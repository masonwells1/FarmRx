import { isTransportFailure } from './QueuedFieldsRepository'
import { NotificationsWriteQueue, notificationsWriteQueueKey, type NotificationsQueueEntryV1 } from './notificationsWriteQueue'
import { setModuleSyncStatus } from './syncStatus'
import type { MarkReadResult, NotificationsData, NotificationsRepository } from './notifications'
import { isFarmReplayContextChangedError, launchReplayInBackground, type StorageLike } from './writeQueue'
import type { SupabaseNotificationsRepository } from './SupabaseNotificationsRepository'
import { captureWorkspaceCacheFence, operationalCacheMaxAgeMs, readWorkspaceCache, writeWorkspaceCache } from './workspaceCache'
import { queueTransaction } from './queueTransaction'
import { captureQueuedOperationContext, verifyQueuedOperationContext, verifyQueuedReadContext } from './queuedOperationGuard'

const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
export class QueuedNotificationsRepository implements NotificationsRepository {
  constructor(private readonly live: SupabaseNotificationsRepository, private readonly d: { getContext: () => Promise<{ userId: string; farmId: string }>; projectRef: string; storage: StorageLike; createId: () => string; clock: () => string; isOffline: () => boolean }) {}
  private async source() { const operationContext = await captureQueuedOperationContext(this.d); const context = { userId: operationContext.userId, farmId: operationContext.farmId }; return { context, operationContext, queue: new NotificationsWriteQueue(this.d.storage, notificationsWriteQueueKey(this.d.projectRef, context.userId, context.farmId)) } }
  private locked<T>(queue: NotificationsWriteQueue, task: (verify: () => void) => Promise<T>) { return queueTransaction(queue.key, this.d.storage, this.d.createId, task) }
  async getData() {
    const { context, operationContext, queue } = await this.source()
    const verifyRead = () => verifyQueuedReadContext(this.d, operationContext)
    const cacheScope = { projectRef: this.d.projectRef, ...context, module: 'notifications' }
    try {
      const cacheFence = captureWorkspaceCacheFence(cacheScope)
      const data = await this.live.getData(); await verifyRead()
      await writeWorkspaceCache(cacheScope, data, cacheFence); await verifyRead()
      return data
    } catch (error) {
      await verifyRead()
      if (!isTransportFailure(error, this.d.isOffline())) throw error
      const cached = await readWorkspaceCache<NotificationsData>(cacheScope, operationalCacheMaxAgeMs); await verifyRead()
      if (!cached) throw error
      const data = structuredClone(cached.data)
      for (const entry of queue.read().entries) { const ids = new Set(entry.ids); data.notifications = data.notifications.map((row) => ids.has(row.id) ? { ...row, read_at: row.read_at ?? entry.enqueuedAt } : row) }
      data.unreadCount = data.notifications.filter((row) => row.read_at === null).length
      await verifyRead(); return data
    }
  }
  async markRead(ids: string[]): Promise<MarkReadResult> { const { context, operationContext, queue } = await this.source(); const entry: NotificationsQueueEntryV1 = { version: 1, module: 'notifications', kind: 'markRead', operationId: this.d.createId(), userId: context.userId, farmId: context.farmId, enqueuedAt: this.d.clock(), ids: [...new Set(ids)] }; if (!entry.ids.length) throw new Error(blocked); const result = await this.locked(queue, async (verify): Promise<MarkReadResult> => { const verifyOperation = async () => { verify(); await verifyQueuedOperationContext(this.d, operationContext, entry) }; await verifyOperation(); const enqueue = async () => { await verifyOperation(); const next = queue.append(entry); setModuleSyncStatus('notifications', { kind: 'pending', pending: next.entries.length }); return { kind: 'pending' as const } }; if (this.d.isOffline() || queue.read().entries.length) return enqueue(); try { const saved = await this.live.markReadOperation(entry.ids, operationContext); await verifyOperation(); setModuleSyncStatus('notifications', { kind: 'synced', pending: 0 }); return saved } catch (error) { await verifyQueuedOperationContext(this.d, operationContext, entry); if (!isTransportFailure(error, this.d.isOffline())) throw error; return enqueue() } }); if (result.kind === 'pending') launchReplayInBackground(() => this.inspectAndReplay()); return result }
  async raiseNotification(...args: Parameters<NotificationsRepository['raiseNotification']>) { return this.live.raiseNotification(...args) }
  async savePushSubscription(...args: Parameters<NotificationsRepository['savePushSubscription']>) { return this.live.savePushSubscription(...args) }
  async deletePushSubscription(...args: Parameters<NotificationsRepository['deletePushSubscription']>) { return this.live.deletePushSubscription(...args) }
  async inspectAndReplay() { let source: Awaited<ReturnType<QueuedNotificationsRepository['source']>>; try { source = await this.source() } catch (error) { if (isFarmReplayContextChangedError(error)) throw error; return }; const { context, operationContext, queue } = source; try { await this.locked(queue, async (verify) => { await verifyQueuedOperationContext(this.d, operationContext, context); verify(); let envelope = queue.read(); if (!envelope.entries.length) { setModuleSyncStatus('notifications', { kind: 'synced', pending: 0 }); return } if (this.d.isOffline()) { setModuleSyncStatus('notifications', { kind: 'pending', pending: envelope.entries.length }); return } while (envelope.entries.length) { const entry = envelope.entries[0]; if (entry.userId !== context.userId || entry.farmId !== context.farmId) throw new Error(blocked); await verifyQueuedOperationContext(this.d, operationContext, entry); setModuleSyncStatus('notifications', { kind: 'syncing', pending: envelope.entries.length }); try { await this.live.markReadOperation(entry.ids, operationContext); verify(); await verifyQueuedOperationContext(this.d, operationContext, entry); envelope = queue.removeConfirmedHead(entry.operationId) } catch (error) { await verifyQueuedOperationContext(this.d, operationContext, entry); if (isTransportFailure(error, this.d.isOffline())) setModuleSyncStatus('notifications', { kind: 'pending', pending: envelope.entries.length }); else setModuleSyncStatus('notifications', { kind: 'blocked', pending: envelope.entries.length, message: blocked }); return } } setModuleSyncStatus('notifications', { kind: 'synced', pending: 0 }) }) } catch (error) { if (isFarmReplayContextChangedError(error)) throw error; setModuleSyncStatus('notifications', { kind: 'blocked', pending: 0, message: blocked }) } }
}
