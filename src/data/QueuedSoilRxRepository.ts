import { isTransportFailure } from './QueuedFieldsRepository'
import { appendNeedsAttention, dismissNeedsAttention, readNeedsAttention, type NeedsAttentionRecord } from './needsAttentionStore'
import { captureQueuedOperationContext, verifyQueuedOperationContext, verifyQueuedReadContext } from './queuedOperationGuard'
import { queueTransaction } from './queueTransaction'
import { beginSoilRxAttachmentCustody, confirmSoilRxAttachmentRemoval, drainSoilRxCleanupOutbox, readSoilRxAttachmentCustody, readSoilRxCleanupOutbox, releaseSoilRxAttachmentCustody, replaceSoilRxAttachmentCustody, soilRxCleanupOutboxKey, soilRxCleanupOutboxTransaction, type SoilRxAttachmentCustodyEntry } from './soilRxCleanupOutbox'
import { createSoilRxQueueEntry, SoilRxWriteQueue, parseSoilRxQueue, soilRxWriteQueueKey, type QueuedSoilTestDraft, type SoilRxQueueEntryV1 } from './soilRxWriteQueue'
import { normalizeSoilTestDraft, soilMeasurementKeys, sortSoilTestsNewestFirst, validateSoilTestDraft, type SoilReportMime, type SoilRxData, type SoilRxRepository, type SoilTest, type SoilTestDraft } from './soilRx'
import { validateSoilReportFile } from './soilRxStorage'
import { setModuleSyncStatus } from './syncStatus'
import type { SupabaseSoilRxRepository } from './SupabaseSoilRxRepository'
import { isFarmReplayContextChangedError, launchReplayInBackground, type StorageLike } from './writeQueue'
import { beginWorkspaceCacheInvalidation, captureWorkspaceCacheFence, operationalCacheMaxAgeMs, readWorkspaceCache, writeWorkspaceCache } from './workspaceCache'
import type { FarmOperationContext } from './farmOperationContext'

type Context = { userId: string; farmId: string }
type Source = { context: Context; operationContext: FarmOperationContext; queue: SoilRxWriteQueue; cacheEpoch: number }
type Dependencies = {
  getContext: () => Promise<Context>
  projectRef: string
  storage: StorageLike
  createId: () => string
  clock: () => string
  isOffline: () => boolean
  createReportPath: (farmId: string, fieldId: string, testId: string, file: File) => string
  uploadReport: (path: string, file: File, context: FarmOperationContext) => Promise<void>
  removeReports: (paths: string[], context: FarmOperationContext) => Promise<string[]>
}
const attention = 'A saved Soil Rx change needs attention. Nothing was deleted.'
const parkedBlocked = 'This saved Soil Rx change no longer matches the signed-in account, farm, or original save. Nothing was changed.'
const sameOperationContext = (left: FarmOperationContext, right: FarmOperationContext) => left.projectRef === right.projectRef && left.userId === right.userId && left.farmId === right.farmId && left.generation === right.generation && left.token === right.token && left.serverEpoch === right.serverEpoch
const sameEntry = (left: SoilRxQueueEntryV1, right: SoilRxQueueEntryV1) => left.payloadBytes === right.payloadBytes

export class QueuedSoilRxRepository implements SoilRxRepository {
  private workspace: SoilRxData | null = null
  private scopeKey: string | null = null
  private cacheEpoch = 0
  private cacheTail: Promise<void> = Promise.resolve()
  private confirmedInMemory = new Set<string>()
  constructor(private readonly live: SupabaseSoilRxRepository, private readonly d: Dependencies) {}

