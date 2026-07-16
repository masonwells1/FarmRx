import type { StorageLike } from './writeQueue'
import { quarantineLegacyScoutingCleanup, scoutingCleanupOutboxKey, type ScoutingCleanupEntry } from './scoutingCleanupOutbox'
import { parseFieldsQueue } from './writeQueue'
import { parseFieldLocationQueue } from './fieldLocation'
import { parseFieldLogQueue } from './fieldLogWriteQueue'
import { parseScoutingQueue } from './scoutingWriteQueue'
import { parseHarvestQueue } from './harvestWriteQueue'
import { parseInventoryQueue } from './inventoryWriteQueue'
import { parseGrainQueue } from './grainWriteQueue'
import { parseProfitabilityQueue } from './profitabilityWriteQueue'
import { parseEquipmentTasksQueue } from './equipmentTasksWriteQueue'
import { parseNotificationsQueue } from './notificationsWriteQueue'
import { parseProgramsQueue } from './programsWriteQueue'

export type RevokedWorkKind = 'queue' | 'needs_attention' | 'scouting_cleanup'
export type RevokedWorkItem = { version: 1; id: string; projectRef: string; userId: string; farmId: string; originalKey: string; kind: RevokedWorkKind; capturedAt: string; reason: 'farm_access_removed'; payload: unknown }
type Envelope = { version: 1; records: RevokedWorkItem[] }
type Scope = { projectRef: string; userId: string; farmId: string }
type EnumeratedStorage = StorageLike & { readonly length: number; key(index: number): string | null }

type QueueEntryScope = { operationId: string; userId: string; farmId: string; enqueuedAt: string; module: string }
type QueueDefinition = { prefix: string; parse: (serialized: string) => unknown }
const queueDefinitions: readonly QueueDefinition[] = [
  { prefix: 'farm-rx-write-queue:v1:', parse: parseFieldsQueue },
  { prefix: 'farm-rx-field-location-queue:v1:', parse: parseFieldLocationQueue },
  { prefix: 'farm-rx-field-log-write-queue:v1:', parse: parseFieldLogQueue },
  { prefix: 'farm-rx-scouting-write-queue:v1:', parse: parseScoutingQueue },
  { prefix: 'farm-rx-harvest-write-queue:v1:', parse: parseHarvestQueue },
  { prefix: 'farm-rx-inventory-write-queue:v1:', parse: parseInventoryQueue },
  { prefix: 'farm-rx-grain-write-queue:v1:', parse: parseGrainQueue },
  { prefix: 'farm-rx-profitability-write-queue:v1:', parse: parseProfitabilityQueue },
  { prefix: 'farm-rx-equipment-tasks-queue:v1:', parse: parseEquipmentTasksQueue },
  { prefix: 'farm-rx-notifications-write-queue:v1:', parse: parseNotificationsQueue },
  { prefix: 'farm-rx-programs-write-queue:v1:', parse: parseProgramsQueue },
] as const
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const recoveryId = /^rw1-[0-9a-f]{16}(?:-\d+)?$/

