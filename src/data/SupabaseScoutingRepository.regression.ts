import { QueuedScoutingRepository } from './QueuedScoutingRepository'
import type { ScoutingDataGateway } from './ScoutingDataGateway'
import { ScoutingWriteQueue, parseScoutingQueue, scoutingWriteQueueKey } from './scoutingWriteQueue'
import { canEditScouting, SupabaseScoutingRepository } from './SupabaseScoutingRepository'
import { normalizeScoutingCoordinate, type ScoutingNoteDraft } from './scouting'
import { uploadScoutingPhotos, validateScoutingPhotoFile } from './scoutingStorage'
import { readScoutingCleanupOutbox, scoutingCleanupOutboxKey } from './scoutingCleanupOutbox'
import { resetFarmGrantFromLive } from './farmRevocationFence'
import type { StorageLike } from './writeQueue'
import { appendNeedsAttention, readNeedsAttention } from './needsAttentionStore'
import { getSaveReceipt } from '../lib/saveReceipt'
import { getSyncStatus } from './syncStatus'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const farm = uid(1); const actor = uid(3); const field = uid(4); const otherField = uid(5); const stamp = '2026-07-12T12:30:00.123456+00:00'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => Promise<unknown>, message: string) { let failed = false; try { await action() } catch { failed = true } assert(failed, message) }
function memory(): StorageLike & { values: Map<string, string> } { const values = new Map<string, string>(); return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) } }
function memoryWithQueueWriteFailure() { const values = new Map<string, string>(); let rejectedQueueKey: string | null = null; return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { if (key !== rejectedQueueKey) values.set(key, value) }, removeItem: (key: string) => values.delete(key), rejectWritesTo: (key: string | null) => { rejectedQueueKey = key } } }
function draft(id = uid(10), photos = false, task = false): ScoutingNoteDraft { return { id, field_id: field, observed_on: '2026-07-10', category: 'weed', note: photos ? '' : 'Waterhemp by west edge', latitude: 39.123456789, longitude: -87.654321987, photos: photos ? [{ storage_path: `${farm}/${field}/${id}/photo.jpg` }] : [], create_task: task } }
function sqlNoteRow(value: ScoutingNoteDraft, farmId = farm) { return { id: value.id!, farm_id: farmId, field_id: value.field_id, observed_on: value.observed_on, category: value.category, note: value.note.trim() || null, latitude: normalizeScoutingCoordinate(value.latitude), longitude: normalizeScoutingCoordinate(value.longitude), created_by: actor, created_at: stamp, updated_at: stamp } }
function photoRows(value: ScoutingNoteDraft, farmId = farm) { return value.photos.map((photo, index) => ({ id: photo.id ?? uid(200 + index), farm_id: farmId, note_id: value.id!, storage_path: photo.storage_path, created_by: actor, created_at: stamp })) }

