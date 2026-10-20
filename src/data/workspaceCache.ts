import { captureFarmRevocationFence, ensureQueueFarmGrant, verifyFarmRevocationFence, type FarmRevocationSnapshot } from './farmRevocationFence'
import type { ReadOnlySnapshot } from './fields'
import type { StorageLike } from './writeQueue'
export { maximumClockSkewMs } from './deviceClockFence'
import { maximumClockSkewMs } from './deviceClockFence'

export const financialCacheMaxAgeMs = 24 * 60 * 60 * 1_000
export const operationalCacheMaxAgeMs = 7 * 24 * 60 * 60 * 1_000

export type WorkspaceCacheScope = { projectRef: string; userId: string; farmId: string; module: string }
export type WorkspaceMemoryGuard = { key: string; fence: FarmRevocationSnapshot }
type WorkspaceEnvelopeV2<T> = WorkspaceCacheScope & { version: 2; key: string; generation: number; fenceToken: string; serverEpoch: number; cachedAt: string; data: T }
type WorkspaceEnvelopeV3<T> = WorkspaceCacheScope & { version: 3; key: string; generation: number; fenceToken: string; serverEpoch: number; cacheCustody: number; cachedAt: string; data: T; turn?: number; changes?: Array<{ turn: number; change: unknown }> }
type WorkspaceEnvelope<T> = WorkspaceEnvelopeV2<T> | WorkspaceEnvelopeV3<T>
export type WorkspaceCacheNotice = { module: string; cachedAt: string }

export class WorkspaceCacheCustodyError extends Error {
  constructor() { super('Farm Rx could not verify offline cache custody.') }
}

const storeName = 'workspaces'
const listeners = new Set<() => void>()
const notices = new Map<string, WorkspaceCacheNotice>()
let noticeSnapshot: WorkspaceCacheNotice[] = []

function cacheKey(scope: WorkspaceCacheScope) { return `${scope.projectRef}:${scope.userId}:${scope.farmId}:${scope.module}` }
function custodyKey(scope: WorkspaceCacheScope) { return `farm-rx-workspace-cache-custody:v1:${cacheKey(scope)}` }
export function captureWorkspaceCacheCustody(storage: StorageLike, scope: WorkspaceCacheScope): number { const raw = storage.getItem(custodyKey(scope)); if (raw === null) return 0; const value = Number(raw); if (!Number.isSafeInteger(value) || value < 0 || String(value) !== raw) throw new WorkspaceCacheCustodyError() ; return value }
export function verifyWorkspaceCacheCustody(storage: StorageLike, scope: WorkspaceCacheScope, expected: number): boolean { try { return captureWorkspaceCacheCustody(storage, scope) === expected } catch { return false } }
/** Older or malformed snapshots may be deleted; same/newer custody belongs to a later writer. */
export function shouldDeleteInvalidatedWorkspaceCache(cacheCustody: unknown, invalidationCustody: number): boolean { return !Number.isSafeInteger(cacheCustody) || Number(cacheCustody) < invalidationCustody }
function databaseName(projectRef: string) { return `farm-rx-offline-v1-${projectRef}` }
function available() { return typeof indexedDB !== 'undefined' }
function open(projectRef: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName(projectRef), 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName, { keyPath: 'key' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Farm Rx could not open offline storage.'))
    request.onblocked = () => reject(new Error('Farm Rx offline storage is blocked by another tab.'))
  })
}
async function openExisting(projectRef: string): Promise<IDBDatabase | null> {
  if (!available()) return null
  const factory = indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> }
  if (typeof factory.databases !== 'function') return null
  const name = databaseName(projectRef)
  const known = await factory.databases.call(factory)
  if (!known.some((entry) => entry.name === name)) return null
  return new Promise((resolve) => {
    const request = indexedDB.open(name)
    let upgrading = false
    request.onupgradeneeded = () => { upgrading = true; request.transaction?.abort() }
    request.onsuccess = () => {
      if (upgrading || !request.result.objectStoreNames.contains(storeName)) { request.result.close(); resolve(null); return }
      resolve(request.result)
    }
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
}
function requestResult<T>(request: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error('Farm Rx could not use offline storage.')) }) }
function complete(transaction: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error ?? new Error('Farm Rx could not save offline data.')); transaction.onabort = () => reject(transaction.error ?? new Error('Farm Rx could not save offline data.')) }) }
function validEnvelope<T>(value: unknown, scope: WorkspaceCacheScope, fence: FarmRevocationSnapshot, cacheCustody: number): value is WorkspaceEnvelope<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  const matchingScope = row.key === cacheKey(scope) && row.projectRef === scope.projectRef && row.userId === scope.userId && row.farmId === scope.farmId && row.module === scope.module && row.generation === fence.generation && row.fenceToken === fence.token && row.serverEpoch === fence.serverEpoch && typeof row.cachedAt === 'string' && !Number.isNaN(Date.parse(row.cachedAt)) && Object.hasOwn(row, 'data')
  return matchingScope && (row.version === 3 ? row.cacheCustody === cacheCustody : row.version === 2 && cacheCustody === 0)
}
function publish(notice: WorkspaceCacheNotice) { notices.set(notice.module, notice); noticeSnapshot = [...notices.values()].sort((a, b) => a.cachedAt.localeCompare(b.cachedAt)); for (const listener of listeners) listener() }