export function revokedFarmRecoveryKey(projectRef: string, userId: string) { return `farm-rx-revoked-work-recovery:v1:${projectRef}:${userId}` }
function plainJson(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every(plainJson)
  return !!value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype && Object.values(value as Record<string, unknown>).every(plainJson)
}
function expectedQueueKey(key: string, scope: Scope) {
  const base = key.endsWith(':needs-attention') ? key.slice(0, -':needs-attention'.length) : key
  const definition = queueDefinitions.find(({ prefix }) => base === `${prefix}${scope.projectRef}:${scope.userId}:${scope.farmId}`)
  if (!definition) return null
  return { definition, kind: key.endsWith(':needs-attention') ? 'needs_attention' as const : 'queue' as const }
}
function scopedEntries(definition: QueueDefinition, serialized: string, scope: Scope): QueueEntryScope[] {
  const parsed = definition.parse(serialized) as { entries?: unknown }
  if (!Array.isArray(parsed.entries)) throw new Error('Saved work has an invalid queue shape.')
  const entries = parsed.entries as QueueEntryScope[]
  if (!entries.every((entry) => entry.userId === scope.userId && entry.farmId === scope.farmId)) throw new Error('Saved work does not match the farm being secured.')
  return entries
}
function parseNeedsAttentionPayload(definition: QueueDefinition, raw: string, scope: Scope): unknown {
  const parsed: unknown = JSON.parse(raw)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
  const envelope = parsed as Record<string, unknown>
  if (Object.keys(envelope).length !== 2 || envelope.version !== 1 || !Array.isArray(envelope.records)) throw new Error()
  for (const item of envelope.records) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error()
    const record = item as Record<string, unknown>
    const keys = Object.keys(record)
    if (!(keys.length === 5 || keys.length === 6) || !['id', 'module', 'createdAt', 'message', 'entry'].every((key) => Object.hasOwn(record, key)) || (keys.length === 6 && !Object.hasOwn(record, 'reason')) || typeof record.id !== 'string' || typeof record.module !== 'string' || typeof record.createdAt !== 'string' || Number.isNaN(Date.parse(record.createdAt)) || typeof record.message !== 'string' || !record.message.trim() || !plainJson(record.entry) || (Object.hasOwn(record, 'reason') && record.reason !== 'database_update_required')) throw new Error()
    const entries = scopedEntries(definition, JSON.stringify({ version: 1, entries: [record.entry] }), scope)
    const entry = entries[0]
    if (!entry || record.id !== entry.operationId || record.module !== entry.module || record.createdAt !== entry.enqueuedAt) throw new Error()
  }
  return parsed
}
function validItem(value: unknown): value is RevokedWorkItem {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (Object.keys(row).length !== 10 || row.version !== 1 || typeof row.id !== 'string' || !recoveryId.test(row.id) || typeof row.projectRef !== 'string' || typeof row.userId !== 'string' || typeof row.farmId !== 'string' || typeof row.originalKey !== 'string' || typeof row.capturedAt !== 'string' || Number.isNaN(Date.parse(row.capturedAt)) || row.reason !== 'farm_access_removed' || !plainJson(row.payload)) return false
  const kind = row.kind
  if (kind === 'scouting_cleanup') return row.originalKey === scoutingCleanupOutboxKey(String(row.projectRef), String(row.userId)) && Array.isArray(row.payload) && row.payload.every((entry) => validScoutingCleanup(entry, String(row.farmId), String(row.userId)))
  if (kind !== 'queue' && kind !== 'needs_attention') return false
  const scope = { projectRef: String(row.projectRef), userId: String(row.userId), farmId: String(row.farmId) }
  const expected = expectedQueueKey(String(row.originalKey), scope)
  if (!expected || expected.kind !== kind) return false
  try { if (kind === 'queue') scopedEntries(expected.definition, JSON.stringify(row.payload), scope); else parseNeedsAttentionPayload(expected.definition, JSON.stringify(row.payload), scope); return true } catch { return false }
}
function validScoutingCleanup(value: unknown, farmId: string, userId: string): value is ScoutingCleanupEntry {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 4) return false
  const entry = value as Record<string, unknown>
  if (typeof entry.path !== 'string' || typeof entry.userId !== 'string' || entry.userId !== userId || !uuid.test(entry.userId) || typeof entry.farmId !== 'string' || entry.farmId !== farmId || !uuid.test(entry.farmId) || typeof entry.recordedAt !== 'string' || Number.isNaN(Date.parse(entry.recordedAt))) return false
  const [pathFarm, fieldId, noteId, file, ...extra] = entry.path.split('/')
  return extra.length === 0 && pathFarm === farmId && uuid.test(fieldId ?? '') && uuid.test(noteId ?? '') && !!file && file !== '.' && file !== '..'
}
function parse(raw: string | null): Envelope {
  if (raw === null) return { version: 1, records: [] }
  try { const value: unknown = JSON.parse(raw); if (!!value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 2 && (value as { version?: unknown }).version === 1 && Array.isArray((value as { records?: unknown }).records) && (value as { records: unknown[] }).records.every(validItem)) return value as Envelope } catch { /* fail closed below */ }
  throw new Error('Farm Rx could not safely read the saved recovery work on this device.')
}
function hash(value: string, seed: number) { let result = seed; for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16_777_619); return (result >>> 0).toString(16).padStart(8, '0') }
function baseId(scope: Scope, kind: RevokedWorkKind, key: string, payload: unknown) { const identity = `${scope.projectRef}\0${scope.userId}\0${scope.farmId}\0${kind}\0${key}\0${JSON.stringify(payload)}`; return `rw1-${hash(identity, 2_166_136_261)}${hash(identity, 3_337_903_763)}` }
function sameRecord(record: RevokedWorkItem, scope: Scope, kind: RevokedWorkKind, key: string, payload: unknown) { return record.projectRef === scope.projectRef && record.userId === scope.userId && record.farmId === scope.farmId && record.kind === kind && record.originalKey === key && JSON.stringify(record.payload) === JSON.stringify(payload) }
function durableWrite(storage: StorageLike, key: string, envelope: Envelope) {
  const bytes = JSON.stringify(envelope)
  storage.setItem(key, bytes)
  const readBack = storage.getItem(key)
  if (readBack !== bytes || !readBack || JSON.stringify(parse(readBack)) !== bytes) throw new Error('Farm Rx could not safely retain removed-farm work on this device. Nothing was cleared.')
}

