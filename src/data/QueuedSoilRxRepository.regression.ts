import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { captureFarmRevocationFence, resetFarmGrantFromLive } from './farmRevocationFence'
import { needsAttentionKey, readNeedsAttention } from './needsAttentionStore'
import { queueTransaction } from './queueTransaction'
import { QueuedSoilRxRepository } from './QueuedSoilRxRepository'
import { beginSoilRxAttachmentCustody, readSoilRxAttachmentCustody, readSoilRxCleanupOutbox, recordSoilRxCleanup, replaceSoilRxAttachmentCustody, soilRxCleanupOutboxKey } from './soilRxCleanupOutbox'
import { soilMeasurementKeys, type SoilReportMime, type SoilTest, type SoilTestDraft } from './soilRx'
import { confirmSoilRxReportRemoval, maximumSoilReportBytes, removeSoilRxReportsWithGateway, validateSoilReportFile } from './soilRxStorage'
import { createSoilRxQueueEntry, SoilRxWriteQueue, soilRxWriteQueueKey, type SoilRxQueueEntryPayloadV1, type SoilRxQueueEntryV1 } from './soilRxWriteQueue'
import { getSyncStatus, setModuleSyncStatus } from './syncStatus'
import type { SupabaseSoilRxRepository } from './SupabaseSoilRxRepository'
import type { StorageLike } from './writeQueue'
import { beginWorkspaceCacheInvalidation, getWorkspaceCacheNotices, readWorkspaceCache, readWorkspaceCachePure, shouldDeleteInvalidatedWorkspaceCache } from './workspaceCache'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const userId = uid(1), farmId = uid(2), fieldId = uid(3), testId = uid(4)
const stamp = '2027-01-15T12:00:00.000Z'
assert.equal(shouldDeleteInvalidatedWorkspaceCache(0, 1), true)
assert.equal(shouldDeleteInvalidatedWorkspaceCache(1, 1), false)
assert.equal(shouldDeleteInvalidatedWorkspaceCache(2, 1), false)
assert.equal(shouldDeleteInvalidatedWorkspaceCache('bad', 1), true)
const mutatedDeleteDecision = (cacheCustody: unknown, invalidationCustody: number) => !Number.isSafeInteger(cacheCustody) || Number(cacheCustody) !== invalidationCustody
assert.notEqual(mutatedDeleteDecision(2, 1), shouldDeleteInvalidatedWorkspaceCache(2, 1), 'Conditional delete mutation must change the newer-cache runtime outcome.')
const measurements = Object.fromEntries(soilMeasurementKeys.map((key) => [key, null])) as Pick<SoilTestDraft, typeof soilMeasurementKeys[number]>
const draft = (id = testId): SoilTestDraft => ({ ...measurements, id, field_id: fieldId, sample_date: '2027-01-10', lab_name: 'Midwest Lab' })
const report = new File(['soil-rx'], 'soil.pdf', { type: 'application/pdf' })
const cleanupPath = `${farmId}/${fieldId}/${testId}/${uid(99)}.pdf`

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()
  readonly reads = new Map<string, number>()
  failNextKey: string | null = null
  onSet: ((key: string, value: string) => void) | null = null
  getItem(key: string) { this.reads.set(key, (this.reads.get(key) ?? 0) + 1); return this.values.get(key) ?? null }
  setItem(key: string, value: string) { if (this.failNextKey === key) { this.failNextKey = null; throw new Error('simulated process interruption') }; this.values.set(key, value); this.onSet?.(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

type Mode = 'success' | 'metadata_ambiguous' | 'permanent_save_failure'
function harness(projectRef: string, selectedFarmId = farmId, storage = new MemoryStorage()) {
  const scope = { projectRef, userId, farmId: selectedFarmId }
  resetFarmGrantFromLive(storage, scope, 1, stamp)
  const rows = new Map<string, SoilTest>()
  const attachments = new Map<string, NonNullable<SoilTest['attachment']>>()
  const objects = new Set<string>()
  const savedIds: string[] = []
  let mode: Mode = 'success'
  let offline = false
  let changeEpochAfterUpload = false
  let removeFailure = false
  let terminalAbsenceFailure = false
  let terminalAbsenceChecks = 0
  let rollbackFailure = false
  let nextId = 100
  let contextReadsUntilHook = 0
  let contextReadHook: (() => void) | null = null
  let removeHook: (() => Promise<void>) | null = null
  let getDataHook: (() => Promise<void>) | null = null
  let getDataFailure: Error | null = null
  const toTest = (input: SoilTestDraft): SoilTest => ({ ...input, id: input.id!, farm_id: selectedFarmId, created_by: userId, created_at: stamp, updated_at: stamp, attachment: attachments.get(input.id!) ?? null })
  const live = {
    async getData(field?: string) { const snapshot = [...rows.values()].filter((test) => !field || test.field_id === field); await getDataHook?.(); if (getDataFailure) throw getDataFailure; if (offline) throw new Error('network unavailable'); return { tests: snapshot } },
    async saveTestOperation(input: SoilTestDraft) {
      if (mode === 'permanent_save_failure') throw new Error('validation failed')
      savedIds.push(input.id!)
      const saved = toTest(input); rows.set(saved.id, saved); return saved
    },
    async saveAttachmentOperation(test: SoilTest, input: { id: string; storagePath: string; originalFilename: string; mimeType: SoilReportMime; sizeBytes: number }) {
      const attachment = { id: input.id, farm_id: selectedFarmId, field_id: test.field_id, test_id: test.id, storage_path: input.storagePath, original_filename: input.originalFilename, mime_type: input.mimeType, size_bytes: input.sizeBytes, created_by: userId, created_at: stamp }
      attachments.set(test.id, attachment)
      rows.set(test.id, { ...test, attachment })
      if (mode === 'metadata_ambiguous') throw new Error('metadata response was lost')
      return rows.get(test.id)!
    },
    async rollbackTestOperation(id: string) {
      if (rollbackFailure) throw new Error('row cleanup failed')
      const path = attachments.get(id)?.storage_path
      attachments.delete(id); rows.delete(id)
      return { id, storage_paths: path ? [path] : [] }
    },
    async getReportUrlOperation(path: string) { return `https://signed.invalid/${path}` },
  } as unknown as SupabaseSoilRxRepository
  const repository = new QueuedSoilRxRepository(live, {
    getContext: async () => {
      if (contextReadsUntilHook > 0 && --contextReadsUntilHook === 0) { const hook = contextReadHook; contextReadHook = null; hook?.() }
      return { userId, farmId: selectedFarmId }
    }, projectRef, storage,
    createId: () => uid(nextId++), clock: () => stamp, isOffline: () => offline,
    createReportPath: (farm, field, test) => `${farm}/${field}/${test}/${uid(nextId++)}.pdf`,
    uploadReport: async (path) => { objects.add(path); if (changeEpochAfterUpload) resetFarmGrantFromLive(storage, scope, 2, '2027-01-15T12:01:00.000Z') },
    removeReports: async (paths) => {
      await removeHook?.()
      if (removeFailure) throw new Error('storage cleanup failed')
      for (const path of paths) {
        const test = [...rows.values()].find((candidate) => candidate.id === path.split('/')[2])
        if (!test && objects.has(path)) throw new Error('storage RLS denied cleanup while an orphan object remains')
        if (!test) {
          terminalAbsenceChecks += 1
          if (terminalAbsenceFailure) throw new Error('terminal absence verification failed')
        }
      }
      paths.forEach((path) => objects.delete(path)); return paths
    },
  })
  return {
    storage, scope, rows, attachments, objects, savedIds, repository,
    setMode: (next: Mode) => { mode = next }, setOffline: (next: boolean) => { offline = next },
    setEpochChange: (next: boolean) => { changeEpochAfterUpload = next }, setRemoveFailure: (next: boolean) => { removeFailure = next }, setTerminalAbsenceFailure: (next: boolean) => { terminalAbsenceFailure = next }, getTerminalAbsenceChecks: () => terminalAbsenceChecks, setRollbackFailure: (next: boolean) => { rollbackFailure = next },
    setRemoveHook: (next: (() => Promise<void>) | null) => { removeHook = next },
    setContextReadHook: (reads: number, hook: () => void) => { contextReadsUntilHook = reads; contextReadHook = hook },
    setGetDataHook: (next: (() => Promise<void>) | null) => { getDataHook = next },
    setGetDataFailure: (next: Error | null) => { getDataFailure = next },
  }
}

assert.throws(() => confirmSoilRxReportRemoval([cleanupPath], []), /could not confirm Soil Rx attachment cleanup/)
assert.deepEqual(confirmSoilRxReportRemoval([cleanupPath], [{ name: cleanupPath }]), [cleanupPath])

// Exercise the production removal core across a committed remove whose first
// response is lost. The retry accepts only the exact authoritative absence set.
const removalContext = { projectRef: 'soil-rx-storage-retry', userId, farmId, generation: 1, token: uid(98), serverEpoch: 1 }
const removalObjects = new Set([cleanupPath]); let loseRemovalResponse = true; let absenceChecks = 0
const removalGateway = {
  remove: async (paths: string[]) => { const removed = paths.filter((path) => removalObjects.delete(path)).map((name) => ({ name })); if (loseRemovalResponse) { loseRemovalResponse = false; throw new Error('Storage remove response was lost') }; return removed },
  verifyAbsent: async (paths: string[]) => { absenceChecks += 1; return paths.filter((path) => !removalObjects.has(path)).map((name) => ({ name })) },
}
await assert.rejects(() => removeSoilRxReportsWithGateway([cleanupPath], removalContext, removalGateway), /response was lost/)
assert.deepEqual(await removeSoilRxReportsWithGateway([cleanupPath], removalContext, removalGateway), [cleanupPath])
assert.equal(absenceChecks, 1)

// Only the exact missing-row ownership denial may use the purpose-specific
// terminal verifier. That verifier still has to return the exact receipt.
let terminalChecks = 0
const missingRowOwnership = Object.assign(new Error('soil report path is not owned by the current farm test'), { code: '42501' })
assert.deepEqual(await removeSoilRxReportsWithGateway([cleanupPath], removalContext, {
  remove: async () => [],
  verifyAbsent: async () => { throw missingRowOwnership },
  verifyTerminalAbsence: async (paths, _context, scope) => { terminalChecks += 1; assert.deepEqual(scope, { fieldId, testId }); return paths.map((name) => ({ name })) },
}), [cleanupPath])
assert.equal(terminalChecks, 1)

const otherPath = `${farmId}/${fieldId}/${testId}/${uid(97)}.pdf`
await assert.rejects(() => removeSoilRxReportsWithGateway([cleanupPath], removalContext, { remove: async () => [], verifyAbsent: async () => { throw new Error('unauthorized absence verification') } }), /unauthorized/)
await assert.rejects(() => removeSoilRxReportsWithGateway([cleanupPath], removalContext, { remove: async () => [], verifyAbsent: async () => { throw new Error('absence verification failed') } }), /verification failed/)
let unauthorizedTerminalChecks = 0
await assert.rejects(() => removeSoilRxReportsWithGateway([cleanupPath], removalContext, { remove: async () => [], verifyAbsent: async () => { throw Object.assign(new Error('soil report absence verification requires current farm edit access'), { code: '42501' }) }, verifyTerminalAbsence: async () => { unauthorizedTerminalChecks += 1; return [{ name: cleanupPath }] } }), /edit access/)
assert.equal(unauthorizedTerminalChecks, 0)
await assert.rejects(() => removeSoilRxReportsWithGateway([cleanupPath, otherPath], removalContext, { remove: async () => [], verifyAbsent: async () => { throw missingRowOwnership }, verifyTerminalAbsence: async () => [{ name: cleanupPath }] }), /could not confirm Soil Rx attachment cleanup/)
await assert.rejects(() => removeSoilRxReportsWithGateway([cleanupPath], removalContext, { remove: async () => [], verifyAbsent: async () => { throw missingRowOwnership }, verifyTerminalAbsence: async () => [] }), /could not confirm Soil Rx attachment cleanup/)
await assert.rejects(() => removeSoilRxReportsWithGateway([cleanupPath], removalContext, { remove: async () => [], verifyAbsent: async () => { throw missingRowOwnership }, verifyTerminalAbsence: async () => { throw new Error('terminal verification failed') } }), /terminal verification failed/)
await assert.rejects(() => removeSoilRxReportsWithGateway([cleanupPath, otherPath], removalContext, { remove: async () => [], verifyAbsent: async () => [{ name: cleanupPath }] }), /could not confirm Soil Rx attachment cleanup/)
let malformedReceiptChecks = 0
await assert.rejects(() => removeSoilRxReportsWithGateway([cleanupPath], removalContext, { remove: async () => [{ name: otherPath }], verifyAbsent: async () => { malformedReceiptChecks += 1; return [{ name: cleanupPath }] } }), /could not confirm Soil Rx attachment cleanup/)
assert.equal(malformedReceiptChecks, 0)
let invalidRemovalCalls = 0
const invalidRemovalGateway = { remove: async () => { invalidRemovalCalls += 1; return [] }, verifyAbsent: async () => { invalidRemovalCalls += 1; return [] } }
await assert.rejects(() => removeSoilRxReportsWithGateway([cleanupPath, cleanupPath], removalContext, invalidRemovalGateway), /path changed/)
await assert.rejects(() => removeSoilRxReportsWithGateway([`${uid(500)}/${fieldId}/${testId}/${uid(96)}.pdf`], removalContext, invalidRemovalGateway), /path changed/)
assert.equal(invalidRemovalCalls, 0)

// Two farms for one account share one Soil Rx cleanup envelope. Farm A pauses
// after reading its legacy cleanup while Farm B attempts an attachment save.
// The user-scoped cleanup transaction must keep Farm B out until Farm A has
// persisted its removal, so neither farm can overwrite the other's custody.
{
  const sharedStorage = new MemoryStorage()
  const projectRef = 'soil-rx-cross-farm-cleanup-lock'
  const otherFarmId = uid(12), otherFieldId = uid(13), otherTestId = uid(14)
  const first = harness(projectRef, farmId, sharedStorage)
  const second = harness(projectRef, otherFarmId, sharedStorage)
  const key = soilRxCleanupOutboxKey(projectRef, userId)
  const firstPath = `${farmId}/${fieldId}/${testId}/legacy.pdf`
  assert.equal(recordSoilRxCleanup(sharedStorage, key, { path: firstPath, userId, farmId, recordedAt: stamp }), true)
  let announceRemoval!: () => void, releaseRemoval!: () => void
  const removalEntered = new Promise<void>((resolve) => { announceRemoval = resolve })
  const removalRelease = new Promise<void>((resolve) => { releaseRemoval = resolve })
  first.setRemoveHook(async () => { announceRemoval(); await removalRelease })
  const firstDrain = first.repository.getData()
  await removalEntered
  const secondSave = second.repository.saveTest({ ...draft(otherTestId), field_id: otherFieldId }, report)
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(second.rows.size, 0, 'Another farm entered the shared cleanup mutation while the first farm held its transaction.')
  assert.deepEqual(readSoilRxCleanupOutbox(sharedStorage, key).map((entry) => entry.farmId), [farmId], 'The waiting farm changed the shared cleanup envelope before the holder committed.')
  releaseRemoval()
  await firstDrain
  assert.equal((await secondSave).id, otherTestId)
  assert.deepEqual([...second.rows.keys()], [otherTestId])
  assert.equal(second.objects.size, 1)
  assert.deepEqual(readSoilRxCleanupOutbox(sharedStorage, key), [])
}

// The custody record is written before the provisional Soil row. A permanent
// save failure can therefore leave neither row nor object. A failed terminal
// check must retain custody; the next load drains it only after exact absence
// is authoritatively confirmed.
const preRow = harness('soil-rx-pre-row-save-failure')
preRow.setMode('permanent_save_failure')
preRow.setTerminalAbsenceFailure(true)
await assert.rejects(() => preRow.repository.saveTest(draft(), report), /validation failed/)
const preRowKey = soilRxCleanupOutboxKey(preRow.scope.projectRef, userId)
assert.equal(preRow.rows.size, 0)
assert.equal(preRow.objects.size, 0)
assert.ok(readSoilRxAttachmentCustody(preRow.storage, preRowKey, userId, farmId, testId))
assert.equal(preRow.getTerminalAbsenceChecks(), 1)
preRow.setTerminalAbsenceFailure(false)
preRow.setMode('success')
assert.deepEqual(await preRow.repository.getData(), { tests: [] })
assert.equal(preRow.getTerminalAbsenceChecks(), 2)
assert.equal(readSoilRxAttachmentCustody(preRow.storage, preRowKey, userId, farmId, testId), null)

// An upload followed by an ambiguous metadata failure must roll back both the
// row and object. Retrying the same UI draft ID must produce exactly one row.
const metadata = harness('soil-rx-metadata-failure')
metadata.setMode('metadata_ambiguous')
await assert.rejects(() => metadata.repository.saveTest(draft(), report), /metadata response was lost/)
assert.equal(metadata.rows.size, 0)
assert.equal(metadata.attachments.size, 0)
assert.equal(metadata.objects.size, 0)
assert.equal(readSoilRxAttachmentCustody(metadata.storage, soilRxCleanupOutboxKey(metadata.scope.projectRef, userId), userId, farmId, testId), null)
metadata.setMode('success')
assert.equal((await metadata.repository.saveTest(draft(), report)).id, testId)
assert.deepEqual([...metadata.rows.keys()], [testId])
assert.ok(metadata.savedIds.every((id) => id === testId), 'Every attempt must retain the stable draft ID.')

// Once Storage has returned an exact delete receipt, its durable custody mark
// survives a later row-delete failure so a retry never mistakes an absent
// object for an RLS-filtered successful delete.
const receipt = harness('soil-rx-removal-receipt')
receipt.setMode('metadata_ambiguous')
receipt.setRollbackFailure(true)
await assert.rejects(() => receipt.repository.saveTest(draft(), report), /metadata response was lost/)
const receiptKey = soilRxCleanupOutboxKey(receipt.scope.projectRef, userId)
const receiptCustody = readSoilRxAttachmentCustody(receipt.storage, receiptKey, userId, farmId, testId)
assert.equal(receipt.rows.size, 1)
assert.equal(receipt.objects.size, 0)
assert.deepEqual(receiptCustody?.removedPaths, receiptCustody?.paths)
receipt.setRollbackFailure(false)
receipt.setMode('success')
await receipt.repository.getData()
assert.equal(receipt.rows.size, 0)
assert.equal(readSoilRxAttachmentCustody(receipt.storage, receiptKey, userId, farmId, testId), null)

// If access changes after the upload, cleanup must not run under stale
// authority. Durable custody survives until a matching-context drain. A
// failed Storage delete must retain the Soil row too: that row is the RLS
// authorization for the later retry.
const epoch = harness('soil-rx-epoch-change')
epoch.setEpochChange(true)
await assert.rejects(() => epoch.repository.saveTest(draft(), report), /Access to this farm changed/)
const epochKey = soilRxCleanupOutboxKey(epoch.scope.projectRef, userId)
assert.ok(readSoilRxAttachmentCustody(epoch.storage, epochKey, userId, farmId, testId))
assert.equal(epoch.rows.size, 1)
assert.equal(epoch.objects.size, 1)
epoch.setEpochChange(false)
epoch.setRemoveFailure(true)
await assert.rejects(() => epoch.repository.getData(), /cleanup still needs attention/)
assert.equal(getSyncStatus().kind, 'blocked')
assert.equal(epoch.rows.size, 1)
assert.equal(epoch.objects.size, 1)
assert.ok(readSoilRxAttachmentCustody(epoch.storage, epochKey, userId, farmId, testId))
epoch.setRemoveFailure(false)
await epoch.repository.getData()
assert.equal(epoch.rows.size, 0)
assert.equal(epoch.objects.size, 0)
assert.equal(readSoilRxAttachmentCustody(epoch.storage, epochKey, userId, farmId, testId), null)

// Custody replacement is one verified localStorage write. A simulated process
// interruption cannot erase the old record before the replacement is durable.
const transfer = new MemoryStorage()
const transferKey = soilRxCleanupOutboxKey('soil-rx-transfer', userId)
const oldPath = `${farmId}/${fieldId}/${testId}/${uid(200)}.pdf`
const newPath = `${farmId}/${fieldId}/${testId}/${uid(201)}.pdf`
beginSoilRxAttachmentCustody(transfer, transferKey, { testId, path: oldPath, userId, farmId, recordedAt: stamp })
transfer.failNextKey = transferKey
assert.throws(() => replaceSoilRxAttachmentCustody(transfer, transferKey, { testId, path: newPath, userId, farmId, recordedAt: stamp }), /process interruption/)
assert.deepEqual(readSoilRxAttachmentCustody(transfer, transferKey, userId, farmId, testId)?.paths, [oldPath])

// A failed retry cleanup retains the prior custody record. A later retry can
// idempotently finish cleanup and still save only the stable test ID.
const retry = harness('soil-rx-retry-failure')
const retryKey = soilRxCleanupOutboxKey(retry.scope.projectRef, userId)
const retryOldPath = `${farmId}/${fieldId}/${testId}/${uid(202)}.pdf`
beginSoilRxAttachmentCustody(retry.storage, retryKey, { testId, path: retryOldPath, userId, farmId, recordedAt: stamp })
retry.objects.add(retryOldPath)
retry.rows.set(testId, { ...draft(), id: testId, farm_id: farmId, created_by: userId, created_at: stamp, updated_at: stamp, attachment: null })
retry.setRemoveFailure(true)
await assert.rejects(() => retry.repository.saveTest(draft(), report), /storage cleanup failed/)
assert.deepEqual(readSoilRxAttachmentCustody(retry.storage, retryKey, userId, farmId, testId)?.paths, [retryOldPath])
assert.equal(getSyncStatus().kind, 'blocked')
retry.setRemoveFailure(false)
await retry.repository.saveTest(draft(), report)
assert.deepEqual([...retry.rows.keys()], [testId])
assert.equal(retry.objects.has(retryOldPath), false)
assert.equal(readSoilRxAttachmentCustody(retry.storage, retryKey, userId, farmId, testId), null)

// Text-only offline work must report pending, then park a permanent failure as
// Needs attention with its exact operation-era access context and payload bytes.
async function parkedHarness(projectRef: string, pendingId: string) {
  const queued = harness(projectRef)
  const queueKey = soilRxWriteQueueKey(queued.scope.projectRef, userId, farmId)
  queued.setOffline(true)
  await queued.repository.saveTest(draft(pendingId))
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(getSyncStatus().kind, 'pending')
  queued.setOffline(false); queued.setMode('permanent_save_failure')
  await queued.repository.inspectAndReplay()
  assert.equal(getSyncStatus().kind, 'blocked')
  const parked = readNeedsAttention(queued.storage, queueKey)
  assert.equal(parked.length, 1)
  return { queued, queueKey, record: parked[0]!, entry: parked[0]!.entry as SoilRxQueueEntryV1 }
}
const entryPayload = (entry: SoilRxQueueEntryV1): SoilRxQueueEntryPayloadV1 => {
  const { payloadBytes: _payloadBytes, ...payload } = entry
  return payload
}

const queued = await parkedHarness('soil-rx-offline', uid(300))
await assert.rejects(() => queued.queued.repository.retryNeedsAttention(`${queued.queueKey}:wrong`, queued.record.id), /no longer matches/)
queued.queued.setMode('success')
await queued.queued.repository.retryNeedsAttention(queued.queueKey, queued.record.id)
assert.equal(readNeedsAttention(queued.queued.storage, queued.queueKey).length, 0)
assert.deepEqual([...queued.queued.rows.keys()], [uid(300)])
assert.equal(getSyncStatus().kind, 'synced')

// Corrupt queue bytes must transition to a blocked sync state without a second
// read in the catch path. A second read can throw during app startup and hide
// the recoverable "needs attention" state.
const malformed = harness('soil-rx-malformed-queue')
const malformedQueueKey = soilRxWriteQueueKey(malformed.scope.projectRef, userId, farmId)
malformed.storage.setItem(malformedQueueKey, '{not-json')
await malformed.repository.inspectAndReplay()
assert.equal(getSyncStatus().kind, 'blocked')
assert.equal(malformed.storage.reads.get(malformedQueueKey), 1, 'Malformed Soil Rx queue bytes were re-read while reporting blocked sync.')

function scopedCacheDatabase(storage: MemoryStorage, values: Map<string, unknown>, failDelete = false) {
  const priorIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
  const priorLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const database = {
    objectStoreNames: { contains: (name: string) => name === 'workspaces' },
    transaction: () => {
      const transaction: { oncomplete?: () => void; onerror?: () => void; onabort?: () => void; error?: Error; objectStore: () => { delete: (key: string) => void; get: (key: string) => unknown; put: (value: { key: string }) => void } } = {
        objectStore: () => ({
          delete: (key: string) => queueMicrotask(() => { if (failDelete) { transaction.error = new Error('indexeddb delete failed'); transaction.onerror?.() } else { values.delete(key); transaction.oncomplete?.() } }),
          get: (key: string) => { const request: { result?: unknown; onsuccess?: () => void } = {}; queueMicrotask(() => { request.result = values.get(key); request.onsuccess?.(); queueMicrotask(() => transaction.oncomplete?.()) }); return request },
          put: (value: { key: string }) => queueMicrotask(() => { values.set(value.key, value); transaction.oncomplete?.() }),
        }),
      }
      return transaction
    },
    close: () => undefined,
  }
  const factory = { open: () => { const request: { result?: typeof database; onsuccess?: () => void } = {}; queueMicrotask(() => { request.result = database; request.onsuccess?.() }); return request } }
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: factory })
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  return { restore: () => { if (priorIndexedDb) Object.defineProperty(globalThis, 'indexedDB', priorIndexedDb); else Reflect.deleteProperty(globalThis, 'indexedDB'); if (priorLocalStorage) Object.defineProperty(globalThis, 'localStorage', priorLocalStorage); else Reflect.deleteProperty(globalThis, 'localStorage') } }
}
const cacheKey = (projectRef: string, user: string, farm: string, module = 'soilRx') => `${projectRef}:${user}:${farm}:${module}`
const custodyStorageKey = (scope: string) => `farm-rx-workspace-cache-custody:v1:${scope}`
function heldCacheDatabase(storage: MemoryStorage, values: Map<string, any>) {
  const priorIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB'); const priorLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  let holdNext = false; let held: (() => void) | null = null
  const database = { objectStoreNames: { contains: (name: string) => name === 'workspaces' }, transaction: () => {
    const tx: any = { objectStore: () => ({
      get: (key: string) => { const request: any = {}; const finish = () => { request.result = values.get(key); request.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.()) }; if (holdNext) { holdNext = false; held = finish } else queueMicrotask(finish); return request },
      put: (value: any) => queueMicrotask(() => { values.set(value.key, value); tx.oncomplete?.() }),
      delete: (key: string) => queueMicrotask(() => { values.delete(key); tx.oncomplete?.() }),
    }) }; return tx }, close: () => undefined }
  const factory: any = { databases: async () => [{ name: `farm-rx-offline-v1-held-cache` }], open: () => { const request: any = {}; queueMicrotask(() => { request.result = database; request.onsuccess?.() }); return request } }
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: factory }); Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage })
  return { holdNextGet: () => { holdNext = true }, releaseGet: () => { const next = held; held = null; next?.() }, restore: () => { if (priorIndexedDb) Object.defineProperty(globalThis, 'indexedDB', priorIndexedDb); else Reflect.deleteProperty(globalThis, 'indexedDB'); if (priorLocalStorage) Object.defineProperty(globalThis, 'localStorage', priorLocalStorage); else Reflect.deleteProperty(globalThis, 'localStorage') } }
}
// Hold actual IndexedDB reads after custody capture, advance custody in another
// actor, and ensure neither cache reader returns or publishes stale data.
const heldCacheStorage = new MemoryStorage(); const heldScope = { projectRef: 'held-cache', userId, farmId, module: 'soilRx' }
resetFarmGrantFromLive(heldCacheStorage, heldScope, 1, stamp)
const heldFence = captureFarmRevocationFence(heldCacheStorage, heldScope)
const heldKey = `${heldScope.projectRef}:${heldScope.userId}:${heldScope.farmId}:${heldScope.module}`
const heldValues = new Map<string, any>([[heldKey, { version: 3, key: heldKey, ...heldScope, generation: heldFence.generation, fenceToken: heldFence.token, serverEpoch: heldFence.serverEpoch, cacheCustody: 0, cachedAt: stamp, data: { stale: true } }]])
const heldDatabase = heldCacheDatabase(heldCacheStorage, heldValues)
try {
  heldDatabase.holdNextGet(); const normalRead = readWorkspaceCache<{ stale: boolean }>(heldScope, 9e9); await new Promise<void>(queueMicrotask); await new Promise<void>(queueMicrotask); beginWorkspaceCacheInvalidation(heldCacheStorage, heldScope); heldDatabase.releaseGet(); assert.equal(await normalRead, null, 'Held normal cache read returned after custody advanced.'); assert.equal(getWorkspaceCacheNotices().some((notice) => notice.module === 'soilRx' && notice.cachedAt === stamp), false, 'Held normal cache read published a stale notice.')
  heldCacheStorage.removeItem(custodyStorageKey(heldKey)); heldDatabase.holdNextGet(); const pureRead = readWorkspaceCachePure<{ stale: boolean }>(heldScope, heldFence, 9e9, heldCacheStorage); await new Promise<void>(queueMicrotask); await new Promise<void>(queueMicrotask); beginWorkspaceCacheInvalidation(heldCacheStorage, heldScope); heldDatabase.releaseGet(); assert.equal(await pureRead, null, 'Held pure cache read returned after custody advanced.')
} finally { heldDatabase.restore() }
async function assertReplayDoesNotResurrect(name: string, settle: (value: ReturnType<typeof harness>, key: string) => Promise<void>) {
  const value = harness(`soil-rx-cache-${name}`)
  const key = soilRxWriteQueueKey(value.scope.projectRef, userId, farmId)
  value.setOffline(true); await value.repository.saveTest(draft(uid(600 + name.length)))
  const scoped = cacheKey(value.scope.projectRef, userId, farmId)
  const siblingUser = cacheKey(value.scope.projectRef, uid(601), farmId)
  const siblingFarm = cacheKey(value.scope.projectRef, userId, uid(602))
  const siblingModule = cacheKey(value.scope.projectRef, userId, farmId, 'grain')
  const snapshots = new Map<string, unknown>([[scoped, { stale: 'pending' }], [siblingUser, {}], [siblingFarm, {}], [siblingModule, {}]])
  const database = scopedCacheDatabase(value.storage, snapshots)
  try {
    value.setOffline(false); await settle(value, key)
    assert.equal(snapshots.has(scoped), false, `${name} did not delete the exact Soil Rx offline cache.`)
    assert.ok(snapshots.has(siblingUser) && snapshots.has(siblingFarm) && snapshots.has(siblingModule), `${name} deleted another user, farm, or module cache.`)
    value.setOffline(true)
    await assert.rejects(() => value.repository.getData(), /Connect to the internet once/, `${name} let same-session offline data resurrect a released pending record.`)
  } finally { database.restore() }
}
await assertReplayDoesNotResurrect('success', async (value) => { await value.repository.inspectAndReplay(); assert.equal(new SoilRxWriteQueue(value.storage, soilRxWriteQueueKey(value.scope.projectRef, userId, farmId)).read().entries.length, 0) })
await assertReplayDoesNotResurrect('parked', async (value) => { value.setMode('permanent_save_failure'); await value.repository.inspectAndReplay(); assert.equal(readNeedsAttention(value.storage, soilRxWriteQueueKey(value.scope.projectRef, userId, farmId)).length, 1) })
await assertReplayDoesNotResurrect('dismissed', async (value, key) => { value.setMode('permanent_save_failure'); await value.repository.inspectAndReplay(); const record = readNeedsAttention(value.storage, key)[0]!; await value.repository.dismissNeedsAttention(key, record.id) })

