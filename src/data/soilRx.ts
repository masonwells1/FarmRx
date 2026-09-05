export const soilMeasurementKeys = [
  'ph', 'organic_matter_pct', 'cec_meq_100g', 'phosphorus_ppm', 'potassium_ppm',
  'calcium_ppm', 'magnesium_ppm', 'sulfur_ppm', 'base_saturation_calcium_pct',
  'base_saturation_magnesium_pct', 'base_saturation_potassium_pct',
  'base_saturation_sodium_pct', 'base_saturation_hydrogen_pct', 'boron_ppm',
  'chloride_ppm', 'copper_ppm', 'iron_ppm', 'manganese_ppm', 'molybdenum_ppm',
  'zinc_ppm',
] as const

export type SoilMeasurementKey = typeof soilMeasurementKeys[number]
export type SoilMeasurements = Record<SoilMeasurementKey, number | null>
export interface SoilTestDraft extends SoilMeasurements { id?: string; field_id: string; sample_date: string; lab_name: string }
export interface SoilTestAttachment { id: string; farm_id: string; field_id: string; test_id: string; storage_path: string; original_filename: string; mime_type: SoilReportMime; size_bytes: number; created_by: string; created_at: string }
export interface SoilTest extends SoilMeasurements { id: string; farm_id: string; field_id: string; sample_date: string; lab_name: string; created_by: string; created_at: string; updated_at: string; attachment: SoilTestAttachment | null; pending?: boolean }
export interface SoilRxData { tests: SoilTest[] }
/**
 * The device has no verified Soil Rx history yet, but a separate cached
 * Fields projection can still support a text-only offline save.
 */
export class SoilRxHistoryUnavailableOfflineError extends Error {
  constructor() {
    super('Connect to the internet once to load Soil Rx history on this device.')
    this.name = 'SoilRxHistoryUnavailableOfflineError'
  }
}
export type SoilReportMime = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/heic' | 'image/heif'
export interface SoilRxRepository {
  getData(fieldId?: string): Promise<SoilRxData>
  saveTest(draft: SoilTestDraft, report?: File): Promise<SoilTest>
  getReportUrl(storagePath: string): Promise<string>
  getNeedsAttentionQueueKey?(): Promise<string>
  retryNeedsAttention?(queueKey: string, operationId: string): Promise<void>
  dismissNeedsAttention?(queueKey: string, operationId: string): Promise<void>
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const date = /^\d{4}-\d{2}-\d{2}$/
const ranges: Record<SoilMeasurementKey, readonly [number, number]> = {
  ph: [0, 14], organic_matter_pct: [0, 100], cec_meq_100g: [0, 500],
  phosphorus_ppm: [0, 1_000_000], potassium_ppm: [0, 1_000_000], calcium_ppm: [0, 1_000_000],
  magnesium_ppm: [0, 1_000_000], sulfur_ppm: [0, 1_000_000],
  base_saturation_calcium_pct: [0, 100], base_saturation_magnesium_pct: [0, 100],
  base_saturation_potassium_pct: [0, 100], base_saturation_sodium_pct: [0, 100],
  base_saturation_hydrogen_pct: [0, 100], boron_ppm: [0, 1_000_000],
  chloride_ppm: [0, 1_000_000], copper_ppm: [0, 1_000_000], iron_ppm: [0, 1_000_000],
  manganese_ppm: [0, 1_000_000], molybdenum_ppm: [0, 1_000_000], zinc_ppm: [0, 1_000_000],
}
export const isSoilRxUuid = (value: unknown): value is string => typeof value === 'string' && uuid.test(value)
export const isSoilRxDate = (value: unknown): value is string => typeof value === 'string' && date.test(value) && value >= '1900-01-01' && value <= '2200-12-31' && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
export function normalizeSoilTestDraft(draft: SoilTestDraft): SoilTestDraft { const result = { ...draft, lab_name: draft.lab_name.trim() }; for (const key of soilMeasurementKeys) result[key] = draft[key] === null ? null : Number(draft[key]); return result }
export function validateSoilTestDraft(draft: SoilTestDraft): string | null {
  if (draft.id !== undefined && !isSoilRxUuid(draft.id) || !isSoilRxUuid(draft.field_id)) return 'This soil test is invalid. Reopen the form and try again.'
  if (!isSoilRxDate(draft.sample_date)) return 'Enter a valid sample date.'
  if (typeof draft.lab_name !== 'string' || draft.lab_name.trim().length < 1 || draft.lab_name.trim().length > 160) return 'Lab name is required and must be 160 characters or fewer.'
  for (const key of soilMeasurementKeys) { const value = draft[key]; const [minimum, maximum] = ranges[key]; if (value !== null && (!Number.isFinite(value) || value < minimum || value > maximum || Number(value.toFixed(3)) !== value)) return `The ${key.replaceAll('_', ' ')} measurement is invalid.` }
  return null
}
export function isSoilReportPath(path: string, expected: { farmId: string; fieldId: string; testId: string }) { const parts = path.split('/'); return parts.length === 4 && parts[0] === expected.farmId && parts[1] === expected.fieldId && parts[2] === expected.testId && !!parts[3] && parts[3] !== '.' && parts[3] !== '..' }
export function sortSoilTestsNewestFirst(tests: SoilTest[]) { return [...tests].sort((a, b) => b.sample_date.localeCompare(a.sample_date) || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id)) }
