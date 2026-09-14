import { CARRY_GRID_ROWS, defaultCarrySettings, emptyCarryRows, normalizeGrainCarryGrid, normalizeGrainCarrySettings, normalizeGrainSaleLimit, validateGrainCarryGrid, validateGrainCarrySettings, validateGrainSaleLimit } from './grainSettings'
import { parseGrainQueue } from './grainWriteQueue'
import { isCarryDraft } from '../GrainCostOfCarry'
import { farmerError } from '../lib/farmerErrors'
import { readGrain } from './MockGrainRepository'
import type { GrainCarryGrid, GrainCarrySettings, GrainSaleLimit } from './grain'
import { settingsSlicesFromResults } from './SupabaseGrainDataGateway'
import { BADGE_PROVENANCE_NOT_KEPT, saveCostLineWithBadgeFallback } from './SupabaseProfitabilityDataGateway'
import { forgetLegacyDefaults, readLegacyDefaults, rememberLegacyDefault, retainSeededDefaults, universityDefaultKey, universityDefaultLineOf } from './universityDefaultProvenance'
import { beginPendingSettingsWork, hasPendingSettingsWork, registerPendingSettingsFlush, SETTINGS_SAVE_FAILED, SETTINGS_SAVE_STILL_RUNNING, settlePendingSettingsWork } from './pendingSettingsWork'
import { clearSettingsDraft, readSettingsDrafts, settingsDraftKey, settingsDraftKeyOf, writeSettingsDraft } from './settingsDrafts'
import { queueFarmRevocationScope } from './farmRevocationFence'

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
const savedWith = await saveCostLineWithBadgeFallback(async (columns) => { attempts.push(columns); return columns }, { id: uid(40), label: 'Seed' }, 120, () => true)
assert(attempts.length === 1 && savedWith.university_default_amount === 120, 'The badge column is written on the first attempt when the database has it.')
attempts.length = 0
const savedWithout = await saveCostLineWithBadgeFallback(async (columns) => { attempts.push(columns); if ('university_default_amount' in columns) throw Object.assign(new Error('column not found'), { code: 'PGRST204' }); return columns }, { id: uid(40), label: 'Seed' }, 120, () => true)
assert(attempts.length === 2 && !('university_default_amount' in savedWithout), 'PGRST204 must retry once without the badge column.')
const retained: Array<[string, number]> = []
const lineId = uid(41)
await saveCostLineWithBadgeFallback(async (columns) => { if ('university_default_amount' in columns) throw Object.assign(new Error('column not found'), { code: 'PGRST204' }); return columns }, { id: lineId, label: 'Seed' }, 120, (id, amount) => { retained.push([id, amount]); return true })
await saveCostLineWithBadgeFallback(async (columns) => { if ('university_default_amount' in columns) throw Object.assign(new Error('column not found'), { code: 'PGRST204' }); return columns }, { id: uid(42), label: 'Hand-entered' }, null, (id, amount) => { retained.push([id, amount]); return true })
await saveCostLineWithBadgeFallback(async (columns) => columns, { id: uid(43), label: 'Seed' }, 120, (id, amount) => { retained.push([id, amount]); return true })
assert(retained.length === 1 && retained[0]?.[0] === lineId && retained[0]?.[1] === 120, 'A seeded amount dropped on PGRST204 is retained for the line; a hand-entered line and a stored badge retain nothing.')
// A browser that refuses to keep the seeded amount fails the save closed: nothing is written and the message names the cause.
attempts.length = 0
let refusedMessage = ''
try { await saveCostLineWithBadgeFallback(async (columns) => { attempts.push(columns); if ('university_default_amount' in columns) throw Object.assign(new Error('column not found'), { code: 'PGRST204' }); return columns }, { id: uid(44), label: 'Seed' }, 120, () => false) } catch (error) { refusedMessage = (error as Error).message }
assert(refusedMessage === BADGE_PROVENANCE_NOT_KEPT && attempts.length === 1, 'A refused retention throws before the second attempt, so the line is not saved without its badge.')
assert(farmerError(new Error(BADGE_PROVENANCE_NOT_KEPT), 'save profitability').includes('was not added'), 'The farmer sees why the line was not added.')
let rethrown = false
try { await saveCostLineWithBadgeFallback(async () => { throw Object.assign(new Error('stale'), { code: '23505' }) }, { id: uid(40) }, null, () => true) } catch { rethrown = true }
assert(rethrown, 'Any other error must not be swallowed by the badge fallback.')

