import { CARRY_GRID_ROWS, defaultCarrySettings, emptyCarryRows, validateGrainCarryGrid, validateGrainCarrySettings, validateGrainSaleLimit } from './grainSettings'
import { parseGrainQueue } from './grainWriteQueue'
import { readGrain } from './MockGrainRepository'
import type { GrainCarryGrid, GrainCarrySettings, GrainSaleLimit } from './grain'
import { settingsSlicesFromResults } from './SupabaseGrainDataGateway'
import { saveCostLineWithBadgeFallback } from './SupabaseProfitabilityDataGateway'
import { beginPendingSettingsWork, hasPendingSettingsWork, registerPendingSettingsFlush, SETTINGS_SAVE_FAILED, SETTINGS_SAVE_STILL_RUNNING, settlePendingSettingsWork } from './pendingSettingsWork'
import { clearSettingsDraft, readSettingsDrafts, settingsDraftsKey, writeSettingsDraft } from './settingsDrafts'

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const stamp = '2026-09-13T12:00:00.000Z'
const farm = uid(10)
const limit: GrainSaleLimit = { id: uid(30), farm_id: farm, crop_year: 2026, commodity_id: 'corn_yellow', operating_entity_id: null, enterprise_label: null, sale_limit_bushels: 50_000, created_at: stamp, updated_at: stamp }
const settings: GrainCarrySettings = defaultCarrySettings(farm, stamp)
const grid: GrainCarryGrid = { id: uid(31), farm_id: farm, production_estimate_id: uid(12), harvest_month: 9, default_basis: -0.25, rows: emptyCarryRows(), updated_at: stamp }

// Validators: the same rules the database enforces, so a bad value never reaches the queue.
assert(validateGrainSaleLimit(limit).length === 0 && validateGrainSaleLimit({ ...limit, sale_limit_bushels: null }).length === 0, 'A sale limit of bushels or "none" is valid.')
assert(validateGrainSaleLimit({ ...limit, sale_limit_bushels: -1 }).length === 1, 'A negative sale limit must be rejected.')
assert(validateGrainSaleLimit({ ...limit, crop_year: 1899 }).length === 1, 'An out-of-range crop year must be rejected.')
assert(validateGrainCarrySettings(settings).length === 0, 'Default carry settings are valid.')
assert(validateGrainCarrySettings({ ...settings, mode: 'weekly' as GrainCarrySettings['mode'] }).length === 1, 'An unknown storage mode must be rejected.')
assert(validateGrainCarrySettings({ ...settings, trucking_per_bu: -0.01 }).length === 1, 'A negative trucking rate must be rejected.')
assert(validateGrainCarrySettings({ ...settings, interest_rate_pct: 101 }).length === 1, 'An interest rate above 100% must be rejected.')
assert(validateGrainCarryGrid(grid).length === 0 && grid.rows.length === CARRY_GRID_ROWS, 'A thirteen-row grid is valid.')
assert(validateGrainCarryGrid({ ...grid, rows: grid.rows.slice(0, 12) }).length === 1, 'A twelve-row grid must be rejected.')
assert(validateGrainCarryGrid({ ...grid, harvest_month: 12 }).length === 1, 'Harvest month 12 must be rejected.')
assert(validateGrainCarryGrid({ ...grid, rows: grid.rows.map((row, index) => index === 3 ? { market_price: Number.NaN, basis: 0 } : row) }).length === 1, 'A NaN price must be rejected.')

