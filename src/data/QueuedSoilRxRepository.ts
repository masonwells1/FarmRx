import { isTransportFailure } from './QueuedFieldsRepository'
import { appendNeedsAttention, dismissNeedsAttention, readNeedsAttention } from './needsAttentionStore'
import { captureQueuedOperationContext, verifyQueuedOperationContext, verifyQueuedReadContext } from './queuedOperationGuard'
import { queueTransaction } from './queueTransaction'
import { drainSoilRxCleanupOutbox, recordSoilRxCleanup, soilRxCleanupOutboxKey } from './soilRxCleanupOutbox'
import { SoilRxWriteQueue, parseSoilRxQueue, soilRxWriteQueueKey, type QueuedSoilTestDraft, type SoilRxQueueEntryV1 } from './soilRxWriteQueue'
import { normalizeSoilTestDraft, sortSoilTestsNewestFirst, validateSoilTestDraft, type SoilReportMime, type SoilRxData, type SoilRxRepository, type SoilTest, type SoilTestDraft } from './soilRx'
import { validateSoilReportFile } from './soilRxStorage'
import type { SupabaseSoilRxRepository } from './SupabaseSoilRxRepository'
import { launchReplayInBackground, type StorageLike } from './writeQueue'
import { captureWorkspaceCacheFence, operationalCacheMaxAgeMs, readWorkspaceCache, writeWorkspaceCache } from './workspaceCache'
import type { FarmOperationContext } from './farmOperationContext'

type Context = { userId: string; farmId: string }
type Source = { context: Context; operationContext: FarmOperationContext; queue: SoilRxWriteQueue }
type Dependencies = {
  getContext: () => Promise<Context>
  projectRef: string
  storage: StorageLike
  createId: () => string
  clock: () => string
  isOffline: () => boolean
  uploadReport: (farmId: string, fieldId: string, testId: string, file: File, context: FarmOperationContext) => Promise<string>
  removeReports: (paths: string[], context: FarmOperationContext) => Promise<string[]>
}
const attention = 'A saved Soil Rx change needs attention. Nothing was deleted.'

export class QueuedSoilRxRepository implements SoilRxRepository {
  private workspace: SoilRxData | null = null
  private scopeKey: string | null = null
  constructor(private readonly live: SupabaseSoilRxRepository, private readonly d: Dependencies) {}

  private async source(): Promise<Source> {
    const operationContext = await captureQueuedOperationContext(this.d)
    const context = { userId: operationContext.userId, farmId: operationContext.farmId }
    const scopeKey = `${context.userId}:${context.farmId}:${operationContext.generation}:${operationContext.token}:${operationContext.serverEpoch}`
    if (this.scopeKey !== scopeKey) { this.workspace = null; this.scopeKey = scopeKey }
    return { context, operationContext, queue: new SoilRxWriteQueue(this.d.storage, soilRxWriteQueueKey(this.d.projectRef, context.userId, context.farmId)) }
  }
  private cacheScope(context: Context) { return { projectRef: this.d.projectRef, ...context, module: 'soilRx' } }
  private pending(entry: SoilRxQueueEntryV1): SoilTest { return { ...entry.draft, farm_id: entry.farmId, created_by: entry.userId, created_at: entry.enqueuedAt, updated_at: entry.enqueuedAt, attachment: null, pending: true } }
  private overlay(data: SoilRxData, entries: SoilRxQueueEntryV1[]) {
    const tests = [...data.tests]
    for (const entry of entries) { const pending = this.pending(entry); const index = tests.findIndex((test) => test.id === pending.id); if (index < 0) tests.push(pending); else tests[index] = pending }
    return { tests: sortSoilTestsNewestFirst(tests) }
  }
  private async retain(source: Source, data: SoilRxData) { this.workspace = data; await writeWorkspaceCache(this.cacheScope(source.context), data, captureWorkspaceCacheFence(this.cacheScope(source.context))); await verifyQueuedReadContext(this.d, source.operationContext) }
  private cleanupKey(userId: string) { return soilRxCleanupOutboxKey(this.d.projectRef, userId) }
  private recordCleanup(source: Source, path: string) { if (!recordSoilRxCleanup(this.d.storage, this.cleanupKey(source.context.userId), { path, ...source.context, recordedAt: this.d.clock() })) console.warn('Farm Rx could not retain Soil Rx file-cleanup custody on this device.') }
  private async drainCleanup(source: Source) {
    if (this.d.isOffline()) return
    await drainSoilRxCleanupOutbox(this.d.storage, this.cleanupKey(source.context.userId), source.context.userId, source.context.farmId, async (paths) => {
      await verifyQueuedOperationContext(this.d, source.operationContext, source.context)
      const confirmed = await this.d.removeReports(paths, source.operationContext)
      await verifyQueuedOperationContext(this.d, source.operationContext, source.context)
      return confirmed
    })
  }

