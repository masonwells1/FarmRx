import { isTransportFailure } from './QueuedFieldsRepository'
import { drainScoutingCleanupOutbox, recordScoutingCleanup, scoutingCleanupOutboxKey } from './scoutingCleanupOutbox'
import type { SupabaseScoutingRepository } from './SupabaseScoutingRepository'
import { ScoutingWriteQueue, scoutingWriteQueueKey, type ScoutingQueueEntryV1 } from './scoutingWriteQueue'
import { setModuleSyncRetryAction, setModuleSyncStatus } from './syncStatus'
import { isScoutingPhotoPath, normalizeScoutingNoteDraft, validateScoutingNoteDraft, type ScoutingData, type ScoutingDeleteReceipt, type ScoutingNote, type ScoutingNoteDraft, type ScoutingRepository } from './scouting'
import type { StorageLike } from './writeQueue'
import { captureWorkspaceCacheFence, operationalCacheMaxAgeMs, readWorkspaceCache, writeWorkspaceCache } from './workspaceCache'
import { queueTransaction, subscribeQueueTransactions } from './queueTransaction'
import { captureQueuedOperationContext, verifyQueuedOperationContext, verifyQueuedReadContext } from './queuedOperationGuard'
import type { FarmOperationContext } from './farmOperationContext'
import { uploadScoutingPhotos, validateScoutingPhotoFile } from './scoutingStorage'

const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
type Context = { userId: string; farmId: string }
type Source = { context: Context; operationContext: FarmOperationContext; queue: ScoutingWriteQueue }
type Dependencies = {
  getContext: () => Promise<Context>
  projectRef: string
  storage: StorageLike
  createId: () => string
  clock: () => string
  isOffline: () => boolean
  uploadPhoto?: (farmId: string, fieldId: string, noteId: string, file: File, context: FarmOperationContext) => Promise<string>
  removeStoragePaths?: (paths: string[], context: FarmOperationContext) => Promise<string[]>
}

function pending(entry: Extract<ScoutingQueueEntryV1, { kind: 'saveNote' }>, context: Context): ScoutingNote {
  const d = entry.draft
  return { id: d.id!, farm_id: context.farmId, field_id: d.field_id, observed_on: d.observed_on, category: d.category, note: d.note, latitude: d.latitude, longitude: d.longitude, created_by: context.userId, created_at: entry.enqueuedAt, updated_at: entry.enqueuedAt, photos: [], pending: true }
}

export class QueuedScoutingRepository implements ScoutingRepository {
  constructor(private readonly live: SupabaseScoutingRepository, private readonly d: Dependencies) {
    setModuleSyncRetryAction('scouting', () => this.inspectAndReplay())
    if (typeof window !== 'undefined') window.addEventListener('online', () => { void this.inspectAndReplay() })
    subscribeQueueTransactions((key) => { void this.source().then(({ queue }) => { if (queue.key === key) void this.inspectAndReplay() }).catch(() => undefined) })
  }

  private async source(): Promise<Source> {
    const operationContext = await captureQueuedOperationContext(this.d)
    const context = { userId: operationContext.userId, farmId: operationContext.farmId }
    return { context, operationContext, queue: new ScoutingWriteQueue(this.d.storage, scoutingWriteQueueKey(this.d.projectRef, context.userId, context.farmId)) }
  }
  private locked<T>(queue: ScoutingWriteQueue, task: (verify: () => void) => Promise<T>) { return queueTransaction(queue.key, this.d.storage, this.d.createId, task) }
  private outboxKey(userId: string) { return scoutingCleanupOutboxKey(this.d.projectRef, userId) }
  private recordPhotoCleanup(context: Context, paths: string[]) {
    if (!recordScoutingCleanup(this.d.storage, this.outboxKey(context.userId), context.userId, context.farmId, paths, this.d.clock())) console.warn('Farm Rx could not retain photo-cleanup records on this device; some photo files may need manual removal.')
  }
  private base<K extends ScoutingQueueEntryV1['kind']>(kind: K, context: Context) { return { version: 1 as const, module: 'scouting' as const, kind, operationId: this.d.createId(), userId: context.userId, farmId: context.farmId, enqueuedAt: this.d.clock() } }

  private async drainPhotoCleanup(source: Source) {
    if (this.d.isOffline() || !this.d.removeStoragePaths) return
    const { context, operationContext } = source
    await drainScoutingCleanupOutbox(this.d.storage, this.outboxKey(context.userId), context.userId, context.farmId, async (paths) => {
      await verifyQueuedOperationContext(this.d, operationContext, context)
      const confirmed = await this.d.removeStoragePaths!(paths, operationContext)
      await verifyQueuedOperationContext(this.d, operationContext, context)
      return confirmed
    })
  }