// Pending-work registry: the farm switcher warns while any settings save is queued or in flight, for that account and farm only.
const owner = { userId: uid(1), farmId: farm }; const otherFarmOwner = { userId: uid(1), farmId: uid(20) }; const otherAccount = { userId: uid(2), farmId: farm }
assert(!hasPendingSettingsWork(owner), 'No settings work is pending before any save.')
const doneA = beginPendingSettingsWork(owner); const doneB = beginPendingSettingsWork(owner)
assert(hasPendingSettingsWork(owner) && !hasPendingSettingsWork(otherFarmOwner) && !hasPendingSettingsWork(otherAccount), 'Pending work is tracked per account and farm: another account on the same farm sees none of it.')
doneA(); doneA()
assert(hasPendingSettingsWork(owner), 'One finished save must not clear another still pending, and finishing twice is harmless.')
doneB()
assert(!hasPendingSettingsWork(owner), 'The farm is clear once every queued save has run.')

// A confirmed farm switch sends unflushed edits and waits for every save (including one chained behind another) before the farm changes.
{
  const events: string[] = []
  let releaseFirst: () => void = () => undefined
  let releaseSecond: () => void = () => undefined
  const unregister = registerPendingSettingsFlush(owner, () => { events.push('flushed'); releaseFirst = beginPendingSettingsWork(owner) })
  const otherFarmDone = beginPendingSettingsWork(otherFarmOwner)
  let settled = false
  const waiting = settlePendingSettingsWork(owner).then(() => { settled = true })
  assert(events.join() === 'flushed' && hasPendingSettingsWork(owner), 'Settling must send unflushed edits first and then wait for their save.')
  await Promise.resolve()
  assert(!settled, 'Settling must not finish while a save is still in flight.')
  releaseSecond = beginPendingSettingsWork(owner) // a follow-up save chained behind the first
  releaseFirst()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert(!settled, 'Settling must also wait for a save that started while the first one was running.')
  releaseSecond()
  await waiting
  assert(settled && !hasPendingSettingsWork(owner) && hasPendingSettingsWork(otherFarmOwner), 'Settling finishes once the farm is clear and leaves other farms alone.')
  unregister(); otherFarmDone()
  await settlePendingSettingsWork(owner)
  assert(events.length === 1, 'An unregistered screen is not flushed again.')
  // A save that keeps re-queuing itself cannot hold the switch forever: the switch is refused instead.
  let hops = 0
  const repeat = () => { const done = beginPendingSettingsWork(owner); hops += 1; setTimeout(() => { if (hops < 100) repeat(); done() }, 0) }
  repeat()
  const rounds = await settlePendingSettingsWork(owner, { maxRounds: 5 }).then(() => 'resolved', (error: Error) => error.message)
  assert(rounds === SETTINGS_SAVE_STILL_RUNNING && hops >= 5 && hops < 100, 'The round count is bounded and refuses the switch.')
  await new Promise((resolve) => setTimeout(resolve, 20)); hops = 100
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert(!hasPendingSettingsWork(owner), 'The repeating save has stopped.')
  // A save that failed before reaching the server or the durable queue refuses the switch, so the edit is not discarded.
  const failing = beginPendingSettingsWork(owner)
  const failed = settlePendingSettingsWork(owner).then(() => 'resolved', (error: Error) => error.message)
  failing(new Error('boom'))
  assert((await failed) === SETTINGS_SAVE_FAILED && !hasPendingSettingsWork(owner), 'A failed save must refuse the switch and clear its token.')
  // A save still running after the time limit refuses the switch and keeps the work pending for the farm.
  const stalled = beginPendingSettingsWork(owner)
  const stall = await settlePendingSettingsWork(owner, { timeoutMs: 20 }).then(() => 'resolved', (error: Error) => error.message)
  assert(stall === SETTINGS_SAVE_STILL_RUNNING && hasPendingSettingsWork(owner), 'A stalled save must refuse the switch after the time limit and stay pending.')
  stalled()
  await settlePendingSettingsWork(owner, { timeoutMs: 20 })
  assert(!hasPendingSettingsWork(owner), 'Nothing pending settles at once.')
  // A failed save surfaces at once even while another token is still open.
  const open = beginPendingSettingsWork(owner); const quickFail = beginPendingSettingsWork(owner)
  const fast = settlePendingSettingsWork(owner, { timeoutMs: 500 }).then(() => 'resolved', (error: Error) => error.message)
  quickFail(new Error('boom'))
  assert((await fast) === SETTINGS_SAVE_FAILED && hasPendingSettingsWork(owner), 'A failure must not wait for the other saves or the time limit.')
  open()
}

