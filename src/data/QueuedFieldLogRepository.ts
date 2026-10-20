import { isTransportFailure } from './QueuedFieldsRepository'
import { FieldLogWriteQueue, fieldLogWriteQueueKey, type FieldLogQueueEntry, type FieldLogQueueEntryV2 } from './fieldLogWriteQueue'
import { setModuleSyncStatus } from './syncStatus'
import { validateFieldLogDraft, type FieldLogData, type FieldLogDeleteReceipt, type FieldLogEntry, type FieldLogEntryDraft, type FieldLogRepository } from './fieldLog'
import { isFarmReplayContextChangedError, launchReplayInBackground, type StorageLike } from './writeQueue'
import type { SupabaseFieldLogRepository } from './SupabaseFieldLogRepository'
import { captureWorkspaceCacheFence, operationalCacheMaxAgeMs, readWorkspaceCache, writeWorkspaceCacheInOrder, type OrderedWorkspaceWrite } from './workspaceCache'
import { queueTransaction } from './queueTransaction'
import { captureQueuedOperationContext, verifyQueuedOperationContext, verifyQueuedReadContext } from './queuedOperationGuard'
import { verifyFarmOperationContext, type FarmOperationContext } from './farmOperationContext'

const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
type Context = { userId: string; farmId: string }
function pendingEntry(entry: Extract<FieldLogQueueEntry, { kind: 'saveEntry' }>, context: Context): FieldLogEntry {
  return { id: entry.draft.id!, farm_id: context.farmId, field_id: entry.draft.field_id, entry_type: entry.draft.entry_type, observed_on: entry.draft.observed_on, rainfall_in: entry.draft.rainfall_in, note: entry.draft.note, created_by: context.userId, created_at: entry.enqueuedAt, updated_at: entry.enqueuedAt, pending: true }
}
const waitingId = (entry: FieldLogQueueEntryV2) => entry.kind === 'saveEntry' ? entry.draft.id! : entry.entryId
/** Lays writes waiting on this device over rows, in queue order: a waiting save shows as pending, keeping a listed row's
 * created time so it keeps its place, and a waiting delete takes its row out. */