  async getData(fieldId?: string) {
    const source = await this.source(); const { context, operationContext, queue } = source
    const verifyRead = () => verifyQueuedReadContext(this.d, operationContext)
    const cacheScope = { projectRef: this.d.projectRef, ...context, module: `scouting:${fieldId ?? 'all'}` }
    try {
      await this.inspectAndReplay(); await verifyRead()
      const cacheFence = captureWorkspaceCacheFence(cacheScope)
      const data = await this.live.getData(fieldId); await verifyRead()
      await writeWorkspaceCache(cacheScope, data, cacheFence); await verifyRead()
      return data
    } catch (error) {
      await verifyRead()
      if (!isTransportFailure(error, this.d.isOffline())) throw error
      const cached = await readWorkspaceCache<ScoutingData>(cacheScope, operationalCacheMaxAgeMs); await verifyRead()
      if (!cached) throw error
      const data = structuredClone(cached.data)
      for (const entry of queue.read().entries) {
        if (entry.kind === 'deleteNote') data.notes = data.notes.filter((note) => note.id !== entry.noteId)
        else if (!fieldId || entry.draft.field_id === fieldId) {
          const note = pending(entry, context)
          data.notes = data.notes.some((item) => item.id === note.id) ? data.notes.map((item) => item.id === note.id ? note : item) : [...data.notes, note]
        }
      }
      await verifyRead(); return data
    }
  }

  private async removePaths(paths: string[], operationContext: FarmOperationContext, context: Context) {
    if (!paths.length || !this.d.removeStoragePaths) return []
    await verifyQueuedOperationContext(this.d, operationContext, context)
    const confirmed = await this.d.removeStoragePaths(paths, operationContext)
    await verifyQueuedOperationContext(this.d, operationContext, context)
    return confirmed
  }

  private async write(entry: ScoutingQueueEntryV1, operationContext: FarmOperationContext): Promise<ScoutingNote | ScoutingDeleteReceipt> {
    await verifyQueuedOperationContext(this.d, operationContext, entry)
    if (entry.kind === 'saveNote') return this.live.saveNoteOperation(entry.draft, entry.operationId, operationContext)
    const receipt = await this.live.deleteNoteOperation(entry.noteId, operationContext)
    await verifyQueuedOperationContext(this.d, operationContext, entry)
    const paths = [...new Set([...entry.storagePaths, ...receipt.storage_paths])]
    if (paths.length && this.d.removeStoragePaths) {
      try {
        const confirmed = await this.removePaths(paths, operationContext, entry)
        const missed = paths.filter((path) => !confirmed.includes(path))
        if (missed.length) this.recordPhotoCleanup(entry, missed)
      } catch (error) {
        await verifyQueuedOperationContext(this.d, operationContext, entry)
        this.recordPhotoCleanup(entry, paths)
      }
    }
    return { ...receipt, storage_paths: paths }
  }

  private enqueue(queue: ScoutingWriteQueue, entry: ScoutingQueueEntryV1) { const next = queue.append(entry); setModuleSyncStatus('scouting', { kind: 'pending', pending: next.entries.length }); void this.inspectAndReplay(); return next }

  private async cleanupFailedUpload(entry: Extract<ScoutingQueueEntryV1, { kind: 'saveNote' }>, operationContext: FarmOperationContext) {
    if (!entry.uploadedPaths.length || !this.d.removeStoragePaths) return
    try {
      const confirmed = await this.removePaths(entry.uploadedPaths, operationContext, entry)
      const missed = entry.uploadedPaths.filter((path) => !confirmed.includes(path))
      if (missed.length) this.recordPhotoCleanup(entry, missed)
    } catch {
      await verifyQueuedOperationContext(this.d, operationContext, entry)
      this.recordPhotoCleanup(entry, entry.uploadedPaths)
    }
  }

  private async save(entry: ScoutingQueueEntryV1, source: Source) {
    const { context, operationContext, queue } = source
    if (entry.userId !== context.userId || entry.farmId !== context.farmId) throw new Error(blocked)
    await verifyQueuedOperationContext(this.d, operationContext, entry)
    return this.locked(queue, async (verify) => {
      const verifyOperation = async () => { verify(); await verifyQueuedOperationContext(this.d, operationContext, entry) }
      await verifyOperation()
      if (this.d.isOffline() || queue.read().entries.length) { await verifyOperation(); this.enqueue(queue, entry); return undefined }
      try {
        const result = await this.write(entry, operationContext)
        await verifyOperation()
        setModuleSyncStatus('scouting', { kind: 'synced', pending: 0 })
        return result
      } catch (error) {
        await verifyQueuedOperationContext(this.d, operationContext, entry)
        if (!isTransportFailure(error, this.d.isOffline())) { if (entry.kind === 'saveNote') await this.cleanupFailedUpload(entry, operationContext); throw error }
        await verifyOperation(); this.enqueue(queue, entry); return undefined
      }
    })
  }