export function readRevokedFarmRecovery(storage: StorageLike, projectRef: string, userId: string) { return parse(storage.getItem(revokedFarmRecoveryKey(projectRef, userId))).records }
export function dismissRevokedFarmRecovery(storage: StorageLike, projectRef: string, userId: string, idToDismiss: string) {
  const key = revokedFarmRecoveryKey(projectRef, userId); const current = parse(storage.getItem(key)); const next = { version: 1 as const, records: current.records.filter((record) => record.id !== idToDismiss) }
  durableWrite(storage, key, next)
}

/** Moves revoked farm work to a separate recovery vault. It deliberately never writes to a live queue. */
export function quarantineRevokedFarmWork(storage: EnumeratedStorage, scope: Scope, capturedAt = new Date().toISOString()): number {
  quarantineLegacyScoutingCleanup(storage, scope.projectRef)
  const candidate: Array<{ key: string; kind: RevokedWorkKind; payload: unknown }> = []
  const emptyKeys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index); if (!key || key.endsWith(':lease')) continue
    const expected = expectedQueueKey(key, scope); if (!expected) continue
    const raw = storage.getItem(key); if (raw === null) continue
    try {
      const payload = expected.kind === 'queue' ? JSON.parse(raw) as unknown : parseNeedsAttentionPayload(expected.definition, raw, scope)
      const entries = expected.kind === 'queue' ? scopedEntries(expected.definition, raw, scope) : (payload as { records: unknown[] }).records
      if (entries.length === 0) { emptyKeys.push(key); continue }
      candidate.push({ key, kind: expected.kind, payload })
    } catch { throw new Error('Farm Rx found unreadable or mismatched saved work for a farm you no longer can open. Nothing was cleared.') }
  }
  const cleanupKey = scoutingCleanupOutboxKey(scope.projectRef, scope.userId)
  const cleanupRaw = storage.getItem(cleanupKey)
  let cleanupAll: ScoutingCleanupEntry[] = []
  if (cleanupRaw !== null) {
    try { const parsed: unknown = JSON.parse(cleanupRaw); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).length !== 2 || (parsed as { version?: unknown }).version !== 2 || !Array.isArray((parsed as { entries?: unknown }).entries) || !(parsed as { entries: unknown[] }).entries.every((entry) => !!entry && typeof entry === 'object' && !Array.isArray(entry) && typeof (entry as { farmId?: unknown }).farmId === 'string' && validScoutingCleanup(entry, (entry as { farmId: string }).farmId, scope.userId))) throw new Error(); cleanupAll = (parsed as { entries: ScoutingCleanupEntry[] }).entries } catch { throw new Error('Farm Rx could not safely read saved scouting cleanup work. Nothing was cleared.') }
    const partition = cleanupAll.filter((entry) => entry.farmId === scope.farmId)
    if (partition.length) candidate.push({ key: cleanupKey, kind: 'scouting_cleanup', payload: partition })
  }
  const recoveryKey = revokedFarmRecoveryKey(scope.projectRef, scope.userId)
  const prior = candidate.length ? parse(storage.getItem(recoveryKey)) : { version: 1 as const, records: [] }
  const additions: RevokedWorkItem[] = []
  for (const { key, kind, payload } of candidate) {
    const existing = [...prior.records, ...additions]
    if (existing.some((record) => sameRecord(record, scope, kind, key, payload))) continue
    const base = baseId(scope, kind, key, payload)
    let nextId = base; let suffix = 2
    while (existing.some((record) => record.id === nextId)) { nextId = `${base}-${suffix}`; suffix += 1 }
    additions.push({ version: 1, id: nextId, projectRef: scope.projectRef, userId: scope.userId, farmId: scope.farmId, originalKey: key, kind, capturedAt, reason: 'farm_access_removed', payload })
  }
  if (candidate.length) durableWrite(storage, recoveryKey, { version: 1, records: [...prior.records, ...additions] })
  for (const item of candidate) {
    if (item.kind === 'scouting_cleanup') {
      const bytes = JSON.stringify({ version: 2, entries: cleanupAll.filter((entry) => entry.farmId !== scope.farmId || entry.userId !== scope.userId) })
      storage.setItem(item.key, bytes); if (storage.getItem(item.key) !== bytes) throw new Error('Farm Rx could not remove active scouting cleanup work after recovery was saved.')
    } else { storage.removeItem(item.key); if (storage.getItem(item.key) !== null) throw new Error('Farm Rx could not remove active saved work after recovery was saved.') }
  }
  for (const key of emptyKeys) { storage.removeItem(key); if (storage.getItem(key) !== null) throw new Error('Farm Rx could not remove an empty saved-work queue for a farm you no longer can open.') }
  return candidate.length
}
