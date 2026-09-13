/** Settings drafts kept in this browser per account and farm until their save is confirmed.
 * A carry edit waits up to 600 ms before saving and a sale limit saves on blur; a reload, a closed tab, or a save that
 * fails after the screen was left must not lose what the farmer typed. The draft is written synchronously on every
 * edit and cleared only after the server (or the durable offline queue) confirmed the save. The key carries the
 * project, account, and farm, and the value has a non-empty `entries` array, so the farm switcher's existing scan
 * (`hasPendingFarmWork`) counts it as work waiting for that farm and that account only. */
export type SettingsDraftScope = { projectRef: string; userId: string; farmId: string }
/** `revision` identifies one write; a save clears the entry only when the revision it covered is still the stored one,
 * so a tab finishing an older save never removes a newer draft another tab wrote under the same key. */
export type SettingsDraftEntry = { key: string; payload: unknown; savedAt: string; revision: string }
let revisionCounter = 0
function nextRevision(now: string): string { revisionCounter += 1; return `${now}#${revisionCounter}#${Math.random().toString(36).slice(2, 10)}` }

export function settingsDraftsKey(scope: SettingsDraftScope): string { return `farm-rx-settings-drafts:v1:${scope.projectRef}:${scope.userId}:${scope.farmId}` }

function storage(): Storage | null { try { return globalThis.localStorage ?? null } catch { return null } }

function readAll(scope: SettingsDraftScope): SettingsDraftEntry[] {
  const target = storage(); if (!target) return []
  try {
    const raw = target.getItem(settingsDraftsKey(scope)); if (!raw) return []
    const value = JSON.parse(raw) as { entries?: unknown }
    if (!Array.isArray(value.entries)) return []
    return value.entries.filter((entry): entry is SettingsDraftEntry => typeof entry === 'object' && entry !== null && typeof (entry as SettingsDraftEntry).key === 'string' && typeof (entry as SettingsDraftEntry).revision === 'string')
  } catch { return [] }
}

/** True when the browser accepted the write; false in private mode, with storage blocked, or when the store is full. */
function writeAll(scope: SettingsDraftScope, entries: SettingsDraftEntry[]): boolean {
  const target = storage(); if (!target) return false
  try { if (entries.length === 0) target.removeItem(settingsDraftsKey(scope)); else target.setItem(settingsDraftsKey(scope), JSON.stringify({ version: 1, entries })); return true } catch { return false }
}

export function readSettingsDrafts(scope: SettingsDraftScope, prefix = ''): SettingsDraftEntry[] { return readAll(scope).filter((entry) => entry.key.startsWith(prefix)) }

/** Writes the draft and returns its revision, or null when the browser refused the write: the caller must then not treat
 * the edit as kept and should save it at once instead of waiting. */
export function writeSettingsDraft(scope: SettingsDraftScope, key: string, payload: unknown, now = new Date().toISOString()): string | null {
  const revision = nextRevision(now)
  return writeAll(scope, [...readAll(scope).filter((entry) => entry.key !== key), { key, payload, savedAt: now, revision }]) ? revision : null
}

/** Removes the draft; with `revision`, only when the stored entry is still that write (another tab may have written a newer one). */
export function clearSettingsDraft(scope: SettingsDraftScope, key: string, revision?: string): void {
  const entries = readAll(scope); const kept = entries.filter((entry) => entry.key !== key || (revision !== undefined && entry.revision !== revision))
  if (kept.length !== entries.length) writeAll(scope, kept)
}
