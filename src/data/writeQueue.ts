import type { FieldDraft } from './fields'
import { structuredFlexFormulaError } from './flexLeaseValidation'

export interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
export class FarmReplayContextChangedError extends Error {
  constructor(message: string) { super(message); this.name = 'FarmReplayContextChangedError' }
}
export function isFarmReplayContextChangedError(error: unknown): error is FarmReplayContextChangedError { return error instanceof FarmReplayContextChangedError }
/** Post-save replay is best effort. Context cancellation is expected when a
 * farmer switches farms or signs out, so consume that rejection instead of
 * leaking an unhandled promise rejection from a fire-and-forget launch. Every
 * replay entrypoint still surfaces ordinary failures through sync status. */
export function launchReplayInBackground(replay: () => Promise<unknown>): void {
  void replay().catch((error) => {
    if (!isFarmReplayContextChangedError(error) && typeof globalThis.reportError === 'function') globalThis.reportError(error)
  })
}
export type NormalizedQueueDraft = FieldDraft & { id: string; arrangement: FieldDraft['arrangement'] & { id: string }; crop_assignments: Array<FieldDraft['crop_assignments'][number] & { id: string; is_new: boolean }> }
export interface FieldsQueueEntryV1 { version: 1; module: 'fields'; kind: 'saveField'; operationId: string; userId: string; farmId: string; enqueuedAt: string; draft: NormalizedQueueDraft }
export interface FieldsQueueEnvelopeV1 { version: 1; entries: FieldsQueueEntryV1[] }

const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const commodityId = /^[a-z][a-z0-9_]*$/
const date = /^\d{4}-\d{2}-\d{2}$/
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const isUuid = (value: unknown) => typeof value === 'string' && uuid.test(value)
const isDate = (value: unknown) => { if (typeof value !== 'string' || !date.test(value)) return false; const parsed = new Date(`${value}T00:00:00.000Z`); return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value }
const nullableString = (value: unknown) => value === null || typeof value === 'string'
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
const timestamp = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value))
const decimal = (value: unknown, integerDigits: number, scale: number) => finite(value) && Math.abs(Number(value)) < 10 ** integerDigits && Number(Number(value).toFixed(scale)) === value
const nullableDecimal = (value: unknown, integerDigits: number, scale: number) => value === null || decimal(value, integerDigits, scale)
const percent = (value: unknown) => nullableDecimal(value, 3, 2) && (value === null || Number(value) >= 0 && Number(value) <= 100)

function isExpectedVersions(value: unknown): boolean {
  if (value === null) return true
  if (!isRecord(value) || !exact(value, ['field_updated_at', 'arrangement', 'crop_assignments']) || !timestamp(value.field_updated_at) || !isRecord(value.arrangement) || !exact(value.arrangement, ['id', 'updated_at']) || !isUuid(value.arrangement.id) || !timestamp(value.arrangement.updated_at) || !Array.isArray(value.crop_assignments)) return false
  return value.crop_assignments.every((item) => isRecord(item) && exact(item, ['id', 'updated_at']) && isUuid(item.id) && timestamp(item.updated_at))
}

const legacyFlexTypes = ['price', 'yield', 'revenue']
/** Accepts both saved flex_bonus_formula shapes (docs/flex-lease-research.md §3) so a queued
 * offline entry using the new structured schema round-trips through the write queue instead of
 * being rejected as corrupt. */
