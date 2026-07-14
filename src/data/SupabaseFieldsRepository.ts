import type { Arrangement, Commodity, CropAssignment, Entity, EntityType, Farm, Field, FieldDraft, FieldsData, FieldsRepository, FlexBonusFormula, FlexMethod, LandArrangementType } from './fields'
import type { FieldsDataGateway, SaveFieldBundleInput } from './FieldsDataGateway'
import { structuredFlexFormulaError } from './flexLeaseValidation'

export interface SavedFieldOperation {
  field: Field
  arrangement: Arrangement
  cropAssignments: CropAssignment[]
}

export interface FieldsOperationWriter {
  saveFieldOperation(draft: FieldDraft, operationId: string): Promise<SavedFieldOperation>
}

type Clock = () => string
type IdSource = () => string
type NormalizedDraft = FieldDraft & { id: string; arrangement: FieldDraft['arrangement'] & { id: string }; crop_assignments: Array<FieldDraft['crop_assignments'][number] & { id: string }> }
const entityTypes = new Set<EntityType>(['individual', 'sole_proprietorship', 'partnership', 'llc', 'corporation', 'trust'])
const arrangementTypes = new Set<LandArrangementType>(['owned', 'cash_rent', 'flex_cash_rent', 'crop_share'])
const cropFamilies = new Set<Commodity['crop_family']>(['corn', 'soybeans', 'wheat'])
const shareKeys = ['landlord_seed_pct', 'landlord_fertilizer_pct', 'landlord_chemical_pct', 'landlord_fuel_pct', 'landlord_labor_custom_pct', 'landlord_crop_insurance_pct', 'landlord_equipment_pct', 'landlord_interest_pct', 'landlord_other_input_pct'] as const

