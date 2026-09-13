// Which budget cost lines were seeded from the U of I defaults, kept in this browser only while the live database has no
// `university_default_amount` column yet (the slice-3 migration pending). The Profitability page moves each entry into the
// column once it exists and forgets it after the refreshed row confirms the amount. Safe where there is no browser storage.
const KEY = 'farm-rx.profitability.university-defaults'
const storage = () => { try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null } }
export function readLegacyDefaults(): Record<string, number> {
  try {
    const value = JSON.parse(storage()?.getItem(KEY) ?? '{}') as unknown
    return value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && Number.isFinite(entry[1]) && entry[1] >= 0)) : {}
  } catch { return {} }
}
function write(entries: Record<string, number>) {
  const store = storage(); if (!store) return
  if (Object.keys(entries).length === 0) store.removeItem(KEY); else store.setItem(KEY, JSON.stringify(entries))
}
/** A seeded amount the live database could not store yet: kept here until the column exists. */
export function rememberLegacyDefault(lineId: string, amount: number) {
  try { write({ ...readLegacyDefaults(), [lineId]: amount }) } catch { /* private mode or full storage: the badge for this line is lost, the farmer's number is saved */ }
}
export function forgetLegacyDefaults(ids: string[]) {
  try { write(Object.fromEntries(Object.entries(readLegacyDefaults()).filter(([id]) => !ids.includes(id)))) } catch { /* the entries are retried on the next visit */ }
}
