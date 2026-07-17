import type { Arrangement, Commodity, CropAssignment, Entity, EntityType, Farm, Field, FieldDraft, FieldsData, FieldsRepository, FlexBonusFormula, FlexMethod, LandArrangementType } from './fields'
import type { FieldsDataGateway, SaveFieldBundleInput } from './FieldsDataGateway'
import { structuredFlexFormulaError } from './flexLeaseValidation'
import type { FarmOperationContext } from './farmOperationContext'

export interface SavedFieldOperation {
  field: Field
  arrangement: Arrangement
  cropAssignments: CropAssignment[]
}

export interface FieldsOperationWriter {
  saveFieldOperation(draft: FieldDraft, operationId: string, context: FarmOperationContext): Promise<SavedFieldOperation>
}

type Clock = () => string
type IdSource = () => string
type NormalizedDraft = FieldDraft & { id: string; arrangement: FieldDraft['arrangement'] & { id: string }; crop_assignments: Array<FieldDraft['crop_assignments'][number] & { id: string }> }
const entityTypes = new Set<EntityType>(['individual', 'sole_proprietorship', 'partnership', 'llc', 'corporation', 'trust'])
const arrangementTypes = new Set<LandArrangementType>(['owned', 'cash_rent', 'flex_cash_rent', 'crop_share'])
const cropFamilies = new Set<Commodity['crop_family']>(['corn', 'soybeans', 'wheat'])
const shareKeys = ['landlord_seed_pct', 'landlord_fertilizer_pct', 'landlord_chemical_pct', 'landlord_fuel_pct', 'landlord_labor_custom_pct', 'landlord_crop_insurance_pct', 'landlord_equipment_pct', 'landlord_interest_pct', 'landlord_other_input_pct'] as const
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const commodityId = /^[a-z][a-z0-9_]*$/