// Offline queue: the three new kinds parse exactly and malformed rows fail closed.
const common = { version: 1 as const, module: 'grain' as const, operationId: uid(900), userId: uid(1), farmId: farm, enqueuedAt: stamp }
const envelope = (entries: unknown[]) => JSON.stringify({ version: 1, entries })
const parsed = parseGrainQueue(envelope([{ ...common, kind: 'saveGrainSaleLimit', row: limit }, { ...common, operationId: uid(901), kind: 'saveGrainCarrySettings', row: settings }, { ...common, operationId: uid(902), kind: 'saveGrainCarryGrid', row: grid }]))
assert(parsed.entries.length === 3 && parsed.entries.map((entry) => entry.kind).join(',') === 'saveGrainSaleLimit,saveGrainCarrySettings,saveGrainCarryGrid', 'All three settings kinds must parse from the offline queue.')
for (const [label, entry] of [
  ['a twelve-row grid', { ...common, kind: 'saveGrainCarryGrid', row: { ...grid, rows: grid.rows.slice(0, 12) } }],
  ['a grid cell with an extra key', { ...common, kind: 'saveGrainCarryGrid', row: { ...grid, rows: grid.rows.map((row) => ({ ...row, extra: 1 })) } }],
  ['a sale limit with a string amount', { ...common, kind: 'saveGrainSaleLimit', row: { ...limit, sale_limit_bushels: '50000' } }],
  ['carry settings with an unknown mode', { ...common, kind: 'saveGrainCarrySettings', row: { ...settings, mode: 'weekly' } }],
  ['carry settings missing a rate', { ...common, kind: 'saveGrainCarrySettings', row: (({ trucking_per_bu: _t, ...rest }) => rest)(settings) } ],
] as const) {
  let failed = false
  try { parseGrainQueue(envelope([entry])) } catch { failed = true }
  assert(failed, `The offline queue must reject ${label}.`)
}

// Mock persistence: the three slices round-trip and default when an older envelope lacks them.
const stored = readGrain({ production_estimates: [], grain_contracts: [], marketing_plan_targets: [], insurance_units: [], grain_bins: [], bin_inventory: [], cash_bids: [], marketing_alert_rules: [], grain_alert_settings: null, grain_sale_limits: [limit], grain_carry_settings: settings, grain_carry_grids: [grid] })
assert(stored && stored.grain_sale_limits.length === 1 && stored.grain_carry_settings?.mode === 'monthly' && stored.grain_carry_grids[0].rows.length === CARRY_GRID_ROWS && stored.capabilities?.persisted_settings === true, 'Mock grain storage must keep sale limits, carry settings, and carry grids.')
const legacy = readGrain({ production_estimates: [], grain_contracts: [], marketing_plan_targets: [], insurance_units: [], grain_bins: [], bin_inventory: [], cash_bids: [], marketing_alert_rules: [] })
assert(legacy && legacy.grain_sale_limits.length === 0 && legacy.grain_carry_settings === null && legacy.grain_carry_grids.length === 0, 'An older mock envelope must default the new slices to empty.')

// Backward compatibility: before the slice-3 migration is applied, the three tables are missing and the
// gateway must report persisted_settings=false with empty slices instead of failing the whole Grain load.
const ok = (data: unknown) => ({ data, error: null })
const missing = (code: string) => ({ data: null, error: { code, message: 'relation does not exist' } })
const live = settingsSlicesFromResults(ok([limit]), ok(settings), ok([grid]))
assert(live.persisted && live.grain_sale_limits.length === 1 && live.grain_carry_settings !== null && live.grain_carry_grids.length === 1, 'Present tables must map through with persisted=true.')
for (const code of ['42P01', 'PGRST205']) {
  for (const [label, slices] of [['sale limits', settingsSlicesFromResults(missing(code), ok(settings), ok([grid]))], ['carry settings', settingsSlicesFromResults(ok([limit]), missing(code), ok([grid]))], ['carry grids', settingsSlicesFromResults(ok([limit]), ok(settings), missing(code))]] as const) {
    assert(!slices.persisted && slices.grain_sale_limits.length === 0 && slices.grain_carry_settings === null && slices.grain_carry_grids.length === 0, `A missing ${label} table (${code}) must yield persisted=false and empty slices.`)
  }
}
let threw = false
try { settingsSlicesFromResults(ok([limit]), { data: null, error: { code: '42501', message: 'denied' } }, ok([grid])) } catch { threw = true }
assert(threw, 'Any other carry-settings error must still fail closed.')

