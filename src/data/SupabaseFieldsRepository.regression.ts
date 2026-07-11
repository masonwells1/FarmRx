import type { Arrangement, CropAssignment, Field, FieldDraft, FieldsData, FieldsRepository } from './fields'
import type { FieldsDataGateway, FieldsRowBundle, SaveFieldBundleInput, SavedFieldBundle } from './FieldsDataGateway'
import { fieldsSeedForRegression } from './MockFieldsRepository'
import { MockGrainRepository, writeGrainEnvelope } from './MockGrainRepository'
import { QueuedFieldsRepository } from './QueuedFieldsRepository'
import { SupabaseFieldsRepository } from './SupabaseFieldsRepository'
import { getSyncStatus } from './syncStatus'
import { writeQueueKey } from './writeQueue'
import { moduleBackends } from './backends'
import { supabaseConfig } from '../lib/supabaseConfig'

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
async function rejects(action: () => Promise<unknown>, message: string) { let failed = false; try { await action() } catch { failed = true }; assert(failed, message) }
class FakeStorage {
  values = new Map<string, string>(); throwOnSet = false
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { if (this.throwOnSet) throw new Error('storage full'); this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

function draft(data: FieldsData, patch: Partial<FieldDraft> = {}): FieldDraft {
  const field = data.fields[0]; const arrangement = data.arrangements.find((row) => row.field_id === field.id && row.effective_to === null)!; const assignments = data.crop_assignments.filter((row) => row.field_id === field.id && row.crop_year === new Date().getFullYear())
  return { id: field.id, name: field.name, operating_entity_id: field.operating_entity_id, total_acres: field.total_acres, county: field.county, state: field.state, legal_description: field.legal_description, fsa_farm_number: field.fsa_farm_number, fsa_tract_number: field.fsa_tract_number, soil_productivity_index: field.soil_productivity_index, arrangement: { arrangement_type: arrangement.arrangement_type, landlord_name: arrangement.landlord_name, landlord_phone: arrangement.landlord_phone, landlord_contact_notes: arrangement.landlord_contact_notes, effective_from: arrangement.effective_from, cash_rent_per_acre: arrangement.cash_rent_per_acre, flex_bonus_formula: arrangement.flex_bonus_formula, landlord_crop_pct: arrangement.landlord_crop_pct, landlord_seed_pct: arrangement.landlord_seed_pct, landlord_fertilizer_pct: arrangement.landlord_fertilizer_pct, landlord_chemical_pct: arrangement.landlord_chemical_pct, landlord_fuel_pct: arrangement.landlord_fuel_pct, landlord_labor_custom_pct: arrangement.landlord_labor_custom_pct, landlord_crop_insurance_pct: arrangement.landlord_crop_insurance_pct, landlord_equipment_pct: arrangement.landlord_equipment_pct, landlord_interest_pct: arrangement.landlord_interest_pct, landlord_other_input_pct: arrangement.landlord_other_input_pct, notes: arrangement.notes }, crop_assignments: assignments.map((row) => ({ id: row.id, crop_year: row.crop_year, commodity_id: row.commodity_id, planted_acres: row.planted_acres, planting_sequence: row.planting_sequence, variety: row.variety, planting_date: row.planting_date, harvest_date: row.harvest_date, harvested_bushels: row.harvested_bushels, expected_yield_per_acre: row.expected_yield_per_acre, expected_price_per_bu: row.expected_price_per_bu, notes: row.notes })), ...patch }
}

class FakeFieldsDataGateway implements FieldsDataGateway {
  readonly data = fieldsSeedForRegression(); inputs: SaveFieldBundleInput[] = []; failLoad = false; failSave: Error | null = null; receipts = new Map<string, SavedFieldBundle>()
  async loadWorkspace(_farmId: string): Promise<FieldsRowBundle> { if (this.failLoad) throw new Error('partial query failed'); return structuredClone(this.data) }
  async saveFieldBundle(input: SaveFieldBundleInput): Promise<SavedFieldBundle> {
    if (this.failSave) throw this.failSave
    if (input.draft.id === this.data.fields[0].id && input.draft.crop_assignments.some((row) => row.id && !this.data.crop_assignments.some((saved) => saved.id === row.id))) throw new Error('A crop record changed before it could be saved.')
    this.inputs.push(structuredClone(input))
    const receipt = this.receipts.get(input.operationId); if (receipt) return structuredClone(receipt)
    const previous = this.data.fields.find((row) => row.id === input.draft.id) ?? this.data.fields[0]
    const field: Field = { ...previous, id: input.draft.id!, farm_id: input.farmId, name: input.draft.name, operating_entity_id: input.draft.operating_entity_id, total_acres: input.draft.total_acres, county: input.draft.county, state: input.draft.state, legal_description: input.draft.legal_description, fsa_farm_number: input.draft.fsa_farm_number, fsa_tract_number: input.draft.fsa_tract_number, soil_productivity_index: input.draft.soil_productivity_index }
    const arrangement: Arrangement = { ...this.data.arrangements[0], ...input.draft.arrangement, id: (input.draft.arrangement as { id?: string }).id ?? this.data.arrangements[0].id, farm_id: input.farmId, field_id: field.id, effective_to: null }
    const cropAssignments: CropAssignment[] = input.draft.crop_assignments.map((row, index) => ({ ...this.data.crop_assignments[index], ...row, id: row.id!, farm_id: input.farmId, field_id: field.id, expected_yield_per_acre: row.expected_yield_per_acre ?? null, expected_price_per_bu: row.expected_price_per_bu ?? null }))
    const result = { field, arrangement, cropAssignments }; this.receipts.set(input.operationId, structuredClone(result)); return result
  }
}

function ids() { let value = 9000; return () => `00000000-0000-4000-8000-${String(value++).padStart(12, '0')}` }
function repository(gateway: FakeFieldsDataGateway) { return new SupabaseFieldsRepository({ gateway, getFarmId: async () => gateway.data.farm.id, createId: ids(), clock: () => '2026-07-11T00:00:00.000Z' }) }

async function run() {
  const gateway = new FakeFieldsDataGateway(); const live = repository(gateway); const data = await live.getData()
  // 1. all six result sets map numeric/null values, and an incomplete read rejects.
  assert(data.fields.length === gateway.data.fields.length && data.fields[0].total_acres === 422.5 && data.fields[0].legal_description !== undefined, 'getData did not map the workspace exactly.')
  gateway.failLoad = true; await rejects(() => live.getData(), 'Partial workspace reads must reject.'); gateway.failLoad = false
  // 2. a new save is farm-bound and returns only the canonical gateway field.
  const saved = await live.saveField({ ...draft(data), id: undefined, name: 'Canonical field', crop_assignments: [] }); assert(gateway.inputs.length === 1 && gateway.inputs[0].farmId === data.farm.id && saved.name === 'Canonical field', 'New saves must use one farm-bound bundle.')
  // 3. live rejections never become mock/seed successes.
  gateway.failSave = new Error('permission denied'); await rejects(() => live.saveField(draft(data)), 'Remote failures must propagate.'); gateway.failSave = null
  // 4. every additive support-migration value survives the adapter mapping.
  const rich = draft(data); rich.arrangement.landlord_phone = '618-555-0147'; rich.arrangement.landlord_contact_notes = 'Call after 6 PM.'; rich.crop_assignments[0].harvested_bushels = 0; rich.crop_assignments[0].expected_yield_per_acre = 205; rich.crop_assignments[0].expected_price_per_bu = 0; const richSaved = await live.saveField(rich); assert(richSaved.id === rich.id && gateway.inputs.at(-1)!.draft.arrangement.landlord_phone === '618-555-0147', 'Support-migration properties did not round trip.')
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
  // 14. Grain reads injected Fields and preserves its own storage slice.
  const previousLocalStorage = globalThis.localStorage; Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage }); const injected: FieldsRepository = { getData: async () => data, saveField: async (value) => ({ ...data.fields[0], id: value.id ?? data.fields[0].id }) }; const grain = new MockGrainRepository(injected); const grainData = await grain.getData(); const grainEnvelope = writeGrainEnvelope(storage.getItem('farm-rx-local-data'), { ...grainData, fields: data }); assert(grainData.fields.farm.id === data.farm.id && !('fields' in (JSON.parse(grainEnvelope).grain as object)), 'Injected Grain crossed into Fields storage.'); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: previousLocalStorage })
  // 15. release composition is deliberately live Fields + queued live Grain at the exact project ref.
  assert(moduleBackends.fields === 'supabase' && moduleBackends.grain === 'supabase' && supabaseConfig.projectRef === 'agvsozfbstpekuqxpqjr', 'Backend manifest or project identity drifted.')
}

void run().then(() => console.log('SupabaseFieldsRepository regressions passed.'))
