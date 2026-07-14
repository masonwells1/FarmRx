import { QueuedScoutingRepository } from './QueuedScoutingRepository'
import type { ScoutingDataGateway } from './ScoutingDataGateway'
import { ScoutingWriteQueue, parseScoutingQueue, scoutingWriteQueueKey } from './scoutingWriteQueue'
import { canEditScouting, SupabaseScoutingRepository } from './SupabaseScoutingRepository'
import { normalizeScoutingCoordinate, type ScoutingNoteDraft } from './scouting'
import { uploadScoutingPhotos, validateScoutingPhotoFile } from './scoutingStorage'
import { readScoutingCleanupOutbox, scoutingCleanupOutboxKey } from './scoutingCleanupOutbox'
import type { StorageLike } from './writeQueue'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const farm = uid(1); const actor = uid(3); const field = uid(4); const otherField = uid(5); const stamp = '2026-07-12T12:30:00.123456+00:00'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => Promise<unknown>, message: string) { let failed = false; try { await action() } catch { failed = true } assert(failed, message) }
function memory(): StorageLike & { values: Map<string, string> } { const values = new Map<string, string>(); return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) } }
function draft(id = uid(10), photos = false, task = false): ScoutingNoteDraft { return { id, field_id: field, observed_on: '2026-07-10', category: 'weed', note: photos ? '' : 'Waterhemp by west edge', latitude: 39.123456789, longitude: -87.654321987, photos: photos ? [{ storage_path: `${farm}/${field}/${id}/photo.jpg` }] : [], create_task: task } }
function sqlNoteRow(value: ScoutingNoteDraft, farmId = farm) { return { id: value.id!, farm_id: farmId, field_id: value.field_id, observed_on: value.observed_on, category: value.category, note: value.note.trim() || null, latitude: normalizeScoutingCoordinate(value.latitude), longitude: normalizeScoutingCoordinate(value.longitude), created_by: actor, created_at: stamp, updated_at: stamp } }
function photoRows(value: ScoutingNoteDraft, farmId = farm) { return value.photos.map((photo, index) => ({ id: photo.id ?? uid(200 + index), farm_id: farmId, note_id: value.id!, storage_path: photo.storage_path, created_by: actor, created_at: stamp })) }

class FakeGateway implements ScoutingDataGateway {
  notes: unknown[] = []; photos: unknown[] = []; role: unknown = { role: 'worker' }; saves: Array<{ operationId: string; note: ScoutingNoteDraft }> = []; deletes: string[] = []; receipts = new Map<string, unknown>(); mutateSave: (value: unknown) => unknown = (value) => value; mutateDelete: (value: unknown) => unknown = (value) => value; saveFailure: Error | null = null; deleteFailure: Error | null = null; canWrite = true
  async loadNotes(farmId: string) { return structuredClone(this.notes.filter((note) => (note as { farm_id: string }).farm_id === farmId)) }
  async loadPhotos(farmId: string) { return structuredClone(this.photos.filter((photo) => (photo as { farm_id: string }).farm_id === farmId)) }
  async loadViewerRole() { return structuredClone(this.role) }
  async saveNote(input: { farmId: string; operationId: string; note: ScoutingNoteDraft }) {
    this.saves.push({ operationId: input.operationId, note: structuredClone(input.note) })
    if (!this.canWrite) throw new Error('permission denied')
    if (this.saveFailure) throw this.saveFailure
    const priorReceipt = this.receipts.get(input.operationId); if (priorReceipt) return structuredClone(priorReceipt)
    const row = sqlNoteRow(input.note, input.farmId); const existingIndex = this.notes.findIndex((note) => (note as { id: string }).id === input.note.id)
    if (existingIndex >= 0) this.notes[existingIndex] = row; else this.notes.push(row)
    this.photos = this.photos.filter((photo) => (photo as { farm_id: string; note_id: string }).farm_id !== input.farmId || (photo as { note_id: string }).note_id !== input.note.id)
    const inserted = photoRows(input.note, input.farmId); this.photos.push(...inserted)
    const result = { ...row, photos: inserted, ...(input.note.create_task ? { created_task_id: uid(99) } : {}) }
    this.receipts.set(input.operationId, result)
    return structuredClone(this.mutateSave(result))
  }
  async deleteNote(input: { farmId: string; noteId: string }) {
    this.deletes.push(input.noteId)
    if (!this.canWrite) throw new Error('permission denied')
    if (this.deleteFailure) throw this.deleteFailure
    const paths = this.photos.filter((photo) => (photo as { farm_id: string; note_id: string }).farm_id === input.farmId && (photo as { note_id: string }).note_id === input.noteId).map((photo) => (photo as { storage_path: string }).storage_path)
    this.notes = this.notes.filter((note) => (note as { farm_id: string; id: string }).farm_id !== input.farmId || (note as { id: string }).id !== input.noteId)
    this.photos = this.photos.filter((photo) => (photo as { farm_id: string; note_id: string }).farm_id !== input.farmId || (photo as { note_id: string }).note_id !== input.noteId)
    return structuredClone(this.mutateDelete({ id: input.noteId, deleted: true, storage_paths: paths }))
  }
}
function live(gateway: FakeGateway, farmId = farm) { let next = 100; return new SupabaseScoutingRepository({ gateway, getFarmId: async () => farmId, getUserId: async () => actor, createId: () => uid(next++) }) }