/** Tags retained repository state with the exact account and revocation epoch
 * that produced it. A context switch clears the old value, and a late async
 * response cannot overwrite the new account's in-memory workspace. */
export class WorkspaceMemoryScope {
  private currentKey: string | null = null

  enter(storage: StorageLike, scope: WorkspaceCacheScope, clear: () => void): WorkspaceMemoryGuard {
    ensureQueueFarmGrant(storage, scope)
    const fence = captureFarmRevocationFence(storage, scope)
    const key = `${cacheKey(scope)}:${fence.generation}:${fence.token}:${fence.serverEpoch}`
    if (key !== this.currentKey) { clear(); this.currentKey = key }
    return { key, fence }
  }

  verify(storage: StorageLike, guard: WorkspaceMemoryGuard): void {
    if (guard.key !== this.currentKey) throw new WorkspaceMemoryChangedError()
    try { verifyFarmRevocationFence(storage, guard.fence) } catch { throw new WorkspaceMemoryChangedError() }
  }
}

export class WorkspaceMemoryChangedError extends Error {
  constructor() { super('Access to this farm changed while data was loading.'); this.name = 'WorkspaceMemoryChangedError' }
}

export class WorkspaceCacheExpiredError extends Error {
  constructor() { super('This offline copy is too old to show safely. Connect to verify your farm access.'); this.name = 'WorkspaceCacheExpiredError' }
}

function resolveStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage
  return typeof localStorage === 'undefined' ? null : localStorage
}

export function captureWorkspaceCacheFence(scope: WorkspaceCacheScope, storage?: StorageLike): FarmRevocationSnapshot | null {
  const store = resolveStorage(storage)
  if (!store) return null
  try { return captureFarmRevocationFence(store, scope) } catch { return null }
}

export async function writeWorkspaceCache<T>(scope: WorkspaceCacheScope, data: T, fence: FarmRevocationSnapshot | null, cachedAt = new Date().toISOString(), expectedCacheCustody?: number, storage?: StorageLike): Promise<boolean> {
  const store = resolveStorage(storage)
  if (!available() || !fence || !store) return false
  let database: IDBDatabase | null = null
  try {
    const cacheCustody = expectedCacheCustody ?? captureWorkspaceCacheCustody(store, scope)
    if (!verifyWorkspaceCacheCustody(store, scope, cacheCustody)) return false
    database = await open(scope.projectRef)
    verifyFarmRevocationFence(store, fence)
    if (!verifyWorkspaceCacheCustody(store, scope, cacheCustody)) return false
    const transaction = database.transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).put({ version: 3, key: cacheKey(scope), ...scope, generation: fence.generation, fenceToken: fence.token, serverEpoch: fence.serverEpoch, cacheCustody, cachedAt, data: structuredClone(data) } satisfies WorkspaceEnvelope<T>)
    await complete(transaction)
    verifyFarmRevocationFence(store, fence)
    if (!verifyWorkspaceCacheCustody(store, scope, cacheCustody)) return false
    return true
  } catch { return false }
  finally { database?.close() }
}

