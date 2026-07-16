import type { StorageLike } from './writeQueue'

/**
 * Durable cleanup work is scoped to the exact account and farm that created it.
 * A shared browser can hold work for several users, so farm-only ownership is
 * insufficient even though Storage RLS independently guards the object path.
 */
export interface ScoutingCleanupEntry { path: string; userId: string; farmId: string; recordedAt: string }
interface Envelope { version: 2; entries: ScoutingCleanupEntry[] }
interface LegacyEntry { path: string; farmId: string; recordedAt: string }
interface LegacyEnvelope { version: 1; entries: LegacyEntry[] }

export function scoutingCleanupOutboxKey(projectRef: string, userId: string) { return `farm-rx-scouting-cleanup:v2:${projectRef}:${userId}` }
export function legacyScoutingCleanupOutboxKey(projectRef: string) { return `farm-rx-scouting-cleanup:v1:${projectRef}` }
export function unownedScoutingCleanupRecoveryKey(projectRef: string) { return `farm-rx-scouting-cleanup-unowned:v1:${projectRef}` }

const text = (value: unknown) => typeof value === 'string' && value.length > 0
const validEntry = (value: unknown): value is ScoutingCleanupEntry => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === 4
  && text((value as Record<string, unknown>).path)
  && text((value as Record<string, unknown>).userId)
  && text((value as Record<string, unknown>).farmId)
  && text((value as Record<string, unknown>).recordedAt)
const validLegacyEntry = (value: unknown): value is LegacyEntry => !!value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === 3
  && text((value as Record<string, unknown>).path)
  && text((value as Record<string, unknown>).farmId)
  && text((value as Record<string, unknown>).recordedAt)

function parse(raw: string | null): Envelope {
  if (raw === null) return { version: 2, entries: [] }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!!parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length === 2 && (parsed as { version?: unknown }).version === 2 && Array.isArray((parsed as { entries?: unknown }).entries) && (parsed as { entries: unknown[] }).entries.every(validEntry)) return parsed as Envelope
  } catch { /* handled below */ }
  console.warn('Farm Rx discarded a corrupt photo-cleanup record on this device.')
  return { version: 2, entries: [] }
}

function parseLegacy(raw: string | null): LegacyEnvelope {
  if (raw === null) return { version: 1, entries: [] }
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length !== 2 || (parsed as { version?: unknown }).version !== 1 || !Array.isArray((parsed as { entries?: unknown }).entries) || !(parsed as { entries: unknown[] }).entries.every(validLegacyEntry)) throw new Error('Farm Rx could not safely quarantine legacy photo-cleanup work.')
  return parsed as LegacyEnvelope
}

export function readScoutingCleanupOutbox(storage: StorageLike, key: string): ScoutingCleanupEntry[] {
  return parse(storage.getItem(key)).entries
}

/** Records paths for later removal; read-back verified. Returns false when the device could not retain them. */
export function recordScoutingCleanup(storage: StorageLike, key: string, userId: string, farmId: string, paths: string[], recordedAt: string): boolean {
  const unique = [...new Set(paths)].filter((path) => path.length > 0)
  if (!unique.length) return true
  try {
    const current = readScoutingCleanupOutbox(storage, key)
    if (current.some((entry) => entry.userId !== userId)) return false
    const additions = unique.filter((path) => !current.some((entry) => entry.path === path)).map((path) => ({ path, userId, farmId, recordedAt }))
    if (!additions.length) return true
    const bytes = JSON.stringify({ version: 2, entries: [...current, ...additions] } satisfies Envelope)
    storage.setItem(key, bytes)
    return storage.getItem(key) === bytes
  } catch { return false }
}

/** Attempts only the initiating user's current farm partition. */
export async function drainScoutingCleanupOutbox(storage: StorageLike, key: string, userId: string, farmId: string, remove: (paths: string[]) => Promise<string[]>): Promise<void> {
  const entries = readScoutingCleanupOutbox(storage, key).filter((entry) => entry.userId === userId && entry.farmId === farmId)
  if (!entries.length) return
  let confirmed: string[]
  try { confirmed = await remove(entries.map((entry) => entry.path)) }
  catch { return /* kept for the next drain */ }
  if (!confirmed.length) return
  try {
    const remaining = readScoutingCleanupOutbox(storage, key).filter((entry) => !confirmed.includes(entry.path))
    storage.setItem(key, JSON.stringify({ version: 2, entries: remaining } satisfies Envelope))
  } catch { /* a failed trim only means a harmless duplicate removal attempt later */ }
}

/**
 * Version-1 entries predate account ownership and cannot safely be assigned to
 * whichever user happens to be revoked next. Move them intact to a separate,
 * device-level vault that is never exposed as any user's recovery work.
 */
export function quarantineLegacyScoutingCleanup(storage: StorageLike, projectRef: string): number {
  const legacyKey = legacyScoutingCleanupOutboxKey(projectRef)
  const raw = storage.getItem(legacyKey)
  if (raw === null) return 0
  const legacy = parseLegacy(raw)
  const unownedKey = unownedScoutingCleanupRecoveryKey(projectRef)
  const existing = parseLegacy(storage.getItem(unownedKey))
  const entries = [...existing.entries]
  for (const entry of legacy.entries) if (!entries.some((candidate) => candidate.path === entry.path && candidate.farmId === entry.farmId && candidate.recordedAt === entry.recordedAt)) entries.push(entry)
  const bytes = JSON.stringify({ version: 1, entries } satisfies LegacyEnvelope)
  storage.setItem(unownedKey, bytes)
  if (storage.getItem(unownedKey) !== bytes) throw new Error('Farm Rx could not safely retain legacy photo-cleanup work.')
  storage.removeItem(legacyKey)
  if (storage.getItem(legacyKey) !== null) throw new Error('Farm Rx could not safely separate legacy photo-cleanup work.')
  return legacy.entries.length
}
