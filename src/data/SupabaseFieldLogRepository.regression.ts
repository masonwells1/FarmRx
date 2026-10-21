import { QueuedFieldLogRepository } from './QueuedFieldLogRepository'
import type { FieldLogDataGateway } from './FieldLogDataGateway'
import { FieldLogWriteQueue, fieldLogWriteQueueKey } from './fieldLogWriteQueue'
import { canEditFieldLog, SupabaseFieldLogRepository } from './SupabaseFieldLogRepository'
import type { FarmOperationContext } from './farmOperationContext'
import { captureFarmRevocationFence, resetFarmGrantFromLive, resetFarmRevokedFromLive } from './farmRevocationFence'
import { readNeedsAttention } from './needsAttentionStore'
import { getModuleSyncStatus } from './syncStatus'
import { quarantineRevokedFarmWork, readRevokedFarmRecovery } from './revokedFarmRecovery'
import { FIELD_LOG_DELETED_ENTRY_MESSAGE, isFieldLogDeletedEntryRefusal, type FieldLogData, type FieldLogEntryDraft } from './fieldLog'
import { farmerError } from '../lib/farmerErrors'
import { captureWorkspaceCacheFence, takeWorkspaceCacheTurn, writeWorkspaceCache, writeWorkspaceCacheInOrder } from './workspaceCache'
import type { StorageLike } from './writeQueue'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const farm = uid(1); const otherFarm = uid(2); const actor = uid(3); const field = uid(4); const otherField = uid(5); const stamp = '2026-07-12T12:30:00.123456+00:00'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => Promise<unknown>, message: string) { let failed = false; try { await action() } catch { failed = true }; assert(failed, message) }
function memory(): StorageLike & { values: Map<string, string>; readonly length: number; key(index: number): string | null } { const values = new Map<string, string>(); return { values, get length() { return values.size }, key: (index) => [...values.keys()][index] ?? null, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) } }
function draft(id = uid(10), type: 'rainfall' | 'note' = 'rainfall'): FieldLogEntryDraft { return type === 'rainfall' ? { id, field_id: field, entry_type: type, observed_on: '2026-07-10', rainfall_in: 0.8, note: 'Storm total' } : { id, field_id: field, entry_type: type, observed_on: '2026-07-10', rainfall_in: null, note: 'First cutting' } }
function canonical(value: FieldLogEntryDraft, farmId = farm) { return { id: value.id!, farm_id: farmId, field_id: value.field_id, entry_type: value.entry_type, observed_on: value.observed_on, rainfall_in: value.rainfall_in, note: value.note, created_by: actor, created_at: stamp, updated_at: stamp } }
class FakeGateway implements FieldLogDataGateway {
  entries: unknown[] = []; role: unknown = { role: 'worker' }; saves: Array<{ operationId: string; entry: FieldLogEntryDraft; context: FarmOperationContext }> = []; deletes: Array<{ entryId: string; context: FarmOperationContext }> = []; mutateSave: (value: unknown) => unknown = (value) => value; mutateDelete: (value: unknown) => unknown = (value) => value; saveFailure: Error | null = null; loadFailure: Error | null = null; refuseSave: (entry: FieldLogEntryDraft) => Error | null = () => null; refuseDelete: (entryId: string) => Error | null = () => null
  async loadEntries(farmId: string) { if (this.loadFailure) throw this.loadFailure; return structuredClone(this.entries.filter((entry) => (entry as { farm_id: string }).farm_id === farmId)) }
  async loadViewerRole() { if (this.loadFailure) throw this.loadFailure; return structuredClone(this.role) }
  async saveEntry(input: { farmId: string; operationId: string; entry: FieldLogEntryDraft }, context: FarmOperationContext) { this.saves.push({ operationId: input.operationId, entry: structuredClone(input.entry), context: structuredClone(context) }); const refusal = this.refuseSave(input.entry); if (refusal) throw refusal; const existing = this.entries.find((entry) => (entry as { id: string }).id === input.entry.id); const result = existing ?? canonical(input.entry, input.farmId); if (!existing) this.entries.push(result); if (this.saveFailure) throw this.saveFailure; return structuredClone(this.mutateSave(result)) }
  async deleteEntry(input: { farmId: string; entryId: string }, context: FarmOperationContext) { this.deletes.push({ entryId: input.entryId, context: structuredClone(context) }); const refusal = this.refuseDelete(input.entryId); if (refusal) throw refusal; this.entries = this.entries.filter((entry) => (entry as { farm_id: string; id: string }).farm_id !== input.farmId || (entry as { id: string }).id !== input.entryId); return structuredClone(this.mutateDelete({ id: input.entryId, deleted: true })) }
}
async function until(check: () => boolean, failure: string) { for (let tries = 0; !check(); tries += 1) { if (tries > 1_000) throw new Error(failure); await new Promise<void>((resolve) => setTimeout(resolve, 0)) } }
/** One device for saved-copy tests, shared by every tab on it: its localStorage, a small IndexedDB stand-in that, like the
 * browser, runs one transaction at a time, and a device clock that moves on a millisecond each time it is read. */
function deviceCache() {
  const storage = memory(); const records = new Map<string, unknown>(); let transactions = Promise.resolve(); let now = Date.UTC(2026, 6, 13, 9)
  const later = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
  const database = { objectStoreNames: { contains: (name: string) => name === 'workspaces' }, close: () => undefined, transaction: () => {
    const steps: Array<() => void> = []
    const request = (run: () => unknown) => { const handle: { result?: unknown; onsuccess?: () => void } = {}; steps.push(() => { handle.result = run(); handle.onsuccess?.() }); return handle }
    const store = { get: (key: string) => request(() => structuredClone(records.get(key))), put: (value: { key: string }) => request(() => { records.set(value.key, structuredClone(value)) }), delete: (key: string) => request(() => { records.delete(key) }) }
    const transaction: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; objectStore: () => typeof store } = { objectStore: () => store }
    transactions = transactions.then(async () => { await later(); while (steps.length) { try { steps.shift()!() } catch { /* a failed step ends only its own work */ } await later() } transaction.oncomplete?.() })
    return transaction
  } }
  const factory = { open: () => { const handle: { result?: unknown; onsuccess?: () => void } = {}; setTimeout(() => { handle.result = database; handle.onsuccess?.() }); return handle } }
  const prior = { indexedDB: Object.getOwnPropertyDescriptor(globalThis, 'indexedDB'), localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage') }
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: factory }); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  const savedCopy = (projectRef: string) => (records.get(`${projectRef}:${actor}:${farm}:fieldLog:all:ordered`) as { data?: FieldLogData } | undefined)?.data
  return {
    storage, records, clock: () => new Date(now++).toISOString(), savedCopy,
    savedIds: (projectRef: string) => savedCopy(projectRef)?.entries.map((entry) => entry.id).join() ?? 'no saved copy',
    restore: () => { for (const [name, descriptor] of Object.entries(prior)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name) } },
  }
}
function live(gateway: FakeGateway, farmId = farm) { let next = 100; const operationContext = { projectRef: 'test', userId: actor, farmId, generation: 1, token: uid(900), serverEpoch: 1 }; return new SupabaseFieldLogRepository({ gateway, getFarmId: async () => farmId, getUserId: async () => actor, getOperationContext: async () => operationContext, verifyOperationContext: async () => undefined, createId: () => uid(next++) }) }