  private async source(): Promise<Source> {
    const operationContext = await captureQueuedOperationContext(this.d)
    const context = { userId: operationContext.userId, farmId: operationContext.farmId }
    const scopeKey = `${context.userId}:${context.farmId}:${operationContext.generation}:${operationContext.token}:${operationContext.serverEpoch}`
    if (this.scopeKey !== scopeKey) { this.workspace = null; this.scopeKey = scopeKey; this.cacheEpoch += 1 }
    return { context, operationContext, queue: new SoilRxWriteQueue(this.d.storage, soilRxWriteQueueKey(this.d.projectRef, context.userId, context.farmId)), cacheEpoch: this.cacheEpoch }
  }
  private cacheScope(context: Context) { return { projectRef: this.d.projectRef, ...context, module: 'soilRx' } }
  private async cacheTransaction<T>(task: () => Promise<T>) { let release!: () => void; const previous = this.cacheTail; this.cacheTail = new Promise<void>((resolve) => { release = resolve }); await previous; try { return await task() } finally { release() } }
  private async retain(source: Source, data: SoilRxData) {
    await this.cacheTransaction(async () => {
      if (source.cacheEpoch !== this.cacheEpoch) throw new Error('Soil Rx cache custody changed while data was loading.')
      this.workspace = data
      await writeWorkspaceCache(this.cacheScope(source.context), data, captureWorkspaceCacheFence(this.cacheScope(source.context)))
    })
    await verifyQueuedReadContext(this.d, source.operationContext)
  }
  private async releaseCacheCustody(source: Source, releaseQueue: () => void) {
    await this.cacheTransaction(async () => {
      this.cacheEpoch += 1
      this.workspace = null
      // This synchronous fence closes the interruption window between a
      // confirmed queue release and IndexedDB deletion.
      const finishInvalidation = beginWorkspaceCacheInvalidation(this.d.storage, this.cacheScope(source.context))
      releaseQueue()
      await finishInvalidation()
    })
  }
  private pending(entry: SoilRxQueueEntryV1): SoilTest { return { ...entry.draft, farm_id: entry.farmId, created_by: entry.userId, created_at: entry.enqueuedAt, updated_at: entry.enqueuedAt, attachment: null, pending: true } }
  private confirmedTest(entry: SoilRxQueueEntryV1, value: SoilTest | undefined) {
    return value !== undefined && value.id === entry.draft.id && value.farm_id === entry.farmId && value.field_id === entry.draft.field_id && value.sample_date === entry.draft.sample_date && value.lab_name === entry.draft.lab_name && value.created_by === entry.userId && soilMeasurementKeys.every((key) => value[key] === entry.draft[key])
  }
  private overlay(data: SoilRxData, entries: SoilRxQueueEntryV1[]) {
    const tests = [...data.tests]
    for (const entry of entries) { const pending = this.pending(entry); const index = tests.findIndex((test) => test.id === pending.id); if (index < 0) tests.push(pending); else tests[index] = pending }
    return { tests: sortSoilTestsNewestFirst(tests) }
  }
  private cleanupKey(userId: string) { return soilRxCleanupOutboxKey(this.d.projectRef, userId) }
  private cleanupLocked<T>(source: Source, verifyQueue: () => void, task: (verify: () => void) => Promise<T>) {
    return soilRxCleanupOutboxTransaction(this.d.storage, this.d.projectRef, source.context.userId, this.d.createId, async (verifyCleanup) => {
      const verify = () => { verifyQueue(); verifyCleanup() }
      verify()
      const result = await task(verify)
      verify()
      return result
    })
  }
  private refreshSync(source: Source) {
    const queued = source.queue.read().entries.length
    const parked = readNeedsAttention(this.d.storage, source.queue.key).length
    const cleanup = readSoilRxCleanupOutbox(this.d.storage, this.cleanupKey(source.context.userId)).filter((entry) => entry.userId === source.context.userId && entry.farmId === source.context.farmId).length
    if (cleanup) setModuleSyncStatus('soilRx', { kind: 'blocked', pending: queued + parked + cleanup, message: `${cleanup} Soil Rx attachment ${cleanup === 1 ? 'cleanup needs' : 'cleanups need'} attention. Retry when connected.` })
    else if (parked) setModuleSyncStatus('soilRx', { kind: 'blocked', pending: queued + parked, message: `${parked} Soil Rx ${parked === 1 ? 'save needs' : 'saves need'} attention.` })
    else if (queued) setModuleSyncStatus('soilRx', { kind: 'pending', pending: queued })
    else setModuleSyncStatus('soilRx', { kind: 'synced', pending: 0 })
  }

