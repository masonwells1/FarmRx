import { runScheduledAlertSweep, scheduledAlertRunHasFailures, type ScheduledAlertDatabase, type ScheduledWeatherField } from './scheduledAlertOrchestrator'

const fixed = new Date('2026-07-15T14:15:00.000Z')
const fields: ScheduledWeatherField[] = [
  { id:'timeout-field',farm_id:'farm-a',name:'Timeout',latitude:1,longitude:1 },
  { id:'non-ok-field',farm_id:'farm-a',name:'Non OK',latitude:2,longitude:2 },
  { id:'malformed-field',farm_id:'farm-a',name:'Malformed',latitude:3,longitude:3 },
  { id:'good-field',farm_id:'farm-b',name:'Good',latitude:4,longitude:4 },
]
const times=['2026-07-15T14:00','2026-07-15T15:00','2026-07-15T16:00','2026-07-15T17:00','2026-07-15T18:00']
const values=(value:number)=>times.map(()=>value)
const goodWeather={utc_offset_seconds:0,current:{time:'2026-07-15T14:15',temperature_2m:74,relative_humidity_2m:60,precipitation:0,rain:0,weather_code:1,wind_speed_10m:6,wind_gusts_10m:9},hourly:{time:times,temperature_2m:values(74),relative_humidity_2m:values(60),precipitation:values(0),rain:values(0),weather_code:values(1),wind_speed_10m:values(6),wind_gusts_10m:values(9),precipitation_probability:values(10)}}

let sweepRuns=0
let pushRuns=0
let goodState=false
let records=0
const database: ScheduledAlertDatabase={
  async runAlertSweep(nowIso){if(nowIso!==fixed.toISOString())throw new Error('injected clock was not used');sweepRuns+=1;return{program_created:sweepRuns===1?1:0}},
  async listWeatherFields(){return fields},
  async recordSprayWindow(input){if(input.fieldId!=='good-field')throw new Error('failed field reached database');records+=1;const fired=!goodState&&input.isGood;goodState=input.isGood;return{fired}},
}
const fetchWeather=async(field:ScheduledWeatherField)=>{if(field.id==='timeout-field'){const error=new Error('timeout');error.name='AbortError';throw error}if(field.id==='non-ok-field')throw new Error('provider non-OK');if(field.id==='malformed-field')return{ok:true};return goodWeather}
const run=()=>runScheduledAlertSweep({now:()=>new Date(fixed),database,fetchWeather,runPushSweep:async()=>{pushRuns+=1;return{sent:1,failed:0}}})
const first=await run()
const second=await run()
if(first.weatherChecked!==1||first.weatherFailed!==3||first.sprayFired!==1)throw new Error(`per-field continuation failed: ${JSON.stringify(first)}`)
if(second.weatherChecked!==1||second.weatherFailed!==3||second.sprayFired!==0)throw new Error(`fixed-clock replay was not idempotent: ${JSON.stringify(second)}`)
if(sweepRuns!==2||pushRuns!==2||records!==2)throw new Error('orchestration dependencies were not invoked deterministically')
if(!scheduledAlertRunHasFailures(first))throw new Error('weather partial failures were reported healthy')
if(!scheduledAlertRunHasFailures({...second,sweep:{farm_failure_count:1},weatherFailed:0,weatherFailureFields:[]}))throw new Error('farm-local failures were reported healthy')

let pushFailureSurfaced=false
try{await runScheduledAlertSweep({now:()=>new Date(fixed),database:{...database,async listWeatherFields(){return[]}},fetchWeather,runPushSweep:async()=>{throw new Error('provider failure')}})}catch{pushFailureSurfaced=true}
if(!pushFailureSurfaced)throw new Error('final push-sweep failure was reported as success')