/** A saved-copy write that must not go backwards: a whole new copy from a live read, or one change the server confirmed.
 * A change may name an older copy to start from when no ordered copy exists yet (one an earlier app version saved). */
export type OrderedWorkspaceWrite<T, C> = { replace: T } | { change: C; startFrom?: WorkspaceCacheScope }
type KeptChange<C> = { turn: number; change: C }
const turnCounterKey = 'farm-rx-workspace-cache-turn'
const turnOf = (value: unknown) => { const turn = value && typeof value === 'object' ? (value as { turn?: unknown }).turn : undefined; return typeof turn === 'number' && Number.isSafeInteger(turn) && turn > 0 ? turn : 0 }
function keptChangesOf<C>(value: unknown): KeptChange<C>[] {
  const changes = value && typeof value === 'object' ? (value as { changes?: unknown }).changes : undefined
  return Array.isArray(changes) ? changes.filter((item): item is KeptChange<C> => turnOf(item) > 0 && Object.hasOwn(item as object, 'change')).sort((a, b) => a.turn - b.turn) : []
}
const latestTurnOf = (value: unknown) => Math.max(turnOf(value), ...keptChangesOf(value).map((item) => item.turn))

/** Takes this device's next saved-copy turn. Every tab draws from one counter kept in IndexedDB, which runs one transaction
 * at a time, so no two turns are equal, even taken in the same millisecond, and a later turn was always taken later. Take
 * it when a copy's news is known: before a live read asks the server, or once the server confirmed a change. The counter
 * never falls behind the turns kept with the scope's stored copy. Null when offline storage cannot be used; it never throws. */
export async function takeWorkspaceCacheTurn(scope: WorkspaceCacheScope): Promise<number | null> {
  if (!available()) return null
  let database: IDBDatabase | null = null
  try {
    database = await open(scope.projectRef)
    const transaction = database.transaction(storeName, 'readwrite')
    const objectStore = transaction.objectStore(storeName)
    const counter = objectStore.get(turnCounterKey); const stored = objectStore.get(cacheKey(scope))
    let turn: number | null = null
    stored.onsuccess = () => { turn = Math.max(turnOf(counter.result), latestTurnOf(stored.result)) + 1; objectStore.put({ key: turnCounterKey, turn }) }
    await complete(transaction)
    return turn
  } catch { return null }
  finally { database?.close() }
}

/** Writes a saved copy in turn order across every tab on this device (see takeWorkspaceCacheTurn). The stored copy carries
 * the turn of the live read it came from, and the changes confirmed since, each with its own turn.
 * - A whole new copy replaces it only with a later turn than that read. A change confirmed after the new copy's read began
 *   may be missing from it, so those kept changes are laid back on top; older ones are already in it and are dropped.
 * - A confirmed change lands only on a stored copy whose read began before the change's turn (a later read already has
 *   it). It is laid on the copy, the changes confirmed after it are laid again so the latest wins per row, and it is kept.
 *   It leaves the copy's turn and cachedAt as they were, so a newer read still replaces the copy. With no stored copy it
 *   starts one from `startFrom` when that copy is valid for this farm's fence, with no read turn, so any live read
 *   replaces it; without either, nothing is written.
 * `apply` lays one change on a copy; it must give the same row whether or not the copy had it. The check and the write
 * share one IndexedDB transaction. Returns whether it wrote; like writeWorkspaceCache it never throws. */
