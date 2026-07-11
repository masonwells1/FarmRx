import type { Arrangement, Commodity, CropAssignment, Entity, Farm, Field, FieldDraft, FieldsData, FieldsRepository, FlexBonusFormula, LandArrangementType } from './fields'

const STORAGE_KEY = 'farm-rx-module-1-fields-v1'
const STORAGE_VERSION = 1
const currentYear = new Date().getFullYear()
const now = () => new Date().toISOString()
const newId = () => crypto.randomUUID()
const seedId = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const entityTypes = new Set(['individual', 'sole_proprietorship', 'partnership', 'llc', 'corporation', 'trust'])
const arrangementTypes = new Set<LandArrangementType>(['owned', 'cash_rent', 'flex_cash_rent', 'crop_share'])
const inputShareKeys = ['landlord_seed_pct', 'landlord_fertilizer_pct', 'landlord_chemical_pct', 'landlord_fuel_pct', 'landlord_labor_custom_pct', 'landlord_crop_insurance_pct', 'landlord_equipment_pct', 'landlord_interest_pct', 'landlord_other_input_pct'] as const

const farm: Farm = { id: seedId(1), name: 'Wells Farm Group', share_with_rep: false, created_by: seedId(2), created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' }
const entities: Entity[] = [
  { id: seedId(11), farm_id: farm.id, name: 'Wells Farms LLC', entity_type: 'llc', is_active: true, created_at: farm.created_at, updated_at: farm.updated_at },
  { id: seedId(12), farm_id: farm.id, name: 'Wells Family Farms', entity_type: 'partnership', is_active: true, created_at: farm.created_at, updated_at: farm.updated_at },
  { id: seedId(13), farm_id: farm.id, name: 'Wells Land Co.', entity_type: 'corporation', is_active: true, created_at: farm.created_at, updated_at: farm.updated_at },
]

const commodities: Commodity[] = [
  { id: 'corn_yellow', name: 'Yellow Corn', crop_family: 'corn', traits: {}, is_active: true, created_at: farm.created_at, updated_at: farm.updated_at },
  { id: 'corn_white', name: 'White Corn', crop_family: 'corn', traits: { identity_preserved: true, premium_eligible: true }, is_active: true, created_at: farm.created_at, updated_at: farm.updated_at },
  { id: 'corn_non_gmo', name: 'Conventional Corn (Non-GMO)', crop_family: 'corn', traits: { identity_preserved: true, premium_eligible: true, non_gmo: true }, is_active: true, created_at: farm.created_at, updated_at: farm.updated_at },
  { id: 'soybeans', name: 'Soybeans', crop_family: 'soybeans', traits: {}, is_active: true, created_at: farm.created_at, updated_at: farm.updated_at },
  { id: 'soybeans_double_crop', name: 'Double-Crop Soybeans', crop_family: 'soybeans', traits: { double_crop: true }, is_active: true, created_at: farm.created_at, updated_at: farm.updated_at },
  { id: 'wheat', name: 'Wheat', crop_family: 'wheat', traits: {}, is_active: true, created_at: farm.created_at, updated_at: farm.updated_at },
]

const fieldSeed: Array<[string, number, number, string, string]> = [
  ['North Home', 11, 422.5, 'Richland', 'IL'], ['River Bottom', 11, 318, 'Lawrence', 'IL'], ['West Ridge', 12, 280, 'Richland', 'IL'], ['Cedar Creek', 12, 186.25, 'Wayne', 'IL'], ['Highland', 11, 155.5, 'Richland', 'IL'], ['East 50', 13, 50, 'Lawrence', 'IL'], ['Maple Grove', 13, 227.75, 'Wayne', 'IL'], ['South 40', 12, 40, 'Richland', 'IL'], ['Airport Farm', 11, 364, 'Lawrence', 'IL'], ['Hobbs', 13, 92, 'Richland', 'IL'],
]
const seedFields: Field[] = fieldSeed.map(([name, entityNumber, total_acres, county, state], index) => ({
  id: seedId(101 + index), farm_id: farm.id, operating_entity_id: seedId(entityNumber), name, total_acres, county, state,
  legal_description: index === 0 ? 'S 1/2 NW 1/4, T4N R10E' : null, fsa_farm_number: index === 0 ? '1147' : null, fsa_tract_number: index === 0 ? '9003' : null,
  soil_productivity_index: [132.4, 126.8, 119.5, 123.1, 117.9, 129.2, 121.6, 128.7, 124.3, 130.1][index], is_active: true, created_at: farm.created_at, updated_at: farm.updated_at,
}))

function arrangement(field_id: string, arrangement_type: LandArrangementType, values: Partial<Arrangement> = {}): Arrangement {
  return {
    id: seedId(201 + seedFields.findIndex((field) => field.id === field_id)), farm_id: farm.id, field_id, arrangement_type, landlord_name: null, effective_from: `${currentYear}-01-01`, effective_to: null,
    cash_rent_per_acre: null, flex_bonus_formula: null, landlord_crop_pct: null, landlord_seed_pct: 0, landlord_fertilizer_pct: 0, landlord_chemical_pct: 0, landlord_fuel_pct: 0, landlord_labor_custom_pct: 0,
    landlord_crop_insurance_pct: 0, landlord_equipment_pct: 0, landlord_interest_pct: 0, landlord_other_input_pct: 0, notes: null, created_at: farm.created_at, updated_at: farm.updated_at, ...values,
  }
}

const seedArrangements: Arrangement[] = [
  arrangement(seedFields[0].id, 'owned'), arrangement(seedFields[1].id, 'cash_rent', { landlord_name: 'Rivers Family', cash_rent_per_acre: 285 }),
  arrangement(seedFields[2].id, 'crop_share', { landlord_name: 'Miller Trust', landlord_crop_pct: 33.33, landlord_seed_pct: 33.33, landlord_fertilizer_pct: 33.33, landlord_chemical_pct: 33.33, landlord_fuel_pct: 33.33, landlord_labor_custom_pct: 33.33, landlord_crop_insurance_pct: 33.33, landlord_equipment_pct: 33.33, landlord_interest_pct: 33.33, landlord_other_input_pct: 33.33 }),
  arrangement(seedFields[3].id, 'cash_rent', { landlord_name: 'Harlan Estate', cash_rent_per_acre: 265 }),
  arrangement(seedFields[4].id, 'flex_cash_rent', { landlord_name: 'Weston Farms', cash_rent_per_acre: 230, flex_bonus_formula: { type: 'revenue', trigger: 750, bonus_rate: 20 } }),
  arrangement(seedFields[5].id, 'owned'), arrangement(seedFields[6].id, 'crop_share', { landlord_name: 'Maple Grove Partnership', landlord_crop_pct: 40, landlord_seed_pct: 40, landlord_fertilizer_pct: 40, landlord_chemical_pct: 40, landlord_fuel_pct: 40, landlord_labor_custom_pct: 40, landlord_crop_insurance_pct: 40, landlord_equipment_pct: 40, landlord_interest_pct: 40, landlord_other_input_pct: 40 }),
  arrangement(seedFields[7].id, 'cash_rent', { landlord_name: 'M. Carter', cash_rent_per_acre: 295 }), arrangement(seedFields[8].id, 'owned'), arrangement(seedFields[9].id, 'cash_rent', { landlord_name: 'Hobbs Family', cash_rent_per_acre: 275 }),
]

const crop = (fieldIndex: number, commodity_id: string, planted_acres: number, planting_sequence = 1, crop_year = currentYear, harvested_bushels: number | null = null): CropAssignment => ({
  id: seedId(301 + fieldIndex * 10 + planting_sequence + (crop_year === currentYear ? 0 : 100)), farm_id: farm.id, field_id: seedFields[fieldIndex].id, crop_year, commodity_id, planted_acres, planting_sequence, variety: null, planting_date: null, harvest_date: null, harvested_bushels, notes: null, created_at: farm.created_at, updated_at: farm.updated_at,
})
const seedAssignments: CropAssignment[] = [
  crop(0, 'corn_yellow', 422.5), crop(1, 'soybeans', 318), crop(2, 'corn_white', 280), crop(3, 'soybeans', 186.25), crop(4, 'corn_non_gmo', 155.5), crop(5, 'wheat', 50), crop(6, 'corn_yellow', 227.75), crop(7, 'soybeans', 40), crop(8, 'corn_yellow', 364), crop(9, 'wheat', 92), crop(9, 'soybeans_double_crop', 92, 2), crop(0, 'soybeans', 422.5, 1, currentYear - 1, 23238), crop(1, 'corn_yellow', 318, 1, currentYear - 1, 61056),
]

function seedData(): FieldsData { return structuredClone({ farm, entities, fields: seedFields, crop_assignments: seedAssignments, arrangements: seedArrangements, commodities }) }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function isString(value: unknown): value is string { return typeof value === 'string' }
function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function validDate(value: unknown): value is string { return isString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) }
function validName(value: unknown, limit = 160): boolean { return isString(value) && value.trim().length >= 1 && value.trim().length <= limit }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
function assertNullableString(value: unknown, message: string) { assert(value === null || isString(value), message) }
function assertUuid(value: unknown, message: string) { assert(isString(value) && uuidPattern.test(value), message) }
function assertPercent(value: unknown, message: string) { assert(isFiniteNumber(value) && value >= 0 && value <= 100, message) }

