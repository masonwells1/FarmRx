/** Settings drafts kept in this browser per account and farm until their save is confirmed.
 * A carry edit waits up to 600 ms before saving and a sale limit saves on blur; a reload, a closed tab, or a save that
 * fails after the screen was left must not lose what the farmer typed. The draft is written synchronously on every
 * edit and cleared only after the server (or the durable offline queue) confirmed the save. Each draft has its own
 * storage key, so two tabs editing different drafts never overwrite each other's entry; the key names the project,
 * account, and farm in the same shape as the offline queues (`farm-rx-<name>:v1:<project>:<user>:<farm>`) and the
 * value has a non-empty `entries` array, so the farm switcher's existing scan (`hasPendingFarmWork`) counts it as work
 * waiting for that farm and that account only, and the revoked-farm quarantine finds it. */
export type SettingsDraftScope = { projectRef: string; userId: string; farmId: string }
/** `revision` identifies one write; a save clears the entry only when the revision it covered is still the stored one,
 * so a tab finishing an older save never removes a newer draft another tab wrote under the same key. */
export type SettingsDraftEntry = { key: string; payload: unknown; savedAt: string; revision: string }
let revisionCounter = 0
function nextRevision(now: string): string { revisionCounter += 1; return `${now}#${revisionCounter}#${Math.random().toString(36).slice(2, 10)}` }

const keyPrefix = 'farm-rx-settings-draft-'
function scopeSuffix(scope: SettingsDraftScope): string { return `:v1:${scope.projectRef}:${scope.userId}:${scope.farmId}` }
/** The storage key of one draft. The draft's own key is URL-encoded so the name segment carries no colon. */
export function settingsDraftKey(scope: SettingsDraftScope, key: string): string { return `${keyPrefix}${encodeURIComponent(key)}${scopeSuffix(scope)}` }
/** The draft key a storage key holds for the scope, or null when the storage key is not one of the scope's drafts. */
export function settingsDraftKeyOf(storageKey: string, scope: SettingsDraftScope): string | null {
  const suffix = scopeSuffix(scope)
  if (!storageKey.startsWith(keyPrefix) || !storageKey.endsWith(suffix)) return null
  const encoded = storageKey.slice(keyPrefix.length, storageKey.length - suffix.length)
  if (!encoded || encoded.includes(':')) return null
  try { return decodeURIComponent(encoded) } catch { return null }
}

type EnumeratedStorage = Storage
function storage(): EnumeratedStorage | null { try { return globalThis.localStorage ?? null } catch { return null } }

function validEntry(value: unknown): value is SettingsDraftEntry {
  return typeof value === 'object' && value !== null && typeof (value as SettingsDraftEntry).key === 'string' && typeof (value as SettingsDraftEntry).revision === 'string' && typeof (value as SettingsDraftEntry).savedAt === 'string'
}
function readOne(target: EnumeratedStorage, storageKey: string): SettingsDraftEntry | null {
  try {
    const raw = target.getItem(storageKey); if (!raw) return null
    const value = JSON.parse(raw) as { entries?: unknown }
    const entry = Array.isArray(value.entries) ? value.entries[0] : null
    return validEntry(entry) ? entry : null
  } catch { return null }
}

export function readSettingsDrafts(scope: SettingsDraftScope, prefix = ''): SettingsDraftEntry[] {
  const target = storage(); if (!target) return []
  const found: SettingsDraftEntry[] = []
  for (let index = 0; index < target.length; index += 1) {
    const storageKey = target.key(index); if (!storageKey) continue
    const key = settingsDraftKeyOf(storageKey, scope); if (key === null || !key.startsWith(prefix)) continue
    const entry = readOne(target, storageKey); if (entry && entry.key === key) found.push(entry)
  }
  return found
}

/** Writes the draft and returns its revision, or null when the browser refused the write: the caller must then not treat
 * the edit as kept and should save it at once instead of waiting. */
export function writeSettingsDraft(scope: SettingsDraftScope, key: string, payload: unknown, now = new Date().toISOString()): string | null {
  const target = storage(); if (!target) return null
  const revision = nextRevision(now)
  try { target.setItem(settingsDraftKey(scope, key), JSON.stringify({ version: 1, entries: [{ key, payload, savedAt: now, revision }] })); return revision } catch { return null }
}

/** Removes the draft; with `revision`, only when the stored entry is still that write (another tab may have written a newer one). */
export function clearSettingsDraft(scope: SettingsDraftScope, key: string, revision?: string): void {
  const target = storage(); if (!target) return
  const storageKey = settingsDraftKey(scope, key)
  if (revision !== undefined) { const entry = readOne(target, storageKey); if (entry && entry.revision !== revision) return }
  try { target.removeItem(storageKey) } catch { /* nothing to do: the draft stays until a later confirmed save clears it */ }
}