export async function writeWorkspaceCacheInOrder<T, C>(scope: WorkspaceCacheScope, write: OrderedWorkspaceWrite<T, C>, turn: number | null, fence: FarmRevocationSnapshot | null, apply: (data: T, change: C) => T, storage?: StorageLike): Promise<boolean> {
  const store = resolveStorage(storage)
  if (!available() || !fence || !store || turn === null) return false
  let database: IDBDatabase | null = null
  try {
    const cacheCustody = captureWorkspaceCacheCustody(store, scope)
    const startFrom = 'change' in write ? write.startFrom : undefined
    let startCustody: number | null = null; if (startFrom) { try { startCustody = captureWorkspaceCacheCustody(store, startFrom) } catch { startCustody = null } }
    database = await open(scope.projectRef)
    verifyFarmRevocationFence(store, fence)
    if (!verifyWorkspaceCacheCustody(store, scope, cacheCustody)) return false
    const transaction = database.transaction(storeName, 'readwrite')
    const objectStore = transaction.objectStore(storeName)
    const request = objectStore.get(cacheKey(scope))
    let written = false
    const envelope = { version: 3 as const, key: cacheKey(scope), ...scope, generation: fence.generation, fenceToken: fence.token, serverEpoch: fence.serverEpoch, cacheCustody }
    const putChange = (change: C, base: WorkspaceEnvelope<T>, readTurn: number, kept: KeptChange<C>[]) => {
      const changes = [...kept, { turn: turn!, change }].sort((a, b) => a.turn - b.turn)
      objectStore.put({ ...envelope, ...(readTurn ? { turn: readTurn } : {}), changes, cachedAt: base.cachedAt, data: changes.filter((item) => item.turn >= turn!).reduce((data, item) => apply(data, item.change), structuredClone(base.data)) } satisfies WorkspaceEnvelope<T>)
      written = true
    }
    request.onsuccess = () => {
      try {
        verifyFarmRevocationFence(store, fence)
        if (!verifyWorkspaceCacheCustody(store, scope, cacheCustody)) return
        const stored = validEnvelope<T>(request.result, scope, fence, cacheCustody) ? request.result as WorkspaceEnvelope<T> : null
        const readTurn = stored ? turnOf(stored) : 0; const kept = stored ? keptChangesOf<C>(stored) : []
        if (turn <= readTurn) return
        if ('replace' in write) {
          const later = kept.filter((item) => item.turn > turn)
          objectStore.put({ ...envelope, turn, changes: later, cachedAt: new Date().toISOString(), data: later.reduce((data, item) => apply(data, item.change), structuredClone(write.replace)) } satisfies WorkspaceEnvelope<T>)
          written = true
        } else if (stored) putChange(write.change, stored, readTurn, kept)
        else if (startFrom && startCustody !== null) {
          const previous = objectStore.get(cacheKey(startFrom))
          previous.onsuccess = () => {
            try {
              verifyFarmRevocationFence(store, fence)
              if (!verifyWorkspaceCacheCustody(store, scope, cacheCustody) || !verifyWorkspaceCacheCustody(store, startFrom, startCustody!)) return
              if (validEnvelope<T>(previous.result, startFrom, fence, startCustody!)) putChange(write.change, previous.result as WorkspaceEnvelope<T>, 0, [])
            } catch { written = false }
          }
        }
      } catch { written = false }
    }
    await complete(transaction)
    verifyFarmRevocationFence(store, fence)
    if (!verifyWorkspaceCacheCustody(store, scope, cacheCustody)) return false
    return written
  } catch { return false }
  finally { database?.close() }
}

/** Records a synchronous fence before a queue can release its matching
 * projection. Call the returned finisher after that durable release. */
export function beginWorkspaceCacheInvalidation(storage: StorageLike, scope: WorkspaceCacheScope): () => Promise<void> {
  const nextCustody = captureWorkspaceCacheCustody(storage, scope) + 1
  storage.setItem(custodyKey(scope), String(nextCustody))
  return async () => {
    if (!available()) return
    const database = await open(scope.projectRef)
    try {
      const transaction = database.transaction(storeName, 'readwrite')
      const store = transaction.objectStore(storeName)
      const request = store.get(cacheKey(scope))
      request.onsuccess = () => {
        const value = request.result as { cacheCustody?: unknown } | undefined
        if (value === undefined || shouldDeleteInvalidatedWorkspaceCache(value.cacheCustody, nextCustody)) store.delete(cacheKey(scope))
      }
      await complete(transaction)
    } finally { database.close() }
  }
}