function assertFlexFormula(value: unknown): asserts value is FlexBonusFormula {
  assert(isRecord(value), 'Flex rent requires a bonus formula.')
  assert(value.type === 'price' || value.type === 'yield' || value.type === 'revenue', 'Flex bonus type must be price, yield, or revenue.')
  assert(isFiniteNumber(value.trigger) && value.trigger >= 0, 'Flex bonus trigger must be zero or greater.')
  assert(isFiniteNumber(value.bonus_rate) && value.bonus_rate > 0, 'Flex bonus rate must be greater than zero.')
}

function assertArrangement(arrangement: Arrangement, field: Field, farmId: string) {
  assertUuid(arrangement.id, 'Arrangement ID must be a UUID.')
  assert(arrangement.farm_id === farmId && arrangement.field_id === field.id, 'Arrangement must belong to its field and farm.')
  assert(arrangementTypes.has(arrangement.arrangement_type), 'Unknown land arrangement type.')
  assertNullableString(arrangement.landlord_name, 'Landlord name must be text or blank.')
  assert(validDate(arrangement.effective_from), 'Arrangement effective date is invalid.')
  assert(arrangement.effective_to === null || validDate(arrangement.effective_to), 'Arrangement end date is invalid.')
  assert(arrangement.effective_to === null || arrangement.effective_to >= arrangement.effective_from, 'Arrangement end date cannot be before its effective date.')
  assert(arrangement.cash_rent_per_acre === null || (isFiniteNumber(arrangement.cash_rent_per_acre) && arrangement.cash_rent_per_acre >= 0), 'Cash rent must be zero or greater.')
  assertNullableString(arrangement.notes, 'Arrangement notes must be text or blank.')
  for (const key of inputShareKeys) assertPercent(arrangement[key], 'Landlord input percentages must be between 0 and 100.')
  if (arrangement.arrangement_type === 'owned') assert(arrangement.cash_rent_per_acre === null && arrangement.flex_bonus_formula === null && arrangement.landlord_crop_pct === null, 'Owned arrangements cannot contain rent or crop-share terms.')
  if (arrangement.arrangement_type === 'cash_rent') assert(arrangement.cash_rent_per_acre !== null && arrangement.flex_bonus_formula === null && arrangement.landlord_crop_pct === null, 'Cash rent requires a rate and no flex or crop-share terms.')
  if (arrangement.arrangement_type === 'flex_cash_rent') { assert(arrangement.cash_rent_per_acre !== null && arrangement.landlord_crop_pct === null, 'Flex rent requires a base rate and cannot contain crop-share terms.'); assertFlexFormula(arrangement.flex_bonus_formula) }
  if (arrangement.arrangement_type === 'crop_share') assert(isFiniteNumber(arrangement.landlord_crop_pct) && arrangement.landlord_crop_pct > 0 && arrangement.landlord_crop_pct < 100 && arrangement.cash_rent_per_acre === null && arrangement.flex_bonus_formula === null, 'Crop share requires a landlord crop percentage between 0 and 100 and no rent terms.')
  if (arrangement.arrangement_type !== 'crop_share') for (const key of inputShareKeys) assert(arrangement[key] === 0, 'Only crop-share arrangements may include landlord input shares.')
}

