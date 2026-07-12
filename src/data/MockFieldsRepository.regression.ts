import type { Arrangement, FieldDraft, FieldsData } from './fields'
import { fieldsSeedForRegression, MockFieldsRepository, readFieldsEnvelope } from './MockFieldsRepository'

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
class FakeStorage implements Storage {
  private readonly values = new Map<string, string>()
  throwOnSet = false
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { if (this.throwOnSet) throw new Error('Storage is full.'); this.values.set(key, value) }
}
const storageKey = 'farm-rx-local-data'

function withStorage(storage: Storage, run: () => Promise<void>) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  return run().finally(() => { if (previous) Object.defineProperty(globalThis, 'localStorage', previous); else delete (globalThis as { localStorage?: Storage }).localStorage })
}
function currentArrangement(data: FieldsData, fieldId: string) { const arrangement = data.arrangements.find((item) => item.field_id === fieldId && item.effective_to === null); if (!arrangement) throw new Error('Regression fixture has no current arrangement.'); return arrangement }
function draft(data: FieldsData, arrangementPatch: Partial<Arrangement> = {}): FieldDraft {
  const field = data.fields[1]; const arrangement = { ...currentArrangement(data, field.id), ...arrangementPatch }
  return {
    id: field.id, name: field.name, operating_entity_id: field.operating_entity_id, total_acres: field.total_acres, county: field.county, state: field.state, legal_description: field.legal_description, fsa_farm_number: field.fsa_farm_number, fsa_tract_number: field.fsa_tract_number, soil_productivity_index: field.soil_productivity_index,
    arrangement: { arrangement_type: arrangement.arrangement_type, landlord_name: arrangement.landlord_name, landlord_phone: arrangement.landlord_phone, landlord_contact_notes: arrangement.landlord_contact_notes, effective_from: arrangement.effective_from, cash_rent_per_acre: arrangement.cash_rent_per_acre, flex_bonus_formula: arrangement.flex_bonus_formula, landlord_crop_pct: arrangement.landlord_crop_pct, landlord_seed_pct: arrangement.landlord_seed_pct, landlord_fertilizer_pct: arrangement.landlord_fertilizer_pct, landlord_chemical_pct: arrangement.landlord_chemical_pct, landlord_fuel_pct: arrangement.landlord_fuel_pct, landlord_labor_custom_pct: arrangement.landlord_labor_custom_pct, landlord_crop_insurance_pct: arrangement.landlord_crop_insurance_pct, landlord_equipment_pct: arrangement.landlord_equipment_pct, landlord_interest_pct: arrangement.landlord_interest_pct, landlord_other_input_pct: arrangement.landlord_other_input_pct, notes: arrangement.notes },
    crop_assignments: data.crop_assignments.filter((assignment) => assignment.field_id === field.id).map((assignment) => ({ id: assignment.id, crop_year: assignment.crop_year, commodity_id: assignment.commodity_id, planted_acres: assignment.planted_acres, planting_sequence: assignment.planting_sequence, variety: assignment.variety, planting_date: assignment.planting_date, harvest_date: assignment.harvest_date, harvested_bushels: assignment.harvested_bushels, expected_yield_per_acre: assignment.expected_yield_per_acre, expected_price_per_bu: assignment.expected_price_per_bu, notes: assignment.notes })),
  }
}

async function regression_contactRoundTripAndGrainPreservation() {
  const storage = new FakeStorage(); const fields = fieldsSeedForRegression(); const grainToken = '{"z": 1, "a":[ 2,3 ]}'
  storage.setItem(storageKey, `{"version":2,"fields":${JSON.stringify(fields)},"grain":${grainToken}}`)
  await withStorage(storage, async () => {
    const repository = new MockFieldsRepository(); const loaded = await repository.getData()
    await repository.saveField(draft(loaded, { landlord_phone: '618-555-0147', landlord_contact_notes: 'Call after 6 PM.' }))
    const saved = storage.getItem(storageKey)!; const reread = await repository.getData()
    assert(reread.arrangements.find((item) => item.field_id === loaded.fields[1].id && item.effective_to === null)?.landlord_phone === '618-555-0147', 'Landlord phone did not round-trip through saveField().')
    assert(reread.arrangements.find((item) => item.field_id === loaded.fields[1].id && item.effective_to === null)?.landlord_contact_notes === 'Call after 6 PM.', 'Landlord contact notes did not round-trip through saveField().')
    assert(saved.includes(`"grain":${grainToken}`), 'Fields save changed the shared Grain compartment bytes.')
  })
}

async function regressionWriteFailurePropagates() {
  const storage = new FakeStorage(); const fields = fieldsSeedForRegression(); storage.setItem(storageKey, JSON.stringify({ version: 2, fields, grain: { protected: true } }))
  await withStorage(storage, async () => {
    const repository = new MockFieldsRepository(); const loaded = await repository.getData(); const before = storage.getItem(storageKey); storage.throwOnSet = true
    let rejected = false; try { await repository.saveField(draft(loaded, { landlord_phone: '618-555-0199' })) } catch { rejected = true }
    assert(rejected, 'saveField() resolved after a storage write failure.')
    assert(storage.getItem(storageKey) === before, 'A failed save changed the stored envelope.')
  })
}