  async saveNote(draft: ScoutingNoteDraft, files: File[] = []) {
    for (const file of files) { const validation = validateScoutingPhotoFile(file); if (validation) throw new Error(validation) }
    if (files.length && this.d.isOffline()) throw new Error('Photos need a connection before this scouting note can be saved.')
    const source = await this.source(); const { context, operationContext } = source
    const normalized = normalizeScoutingNoteDraft({ ...draft, id: draft.id ?? this.d.createId() })
    const validationPhotos = files.map((_, index) => ({ storage_path: `${context.farmId}/${normalized.field_id}/${normalized.id}/pending-${index}.jpg` }))
    const validation = validateScoutingNoteDraft({ ...normalized, photos: [...normalized.photos, ...validationPhotos] })
    if (validation) throw new Error(validation)
    let uploadedPaths: string[] = []
    if (files.length) {
      if (!this.d.uploadPhoto) throw new Error('Photo uploads are not configured on this device.')
      uploadedPaths = await uploadScoutingPhotos(
        context.farmId,
        normalized.field_id,
        normalized.id!,
        files,
        operationContext,
        (expected) => verifyQueuedOperationContext(this.d, expected, context),
        this.d.uploadPhoto,
        this.d.removeStoragePaths,
        (paths) => this.recordPhotoCleanup(context, paths),
      )
    }
    await verifyQueuedOperationContext(this.d, operationContext, context)
    const finalDraft = normalizeScoutingNoteDraft({ ...normalized, photos: [...normalized.photos, ...uploadedPaths.map((storage_path) => ({ storage_path }))] })
    const entry = { ...this.base('saveNote', context), draft: finalDraft, uploadedPaths } as Extract<ScoutingQueueEntryV1, { kind: 'saveNote' }>
    const result = await this.save(entry, source)
    return (result as ScoutingNote | undefined) ?? pending(entry, context)
  }

  async deleteNote(noteId: string, storagePaths: string[] = []) {
    const source = await this.source(); const { context } = source
    if (!storagePaths.every((path) => isScoutingPhotoPath(path, { farmId: context.farmId, noteId }))) throw new Error(blocked)
    const entry = { ...this.base('deleteNote', context), noteId, storagePaths: [...new Set(storagePaths)] } as Extract<ScoutingQueueEntryV1, { kind: 'deleteNote' }>
    const result = await this.save(entry, source)
    return (result as ScoutingDeleteReceipt | undefined) ?? { id: noteId, deleted: true, storage_paths: entry.storagePaths, pending: true }
  }

  async inspectAndReplay() {
    let source: Source
    try { source = await this.source() } catch { return }
    const { context, operationContext, queue } = source
    try { await verifyQueuedOperationContext(this.d, operationContext, context); await this.drainPhotoCleanup(source); await verifyQueuedOperationContext(this.d, operationContext, context) } catch { /* retried next replay */ }
    try {
      await this.locked(queue, async (verify) => {
        let envelope = queue.read()
        if (!envelope.entries.length) { setModuleSyncStatus('scouting', { kind: 'synced', pending: 0 }); return }
        if (this.d.isOffline()) { setModuleSyncStatus('scouting', { kind: 'pending', pending: envelope.entries.length }); return }
        while (envelope.entries.length) {
          const head = envelope.entries[0]
          if (head.userId !== context.userId || head.farmId !== context.farmId) throw new Error(blocked)
          await verifyQueuedOperationContext(this.d, operationContext, head)
          setModuleSyncStatus('scouting', { kind: 'syncing', pending: envelope.entries.length })
          try {
            await this.write(head, operationContext)
            verify(); await verifyQueuedOperationContext(this.d, operationContext, head)
            envelope = queue.removeConfirmedHead(head.operationId)
          } catch (error) {
            await verifyQueuedOperationContext(this.d, operationContext, head)
            if (isTransportFailure(error, this.d.isOffline())) { setModuleSyncStatus('scouting', { kind: 'pending', pending: envelope.entries.length }); return }
            if (head.kind === 'saveNote') { await this.cleanupFailedUpload(head, operationContext); verify(); await verifyQueuedOperationContext(this.d, operationContext, head); envelope = queue.removeConfirmedHead(head.operationId); continue }
            setModuleSyncStatus('scouting', { kind: 'blocked', pending: envelope.entries.length, message: blocked }); return
          }
        }
        setModuleSyncStatus('scouting', { kind: 'synced', pending: 0 })
      })
    } catch { setModuleSyncStatus('scouting', { kind: 'blocked', pending: 0, message: blocked }) }
  }
}