export async function readWorkspaceCache<T>(scope: WorkspaceCacheScope, maximumAgeMs: number, storage?: StorageLike): Promise<{ data: T; cachedAt: string } | null> {
  const store = resolveStorage(storage)
  if (!available() || !store) return null
  let fence
  let cacheCustody
  try { fence = captureFarmRevocationFence(store, scope); cacheCustody = captureWorkspaceCacheCustody(store, scope) } catch { return null }
  const database = await open(scope.projectRef)
  try {
    const transaction = database.transaction(storeName, 'readonly')
    const value = await requestResult(transaction.objectStore(storeName).get(cacheKey(scope)))
    if (value === undefined) return null
    if (!verifyWorkspaceCacheCustody(store, scope, cacheCustody)) return null
    if (!validEnvelope<T>(value, scope, fence, cacheCustody)) return null
    const ageMs = Date.now() - Date.parse(value.cachedAt)
    if (ageMs < -maximumClockSkewMs || ageMs > maximumAgeMs) throw new WorkspaceCacheExpiredError()
    try { verifyFarmRevocationFence(store, fence) } catch { return null }
    if (!verifyWorkspaceCacheCustody(store, scope, cacheCustody)) return null
    publish({ module: scope.module.split(':')[0], cachedAt: value.cachedAt })
    return { data: structuredClone(value.data), cachedAt: value.cachedAt }
  } finally { database.close() }
}

/** Read-only projection cache access. It never creates/upgrades IndexedDB and never publishes UI notices. */
export async function readWorkspaceCachePure<T>(scope: WorkspaceCacheScope, fence: FarmRevocationSnapshot, maximumAgeMs: number, storage: StorageLike, nowMs = Date.now()): Promise<ReadOnlySnapshot<T> | null> {
  if (!Number.isFinite(nowMs) || fence.projectRef !== scope.projectRef || fence.userId !== scope.userId || fence.farmId !== scope.farmId) return null
  let cacheCustody: number
  try { cacheCustody = captureWorkspaceCacheCustody(storage, scope) } catch { return null }
  try { verifyFarmRevocationFence(storage, fence) } catch { return null }
  const database = await openExisting(scope.projectRef)
  if (!database) return null
  try {
    const transaction = database.transaction(storeName, 'readonly')
    const value = await requestResult(transaction.objectStore(storeName).get(cacheKey(scope)))
    if (value === undefined || !validEnvelope<T>(value, scope, fence, cacheCustody)) return null
    if (!verifyWorkspaceCacheCustody(storage, scope, cacheCustody)) return null
    const ageMs = nowMs - Date.parse(value.cachedAt)
    if (ageMs < -maximumClockSkewMs || ageMs > maximumAgeMs) throw new WorkspaceCacheExpiredError()
    try { verifyFarmRevocationFence(storage, fence) } catch { return null }
    if (!verifyWorkspaceCacheCustody(storage, scope, cacheCustody)) return null
    return { data: structuredClone(value.data), source: 'offline', capturedAt: value.cachedAt }
  } finally { database.close() }
}

export async function deleteUserWorkspaceCaches(projectRef: string, userId: string, farmId?: string): Promise<void> {
  if (!available()) return
  const database = await open(projectRef)
  try {
    const transaction = database.transaction(storeName, 'readwrite')
    const store = transaction.objectStore(storeName)
    await new Promise<void>((resolve, reject) => {
      const cursor = store.openCursor()
      cursor.onsuccess = () => {
        const current = cursor.result
        if (!current) { resolve(); return }
        const value = current.value as Partial<WorkspaceEnvelope<unknown>>
        if (value.projectRef === projectRef && value.userId === userId && (farmId === undefined || value.farmId === farmId)) current.delete()
        current.continue()
      }
      cursor.onerror = () => reject(cursor.error ?? new Error('Farm Rx could not clear offline data.'))
    })
    await complete(transaction)
    const verification = database.transaction(storeName, 'readonly').objectStore(storeName).openCursor()
    await new Promise<void>((resolve, reject) => {
      verification.onsuccess = () => {
        const current = verification.result
        if (!current) { resolve(); return }
        const value = current.value as Partial<WorkspaceEnvelope<unknown>>
        if (value.projectRef === projectRef && value.userId === userId && (farmId === undefined || value.farmId === farmId)) { reject(new Error('Farm Rx could not remove the offline copy for a farm you no longer can open.')); return }
        current.continue()
      }
      verification.onerror = () => reject(verification.error ?? new Error('Farm Rx could not verify offline cleanup.'))
    })
    notices.clear(); noticeSnapshot = []; for (const listener of listeners) listener()
  } finally { database.close() }
}

export function subscribeWorkspaceCacheNotices(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) }
export function getWorkspaceCacheNotices(): WorkspaceCacheNotice[] { return noticeSnapshot }
