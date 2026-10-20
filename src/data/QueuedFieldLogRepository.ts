import { isTransportFailure } from './QueuedFieldsRepository'
import { FieldLogWriteQueue, fieldLogWriteQueueKey, parseFieldLogQueueForScope, type FieldLogQueueEntry, type FieldLogQueueEntryV2 } from './fieldLogWriteQueue'
import { setModuleSyncStatus } from './syncStatus'
import { validateFieldLogDraft, type FieldLogData, type FieldLogDeleteReceipt, type FieldLogEntry, type FieldLogEntryDraft, type FieldLogRepository } from './fieldLog'
import { isFarmReplayContextChangedError, launchReplayInBackground, type StorageLike } from './writeQueue'
import type { SupabaseFieldLogRepository } from './SupabaseFieldLogRepository'
import { captureWorkspaceCacheFence, operationalCacheMaxAgeMs, readWorkspaceCache, takeWorkspaceCacheTurn, writeWorkspaceCacheInOrder, type OrderedWorkspaceWrite } from './workspaceCache'
import { queueTransaction } from './queueTransaction'
import { captureQueuedOperationContext, verifyQueuedOperationContext, verifyQueuedReadContext } from './queuedOperationGuard'
import { verifyFarmOperationContext, type FarmOperationContext } from './farmOperationContext'
import { dismissNeedsAttention as dismissParked, readNeedsAttention } from './needsAttentionStore'

const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
const parked = 'This save needs attention before it can be retried.'
/** Farmer wording for the refusals only the server can make (the form already checks the rest). */
const refusalReasons: Array<[RegExp, string]> = [
  [/more than one day in the future/, 'Not saved: the observed date cannot be more than one day in the future. Check the date on this device.'],
  [/field does not belong to this farm/, 'Not saved: this field is no longer on this farm.'],
  [/entry does not belong to/, 'Not saved: this entry is now on a different field or farm.'],
]
/** Why the server refused this entry, or null when the failure is not the database refusing the entry itself: only its
 * own refusals (P0001) and bad or conflicting data (classes 22 and 23) qualify. Access refusals (no permission, signed out,
 * access changed) are about the farm, and failures such as a deadlock pass on a retry, so those still hold the queue. */
