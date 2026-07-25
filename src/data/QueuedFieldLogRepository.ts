import { isTransportFailure } from './QueuedFieldsRepository'
import { FieldLogWriteQueue, fieldLogWriteQueueKey, type FieldLogQueueEntry, type FieldLogQueueEntryV2 } from './fieldLogWriteQueue'
import { setModuleSyncStatus } from './syncStatus'
import { validateFieldLogDraft, type FieldLogData, type FieldLogDeleteReceipt, type FieldLogEntry, type FieldLogEntryDraft, type FieldLogRepository } from './fieldLog'
import { isFarmReplayContextChangedError, launchReplayInBackground, type StorageLike } from './writeQueue'
import type { SupabaseFieldLogRepository } from './SupabaseFieldLogRepository'
import { captureWorkspaceCacheFence, operationalCacheMaxAgeMs, readWorkspaceCache, writeWorkspaceCache } from './workspaceCache'
import { queueTransaction } from './queueTransaction'
import { captureQueuedOperationContext, verifyQueuedOperationContext, verifyQueuedReadContext } from './queuedOperationGuard'
import type { FarmOperationContext } from './farmOperationContext'

const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
type Context = { userId: string; farmId: string }
function pendingEntry(entry: Extract<FieldLogQueueEntry, { kind: 'saveEntry' }>, context: Context): FieldLogEntry {
  return { id: entry.draft.id!, farm_id: context.farmId, field_id: entry.draft.field_id, entry_type: entry.draft.entry_type, observed_on: entry.draft.observed_on, rainfall_in: entry.draft.rainfall_in, note: entry.draft.note, created_by: context.userId, created_at: entry.enqueuedAt, updated_at: entry.enqueuedAt, pending: true }
}
export class QueuedFieldLogRepository implements FieldLogRepository {
  constructor(private readonly live: SupabaseFieldLogRepository, private readonly d: { getContext: () => Promise<Context>; projectRef: string; storage: StorageLike; createId: () => string; clock: () => string; isOffline: () => boolean; readWorkspaceCache?: typeof readWorkspaceCache }) {}
  private async source() { const operationContext = await captureQueuedOperationContext(this.d); const context = { userId: operationContext.userId, farmId: operationContext.farmId }; return { context, operationContext, queue: new FieldLogWriteQueue(this.d.storage, fieldLogWriteQueueKey(this.d.projectRef, context.userId, context.farmId)) } }
  private locked<T>(storageKey: string, task: (verify: () => void) => Promise<T>) { return queueTransaction(storageKey, this.d.storage, this.d.createId, task) }
  async getNeedsAttentionQueueKey() { return (await this.source()).queue.key }
  async getData(fieldId?: string) {
    const { context, operationContext, queue } = await this.source()
    const verifyRead = () => verifyQueuedReadContext(this.d, operationContext)
    const cacheScope = { projectRef: this.d.projectRef, ...context, module: `fieldLog:${fieldId ?? 'all'}` }
    try {
      const cacheFence = captureWorkspaceCacheFence(cacheScope)
      const data = await this.live.getData(fieldId); await verifyRead()
      await writeWorkspaceCache(cacheScope, data, cacheFence); await verifyRead()
      return data
    } catch (error) {
      await verifyRead()
      if (!isTransportFailure(error, this.d.isOffline())) throw error
      const readCache = this.d.readWorkspaceCache ?? readWorkspaceCache
      const cached = await readCache<FieldLogData>(cacheScope, operationalCacheMaxAgeMs); await verifyRead()
      if (!cached) throw error
      const data = structuredClone(cached.data)
      for (const entry of queue.read().entries) { if (entry.version !== 2) continue; await verifyQueuedOperationContext(this.d, entry.operationContext, entry); if (entry.kind === 'deleteEntry') data.entries = data.entries.filter((row) => row.id !== entry.entryId); else if (!fieldId || entry.draft.field_id === fieldId) { const row = pendingEntry(entry, context); data.entries = data.entries.some((item) => item.id === row.id) ? data.entries.map((item) => item.id === row.id ? row : item) : [...data.entries, row] } }
      await verifyRead(); return data
    }
  }
  private base<K extends FieldLogQueueEntryV2['kind']>(kind: K, operationContext: FarmOperationContext) { return { version: 2 as const, module: 'fieldLog' as const, kind, operationId: this.d.createId(), userId: operationContext.userId, farmId: operationContext.farmId, enqueuedAt: this.d.clock(), operationContext } }
  private async write(entry: FieldLogQueueEntryV2): Promise<FieldLogEntry | FieldLogDeleteReceipt> { await verifyQueuedOperationContext(this.d, entry.operationContext, entry); if (entry.kind === 'saveEntry') return this.live.saveEntryOperation(entry.draft, entry.operationId, entry.operationContext); return this.live.deleteEntryOperation(entry.entryId, entry.operationContext) }
  private async save(entry: FieldLogQueueEntryV2): Promise<FieldLogEntry | FieldLogDeleteReceipt | void> {
    const operationContext = entry.operationContext
    const source = await this.source(); const { context, queue } = source; if (entry.userId !== context.userId || entry.farmId !== context.farmId) throw new Error(blocked); await verifyQueuedOperationContext(this.d, operationContext, entry)
    return this.locked(queue.key, async (verify) => { const verifyOperation = async () => { verify(); await verifyQueuedOperationContext(this.d, operationContext, entry) }; await verifyOperation(); if (this.d.isOffline() || queue.read().entries.length) { await verifyOperation(); const next = queue.append(entry); setModuleSyncStatus('fieldLog', { kind: 'pending', pending: next.entries.length }); launchReplayInBackground(() => this.inspectAndReplay()); return }
      try { const result = await this.write(entry); await verifyOperation(); setModuleSyncStatus('fieldLog', { kind: 'synced', pending: 0 }); return result } catch (error) { await verifyQueuedOperationContext(this.d, operationContext, entry); if (!isTransportFailure(error, this.d.isOffline())) throw error; await verifyOperation(); const next = queue.append(entry); setModuleSyncStatus('fieldLog', { kind: 'pending', pending: next.entries.length }); launchReplayInBackground(() => this.inspectAndReplay()); return } })
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
      while (envelope.entries.length) { const head = envelope.entries[0]; if (head.userId !== context.userId || head.farmId !== context.farmId) throw new Error(blocked); if (head.version === 1) { envelope = queue.parkLegacyHead(head.operationId); setModuleSyncStatus('fieldLog', { kind: 'blocked', pending: envelope.entries.length, message: blocked }); return } await verifyQueuedOperationContext(this.d, head.operationContext, head); setModuleSyncStatus('fieldLog', { kind: 'syncing', pending: envelope.entries.length }); try { await this.write(head); verify(); await verifyQueuedOperationContext(this.d, head.operationContext, head); envelope = queue.removeConfirmedHead(head.operationId) } catch (error) { await verifyQueuedOperationContext(this.d, head.operationContext, head); if (isTransportFailure(error, this.d.isOffline())) { setModuleSyncStatus('fieldLog', { kind: 'pending', pending: envelope.entries.length }); return } setModuleSyncStatus('fieldLog', { kind: 'blocked', pending: envelope.entries.length, message: blocked }); return } }
      setModuleSyncStatus('fieldLog', { kind: 'synced', pending: 0 }) })
    } catch (error) { if (isFarmReplayContextChangedError(error)) throw error; setModuleSyncStatus('fieldLog', { kind: 'blocked', pending: 0, message: blocked }) }
  }
}
