import type { Arrangement, CropAssignment, Field, FieldDraft, FieldsData, FieldsRepository } from './fields'
import type { FieldsOperationWriter, SavedFieldOperation } from './SupabaseFieldsRepository'
import { normalizeFieldDraft, validateFieldsWorkspace } from './SupabaseFieldsRepository'
import { setModuleSyncStatus } from './syncStatus'
import { FieldsWriteQueue, isFarmReplayContextChangedError, launchReplayInBackground, type FieldsQueueEntryV1, type StorageLike, writeQueueKey } from './writeQueue'
import { captureWorkspaceCacheFence, maximumClockSkewMs, operationalCacheMaxAgeMs, readWorkspaceCache, readWorkspaceCachePure, WorkspaceCacheExpiredError, WorkspaceMemoryScope, writeWorkspaceCache } from './workspaceCache'
import { queueTransaction } from './queueTransaction'
import { captureQueuedOperationContext, verifyQueuedOperationContext, verifyQueuedReadContext } from './queuedOperationGuard'
import { captureFarmOperationContext, verifyFarmOperationContext, type FarmOperationContext } from './farmOperationContext'
import { verifyObservedDeviceTime } from './deviceClockFence'

type Context = { userId: string; farmId: string }
type QueueDependencies = { getContext: () => Promise<Context>; projectRef: string; storage: StorageLike; createId: () => string; clock: () => string; isOffline: () => boolean }
const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
const offlineMessage = 'Your saved entries are waiting on this device. Connect to load your farm.'