// Browser drafts: one storage key per write, named for the draft and its revision, written per account and farm on every edit,
// cleared only after a confirmed save, invisible to other accounts, keyed in the offline-queue shape so the farm switcher's scan and
// the revocation scope discovery find them.
{
  const store = new Map<string, string>(); const sequenceKey = 'farm-rx-draft-sequence:v1'; const storedCount = () => [...store.keys()].filter((key) => key !== sequenceKey).length
  const fakeStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) }, removeItem: (key: string) => { store.delete(key) }, key: (index: number) => [...store.keys()][index] ?? null, get length() { return store.size }, clear: () => store.clear() }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fakeStorage })
  const scopeA = { projectRef: 'proj', userId: uid(1), farmId: farm }; const scopeB = { ...scopeA, userId: uid(2) }
  assert(readSettingsDrafts(scopeA).length === 0, 'No drafts before any edit.')
  writeSettingsDraft(scopeA, 'carry-settings', { draft: 'S1' }, stamp); const gridRevision = writeSettingsDraft(scopeA, 'carry-grid:x', { draft: 'G' }, stamp); const settingsRevision = writeSettingsDraft(scopeA, 'carry-settings', { draft: 'S2' }, '2026-09-13T12:00:01.000Z')
  assert(gridRevision !== null && settingsRevision !== null, 'Writes return their revision.')
  const key = settingsDraftKey(scopeA, 'carry-settings', settingsRevision!)
  assert(storedCount() === 2 && store.has(key) && store.has(settingsDraftKey(scopeA, 'carry-grid:x', gridRevision!)), 'Each draft lives under its own storage key, and a newer write of the same draft replaces this scope\'s older write.')
  assert(key.includes('proj') && key.includes(uid(1)) && key.includes(farm) && !key.endsWith(':lease') && !key.includes('sale-limit:') && key.split(':').length === 5, 'The key names the project, account, and farm; the draft key and the revision are encoded so they add no colon.')
  assert(JSON.stringify(queueFarmRevocationScope(settingsDraftKey(scopeA, 'sale-limit:a|2026|corn||', 'r1'))) === JSON.stringify(scopeA), 'The key has the offline-queue shape, so the revocation scope discovery resolves it to the account and farm.')
  assert(settingsDraftKeyOf(settingsDraftKey(scopeA, 'sale-limit:a|2026|corn||', 'r1'), scopeA) === 'sale-limit:a|2026|corn||' && settingsDraftKeyOf(key, scopeB) === null && settingsDraftKeyOf('farm-rx-grain-write-queue:v1:proj:x:y', scopeA) === null && settingsDraftKeyOf(`farm-rx-settings-draft-carry-settings:v1:proj:${uid(1)}:${farm}`, scopeA) === null, 'A storage key resolves back to its draft key for its own scope only; a key without a revision segment is not a draft.')
  const stored = JSON.parse(store.get(key)!) as { entries: unknown[] }
  assert(Array.isArray(stored.entries) && stored.entries.length === 1, 'The stored value carries a non-empty entries array.')
  assert(readSettingsDrafts(scopeA, 'carry-').length === 2 && (readSettingsDrafts(scopeA, 'carry-settings')[0].payload as { draft: string }).draft === 'S2', 'Drafts read back by prefix with the latest payload.')
  assert(readSettingsDrafts(scopeB).length === 0, 'Another account on the same farm sees no drafts.')
  // Two tabs on the same account and farm: a save that covered an older write must not clear a newer draft under the same key. The
  // newer tab's write lives under its own revision key, so the older tab's clear is one removal of its own key and can never race it.
  const older = writeSettingsDraft(scopeA, 'sale-limit:p', { value: 1 }, stamp)
  const olderKey = settingsDraftKey(scopeA, 'sale-limit:p', older!)
  store.set(settingsDraftKey(scopeA, 'sale-limit:p', 'tab-b'), JSON.stringify({ version: 1, entries: [{ key: 'sale-limit:p', payload: { value: 2 }, savedAt: '2026-09-13T12:00:05.000Z', revision: 'tab-b' }] }))
  assert(older !== null && store.has(olderKey), 'The older write has its own key.')
  clearSettingsDraft(scopeA, 'sale-limit:p', older!)
  assert(!store.has(olderKey) && (readSettingsDrafts(scopeA, 'sale-limit:p')[0]?.payload as { value: number })?.value === 2, 'Clearing with an older revision removes only that write and leaves the other tab\'s newer draft.')
  const superseded = writeSettingsDraft(scopeA, 'sale-limit:p', { value: 3 }, '2026-09-13T12:00:09.000Z')
  assert(readSettingsDrafts(scopeA, 'sale-limit:p').length === 1 && (readSettingsDrafts(scopeA, 'sale-limit:p')[0]?.payload as { value: number })?.value === 3 && !store.has(settingsDraftKey(scopeA, 'sale-limit:p', 'tab-b')), 'A newer write supersedes the other tab\'s older one, which is removed; the newest is read back.')
  clearSettingsDraft(scopeA, 'sale-limit:p', superseded!)
  assert(readSettingsDrafts(scopeA, 'sale-limit:p').length === 0, 'Clearing with the current revision removes the draft.')
  clearSettingsDraft(scopeA, 'carry-settings')
  assert(readSettingsDrafts(scopeA).length === 1 && readSettingsDrafts(scopeA)[0].key === 'carry-grid:x', 'Clearing one draft leaves the others.')
  clearSettingsDraft(scopeA, 'carry-grid:x')
  assert(storedCount() === 0, 'Clearing the last draft leaves no key, so the farm no longer looks pending.')
  assert(!store.has(`farm-rx-settings-draft-${sequenceKey}`) && /^\d+$/.test(store.get(sequenceKey) ?? '') && settingsDraftKeyOf(sequenceKey, scopeA) === null, 'The shared sequence lives under its own key, which is not a draft and names no farm.')
  // Two tabs writing the same draft in the same millisecond: the order of the writes decides, through the sequence number every tab
  // shares in storage, never the random tail of a revision. A sequence number compares as a number (10 after 9), and two writes that
  // tie on both time and sequence (two tabs drew the same number at once) are both kept until a later write supersedes them.
  const first = writeSettingsDraft(scopeA, 'sale-limit:t', { value: 1 }, stamp); const second = writeSettingsDraft(scopeA, 'sale-limit:t', { value: 2 }, stamp)
  assert(first !== null && second !== null && (readSettingsDrafts(scopeA, 'sale-limit:t')[0]?.payload as { value: number })?.value === 2 && !store.has(settingsDraftKey(scopeA, 'sale-limit:t', first)), 'Of two same-millisecond writes the later one is read back and the earlier one is removed.')
  store.set(sequenceKey, '9')
  store.set(settingsDraftKey(scopeA, 'sale-limit:t', `${stamp}#9#zzzzzzzz`), JSON.stringify({ version: 1, entries: [{ key: 'sale-limit:t', payload: { value: 9 }, savedAt: stamp, revision: `${stamp}#9#zzzzzzzz` }] }))
  const tenth = writeSettingsDraft(scopeA, 'sale-limit:t', { value: 10 }, stamp)
  assert(tenth !== null && tenth.split('#')[1] === String(Math.max(10, Number(second.split('#')[1]) + 1)) && (readSettingsDrafts(scopeA, 'sale-limit:t')[0]?.payload as { value: number })?.value === 10 && !store.has(settingsDraftKey(scopeA, 'sale-limit:t', `${stamp}#9#zzzzzzzz`)), 'The sequence continues above the stored value and compares as a number: the tenth write supersedes the ninth in the same millisecond.')
  clearSettingsDraft(scopeA, 'sale-limit:t')
  const tiedA = `${stamp}#77#aaaaaaaa`; const tiedB = `${stamp}#77#bbbbbbbb`
  for (const [revision, value] of [[tiedA, 'A'], [tiedB, 'B']] as const) store.set(settingsDraftKey(scopeA, 'sale-limit:t', revision), JSON.stringify({ version: 1, entries: [{ key: 'sale-limit:t', payload: { value }, savedAt: stamp, revision }] }))
  const reported: Array<{ kept: string; tied: string[] }> = []
  const tiedRead = readSettingsDrafts(scopeA, 'sale-limit:t', undefined, (kept, tied) => reported.push({ kept: kept.revision, tied: tied.map((entry) => entry.revision) }))
  assert(tiedRead.length === 1 && tiedRead[0]?.revision === tiedB && store.has(settingsDraftKey(scopeA, 'sale-limit:t', tiedA)) && store.has(settingsDraftKey(scopeA, 'sale-limit:t', tiedB)), 'Two writes tied on time and sequence are both kept; one of them is read back, the same one every time.')
  assert(JSON.stringify(reported) === JSON.stringify([{ kept: tiedB, tied: [tiedA] }]), 'The tied write that is not read back is reported to the caller, which must put it where the farmer can review it.')
  assert(readSettingsDrafts(scopeA, 'sale-limit:t').length === 1 && store.has(settingsDraftKey(scopeA, 'sale-limit:t', tiedA)), 'Without a handler the tied write stays in storage and is reported again on the next read.')
  clearSettingsDraft(scopeA, 'sale-limit:t', tiedB)
  assert((readSettingsDrafts(scopeA, 'sale-limit:t')[0]?.payload as { value: string })?.value === 'A', 'After the read-back tied write is cleared by its save, the other tab\'s tied write is still there to be read.')
  store.set(settingsDraftKey(scopeA, 'sale-limit:t', tiedB), JSON.stringify({ version: 1, entries: [{ key: 'sale-limit:t', payload: { value: 'B' }, savedAt: stamp, revision: tiedB }] }))
  const later = writeSettingsDraft(scopeA, 'sale-limit:t', { value: 'C' }, '2026-09-13T12:00:00.001Z')
  assert(later !== null && readSettingsDrafts(scopeA, 'sale-limit:t').length === 1 && storedCount() === 1, 'A later write supersedes both tied writes, which are removed.')
  clearSettingsDraft(scopeA, 'sale-limit:t')
  assert(storedCount() === 0, 'No draft is left.')
  // A browser that refuses the write reports it, so the screen saves at once instead of believing the edit is kept.
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { ...fakeStorage, setItem: () => { throw new Error('QuotaExceededError') } } })
  assert(writeSettingsDraft(scopeA, 'carry-settings', { draft: 'S3' }, stamp) === null, 'A refused write must return null.')
  Reflect.deleteProperty(globalThis, 'localStorage')
}

