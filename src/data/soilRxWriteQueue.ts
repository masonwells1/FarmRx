import type { FarmOperationContext } from './farmOperationContext'
import { isSoilRxUuid, normalizeSoilTestDraft, soilMeasurementKeys, validateSoilTestDraft, type SoilTestDraft } from './soilRx'
import type { StorageLike } from './writeQueue'

export type QueuedSoilTestDraft = SoilTestDraft & { id: string }
export interface SoilRxQueueEntryPayloadV1 {
  version: 1
  module: 'soilRx'
  kind: 'saveTest'
  operationId: string
  userId: string
  farmId: string
  enqueuedAt: string
  operationContext: FarmOperationContext
  draft: QueuedSoilTestDraft
}
export interface SoilRxQueueEntryV1 extends SoilRxQueueEntryPayloadV1 { payloadBytes: string }
export interface SoilRxQueueEnvelopeV1 { version: 1; entries: SoilRxQueueEntryV1[] }

const blocked = 'Saved Soil Rx changes on this device need attention. Nothing was deleted.'
const draftKeys = ['id', 'field_id', 'sample_date', 'lab_name', ...soilMeasurementKeys]
const entryPayloadKeys = ['version', 'module', 'kind', 'operationId', 'userId', 'farmId', 'enqueuedAt', 'operationContext', 'draft']
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))

function isDraft(value: unknown): value is QueuedSoilTestDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (!exact(row, draftKeys)) return false
  return isSoilRxUuid(row.id) && validateSoilTestDraft(normalizeSoilTestDraft(row as unknown as QueuedSoilTestDraft)) === null
}
function isOperationContext(value: unknown, userId: string, farmId: string): value is FarmOperationContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return exact(row, ['projectRef', 'userId', 'farmId', 'generation', 'token', 'serverEpoch'])
    && typeof row.projectRef === 'string' && !!row.projectRef && !row.projectRef.includes(':')
    && row.userId === userId && row.farmId === farmId
    && Number.isSafeInteger(row.generation) && Number(row.generation) >= 1
    && typeof row.token === 'string' && row.token.length >= 16 && row.token.length <= 128
    && Number.isSafeInteger(row.serverEpoch) && Number(row.serverEpoch) >= 1
}
function canonicalPayload(value: SoilRxQueueEntryPayloadV1): SoilRxQueueEntryPayloadV1 {
  return {
    version: value.version,
    module: value.module,
    kind: value.kind,
    operationId: value.operationId,
    userId: value.userId,
    farmId: value.farmId,
    enqueuedAt: value.enqueuedAt,
    operationContext: {
      projectRef: value.operationContext.projectRef,
      userId: value.operationContext.userId,
      farmId: value.operationContext.farmId,
      generation: value.operationContext.generation,
      token: value.operationContext.token,
      serverEpoch: value.operationContext.serverEpoch,
    },
    draft: value.draft,
  }
}
export function createSoilRxQueueEntry(value: SoilRxQueueEntryPayloadV1): SoilRxQueueEntryV1 {
  const payload = canonicalPayload(value)
  return { ...payload, payloadBytes: JSON.stringify(payload) }
}
function isEntry(value: unknown): value is SoilRxQueueEntryV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (!exact(row, [...entryPayloadKeys, 'payloadBytes']) || row.version !== 1 || row.module !== 'soilRx' || row.kind !== 'saveTest'
    || !isSoilRxUuid(row.operationId) || !isSoilRxUuid(row.userId) || !isSoilRxUuid(row.farmId)
    || typeof row.enqueuedAt !== 'string' || Number.isNaN(Date.parse(row.enqueuedAt))
    || !isOperationContext(row.operationContext, row.userId, row.farmId) || !isDraft(row.draft) || typeof row.payloadBytes !== 'string') return false
  const payload = canonicalPayload(row as unknown as SoilRxQueueEntryPayloadV1)
  return row.payloadBytes === JSON.stringify(payload)
}
export function parseSoilRxQueue(serialized: string): SoilRxQueueEnvelopeV1 {
  let value: unknown
  try { value = JSON.parse(serialized) } catch { throw new Error(blocked) }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !exact(value as Record<string, unknown>, ['version', 'entries']) || (value as { version?: unknown }).version !== 1 || !Array.isArray((value as { entries?: unknown }).entries) || !(value as { entries: unknown[] }).entries.every(isEntry)) throw new Error(blocked)
  return value as SoilRxQueueEnvelopeV1
}
export class SoilRxWriteQueue {
  constructor(private readonly storage: StorageLike, readonly key: string) {}
  read() { const raw = this.storage.getItem(this.key); return raw === null ? { version: 1 as const, entries: [] } : parseSoilRxQueue(raw) }
  private persist(value: SoilRxQueueEnvelopeV1) { const bytes = JSON.stringify(value); parseSoilRxQueue(bytes); this.storage.setItem(this.key, bytes); if (this.storage.getItem(this.key) !== bytes) throw new Error('This Soil Rx entry could not be saved on this device. Keep this screen open and try again.'); parseSoilRxQueue(bytes) }
  append(entry: SoilRxQueueEntryV1) { parseSoilRxQueue(JSON.stringify({ version: 1, entries: [entry] })); const next = { version: 1 as const, entries: [...this.read().entries, entry] }; this.persist(next); return next }
  removeConfirmedHead(operationId: string) { const current = this.read(); if (current.entries[0]?.operationId !== operationId) throw new Error(blocked); const next = { version: 1 as const, entries: current.entries.slice(1) }; this.persist(next); return next }
}
export function soilRxWriteQueueKey(projectRef: string, userId: string, farmId: string) { return `farm-rx-soil-rx-write-queue:v1:${projectRef}:${userId}:${farmId}` }
