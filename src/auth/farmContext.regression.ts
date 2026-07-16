import assert from 'node:assert/strict'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const storage = new MemoryStorage()
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })

const { supabase } = await import('../lib/supabaseClient')
const { loadFarmAccess } = await import('./farmContext')
const { farmRevocationFenceKey } = await import('../data/farmRevocationFence')
const { supabaseConfig } = await import('../lib/supabaseConfig')

const userA = '00000000-0000-4000-8000-000000000001'
const userB = '00000000-0000-4000-8000-000000000002'
const farmA = '00000000-0000-4000-8000-000000000011'
const farmB = '00000000-0000-4000-8000-000000000022'
const now = '2026-07-15T12:00:00.000Z'
const farm = (id: string, userId: string, name: string) => ({ id, name, share_with_rep: false, created_by: userId, created_at: now, updated_at: now })

let currentUser = userA
let releaseA!: (value: { data: ReturnType<typeof farm>[]; error: null }) => void
const delayedA = new Promise<{ data: ReturnType<typeof farm>[]; error: null }>((resolve) => { releaseA = resolve })
let sawA!: () => void
const aStarted = new Promise<void>((resolve) => { sawA = resolve })

type SessionResult = { data: { session: { user: { id: string } } }; error: null }
;(supabase.auth as unknown as { getSession: () => Promise<SessionResult> }).getSession = async () => ({ data: { session: { user: { id: currentUser } } }, error: null })

type QueryResult = { data: ReturnType<typeof farm>[]; error: null }
type Query = PromiseLike<QueryResult> & { select: () => Query; order: () => Query }
;(supabase as unknown as { from: (table: string) => Query }).from = (table: string) => {
  assert.equal(table, 'farms')
  const requestedUser = currentUser
  const result = requestedUser === userA ? (sawA(), delayedA) : Promise.resolve({ data: [farm(farmB, userB, 'User B Farm')], error: null })
  const query = {
    select: () => query,
    order: () => query,
    then: result.then.bind(result),
  } as Query
  return query
}

;(supabase as unknown as { rpc: (name: string) => Promise<{ data: Array<{ farm_id: string; access_epoch: number }>; error: null }> }).rpc = async (name: string) => {
  assert.equal(name, 'get_current_farm_access_epochs')
  assert.equal(currentUser, userB, 'User A reached the epoch RPC after the account switched.')
  return { data: [{ farm_id: farmB, access_epoch: 1 }], error: null }
}

const userALoad = loadFarmAccess(userA, true)
await aStarted
currentUser = userB
const userBAccess = await loadFarmAccess(userB, true)
releaseA({ data: [farm(farmA, userA, 'User A Farm')], error: null })
await assert.rejects(userALoad, /no longer matches the signed-in account/)

assert.equal(userBAccess.userId, userB)
assert.deepEqual(userBAccess.farms.map(({ id }) => id), [farmB])
assert.equal(storage.getItem(`farm-rx-access:v1:${supabaseConfig.projectRef}:${userA}`), null, 'User A access was persisted after switching to User B.')
assert.notEqual(storage.getItem(`farm-rx-access:v1:${supabaseConfig.projectRef}:${userB}`), null, 'User B access was not persisted independently.')
assert.equal(storage.getItem(farmRevocationFenceKey({ projectRef: supabaseConfig.projectRef, userId: userA, farmId: farmA })), null, 'User A farm fence was recreated after switching accounts.')
assert.equal((JSON.parse(storage.getItem(`farm-rx-active-context:v1:${supabaseConfig.projectRef}`) ?? '{}') as { userId?: string }).userId, userB)

console.log('Farm access account-isolation regression passed (paused A refresh cannot satisfy or repersist into B).')