function isFlexFormula(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (typeof value.method === 'string') return exact(value, ['method', 'base_rent_per_acre', 'rate_pct', 'trigger_revenue_per_acre', 'base_price_per_bu', 'base_yield_per_acre', 'min_rent_per_acre', 'max_rent_per_acre', 'price_source_note']) && structuredFlexFormulaError(value) === null
  return exact(value, ['type', 'trigger', 'bonus_rate']) && legacyFlexTypes.includes(String(value.type)) && finite(value.trigger) && Number(value.trigger) >= 0 && finite(value.bonus_rate) && Number(value.bonus_rate) > 0
}
function isArrangement(value: unknown): boolean {
  if (!isRecord(value)) return false
  const keys = ['id', 'arrangement_type', 'landlord_name', 'landlord_phone', 'landlord_contact_notes', 'effective_from', 'cash_rent_per_acre', 'flex_bonus_formula', 'landlord_crop_pct', 'landlord_seed_pct', 'landlord_fertilizer_pct', 'landlord_chemical_pct', 'landlord_fuel_pct', 'landlord_labor_custom_pct', 'landlord_crop_insurance_pct', 'landlord_equipment_pct', 'landlord_interest_pct', 'landlord_other_input_pct', 'notes']
  if (!exact(value, keys) || !isUuid(value.id) || !['owned', 'cash_rent', 'flex_cash_rent', 'crop_share'].includes(String(value.arrangement_type)) || !nullableString(value.landlord_name) || !nullableString(value.landlord_phone) || !nullableString(value.landlord_contact_notes) || !isDate(value.effective_from) || !nullableDecimal(value.cash_rent_per_acre, 10, 2) || value.cash_rent_per_acre !== null && Number(value.cash_rent_per_acre) < 0 || !percent(value.landlord_crop_pct) || !nullableString(value.notes)) return false
  const shares = ['landlord_seed_pct', 'landlord_fertilizer_pct', 'landlord_chemical_pct', 'landlord_fuel_pct', 'landlord_labor_custom_pct', 'landlord_crop_insurance_pct', 'landlord_equipment_pct', 'landlord_interest_pct', 'landlord_other_input_pct']
  if (!shares.every((key) => percent(value[key]))) return false
  const type = value.arrangement_type
  if (type !== 'crop_share' && shares.some((key) => value[key] !== 0)) return false
  if (type === 'owned') return value.cash_rent_per_acre === null && value.flex_bonus_formula === null && value.landlord_crop_pct === null
  if (type === 'cash_rent') return value.cash_rent_per_acre !== null && value.flex_bonus_formula === null && value.landlord_crop_pct === null
  if (type === 'flex_cash_rent') return value.cash_rent_per_acre !== null && value.landlord_crop_pct === null && isFlexFormula(value.flex_bonus_formula)
  return value.cash_rent_per_acre === null && value.flex_bonus_formula === null && typeof value.landlord_crop_pct === 'number' && value.landlord_crop_pct > 0 && value.landlord_crop_pct < 100
}
function isCrop(value: unknown): boolean {
  if (!isRecord(value)) return false
  return exact(value, ['id', 'is_new', 'crop_year', 'commodity_id', 'planted_acres', 'planting_sequence', 'variety', 'planting_date', 'harvest_date', 'harvested_bushels', 'expected_yield_per_acre', 'expected_price_per_bu', 'notes']) && isUuid(value.id) && typeof value.is_new === 'boolean' && Number.isInteger(value.crop_year) && Number(value.crop_year) >= 1900 && Number(value.crop_year) <= 2200 && typeof value.commodity_id === 'string' && commodityId.test(value.commodity_id) && decimal(value.planted_acres, 8, 2) && Number(value.planted_acres) > 0 && Number(value.planted_acres) <= 5000 && Number.isInteger(value.planting_sequence) && Number(value.planting_sequence) > 0 && Number(value.planting_sequence) <= 32767 && nullableString(value.variety) && (value.planting_date === null || isDate(value.planting_date)) && (value.harvest_date === null || isDate(value.harvest_date)) && (value.planting_date === null || value.harvest_date === null || String(value.harvest_date) >= String(value.planting_date)) && nullableDecimal(value.harvested_bushels, 14, 2) && (value.harvested_bushels === null || Number(value.harvested_bushels) >= 0) && nullableDecimal(value.expected_yield_per_acre, 8, 4) && (value.expected_yield_per_acre === null || Number(value.expected_yield_per_acre) > 0) && nullableDecimal(value.expected_price_per_bu, 6, 6) && (value.expected_price_per_bu === null || Number(value.expected_price_per_bu) >= 0) && nullableString(value.notes)
}
function isDraft(value: unknown): value is NormalizedQueueDraft {
  if (!isRecord(value)) return false
  const legacyKeys = ['id', 'name', 'operating_entity_id', 'total_acres', 'county', 'state', 'legal_description', 'fsa_farm_number', 'fsa_tract_number', 'soil_productivity_index', 'arrangement', 'crop_assignments']
  const shape = exact(value, legacyKeys) || exact(value, [...legacyKeys, 'expected_versions'])
  if (!shape || Object.hasOwn(value, 'expected_versions') && !isExpectedVersions(value.expected_versions) || !isUuid(value.id) || typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 160 || !isUuid(value.operating_entity_id) || !decimal(value.total_acres, 8, 2) || Number(value.total_acres) <= 0 || Number(value.total_acres) > 5000 || !nullableString(value.county) || !nullableString(value.state) || value.state !== null && (value.state.trim().length < 2 || value.state.trim().length > 50) || !nullableString(value.legal_description) || !nullableString(value.fsa_farm_number) || !nullableString(value.fsa_tract_number) || !nullableDecimal(value.soil_productivity_index, 5, 3) || value.soil_productivity_index !== null && Number(value.soil_productivity_index) < 0 || !isArrangement(value.arrangement) || !Array.isArray(value.crop_assignments) || !value.crop_assignments.every(isCrop)) return false
  if (value.crop_assignments.some((row) => Number((row as Record<string, unknown>).planted_acres) > Number(value.total_acres))) return false
  const cropKeys = value.crop_assignments.map((row) => { const crop = row as Record<string, unknown>; return `${crop.crop_year}|${crop.commodity_id}|${crop.planting_sequence}` })
  return new Set(cropKeys).size === cropKeys.length
}
function isEntry(value: unknown): value is FieldsQueueEntryV1 { return isRecord(value) && exact(value, ['version', 'module', 'kind', 'operationId', 'userId', 'farmId', 'enqueuedAt', 'draft']) && value.version === 1 && value.module === 'fields' && value.kind === 'saveField' && isUuid(value.operationId) && isUuid(value.userId) && isUuid(value.farmId) && typeof value.enqueuedAt === 'string' && !Number.isNaN(Date.parse(value.enqueuedAt)) && isDraft(value.draft) }
export function parseFieldsQueue(serialized: string): FieldsQueueEnvelopeV1 { let parsed: unknown; try { parsed = JSON.parse(serialized) } catch { throw new Error(blocked) }; if (!isRecord(parsed) || !exact(parsed, ['version', 'entries']) || parsed.version !== 1 || !Array.isArray(parsed.entries) || !parsed.entries.every(isEntry)) throw new Error(blocked); return parsed as unknown as FieldsQueueEnvelopeV1 }

