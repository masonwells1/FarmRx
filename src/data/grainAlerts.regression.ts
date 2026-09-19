import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { farmOperationRequestHeaders, type FarmOperationContext } from './farmOperationContext'
import { evaluateGrainAlerts, recordMarketingAlertTransitionsGuarded, requestOwnerAlertDeliveryGuarded, type GrainAlert } from './grainAlerts'
import type { GrainWorkspace } from './grain'

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
const migrationSource = readFileSync(fileURLToPath(new URL('../../supabase/migrations/20260716122229_0041_unscoped_authenticated_write_fencing.sql', import.meta.url)), 'utf8')
const transitionStart = migrationSource.indexOf('create or replace function public.record_marketing_alert_transition')
const serverFence = migrationSource.indexOf('perform public.assert_current_farm_access_epoch(p_farm_id);', transitionStart)
const stateLock = migrationSource.indexOf('perform pg_advisory_xact_lock', transitionStart)
assert(transitionStart >= 0 && serverFence > transitionStart && stateLock > serverFence, 'The production transition RPC must enforce the captured user/farm epoch before locking or changing alert state.')

// GL-004: a plan target's cash-price alert reads the farm's own elevator bids only. A USDA MARS feed row
// (column provenance or the note prefix) is display-only and never reaches a price target, exactly as the
// marketing rules and Today already treat it.
{
  const stamp = '2026-07-13T12:00:00.000Z'
  const alertNow = new Date('2026-07-13T18:00:00.000Z')
  const bid = (id: number, cash_price: number, extra: Record<string, unknown> = {}) => ({ id: uid(id), farm_id: uid(2), elevator: 'Local elevator', commodity_id: 'corn', bid_date: '2026-07-13', basis: -0.3, cash_price, delivery_start: null, delivery_end: null, notes: null, feed_source: null, feed_report_id: null, feed_geography: null, created_at: stamp, updated_at: stamp, ...extra })
  const target = { id: uid(20), farm_id: uid(2), crop_year: 2026, commodity_id: 'corn', operating_entity_id: null, enterprise_label: null, target_month: '2026-09', target_pct_of_production: 10, target_price: 4.5, breakeven_relative_pct: null, deadline: null, notes: null, created_at: stamp, updated_at: stamp }
  const workspace = { fields: { farm: { id: uid(2), time_zone: 'America/Chicago' }, commodities: [{ id: 'corn', name: 'Corn' }], crop_assignments: [], entities: [], fields: [] }, production_estimates: [], grain_contracts: [], grain_contract_deliveries: [], marketing_plan_targets: [target], insurance_units: [], grain_bins: [], bin_inventory: [], bin_transactions: [], cash_bids: [], usda_report_dates: [], usda_market_reports: [], marketing_alert_rules: [], firm_offers: [], grain_alert_settings: null, grain_sale_limits: [], grain_carry_settings: null, grain_carry_grids: [] } as unknown as GrainWorkspace
  const feedByColumn = bid(30, 4.9, { elevator: 'Cedar Rapids', feed_source: 'usda_mars', feed_report_id: '2850', feed_geography: 'IA', notes: '[USDA MARS 2850 · Iowa]' })
  const feedByNote = bid(31, 4.9, { elevator: 'Cedar Rapids', notes: '[USDA MARS 2850] basis -0.35' })
  const manualBelow = bid(32, 4.2)
  const manualAbove = bid(33, 4.6)
  const priceAlerts = (bids: unknown[]) => evaluateGrainAlerts({ ...workspace, cash_bids: bids as GrainWorkspace['cash_bids'] }, alertNow).filter((alert) => alert.kind === 'price_target')
  assert(priceAlerts([feedByColumn, feedByNote, manualBelow]).length === 0, 'A USDA MARS feed row at or above the target must not raise a plan-target price alert.')
  const reached = priceAlerts([feedByColumn, feedByNote, manualAbove])
  assert(reached.length === 1 && reached[0]!.observationId === manualAbove.id && reached[0]!.targetId === target.id, 'The farm\'s own bid at or above the target raises the alert, naming that bid.')
  const highestManual = priceAlerts([bid(34, 4.7), feedByColumn, manualAbove])
  assert(highestManual[0]!.observationId === uid(34), 'The alert names the highest manual bid, never a feed row above it.')
}

console.log('Grain alert operation-context regression passed (capture-before-load, dispatch-race rejection, auth/invoke/transition fencing, and exact headers; plan-target price alerts ignore USDA MARS feed rows).')