// Once the server upsert returns, a cache deletion failure must not convert that
// confirmed save into a parked failure or issue it again on a later sync.
const failedInvalidation = harness('soil-rx-cache-delete-failure')
const failedInvalidationKey = soilRxWriteQueueKey(failedInvalidation.scope.projectRef, userId, farmId)
failedInvalidation.setOffline(true); await failedInvalidation.repository.saveTest(draft(uid(650)))
const failedCacheScope = cacheKey(failedInvalidation.scope.projectRef, userId, farmId)
const failedCache = scopedCacheDatabase(failedInvalidation.storage, new Map([[failedCacheScope, { stale: 'pending' }]]), true)
try {
  failedInvalidation.setOffline(false); await failedInvalidation.repository.inspectAndReplay()
  assert.equal(failedInvalidation.savedIds.filter((id) => id === uid(650)).length, 1, 'A failed cache deletion reissued the server-confirmed save.')
  assert.equal(new SoilRxWriteQueue(failedInvalidation.storage, failedInvalidationKey).read().entries.length, 0, 'A failed cache deletion retained confirmed write custody for replay.')
  assert.equal(readNeedsAttention(failedInvalidation.storage, failedInvalidationKey).length, 0, 'A failed cache deletion misclassified the confirmed save as a parked failure.')
  assert.equal(failedInvalidation.storage.getItem(custodyStorageKey(failedCacheScope)), '1', 'A failed cache deletion did not retain its fail-closed custody revision.')
  await failedInvalidation.repository.inspectAndReplay()
  assert.equal(failedInvalidation.savedIds.filter((id) => id === uid(650)).length, 1, 'A later sync reissued a save already confirmed before cache cleanup failed.')
  failedInvalidation.setOffline(true)
  await assert.rejects(() => failedInvalidation.repository.getData(), /Connect to the internet once/, 'A failed cache deletion resurrected stale pending state despite its tombstone.')
} finally { failedCache.restore() }

