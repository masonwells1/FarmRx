import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resetFarmGrantFromLive } from './farmRevocationFence'
import { readNeedsAttention } from './needsAttentionStore'
import { QueuedSoilRxRepository } from './QueuedSoilRxRepository'
import { beginSoilRxAttachmentCustody, readSoilRxAttachmentCustody, replaceSoilRxAttachmentCustody, soilRxCleanupOutboxKey } from './soilRxCleanupOutbox'
import { soilMeasurementKeys, type SoilReportMime, type SoilTest, type SoilTestDraft } from './soilRx'
import { maximumSoilReportBytes, validateSoilReportFile } from './soilRxStorage'
import { soilRxWriteQueueKey } from './soilRxWriteQueue'
import { getSyncStatus, setModuleSyncStatus } from './syncStatus'
import type { SupabaseSoilRxRepository } from './SupabaseSoilRxRepository'
import type { StorageLike } from './writeQueue'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const userId = uid(1), farmId = uid(2), fieldId = uid(3), testId = uid(4)
const stamp = '2027-01-15T12:00:00.000Z'
const measurements = Object.fromEntries(soilMeasurementKeys.map((key) => [key, null])) as Pick<SoilTestDraft, typeof soilMeasurementKeys[number]>
const draft = (id = testId): SoilTestDraft => ({ ...measurements, id, field_id: fieldId, sample_date: '2027-01-10', lab_name: 'Midwest Lab' })
const report = new File(['soil-rx'], 'soil.pdf', { type: 'application/pdf' })

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>()
  failNextKey: string | null = null
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { if (this.failNextKey === key) { this.failNextKey = null; throw new Error('simulated process interruption') }; this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

type Mode = 'success' | 'metadata_ambiguous' | 'permanent_save_failure'
function harness(projectRef: string) {
  const storage = new MemoryStorage()
  const scope = { projectRef, userId, farmId }
  resetFarmGrantFromLive(storage, scope, 1, stamp)
  const rows = new Map<string, SoilTest>()
  const attachments = new Map<string, NonNullable<SoilTest['attachment']>>()
  const objects = new Set<string>()
  const savedIds: string[] = []
  let mode: Mode = 'success'
  let offline = false
  let changeEpochAfterUpload = false
  let removeFailure = false
  let nextId = 100
  const toTest = (input: SoilTestDraft): SoilTest => ({ ...input, id: input.id!, farm_id: farmId, created_by: userId, created_at: stamp, updated_at: stamp, attachment: attachments.get(input.id!) ?? null })
  const live = {
    async getData(field?: string) { return { tests: [...rows.values()].filter((test) => !field || test.field_id === field) } },
    async saveTestOperation(input: SoilTestDraft) {
      if (mode === 'permanent_save_failure') throw new Error('validation failed')
      savedIds.push(input.id!)
      const saved = toTest(input); rows.set(saved.id, saved); return saved
    },
    async saveAttachmentOperation(test: SoilTest, input: { id: string; storagePath: string; originalFilename: string; mimeType: SoilReportMime; sizeBytes: number }) {
      const attachment = { id: input.id, farm_id: farmId, field_id: test.field_id, test_id: test.id, storage_path: input.storagePath, original_filename: input.originalFilename, mime_type: input.mimeType, size_bytes: input.sizeBytes, created_by: userId, created_at: stamp }
      attachments.set(test.id, attachment)
      rows.set(test.id, { ...test, attachment })
      if (mode === 'metadata_ambiguous') throw new Error('metadata response was lost')
      return rows.get(test.id)!
    },
    async rollbackTestOperation(id: string) {
      const path = attachments.get(id)?.storage_path
      attachments.delete(id); rows.delete(id)
      return { id, storage_paths: path ? [path] : [] }
    },
    async getReportUrlOperation(path: string) { return `https://signed.invalid/${path}` },
  } as unknown as SupabaseSoilRxRepository
  const repository = new QueuedSoilRxRepository(live, {
    getContext: async () => ({ userId, farmId }), projectRef, storage,
    createId: () => uid(nextId++), clock: () => stamp, isOffline: () => offline,
    createReportPath: (farm, field, test) => `${farm}/${field}/${test}/${uid(nextId++)}.pdf`,
    uploadReport: async (path) => { objects.add(path); if (changeEpochAfterUpload) resetFarmGrantFromLive(storage, scope, 2, '2027-01-15T12:01:00.000Z') },
    removeReports: async (paths) => { if (removeFailure) throw new Error('storage cleanup failed'); paths.forEach((path) => objects.delete(path)); return paths },
  })
  return {
    storage, scope, rows, attachments, objects, savedIds, repository,
    setMode: (next: Mode) => { mode = next }, setOffline: (next: boolean) => { offline = next },
    setEpochChange: (next: boolean) => { changeEpochAfterUpload = next }, setRemoveFailure: (next: boolean) => { removeFailure = next },
  }
}

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

// If access changes after the upload, cleanup must not run under stale
// authority. Durable custody survives until a matching-context drain.
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
assert.equal(epoch.rows.size, 0)
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
// Needs attention. Retry and dismiss are guarded by the exact queue key.
const queued = harness('soil-rx-offline')
const queueKey = soilRxWriteQueueKey(queued.scope.projectRef, userId, farmId)
queued.setOffline(true)
const pendingId = uid(300)
await queued.repository.saveTest(draft(pendingId))
await new Promise((resolve) => setTimeout(resolve, 100))
assert.equal(getSyncStatus().kind, 'pending')
queued.setOffline(false); queued.setMode('permanent_save_failure')
await queued.repository.inspectAndReplay()
assert.equal(getSyncStatus().kind, 'blocked')
let parked = readNeedsAttention(queued.storage, queueKey)
assert.equal(parked.length, 1)
await assert.rejects(() => queued.repository.retryNeedsAttention(`${queueKey}:wrong`, parked[0]!.id), /selected farm changed/)
queued.setMode('success')
await queued.repository.retryNeedsAttention(queueKey, parked[0]!.id)
assert.equal(readNeedsAttention(queued.storage, queueKey).length, 0)
assert.deepEqual([...queued.rows.keys()], [pendingId])
assert.equal(getSyncStatus().kind, 'synced')

queued.setOffline(true)
await queued.repository.saveTest(draft(uid(301)))
await new Promise((resolve) => setTimeout(resolve, 100))
queued.setOffline(false); queued.setMode('permanent_save_failure')
await queued.repository.inspectAndReplay()
parked = readNeedsAttention(queued.storage, queueKey)
assert.equal(parked.length, 1)
await queued.repository.dismissNeedsAttention(queueKey, parked[0]!.id)
assert.equal(readNeedsAttention(queued.storage, queueKey).length, 0)
assert.equal(getSyncStatus().kind, 'synced')

// Picker and service use one validation boundary, including the exact 20 MB
// limit, zero-byte rejection, and the database's 255-character filename cap.
assert.match(validateSoilReportFile(new File([], 'empty.pdf', { type: 'application/pdf' }))!, /larger than 0 bytes and no more than 20 MB/)
assert.equal(validateSoilReportFile({ name: 'exact.pdf', type: 'application/pdf', size: maximumSoilReportBytes }), null)
assert.match(validateSoilReportFile({ name: `${'x'.repeat(252)}.pdf`, type: 'application/pdf', size: 1 })!, /255 characters or fewer/)

// Mutation guard: moving any of these boundaries reintroduces the reviewed
// stranding window. Custody begins before the first remote write, retained UI
// state precedes release, and retry replacement follows completed cleanup.
const source = readFileSync(new URL('./QueuedSoilRxRepository.ts', import.meta.url), 'utf8')
const attachmentBranch = source.slice(source.indexOf('if (report) {'), source.indexOf('const entry: SoilRxQueueEntryV1'))
assert.ok(attachmentBranch.indexOf('beginSoilRxAttachmentCustody') < attachmentBranch.indexOf('saveTestOperation'))
assert.ok(attachmentBranch.indexOf('cleanAttachmentResources(source, existing') < attachmentBranch.indexOf('replaceSoilRxAttachmentCustody'))
assert.ok(attachmentBranch.lastIndexOf('await this.retain') < attachmentBranch.lastIndexOf('releaseSoilRxAttachmentCustody'))
setModuleSyncStatus('soilRx', { kind: 'synced', pending: 0 })
console.log('QUEUED_SOIL_RX_REPOSITORY_REGRESSION_PASS')