function fail(message: string): never { throw new Error(message) }
function record(value: unknown, label: string): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} is malformed.`); return value as Record<string, unknown> }
function exactRecord(value: unknown, label: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const row = record(value, label)
  const allowed = new Set([...required, ...optional])
  if (!required.every((key) => Object.hasOwn(row, key)) || Object.keys(row).some((key) => !allowed.has(key))) fail(`${label} contains unsupported or missing fields.`)
  return row
}
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
const structuredFlexKeys = ['method', 'base_rent_per_acre', 'rate_pct', 'trigger_revenue_per_acre', 'base_price_per_bu', 'base_yield_per_acre', 'min_rent_per_acre', 'max_rent_per_acre', 'price_source_note'] as const
const legacyFlexKeys = ['type', 'trigger', 'bonus_rate'] as const
function nullableFlex(value: unknown): FlexBonusFormula | null {
  if (value === null) return null
  const formula = record(value, 'Flex rent formula')
  // The structured schema (docs/flex-lease-research.md §3) is discriminated by "method"; the
  // legacy Module 1 shape by "type". Both stay readable — see docs/flex-lease-research.md §3
  // "Translation of existing saved shapes".
  if (typeof formula.method === 'string') {
    exactRecord(formula, 'Flex rent formula', ['method'], structuredFlexKeys.slice(1))
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
  exactRecord(formula, 'Flex rent formula', legacyFlexKeys)
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

function unique(values: string[], label: string) { if (new Set(values).size !== values.length) fail(`${label} contains duplicate records.`) }
function validStamp(value: string) { return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && validDate(value.slice(0, 10)) && !Number.isNaN(Date.parse(value)) }
function validName(value: string, max: number) { return value.trim().length > 0 && value.trim().length <= max }
function validUuid(value: string) { return uuid.test(value) }
function validDecimal(value: number, integerDigits: number, scale: number) { return Number.isFinite(value) && Math.abs(value) < 10 ** integerDigits && Number(value.toFixed(scale)) === value }
function validNullableDecimal(value: number | null, integerDigits: number, scale: number) { return value === null || validDecimal(value, integerDigits, scale) }
function validPercent(value: number | null) { return value === null || validDecimal(value, 3, 2) && value >= 0 && value <= 100 }
function validFlexFormula(value: FlexBonusFormula | null) {
  if (value === null) return false
  const formula = value as unknown as Record<string, unknown>
  if (typeof formula.method === 'string') return structuredFlexFormulaError(formula) === null
  return (formula.type === 'price' || formula.type === 'yield' || formula.type === 'revenue') && typeof formula.trigger === 'number' && Number.isFinite(formula.trigger) && formula.trigger >= 0 && typeof formula.bonus_rate === 'number' && Number.isFinite(formula.bonus_rate) && formula.bonus_rate > 0
}
function validateWorkspace(data: FieldsData, farmId: string) {
  if (data.farm.id !== farmId) fail('Farm access did not match the selected farm.')
  if (!validUuid(data.farm.id) || !validUuid(data.farm.created_by) || !validName(data.farm.name, 160) || !validStamp(data.farm.created_at) || !validStamp(data.farm.updated_at)) fail('Farm data is malformed.')
  unique(data.entities.map((row) => row.id), 'Entities'); unique(data.fields.map((row) => row.id), 'Fields'); unique(data.crop_assignments.map((row) => row.id), 'Crop assignments'); unique(data.arrangements.map((row) => row.id), 'Arrangements'); unique(data.commodities.map((row) => row.id), 'Commodities')
  unique(data.entities.map((row) => row.name), 'Entity names'); unique(data.fields.map((row) => row.name), 'Field names'); unique(data.commodities.map((row) => row.name), 'Commodity names')
  const entities = new Set(data.entities.map((row) => row.id))
  const fields = new Map(data.fields.map((row) => [row.id, row]))
  const commodities = new Set(data.commodities.map((row) => row.id))
  if (data.entities.some((row) => row.farm_id !== farmId) || data.fields.some((row) => row.farm_id !== farmId || !entities.has(row.operating_entity_id)) || data.arrangements.some((row) => row.farm_id !== farmId || !fields.has(row.field_id)) || data.crop_assignments.some((row) => row.farm_id !== farmId || !fields.has(row.field_id) || !commodities.has(row.commodity_id))) fail('Farm data contains a record that does not belong to this farm.')
  if (data.entities.some((row) => !validUuid(row.id) || !validName(row.name, 160) || !validStamp(row.created_at) || !validStamp(row.updated_at))) fail('Entity data is malformed.')
  if (data.fields.some((row) => !validUuid(row.id) || !validUuid(row.operating_entity_id) || !validName(row.name, 160) || !validDecimal(row.total_acres, 8, 2) || row.total_acres <= 0 || row.total_acres > 5000 || row.state !== null && !validName(row.state, 50) || row.state !== null && row.state.trim().length < 2 || !validNullableDecimal(row.soil_productivity_index, 5, 3) || row.soil_productivity_index !== null && row.soil_productivity_index < 0 || !validNullableDecimal(row.latitude, 3, 6) || !validNullableDecimal(row.longitude, 3, 6) || !validStamp(row.created_at) || !validStamp(row.updated_at))) fail('Field data is malformed.')
  if (data.commodities.some((row) => !commodityId.test(row.id) || !validName(row.name, 100) || !validStamp(row.created_at) || !validStamp(row.updated_at))) fail('Commodity data is malformed.')
  if (data.crop_assignments.some((row) => !validUuid(row.id) || !Number.isInteger(row.crop_year) || row.crop_year < 1900 || row.crop_year > 2200 || !Number.isInteger(row.planting_sequence) || row.planting_sequence < 1 || row.planting_sequence > 32767 || !validDecimal(row.planted_acres, 8, 2) || row.planted_acres <= 0 || row.planted_acres > 5000 || row.planted_acres > fields.get(row.field_id)!.total_acres || !validDate(row.planting_date) || !validDate(row.harvest_date) || row.planting_date !== null && row.harvest_date !== null && row.harvest_date < row.planting_date || !validNullableDecimal(row.harvested_bushels, 14, 2) || row.harvested_bushels !== null && row.harvested_bushels < 0 || !validNullableDecimal(row.expected_yield_per_acre, 8, 4) || row.expected_yield_per_acre !== null && row.expected_yield_per_acre <= 0 || !validNullableDecimal(row.expected_price_per_bu, 6, 6) || row.expected_price_per_bu !== null && row.expected_price_per_bu < 0 || !validNullableDecimal(row.actual_price_per_bu, 6, 6) || row.actual_price_per_bu !== null && row.actual_price_per_bu < 0 || !validStamp(row.created_at) || !validStamp(row.updated_at))) fail('Crop assignment data is malformed.')
  if (data.arrangements.some((row) => {
    const owned = row.arrangement_type === 'owned' && row.cash_rent_per_acre === null && row.flex_bonus_formula === null && row.landlord_crop_pct === null
    const cash = row.arrangement_type === 'cash_rent' && row.cash_rent_per_acre !== null && row.flex_bonus_formula === null && row.landlord_crop_pct === null
    const flex = row.arrangement_type === 'flex_cash_rent' && row.cash_rent_per_acre !== null && validFlexFormula(row.flex_bonus_formula) && row.landlord_crop_pct === null
    const share = row.arrangement_type === 'crop_share' && row.cash_rent_per_acre === null && row.flex_bonus_formula === null && row.landlord_crop_pct !== null && row.landlord_crop_pct > 0 && row.landlord_crop_pct < 100
    return !validUuid(row.id) || !validDate(row.effective_from) || !validDate(row.effective_to) || row.effective_to !== null && row.effective_to < row.effective_from || !validNullableDecimal(row.cash_rent_per_acre, 10, 2) || row.cash_rent_per_acre !== null && row.cash_rent_per_acre < 0 || !validPercent(row.landlord_crop_pct) || shareKeys.some((key) => !validPercent(row[key])) || row.arrangement_type !== 'crop_share' && shareKeys.some((key) => row[key] !== 0) || !(owned || cash || flex || share) || !validStamp(row.created_at) || !validStamp(row.updated_at)
  })) fail('Arrangement data is malformed.')
  unique(data.crop_assignments.map((row) => `${row.field_id}|${row.crop_year}|${row.commodity_id}|${row.planting_sequence}`), 'Crop assignments')
  unique(data.arrangements.map((row) => `${row.field_id}|${row.effective_from}`), 'Arrangements')
  unique(data.arrangements.filter((row) => row.effective_to === null).map((row) => row.field_id), 'Current arrangements')
}

/** One canonical parser for live, retained-memory, IndexedDB, and nested Equipment snapshots. */
export function validateFieldsWorkspace(value: unknown, farmId: string): FieldsData {
  const rows = record(value, 'Fields workspace')
  const array = (key: string) => { const next = rows[key]; if (!Array.isArray(next)) fail(`Fields workspace ${key} is malformed.`); return next }
  const data: FieldsData = { farm: mapFarm(rows.farm), entities: array('entities').map(mapEntity), fields: array('fields').map(mapField), crop_assignments: array('crop_assignments').map(mapCropAssignment), arrangements: array('arrangements').map(mapArrangement), commodities: array('commodities').map(mapCommodity) }
  validateWorkspace(data, farmId)
  return data
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
function validDate(value: string | null): boolean { if (value === null) return true; if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false; const parsed = new Date(`${value}T00:00:00.000Z`); return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value }
const draftKeys = ['name', 'operating_entity_id', 'total_acres', 'county', 'state', 'legal_description', 'fsa_farm_number', 'fsa_tract_number', 'soil_productivity_index', 'arrangement', 'crop_assignments'] as const
const arrangementDraftKeys = ['arrangement_type', 'landlord_name', 'landlord_phone', 'landlord_contact_notes', 'effective_from', 'cash_rent_per_acre', 'flex_bonus_formula', 'landlord_crop_pct', ...shareKeys, 'notes'] as const
const cropDraftKeys = ['crop_year', 'commodity_id', 'planted_acres', 'planting_sequence', 'variety', 'planting_date', 'harvest_date', 'harvested_bushels', 'expected_yield_per_acre', 'expected_price_per_bu', 'notes'] as const
function assertExpectedVersions(value: FieldDraft['expected_versions'] | undefined) {
  if (value === undefined || value === null) return
  const versions = exactRecord(value, 'Field save version', ['field_updated_at', 'arrangement', 'crop_assignments'])
  assert(validStamp(String(versions.field_updated_at)), 'Field save version is malformed.')
  const arrangement = exactRecord(versions.arrangement, 'Arrangement save version', ['id', 'updated_at'])
  assert(validUuid(String(arrangement.id)) && validStamp(String(arrangement.updated_at)), 'Arrangement save version is malformed.')
  assert(Array.isArray(versions.crop_assignments), 'Crop save versions are malformed.')
  for (const value of versions.crop_assignments) { const crop = exactRecord(value, 'Crop save version', ['id', 'updated_at']); assert(validUuid(String(crop.id)) && validStamp(String(crop.updated_at)), 'Crop save version is malformed.') }
}
function canonicalFlexFormula(value: FlexBonusFormula | null): FlexBonusFormula | null {
  if (value === null) return null
  const formula = record(value, 'Flex rent formula')
  if (typeof formula.method === 'string') {
    exactRecord(formula, 'Flex rent formula', ['method'], ['base_rent_per_acre', 'rate_pct', 'trigger_revenue_per_acre', 'base_price_per_bu', 'base_yield_per_acre', 'min_rent_per_acre', 'max_rent_per_acre', 'price_source_note'])
    assertFlexFormulaDraft(value)
    return {
      method: formula.method as FlexMethod,
      base_rent_per_acre: formula.base_rent_per_acre as number | null | undefined ?? null,
      rate_pct: formula.rate_pct as number | null | undefined ?? null,
      trigger_revenue_per_acre: formula.trigger_revenue_per_acre as number | null | undefined ?? null,
      base_price_per_bu: formula.base_price_per_bu as number | null | undefined ?? null,
      base_yield_per_acre: formula.base_yield_per_acre as number | null | undefined ?? null,
      min_rent_per_acre: formula.min_rent_per_acre as number | null | undefined ?? null,
      max_rent_per_acre: formula.max_rent_per_acre as number | null | undefined ?? null,
      price_source_note: formula.price_source_note as string | null | undefined ?? null,
    }
  }
  exactRecord(formula, 'Flex rent formula', ['type', 'trigger', 'bonus_rate'])
  assertFlexFormulaDraft(value)
  return { type: formula.type as 'price' | 'yield' | 'revenue', trigger: formula.trigger as number, bonus_rate: formula.bonus_rate as number }
}

/** Normalizes one UI draft before a request or durable queue attempt. */
export function normalizeFieldDraft(draft: FieldDraft, createId: IdSource): NormalizedDraft {
  exactRecord(draft, 'Field draft', draftKeys, ['id', 'expected_versions'])
  exactRecord(draft.arrangement, 'Arrangement draft', arrangementDraftKeys, ['id'])
  assert(Array.isArray(draft.crop_assignments), 'Crop assignments are malformed.')
  assertExpectedVersions(draft.expected_versions)
  assert(draft.name.trim().length > 0 && draft.name.trim().length <= 160, 'Field name is required and must be 160 characters or fewer.')
  assert((draft.id === undefined || draft.id === '' || validUuid(draft.id)) && validUuid(draft.operating_entity_id), 'Field identity is malformed.')
  assert(validDecimal(draft.total_acres, 8, 2) && draft.total_acres > 0 && draft.total_acres <= 5000, 'Field acres must use no more than two decimal places and be no more than 5,000.')
  assert(draft.state === null || (draft.state.trim().length >= 2 && draft.state.trim().length <= 50), 'State must be 2 to 50 characters when provided.')
  assert(validNullableDecimal(draft.soil_productivity_index, 5, 3) && (draft.soil_productivity_index === null || draft.soil_productivity_index >= 0), 'Soil productivity index must be zero or greater with no more than three decimal places.')
  assert(arrangementTypes.has(draft.arrangement.arrangement_type), 'Unknown land arrangement type.')
  assert(validDate(draft.arrangement.effective_from), 'Arrangement effective date is invalid.')
  assert(validNullableDecimal(draft.arrangement.cash_rent_per_acre, 10, 2) && (draft.arrangement.cash_rent_per_acre === null || draft.arrangement.cash_rent_per_acre >= 0), 'Cash rent must be zero or greater with no more than two decimal places.')
  assert(validPercent(draft.arrangement.landlord_crop_pct), 'Landlord crop share must be between 0 and 100 with no more than two decimal places.')
  for (const key of shareKeys) assert(validPercent(draft.arrangement[key]), 'Landlord input percentages must be between 0 and 100 with no more than two decimal places.')
  const type = draft.arrangement.arrangement_type
  const flexFormula = canonicalFlexFormula(draft.arrangement.flex_bonus_formula)
  if (type !== 'crop_share') assert(shareKeys.every((key) => draft.arrangement[key] === 0), 'Only crop-share arrangements can include landlord input percentages.')
  if (type === 'owned') assert(draft.arrangement.cash_rent_per_acre === null && draft.arrangement.flex_bonus_formula === null && draft.arrangement.landlord_crop_pct === null, 'Owned ground cannot include rent or crop-share terms.')
  else if (type === 'cash_rent') assert(draft.arrangement.cash_rent_per_acre !== null && draft.arrangement.flex_bonus_formula === null && draft.arrangement.landlord_crop_pct === null, 'Cash rent requires a rent amount and cannot include flex or crop-share terms.')
  else if (type === 'flex_cash_rent') { assert(draft.arrangement.cash_rent_per_acre !== null && draft.arrangement.landlord_crop_pct === null, 'Flex rent requires a base rent and cannot include crop-share terms.'); assert(flexFormula !== null, 'Flex rent requires a bonus formula.') }
  else assert(draft.arrangement.cash_rent_per_acre === null && draft.arrangement.flex_bonus_formula === null && draft.arrangement.landlord_crop_pct !== null && draft.arrangement.landlord_crop_pct > 0 && draft.arrangement.landlord_crop_pct < 100, 'Crop share requires a landlord crop percentage between zero and 100 and cannot include cash rent.')
  const assignments = draft.crop_assignments.map((row) => {
    exactRecord(row, 'Crop assignment draft', cropDraftKeys, ['id', 'is_new'])
    assert(Number.isInteger(row.crop_year) && row.crop_year >= 1900 && row.crop_year <= 2200, 'Crop year must be between 1900 and 2200.')
    assert(commodityId.test(row.commodity_id) && (row.id === undefined || row.id === '' || validUuid(row.id)), 'Crop assignment identity is malformed.')
    assert(validDecimal(row.planted_acres, 8, 2) && row.planted_acres > 0 && row.planted_acres <= draft.total_acres, 'Each planted acreage must use no more than two decimal places and cannot exceed the field acres.')
    assert(Number.isInteger(row.planting_sequence) && row.planting_sequence > 0 && row.planting_sequence <= 32767, 'Planting sequence must be a positive whole number.')
    assert(validDate(row.planting_date) && validDate(row.harvest_date) && (row.planting_date === null || row.harvest_date === null || row.harvest_date >= row.planting_date), 'Crop dates are invalid or out of order.')
    assert(validNullableDecimal(row.harvested_bushels, 14, 2) && (row.harvested_bushels === null || row.harvested_bushels >= 0), 'Harvested bushels must be zero or greater with no more than two decimal places.')
    assert(validNullableDecimal(row.expected_yield_per_acre, 8, 4) && (row.expected_yield_per_acre === null || row.expected_yield_per_acre > 0), 'Expected yield must be greater than zero with no more than four decimal places when entered.')
    assert(validNullableDecimal(row.expected_price_per_bu, 6, 6) && (row.expected_price_per_bu === null || row.expected_price_per_bu >= 0), 'Expected price must be zero or greater with no more than six decimal places when entered.')
    const isNew = row.is_new ?? !row.id
    assert(typeof isNew === 'boolean', 'Crop record status is malformed.')
    return { id: row.id || createId(), is_new: isNew, crop_year: row.crop_year, commodity_id: row.commodity_id, planted_acres: row.planted_acres, planting_sequence: row.planting_sequence, variety: cleanText(row.variety), planting_date: row.planting_date, harvest_date: row.harvest_date, notes: cleanText(row.notes), harvested_bushels: row.harvested_bushels ?? null, expected_yield_per_acre: row.expected_yield_per_acre ?? null, expected_price_per_bu: row.expected_price_per_bu ?? null }
  })
  assert(new Set(assignments.map((row) => `${row.crop_year}|${row.commodity_id}|${row.planting_sequence}`)).size === assignments.length, 'Crop assignments must have unique crop, year, and planting sequence combinations.')
  const existingArrangementId = (draft.arrangement as FieldDraft['arrangement'] & { id?: string }).id
  assert(existingArrangementId === undefined || existingArrangementId === '' || validUuid(existingArrangementId), 'Arrangement identity is malformed.')
  return {
    ...(draft.expected_versions !== undefined ? { expected_versions: draft.expected_versions } : {}),
    id: draft.id || createId(), name: draft.name.trim(), operating_entity_id: draft.operating_entity_id, total_acres: draft.total_acres,
    county: cleanText(draft.county), state: cleanText(draft.state), legal_description: cleanText(draft.legal_description), fsa_farm_number: cleanText(draft.fsa_farm_number), fsa_tract_number: cleanText(draft.fsa_tract_number), soil_productivity_index: draft.soil_productivity_index,
    arrangement: {
      id: existingArrangementId || createId(), arrangement_type: draft.arrangement.arrangement_type, landlord_name: cleanText(draft.arrangement.landlord_name), landlord_phone: cleanText(draft.arrangement.landlord_phone), landlord_contact_notes: cleanText(draft.arrangement.landlord_contact_notes), effective_from: draft.arrangement.effective_from, cash_rent_per_acre: draft.arrangement.cash_rent_per_acre, flex_bonus_formula: flexFormula, landlord_crop_pct: draft.arrangement.landlord_crop_pct,
      landlord_seed_pct: draft.arrangement.landlord_seed_pct, landlord_fertilizer_pct: draft.arrangement.landlord_fertilizer_pct, landlord_chemical_pct: draft.arrangement.landlord_chemical_pct, landlord_fuel_pct: draft.arrangement.landlord_fuel_pct, landlord_labor_custom_pct: draft.arrangement.landlord_labor_custom_pct, landlord_crop_insurance_pct: draft.arrangement.landlord_crop_insurance_pct, landlord_equipment_pct: draft.arrangement.landlord_equipment_pct, landlord_interest_pct: draft.arrangement.landlord_interest_pct, landlord_other_input_pct: draft.arrangement.landlord_other_input_pct, notes: cleanText(draft.arrangement.notes),
    },
    crop_assignments: assignments,
  }
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonicalJson(entry)]))
  return value
}
function sameJson(left: unknown, right: unknown) { return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right)) }
function confirmSavedBundle(draft: NormalizedDraft, field: Field, arrangement: Arrangement, assignments: CropAssignment[], farmId: string) {
  const fieldKeys = ['id', 'name', 'operating_entity_id', 'total_acres', 'county', 'state', 'legal_description', 'fsa_farm_number', 'fsa_tract_number', 'soil_productivity_index'] as const
  const arrangementKeys = ['id', 'arrangement_type', 'landlord_name', 'landlord_phone', 'landlord_contact_notes', 'effective_from', 'cash_rent_per_acre', 'landlord_crop_pct', 'landlord_seed_pct', 'landlord_fertilizer_pct', 'landlord_chemical_pct', 'landlord_fuel_pct', 'landlord_labor_custom_pct', 'landlord_crop_insurance_pct', 'landlord_equipment_pct', 'landlord_interest_pct', 'landlord_other_input_pct', 'notes'] as const
  if (field.farm_id !== farmId || arrangement.farm_id !== farmId || arrangement.field_id !== field.id || arrangement.effective_to !== null || fieldKeys.some((key) => field[key] !== draft[key]) || arrangementKeys.some((key) => arrangement[key] !== draft.arrangement[key]) || !sameJson(arrangement.flex_bonus_formula, draft.arrangement.flex_bonus_formula) || assignments.length !== draft.crop_assignments.length) fail('Farm Rx could not confirm the field save. Please try again.')
  const savedById = new Map(assignments.map((row) => [row.id, row]))
  for (const expected of draft.crop_assignments) {
    const saved = savedById.get(expected.id)
    const keys = ['id', 'crop_year', 'commodity_id', 'planted_acres', 'planting_sequence', 'variety', 'planting_date', 'harvest_date', 'harvested_bushels', 'expected_yield_per_acre', 'expected_price_per_bu', 'notes'] as const
    if (!saved || saved.farm_id !== farmId || saved.field_id !== field.id || keys.some((key) => saved[key] !== expected[key]) || !validNullableDecimal(saved.actual_price_per_bu, 6, 6) || !validStamp(saved.created_at) || !validStamp(saved.updated_at)) fail('Farm Rx could not confirm the field save. Please try again.')
  }
  if (!validStamp(field.created_at) || !validStamp(field.updated_at) || !validStamp(arrangement.created_at) || !validStamp(arrangement.updated_at)) fail('Farm Rx could not confirm the field save. Please try again.')
}

export class SupabaseFieldsRepository implements FieldsRepository, FieldsOperationWriter {
  constructor(private readonly dependencies: { gateway: FieldsDataGateway; getFarmId: () => Promise<string>; getOperationContext: () => Promise<FarmOperationContext>; verifyOperationContext: (expected: FarmOperationContext) => Promise<void>; createId: IdSource; clock: Clock }) {}

  async getData(): Promise<FieldsData> {
    const farmId = await this.dependencies.getFarmId()
    const rows = await this.dependencies.gateway.loadWorkspace(farmId)
    return validateFieldsWorkspace(rows, farmId)
  }

  async getSnapshot(context: FarmOperationContext) {
    const rows = await this.dependencies.gateway.loadWorkspace(context.farmId)
    return { data: validateFieldsWorkspace(rows, context.farmId), source: 'live' as const, capturedAt: this.dependencies.clock() }
  }

  async saveField(draft: FieldDraft): Promise<Field> { return (await this.saveFieldOperation(draft, this.dependencies.createId(), await this.dependencies.getOperationContext())).field }

  async saveFieldOperation(draft: FieldDraft, operationId: string, context: FarmOperationContext): Promise<SavedFieldOperation> {
    const normalized = normalizeFieldDraft(draft, this.dependencies.createId)
    await this.dependencies.verifyOperationContext(context)
    const input: SaveFieldBundleInput = { farmId: context.farmId, operationId, draft: normalized }
    const saved = await this.dependencies.gateway.saveFieldBundle(input, context)
    await this.dependencies.verifyOperationContext(context)
    const field = mapField(saved.field)
    const arrangement = mapArrangement(saved.arrangement)
    const assignments = saved.cropAssignments.map(mapCropAssignment)
    confirmSavedBundle(normalized, field, arrangement, assignments, input.farmId)
    void this.dependencies.clock
    return { field, arrangement, cropAssignments: assignments }
  }
}