// A live read can start before replay, then resolve after the replay's queue
// release. Its old overlay must not republish after the newer cache custody.
const heldRead = harness('soil-rx-held-live-read')
const heldReadQueueKey = soilRxWriteQueueKey(heldRead.scope.projectRef, userId, farmId)
heldRead.setOffline(true); await heldRead.repository.saveTest(draft(uid(660)))
await new Promise((resolve) => setTimeout(resolve, 25))
const heldReadScope = cacheKey(heldRead.scope.projectRef, userId, farmId)
const heldReadSnapshots = new Map<string, unknown>([[heldReadScope, { stale: 'pending' }]])
const heldReadCache = scopedCacheDatabase(heldRead.storage, heldReadSnapshots)
let releaseHeldRead!: () => void; let sawHeldRead!: () => void
const heldReadStarted = new Promise<void>((resolve) => { sawHeldRead = resolve })
const heldReadRelease = new Promise<void>((resolve) => { releaseHeldRead = resolve })
heldRead.setGetDataHook(async () => { heldRead.setGetDataHook(null); sawHeldRead(); await heldReadRelease })
try {
  heldRead.setOffline(false)
  const staleGetData = heldRead.repository.getData()
  await heldReadStarted
  await heldRead.repository.inspectAndReplay()
  assert.equal(new SoilRxWriteQueue(heldRead.storage, heldReadQueueKey).read().entries.length, 0, 'Held-read replay did not release confirmed queue custody.')
  releaseHeldRead()
  await assert.rejects(() => staleGetData, /cache custody changed/, 'A held pre-replay live response published after replay cache custody changed.')
  assert.equal(heldReadSnapshots.has(heldReadScope), false, 'A held pre-replay live response recreated the released offline cache.')
  assert.equal(heldRead.storage.getItem(custodyStorageKey(heldReadScope)), '1', 'A successful exact cache deletion did not retain its shared custody revision.')
  heldRead.setOffline(true)
  await assert.rejects(() => heldRead.repository.getData(), /Connect to the internet once/, 'A held pre-replay live response resurrected a same-session pending record.')
} finally { heldReadCache.restore() }

