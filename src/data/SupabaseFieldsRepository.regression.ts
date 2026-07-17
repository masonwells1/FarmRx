import type { Arrangement, CropAssignment, Field, FieldDraft, FieldsData, FieldsRepository } from './fields'
import type { FieldsDataGateway, FieldsRowBundle, SaveFieldBundleInput, SavedFieldBundle } from './FieldsDataGateway'
import { fieldsSeedForRegression } from './MockFieldsRepository'
import { MockGrainRepository, writeGrainEnvelope } from './MockGrainRepository'
import { QueuedFieldsRepository } from './QueuedFieldsRepository'
import { normalizeFieldDraft, SupabaseFieldsRepository } from './SupabaseFieldsRepository'
import { getSyncStatus } from './syncStatus'
import { FieldsWriteQueue, parseFieldsQueue, writeQueueKey, type FieldsQueueEntryV1 } from './writeQueue'
import { moduleBackends } from './backends'
import { supabaseConfig } from '../lib/supabaseConfig'
import { queueTransaction } from './queueTransaction'
import { captureFarmRevocationFence, resetFarmGrantFromLive } from './farmRevocationFence'
import { getWorkspaceCacheNotices } from './workspaceCache'
import { observeDeviceTime } from './deviceClockFence'

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
async function rejects(action: () => Promise<unknown>, message: string) { let failed = false; try { await action() } catch { failed = true }; assert(failed, message) }
class FakeStorage {
  values = new Map<string, string>(); throwOnSet = false; writes = 0
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { if (this.throwOnSet) throw new Error('storage full'); this.values.set(key, value); this.writes += 1 }
  removeItem(key: string) { this.values.delete(key); this.writes += 1 }
}

function draft(data: FieldsData, patch: Partial<FieldDraft> = {}): FieldDraft {
  const field = data.fields[0]; const arrangement = data.arrangements.find((row) => row.field_id === field.id && row.effective_to === null)!; const assignments = data.crop_assignments.filter((row) => row.field_id === field.id && row.crop_year === new Date().getFullYear())
  return { id: field.id, name: field.name, operating_entity_id: field.operating_entity_id, total_acres: field.total_acres, county: field.county, state: field.state, legal_description: field.legal_description, fsa_farm_number: field.fsa_farm_number, fsa_tract_number: field.fsa_tract_number, soil_productivity_index: field.soil_productivity_index, arrangement: { arrangement_type: arrangement.arrangement_type, landlord_name: arrangement.landlord_name, landlord_phone: arrangement.landlord_phone, landlord_contact_notes: arrangement.landlord_contact_notes, effective_from: arrangement.effective_from, cash_rent_per_acre: arrangement.cash_rent_per_acre, flex_bonus_formula: arrangement.flex_bonus_formula, landlord_crop_pct: arrangement.landlord_crop_pct, landlord_seed_pct: arrangement.landlord_seed_pct, landlord_fertilizer_pct: arrangement.landlord_fertilizer_pct, landlord_chemical_pct: arrangement.landlord_chemical_pct, landlord_fuel_pct: arrangement.landlord_fuel_pct, landlord_labor_custom_pct: arrangement.landlord_labor_custom_pct, landlord_crop_insurance_pct: arrangement.landlord_crop_insurance_pct, landlord_equipment_pct: arrangement.landlord_equipment_pct, landlord_interest_pct: arrangement.landlord_interest_pct, landlord_other_input_pct: arrangement.landlord_other_input_pct, notes: arrangement.notes }, crop_assignments: assignments.map((row) => ({ id: row.id, crop_year: row.crop_year, commodity_id: row.commodity_id, planted_acres: row.planted_acres, planting_sequence: row.planting_sequence, variety: row.variety, planting_date: row.planting_date, harvest_date: row.harvest_date, harvested_bushels: row.harvested_bushels, expected_yield_per_acre: row.expected_yield_per_acre, expected_price_per_bu: row.expected_price_per_bu, notes: row.notes })), ...patch }
}

class FakeFieldsDataGateway implements FieldsDataGateway {
  readonly data = fieldsSeedForRegression(); inputs: SaveFieldBundleInput[] = []; failLoad: boolean | Error = false; failSave: Error | null = null; persistNextSave = false; receipts = new Map<string, SavedFieldBundle>(); loadCalls = 0; beforeLoad: (() => Promise<void>) | null = null; mutateSave: ((reply: SavedFieldBundle) => SavedFieldBundle) | null = null
  async loadWorkspace(_farmId: string): Promise<FieldsRowBundle> { this.loadCalls += 1; await this.beforeLoad?.(); if (this.failLoad instanceof Error) throw this.failLoad; if (this.failLoad) throw new Error('partial query failed'); return structuredClone(this.data) }
  async saveFieldBundle(input: SaveFieldBundleInput): Promise<SavedFieldBundle> {
    if (this.failSave) throw this.failSave
    if (input.draft.id === this.data.fields[0].id && input.draft.crop_assignments.some((row) => row.id && !this.data.crop_assignments.some((saved) => saved.id === row.id))) throw new Error('A crop record changed before it could be saved.')
    this.inputs.push(structuredClone(input))
    const receipt = this.receipts.get(input.operationId); if (receipt) return structuredClone(receipt)
    const previous = this.data.fields.find((row) => row.id === input.draft.id) ?? this.data.fields[0]
    const field: Field = { ...previous, id: input.draft.id!, farm_id: input.farmId, name: input.draft.name, operating_entity_id: input.draft.operating_entity_id, total_acres: input.draft.total_acres, county: input.draft.county, state: input.draft.state, legal_description: input.draft.legal_description, fsa_farm_number: input.draft.fsa_farm_number, fsa_tract_number: input.draft.fsa_tract_number, soil_productivity_index: input.draft.soil_productivity_index }
    const arrangement: Arrangement = { ...this.data.arrangements[0], ...input.draft.arrangement, id: (input.draft.arrangement as { id?: string }).id ?? this.data.arrangements[0].id, farm_id: input.farmId, field_id: field.id, effective_to: null }
    const cropAssignments: CropAssignment[] = input.draft.crop_assignments.map((row, index) => ({ ...this.data.crop_assignments[index], ...row, id: row.id!, farm_id: input.farmId, field_id: field.id, expected_yield_per_acre: row.expected_yield_per_acre ?? null, expected_price_per_bu: row.expected_price_per_bu ?? null }))
    const result = { field, arrangement, cropAssignments }
    if (this.persistNextSave) {
      this.data.fields = this.data.fields.map((row) => row.id === field.id ? field : row)
      this.data.arrangements = this.data.arrangements.map((row) => row.field_id === field.id && row.effective_to === null ? arrangement : row)
      this.data.crop_assignments = [...this.data.crop_assignments.filter((row) => row.field_id !== field.id), ...cropAssignments]
    }
    this.receipts.set(input.operationId, structuredClone(result)); return this.mutateSave ? this.mutateSave(structuredClone(result)) : result
  }
}

