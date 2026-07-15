import type { StorageLike } from './writeQueue'

const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
const leaseTtlMs = 6_000
const processLocks = new Map<string, Promise<void>>()
const changeListeners = new Set<(key: string) => void>()
let changeChannel: BroadcastChannel | null = null
let storageListening = false

function pause(milliseconds: number) { return new Promise<void>((resolve) => setTimeout(resolve, milliseconds)) }
function expiry(raw: string | null) {
  if (!raw) return 0
  try { const value = JSON.parse(raw) as { expiresAt?: unknown }; return typeof value.expiresAt === 'number' ? value.expiresAt : 0 } catch { return 0 }
}

async function serial<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = processLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  const tail = previous.then(() => current)
  processLocks.set(key, tail)
  await previous
  try { return await task() }
  finally { release(); if (processLocks.get(key) === tail) processLocks.delete(key) }
}

async function leased<T>(key: string, storage: StorageLike, createId: () => string, task: (verify: () => void) => Promise<T>): Promise<T> {
  const leaseKey = `${key}:lease`
  const token = createId()
  let lease = ''
  const owns = () => storage.getItem(leaseKey) === lease
  const claim = () => {
    lease = JSON.stringify({ token, expiresAt: Date.now() + leaseTtlMs })
    storage.setItem(leaseKey, lease)
    return owns()
  }
  while (true) {
    const remaining = expiry(storage.getItem(leaseKey)) - Date.now()
    if (remaining > 0) { await pause(Math.max(20, Math.min(100, remaining))); continue }
    claim()
    // localStorage has no compare-and-swap. A short arbitration window lets
    // simultaneous fallback contenders observe the final claimant; only that
    // claimant enters the critical section.
    await pause(30 + token.charCodeAt(token.length - 1) % 20)
    if (owns()) break
  }
  let lost = false
  const verify = () => {
    if (lost || !owns()) throw new Error(blocked)
    if (!claim()) { lost = true; throw new Error(blocked) }
  }
  const timer = setInterval(() => { try { verify() } catch { lost = true } }, Math.floor(leaseTtlMs / 3))
  try { verify(); return await task(verify) }
  finally { clearInterval(timer); if (owns()) storage.removeItem(leaseKey) }
}

/** One transaction boundary for every queue read-modify-write and replay. Web
 * Locks coordinate tabs; the renewable localStorage lease is the fail-closed
 * fallback for browsers without Web Locks. The task must call verify directly
 * before each persistence step and after every awaited remote operation. */
function publish(key: string) { changeChannel?.postMessage({ version: 1, key }) }
function ensureChangeFeed() {
  if (typeof window === 'undefined') return
  if (typeof BroadcastChannel !== 'undefined' && !changeChannel) {
    changeChannel = new BroadcastChannel('farm-rx-queue-change:v1')
    changeChannel.onmessage = (event: MessageEvent<unknown>) => {
      const value = event.data as { version?: unknown; key?: unknown }
      if (value?.version === 1 && typeof value.key === 'string') for (const listener of changeListeners) listener(value.key)
    }
  }
  if (!storageListening) {
    window.addEventListener('storage', (event) => { if (event.key?.startsWith('farm-rx-') && !event.key.endsWith(':lease')) for (const listener of changeListeners) listener(event.key) })
    storageListening = true
  }
}

export function subscribeQueueTransactions(listener: (key: string) => void) { ensureChangeFeed(); changeListeners.add(listener); return () => changeListeners.delete(listener) }

export async function queueTransaction<T>(key: string, storage: StorageLike, createId: () => string, task: (verify: () => void) => Promise<T>): Promise<T> {
  let touched = false
  const result = await serial(key, async () => {
    const lockName = `farm-rx-queue:${key}`
    if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(lockName, async () => task(() => { touched = true }))
    return leased(key, storage, createId, (verify) => task(() => { verify(); touched = true }))
  })
  if (touched) publish(key)
  return result
}
