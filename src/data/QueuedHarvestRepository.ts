import { isTransportFailure } from './QueuedFieldsRepository'
import { HarvestWriteQueue, harvestWriteQueueKey, type HarvestQueueEntryV1 } from './harvestWriteQueue'
import { setModuleSyncRetryAction, setModuleSyncStatus } from './syncStatus'
import { validateHarvestDraft, type HarvestDraft, type HarvestRecord, type HarvestRepository } from './harvest'
import type { StorageLike } from './writeQueue'
import type { SupabaseHarvestRepository } from './SupabaseHarvestRepository'

const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
type Context = { userId: string; farmId: string }
const processLocks = new Map<string, Promise<void>>()
const leaseTtl = 6_000
function pendingRecord(entry: HarvestQueueEntryV1, context: Context): HarvestRecord { return { ...entry.draft, id: entry.draft.crop_assignment_id, farm_id: context.farmId, pending: true } }
async function serial<T>(key: string, task: () => Promise<T>): Promise<T> { const previous = processLocks.get(key) ?? Promise.resolve(); let release!: () => void; const next = new Promise<void>((resolve) => { release = resolve }); processLocks.set(key, previous.then(() => next)); await previous; try { return await task() } finally { release(); if (processLocks.get(key) === next) processLocks.delete(key) } }
function waitingForCropAssignment(error: unknown) { return error instanceof Error && /crop assignment does not belong to this farm/i.test(error.message) }
async function crossTabLock<T>(key: string, storage: StorageLike, createId: () => string, task: (verify: () => void) => Promise<T>): Promise<T> { const name = `farm-rx-harvest:${key}`; if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(name, async () => task(() => undefined)); const leaseKey = `${key}:lease`; const token = createId(); let lease = ''; const owns = () => storage.getItem(leaseKey) === lease; const renew = () => { if (!owns()) throw new Error(blocked); lease = JSON.stringify({ token, expiresAt: Date.now() + leaseTtl }); storage.setItem(leaseKey, lease); if (!owns()) throw new Error(blocked) }; const existing = storage.getItem(leaseKey); try { if (existing) { const parsed = JSON.parse(existing) as { expiresAt?: unknown }; if (typeof parsed.expiresAt === 'number' && parsed.expiresAt > Date.now()) throw new Error(blocked) } lease = JSON.stringify({ token, expiresAt: Date.now() + leaseTtl }); storage.setItem(leaseKey, lease); if (!owns()) throw new Error(blocked); const timer = setInterval(() => { try { renew() } catch { /* the next guarded mutation fails closed */ } }, Math.floor(leaseTtl / 3)); try { return await task(renew) } finally { clearInterval(timer); if (owns()) storage.removeItem(leaseKey) } } catch (error) { throw error instanceof Error ? error : new Error(blocked) } }

export class QueuedHarvestRepository implements HarvestRepository {
  constructor(private readonly live: SupabaseHarvestRepository, private readonly d: { getContext: () => Promise<Context>; projectRef: string; storage: StorageLike; createId: () => string; clock: () => string; isOffline: () => boolean }) { setModuleSyncRetryAction('harvest', () => this.inspectAndReplay()) }
  private async source() { const context = await this.d.getContext(); return { context, queue: new HarvestWriteQueue(this.d.storage, harvestWriteQueueKey(this.d.projectRef, context.userId, context.farmId)) } }
  private locked<T>(key: string, task: (verify: () => void) => Promise<T>) { return serial(key, () => crossTabLock(key, this.d.storage, this.d.createId, task)) }
  async getData() { return this.live.getData() }
  private async send(entry: HarvestQueueEntryV1) { return this.live.saveHarvestOperation(entry.draft, entry.operationId) }
  async saveHarvest(draft: HarvestDraft) {
    const validation = validateHarvestDraft(draft); if (validation) throw new Error(validation)
    const { context, queue } = await this.source(); const entry: HarvestQueueEntryV1 = { version: 1, module: 'harvest', kind: 'saveHarvest', operationId: this.d.createId(), userId: context.userId, farmId: context.farmId, enqueuedAt: this.d.clock(), draft: { crop_assignment_id: draft.crop_assignment_id, harvested_bushels: draft.harvested_bushels, harvest_date: draft.harvest_date, actual_price_per_bu: draft.actual_price_per_bu } }
    return this.locked(queue.key, async (verify) => { verify(); if (this.d.isOffline() || queue.read().entries.length) { const next = queue.append(entry); setModuleSyncStatus('harvest', { kind: 'pending', pending: next.entries.length }); void this.inspectAndReplay(); return pendingRecord(entry, context) }
      try { const result = await this.send(entry); verify(); setModuleSyncStatus('harvest', { kind: 'synced', pending: 0 }); return result } catch (error) { if (!isTransportFailure(error, this.d.isOffline())) throw error; verify(); const next = queue.append(entry); setModuleSyncStatus('harvest', { kind: 'pending', pending: next.entries.length }); void this.inspectAndReplay(); return pendingRecord(entry, context) } })
  }
  async inspectAndReplay() {
    let source: Awaited<ReturnType<QueuedHarvestRepository['source']>>; try { source = await this.source() } catch { return }
    const { context, queue } = source
    try { await this.locked(queue.key, async (verify) => { let envelope = queue.read(); if (!envelope.entries.length) { setModuleSyncStatus('harvest', { kind: 'synced', pending: 0 }); return }; if (this.d.isOffline()) { setModuleSyncStatus('harvest', { kind: 'pending', pending: envelope.entries.length }); return }
      while (envelope.entries.length) { const head = envelope.entries[0]; if (head.userId !== context.userId || head.farmId !== context.farmId) throw new Error(blocked); setModuleSyncStatus('harvest', { kind: 'syncing', pending: envelope.entries.length }); try { await this.send(head); verify(); envelope = queue.removeConfirmedHead(head.operationId) } catch (error) { if (isTransportFailure(error, this.d.isOffline()) || waitingForCropAssignment(error)) { setModuleSyncStatus('harvest', { kind: 'pending', pending: envelope.entries.length }); return } setModuleSyncStatus('harvest', { kind: 'blocked', pending: envelope.entries.length, message: blocked }); return } }
      setModuleSyncStatus('harvest', { kind: 'synced', pending: 0 }) })
    } catch { setModuleSyncStatus('harvest', { kind: 'blocked', pending: 0, message: blocked }) }
  }
}
