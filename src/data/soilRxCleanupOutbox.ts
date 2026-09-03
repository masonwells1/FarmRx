import { isSoilReportPath, isSoilRxUuid } from './soilRx'
import type { StorageLike } from './writeQueue'

export interface SoilRxCleanupEntry { path: string; userId: string; farmId: string; recordedAt: string }
export interface SoilRxAttachmentCustodyEntry { kind: 'attachment_save'; testId: string; paths: string[]; removedPaths?: string[]; userId: string; farmId: string; recordedAt: string }
type StoredReportCleanup = SoilRxCleanupEntry & { kind: 'report_path' }
export type SoilRxStoredCleanupEntry = StoredReportCleanup | SoilRxAttachmentCustodyEntry
interface Envelope { version: 2; entries: SoilRxStoredCleanupEntry[] }

export function soilRxCleanupOutboxKey(projectRef: string, userId: string) { return `farm-rx-soil-rx-cleanup:v1:${projectRef}:${userId}` }

function validPath(path: unknown, farmId: string, testId?: string) {
  if (typeof path !== 'string') return false
  const parts = path.split('/')
  return parts.length === 4 && isSoilRxUuid(parts[1]) && isSoilRxUuid(parts[2]) && (!testId || parts[2] === testId) && isSoilReportPath(path, { farmId, fieldId: parts[1], testId: parts[2] })
}
function validStamp(value: unknown) { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) }
const soilRxAttachmentLegacyKeys = ['kind', 'testId', 'paths', 'userId', 'farmId', 'recordedAt'] as const
const soilRxAttachmentCurrentKeys = [...soilRxAttachmentLegacyKeys, 'removedPaths'] as const
function hasExactOwnKeys(row: Record<string, unknown>, keys: readonly string[]) { return Object.keys(row).length === keys.length && keys.every((key) => Object.hasOwn(row, key)) }
export function isSoilRxStoredCleanupEntry(value: unknown): value is SoilRxStoredCleanupEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (!isSoilRxUuid(row.userId) || !isSoilRxUuid(row.farmId) || !validStamp(row.recordedAt)) return false
  if (row.kind === 'report_path') return Object.keys(row).length === 5 && validPath(row.path, row.farmId)
  const paths = row.paths
  if (row.kind !== 'attachment_save' || !isSoilRxUuid(row.testId) || !Array.isArray(paths) || paths.length === 0 || new Set(paths).size !== paths.length || !paths.every((path) => validPath(path, row.farmId as string, row.testId as string))) return false
  if ('removedPaths' in row && !Object.hasOwn(row, 'removedPaths')) return false
  if (hasExactOwnKeys(row, soilRxAttachmentLegacyKeys)) return true
  const removedPaths = row.removedPaths
  return hasExactOwnKeys(row, soilRxAttachmentCurrentKeys) && Array.isArray(removedPaths) && new Set(removedPaths).size === removedPaths.length && removedPaths.every((path) => typeof path === 'string' && paths.includes(path))
}
function legacy(value: unknown): StoredReportCleanup | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 4) return null
  const row = value as Record<string, unknown>
  if (!isSoilRxUuid(row.userId) || !isSoilRxUuid(row.farmId) || !validStamp(row.recordedAt) || !validPath(row.path, row.farmId)) return null
  return { kind: 'report_path', path: row.path as string, userId: row.userId, farmId: row.farmId, recordedAt: row.recordedAt as string }
}
function parse(raw: string | null): Envelope {
  if (raw === null) return { version: 2, entries: [] }
  try {
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2 && Array.isArray((value as { entries?: unknown }).entries)) {
      const version = (value as { version?: unknown }).version
      const entries = (value as { entries: unknown[] }).entries
      if (version === 2 && entries.every(isSoilRxStoredCleanupEntry)) return value as Envelope
      if (version === 1) {
        const converted = entries.map(legacy)
        if (converted.every((entry): entry is StoredReportCleanup => entry !== null)) return { version: 2, entries: converted }
      }
    }
  } catch { /* fail closed below */ }
  throw new Error('Farm Rx could not safely read saved Soil Rx cleanup custody.')
}
function write(storage: StorageLike, key: string, entries: SoilRxStoredCleanupEntry[]) {
  const bytes = JSON.stringify({ version: 2, entries } satisfies Envelope)
  storage.setItem(key, bytes)
  if (storage.getItem(key) !== bytes) throw new Error('Farm Rx could not confirm Soil Rx cleanup custody.')
}
function sameActor(entries: SoilRxStoredCleanupEntry[], userId: string) { return entries.every((entry) => entry.userId === userId) }