async function regressionUnsafeEnvelopesRemainUntouched() {
  for (const unsafe of ['{not json', JSON.stringify({ version: 99, fields: fieldsSeedForRegression(), grain: { protected: true } })]) {
    const storage = new FakeStorage(); storage.setItem(storageKey, unsafe)
    await withStorage(storage, async () => {
      const repository = new MockFieldsRepository(); const inMemorySeed = await repository.getData(); let rejected = false
      try { await repository.saveField(draft(inMemorySeed, { landlord_phone: '618-555-0101' })) } catch { rejected = true }
      assert(rejected, 'saveField() accepted an unsafe envelope.')
      assert(storage.getItem(storageKey) === unsafe, 'Fields overwrote corrupt or unknown-version storage.')
    })
  }
}

async function regressionSameDateAndFutureArrangementHistory() {
  const storage = new FakeStorage(); const fields = fieldsSeedForRegression(); storage.setItem(storageKey, JSON.stringify({ version: 2, fields, grain: { protected: true } }))
  await withStorage(storage, async () => {
    const repository = new MockFieldsRepository(); const first = await repository.getData(); const original = currentArrangement(first, first.fields[1].id)
    await repository.saveField(draft(first, { landlord_phone: '618-555-0171' }))
    const sameDate = await repository.getData(); const sameDateRows = sameDate.arrangements.filter((item) => item.field_id === first.fields[1].id)
    assert(sameDateRows.length === 1 && sameDateRows[0].id === original.id, 'Same-date arrangement edit did not update in place.')
    const futureDate = `${new Date().getFullYear()}-08-01`; await repository.saveField(draft(sameDate, { effective_from: futureDate, landlord_phone: '618-555-0172' }))
    const afterInsert = await repository.getData(); const rows = afterInsert.arrangements.filter((item) => item.field_id === first.fields[1].id).sort((left, right) => left.effective_from.localeCompare(right.effective_from))
    assert(rows.length === 2 && rows[0].effective_to === `${new Date().getFullYear()}-07-31` && rows[1].effective_from === futureDate && rows[1].effective_to === null, 'Future-effective arrangement did not close and insert history correctly.')
  })
}

async function regressionFlexLeaseMethodsSaveTime() {
  const storage = new FakeStorage(); const fields = fieldsSeedForRegression(); storage.setItem(storageKey, JSON.stringify({ version: 2, fields, grain: { protected: true } }))
  await withStorage(storage, async () => {
    const repository = new MockFieldsRepository(); const loaded = await repository.getData()
    // A valid pct_of_revenue formula (docs/flex-lease-research.md §4) saves and round-trips.
    const validPct = { arrangement_type: 'flex_cash_rent' as const, cash_rent_per_acre: 0, flex_bonus_formula: { method: 'pct_of_revenue' as const, base_rent_per_acre: null, rate_pct: 30, trigger_revenue_per_acre: null, base_price_per_bu: null, base_yield_per_acre: null, min_rent_per_acre: 200, max_rent_per_acre: 400, price_source_note: 'Fall average, Elevator A' } }
    await repository.saveField(draft(loaded, validPct))
    const reread = await repository.getData(); const savedArrangement = currentArrangement(reread, loaded.fields[1].id)
    assert(JSON.stringify(savedArrangement.flex_bonus_formula) === JSON.stringify(validPct.flex_bonus_formula), 'A valid structured flex formula did not round-trip through saveField().')
    // A valid base_plus_bonus formula saves too.
    const validBonus = { arrangement_type: 'flex_cash_rent' as const, cash_rent_per_acre: 200, flex_bonus_formula: { method: 'base_plus_bonus' as const, base_rent_per_acre: 200, rate_pct: 40, trigger_revenue_per_acre: 720, base_price_per_bu: null, base_yield_per_acre: null, min_rent_per_acre: null, max_rent_per_acre: 550, price_source_note: null } }
    await repository.saveField(draft(await repository.getData(), validBonus))
    // Fail closed: an out-of-range rate is rejected before it reaches storage.
    const invalid = { arrangement_type: 'flex_cash_rent' as const, cash_rent_per_acre: 0, flex_bonus_formula: { method: 'pct_of_revenue' as const, base_rent_per_acre: null, rate_pct: 150, trigger_revenue_per_acre: null, base_price_per_bu: null, base_yield_per_acre: null, min_rent_per_acre: null, max_rent_per_acre: null, price_source_note: null } }
    let rejected = false; try { await repository.saveField(draft(await repository.getData(), invalid)) } catch { rejected = true }
    assert(rejected, 'A pct_of_revenue rate above 100 percent must be rejected before saving.')
    // Fail closed: an unrecognized method is rejected before it reaches storage.
    const unknownMethod = { arrangement_type: 'flex_cash_rent' as const, cash_rent_per_acre: 0, flex_bonus_formula: { method: 'made_up_method', base_rent_per_acre: null, rate_pct: 30, trigger_revenue_per_acre: null, base_price_per_bu: null, base_yield_per_acre: null } } as unknown as Partial<Arrangement>
    let rejectedUnknown = false; try { await repository.saveField(draft(await repository.getData(), unknownMethod)) } catch { rejectedUnknown = true }
    assert(rejectedUnknown, 'An unrecognized flex method must be rejected before saving.')
  })
}

async function run() {
  await regression_contactRoundTripAndGrainPreservation()
  await regressionWriteFailurePropagates()
  await regressionUnsafeEnvelopesRemainUntouched()
  await regressionSameDateAndFutureArrangementHistory()
  await regressionFlexLeaseMethodsSaveTime()
  // Confirm that the final writer still yields a valid Fields compartment after real repository saves.
  const check = fieldsSeedForRegression(); readFieldsEnvelope(JSON.stringify({ version: 2, fields: check }))
  console.log('MockFieldsRepository regressions passed.')
}

void run().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
