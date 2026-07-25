import { QueuedFieldLogRepository } from './QueuedFieldLogRepository'
import type { FieldLogDataGateway } from './FieldLogDataGateway'
import { FieldLogWriteQueue, fieldLogWriteQueueKey } from './fieldLogWriteQueue'
import { canEditFieldLog, SupabaseFieldLogRepository } from './SupabaseFieldLogRepository'
import type { FarmOperationContext } from './farmOperationContext'
import { resetFarmGrantFromLive } from './farmRevocationFence'
import { readNeedsAttention } from './needsAttentionStore'
import type { FieldLogEntryDraft } from './fieldLog'
import type { StorageLike } from './writeQueue'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const farm = uid(1); const otherFarm = uid(2); const actor = uid(3); const field = uid(4); const otherField = uid(5); const stamp = '2026-07-12T12:30:00.123456+00:00'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => Promise<unknown>, message: string) { let failed = false; try { await action() } catch { failed = true }; assert(failed, message) }
function memory(): StorageLike & { values: Map<string, string> } { const values = new Map<string, string>(); return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) } }
function draft(id = uid(10), type: 'rainfall' | 'note' = 'rainfall'): FieldLogEntryDraft { return type === 'rainfall' ? { id, field_id: field, entry_type: type, observed_on: '2026-07-10', rainfall_in: 0.8, note: 'Storm total' } : { id, field_id: field, entry_type: type, observed_on: '2026-07-10', rainfall_in: null, note: 'First cutting' } }
function canonical(value: FieldLogEntryDraft, farmId = farm) { return { id: value.id!, farm_id: farmId, field_id: value.field_id, entry_type: value.entry_type, observed_on: value.observed_on, rainfall_in: value.rainfall_in, note: value.note, created_by: actor, created_at: stamp, updated_at: stamp } }
class FakeGateway implements FieldLogDataGateway {
  entries: unknown[] = []; role: unknown = { role: 'worker' }; saves: Array<{ operationId: string; entry: FieldLogEntryDraft; context: FarmOperationContext }> = []; deletes: Array<{ entryId: string; context: FarmOperationContext }> = []; mutateSave: (value: unknown) => unknown = (value) => value; mutateDelete: (value: unknown) => unknown = (value) => value; saveFailure: Error | null = null
  async loadEntries(farmId: string) { return structuredClone(this.entries.filter((entry) => (entry as { farm_id: string }).farm_id === farmId)) }
  async loadViewerRole() { return structuredClone(this.role) }
  async saveEntry(input: { farmId: string; operationId: string; entry: FieldLogEntryDraft }, context: FarmOperationContext) { this.saves.push({ operationId: input.operationId, entry: structuredClone(input.entry), context: structuredClone(context) }); const existing = this.entries.find((entry) => (entry as { id: string }).id === input.entry.id); const result = existing ?? canonical(input.entry, input.farmId); if (!existing) this.entries.push(result); if (this.saveFailure) throw this.saveFailure; return structuredClone(this.mutateSave(result)) }
  async deleteEntry(input: { farmId: string; entryId: string }, context: FarmOperationContext) { this.deletes.push({ entryId: input.entryId, context: structuredClone(context) }); this.entries = this.entries.filter((entry) => (entry as { farm_id: string; id: string }).farm_id !== input.farmId || (entry as { id: string }).id !== input.entryId); return structuredClone(this.mutateDelete({ id: input.entryId, deleted: true })) }
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

  // Group 7: a same-ID revoke/regrant cannot upgrade old queued work to the new access epoch.
  const regrantStore = memory(); let regrantOffline = true; const regrantGateway = new FakeGateway(); const regrantProject = 'regrant-field-log'; let regrantId = 500
  const regrantQueued = new QueuedFieldLogRepository(live(regrantGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: regrantProject, storage: regrantStore, createId: () => uid(regrantId++), clock: () => stamp, isOffline: () => regrantOffline })
  await regrantQueued.saveEntry(draft(uid(501))); const regrantQueue = new FieldLogWriteQueue(regrantStore, fieldLogWriteQueueKey(regrantProject, actor, farm)); const regrantBytes = regrantStore.getItem(regrantQueue.key); const oldCustody = regrantQueue.read().entries[0]
  resetFarmGrantFromLive(regrantStore, { projectRef: regrantProject, userId: actor, farmId: farm }, 2, '2026-07-12T13:00:00.000Z'); regrantOffline = false
  await rejects(() => regrantQueued.inspectAndReplay(), 'A same-ID regrant must reject replay under the new epoch.')
  assert(regrantGateway.saves.length === 0 && regrantStore.getItem(regrantQueue.key) === regrantBytes && oldCustody?.version === 2 && oldCustody.operationContext.serverEpoch === 1, 'A same-ID regrant must preserve the byte-exact old queue and make zero remote calls.')

  // Group 8: a lost response retains and replays the original operation-era context.
  const lostStore = memory(); const lostGateway = new FakeGateway(); lostGateway.saveFailure = new TypeError('Failed to fetch after commit'); let lostId = 600
  const lostQueued = new QueuedFieldLogRepository(live(lostGateway), { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: 'lost-field-log', storage: lostStore, createId: () => uid(lostId++), clock: () => stamp, isOffline: () => false })
  const lostPending = await lostQueued.saveEntry(draft(uid(601))); const lostQueue = new FieldLogWriteQueue(lostStore, fieldLogWriteQueueKey('lost-field-log', actor, farm)); const lostEntry = lostQueue.read().entries[0]
  assert(lostPending.pending && lostEntry?.version === 2 && lostGateway.saves.length === 1, 'An ambiguous committed response must retain one custody-bearing queue entry.')
  const lostCustody = lostEntry.operationContext
  lostGateway.saveFailure = null; await lostQueued.inspectAndReplay()
  assert(lostQueue.read().entries.length === 0 && [...lostGateway.saves].length === 2 && lostGateway.saves.every((call) => JSON.stringify(call.context) === JSON.stringify(lostCustody)), 'Lost-response replay must resend the same operation with the exact saved custody context.')

  // Group 9: legacy work is durably parked without a remote call, while corrupt bytes stay untouched.
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

  // Group 10: queue bytes reject malformed DB-illegal shapes and season math excludes notes.
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
  console.log('SupabaseFieldLogRepository regression passed (10 coverage groups)')
}
void run()
