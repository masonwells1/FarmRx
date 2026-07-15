import { queueTransaction } from './queueTransaction'
import type { StorageLike } from './writeQueue'

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

await Promise.all(Array.from({ length: 40 }, (_, value) => queueTransaction(key, storage, createId, async (verify) => {
  const current = JSON.parse(storage.getItem(key) ?? '[]') as number[]
  await Promise.resolve()
  verify()
  storage.setItem(key, JSON.stringify([...current, value]))
})))

const values = JSON.parse(storage.getItem(key) ?? '[]') as number[]
assert(values.length === 40 && new Set(values).size === 40, 'Concurrent queue transactions lost an append.')
assert(storage.getItem(`${key}:lease`) === null, 'The queue transaction left a stale lease behind.')
console.log('Queue transaction regression passed (40 concurrent appends).')