// Every repository saves and returns the row as the database stores it, so a screen's "last sent" row equals the row a replay
// produces: bushels at two decimals, rates and prices at four, ties away from zero, and a value too large for its column refused.
{
  const stamp = '2026-09-13T12:00:00.000Z'
  const limit: GrainSaleLimit = { id: '00000000-0000-4000-8000-000000000201', farm_id: 'farm-a', crop_year: 2026, commodity_id: 'corn', operating_entity_id: null, enterprise_label: null, sale_limit_bushels: 1234.565, created_at: stamp, updated_at: stamp }
  assert(normalizeGrainSaleLimit(limit).sale_limit_bushels === 1234.57, 'A sale limit is rounded to two decimals, ties away from zero.')
  assert(normalizeGrainSaleLimit({ ...limit, sale_limit_bushels: null }).sale_limit_bushels === null, 'A cleared sale limit stays null.')
  let refused = false
  try { normalizeGrainSaleLimit({ ...limit, sale_limit_bushels: 1e15 }) } catch { refused = true }
  assert(refused, 'A sale limit too large for its column is refused before it can be queued.')
  const settings: GrainCarrySettings = { farm_id: 'farm-a', mode: 'monthly', monthly_rate_cents_per_bu_month: 4.12345, flat_rate_per_bu: 0.18, interest_rate_pct: 7.00005, trucking_per_bu: 0.123456, updated_at: stamp }
  const normalizedSettings = normalizeGrainCarrySettings(settings)
  assert(normalizedSettings.monthly_rate_cents_per_bu_month === 4.1235 && normalizedSettings.interest_rate_pct === 7.0001 && normalizedSettings.trucking_per_bu === 0.1235 && normalizedSettings.flat_rate_per_bu === 0.18, 'Carry rates are rounded to four decimals.')
  const grid: GrainCarryGrid = { id: '00000000-0000-4000-8000-000000000202', farm_id: 'farm-a', production_estimate_id: '00000000-0000-4000-8000-000000000012', harvest_month: 8, default_basis: -0.30005, rows: emptyCarryRows().map((row, index) => index === 0 ? { market_price: 4.23456, basis: -0.30004 } : row), updated_at: stamp }
  const normalizedGrid = normalizeGrainCarryGrid(grid)
  assert(normalizedGrid.default_basis === -0.3001 && normalizedGrid.rows[0]?.market_price === 4.2346 && normalizedGrid.rows[0]?.basis === -0.3 && normalizedGrid.rows[1]?.market_price === null, 'Grid prices and bases are rounded to four decimals; blanks stay blank.')
  assert(JSON.stringify(normalizeGrainCarryGrid(normalizedGrid)) === JSON.stringify(normalizedGrid), 'Normalizing an already normalized grid changes nothing.')
}

