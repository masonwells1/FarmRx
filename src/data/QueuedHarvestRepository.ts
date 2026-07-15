import { isTransportFailure } from './QueuedFieldsRepository'
import { HarvestWriteQueue, harvestWriteQueueKey, type HarvestQueueEntryV1 } from './harvestWriteQueue'
import { setModuleSyncRetryAction, setModuleSyncStatus } from './syncStatus'
import { validateHarvestDraft, type HarvestData, type HarvestDraft, type HarvestRecord, type HarvestRepository } from './harvest'
import type { StorageLike } from './writeQueue'
import type { SupabaseHarvestRepository } from './SupabaseHarvestRepository'
import { operationalCacheMaxAgeMs, readWorkspaceCache, writeWorkspaceCache } from './workspaceCache'
import { queueTransaction } from './queueTransaction'

const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
type Context = { userId: string; farmId: string }
function pendingRecord(entry: HarvestQueueEntryV1, context: Context): HarvestRecord { return { ...entry.draft, id: entry.draft.crop_assignment_id, farm_id: context.farmId, updated_at: entry.enqueuedAt, pending: true } }
function waitingForCropAssignment(error: unknown) { return error instanceof Error && /crop assignment does not belong to this farm/i.test(error.message) }

export class QueuedHarvestRepository implements HarvestRepository {
  constructor(private readonly live: SupabaseHarvestRepository, private readonly d: { getContext: () => Promise<Context>; projectRef: string; storage: StorageLike; createId: () => string; clock: () => string; isOffline: () => boolean }) { setModuleSyncRetryAction('harvest', () => this.inspectAndReplay()) }
  private async source() { const context = await this.d.getContext(); return { context, queue: new HarvestWriteQueue(this.d.storage, harvestWriteQueueKey(this.d.projectRef, context.userId, context.farmId)) } }
  private locked<T>(key: string, task: (verify: () => void) => Promise<T>) { return queueTransaction(key, this.d.storage, this.d.createId, task) }
  async getData() { const { context, queue } = await this.source(); const cacheScope = { projectRef: this.d.projectRef, ...context, module: 'harvest' }; try { await this.inspectAndReplay(); const data = await this.live.getData(); await writeWorkspaceCache(cacheScope, data); return data } catch (error) { if (!isTransportFailure(error, this.d.isOffline())) throw error; const cached = await readWorkspaceCache<HarvestData>(cacheScope, operationalCacheMaxAgeMs); if (!cached) throw error; const data = structuredClone(cached.data); for (const entry of queue.read().entries) data.fieldsData.crop_assignments = data.fieldsData.crop_assignments.map((row) => row.id === entry.draft.crop_assignment_id ? { ...row, harvested_bushels: entry.draft.harvested_bushels, harvest_date: entry.draft.harvest_date, actual_price_per_bu: entry.draft.actual_price_per_bu, updated_at: entry.enqueuedAt } : row); return data } }
  private async send(entry: HarvestQueueEntryV1) { return this.live.saveHarvestOperation(entry.draft, entry.operationId) }
  async saveHarvest(draft: HarvestDraft) {
    const validation = validateHarvestDraft(draft); if (validation) throw new Error(validation)
    const { context, queue } = await this.source(); const entry: HarvestQueueEntryV1 = { version: 1, module: 'harvest', kind: 'saveHarvest', operationId: this.d.createId(), userId: context.userId, farmId: context.farmId, enqueuedAt: this.d.clock(), draft: { crop_assignment_id: draft.crop_assignment_id, harvested_bushels: draft.harvested_bushels, harvest_date: draft.harvest_date, actual_price_per_bu: draft.actual_price_per_bu, ...(Object.hasOwn(draft, 'expected_updated_at') ? { expected_updated_at: draft.expected_updated_at ?? null } : {}) } }
    return this.locked(queue.key, async (verify) => { verify(); if (this.d.isOffline() || queue.read().entries.length) { const next = queue.append(entry); setModuleSyncStatus('harvest', { kind: 'pending', pending: next.entries.length }); void this.inspectAndReplay(); return pendingRecord(entry, context) }
      try { const result = await this.send(entry); verify(); setModuleSyncStatus('harvest', { kind: 'synced', pending: 0 }); return result } catch (error) { if (!isTransportFailure(error, this.d.isOffline())) throw error; verify(); const next = queue.append(entry); setModuleSyncStatus('harvest', { kind: 'pending', pending: next.entries.length }); void this.inspectAndReplay(); return pendingRecord(entry, context) } })
  }
  async inspectAndReplay() {
    let source: Awaited<ReturnType<QueuedHarvestRepository['source']>>; try { source = await this.source() } catch { return }
    const { context, queue } = source
    try { await this.locked(queue.key, async (verify) => { let envelope = queue.read(); if (!envelope.entries.length) { setModuleSyncStatus('harvest', { kind: 'synced', pending: 0 }); return }; if (this.d.isOffline()) { setModuleSyncStatus('harvest', { kind: 'pending', pending: envelope.entries.length }); return }
      const versions = new Map<string, string>()
      while (envelope.entries.length) { const head = envelope.entries[0]; if (head.userId !== context.userId || head.farmId !== context.farmId) throw new Error(blocked); setModuleSyncStatus('harvest', { kind: 'syncing', pending: envelope.entries.length }); try { const chained = versions.get(head.draft.crop_assignment_id); const saved = await this.send(chained ? { ...head, draft: { ...head.draft, expected_updated_at: chained } } : head); versions.set(head.draft.crop_assignment_id, saved.updated_at); verify(); envelope = queue.removeConfirmedHead(head.operationId) } catch (error) { if (isTransportFailure(error, this.d.isOffline()) || waitingForCropAssignment(error)) { setModuleSyncStatus('harvest', { kind: 'pending', pending: envelope.entries.length }); return } setModuleSyncStatus('harvest', { kind: 'blocked', pending: envelope.entries.length, message: blocked }); return } }
      setModuleSyncStatus('harvest', { kind: 'synced', pending: 0 }) })
    } catch { setModuleSyncStatus('harvest', { kind: 'blocked', pending: 0, message: blocked }) }
  }
}