// Cache custody is shared across repository instances/tabs. A read held in A
// must not republish after B confirms and releases the same scoped queue.
const sharedTabsStorage = new MemoryStorage()
const sharedTabsA = harness('soil-rx-shared-tabs', farmId, sharedTabsStorage)
const sharedTabsB = harness('soil-rx-shared-tabs', farmId, sharedTabsStorage)
const sharedTabsQueueKey = soilRxWriteQueueKey(sharedTabsA.scope.projectRef, userId, farmId)
sharedTabsA.setOffline(true); await sharedTabsA.repository.saveTest(draft(uid(665)))
await new Promise((resolve) => setTimeout(resolve, 25))
const sharedTabsScope = cacheKey(sharedTabsA.scope.projectRef, userId, farmId)
const sharedTabsSibling = cacheKey(sharedTabsA.scope.projectRef, uid(666), farmId)
const sharedTabsSnapshots = new Map<string, unknown>([[sharedTabsScope, { stale: 'pending' }], [sharedTabsSibling, {}]])
const sharedTabsCache = scopedCacheDatabase(sharedTabsStorage, sharedTabsSnapshots)
let releaseSharedTabsRead!: () => void; let sawSharedTabsRead!: () => void
const sharedTabsReadStarted = new Promise<void>((resolve) => { sawSharedTabsRead = resolve })
const sharedTabsReadRelease = new Promise<void>((resolve) => { releaseSharedTabsRead = resolve })
sharedTabsA.setGetDataHook(async () => { sharedTabsA.setGetDataHook(null); sawSharedTabsRead(); await sharedTabsReadRelease })
try {
  sharedTabsA.setOffline(false); sharedTabsB.setOffline(false)
  const staleTabRead = sharedTabsA.repository.getData()
  await sharedTabsReadStarted
  await sharedTabsB.repository.inspectAndReplay()
  assert.equal(new SoilRxWriteQueue(sharedTabsStorage, sharedTabsQueueKey).read().entries.length, 0, 'Second-tab replay did not release confirmed custody.')
  releaseSharedTabsRead()
  await assert.rejects(() => staleTabRead, /cache custody changed/, 'A stale first-tab read republished after second-tab cache release.')
  assert.equal(sharedTabsSnapshots.has(sharedTabsScope), false, 'A stale first-tab read rewrote the released shared cache.')
  assert.ok(sharedTabsSnapshots.has(sharedTabsSibling), 'A shared-tab release crossed user cache scope.')
  sharedTabsA.setOffline(true)
  await assert.rejects(() => sharedTabsA.repository.getData(), /Connect to the internet once/, 'A retained custody-0 memory snapshot rendered after the second tab advanced custody.')
  sharedTabsA.setOffline(false)
  const freshTabRead = await sharedTabsB.repository.getData()
  assert.equal(freshTabRead.tests[0]?.id, uid(665), 'A fresh post-release read did not publish the confirmed server row.')
  assert.ok(sharedTabsSnapshots.has(sharedTabsScope), 'A fresh post-release read could not repopulate the exact cache.')
  sharedTabsB.setOffline(true)
  const offlineFresh = await sharedTabsB.repository.getData()
  assert.equal(offlineFresh.tests[0]?.pending, undefined, 'Cross-tab offline reopen resurrected a released pending record.')
} finally { sharedTabsCache.restore() }

// The tombstone is written synchronously before a confirmed queue entry can be
// removed. A process interruption after the removal therefore still has a
// durable no-resurrection fence.
const ordering = harness('soil-rx-tombstone-ordering')
const orderingQueueKey = soilRxWriteQueueKey(ordering.scope.projectRef, userId, farmId)
ordering.setOffline(true); await ordering.repository.saveTest(draft(uid(670)))
const orderingScope = cacheKey(ordering.scope.projectRef, userId, farmId)
const orderingCache = scopedCacheDatabase(ordering.storage, new Map([[orderingScope, { stale: 'pending' }]]), true)
let tombstoneSawQueuedEntry = false
ordering.storage.onSet = (key) => {
  if (key === custodyStorageKey(orderingScope)) tombstoneSawQueuedEntry = new SoilRxWriteQueue(ordering.storage, orderingQueueKey).read().entries.length === 1
}
try {
  ordering.setOffline(false); await ordering.repository.inspectAndReplay()
  assert.ok(tombstoneSawQueuedEntry, 'The confirmed queue entry was removed before its durable cache tombstone was written.')
  assert.equal(new SoilRxWriteQueue(ordering.storage, orderingQueueKey).read().entries.length, 0, 'The ordering proof did not release confirmed queue custody.')
  assert.equal(ordering.storage.getItem(custodyStorageKey(orderingScope)), '1', 'The ordering proof lost its custody revision after the forced IndexedDB failure.')
} finally { ordering.storage.onSet = null; orderingCache.restore() }

