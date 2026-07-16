import type { Arrangement, CropAssignment, Field, FieldDraft, FieldsData, FieldsRepository } from './fields'
import type { FieldsOperationWriter, SavedFieldOperation } from './SupabaseFieldsRepository'
import { normalizeFieldDraft } from './SupabaseFieldsRepository'
import { setModuleSyncRetryAction, setModuleSyncStatus } from './syncStatus'
import { FieldsWriteQueue, type FieldsQueueEntryV1, type StorageLike, writeQueueKey } from './writeQueue'
import { captureWorkspaceCacheFence, operationalCacheMaxAgeMs, readWorkspaceCache, WorkspaceMemoryScope, writeWorkspaceCache } from './workspaceCache'
import { queueTransaction } from './queueTransaction'
import { captureQueuedOperationContext, verifyQueuedOperationContext, verifyQueuedReadContext } from './queuedOperationGuard'
import type { FarmOperationContext } from './farmOperationContext'

type Context = { userId: string; farmId: string }
type QueueDependencies = { getContext: () => Promise<Context>; projectRef: string; storage: StorageLike; createId: () => string; clock: () => string; isOffline: () => boolean }
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
export class QueuedFieldsRepository implements FieldsRepository {
  private workspace: FieldsData | null = null
  private workspaceIsCanonical = false
  private receiptFieldIds = new Set<string>()
  private readonly memoryScope = new WorkspaceMemoryScope()
  constructor(private readonly writer: FieldsRepository & FieldsOperationWriter, private readonly dependencies: QueueDependencies) {
    if (typeof window !== 'undefined') window.addEventListener('online', () => { void this.replayCurrent() })
    setModuleSyncRetryAction('fields', () => this.replayCurrent())
  }
  private async contextAndQueue() { const operationContext = await captureQueuedOperationContext(this.dependencies); const context = { userId: operationContext.userId, farmId: operationContext.farmId }; const queue = new FieldsWriteQueue(this.dependencies.storage, writeQueueKey(this.dependencies.projectRef, context.userId, context.farmId)); const memoryGuard = this.memoryScope.enter(this.dependencies.storage, { projectRef: this.dependencies.projectRef, ...context, module: 'fields' }, () => { this.workspace = null; this.workspaceIsCanonical = false; this.receiptFieldIds.clear() }); return { context, operationContext, queue, memoryGuard } }
  private async verifyOperation(entry: FieldsQueueEntryV1, operationContext: FarmOperationContext, memoryGuard: Parameters<WorkspaceMemoryScope['verify']>[1]) { await verifyQueuedOperationContext(this.dependencies, operationContext, entry); this.memoryScope.verify(this.dependencies.storage, memoryGuard) }
  private async locked<T>(queue: FieldsWriteQueue, task: (verify: () => void) => Promise<T>) { return queueTransaction(queue.key, this.dependencies.storage, this.dependencies.createId, task) }
  async inspectAndReplay() { await this.replayCurrent() }
  async getData(retryAfterSameSelectionFenceChange = true): Promise<FieldsData> {
    const { context, operationContext, queue, memoryGuard } = await this.contextAndQueue()
    const verifyRead = () => verifyQueuedReadContext(this.dependencies, operationContext)
    const cacheScope = { projectRef: this.dependencies.projectRef, ...context, module: 'fields' }
    try {
      await this.replayCurrent(); await verifyRead()
      const cacheFence = captureWorkspaceCacheFence(cacheScope)
      const workspace = await this.writer.getData(); await verifyRead(); this.memoryScope.verify(this.dependencies.storage, memoryGuard)
      this.workspace = workspace; this.workspaceIsCanonical = true; this.receiptFieldIds.clear()
      await writeWorkspaceCache(cacheScope, this.workspace, cacheFence); await verifyRead(); this.memoryScope.verify(this.dependencies.storage, memoryGuard)
      const result = await this.locked(queue, () => Promise.resolve(this.overlayQueued(this.workspace!, queue.read().entries)))
      await verifyRead(); this.memoryScope.verify(this.dependencies.storage, memoryGuard); return result
    } catch (error) {
      if (retryAfterSameSelectionFenceChange) {
        let current: FarmOperationContext | null = null
        try { current = await captureQueuedOperationContext(this.dependencies) } catch { /* revoked access stays failed closed */ }
        const sameSelection = current?.userId === operationContext.userId && current?.farmId === operationContext.farmId
        const fenceChanged = current && (current.generation !== operationContext.generation || current.token !== operationContext.token || current.serverEpoch !== operationContext.serverEpoch)
        if (sameSelection && fenceChanged) return this.getData(false)
      }
      await verifyRead()
      const entries = await this.locked(queue, () => Promise.resolve(queue.read().entries)); await verifyRead()
      if (!this.workspace && isTransportFailure(error, this.dependencies.isOffline())) {
        const cached = await readWorkspaceCache<FieldsData>(cacheScope, operationalCacheMaxAgeMs); await verifyRead(); this.memoryScope.verify(this.dependencies.storage, memoryGuard)
        if (cached) { this.workspace = cached.data; this.workspaceIsCanonical = false }
      }
      if (this.workspace && isTransportFailure(error, this.dependencies.isOffline())) { await verifyRead(); this.memoryScope.verify(this.dependencies.storage, memoryGuard); this.workspaceIsCanonical = false; return this.overlayQueued(this.workspace, entries) }
      if (!this.workspace && entries.length && isTransportFailure(error, this.dependencies.isOffline())) throw new Error(offlineMessage)
      throw error
    }
  }
  async saveField(draft: FieldDraft): Promise<Field> {
    const normalized = normalizeFieldDraft(draft, this.dependencies.createId); const operationId = this.dependencies.createId(); const { context, operationContext, queue, memoryGuard } = await this.contextAndQueue()
    const entry: FieldsQueueEntryV1 = { version: 1, module: 'fields', kind: 'saveField', operationId, userId: context.userId, farmId: context.farmId, enqueuedAt: this.dependencies.clock(), draft: normalized as FieldsQueueEntryV1['draft'] }
    const result = await this.locked(queue, async (verify) => {
      const verifyOperation = async () => { verify(); await this.verifyOperation(entry, operationContext, memoryGuard) }; await verifyOperation(); const pending = queue.read().entries.length
      const enqueue = async () => { await verifyOperation(); const next = queue.append(entry); setModuleSyncStatus('fields', { kind: 'pending', pending: next.entries.length }); await verifyOperation(); this.workspace = this.workspace ? this.overlayQueued(this.workspace, next.entries) : this.workspace; return this.queuedField(normalized) }
      if (pending > 0 || this.dependencies.isOffline()) return enqueue()
      this.requireCanonicalBase(normalized.id)
      try { const saved = await this.writer.saveFieldOperation(normalized, operationId, operationContext); await verifyOperation(); this.applySavedReceipt(normalized, saved); if (queue.read().entries.length) setModuleSyncStatus('fields', { kind: 'pending', pending: queue.read().entries.length }); else setModuleSyncStatus('fields', { kind: 'synced', pending: 0 }); return saved.field }
      catch (error) { await this.verifyOperation(entry, operationContext, memoryGuard); if (isTransportFailure(error, this.dependencies.isOffline())) return enqueue(); throw error }
    })
    void this.replayCurrent()
    return result
  }
  private requireCanonicalBase(fieldId: string) { if (!this.workspace || (!this.workspaceIsCanonical && !this.receiptFieldIds.has(fieldId))) throw new Error('Saved changes need a reload before another edit. Reload to continue.') }
  private queuedField(draft: FieldDraft & { id: string }, workspace = this.workspace): Field { const existing = workspace?.fields.find((field) => field.id === draft.id); const timestamp = this.dependencies.clock(); return { id: draft.id, farm_id: existing?.farm_id ?? workspace?.farm.id ?? '', operating_entity_id: draft.operating_entity_id, name: draft.name, total_acres: draft.total_acres, county: draft.county, state: draft.state, legal_description: draft.legal_description, fsa_farm_number: draft.fsa_farm_number, fsa_tract_number: draft.fsa_tract_number, soil_productivity_index: draft.soil_productivity_index, latitude: existing?.latitude ?? null, longitude: existing?.longitude ?? null, location_source: existing?.location_source ?? null, is_active: existing?.is_active ?? true, created_at: existing?.created_at ?? timestamp, updated_at: timestamp } }
  private dayBefore(date: string) { const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() - 1); return value.toISOString().slice(0, 10) }
  private replaceCurrentArrangement(workspace: FieldsData, fieldId: string, replacement: Arrangement) {
    workspace.arrangements = workspace.arrangements.flatMap((row) => {
      if (row.field_id !== fieldId || row.effective_to !== null) return [row]
      if (row.id === replacement.id) return []
      if (row.effective_from < replacement.effective_from) return [{ ...row, effective_to: this.dayBefore(replacement.effective_from), updated_at: replacement.updated_at }]
      return []
    })
    workspace.arrangements.push(replacement)
  }
  private applySavedReceipt(draft: FieldDraft & { id: string }, saved: SavedFieldOperation) {
    if (!this.workspace) return
    const next = structuredClone(this.workspace)
    next.fields = next.fields.some((row) => row.id === saved.field.id) ? next.fields.map((row) => row.id === saved.field.id ? saved.field : row) : [...next.fields, saved.field]
    this.replaceCurrentArrangement(next, saved.field.id, saved.arrangement)
    if (draft.crop_assignments.length) { const years = new Set(draft.crop_assignments.map((row) => row.crop_year)); next.crop_assignments = [...next.crop_assignments.filter((row) => row.field_id !== saved.field.id || !years.has(row.crop_year)), ...saved.cropAssignments] }
    this.workspace = next
    this.receiptFieldIds.add(saved.field.id)
  }
  private expectedVersions(saved: SavedFieldOperation): NonNullable<FieldDraft['expected_versions']> { return { field_updated_at: saved.field.updated_at, arrangement: { id: saved.arrangement.id, updated_at: saved.arrangement.updated_at }, crop_assignments: saved.cropAssignments.map((row) => ({ id: row.id, updated_at: row.updated_at })) } }
  private rebaseExpected(original: FieldDraft['expected_versions'], chained: NonNullable<FieldDraft['expected_versions']>): NonNullable<FieldDraft['expected_versions']> { const changed = new Map(chained.crop_assignments.map((row) => [row.id, row])); return { ...chained, crop_assignments: (original?.crop_assignments ?? []).map((row) => changed.get(row.id) ?? row) } }
  private overlayQueued(workspace: FieldsData, entries: FieldsQueueEntryV1[]): FieldsData {
    let next = structuredClone(workspace)
    for (const entry of entries) {
      const draft = entry.draft; const field = this.queuedField(draft, next); field.farm_id = next.farm.id
      next.fields = next.fields.some((item) => item.id === field.id) ? next.fields.map((item) => item.id === field.id ? field : item) : [...next.fields, field]
      const prior = next.arrangements.find((item) => item.field_id === field.id && item.effective_to === null); const arrangement = { ...(prior ?? { farm_id: next.farm.id, field_id: field.id, effective_to: null, created_at: entry.enqueuedAt, updated_at: entry.enqueuedAt }), ...draft.arrangement, farm_id: next.farm.id, field_id: field.id, effective_to: null, created_at: prior?.id === draft.arrangement.id ? prior.created_at : entry.enqueuedAt, updated_at: entry.enqueuedAt } as Arrangement
      this.replaceCurrentArrangement(next, field.id, arrangement)
      if (draft.crop_assignments.length) { const years = new Set(draft.crop_assignments.map((item) => item.crop_year)); next.crop_assignments = next.crop_assignments.filter((item) => item.field_id !== field.id || !years.has(item.crop_year)); const crops = draft.crop_assignments.map((item) => ({ ...item, farm_id: next.farm.id, field_id: field.id, created_at: next.crop_assignments.find((old) => old.id === item.id)?.created_at ?? entry.enqueuedAt, updated_at: entry.enqueuedAt } as CropAssignment)); next.crop_assignments = [...next.crop_assignments, ...crops] }
    }
    return next
  }
  async replayCurrent() {
    let contextAndQueue: Awaited<ReturnType<QueuedFieldsRepository['contextAndQueue']>>; try { contextAndQueue = await this.contextAndQueue() } catch { return }
    const { context, operationContext, queue, memoryGuard } = contextAndQueue
    try { await this.locked(queue, async (verify) => { let envelope = queue.read(); if (!envelope.entries.length) { setModuleSyncStatus('fields', { kind: 'synced', pending: 0 }); return }; if (this.dependencies.isOffline()) { setModuleSyncStatus('fields', { kind: 'pending', pending: envelope.entries.length }); return }; const versions = new Map<string, NonNullable<FieldDraft['expected_versions']>>(); while (envelope.entries.length) { const head = envelope.entries[0]; if (head.userId !== context.userId || head.farmId !== context.farmId) throw new Error(blocked); await this.verifyOperation(head, operationContext, memoryGuard); setModuleSyncStatus('fields', { kind: 'syncing', pending: envelope.entries.length }); try { const chained = versions.get(head.draft.id); const sent = chained ? { ...head.draft, expected_versions: this.rebaseExpected(head.draft.expected_versions, chained) } : head.draft; const saved = await this.writer.saveFieldOperation(sent, head.operationId, operationContext); versions.set(head.draft.id, this.expectedVersions(saved)); verify(); await this.verifyOperation(head, operationContext, memoryGuard); this.applySavedReceipt(head.draft, saved); await this.verifyOperation(head, operationContext, memoryGuard); envelope = queue.removeConfirmedHead(head.operationId) } catch (error) { await this.verifyOperation(head, operationContext, memoryGuard); if (isTransportFailure(error, this.dependencies.isOffline())) { setModuleSyncStatus('fields', { kind: 'pending', pending: envelope.entries.length }); return }; setModuleSyncStatus('fields', { kind: 'blocked', pending: envelope.entries.length, message: blocked }); return } }; setModuleSyncStatus('fields', { kind: 'synced', pending: 0 }) }) } catch { setModuleSyncStatus('fields', { kind: 'blocked', pending: 0, message: blocked }) }
  }
}
