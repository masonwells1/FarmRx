import { isScoutingPhotoPath, validateScoutingNoteDraft, type ScoutingNoteDraft } from './scouting'
import type { StorageLike } from './writeQueue'
export type ScoutingQueueEntryV1 = { version: 1; module: 'scouting'; kind: 'saveNote'; operationId: string; userId: string; farmId: string; enqueuedAt: string; draft: ScoutingNoteDraft; uploadedPaths: string[] } | { version: 1; module: 'scouting'; kind: 'deleteNote'; operationId: string; userId: string; farmId: string; enqueuedAt: string; noteId: string; storagePaths: string[] }
export interface ScoutingQueueEnvelopeV1 { version: 1; entries: ScoutingQueueEntryV1[] }
const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const rec = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const exact = (v: Record<string, unknown>, keys: string[]) => Object.keys(v).length === keys.length && keys.every((key) => Object.hasOwn(v, key))
const paths = (value: unknown) => Array.isArray(value) && value.every((path) => typeof path === 'string') && new Set(value).size === value.length
function valid(v: unknown): v is ScoutingQueueEntryV1 {
  if (!rec(v) || v.version !== 1 || v.module !== 'scouting' || !['operationId', 'userId', 'farmId'].every((key) => typeof v[key] === 'string' && uuid.test(v[key])) || typeof v.enqueuedAt !== 'string' || Number.isNaN(Date.parse(v.enqueuedAt))) return false
  const base = ['version', 'module', 'kind', 'operationId', 'userId', 'farmId', 'enqueuedAt']
  if (v.kind === 'saveNote') {
    if (!exact(v, [...base, 'draft', 'uploadedPaths']) || !rec(v.draft) || typeof v.draft.id !== 'string' || !paths(v.uploadedPaths)) return false
    const draft = v.draft as unknown as ScoutingNoteDraft
    const knownPaths = new Set(draft.photos.map((photo) => photo.storage_path))
    return validateScoutingNoteDraft(draft) === null
      && draft.photos.every((photo) => isScoutingPhotoPath(photo.storage_path, { farmId: v.farmId as string, fieldId: draft.field_id, noteId: draft.id! }))
      && (v.uploadedPaths as string[]).every((path) => knownPaths.has(path) && isScoutingPhotoPath(path, { farmId: v.farmId as string, fieldId: draft.field_id, noteId: draft.id! }))
  }
  return v.kind === 'deleteNote'
    && exact(v, [...base, 'noteId', 'storagePaths'])
    && typeof v.noteId === 'string'
    && uuid.test(v.noteId)
    && paths(v.storagePaths)
    && (v.storagePaths as string[]).every((path) => isScoutingPhotoPath(path, { farmId: v.farmId as string, noteId: v.noteId as string }))
}
export function parseScoutingQueue(serialized: string): ScoutingQueueEnvelopeV1 { let parsed: unknown; try { parsed = JSON.parse(serialized) } catch { throw new Error(blocked) } if (!rec(parsed) || !exact(parsed, ['version', 'entries']) || parsed.version !== 1 || !Array.isArray(parsed.entries) || !parsed.entries.every(valid)) throw new Error(blocked); return parsed as unknown as ScoutingQueueEnvelopeV1 }
export class ScoutingWriteQueue { constructor(private readonly storage: StorageLike, readonly key: string) {} read() { const raw = this.storage.getItem(this.key); return raw === null ? { version: 1 as const, entries: [] } : parseScoutingQueue(raw) } private persist(next: ScoutingQueueEnvelopeV1) { const raw = JSON.stringify(next); parseScoutingQueue(raw); this.storage.setItem(this.key, raw); if (this.storage.getItem(this.key) !== raw) throw new Error('This scouting note could not be saved on this device. Keep this screen open and try again.') } append(entry: ScoutingQueueEntryV1) { const next = { version: 1 as const, entries: [...this.read().entries, entry] }; this.persist(next); return next } removeConfirmedHead(operationId: string) { const current = this.read(); if (current.entries[0]?.operationId !== operationId) throw new Error(blocked); const next = { version: 1 as const, entries: current.entries.slice(1) }; this.persist(next); return next } }
export const scoutingWriteQueueKey = (projectRef: string, userId: string, farmId: string) => `farm-rx-scouting-write-queue:v1:${projectRef}:${userId}:${farmId}`