// If the tombstone write itself fails after the remote upsert, the durable
// confirmed queue state blocks offline rendering and later recovery must skip
// the server call while it finishes cache cleanup.
const tombstoneWriteFailure = harness('soil-rx-tombstone-write-failure')
const tombstoneWriteFailureQueueKey = soilRxWriteQueueKey(tombstoneWriteFailure.scope.projectRef, userId, farmId)
tombstoneWriteFailure.setOffline(true); await tombstoneWriteFailure.repository.saveTest(draft(uid(680)))
await new Promise((resolve) => setTimeout(resolve, 25))
const tombstoneWriteFailureScope = cacheKey(tombstoneWriteFailure.scope.projectRef, userId, farmId)
const tombstoneWriteFailureSnapshots = new Map<string, unknown>([[tombstoneWriteFailureScope, { stale: 'pending' }], [cacheKey(tombstoneWriteFailure.scope.projectRef, uid(681), farmId), {}]])
const tombstoneWriteFailureCache = scopedCacheDatabase(tombstoneWriteFailure.storage, tombstoneWriteFailureSnapshots)
try {
  tombstoneWriteFailure.storage.failNextKey = custodyStorageKey(tombstoneWriteFailureScope)
  tombstoneWriteFailure.setOffline(false); await tombstoneWriteFailure.repository.inspectAndReplay()
  const confirmedHead = new SoilRxWriteQueue(tombstoneWriteFailure.storage, tombstoneWriteFailureQueueKey).read().entries[0]
  assert.equal(tombstoneWriteFailure.savedIds.filter((id) => id === uid(680)).length, 1, 'A tombstone-write failure repeated the confirmed server save.')
  assert.equal(confirmedHead?.confirmed, true, 'A tombstone-write failure did not preserve durable confirmed replay custody.')
  assert.equal(readNeedsAttention(tombstoneWriteFailure.storage, tombstoneWriteFailureQueueKey).length, 0, 'A tombstone-write failure misclassified a confirmed save as Needs Attention.')
  tombstoneWriteFailure.setOffline(true)
  await assert.rejects(() => tombstoneWriteFailure.repository.getData(), /finishing device cleanup/, 'A tombstone-write failure allowed stale pending data to render offline.')
  tombstoneWriteFailure.setOffline(false); await tombstoneWriteFailure.repository.inspectAndReplay()
  assert.equal(tombstoneWriteFailure.savedIds.filter((id) => id === uid(680)).length, 1, 'Recovery after tombstone storage recovered repeated the confirmed server save.')
  assert.equal(new SoilRxWriteQueue(tombstoneWriteFailure.storage, tombstoneWriteFailureQueueKey).read().entries.length, 0, 'Recovery did not release durable confirmed queue custody.')
  assert.equal(tombstoneWriteFailureSnapshots.has(tombstoneWriteFailureScope), false, 'Recovered cleanup did not remove the exact stale cache.')
  assert.ok(tombstoneWriteFailureSnapshots.has(cacheKey(tombstoneWriteFailure.scope.projectRef, uid(681), farmId)), 'Recovered cleanup deleted another user cache.')
} finally { tombstoneWriteFailureCache.restore() }

// A forged durable confirmation is only a recovery hint. With no matching
// server row, replay must still save exactly once instead of dropping custody.
const forgedConfirmed = harness('soil-rx-forged-confirmed')
const forgedConfirmedQueueKey = soilRxWriteQueueKey(forgedConfirmed.scope.projectRef, userId, farmId)
forgedConfirmed.setOffline(true); await forgedConfirmed.repository.saveTest(draft(uid(690)))
await new Promise((resolve) => setTimeout(resolve, 25))
new SoilRxWriteQueue(forgedConfirmed.storage, forgedConfirmedQueueKey).markConfirmedHead(new SoilRxWriteQueue(forgedConfirmed.storage, forgedConfirmedQueueKey).read().entries[0]!.operationId)
forgedConfirmed.setOffline(false); await forgedConfirmed.repository.inspectAndReplay()
assert.equal(forgedConfirmed.savedIds.filter((id) => id === uid(690)).length, 1, 'A forged durable confirmed flag silently skipped its missing server save.')
assert.equal(new SoilRxWriteQueue(forgedConfirmed.storage, forgedConfirmedQueueKey).read().entries.length, 0, 'A forged durable confirmed flag left recoverable queue custody behind.')

// Probe errors are not save failures. They retain active custody and surface a
// blocked retry state without parking or releasing a write that was never sent.
const probeFailure = harness('soil-rx-probe-failure')
const probeFailureQueueKey = soilRxWriteQueueKey(probeFailure.scope.projectRef, userId, farmId)
probeFailure.setOffline(true); await probeFailure.repository.saveTest(draft(uid(691)))
await new Promise((resolve) => setTimeout(resolve, 25))
probeFailure.setGetDataFailure(new Error('probe refused'))
probeFailure.setOffline(false); await probeFailure.repository.inspectAndReplay()
assert.equal(probeFailure.savedIds.filter((id) => id === uid(691)).length, 0, 'A non-transport probe failure called the server save path.')
assert.equal(new SoilRxWriteQueue(probeFailure.storage, probeFailureQueueKey).read().entries.length, 1, 'A non-transport probe failure released active queue custody.')
assert.equal(readNeedsAttention(probeFailure.storage, probeFailureQueueKey).length, 0, 'A non-transport probe failure was misclassified as a permanent save failure.')
assert.equal(getSyncStatus().kind, 'blocked', 'A non-transport probe failure did not surface blocked retry state.')

const dismiss = await parkedHarness('soil-rx-dismiss', uid(301))
await dismiss.queued.repository.dismissNeedsAttention(dismiss.queueKey, dismiss.record.id)
assert.equal(readNeedsAttention(dismiss.queued.storage, dismiss.queueKey).length, 0)
assert.equal(getSyncStatus().kind, 'synced')

// Payload corruption is rejected by the stored canonical byte binding. Retry
// and Dismiss must leave both queue and parked custody byte-stable.
const payloadMismatch = await parkedHarness('soil-rx-payload-mismatch', uid(302))
const payloadEnvelope = JSON.parse(payloadMismatch.queued.storage.getItem(needsAttentionKey(payloadMismatch.queueKey))!)
payloadEnvelope.records[0].entry.draft.lab_name = 'Corrupt payload'
payloadMismatch.queued.storage.setItem(needsAttentionKey(payloadMismatch.queueKey), JSON.stringify(payloadEnvelope))
const payloadQueueBytes = payloadMismatch.queued.storage.getItem(payloadMismatch.queueKey)
const payloadAttentionBytes = payloadMismatch.queued.storage.getItem(needsAttentionKey(payloadMismatch.queueKey))
await assert.rejects(() => payloadMismatch.queued.repository.retryNeedsAttention(payloadMismatch.queueKey, payloadMismatch.record.id), /need attention/)
await assert.rejects(() => payloadMismatch.queued.repository.dismissNeedsAttention(payloadMismatch.queueKey, payloadMismatch.record.id), /need attention/)
assert.equal(payloadMismatch.queued.storage.getItem(payloadMismatch.queueKey), payloadQueueBytes)
assert.equal(payloadMismatch.queued.storage.getItem(needsAttentionKey(payloadMismatch.queueKey)), payloadAttentionBytes)

// Record ID/module plus entry operation/scope/kind must all bind. Each valid or
// controlled-invalid mismatch fails before either local envelope changes.
for (const [name, mutate] of [
  ['record-module', (record: Record<string, unknown>, _entry: SoilRxQueueEntryV1) => { record.module = 'scouting' }],
  ['operation-id', (_record: Record<string, unknown>, entry: SoilRxQueueEntryV1) => createSoilRxQueueEntry({ ...entryPayload(entry), operationId: uid(990) })],
  ['farm-scope', (_record: Record<string, unknown>, entry: SoilRxQueueEntryV1) => createSoilRxQueueEntry({ ...entryPayload(entry), farmId: uid(991), operationContext: { ...entry.operationContext, farmId: uid(991) } })],
  ['kind', (_record: Record<string, unknown>, entry: SoilRxQueueEntryV1) => createSoilRxQueueEntry({ ...entryPayload(entry), kind: 'deleteTest' } as never)],
] as const) {
  const mismatch = await parkedHarness(`soil-rx-${name}`, uid(310 + name.length))
  const envelope = JSON.parse(mismatch.queued.storage.getItem(needsAttentionKey(mismatch.queueKey))!) as { records: Array<Record<string, unknown>> }
  const replacement = mutate(envelope.records[0]!, mismatch.entry)
  if (replacement) envelope.records[0]!.entry = replacement
  mismatch.queued.storage.setItem(needsAttentionKey(mismatch.queueKey), JSON.stringify(envelope))
  const queueBytes = mismatch.queued.storage.getItem(mismatch.queueKey)
  const attentionBytes = mismatch.queued.storage.getItem(needsAttentionKey(mismatch.queueKey))
  await assert.rejects(() => mismatch.queued.repository.retryNeedsAttention(mismatch.queueKey, mismatch.record.id))
  await assert.rejects(() => mismatch.queued.repository.dismissNeedsAttention(mismatch.queueKey, mismatch.record.id))
  assert.equal(mismatch.queued.storage.getItem(mismatch.queueKey), queueBytes, `${name} changed the active queue`)
  assert.equal(mismatch.queued.storage.getItem(needsAttentionKey(mismatch.queueKey)), attentionBytes, `${name} changed parked custody`)
}