function assertData(data: FieldsData) {
  assert(isRecord(data), 'Saved field data is not an object.')
  assertUuid(data.farm.id, 'Farm ID must be a UUID.'); assert(validName(data.farm.name), 'Farm name is invalid.')
  assert(Array.isArray(data.entities) && Array.isArray(data.fields) && Array.isArray(data.crop_assignments) && Array.isArray(data.arrangements) && Array.isArray(data.commodities), 'Saved field data has an invalid collection.')
  const entityIds = new Set<string>()
  for (const entity of data.entities) { assertUuid(entity.id, 'Entity ID must be a UUID.'); assert(entity.farm_id === data.farm.id && !entityIds.has(entity.id), 'Entity is invalid or duplicated.'); entityIds.add(entity.id); assert(validName(entity.name) && entityTypes.has(entity.entity_type), 'Entity name or type is invalid.') }
  const commodityIds = new Set<string>()
  for (const commodity of data.commodities) { assert(/^[a-z][a-z0-9_]*$/.test(commodity.id) && !commodityIds.has(commodity.id) && validName(commodity.name, 100), 'Commodity is invalid or duplicated.'); commodityIds.add(commodity.id) }
  const fieldIds = new Set<string>(); const fieldNames = new Set<string>()
  for (const field of data.fields) {
    assertUuid(field.id, 'Field ID must be a UUID.'); assert(field.farm_id === data.farm.id && entityIds.has(field.operating_entity_id) && !fieldIds.has(field.id), 'Field farm or entity is invalid.'); fieldIds.add(field.id)
    assert(validName(field.name) && !fieldNames.has(field.name), 'Field names must be present, unique, and 160 characters or fewer.'); fieldNames.add(field.name)
    assert(isFiniteNumber(field.total_acres) && field.total_acres > 0 && field.total_acres <= 5000, 'Field acres must be greater than zero and no more than 5,000.'); assertNullableString(field.county, 'County must be text or blank.'); assert(field.state === null || (isString(field.state) && field.state.trim().length >= 2 && field.state.trim().length <= 50), 'State must be 2 to 50 characters when provided.'); assertNullableString(field.legal_description, 'Legal description must be text or blank.'); assertNullableString(field.fsa_farm_number, 'FSA farm number must be text or blank.'); assertNullableString(field.fsa_tract_number, 'FSA tract number must be text or blank.'); assert(field.soil_productivity_index === null || (isFiniteNumber(field.soil_productivity_index) && field.soil_productivity_index >= 0), 'Soil productivity index must be zero or greater.')
  }
  const assignmentKeys = new Set<string>()
  for (const assignment of data.crop_assignments) {
    assertUuid(assignment.id, 'Crop assignment ID must be a UUID.'); const field = data.fields.find((item) => item.id === assignment.field_id); assert(field && assignment.farm_id === data.farm.id && commodityIds.has(assignment.commodity_id), 'Crop assignment field or commodity is invalid.'); assert(Number.isInteger(assignment.crop_year) && assignment.crop_year >= 1900 && assignment.crop_year <= 2200 && Number.isInteger(assignment.planting_sequence) && assignment.planting_sequence > 0, 'Crop year or planting sequence is invalid.'); assert(isFiniteNumber(assignment.planted_acres) && assignment.planted_acres > 0 && assignment.planted_acres <= field.total_acres, 'Crop acres are invalid.'); assertNullableString(assignment.variety, 'Variety must be text or blank.'); assert(assignment.planting_date === null || validDate(assignment.planting_date), 'Planting date is invalid.'); assert(assignment.harvest_date === null || validDate(assignment.harvest_date), 'Harvest date is invalid.'); assert(assignment.harvest_date === null || assignment.planting_date === null || assignment.harvest_date >= assignment.planting_date, 'Harvest date cannot be before planting date.'); assert(assignment.harvested_bushels === null || (isFiniteNumber(assignment.harvested_bushels) && assignment.harvested_bushels >= 0), 'Harvested bushels must be zero or greater.'); const key = `${assignment.field_id}|${assignment.crop_year}|${assignment.commodity_id}|${assignment.planting_sequence}`; assert(!assignmentKeys.has(key), 'Crop assignments must be unique by field, year, commodity, and sequence.'); assignmentKeys.add(key)
  }
  const currentFields = new Set<string>(); const arrangementDates = new Set<string>()
  for (const item of data.arrangements) { const field = data.fields.find((candidate) => candidate.id === item.field_id); assert(field, 'Arrangement has an invalid field.'); assertArrangement(item, field, data.farm.id); const dateKey = `${item.field_id}|${item.effective_from}`; assert(!arrangementDates.has(dateKey), 'Arrangement effective dates must be unique per field.'); arrangementDates.add(dateKey); if (item.effective_to === null) { assert(!currentFields.has(item.field_id), 'Only one current arrangement is allowed per field.'); currentFields.add(item.field_id) } }
}

