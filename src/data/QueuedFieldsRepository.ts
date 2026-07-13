import type { Arrangement, CropAssignment, Field, FieldDraft, FieldsData, FieldsRepository } from './fields'
import type { FieldsOperationWriter } from './SupabaseFieldsRepository'
import { normalizeFieldDraft } from './SupabaseFieldsRepository'
import { setModuleSyncRetryAction, setModuleSyncStatus } from './syncStatus'
import { FieldsWriteQueue, type FieldsQueueEntryV1, type StorageLike, writeQueueKey } from './writeQueue'

type Context = { userId: string; farmId: string }
type QueueDependencies = { getContext: () => Promise<Context>; projectRef: string; storage: StorageLike; createId: () => string; clock: () => string; isOffline: () => boolean }
const processLocks = new Map<string, Promise<void>>()
const leaseTtl = 6_000
const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
const offlineMessage = 'Your saved entries are waiting on this device. Connect to load your farm.'

function record(value: unknown): Record<string, unknown> | null { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null }
function errorDetails(error: unknown): Array<Record<string, unknown>> { const result: Array<Record<string, unknown>> = []; const seen = new Set<unknown>(); let next: unknown = error; while (next && !seen.has(next)) { seen.add(next); const item = record(next); if (!item) break; result.push(item); next = item.cause }; return result }
/** The receipt makes fetch/timeouts ambiguous commits. Auth, RLS, validation and malformed responses are definite. */
export function isTransportFailure(error: unknown, offline: boolean) {
  if (offline || error instanceof TypeError) return true
  const details = errorDetails(error)
  const text = [error instanceof Error ? error.message : '', ...details.flatMap((item) => [item.message, item.code, item.status, item.statusCode]).filter((value): value is string | number => typeof value === 'string' || typeof value === 'number').map(String)].join(' ').toLowerCase()
  if (/permission|rls|jwt|auth|unauthori[sz]ed|forbidden|validation|duplicate|conflict|malformed|invalid|23505|23503|22p02|42p01/.test(text) || /\b(400|401|403|409|422)\b/.test(text)) return false
  return /network|fetch|timeout|timed out|connection reset|failed to send|unknown commit|econn|socket|\b(0|408|502|503|504)\b/.test(text)
}
async function serial<T>(key: string, task: () => Promise<T>): Promise<T> { const previous = processLocks.get(key) ?? Promise.resolve(); let release!: () => void; const next = new Promise<void>((resolve) => { release = resolve }); processLocks.set(key, previous.then(() => next)); await previous; try { return await task() } finally { release(); if (processLocks.get(key) === next) processLocks.delete(key) } }

async function crossTabLock<T>(key: string, storage: StorageLike, createId: () => string, task: (verify: () => void) => Promise<T>): Promise<T> {
  const lockName = `farm-rx-fields:${key}`
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(lockName, async () => task(() => undefined))
  const leaseKey = `${key}:lease`; const token = createId(); let lease = ''
  const owns = () => storage.getItem(leaseKey) === lease
  const renew = () => { if (!owns()) throw new Error(blocked); lease = JSON.stringify({ token, expiresAt: Date.now() + leaseTtl }); storage.setItem(leaseKey, lease); if (!owns()) throw new Error(blocked) }
  const existing = storage.getItem(leaseKey)
  try {
    if (existing) { const parsed = JSON.parse(existing) as { expiresAt?: unknown }; if (typeof parsed.expiresAt === 'number' && parsed.expiresAt > Date.now()) throw new Error(blocked) }
    lease = JSON.stringify({ token, expiresAt: Date.now() + leaseTtl }); storage.setItem(leaseKey, lease); if (!owns()) throw new Error(blocked)
    const timer = setInterval(() => { try { renew() } catch { /* the next guarded mutation fails closed */ } }, Math.floor(leaseTtl / 3))
    try { return await task(renew) } finally { clearInterval(timer); if (owns()) storage.removeItem(leaseKey) }
  } catch (error) { throw error instanceof Error ? error : new Error(blocked) }
}

