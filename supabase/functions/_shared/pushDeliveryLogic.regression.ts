import { deliverClaimedPushTargets, type ClaimedPushTarget, type PushTargetOutcome } from './pushDeliveryLogic'

const targets: ClaimedPushTarget[]=[
  {target_id:'target-a',notification_id:'notification-1',endpoint:'device-a',p256dh:'a',auth:'a',title:'Alert',body:'Body',link:'/notifications',category:'task'},
  {target_id:'target-b',notification_id:'notification-1',endpoint:'device-b',p256dh:'b',auth:'b',title:'Alert',body:'Body',link:'/notifications',category:'task'},
]
const state=new Map(targets.map((target)=>[target.target_id,'pending' as 'pending'|'sending'|PushTargetOutcome]))
const sends:string[]=[]
let failB=true
const database={
  async claimTargets(){const claimed=targets.filter((target)=>state.get(target.target_id)==='pending'||state.get(target.target_id)==='retry');for(const target of claimed)state.set(target.target_id,'sending');return claimed},
  async finishTarget(targetId:string,outcome:PushTargetOutcome){state.set(targetId,outcome)},
  async getHealth(){return{terminalFailed:0,retryable:[...state.values()].filter((value)=>value==='pending'||value==='sending'||value==='retry').length}},
}
const provider={async send(target:ClaimedPushTarget,payload:string){sends.push(target.target_id);const parsed=JSON.parse(payload) as {notification_id?:string};if(parsed.notification_id!=='notification-1')throw new Error('payload omitted notification_id');if(target.target_id==='target-b'&&failB){failB=false;const error=new Error('transient');(error as Error&{statusCode:number}).statusCode=503;throw error}}}

const first=await deliverClaimedPushTargets(database,provider,null)
const second=await deliverClaimedPushTargets(database,provider,null)
if(first.sent!==1||first.failed!==1||second.sent!==1||second.failed!==0)throw new Error(`partial retry counts were wrong: ${JSON.stringify({first,second})}`)
if(sends.filter((id)=>id==='target-a').length!==1||sends.filter((id)=>id==='target-b').length!==2)throw new Error(`successful device was resent during partial retry: ${JSON.stringify(sends)}`)
if(state.get('target-a')!=='sent'||state.get('target-b')!=='sent')throw new Error('both device targets did not finish independently')

const goneTarget:ClaimedPushTarget={...targets[0],target_id:'target-gone',endpoint:'gone-device'}
state.set(goneTarget.target_id,'pending');targets.push(goneTarget)
const goneProvider={async send(target:ClaimedPushTarget){if(target.target_id==='target-gone'){const error=new Error('gone');(error as Error&{statusCode:number}).statusCode=410;throw error}}}
const gone=await deliverClaimedPushTargets(database,goneProvider,null)
if(gone.gone!==1||gone.failed!==0||state.get('target-gone')!=='gone')throw new Error('404/410 target blocked delivery completion')

let completionAttempts=0
let acceptedSends=0
const completionTarget:ClaimedPushTarget={...targets[0],target_id:'target-completion',notification_id:'notification-completion'}
const completion=await deliverClaimedPushTargets({
  async claimTargets(){return[completionTarget]},
  async finishTarget(_targetId,outcome){if(outcome!=='sent')throw new Error('provider success was misclassified');completionAttempts+=1;if(completionAttempts===1)throw new Error('transient database completion failure')},
  async getHealth(){return{terminalFailed:0,retryable:0}},
},{async send(){acceptedSends+=1}},null)
if(acceptedSends!==1||completionAttempts!==2||completion.sent!==1)throw new Error(`provider success was resent after a completion failure: ${JSON.stringify({acceptedSends,completionAttempts,completion})}`)

const terminal=await deliverClaimedPushTargets({async claimTargets(){return[]},async finishTarget(){throw new Error('unexpected finish')},async getHealth(){return{terminalFailed:1,retryable:0}}},{async send(){throw new Error('unexpected send')}},null)
if(terminal.terminalFailed!==1||terminal.claimed!==0)throw new Error('terminal push failure disappeared from a later empty sweep')