// Badge provenance kept in the browser while the column is missing: one key per line (two tabs never overwrite each other), the
// older single-map key still read and pruned, a refused write reported once instead of silently lost.
{
  const store = new Map<string, string>()
  const fakeStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) }, removeItem: (key: string) => { store.delete(key) }, key: (index: number) => [...store.keys()][index] ?? null, get length() { return store.size } }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fakeStorage })
  const badgeScope = { projectRef: 'proj', userId: 'user-a', farmId: 'farm-a' }
  store.set('farm-rx.profitability.university-defaults', JSON.stringify({ [uid(50)]: 100, [uid(51)]: 110 }))
  assert(rememberLegacyDefault(badgeScope, uid(52), 120) && rememberLegacyDefault(badgeScope, uid(53), 130) && rememberLegacyDefault({ ...badgeScope, farmId: 'farm-b' }, uid(56), 160), 'A seeded amount is kept under its own key for its account and farm.')
  const read = readLegacyDefaults(badgeScope)
  assert(read[uid(50)] === 100 && read[uid(51)] === 110 && read[uid(52)] === 120 && read[uid(53)] === 130 && read[uid(56)] === undefined, 'Older single-map entries and this scope\'s per-line entries are read together; another farm\'s entry is not.')
  assert(universityDefaultKey(badgeScope, uid(52)) === `farm-rx-university-default-${uid(52)}:v1:proj:user-a:farm-a` && universityDefaultLineOf(universityDefaultKey(badgeScope, uid(52)), badgeScope) === uid(52) && universityDefaultLineOf(universityDefaultKey({ ...badgeScope, farmId: 'farm-b' }, uid(56)), badgeScope) === null, 'The key names the project, account, and farm in the offline-queue shape, so the revocation scope discovery and the quarantine find it.')
  assert(queueFarmRevocationScope(universityDefaultKey(badgeScope, uid(52)))?.farmId === 'farm-a', 'The revocation scope discovery reads the farm from the key.')
  assert(JSON.parse(store.get(universityDefaultKey(badgeScope, uid(52))) ?? 'null')?.entries === undefined, 'The value carries no entries, so the farm switcher\'s unsaved-work scan does not count it.')
  forgetLegacyDefaults(badgeScope, [uid(50), uid(52)])
  const after = readLegacyDefaults(badgeScope)
  assert(after[uid(50)] === undefined && after[uid(52)] === undefined && after[uid(51)] === 110 && after[uid(53)] === 130, 'Forgetting removes the per-line key and prunes the older map.')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { ...fakeStorage, setItem: () => { throw new Error('QuotaExceededError') } } })
  assert(rememberLegacyDefault(badgeScope, uid(54), 140) === false, 'A refused write returns false.')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fakeStorage })
  // A seeded budget keeps every badge before its shell is created, all or nothing.
  retainSeededDefaults(badgeScope, [{ id: uid(57), university_default_amount: 10 }, { id: uid(58), university_default_amount: null }, { id: uid(59), university_default_amount: 30 }])
  const seeded = readLegacyDefaults(badgeScope)
  assert(seeded[uid(57)] === 10 && seeded[uid(59)] === 30 && seeded[uid(58)] === undefined, 'Every seeded amount is kept and a line without one is skipped.')
  forgetLegacyDefaults(badgeScope, [uid(57), uid(59)])
  let writes = 0
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { ...fakeStorage, setItem: (key: string, value: string) => { writes += 1; if (writes === 2) throw new Error('QuotaExceededError'); store.set(key, value) } } })
  let seedRefused = ''
  try { retainSeededDefaults(badgeScope, [{ id: uid(57), university_default_amount: 10 }, { id: uid(59), university_default_amount: 30 }]) } catch (error) { seedRefused = (error as Error).message }
  assert(seedRefused === BADGE_PROVENANCE_NOT_KEPT && readLegacyDefaults(badgeScope)[uid(57)] === undefined && readLegacyDefaults(badgeScope)[uid(59)] === undefined, 'A refusal part-way removes what was written and throws, so no budget row is created.')
  Reflect.deleteProperty(globalThis, 'localStorage')
  assert(Object.keys(readLegacyDefaults(badgeScope)).length === 0 && rememberLegacyDefault(badgeScope, uid(55), 150) === false, 'Without browser storage nothing is read and a write reports as refused.')
}

