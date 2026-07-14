import type { StorageLike } from './writeQueue'

/**
 * Audit P2-09: a durable cleanup outbox for scouting photo objects that were uploaded
 * (or whose note was deleted) but whose storage removal failed or was interrupted.
 * Paths recorded here are retried on every reconnect/replay until the bucket removal
 * succeeds, so an ambiguous failure can no longer orphan a private photo object.
 * Storage paths are farm-scoped (`<farmId>/<fieldId>/<noteId>/<file>`), and bucket RLS
 * rejects removals by anyone outside that farm, so a device-level per-project key is safe.
 */
export interface ScoutingCleanupEntry { path: string; farmId: string; recordedAt: string }
interface Envelope { version: 1; entries: ScoutingCleanupEntry[] }

export function scoutingCleanupOutboxKey(projectRef: string) { return `farm-rx-scouting-cleanup:v1:${projectRef}` }

const validEntry = (value: unknown): value is ScoutingCleanupEntry => !!value && typeof value === 'object' && !Array.isArray(value)
  && typeof (value as Record<string, unknown>).path === 'string' && ((value as Record<string, unknown>).path as string).length > 0
  && typeof (value as Record<string, unknown>).farmId === 'string' && typeof (value as Record<string, unknown>).recordedAt === 'string'

function parse(raw: string | null): Envelope {
  if (raw === null) return { version: 1, entries: [] }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!!parsed && typeof parsed === 'object' && (parsed as { version?: unknown }).version === 1 && Array.isArray((parsed as { entries?: unknown }).entries) && (parsed as { entries: unknown[] }).entries.every(validEntry)) return parsed as Envelope
  } catch { /* handled below */ }
  console.warn('Farm Rx discarded a corrupt photo-cleanup record on this device.')
  return { version: 1, entries: [] }
}

export function readScoutingCleanupOutbox(storage: StorageLike, key: string): ScoutingCleanupEntry[] {
  return parse(storage.getItem(key)).entries
}

/** Records paths for later removal; read-back verified. Returns false when the device could not retain them. */
export function recordScoutingCleanup(storage: StorageLike, key: string, farmId: string, paths: string[], recordedAt: string): boolean {
  const unique = [...new Set(paths)].filter((path) => path.length > 0)
  if (!unique.length) return true
  try {
    const current = readScoutingCleanupOutbox(storage, key)
    const additions = unique.filter((path) => !current.some((entry) => entry.path === path)).map((path) => ({ path, farmId, recordedAt }))
    if (!additions.length) return true
    const bytes = JSON.stringify({ version: 1, entries: [...current, ...additions] } satisfies Envelope)
    storage.setItem(key, bytes)
    return storage.getItem(key) === bytes
  } catch { return false }
}

/** Attempts the CURRENT farm's recorded removals; an entry leaves the outbox only when
 * the bucket names it in the confirmed-removal list. Another farm's entries are left
 * untouched (a different signed-in user would be silently RLS-blocked, and trimming on
 * a merely-resolved call would orphan the photo objects forever). */
export async function drainScoutingCleanupOutbox(storage: StorageLike, key: string, farmId: string, remove: (paths: string[]) => Promise<string[]>): Promise<void> {
  const entries = readScoutingCleanupOutbox(storage, key).filter((entry) => entry.farmId === farmId)
  if (!entries.length) return
  let confirmed: string[]
  try {
    confirmed = await remove(entries.map((entry) => entry.path))
  } catch { return /* kept for the next drain */ }
  if (!confirmed.length) return
  try {
    const remaining = readScoutingCleanupOutbox(storage, key).filter((entry) => !confirmed.includes(entry.path))
    storage.setItem(key, JSON.stringify({ version: 1, entries: remaining } satisfies Envelope))
  } catch { /* a failed trim only means a harmless duplicate removal attempt later */ }
}
