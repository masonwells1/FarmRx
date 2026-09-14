/** Settings drafts kept in this browser per account and farm until their save is confirmed.
 * A carry edit waits up to 600 ms before saving and a sale limit saves on blur; a reload, a closed tab, or a save that
 * fails after the screen was left must not lose what the farmer typed. The draft is written synchronously on every
 * edit and cleared only after the server (or the durable offline queue) confirmed the save. Every write lives under its
 * own storage key, named for the draft and the write's revision, so two tabs editing the same draft never overwrite each
 * other's entry and a save clears exactly the revision it covered with one atomic `removeItem` (no read-then-remove
 * that another tab could slip a newer write between); the key names the project, account, and farm in the same shape as
 * the offline queues (`farm-rx-<name>:v1:<project>:<user>:<farm>`) and the value has a non-empty `entries` array, so the
 * farm switcher's existing scan (`hasPendingFarmWork`) counts it as work waiting for that farm and that account only,
 * and the revoked-farm quarantine finds it. A read returns the newest revision of each draft and removes the older ones,
 * which a newer write has superseded. */
export type SettingsDraftScope = { projectRef: string; userId: string; farmId: string }
/** `revision` identifies one write; a save clears the entry only when the revision it covered is still the stored one,
 * so a tab finishing an older save never removes a newer draft another tab wrote under the same key. */
export type SettingsDraftEntry = { key: string; payload: unknown; savedAt: string; revision: string }
let revisionCounter = 0
function nextRevision(now: string): string { revisionCounter += 1; return `${now}#${revisionCounter}#${Math.random().toString(36).slice(2, 10)}` }

const keyPrefix = 'farm-rx-settings-draft-'
function scopeSuffix(scope: SettingsDraftScope): string { return `:v1:${scope.projectRef}:${scope.userId}:${scope.farmId}` }
/** The storage key of one write of a draft. The draft key and the revision are URL-encoded (neither segment then carries a colon or
 * an `@`), joined with `@`, so a key identifies exactly one write. */
export function settingsDraftKey(scope: SettingsDraftScope, key: string, revision: string): string { return `${keyPrefix}${encodeURIComponent(key)}@${encodeURIComponent(revision)}${scopeSuffix(scope)}` }
function parseStorageKey(storageKey: string, scope: SettingsDraftScope): { key: string; revision: string } | null {
  const suffix = scopeSuffix(scope)
  if (!storageKey.startsWith(keyPrefix) || !storageKey.endsWith(suffix)) return null
  const name = storageKey.slice(keyPrefix.length, storageKey.length - suffix.length)
  const parts = name.split('@')
  if (parts.length !== 2 || !parts[0] || !parts[1] || name.includes(':')) return null
  try { return { key: decodeURIComponent(parts[0]), revision: decodeURIComponent(parts[1]) } } catch { return null }
}
/** The draft key a storage key holds for the scope, or null when the storage key is not one of the scope's drafts. */
export function settingsDraftKeyOf(storageKey: string, scope: SettingsDraftScope): string | null { return parseStorageKey(storageKey, scope)?.key ?? null }

type EnumeratedStorage = Storage
function storage(): EnumeratedStorage | null { try { return globalThis.localStorage ?? null } catch { return null } }

function validEntry(value: unknown): value is SettingsDraftEntry {
  return typeof value === 'object' && value !== null && typeof (value as SettingsDraftEntry).key === 'string' && typeof (value as SettingsDraftEntry).revision === 'string' && typeof (value as SettingsDraftEntry).savedAt === 'string'
}
function readOne(target: EnumeratedStorage, storageKey: string, expected: { key: string; revision: string }): SettingsDraftEntry | null {
  try {
    const raw = target.getItem(storageKey); if (!raw) return null
    const value = JSON.parse(raw) as { entries?: unknown }
    const entry = Array.isArray(value.entries) ? value.entries[0] : null
    return validEntry(entry) && entry.key === expected.key && entry.revision === expected.revision ? entry : null
  } catch { return null }
}
/** Later write first: by the time it was saved, then by revision (the counter and random tail break same-millisecond ties). */
const newerFirst = (a: SettingsDraftEntry, b: SettingsDraftEntry) => b.savedAt.localeCompare(a.savedAt) || b.revision.localeCompare(a.revision)
function remove(target: EnumeratedStorage, storageKey: string) { try { target.removeItem(storageKey) } catch { /* it is skipped or removed again on the next read */ } }
/** Every stored write of the scope's drafts whose key starts with `prefix`, grouped by draft key, newest first. */
function scan(target: EnumeratedStorage, scope: SettingsDraftScope, prefix: string): Map<string, Array<{ storageKey: string; entry: SettingsDraftEntry }>> {
  const groups = new Map<string, Array<{ storageKey: string; entry: SettingsDraftEntry }>>()
  for (let index = 0; index < target.length; index += 1) {
    const storageKey = target.key(index); if (!storageKey) continue
    const parsed = parseStorageKey(storageKey, scope); if (parsed === null || !parsed.key.startsWith(prefix)) continue
    const entry = readOne(target, storageKey, parsed); if (!entry) continue
    const group = groups.get(parsed.key) ?? []; group.push({ storageKey, entry }); groups.set(parsed.key, group)
  }
  for (const group of groups.values()) group.sort((a, b) => newerFirst(a.entry, b.entry))
  return groups
}

/** The newest write of each of the scope's drafts whose key starts with `prefix`; older writes of the same draft are removed, since a
 * newer one supersedes them. With `isPayload`, an entry whose payload the screen cannot use (a malformed or older shape) is removed
 * from storage and skipped, so a bad local record never reaches the screen. */
export function readSettingsDrafts(scope: SettingsDraftScope, prefix = '', isPayload?: (key: string, payload: unknown) => boolean): SettingsDraftEntry[] {
  const target = storage(); if (!target) return []
  const found: SettingsDraftEntry[] = []
  for (const [key, group] of scan(target, scope, prefix)) {
    const [newest, ...older] = group
    for (const item of older) remove(target, item.storageKey)
    if (!newest) continue
    if (isPayload && !isPayload(key, newest.entry.payload)) { remove(target, newest.storageKey); continue }
    found.push(newest.entry)
  }
  return found
}

/** Writes the draft under a new revision key, then removes this scope's older writes of the same draft (superseded), and returns the
 * revision, or null when the browser refused the write: the caller must then not treat the edit as kept and should save it at once. */
export function writeSettingsDraft(scope: SettingsDraftScope, key: string, payload: unknown, now = new Date().toISOString()): string | null {
  const target = storage(); if (!target) return null
  const revision = nextRevision(now)
  const entry: SettingsDraftEntry = { key, payload, savedAt: now, revision }
  try { target.setItem(settingsDraftKey(scope, key, revision), JSON.stringify({ version: 1, entries: [entry] })) } catch { return null }
  for (const item of scan(target, scope, key).get(key) ?? []) if (item.entry.key === key && item.entry.revision !== revision && newerFirst(entry, item.entry) < 0) remove(target, item.storageKey)
  return revision
}

/** Removes one write of the draft (`revision`: one atomic removal of that write's own key, so a newer write another tab made under
 * its own key is never touched), or every write of the draft when no revision is given. */
export function clearSettingsDraft(scope: SettingsDraftScope, key: string, revision?: string): void {
  const target = storage(); if (!target) return
  if (revision !== undefined) { remove(target, settingsDraftKey(scope, key, revision)); return }
  for (const item of scan(target, scope, key).get(key) ?? []) if (item.entry.key === key) remove(target, item.storageKey)
}