// A kept draft whose payload is not the shape the screen writes is dropped and its key removed, instead of reaching the screen.
{
  const store = new Map<string, string>()
  const fakeStorage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) }, removeItem: (key: string) => { store.delete(key) }, key: (index: number) => [...store.keys()][index] ?? null, get length() { return store.size } }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: fakeStorage })
  const scope = { projectRef: 'proj', userId: 'user-a', farmId: 'farm-a' }
  writeSettingsDraft(scope, 'carry-settings', { draft: { mode: 'flat' }, base: null }, '2026-09-13T12:00:00.000Z')
  writeSettingsDraft(scope, 'carry-grid:e1', { estimateId: 'e1', draft: { harvestMonth: 8, defaultBasis: '0', rows: [] }, base: null }, '2026-09-13T12:00:00.000Z')
  const isGood = (key: string, payload: unknown) => key === 'carry-grid:e1' && !!payload
  assert(readSettingsDrafts(scope, 'carry-').length === 2, 'Without a guard every entry is returned.')
  const kept = readSettingsDrafts(scope, 'carry-', isGood)
  assert(kept.length === 1 && kept[0]?.key === 'carry-grid:e1', 'With a guard, an entry the screen cannot use is skipped.')
  assert([...store.keys()].some((k) => settingsDraftKeyOf(k, scope) === 'carry-grid:e1') && ![...store.keys()].some((k) => settingsDraftKeyOf(k, scope) === 'carry-settings'), 'The unusable entry is removed from storage; the usable one stays.')
  Reflect.deleteProperty(globalThis, 'localStorage')
}