export class QueuedFieldsRepository implements FieldsRepository {
  private workspace: FieldsData | null = null
  constructor(private readonly writer: FieldsRepository & FieldsOperationWriter, private readonly dependencies: QueueDependencies) {
    if (typeof window !== 'undefined') window.addEventListener('online', () => { void this.replayCurrent() })
    setModuleSyncRetryAction('fields', () => this.replayCurrent())
  }
  private async contextAndQueue() { const context = await this.dependencies.getContext(); return { context, queue: new FieldsWriteQueue(this.dependencies.storage, writeQueueKey(this.dependencies.projectRef, context.userId, context.farmId)) } }
  private async locked<T>(queue: FieldsWriteQueue, task: (verify: () => void) => Promise<T>) { return serial(queue.key, () => crossTabLock(queue.key, this.dependencies.storage, this.dependencies.createId, task)) }
  async inspectAndReplay() { await this.replayCurrent() }
  async getData(): Promise<FieldsData> {
    try { await this.replayCurrent(); this.workspace = await this.writer.getData(); const { queue } = await this.contextAndQueue(); return this.locked(queue, () => Promise.resolve(this.overlayQueued(this.workspace!, queue.read().entries))) }
    catch (error) { const { queue } = await this.contextAndQueue(); const entries = await this.locked(queue, () => Promise.resolve(queue.read().entries)); if (this.workspace && isTransportFailure(error, this.dependencies.isOffline())) return this.overlayQueued(this.workspace, entries); if (!this.workspace && entries.length && isTransportFailure(error, this.dependencies.isOffline())) throw new Error(offlineMessage); throw error }
  }
  async saveField(draft: FieldDraft): Promise<Field> {
    const normalized = normalizeFieldDraft(draft, this.dependencies.createId); const operationId = this.dependencies.createId(); const { context, queue } = await this.contextAndQueue()
    const entry: FieldsQueueEntryV1 = { version: 1, module: 'fields', kind: 'saveField', operationId, userId: context.userId, farmId: context.farmId, enqueuedAt: this.dependencies.clock(), draft: normalized as FieldsQueueEntryV1['draft'] }
    const result = await this.locked(queue, async (verify) => {
      verify(); const pending = queue.read().entries.length
      const enqueue = () => { verify(); const next = queue.append(entry); setModuleSyncStatus('fields', { kind: 'pending', pending: next.entries.length }); this.workspace = this.workspace ? this.overlayQueued(this.workspace, next.entries) : this.workspace; return this.queuedField(normalized) }
      if (pending > 0 || this.dependencies.isOffline()) return enqueue()
      try { const field = await this.writer.saveFieldOperation(normalized, operationId); verify(); if (queue.read().entries.length) setModuleSyncStatus('fields', { kind: 'pending', pending: queue.read().entries.length }); else setModuleSyncStatus('fields', { kind: 'synced', pending: 0 }); return field }
      catch (error) { if (isTransportFailure(error, this.dependencies.isOffline())) return enqueue(); throw error }
    })
    void this.replayCurrent()
    return result
  }
  private queuedField(draft: FieldDraft & { id: string }): Field { const existing = this.workspace?.fields.find((field) => field.id === draft.id); const timestamp = this.dependencies.clock(); return { id: draft.id, farm_id: existing?.farm_id ?? this.workspace?.farm.id ?? '', operating_entity_id: draft.operating_entity_id, name: draft.name, total_acres: draft.total_acres, county: draft.county, state: draft.state, legal_description: draft.legal_description, fsa_farm_number: draft.fsa_farm_number, fsa_tract_number: draft.fsa_tract_number, soil_productivity_index: draft.soil_productivity_index, latitude: existing?.latitude ?? null, longitude: existing?.longitude ?? null, location_source: existing?.location_source ?? null, is_active: existing?.is_active ?? true, created_at: existing?.created_at ?? timestamp, updated_at: timestamp } }
  private overlayQueued(workspace: FieldsData, entries: FieldsQueueEntryV1[]): FieldsData {
    let next = structuredClone(workspace)
    for (const entry of entries) {
      const draft = entry.draft; const field = this.queuedField(draft); field.farm_id = next.farm.id
      next.fields = next.fields.some((item) => item.id === field.id) ? next.fields.map((item) => item.id === field.id ? field : item) : [...next.fields, field]
      const prior = next.arrangements.find((item) => item.field_id === field.id && item.effective_to === null); const arrangement = { ...(prior ?? { farm_id: next.farm.id, field_id: field.id, effective_to: null, created_at: entry.enqueuedAt, updated_at: entry.enqueuedAt }), ...draft.arrangement, farm_id: next.farm.id, field_id: field.id, effective_to: null, created_at: prior?.created_at ?? entry.enqueuedAt, updated_at: entry.enqueuedAt } as Arrangement
      next.arrangements = next.arrangements.some((item) => item.id === arrangement.id) ? next.arrangements.map((item) => item.id === arrangement.id ? arrangement : item) : [...next.arrangements, arrangement]
      if (draft.crop_assignments.length) { const years = new Set(draft.crop_assignments.map((item) => item.crop_year)); next.crop_assignments = next.crop_assignments.filter((item) => item.field_id !== field.id || !years.has(item.crop_year)); const crops = draft.crop_assignments.map((item) => ({ ...item, farm_id: next.farm.id, field_id: field.id, created_at: next.crop_assignments.find((old) => old.id === item.id)?.created_at ?? entry.enqueuedAt, updated_at: entry.enqueuedAt } as CropAssignment)); next.crop_assignments = [...next.crop_assignments, ...crops] }
    }
    return next
  }
  async replayCurrent() {
    let contextAndQueue: Awaited<ReturnType<QueuedFieldsRepository['contextAndQueue']>>; try { contextAndQueue = await this.contextAndQueue() } catch { return }
    const { context, queue } = contextAndQueue
    try { await this.locked(queue, async (verify) => { let envelope = queue.read(); if (!envelope.entries.length) { setModuleSyncStatus('fields', { kind: 'synced', pending: 0 }); return }; if (this.dependencies.isOffline()) { setModuleSyncStatus('fields', { kind: 'pending', pending: envelope.entries.length }); return }; while (envelope.entries.length) { const head = envelope.entries[0]; if (head.userId !== context.userId || head.farmId !== context.farmId) throw new Error(blocked); setModuleSyncStatus('fields', { kind: 'syncing', pending: envelope.entries.length }); try { await this.writer.saveFieldOperation(head.draft, head.operationId); verify(); envelope = queue.removeConfirmedHead(head.operationId) } catch (error) { if (isTransportFailure(error, this.dependencies.isOffline())) { setModuleSyncStatus('fields', { kind: 'pending', pending: envelope.entries.length }); return }; setModuleSyncStatus('fields', { kind: 'blocked', pending: envelope.entries.length, message: blocked }); return } }; setModuleSyncStatus('fields', { kind: 'synced', pending: 0 }) }) } catch { setModuleSyncStatus('fields', { kind: 'blocked', pending: 0, message: blocked }) }
  }
}
