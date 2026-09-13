/** Settings drafts kept in this browser per account and farm until their save is confirmed.
 * A carry edit waits up to 600 ms before saving and a sale limit saves on blur; a reload, a closed tab, or a save that
 * fails after the screen was left must not lose what the farmer typed. The draft is written synchronously on every
 * edit and cleared only after the server (or the durable offline queue) confirmed the save. The key carries the
 * project, account, and farm, and the value has a non-empty `entries` array, so the farm switcher's existing scan
 * (`hasPendingFarmWork`) counts it as work waiting for that farm and that account only. */
export type SettingsDraftScope = { projectRef: string; userId: string; farmId: string }
export type SettingsDraftEntry = { key: string; payload: unknown; savedAt: string }

export function settingsDraftsKey(scope: SettingsDraftScope): string { return `farm-rx-settings-drafts:v1:${scope.projectRef}:${scope.userId}:${scope.farmId}` }

function storage(): Storage | null { try { return globalThis.localStorage ?? null } catch { return null } }

function readAll(scope: SettingsDraftScope): SettingsDraftEntry[] {
  const target = storage(); if (!target) return []
  try {
    const raw = target.getItem(settingsDraftsKey(scope)); if (!raw) return []
    const value = JSON.parse(raw) as { entries?: unknown }
    if (!Array.isArray(value.entries)) return []
    return value.entries.filter((entry): entry is SettingsDraftEntry => typeof entry === 'object' && entry !== null && typeof (entry as SettingsDraftEntry).key === 'string')
  } catch { return [] }
}

function writeAll(scope: SettingsDraftScope, entries: SettingsDraftEntry[]): void {
  const target = storage(); if (!target) return
  try { if (entries.length === 0) target.removeItem(settingsDraftsKey(scope)); else target.setItem(settingsDraftsKey(scope), JSON.stringify({ version: 1, entries })) } catch { /* private mode or a full store: the in-memory draft still saves normally */ }
}

export function readSettingsDrafts(scope: SettingsDraftScope, prefix = ''): SettingsDraftEntry[] { return readAll(scope).filter((entry) => entry.key.startsWith(prefix)) }

export function writeSettingsDraft(scope: SettingsDraftScope, key: string, payload: unknown, now = new Date().toISOString()): void {
  writeAll(scope, [...readAll(scope).filter((entry) => entry.key !== key), { key, payload, savedAt: now }])
}

export function clearSettingsDraft(scope: SettingsDraftScope, key: string): void {
  const entries = readAll(scope); const kept = entries.filter((entry) => entry.key !== key)
  if (kept.length !== entries.length) writeAll(scope, kept)
}