// The badge column is written when present and dropped only on PGRST204 (column missing on the live database).
const attempts: Array<Record<string, unknown>> = []
const savedWith = await saveCostLineWithBadgeFallback(async (columns) => { attempts.push(columns); return columns }, { id: uid(40), label: 'Seed' }, 120)
assert(attempts.length === 1 && savedWith.university_default_amount === 120, 'The badge column is written on the first attempt when the database has it.')
attempts.length = 0
const savedWithout = await saveCostLineWithBadgeFallback(async (columns) => { attempts.push(columns); if ('university_default_amount' in columns) throw Object.assign(new Error('column not found'), { code: 'PGRST204' }); return columns }, { id: uid(40), label: 'Seed' }, 120)
assert(attempts.length === 2 && !('university_default_amount' in savedWithout), 'PGRST204 must retry once without the badge column.')
let rethrown = false
try { await saveCostLineWithBadgeFallback(async () => { throw Object.assign(new Error('stale'), { code: '23505' }) }, { id: uid(40) }, null) } catch { rethrown = true }
assert(rethrown, 'Any other error must not be swallowed by the badge fallback.')

// Pending-work registry: the farm switcher warns while any settings save is queued or in flight.
assert(!hasPendingSettingsWork(farm), 'No settings work is pending before any save.')
const doneA = beginPendingSettingsWork(farm); const doneB = beginPendingSettingsWork(farm)
assert(hasPendingSettingsWork(farm) && !hasPendingSettingsWork(uid(20)), 'Pending work is tracked per farm.')
doneA(); doneA()
assert(hasPendingSettingsWork(farm), 'One finished save must not clear another still pending, and finishing twice is harmless.')
doneB()
assert(!hasPendingSettingsWork(farm), 'The farm is clear once every queued save has run.')

// A confirmed farm switch sends unflushed edits and waits for every save (including one chained behind another) before the farm changes.
{
  const events: string[] = []
  let releaseFirst: () => void = () => undefined
  let releaseSecond: () => void = () => undefined
  const unregister = registerPendingSettingsFlush(farm, () => { events.push('flushed'); releaseFirst = beginPendingSettingsWork(farm) })
  const otherFarmDone = beginPendingSettingsWork(uid(20))
  let settled = false
  const waiting = settlePendingSettingsWork(farm).then(() => { settled = true })
  assert(events.join() === 'flushed' && hasPendingSettingsWork(farm), 'Settling must send unflushed edits first and then wait for their save.')
  await Promise.resolve()
  assert(!settled, 'Settling must not finish while a save is still in flight.')
  releaseSecond = beginPendingSettingsWork(farm) // a follow-up save chained behind the first
  releaseFirst()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert(!settled, 'Settling must also wait for a save that started while the first one was running.')
  releaseSecond()
  await waiting
  assert(settled && !hasPendingSettingsWork(farm) && hasPendingSettingsWork(uid(20)), 'Settling finishes once the farm is clear and leaves other farms alone.')
  unregister(); otherFarmDone()
  await settlePendingSettingsWork(farm)
  assert(events.length === 1, 'An unregistered screen is not flushed again.')
  // A save that keeps re-queuing itself cannot hold the switch forever: the switch is refused instead.
  let hops = 0
  const repeat = () => { const done = beginPendingSettingsWork(farm); hops += 1; setTimeout(() => { if (hops < 100) repeat(); done() }, 0) }
  repeat()
  const rounds = await settlePendingSettingsWork(farm, { maxRounds: 5 }).then(() => 'resolved', (error: Error) => error.message)
  assert(rounds === SETTINGS_SAVE_STILL_RUNNING && hops >= 5 && hops < 100, 'The round count is bounded and refuses the switch.')
  await new Promise((resolve) => setTimeout(resolve, 20)); hops = 100
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert(!hasPendingSettingsWork(farm), 'The repeating save has stopped.')
  // A save that failed before reaching the server or the durable queue refuses the switch, so the edit is not discarded.
  const failing = beginPendingSettingsWork(farm)
  const failed = settlePendingSettingsWork(farm).then(() => 'resolved', (error: Error) => error.message)
  failing(new Error('boom'))
  assert((await failed) === SETTINGS_SAVE_FAILED && !hasPendingSettingsWork(farm), 'A failed save must refuse the switch and clear its token.')
  // A save still running after the time limit refuses the switch and keeps the work pending for the farm.
  const stalled = beginPendingSettingsWork(farm)
  const stall = await settlePendingSettingsWork(farm, { timeoutMs: 20 }).then(() => 'resolved', (error: Error) => error.message)
  assert(stall === SETTINGS_SAVE_STILL_RUNNING && hasPendingSettingsWork(farm), 'A stalled save must refuse the switch after the time limit and stay pending.')
  stalled()
  await settlePendingSettingsWork(farm, { timeoutMs: 20 })
  assert(!hasPendingSettingsWork(farm), 'Nothing pending settles at once.')
  // A failed save surfaces at once even while another token is still open.
  const open = beginPendingSettingsWork(farm); const quickFail = beginPendingSettingsWork(farm)
  const fast = settlePendingSettingsWork(farm, { timeoutMs: 500 }).then(() => 'resolved', (error: Error) => error.message)
  quickFail(new Error('boom'))
  assert((await fast) === SETTINGS_SAVE_FAILED && hasPendingSettingsWork(farm), 'A failure must not wait for the other saves or the time limit.')
  open()
}

