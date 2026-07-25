import { validateFieldLogDraft, type FieldLogEntryDraft } from './fieldLog'
import type { FarmOperationContext } from './farmOperationContext'
import { appendNeedsAttention, needsAttentionKey, readNeedsAttention } from './needsAttentionStore'
import type { StorageLike } from './writeQueue'

export type FieldLogQueueEntryV1 = { version: 1; module: 'fieldLog'; kind: 'saveEntry'; operationId: string; userId: string; farmId: string; enqueuedAt: string; draft: FieldLogEntryDraft } | { version: 1; module: 'fieldLog'; kind: 'deleteEntry'; operationId: string; userId: string; farmId: string; enqueuedAt: string; entryId: string }
export type FieldLogQueueEntryV2 = { version: 2; module: 'fieldLog'; kind: 'saveEntry'; operationId: string; userId: string; farmId: string; enqueuedAt: string; operationContext: FarmOperationContext; draft: FieldLogEntryDraft } | { version: 2; module: 'fieldLog'; kind: 'deleteEntry'; operationId: string; userId: string; farmId: string; enqueuedAt: string; operationContext: FarmOperationContext; entryId: string }
export type FieldLogQueueEntry = FieldLogQueueEntryV1 | FieldLogQueueEntryV2
export interface FieldLogQueueEnvelopeV1 { version: 1; entries: FieldLogQueueEntry[] }
const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
const legacyBlocked = 'This saved Field Log change predates access custody tracking and cannot be sent automatically.'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const token = /^[a-z0-9-]{16,128}$/i
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const validDraft = (value: unknown) => record(value) && exact(value, ['id', 'field_id', 'entry_type', 'observed_on', 'rainfall_in', 'note']) && typeof value.id === 'string' && uuid.test(value.id) && typeof value.field_id === 'string' && uuid.test(value.field_id) && (value.rainfall_in === null || typeof value.rainfall_in === 'number') && (value.note === null || typeof value.note === 'string') && validateFieldLogDraft(value as unknown as FieldLogEntryDraft) === null
function validOperationContext(value: unknown, entry: Record<string, unknown>): value is FarmOperationContext {
  return record(value)
    && exact(value, ['projectRef', 'userId', 'farmId', 'generation', 'token', 'serverEpoch'])
    && typeof value.projectRef === 'string'
    && !!value.projectRef
    && value.userId === entry.userId
    && value.farmId === entry.farmId
    && typeof value.token === 'string'
    && token.test(value.token)
    && Number.isSafeInteger(value.generation)
    && Number(value.generation) > 0
    && Number.isSafeInteger(value.serverEpoch)
    && Number(value.serverEpoch) > 0
}
function valid(value: unknown): value is FieldLogQueueEntry {
  if (!record(value) || (value.version !== 1 && value.version !== 2) || value.module !== 'fieldLog' || !['operationId', 'userId', 'farmId'].every((key) => typeof value[key] === 'string' && uuid.test(value[key])) || typeof value.enqueuedAt !== 'string' || Number.isNaN(Date.parse(value.enqueuedAt))) return false
  const common = ['version', 'module', 'kind', 'operationId', 'userId', 'farmId', 'enqueuedAt']
  const custody = value.version === 2 ? ['operationContext'] : []
  if (value.version === 2 && !validOperationContext(value.operationContext, value)) return false
  return value.kind === 'saveEntry' ? exact(value, [...common, ...custody, 'draft']) && validDraft(value.draft) : value.kind === 'deleteEntry' && exact(value, [...common, ...custody, 'entryId']) && typeof value.entryId === 'string' && uuid.test(value.entryId)
}
export function parseFieldLogQueue(serialized: string): FieldLogQueueEnvelopeV1 { let parsed: unknown; try { parsed = JSON.parse(serialized) } catch { throw new Error(blocked) }; if (!record(parsed) || !exact(parsed, ['version', 'entries']) || parsed.version !== 1 || !Array.isArray(parsed.entries) || !parsed.entries.every(valid)) throw new Error(blocked); return parsed as unknown as FieldLogQueueEnvelopeV1 }
export class FieldLogWriteQueue {
  constructor(private readonly storage: StorageLike, readonly key: string) {}
  read() { const raw = this.storage.getItem(this.key); return raw === null ? { version: 1 as const, entries: [] } : parseFieldLogQueue(raw) }
  private persist(next: FieldLogQueueEnvelopeV1) { const raw = JSON.stringify(next); parseFieldLogQueue(raw); this.storage.setItem(this.key, raw); if (this.storage.getItem(this.key) !== raw) throw new Error('This log entry could not be saved on this device. Keep this screen open and try again.') }
  append(entry: FieldLogQueueEntry) { const current = this.read(); const next = { version: 1 as const, entries: current.entries.some((item) => item.operationId === entry.operationId) ? current.entries : [...current.entries, entry] }; this.persist(next); return next }
  removeConfirmedHead(operationId: string) { const current = this.read(); if (current.entries[0]?.operationId !== operationId) throw new Error(blocked); const next = { version: 1 as const, entries: current.entries.slice(1) }; this.persist(next); return next }
  parkLegacyHead(operationId: string) {
    const current = this.read(); const head = current.entries[0]
    if (!head || head.operationId !== operationId || head.version !== 1) throw new Error(blocked)
    const attentionKey = needsAttentionKey(this.key); const priorAttention = this.storage.getItem(attentionKey)
    if (priorAttention !== null && priorAttention !== JSON.stringify({ version: 1, records: readNeedsAttention(this.storage, this.key) })) throw new Error(blocked)
    appendNeedsAttention(this.storage, this.key, { id: head.operationId, module: 'fieldLog', createdAt: head.enqueuedAt, message: legacyBlocked, entry: head })
    const next = { version: 1 as const, entries: current.entries.slice(1) }; this.persist(next); return next
  }
}
export const fieldLogWriteQueueKey = (projectRef: string, userId: string, farmId: string) => `farm-rx-field-log-write-queue:v1:${projectRef}:${userId}:${farmId}`