class FakeGateway implements ScoutingDataGateway {
  notes: unknown[] = []; photos: unknown[] = []; role: unknown = { role: 'worker' }; saves: Array<{ operationId: string; note: ScoutingNoteDraft }> = []; deletes: string[] = []; receipts = new Map<string, unknown>(); mutateSave: (value: unknown) => unknown = (value) => value; mutateDelete: (value: unknown) => unknown = (value) => value; saveFailure: Error | null = null; deleteFailure: Error | null = null; canWrite = true; beforeSave: (() => Promise<void>) | null = null
  async loadNotes(farmId: string) { return structuredClone(this.notes.filter((note) => (note as { farm_id: string }).farm_id === farmId)) }
  async loadPhotos(farmId: string) { return structuredClone(this.photos.filter((photo) => (photo as { farm_id: string }).farm_id === farmId)) }
  async loadViewerRole() { return structuredClone(this.role) }
  async saveNote(input: { farmId: string; operationId: string; note: ScoutingNoteDraft }) {
    this.saves.push({ operationId: input.operationId, note: structuredClone(input.note) })
    if (this.beforeSave) await this.beforeSave()
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
function live(gateway: FakeGateway, farmId = farm) { let next = 100; const operationContext = { projectRef: 'test', userId: actor, farmId, generation: 1, token: uid(900), serverEpoch: 1 }; return new SupabaseScoutingRepository({ gateway, getFarmId: async () => farmId, getUserId: async () => actor, getOperationContext: async () => operationContext, verifyOperationContext: async () => undefined, createId: () => uid(next++) }) }

async function run() {
  // Group 1: the connected save receipt is keyed to the scouting note, including its in-flight state.
  const connectedGateway = new FakeGateway(); let releaseConnected!: () => void; let beganConnected!: () => void
  const connectedGate = new Promise<void>((resolve) => { releaseConnected = resolve }); const connectedBegan = new Promise<void>((resolve) => { beganConnected = resolve })
  connectedGateway.beforeSave = async () => { beganConnected(); await connectedGate }
  const connectedQueued = new QueuedScoutingRepository(live(connectedGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: 'connected-receipt', storage: memory(), createId: () => uid(250), clock: () => stamp, isOffline: () => false })
  const connectedDraft = draft(uid(249)); const connectedSave = connectedQueued.saveNote(connectedDraft)
  await connectedBegan; assert(getSaveReceipt(connectedDraft.id!) === 'saving', 'A connected scouting save must publish Saving for the note ID before the repository reply.')
  releaseConnected(); const connectedResult = await connectedSave; assert(getSaveReceipt(connectedDraft.id!) === 'saved' && connectedResult.created_task_id === undefined, 'A connected scouting save must publish Saved for the same note ID without creating a task when the checkbox is off.')

  // Group 2: SQL-faithful null notes and numeric(9,6) coordinates are accepted as canonical echoes.
  const gateway = new FakeGateway(); const repository = live(gateway); const photoOnly = await repository.saveNote(draft(uid(11), true, true)); const gps = await repository.saveNote(draft(uid(12)))
  assert(photoOnly.note === null && photoOnly.photos.length === 1 && photoOnly.created_task_id === uid(99), 'Photo-only SQL echoes must accept note:null.')
  assert(gps.latitude === 39.123457 && gps.longitude === -87.654322 && gateway.saves[1].note.latitude === 39.123457, 'GPS values must be rounded before RPC and accepted after SQL rounding.')

  // Group 3: malformed canonical replies and exact photo path segments fail closed before or after RPC.
  const wrong = new FakeGateway(); wrong.mutateSave = (value) => ({ ...(value as object), id: uid(70) }); await rejects(() => live(wrong).saveNote(draft()), 'A save reply with another note ID must fail closed.')
  const wrongDelete = new FakeGateway(); wrongDelete.mutateDelete = () => ({ id: uid(71), deleted: true, storage_paths: [] }); await rejects(() => live(wrongDelete).deleteNote(uid(10)), 'A delete reply with another note ID must fail closed.')
  await rejects(() => repository.saveNote({ ...draft(uid(13), true), photos: [{ storage_path: `${farm}/${field}/${uid(14)}/wrong-note.jpg` }] }), 'A path with another note ID must fail closed.')
  await rejects(() => repository.saveNote({ ...draft(uid(15), true), photos: [{ storage_path: `${farm}/${otherField}/${uid(15)}/wrong-field.jpg` }] }), 'A path with another field ID must fail closed.')
  await rejects(() => repository.saveNote({ ...draft(uid(16), true), photos: [{ storage_path: `${farm}/${field}/${uid(16)}/nested/extra.jpg` }] }), 'A path with extra segments must fail closed.')
  const malformedRead = new FakeGateway(); malformedRead.notes = [sqlNoteRow(draft(uid(17)))]; malformedRead.photos = [{ ...photoRows(draft(uid(17), true))[0], storage_path: `${farm}/${field}/${uid(17)}/nested/extra.jpg` }]; await rejects(() => live(malformedRead).getData(), 'A malformed stored path must fail closed during repository reads.')

  // Group 4: corrupted local envelopes, including legacy photo-less save envelopes, fail closed.
  await rejects(async () => { parseScoutingQueue('{bad json') }, 'Invalid JSON queues must fail closed.')
  await rejects(async () => { parseScoutingQueue(JSON.stringify({ version: 1, entries: [{ version: 1, module: 'scouting', kind: 'saveNote', operationId: uid(20), userId: actor, farmId: farm, enqueuedAt: stamp, draft: draft(uid(21), true) }] })) }, 'A queue missing durable uploaded-path metadata must fail closed.')

  // Group 5: an upload followed by a transport failure queues the same operation and replays its photo metadata.
  const transportGateway = new FakeGateway(); transportGateway.saveFailure = new TypeError('network timeout'); let transportOffline = false; let next = 300; const transportStore = memory(); const removedAfterTransport: string[][] = []
  const transportQueued = new QueuedScoutingRepository(live(transportGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: 'transport', storage: transportStore, createId: () => uid(next++), clock: () => stamp, isOffline: () => transportOffline, uploadPhoto: async (_farmId, _fieldId, noteId) => `${farm}/${field}/${noteId}/uploaded.jpg`, removeStoragePaths: async (paths: string[]) => { removedAfterTransport.push(paths); return paths } })
  const uploadedDraft = draft(uid(22)); const pendingSave = await transportQueued.saveNote(uploadedDraft, [{ type: 'image/jpeg', size: 1, name: 'field.jpg' } as File]); const transportQueue = new ScoutingWriteQueue(transportStore, scoutingWriteQueueKey('transport', actor, farm)); const queuedSave = transportQueue.read().entries[0]
  assert(pendingSave.pending && queuedSave.kind === 'saveNote' && queuedSave.uploadedPaths[0] === `${farm}/${field}/${uid(22)}/uploaded.jpg` && getSaveReceipt(uploadedDraft.id!) === 'queued offline', 'Transport failures must retain uploaded photo metadata and publish Queued offline for that note.')
  transportGateway.saveFailure = null; await transportQueued.inspectAndReplay(); assert(transportQueue.read().entries.length === 0 && transportGateway.saves.every((call) => call.operationId === queuedSave.operationId) && transportGateway.photos.length === 1 && removedAfterTransport.length === 0 && getSaveReceipt(uploadedDraft.id!) === 'saved', 'Replay must reuse the operation ID, keep the successfully uploaded photo attached, and publish Saved for that note.')

  // Group 6: a replay-time terminal failure parks the exact note for retry and retains its uploaded photo path.
  const parkedGateway = new FakeGateway(); parkedGateway.saveFailure = new TypeError('network timeout'); let parkedNext = 360; const parkedStore = memory(); const parkedRemoved: string[][] = []
  const parkedQueued = new QueuedScoutingRepository(live(parkedGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: 'parked', storage: parkedStore, createId: () => uid(parkedNext++), clock: () => stamp, isOffline: () => false, uploadPhoto: async (_farmId, _fieldId, noteId) => `${farm}/${field}/${noteId}/uploaded.jpg`, removeStoragePaths: async (paths: string[]) => { parkedRemoved.push(paths); return paths } })
  const parkedDraft = draft(uid(230)); await parkedQueued.saveNote(parkedDraft, [{ type: 'image/jpeg', size: 1, name: 'field.jpg' } as File]); const parkedQueue = new ScoutingWriteQueue(parkedStore, scoutingWriteQueueKey('parked', actor, farm))
  parkedGateway.saveFailure = new Error('validation failed'); await parkedQueued.inspectAndReplay(); const parked = readNeedsAttention(parkedStore, parkedQueue.key)[0]
  assert(parkedQueue.read().entries.length === 0 && parked?.id && parked.entry && (parked.entry as { kind?: string; draft?: ScoutingNoteDraft; uploadedPaths?: string[] }).kind === 'saveNote' && (parked.entry as { draft: ScoutingNoteDraft }).draft.id === parkedDraft.id && (parked.entry as { uploadedPaths: string[] }).uploadedPaths[0] === `${farm}/${field}/${uid(230)}/uploaded.jpg` && parkedRemoved.length === 0 && getSaveReceipt(parkedDraft.id!) === 'needs attention', 'A replay-time terminal failure must park the exact scouting note, preserve retryable uploaded paths, and publish Needs attention.')
  parkedGateway.saveFailure = null; await parkedQueued.retryNeedsAttention(parkedQueue.key, parked.id)
  assert(parkedQueue.read().entries.length === 0 && readNeedsAttention(parkedStore, parkedQueue.key).length === 0 && getSaveReceipt(parkedDraft.id!) === 'saved', 'Retrying a parked scouting note must replay its original entity and return its receipt to Saved.')
  appendNeedsAttention(parkedStore, parkedQueue.key, { id: parked.id, module: 'scouting', createdAt: stamp, message: 'This save needs attention before it can be retried.', entry: parked.entry }); await parkedQueued.dismissNeedsAttention(parkedQueue.key, parked.id)
  assert(parkedRemoved.some((paths) => paths[0] === `${farm}/${field}/${uid(230)}/uploaded.jpg`), 'Dismissing a parked scouting note must return its uploaded photo path to the guarded cleanup flow.')

  // Group 7: a same-operation retry must not replace the rendered parked payload with a different active entry.
  const mismatchEntry = { ...(parked.entry as { draft: ScoutingNoteDraft }), draft: { ...(parked.entry as { draft: ScoutingNoteDraft }).draft, category: 'disease' as const } }
  parkedQueue.append(mismatchEntry as never); appendNeedsAttention(parkedStore, parkedQueue.key, { id: parked.id, module: 'scouting', createdAt: stamp, message: 'This save needs attention before it can be retried.', entry: parked.entry }); const mismatchQueueBytes = parkedStore.getItem(parkedQueue.key); const mismatchAttentionBytes = parkedStore.getItem(`${parkedQueue.key}:needs-attention`); const cleanupBeforeMismatch = parkedRemoved.length
  await rejects(() => parkedQueued.retryNeedsAttention(parkedQueue.key, parked.id), 'A same-operation retry with different payloads must fail closed.')
  assert(parkedStore.getItem(parkedQueue.key) === mismatchQueueBytes && parkedStore.getItem(`${parkedQueue.key}:needs-attention`) === mismatchAttentionBytes && parkedRemoved.length === cleanupBeforeMismatch, 'A mismatched active operation must leave the parked record, active queue, and photo custody unchanged.')

  // Group 8: after a remote confirmation, failure to persist the queue-head removal keeps the exact entry for idempotent replay.
  const persistenceGateway = new FakeGateway(); const persistenceStore = memoryWithQueueWriteFailure(); const persistenceRemoved: string[][] = []
  const persistenceQueued = new QueuedScoutingRepository(live(persistenceGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: 'persist-after-remote', storage: persistenceStore, createId: (() => { let n = 380; return () => uid(n++) })(), clock: () => stamp, isOffline: () => false, removeStoragePaths: async (paths: string[]) => { persistenceRemoved.push(paths); return paths } })
  resetFarmGrantFromLive(persistenceStore, { projectRef: 'persist-after-remote', userId: actor, farmId: farm }, 1, stamp); const persistenceQueue = new ScoutingWriteQueue(persistenceStore, scoutingWriteQueueKey('persist-after-remote', actor, farm))
  const persistenceDraft = draft(uid(382), true); const persistenceEntry = { version: 1 as const, module: 'scouting' as const, kind: 'saveNote' as const, operationId: uid(383), userId: actor, farmId: farm, enqueuedAt: stamp, draft: persistenceDraft, uploadedPaths: [persistenceDraft.photos[0]!.storage_path] }; persistenceQueue.append(persistenceEntry); const persistenceBytes = persistenceStore.getItem(persistenceQueue.key); persistenceStore.rejectWritesTo(persistenceQueue.key)
  await persistenceQueued.inspectAndReplay()
  assert(persistenceGateway.notes.length === 1 && persistenceGateway.receipts.size === 1 && persistenceStore.getItem(persistenceQueue.key) === persistenceBytes && readNeedsAttention(persistenceStore, persistenceQueue.key).length === 0 && persistenceRemoved.length === 0 && getSyncStatus().kind === 'blocked' && getSyncStatus().pending === 1, 'A confirmed remote note followed by local queue persistence failure must retain the exact queue payload without parking or cleaning it.')
  persistenceStore.rejectWritesTo(null); await persistenceQueued.inspectAndReplay()
  const persistenceCalls = persistenceGateway.saves.filter((call) => call.operationId === persistenceEntry.operationId)
  assert(persistenceQueue.read().entries.length === 0 && persistenceGateway.notes.length === 1 && persistenceGateway.receipts.size === 1 && persistenceCalls.length === 2 && persistenceCalls.every((call) => call.operationId === persistenceEntry.operationId), 'The retained queue entry must later replay its immutable receipt and remove without duplicating the scouting row.')

  // Group 9: account switches and regrants cannot mutate a rendered old queue or its photo custody.
  const guardedStore = memory(); let guardedActive = { userId: actor, farmId: farm }; const guardedGateway = new FakeGateway(); const guardedRemoved: string[][] = []
  const guardedQueued = new QueuedScoutingRepository(live(guardedGateway), { getContext: async () => guardedActive, projectRef: 'guarded-needs-attention', storage: guardedStore, createId: (() => { let n = 390; return () => uid(n++) })(), clock: () => stamp, isOffline: () => false, removeStoragePaths: async (paths: string[]) => { guardedRemoved.push(paths); return paths } })
  const guardedQueue = new ScoutingWriteQueue(guardedStore, scoutingWriteQueueKey('guarded-needs-attention', actor, farm)); const guardedDraft = draft(uid(391), true); const guardedEntry = { version: 1 as const, module: 'scouting' as const, kind: 'saveNote' as const, operationId: uid(392), userId: actor, farmId: farm, enqueuedAt: stamp, draft: guardedDraft, uploadedPaths: [guardedDraft.photos[0]!.storage_path] }; guardedQueue.append(guardedEntry); guardedQueue.removeConfirmedHead(guardedEntry.operationId); appendNeedsAttention(guardedStore, guardedQueue.key, { id: guardedEntry.operationId, module: 'scouting', createdAt: stamp, message: 'This save needs attention before it can be retried.', entry: guardedEntry }); const guardedQueueBytes = guardedStore.getItem(guardedQueue.key); const guardedAttentionBytes = guardedStore.getItem(`${guardedQueue.key}:needs-attention`)
  guardedActive = { userId: uid(393), farmId: uid(394) }; await rejects(() => guardedQueued.retryNeedsAttention(guardedQueue.key, guardedEntry.operationId), 'A switched account or farm must not retry a rendered old scouting record.'); await rejects(() => guardedQueued.dismissNeedsAttention(guardedQueue.key, guardedEntry.operationId), 'A switched account or farm must not dismiss a rendered old scouting record.')
  assert(guardedStore.getItem(guardedQueue.key) === guardedQueueBytes && guardedStore.getItem(`${guardedQueue.key}:needs-attention`) === guardedAttentionBytes && guardedRemoved.length === 0 && guardedGateway.saves.length === 0, 'A switched account or farm must leave old queued work, needs-attention custody, and photos byte-stable.')

  const needsRegrantStore = memory(); const needsRegrantQueue = new ScoutingWriteQueue(needsRegrantStore, scoutingWriteQueueKey('regrant-needs-attention', actor, farm)); const needsRegrantDraft = draft(uid(395), true); const needsRegrantEntry = { version: 1 as const, module: 'scouting' as const, kind: 'saveNote' as const, operationId: uid(396), userId: actor, farmId: farm, enqueuedAt: stamp, draft: needsRegrantDraft, uploadedPaths: [needsRegrantDraft.photos[0]!.storage_path] }; needsRegrantQueue.append(needsRegrantEntry); needsRegrantQueue.removeConfirmedHead(needsRegrantEntry.operationId); appendNeedsAttention(needsRegrantStore, needsRegrantQueue.key, { id: needsRegrantEntry.operationId, module: 'scouting', createdAt: stamp, message: 'This save needs attention before it can be retried.', entry: needsRegrantEntry }); const needsRegrantQueueBytes = needsRegrantStore.getItem(needsRegrantQueue.key); const needsRegrantAttentionBytes = needsRegrantStore.getItem(`${needsRegrantQueue.key}:needs-attention`); let needsRegrantCalls = 0; const needsRegrantRemoved: string[][] = []
  const needsRegrantQueued = new QueuedScoutingRepository(live(new FakeGateway()), { getContext: async () => { needsRegrantCalls += 1; if (needsRegrantCalls === 2) resetFarmGrantFromLive(needsRegrantStore, { projectRef: 'regrant-needs-attention', userId: actor, farmId: farm }, 2, stamp); return { userId: actor, farmId: farm } }, projectRef: 'regrant-needs-attention', storage: needsRegrantStore, createId: (() => { let n = 397; return () => uid(n++) })(), clock: () => stamp, isOffline: () => false, removeStoragePaths: async (paths: string[]) => { needsRegrantRemoved.push(paths); return paths } })
  await rejects(() => needsRegrantQueued.retryNeedsAttention(needsRegrantQueue.key, needsRegrantEntry.operationId), 'A revoke/regrant during a scouting retry must fail before mutating the parked record.'); needsRegrantCalls = 0
  await rejects(() => needsRegrantQueued.dismissNeedsAttention(needsRegrantQueue.key, needsRegrantEntry.operationId), 'A revoke/regrant during scouting dismissal must fail before photo cleanup.');
  assert(needsRegrantStore.getItem(needsRegrantQueue.key) === needsRegrantQueueBytes && needsRegrantStore.getItem(`${needsRegrantQueue.key}:needs-attention`) === needsRegrantAttentionBytes && needsRegrantRemoved.length === 0, 'A same-ID revoke/regrant must leave the old queue, needs-attention record, and photo custody byte-stable.')

  // Group 10: a dismissal cannot delete an uploaded photo unless both the parked-record removal and cleanup intent persist.
  const dismissFaultStore = memoryWithQueueWriteFailure(); const dismissFaultQueue = new ScoutingWriteQueue(dismissFaultStore, scoutingWriteQueueKey('dismiss-custody', actor, farm)); const dismissFaultDraft = draft(uid(398), true); const dismissFaultEntry = { version: 1 as const, module: 'scouting' as const, kind: 'saveNote' as const, operationId: uid(399), userId: actor, farmId: farm, enqueuedAt: stamp, draft: dismissFaultDraft, uploadedPaths: [dismissFaultDraft.photos[0]!.storage_path] }; dismissFaultQueue.append(dismissFaultEntry); dismissFaultQueue.removeConfirmedHead(dismissFaultEntry.operationId); appendNeedsAttention(dismissFaultStore, dismissFaultQueue.key, { id: dismissFaultEntry.operationId, module: 'scouting', createdAt: stamp, message: 'This save needs attention before it can be retried.', entry: dismissFaultEntry }); const dismissFaultBytes = dismissFaultStore.getItem(`${dismissFaultQueue.key}:needs-attention`); const dismissFaultRemoved: string[][] = []
  const dismissFaultQueued = new QueuedScoutingRepository(live(new FakeGateway()), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: 'dismiss-custody', storage: dismissFaultStore, createId: (() => { let n = 400; return () => uid(n++) })(), clock: () => stamp, isOffline: () => false, removeStoragePaths: async (paths: string[]) => { dismissFaultRemoved.push(paths); return paths } })
  dismissFaultStore.rejectWritesTo(`${dismissFaultQueue.key}:needs-attention`); await rejects(() => dismissFaultQueued.dismissNeedsAttention(dismissFaultQueue.key, dismissFaultEntry.operationId), 'A failed parked-record dismissal must stop before photo deletion.');
  assert(dismissFaultStore.getItem(`${dismissFaultQueue.key}:needs-attention`) === dismissFaultBytes && dismissFaultRemoved.length === 0, 'A failed parked-record dismissal must retain exact retry custody and make no remote photo deletion.')
  dismissFaultStore.rejectWritesTo(scoutingCleanupOutboxKey('dismiss-custody', actor)); await rejects(() => dismissFaultQueued.dismissNeedsAttention(dismissFaultQueue.key, dismissFaultEntry.operationId), 'A failed cleanup-intent write must restore the parked note before photo deletion.');
  assert(dismissFaultStore.getItem(`${dismissFaultQueue.key}:needs-attention`) === dismissFaultBytes && dismissFaultRemoved.length === 0, 'A failed cleanup-intent write must restore exact parked custody and make no remote photo deletion.')

  // Group 7: a definite save failure removes only the newly uploaded paths and does not queue a bad RPC.
  const rejectedGateway = new FakeGateway(); rejectedGateway.saveFailure = new Error('validation failed'); const rejectedStore = memory(); const cleanedDefinite: string[][] = []
  const rejectedQueued = new QueuedScoutingRepository(live(rejectedGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: 'rejected', storage: rejectedStore, createId: () => uid(350), clock: () => stamp, isOffline: () => false, uploadPhoto: async (_farmId, _fieldId, noteId) => `${farm}/${field}/${noteId}/uploaded.jpg`, removeStoragePaths: async (paths: string[]) => { cleanedDefinite.push(paths); return paths } })
  await rejects(() => rejectedQueued.saveNote(draft(uid(23)), [{ type: 'image/jpeg', size: 1, name: 'field.jpg' } as File]), 'A definite RPC failure must be returned to the caller.')
  assert(cleanedDefinite.length === 1 && cleanedDefinite[0].length === 1 && new ScoutingWriteQueue(rejectedStore, scoutingWriteQueueKey('rejected', actor, farm)).read().entries.length === 0 && getSaveReceipt(uid(23)) === 'needs attention', 'Definite failures must clean uploaded paths, avoid queueing an invalid save, and publish Needs attention for that note.')

  // Group 8: a partial upload rolls back the paths that did finish uploading.
  const partialCleanup: string[][] = []; let uploadAttempt = 0
  const uploadContext = { projectRef: 'test', userId: actor, farmId: farm, generation: 1, token: uid(901), serverEpoch: 1 }
  await rejects(() => uploadScoutingPhotos(farm, field, uid(24), [{ type: 'image/jpeg', size: 1 } as File, { type: 'image/jpeg', size: 1 } as File], uploadContext, async () => undefined, async (_farmId, _fieldId, _noteId, _file, _context) => { uploadAttempt += 1; if (uploadAttempt === 2) throw new Error('upload failed'); return `${farm}/${field}/${uid(24)}/uploaded-${uploadAttempt}.jpg` }, async (paths: string[], _context) => { partialCleanup.push(paths); return paths }), 'A partial upload must surface its upload failure.')
  assert(partialCleanup.length === 1 && partialCleanup[0][0].endsWith('uploaded-1.jpg'), 'A partial upload must clean paths that already uploaded.')

  // Group 9 (audit P2-09): a failed photo removal after the DB delete parks the paths in the
  // durable cleanup outbox — the delete finishes, the queue never wedges, and the next replay
  // drains the outbox instead of re-running the delete RPC.
  const deleteGateway = new FakeGateway(); await live(deleteGateway).saveNote(draft(uid(25), true)); const deleteOffline = false; let failRemoval = true; const removedDeletes: string[][] = []; const deleteStore = memory()
  const deleteQueued = new QueuedScoutingRepository(live(deleteGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: 'delete', storage: deleteStore, createId: () => uid(400), clock: () => stamp, isOffline: () => deleteOffline, removeStoragePaths: async (paths: string[]) => { if (failRemoval) { failRemoval = false; throw new Error('storage timeout') } removedDeletes.push(paths); return paths } })
  const originalPath = `${farm}/${field}/${uid(25)}/photo.jpg`; const deleteReceipt = await deleteQueued.deleteNote(uid(25), [originalPath]); const deleteQueue = new ScoutingWriteQueue(deleteStore, scoutingWriteQueueKey('delete', actor, farm))
  const parkedCleanup = readScoutingCleanupOutbox(deleteStore, scoutingCleanupOutboxKey('delete', actor))
  assert(!deleteReceipt.pending && deleteReceipt.deleted && deleteQueue.read().entries.length === 0 && deleteGateway.photos.length === 0 && parkedCleanup.length === 1 && parkedCleanup[0].path === originalPath, 'A failed storage deletion must finish the delete and park the captured paths durably.')
  await deleteQueued.inspectAndReplay(); assert(deleteGateway.deletes.length === 1 && removedDeletes.length === 1 && removedDeletes[0][0] === originalPath && readScoutingCleanupOutbox(deleteStore, scoutingCleanupOutboxKey('delete', actor)).length === 0, 'The next replay must drain the parked path without re-running the delete RPC.')

  // Group 10: client file checks reject unsupported MIME types and files larger than 20 MB before upload.
  assert(validateScoutingPhotoFile({ type: 'application/pdf', size: 1 }) === 'Choose a JPEG, PNG, WebP, HEIC, or HEIF photo.' && validateScoutingPhotoFile({ type: 'image/jpeg', size: 20 * 1024 * 1024 + 1 }) === 'Choose a photo smaller than 20 MB.' && validateScoutingPhotoFile({ type: 'image/heic', size: 1 }) === null, 'Client file validation must enforce the allowed image types and 20 MB limit.')

  // Group 11: the RPC boundary rejects read-only writers while worker reads and writes remain allowed.
  const readonly = new FakeGateway(); readonly.role = { role: 'read_only' }; readonly.canWrite = false; const readOnlyRepository = live(readonly); const readOnlyData = await readOnlyRepository.getData(); await rejects(() => readOnlyRepository.saveNote(draft(uid(26))), 'Read-only RPC writes must be rejected.')
  assert(readOnlyData.viewer.role === 'read_only' && !canEditScouting('read_only') && canEditScouting('worker') && (await repository.saveNote(draft(uid(27)))).id === uid(27), 'Workers must remain able to save while read-only users cannot.')

  // Group 12 (FRX-D8-001): once the account/farm changes after the first upload,
  // no second Storage request, DB write, queue append, cleanup request, or outbox write may occur.
  const switchStore = memory(); const switchRef = 'scouting-upload-switch'; let active = { userId: actor, farmId: farm }
  let uploadCalls = 0; let cleanupCalls = 0; let dbWrites = 0; let releaseUpload!: () => void; let sawUpload!: () => void
  const uploadStarted = new Promise<void>((resolve) => { sawUpload = resolve }); const uploadRelease = new Promise<void>((resolve) => { releaseUpload = resolve })
  const switchQueued = new QueuedScoutingRepository({ saveNoteOperation: async () => { dbWrites += 1; throw new Error('DB writer reached') } } as never, {
    getContext: async () => active, projectRef: switchRef, storage: switchStore, createId: (() => { let n = 500; return () => uid(n++) })(), clock: () => stamp, isOffline: () => false,
    uploadPhoto: async (_farmId, _fieldId, noteId) => { uploadCalls += 1; if (uploadCalls === 1) { sawUpload(); await uploadRelease } return `${farm}/${field}/${noteId}/upload-${uploadCalls}.jpg` },
    removeStoragePaths: async (paths) => { cleanupCalls += 1; return paths },
  })
  const switchedSave = switchQueued.saveNote(draft(uid(28)), [{ type: 'image/jpeg', size: 1, name: 'one.jpg' } as File, { type: 'image/jpeg', size: 1, name: 'two.jpg' } as File]).then(() => null).catch((error: unknown) => error)
  await uploadStarted; active = { userId: uid(30), farmId: uid(31) }; releaseUpload()
  const switchedOutcome = await switchedSave
  assert(switchedOutcome instanceof Error && uploadCalls === 1 && cleanupCalls === 0 && dbWrites === 0, 'A switched scouting upload must stop after the first Storage request and never publish later mutations.')
  assert(new ScoutingWriteQueue(switchStore, scoutingWriteQueueKey(switchRef, actor, farm)).read().entries.length === 0 && switchStore.getItem(scoutingCleanupOutboxKey(switchRef, actor)) === null, 'A switched scouting upload must not append to the initiating queue or cleanup outbox.')

  // Group 13 (FRX-D8-001): same user/farm IDs after revoke/regrant are still a
  // different access epoch and cannot resume the old photo operation.
  const regrantStore = memory(); const regrantRef = 'scouting-upload-regrant'; let regrantUploads = 0; let regrantDbWrites = 0
  const regrantQueued = new QueuedScoutingRepository({ saveNoteOperation: async () => { regrantDbWrites += 1; throw new Error('DB writer reached') } } as never, {
    getContext: async () => ({ userId: actor, farmId: farm }), projectRef: regrantRef, storage: regrantStore, createId: (() => { let n = 600; return () => uid(n++) })(), clock: () => stamp, isOffline: () => false,
    uploadPhoto: async (_farmId, _fieldId, noteId) => { regrantUploads += 1; resetFarmGrantFromLive(regrantStore, { projectRef: regrantRef, userId: actor, farmId: farm }, 2, stamp); return `${farm}/${field}/${noteId}/upload-${regrantUploads}.jpg` },
    removeStoragePaths: async (paths) => paths,
  })
  await rejects(() => regrantQueued.saveNote(draft(uid(29)), [{ type: 'image/jpeg', size: 1, name: 'one.jpg' } as File, { type: 'image/jpeg', size: 1, name: 'two.jpg' } as File]), 'A revoke/regrant during a scouting upload must reject.')
  assert(regrantUploads === 1 && regrantDbWrites === 0 && new ScoutingWriteQueue(regrantStore, scoutingWriteQueueKey(regrantRef, actor, farm)).read().entries.length === 0 && regrantStore.getItem(scoutingCleanupOutboxKey(regrantRef, actor)) === null, 'A revoke/regrant must stop all later scouting mutations without rebinding to the new epoch.')

  console.log('SupabaseScoutingRepository regression passed (18 coverage groups)')
}
void run()