  async getData(fieldId?: string) {
    const source = await this.source(); const entries = source.queue.read().entries
    try {
      const data = await this.live.getData(fieldId); await verifyQueuedReadContext(this.d, source.operationContext)
      if (!fieldId) await this.retain(source, data)
      await this.drainCleanup(source)
      return this.overlay(data, entries.filter((entry) => !fieldId || entry.draft.field_id === fieldId))
    } catch (error) {
      await verifyQueuedReadContext(this.d, source.operationContext)
      if (!isTransportFailure(error, this.d.isOffline())) throw error
      const cached = this.workspace ?? (await readWorkspaceCache<SoilRxData>(this.cacheScope(source.context), operationalCacheMaxAgeMs))?.data ?? null
      await verifyQueuedReadContext(this.d, source.operationContext)
      if (!cached && !entries.length) throw new Error('Connect to the internet once to load Soil Rx history on this device.')
      const data = cached ?? { tests: [] }
      return this.overlay({ tests: fieldId ? data.tests.filter((test) => test.field_id === fieldId) : data.tests }, entries.filter((entry) => !fieldId || entry.draft.field_id === fieldId))
    }
  }

  async saveTest(draft: SoilTestDraft, report?: File) {
    const source = await this.source()
    const normalized = normalizeSoilTestDraft({ ...draft, id: draft.id ?? this.d.createId() }) as QueuedSoilTestDraft
    const validation = validateSoilTestDraft(normalized); if (validation) throw new Error(validation)
    if (report) {
      const fileError = validateSoilReportFile(report); if (fileError) throw new Error(fileError)
      if (this.d.isOffline()) throw new Error('Connect to the internet to attach a lab report. Text-only Soil Rx records can still save offline.')
      await verifyQueuedOperationContext(this.d, source.operationContext, source.context)
      const saved = await this.live.saveTestOperation(normalized, source.operationContext)
      await verifyQueuedOperationContext(this.d, source.operationContext, source.context)
      const path = await this.d.uploadReport(source.context.farmId, normalized.field_id, normalized.id, report, source.operationContext)
      await verifyQueuedOperationContext(this.d, source.operationContext, source.context)
      try {
        const complete = await this.live.saveAttachmentOperation(saved, { id: this.d.createId(), storagePath: path, originalFilename: report.name.trim(), mimeType: report.type.toLowerCase() as SoilReportMime, sizeBytes: report.size }, source.operationContext)
        await this.retain(source, { tests: sortSoilTestsNewestFirst([...(this.workspace?.tests ?? []).filter((test) => test.id !== complete.id), complete]) })
        return complete
      } catch (error) {
        await verifyQueuedOperationContext(this.d, source.operationContext, source.context)
        try { const confirmed = await this.d.removeReports([path], source.operationContext); if (!confirmed.includes(path)) this.recordCleanup(source, path) } catch { this.recordCleanup(source, path) }
        throw error
      }
    }
    const entry: SoilRxQueueEntryV1 = { version: 1, module: 'soilRx', kind: 'saveTest', operationId: this.d.createId(), userId: source.context.userId, farmId: source.context.farmId, enqueuedAt: this.d.clock(), draft: normalized }
    return queueTransaction(source.queue.key, this.d.storage, this.d.createId, async (verify) => {
      await verifyQueuedOperationContext(this.d, source.operationContext, source.context); verify()
      const enqueue = async () => { source.queue.append(entry); const pending = this.pending(entry); await this.retain(source, { tests: sortSoilTestsNewestFirst([...(this.workspace?.tests ?? []).filter((test) => test.id !== pending.id), pending]) }); return pending }
      if (this.d.isOffline() || source.queue.read().entries.length) { const result = await enqueue(); launchReplayInBackground(() => this.inspectAndReplay()); return result }
      try { const saved = await this.live.saveTestOperation(normalized, source.operationContext); verify(); await verifyQueuedOperationContext(this.d, source.operationContext, source.context); await this.retain(source, { tests: sortSoilTestsNewestFirst([...(this.workspace?.tests ?? []).filter((test) => test.id !== saved.id), saved]) }); return saved }
      catch (error) { await verifyQueuedOperationContext(this.d, source.operationContext, source.context); if (!isTransportFailure(error, this.d.isOffline())) throw error; return enqueue() }
    })
  }

