export type FieldLogEntryType = 'rainfall' | 'note'
export type FarmViewerRole = 'owner' | 'manager' | 'worker' | 'read_only'

export interface FieldLogEntry {
  id: string
  farm_id: string
  field_id: string
  entry_type: FieldLogEntryType
  observed_on: string
  rainfall_in: number | null
  note: string | null
  created_by: string
  created_at: string
  updated_at: string
  /** Present only for a device-local write that is waiting to sync. */
  pending?: boolean
}

export interface FieldLogEntryDraft {
  id?: string
  field_id: string
  entry_type: FieldLogEntryType
  observed_on: string
  rainfall_in: number | null
  note: string | null
}

export interface FieldLogData {
  entries: FieldLogEntry[]
  viewer: { user_id: string; role: FarmViewerRole }
}

export interface FieldLogDeleteReceipt { id: string; deleted: true; pending?: boolean }
/** Audit P2-10: an offline delete succeeded on this device — it must never read as a failure. */
export const FIELD_LOG_OFFLINE_DELETE_MESSAGE = 'Deleted on this device. It will finish syncing when you reconnect.'

export interface FieldLogRepository {
  getData(fieldId?: string): Promise<FieldLogData>
  saveEntry(draft: FieldLogEntryDraft): Promise<FieldLogEntry>
  deleteEntry(id: string): Promise<FieldLogDeleteReceipt>
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isoDate = /^\d{4}-\d{2}-\d{2}$/

export function fieldLogMaximumObservedOn(now = new Date()) {
  const maximum = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1))
  return maximum.toISOString().slice(0, 10)
}

/** Returns a farmer-readable error when a draft cannot satisfy the database contract. */
export function validateFieldLogDraft(draft: FieldLogEntryDraft, now = new Date()): string | null {
  if (!uuid.test(draft.field_id) || (draft.id !== undefined && !uuid.test(draft.id))) return 'This field log entry is invalid. Please reopen the form and try again.'
  if (draft.entry_type !== 'rainfall' && draft.entry_type !== 'note') return 'Choose rainfall or a field note.'
  if (!isoDate.test(draft.observed_on) || Number.isNaN(Date.parse(`${draft.observed_on}T00:00:00Z`)) || new Date(`${draft.observed_on}T00:00:00Z`).toISOString().slice(0, 10) !== draft.observed_on) return 'Enter a valid observed date.'
  if (draft.observed_on > fieldLogMaximumObservedOn(now)) return 'The observed date cannot be more than one day in the future.'
  if (draft.note !== null && (typeof draft.note !== 'string' || !draft.note.trim())) return 'A note cannot be blank when provided.'
  if (draft.note !== null && draft.note.length > 500) return 'Notes cannot exceed 500 characters.'
  if (draft.entry_type === 'rainfall') {
    if (typeof draft.rainfall_in !== 'number' || !Number.isFinite(draft.rainfall_in) || draft.rainfall_in < 0 || draft.rainfall_in > 100) return 'Enter rainfall from 0 to 100 inches.'
  } else if (draft.rainfall_in !== null) return 'A field note cannot include rainfall.'
  else if (draft.note === null) return 'Enter a field note.'
  return null
}
