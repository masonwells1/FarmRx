import type { FieldDraft } from './fields'

export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export type NormalizedQueueDraft = FieldDraft & { id: string; arrangement: FieldDraft['arrangement'] & { id: string }; crop_assignments: Array<FieldDraft['crop_assignments'][number] & { id: string; is_new: boolean }> }
export interface FieldsQueueEntryV1 { version: 1; module: 'fields'; kind: 'saveField'; operationId: string; userId: string; farmId: string; enqueuedAt: string; draft: NormalizedQueueDraft }
export interface FieldsQueueEnvelopeV1 { version: 1; entries: FieldsQueueEntryV1[] }

const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const date = /^\d{4}-\d{2}-\d{2}$/
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const isUuid = (value: unknown) => typeof value === 'string' && uuid.test(value)
const isDate = (value: unknown) => typeof value === 'string' && date.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`))
const nullableString = (value: unknown) => value === null || typeof value === 'string'
const nullableNumber = (value: unknown) => value === null || (typeof value === 'number' && Number.isFinite(value))
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)

function isArrangement(value: unknown): boolean {
  if (!isRecord(value)) return false
  const keys = ['id', 'arrangement_type', 'landlord_name', 'landlord_phone', 'landlord_contact_notes', 'effective_from', 'cash_rent_per_acre', 'flex_bonus_formula', 'landlord_crop_pct', 'landlord_seed_pct', 'landlord_fertilizer_pct', 'landlord_chemical_pct', 'landlord_fuel_pct', 'landlord_labor_custom_pct', 'landlord_crop_insurance_pct', 'landlord_equipment_pct', 'landlord_interest_pct', 'landlord_other_input_pct', 'notes']
  return exact(value, keys) && isUuid(value.id) && ['owned', 'cash_rent', 'flex_cash_rent', 'crop_share'].includes(String(value.arrangement_type)) && nullableString(value.landlord_name) && nullableString(value.landlord_phone) && nullableString(value.landlord_contact_notes) && isDate(value.effective_from) && nullableNumber(value.cash_rent_per_acre) && nullableNumber(value.landlord_crop_pct) && nullableString(value.notes) && ['landlord_seed_pct', 'landlord_fertilizer_pct', 'landlord_chemical_pct', 'landlord_fuel_pct', 'landlord_labor_custom_pct', 'landlord_crop_insurance_pct', 'landlord_equipment_pct', 'landlord_interest_pct', 'landlord_other_input_pct'].every((key) => finite(value[key])) && (value.flex_bonus_formula === null || (isRecord(value.flex_bonus_formula) && exact(value.flex_bonus_formula, ['type', 'trigger', 'bonus_rate']) && ['price', 'yield', 'revenue'].includes(String(value.flex_bonus_formula.type)) && finite(value.flex_bonus_formula.trigger) && finite(value.flex_bonus_formula.bonus_rate)))
}
function isCrop(value: unknown): boolean {
  if (!isRecord(value)) return false
  return exact(value, ['id', 'is_new', 'crop_year', 'commodity_id', 'planted_acres', 'planting_sequence', 'variety', 'planting_date', 'harvest_date', 'harvested_bushels', 'expected_yield_per_acre', 'expected_price_per_bu', 'notes']) && isUuid(value.id) && typeof value.is_new === 'boolean' && Number.isInteger(value.crop_year) && isUuid(value.commodity_id) && finite(value.planted_acres) && Number.isInteger(value.planting_sequence) && nullableString(value.variety) && (value.planting_date === null || isDate(value.planting_date)) && (value.harvest_date === null || isDate(value.harvest_date)) && nullableNumber(value.harvested_bushels) && nullableNumber(value.expected_yield_per_acre) && nullableNumber(value.expected_price_per_bu) && nullableString(value.notes)
}
function isDraft(value: unknown): value is NormalizedQueueDraft {
  if (!isRecord(value)) return false
  return exact(value, ['id', 'name', 'operating_entity_id', 'total_acres', 'county', 'state', 'legal_description', 'fsa_farm_number', 'fsa_tract_number', 'soil_productivity_index', 'arrangement', 'crop_assignments']) && isUuid(value.id) && typeof value.name === 'string' && isUuid(value.operating_entity_id) && finite(value.total_acres) && nullableString(value.county) && nullableString(value.state) && nullableString(value.legal_description) && nullableString(value.fsa_farm_number) && nullableString(value.fsa_tract_number) && nullableNumber(value.soil_productivity_index) && isArrangement(value.arrangement) && Array.isArray(value.crop_assignments) && value.crop_assignments.every(isCrop)
}
function isEntry(value: unknown): value is FieldsQueueEntryV1 { return isRecord(value) && exact(value, ['version', 'module', 'kind', 'operationId', 'userId', 'farmId', 'enqueuedAt', 'draft']) && value.version === 1 && value.module === 'fields' && value.kind === 'saveField' && isUuid(value.operationId) && isUuid(value.userId) && isUuid(value.farmId) && typeof value.enqueuedAt === 'string' && !Number.isNaN(Date.parse(value.enqueuedAt)) && isDraft(value.draft) }
export function parseFieldsQueue(serialized: string): FieldsQueueEnvelopeV1 { let parsed: unknown; try { parsed = JSON.parse(serialized) } catch { throw new Error(blocked) }; if (!isRecord(parsed) || !exact(parsed, ['version', 'entries']) || parsed.version !== 1 || !Array.isArray(parsed.entries) || !parsed.entries.every(isEntry)) throw new Error(blocked); return parsed as unknown as FieldsQueueEnvelopeV1 }

export class FieldsWriteQueue {
  constructor(private readonly storage: StorageLike, readonly key: string) {}
  read(): FieldsQueueEnvelopeV1 { const value = this.storage.getItem(this.key); return value === null ? { version: 1, entries: [] } : parseFieldsQueue(value) }
  private persist(next: FieldsQueueEnvelopeV1) { const serialized = JSON.stringify(next); this.storage.setItem(this.key, serialized); const readBack = this.storage.getItem(this.key); if (readBack !== serialized) throw new Error('This entry could not be saved on this device. Keep this screen open and try again.'); parseFieldsQueue(readBack) }
  append(entry: FieldsQueueEntryV1) { const current = this.read(); const next = { version: 1 as const, entries: [...current.entries, entry] }; this.persist(next); return next }
  removeConfirmedHead(operationId: string) { const current = this.read(); if (current.entries[0]?.operationId !== operationId) throw new Error(blocked); const next = { version: 1 as const, entries: current.entries.slice(1) }; this.persist(next); return next }
}
export function writeQueueKey(projectRef: string, userId: string, farmId: string) { return `farm-rx-write-queue:v1:${projectRef}:${userId}:${farmId}` }