const hangingFields=Array.from({length:50},(_,index)=>({id:`hanging-${index}`,farm_id:'farm-timeout',name:`Hanging ${index}`,latitude:index,longitude:index}))
let deadlinePushes=0
const deadlineStarted=Date.now()
const deadlineResult=await runScheduledAlertSweep({
  now:()=>new Date(fixed),
  database:{async runAlertSweep(){return{farm_failure_count:0}},async listWeatherFields(){return hangingFields},async recordSprayWindow(){throw new Error('timed-out weather reached the database')}},
  fetchWeather:async(_field,signal)=>new Promise((_resolve,reject)=>{const fail=()=>{const error=new Error('deadline');error.name='AbortError';reject(error)};if(signal.aborted)fail();else signal.addEventListener('abort',fail,{once:true})}),
  runPushSweep:async()=>{deadlinePushes+=1;return{sent:1,failed:0}},
  weatherConcurrency:5,
  weatherDeadlineMs:25,
})
if(Date.now()-deadlineStarted>1_000||deadlinePushes!==1||!deadlineResult.weatherTimedOut||deadlineResult.weatherFailed!==50)throw new Error(`global weather deadline did not preserve push delivery: ${JSON.stringify({elapsed:Date.now()-deadlineStarted,deadlinePushes,deadlineResult})}`)

let recordAbortObserved=false
let pushAfterRecordAbort=0
const hangingRecordStarted=Date.now()
const hangingRecordResult=await runScheduledAlertSweep({
  now:()=>new Date(fixed),
  database:{
    async runAlertSweep(){return{farm_failure_count:0}},
    async listWeatherFields(){return[fields[3]!]},
    async recordSprayWindow(_input,signal){return new Promise((_resolve,reject)=>{const fail=()=>{recordAbortObserved=true;const error=new Error('record deadline');error.name='AbortError';reject(error)};if(signal.aborted)fail();else signal.addEventListener('abort',fail,{once:true})})},
  },
  fetchWeather:async()=>goodWeather,
  runPushSweep:async()=>{if(!recordAbortObserved)throw new Error('push began before the timed-out database record stopped');pushAfterRecordAbort+=1;return{sent:1,failed:0}},
  weatherDeadlineMs:25,
  schedulerDeadlineMs:500,
})
if(Date.now()-hangingRecordStarted>1_000||!recordAbortObserved||pushAfterRecordAbort!==1||!hangingRecordResult.weatherTimedOut||hangingRecordResult.weatherFailed!==1)throw new Error(`a timed-out weather database write outlived the weather phase: ${JSON.stringify({elapsed:Date.now()-hangingRecordStarted,recordAbortObserved,pushAfterRecordAbort,hangingRecordResult})}`)

for(const hang of ['sweep','fields','push'] as const){
  let abortObserved=false
  const untilAbort=<T>(signal:AbortSignal)=>new Promise<T>((_resolve,reject)=>{const fail=()=>{abortObserved=true;const error=new Error('scheduler deadline');error.name='AbortError';reject(error)};if(signal.aborted)fail();else signal.addEventListener('abort',fail,{once:true})})
  const started=Date.now()
  let rejected=false
  try{await runScheduledAlertSweep({
    now:()=>new Date(fixed),
    database:{
      async runAlertSweep(_nowIso,signal){if(hang==='sweep')return untilAbort(signal);return{farm_failure_count:0}},
      async listWeatherFields(signal){if(hang==='fields')return untilAbort(signal);return[]},
      async recordSprayWindow(){return{}},
    },
    fetchWeather,
    runPushSweep:async(signal)=>{if(hang==='push')return untilAbort(signal);return{sent:0,failed:0}},
    schedulerDeadlineMs:25,
  })}catch{rejected=true}
  if(Date.now()-started>1_000||!rejected||!abortObserved)throw new Error(`${hang} database/provider work escaped the scheduler deadline`)
}
console.log('Scheduled Edge orchestration regression passed (fixed clock, replay, field isolation, database cancellation, whole-run deadline, push failure).')
