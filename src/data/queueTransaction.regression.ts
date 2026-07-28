import { captureFarmRevocationFence, farmRevocationFenceKey, markFarmGranted, markFarmRevoked, resetFarmGrantFromLive, resetFarmRevokedFromLive } from './farmRevocationFence'
import { FieldLogWriteQueue, fieldLogWriteQueueKey } from './fieldLogWriteQueue'
import { quarantineRevokedFarmWork, readRevokedFarmRecovery } from './revokedFarmRecovery'
import type { StorageLike } from './writeQueue'

Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
const { createDeviceTransactionCoordinator, farmCustodyTransactionKey, queueTransaction } = await import('./queueTransaction')

class Storage implements StorageLike {
  values = new Map<string, string>()
  get length() { return this.values.size }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
let id = 1
const createId = () => `00000000-0000-4000-8000-${String(id++).padStart(12, '0')}`
const storage = new Storage()
const key = 'queue-transaction-regression'

storage.setItem(`${key}:lease`, JSON.stringify({ token: 'corrupt', expiresAt: Number.MAX_SAFE_INTEGER }))
const corruptLeaseStartedAt = Date.now()
await queueTransaction(key, storage, createId, async (verify) => { verify(); storage.setItem(key, '[]') })
assert(Date.now() - corruptLeaseStartedAt < 1_000, 'A corrupt far-future lease blocked acquisition instead of failing closed and recovering.')

await Promise.all(Array.from({ length: 40 }, (_, value) => queueTransaction(key, storage, createId, async (verify) => {
  const current = JSON.parse(storage.getItem(key) ?? '[]') as number[]
  await Promise.resolve()
  verify()
  storage.setItem(key, JSON.stringify([...current, value]))
})))

const values = JSON.parse(storage.getItem(key) ?? '[]') as number[]
assert(values.length === 40 && new Set(values).size === 40, 'Concurrent queue transactions lost an append.')
assert(storage.getItem(`${key}:lease`) === null, 'The queue transaction left a stale lease behind.')

const scope = { projectRef: 'project', userId: '00000000-0000-4000-8000-000000000001', farmId: '00000000-0000-4000-8000-000000000010' }
const scopedKey = `farm-rx-notifications-write-queue:v1:${scope.projectRef}:${scope.userId}:${scope.farmId}`
markFarmGranted(storage, scope, '2026-07-15T11:59:00.000Z')
let resume!: () => void
const paused = new Promise<void>((resolve) => { resume = resolve })
let entered!: () => void
const started = new Promise<void>((resolve) => { entered = resolve })
const stale = queueTransaction(scopedKey, storage, createId, async (verify) => {
  entered()
  await paused
  verify()
  storage.setItem(scopedKey, 'stale-write')
})
await started
markFarmRevoked(storage, scope, '2026-07-15T12:00:00.000Z')
storage.removeItem(farmRevocationFenceKey(scope))
markFarmGranted(storage, scope, '2026-07-15T12:01:00.000Z')
resume()
let staleBlocked = false
try { await stale } catch (error) { staleBlocked = error instanceof Error && /Access to this farm changed/.test(error.message) }
assert(staleBlocked, 'A stale transaction was not blocked after the primary fence disappeared during revoke/regrant.')
assert(storage.getItem(scopedKey) === null, 'A stale transaction wrote after a missing-fence revoke/regrant.')
await queueTransaction(scopedKey, storage, createId, async (verify) => { verify(); storage.setItem(scopedKey, 'new-generation-write') })
assert(storage.getItem(scopedKey) === 'new-generation-write', 'A newly granted transaction could not use the new generation.')

// A writer and removed-farm cleanup run in separate agent-like coordinators.
// Writer-first must retain its persisted work for removal recovery; removal-first
// must reject a later writer before it can create an active queue.
const custodyScope = { projectRef: 'custody-project', userId: scope.userId, farmId: '00000000-0000-4000-8000-000000000020' }
const custodyQueueKey = fieldLogWriteQueueKey(custodyScope.projectRef, custodyScope.userId, custodyScope.farmId)
const custodyLockKey = farmCustodyTransactionKey(custodyScope)
resetFarmGrantFromLive(storage, custodyScope, 1, '2026-07-15T12:02:00.000Z')
const custodyContext = captureFarmRevocationFence(storage, custodyScope)
const custodyQueue = new FieldLogWriteQueue(storage, custodyQueueKey)
const custodyEntry = { version: 2 as const, module: 'fieldLog' as const, kind: 'saveEntry' as const, operationId: '00000000-0000-4000-8000-000000000031', userId: custodyScope.userId, farmId: custodyScope.farmId, enqueuedAt: '2026-07-15T12:02:00.000Z', operationContext: custodyContext, draft: { id: '00000000-0000-4000-8000-000000000032', field_id: '00000000-0000-4000-8000-000000000033', entry_type: 'note' as const, observed_on: '2026-07-15', rainfall_in: null, note: 'Writer-first custody proof' } }
let releaseWriter!: () => void
const writerReleased = new Promise<void>((resolve) => { releaseWriter = resolve })
let writerEntered!: () => void
const writerInsideCustody = new Promise<void>((resolve) => { writerEntered = resolve })
const writer = queueTransaction(custodyQueueKey, storage, createId, async (verify) => { verify(); writerEntered(); await writerReleased; verify(); custodyQueue.append(custodyEntry) })
await writerInsideCustody
const removalCoordinator = createDeviceTransactionCoordinator()
let removalEntered = false
const removal = removalCoordinator(custodyLockKey, storage, createId, async (verify) => { removalEntered = true; verify(); quarantineRevokedFarmWork(storage, custodyScope, '2026-07-15T12:03:00.000Z'); verify(); resetFarmRevokedFromLive(storage, custodyScope, 2, '2026-07-15T12:03:00.000Z') })
await new Promise((resolve) => setTimeout(resolve, 100))
assert(!removalEntered, 'Removed-farm cleanup entered while a writer still owned the farm custody boundary.')
releaseWriter()
await writer
await removal
assert(storage.getItem(custodyQueueKey) === null, 'Writer-first removed-farm cleanup left active queue bytes behind.')
assert(readRevokedFarmRecovery(storage, custodyScope.projectRef, custodyScope.userId).some((record) => record.originalKey === custodyQueueKey && (record.payload as { entries?: Array<{ operationId?: string }> }).entries?.[0]?.operationId === custodyEntry.operationId), 'Writer-first removed-farm cleanup did not retain persisted work in exportable recovery.')

resetFarmGrantFromLive(storage, custodyScope, 3, '2026-07-15T12:04:00.000Z')
await removalCoordinator(custodyLockKey, storage, createId, async (verify) => { verify(); quarantineRevokedFarmWork(storage, custodyScope, '2026-07-15T12:05:00.000Z'); verify(); resetFarmRevokedFromLive(storage, custodyScope, 4, '2026-07-15T12:05:00.000Z') })
let removalFirstBlocked = false
try { await queueTransaction(custodyQueueKey, storage, createId, async (verify) => { verify(); custodyQueue.append({ ...custodyEntry, operationId: '00000000-0000-4000-8000-000000000034', operationContext: captureFarmRevocationFence(storage, custodyScope) }) }) } catch { removalFirstBlocked = true }
assert(removalFirstBlocked && storage.getItem(custodyQueueKey) === null, 'Removal-first allowed a later writer to create active queue work.')
console.log('Queue transaction regression passed (40 concurrent appends, stale revocation writer blocked, and farm-custody ordering).')