function record(value: unknown): Record<string, unknown> | null { return typeof value === 'object' && value !== null ? value as Record<string, unknown> : null }
function errorDetails(error: unknown): Array<Record<string, unknown>> { const result: Array<Record<string, unknown>> = []; const seen = new Set<unknown>(); let next: unknown = error; while (next && !seen.has(next)) { seen.add(next); const item = record(next); if (!item) break; result.push(item); next = item.cause }; return result }
function snapshotIsFresh(capturedAt: string, nowMs: number) { const ageMs = nowMs - Date.parse(capturedAt); return Number.isFinite(ageMs) && ageMs >= -maximumClockSkewMs && ageMs <= operationalCacheMaxAgeMs }
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
  private workspaceCapturedAt: string | null = null
  private workspaceIsCanonical = false
  private receiptFieldIds = new Set<string>()
  private workspaceScopeKey: string | null = null
  private readonly memoryScope = new WorkspaceMemoryScope()
  constructor(private readonly writer: FieldsRepository & FieldsOperationWriter, private readonly dependencies: QueueDependencies) {}
  private scopeKey(context: FarmOperationContext) { return `${context.projectRef}:${context.userId}:${context.farmId}:${context.generation}:${context.token}:${context.serverEpoch}` }
  private clearWorkspace() { this.workspace = null; this.workspaceCapturedAt = null; this.workspaceIsCanonical = false; this.receiptFieldIds.clear() }
  private async contextAndQueue() { const operationContext = await captureQueuedOperationContext(this.dependencies); const context = { userId: operationContext.userId, farmId: operationContext.farmId }; const queue = new FieldsWriteQueue(this.dependencies.storage, writeQueueKey(this.dependencies.projectRef, context.userId, context.farmId)); const memoryGuard = this.memoryScope.enter(this.dependencies.storage, { projectRef: this.dependencies.projectRef, ...context, module: 'fields' }, () => this.clearWorkspace()); this.workspaceScopeKey = this.scopeKey(operationContext); return { context, operationContext, queue, memoryGuard } }
  private snapshotSource(expected: FarmOperationContext) { if (expected.projectRef !== this.dependencies.projectRef) throw new Error('Access to this farm changed while data was loading.'); const current = captureFarmOperationContext(this.dependencies.storage, this.dependencies.projectRef, { userId: expected.userId, farmId: expected.farmId }); verifyFarmOperationContext(this.dependencies.storage, expected, current); const context = { userId: expected.userId, farmId: expected.farmId }; const queue = new FieldsWriteQueue(this.dependencies.storage, writeQueueKey(this.dependencies.projectRef, context.userId, context.farmId)); return { context, operationContext: expected, queue, canUseRetained: this.workspaceScopeKey === this.scopeKey(expected) } }
  private verifySnapshotContext(expected: FarmOperationContext) { const current = captureFarmOperationContext(this.dependencies.storage, this.dependencies.projectRef, { userId: expected.userId, farmId: expected.farmId }); verifyFarmOperationContext(this.dependencies.storage, expected, current) }
  private snapshotNow(expected: FarmOperationContext) { return verifyObservedDeviceTime(this.dependencies.storage, { projectRef: expected.projectRef, userId: expected.userId }, this.dependencies.clock()) }
  private async verifyOperation(entry: FieldsQueueEntryV1, operationContext: FarmOperationContext, memoryGuard: Parameters<WorkspaceMemoryScope['verify']>[1]) { await verifyQueuedOperationContext(this.dependencies, operationContext, entry); this.memoryScope.verify(this.dependencies.storage, memoryGuard) }
  private async locked<T>(queue: FieldsWriteQueue, task: (verify: () => void) => Promise<T>) { return queueTransaction(queue.key, this.dependencies.storage, this.dependencies.createId, task) }
  async inspectAndReplay() { await this.replayCurrent() }
  async getData(retryAfterSameSelectionFenceChange = true): Promise<FieldsData> {
    const { context, operationContext, queue, memoryGuard } = await this.contextAndQueue()
    const verifyRead = () => verifyQueuedReadContext(this.dependencies, operationContext)
    const cacheScope = { projectRef: this.dependencies.projectRef, ...context, module: 'fields' }
    try {
      const cacheFence = captureWorkspaceCacheFence(cacheScope)
      const workspace = validateFieldsWorkspace(await this.writer.getData(), context.farmId); await verifyRead(); this.memoryScope.verify(this.dependencies.storage, memoryGuard)
      const capturedAt = this.dependencies.clock(); this.workspace = workspace; this.workspaceCapturedAt = capturedAt; this.workspaceIsCanonical = true; this.receiptFieldIds.clear()
      await writeWorkspaceCache(cacheScope, this.workspace, cacheFence, capturedAt); await verifyRead(); this.memoryScope.verify(this.dependencies.storage, memoryGuard)
      const result = await this.locked(queue, () => Promise.resolve(validateFieldsWorkspace(this.overlayQueued(this.workspace!, queue.read().entries), context.farmId)))
      await verifyRead(); this.memoryScope.verify(this.dependencies.storage, memoryGuard); return result
    } catch (error) {
      if (retryAfterSameSelectionFenceChange) {
        let current: FarmOperationContext | null = null
        try { current = await captureQueuedOperationContext(this.dependencies) } catch (currentError) { if (isFarmReplayContextChangedError(currentError)) throw currentError /* revoked access stays failed closed */ }
        const sameSelection = current?.userId === operationContext.userId && current?.farmId === operationContext.farmId
        const fenceChanged = current && (current.generation !== operationContext.generation || current.token !== operationContext.token || current.serverEpoch !== operationContext.serverEpoch)
        if (sameSelection && fenceChanged) return this.getData(false)
      }
      await verifyRead()
      const entries = await this.locked(queue, () => Promise.resolve(queue.read().entries)); await verifyRead()
      if (!this.workspace && isTransportFailure(error, this.dependencies.isOffline())) {
        const cached = await readWorkspaceCache<FieldsData>(cacheScope, operationalCacheMaxAgeMs); await verifyRead(); this.memoryScope.verify(this.dependencies.storage, memoryGuard)
        if (cached) { this.workspace = validateFieldsWorkspace(cached.data, context.farmId); this.workspaceCapturedAt = cached.cachedAt; this.workspaceIsCanonical = false }
      }
      if (this.workspace && isTransportFailure(error, this.dependencies.isOffline())) { await verifyRead(); this.memoryScope.verify(this.dependencies.storage, memoryGuard); this.workspaceIsCanonical = false; return validateFieldsWorkspace(this.overlayQueued(validateFieldsWorkspace(this.workspace, context.farmId), entries), context.farmId) }
      if (!this.workspace && entries.length && isTransportFailure(error, this.dependencies.isOffline())) throw new Error(offlineMessage)
      throw error
    }
  }
  async getSnapshot(operationContext: FarmOperationContext) {
    const { context, queue, canUseRetained } = this.snapshotSource(operationContext)
    const verifyRead = () => this.verifySnapshotContext(operationContext)
    const entries = () => { const values = queue.read().entries; if (values.some((entry) => entry.userId !== context.userId || entry.farmId !== context.farmId)) throw new Error(blocked); return values }
    if (!this.writer.getSnapshot) throw new Error('Fields does not expose a side-effect-free snapshot.')
    try {
      const snapshot = await this.writer.getSnapshot(operationContext); verifyRead(); const canonical = validateFieldsWorkspace(snapshot.data, context.farmId)
      const nowMs = this.snapshotNow(operationContext); if (snapshot.source !== 'live' || !snapshotIsFresh(snapshot.capturedAt, nowMs)) throw new WorkspaceCacheExpiredError()
      const result = validateFieldsWorkspace(this.overlayQueued(canonical, entries()), context.farmId); verifyRead(); return { data: result, source: 'live' as const, capturedAt: snapshot.capturedAt }
    } catch (error) {
      verifyRead()
      if (!isTransportFailure(error, this.dependencies.isOffline())) throw error
      const nowMs = this.snapshotNow(operationContext)
      let base = canUseRetained ? this.workspace : null; let capturedAt = canUseRetained ? this.workspaceCapturedAt : null
      if (base && capturedAt && !snapshotIsFresh(capturedAt, nowMs)) { base = null; capturedAt = null }
      if (!base) {
        const cached = await readWorkspaceCachePure<FieldsData>({ projectRef: this.dependencies.projectRef, ...context, module: 'fields' }, operationContext, operationalCacheMaxAgeMs, this.dependencies.storage, nowMs)
        verifyRead()
        if (cached) { base = validateFieldsWorkspace(cached.data, context.farmId); capturedAt = cached.capturedAt }
      }
      if (base && capturedAt) { const canonical = validateFieldsWorkspace(base, context.farmId); const result = validateFieldsWorkspace(this.overlayQueued(canonical, entries()), context.farmId); verifyRead(); return { data: result, source: 'offline' as const, capturedAt } }
      if (entries().length) throw new Error(offlineMessage)
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
    launchReplayInBackground(() => this.replayCurrent())
    return result
  }
  private requireCanonicalBase(fieldId: string) { if (!this.workspace || (!this.workspaceIsCanonical && !this.receiptFieldIds.has(fieldId))) throw new Error('Saved changes need a reload before another edit. Reload to continue.') }
  private queuedField(draft: FieldDraft & { id: string }, workspace = this.workspace, timestamp = this.dependencies.clock()): Field { const existing = workspace?.fields.find((field) => field.id === draft.id); return { id: draft.id, farm_id: existing?.farm_id ?? workspace?.farm.id ?? '', operating_entity_id: draft.operating_entity_id, name: draft.name, total_acres: draft.total_acres, county: draft.county, state: draft.state, legal_description: draft.legal_description, fsa_farm_number: draft.fsa_farm_number, fsa_tract_number: draft.fsa_tract_number, soil_productivity_index: draft.soil_productivity_index, latitude: existing?.latitude ?? null, longitude: existing?.longitude ?? null, location_source: existing?.location_source ?? null, is_active: existing?.is_active ?? true, created_at: existing?.created_at ?? timestamp, updated_at: timestamp } }
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
    if (draft.crop_assignments.length) { const years = new Set(draft.crop_assignments.map((row) => row.crop_year)); next.crop_assignments = [...next.crop_assignments.filter((row) => row.field_id !== saved.field.id || !years.has(row.crop_year)), ...saved.cropAssignments.filter((row) => years.has(row.crop_year))] }
    this.workspace = next
    this.receiptFieldIds.add(saved.field.id)
  }
  private expectedVersions(saved: SavedFieldOperation): NonNullable<FieldDraft['expected_versions']> { return { field_updated_at: saved.field.updated_at, arrangement: { id: saved.arrangement.id, updated_at: saved.arrangement.updated_at }, crop_assignments: saved.cropAssignments.map((row) => ({ id: row.id, updated_at: row.updated_at, crop_year: row.crop_year })) } }
  private rebaseExpected(_original: FieldDraft['expected_versions'], chained: NonNullable<FieldDraft['expected_versions']>): NonNullable<FieldDraft['expected_versions']> { return chained }
  private overlayQueued(workspace: FieldsData, entries: FieldsQueueEntryV1[]): FieldsData {
    let next = structuredClone(workspace)
    for (const entry of entries) {
      const draft = entry.draft; const field = this.queuedField(draft, next, entry.enqueuedAt); field.farm_id = next.farm.id
      next.fields = next.fields.some((item) => item.id === field.id) ? next.fields.map((item) => item.id === field.id ? field : item) : [...next.fields, field]
      const prior = next.arrangements.find((item) => item.field_id === field.id && item.effective_to === null); const arrangement = { ...(prior ?? { farm_id: next.farm.id, field_id: field.id, effective_to: null, created_at: entry.enqueuedAt, updated_at: entry.enqueuedAt }), ...draft.arrangement, farm_id: next.farm.id, field_id: field.id, effective_to: null, created_at: prior?.id === draft.arrangement.id ? prior.created_at : entry.enqueuedAt, updated_at: entry.enqueuedAt } as Arrangement
      this.replaceCurrentArrangement(next, field.id, arrangement)
      if (draft.crop_assignments.length) { const priorCrops = new Map(next.crop_assignments.map((item) => [item.id, item])); const years = new Set(draft.crop_assignments.map((item) => item.crop_year)); next.crop_assignments = next.crop_assignments.filter((item) => item.field_id !== field.id || !years.has(item.crop_year)); const crops = draft.crop_assignments.map((item) => { if (!item.id) throw new Error(blocked); const priorCrop = priorCrops.get(item.id); return { ...item, farm_id: next.farm.id, field_id: field.id, actual_price_per_bu: priorCrop?.actual_price_per_bu ?? null, created_at: priorCrop?.created_at ?? entry.enqueuedAt, updated_at: entry.enqueuedAt } as CropAssignment }); next.crop_assignments = [...next.crop_assignments, ...crops] }
    }
    return next
  }
  async replayCurrent() {
    let contextAndQueue: Awaited<ReturnType<QueuedFieldsRepository['contextAndQueue']>>; try { contextAndQueue = await this.contextAndQueue() } catch (error) { if (isFarmReplayContextChangedError(error)) throw error; return }
    const { context, operationContext, queue, memoryGuard } = contextAndQueue
    try { await this.locked(queue, async (verify) => { await verifyQueuedOperationContext(this.dependencies, operationContext, context); verify(); this.memoryScope.verify(this.dependencies.storage, memoryGuard); let envelope = queue.read(); if (!envelope.entries.length) { setModuleSyncStatus('fields', { kind: 'synced', pending: 0 }); return }; if (this.dependencies.isOffline()) { setModuleSyncStatus('fields', { kind: 'pending', pending: envelope.entries.length }); return }; const versions = new Map<string, NonNullable<FieldDraft['expected_versions']>>(); while (envelope.entries.length) { const head = envelope.entries[0]; if (head.userId !== context.userId || head.farmId !== context.farmId) throw new Error(blocked); await this.verifyOperation(head, operationContext, memoryGuard); setModuleSyncStatus('fields', { kind: 'syncing', pending: envelope.entries.length }); try { const chained = versions.get(head.draft.id); const sent = chained ? { ...head.draft, expected_versions: this.rebaseExpected(head.draft.expected_versions, chained) } : head.draft; const saved = await this.writer.saveFieldOperation(sent, head.operationId, operationContext); versions.set(head.draft.id, this.expectedVersions(saved)); verify(); await this.verifyOperation(head, operationContext, memoryGuard); this.applySavedReceipt(head.draft, saved); await this.verifyOperation(head, operationContext, memoryGuard); envelope = queue.removeConfirmedHead(head.operationId) } catch (error) { await this.verifyOperation(head, operationContext, memoryGuard); if (isTransportFailure(error, this.dependencies.isOffline())) { setModuleSyncStatus('fields', { kind: 'pending', pending: envelope.entries.length }); return }; setModuleSyncStatus('fields', { kind: 'blocked', pending: envelope.entries.length, message: blocked }); return } }; setModuleSyncStatus('fields', { kind: 'synced', pending: 0 }) }) } catch (error) { if (isFarmReplayContextChangedError(error)) throw error; setModuleSyncStatus('fields', { kind: 'blocked', pending: 0, message: blocked }) }
  }
}