export function readSoilRxCleanupOutbox(storage: StorageLike, key: string) { return parse(storage.getItem(key)).entries }
export function recordSoilRxCleanup(storage: StorageLike, key: string, entry: SoilRxCleanupEntry) {
  const stored: StoredReportCleanup = { kind: 'report_path', ...entry }
  if (!isSoilRxStoredCleanupEntry(stored)) return false
  try {
    const current = readSoilRxCleanupOutbox(storage, key)
    if (!sameActor(current, entry.userId)) return false
    write(storage, key, current.some((row) => row.kind === 'report_path' && row.path === entry.path) ? current : [...current, stored])
    return true
  } catch { return false }
}
export function readSoilRxAttachmentCustody(storage: StorageLike, key: string, userId: string, farmId: string, testId: string) {
  return readSoilRxCleanupOutbox(storage, key).find((entry): entry is SoilRxAttachmentCustodyEntry => entry.kind === 'attachment_save' && entry.userId === userId && entry.farmId === farmId && entry.testId === testId) ?? null
}
export function beginSoilRxAttachmentCustody(storage: StorageLike, key: string, entry: Omit<SoilRxAttachmentCustodyEntry, 'kind' | 'paths'> & { path: string }) {
  const candidate: SoilRxAttachmentCustodyEntry = { kind: 'attachment_save', testId: entry.testId, paths: [entry.path], removedPaths: [], userId: entry.userId, farmId: entry.farmId, recordedAt: entry.recordedAt }
  if (!isSoilRxStoredCleanupEntry(candidate)) throw new Error('Farm Rx could not safely start Soil Rx attachment custody.')
  const current = readSoilRxCleanupOutbox(storage, key)
  if (!sameActor(current, entry.userId)) throw new Error('Farm Rx found Soil Rx cleanup work for another account.')
  const existing = current.find((row): row is SoilRxAttachmentCustodyEntry => row.kind === 'attachment_save' && row.testId === entry.testId)
  if (existing && (existing.userId !== entry.userId || existing.farmId !== entry.farmId)) throw new Error('Farm Rx found Soil Rx attachment work for another farm.')
  const next = existing
    ? current.map((row) => row === existing ? { ...existing, paths: existing.paths.includes(entry.path) ? existing.paths : [...existing.paths, entry.path], removedPaths: existing.removedPaths ?? [] } : row)
    : [...current, candidate]
  write(storage, key, next)
}
export function replaceSoilRxAttachmentCustody(storage: StorageLike, key: string, entry: Omit<SoilRxAttachmentCustodyEntry, 'kind' | 'paths'> & { path: string }) {
  const candidate: SoilRxAttachmentCustodyEntry = { kind: 'attachment_save', testId: entry.testId, paths: [entry.path], removedPaths: [], userId: entry.userId, farmId: entry.farmId, recordedAt: entry.recordedAt }
  if (!isSoilRxStoredCleanupEntry(candidate)) throw new Error('Farm Rx could not safely replace Soil Rx attachment custody.')
  const current = readSoilRxCleanupOutbox(storage, key)
  if (!sameActor(current, entry.userId)) throw new Error('Farm Rx found Soil Rx cleanup work for another account.')
  const existing = current.find((row): row is SoilRxAttachmentCustodyEntry => row.kind === 'attachment_save' && row.testId === entry.testId)
  if (!existing || existing.userId !== entry.userId || existing.farmId !== entry.farmId) throw new Error('Farm Rx lost the original Soil Rx attachment custody before retry.')
  write(storage, key, current.map((row) => row === existing ? candidate : row))
}
export function confirmSoilRxAttachmentRemoval(storage: StorageLike, key: string, userId: string, farmId: string, testId: string, paths: string[]) {
  const current = readSoilRxCleanupOutbox(storage, key)
  const target = current.find((row): row is SoilRxAttachmentCustodyEntry => row.kind === 'attachment_save' && row.testId === testId)
  if (!target || target.userId !== userId || target.farmId !== farmId || paths.some((path) => !target.paths.includes(path))) throw new Error('Farm Rx lost Soil Rx attachment custody before confirming cleanup.')
  const removedPaths = [...new Set([...(target.removedPaths ?? []), ...paths])]
  write(storage, key, current.map((row) => row === target ? { ...target, removedPaths } : row))
}
export function releaseSoilRxAttachmentCustody(storage: StorageLike, key: string, userId: string, farmId: string, testId: string) {
  const current = readSoilRxCleanupOutbox(storage, key)
  const target = current.find((row): row is SoilRxAttachmentCustodyEntry => row.kind === 'attachment_save' && row.testId === testId)
  if (!target || target.userId !== userId || target.farmId !== farmId) throw new Error('Farm Rx lost Soil Rx attachment custody before confirming the save.')
  write(storage, key, current.filter((row) => row !== target))
}
export async function drainSoilRxCleanupOutbox(storage: StorageLike, key: string, userId: string, farmId: string, remove: (paths: string[]) => Promise<string[]>) {
  const current = readSoilRxCleanupOutbox(storage, key)
  const target = current.filter((row): row is StoredReportCleanup => row.kind === 'report_path' && row.userId === userId && row.farmId === farmId)
  if (!target.length) return
  let confirmed: string[]
  try { confirmed = await remove(target.map((row) => row.path)) } catch { return }
  if (!confirmed.length) return
  write(storage, key, current.filter((row) => row.kind !== 'report_path' || !confirmed.includes(row.path)))
}