function load(): FieldsData {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return seedData()
    const envelope: unknown = JSON.parse(saved)
    if (!isRecord(envelope) || envelope.version !== STORAGE_VERSION || !isRecord(envelope.data)) throw new Error('Unsupported or corrupt saved data.')
    assertData(envelope.data as unknown as FieldsData)
    return envelope.data as unknown as FieldsData
  } catch {
    const data = seedData()
    persist(data)
    return data
  }
}

function persist(data: FieldsData) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, data })) } catch { /* Local storage may be unavailable or full; keep the current session usable. */ }
}

const zeroInputShares = { landlord_seed_pct: 0, landlord_fertilizer_pct: 0, landlord_chemical_pct: 0, landlord_fuel_pct: 0, landlord_labor_custom_pct: 0, landlord_crop_insurance_pct: 0, landlord_equipment_pct: 0, landlord_interest_pct: 0, landlord_other_input_pct: 0 }
function arrangementTermsEqual(left: Arrangement, right: Arrangement): boolean { return left.arrangement_type === right.arrangement_type && left.landlord_name === right.landlord_name && left.cash_rent_per_acre === right.cash_rent_per_acre && JSON.stringify(left.flex_bonus_formula) === JSON.stringify(right.flex_bonus_formula) && left.landlord_crop_pct === right.landlord_crop_pct && inputShareKeys.every((key) => left[key] === right[key]) && left.notes === right.notes }
function dayBefore(date: string): string { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() - 1); return value.toISOString().slice(0, 10) }

