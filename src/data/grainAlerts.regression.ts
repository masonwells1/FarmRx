import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { farmOperationRequestHeaders, type FarmOperationContext } from './farmOperationContext'
import { recordMarketingAlertTransitionsGuarded, requestOwnerAlertDeliveryGuarded, type GrainAlert } from './grainAlerts'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const context: FarmOperationContext = { projectRef: 'grain-alert-regression', userId: uid(1), farmId: uid(2), generation: 1, token: uid(3), serverEpoch: 7 }
const alerts: GrainAlert[] = [{ key: 'alert:one', kind: 'usda_report', reportId: uid(4), message: 'One' }, { key: 'alert:two', kind: 'usda_report', reportId: uid(5), message: 'Two' }]
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => Promise<unknown>, message: string) { try { await action() } catch { return } throw new Error(message) }

// The UI must capture once before the Grain load; no post-load recapture can
// turn a Farm A refresh into Farm B alert state or delivery work.
const moduleSource = readFileSync(fileURLToPath(new URL('../GrainModule.tsx', import.meta.url)), 'utf8')
const captureIndex = moduleSource.indexOf('const alertOperationContext = await captureGrainAlertOperationContext()')
const loadIndex = moduleSource.indexOf('services.grainRepository.getData()', captureIndex)
assert(captureIndex >= 0 && loadIndex > captureIndex, 'Grain alert context must be captured before repository data begins loading.')

// A change during auth verification stops before any Edge invocation or sent-state write.
let valid = true; let invokes = 0; let writes = 0
await rejects(() => requestOwnerAlertDeliveryGuarded(alerts, context.farmId, context, {
  verify: async () => { if (!valid) throw new Error('context changed') },
  getUser: async () => { valid = false; return { userId: context.userId, error: null } },
  invoke: async () => { invokes += 1; return null }, readSent: () => new Set(), writeSent: () => { writes += 1 },
}), 'An alert operation whose context changed during auth verification must reject.')
assert(invokes === 0 && writes === 0, 'A changed alert context reached Edge delivery or sent-state persistence after auth.')

// A change while the first invocation is in flight stops every later invocation
// and never records the alert as sent under either identity.
valid = true; invokes = 0; writes = 0; let observedHeaders: Record<string, string> | null = null
await rejects(() => requestOwnerAlertDeliveryGuarded(alerts, context.farmId, context, {
  verify: async () => { if (!valid) throw new Error('context changed') },
  getUser: async () => ({ userId: context.userId, error: null }),
  invoke: async (_alert, _farmId, headers) => { invokes += 1; observedHeaders = headers; valid = false; return null },
  readSent: () => new Set(), writeSent: () => { writes += 1 },
}), 'An alert operation whose context changed during Edge invocation must reject.')
assert(invokes === 1 && writes === 0, 'A changed alert context invoked a later alert or persisted sent state.')
assert(JSON.stringify(observedHeaders) === JSON.stringify(farmOperationRequestHeaders(context)), 'The Edge invocation did not carry the exact captured user and access epoch.')

// Transition recording has the same fence: a change after rule one prevents rule two.
valid = true; let transitions = 0
await rejects(() => recordMarketingAlertTransitionsGuarded(context.farmId, [{ ruleId: uid(6), met: true }, { ruleId: uid(7), met: true }], context, {
  verify: async () => { if (!valid) throw new Error('context changed') }, hasCapability: async () => true,
  record: async (_condition, headers) => { transitions += 1; assert(JSON.stringify(headers) === JSON.stringify(farmOperationRequestHeaders(context)), 'The transition RPC lost its captured headers.'); valid = false; return { data: { fired: true }, error: null } },
}), 'A changed alert-transition context must reject.')
assert(transitions === 1, 'A changed alert-transition context reached a later RPC.')

// A session replacement after the final client check but before RPC dispatch
// must be rejected by the SQL fence before alert_rule_states can change.
let remoteTransitions = 0
const laterUserId = uid(8)
const dispatchRace = await recordMarketingAlertTransitionsGuarded(context.farmId, [{ ruleId: uid(9), met: true }], context, {
  verify: async () => undefined,
  hasCapability: async () => true,
  record: async (_condition, headers) => {
    if (headers['x-farm-rx-expected-user-id'] !== laterUserId) return { data: null, error: { code: 'P0001' } }
    remoteTransitions += 1
    return { data: { fired: true }, error: null }
  },
})
assert(dispatchRace?.size === 0 && remoteTransitions === 0, 'A later authenticated user changed alert state for an earlier captured operation.')
const migrationSource = readFileSync(fileURLToPath(new URL('../../supabase/migrations/0041_unscoped_authenticated_write_fencing.sql', import.meta.url)), 'utf8')
const transitionStart = migrationSource.indexOf('create or replace function public.record_marketing_alert_transition')
const serverFence = migrationSource.indexOf('perform public.assert_current_farm_access_epoch(p_farm_id);', transitionStart)
const stateLock = migrationSource.indexOf('perform pg_advisory_xact_lock', transitionStart)
assert(transitionStart >= 0 && serverFence > transitionStart && stateLock > serverFence, 'The production transition RPC must enforce the captured user/farm epoch before locking or changing alert state.')

console.log('Grain alert operation-context regression passed (capture-before-load, dispatch-race rejection, auth/invoke/transition fencing, and exact headers).')
