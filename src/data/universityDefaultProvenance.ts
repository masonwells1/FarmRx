// Which budget cost lines were seeded from the U of I defaults, kept in this browser only while the live database has no
// `university_default_amount` column yet (the slice-3 migration pending). One storage key per line, so two tabs seeding different
// lines at the same time never overwrite each other. The Profitability page shows these as badges, moves each into the column once
// it exists, and forgets it after the refreshed row confirms the amount. Safe where there is no browser storage.
const PREFIX = 'farm-rx.profitability.university-default:'
/** The single-map key older releases wrote; still read, and pruned as its entries are confirmed. */
const LEGACY_KEY = 'farm-rx.profitability.university-defaults'
type EnumeratedStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; key(index: number): string | null; readonly length: number }
function storage(): EnumeratedStorage | null { try { return (globalThis as { localStorage?: EnumeratedStorage }).localStorage ?? null } catch { return null } }
const amount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
function readLegacyMap(store: EnumeratedStorage): Record<string, number> {
  try { const value = JSON.parse(store.getItem(LEGACY_KEY) ?? '{}') as unknown; return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] => amount(entry[1]))) : {} } catch { return {} }
}
export function readLegacyDefaults(): Record<string, number> {
  const store = storage(); if (!store) return {}
  try {
    const entries = readLegacyMap(store)
    for (let index = 0; index < store.length; index += 1) {
      const key = store.key(index); if (!key || !key.startsWith(PREFIX)) continue
      const value = Number(store.getItem(key)); if (amount(value)) entries[key.slice(PREFIX.length)] = value
    }
    return entries
  } catch { return {} }
}
// Seeded amounts the browser refused to keep (private mode, blocked or full storage): the Profitability page reports them once.
const unretained = new Set<string>()
/** A seeded amount the live database could not store yet: kept here until the column exists. False when the browser refused it. */
export function rememberLegacyDefault(lineId: string, value: number): boolean {
  try { const store = storage(); if (!store) throw new Error('no storage'); store.setItem(`${PREFIX}${lineId}`, String(value)); return true } catch { unretained.add(lineId); return false }
}
/** Line ids whose seeded amount could not be kept since the last call: the farmer's numbers are saved, their badge is not. */
export function takeUnretainedLegacyDefaults(): string[] { const ids = [...unretained]; unretained.clear(); return ids }
export function forgetLegacyDefaults(ids: string[]) {
  const store = storage(); if (!store) return
  try {
    for (const id of ids) store.removeItem(`${PREFIX}${id}`)
    const legacy = readLegacyMap(store); const kept = Object.fromEntries(Object.entries(legacy).filter(([id]) => !ids.includes(id)))
    if (Object.keys(kept).length !== Object.keys(legacy).length) { if (Object.keys(kept).length === 0) store.removeItem(LEGACY_KEY); else store.setItem(LEGACY_KEY, JSON.stringify(kept)) }
  } catch { /* the entries are retried on the next visit */ }
}