// Browser drafts: written per account and farm on every edit, cleared only after a confirmed save, invisible to other accounts,
// and shaped so the farm switcher's scan counts them as work waiting for that farm.
{
  const store = new Map<string, string>()
  const fakeStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) }, removeItem: (key: string) => { store.delete(key) }, key: (index: number) => [...store.keys()][index] ?? null, get length() { return store.size }, clear: () => store.clear() }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fakeStorage })
  const scopeA = { projectRef: 'proj', userId: uid(1), farmId: farm }; const scopeB = { ...scopeA, userId: uid(2) }
  assert(readSettingsDrafts(scopeA).length === 0, 'No drafts before any edit.')
  writeSettingsDraft(scopeA, 'carry-settings', { draft: 'S1' }, stamp); writeSettingsDraft(scopeA, 'carry-grid:x', { draft: 'G' }, stamp); writeSettingsDraft(scopeA, 'carry-settings', { draft: 'S2' }, stamp)
  const key = settingsDraftsKey(scopeA)
  assert(key.includes('proj') && key.includes(uid(1)) && key.includes(farm) && !key.endsWith(':lease'), 'The draft key names the project, account, and farm so the farm switcher scan finds it.')
  const stored = JSON.parse(store.get(key)!) as { entries: unknown[] }
  assert(Array.isArray(stored.entries) && stored.entries.length === 2, 'The stored value carries a non-empty entries array, one per draft key, latest write winning.')
  assert(readSettingsDrafts(scopeA, 'carry-').length === 2 && (readSettingsDrafts(scopeA, 'carry-settings')[0].payload as { draft: string }).draft === 'S2', 'Drafts read back by prefix with the latest payload.')
  assert(readSettingsDrafts(scopeB).length === 0, 'Another account on the same farm sees no drafts.')
  clearSettingsDraft(scopeA, 'carry-settings')
  assert(readSettingsDrafts(scopeA).length === 1 && readSettingsDrafts(scopeA)[0].key === 'carry-grid:x', 'Clearing one draft leaves the others.')
  clearSettingsDraft(scopeA, 'carry-grid:x')
  assert(store.get(key) === undefined, 'Clearing the last draft removes the key, so the farm no longer looks pending.')
  Reflect.deleteProperty(globalThis, 'localStorage')
}

console.log('Grain settings regressions passed.')
