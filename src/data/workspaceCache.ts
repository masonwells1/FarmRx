export const financialCacheMaxAgeMs = 24 * 60 * 60 * 1_000
export const operationalCacheMaxAgeMs = 7 * 24 * 60 * 60 * 1_000

export type WorkspaceCacheScope = { projectRef: string; userId: string; farmId: string; module: string }
type WorkspaceEnvelope<T> = WorkspaceCacheScope & { version: 1; key: string; cachedAt: string; data: T }
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
function requestResult<T>(request: IDBRequest<T>): Promise<T> { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error ?? new Error('Farm Rx could not use offline storage.')) }) }
function complete(transaction: IDBTransaction): Promise<void> { return new Promise((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error ?? new Error('Farm Rx could not save offline data.')); transaction.onabort = () => reject(transaction.error ?? new Error('Farm Rx could not save offline data.')) }) }
function validEnvelope<T>(value: unknown, scope: WorkspaceCacheScope): value is WorkspaceEnvelope<T> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return row.version === 1 && row.key === cacheKey(scope) && row.projectRef === scope.projectRef && row.userId === scope.userId && row.farmId === scope.farmId && row.module === scope.module && typeof row.cachedAt === 'string' && !Number.isNaN(Date.parse(row.cachedAt)) && Object.hasOwn(row, 'data')
}
function publish(notice: WorkspaceCacheNotice) { notices.set(notice.module, notice); noticeSnapshot = [...notices.values()].sort((a, b) => a.cachedAt.localeCompare(b.cachedAt)); for (const listener of listeners) listener() }

export class WorkspaceCacheExpiredError extends Error {
  constructor() { super('This offline copy is too old to show safely. Connect to verify your farm access.'); this.name = 'WorkspaceCacheExpiredError' }
}

export async function writeWorkspaceCache<T>(scope: WorkspaceCacheScope, data: T, cachedAt = new Date().toISOString()): Promise<boolean> {
  if (!available()) return false
  let database: IDBDatabase | null = null
  try {
    database = await open(scope.projectRef)
    const transaction = database.transaction(storeName, 'readwrite')
    transaction.objectStore(storeName).put({ version: 1, key: cacheKey(scope), ...scope, cachedAt, data: structuredClone(data) } satisfies WorkspaceEnvelope<T>)
    await complete(transaction)
    return true
  } catch { return false }
  finally { database?.close() }
}

export async function readWorkspaceCache<T>(scope: WorkspaceCacheScope, maximumAgeMs: number): Promise<{ data: T; cachedAt: string } | null> {
  if (!available()) return null
  const database = await open(scope.projectRef)
  try {
    const transaction = database.transaction(storeName, 'readonly')
    const value = await requestResult(transaction.objectStore(storeName).get(cacheKey(scope)))
    if (value === undefined) return null
    if (!validEnvelope<T>(value, scope)) throw new Error('Farm Rx found a damaged offline copy. Reconnect to replace it.')
    if (Date.now() - Date.parse(value.cachedAt) > maximumAgeMs) throw new WorkspaceCacheExpiredError()
    publish({ module: scope.module.split(':')[0], cachedAt: value.cachedAt })
    return { data: structuredClone(value.data), cachedAt: value.cachedAt }
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
    notices.clear(); noticeSnapshot = []; for (const listener of listeners) listener()
  } finally { database.close() }
}

export function subscribeWorkspaceCacheNotices(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) }
export function getWorkspaceCacheNotices(): WorkspaceCacheNotice[] { return noticeSnapshot }
