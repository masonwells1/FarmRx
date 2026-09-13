// Which budget cost lines were seeded from the U of I defaults, kept in this browser only while the live database has no
// `university_default_amount` column yet (the slice-3 migration pending). One storage key per line, named for the project,
// account, and farm in the offline-queue key shape (`farm-rx-<name>:v1:<project>:<user>:<farm>`), so two tabs seeding
// different lines never overwrite each other, the revocation scope discovery finds the farm, and the revoked-farm quarantine
// moves the entries into custody with the rest of the farm's work. The value carries no `entries`, so the farm switcher's
// unsaved-work scan does not count it. The Profitability page shows these as badges, moves each into the column once it
// exists, and forgets it after the refreshed row confirms the amount. Safe where there is no browser storage.
export type UniversityDefaultScope = { projectRef: string; userId: string; farmId: string }
const keyPrefix = 'farm-rx-university-default-'
function scopeSuffix(scope: UniversityDefaultScope): string { return `:v1:${scope.projectRef}:${scope.userId}:${scope.farmId}` }
/** The storage key of one line's seeded amount for the scope. */
export function universityDefaultKey(scope: UniversityDefaultScope, lineId: string): string { return `${keyPrefix}${encodeURIComponent(lineId)}${scopeSuffix(scope)}` }
/** The line id a storage key holds for the scope, or null when the key is not one of the scope's seeded amounts. */
export function universityDefaultLineOf(storageKey: string, scope: UniversityDefaultScope): string | null {
  const suffix = scopeSuffix(scope)
  if (!storageKey.startsWith(keyPrefix) || !storageKey.endsWith(suffix)) return null
  const encoded = storageKey.slice(keyPrefix.length, storageKey.length - suffix.length)
  if (!encoded || encoded.includes(':')) return null
  try { return decodeURIComponent(encoded) } catch { return null }
}
/** The stored value: exactly `{ version: 1, amount }` with a finite amount of zero or more. */
export function validUniversityDefault(value: unknown): value is { version: 1; amount: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return Object.keys(row).length === 2 && row.version === 1 && typeof row.amount === 'number' && Number.isFinite(row.amount) && row.amount >= 0
}
/** The single-map key older releases wrote (unscoped); still read, and pruned as its entries are confirmed. */
const LEGACY_KEY = 'farm-rx.profitability.university-defaults'
type EnumeratedStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; key(index: number): string | null; readonly length: number }
function storage(): EnumeratedStorage | null { try { return (globalThis as { localStorage?: EnumeratedStorage }).localStorage ?? null } catch { return null } }
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
function readLegacyMap(store: EnumeratedStorage): Record<string, number> {
  try { const value = JSON.parse(store.getItem(LEGACY_KEY) ?? '{}') as unknown; return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] => amount(entry[1]))) : {} } catch { return {} }
}
export function readLegacyDefaults(scope: UniversityDefaultScope): Record<string, number> {
  const store = storage(); if (!store) return {}
  try {
    const entries = readLegacyMap(store)
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index); if (!key) continue
      const lineId = universityDefaultLineOf(key, scope); if (lineId === null) continue
      try { const value: unknown = JSON.parse(store.getItem(key) ?? 'null'); if (validUniversityDefault(value)) entries[lineId] = value.amount } catch { /* an unreadable entry is left for the quarantine to report */ }
    }
    return entries
  } catch { return {} }
}
/** A seeded amount the live database could not store yet: kept here until the column exists. False when the browser refused it
 * (private mode, blocked or full storage); the caller then fails the save closed rather than saving a number with a lost badge. */
export function rememberLegacyDefault(scope: UniversityDefaultScope, lineId: string, value: number): boolean {
  try { const store = storage(); if (!store) return false; store.setItem(universityDefaultKey(scope, lineId), JSON.stringify({ version: 1, amount: value })); const written = store.getItem(universityDefaultKey(scope, lineId)); return written !== null && validUniversityDefault(JSON.parse(written)) } catch { return false }
}
export function forgetLegacyDefaults(scope: UniversityDefaultScope, ids: string[]) {
  const store = storage(); if (!store) return
  try {
    for (const id of ids) store.removeItem(universityDefaultKey(scope, id))
    const legacy = readLegacyMap(store); const kept = Object.fromEntries(Object.entries(legacy).filter(([id]) => !ids.includes(id)))
    if (Object.keys(kept).length !== Object.keys(legacy).length) { if (Object.keys(kept).length === 0) store.removeItem(LEGACY_KEY); else store.setItem(LEGACY_KEY, JSON.stringify(kept)) }
  } catch { /* the entries are retried on the next visit */ }
}