  private async cleanAttachmentResources(source: Source, custody: SoilRxAttachmentCustodyEntry, verify: () => void) {
    await verifyQueuedOperationContext(this.d, source.operationContext, source.context)
    // Storage RLS authorizes this delete through the still-existing Soil test.
    // Delete the object first; only then may the cascading test-row delete run.
    const paths = custody.paths.filter((path) => !(custody.removedPaths ?? []).includes(path))
    const confirmed = await this.d.removeReports(paths, source.operationContext)
    verify(); await verifyQueuedOperationContext(this.d, source.operationContext, source.context)
    if (paths.some((path) => !confirmed.includes(path))) throw new Error('Farm Rx could not confirm Soil Rx attachment cleanup. The cleanup remains safely queued.')
    confirmSoilRxAttachmentRemoval(this.d.storage, this.cleanupKey(source.context.userId), custody.userId, custody.farmId, custody.testId, confirmed)
    verify(); await verifyQueuedOperationContext(this.d, source.operationContext, source.context)
    await this.live.rollbackTestOperation(custody.testId, source.operationContext)
    verify(); await verifyQueuedOperationContext(this.d, source.operationContext, source.context)
  }
  private async forgetRolledBackTest(source: Source, testId: string) {
    if (!this.workspace?.tests.some((test) => test.id === testId)) return
    await this.retain(source, { tests: this.workspace.tests.filter((test) => test.id !== testId) })
  }
  private async drainCleanup(source: Source, verify: () => void) {
    if (this.d.isOffline()) return
    const key = this.cleanupKey(source.context.userId)
    const attachmentEntries = readSoilRxCleanupOutbox(this.d.storage, key).filter((entry): entry is SoilRxAttachmentCustodyEntry => entry.kind === 'attachment_save' && entry.userId === source.context.userId && entry.farmId === source.context.farmId)
    for (const custody of attachmentEntries) {
      try {
        await this.cleanAttachmentResources(source, custody, verify)
        await this.forgetRolledBackTest(source, custody.testId)
        verify(); releaseSoilRxAttachmentCustody(this.d.storage, key, custody.userId, custody.farmId, custody.testId)
      } catch (error) {
        if (isFarmReplayContextChangedError(error)) throw error
        this.refreshSync(source)
        throw new Error('A Soil Rx attachment cleanup still needs attention. Retry when connected.')
      }
    }
    await drainSoilRxCleanupOutbox(this.d.storage, key, source.context.userId, source.context.farmId, async (paths) => {
      await verifyQueuedOperationContext(this.d, source.operationContext, source.context)
      const confirmed = await this.d.removeReports(paths, source.operationContext)
      verify(); await verifyQueuedOperationContext(this.d, source.operationContext, source.context)
      return confirmed
    })
    const remaining = readSoilRxCleanupOutbox(this.d.storage, key).some((entry) => entry.userId === source.context.userId && entry.farmId === source.context.farmId)
    if (remaining) { this.refreshSync(source); throw new Error('A Soil Rx attachment cleanup still needs attention. Retry when connected.') }
  }