function ids() { let value = 9000; return () => `00000000-0000-4000-8000-${String(value++).padStart(12, '0')}` }
function repository(gateway: FakeFieldsDataGateway) { const operationContext = { projectRef: 'test', userId: '00000000-0000-4000-8000-0000000000aa', farmId: gateway.data.farm.id, generation: 1, token: '00000000-0000-4000-8000-000000000900', serverEpoch: 1 }; return new SupabaseFieldsRepository({ gateway, getFarmId: async () => gateway.data.farm.id, getOperationContext: async () => operationContext, verifyOperationContext: async () => undefined, createId: ids(), clock: () => '2026-07-11T00:00:00.000Z' }) }

function existingReadonlyDatabase(databaseName: string, values: Map<string, unknown>) {
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB'); const calls = { open: 0, upgrade: 0 }
  const database = { objectStoreNames: { contains: (name: string) => name === 'workspaces' }, transaction: () => ({ objectStore: () => ({ get: (key: string) => { const request: { result?: unknown; onsuccess?: () => void; onerror?: () => void } = {}; queueMicrotask(() => { request.result = values.get(key); request.onsuccess?.() }); return request } }) }), close: () => undefined }
  const factory = { databases: async () => [{ name: databaseName }], open: (name: string) => { calls.open += 1; const request: { result?: typeof database; onsuccess?: () => void; onerror?: () => void; onblocked?: () => void; onupgradeneeded?: () => void } = {}; queueMicrotask(() => { if (name !== databaseName) { request.onerror?.(); return }; request.result = database; request.onsuccess?.() }); return request } }
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: factory })
  return { calls, restore: () => { if (prior) Object.defineProperty(globalThis, 'indexedDB', prior); else Reflect.deleteProperty(globalThis, 'indexedDB') } }
}

