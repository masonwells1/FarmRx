/**
 * Round 7 (P2/P3 sweep) regressions. Each group fails if its audit fix is reverted:
 *  1. P2-11 — farm-local calendar dates (never UTC "tomorrow" for an evening entry)
 *  2. P3-02/P2-06 — sync aggregate surfaces every blocked module + honest Programs pending count
 *  3. P2-08 — harvest dates cannot be far-future
 *  4. P2-15 — explicit progress-only vs record-creation confirmation wording
 *  5. P2-09 — durable scouting photo cleanup outbox
 *  6. P2-10 — offline deletes return honest pending receipts
 *  7. P2-07 — field wall-clock hour display, browser-timezone independent
 *  8. P2-04 — shared finite/scale decimal contracts for profitability numbers
 *  9. P2-14 — inventory/equipment-sourced cost lines load; hand edits are refused
 * 10. P2-05 — dropped/misnamed columns fail loudly instead of collapsing to null
 * 11. P2-12 — 18px text / 48px tap-target CSS contract
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { farmLocalCalendarDate } from './farmDates'
import { localCalendarDay } from './marketingAlerts'
import { getSyncStatus, setModuleSyncStatus } from './syncStatus'
import { HARVEST_FUTURE_DATE_MESSAGE, harvestMaximumDate, validateHarvestDraft } from './harvest'
import { defaultProgramApplyRecordChoice, programApplyConfirmation } from './programs'
import { drainScoutingCleanupOutbox, readScoutingCleanupOutbox, recordScoutingCleanup, scoutingCleanupOutboxKey } from './scoutingCleanupOutbox'
import { QueuedFieldLogRepository } from './QueuedFieldLogRepository'
import { FIELD_LOG_OFFLINE_DELETE_MESSAGE } from './fieldLog'
import type { SupabaseFieldLogRepository } from './SupabaseFieldLogRepository'
import { FieldLogWriteQueue, fieldLogWriteQueueKey } from './fieldLogWriteQueue'
import { QueuedProgramsRepository } from './QueuedProgramsRepository'
import type { SupabaseProgramsRepository } from './SupabaseProgramsRepository'
import { ProgramsWriteQueue, programsWriteQueueKey, type ProgramsQueueEntryV1 } from './programsWriteQueue'
import { fieldWallClockDate, formatHour, hourAfter } from './weatherService'
import { boundedDecimal, nullableBoundedDecimal } from './decimal'
import { manualCostLineWrite, normalizeBudgetDecimals, SupabaseProfitabilityRepository } from './SupabaseProfitabilityRepository'
import { SOURCED_COST_LINE_EDIT_MESSAGE, type BudgetCostLine, type CropBudget } from './profitability'
import type { BudgetCostLineWrite, ProfitabilityDataGateway } from './ProfitabilityDataGateway'
import { fieldsSeedForRegression } from './MockFieldsRepository'
import type { FieldsRepository } from './fields'
import { mapCropAssignment, mapField } from './SupabaseFieldsRepository'
import type { StorageLike } from './writeQueue'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => Promise<unknown>, message: string): Promise<string> { try { await action() } catch (error) { return error instanceof Error ? error.message : String(error) } throw new Error(message) }
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const stamp = '2026-07-14T00:00:00.000Z'
function memory(): StorageLike { const values = new Map<string, string>(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) }, removeItem: (key) => { values.delete(key) } } }

// ---- 1. P2-11: farm-local calendar dates ----
assert(farmLocalCalendarDate(new Date(2026, 6, 13, 23, 30)) === '2026-07-13', 'A 11:30 PM entry must record the local day, not the UTC day.')
assert(farmLocalCalendarDate(new Date(2026, 0, 5, 0, 5)) === '2026-01-05', 'Local-date parts must be zero-padded.')
assert(localCalendarDay(new Date(2026, 6, 13, 23, 30)) === farmLocalCalendarDate(new Date(2026, 6, 13, 23, 30)), 'The alert-day helper must delegate to the one canonical local-date helper.')

// ---- 2. P3-02 + P2-06: sync aggregate honesty ----
setModuleSyncStatus('grain', { kind: 'blocked', pending: 1, message: 'Grain saves need attention.' })
setModuleSyncStatus('inventory', { kind: 'blocked', pending: 2, message: 'Inventory saves need attention.' })
{
  const status = getSyncStatus()
  assert(status.kind === 'blocked' && status.message.includes('Grain saves need attention.') && status.message.includes('Inventory saves need attention.'), 'The aggregate must surface EVERY blocked module message, not just the first.')
}
setModuleSyncStatus('grain', { kind: 'synced', pending: 0 })
setModuleSyncStatus('inventory', { kind: 'synced', pending: 0 })

{
  // P2-06: a blocked Programs queue must report its real waiting count (was hard-coded 0/1).
  const storage = memory(); const userId = uid(50); const farmId = uid(51)
  const queueKey = programsWriteQueueKey('sweep', userId, farmId)
  const queue = new ProgramsWriteQueue(storage, queueKey)
  for (let index = 0; index < 3; index += 1) queue.append({ version: 1, module: 'programs', kind: 'delete_program', operationId: uid(60 + index), userId, farmId, enqueuedAt: stamp, programId: uid(70 + index) } as ProgramsQueueEntryV1)
  // A transport failure with three queued saves and no cached workspace lands in markBlocked.
  const transportDown = { getData: async () => { throw new TypeError('fetch failed') }, deleteProgramOperation: async () => { throw new TypeError('fetch failed') } } as unknown as SupabaseProgramsRepository
  const repo = new QueuedProgramsRepository(transportDown, { getContext: async () => ({ userId, farmId }), projectRef: 'sweep', storage, createId: () => uid(99), clock: () => stamp, isOffline: () => false })
  await rejects(() => repo.getData(), 'A transport-failed Programs load with queued saves must reject.')
  const status = getSyncStatus()
  assert(status.kind === 'blocked' && status.pending === 3, `A blocked Programs queue with 3 saves must report pending=3 (got ${status.kind}/${status.pending}).`)
  setModuleSyncStatus('programs', { kind: 'synced', pending: 0 })
}

// ---- 3. P2-08: harvest dates cannot be far-future ----
{
  const now = new Date(2026, 6, 14, 12, 0)
  assert(harvestMaximumDate(new Date(2026, 6, 14)) === '2026-07-15', 'Harvest max date must be local today + 1 day of clock tolerance.')
  const draft = { crop_assignment_id: uid(1), harvested_bushels: 100, harvest_date: '2026-09-01', actual_price_per_bu: null }
  assert(validateHarvestDraft(draft, now) === HARVEST_FUTURE_DATE_MESSAGE, 'A far-future harvest date must be rejected with the shared message.')
  assert(validateHarvestDraft({ ...draft, harvest_date: '2026-07-15' }, now) === null, 'Tomorrow (clock tolerance) must stay valid.')
  assert(validateHarvestDraft({ ...draft, harvest_date: '2026-07-01' }, now) === null, 'A past harvest date must stay valid.')
}

// ---- 4. P2-15: explicit apply confirmation ----
assert(defaultProgramApplyRecordChoice('spray') === 'create', 'A spray pass must default to a new draft application record so it is visible in Inventory.')
assert(defaultProgramApplyRecordChoice('fertility') === 'none', 'A fertility pass must retain progress-only as its default application-record choice.')
assert(defaultProgramApplyRecordChoice('other') === 'none', 'An other pass must retain progress-only as its default application-record choice.')
assert(programApplyConfirmation('none').includes('does NOT create a spray/application record') && programApplyConfirmation('none').includes('inventory on hand'), 'Progress-only confirmation must say no record and no on-hand change.')
assert(programApplyConfirmation('create').includes('creates a new draft application record') && programApplyConfirmation('create').includes('not matched'), 'Create-record confirmation must say a draft record is created and products are unmatched.')
assert(programApplyConfirmation('link').includes('links it to the application record') && programApplyConfirmation('link').includes('does not change'), 'Link confirmation must name the linked record and the unchanged inventory.')

// ---- 5. P2-09: durable photo cleanup outbox ----
{
  const storage = memory(); const userId = uid(1); const farmId = uid(2); const key = scoutingCleanupOutboxKey('sweep', userId)
  assert(recordScoutingCleanup(storage, key, userId, farmId, ['farm/f/n/a.jpg', 'farm/f/n/a.jpg', 'farm/f/n/b.jpg'], stamp), 'Recording cleanup paths must succeed and read back.')
  assert(readScoutingCleanupOutbox(storage, key).map((entry) => entry.path).join(',') === 'farm/f/n/a.jpg,farm/f/n/b.jpg', 'The outbox must dedupe paths durably.')
  let failRemoval = true; const removed: string[][] = []
  const remover = async (paths: string[]) => { if (failRemoval) throw new Error('storage timeout'); removed.push(paths); return paths }
  await drainScoutingCleanupOutbox(storage, key, userId, farmId, remover)
  assert(readScoutingCleanupOutbox(storage, key).length === 2, 'A failed drain must keep every entry for the next retry.')
  failRemoval = false
  await drainScoutingCleanupOutbox(storage, key, userId, uid(3), remover)
  const drainedByOtherFarm = removed.length
  assert(drainedByOtherFarm === 0 && readScoutingCleanupOutbox(storage, key).length === 2, 'Another farm signed in must not drain (or discard) this farm entries.')
  await drainScoutingCleanupOutbox(storage, key, userId, farmId, remover)
  assert(removed.length === 1 && removed[0].length === 2 && readScoutingCleanupOutbox(storage, key).length === 0, 'A successful drain must remove exactly the confirmed paths.')
  assert(recordScoutingCleanup(storage, key, userId, farmId, ['farm/f/n/c.jpg', 'farm/f/n/d.jpg'], stamp), 'Re-recording after a drain must succeed.')
  await drainScoutingCleanupOutbox(storage, key, userId, farmId, async (paths: string[]) => paths.filter((path: string) => path.endsWith('c.jpg')))
  assert(readScoutingCleanupOutbox(storage, key).map((entry) => entry.path).join(',') === 'farm/f/n/d.jpg', 'A resolved removal that omits a path must keep that path parked (RLS-silent omission).')
  await drainScoutingCleanupOutbox(storage, key, userId, farmId, async (paths: string[]) => paths)
  storage.setItem(key, '{corrupt')
  assert(readScoutingCleanupOutbox(storage, key).length === 0, 'Corrupt outbox bytes must be discarded safely.')
}

// ---- 6. P2-10: offline deletes return honest pending receipts ----
{
  const storage = memory(); const userId = uid(10); const farmId = uid(11)
  const live = { async deleteEntry() { throw new Error('offline test must not reach the live repository') } } as unknown as SupabaseFieldLogRepository
  const repo = new QueuedFieldLogRepository(live, { getContext: async () => ({ userId, farmId }), projectRef: 'sweep', storage, createId: () => crypto.randomUUID(), clock: () => stamp, isOffline: () => true })
  const receipt = await repo.deleteEntry(uid(12))
  const queue = new FieldLogWriteQueue(storage, fieldLogWriteQueueKey('sweep', userId, farmId))
  assert(receipt.deleted && receipt.pending === true && receipt.id === uid(12), 'An offline field-log delete must return a pending tombstone receipt, never a failure.')
  assert(queue.read().entries[0]?.kind === 'deleteEntry', 'The offline delete must be queued for replay.')
  assert(FIELD_LOG_OFFLINE_DELETE_MESSAGE.includes('Deleted on this device'), 'The shared offline-delete message must state the delete succeeded locally.')
  setModuleSyncStatus('fieldLog', { kind: 'synced', pending: 0 })
}

// ---- 7. P2-07: field wall-clock display ----
assert(fieldWallClockDate('2026-07-13T14:00').getUTCHours() === 14 && fieldWallClockDate('2026-07-13T14:00').getUTCDate() === 13, 'A naive field-local time must be pinned, not parsed in the browser zone.')
assert(formatHour('2026-07-13T14:00') === new Intl.DateTimeFormat(undefined, { hour: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 6, 13, 14))), 'formatHour must render the field wall clock regardless of the process time zone.')
assert(hourAfter('2026-07-13T23:00') === '2026-07-14T00:00', 'The window-end hour must be computed in field wall-clock notation across midnight.')
assert(hourAfter('2026-07-13T09:00') === '2026-07-13T10:00', 'The window-end hour must add exactly one wall-clock hour.')

// ---- 8. P2-04: finite/scale decimal contracts ----
assert(boundedDecimal(1.23455, { precision: 14, scale: 4, label: 'the cost per acre' }) === 1.2346, 'boundedDecimal must round half away from zero to the column scale.')
assert(nullableBoundedDecimal(null, { precision: 14, scale: 4, label: 'x' }) === null, 'Null passes through the nullable contract.')
{
  let message = ''
  try { boundedDecimal(Number.POSITIVE_INFINITY, { precision: 14, scale: 4, label: 'the cost per acre' }) } catch (error) { message = (error as Error).message }
  assert(message === 'Enter a real number for the cost per acre.', 'Non-finite input must fail with the plain-English message.')
  try { boundedDecimal(10_000_000_000, { precision: 14, scale: 4, label: 'the cost per acre' }) } catch (error) { message = (error as Error).message }
  assert(message.includes('too large to save'), 'Values beyond the column precision must fail closed before the database.')
  const budget: CropBudget = { id: uid(20), farm_id: uid(21), crop_year: 2026, commodity_id: 'corn', operating_entity_id: null, enterprise_label: null, name: 'B', expected_yield_per_acre: 180.123456, expected_price_per_bushel: 4.1234567, rp_coverage_pct: null, rp_aph_yield: null, rp_projected_price: null, rp_premium_per_acre: null, copied_from_budget_id: null, created_at: stamp, updated_at: stamp }
  const normalized = normalizeBudgetDecimals(budget)
  assert(normalized.expected_yield_per_acre === 180.1235 && normalized.expected_price_per_bushel === 4.123457, 'Budget numbers must round to the numeric(12,4)/(12,6) contracts before any write.')
}

// ---- 9. P2-14: sourced cost lines load; hand edits refuse ----
{
  const fields = fieldsSeedForRegression(); const farm = fields.farm.id; const commodity = fields.commodities[0].id
  const budgetRow = { id: uid(30), farm_id: farm, crop_year: 2026, commodity_id: commodity, operating_entity_id: null, enterprise_label: null, name: 'Sweep budget', expected_yield_per_acre: '200', expected_price_per_bushel: '4.5', rp_coverage_pct: null, rp_aph_yield: null, rp_projected_price: null, rp_premium_per_acre: null, copied_from_budget_id: null, created_at: stamp, updated_at: stamp }
  const inventoryRow = { id: uid(31), budget_id: uid(30), category: 'chemical', label: 'From shelf', amount_per_acre: '12.5', source_kind: 'inventory', source_record_id: uid(32), sort_order: 0, created_at: stamp, updated_at: stamp }
  const manualRow = { id: uid(33), budget_id: uid(30), category: 'seed', label: 'Seed', amount_per_acre: '100', source_kind: 'manual', source_record_id: null, sort_order: 1, created_at: stamp, updated_at: stamp }
  const upserts: BudgetCostLineWrite[] = []
  const unimplemented = () => { throw new Error('not used in this regression') }
  const gateway: ProfitabilityDataGateway = {
    loadWorkspace: async () => ({ budgets: [budgetRow], cost_lines: [inventoryRow, manualRow], matrix_steps: [], allocations: [] }),
    upsertCostLine: async (_farm, row) => { upserts.push(structuredClone(row)); return { id: row.id, budget_id: row.budget_id, category: row.category, label: row.name, amount_per_acre: row.amount_per_acre, source_kind: 'manual', source_record_id: null, sort_order: row.sort_order, created_at: stamp, updated_at: stamp } },
    upsertBudget: unimplemented, patchBudgetInsurance: unimplemented, deleteCostLine: unimplemented, upsertAllocation: unimplemented, deleteAllocation: unimplemented, replaceMatrixSteps: unimplemented, createBudgetWithMatrix: unimplemented, copyBudget: unimplemented,
  }
  const fieldsRepository: FieldsRepository = { getData: async () => structuredClone(fields), saveField: async () => { throw new Error('not used') } }
  const repo = new SupabaseProfitabilityRepository({ gateway, fieldsRepository, getFarmId: async () => farm, getOperationContext: async () => ({ projectRef: 'test', userId: uid(1), farmId: farm, generation: 1, token: uid(999), serverEpoch: 1 }), verifyOperationContext: async () => undefined, createId: () => crypto.randomUUID(), clock: () => stamp })
  const workspace = await repo.getWorkspace()
  const inventoryLine = workspace.cost_lines.find((line) => line.id === uid(31))
  assert(inventoryLine?.source_kind === 'inventory' && workspace.cost_lines.length === 2, 'A DB-valid inventory-sourced cost line must LOAD instead of blocking the whole module.')
  const editMessage = await rejects(() => repo.saveCostLine({ ...(inventoryLine as BudgetCostLine), amount_per_acre: 99 }), 'Editing an inventory-sourced line by hand must be refused.')
  const upsertsAfterRefusal = upserts.length
  assert(editMessage === SOURCED_COST_LINE_EDIT_MESSAGE && upsertsAfterRefusal === 0, 'The sourced-line edit refusal must use the shared message and never reach the gateway.')
  const manualLine = workspace.cost_lines.find((line) => line.id === uid(33)) as BudgetCostLine
  await repo.saveCostLine({ ...manualLine, amount_per_acre: 12.34567 })
  const upsertsAfterManualEdit = upserts.length
  assert(upsertsAfterManualEdit === 1 && upserts[0].amount_per_acre === 12.3457 && !Object.hasOwn(upserts[0], 'source_kind'), 'A manual line edit must round to the column scale and send exactly the manual write columns.')
  const infinityMessage = await rejects(() => repo.saveCostLine({ ...manualLine, amount_per_acre: Number.POSITIVE_INFINITY }), 'A non-finite cost must be refused.')
  assert(infinityMessage.includes('Enter a real number'), 'A non-finite cost must fail with the plain-English decimal message.')
  assert(manualCostLineWrite({ ...(inventoryLine as BudgetCostLine), sort_order: 5 } as BudgetCostLineWrite).source_kind === undefined, 'The write shape must strip source columns so queue validators and the gateway stay manual-only.')
}

// ---- 10. P2-05: dropped/misnamed columns fail loudly ----
{
  const fieldRow = { id: uid(40), farm_id: uid(41), operating_entity_id: uid(42), name: 'North', legal_description: null, county: null, state: null, total_acres: 160, fsa_farm_number: null, fsa_tract_number: null, soil_productivity_index: null, latitude: null, longitude: null, location_source: null, is_active: true, created_at: stamp, updated_at: stamp }
  assert(mapField(fieldRow).name === 'North', 'A complete field row must map.')
  const droppedField = { ...fieldRow } as Record<string, unknown>; delete droppedField.legal_description
  let message = ''
  try { mapField(droppedField) } catch (error) { message = (error as Error).message }
  assert(message.includes('missing'), 'A dropped nullable field column must fail loudly, not collapse to null.')
  const cropRow = { id: uid(43), farm_id: uid(41), field_id: uid(40), crop_year: 2026, commodity_id: 'corn', planting_sequence: 1, planted_acres: 160, variety: null, planting_date: null, harvest_date: null, harvested_bushels: null, expected_yield_per_acre: null, expected_price_per_bu: null, actual_price_per_bu: null, notes: null, created_at: stamp, updated_at: stamp }
  assert(mapCropAssignment(cropRow).actual_price_per_bu === null, 'A complete crop assignment row must map.')
  const droppedCrop = { ...cropRow } as Record<string, unknown>; delete droppedCrop.actual_price_per_bu
  message = ''
  try { mapCropAssignment(droppedCrop) } catch (error) { message = (error as Error).message }
  assert(message.includes('missing'), 'The previously-collapsing actual_price_per_bu column must now fail loudly when dropped.')
}

// ---- 11. P2-12: 18px / 48px CSS contract ----
{
  const css = readFileSync(fileURLToPath(new URL('../styles/app.css', import.meta.url)), 'utf8')
  for (const line of css.split('\n')) {
    if (line.includes('svg-viewbox-scale-exempt')) continue
    for (const match of line.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) {
      assert(Number(match[1]) >= 18, `Farmer-facing text below the 18px contract: "${line.trim().slice(0, 80)}"`)
    }
  }
  const targets = ['.math-toggle', '.task-actions button', '.task-card .chip-row button', '.contract-entry summary', '.matrix-controls input', '.task-check input']
  for (const selector of targets) {
    const index = css.indexOf(selector)
    assert(index >= 0, `Missing expected selector ${selector} in app.css.`)
    const block = css.slice(index, css.indexOf('}', index) + 1)
    const minHeight = /min-height:\s*(\d+)px/.exec(block)
    assert(minHeight !== null && Number(minHeight[1]) >= 48, `${selector} must keep a >=48px tap target (audit P2-12).`)
  }
  assert(css.includes('.program-archived input { width: 48px; height: 48px; }'), 'The archived-programs checkbox must keep its 48px tap target.')
  // The mobile notification button previously collapsed to min-height: 0.
  assert(css.includes('.notification-open { min-height: 48px; }'), 'The mobile notification button must not collapse below the 48px tap target.')
}

console.log('Round 7 sweep regressions passed (11 audit-fix groups).')