// The calculator accepts a kept draft only in the shape it writes, including the lineage row a save returned.
{
  const settingsDraft = { draft: { mode: 'flat', monthlyRateCentsPerBuMonth: 4, flatRatePerBu: 0.2, interestRatePct: 6.5, truckingPerBu: 0.1 }, base: 'T1', sent: null }
  const sentSettings = { farm_id: 'farm-a', mode: 'flat', monthly_rate_cents_per_bu_month: 4, flat_rate_per_bu: 0.2, interest_rate_pct: 6.5, trucking_per_bu: 0.1, updated_at: 'T1' }
  const rows = Array.from({ length: CARRY_GRID_ROWS }, () => ({ marketPrice: '', basis: '0' }))
  const sentGrid = { id: uid(60), farm_id: 'farm-a', production_estimate_id: uid(12), harvest_month: 8, default_basis: 0, rows: Array.from({ length: CARRY_GRID_ROWS }, () => ({ market_price: null, basis: 0 })), updated_at: 'T1' }
  const gridDraft = { estimateId: uid(12), draft: { harvestMonth: 8, defaultBasis: '0', rows }, base: 'T1', sent: sentGrid }
  assert(isCarryDraft('carry-settings', settingsDraft) && isCarryDraft('carry-settings', { ...settingsDraft, sent: sentSettings }), 'A settings draft with no lineage or a complete settings row is accepted.')
  assert(!isCarryDraft('carry-settings', { ...settingsDraft, sent: {} }) && !isCarryDraft('carry-settings', { ...settingsDraft, draft: { mode: 'flat' } }) && !isCarryDraft('carry-settings', { ...settingsDraft, sent: sentGrid }), 'A settings draft with an incomplete rate set, an empty lineage, or a grid as lineage is dropped.')
  assert(isCarryDraft(`carry-grid:${uid(12)}`, gridDraft) && isCarryDraft(`carry-grid:${uid(12)}`, { ...gridDraft, sent: undefined }), 'A grid draft with a complete grid row as lineage, or none, is accepted.')
  assert(!isCarryDraft(`carry-grid:${uid(12)}`, { ...gridDraft, sent: {} }) && !isCarryDraft(`carry-grid:${uid(12)}`, { ...gridDraft, sent: { ...sentGrid, rows: [] } }) && !isCarryDraft(`carry-grid:${uid(12)}`, { ...gridDraft, draft: { ...gridDraft.draft, rows: rows.slice(1) } }) && !isCarryDraft(`carry-grid:${uid(13)}`, gridDraft), 'A grid draft with an empty or short lineage, twelve rows, or another estimate\'s key is dropped.')
}

console.log('Grain settings regressions passed.')