async function run() {
  const gateway = new FakeFieldsDataGateway(); const live = repository(gateway); const data = await live.getData()
  // 1. all six result sets map numeric/null values, and an incomplete read rejects.
  assert(data.fields.length === gateway.data.fields.length && data.fields[0].total_acres === 422.5 && data.fields[0].legal_description !== undefined, 'getData did not map the workspace exactly.')
  gateway.failLoad = true; await rejects(() => live.getData(), 'Partial workspace reads must reject.'); gateway.failLoad = false
  const optionalLiveFlexGateway = new FakeFieldsDataGateway(); Object.assign(optionalLiveFlexGateway.data.arrangements[0], { arrangement_type: 'flex_cash_rent', cash_rent_per_acre: 200, landlord_crop_pct: null, flex_bonus_formula: { method: 'pct_of_revenue', base_rent_per_acre: null, rate_pct: 30, trigger_revenue_per_acre: null, base_price_per_bu: null, base_yield_per_acre: null } })
  const optionalLiveFlex = (await repository(optionalLiveFlexGateway).getData()).arrangements[0].flex_bonus_formula as unknown as Record<string, unknown>
  assert(optionalLiveFlex.min_rent_per_acre === null && optionalLiveFlex.max_rent_per_acre === null && optionalLiveFlex.price_source_note === null, 'Live structured flex ingress did not canonicalize omitted optional keys.')
  const unknownStructuredFlexGateway = new FakeFieldsDataGateway(); Object.assign(unknownStructuredFlexGateway.data.arrangements[0], { arrangement_type: 'flex_cash_rent', cash_rent_per_acre: 200, landlord_crop_pct: null, flex_bonus_formula: { method: 'pct_of_revenue', base_rent_per_acre: null, rate_pct: 30, trigger_revenue_per_acre: null, base_price_per_bu: null, base_yield_per_acre: null, surprise: true } })
  await rejects(() => repository(unknownStructuredFlexGateway).getData(), 'Live structured flex ingress accepted an unknown nested key.')
  const unknownLegacyFlexGateway = new FakeFieldsDataGateway(); Object.assign(unknownLegacyFlexGateway.data.arrangements[0], { arrangement_type: 'flex_cash_rent', cash_rent_per_acre: 200, landlord_crop_pct: null, flex_bonus_formula: { type: 'revenue', trigger: 700, bonus_rate: 20, surprise: true } })
  await rejects(() => repository(unknownLegacyFlexGateway).getData(), 'Live legacy flex ingress accepted an unknown nested key.')
  // 1b. Today-facing snapshots read live or retained in-memory data and queued overlays
  // without replay, locks, storage/cache writes, ID creation, or sync-state publication.
  const snapshotUser = '00000000-0000-4000-8000-0000000000aa'; const snapshotRef = 'snapshot-fields'; const snapshotFarm = data.farm.id
  const seedSnapshotFence = (target: FakeStorage) => resetFarmGrantFromLive(target, { projectRef: snapshotRef, userId: snapshotUser, farmId: snapshotFarm }, 1, '2026-07-15T00:00:00.000Z')
  const snapshotStorage = new FakeStorage(); seedSnapshotFence(snapshotStorage); const snapshotContext = captureFarmRevocationFence(snapshotStorage, { projectRef: snapshotRef, userId: snapshotUser, farmId: snapshotFarm })
  const snapshotGateway = new FakeFieldsDataGateway(); let snapshotIds = 0; let snapshotOffline = false
  let snapshotContextResolutions = 0; const snapshotRepository = new QueuedFieldsRepository(repository(snapshotGateway), { getContext: async () => { snapshotContextResolutions += 1; throw new Error('pure snapshot resolved mutable farm access') }, projectRef: snapshotRef, storage: snapshotStorage, createId: () => { snapshotIds += 1; return `00000000-0000-4000-8000-${String(9700 + snapshotIds).padStart(12, '0')}` }, clock: () => '2026-07-15T00:00:00.000Z', isOffline: () => snapshotOffline })
  const writesBeforeLiveSnapshot = snapshotStorage.writes; const idsBeforeLiveSnapshot = snapshotIds; const syncBeforeLiveSnapshot = getSyncStatus()
  const liveSnapshot = await snapshotRepository.getSnapshot(snapshotContext)
  assert(liveSnapshot.data.farm.id === snapshotFarm && liveSnapshot.source === 'live' && snapshotGateway.loadCalls === 1, 'The pure Fields snapshot did not read the selected live farm exactly once.')
  assert(snapshotContextResolutions === 0 && snapshotStorage.writes === writesBeforeLiveSnapshot && snapshotIds === idsBeforeLiveSnapshot && getSyncStatus() === syncBeforeLiveSnapshot, 'The pure Fields snapshot resolved access, wrote storage, created an ID, or changed sync status.')
  const pureStateRef = 'snapshot-fields-state'; const pureStateStorage = new FakeStorage(); resetFarmGrantFromLive(pureStateStorage, { projectRef: pureStateRef, userId: snapshotUser, farmId: snapshotFarm }, 1, '2026-07-15T00:00:00.000Z'); const pureStateContext = captureFarmRevocationFence(pureStateStorage, { projectRef: pureStateRef, userId: snapshotUser, farmId: snapshotFarm }); const pureStateGateway = new FakeFieldsDataGateway(); const pureStateWriter = repository(pureStateGateway); let pureStateId = 9900
  const pureStateRepository = new QueuedFieldsRepository(pureStateWriter, { getContext: async () => ({ userId: snapshotUser, farmId: snapshotFarm }), projectRef: pureStateRef, storage: pureStateStorage, createId: () => `00000000-0000-4000-8000-${String(pureStateId++).padStart(12, '0')}`, clock: () => '2026-07-15T00:00:00.000Z', isOffline: () => false })
  await pureStateRepository.getSnapshot(pureStateContext)
  await rejects(() => pureStateRepository.saveField({ ...draft(data), crop_assignments: [] }), 'A pure Fields snapshot changed later save eligibility.'); assert(pureStateGateway.inputs.length === 0, 'A pure Fields snapshot allowed a save to reach the writer without a normal canonical read.')

  const pendingIds = ids(); const pendingDraft = normalizeFieldDraft({ ...draft(data), name: 'Pending snapshot field', crop_assignments: [] }, pendingIds)
  const snapshotQueue = new FieldsWriteQueue(snapshotStorage, writeQueueKey(snapshotRef, snapshotUser, snapshotFarm))
  snapshotQueue.append({ version: 1, module: 'fields', kind: 'saveField', operationId: pendingIds(), userId: snapshotUser, farmId: snapshotFarm, enqueuedAt: '2026-07-15T00:05:00.000Z', draft: pendingDraft as FieldsQueueEntryV1['draft'] })
  const writesBeforeOverlay = snapshotStorage.writes; const idsBeforeOverlay = snapshotIds; const overlaidSnapshot = await snapshotRepository.getSnapshot(snapshotContext)
  assert(overlaidSnapshot.data.fields.filter((field) => field.id === pendingDraft.id && field.name === 'Pending snapshot field').length === 1, 'The Fields snapshot did not overlay the queued field exactly once.')
  assert(snapshotStorage.writes === writesBeforeOverlay && snapshotIds === idsBeforeOverlay, 'Overlaying queued Fields work wrote storage or created an ID.')

  const offlineStorage = new FakeStorage(); seedSnapshotFence(offlineStorage); const offlineContext = captureFarmRevocationFence(offlineStorage, { projectRef: snapshotRef, userId: snapshotUser, farmId: snapshotFarm }); const offlineGateway = new FakeFieldsDataGateway(); let offlineMode = false; let offlineSnapshotIds = 0; let offlineNow = '2026-07-15T00:00:00.000Z'
  const offlineRepository = new QueuedFieldsRepository(repository(offlineGateway), { getContext: async () => ({ userId: snapshotUser, farmId: snapshotFarm }), projectRef: snapshotRef, storage: offlineStorage, createId: () => { offlineSnapshotIds += 1; return `00000000-0000-4000-8000-${String(9800 + offlineSnapshotIds).padStart(12, '0')}` }, clock: () => offlineNow, isOffline: () => offlineMode })
  await offlineRepository.getData()
  const offlinePendingIds = ids(); const offlinePendingDraft = normalizeFieldDraft({ ...draft(data), name: 'Offline pending field', crop_assignments: [] }, offlinePendingIds)
  new FieldsWriteQueue(offlineStorage, writeQueueKey(snapshotRef, snapshotUser, snapshotFarm)).append({ version: 1, module: 'fields', kind: 'saveField', operationId: offlinePendingIds(), userId: snapshotUser, farmId: snapshotFarm, enqueuedAt: '2026-07-15T00:10:00.000Z', draft: offlinePendingDraft as FieldsQueueEntryV1['draft'] })
  offlineGateway.failLoad = new TypeError('Failed to fetch'); offlineMode = true
  const writesBeforeOfflineSnapshot = offlineStorage.writes; const idsBeforeOfflineSnapshot = offlineSnapshotIds; const syncBeforeOfflineSnapshot = getSyncStatus()
  const retainedSnapshot = await offlineRepository.getSnapshot(offlineContext)
  assert(retainedSnapshot.source === 'offline' && retainedSnapshot.data.fields.filter((field) => field.id === offlinePendingDraft.id && field.name === 'Offline pending field').length === 1, 'The offline Fields snapshot did not overlay retained queued work exactly once.')
  assert(offlineStorage.writes === writesBeforeOfflineSnapshot && offlineSnapshotIds === idsBeforeOfflineSnapshot && getSyncStatus() === syncBeforeOfflineSnapshot, 'The offline Fields snapshot wrote storage, created an ID, or changed sync status.')
  offlineNow = '2026-07-23T00:00:01.000Z'; await rejects(() => offlineRepository.getSnapshot(offlineContext), 'An expired retained Fields snapshot was shown as current offline data.')

  const rollbackStorage = new FakeStorage(); seedSnapshotFence(rollbackStorage); const rollbackContext = captureFarmRevocationFence(rollbackStorage, { projectRef: snapshotRef, userId: snapshotUser, farmId: snapshotFarm }); let rollbackOffline = false; let rollbackNow = '2026-07-15T00:00:00.000Z'
  const rollbackWriter = { getData: async () => { if (rollbackOffline) throw new TypeError('Failed to fetch'); return structuredClone(data) }, getSnapshot: async () => { if (rollbackOffline) throw new TypeError('Failed to fetch'); return { data: structuredClone(data), source: 'live' as const, capturedAt: '2026-07-15T00:00:00.000Z' } } }
  let rollbackId = 9950; const rollbackRepository = new QueuedFieldsRepository(rollbackWriter as never, { getContext: async () => ({ userId: snapshotUser, farmId: snapshotFarm }), projectRef: snapshotRef, storage: rollbackStorage, createId: () => `00000000-0000-4000-8000-${String(rollbackId++).padStart(12, '0')}`, clock: () => rollbackNow, isOffline: () => rollbackOffline })
  await rollbackRepository.getData(); rollbackOffline = true; rollbackNow = '2026-07-21T00:00:00.000Z'; assert((await rollbackRepository.getSnapshot(rollbackContext)).source === 'offline', 'A day-six retained Fields snapshot was not available offline.'); observeDeviceTime(rollbackStorage, { projectRef: snapshotRef, userId: snapshotUser }, rollbackNow); const rollbackWrites = rollbackStorage.writes; rollbackNow = '2026-07-15T00:00:00.000Z'; await rejects(() => rollbackRepository.getSnapshot(rollbackContext), 'Clock rollback extended a retained Fields snapshot.'); assert(rollbackStorage.writes === rollbackWrites, 'Clock rollback changed storage from the pure Fields snapshot path.')

  const missingFenceStorage = new FakeStorage(); const missingFenceRepository = new QueuedFieldsRepository(repository(new FakeFieldsDataGateway()), { getContext: async () => ({ userId: snapshotUser, farmId: snapshotFarm }), projectRef: snapshotRef, storage: missingFenceStorage, createId: () => { throw new Error('snapshot created an ID') }, clock: () => '2026-07-15T00:00:00.000Z', isOffline: () => false })
  await rejects(() => missingFenceRepository.getSnapshot({ projectRef: snapshotRef, userId: snapshotUser, farmId: snapshotFarm, generation: 1, token: '00000000-0000-4000-8000-000000000999', serverEpoch: 1 }), 'A pure Fields snapshot initialized a missing farm fence instead of failing closed.')
  assert(missingFenceStorage.writes === 0, 'A pure Fields snapshot wrote a missing fence or queue key.')

  const coldRef = 'snapshot-fields-cold'; const coldStorage = new FakeStorage(); resetFarmGrantFromLive(coldStorage, { projectRef: coldRef, userId: snapshotUser, farmId: snapshotFarm }, 1, '2026-07-15T00:00:00.000Z'); const coldContext = captureFarmRevocationFence(coldStorage, { projectRef: coldRef, userId: snapshotUser, farmId: snapshotFarm }); const coldKey = `${coldRef}:${snapshotUser}:${snapshotFarm}:fields`; const coldValues = new Map<string, unknown>([[coldKey, { version: 2, key: coldKey, projectRef: coldRef, userId: snapshotUser, farmId: snapshotFarm, module: 'fields', generation: coldContext.generation, fenceToken: coldContext.token, serverEpoch: coldContext.serverEpoch, cachedAt: '2026-07-15T00:00:00.000Z', data }]])
  const fakeIdb = existingReadonlyDatabase(`farm-rx-offline-v1-${coldRef}`, coldValues); const coldNotices = JSON.stringify(getWorkspaceCacheNotices()); const coldWrites = coldStorage.writes
  try {
    const coldWriter = { getSnapshot: async () => { throw new TypeError('Failed to fetch') } }
    const freshColdRepository = new QueuedFieldsRepository(coldWriter as never, { getContext: async () => { throw new Error('cold snapshot resolved context') }, projectRef: coldRef, storage: coldStorage, createId: () => { throw new Error('cold snapshot created an ID') }, clock: () => '2026-07-15T00:00:00.000Z', isOffline: () => true })
    const coldSnapshot = await freshColdRepository.getSnapshot(coldContext)
    assert(coldSnapshot.source === 'offline' && coldSnapshot.data.farm.id === snapshotFarm, 'A fresh Fields repository did not reopen the existing IndexedDB cache.')
    assert(coldStorage.writes === coldWrites && JSON.stringify(getWorkspaceCacheNotices()) === coldNotices && fakeIdb.calls.open === 1 && fakeIdb.calls.upgrade === 0, 'Cold Fields snapshot created/upgraded storage, published a notice, or wrote device state.')
    const corruptCases: Array<[string, (value: FieldsData) => void]> = [
      ['cross-farm row', (value) => { value.fields[0]!.farm_id = '00000000-0000-4000-8000-000000000099' }],
      ['malformed row', (value) => { (value.fields[0] as unknown as Record<string, unknown>).name = 42 }],
      ['duplicate ID', (value) => { value.fields.push(structuredClone(value.fields[0]!)) }],
      ['dangling entity', (value) => { value.fields[0]!.operating_entity_id = '00000000-0000-4000-8000-000000000099' }],
      ['dangling commodity', (value) => { value.crop_assignments[0]!.commodity_id = 'missing_commodity' }],
      ['dangling field', (value) => { value.arrangements[0]!.field_id = '00000000-0000-4000-8000-000000000099' }],
      ['owned arrangement with rent', (value) => { value.arrangements[0]!.cash_rent_per_acre = 250 }],
      ['two current arrangements', (value) => { value.arrangements.push({ ...structuredClone(value.arrangements[0]!), id: '00000000-0000-4000-8000-000000000098', effective_from: '2025-01-01' }) }],
      ['crop acres over field acres', (value) => { const crop = value.crop_assignments[0]!; crop.planted_acres = value.fields.find((field) => field.id === crop.field_id)!.total_acres + 1 }],
      ['excess field numeric scale', (value) => { value.fields[0]!.total_acres = 80.001 }],
      ['non-crop-share input percentage', (value) => { value.arrangements[0]!.landlord_seed_pct = 1 }],
      ['impossible audit timestamp', (value) => { value.fields[0]!.updated_at = '2026-02-30T00:00:00.000Z' }],
    ]
    for (const [label, mutate] of corruptCases) {
      const corrupt = structuredClone(data); mutate(corrupt); coldValues.set(coldKey, { version: 2, key: coldKey, projectRef: coldRef, userId: snapshotUser, farmId: snapshotFarm, module: 'fields', generation: coldContext.generation, fenceToken: coldContext.token, serverEpoch: coldContext.serverEpoch, cachedAt: '2026-07-15T00:00:00.000Z', data: corrupt })
      const freshCorruptRepository = new QueuedFieldsRepository(coldWriter as never, { getContext: async () => { throw new Error('corrupt snapshot resolved context') }, projectRef: coldRef, storage: coldStorage, createId: () => { throw new Error('corrupt snapshot created an ID') }, clock: () => '2026-07-15T00:00:00.000Z', isOffline: () => true })
      await rejects(() => freshCorruptRepository.getSnapshot(coldContext), `A Fields cache with a ${label} survived fresh-instance validation.`)
    }
  } finally { fakeIdb.restore() }

  const crossFarmGateway = new FakeFieldsDataGateway(); crossFarmGateway.data.fields[0].farm_id = '00000000-0000-4000-8000-000000000099'
  await rejects(() => repository(crossFarmGateway).getSnapshot({ projectRef: 'test', userId: snapshotUser, farmId: snapshotFarm, generation: 1, token: '00000000-0000-4000-8000-000000000900', serverEpoch: 1 }), 'A cross-farm Fields row entered a pure snapshot.')
  const duplicateGateway = new FakeFieldsDataGateway(); duplicateGateway.data.fields.push(structuredClone(duplicateGateway.data.fields[0]!)); await rejects(() => repository(duplicateGateway).getData(), 'Duplicate live Fields IDs were accepted.')
  const danglingGateway = new FakeFieldsDataGateway(); danglingGateway.data.fields[0]!.operating_entity_id = '00000000-0000-4000-8000-000000000099'; await rejects(() => repository(danglingGateway).getData(), 'A live Field with a dangling entity was accepted.')
  const ownedRentGateway = new FakeFieldsDataGateway(); ownedRentGateway.data.arrangements[0]!.cash_rent_per_acre = 250; await rejects(() => repository(ownedRentGateway).getData(), 'A live owned arrangement containing rent was accepted.')
  const cropAcresGateway = new FakeFieldsDataGateway(); { const crop = cropAcresGateway.data.crop_assignments[0]!; crop.planted_acres = cropAcresGateway.data.fields.find((field) => field.id === crop.field_id)!.total_acres + 1 }; await rejects(() => repository(cropAcresGateway).getData(), 'A live crop assignment exceeding its field acres was accepted.')
  const currentArrangementGateway = new FakeFieldsDataGateway(); currentArrangementGateway.data.arrangements.push({ ...structuredClone(currentArrangementGateway.data.arrangements[0]!), id: '00000000-0000-4000-8000-000000000098', effective_from: '2025-01-01' }); await rejects(() => repository(currentArrangementGateway).getData(), 'Two live current arrangements for one field were accepted.')

  const snapshotRaceStorage = new FakeStorage(); seedSnapshotFence(snapshotRaceStorage); const snapshotRaceFence = captureFarmRevocationFence(snapshotRaceStorage, { projectRef: snapshotRef, userId: snapshotUser, farmId: snapshotFarm }); const raceGateway = new FakeFieldsDataGateway(); let releaseSnapshot!: () => void; let snapshotReadStarted!: () => void
  const snapshotReadIsStarted = new Promise<void>((resolve) => { snapshotReadStarted = resolve })
  raceGateway.beforeLoad = () => { snapshotReadStarted(); return new Promise<void>((resolve) => { releaseSnapshot = resolve }) }
  const raceSnapshotRepository = new QueuedFieldsRepository(repository(raceGateway), { getContext: async () => { throw new Error('pure snapshot resolved mutable farm access') }, projectRef: snapshotRef, storage: snapshotRaceStorage, createId: () => { throw new Error('snapshot created an ID') }, clock: () => '2026-07-15T00:00:00.000Z', isOffline: () => false })
  const delayedSnapshot = raceSnapshotRepository.getSnapshot(snapshotRaceFence); await snapshotReadIsStarted; resetFarmGrantFromLive(snapshotRaceStorage, { projectRef: snapshotRef, userId: snapshotUser, farmId: snapshotFarm }, 2, '2026-07-15T00:01:00.000Z'); releaseSnapshot()
  await rejects(() => delayedSnapshot, 'A delayed Fields snapshot published after the selected farm changed.')
  // 2. a new save is farm-bound and returns only the canonical gateway field.
  const saved = await live.saveField({ ...draft(data), id: undefined, name: 'Canonical field', crop_assignments: [] }); assert(gateway.inputs.length === 1 && gateway.inputs[0].farmId === data.farm.id && saved.name === 'Canonical field', 'New saves must use one farm-bound bundle.')
  // 3. live rejections never become mock/seed successes.
  gateway.failSave = new Error('permission denied'); await rejects(() => live.saveField(draft(data)), 'Remote failures must propagate.'); gateway.failSave = null
  // 4. every additive support-migration value survives the adapter mapping.
  const rich = draft(data); rich.arrangement.landlord_phone = '618-555-0147'; rich.arrangement.landlord_contact_notes = 'Call after 6 PM.'; rich.arrangement.arrangement_type = 'crop_share'; rich.arrangement.landlord_crop_pct = 51.5; rich.arrangement.landlord_seed_pct = 41.25; rich.arrangement.landlord_fertilizer_pct = 32.5; rich.arrangement.landlord_chemical_pct = 28.75; rich.arrangement.landlord_fuel_pct = 15.1; rich.arrangement.landlord_labor_custom_pct = 12.5; rich.arrangement.landlord_crop_insurance_pct = 33.33; rich.arrangement.landlord_equipment_pct = 22.2; rich.arrangement.landlord_interest_pct = 47.75; rich.arrangement.landlord_other_input_pct = 9.9; rich.crop_assignments[0].harvested_bushels = 0; rich.crop_assignments[0].expected_yield_per_acre = 205; rich.crop_assignments[0].expected_price_per_bu = 0; gateway.persistNextSave = true; const richSaved = await live.saveField(rich); gateway.persistNextSave = false; const richPayload = gateway.inputs.at(-1)!.draft.arrangement; const reloadedShares = (await live.getData()).arrangements.find((row) => row.field_id === rich.id && row.effective_to === null)!; assert(richSaved.id === rich.id && richPayload.landlord_phone === '618-555-0147' && richPayload.landlord_crop_pct === 51.5 && richPayload.landlord_seed_pct === 41.25 && richPayload.landlord_fertilizer_pct === 32.5 && richPayload.landlord_chemical_pct === 28.75 && richPayload.landlord_fuel_pct === 15.1 && richPayload.landlord_labor_custom_pct === 12.5 && richPayload.landlord_crop_insurance_pct === 33.33 && richPayload.landlord_equipment_pct === 22.2 && richPayload.landlord_interest_pct === 47.75 && richPayload.landlord_other_input_pct === 9.9 && reloadedShares.landlord_crop_pct === 51.5 && reloadedShares.landlord_seed_pct === 41.25 && reloadedShares.landlord_fertilizer_pct === 32.5 && reloadedShares.landlord_chemical_pct === 28.75 && reloadedShares.landlord_fuel_pct === 15.1 && reloadedShares.landlord_labor_custom_pct === 12.5 && reloadedShares.landlord_crop_insurance_pct === 33.33 && reloadedShares.landlord_equipment_pct === 22.2 && reloadedShares.landlord_interest_pct === 47.75 && reloadedShares.landlord_other_input_pct === 9.9, 'Input-share values did not round trip through the Fields save and reload adapter path.')
  // 5. existing assignment IDs are sent unchanged; stale IDs and empty lists retain the stated contract.
  const preserved = draft(data); assert(preserved.crop_assignments[0].id === data.crop_assignments[0].id, 'Existing crop IDs were not preserved.'); const stale = draft(data); stale.crop_assignments[0].id = '00000000-0000-4000-8000-000000009999'; await rejects(() => live.saveField(stale), 'Stale crop IDs must reject.'); const empty = draft(data); empty.crop_assignments = []; await live.saveField(empty); assert(gateway.inputs.at(-1)!.draft.crop_assignments.length === 0, 'Empty crop arrays must mean no crop change.')
  // 6. arrangement dates/IDs are left explicit for the RPC to enforce atomically.
  const sameDate = draft(data); await live.saveField(sameDate); assert(gateway.inputs.at(-1)!.draft.arrangement.effective_from === sameDate.arrangement.effective_from, 'Same-date arrangement edits lost their date.')
  const later = draft(data); later.arrangement.effective_from = '2027-01-01'; await live.saveField(later); assert(gateway.inputs.at(-1)!.draft.arrangement.effective_from === '2027-01-01', 'Later arrangement dates were not sent.')
  // 7. a failing atomic gateway leaves its fake database untouched.
  const before = JSON.stringify(gateway.data); gateway.failSave = new Error('child failed'); await rejects(() => live.saveField(draft(data)), 'Atomic remote failure must reject.'); assert(JSON.stringify(gateway.data) === before, 'Remote failure changed fake database state.'); gateway.failSave = null
  // 8. Fields adapter never uses the old combined mock key.
  const storage = new FakeStorage(); storage.setItem('farm-rx-local-data', 'grain-token-bytes'); await live.saveField(draft(data)); assert(storage.getItem('farm-rx-local-data') === 'grain-token-bytes', 'Fields adapter touched Grain storage.')
  // 9. offline saves persist only the versioned queue and publish pending.
  const userA = '00000000-0000-4000-8000-0000000000aa'; const userB = '00000000-0000-4000-8000-0000000000bb'; const offlineWriter = repository(new FakeFieldsDataGateway()); const queued = new QueuedFieldsRepository(offlineWriter, { getContext: async () => ({ userId: userA, farmId: data.farm.id }), projectRef: supabaseConfig.projectRef, storage, createId: ids(), clock: () => '2026-07-11T00:00:00.000Z', isOffline: () => true }); const queuedField = await queued.saveField({ ...draft(data), crop_assignments: [] }); const queueKey = writeQueueKey(supabaseConfig.projectRef, userA, data.farm.id); assert(queuedField.id === data.fields[0].id && storage.getItem(queueKey) !== null && getSyncStatus().kind === 'pending', 'Offline save was not honestly queued.')
  // 9b. a structured flex formula (docs/flex-lease-research.md §3) queues offline too — the
  // write queue's own byte-validator must recognize the new schema, not just the legacy shape.
  const flexBaseline = draft(data)
  const flexDraft: FieldDraft = { ...flexBaseline, arrangement: { ...flexBaseline.arrangement, arrangement_type: 'flex_cash_rent', cash_rent_per_acre: 0, flex_bonus_formula: { method: 'pct_of_revenue', base_rent_per_acre: null, rate_pct: 30, trigger_revenue_per_acre: null, base_price_per_bu: null, base_yield_per_acre: null, min_rent_per_acre: 200, max_rent_per_acre: 400, price_source_note: 'Fall average, Elevator A' } }, crop_assignments: [] }
  await queued.saveField(flexDraft)
  const flexQueueEntry = new FieldsWriteQueue(storage, queueKey).read().entries.at(-1)
  assert((flexQueueEntry?.draft.arrangement.flex_bonus_formula as { method?: string } | null)?.method === 'pct_of_revenue', 'A structured flex formula was not accepted by the offline write queue.')
  const corruptFlexQueue = structuredClone(flexQueueEntry!); corruptFlexQueue.draft.arrangement.flex_bonus_formula = null
  let corruptFlexRejected = false; try { parseFieldsQueue(JSON.stringify({ version: 1, entries: [corruptFlexQueue] })) } catch { corruptFlexRejected = true }
  assert(corruptFlexRejected, 'A corrupted flex-cash-rent queue entry without its formula passed durable parsing.')
  // 9c. A real commodity slug must survive durable queue validation, retain the canonical
  // actual harvest price in the offline overlay, and reject malformed bytes before storage changes.
  const cropRef = 'fields-crop-queue'; const cropStorage = new FakeStorage(); resetFarmGrantFromLive(cropStorage, { projectRef: cropRef, userId: userA, farmId: data.farm.id }, 1, '2026-07-15T00:00:00.000Z'); const cropGateway = new FakeFieldsDataGateway(); cropGateway.data.crop_assignments[0]!.actual_price_per_bu = 4.25; let cropOffline = false
  const cropQueued = new QueuedFieldsRepository(repository(cropGateway), { getContext: async () => ({ userId: userA, farmId: data.farm.id }), projectRef: cropRef, storage: cropStorage, createId: ids(), clock: () => '2026-07-15T00:00:00.000Z', isOffline: () => cropOffline })
  await cropQueued.getData(); cropOffline = true; cropGateway.failLoad = new TypeError('Failed to fetch'); const cropDraft = draft(cropGateway.data); cropDraft.crop_assignments[0]!.expected_price_per_bu = 5.125; await cropQueued.saveField(cropDraft)
  const cropQueue = new FieldsWriteQueue(cropStorage, writeQueueKey(cropRef, userA, data.farm.id)); const cropEnvelope = cropQueue.read(); assert(cropEnvelope.entries.length === 1 && cropEnvelope.entries[0]!.draft.crop_assignments[0]!.commodity_id === 'corn_yellow', 'A valid commodity slug did not survive the Fields queue round trip.')
  const overlaidCrop = (await cropQueued.getData()).crop_assignments.find((row) => row.id === cropDraft.crop_assignments[0]!.id); assert(overlaidCrop?.expected_price_per_bu === 5.125 && overlaidCrop.actual_price_per_bu === 4.25, 'The queued crop overlay lost either the pending expected price or canonical actual harvest price.')
  const cropBytes = cropStorage.getItem(cropQueue.key); const invalidCommodity = structuredClone(cropEnvelope.entries[0]!); invalidCommodity.operationId = ids()(); invalidCommodity.draft.crop_assignments[0]!.commodity_id = '00000000-0000-4000-8000-000000000099'; await rejects(async () => { cropQueue.append(invalidCommodity) }, 'A UUID commodity ID was accepted by the Fields queue.'); assert(cropStorage.getItem(cropQueue.key) === cropBytes, 'Invalid Fields queue input changed durable bytes before validation.')
  // 9d. Online and offline entry points enforce the same DB-shape rules before a writer or queue.
  const validationGateway = new FakeFieldsDataGateway(); const validationLive = repository(validationGateway); const invalidQueueStorage = new FakeStorage(); const invalidQueueRef = 'fields-invalid-draft'; resetFarmGrantFromLive(invalidQueueStorage, { projectRef: invalidQueueRef, userId: userA, farmId: data.farm.id }, 1, '2026-07-15T00:00:00.000Z'); const invalidQueued = new QueuedFieldsRepository(repository(new FakeFieldsDataGateway()), { getContext: async () => ({ userId: userA, farmId: data.farm.id }), projectRef: invalidQueueRef, storage: invalidQueueStorage, createId: ids(), clock: () => '2026-07-15T00:00:00.000Z', isOffline: () => true })
  const flexBase = draft(data); flexBase.arrangement = { ...flexBase.arrangement, arrangement_type: 'flex_cash_rent', cash_rent_per_acre: 200, landlord_crop_pct: null, flex_bonus_formula: { method: 'pct_of_revenue', base_rent_per_acre: null, rate_pct: 30, trigger_revenue_per_acre: null, base_price_per_bu: null, base_yield_per_acre: null, min_rent_per_acre: 100, max_rent_per_acre: 400, price_source_note: null } }
  const optionalFlex = structuredClone(flexBase); const optionalFormula = optionalFlex.arrangement.flex_bonus_formula as unknown as Record<string, unknown>; delete optionalFormula.min_rent_per_acre; delete optionalFormula.max_rent_per_acre; delete optionalFormula.price_source_note
  await validationLive.saveField(optionalFlex); await invalidQueued.saveField(optionalFlex)
  const onlineOptional = validationGateway.inputs.at(-1)!.draft.arrangement.flex_bonus_formula as unknown as Record<string, unknown>; const offlineOptional = new FieldsWriteQueue(invalidQueueStorage, writeQueueKey(invalidQueueRef, userA, data.farm.id)).read().entries.at(-1)!.draft.arrangement.flex_bonus_formula as unknown as Record<string, unknown>
  for (const formula of [onlineOptional, offlineOptional]) assert(formula.min_rent_per_acre === null && formula.max_rent_per_acre === null && formula.price_source_note === null, 'Omitted optional flex settings were not canonicalized identically online and offline.')
  const durableInvalidQueueBytes = () => JSON.stringify([...invalidQueueStorage.values].filter(([key]) => !key.endsWith(':lease')).sort(([left], [right]) => left.localeCompare(right)))
  const validationInputsBeforeInvalid = validationGateway.inputs.length; const invalidQueueBytesBefore = durableInvalidQueueBytes()
  const legacyFlex = structuredClone(flexBase); legacyFlex.arrangement.flex_bonus_formula = { type: 'revenue', trigger: 700, bonus_rate: 20 }
  const invalidDrafts: Array<[string, FieldDraft]> = [
    ['over-precision field acres', { ...draft(data), total_acres: 80.001 }],
    ['owned ground with cash rent', { ...draft(data), arrangement: { ...draft(data).arrangement, cash_rent_per_acre: 1 } }],
    ['negative flex floor', { ...flexBase, arrangement: { ...flexBase.arrangement, flex_bonus_formula: { ...(flexBase.arrangement.flex_bonus_formula as unknown as Record<string, unknown>), min_rent_per_acre: -1 } as never } }],
    ['non-numeric percent-of-revenue base rent', { ...flexBase, arrangement: { ...flexBase.arrangement, flex_bonus_formula: { ...(flexBase.arrangement.flex_bonus_formula as unknown as Record<string, unknown>), base_rent_per_acre: 'bad' } as never } }],
    ['object percent-of-revenue revenue trigger', { ...flexBase, arrangement: { ...flexBase.arrangement, flex_bonus_formula: { ...(flexBase.arrangement.flex_bonus_formula as unknown as Record<string, unknown>), trigger_revenue_per_acre: { bad: true } } as never } }],
    ['unused percent-of-revenue base rent', { ...flexBase, arrangement: { ...flexBase.arrangement, flex_bonus_formula: { ...(flexBase.arrangement.flex_bonus_formula as unknown as Record<string, unknown>), base_rent_per_acre: 1 } as never } }],
    ['unused percent-of-revenue revenue trigger', { ...flexBase, arrangement: { ...flexBase.arrangement, flex_bonus_formula: { ...(flexBase.arrangement.flex_bonus_formula as unknown as Record<string, unknown>), trigger_revenue_per_acre: 1 } as never } }],
    ['unknown flex setting', { ...flexBase, arrangement: { ...flexBase.arrangement, flex_bonus_formula: { ...(flexBase.arrangement.flex_bonus_formula as unknown as Record<string, unknown>), surprise: true } as never } }],
    ['oversized flex note', { ...flexBase, arrangement: { ...flexBase.arrangement, flex_bonus_formula: { ...(flexBase.arrangement.flex_bonus_formula as unknown as Record<string, unknown>), price_source_note: 'x'.repeat(501) } as never } }],
    ['unknown top-level setting', { ...draft(data), surprise: true } as never],
    ['unknown arrangement setting', { ...draft(data), arrangement: { ...draft(data).arrangement, surprise: true } } as never],
    ['unknown crop setting', { ...draft(data), crop_assignments: [{ ...draft(data).crop_assignments[0]!, surprise: true }] } as never],
    ['unknown legacy-flex setting', { ...legacyFlex, arrangement: { ...legacyFlex.arrangement, flex_bonus_formula: { ...(legacyFlex.arrangement.flex_bonus_formula as unknown as Record<string, unknown>), surprise: true } as never } }],
  ]
  for (const [label, invalid] of invalidDrafts) { await rejects(() => validationLive.saveField(invalid), `Online Fields accepted ${label}.`); await rejects(() => invalidQueued.saveField(invalid), `Offline Fields accepted ${label}.`) }
  assert(validationGateway.inputs.length === validationInputsBeforeInvalid && durableInvalidQueueBytes() === invalidQueueBytesBefore, 'Invalid Fields drafts reached a writer or changed durable queue storage.')
  const roundedEchoGateway = new FakeFieldsDataGateway(); roundedEchoGateway.mutateSave = (reply) => { const field = reply.field as Record<string, unknown>; return { ...reply, field: { ...field, total_acres: Number(field.total_acres) + 0.01 } } }; await rejects(() => repository(roundedEchoGateway).saveField(draft(roundedEchoGateway.data)), 'A server-rounded field echo was accepted as the exact save result.')
  // 10. full, corrupt, and unknown queue values reject without replacement.
  const badStorage = new FakeStorage(); badStorage.setItem(queueKey, '{"version":2,"entries":[]}'); const badQueued = new QueuedFieldsRepository(repository(new FakeFieldsDataGateway()), { getContext: async () => ({ userId: userA, farmId: data.farm.id }), projectRef: supabaseConfig.projectRef, storage: badStorage, createId: ids(), clock: () => '2026-07-11T00:00:00.000Z', isOffline: () => true }); await rejects(() => badQueued.saveField({ ...draft(data), crop_assignments: [] }), 'Unknown queue version must reject.'); assert(badStorage.getItem(queueKey) === '{"version":2,"entries":[]}', 'Unsafe queue was overwritten.')
  // 11-12. replay is FIFO, retains IDs after a transport failure, and receipt replay does not duplicate.
  const replayStorage = new FakeStorage(); let offline = true; const replayGateway = new FakeFieldsDataGateway(); const replayWriter = repository(replayGateway); const replay = new QueuedFieldsRepository(replayWriter, { getContext: async () => ({ userId: userA, farmId: data.farm.id }), projectRef: supabaseConfig.projectRef, storage: replayStorage, createId: ids(), clock: () => '2026-07-11T00:00:00.000Z', isOffline: () => offline }); await replay.saveField({ ...draft(data), crop_assignments: [] }); const second = { ...draft(data), crop_assignments: [] }; second.name = 'Second FIFO'; await replay.saveField(second); offline = false; await replay.inspectAndReplay(); assert(replayGateway.inputs.map((input) => input.draft.name).join('|') === 'North Home|Second FIFO' && JSON.parse(replayStorage.getItem(queueKey)!).entries.length === 0, 'Replay was not FIFO with original operation IDs.')
  // 13a. Two tabs sharing real storage append atomically under the same lock; neither write is lost.
  const raceStorage = new FakeStorage(); const raceIds = ids(); const raceContext = async () => ({ userId: userA, farmId: data.farm.id }); const writerA = new QueuedFieldsRepository(repository(new FakeFieldsDataGateway()), { getContext: raceContext, projectRef: supabaseConfig.projectRef, storage: raceStorage, createId: raceIds, clock: () => '2026-07-11T00:00:00.000Z', isOffline: () => true }); const writerB = new QueuedFieldsRepository(repository(new FakeFieldsDataGateway()), { getContext: raceContext, projectRef: supabaseConfig.projectRef, storage: raceStorage, createId: raceIds, clock: () => '2026-07-11T00:00:00.000Z', isOffline: () => true }); const raceOne = { ...draft(data), name: 'Writer one', crop_assignments: [] }; const raceTwo = { ...draft(data), name: 'Writer two', crop_assignments: [] }; await Promise.all([writerA.saveField(raceOne), writerB.saveField(raceTwo)]); assert(JSON.parse(raceStorage.getItem(queueKey)!).entries.map((entry: { draft: { name: string } }) => entry.draft.name).sort().join('|') === 'Writer one|Writer two', 'Concurrent writers lost a queue entry.')
  // 13b. Storage-full, corrupt, and write-read mismatch keep the prior bytes intact.
  const fullStorage = new FakeStorage(); fullStorage.throwOnSet = true; const fullQueue = new QueuedFieldsRepository(repository(new FakeFieldsDataGateway()), { getContext: raceContext, projectRef: supabaseConfig.projectRef, storage: fullStorage, createId: ids(), clock: () => '2026-07-11T00:00:00.000Z', isOffline: () => true }); await rejects(() => fullQueue.saveField({ ...draft(data), crop_assignments: [] }), 'Full storage must reject.'); const corruptStorage = new FakeStorage(); corruptStorage.setItem(queueKey, '{bad'); const corruptQueue = new QueuedFieldsRepository(repository(new FakeFieldsDataGateway()), { getContext: raceContext, projectRef: supabaseConfig.projectRef, storage: corruptStorage, createId: ids(), clock: () => '2026-07-11T00:00:00.000Z', isOffline: () => true }); await rejects(() => corruptQueue.saveField({ ...draft(data), crop_assignments: [] }), 'Corrupt storage must reject.'); assert(corruptStorage.getItem(queueKey) === '{bad', 'Corrupt queue was overwritten.')
  // 13. queue keys isolate users.
  assert(replayStorage.getItem(writeQueueKey(supabaseConfig.projectRef, userB, data.farm.id)) === null, 'Another user can see this queue.')
  // 13c. A singleton repository must not return User A's retained workspace
  // after the SPA switches to User B and User B's live read has a transport failure.
  const accountStorage = new FakeStorage(); const accountGateway = new FakeFieldsDataGateway(); accountGateway.data.fields[0].name = 'USER_A_PRIVATE_FIELD'; let activeUser = userA; const accountRepository = new QueuedFieldsRepository(repository(accountGateway), { getContext: async () => ({ userId: activeUser, farmId: data.farm.id }), projectRef: supabaseConfig.projectRef, storage: accountStorage, createId: ids(), clock: () => '2026-07-15T00:00:00.000Z', isOffline: () => false }); const accountA = await accountRepository.getData(); assert(accountA.fields[0].name === 'USER_A_PRIVATE_FIELD', 'User A did not load the attack fixture.'); activeUser = userB; accountGateway.failLoad = new TypeError('Failed to fetch'); let crossAccountLeak = false; try { const accountB = await accountRepository.getData(); crossAccountLeak = accountB.fields.some((field) => field.name === 'USER_A_PRIVATE_FIELD') } catch { /* fail-closed is the expected no-cache outcome */ } assert(!crossAccountLeak, 'User B received User A in-memory workspace after a transport failure.')
  // 13d. A save waiting behind the queue lock remains bound to its exact account and grant epoch.
  for (const scenario of ['account-switch', 'same-scope-regrant'] as const) {
    const guardedStorage = new FakeStorage(); const guardedRef = `fields-${scenario}`; const scope = { projectRef: guardedRef, userId: userA, farmId: data.farm.id }; resetFarmGrantFromLive(guardedStorage, scope, 1, '2026-07-15T00:00:00.000Z')
    let guardedUser = userA; let nextId = 9500
    let entered!: () => void; const enteredPromise = new Promise<void>((resolve) => { entered = resolve })
    let release!: () => void; const releasePromise = new Promise<void>((resolve) => { release = resolve })
    let captured!: () => void; const capturedPromise = new Promise<void>((resolve) => { captured = resolve })
    const guardedKey = writeQueueKey(guardedRef, userA, data.farm.id)
    const blocker = queueTransaction(guardedKey, guardedStorage, () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`, async () => { entered(); await releasePromise }); await enteredPromise
    const guardedGateway = new FakeFieldsDataGateway(); const guarded = new QueuedFieldsRepository(repository(guardedGateway), { getContext: async () => { const value = { userId: guardedUser, farmId: data.farm.id }; captured(); return value }, projectRef: guardedRef, storage: guardedStorage, createId: () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`, clock: () => '2026-07-15T00:00:00.000Z', isOffline: () => true })
    const saving = guarded.saveField({ ...draft(data), crop_assignments: [] }); await capturedPromise
    if (scenario === 'account-switch') guardedUser = userB; else resetFarmGrantFromLive(guardedStorage, scope, 1, '2026-07-15T00:01:00.000Z')
    release(); await blocker; await rejects(() => saving, `Fields must reject a delayed ${scenario} save.`)
    assert(guardedGateway.inputs.length === 0 && new FieldsWriteQueue(guardedStorage, guardedKey).read().entries.length === 0, `Fields ${scenario} race reached the writer or queue.`)
  }
  // 14. Grain reads injected Fields and preserves its own storage slice.
  const previousLocalStorage = globalThis.localStorage; Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage }); const injected: FieldsRepository = { getData: async () => data, saveField: async (value) => ({ ...data.fields[0], id: value.id ?? data.fields[0].id }) }; const grain = new MockGrainRepository(injected); const grainData = await grain.getData(); const grainEnvelope = writeGrainEnvelope(storage.getItem('farm-rx-local-data'), { ...grainData, fields: data }); assert(grainData.fields.farm.id === data.farm.id && !('fields' in (JSON.parse(grainEnvelope).grain as object)), 'Injected Grain crossed into Fields storage.'); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousLocalStorage })
  // 15. release composition is deliberately live Fields + queued live Grain at the exact project ref.
  assert(moduleBackends.fields === 'supabase' && moduleBackends.grain === 'supabase' && supabaseConfig.projectRef === 'agvsozfbstpekuqxpqjr', 'Backend manifest or project identity drifted.')
}

void run().then(() => console.log('SupabaseFieldsRepository regressions passed.'))