  async getData(fieldId?: string) {
    const source = await this.source()
    await queueTransaction(source.queue.key, this.d.storage, this.d.createId, async (verify) => {
      await this.cleanupLocked(source, verify, async (verifyCleanup) => { await this.drainCleanup(source, verifyCleanup) })
    })
    const entries = source.queue.read().entries; this.refreshSync(source)
    try {
      const data = await this.live.getData(fieldId); await verifyQueuedReadContext(this.d, source.operationContext)
      if (!fieldId) await this.retain(source, data)
      return this.overlay(data, entries.filter((entry) => !fieldId || entry.draft.field_id === fieldId))
    } catch (error) {
      await verifyQueuedReadContext(this.d, source.operationContext)
      if (!isTransportFailure(error, this.d.isOffline())) throw error
      if (entries.some((entry) => entry.confirmed)) throw new Error('A confirmed Soil Rx save is finishing device cleanup. Connect to finish safely.')
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
      return queueTransaction(source.queue.key, this.d.storage, this.d.createId, async (verifyQueue) => this.cleanupLocked(source, verifyQueue, async (verify) => {
        const custodyKey = this.cleanupKey(source.context.userId)
        const path = this.d.createReportPath(source.context.farmId, normalized.field_id, normalized.id, report)
        const nextCustody = { testId: normalized.id, path, ...source.context, recordedAt: this.d.clock() }
        const existing = readSoilRxAttachmentCustody(this.d.storage, custodyKey, source.context.userId, source.context.farmId, normalized.id)
        if (existing) {
          try { await this.cleanAttachmentResources(source, existing, verify); verify(); replaceSoilRxAttachmentCustody(this.d.storage, custodyKey, nextCustody) }
          catch (error) { this.refreshSync(source); throw error }
        } else { verify(); beginSoilRxAttachmentCustody(this.d.storage, custodyKey, nextCustody) }
        try {
          await verifyQueuedOperationContext(this.d, source.operationContext, source.context)
          const saved = await this.live.saveTestOperation(normalized, source.operationContext)
          verify(); await verifyQueuedOperationContext(this.d, source.operationContext, source.context)
          await this.d.uploadReport(path, report, source.operationContext)
          verify(); await verifyQueuedOperationContext(this.d, source.operationContext, source.context)
          const complete = await this.live.saveAttachmentOperation(saved, { id: this.d.createId(), storagePath: path, originalFilename: report.name.trim(), mimeType: report.type.toLowerCase() as SoilReportMime, sizeBytes: report.size }, source.operationContext)
          verify(); await verifyQueuedOperationContext(this.d, source.operationContext, source.context)
          await this.retain(source, { tests: sortSoilTestsNewestFirst([...(this.workspace?.tests ?? []).filter((test) => test.id !== complete.id), complete]) })
          verify(); releaseSoilRxAttachmentCustody(this.d.storage, custodyKey, source.context.userId, source.context.farmId, normalized.id)
          this.refreshSync(source)
          return complete
        } catch (error) {
          const custody = readSoilRxAttachmentCustody(this.d.storage, custodyKey, source.context.userId, source.context.farmId, normalized.id)
          if (custody) {
            try { await this.cleanAttachmentResources(source, custody, verify); await this.forgetRolledBackTest(source, normalized.id); verify(); releaseSoilRxAttachmentCustody(this.d.storage, custodyKey, source.context.userId, source.context.farmId, normalized.id) }
            catch { this.refreshSync(source); /* durable custody remains for matching-context replay */ }
          }
          throw error
        }
      }))
    }
    const entry = createSoilRxQueueEntry({ version: 1, module: 'soilRx', kind: 'saveTest', operationId: this.d.createId(), userId: source.context.userId, farmId: source.context.farmId, enqueuedAt: this.d.clock(), operationContext: source.operationContext, draft: normalized })
    return queueTransaction(source.queue.key, this.d.storage, this.d.createId, async (verify) => {
      await verifyQueuedOperationContext(this.d, source.operationContext, source.context); verify()
      const enqueue = async () => { const envelope = source.queue.append(entry); setModuleSyncStatus('soilRx', { kind: 'pending', pending: envelope.entries.length }); const pending = this.pending(entry); await this.retain(source, { tests: sortSoilTestsNewestFirst([...(this.workspace?.tests ?? []).filter((test) => test.id !== pending.id), pending]) }); return pending }
      if (this.d.isOffline() || source.queue.read().entries.length) { const result = await enqueue(); launchReplayInBackground(() => this.inspectAndReplay()); return result }
      try { const saved = await this.live.saveTestOperation(normalized, source.operationContext); verify(); await verifyQueuedOperationContext(this.d, source.operationContext, source.context); await this.retain(source, { tests: sortSoilTestsNewestFirst([...(this.workspace?.tests ?? []).filter((test) => test.id !== saved.id), saved]) }); this.refreshSync(source); return saved }
      catch (error) { await verifyQueuedOperationContext(this.d, source.operationContext, source.context); if (!isTransportFailure(error, this.d.isOffline())) throw error; return enqueue() }
    })
  }