export class MockFieldsRepository implements FieldsRepository {
  async getData() { return load() }

  async saveField(draft: FieldDraft) {
    const data = load(); const timestamp = now(); const existing = draft.id ? data.fields.find((item) => item.id === draft.id) : undefined
    assert(validName(draft.name), 'Field name is required and must be 160 characters or fewer.'); assert(data.fields.every((item) => item.id === existing?.id || item.name !== draft.name.trim()), 'A field with that name already exists.'); assert(data.entities.some((entity) => entity.id === draft.operating_entity_id), 'Select a valid operating entity.'); assert(isFiniteNumber(draft.total_acres) && draft.total_acres > 0 && draft.total_acres <= 5000, 'Field acres must be greater than zero and no more than 5,000.'); assert(draft.state === null || (isString(draft.state) && draft.state.trim().length >= 2 && draft.state.trim().length <= 50), 'State must be 2 to 50 characters when provided.'); assert(draft.soil_productivity_index === null || (isFiniteNumber(draft.soil_productivity_index) && draft.soil_productivity_index >= 0), 'Soil productivity index must be zero or greater.')
    const field: Field = { id: existing?.id ?? newId(), farm_id: data.farm.id, name: draft.name.trim(), operating_entity_id: draft.operating_entity_id, total_acres: draft.total_acres, county: draft.county?.trim() || null, state: draft.state?.trim() || null, legal_description: draft.legal_description?.trim() || null, fsa_farm_number: draft.fsa_farm_number?.trim() || null, fsa_tract_number: draft.fsa_tract_number?.trim() || null, soil_productivity_index: draft.soil_productivity_index, is_active: existing?.is_active ?? true, created_at: existing?.created_at ?? timestamp, updated_at: timestamp }
    const candidate: Arrangement = { id: newId(), farm_id: field.farm_id, field_id: field.id, effective_to: null, created_at: timestamp, updated_at: timestamp, ...zeroInputShares, ...draft.arrangement }
    assertArrangement(candidate, field, data.farm.id)
    assert(draft.crop_assignments.length > 0, 'Add at least one crop assignment.'); for (const assignment of draft.crop_assignments) { assert(Number.isInteger(assignment.crop_year) && assignment.crop_year >= 1900 && assignment.crop_year <= 2200, 'Crop year must be between 1900 and 2200.'); assert(data.commodities.some((commodity) => commodity.id === assignment.commodity_id), 'Select a valid commodity.'); assert(isFiniteNumber(assignment.planted_acres) && assignment.planted_acres > 0 && assignment.planted_acres <= field.total_acres, 'Each planted acreage must be greater than zero and cannot exceed the field acres.'); assert(Number.isInteger(assignment.planting_sequence) && assignment.planting_sequence > 0, 'Planting sequence must be a positive whole number.'); assert(assignment.harvested_bushels === null || (isFiniteNumber(assignment.harvested_bushels) && assignment.harvested_bushels >= 0), 'Harvested bushels must be zero or greater.') }
    const draftAssignmentKeys = new Set(draft.crop_assignments.map((item) => `${item.crop_year}|${item.commodity_id}|${item.planting_sequence}`)); assert(draftAssignmentKeys.size === draft.crop_assignments.length, 'Crop assignments must have unique crop, year, and planting sequence combinations.')
    data.fields = existing ? data.fields.map((item) => item.id === field.id ? field : item) : [...data.fields, field]
    const current = data.arrangements.find((item) => item.field_id === field.id && item.effective_to === null)
    if (current && arrangementTermsEqual(current, candidate)) data.arrangements = data.arrangements.map((item) => item.id === current.id ? { ...candidate, id: current.id, effective_from: current.effective_from, created_at: current.created_at } : item)
    else if (current && candidate.effective_from <= current.effective_from) { assert(candidate.effective_from === current.effective_from, 'A changed arrangement must have an effective date after the current arrangement begins.'); data.arrangements = data.arrangements.map((item) => item.id === current.id ? { ...candidate, id: current.id, created_at: current.created_at } : item) }
    else if (current) { data.arrangements = data.arrangements.map((item) => item.id === current.id ? { ...item, effective_to: dayBefore(candidate.effective_from), updated_at: timestamp } : item); data.arrangements.push(candidate) }
    else { assert(!data.arrangements.some((item) => item.field_id === field.id && item.effective_from === candidate.effective_from), 'An arrangement already starts on that date.'); data.arrangements.push(candidate) }
    const years = new Set(draft.crop_assignments.map((assignment) => assignment.crop_year)); data.crop_assignments = data.crop_assignments.filter((item) => !(item.field_id === field.id && years.has(item.crop_year))); data.crop_assignments.push(...draft.crop_assignments.map((assignment) => ({ ...assignment, id: newId(), farm_id: field.farm_id, field_id: field.id, created_at: timestamp, updated_at: timestamp })))
    assertData(data); persist(data); return field
  }
}

export const fieldsRepository = new MockFieldsRepository()
export const moduleYear = currentYear
