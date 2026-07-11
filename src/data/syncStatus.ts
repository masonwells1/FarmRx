export type SyncState =
  | { kind: 'synced'; pending: 0 }
  | { kind: 'pending'; pending: number }
  | { kind: 'syncing'; pending: number }
  | { kind: 'blocked'; pending: number; message: string }

let current: SyncState = { kind: 'synced', pending: 0 }
let retryAction: (() => void) | null = null
const listeners = new Set<() => void>()

export function getSyncStatus() { return current }
export function subscribeSyncStatus(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) }
export function setSyncStatus(next: SyncState) { current = next; listeners.forEach((listener) => listener()) }
export function setSyncRetryAction(action: (() => void) | null) { retryAction = action }
export function retrySavedChanges() { retryAction?.() }