// An identical active copy is deduplicated and only the parked copy is
// dismissed before one replay. A conflicting same-ID copy changes nothing.
const identical = await parkedHarness('soil-rx-identical-active', uid(320))
new SoilRxWriteQueue(identical.queued.storage, identical.queueKey).append(identical.entry)
identical.queued.setMode('success')
await identical.queued.repository.retryNeedsAttention(identical.queueKey, identical.record.id)
assert.equal(identical.queued.savedIds.filter((id) => id === identical.entry.draft.id).length, 1)
assert.equal(new SoilRxWriteQueue(identical.queued.storage, identical.queueKey).read().entries.length, 0)
assert.equal(readNeedsAttention(identical.queued.storage, identical.queueKey).length, 0)

const conflict = await parkedHarness('soil-rx-conflicting-active', uid(321))
const conflictingEntry = createSoilRxQueueEntry({ ...entryPayload(conflict.entry), draft: { ...conflict.entry.draft, lab_name: 'Conflicting active payload' } })
new SoilRxWriteQueue(conflict.queued.storage, conflict.queueKey).append(conflictingEntry)
const conflictQueueBytes = conflict.queued.storage.getItem(conflict.queueKey)
const conflictAttentionBytes = conflict.queued.storage.getItem(needsAttentionKey(conflict.queueKey))
await assert.rejects(() => conflict.queued.repository.retryNeedsAttention(conflict.queueKey, conflict.record.id), /no longer matches/)
await assert.rejects(() => conflict.queued.repository.dismissNeedsAttention(conflict.queueKey, conflict.record.id), /no longer matches/)
assert.equal(conflict.queued.storage.getItem(conflict.queueKey), conflictQueueBytes)
assert.equal(conflict.queued.storage.getItem(needsAttentionKey(conflict.queueKey)), conflictAttentionBytes)

// Duplicate parked IDs are ambiguous even when their bytes are identical. A
// conflicting duplicate must never be hidden by validating only the first
// record and then dismissing every record that shares its ID.
for (const [name, duplicate] of [
  ['identical-parked', (entry: SoilRxQueueEntryV1) => entry],
  ['conflicting-parked', (entry: SoilRxQueueEntryV1) => createSoilRxQueueEntry({ ...entryPayload(entry), draft: { ...entry.draft, lab_name: 'Conflicting parked payload' } })],
] as const) {
  const duplicated = await parkedHarness(`soil-rx-${name}`, uid(324 + name.length))
  const attentionKey = needsAttentionKey(duplicated.queueKey)
  const envelope = JSON.parse(duplicated.queued.storage.getItem(attentionKey)!) as { records: Array<Record<string, unknown>> }
  envelope.records.push({ ...envelope.records[0]!, entry: duplicate(duplicated.entry) })
  duplicated.queued.storage.setItem(attentionKey, JSON.stringify(envelope))
  const queueBytes = duplicated.queued.storage.getItem(duplicated.queueKey)
  const attentionBytes = duplicated.queued.storage.getItem(attentionKey)
  await assert.rejects(() => duplicated.queued.repository.retryNeedsAttention(duplicated.queueKey, duplicated.record.id), /no longer matches/)
  assert.equal(duplicated.queued.storage.getItem(duplicated.queueKey), queueBytes, `${name} changed the active queue during Retry`)
  assert.equal(duplicated.queued.storage.getItem(attentionKey), attentionBytes, `${name} changed parked custody during Retry`)
  await assert.rejects(() => duplicated.queued.repository.dismissNeedsAttention(duplicated.queueKey, duplicated.record.id), /no longer matches/)
  assert.equal(duplicated.queued.storage.getItem(duplicated.queueKey), queueBytes, `${name} changed the active queue during Dismiss`)
  assert.equal(duplicated.queued.storage.getItem(attentionKey), attentionBytes, `${name} changed parked custody during Dismiss`)
}

// Same-farm revoke/regrant reuses the queue key but not the captured access
// snapshot. Retry and Dismiss both fail with exact parked bytes retained.
const regrant = await parkedHarness('soil-rx-same-farm-regrant', uid(322))
const regrantQueueBytes = regrant.queued.storage.getItem(regrant.queueKey)
const regrantAttentionBytes = regrant.queued.storage.getItem(needsAttentionKey(regrant.queueKey))
resetFarmGrantFromLive(regrant.queued.storage, regrant.queued.scope, 2, '2027-01-15T12:02:00.000Z')
await assert.rejects(() => regrant.queued.repository.retryNeedsAttention(regrant.queueKey, regrant.record.id), /no longer matches/)
await assert.rejects(() => regrant.queued.repository.dismissNeedsAttention(regrant.queueKey, regrant.record.id), /no longer matches/)
assert.equal(regrant.queued.storage.getItem(regrant.queueKey), regrantQueueBytes)
assert.equal(regrant.queued.storage.getItem(needsAttentionKey(regrant.queueKey)), regrantAttentionBytes)

// A revoke/regrant that lands after source() captured the old operation context
// but on the next context read inside parkedSave's mandatory verification must
// pass the earlier sameOperationContext comparison and then fail at that
// post-capture verification. Retry and Dismiss retain both envelopes byte-for-byte.
for (const [name, invoke] of [
  ['retry', (repository: QueuedSoilRxRepository, queueKey: string, operationId: string) => repository.retryNeedsAttention(queueKey, operationId)],
  ['dismiss', (repository: QueuedSoilRxRepository, queueKey: string, operationId: string) => repository.dismissNeedsAttention(queueKey, operationId)],
] as const) {
  const raced = await parkedHarness(`soil-rx-post-capture-${name}`, uid(340 + name.length))
  const queueBytes = raced.queued.storage.getItem(raced.queueKey)
  const attentionBytes = raced.queued.storage.getItem(needsAttentionKey(raced.queueKey))
  raced.queued.setContextReadHook(2, () => {
    resetFarmGrantFromLive(raced.queued.storage, raced.queued.scope, 2, '2027-01-15T12:03:00.000Z')
  })
  await assert.rejects(() => invoke(raced.queued.repository, raced.queueKey, raced.record.id), /signed-in account or selected farm changed/)
  assert.equal(raced.queued.storage.getItem(raced.queueKey), queueBytes, `${name} changed the active queue across post-capture regrant`)
  assert.equal(raced.queued.storage.getItem(needsAttentionKey(raced.queueKey)), attentionBytes, `${name} changed parked custody across post-capture regrant`)
}

// The repository must wait behind the same real queue transaction used by all
// app writers. While that lock is held, neither Retry nor Dismiss may touch the
// envelopes. After the holder appends a same-ID conflict, the waiting action
// must fail closed and preserve the exact post-conflict bytes.
for (const [name, invoke] of [
  ['retry', (repository: QueuedSoilRxRepository, queueKey: string, operationId: string) => repository.retryNeedsAttention(queueKey, operationId)],
  ['dismiss', (repository: QueuedSoilRxRepository, queueKey: string, operationId: string) => repository.dismissNeedsAttention(queueKey, operationId)],
] as const) {
  const contended = await parkedHarness(`soil-rx-lock-contention-${name}`, uid(350 + name.length))
  const conflictingEntry = createSoilRxQueueEntry({ ...entryPayload(contended.entry), draft: { ...contended.entry.draft, lab_name: `Contended ${name} payload` } })
  const beforeQueueBytes = contended.queued.storage.getItem(contended.queueKey)
  const beforeAttentionBytes = contended.queued.storage.getItem(needsAttentionKey(contended.queueKey))
  let announceLock!: () => void, releaseLock!: () => void
  const lockHeld = new Promise<void>((resolve) => { announceLock = resolve })
  const release = new Promise<void>((resolve) => { releaseLock = resolve })
  let conflictQueueBytes: string | null = null
  let conflictAttentionBytes: string | null = null
  const holder = queueTransaction(contended.queueKey, contended.queued.storage, () => uid(900 + name.length), async (verify) => {
    announceLock(); await release; verify()
    new SoilRxWriteQueue(contended.queued.storage, contended.queueKey).append(conflictingEntry)
    conflictQueueBytes = contended.queued.storage.getItem(contended.queueKey)
    conflictAttentionBytes = contended.queued.storage.getItem(needsAttentionKey(contended.queueKey))
  })
  await lockHeld
  const contender = invoke(contended.queued.repository, contended.queueKey, contended.record.id)
  await new Promise((resolve) => setTimeout(resolve, 25))
  assert.equal(contended.queued.storage.getItem(contended.queueKey), beforeQueueBytes, `${name} bypassed the held queue lock`)
  assert.equal(contended.queued.storage.getItem(needsAttentionKey(contended.queueKey)), beforeAttentionBytes, `${name} changed parked custody while the queue lock was held`)
  releaseLock(); await holder
  await assert.rejects(() => contender, /no longer matches/)
  assert.equal(contended.queued.storage.getItem(contended.queueKey), conflictQueueBytes, `${name} changed the contended active queue`)
  assert.equal(contended.queued.storage.getItem(needsAttentionKey(contended.queueKey)), conflictAttentionBytes, `${name} changed contended parked custody`)
}

// A process interruption after append but before parked dismissal leaves two
// exact custodians. Dismiss refuses to lie; Retry deduplicates and sends once.
const handoff = await parkedHarness('soil-rx-retry-handoff', uid(323))
handoff.queued.setMode('success')
handoff.queued.storage.failNextKey = needsAttentionKey(handoff.queueKey)
await assert.rejects(() => handoff.queued.repository.retryNeedsAttention(handoff.queueKey, handoff.record.id), /process interruption/)
assert.equal(new SoilRxWriteQueue(handoff.queued.storage, handoff.queueKey).read().entries.length, 1)
assert.equal(readNeedsAttention(handoff.queued.storage, handoff.queueKey).length, 1)
await assert.rejects(() => handoff.queued.repository.dismissNeedsAttention(handoff.queueKey, handoff.record.id), /no longer matches/)
await handoff.queued.repository.retryNeedsAttention(handoff.queueKey, handoff.record.id)
assert.equal(handoff.queued.savedIds.filter((id) => id === handoff.entry.draft.id).length, 1)
assert.equal(new SoilRxWriteQueue(handoff.queued.storage, handoff.queueKey).read().entries.length, 0)
assert.equal(readNeedsAttention(handoff.queued.storage, handoff.queueKey).length, 0)

