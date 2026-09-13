import { CARRY_GRID_ROWS, defaultCarrySettings, emptyCarryRows, validateGrainCarryGrid, validateGrainCarrySettings, validateGrainSaleLimit } from './grainSettings'
import { parseGrainQueue } from './grainWriteQueue'
import { readGrain } from './MockGrainRepository'
import type { GrainCarryGrid, GrainCarrySettings, GrainSaleLimit } from './grain'
import { settingsSlicesFromResults } from './SupabaseGrainDataGateway'
import { saveCostLineWithBadgeFallback } from './SupabaseProfitabilityDataGateway'

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

console.log('Grain settings regressions passed.')