const hangingTargets=Array.from({length:100},(_,index)=>({...targets[0],target_id:`hanging-${index}`,notification_id:'notification-hanging',endpoint:`hanging-device-${index}`}))
let active=0;let maxActive=0;let started=0;const retryOutcomes:string[]=[]
const began=Date.now()
const bounded=await deliverClaimedPushTargets({
  async claimTargets(){return hangingTargets},
  async finishTarget(targetId,outcome){if(outcome!=='retry')throw new Error('budget exhaustion was not retryable');retryOutcomes.push(targetId)},
  async getHealth(){return{terminalFailed:0,retryable:100}},
},{async send(){started+=1;active+=1;maxActive=Math.max(maxActive,active);await new Promise<void>(()=>{})}},null,{limit:100,concurrency:4,budgetMs:100})
const elapsed=Date.now()-began
if(elapsed>1_000||maxActive>4||started>4||bounded.claimed!==100||bounded.failed!==100||bounded.retryable!==100)throw new Error(`push budget or concurrency failed: ${JSON.stringify({elapsed,maxActive,started,bounded,retries:retryOutcomes.length})}`)
if(retryOutcomes.length>4)throw new Error(`budget expiry started unbounded completion writes: ${retryOutcomes.length}`)

const databaseAbortEvents: string[] = []
function untilDatabaseAbort<T>(signal: AbortSignal, label: string): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    const aborted = () => { databaseAbortEvents.push(label); reject(new DOMException('database request aborted', 'AbortError')) }
    if (signal.aborted) aborted(); else signal.addEventListener('abort', aborted, { once: true })
  })
}
for (const hang of ['claim','finish','health'] as const) {
  const startedAt=Date.now()
  const result=await Promise.race([
    deliverClaimedPushTargets({
      async claimTargets(_notificationId,_limit,signal){if(hang==='claim')return untilDatabaseAbort<ClaimedPushTarget[]>(signal,hang);return[{...targets[0],target_id:`${hang}-target`}]},
      async finishTarget(_targetId,_outcome,_error,signal){if(hang==='finish')return untilDatabaseAbort<void>(signal,hang)},
      async getHealth(_notificationId,signal){if(hang==='health')return untilDatabaseAbort<{terminalFailed:number;retryable:number}>(signal,hang);return{terminalFailed:0,retryable:1}},
    },{async send(){}},null,{limit:1,concurrency:1,budgetMs:100}).then((value)=>({kind:'result' as const,value})).catch(()=>({kind:'rejected' as const})),
    new Promise<{kind:'outer-timeout'}>((resolve)=>setTimeout(()=>resolve({kind:'outer-timeout'}),1_000)),
  ])
  if(result.kind==='outer-timeout'||Date.now()-startedAt>1_000)throw new Error(`${hang} escaped the whole-delivery deadline`)
  if(hang!=='claim'&&result.kind==='result'&&result.value.failed<1)throw new Error(`${hang} timeout did not return unhealthy state`)
  if(!databaseAbortEvents.includes(hang))throw new Error(`${hang} database operation did not receive the absolute-deadline AbortSignal`)
}

let observedProviderTimeout=0
let observedProviderAbort=false
const providerBudgetStarted=Date.now()
const providerBudget=await deliverClaimedPushTargets({
  async claimTargets(){return[{...targets[0],target_id:'provider-timeout-target'}]},
  async finishTarget(_targetId,outcome){if(outcome!=='retry')throw new Error('provider timeout was not left retryable')},
  async getHealth(){return{terminalFailed:0,retryable:1}},
},{async send(_target,_payload,signal,timeoutMs){observedProviderTimeout=timeoutMs;return new Promise((_resolve,reject)=>{const fail=()=>{observedProviderAbort=true;const error=new Error('provider timeout');error.name='AbortError';reject(error)};if(signal.aborted)fail();else signal.addEventListener('abort',fail,{once:true})})}},null,{limit:1,concurrency:1,budgetMs:100})
if(Date.now()-providerBudgetStarted>1_000||observedProviderTimeout<1||observedProviderTimeout>50||!observedProviderAbort||providerBudget.failed!==1||providerBudget.retryable!==1)throw new Error(`provider timeout was not bounded by the absolute delivery deadline: ${JSON.stringify({elapsed:Date.now()-providerBudgetStarted,observedProviderTimeout,observedProviderAbort,providerBudget})}`)
console.log('Push per-device retry regression passed (partial retry, one absolute deadline with database/provider cancellation, completion retry without resend, gone target, terminal health).')
