export type SyncState =
  | { kind: 'synced'; pending: 0 }
  | { kind: 'pending'; pending: number }
  | { kind: 'syncing'; pending: number }
  | { kind: 'blocked'; pending: number; message: string }

type Module = 'fields' | 'grain' | 'profitability' | 'inventory' | 'equipment_tasks' | 'weather' | 'fieldLog' | 'scouting' | 'harvest' | 'programs' | 'notifications'
const states: Record<Module, SyncState> = { fields: { kind: 'synced', pending: 0 }, grain: { kind: 'synced', pending: 0 }, profitability: { kind: 'synced', pending: 0 }, inventory: { kind: 'synced', pending: 0 }, equipment_tasks: { kind: 'synced', pending: 0 }, weather: { kind: 'synced', pending: 0 }, fieldLog: { kind: 'synced', pending: 0 }, scouting: { kind: 'synced', pending: 0 }, harvest: { kind: 'synced', pending: 0 }, programs: { kind: 'synced', pending: 0 }, notifications: { kind: 'synced', pending: 0 } }
const retries: Partial<Record<Module, () => void | Promise<unknown>>> = {}
const listeners = new Set<() => void>()
function aggregate(): SyncState {
  const values = Object.values(states)
  const pending = values.reduce((total, value) => total + value.pending, 0)
  // Audit P3-02: every blocked module's message is surfaced, not just the first —
  // a farmer with two stuck modules must not discover the second only after fixing the first.
  const blockedMessages = [...new Set(values.filter((value): value is Extract<SyncState, { kind: 'blocked' }> => value.kind === 'blocked').map((value) => value.message))]
  if (blockedMessages.length) return { kind: 'blocked', pending, message: blockedMessages.join(' ') }
  if (values.some((value) => value.kind === 'syncing')) return { kind: 'syncing', pending }
  if (pending) return { kind: 'pending', pending }
  return { kind: 'synced', pending: 0 }
}
// useSyncExternalStore requires a stable snapshot reference between changes;
// recompute the aggregate only when a module's state is set.
let snapshot: SyncState = aggregate()
export function getSyncStatus() { return snapshot }
export function subscribeSyncStatus(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) }
export function setModuleSyncStatus(module: Module, next: SyncState) { states[module] = next; snapshot = aggregate(); listeners.forEach((listener) => listener()) }
export function setModuleSyncRetryAction(module: Module, action: (() => void | Promise<unknown>) | null) { if (action) retries[module] = action; else delete retries[module] }
/** Compatibility for non-queue callers; queues must identify their module. */
export function setSyncStatus(next: SyncState) { setModuleSyncStatus('fields', next) }
export function setSyncRetryAction(action: (() => void | Promise<unknown>) | null) { setModuleSyncRetryAction('fields', action) }
export async function retrySavedChanges() { await Promise.allSettled(Object.values(retries).map((retry) => Promise.resolve(retry?.()))) }