function refusedEntryReason(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code; const message = String((error as { message?: unknown } | null)?.message ?? '')
  if (typeof code !== 'string' || !/^(P0001|2[23][0-9A-Z]{3})$/.test(code) || /permission|authenticat|jwt|farm_access_epoch_changed/i.test(message)) return null
  return refusalReasons.find(([pattern]) => pattern.test(message))?.[1] ?? parked
}
type Context = { userId: string; farmId: string }
function pendingEntry(entry: Extract<FieldLogQueueEntry, { kind: 'saveEntry' }>, context: Context): FieldLogEntry {
  return { id: entry.draft.id!, farm_id: context.farmId, field_id: entry.draft.field_id, entry_type: entry.draft.entry_type, observed_on: entry.draft.observed_on, rainfall_in: entry.draft.rainfall_in, note: entry.draft.note, created_by: context.userId, created_at: entry.enqueuedAt, updated_at: entry.enqueuedAt, pending: true, operationId: entry.operationId }
}
const waitingId = (entry: FieldLogQueueEntryV2) => entry.kind === 'saveEntry' ? entry.draft.id! : entry.entryId
/** Lays writes waiting on this device over rows, in queue order: a waiting save shows as pending, keeping a listed row's
 * created time so it keeps its place, and a waiting delete takes its row out. A change parked in Needs attention has left
 * the queue, so it is never laid over. */
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
  /** The saved copy written in turn order. It has its own key: a tab still on the previous app version writes the older
   * `fieldLog:<scope>` copy without the turn check, and must not overwrite this one. */
  private savedCopyScope(context: Context, fieldId?: string) { return { projectRef: this.d.projectRef, ...context, module: `fieldLog:${fieldId ?? 'all'}:ordered` } }
  /** The copy the previous app version saved: read without signal only while no ordered copy exists yet, as that version did. */
  private previousSavedCopyScope(context: Context, fieldId?: string) { return { projectRef: this.d.projectRef, ...context, module: `fieldLog:${fieldId ?? 'all'}` } }
  /** Writes the saved copy in turn order with every tab on this device (see takeWorkspaceCacheTurn), so the page can trust it
   * once a live read settled an entry: an older answer never puts back rows from before a newer one. */
  private writeSavedCopy(scope: ReturnType<QueuedFieldLogRepository['savedCopyScope']>, write: OrderedWorkspaceWrite<FieldLogData>, turn: number | null, fence: FarmOperationContext | null) { return (this.d.writeWorkspaceCacheInOrder ?? writeWorkspaceCacheInOrder)(scope, write, turn, fence) }
  /** A save or delete the server confirmed goes into the whole-farm saved copy straight away, so an answer without signal
   * shows it before the next live read. A single field's copy, which no screen asks for, is refreshed by its own live reads.
   * Only a confirmed change comes here: a refused one is parked in Needs attention and never reaches the saved copy. Best
   * effort: without a saved copy, or once the farm's access changed, nothing is written and the save still stands. */
  private async keepInSavedCopy(entry: FieldLogQueueEntryV2, confirmed: FieldLogEntry | FieldLogDeleteReceipt) {
    const scope = this.savedCopyScope({ userId: entry.userId, farmId: entry.farmId }); const turn = await takeWorkspaceCacheTurn(scope); const id = waitingId(entry)
    const change = (copy: FieldLogData): FieldLogData => ({ ...copy, entries: 'deleted' in confirmed ? copy.entries.filter((row) => row.id !== id) : copy.entries.some((row) => row.id === id) ? copy.entries.map((row) => row.id === id ? confirmed : row) : [...copy.entries, confirmed] })
    await this.writeSavedCopy(scope, { change }, turn, entry.operationContext)
  }
  async getNeedsAttentionQueueKey() { return (await this.source()).queue.key }
  /** Status from what is parked and what still waits: "synced" only when nothing is either. */
  private syncOrParked(queue: FieldLogWriteQueue) {
    const count = readNeedsAttention(this.d.storage, queue.key).length; if (count) { setModuleSyncStatus('fieldLog', { kind: 'blocked', pending: count, message: `${count} saves need attention.` }); return }
    let waiting: number; try { waiting = queue.read().entries.length } catch { setModuleSyncStatus('fieldLog', { kind: 'blocked', pending: 0, message: blocked }); return }
    setModuleSyncStatus('fieldLog', waiting ? { kind: 'pending', pending: waiting } : { kind: 'synced', pending: 0 })
  }
  async getData(fieldId?: string) {
    const { context, operationContext, queue } = await this.source()
    const verifyRead = () => verifyQueuedReadContext(this.d, operationContext)
    const cacheScope = this.savedCopyScope(context, fieldId)
    try {
      const cacheFence = captureWorkspaceCacheFence(cacheScope); const turn = await takeWorkspaceCacheTurn(cacheScope)
      // Writes still waiting when the read starts, read before the server so one sent during the read still shows (as not
      // sent yet, until the next read). Unreadable bytes never break a live read; they leave the waiting list unknown.
      let waiting: FieldLogQueueEntryV2[] | undefined
      try { waiting = queue.read().entries.filter((entry): entry is FieldLogQueueEntryV2 => entry.version === 2) } catch { waiting = undefined }
      const data = await this.live.getData(fieldId); await verifyRead()
      await this.writeSavedCopy(cacheScope, { replace: data }, turn, cacheFence); await verifyRead()
      if (!waiting) return data
      // Only writes made under this farm access are laid over the rows: one from an earlier access can never be sent.
      const current = waiting.filter((entry) => { try { verifyFarmOperationContext(this.d.storage, entry.operationContext, operationContext); return true } catch { return false } })
      return { ...data, entries: layWaitingWrites(data.entries, current, fieldId, context), waitingIds: waiting.map(waitingId) }
    } catch (error) {
      await verifyRead()
      if (!isTransportFailure(error, this.d.isOffline())) throw error
      const readCache = this.d.readWorkspaceCache ?? readWorkspaceCache
      let cached = await readCache<FieldLogData>(cacheScope, operationalCacheMaxAgeMs); await verifyRead()
      if (!cached) { cached = await readCache<FieldLogData>(this.previousSavedCopyScope(context, fieldId), operationalCacheMaxAgeMs); await verifyRead() }
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
    return this.locked(queue.key, async (verify) => { const verifyOperation = async () => { verify(); await verifyQueuedOperationContext(this.d, operationContext, entry) }; await verifyOperation(); if (this.d.isOffline() || queue.read().entries.length) { await verifyOperation(); queue.append(entry); this.syncOrParked(queue); launchReplayInBackground(() => this.inspectAndReplay()); return }
      try { const result = await this.write(entry); await this.keepInSavedCopy(entry, result); await verifyOperation(); this.syncOrParked(queue); return result } catch (error) { await verifyQueuedOperationContext(this.d, operationContext, entry); if (!isTransportFailure(error, this.d.isOffline())) throw error; await verifyOperation(); queue.append(entry); this.syncOrParked(queue); launchReplayInBackground(() => this.inspectAndReplay()); return } })
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
    try { await this.locked(queue.key, async (verify) => { await verifyQueuedOperationContext(this.d, operationContext, context); verify(); let envelope = queue.read(); if (!envelope.entries.length) { this.syncOrParked(queue); return }
      let parkedLegacy = false
      while (envelope.entries[0]?.version === 1) { const head = envelope.entries[0]; if (head.userId !== context.userId || head.farmId !== context.farmId) throw new Error(blocked); envelope = queue.parkLegacyHead(head.operationId); parkedLegacy = true }
      if (parkedLegacy) { setModuleSyncStatus('fieldLog', { kind: 'blocked', pending: envelope.entries.length, message: blocked }); return }
      if (this.d.isOffline()) { this.syncOrParked(queue); return }
      while (envelope.entries.length) { const head = envelope.entries[0]; if (head.userId !== context.userId || head.farmId !== context.farmId) throw new Error(blocked); if (head.version === 1) { envelope = queue.parkLegacyHead(head.operationId); setModuleSyncStatus('fieldLog', { kind: 'blocked', pending: envelope.entries.length, message: blocked }); return } await verifyQueuedOperationContext(this.d, head.operationContext, head); setModuleSyncStatus('fieldLog', { kind: 'syncing', pending: envelope.entries.length }); try { const confirmed = await this.write(head); await this.keepInSavedCopy(head, confirmed); verify(); await verifyQueuedOperationContext(this.d, head.operationContext, head); envelope = queue.removeConfirmedHead(head.operationId) } catch (error) { await verifyQueuedOperationContext(this.d, head.operationContext, head); if (isTransportFailure(error, this.d.isOffline())) { this.syncOrParked(queue); return }
          // A refusal of this entry moves it to Needs attention so the saves behind it carry on; anything else still holds the queue.
          const reason = refusedEntryReason(error); if (!reason) { setModuleSyncStatus('fieldLog', { kind: 'blocked', pending: envelope.entries.length, message: blocked }); return } verify(); envelope = queue.parkHead(head.operationId, reason) } }
      this.syncOrParked(queue) })
    } catch (error) { if (isFarmReplayContextChangedError(error)) throw error; setModuleSyncStatus('fieldLog', { kind: 'blocked', pending: 0, message: blocked }) }
  }
  /** Retry from Needs attention: the same saved change goes back on this farm's queue under the custody checks it was
   * saved with, then sends. A change whose date is now ahead of this device is not queued again; the farmer re-enters it. */
  async retryNeedsAttention(expectedQueueKey: string, operationId: string) {
    const { context, operationContext, queue } = await this.source()
    await this.locked(queue.key, async (verify) => {
      await verifyQueuedOperationContext(this.d, operationContext, context); verify()
      const record = queue.key === expectedQueueKey ? readNeedsAttention(this.d.storage, queue.key).find((item) => item.id === operationId) : undefined
      if (!record) throw new Error(blocked)
      const draft = (record.entry as { draft?: unknown } | null)?.draft; const invalid = draft && typeof draft === 'object' ? validateFieldLogDraft(draft as FieldLogEntryDraft) : null
      if (invalid) throw new Error(`${invalid} Dismiss this change and enter it again.`)
      const entry = parseFieldLogQueueForScope(JSON.stringify({ version: 1, entries: [record.entry] }), { projectRef: this.d.projectRef, ...context }).entries[0]
      if (entry?.version !== 2 || entry.operationId !== operationId) throw new Error(blocked)
      await verifyQueuedOperationContext(this.d, entry.operationContext, entry); verify()
      const active = queue.read().entries.find((candidate) => candidate.operationId === operationId)
      if (active && JSON.stringify(active) !== JSON.stringify(entry)) throw new Error(blocked)
      if (!active) queue.append(entry)
      verify(); await verifyQueuedOperationContext(this.d, entry.operationContext, entry)
      dismissParked(this.d.storage, queue.key, operationId)
    })
    await this.inspectAndReplay()
    let waiting: FieldLogQueueEntry | undefined; try { waiting = queue.read().entries.find((candidate) => candidate.operationId === operationId) } catch { waiting = undefined }
    return waiting?.kind === 'saveEntry' ? pendingEntry(waiting, context) : null
  }
  /** Dismiss from Needs attention, only from the account and farm whose queue the page showed, so a page left open across a
   * switch cannot discard another queue's change. The change's own custody is not required: the farmer can always let it go. */
  async dismissNeedsAttention(expectedQueueKey: string, operationId: string) {
    const { context, operationContext, queue } = await this.source()
    await this.locked(queue.key, async (verify) => {
      await verifyQueuedOperationContext(this.d, operationContext, context); verify()
      if (queue.key !== expectedQueueKey || !readNeedsAttention(this.d.storage, queue.key).some((item) => item.id === operationId)) throw new Error(blocked)
      dismissParked(this.d.storage, queue.key, operationId)
    })
    this.syncOrParked(queue)
  }
}