function layWaitingWrites(rows: FieldLogEntry[], waiting: FieldLogQueueEntryV2[], fieldId: string | undefined, context: Context) {
  let entries = rows
  for (const entry of waiting) {
    if (entry.kind === 'deleteEntry') entries = entries.filter((row) => row.id !== entry.entryId)
    else if (!fieldId || entry.draft.field_id === fieldId) { const row = pendingEntry(entry, context); entries = entries.some((item) => item.id === row.id) ? entries.map((item) => item.id === row.id ? { ...row, created_at: item.created_at } : item) : [...entries, row] }
  }
  return entries
}
export class QueuedFieldLogRepository implements FieldLogRepository {
  constructor(private readonly live: SupabaseFieldLogRepository, private readonly d: { getContext: () => Promise<Context>; projectRef: string; storage: StorageLike; createId: () => string; clock: () => string; isOffline: () => boolean; readWorkspaceCache?: typeof readWorkspaceCache; writeWorkspaceCacheInOrder?: typeof writeWorkspaceCacheInOrder }) {}
  private async source() { const operationContext = await captureQueuedOperationContext(this.d); const context = { userId: operationContext.userId, farmId: operationContext.farmId }; return { context, operationContext, queue: new FieldLogWriteQueue(this.d.storage, fieldLogWriteQueueKey(this.d.projectRef, context.userId, context.farmId)) } }
  private locked<T>(storageKey: string, task: (verify: () => void) => Promise<T>) { return queueTransaction(storageKey, this.d.storage, this.d.createId, task) }
  private savedCopyScope(context: Context, fieldId?: string) { return { projectRef: this.d.projectRef, ...context, module: `fieldLog:${fieldId ?? 'all'}` } }
  /** Writes the saved copy in order with every tab on this device (see writeWorkspaceCacheInOrder), so the page can trust it
   * once a live read settled an entry: an older answer never puts back rows from before a newer one. */
  private writeSavedCopy(scope: ReturnType<QueuedFieldLogRepository['savedCopyScope']>, write: OrderedWorkspaceWrite<FieldLogData>, orderedAt: number, fence: FarmOperationContext | null) { return (this.d.writeWorkspaceCacheInOrder ?? writeWorkspaceCacheInOrder)(scope, write, orderedAt, fence) }
  /** A save or delete the server confirmed goes into the whole-farm saved copy straight away, so an answer without signal
   * shows it before the next live read. A single field's copy, which no screen asks for, is refreshed by its own live reads.
   * Best effort: without a saved copy, or once the farm's access changed, nothing is written and the save still stands. */
  private async keepInSavedCopy(entry: FieldLogQueueEntryV2, confirmed: FieldLogEntry | FieldLogDeleteReceipt, confirmedAt: number) {
    const id = waitingId(entry)
    const change = (copy: FieldLogData): FieldLogData => ({ ...copy, entries: 'deleted' in confirmed ? copy.entries.filter((row) => row.id !== id) : copy.entries.some((row) => row.id === id) ? copy.entries.map((row) => row.id === id ? confirmed : row) : [...copy.entries, confirmed] })
    await this.writeSavedCopy(this.savedCopyScope({ userId: entry.userId, farmId: entry.farmId }), { change }, confirmedAt, entry.operationContext)
  }
  async getNeedsAttentionQueueKey() { return (await this.source()).queue.key }
  async getData(fieldId?: string) {
    const { context, operationContext, queue } = await this.source()
    const verifyRead = () => verifyQueuedReadContext(this.d, operationContext)
    const cacheScope = this.savedCopyScope(context, fieldId)
    try {
      const cacheFence = captureWorkspaceCacheFence(cacheScope); const readStartedAt = Date.parse(this.d.clock())
      // Writes still waiting when the read starts, read before the server so one sent during the read still shows (as not
      // sent yet, until the next read). Unreadable bytes never break a live read; they leave the waiting list unknown.
      let waiting: FieldLogQueueEntryV2[] | undefined
      try { waiting = queue.read().entries.filter((entry): entry is FieldLogQueueEntryV2 => entry.version === 2) } catch { waiting = undefined }
      const data = await this.live.getData(fieldId); await verifyRead()
      await this.writeSavedCopy(cacheScope, { replace: data }, readStartedAt, cacheFence); await verifyRead()
      if (!waiting) return data
      // Only writes made under this farm access are laid over the rows: one from an earlier access can never be sent.
      const current = waiting.filter((entry) => { try { verifyFarmOperationContext(this.d.storage, entry.operationContext, operationContext); return true } catch { return false } })
      return { ...data, entries: layWaitingWrites(data.entries, current, fieldId, context), waitingIds: waiting.map(waitingId) }
    } catch (error) {
      await verifyRead()
      if (!isTransportFailure(error, this.d.isOffline())) throw error
      const readCache = this.d.readWorkspaceCache ?? readWorkspaceCache
      const cached = await readCache<FieldLogData>(cacheScope, operationalCacheMaxAgeMs); await verifyRead()
      if (!cached) throw error
      const waiting = queue.read().entries.filter((entry): entry is FieldLogQueueEntryV2 => entry.version === 2)
      for (const entry of waiting) await verifyQueuedOperationContext(this.d, entry.operationContext, entry)
      const data: FieldLogData = { ...structuredClone(cached.data), offline: true }
      data.entries = layWaitingWrites(data.entries, waiting, fieldId, context); data.waitingIds = waiting.map(waitingId)
      await verifyRead(); return data
    }
  }
  private base<K extends FieldLogQueueEntryV2['kind']>(kind: K, operationContext: FarmOperationContext) { return { version: 2 as const, module: 'fieldLog' as const, kind, operationId: this.d.createId(), userId: operationContext.userId, farmId: operationContext.farmId, enqueuedAt: this.d.clock(), operationContext } }
  private async write(entry: FieldLogQueueEntryV2): Promise<FieldLogEntry | FieldLogDeleteReceipt> { await verifyQueuedOperationContext(this.d, entry.operationContext, entry); if (entry.kind === 'saveEntry') return this.live.saveEntryOperation(entry.draft, entry.operationId, entry.operationContext); return this.live.deleteEntryOperation(entry.entryId, entry.operationContext) }
  private async save(entry: FieldLogQueueEntryV2): Promise<FieldLogEntry | FieldLogDeleteReceipt | void> {
    const operationContext = entry.operationContext
    const source = await this.source(); const { context, queue } = source; if (entry.userId !== context.userId || entry.farmId !== context.farmId) throw new Error(blocked); await verifyQueuedOperationContext(this.d, operationContext, entry)
    return this.locked(queue.key, async (verify) => { const verifyOperation = async () => { verify(); await verifyQueuedOperationContext(this.d, operationContext, entry) }; await verifyOperation(); if (this.d.isOffline() || queue.read().entries.length) { await verifyOperation(); const next = queue.append(entry); setModuleSyncStatus('fieldLog', { kind: 'pending', pending: next.entries.length }); launchReplayInBackground(() => this.inspectAndReplay()); return }
      try { const result = await this.write(entry); await this.keepInSavedCopy(entry, result, Date.parse(this.d.clock())); await verifyOperation(); setModuleSyncStatus('fieldLog', { kind: 'synced', pending: 0 }); return result } catch (error) { await verifyQueuedOperationContext(this.d, operationContext, entry); if (!isTransportFailure(error, this.d.isOffline())) throw error; await verifyOperation(); const next = queue.append(entry); setModuleSyncStatus('fieldLog', { kind: 'pending', pending: next.entries.length }); launchReplayInBackground(() => this.inspectAndReplay()); return } })
  }
  async saveEntry(draft: FieldLogEntryDraft) {
    const validation = validateFieldLogDraft(draft); if (validation) throw new Error(validation)
    const { context, operationContext } = await this.source(); const entry = { ...this.base('saveEntry', operationContext), draft: { ...draft, id: draft.id ?? this.d.createId() } } as Extract<FieldLogQueueEntryV2, { kind: 'saveEntry' }>
    const result = await this.save(entry); return (result as FieldLogEntry | undefined) ?? pendingEntry(entry, context)
  }
  async deleteEntry(entryId: string): Promise<FieldLogDeleteReceipt> { const { operationContext } = await this.source(); const result = await this.save({ ...this.base('deleteEntry', operationContext), entryId } as FieldLogQueueEntryV2); return (result as FieldLogDeleteReceipt | undefined) ?? { id: entryId, deleted: true, pending: true } }
  async inspectAndReplay() {
    let source: Awaited<ReturnType<QueuedFieldLogRepository['source']>>; try { source = await this.source() } catch (error) { if (isFarmReplayContextChangedError(error)) throw error; return }
    const { context, operationContext, queue } = source
    try { await this.locked(queue.key, async (verify) => { await verifyQueuedOperationContext(this.d, operationContext, context); verify(); let envelope = queue.read(); if (!envelope.entries.length) { setModuleSyncStatus('fieldLog', { kind: 'synced', pending: 0 }); return }
      let parkedLegacy = false
      while (envelope.entries[0]?.version === 1) { const head = envelope.entries[0]; if (head.userId !== context.userId || head.farmId !== context.farmId) throw new Error(blocked); envelope = queue.parkLegacyHead(head.operationId); parkedLegacy = true }
      if (parkedLegacy) { setModuleSyncStatus('fieldLog', { kind: 'blocked', pending: envelope.entries.length, message: blocked }); return }
      if (this.d.isOffline()) { setModuleSyncStatus('fieldLog', { kind: 'pending', pending: envelope.entries.length }); return }
      while (envelope.entries.length) { const head = envelope.entries[0]; if (head.userId !== context.userId || head.farmId !== context.farmId) throw new Error(blocked); if (head.version === 1) { envelope = queue.parkLegacyHead(head.operationId); setModuleSyncStatus('fieldLog', { kind: 'blocked', pending: envelope.entries.length, message: blocked }); return } await verifyQueuedOperationContext(this.d, head.operationContext, head); setModuleSyncStatus('fieldLog', { kind: 'syncing', pending: envelope.entries.length }); try { const confirmed = await this.write(head); await this.keepInSavedCopy(head, confirmed, Date.parse(this.d.clock())); verify(); await verifyQueuedOperationContext(this.d, head.operationContext, head); envelope = queue.removeConfirmedHead(head.operationId) } catch (error) { await verifyQueuedOperationContext(this.d, head.operationContext, head); if (isTransportFailure(error, this.d.isOffline())) { setModuleSyncStatus('fieldLog', { kind: 'pending', pending: envelope.entries.length }); return } setModuleSyncStatus('fieldLog', { kind: 'blocked', pending: envelope.entries.length, message: blocked }); return } }
      setModuleSyncStatus('fieldLog', { kind: 'synced', pending: 0 }) })
    } catch (error) { if (isFarmReplayContextChangedError(error)) throw error; setModuleSyncStatus('fieldLog', { kind: 'blocked', pending: 0, message: blocked }) }
  }
}
