import { captureFarmRevocationFence, ensureQueueFarmGrant, verifyFarmRevocationFence, type FarmRevocationSnapshot } from './farmRevocationFence'
import type { ReadOnlySnapshot } from './fields'
import type { StorageLike } from './writeQueue'
export { maximumClockSkewMs } from './deviceClockFence'
import { maximumClockSkewMs } from './deviceClockFence'

export const financialCacheMaxAgeMs = 24 * 60 * 60 * 1_000
export const operationalCacheMaxAgeMs = 7 * 24 * 60 * 60 * 1_000

export type WorkspaceCacheScope = { projectRef: string; userId: string; farmId: string; module: string }
export type WorkspaceMemoryGuard = { key: string; fence: FarmRevocationSnapshot }
type WorkspaceEnvelope<T> = WorkspaceCacheScope & { version: 2; key: string; generation: number; fenceToken: string; serverEpoch: number; cachedAt: string; data: T }
export type WorkspaceCacheNotice = { module: string; cachedAt: string }

const storeName = 'workspaces'
const listeners = new Set<() => void>()
const notices = new Map<string, WorkspaceCacheNotice>()
let noticeSnapshot: WorkspaceCacheNotice[] = []

function cacheKey(scope: WorkspaceCacheScope) { return `${scope.projectRef}:${scope.userId}:${scope.farmId}:${scope.module}` }
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
function validEnvelope<T>(value: unknown, scope: WorkspaceCacheScope, fence: FarmRevocationSnapshot): value is WorkspaceEnvelope<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return row.version === 2 && row.key === cacheKey(scope) && row.projectRef === scope.projectRef && row.userId === scope.userId && row.farmId === scope.farmId && row.module === scope.module && row.generation === fence.generation && row.fenceToken === fence.token && row.serverEpoch === fence.serverEpoch && typeof row.cachedAt === 'string' && !Number.isNaN(Date.parse(row.cachedAt)) && Object.hasOwn(row, 'data')
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

export function captureWorkspaceCacheFence(scope: WorkspaceCacheScope): FarmRevocationSnapshot | null {
  if (typeof localStorage === 'undefined') return null
  try { return captureFarmRevocationFence(localStorage, scope) } catch { return null }
}

export async function writeWorkspaceCache<T>(scope: WorkspaceCacheScope, data: T, fence: FarmRevocationSnapshot | null, cachedAt = new Date().toISOString()): Promise<boolean> {
  if (!available() || !fence) return false
  let database: IDBDatabase | null = null
  try {
    database = await open(scope.projectRef)
    verifyFarmRevocationFence(localStorage, fence)
    const transaction = database.transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).put({ version: 2, key: cacheKey(scope), ...scope, generation: fence.generation, fenceToken: fence.token, serverEpoch: fence.serverEpoch, cachedAt, data: structuredClone(data) } satisfies WorkspaceEnvelope<T>)
    await complete(transaction)
    verifyFarmRevocationFence(localStorage, fence)
    return true
  } catch { return false }
  finally { database?.close() }
}

export async function readWorkspaceCache<T>(scope: WorkspaceCacheScope, maximumAgeMs: number): Promise<{ data: T; cachedAt: string } | null> {
  if (!available()) return null
  let fence
  try { fence = captureFarmRevocationFence(localStorage, scope) } catch { return null }
  const database = await open(scope.projectRef)
  try {
    const transaction = database.transaction(storeName, 'readonly')
    const value = await requestResult(transaction.objectStore(storeName).get(cacheKey(scope)))
    if (value === undefined) return null
    if (!validEnvelope<T>(value, scope, fence)) return null
    const ageMs = Date.now() - Date.parse(value.cachedAt)
    if (ageMs < -maximumClockSkewMs || ageMs > maximumAgeMs) throw new WorkspaceCacheExpiredError()
    try { verifyFarmRevocationFence(localStorage, fence) } catch { return null }
    publish({ module: scope.module.split(':')[0], cachedAt: value.cachedAt })
    return { data: structuredClone(value.data), cachedAt: value.cachedAt }
  } finally { database.close() }
}

/** Read-only projection cache access. It never creates/upgrades IndexedDB and never publishes UI notices. */
export async function readWorkspaceCachePure<T>(scope: WorkspaceCacheScope, fence: FarmRevocationSnapshot, maximumAgeMs: number, storage: StorageLike, nowMs = Date.now()): Promise<ReadOnlySnapshot<T> | null> {
  if (!Number.isFinite(nowMs) || fence.projectRef !== scope.projectRef || fence.userId !== scope.userId || fence.farmId !== scope.farmId) return null
  try { verifyFarmRevocationFence(storage, fence) } catch { return null }
  const database = await openExisting(scope.projectRef)
  if (!database) return null
  try {
    const transaction = database.transaction(storeName, 'readonly')
    const value = await requestResult(transaction.objectStore(storeName).get(cacheKey(scope)))
    if (value === undefined || !validEnvelope<T>(value, scope, fence)) return null
    const ageMs = nowMs - Date.parse(value.cachedAt)
    if (ageMs < -maximumClockSkewMs || ageMs > maximumAgeMs) throw new WorkspaceCacheExpiredError()
    try { verifyFarmRevocationFence(storage, fence) } catch { return null }
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