async function run() {
  // Group 1: canonical rainfall and note writes preserve farm, field, type, and values.
  const gateway = new FakeGateway(); const repository = live(gateway); const rain = await repository.saveEntry(draft()); const note = await repository.saveEntry(draft(uid(11), 'note')); assert(rain.rainfall_in === 0.8 && note.note === 'First cutting' && gateway.saves.length === 2, 'Both field-log write kinds must reach the canonical gateway.')
  await rejects(() => repository.saveEntry({ ...draft(uid(12)), entry_type: 'note', rainfall_in: 1, note: 'Wrong shape' }), 'A note with rainfall must fail closed.')
  await rejects(() => repository.saveEntry({ ...draft(uid(13)), entry_type: 'rainfall', rainfall_in: null }), 'Rainfall without inches must fail closed.')
  await rejects(() => repository.saveEntry({ ...draft(uid(14)), observed_on: '2099-01-01' }), 'Dates beyond the database future bound must fail before writing.')
  await rejects(() => repository.saveEntry({ ...draft(uid(15)), note: 'x'.repeat(501) }), 'Notes over 500 characters must fail before writing.')
  await rejects(() => repository.saveEntry({ ...draft(uid(16)), note: '   ' }), 'A supplied blank rainfall note must fail before writing.')

  // Group 2: wrong canonical echoes and delete replies are rejected.
  const wrongSave = new FakeGateway(); wrongSave.mutateSave = (value) => ({ ...(value as object), field_id: otherField }); await rejects(() => live(wrongSave).saveEntry(draft()), 'A save echo with a different field must be rejected.')
  const wrongFarm = new FakeGateway(); wrongFarm.mutateSave = (value) => ({ ...(value as object), farm_id: otherFarm }); await rejects(() => live(wrongFarm).saveEntry(draft()), 'A save echo with a different farm must be rejected.')
  const wrongId = new FakeGateway(); wrongId.mutateSave = (value) => ({ ...(value as object), id: uid(98) }); await rejects(() => live(wrongId).saveEntry(draft()), 'A save echo with a different ID must be rejected.')
  const wrongType = new FakeGateway(); wrongType.mutateSave = (value) => ({ ...(value as object), entry_type: 'note', rainfall_in: null, note: 'Wrong type' }); await rejects(() => live(wrongType).saveEntry(draft()), 'A save echo with a different type must be rejected.')
  const wrongValue = new FakeGateway(); wrongValue.mutateSave = (value) => ({ ...(value as object), rainfall_in: 0.9 }); await rejects(() => live(wrongValue).saveEntry(draft()), 'A save echo with a different rainfall value must be rejected.')
  const wrongDelete = new FakeGateway(); wrongDelete.mutateDelete = () => ({ id: uid(99), deleted: true }); await rejects(() => live(wrongDelete).deleteEntry(uid(10)), 'A delete echo with a different ID must be rejected.')

  // Group 3: farm isolation and unknown viewer roles fail closed.
  const isolation = new FakeGateway(); isolation.entries = [canonical(draft(), otherFarm)]; const data = await live(isolation).getData(); assert(data.entries.length === 0, 'Loading a farm must not leak another farm’s entries.')
  const foreign = new FakeGateway(); foreign.entries = [canonical(draft(), otherFarm)]; foreign.loadEntries = async () => structuredClone(foreign.entries); await rejects(() => live(foreign).getData(), 'A gateway that returns a foreign farm row must fail closed.')
  const viewer = new FakeGateway(); viewer.role = { role: 'admin' }; await rejects(() => live(viewer).getData(), 'An unknown viewer role must fail closed.'); assert(!canEditFieldLog('read_only') && canEditFieldLog('worker'), 'Read-only members must fail closed while workers retain write access.')

  // Group 4: offline FIFO replay keeps the original operation receipt ID.
  const store = memory(); const queueGateway = new FakeGateway(); const queueLive = live(queueGateway); let offline = true; let next = 200; const queued = new QueuedFieldLogRepository(queueLive, { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: 'test', storage: store, createId: () => uid(next++), clock: () => stamp, isOffline: () => offline })
  const pending = await queued.saveEntry(draft(uid(20))); const queue = new FieldLogWriteQueue(store, fieldLogWriteQueueKey('test', actor, farm)); const savedEntry = queue.read().entries[0]; assert(savedEntry.kind === 'saveEntry' && savedEntry.draft.id === uid(20) && pending.pending && pending.id === uid(20), 'Offline saves must return a visible pending entry with a stable entry ID before enqueue.')
  assert(savedEntry.version === 2 && savedEntry.operationContext.projectRef === 'test' && savedEntry.operationContext.userId === actor && savedEntry.operationContext.farmId === farm && savedEntry.operationContext.generation >= 1 && savedEntry.operationContext.serverEpoch === 1 && !!savedEntry.operationContext.token, 'Offline saves must persist their exact operation-era farm context.')
  offline = false; await queued.inspectAndReplay(); queue.append(savedEntry); await queued.inspectAndReplay(); assert(queueGateway.saves.map((call) => call.operationId).every((operationId) => operationId === savedEntry.operationId) && queueGateway.saves.every((call) => JSON.stringify(call.context) === JSON.stringify(savedEntry.operationContext)), 'Replaying the same queue item must reuse one operation receipt ID and its saved custody context.')

  // Group 5: delete is FIFO and idempotent on its canonical {id, deleted:true} response.
  offline = true; await queued.deleteEntry(uid(20)); const deleteEntry = queue.read().entries[0]; assert(deleteEntry.kind === 'deleteEntry', 'Offline delete must use its own queue kind.'); offline = false; await queued.inspectAndReplay(); queue.append(deleteEntry); await queued.inspectAndReplay(); assert(queueGateway.deletes.filter((call) => call.entryId === uid(20)).length === 2 && queue.read().entries.length === 0, 'Repeated delete replay must stay successful and clear its queue entry.')

  // Group 6: replay rejects a mismatched canonical row instead of discarding the queued write.
  offline = true; const mismatched = await queued.saveEntry(draft(uid(40))); assert(mismatched.pending, 'A replay test needs a queued local entry.'); queueGateway.mutateSave = (value) => ({ ...(value as object), id: uid(41) }); offline = false; await queued.inspectAndReplay(); assert(queue.read().entries.length === 1 && queue.read().entries[0].kind === 'saveEntry', 'A replay returning a different row ID must remain blocked in the queue.'); queueGateway.mutateSave = (value) => value

  // Group 7: append remains a defense-in-depth fence after removal has
  // quarantined old work; cross-tab ordering is owned by queueTransaction.
  const raceStore = memory(); const raceProject = 'revoked-append-race'; const raceScope = { projectRef: raceProject, userId: actor, farmId: farm }; const raceQueue = new FieldLogWriteQueue(raceStore, fieldLogWriteQueueKey(raceProject, actor, farm))
  resetFarmGrantFromLive(raceStore, raceScope, 1, stamp)
  const preservedContext = captureFarmRevocationFence(raceStore, raceScope)
  const preservedEntry = { version: 2 as const, module: 'fieldLog' as const, kind: 'saveEntry' as const, operationId: uid(450), userId: actor, farmId: farm, enqueuedAt: stamp, operationContext: preservedContext, draft: draft(uid(451), 'note') }
  raceQueue.append(preservedEntry)
  quarantineRevokedFarmWork(raceStore, raceScope, stamp); resetFarmRevokedFromLive(raceStore, raceScope, 2, stamp)
  await rejects(async () => raceQueue.append({ ...preservedEntry, operationId: uid(452) }), 'A revoked Field Log queue accepted stale custody at its append boundary.')
  assert(raceStore.getItem(raceQueue.key) === null, 'A revoked Field Log append left stale bytes in the active queue.')
  assert(readRevokedFarmRecovery(raceStore, raceProject, actor).some((record) => record.originalKey === raceQueue.key && (record.payload as { entries?: Array<{ operationId?: string }> }).entries?.[0]?.operationId === preservedEntry.operationId), 'Removed Field Log work was not retained for export.')

  // Group 8: a same-ID revoke/regrant cannot upgrade old queued work to the new access epoch.
  const regrantStore = memory(); let regrantOffline = true; const regrantGateway = new FakeGateway(); const regrantProject = 'regrant-field-log'; let regrantId = 500
  const regrantQueued = new QueuedFieldLogRepository(live(regrantGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: regrantProject, storage: regrantStore, createId: () => uid(regrantId++), clock: () => stamp, isOffline: () => regrantOffline })
  await regrantQueued.saveEntry(draft(uid(501))); const regrantQueue = new FieldLogWriteQueue(regrantStore, fieldLogWriteQueueKey(regrantProject, actor, farm)); const regrantBytes = regrantStore.getItem(regrantQueue.key); const oldCustody = regrantQueue.read().entries[0]
  resetFarmGrantFromLive(regrantStore, { projectRef: regrantProject, userId: actor, farmId: farm }, 2, '2026-07-12T13:00:00.000Z'); regrantOffline = false
  await rejects(() => regrantQueued.inspectAndReplay(), 'A same-ID regrant must reject replay under the new epoch.')
  assert(regrantGateway.saves.length === 0 && regrantStore.getItem(regrantQueue.key) === regrantBytes && oldCustody?.version === 2 && oldCustody.operationContext.serverEpoch === 1, 'A same-ID regrant must preserve the byte-exact old queue and make zero remote calls.')

  // Group 9: cached projection verifies each saved custody snapshot before rendering.
  const renderStore = memory(); const renderGateway = new FakeGateway(); let renderOffline = true; let renderId = 550; const renderProject = 'stale-render-field-log'; let renderCacheReads = 0
  const readRenderCache = async <T>() => { renderCacheReads += 1; return { data: { entries: [], viewer: { user_id: actor, role: 'worker' } } as T, cachedAt: stamp } }
  const renderQueued = new QueuedFieldLogRepository(live(renderGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: renderProject, storage: renderStore, createId: () => uid(renderId++), clock: () => stamp, isOffline: () => renderOffline, readWorkspaceCache: readRenderCache })
  await renderQueued.saveEntry(draft(uid(551)))
  const renderQueue = new FieldLogWriteQueue(renderStore, fieldLogWriteQueueKey(renderProject, actor, farm)); const renderBytes = renderStore.getItem(renderQueue.key)
  resetFarmGrantFromLive(renderStore, { projectRef: renderProject, userId: actor, farmId: farm }, 2, '2026-07-12T13:00:00.000Z'); renderGateway.loadFailure = new TypeError('offline')
  await rejects(() => renderQueued.getData(), 'A stale-generation v2 item was projected over cached Field Log data.')
  assert(renderCacheReads === 1 && renderStore.getItem(renderQueue.key) === renderBytes && renderGateway.saves.length === 0 && readRevokedFarmRecovery(renderStore, renderProject, actor).length === 0, 'Stale-generation cached projection must reach the cached overlay, preserve queue bytes, and make zero remote or recovery mutations.')

  // Group 10: a cross-project v2 item is invalid for both active queue reads and revoked recovery.
  assert(savedEntry.version === 2, 'The cross-project custody test needs a v2 queue item.')
  const crossProjectStore = memory(); const crossProject = 'cross-project-field-log'; const crossKey = fieldLogWriteQueueKey(crossProject, actor, farm); const crossEntry = { ...savedEntry, operationContext: { ...savedEntry.operationContext, projectRef: 'different-project' } }; const crossBytes = JSON.stringify({ version: 1, entries: [crossEntry] })
  crossProjectStore.setItem(crossKey, crossBytes)
  await rejects(async () => new FieldLogWriteQueue(crossProjectStore, crossKey).read(), 'A cross-project v2 item was accepted from the active queue.')
  await rejects(async () => quarantineRevokedFarmWork(crossProjectStore, { projectRef: crossProject, userId: actor, farmId: farm }, stamp), 'A cross-project v2 item was published to revoked recovery.')
  assert(crossProjectStore.getItem(crossKey) === crossBytes && readRevokedFarmRecovery(crossProjectStore, crossProject, actor).length === 0, 'Cross-project custody rejection must keep queue bytes exact and publish no recovery record.')
  for (const mutation of ['generation', 'token', 'serverEpoch'] as const) {
    const mutantStore = memory(); const mutantProject = `mutant-${mutation}`; const mutantScope = { projectRef: mutantProject, userId: actor, farmId: farm }; const mutantKey = fieldLogWriteQueueKey(mutantProject, actor, farm)
    resetFarmGrantFromLive(mutantStore, mutantScope, 1, stamp)
    const current = captureFarmRevocationFence(mutantStore, mutantScope)
    const changed = mutation === 'token' ? uid(999) : current[mutation] + 1
    const mutantEntry = { ...savedEntry, userId: actor, farmId: farm, operationContext: { ...current, [mutation]: changed } }
    const mutantBytes = JSON.stringify({ version: 1, entries: [mutantEntry] }); mutantStore.setItem(mutantKey, mutantBytes)
    await rejects(async () => quarantineRevokedFarmWork(mutantStore, mutantScope, stamp), `Mismatched ${mutation} custody was published to revoked recovery.`)
    assert(mutantStore.getItem(mutantKey) === mutantBytes && readRevokedFarmRecovery(mutantStore, mutantProject, actor).length === 0, `Mismatched ${mutation} custody must preserve exact queue bytes and publish no recovery mutation.`)
  }

  // Group 11: a lost response retains and replays the original operation-era context.
  const lostStore = memory(); const lostGateway = new FakeGateway(); lostGateway.saveFailure = new TypeError('Failed to fetch after commit'); let lostId = 600
  const lostQueued = new QueuedFieldLogRepository(live(lostGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: 'lost-field-log', storage: lostStore, createId: () => uid(lostId++), clock: () => stamp, isOffline: () => false })
  const lostPending = await lostQueued.saveEntry(draft(uid(601))); const lostQueue = new FieldLogWriteQueue(lostStore, fieldLogWriteQueueKey('lost-field-log', actor, farm)); const lostEntry = lostQueue.read().entries[0]
  assert(lostPending.pending && lostEntry?.version === 2 && lostGateway.saves.length === 1, 'An ambiguous committed response must retain one custody-bearing queue entry.')
  const lostCustody = lostEntry.operationContext
  lostGateway.saveFailure = null; await lostQueued.inspectAndReplay()
  assert(lostQueue.read().entries.length === 0 && [...lostGateway.saves].length === 2 && lostGateway.saves.every((call) => JSON.stringify(call.context) === JSON.stringify(lostCustody)), 'Lost-response replay must resend the same operation with the exact saved custody context.')

  // Group 12: legacy work is durably parked without a remote call, while corrupt bytes stay untouched.
  const legacyStore = memory(); const legacyGateway = new FakeGateway(); const legacyProject = 'legacy-field-log'; const legacyKey = fieldLogWriteQueueKey(legacyProject, actor, farm); const legacyEntry = { version: 1 as const, module: 'fieldLog' as const, kind: 'saveEntry' as const, operationId: uid(700), userId: actor, farmId: farm, enqueuedAt: stamp, draft: draft(uid(701)) }
  legacyStore.setItem(legacyKey, JSON.stringify({ version: 1, entries: [legacyEntry] })); let legacyId = 710
  const legacyQueued = new QueuedFieldLogRepository(live(legacyGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: legacyProject, storage: legacyStore, createId: () => uid(legacyId++), clock: () => stamp, isOffline: () => true })
  await legacyQueued.inspectAndReplay()
  const parkedLegacy = readNeedsAttention(legacyStore, legacyKey)
  assert(new FieldLogWriteQueue(legacyStore, legacyKey).read().entries.length === 0 && parkedLegacy.length === 1 && parkedLegacy[0]?.id === legacyEntry.operationId && legacyGateway.saves.length === 0, 'A legacy v1 entry must be durably quarantined even offline and never auto-sent.')
  const corruptStore = memory(); const corruptProject = 'corrupt-field-log'; const corruptKey = fieldLogWriteQueueKey(corruptProject, actor, farm); const corruptBytes = '{bad'; corruptStore.setItem(corruptKey, corruptBytes); let corruptId = 720; const corruptGateway = new FakeGateway()
  const corruptQueued = new QueuedFieldLogRepository(live(corruptGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: corruptProject, storage: corruptStore, createId: () => uid(corruptId++), clock: () => stamp, isOffline: () => false })
  await corruptQueued.inspectAndReplay()
  assert(corruptStore.getItem(corruptKey) === corruptBytes && corruptGateway.saves.length === 0 && readNeedsAttention(corruptStore, corruptKey).length === 0, 'Corrupt queue bytes must remain byte-stable and make zero remote or quarantine mutations.')
  const corruptRecoveryStore = memory(); const corruptRecoveryProject = 'corrupt-recovery-field-log'; const corruptRecoveryKey = fieldLogWriteQueueKey(corruptRecoveryProject, actor, farm); const corruptRecoveryBytes = '{bad recovery'; const corruptLegacyBytes = JSON.stringify({ version: 1, entries: [legacyEntry] })
  corruptRecoveryStore.setItem(corruptRecoveryKey, corruptLegacyBytes); corruptRecoveryStore.setItem(`${corruptRecoveryKey}:needs-attention`, corruptRecoveryBytes); let corruptRecoveryId = 730; const corruptRecoveryGateway = new FakeGateway()
  const corruptRecoveryQueued = new QueuedFieldLogRepository(live(corruptRecoveryGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: corruptRecoveryProject, storage: corruptRecoveryStore, createId: () => uid(corruptRecoveryId++), clock: () => stamp, isOffline: () => false })
  await corruptRecoveryQueued.inspectAndReplay()
  assert(corruptRecoveryStore.getItem(corruptRecoveryKey) === corruptLegacyBytes && corruptRecoveryStore.getItem(`${corruptRecoveryKey}:needs-attention`) === corruptRecoveryBytes && corruptRecoveryGateway.saves.length === 0, 'A corrupt recovery record must preserve both corrupt recovery bytes and legacy queue custody without any remote call.')

  // Group 13: queue bytes reject malformed DB-illegal shapes and season math excludes notes.
  assert(new FieldLogWriteQueue(store, 'empty').read().entries.length === 0, 'An empty queue must remain valid.')
  await rejects(async () => { const bad = new FieldLogWriteQueue({ ...store, getItem: () => '{bad' }, 'bad'); bad.read() }, 'Corrupt queue bytes must fail closed.')
  const malformed = (entry: object) => new FieldLogWriteQueue({ ...store, getItem: () => JSON.stringify({ version: 1, entries: [entry] }) }, 'malformed').read()
  const queuedSave = { version: 1, module: 'fieldLog', kind: 'saveEntry', operationId: uid(50), userId: actor, farmId: farm, enqueuedAt: stamp, draft: { ...draft(uid(51)) } }
  await rejects(async () => malformed({ ...queuedSave, draft: { ...queuedSave.draft, observed_on: '2099-01-01' } }), 'A future-dated queued entry must fail closed.')
  await rejects(async () => malformed({ ...queuedSave, draft: { ...queuedSave.draft, rainfall_in: null, note: null } }), 'A rainfall queue entry without an amount must fail closed.')
  await rejects(async () => malformed({ ...queuedSave, draft: { ...queuedSave.draft, note: '   ' } }), 'A blank rainfall queue note must fail closed.')
  await rejects(async () => malformed({ ...queuedSave, draft: { ...draft(uid(52), 'note'), rainfall_in: 1 } }), 'A note queue entry carrying rainfall must fail closed.')
  await rejects(async () => malformed({ ...queuedSave, version: 2 }), 'A v2 queue entry without operation-era custody must fail closed.')
  await rejects(async () => malformed({ ...queuedSave, version: 2, operationContext: { projectRef: 'test', userId: uid(999), farmId: farm, generation: 1, token: uid(998), serverEpoch: 1 } }), 'A v2 queue entry whose custody identity differs from its queue identity must fail closed.')
  const seasonEntries = [canonical({ ...draft(uid(30)), observed_on: '2026-01-01', rainfall_in: 0.2 }), canonical({ ...draft(uid(31)), observed_on: '2026-07-01', rainfall_in: 1.1 }), canonical({ ...draft(uid(32)), observed_on: '2025-12-31', rainfall_in: 9 }), canonical({ ...draft(uid(33), 'note'), observed_on: '2026-07-02' })] as Array<{ observed_on: string; rainfall_in: number | null; entry_type: string }>
  const total = seasonEntries.filter((entry) => entry.entry_type === 'rainfall' && entry.observed_on >= '2026-01-01' && entry.observed_on <= '2026-07-12').reduce((sum, entry) => sum + (entry.rainfall_in ?? 0), 0); assert(total === 1.3, 'Season rainfall must include only the current calendar year through today.')
  // Group 14: an answer from this device's saved copy is marked offline, so the page knows it may predate a save; a live one is not.
  const labelGateway = new FakeGateway(); labelGateway.entries = [canonical(draft(uid(600)))]; const savedCopy = { entries: [canonical(draft(uid(601)))], viewer: { user_id: actor, role: 'worker' } }; let labelOffline = false; let labelId = 610
  const labelQueued = new QueuedFieldLogRepository(live(labelGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: 'offline-label-field-log', storage: memory(), createId: () => uid(labelId++), clock: () => '2026-07-13T09:00:00.000Z', isOffline: () => labelOffline, readWorkspaceCache: async <T>() => ({ data: structuredClone(savedCopy) as T, cachedAt: stamp }) })
  const liveAnswer = await labelQueued.getData()
  assert(liveAnswer.offline === undefined && liveAnswer.entries.map((entry) => entry.id).join() === uid(600), 'A live Field Log answer must not be marked offline.')
  labelGateway.loadFailure = new TypeError('Failed to fetch'); const savedAnswer = await labelQueued.getData()
  assert(savedAnswer.offline === true && savedAnswer.entries.map((entry) => entry.id).join() === uid(601), 'An answer from the saved copy must be marked offline.')
  labelOffline = true; const waitingSave = await labelQueued.saveEntry(draft(uid(603))); const overlaidAnswer = await labelQueued.getData()
  assert(overlaidAnswer.waitingIds?.join() === uid(603), `The saved-copy answer must list the waiting writes too. Got: ${overlaidAnswer.waitingIds?.join()}`)
  assert(waitingSave.pending && overlaidAnswer.offline === true && overlaidAnswer.entries.map((entry) => `${entry.id}:${entry.pending === true}`).join() === `${uid(601)}:false,${uid(603)}:true`, 'The saved-copy answer must stay marked offline with a waiting save laid over it as pending.')
  await labelQueued.saveEntry({ ...draft(uid(601)), rainfall_in: 1.5 }); const editedRow = (await labelQueued.getData()).entries.find((entry) => entry.id === uid(601))
  assert(editedRow?.pending && editedRow.rainfall_in === 1.5 && editedRow.created_at === stamp, 'A waiting edit laid over the saved copy must keep the row\'s created time, so it keeps its place.')
  await labelQueued.deleteEntry(uid(601)); const deletedAnswer = await labelQueued.getData()
  assert([...(deletedAnswer.waitingIds ?? [])].sort().join() === [uid(601), uid(601), uid(603)].sort().join(), `The saved-copy answer must list waiting deletes as well as saves. Got: ${deletedAnswer.waitingIds?.join()}`)
  assert(deletedAnswer.offline === true && deletedAnswer.entries.map((entry) => entry.id).join() === uid(603), `A waiting delete must take its row out of the saved-copy answer. Got: ${deletedAnswer.entries.map((entry) => entry.id).join()}`)
  labelGateway.loadFailure = null; const liveWhileWaiting = await labelQueued.getData()
  assert(liveWhileWaiting.offline === undefined && liveWhileWaiting.entries.map((entry) => `${entry.id}:${entry.pending === true}`).join() === `${uid(600)}:false,${uid(603)}:true`, `A live answer lays the writes still waiting on this device over the server rows. Got: ${liveWhileWaiting.entries.map((entry) => entry.id).join()}`)
  assert([...(liveWhileWaiting.waitingIds ?? [])].sort().join() === [uid(601), uid(601), uid(603)].sort().join(), `A live answer must list the ids still waiting on this device, one per waiting write. Got: ${liveWhileWaiting.waitingIds?.join()}`)
  const lostSignal = new TypeError('Failed to fetch'); labelGateway.loadFailure = lostSignal; let noCopyError: unknown = null
  const noCopyQueued = new QueuedFieldLogRepository(live(labelGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: 'offline-label-no-copy', storage: memory(), createId: () => uid(604), clock: () => stamp, isOffline: () => true, readWorkspaceCache: async () => null })
  try { await noCopyQueued.getData() } catch (caught) { noCopyError = caught }
  assert(noCopyError === lostSignal, 'With no saved copy, a read that cannot reach the server must fail with that error instead of answering.')

  // Group 15: the saved copy is written in order with every tab on this device. A live read that started first and answers
  // last does not overwrite the copy a newer live read wrote, in the same tab or in another tab, because the page relies on
  // that copy once a live read settled its local entries. A live read that starts later still updates it. Every read here
  // starts in the same millisecond of the device clock (Codex, PR #72): the order comes from turns, not clock times.
  class HeldGateway extends FakeGateway { hold: Promise<void> | null = null; holding = false; override async loadEntries(farmId: string) { const rows = await super.loadEntries(farmId); if (this.hold) { const wait = this.hold; this.hold = null; this.holding = true; await wait } return rows } }
  const holdNextRead = (gateway: HeldGateway) => { let release = () => {}; gateway.holding = false; gateway.hold = new Promise<void>((resolve) => { release = resolve }); return () => release() }
  const orderDevice = deviceCache(); const orderProject = 'saved-copy-order-field-log'; const orderGateway = new HeldGateway(); orderGateway.entries = [canonical(draft(uid(700)))]
  const orderTab = () => new QueuedFieldLogRepository(live(orderGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: orderProject, storage: orderDevice.storage, createId: () => uid(709), clock: () => stamp, isOffline: () => false })
  const orderTabA = orderTab(); const orderTabB = orderTab(); const orderCopy = () => orderDevice.savedIds(orderProject)
  try {
    let releaseOlder = holdNextRead(orderGateway); let olderRead = orderTabA.getData()
    await until(() => orderGateway.holding, 'The older live read never reached the gateway.')
    orderGateway.entries.push(canonical(draft(uid(702))))
    const newerRead = await orderTabA.getData(); releaseOlder(); const olderAnswer = await olderRead
    assert(newerRead.waitingIds?.length === 0, 'With nothing waiting, a live answer lists no waiting ids.')
    assert(newerRead.entries.length === 2 && olderAnswer.entries.length === 1 && orderCopy() === `${uid(700)},${uid(702)}`, `An older live read answering last must not overwrite the newer saved copy. Saved copy: ${orderCopy()}`)
    releaseOlder = holdNextRead(orderGateway); olderRead = orderTabA.getData()
    await until(() => orderGateway.holding, 'The older live read in the first tab never reached the gateway.')
    orderGateway.entries.push(canonical(draft(uid(703))))
    await orderTabB.getData(); releaseOlder(); await olderRead
    assert(orderCopy() === `${uid(700)},${uid(702)},${uid(703)}`, `An older live read in one tab answering last must not overwrite the copy a newer read in another tab wrote. Saved copy: ${orderCopy()}`)
    orderGateway.entries.push(canonical(draft(uid(704)))); await orderTabA.getData()
    assert(orderCopy() === `${uid(700)},${uid(702)},${uid(703)},${uid(704)}`, `A live read that starts after the newest write still updates the saved copy. Saved copy: ${orderCopy()}`)
  } finally { orderDevice.restore() }

  // Group 16: the waiting list is read before the server, so a write sent during the read is still listed (its row may
  // already be in the answer, and the page keeps its copy one reload longer rather than dropping it); unreadable queue
  // bytes never break a live read, they only leave the list unknown.
  const listStore = memory(); const listProject = 'waiting-list-field-log'; const listGateway = new HeldGateway(); let listId = 720; let listOffline = true
  const listQueued = new QueuedFieldLogRepository(live(listGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: listProject, storage: listStore, createId: () => uid(listId++), clock: () => stamp, isOffline: () => listOffline, writeWorkspaceCacheInOrder: async () => true })
  const listed = await listQueued.saveEntry(draft(uid(730))); listOffline = false
  let releaseList = () => {}; listGateway.hold = new Promise<void>((resolve) => { releaseList = resolve })
  const listRead = listQueued.getData()
  for (let tries = 0; !listGateway.holding; tries += 1) { if (tries > 1_000) throw new Error('The listed live read never reached the gateway.'); await new Promise<void>((resolve) => setTimeout(resolve, 0)) }
  listStore.removeItem(fieldLogWriteQueueKey(listProject, actor, farm)); releaseList(); const listAnswer = await listRead
  assert(listed.pending && listAnswer.waitingIds?.join() === uid(730), `A write waiting when the read started must stay listed even if it leaves the queue during the read. Got: ${listAnswer.waitingIds?.join()}`)
  listStore.setItem(fieldLogWriteQueueKey(listProject, actor, farm), '{"version":1,"entries":[{"broken":true}]}')
  const unreadableAnswer = await listQueued.getData()
  assert(unreadableAnswer.waitingIds === undefined && unreadableAnswer.offline === undefined, 'Unreadable queue bytes must leave the waiting list unknown without breaking the live read.')

  // Group 17: a save the server refuses on replay goes to Needs attention, whole and with the reason, and the saves
  // behind it carry on sending. The refusal is the database's own (code P0001), as PostgREST hands it over.
  const futureRefusal = () => Object.assign(new Error('observed date cannot be more than one day in the future'), { code: 'P0001', details: null, hint: null })
  const parkStore = memory(); const parkProject = 'refused-replay-field-log'; const parkGateway = new FakeGateway(); let parkOffline = true; let parkId = 800
  parkGateway.entries = [canonical(draft(uid(810)))]
  parkGateway.refuseSave = (entry) => entry.id === uid(801) ? futureRefusal() : null
  const parkQueued = new QueuedFieldLogRepository(live(parkGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: parkProject, storage: parkStore, createId: () => uid(parkId++), clock: () => stamp, isOffline: () => parkOffline })
  const parkKey = fieldLogWriteQueueKey(parkProject, actor, farm); const parkQueue = new FieldLogWriteQueue(parkStore, parkKey)
  await parkQueued.saveEntry(draft(uid(801))); await parkQueued.saveEntry(draft(uid(802), 'note')); await parkQueued.deleteEntry(uid(810))
  const refusedEntry = parkQueue.read().entries[0]; assert(refusedEntry?.version === 2 && refusedEntry.kind === 'saveEntry' && refusedEntry.draft.id === uid(801) && parkQueue.read().entries.length === 3, 'The refused-replay test needs three waiting writes.')
  parkOffline = false; await parkQueued.inspectAndReplay()
  const parked = readNeedsAttention(parkStore, parkKey)
  assert(parked.length === 1 && parked[0]?.id === refusedEntry.operationId && parked[0].module === 'fieldLog' && JSON.stringify(parked[0].entry) === JSON.stringify(refusedEntry), `A save refused on replay must be kept whole in Needs attention. Got: ${JSON.stringify(parked)}`)
  assert(parked[0]!.message.includes('more than one day in the future'), `Needs attention must say why the server refused the save. Got: ${parked[0]!.message}`)
  assert(parkQueue.read().entries.length === 0, `The refused save must not hold up the writes behind it. Waiting: ${parkQueue.read().entries.length}`)
  assert(parkGateway.saves.some((call) => call.entry.id === uid(802)) && parkGateway.entries.some((entry) => (entry as { id: string }).id === uid(802)), 'A save behind the refused one must still reach the server.')
  assert(parkGateway.deletes.some((call) => call.entryId === uid(810)) && !parkGateway.entries.some((entry) => (entry as { id: string }).id === uid(810)), 'A delete behind the refused save must still reach the server.')
  assert(!parkGateway.entries.some((entry) => (entry as { id: string }).id === uid(801)), 'The refused save must not appear saved on the server.')
  const parkedStatus = getModuleSyncStatus('fieldLog'); assert(parkedStatus.kind === 'blocked' && parkedStatus.pending === 1 && parkedStatus.message === '1 saves need attention.', `The sync status must say a save needs attention, as Grain and Scouting do. Got: ${JSON.stringify(parkedStatus)}`)
  // A later replay leaves the parked save alone and keeps saying it needs attention.
  const sendsBefore = parkGateway.saves.length; await parkQueued.inspectAndReplay()
  assert(parkGateway.saves.length === sendsBefore && readNeedsAttention(parkStore, parkKey).length === 1 && getModuleSyncStatus('fieldLog').kind === 'blocked', 'A later replay must not resend or drop the parked save.')

  // Group 18: Retry puts the same saved change back on the queue under the same custody checks and sends it; a wrong queue
  // or a changed farm grant refuses the retry and keeps the save in Needs attention.
  assert(!!parkQueued.retryNeedsAttention, 'The Field Log repository must offer a guarded retry.')
  await rejects(() => parkQueued.retryNeedsAttention(fieldLogWriteQueueKey(parkProject, actor, otherFarm), refusedEntry.operationId), 'A retry for another farm queue must be refused.')
  await rejects(() => parkQueued.retryNeedsAttention(parkKey, uid(899)), 'A retry for an unknown save must be refused.')
  await parkQueued.retryNeedsAttention(parkKey, refusedEntry.operationId)
  assert(readNeedsAttention(parkStore, parkKey).length === 1 && parkQueue.read().entries.length === 0 && parkGateway.saves.filter((call) => call.entry.id === uid(801)).length === 2, 'A retry the server refuses again must land back in Needs attention, not in the queue.')
  parkGateway.refuseSave = () => null; await parkQueued.retryNeedsAttention(parkKey, refusedEntry.operationId)
  const retried = parkGateway.saves.filter((call) => call.entry.id === uid(801))
  assert(readNeedsAttention(parkStore, parkKey).length === 0 && parkQueue.read().entries.length === 0 && parkGateway.entries.some((entry) => (entry as { id: string }).id === uid(801)), 'A retry the server accepts must save the entry and clear Needs attention.')
  assert(retried.every((call) => call.operationId === refusedEntry.operationId && JSON.stringify(call.context) === JSON.stringify(refusedEntry.operationContext)), 'A retry must resend the same operation with its saved custody context.')
  assert(getModuleSyncStatus('fieldLog').kind === 'synced', 'With nothing waiting or parked, the sync status must read synced.')
  const regrantParkStore = memory(); const regrantParkProject = 'refused-regrant-field-log'; const regrantParkGateway = new FakeGateway(); let regrantParkOffline = true; let regrantParkId = 850
  regrantParkGateway.refuseSave = () => futureRefusal()
  const regrantParkQueued = new QueuedFieldLogRepository(live(regrantParkGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: regrantParkProject, storage: regrantParkStore, createId: () => uid(regrantParkId++), clock: () => stamp, isOffline: () => regrantParkOffline })
  const regrantParkKey = fieldLogWriteQueueKey(regrantParkProject, actor, farm)
  await regrantParkQueued.saveEntry(draft(uid(851))); regrantParkOffline = false; await regrantParkQueued.inspectAndReplay()
  const regrantParked = readNeedsAttention(regrantParkStore, regrantParkKey); assert(regrantParked.length === 1, 'The regrant retry test needs a parked save.')
  resetFarmGrantFromLive(regrantParkStore, { projectRef: regrantParkProject, userId: actor, farmId: farm }, 2, '2026-07-12T13:00:00.000Z'); regrantParkGateway.refuseSave = () => null
  await rejects(() => regrantParkQueued.retryNeedsAttention(regrantParkKey, regrantParked[0]!.id), 'A retry after a revoke and regrant must be refused.')
  assert(readNeedsAttention(regrantParkStore, regrantParkKey).length === 1 && regrantParkGateway.saves.length === 1 && new FieldLogWriteQueue(regrantParkStore, regrantParkKey).read().entries.length === 0, 'A refused retry must keep the save in Needs attention and send nothing.')

  // Dismiss is guarded the same way: only from the account and farm whose queue the page showed, and only a change that is
  // really there; a revoke and regrant does not trap it (the farmer can still let it go).
  assert(!!regrantParkQueued.dismissNeedsAttention, 'The Field Log repository must offer a guarded dismiss.')
  await rejects(() => regrantParkQueued.dismissNeedsAttention(fieldLogWriteQueueKey(regrantParkProject, actor, otherFarm), regrantParked[0]!.id), 'A dismiss for another farm queue must be refused.')
  await rejects(() => regrantParkQueued.dismissNeedsAttention(regrantParkKey, uid(899)), 'A dismiss for an unknown change must be refused.')
  let dismissFarm = farm; const switchedDismiss = new QueuedFieldLogRepository(live(regrantParkGateway), { getContext: async () => ({ userId: actor, farmId: dismissFarm }), projectRef: regrantParkProject, storage: regrantParkStore, createId: () => uid(regrantParkId++), clock: () => stamp, isOffline: () => false })
  dismissFarm = otherFarm; resetFarmGrantFromLive(regrantParkStore, { projectRef: regrantParkProject, userId: actor, farmId: otherFarm }, 1, stamp)
  await rejects(() => switchedDismiss.dismissNeedsAttention(regrantParkKey, regrantParked[0]!.id), 'A page left open across a farm switch must not dismiss the old farm\'s change.')
  assert(readNeedsAttention(regrantParkStore, regrantParkKey).length === 1, 'Refused dismissals must keep the change in Needs attention.')
  await regrantParkQueued.dismissNeedsAttention(regrantParkKey, regrantParked[0]!.id)
  assert(readNeedsAttention(regrantParkStore, regrantParkKey).length === 0 && regrantParkGateway.saves.length === 1, 'A dismiss from the right farm removes the change and sends nothing.')

  // Dismissing the last parked change while a later write still waits on the device reports it waiting, not all saved.
  const waitStore = memory(); const waitProject = 'dismiss-while-waiting-field-log'; const waitGateway = new FakeGateway(); let waitOffline = true; let waitId = 860
  waitGateway.refuseSave = (entry) => entry.id === uid(861) ? futureRefusal() : entry.id === uid(862) ? new TypeError('Failed to fetch') : null
  const waitQueued = new QueuedFieldLogRepository(live(waitGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: waitProject, storage: waitStore, createId: () => uid(waitId++), clock: () => stamp, isOffline: () => waitOffline })
  const waitKey = fieldLogWriteQueueKey(waitProject, actor, farm)
  await waitQueued.saveEntry(draft(uid(861))); await waitQueued.saveEntry(draft(uid(862))); waitOffline = false; await waitQueued.inspectAndReplay()
  const waitParked = readNeedsAttention(waitStore, waitKey); assert(waitParked.length === 1 && new FieldLogWriteQueue(waitStore, waitKey).read().entries.length === 1, 'The test needs one parked change and one still waiting.')
  const beforeDismiss = getModuleSyncStatus('fieldLog'); assert(beforeDismiss.kind === 'blocked' && beforeDismiss.message === '1 saves need attention.', `A later write losing signal must not hide that a parked change needs attention. Got: ${JSON.stringify(beforeDismiss)}`)
  await waitQueued.dismissNeedsAttention(waitKey, waitParked[0]!.id)
  const afterDismiss = getModuleSyncStatus('fieldLog'); assert(afterDismiss.kind === 'pending' && afterDismiss.pending === 1, `With a write still waiting, dismissing must not report all changes saved. Got: ${JSON.stringify(afterDismiss)}`)

  // Group 19: losing signal still waits, and an access refusal (no permission, access changed) or a database failure that
  // goes away on retry (serialization, deadlock) still holds the whole queue: those are not about the entry, so nothing is
  // parked and nothing behind it is sent.
  for (const [label, failure] of [['lost signal', () => new TypeError('Failed to fetch')], ['no permission', () => Object.assign(new Error('you do not have permission to edit this farm'), { code: 'P0001' })], ['access changed', () => Object.assign(new Error('FARM_ACCESS_EPOCH_CHANGED'), { code: 'P0001' })], ['sign-in', () => Object.assign(new Error('JWT expired'), { code: 'PGRST301' })], ['database permission', () => Object.assign(new Error('permission denied for function save_field_log_entry'), { code: '42501' })], ['serialization retry', () => Object.assign(new Error('could not serialize access due to concurrent update'), { code: '40001' })], ['deadlock retry', () => Object.assign(new Error('deadlock detected'), { code: '40P01' })]] as const) {
    const holdStore = memory(); const holdProject = `hold-${label.replace(/\W+/g, '-')}`; const holdGateway = new FakeGateway(); let holdOffline = true; let holdId = 870
    holdGateway.refuseSave = (entry) => entry.id === uid(871) ? failure() : null
    const holdQueued = new QueuedFieldLogRepository(live(holdGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: holdProject, storage: holdStore, createId: () => uid(holdId++), clock: () => stamp, isOffline: () => holdOffline })
    const holdKey = fieldLogWriteQueueKey(holdProject, actor, farm)
    await holdQueued.saveEntry(draft(uid(871))); await holdQueued.saveEntry(draft(uid(872))); const holdBytes = holdStore.getItem(holdKey)
    holdOffline = false; await holdQueued.inspectAndReplay()
    assert(holdStore.getItem(holdKey) === holdBytes && readNeedsAttention(holdStore, holdKey).length === 0 && !holdGateway.saves.some((call) => call.entry.id === uid(872)), `A ${label} failure must keep the queue whole, park nothing and send nothing behind it.`)
  }

  // Group 20: a farm switch while the refused save is in flight parks nothing: the queue stays byte-exact for its own farm.
  const switchStore = memory(); const switchProject = 'refused-switch-field-log'; const switchGateway = new FakeGateway(); let switchOffline = true; let switchId = 890; let switchFarm = farm
  switchGateway.refuseSave = () => { switchFarm = otherFarm; return futureRefusal() }
  const switchQueued = new QueuedFieldLogRepository(live(switchGateway), { getContext: async () => ({ userId: actor, farmId: switchFarm }), projectRef: switchProject, storage: switchStore, createId: () => uid(switchId++), clock: () => stamp, isOffline: () => switchOffline })
  const switchKey = fieldLogWriteQueueKey(switchProject, actor, farm)
  await switchQueued.saveEntry(draft(uid(891))); await switchQueued.saveEntry(draft(uid(892))); const switchBytes = switchStore.getItem(switchKey)
  switchOffline = false; try { await switchQueued.inspectAndReplay() } catch { /* a farm change may end the replay */ }
  assert(switchStore.getItem(switchKey) === switchBytes && readNeedsAttention(switchStore, switchKey).length === 0 && !switchGateway.saves.some((call) => call.entry.id === uid(892)), 'A farm switch during a refused replay must park nothing and send nothing behind it.')

  // Group 21: a live answer lays the writes still waiting on this device over the server's rows, as the saved-copy answer
  // does, so rain kept without signal stays on screen, marked not sent yet, once signal is back and until it is sent (the
  // reads here reach the server while the writes stay parked). A waiting write from an earlier farm access, which can never
  // be sent, stays listed as waiting but is not laid over, and the read still answers.
  const overlayStore = memory(); const overlayProject = 'live-overlay-field-log'; const overlayGateway = new FakeGateway(); let overlayId = 760
  overlayGateway.entries = [canonical(draft(uid(750))), canonical({ ...draft(uid(751)), rainfall_in: 0.4 })]
  const overlayQueued = new QueuedFieldLogRepository(live(overlayGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: overlayProject, storage: overlayStore, createId: () => uid(overlayId++), clock: () => '2026-07-13T10:00:00.000Z', isOffline: () => true })
  await overlayQueued.saveEntry(draft(uid(752))); await overlayQueued.saveEntry({ ...draft(uid(751)), rainfall_in: 0.9 }); await overlayQueued.deleteEntry(uid(750))
  const overlaid = await overlayQueued.getData(); const overlaidRows = overlaid.entries.map((entry) => `${entry.id}:${entry.pending === true}:${entry.rainfall_in}`).join()
  assert(overlaid.offline === undefined && overlaidRows === `${uid(751)}:true:0.9,${uid(752)}:true:0.8`, `A live answer must show waiting saves as pending and leave out waiting deletes. Got: ${overlaidRows}`)
  assert(overlaid.entries[0]?.created_at === stamp && overlaid.waitingIds?.join() === [uid(752), uid(751), uid(750)].join() && overlayGateway.saves.length + overlayGateway.deletes.length === 0, 'On a live answer a waiting edit keeps its row\'s created time, every waiting write is listed, and reading sends nothing.')
  resetFarmGrantFromLive(overlayStore, { projectRef: overlayProject, userId: actor, farmId: farm }, 2, '2026-07-13T11:00:00.000Z')
  const afterRegrant = await overlayQueued.getData(); const regrantRows = afterRegrant.entries.map((entry) => `${entry.id}:${entry.pending === true}`).join()
  assert(regrantRows === `${uid(750)}:false,${uid(751)}:false` && afterRegrant.waitingIds?.length === 3, `Waiting writes from an earlier farm access must not be laid over a live answer, nor break it. Got: ${regrantRows}`)

  // Group 22: a save or delete the server confirmed goes into the saved copy straight away, whether sent at once or later
  // from the queue, so an answer without signal shows it before the next live read. It only changes a copy that exists:
  // a copy made from one change would show nothing else without signal.
  class UpsertGateway extends FakeGateway { override async saveEntry(input: { farmId: string; operationId: string; entry: FieldLogEntryDraft }, context: FarmOperationContext) { this.entries = this.entries.filter((entry) => (entry as { id: string }).id !== input.entry.id); return super.saveEntry(input, context) } }
  const throughDevice = deviceCache(); const throughProject = 'write-through-field-log'; const throughGateway = new UpsertGateway(); let throughOffline = false; let throughId = 800
  throughGateway.entries = [canonical(draft(uid(790)))]
  const throughQueued = new QueuedFieldLogRepository(live(throughGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: throughProject, storage: throughDevice.storage, createId: () => uid(throughId++), clock: throughDevice.clock, isOffline: () => throughOffline })
  const rowsOf = (data: FieldLogData | undefined) => data?.entries.map((entry) => `${entry.id}:${entry.rainfall_in}${entry.pending ? ':waiting' : ''}`).join() ?? 'no saved copy'
  const throughCopy = () => rowsOf(throughDevice.savedCopy(throughProject))
  try {
    await throughQueued.saveEntry(draft(uid(791)))
    assert(throughCopy() === 'no saved copy', 'A confirmed save must not make a saved copy from itself alone.')
    await throughQueued.getData()
    await throughQueued.saveEntry({ ...draft(uid(791)), rainfall_in: 1.2 }); await throughQueued.saveEntry(draft(uid(792))); await throughQueued.deleteEntry(uid(790))
    assert(throughCopy() === `${uid(791)}:1.2,${uid(792)}:0.8`, `Confirmed edits, saves and deletes must reach the saved copy. Saved copy: ${throughCopy()}`)
    throughGateway.loadFailure = new TypeError('Failed to fetch'); const throughNoSignal = await throughQueued.getData()
    assert(throughNoSignal.offline && rowsOf(throughNoSignal) === `${uid(791)}:1.2,${uid(792)}:0.8`, `An answer without signal must show the confirmed changes. Got: ${rowsOf(throughNoSignal)}`)
    throughOffline = true; await throughQueued.saveEntry(draft(uid(793))); await throughQueued.deleteEntry(uid(792))
    assert(throughCopy() === `${uid(791)}:1.2,${uid(792)}:0.8`, `Writes still waiting must not reach the saved copy. Saved copy: ${throughCopy()}`)
    throughOffline = false; await throughQueued.inspectAndReplay()
    assert(throughCopy() === `${uid(791)}:1.2,${uid(793)}:0.8`, `Writes sent later from the queue must reach the saved copy too. Saved copy: ${throughCopy()}`)
    const afterReplay = await throughQueued.getData()
    assert(afterReplay.offline && rowsOf(afterReplay) === `${uid(791)}:1.2,${uid(793)}:0.8`, `After sending, an answer without signal must show the sent writes as sent. Got: ${rowsOf(afterReplay)}`)
  } finally { throughDevice.restore() }

  // Group 23: two tabs on one device share one queue and one saved copy. Rain one tab keeps without signal shows as not
  // sent yet on the other tab's live answer; once it is sent, the first tab's answer without signal shows it as sent. Then
  // the ordering rule itself, straight on a saved copy: a whole copy needs a later turn than the stored copy's read and gets
  // the changes confirmed after its read laid back on top, a confirmed change lands only on an existing copy read before it,
  // and turns taken at the same moment all differ, in the order they were asked for, after every turn kept with the copy.
  const tabsDevice = deviceCache(); const tabsProject = 'two-tabs-field-log'; const tabsGateway = new FakeGateway(); let tabsOffline = false; let tabsId = 850
  tabsGateway.entries = [canonical(draft(uid(840)))]
  const tabsTab = () => new QueuedFieldLogRepository(live(tabsGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: tabsProject, storage: tabsDevice.storage, createId: () => uid(tabsId++), clock: tabsDevice.clock, isOffline: () => tabsOffline })
  const tabOne = tabsTab(); const tabTwo = tabsTab()
  try {
    await tabTwo.getData()
    tabsOffline = true; const keptInTabOne = await tabOne.saveEntry(draft(uid(841))); const seenInTabTwo = await tabTwo.getData()
    assert(keptInTabOne.pending && seenInTabTwo.offline === undefined && rowsOf(seenInTabTwo) === `${uid(840)}:0.8,${uid(841)}:0.8:waiting`, `Rain one tab keeps waiting must show as not sent yet on the other tab's live answer. Got: ${rowsOf(seenInTabTwo)}`)
    tabsOffline = false; await tabTwo.inspectAndReplay(); await tabOne.inspectAndReplay()
    tabsGateway.loadFailure = new TypeError('Failed to fetch'); const sentInTabOne = await tabOne.getData()
    assert(sentInTabOne.offline && rowsOf(sentInTabOne) === `${uid(840)}:0.8,${uid(841)}:0.8` && tabsGateway.saves.length === 1, `Once sent, the first tab's answer without signal must show the rain as sent. Got: ${rowsOf(sentInTabOne)}`)
    type RuleCopy = { rows: string[] }; type RuleChange = { key: string; value: string }
    const ruleScope = { projectRef: tabsProject, userId: actor, farmId: farm, module: 'fieldLog:rule' }; const ruleFence = captureFarmRevocationFence(tabsDevice.storage, ruleScope)
    const ruleRows = () => ((tabsDevice.records.get(`${tabsProject}:${actor}:${farm}:fieldLog:rule`) as { data?: RuleCopy } | undefined)?.data?.rows ?? []).join()
    const ruleApply = (copy: RuleCopy, change: RuleChange): RuleCopy => ({ rows: [...copy.rows.filter((row) => !row.startsWith(`${change.key}=`)), `${change.key}=${change.value}`] })
    const ruleWrite = (turn: number, write: { replace: RuleCopy } | { change: RuleChange }) => writeWorkspaceCacheInOrder<RuleCopy, RuleChange>(ruleScope, write, turn, ruleFence, ruleApply)
    const set = (key: string, value: string) => ({ change: { key, value } }); const read = (...rows: string[]) => ({ replace: { rows } })
    assert(!(await ruleWrite(10, set('lone', 'change'))) && ruleRows() === '', 'A confirmed change must not make a saved copy of its own.')
    assert(await ruleWrite(10, read('a=read 10')), 'A first whole copy must be written.')
    assert(!(await ruleWrite(10, read('a=read 10 again'))) && !(await ruleWrite(9, read('a=read 9'))) && ruleRows() === 'a=read 10', `A whole copy needs a later turn than the stored copy's read. Got: ${ruleRows()}`)
    assert(!(await ruleWrite(9, set('b', 'change 9'))) && await ruleWrite(20, set('b', 'change 20')) && ruleRows() === 'a=read 10,b=change 20', `A confirmed change lands only on a copy read before it. Got: ${ruleRows()}`)
    assert(await ruleWrite(15, read('a=read 15', 'c=other phone')) && ruleRows() === 'a=read 15,c=other phone,b=change 20', `A whole copy read after the stored copy's read but before a confirmed change replaces it, with that change laid back on top. Got: ${ruleRows()}`)
    assert(await ruleWrite(25, read('a=read 25', 'b=edited on another phone')) && ruleRows() === 'a=read 25,b=edited on another phone', `A whole copy read after a confirmed change already has it, and keeps a later edit from elsewhere. Got: ${ruleRows()}`)
    assert(await ruleWrite(31, set('d', 'late')) && await ruleWrite(30, set('d', 'early')) && ruleRows() === 'a=read 25,b=edited on another phone,d=late', `Confirmed changes landing out of order keep the later one for each row. Got: ${ruleRows()}`)
    const sameMoment = await Promise.all([takeWorkspaceCacheTurn(ruleScope), takeWorkspaceCacheTurn(ruleScope), takeWorkspaceCacheTurn(ruleScope)])
    assert(sameMoment.every((turn) => turn !== null && turn > 31) && sameMoment[0]! < sameMoment[1]! && sameMoment[1]! < sameMoment[2]!, `Turns taken at the same moment must all differ, in the order asked, after every turn kept with the stored copy. Got: ${sameMoment.join()}`)
    // A confirmed change with no ordered copy yet starts one from an older copy valid for this farm's access, with no read
    // turn, so any live read replaces it (laying the change back when the read began first); an older copy from an earlier
    // access is never used.
    const startScope = { ...ruleScope, module: 'fieldLog:start' }; const previousRuleScope = { ...ruleScope, module: 'fieldLog:start-previous' }
    const startRows = () => ((tabsDevice.records.get(`${tabsProject}:${actor}:${farm}:fieldLog:start`) as { data?: RuleCopy } | undefined)?.data?.rows ?? []).join()
    const startWrite = (turn: number, write: { replace: RuleCopy } | { change: RuleChange; startFrom?: typeof previousRuleScope }, fence = ruleFence) => writeWorkspaceCacheInOrder<RuleCopy, RuleChange>(startScope, write, turn, fence, ruleApply)
    assert(await writeWorkspaceCache(previousRuleScope, { rows: ['a=previous version'] }, ruleFence), 'The older copy must be written.')
    assert(await startWrite(40, { change: { key: 'b', value: 'sent' }, startFrom: previousRuleScope }) && startRows() === 'a=previous version,b=sent', `A confirmed change must start the ordered copy from the older one. Got: ${startRows()}`)
    assert(await startWrite(35, read('a=live 35')) && startRows() === 'a=live 35,b=sent', `Any live read must replace a started copy, laying back a change confirmed after it began. Got: ${startRows()}`)
    resetFarmGrantFromLive(tabsDevice.storage, { projectRef: tabsProject, userId: actor, farmId: farm }, 2, '2026-07-13T12:00:00.000Z'); const regrantedFence = captureFarmRevocationFence(tabsDevice.storage, ruleScope)
    const otherStartScope = { ...ruleScope, module: 'fieldLog:start-after-regrant' }
    assert(!(await writeWorkspaceCacheInOrder<RuleCopy, RuleChange>(otherStartScope, { change: { key: 'c', value: 'sent' }, startFrom: previousRuleScope }, 50, regrantedFence, ruleApply)) && !tabsDevice.records.has(`${tabsProject}:${actor}:${farm}:fieldLog:start-after-regrant`), 'An older copy from an earlier farm access must not start an ordered copy.')
  } finally { tabsDevice.restore() }

  // Group 24: where a refused replay (groups 17-20) meets the saved copy and the live overlay (groups 21-23). A change the
  // server refused is parked in Needs attention and has left the queue, so no answer shows it as not sent yet and it never
  // reaches the saved copy; the writes behind it still send and still go into the saved copy. Retry sends it again: refused
  // again, it is parked again and the copy stays as it was; taken, it goes into the saved copy. Dismiss lets it go without
  // touching the copy. A refused delete leaves its row in the answers and in the copy.
  const meetDevice = deviceCache(); const meetProject = 'refused-meets-saved-copy-field-log'; const meetGateway = new FakeGateway(); let meetOffline = false; let meetId = 900
  meetGateway.entries = [canonical(draft(uid(940))), canonical(draft(uid(941)))]
  meetGateway.refuseSave = (entry) => entry.id === uid(942) || entry.id === uid(945) ? futureRefusal() : null
  meetGateway.refuseDelete = (entryId) => entryId === uid(941) ? Object.assign(new Error('entry does not belong to this field'), { code: 'P0001' }) : null
  const meetQueued = new QueuedFieldLogRepository(live(meetGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: meetProject, storage: meetDevice.storage, createId: () => uid(meetId++), clock: meetDevice.clock, isOffline: () => meetOffline })
  const meetKey = fieldLogWriteQueueKey(meetProject, actor, farm); const meetCopy = () => rowsOf(meetDevice.savedCopy(meetProject))
  const parkedOperation = (id: string) => readNeedsAttention(meetDevice.storage, meetKey).find((record) => { const entry = record.entry as { draft?: { id?: string }; entryId?: string }; return entry.draft?.id === id || entry.entryId === id })?.id
  try {
    await meetQueued.getData()
    meetOffline = true
    await meetQueued.saveEntry(draft(uid(942))); await meetQueued.saveEntry(draft(uid(943))); await meetQueued.deleteEntry(uid(940)); await meetQueued.deleteEntry(uid(941)); await meetQueued.saveEntry(draft(uid(945)))
    meetOffline = false; await meetQueued.inspectAndReplay()
    assert(readNeedsAttention(meetDevice.storage, meetKey).length === 3 && new FieldLogWriteQueue(meetDevice.storage, meetKey).read().entries.length === 0 && !!parkedOperation(uid(942)) && !!parkedOperation(uid(941)) && !!parkedOperation(uid(945)), 'The test needs two refused saves and a refused delete parked, and nothing left waiting.')
    assert(meetCopy() === `${uid(941)}:0.8,${uid(943)}:0.8`, `Refused changes must stay out of the saved copy while the writes sent after them go in. Saved copy: ${meetCopy()}`)
    const meetStatus = getModuleSyncStatus('fieldLog'); assert(meetStatus.kind === 'blocked' && meetStatus.pending === 3, `Parked changes must still read as needing attention. Got: ${JSON.stringify(meetStatus)}`)
    const meetLive = await meetQueued.getData()
    assert(meetLive.offline === undefined && rowsOf(meetLive) === `${uid(941)}:0.8,${uid(943)}:0.8` && meetLive.waitingIds?.length === 0, `A live answer must not show a parked change as not sent yet, and must keep a row whose delete was refused. Got: ${rowsOf(meetLive)}`)
    meetGateway.loadFailure = new TypeError('Failed to fetch'); const meetOfflineAnswer = await meetQueued.getData(); meetGateway.loadFailure = null
    assert(meetOfflineAnswer.offline && rowsOf(meetOfflineAnswer) === `${uid(941)}:0.8,${uid(943)}:0.8`, `An answer without signal must not show a parked change either. Got: ${rowsOf(meetOfflineAnswer)}`)
    await meetQueued.retryNeedsAttention(meetKey, parkedOperation(uid(942))!)
    const refusedAgain = await meetQueued.getData()
    assert(!!parkedOperation(uid(942)) && meetCopy() === `${uid(941)}:0.8,${uid(943)}:0.8` && rowsOf(refusedAgain) === `${uid(941)}:0.8,${uid(943)}:0.8`, `A retry the server refuses again must be parked again, leaving the saved copy and the answer as they were. Saved copy: ${meetCopy()} Answer: ${rowsOf(refusedAgain)}`)
    meetGateway.refuseSave = (entry) => entry.id === uid(945) ? futureRefusal() : null
    await meetQueued.retryNeedsAttention(meetKey, parkedOperation(uid(942))!)
    assert(!parkedOperation(uid(942)) && meetCopy() === `${uid(941)}:0.8,${uid(943)}:0.8,${uid(942)}:0.8`, `A retry the server takes must go into the saved copy. Saved copy: ${meetCopy()}`)
    await meetQueued.dismissNeedsAttention(meetKey, parkedOperation(uid(945))!)
    const afterMeetDismiss = await meetQueued.getData()
    assert(!parkedOperation(uid(945)) && !!parkedOperation(uid(941)) && meetCopy() === `${uid(941)}:0.8,${uid(943)}:0.8,${uid(942)}:0.8` && rowsOf(afterMeetDismiss) === `${uid(941)}:0.8,${uid(943)}:0.8,${uid(942)}:0.8`, `Dismiss must let a refused save go without touching the saved copy or the answer. Saved copy: ${meetCopy()} Answer: ${rowsOf(afterMeetDismiss)}`)
  } finally { meetDevice.restore() }

  // Group 25: a tab still on the previous app version writes its saved copy without turns, under the older key (Codex,
  // PR #72). It cannot overwrite the ordered copy: an answer without signal shows the ordered copy, not that tab's late,
  // older answer. Only while no ordered copy exists yet, as right after the update, does an answer without signal use the
  // older copy, which is what the previous version showed.
  const previousDevice = deviceCache(); const previousProject = 'previous-version-tab-field-log'; const previousGateway = new FakeGateway(); let previousId = 960
  previousGateway.entries = [canonical(draft(uid(950)))]
  const previousQueued = new QueuedFieldLogRepository(live(previousGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: previousProject, storage: previousDevice.storage, createId: () => uid(previousId++), clock: previousDevice.clock, isOffline: () => false })
  const previousScope = { projectRef: previousProject, userId: actor, farmId: farm, module: 'fieldLog:all' }
  const previousTabWrites = async (ids: number[]) => { assert(await writeWorkspaceCache(previousScope, { entries: ids.map((n) => canonical(draft(uid(n)))), viewer: { user_id: actor, role: 'worker' } }, captureWorkspaceCacheFence(previousScope, previousDevice.storage)), 'The previous-version tab must be able to write its own copy.') }
  try {
    await previousQueued.getNeedsAttentionQueueKey()
    await previousTabWrites([949])
    previousGateway.loadFailure = new TypeError('Failed to fetch'); const beforeAnyOrderedCopy = await previousQueued.getData()
    assert(beforeAnyOrderedCopy.offline && rowsOf(beforeAnyOrderedCopy) === `${uid(949)}:0.8`, `Without an ordered copy yet, an answer without signal must use the previous version's copy. Got: ${rowsOf(beforeAnyOrderedCopy)}`)
    previousGateway.loadFailure = null; previousGateway.entries.push(canonical(draft(uid(951)))); await previousQueued.getData()
    await previousTabWrites([948])
    previousGateway.loadFailure = new TypeError('Failed to fetch'); const afterPreviousTabWrite = await previousQueued.getData()
    assert(afterPreviousTabWrite.offline && rowsOf(afterPreviousTabWrite) === `${uid(950)}:0.8,${uid(951)}:0.8` && previousDevice.savedIds(previousProject) === `${uid(950)},${uid(951)}`, `A previous-version tab's late write must not replace the ordered copy. Got: ${rowsOf(afterPreviousTabWrite)}`)
  } finally { previousDevice.restore() }

  // Group 26: a live read in another tab that starts after the server committed a save, but before that save took its
  // turn, sees the save and whatever else changed on the server by then (here another phone's rain). The save goes into
  // the saved copy first; the read's newer whole copy must still replace it afterwards, with the save laid back on top, so
  // an answer without signal shows both (Codex, PR #72).
  class HeldSaveGateway extends HeldGateway { saveHold: Promise<void> | null = null; saveHolding = false; override async saveEntry(input: { farmId: string; operationId: string; entry: FieldLogEntryDraft }, context: FarmOperationContext) { const result = await super.saveEntry(input, context); if (this.saveHold) { const wait = this.saveHold; this.saveHold = null; this.saveHolding = true; await wait } return result } }
  const commitDevice = deviceCache(); const commitProject = 'post-commit-read-field-log'; const commitGateway = new HeldSaveGateway(); let commitId = 980
  commitGateway.entries = [canonical(draft(uid(970)))]
  const commitTab = () => new QueuedFieldLogRepository(live(commitGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: commitProject, storage: commitDevice.storage, createId: () => uid(commitId++), clock: commitDevice.clock, isOffline: () => false })
  const commitTabA = commitTab(); const commitTabB = commitTab()
  try {
    await commitTabA.getData()
    let releaseSave = () => {}; commitGateway.saveHold = new Promise<void>((resolve) => { releaseSave = resolve })
    const saving = commitTabA.saveEntry(draft(uid(971)))
    await until(() => commitGateway.saveHolding, 'The save never reached the server.')
    commitGateway.entries.push(canonical(draft(uid(972))))
    const releaseRead = holdNextRead(commitGateway); const reading = commitTabB.getData()
    await until(() => commitGateway.holding, 'The read in the other tab never reached the server.')
    releaseSave(); const saved = await saving
    assert(!saved.pending && commitDevice.savedIds(commitProject) === `${uid(970)},${uid(971)}`, `The confirmed save must go into the saved copy first. Saved copy: ${commitDevice.savedIds(commitProject)}`)
    releaseRead(); await reading
    assert(commitDevice.savedIds(commitProject) === `${uid(970)},${uid(971)},${uid(972)}`, `A read that started after the save was committed must replace the copy the save patched, keeping the save. Saved copy: ${commitDevice.savedIds(commitProject)}`)
    commitGateway.loadFailure = new TypeError('Failed to fetch'); const commitOffline = await commitTabA.getData()
    assert(commitOffline.offline && commitOffline.entries.map((entry) => entry.id).join() === `${uid(970)},${uid(971)},${uid(972)}`, 'An answer without signal must show the other phone\'s rain and the save.')
  } finally { commitDevice.restore() }

  // Group 27: right after the update, a device may hold only the previous version's saved copy, and a write waiting on it
  // can be sent before the Field Log's first live read (Codex, PR #72). The confirmed save and delete must still reach an
  // answer without signal: the ordered copy starts from the previous version's copy with them laid on, and the first live
  // read replaces it as usual.
  const handoverDevice = deviceCache(); const handoverProject = 'first-ordered-copy-field-log'; const handoverGateway = new FakeGateway(); let handoverOffline = true; let handoverId = 1000
  handoverGateway.entries = [canonical(draft(uid(990))), canonical(draft(uid(991)))]
  const handoverQueued = new QueuedFieldLogRepository(live(handoverGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: handoverProject, storage: handoverDevice.storage, createId: () => uid(handoverId++), clock: handoverDevice.clock, isOffline: () => handoverOffline })
  const handoverScope = { projectRef: handoverProject, userId: actor, farmId: farm, module: 'fieldLog:all' }
  try {
    await handoverQueued.getNeedsAttentionQueueKey()
    assert(await writeWorkspaceCache(handoverScope, { entries: [canonical(draft(uid(990))), canonical(draft(uid(991)))], viewer: { user_id: actor, role: 'worker' } }, captureWorkspaceCacheFence(handoverScope, handoverDevice.storage)), 'The previous version\'s copy must be written.')
    await handoverQueued.saveEntry(draft(uid(992))); await handoverQueued.deleteEntry(uid(990))
    handoverOffline = false; await handoverQueued.inspectAndReplay()
    assert(new FieldLogWriteQueue(handoverDevice.storage, fieldLogWriteQueueKey(handoverProject, actor, farm)).read().entries.length === 0, 'Both waiting writes must be sent before any live read.')
    assert(handoverDevice.savedIds(handoverProject) === `${uid(991)},${uid(992)}`, `The ordered copy must start from the previous version's copy with the sent writes laid on. Ordered copy: ${handoverDevice.savedIds(handoverProject)}`)
    handoverGateway.loadFailure = new TypeError('Failed to fetch'); const handoverOfflineAnswer = await handoverQueued.getData()
    assert(handoverOfflineAnswer.offline && handoverOfflineAnswer.entries.map((entry) => entry.id).join() === `${uid(991)},${uid(992)}`, `An answer without signal must show the sent save and not the sent delete. Got: ${handoverOfflineAnswer.entries.map((entry) => entry.id).join()}`)
    handoverGateway.loadFailure = null; handoverGateway.entries.push(canonical(draft(uid(993)))); await handoverQueued.getData()
    assert(handoverDevice.savedIds(handoverProject) === `${uid(991)},${uid(992)},${uid(993)}`, `The first live read must replace the started copy. Ordered copy: ${handoverDevice.savedIds(handoverProject)}`)
  } finally { handoverDevice.restore() }

  // Group 28: keeping a confirmed write in the saved copy never turns it into a failure. With a saved-copy writer that
  // throws, a direct save still answers as saved and is on the server, and a replay still empties the queue, parks nothing
  // and reads as synced, sending the write once: a throw there must not hold the queue and send the confirmed write again.
  const throwingStore = memory(); const throwingProject = 'saved-copy-throws-field-log'; const throwingGateway = new FakeGateway(); let throwingOffline = false; let throwingId = 1020
  const throwingQueued = new QueuedFieldLogRepository(live(throwingGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: throwingProject, storage: throwingStore, createId: () => uid(throwingId++), clock: () => stamp, isOffline: () => throwingOffline, writeWorkspaceCacheInOrder: async () => { throw new Error('The saved copy could not be written.') } })
  const throwingKey = fieldLogWriteQueueKey(throwingProject, actor, farm); const onServer = (n: number) => throwingGateway.entries.some((entry) => (entry as { id: string }).id === uid(n))
  let directSave: Awaited<ReturnType<typeof throwingQueued.saveEntry>> | null = null; try { directSave = await throwingQueued.saveEntry(draft(uid(1010))) } catch { directSave = null }
  assert(directSave !== null && !directSave.pending && onServer(1010), 'A direct save must answer as saved, and be on the server, when the saved copy cannot take it.')
  throwingOffline = true; await throwingQueued.saveEntry(draft(uid(1011))); throwingOffline = false; await throwingQueued.inspectAndReplay()
  const throwingStatus = getModuleSyncStatus('fieldLog')
  assert(new FieldLogWriteQueue(throwingStore, throwingKey).read().entries.length === 0 && readNeedsAttention(throwingStore, throwingKey).length === 0 && throwingStatus.kind === 'synced' && onServer(1011) && throwingGateway.saves.filter((call) => call.entry.id === uid(1011)).length === 1, `A replayed write must leave the queue, park nothing and read as synced when the saved copy cannot take it. Status: ${JSON.stringify(throwingStatus)}`)
  // Group 29: an edit of an entry someone deleted. The server refuses it (migration 20261021150000) rather than bringing the
  // entry back. On replay the edit goes to Needs attention in farmer wording (the page offers only Dismiss for it, see
  // FieldLogModule.refusedReplay.regression.tsx), and the writes behind it carry on; a direct edit answers with the refusal at once, and is neither queued nor parked.
  const deletedRefusal = () => Object.assign(new Error('field log entry was deleted and cannot be saved again'), { code: 'P0001', details: null, hint: null })
  const goneStore = memory(); const goneProject = 'deleted-entry-field-log'; const goneGateway = new FakeGateway(); let goneOffline = false; let goneId = 1100
  const deletedElsewhere = new Set<string>(); const goneOnServer = (n: number) => goneGateway.entries.some((entry) => (entry as { id: string }).id === uid(n))
  const deleteElsewhere = (n: number) => { goneGateway.entries = goneGateway.entries.filter((entry) => (entry as { id: string }).id !== uid(n)); deletedElsewhere.add(uid(n)) }
  goneGateway.entries = [canonical(draft(uid(1110))), canonical(draft(uid(1111)))]
  goneGateway.refuseSave = (entry) => entry.id && deletedElsewhere.has(entry.id) ? deletedRefusal() : null
  const goneQueued = new QueuedFieldLogRepository(live(goneGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: goneProject, storage: goneStore, createId: () => uid(goneId++), clock: () => stamp, isOffline: () => goneOffline })
  const goneKey = fieldLogWriteQueueKey(goneProject, actor, farm); const goneQueue = new FieldLogWriteQueue(goneStore, goneKey)
  goneOffline = true; await goneQueued.saveEntry({ ...draft(uid(1110)), rainfall_in: 1.4 }); await goneQueued.saveEntry(draft(uid(1112)))
  deleteElsewhere(1110); goneOffline = false; await goneQueued.inspectAndReplay()
  const goneParked = readNeedsAttention(goneStore, goneKey)
  assert(goneParked.length === 1 && (goneParked[0]!.entry as { draft?: { id?: string } }).draft?.id === uid(1110) && goneParked[0]!.message === FIELD_LOG_DELETED_ENTRY_MESSAGE, `An edit of a deleted entry must wait in Needs attention, saying why. Got: ${JSON.stringify(goneParked)}`)
  assert(!goneOnServer(1110), 'The edit must not bring the deleted entry back.')
  assert(goneOnServer(1112) && goneQueue.read().entries.length === 0, 'A new entry behind the refused edit must still save.')
  deleteElsewhere(1111)
  let directRefusal: unknown = null; try { await goneQueued.saveEntry({ ...draft(uid(1111)), rainfall_in: 2 }) } catch (error) { directRefusal = error }
  assert(isFieldLogDeletedEntryRefusal(directRefusal), `A direct edit of a deleted entry must answer with the server's refusal. Got: ${String(directRefusal)}`)
  assert(farmerError(directRefusal, 'save this field log entry') === 'Someone deleted this entry, so this change was not saved. Add it again if you still need it.', `The farmer must be told the entry was deleted, not to try again. Got: ${farmerError(directRefusal, 'save this field log entry')}`)
  assert(goneQueue.read().entries.length === 0 && readNeedsAttention(goneStore, goneKey).length === 1 && !goneOnServer(1111), 'A direct edit the server refuses must be neither queued, parked nor saved.')

  console.log('SupabaseFieldLogRepository regression passed (29 coverage groups)')
}
void run()