  async inspectAndReplay() {
    const source = await this.source()
    try {
      await queueTransaction(source.queue.key, this.d.storage, this.d.createId, async (verify) => {
        await this.cleanupLocked(source, verify, async (verifyCleanup) => { await this.drainCleanup(source, verifyCleanup) })
        let envelope = source.queue.read()
        if (!envelope.entries.length) { this.refreshSync(source); return }
        if (this.d.isOffline()) { setModuleSyncStatus('soilRx', { kind: 'pending', pending: envelope.entries.length }); return }
        while (envelope.entries.length) {
          const entry = envelope.entries[0]!
          await verifyQueuedOperationContext(this.d, entry.operationContext, entry)
          setModuleSyncStatus('soilRx', { kind: 'syncing', pending: envelope.entries.length })
          let confirmed = entry.confirmed === true || this.confirmedInMemory.has(entry.operationId)
          if (!confirmed) {
            try {
              // A durable mark may have been interrupted after the upsert. Probe
              // the ID-bound row first so restart recovery never repeats it.
              const current = await this.live.getData()
              await verifyQueuedOperationContext(this.d, entry.operationContext, entry)
              confirmed = this.confirmedTest(entry, current.tests.find((test) => test.id === entry.draft.id))
              if (!confirmed) await this.live.saveTestOperation(entry.draft, source.operationContext)
            } catch (error) {
              await verifyQueuedOperationContext(this.d, entry.operationContext, entry)
              if (isTransportFailure(error, this.d.isOffline())) { setModuleSyncStatus('soilRx', { kind: 'pending', pending: envelope.entries.length }); return }
              verify(); appendNeedsAttention(this.d.storage, source.queue.key, { id: entry.operationId, module: 'soilRx', createdAt: entry.enqueuedAt, message: attention, entry })
              await this.releaseCacheCustody(source, () => { envelope = source.queue.removeConfirmedHead(entry.operationId) }); verify(); await verifyQueuedOperationContext(this.d, entry.operationContext, entry)
              continue
            }
            this.confirmedInMemory.add(entry.operationId)
            try { envelope = source.queue.markConfirmedHead(entry.operationId) }
            catch (error) {
              // Storage cannot prove confirmed custody yet. Keep this process
              // blocked; the ID-bound probe above protects a later restart.
              this.refreshSync(source)
              throw error
            }
          }
          verify(); await verifyQueuedOperationContext(this.d, entry.operationContext, entry)
          // A completed upsert must leave the queue before best-effort IndexedDB
          // cleanup. The invalidation tombstone still makes a failed deletion
          // fail closed, without reclassifying or replaying the confirmed write.
          await this.releaseCacheCustody(source, () => { envelope = source.queue.removeConfirmedHead(entry.operationId) }); verify(); await verifyQueuedOperationContext(this.d, entry.operationContext, entry)
        }
        this.refreshSync(source)
      })
    } catch (error) {
      if (isFarmReplayContextChangedError(error)) throw error
      // The queue read itself can be what failed (for example malformed durable
      // bytes). Do not re-read it while reporting the blocked state.
      setModuleSyncStatus('soilRx', { kind: 'blocked', pending: 1, message: attention })
    }
  }
  async getReportUrl(path: string) { const source = await this.source(); if (this.d.isOffline()) throw new Error('Connect to the internet to open this lab report.'); return this.live.getReportUrlOperation(path, source.operationContext) }
  async getNeedsAttentionQueueKey() { const source = await this.source(); this.refreshSync(source); return source.queue.key }
  private async parkedSave(source: Source, expectedQueueKey: string, operationId: string, expectedRecordBytes?: string) {
    if (source.queue.key !== expectedQueueKey) throw new Error(parkedBlocked)
    const records = readNeedsAttention(this.d.storage, source.queue.key).filter((item) => item.id === operationId)
    if (records.length !== 1) throw new Error(parkedBlocked)
    const record = records[0] as NeedsAttentionRecord
    const recordBytes = JSON.stringify(record)
    if (expectedRecordBytes !== undefined && recordBytes !== expectedRecordBytes) throw new Error(parkedBlocked)
    if (record.id !== operationId || record.module !== 'soilRx') throw new Error(parkedBlocked)
    const entry = parseSoilRxQueue(JSON.stringify({ version: 1, entries: [record.entry] })).entries[0]!
    if (entry.operationId !== operationId || entry.module !== 'soilRx' || entry.kind !== 'saveTest' || entry.userId !== source.context.userId || entry.farmId !== source.context.farmId || entry.operationContext.projectRef !== this.d.projectRef || record.createdAt !== entry.enqueuedAt || !sameOperationContext(entry.operationContext, source.operationContext)) throw new Error(parkedBlocked)
    await verifyQueuedOperationContext(this.d, entry.operationContext, entry)
    return { entry, record, recordBytes }
  }
  async retryNeedsAttention(queueKey: string, operationId: string) {
    const source = await this.source()
    await queueTransaction(queueKey, this.d.storage, this.d.createId, async (verify) => {
      let parked = await this.parkedSave(source, queueKey, operationId)
      let active = source.queue.read().entries.filter((candidate) => candidate.operationId === operationId)
      if (active.length > 1 || (active[0] && !sameEntry(active[0], parked.entry))) throw new Error(parkedBlocked)
      if (!active.length) {
        parked = await this.parkedSave(source, queueKey, operationId, parked.recordBytes); verify()
        active = source.queue.read().entries.filter((candidate) => candidate.operationId === operationId)
        if (active.length > 1 || (active[0] && !sameEntry(active[0], parked.entry))) throw new Error(parkedBlocked)
        if (!active.length) source.queue.append(parked.entry)
      }
      active = source.queue.read().entries.filter((candidate) => candidate.operationId === operationId)
      if (active.length !== 1 || !sameEntry(active[0]!, parked.entry)) throw new Error(parkedBlocked)
      parked = await this.parkedSave(source, queueKey, operationId, parked.recordBytes); verify()
      dismissNeedsAttention(this.d.storage, queueKey, operationId)
    })
    this.refreshSync(source)
    await this.inspectAndReplay()
  }
  async dismissNeedsAttention(queueKey: string, operationId: string) {
    const source = await this.source()
    await queueTransaction(queueKey, this.d.storage, this.d.createId, async (verify) => {
      const parked = await this.parkedSave(source, queueKey, operationId)
      const active = source.queue.read().entries.filter((candidate) => candidate.operationId === operationId)
      if (active.length) throw new Error(parkedBlocked)
      if (source.queue.read().entries.some((candidate) => candidate.operationId === operationId)) throw new Error(parkedBlocked)
      await this.parkedSave(source, queueKey, operationId, parked.recordBytes); verify()
      await this.releaseCacheCustody(source, () => dismissNeedsAttention(this.d.storage, queueKey, operationId)); verify()
    })
    this.refreshSync(source)
  }
}