async function run() {
  // Group 1: SQL-faithful null notes and numeric(9,6) coordinates are accepted as canonical echoes.
  const gateway = new FakeGateway(); const repository = live(gateway); const photoOnly = await repository.saveNote(draft(uid(11), true, true)); const gps = await repository.saveNote(draft(uid(12)))
  assert(photoOnly.note === null && photoOnly.photos.length === 1 && photoOnly.created_task_id === uid(99), 'Photo-only SQL echoes must accept note:null.')
  assert(gps.latitude === 39.123457 && gps.longitude === -87.654322 && gateway.saves[1].note.latitude === 39.123457, 'GPS values must be rounded before RPC and accepted after SQL rounding.')

  // Group 2: malformed canonical replies and exact photo path segments fail closed before or after RPC.
  const wrong = new FakeGateway(); wrong.mutateSave = (value) => ({ ...(value as object), id: uid(70) }); await rejects(() => live(wrong).saveNote(draft()), 'A save reply with another note ID must fail closed.')
  const wrongDelete = new FakeGateway(); wrongDelete.mutateDelete = () => ({ id: uid(71), deleted: true, storage_paths: [] }); await rejects(() => live(wrongDelete).deleteNote(uid(10)), 'A delete reply with another note ID must fail closed.')
  await rejects(() => repository.saveNote({ ...draft(uid(13), true), photos: [{ storage_path: `${farm}/${field}/${uid(14)}/wrong-note.jpg` }] }), 'A path with another note ID must fail closed.')
  await rejects(() => repository.saveNote({ ...draft(uid(15), true), photos: [{ storage_path: `${farm}/${otherField}/${uid(15)}/wrong-field.jpg` }] }), 'A path with another field ID must fail closed.')
  await rejects(() => repository.saveNote({ ...draft(uid(16), true), photos: [{ storage_path: `${farm}/${field}/${uid(16)}/nested/extra.jpg` }] }), 'A path with extra segments must fail closed.')
  const malformedRead = new FakeGateway(); malformedRead.notes = [sqlNoteRow(draft(uid(17)))]; malformedRead.photos = [{ ...photoRows(draft(uid(17), true))[0], storage_path: `${farm}/${field}/${uid(17)}/nested/extra.jpg` }]; await rejects(() => live(malformedRead).getData(), 'A malformed stored path must fail closed during repository reads.')

  // Group 3: corrupted local envelopes, including legacy photo-less save envelopes, fail closed.
  await rejects(async () => { parseScoutingQueue('{bad json') }, 'Invalid JSON queues must fail closed.')
  await rejects(async () => { parseScoutingQueue(JSON.stringify({ version: 1, entries: [{ version: 1, module: 'scouting', kind: 'saveNote', operationId: uid(20), userId: actor, farmId: farm, enqueuedAt: stamp, draft: draft(uid(21), true) }] })) }, 'A queue missing durable uploaded-path metadata must fail closed.')

  // Group 4: an upload followed by a transport failure queues the same operation and replays its photo metadata.
  const transportGateway = new FakeGateway(); transportGateway.saveFailure = new TypeError('network timeout'); let transportOffline = false; let next = 300; const transportStore = memory(); const removedAfterTransport: string[][] = []
  const transportQueued = new QueuedScoutingRepository(live(transportGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: 'transport', storage: transportStore, createId: () => uid(next++), clock: () => stamp, isOffline: () => transportOffline, removeStoragePaths: async (paths: string[]) => { removedAfterTransport.push(paths); return paths } })
  const uploadedDraft = draft(uid(22), true); const pendingSave = await transportQueued.saveNote(uploadedDraft); const transportQueue = new ScoutingWriteQueue(transportStore, scoutingWriteQueueKey('transport', actor, farm)); const queuedSave = transportQueue.read().entries[0]
  assert(pendingSave.pending && queuedSave.kind === 'saveNote' && queuedSave.uploadedPaths[0] === uploadedDraft.photos[0].storage_path, 'Transport failures must retain uploaded photo path metadata.')
  transportGateway.saveFailure = null; await transportQueued.inspectAndReplay(); assert(transportQueue.read().entries.length === 0 && transportGateway.saves.every((call) => call.operationId === queuedSave.operationId) && transportGateway.photos.length === 1 && removedAfterTransport.length === 0, 'Replay must reuse the operation ID and keep the successfully uploaded photo attached.')

  // Group 5: a definite save failure removes only the newly uploaded paths and does not queue a bad RPC.
  const rejectedGateway = new FakeGateway(); rejectedGateway.saveFailure = new Error('validation failed'); const rejectedStore = memory(); const cleanedDefinite: string[][] = []
  const rejectedQueued = new QueuedScoutingRepository(live(rejectedGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: 'rejected', storage: rejectedStore, createId: () => uid(350), clock: () => stamp, isOffline: () => false, removeStoragePaths: async (paths: string[]) => { cleanedDefinite.push(paths); return paths } })
  await rejects(() => rejectedQueued.saveNote(draft(uid(23), true)), 'A definite RPC failure must be returned to the caller.')
  assert(cleanedDefinite.length === 1 && cleanedDefinite[0].length === 1 && new ScoutingWriteQueue(rejectedStore, scoutingWriteQueueKey('rejected', actor, farm)).read().entries.length === 0, 'Definite failures must clean uploaded paths instead of queueing an invalid save.')

  // Group 6: a partial upload rolls back the paths that did finish uploading.
  const partialCleanup: string[][] = []; let uploadAttempt = 0
  await rejects(() => uploadScoutingPhotos(farm, field, uid(24), [{ type: 'image/jpeg', size: 1 } as File, { type: 'image/jpeg', size: 1 } as File], async () => { uploadAttempt += 1; if (uploadAttempt === 2) throw new Error('upload failed'); return `${farm}/${field}/${uid(24)}/uploaded-${uploadAttempt}.jpg` }, async (paths: string[]) => { partialCleanup.push(paths); return paths }), 'A partial upload must surface its upload failure.')
  assert(partialCleanup.length === 1 && partialCleanup[0][0].endsWith('uploaded-1.jpg'), 'A partial upload must clean paths that already uploaded.')

  // Group 7 (audit P2-09): a failed photo removal after the DB delete parks the paths in the
  // durable cleanup outbox — the delete finishes, the queue never wedges, and the next replay
  // drains the outbox instead of re-running the delete RPC.
  const deleteGateway = new FakeGateway(); await live(deleteGateway).saveNote(draft(uid(25), true)); const deleteOffline = false; let failRemoval = true; const removedDeletes: string[][] = []; const deleteStore = memory()
  const deleteQueued = new QueuedScoutingRepository(live(deleteGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: 'delete', storage: deleteStore, createId: () => uid(400), clock: () => stamp, isOffline: () => deleteOffline, removeStoragePaths: async (paths: string[]) => { if (failRemoval) { failRemoval = false; throw new Error('storage timeout') } removedDeletes.push(paths); return paths } })
  const originalPath = `${farm}/${field}/${uid(25)}/photo.jpg`; const deleteReceipt = await deleteQueued.deleteNote(uid(25), [originalPath]); const deleteQueue = new ScoutingWriteQueue(deleteStore, scoutingWriteQueueKey('delete', actor, farm))
  const parkedCleanup = readScoutingCleanupOutbox(deleteStore, scoutingCleanupOutboxKey('delete'))
  assert(!deleteReceipt.pending && deleteReceipt.deleted && deleteQueue.read().entries.length === 0 && deleteGateway.photos.length === 0 && parkedCleanup.length === 1 && parkedCleanup[0].path === originalPath, 'A failed storage deletion must finish the delete and park the captured paths durably.')
  await deleteQueued.inspectAndReplay(); assert(deleteGateway.deletes.length === 1 && removedDeletes.length === 1 && removedDeletes[0][0] === originalPath && readScoutingCleanupOutbox(deleteStore, scoutingCleanupOutboxKey('delete')).length === 0, 'The next replay must drain the parked path without re-running the delete RPC.')

  // Group 8: client file checks reject unsupported MIME types and files larger than 20 MB before upload.
  assert(validateScoutingPhotoFile({ type: 'application/pdf', size: 1 }) === 'Choose a JPEG, PNG, WebP, HEIC, or HEIF photo.' && validateScoutingPhotoFile({ type: 'image/jpeg', size: 20 * 1024 * 1024 + 1 }) === 'Choose a photo smaller than 20 MB.' && validateScoutingPhotoFile({ type: 'image/heic', size: 1 }) === null, 'Client file validation must enforce the allowed image types and 20 MB limit.')

  // Group 9: the RPC boundary rejects read-only writers while worker reads and writes remain allowed.
  const readonly = new FakeGateway(); readonly.role = { role: 'read_only' }; readonly.canWrite = false; const readOnlyRepository = live(readonly); const readOnlyData = await readOnlyRepository.getData(); await rejects(() => readOnlyRepository.saveNote(draft(uid(26))), 'Read-only RPC writes must be rejected.')
  assert(readOnlyData.viewer.role === 'read_only' && !canEditScouting('read_only') && canEditScouting('worker') && (await repository.saveNote(draft(uid(27)))).id === uid(27), 'Workers must remain able to save while read-only users cannot.')
  console.log('SupabaseScoutingRepository regression passed (9 coverage groups)')
}
void run()