// Picker and service use one validation boundary, including the exact 20 MB
// limit, zero-byte rejection, and the database's 255-character filename cap.
assert.match(validateSoilReportFile(new File([], 'empty.pdf', { type: 'application/pdf' }))!, /larger than 0 bytes and no more than 20 MB/)
assert.equal(validateSoilReportFile({ name: 'exact.pdf', type: 'application/pdf', size: maximumSoilReportBytes }), null)
assert.match(validateSoilReportFile({ name: `${'x'.repeat(252)}.pdf`, type: 'application/pdf', size: 1 })!, /255 characters or fewer/)

// Mutation guard: moving any of these boundaries reintroduces the reviewed
// stranding window. Custody begins before the first remote write, retained UI
// state precedes release, and retry replacement follows completed cleanup.
const source = readFileSync(new URL('./QueuedSoilRxRepository.ts', import.meta.url), 'utf8')
const replayRelease = 'await this.releaseCacheCustody(source, () => { envelope = source.queue.removeConfirmedHead(entry.operationId) })'
function assertReplayCacheGuards(candidate: string) {
  const replayMethod = candidate.slice(candidate.indexOf('async inspectAndReplay()'), candidate.indexOf('async getReportUrl'))
  assert.equal(replayMethod.split(replayRelease).length - 1, 2, 'Both replay custody exits must use the fenced queue-release path.')
  assert.ok(replayMethod.includes('let confirmed = this.confirmedInMemory.get(entry.operationId) === entry.payloadBytes'), 'Replay may skip a current-process confirmation only when operation and payload bytes both match.')
  assert.ok(replayMethod.includes('const current = await this.live.getData()'), 'Durable confirmed custody must prove the exact server row after restart.')
  assert.ok(candidate.includes('cacheCustody: captureWorkspaceCacheCustody(this.d.storage, cacheScope)'), 'A live read must capture shared cache custody with its source.')
  assert.ok(candidate.includes('verifyWorkspaceCacheCustody(this.d.storage, this.cacheScope(source.context), source.cacheCustody)'), 'A live read must compare shared cache custody before and after publication.')
  assert.ok(replayMethod.indexOf('source.queue.markConfirmedHead(entry.operationId)') < replayMethod.lastIndexOf(replayRelease), 'Replay must durably mark confirmation before successful cache-and-queue release.')
  const replayCatch = replayMethod.slice(replayMethod.lastIndexOf('    } catch (error) {'))
  assert.ok(!replayCatch.includes('source.queue.read()'), 'Blocked replay reporting must not re-read malformed queue bytes.')
  const dismissMethod = candidate.slice(candidate.indexOf('async dismissNeedsAttention'), candidate.lastIndexOf('\n}'))
  assert.ok(dismissMethod.includes('await this.releaseCacheCustody(source, () => dismissNeedsAttention(this.d.storage, queueKey, operationId)); verify()'), 'Dismiss must use the fenced cache-and-custody release path.')
  const releaseMethod = candidate.slice(candidate.indexOf('private async releaseCacheCustody'), candidate.indexOf('private pending'))
  assert.ok(releaseMethod.indexOf('beginWorkspaceCacheInvalidation') < releaseMethod.indexOf('releaseQueue()') && releaseMethod.indexOf('releaseQueue()') < releaseMethod.indexOf('await finishInvalidation()'), 'The tombstone must precede queue release, and IndexedDB deletion must follow it.')
}
assertReplayCacheGuards(source)
for (const [name, mutation] of [
  ['replay-cache-invalidation', source.replace(replayRelease, 'await Promise.resolve()')],
  ['replay-malformed-reread', source.replace("pending: 1, message: attention", "pending: source.queue.read().entries.length, message: attention")],
  ['dismiss-cache-invalidation', source.replace('await this.releaseCacheCustody(source, () => dismissNeedsAttention(this.d.storage, queueKey, operationId)); verify()', 'await Promise.resolve()')],
  ['tombstone-after-release', source.replace('const finishInvalidation = beginWorkspaceCacheInvalidation(this.d.storage, this.cacheScope(source.context))\n      releaseQueue()', 'releaseQueue()\n      const finishInvalidation = beginWorkspaceCacheInvalidation(this.d.storage, this.cacheScope(source.context))')],
  ['confirmed-custody-bypass', source.replace('this.confirmedInMemory.get(entry.operationId) === entry.payloadBytes', 'true')],
  ['confirmed-payload-unbound', source.replace('this.confirmedInMemory.get(entry.operationId) === entry.payloadBytes', 'this.confirmedInMemory.has(entry.operationId)')],
  ['shared-custody-bypass', source.replaceAll('verifyWorkspaceCacheCustody(this.d.storage, this.cacheScope(source.context), source.cacheCustody)', 'true')],
] as const) {
  assert.notEqual(mutation, source, `${name} mutation was not applied`)
  assert.throws(() => assertReplayCacheGuards(mutation), `${name} mutation must turn the replay proof red`)
}
const attachmentBranch = source.slice(source.indexOf('if (report) {'), source.indexOf('const entry = createSoilRxQueueEntry'))
assert.ok(attachmentBranch.indexOf('beginSoilRxAttachmentCustody') < attachmentBranch.indexOf('saveTestOperation'))
assert.ok(attachmentBranch.indexOf('cleanAttachmentResources(source, existing') < attachmentBranch.indexOf('replaceSoilRxAttachmentCustody'))
assert.ok(attachmentBranch.lastIndexOf('await this.retain') < attachmentBranch.lastIndexOf('releaseSoilRxAttachmentCustody'))
const cleanupMethod = source.slice(source.indexOf('private async cleanAttachmentResources'), source.indexOf('private async forgetRolledBackTest'))
assert.ok(cleanupMethod.indexOf('removeReports') < cleanupMethod.indexOf('rollbackTestOperation'), 'Storage cleanup must precede deletion of its Soil RLS authorization row')
assert.ok(cleanupMethod.indexOf('confirmSoilRxAttachmentRemoval') < cleanupMethod.indexOf('rollbackTestOperation'), 'Storage receipt must be durable before deleting its Soil RLS authorization row')
const parkedBranch = source.slice(source.indexOf('private async parkedSave'), source.indexOf('\n}', source.indexOf('async dismissNeedsAttention')))
function assertParkedGuards(candidate: string) {
  for (const required of [
    'const records = readNeedsAttention(this.d.storage, source.queue.key).filter((item) => item.id === operationId)',
    'if (records.length !== 1) throw new Error(parkedBlocked)',
    'const recordBytes = JSON.stringify(record)',
    'expectedRecordBytes !== undefined && recordBytes !== expectedRecordBytes',
    "record.id !== operationId || record.module !== 'soilRx'",
    'entry.operationId !== operationId',
    "entry.module !== 'soilRx'",
    "entry.kind !== 'saveTest'",
    'entry.userId !== source.context.userId',
    'entry.farmId !== source.context.farmId',
    'entry.operationContext.projectRef !== this.d.projectRef',
    '!sameOperationContext(entry.operationContext, source.operationContext)',
    'await verifyQueuedOperationContext(this.d, entry.operationContext, entry)',
    'active.length > 1 || (active[0] && !sameEntry(active[0], parked.entry))',
    'active.length !== 1 || !sameEntry(active[0]!, parked.entry)',
    'if (source.queue.read().entries.some((candidate) => candidate.operationId === operationId)) throw new Error(parkedBlocked)',
  ]) assert.ok(candidate.includes(required), `Missing parked-operation guard: ${required}`)
  const retryStart = candidate.indexOf('async retryNeedsAttention')
  const dismissStart = candidate.indexOf('async dismissNeedsAttention')
  assert.ok(retryStart >= 0, 'Retry method is missing')
  assert.ok(dismissStart >= 0, 'Dismiss method is missing')
  assert.ok(retryStart < dismissStart, 'Retry must precede Dismiss')
  const retry = candidate.slice(retryStart, dismissStart)
  const dismiss = candidate.slice(dismissStart)
  const exactParkedRead = 'this.parkedSave(source, queueKey, operationId, parked.recordBytes)'
  const transactionBoundary = 'queueTransaction(queueKey, this.d.storage, this.d.createId, async (verify) => {'
  const conflictGuard = 'if (active.length > 1 || (active[0] && !sameEntry(active[0], parked.entry))) throw new Error(parkedBlocked)'
  const activeReread = 'active = source.queue.read().entries.filter((candidate) => candidate.operationId === operationId)'
  assert.equal(retry.split(transactionBoundary).length - 1, 1)
  assert.equal(dismiss.split(transactionBoundary).length - 1, 1)
  const retryFirstConflictGuard = retry.indexOf(conflictGuard)
  const retryFirstParkedReread = retry.indexOf(exactParkedRead)
  const retryFirstActiveReread = retry.indexOf(activeReread, retryFirstParkedReread + exactParkedRead.length)
  const retrySecondConflictGuard = retry.indexOf(conflictGuard, retryFirstConflictGuard + 1)
  const retryFinalActiveReread = retry.indexOf(activeReread, retryFirstActiveReread + 1)
  const retryIndices = {
    source: retry.indexOf('const source = await this.source()'),
    transaction: retry.indexOf(transactionBoundary),
    initialParked: retry.indexOf('let parked = await this.parkedSave(source, queueKey, operationId)'),
    initialActive: retry.indexOf('let active = source.queue.read().entries.filter((candidate) => candidate.operationId === operationId)'),
    firstConflictGuard: retryFirstConflictGuard,
    firstParkedReread: retryFirstParkedReread,
    firstActiveReread: retryFirstActiveReread,
    secondConflictGuard: retrySecondConflictGuard,
    append: retry.indexOf('if (!active.length) source.queue.append(parked.entry)'),
    finalActiveReread: retryFinalActiveReread,
    finalGuard: retry.indexOf('if (active.length !== 1 || !sameEntry(active[0]!, parked.entry)) throw new Error(parkedBlocked)'),
    finalParkedReread: retry.indexOf(exactParkedRead, retryFirstParkedReread + 1),
    dismiss: retry.indexOf('dismissNeedsAttention(this.d.storage, queueKey, operationId)'),
  }
  const dismissIndices = {
    source: dismiss.indexOf('const source = await this.source()'),
    transaction: dismiss.indexOf(transactionBoundary),
    initialParked: dismiss.indexOf('const parked = await this.parkedSave(source, queueKey, operationId)'),
    initialActive: dismiss.indexOf('const active = source.queue.read().entries.filter((candidate) => candidate.operationId === operationId)'),
    activeGuard: dismiss.indexOf('if (active.length) throw new Error(parkedBlocked)'),
    freshQueueGuard: dismiss.indexOf('if (source.queue.read().entries.some((candidate) => candidate.operationId === operationId)) throw new Error(parkedBlocked)'),
    finalParkedReread: dismiss.indexOf(exactParkedRead),
    dismiss: dismiss.indexOf('dismissNeedsAttention(this.d.storage, queueKey, operationId)'),
  }
  for (const [name, index] of Object.entries(retryIndices)) assert.ok(index >= 0, `Retry ${name} boundary is missing`)
  for (const [name, index] of Object.entries(dismissIndices)) assert.ok(index >= 0, `Dismiss ${name} boundary is missing`)
  const assertStrictOrder = (method: string, indices: Record<string, number>) => {
    const entries = Object.entries(indices)
    for (let index = 1; index < entries.length; index += 1) assert.ok(entries[index - 1]![1] < entries[index]![1], `${method} ${entries[index - 1]![0]} must precede ${entries[index]![0]}`)
  }
  assertStrictOrder('Retry', retryIndices)
  assertStrictOrder('Dismiss', dismissIndices)
}
assertParkedGuards(parkedBranch)
function assertMutationSyntax(name: string, candidate: string) {
  const syntaxErrors = ts.transpileModule(`class ${name.replaceAll('-', '_')} {\n${candidate}\n}`, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  }).diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? []
  assert.equal(syntaxErrors.length, 0, `${name} mutation must remain syntactically valid`)
}
function bypassTransaction(candidate: string, method: 'retry' | 'dismiss') {
  const methodStart = candidate.indexOf(`async ${method}NeedsAttention`)
  const methodEnd = method === 'retry' ? candidate.indexOf('async dismissNeedsAttention', methodStart) : candidate.length
  const original = candidate.slice(methodStart, methodEnd)
  const nextStatement = method === 'retry' ? 'this.refreshSync(source)\n    await this.inspectAndReplay()' : 'this.refreshSync(source)'
  const bypassed = original
    .replace('await queueTransaction(queueKey, this.d.storage, this.d.createId, async (verify) => {', 'await (async (verify: () => void) => {')
    .replace(`    })\n    ${nextStatement}`, `    })(() => undefined)\n    ${nextStatement}`)
  assert.notEqual(bypassed, original, `${method} transaction bypass mutation was not applied`)
  assert.ok(bypassed.includes('await (async (verify: () => void) => {'), `${method} transaction start was not bypassed`)
  assert.ok(bypassed.includes('})(() => undefined)'), `${method} transaction closure was not bypassed`)
  const mutated = candidate.slice(0, methodStart) + bypassed + candidate.slice(methodEnd)
  assertMutationSyntax(`${method}-transaction-bypass`, mutated)
  return mutated
}
assert.throws(() => assertParkedGuards(bypassTransaction(parkedBranch, 'retry')))
assert.throws(() => assertParkedGuards(bypassTransaction(parkedBranch, 'dismiss')))
function mutateMethod(candidate: string, method: 'retry' | 'dismiss', mutate: (methodSource: string) => string) {
  const methodStart = candidate.indexOf(`async ${method}NeedsAttention`)
  const methodEnd = method === 'retry' ? candidate.indexOf('async dismissNeedsAttention', methodStart) : candidate.length
  assert.ok(methodStart >= 0 && methodEnd > methodStart, `${method} mutation method bounds are missing`)
  const original = candidate.slice(methodStart, methodEnd)
  const mutatedMethod = mutate(original)
  assert.notEqual(mutatedMethod, original, `${method} mutation was not applied`)
  return candidate.slice(0, methodStart) + mutatedMethod + candidate.slice(methodEnd)
}
const sourceLine = '    const source = await this.source()\n'
const dismissFreshGuard = '      if (source.queue.read().entries.some((candidate) => candidate.operationId === operationId)) throw new Error(parkedBlocked)\n'
const orderingMutations = [
  ['retry-source-removed', mutateMethod(parkedBranch, 'retry', (method) => method.replace(sourceLine, '    const source = null as never\n'))],
  ['retry-source-moved-after-transaction', mutateMethod(parkedBranch, 'retry', (method) => method.replace(sourceLine, '').replace('    })\n    this.refreshSync(source)', `    })\n${sourceLine}    this.refreshSync(source)`))],
  ['dismiss-source-removed', mutateMethod(parkedBranch, 'dismiss', (method) => method.replace(sourceLine, '    const source = null as never\n'))],
  ['dismiss-source-moved-after-transaction', mutateMethod(parkedBranch, 'dismiss', (method) => method.replace(sourceLine, '').replace('    })\n    this.refreshSync(source)', `    })\n${sourceLine}    this.refreshSync(source)`))],
  ['dismiss-fresh-guard-removed', mutateMethod(parkedBranch, 'dismiss', (method) => method.replace(dismissFreshGuard, ''))],
  ['dismiss-fresh-guard-moved-after-reread', mutateMethod(parkedBranch, 'dismiss', (method) => method.replace(dismissFreshGuard, '').replace('      await this.parkedSave(source, queueKey, operationId, parked.recordBytes); verify()\n', `      await this.parkedSave(source, queueKey, operationId, parked.recordBytes); verify()\n${dismissFreshGuard}`))],
] as const
const expectedOrderingMutations = ['retry-source-removed', 'retry-source-moved-after-transaction', 'dismiss-source-removed', 'dismiss-source-moved-after-transaction', 'dismiss-fresh-guard-removed', 'dismiss-fresh-guard-moved-after-reread']
const executedOrderingMutations: string[] = []
for (const [name, candidate] of orderingMutations) {
  assertMutationSyntax(name, candidate)
  const method = name.startsWith('retry-') ? 'retry' : 'dismiss'
  const methodStart = candidate.indexOf(`async ${method}NeedsAttention`)
  const methodEnd = method === 'retry' ? candidate.indexOf('async dismissNeedsAttention', methodStart) : candidate.length
  assert.ok(methodStart >= 0 && methodEnd > methodStart, `${name} method bounds are missing`)
  const methodSource = candidate.slice(methodStart, methodEnd)
  if (name.endsWith('source-removed')) {
    assert.equal(methodSource.split('const source = await this.source()').length - 1, 0, `${name} must remove source acquisition`)
    assert.ok(methodSource.includes('const source = null as never'), `${name} must remain syntactically valid without source acquisition`)
  } else if (name.includes('source-moved')) {
    const transactionIndex = methodSource.indexOf('queueTransaction(queueKey, this.d.storage, this.d.createId, async (verify) => {')
    const sourceIndex = methodSource.indexOf('const source = await this.source()')
    assert.ok(transactionIndex >= 0, `${name} transaction boundary is missing`)
    assert.ok(sourceIndex >= 0, `${name} moved source acquisition is missing`)
    assert.equal(methodSource.split('const source = await this.source()').length - 1, 1, `${name} must retain exactly one source acquisition`)
    assert.ok(sourceIndex > transactionIndex, `${name} must move source acquisition after the transaction`)
  } else if (name.endsWith('guard-removed')) {
    assert.equal(methodSource.split(dismissFreshGuard.trim()).length - 1, 0, `${name} must remove the fresh queue guard`)
  } else {
    const parkedRereadIndex = methodSource.indexOf('await this.parkedSave(source, queueKey, operationId, parked.recordBytes); verify()')
    const guardIndex = methodSource.indexOf(dismissFreshGuard.trim())
    assert.ok(parkedRereadIndex >= 0, `${name} parked reread is missing`)
    assert.ok(guardIndex >= 0, `${name} moved fresh queue guard is missing`)
    assert.equal(methodSource.split(dismissFreshGuard.trim()).length - 1, 1, `${name} must retain exactly one fresh queue guard`)
    assert.ok(guardIndex > parkedRereadIndex, `${name} must move the fresh queue guard after the parked reread`)
  }
  assert.throws(() => assertParkedGuards(candidate), `${name} must turn the focused proof red`)
  executedOrderingMutations.push(name)
}
assert.equal(orderingMutations.length, 6, 'Exactly six source/fresh-guard ordering mutations are required')
assert.deepEqual(executedOrderingMutations, expectedOrderingMutations)
for (const mutation of [
  ["record.id !== operationId || record.module !== 'soilRx'", 'false'],
  ['records.length !== 1', 'false'],
  ['recordBytes !== expectedRecordBytes', 'false'],
  ['const recordBytes = JSON.stringify(record)', 'const recordBytes = entry.payloadBytes'],
  [', parked.recordBytes', ''],
  ['entry.operationId !== operationId', 'false'],
  ["entry.kind !== 'saveTest'", 'false'],
  ['entry.userId !== source.context.userId', 'false'],
  ['entry.farmId !== source.context.farmId', 'false'],
  ['!sameOperationContext(entry.operationContext, source.operationContext)', 'false'],
  ['await verifyQueuedOperationContext(this.d, entry.operationContext, entry)', 'await Promise.resolve()'],
  ['active.length > 1 || (active[0] && !sameEntry(active[0], parked.entry))', 'false'],
  ['active.length !== 1 || !sameEntry(active[0]!, parked.entry)', 'false'],
] as const) assert.throws(() => assertParkedGuards(parkedBranch.replaceAll(mutation[0], mutation[1])))
setModuleSyncStatus('soilRx', { kind: 'synced', pending: 0 })
console.log('QUEUED_SOIL_RX_REPOSITORY_REGRESSION_PASS')
