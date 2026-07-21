import { isTransportFailure } from './QueuedFieldsRepository'
import { drainScoutingCleanupOutbox, recordScoutingCleanup, scoutingCleanupOutboxKey } from './scoutingCleanupOutbox'
import type { SupabaseScoutingRepository } from './SupabaseScoutingRepository'
import { ScoutingWriteQueue, parseScoutingQueue, scoutingWriteQueueKey, type ScoutingQueueEntryV1 } from './scoutingWriteQueue'
import { setModuleSyncStatus } from './syncStatus'
import { isScoutingPhotoPath, normalizeScoutingNoteDraft, validateScoutingNoteDraft, type ScoutingData, type ScoutingDeleteReceipt, type ScoutingNote, type ScoutingNoteDraft, type ScoutingRepository } from './scouting'
import { isFarmReplayContextChangedError, launchReplayInBackground, type StorageLike } from './writeQueue'
import { captureWorkspaceCacheFence, operationalCacheMaxAgeMs, readWorkspaceCache, writeWorkspaceCache } from './workspaceCache'
import { queueTransaction } from './queueTransaction'
import { captureQueuedOperationContext, verifyQueuedOperationContext, verifyQueuedReadContext } from './queuedOperationGuard'
import type { FarmOperationContext } from './farmOperationContext'
import { uploadScoutingPhotos, validateScoutingPhotoFile } from './scoutingStorage'
import { setSaveReceipt } from '../lib/saveReceipt'
import { appendNeedsAttention, dismissNeedsAttention as dismissParkedNeedsAttention, readNeedsAttention } from './needsAttentionStore'

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
  constructor(private readonly live: SupabaseScoutingRepository, private readonly d: Dependencies) {}

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
        if (isFarmReplayContextChangedError(error)) throw error
        await verifyQueuedOperationContext(this.d, operationContext, entry)
        this.recordPhotoCleanup(entry, paths)
      }
    }
    return { ...receipt, storage_paths: paths }
  }

  private enqueue(queue: ScoutingWriteQueue, entry: ScoutingQueueEntryV1) { const next = queue.append(entry); setModuleSyncStatus('scouting', { kind: 'pending', pending: next.entries.length }); launchReplayInBackground(() => this.inspectAndReplay()); return next }
  private syncOrParked(queue: ScoutingWriteQueue) { const parked = readNeedsAttention(this.d.storage, queue.key).length; setModuleSyncStatus('scouting', parked ? { kind: 'blocked', pending: parked, message: `${parked} saves need attention.` } : { kind: 'synced', pending: 0 }) }

  private async cleanupFailedUpload(entry: Extract<ScoutingQueueEntryV1, { kind: 'saveNote' }>, operationContext: FarmOperationContext) {
    if (!entry.uploadedPaths.length || !this.d.removeStoragePaths) return
    try {
      const confirmed = await this.removePaths(entry.uploadedPaths, operationContext, entry)
      const missed = entry.uploadedPaths.filter((path) => !confirmed.includes(path))
      if (missed.length) this.recordPhotoCleanup(entry, missed)
    } catch (error) {
      if (isFarmReplayContextChangedError(error)) throw error
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
      const receiptId = entry.kind === 'saveNote' ? entry.draft.id! : null
      if (receiptId) setSaveReceipt(receiptId, 'saving')
      await verifyOperation()
      if (this.d.isOffline() || queue.read().entries.length) { await verifyOperation(); this.enqueue(queue, entry); if (receiptId) setSaveReceipt(receiptId, 'queued offline'); return undefined }
      try {
        const result = await this.write(entry, operationContext)
        await verifyOperation()
        this.syncOrParked(queue)
        if (receiptId) setSaveReceipt(receiptId, 'saved')
        return result
      } catch (error) {
        await verifyQueuedOperationContext(this.d, operationContext, entry)
        if (!isTransportFailure(error, this.d.isOffline())) { if (entry.kind === 'saveNote') await this.cleanupFailedUpload(entry, operationContext); if (receiptId) setSaveReceipt(receiptId, 'needs attention'); throw error }
        await verifyOperation(); this.enqueue(queue, entry); if (receiptId) setSaveReceipt(receiptId, 'queued offline'); return undefined
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

  async getNeedsAttentionQueueKey() { return (await this.source()).queue.key }
  private async parkedSave(queue: ScoutingWriteQueue, context: Context, operationContext: FarmOperationContext, expectedQueueKey: string, operationId: string) {
    if (queue.key !== expectedQueueKey) throw new Error(blocked)
    const record = readNeedsAttention(this.d.storage, queue.key).find((item) => item.id === operationId)
    if (!record) throw new Error(blocked)
    const entry = parseScoutingQueue(JSON.stringify({ version: 1, entries: [record.entry] })).entries[0]!
    if (entry.kind !== 'saveNote' || entry.operationId !== operationId || entry.userId !== context.userId || entry.farmId !== context.farmId) throw new Error(blocked)
    await verifyQueuedOperationContext(this.d, operationContext, entry)
    return { entry, record }
  }
  async retryNeedsAttention(expectedQueueKey: string, operationId: string) {
    const source = await this.source(); const { context, operationContext, queue } = source
    await this.locked(queue, async (verify) => {
      const { entry } = await this.parkedSave(queue, context, operationContext, expectedQueueKey, operationId)
      verify(); await verifyQueuedOperationContext(this.d, operationContext, entry)
      const active = queue.read().entries.find((candidate) => candidate.operationId === operationId)
      if (active && JSON.stringify(active) !== JSON.stringify(entry)) throw new Error(blocked)
      if (!active) queue.append(entry)
      verify(); await verifyQueuedOperationContext(this.d, operationContext, entry)
      dismissParkedNeedsAttention(this.d.storage, queue.key, operationId)
    })
    await this.inspectAndReplay()
  }
  async dismissNeedsAttention(expectedQueueKey: string, operationId: string) {
    const source = await this.source(); const { context, operationContext, queue } = source
    await this.locked(queue, async (verify) => {
      const { entry, record } = await this.parkedSave(queue, context, operationContext, expectedQueueKey, operationId)
      if (entry.uploadedPaths.length && !this.d.removeStoragePaths) throw new Error('Photo cleanup is not configured on this device. Keep this save for retry.')
      verify(); await verifyQueuedOperationContext(this.d, operationContext, entry)
      dismissParkedNeedsAttention(this.d.storage, queue.key, operationId)
      if (entry.uploadedPaths.length && !recordScoutingCleanup(this.d.storage, this.outboxKey(context.userId), context.userId, context.farmId, entry.uploadedPaths, this.d.clock())) {
        appendNeedsAttention(this.d.storage, queue.key, record)
        throw new Error('This photo cleanup could not be retained on this device. Keep this save for retry.')
      }
    })
    await this.drainPhotoCleanup(source)
    this.syncOrParked(queue)
  }

  async inspectAndReplay() {
    let source: Source
    try { source = await this.source() } catch (error) { if (isFarmReplayContextChangedError(error)) throw error; return }
    const { context, operationContext, queue } = source
    try { await verifyQueuedOperationContext(this.d, operationContext, context); await this.drainPhotoCleanup(source); await verifyQueuedOperationContext(this.d, operationContext, context) } catch (error) { if (isFarmReplayContextChangedError(error)) throw error /* retried next replay */ }
    try {
      await this.locked(queue, async (verify) => {
        await verifyQueuedOperationContext(this.d, operationContext, context)
        verify()
        let envelope = queue.read()
        if (!envelope.entries.length) { this.syncOrParked(queue); return }
        if (this.d.isOffline()) { setModuleSyncStatus('scouting', { kind: 'pending', pending: envelope.entries.length }); return }
        while (envelope.entries.length) {
          const head = envelope.entries[0]
          if (head.userId !== context.userId || head.farmId !== context.farmId) throw new Error(blocked)
          await verifyQueuedOperationContext(this.d, operationContext, head)
          setModuleSyncStatus('scouting', { kind: 'syncing', pending: envelope.entries.length })
          let remoteSaveConfirmed = false
          try {
            await this.write(head, operationContext)
            remoteSaveConfirmed = true
            verify(); await verifyQueuedOperationContext(this.d, operationContext, head)
            if (head.kind === 'saveNote') setSaveReceipt(head.draft.id!, 'saved')
            envelope = queue.removeConfirmedHead(head.operationId)
          } catch (error) {
            if (remoteSaveConfirmed) {
              if (isFarmReplayContextChangedError(error)) throw error
              setModuleSyncStatus('scouting', { kind: 'blocked', pending: envelope.entries.length, message: 'This note was saved, but this device could not update its saved-change list. Keep it queued and retry.' })
              return
            }
            await verifyQueuedOperationContext(this.d, operationContext, head)
            if (isTransportFailure(error, this.d.isOffline())) { setModuleSyncStatus('scouting', { kind: 'pending', pending: envelope.entries.length }); return }
            if (head.kind === 'saveNote') { verify(); await verifyQueuedOperationContext(this.d, operationContext, head); setSaveReceipt(head.draft.id!, 'needs attention'); envelope = queue.parkHead(head.operationId); continue }
            setModuleSyncStatus('scouting', { kind: 'blocked', pending: envelope.entries.length, message: blocked }); return
          }
        }
        this.syncOrParked(queue)
      })
    } catch (error) { if (isFarmReplayContextChangedError(error)) throw error; setModuleSyncStatus('scouting', { kind: 'blocked', pending: 0, message: blocked }) }
  }
}