export class FieldsWriteQueue {
  constructor(private readonly storage: StorageLike, readonly key: string) {}
  read(): FieldsQueueEnvelopeV1 { const value = this.storage.getItem(this.key); return value === null ? { version: 1, entries: [] } : parseFieldsQueue(value) }
  private persist(next: FieldsQueueEnvelopeV1) { const serialized = JSON.stringify(next); parseFieldsQueue(serialized); this.storage.setItem(this.key, serialized); const readBack = this.storage.getItem(this.key); if (readBack !== serialized) throw new Error('This entry could not be saved on this device. Keep this screen open and try again.'); parseFieldsQueue(readBack) }
  append(entry: FieldsQueueEntryV1) { parseFieldsQueue(JSON.stringify({ version: 1, entries: [entry] })); const current = this.read(); const next = { version: 1 as const, entries: [...current.entries, entry] }; this.persist(next); return next }
  removeConfirmedHead(operationId: string) { const current = this.read(); if (current.entries[0]?.operationId !== operationId) throw new Error(blocked); const next = { version: 1 as const, entries: current.entries.slice(1) }; this.persist(next); return next }
}
export function writeQueueKey(projectRef: string, userId: string, farmId: string) { return `farm-rx-write-queue:v1:${projectRef}:${userId}:${farmId}` }