function fail(message: string): never { throw new Error(message) }
function record(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} is malformed.`); return value as Record<string, unknown> }
/** Audit P2-05: every contracted column must actually be present in a loaded/echoed row.
 * A dropped or misnamed column fails loudly here instead of collapsing to null/undefined.
 * The proxy is read-only scaffolding for mapping; it is never returned to callers. */
function strictRow(value: unknown, label: string): Record<string, unknown> {
  const row = record(value, label)
  return new Proxy(row, { get(target, key) { if (typeof key === 'string' && !Object.hasOwn(target, key)) fail(`${label} data is missing its "${key}" column. Reload the app; if this keeps happening, contact support.`); return target[key as keyof typeof target] } })
}
function text(value: unknown, label: string): string { if (typeof value !== 'string') fail(`${label} is malformed.`); return value }
function nullableText(value: unknown, label: string): string | null { if (value === null) return null; return text(value, label) }
function finite(value: unknown, label: string): number { const next = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN; if (!Number.isFinite(next)) fail(`${label} is malformed.`); return next }
function nullableFinite(value: unknown, label: string): number | null { return value === null ? null : finite(value, label) }
function bool(value: unknown, label: string): boolean { if (typeof value !== 'boolean') fail(`${label} is malformed.`); return value }
function iso(value: unknown, label: string): string { return text(value, label) }
function nullableDate(value: unknown, label: string): string | null { return value === null ? null : text(value, label) }
const flexMethods = new Set<FlexMethod>(['base_plus_bonus', 'pct_of_revenue', 'base_flex_price', 'base_flex_price_yield'])
function nullableFlex(value: unknown): FlexBonusFormula | null {
  if (value === null) return null
  const formula = record(value, 'Flex rent formula')
  // The structured schema (docs/flex-lease-research.md §3) is discriminated by "method"; the
  // legacy Module 1 shape by "type". Both stay readable — see docs/flex-lease-research.md §3
  // "Translation of existing saved shapes".
  if (typeof formula.method === 'string') {
    const method = formula.method
    if (!flexMethods.has(method as FlexMethod)) fail('Flex rent formula method is malformed.')
    return {
      method: method as FlexMethod,
      base_rent_per_acre: nullableFinite(formula.base_rent_per_acre ?? null, 'Flex base rent'),
      rate_pct: nullableFinite(formula.rate_pct ?? null, 'Flex rate percent'),
      trigger_revenue_per_acre: nullableFinite(formula.trigger_revenue_per_acre ?? null, 'Flex revenue trigger'),
      base_price_per_bu: nullableFinite(formula.base_price_per_bu ?? null, 'Flex base price'),
      base_yield_per_acre: nullableFinite(formula.base_yield_per_acre ?? null, 'Flex base yield'),
      min_rent_per_acre: nullableFinite(formula.min_rent_per_acre ?? null, 'Flex minimum rent'),
      max_rent_per_acre: nullableFinite(formula.max_rent_per_acre ?? null, 'Flex maximum rent'),
      price_source_note: nullableText(formula.price_source_note ?? null, 'Flex price source note'),
    }
  }
  const type = text(formula.type, 'Flex rent formula type')
  if (type !== 'price' && type !== 'yield' && type !== 'revenue') fail('Flex rent formula type is malformed.')
  return { type, trigger: finite(formula.trigger, 'Flex rent trigger'), bonus_rate: finite(formula.bonus_rate, 'Flex rent bonus rate') }
}

function mapFarm(value: unknown): Farm { const row = strictRow(value, 'Farm'); return { id: text(row.id, 'Farm ID'), name: text(row.name, 'Farm name'), share_with_rep: bool(row.share_with_rep, 'Farm sharing setting'), created_by: text(row.created_by, 'Farm creator'), created_at: iso(row.created_at, 'Farm created date'), updated_at: iso(row.updated_at, 'Farm updated date') } }
function mapEntity(value: unknown): Entity { const row = strictRow(value, 'Entity'); const entity_type = text(row.entity_type, 'Entity type'); if (!entityTypes.has(entity_type as EntityType)) fail('Entity type is malformed.'); return { id: text(row.id, 'Entity ID'), farm_id: text(row.farm_id, 'Entity farm ID'), name: text(row.name, 'Entity name'), entity_type: entity_type as EntityType, is_active: bool(row.is_active, 'Entity active setting'), created_at: iso(row.created_at, 'Entity created date'), updated_at: iso(row.updated_at, 'Entity updated date') } }
export function mapField(value: unknown): Field { const row = strictRow(value, 'Field'); const location_source = row.location_source === null ? null : text(row.location_source, 'Field location source'); if (location_source !== null && location_source !== 'gps' && location_source !== 'manual') fail('Field location source is malformed.'); const latitude = nullableFinite(row.latitude, 'Field latitude'); const longitude = nullableFinite(row.longitude, 'Field longitude'); if ((latitude === null) !== (longitude === null) || ((latitude === null) !== (location_source === null)) || (latitude !== null && (latitude < -90 || latitude > 90 || longitude! < -180 || longitude! > 180))) fail('Field location is malformed.'); return { id: text(row.id, 'Field ID'), farm_id: text(row.farm_id, 'Field farm ID'), operating_entity_id: text(row.operating_entity_id, 'Field entity ID'), name: text(row.name, 'Field name'), legal_description: nullableText(row.legal_description, 'Field legal description'), county: nullableText(row.county, 'Field county'), state: nullableText(row.state, 'Field state'), total_acres: finite(row.total_acres, 'Field acres'), fsa_farm_number: nullableText(row.fsa_farm_number, 'FSA farm number'), fsa_tract_number: nullableText(row.fsa_tract_number, 'FSA tract number'), soil_productivity_index: nullableFinite(row.soil_productivity_index, 'Soil productivity index'), latitude, longitude, location_source, is_active: bool(row.is_active, 'Field active setting'), created_at: iso(row.created_at, 'Field created date'), updated_at: iso(row.updated_at, 'Field updated date') } }
function mapArrangement(value: unknown): Arrangement { const row = strictRow(value, 'Arrangement'); const arrangement_type = text(row.arrangement_type, 'Arrangement type'); if (!arrangementTypes.has(arrangement_type as LandArrangementType)) fail('Arrangement type is malformed.'); const result = { id: text(row.id, 'Arrangement ID'), farm_id: text(row.farm_id, 'Arrangement farm ID'), field_id: text(row.field_id, 'Arrangement field ID'), arrangement_type: arrangement_type as LandArrangementType, landlord_name: nullableText(row.landlord_name, 'Landlord name'), landlord_phone: nullableText(row.landlord_phone, 'Landlord phone'), landlord_contact_notes: nullableText(row.landlord_contact_notes, 'Landlord contact notes'), effective_from: iso(row.effective_from, 'Arrangement start date'), effective_to: nullableDate(row.effective_to, 'Arrangement end date'), cash_rent_per_acre: nullableFinite(row.cash_rent_per_acre, 'Cash rent'), flex_bonus_formula: nullableFlex(row.flex_bonus_formula), landlord_crop_pct: nullableFinite(row.landlord_crop_pct, 'Landlord crop share'), notes: nullableText(row.notes, 'Arrangement notes'), created_at: iso(row.created_at, 'Arrangement created date'), updated_at: iso(row.updated_at, 'Arrangement updated date') } as Omit<Arrangement, typeof shareKeys[number]>
  return Object.assign(result, ...shareKeys.map((key) => ({ [key]: finite(row[key], `Arrangement ${key}`) }))) as Arrangement
}
export function mapCropAssignment(value: unknown): CropAssignment { const row = strictRow(value, 'Crop assignment'); return { id: text(row.id, 'Crop assignment ID'), farm_id: text(row.farm_id, 'Crop assignment farm ID'), field_id: text(row.field_id, 'Crop assignment field ID'), crop_year: finite(row.crop_year, 'Crop year'), commodity_id: text(row.commodity_id, 'Commodity ID'), planting_sequence: finite(row.planting_sequence, 'Planting sequence'), planted_acres: finite(row.planted_acres, 'Planted acres'), variety: nullableText(row.variety, 'Crop variety'), planting_date: nullableDate(row.planting_date, 'Planting date'), harvest_date: nullableDate(row.harvest_date, 'Harvest date'), harvested_bushels: nullableFinite(row.harvested_bushels, 'Harvested bushels'), expected_yield_per_acre: nullableFinite(row.expected_yield_per_acre, 'Expected yield'), expected_price_per_bu: nullableFinite(row.expected_price_per_bu, 'Expected price'), actual_price_per_bu: nullableFinite(row.actual_price_per_bu, 'Actual harvest price'), notes: nullableText(row.notes, 'Crop notes'), created_at: iso(row.created_at, 'Crop assignment created date'), updated_at: iso(row.updated_at, 'Crop assignment updated date') } }
function mapCommodity(value: unknown): Commodity { const row = strictRow(value, 'Commodity'); const crop_family = text(row.crop_family, 'Commodity family'); if (!cropFamilies.has(crop_family as Commodity['crop_family'])) fail('Commodity family is malformed.'); const traits = record(row.traits, 'Commodity traits'); return { id: text(row.id, 'Commodity ID'), name: text(row.name, 'Commodity name'), crop_family: crop_family as Commodity['crop_family'], traits, is_active: bool(row.is_active, 'Commodity active setting'), created_at: iso(row.created_at, 'Commodity created date'), updated_at: iso(row.updated_at, 'Commodity updated date') } }

function validateWorkspace(data: FieldsData, farmId: string) {
  if (data.farm.id !== farmId) fail('Farm access did not match the selected farm.')
  const entities = new Set(data.entities.map((row) => row.id))
  const fields = new Set(data.fields.map((row) => row.id))
  const commodities = new Set(data.commodities.map((row) => row.id))
  if (data.entities.some((row) => row.farm_id !== farmId) || data.fields.some((row) => row.farm_id !== farmId || !entities.has(row.operating_entity_id)) || data.arrangements.some((row) => row.farm_id !== farmId || !fields.has(row.field_id)) || data.crop_assignments.some((row) => row.farm_id !== farmId || !fields.has(row.field_id) || !commodities.has(row.commodity_id))) fail('Farm data contains a record that does not belong to this farm.')
}

/** Fails closed before a flex_cash_rent draft ever leaves the browser (farmerError maps this to "Check the field details and try again."). */
function assertFlexFormulaDraft(formula: FlexBonusFormula | null) {
  assert(formula !== null, 'Flex rent requires a bonus formula.')
  const value = formula as unknown as Record<string, unknown>
  if (typeof value.method === 'string') { const error = structuredFlexFormulaError(value); assert(error === null, error ?? 'Flex rent formula is invalid.'); return }
  assert(value.type === 'price' || value.type === 'yield' || value.type === 'revenue', 'Flex bonus type must be price, yield, or revenue.')
  assert(typeof value.trigger === 'number' && Number.isFinite(value.trigger) && value.trigger >= 0, 'Flex bonus trigger must be zero or greater.')
  assert(typeof value.bonus_rate === 'number' && Number.isFinite(value.bonus_rate) && value.bonus_rate > 0, 'Flex bonus rate must be greater than zero.')
}
function cleanText(value: string | null): string | null { return value === null ? null : value.trim() || null }
function assert(condition: unknown, message: string): asserts condition { if (!condition) fail(message) }
function validDate(value: string | null): boolean { return value === null || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))) }

/** Normalizes one UI draft before a request or durable queue attempt. */
export function normalizeFieldDraft(draft: FieldDraft, createId: IdSource): NormalizedDraft {
  assert(draft.name.trim().length > 0 && draft.name.trim().length <= 160, 'Field name is required and must be 160 characters or fewer.')
  assert(Number.isFinite(draft.total_acres) && draft.total_acres > 0 && draft.total_acres <= 5000, 'Field acres must be greater than zero and no more than 5,000.')
  assert(draft.state === null || (draft.state.trim().length >= 2 && draft.state.trim().length <= 50), 'State must be 2 to 50 characters when provided.')
  assert(draft.soil_productivity_index === null || (Number.isFinite(draft.soil_productivity_index) && draft.soil_productivity_index >= 0), 'Soil productivity index must be zero or greater.')
  assert(arrangementTypes.has(draft.arrangement.arrangement_type), 'Unknown land arrangement type.')
  assert(validDate(draft.arrangement.effective_from), 'Arrangement effective date is invalid.')
  if (draft.arrangement.arrangement_type === 'flex_cash_rent') assertFlexFormulaDraft(draft.arrangement.flex_bonus_formula)
  for (const key of shareKeys) assert(Number.isFinite(draft.arrangement[key]) && draft.arrangement[key] >= 0 && draft.arrangement[key] <= 100, 'Landlord input percentages must be between 0 and 100.')
  const assignments = draft.crop_assignments.map((row) => {
    assert(Number.isInteger(row.crop_year) && row.crop_year >= 1900 && row.crop_year <= 2200, 'Crop year must be between 1900 and 2200.')
    assert(Number.isFinite(row.planted_acres) && row.planted_acres > 0 && row.planted_acres <= draft.total_acres, 'Each planted acreage must be greater than zero and cannot exceed the field acres.')
    assert(Number.isInteger(row.planting_sequence) && row.planting_sequence > 0, 'Planting sequence must be a positive whole number.')
    assert(row.harvested_bushels === null || (Number.isFinite(row.harvested_bushels) && row.harvested_bushels >= 0), 'Harvested bushels must be zero or greater.')
    assert(row.expected_yield_per_acre === null || (Number.isFinite(row.expected_yield_per_acre) && row.expected_yield_per_acre > 0), 'Expected yield must be greater than zero when entered.')
    assert(row.expected_price_per_bu === null || (Number.isFinite(row.expected_price_per_bu) && row.expected_price_per_bu >= 0), 'Expected price must be zero or greater when entered.')
    const isNew = row.is_new ?? !row.id
    assert(typeof isNew === 'boolean', 'Crop record status is malformed.')
    return { ...row, id: row.id || createId(), is_new: isNew, variety: cleanText(row.variety), planting_date: row.planting_date, harvest_date: row.harvest_date, notes: cleanText(row.notes), harvested_bushels: row.harvested_bushels ?? null, expected_yield_per_acre: row.expected_yield_per_acre ?? null, expected_price_per_bu: row.expected_price_per_bu ?? null }
  })
  assert(new Set(assignments.map((row) => `${row.crop_year}|${row.commodity_id}|${row.planting_sequence}`)).size === assignments.length, 'Crop assignments must have unique crop, year, and planting sequence combinations.')
  const existingArrangementId = (draft.arrangement as FieldDraft['arrangement'] & { id?: string }).id
  return { ...draft, id: draft.id ?? createId(), name: draft.name.trim(), county: cleanText(draft.county), state: cleanText(draft.state), legal_description: cleanText(draft.legal_description), fsa_farm_number: cleanText(draft.fsa_farm_number), fsa_tract_number: cleanText(draft.fsa_tract_number), arrangement: { ...draft.arrangement, id: existingArrangementId ?? createId(), landlord_name: cleanText(draft.arrangement.landlord_name), landlord_phone: cleanText(draft.arrangement.landlord_phone), landlord_contact_notes: cleanText(draft.arrangement.landlord_contact_notes), notes: cleanText(draft.arrangement.notes) }, crop_assignments: assignments }
}

export class SupabaseFieldsRepository implements FieldsRepository, FieldsOperationWriter {
  constructor(private readonly dependencies: { gateway: FieldsDataGateway; getFarmId: () => Promise<string>; createId: IdSource; clock: Clock }) {}

  async getData(): Promise<FieldsData> {
    const farmId = await this.dependencies.getFarmId()
    const rows = await this.dependencies.gateway.loadWorkspace(farmId)
    const data: FieldsData = { farm: mapFarm(rows.farm), entities: rows.entities.map(mapEntity), fields: rows.fields.map(mapField), crop_assignments: rows.crop_assignments.map(mapCropAssignment), arrangements: rows.arrangements.map(mapArrangement), commodities: rows.commodities.map(mapCommodity) }
    validateWorkspace(data, farmId)
    return data
  }

  async saveField(draft: FieldDraft): Promise<Field> { return (await this.saveFieldOperation(draft, this.dependencies.createId())).field }

  async saveFieldOperation(draft: FieldDraft, operationId: string): Promise<SavedFieldOperation> {
    const normalized = normalizeFieldDraft(draft, this.dependencies.createId)
    const input: SaveFieldBundleInput = { farmId: await this.dependencies.getFarmId(), operationId, draft: normalized }
    const saved = await this.dependencies.gateway.saveFieldBundle(input)
    const field = mapField(saved.field)
    const arrangement = mapArrangement(saved.arrangement)
    const assignments = saved.cropAssignments.map(mapCropAssignment)
    if (field.farm_id !== input.farmId || arrangement.farm_id !== input.farmId || arrangement.field_id !== field.id || arrangement.effective_to !== null || assignments.some((item) => item.farm_id !== input.farmId || item.field_id !== field.id)) fail('Farm Rx could not confirm the field save. Please try again.')
    void this.dependencies.clock
    return { field, arrangement, cropAssignments: assignments }
  }
}
