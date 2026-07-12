import { QueuedHarvestRepository } from './QueuedHarvestRepository'
import type { HarvestDataGateway } from './HarvestDataGateway'
import { HarvestWriteQueue, harvestWriteQueueKey } from './harvestWriteQueue'
import { harvestRevenue, yieldDelta, yieldPerAcre, type HarvestDraft } from './harvest'
import { SupabaseHarvestRepository } from './SupabaseHarvestRepository'
import { roundDecimalHalfUp } from './decimal'
import type { FieldsData, FieldsRepository } from './fields'
import type { StorageLike } from './writeQueue'
import { getSyncStatus } from './syncStatus'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const farm = uid(1); const otherFarm = uid(2); const actor = uid(3); const cropId = uid(4); const stamp = '2026-07-12T12:30:00.123456+00:00'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => Promise<unknown>, message: string) { let failed = false; try { await action() } catch { failed = true }; assert(failed, message) }
function memory(): StorageLike & { values: Map<string, string> } { const values = new Map<string, string>(); return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) } }
function draft(): HarvestDraft { return { crop_assignment_id: cropId, harvested_bushels: 1280.125, harvest_date: '2026-07-11', actual_price_per_bu: 4.567891 } }
function fields(farmId = farm): FieldsData { return { farm: { id: farmId, name: 'Farm', share_with_rep: false, created_by: actor, created_at: stamp, updated_at: stamp }, entities: [], fields: [], crop_assignments: [], arrangements: [], commodities: [] } }
const fieldsRepository = (farmId = farm): FieldsRepository => ({ getData: async () => fields(farmId), saveField: async () => { throw new Error('not used') } })
function canonical(entry: HarvestDraft, farmId = farm, idValue = entry.crop_assignment_id) { return { id: idValue, farm_id: farmId, field_id: uid(5), crop_year: 2026, commodity_id: uid(6), planting_sequence: 1, planted_acres: 10, variety: null, planting_date: '2026-04-20', harvest_date: entry.harvest_date, harvested_bushels: roundDecimalHalfUp(entry.harvested_bushels, 2), expected_yield_per_acre: 190, expected_price_per_bu: 4.25, actual_price_per_bu: roundDecimalHalfUp(entry.actual_price_per_bu, 6), notes: null, created_at: stamp, updated_at: stamp } }
class FakeGateway implements HarvestDataGateway {
  role: unknown = { role: 'worker' }; saves: Array<{ operationId: string; entry: HarvestDraft }> = []; entries = new Map<string, Record<string, unknown>>(); receipts = new Map<string, unknown>(); mutate: (value: unknown) => unknown = (value) => value; failure: Error | null = null
  async loadViewerRole() { return structuredClone(this.role) }
  async saveHarvest(input: { farmId: string; operationId: string; entry: HarvestDraft }) {
    assert(Object.keys(input.entry).length === 4 && ['crop_assignment_id', 'harvested_bushels', 'harvest_date', 'actual_price_per_bu'].every((key) => Object.hasOwn(input.entry, key)), 'The gateway must send exactly the four RPC keys.')
    this.saves.push({ operationId: input.operationId, entry: structuredClone(input.entry) })
    if (this.failure) throw this.failure
    if (this.receipts.has(input.operationId)) return structuredClone(this.mutate(this.receipts.get(input.operationId)))
    const previous = this.entries.get(input.entry.crop_assignment_id) ?? canonical(input.entry, input.farmId)
    const result = { ...previous, harvested_bushels: roundDecimalHalfUp(input.entry.harvested_bushels, 2), harvest_date: input.entry.harvest_date, actual_price_per_bu: roundDecimalHalfUp(input.entry.actual_price_per_bu, 6) }
    this.entries.set(input.entry.crop_assignment_id, result); this.receipts.set(input.operationId, result)
    return structuredClone(this.mutate(result))
  }
}
function live(gateway: FakeGateway, farmId = farm, roleFields = farm) { let next = 100; return new SupabaseHarvestRepository({ gateway, fieldsRepository: fieldsRepository(roleFields), getFarmId: async () => farmId, getUserId: async () => actor, createId: () => uid(next++) }) }

