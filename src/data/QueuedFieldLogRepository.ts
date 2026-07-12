import { isTransportFailure } from './QueuedFieldsRepository'
import { FieldLogWriteQueue, fieldLogWriteQueueKey, type FieldLogQueueEntryV1 } from './fieldLogWriteQueue'
import { setModuleSyncRetryAction, setModuleSyncStatus } from './syncStatus'
import { validateFieldLogDraft, type FieldLogEntry, type FieldLogEntryDraft, type FieldLogRepository } from './fieldLog'
import type { StorageLike } from './writeQueue'
import type { SupabaseFieldLogRepository } from './SupabaseFieldLogRepository'

const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
type Context = { userId: string; farmId: string }
const processLocks = new Map<string, Promise<void>>()
const leaseTtl = 6_000
function pendingEntry(entry: Extract<FieldLogQueueEntryV1, { kind: 'saveEntry' }>, context: Context): FieldLogEntry {
  return { id: entry.draft.id!, farm_id: context.farmId, field_id: entry.draft.field_id, entry_type: entry.draft.entry_type, observed_on: entry.draft.observed_on, rainfall_in: entry.draft.rainfall_in, note: entry.draft.note, created_by: context.userId, created_at: entry.enqueuedAt, updated_at: entry.enqueuedAt, pending: true }
}
async function serial<T>(key: string, task: () => Promise<T>): Promise<T> { const previous = processLocks.get(key) ?? Promise.resolve(); let release!: () => void; const next = new Promise<void>((resolve) => { release = resolve }); processLocks.set(key, previous.then(() => next)); await previous; try { return await task() } finally { release(); if (processLocks.get(key) === next) processLocks.delete(key) } }
async function crossTabLock<T>(key: string, storage: StorageLike, createId: () => string, task: (verify: () => void) => Promise<T>): Promise<T> { const name = `farm-rx-field-log:${key}`; if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(name, async () => task(() => undefined)); const leaseKey = `${key}:lease`; const token = createId(); let lease = ''; const owns = () => storage.getItem(leaseKey) === lease; const renew = () => { if (!owns()) throw new Error(blocked); lease = JSON.stringify({ token, expiresAt: Date.now() + leaseTtl }); storage.setItem(leaseKey, lease); if (!owns()) throw new Error(blocked) }; const existing = storage.getItem(leaseKey); try { if (existing) { const parsed = JSON.parse(existing) as { expiresAt?: unknown }; if (typeof parsed.expiresAt === 'number' && parsed.expiresAt > Date.now()) throw new Error(blocked) } lease = JSON.stringify({ token, expiresAt: Date.now() + leaseTtl }); storage.setItem(leaseKey, lease); if (!owns()) throw new Error(blocked); const timer = setInterval(() => { try { renew() } catch { /* guarded mutation will fail closed */ } }, Math.floor(leaseTtl / 3)); try { return await task(renew) } finally { clearInterval(timer); if (owns()) storage.removeItem(leaseKey) } } catch (error) { throw error instanceof Error ? error : new Error(blocked) } }
export class QueuedFieldLogRepository implements FieldLogRepository {
  constructor(private readonly live: SupabaseFieldLogRepository, private readonly d: { getContext: () => Promise<Context>; projectRef: string; storage: StorageLike; createId: () => string; clock: () => string; isOffline: () => boolean }) { setModuleSyncRetryAction('fieldLog', () => { void this.inspectAndReplay() }); if (typeof window !== 'undefined') window.addEventListener('online', () => { void this.inspectAndReplay() }) }
  private async source() { const context = await this.d.getContext(); return { context, queue: new FieldLogWriteQueue(this.d.storage, fieldLogWriteQueueKey(this.d.projectRef, context.userId, context.farmId)) } }
  private locked<T>(storageKey: string, task: (verify: () => void) => Promise<T>) { return serial(storageKey, () => crossTabLock(storageKey, this.d.storage, this.d.createId, task)) }
  async getData(fieldId?: string) { return this.live.getData(fieldId) }
  private base<K extends FieldLogQueueEntryV1['kind']>(kind: K, context: Context) { return { version: 1 as const, module: 'fieldLog' as const, kind, operationId: this.d.createId(), userId: context.userId, farmId: context.farmId, enqueuedAt: this.d.clock() } }
  private async write(entry: FieldLogQueueEntryV1): Promise<FieldLogEntry | void> { if (entry.kind === 'saveEntry') return this.live.saveEntryOperation(entry.draft, entry.operationId); return this.live.deleteEntry(entry.entryId) }
  private async save(entry: FieldLogQueueEntryV1): Promise<FieldLogEntry | void> {
    const source = await this.source(); const { context, queue } = source; if (entry.userId !== context.userId || entry.farmId !== context.farmId) throw new Error(blocked)
    return this.locked(queue.key, async (verify) => { verify(); if (this.d.isOffline() || queue.read().entries.length) { const next = queue.append(entry); setModuleSyncStatus('fieldLog', { kind: 'pending', pending: next.entries.length }); void this.inspectAndReplay(); return }
      try { const result = await this.write(entry); verify(); setModuleSyncStatus('fieldLog', { kind: 'synced', pending: 0 }); return result } catch (error) { if (!isTransportFailure(error, this.d.isOffline())) throw error; verify(); const next = queue.append(entry); setModuleSyncStatus('fieldLog', { kind: 'pending', pending: next.entries.length }); void this.inspectAndReplay(); return } })
  }
  async saveEntry(draft: FieldLogEntryDraft) {
    const validation = validateFieldLogDraft(draft); if (validation) throw new Error(validation)
    const { context } = await this.source(); const entry = { ...this.base('saveEntry', context), draft: { ...draft, id: draft.id ?? this.d.createId() } } as Extract<FieldLogQueueEntryV1, { kind: 'saveEntry' }>
    const result = await this.save(entry); return result ?? pendingEntry(entry, context)
  }
  async deleteEntry(entryId: string) { const { context } = await this.source(); await this.save({ ...this.base('deleteEntry', context), entryId } as FieldLogQueueEntryV1) }
  async inspectAndReplay() {
    let source: Awaited<ReturnType<QueuedFieldLogRepository['source']>>; try { source = await this.source() } catch { return }
    const { context, queue } = source
    try { await this.locked(queue.key, async (verify) => { let envelope = queue.read(); if (!envelope.entries.length) { setModuleSyncStatus('fieldLog', { kind: 'synced', pending: 0 }); return } if (this.d.isOffline()) { setModuleSyncStatus('fieldLog', { kind: 'pending', pending: envelope.entries.length }); return }
      while (envelope.entries.length) { const head = envelope.entries[0]; if (head.userId !== context.userId || head.farmId !== context.farmId) throw new Error(blocked); setModuleSyncStatus('fieldLog', { kind: 'syncing', pending: envelope.entries.length }); try { await this.write(head); verify(); envelope = queue.removeConfirmedHead(head.operationId) } catch (error) { if (isTransportFailure(error, this.d.isOffline())) { setModuleSyncStatus('fieldLog', { kind: 'pending', pending: envelope.entries.length }); return } setModuleSyncStatus('fieldLog', { kind: 'blocked', pending: envelope.entries.length, message: blocked }); return } }
      setModuleSyncStatus('fieldLog', { kind: 'synced', pending: 0 }) })
    } catch { setModuleSyncStatus('fieldLog', { kind: 'blocked', pending: 0, message: blocked }) }
  }
}
