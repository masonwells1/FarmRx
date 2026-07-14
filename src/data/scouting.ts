export type FarmViewerRole = 'owner' | 'manager' | 'worker' | 'read_only'
export type ScoutingCategory = 'weed' | 'disease' | 'insect' | 'other'

export interface ScoutingPhoto { id: string; farm_id: string; note_id: string; storage_path: string; created_by: string; created_at: string }
export interface ScoutingNote { id: string; farm_id: string; field_id: string; observed_on: string; category: ScoutingCategory; note: string | null; latitude: number | null; longitude: number | null; created_by: string; created_at: string; updated_at: string; photos: ScoutingPhoto[]; created_task_id?: string; pending?: boolean }
export interface ScoutingNoteDraft { id?: string; field_id: string; observed_on: string; category: ScoutingCategory; note: string; latitude: number | null; longitude: number | null; photos: Array<{ id?: string; storage_path: string }>; create_task: boolean }
export interface ScoutingData { notes: ScoutingNote[]; viewer: { user_id: string; role: FarmViewerRole } }
export interface ScoutingDeleteReceipt { id: string; deleted: true; storage_paths: string[]; pending?: boolean }
/** Audit P2-10: an offline delete succeeded on this device — it must never read as a failure. */
export const SCOUTING_OFFLINE_DELETE_MESSAGE = 'Deleted on this device. It will finish syncing when you reconnect.'
export interface ScoutingRepository { getData(fieldId?: string): Promise<ScoutingData>; saveNote(draft: ScoutingNoteDraft): Promise<ScoutingNote>; deleteNote(id: string, storagePaths?: string[]): Promise<ScoutingDeleteReceipt>; /** Audit P2-09: park photo paths whose bucket removal failed for durable retry. */ recordPhotoCleanup?(farmId: string, paths: string[]): void }

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isoDate = /^\d{4}-\d{2}-\d{2}$/
export const scoutingMaximumObservedOn = (now = new Date()) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString().slice(0, 10)
export function canEditScouting(role: FarmViewerRole) { return role === 'owner' || role === 'manager' || role === 'worker' }
export const normalizeScoutingCoordinate = (value: number | null) => value === null ? null : Math.round(value * 1_000_000) / 1_000_000
export function normalizeScoutingNoteDraft(draft: ScoutingNoteDraft): ScoutingNoteDraft { return { ...draft, latitude: normalizeScoutingCoordinate(draft.latitude), longitude: normalizeScoutingCoordinate(draft.longitude), photos: draft.photos.map((photo) => ({ ...photo })) } }
export function isScoutingPhotoPath(path: string, expected: { farmId: string; noteId: string; fieldId?: string }) {
  const segments = path.split('/')
  return segments.length === 4
    && segments[0] === expected.farmId
    && (expected.fieldId === undefined ? uuid.test(segments[1]) : segments[1] === expected.fieldId)
    && segments[2] === expected.noteId
    && !!segments[3]
    && segments[3] !== '.'
    && segments[3] !== '..'
}
export function validateScoutingNoteDraft(draft: ScoutingNoteDraft, now = new Date()): string | null {
  if (!uuid.test(draft.field_id) || (draft.id !== undefined && !uuid.test(draft.id))) return 'This scouting note is invalid. Please reopen the form and try again.'
  if (!['weed', 'disease', 'insect', 'other'].includes(draft.category)) return 'Choose a scouting category.'
  if (!isoDate.test(draft.observed_on) || Number.isNaN(Date.parse(`${draft.observed_on}T00:00:00Z`)) || draft.observed_on > scoutingMaximumObservedOn(now)) return 'Enter an observed date no more than one day in the future.'
  if (typeof draft.note !== 'string' || draft.note.length > 2000) return 'Notes cannot exceed 2,000 characters.'
  if (typeof draft.create_task !== 'boolean') return 'The follow-up task choice is invalid.'
  if (!draft.note.trim() && !draft.photos.length) return 'Add a note or at least one photo.'
  if ((draft.latitude === null) !== (draft.longitude === null) || (draft.latitude !== null && (!Number.isFinite(draft.latitude) || draft.latitude < -90 || draft.latitude > 90 || !Number.isFinite(draft.longitude!) || draft.longitude! < -180 || draft.longitude! > 180))) return 'Use a valid location or clear both coordinates.'
  if (!Array.isArray(draft.photos) || draft.photos.some((photo) => !photo || typeof photo.storage_path !== 'string' || !photo.storage_path || (photo.id !== undefined && !uuid.test(photo.id)))) return 'One of the selected photos is invalid.'
  return null
}