  async inspectAndReplay() {
    const source = await this.source(); if (this.d.isOffline()) return
    await queueTransaction(source.queue.key, this.d.storage, this.d.createId, async (verify) => {
      let envelope = source.queue.read()
      while (envelope.entries.length) {
        const entry = envelope.entries[0]!
        await verifyQueuedOperationContext(this.d, source.operationContext, { userId: entry.userId, farmId: entry.farmId })
        try { const saved = await this.live.saveTestOperation(entry.draft, source.operationContext); verify(); await verifyQueuedOperationContext(this.d, source.operationContext, source.context); envelope = source.queue.removeConfirmedHead(entry.operationId); if (this.workspace) this.workspace = { tests: sortSoilTestsNewestFirst([...this.workspace.tests.filter((test) => test.id !== saved.id), saved]) } }
        catch (error) { await verifyQueuedOperationContext(this.d, source.operationContext, source.context); if (isTransportFailure(error, this.d.isOffline())) return; appendNeedsAttention(this.d.storage, source.queue.key, { id: entry.operationId, module: 'soilRx', createdAt: entry.enqueuedAt, message: attention, entry, reason: 'database_update_required' }); envelope = source.queue.removeConfirmedHead(entry.operationId) }
      }
    })
    await this.drainCleanup(source)
  }
  async deleteTest(id: string) { const source = await this.source(); if (this.d.isOffline()) throw new Error('Connect to the internet to delete a Soil Rx record.'); const result = await this.live.deleteTestOperation(id, source.operationContext); await verifyQueuedOperationContext(this.d, source.operationContext, source.context); if (this.workspace) this.workspace = { tests: this.workspace.tests.filter((test) => test.id !== id) }; return result }
  async getReportUrl(path: string) { const source = await this.source(); if (this.d.isOffline()) throw new Error('Connect to the internet to open this lab report.'); return this.live.getReportUrlOperation(path, source.operationContext) }
  async getNeedsAttentionQueueKey() { return (await this.source()).queue.key }
  async retryNeedsAttention(queueKey: string, operationId: string) { const source = await this.source(); if (source.queue.key !== queueKey) throw new Error('The selected farm changed before this Soil Rx retry could begin.'); const record = readNeedsAttention(this.d.storage, queueKey).find((item) => item.id === operationId); if (!record) return; const entry = parseSoilRxQueue(JSON.stringify({ version: 1, entries: [record.entry] })).entries[0]!; await queueTransaction(queueKey, this.d.storage, this.d.createId, async (verify) => { verify(); source.queue.append(entry); dismissNeedsAttention(this.d.storage, queueKey, operationId) }); await this.inspectAndReplay() }
  async dismissNeedsAttention(queueKey: string, operationId: string) { const source = await this.source(); if (source.queue.key !== queueKey) throw new Error('The selected farm changed before this Soil Rx item could be dismissed.'); dismissNeedsAttention(this.d.storage, queueKey, operationId) }
}