async function run() {
  // Group 1: exact four-key harvest write uses SQL decimal scales and preserves projected values.
  const gateway = new FakeGateway(); const repository = live(gateway); const saved = await repository.saveHarvest(draft()); const stored = gateway.entries.get(cropId)!; assert(saved.harvested_bushels === 1280.13 && saved.actual_price_per_bu === 4.567891 && gateway.saves.length === 1, 'A harvest save must return SQL-canonical harvest values.'); assert(gateway.saves[0].entry.harvested_bushels === 1280.13 && gateway.saves[0].entry.actual_price_per_bu === 4.567891, 'Outgoing writes must use the same SQL decimal scales as the canonical echo.'); assert(stored.expected_yield_per_acre === 190 && stored.expected_price_per_bu === 4.25, 'Harvest writes must never overwrite expected values.')
  await rejects(() => repository.saveHarvest({ crop_assignment_id: cropId, harvested_bushels: 1, harvest_date: null } as unknown as HarvestDraft), 'A draft missing an RPC key must fail before send.'); await rejects(() => repository.saveHarvest({ ...draft(), unexpected: true } as unknown as HarvestDraft), 'A draft with an extra RPC key must fail before send.'); assert(gateway.saves.length === 1, 'Invalid four-key shapes must not reach the gateway.')

  // Group 2: SQL half-up boundaries are accepted, while genuine canonical mismatches are rejected.
  const rounded = await live(new FakeGateway()).saveHarvest({ ...draft(), harvested_bushels: 1.005, actual_price_per_bu: 4.5678915 }); assert(rounded.harvested_bushels === 1.01 && rounded.actual_price_per_bu === 4.567892, 'SQL-rounded 2- and 6-decimal canonical echoes must be accepted.')
  const wrong = new FakeGateway(); wrong.mutate = (value) => ({ ...(value as object), id: uid(99) }); await rejects(() => live(wrong).saveHarvest(draft()), 'A different echoed crop-assignment ID must be rejected.')
  const foreign = new FakeGateway(); foreign.mutate = (value) => ({ ...(value as object), farm_id: otherFarm }); await rejects(() => live(foreign).saveHarvest(draft()), 'A harvest echo from another farm must be rejected.')
  const altered = new FakeGateway(); altered.mutate = (value) => ({ ...(value as object), actual_price_per_bu: 4.6 }); await rejects(() => live(altered).saveHarvest(draft()), 'An altered canonical harvest value must be rejected.')

  // Group 3: receipt replay uses the same operation ID, while a changed echoed ID remains unsafe.
  const replayGateway = new FakeGateway(); const replayLive = live(replayGateway); const operation = uid(30); await replayLive.saveHarvestOperation(draft(), operation); await replayLive.saveHarvestOperation(draft(), operation); assert(replayGateway.saves.every((call) => call.operationId === operation), 'Idempotent replay must reuse one operation receipt ID.')
  const store = memory(); let offline = true; let next = 40; const queued = new QueuedHarvestRepository(replayLive, { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: 'test', storage: store, createId: () => uid(next++), clock: () => stamp, isOffline: () => offline }); const pending = await queued.saveHarvest(draft()); const queue = new HarvestWriteQueue(store, harvestWriteQueueKey('test', actor, farm)); const entry = queue.read().entries[0]; assert(pending.pending && entry.operationId !== operation, 'Offline harvest saves must remain visibly pending with their own receipt ID.'); offline = false; await queued.inspectAndReplay(); queue.append(entry); await queued.inspectAndReplay(); assert(replayGateway.saves.filter((call) => call.operationId === entry.operationId).length === 2, 'Repeated queued replay must keep the original receipt ID.')
  offline = true; await queued.saveHarvest({ ...draft(), crop_assignment_id: uid(41) }); replayGateway.mutate = (value) => ({ ...(value as object), id: uid(42) }); offline = false; await queued.inspectAndReplay(); assert(queue.read().entries.length === 1, 'A different echoed ID must leave the queued harvest entry blocked.'); replayGateway.mutate = (value) => value

  // Group 4: clear-to-null sends and accepts all nullable harvest fields.
  const cleared = await live(new FakeGateway()).saveHarvest({ crop_assignment_id: cropId, harvested_bushels: null, harvest_date: null, actual_price_per_bu: null }); assert(cleared.harvested_bushels === null && cleared.harvest_date === null && cleared.actual_price_per_bu === null, 'Harvest values must be clearable to null.')

  // Group 5: roles and data-farm mismatches fail closed before a write.
  const readOnly = new FakeGateway(); readOnly.role = { role: 'read_only' }; await rejects(() => live(readOnly).saveHarvest(draft()), 'Read-only members must fail closed.'); assert(readOnly.saves.length === 0, 'Read-only access must not reach the write RPC.'); const unknownRole = new FakeGateway(); unknownRole.role = { role: 'administrator' }; await rejects(() => live(unknownRole).saveHarvest(draft()), 'Unknown viewer roles must fail closed.'); assert(unknownRole.saves.length === 0, 'Unknown roles must not reach the write RPC.'); const mismatchedData = new FakeGateway(); await rejects(() => live(mismatchedData, farm, otherFarm).getData(), 'Fields data from a foreign farm must fail closed.')

  // Group 6: queue bytes reject malformed JSON, malformed envelopes, and broadened RPC contracts.
  const malformed = (entry: object) => new HarvestWriteQueue({ ...store, getItem: () => JSON.stringify({ version: 1, entries: [entry] }) }, 'bad').read(); const valid = { version: 1, module: 'harvest', kind: 'saveHarvest', operationId: uid(50), userId: actor, farmId: farm, enqueuedAt: stamp, draft: draft() }; await rejects(async () => { malformed({ ...valid, draft: { ...draft(), extra: true } }) }, 'Queued entries with an extra RPC key must fail closed.'); await rejects(async () => { malformed({ ...valid, draft: { crop_assignment_id: cropId, harvested_bushels: 1, harvest_date: null } }) }, 'Queued entries missing an RPC key must fail closed.')
  await rejects(async () => { new HarvestWriteQueue({ ...store, getItem: () => '{bad json' }, 'bad').read() }, 'Malformed queue JSON must fail closed.'); await rejects(async () => { new HarvestWriteQueue({ ...store, getItem: () => JSON.stringify({ version: 1, entries: [], unexpected: true }) }, 'bad').read() }, 'Queue envelopes with extra top-level keys must fail closed.')

  // Group 7: transport and dependency failures stay pending; definite failures are blocked.
  const queueGateway = new FakeGateway(); const queueStore = memory(); let queueOffline = true; const queueRepository = new QueuedHarvestRepository(live(queueGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: 'queue-errors', storage: queueStore, createId: (() => { let id = 60; return () => uid(id++) })(), clock: () => stamp, isOffline: () => queueOffline }); await queueRepository.saveHarvest(draft()); queueOffline = false; queueGateway.failure = new TypeError('fetch failed'); await queueRepository.inspectAndReplay(); assert(getSyncStatus().kind === 'pending', 'Transport failures must leave queued harvests pending.'); queueGateway.failure = new Error('crop assignment does not belong to this farm'); await queueRepository.inspectAndReplay(); assert(getSyncStatus().kind === 'pending', 'A harvest waiting for its replayed crop assignment must remain retryable.'); queueGateway.failure = new Error('validation failed'); await queueRepository.inspectAndReplay(); assert(getSyncStatus().kind === 'blocked', 'Definite harvest failures must block the queue.')

  // Group 8: pure yield, plan delta, and revenue math covers over, under, invalid acres, none, and price fallback.
  assert(yieldPerAcre(1200, 10) === 120 && yieldPerAcre(null, 10) === null && yieldPerAcre(1200, 0) === null && yieldPerAcre(1200, Number.POSITIVE_INFINITY) === null, 'Yield per acre must never divide by zero or produce a non-finite value.'); assert(yieldDelta(120, 112) === 8 && yieldDelta(100, 112) === -12 && yieldDelta(100, null) === null, 'Yield delta must distinguish over, under, and no expected yield.'); const actualRevenue = harvestRevenue(1000, 5, 4); const expectedRevenue = harvestRevenue(1000, null, 4); assert(actualRevenue?.value === 5000 && actualRevenue?.priceSource === 'actual' && expectedRevenue?.value === 4000 && expectedRevenue?.priceSource === 'expected' && harvestRevenue(1000, null, null) === null, 'Revenue must use actual price first, then expected price, and remain blank without either.')
  console.log('SupabaseHarvestRepository regression passed (8 coverage groups)')
}
void run()
