import { farmRevocationFenceKey, markFarmGranted, markFarmRevoked } from './farmRevocationFence'
import type { StorageLike } from './writeQueue'

Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} })
const { queueTransaction } = await import('./queueTransaction')

class Storage implements StorageLike {
  values = new Map<string, string>()
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
console.log('Queue transaction regression passed (40 concurrent appends and stale revocation writer blocked).')
