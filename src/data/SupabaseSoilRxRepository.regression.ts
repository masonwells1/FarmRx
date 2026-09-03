import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import type { FarmOperationContext } from './farmOperationContext'
import { MockSoilRxRepository } from './MockSoilRxRepository'
import type { SoilRxDataGateway } from './SoilRxDataGateway'
import { readSoilRxCleanupOutbox, recordSoilRxCleanup, soilRxCleanupOutboxKey } from './soilRxCleanupOutbox'
import { soilMeasurementKeys, type SoilTestDraft } from './soilRx'
import { createSoilRxQueueEntry, parseSoilRxQueue, SoilRxWriteQueue, soilRxWriteQueueKey } from './soilRxWriteQueue'
import { SupabaseSoilRxRepository, mapSoilTest } from './SupabaseSoilRxRepository'
import type { StorageLike } from './writeQueue'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const farm = uid(1), field = uid(2), user = uid(3), testId = uid(4), operation = uid(5)
const stamp = '2027-01-15T12:00:00.000Z'
const measurements = Object.fromEntries(soilMeasurementKeys.map((key) => [key, null])) as Pick<SoilTestDraft, typeof soilMeasurementKeys[number]>
const draft: SoilTestDraft = { ...measurements, id: testId, field_id: field, sample_date: '2027-01-10', lab_name: 'Midwest Lab' }
const context: FarmOperationContext = { projectRef: 'test-project', userId: user, farmId: farm, generation: 1, token: 'fence-token-0001', serverEpoch: 2 }
const row = (overrides: Record<string, unknown> = {}) => ({ id: testId, farm_id: farm, field_id: field, sample_date: '2027-01-10', lab_name: 'Midwest Lab', ...measurements, created_by: user, created_at: stamp, updated_at: stamp, ...overrides })
class MemoryStorage implements StorageLike { private data = new Map<string, string>(); getItem(key: string) { return this.data.get(key) ?? null } setItem(key: string, value: string) { this.data.set(key, value) } removeItem(key: string) { this.data.delete(key) } }
class Gateway implements SoilRxDataGateway {
  tests: unknown[] = [row()]; attachments: unknown[] = []; saved: unknown = row(); attachmentSaved: unknown = null; deleteResult: unknown[] = [{ id: testId }]; deletes = 0; deleteResponseLosses = 0; canEdit = true; absenceError = false; absenceChecks: Array<{ farmId: string; testId: string; context: FarmOperationContext }> = []
  async loadTests() { return this.tests }
  async loadAttachments() { return this.attachments }
  async saveTest() { return this.saved }
  async saveAttachment() { return this.attachmentSaved }
  async deleteTest(input: { farmId: string; testId: string }) { this.deletes += 1; if (this.deleteResponseLosses > 0) { this.deleteResponseLosses -= 1; this.tests = this.tests.filter((value) => { const candidate = value as { id?: unknown; farm_id?: unknown }; return candidate.id !== input.testId || candidate.farm_id !== input.farmId }); this.attachments = this.attachments.filter((value) => (value as { test_id?: unknown }).test_id !== input.testId); throw new Error('delete response was lost') }; return this.deleteResult }
  async verifyTestAbsent(input: { farmId: string; testId: string }, operationContext: FarmOperationContext) { this.absenceChecks.push({ ...input, context: operationContext }); if (this.absenceError) throw new Error('absence verification failed'); if (!this.canEdit) throw new Error('unauthorized absence verification'); return !this.tests.some((value) => { const candidate = value as { id?: unknown; farm_id?: unknown }; return candidate.id === input.testId && candidate.farm_id === input.farmId }) }
}
const gateway = new Gateway()
const repository = new SupabaseSoilRxRepository({ gateway, getFarmId: async () => farm, getOperationContext: async () => context, verifyOperationContext: async (expected) => assert.deepEqual(expected, context), createId: () => operation, createReportUrl: async () => 'https://signed.invalid/report' })

const loaded = await repository.getData()
assert.equal(loaded.tests.length, 1)
assert.equal(loaded.tests[0]?.lab_name, 'Midwest Lab')
assert.equal(loaded.tests[0]?.ph, null)
assert.equal((await repository.saveTest(draft)).id, testId)
assert.throws(() => mapSoilTest({ ...row(), unexpected: true }), /invalid Soil Rx data/)
assert.throws(() => mapSoilTest(row({ farm_id: uid(99) }), null, { farmId: farm }), /invalid Soil Rx data/)

const attachmentId = uid(6); const path = `${farm}/${field}/${testId}/${uid(7)}.pdf`
gateway.attachmentSaved = { id: attachmentId, farm_id: farm, field_id: field, test_id: testId, storage_path: path, original_filename: 'soil.pdf', mime_type: 'application/pdf', size_bytes: 1024, created_by: user, created_at: stamp }
const attached = await repository.saveAttachmentOperation(loaded.tests[0]!, { id: attachmentId, storagePath: path, originalFilename: 'soil.pdf', mimeType: 'application/pdf', sizeBytes: 1024 }, context)
assert.equal(attached.attachment?.storage_path, path)
gateway.attachments = [gateway.attachmentSaved]
assert.deepEqual(await repository.rollbackTestOperation(testId, context), { id: testId })
assert.equal(gateway.deletes, 1)
gateway.deleteResult = []
gateway.tests = [row()]
await assert.rejects(() => repository.rollbackTestOperation(testId, context), /invalid Soil Rx data/)

// A committed DELETE with a lost response is recoverable only through the
// authenticated physical postcondition check for this exact farm and test.
gateway.tests = [row()]; gateway.attachments = []; gateway.deleteResponseLosses = 1
await assert.rejects(() => repository.rollbackTestOperation(testId, context), /delete response was lost/)
assert.deepEqual(await repository.rollbackTestOperation(testId, context), { id: testId })
assert.deepEqual(gateway.absenceChecks.at(-1), { farmId: farm, testId, context })

// Empty RLS-filtered results, stale authority, and verification failures are
// never accepted as absence.
gateway.tests = []; gateway.canEdit = false
await assert.rejects(() => repository.rollbackTestOperation(testId, context), /unauthorized absence verification/)
gateway.canEdit = true; gateway.absenceError = true
await assert.rejects(() => repository.rollbackTestOperation(testId, context), /absence verification failed/)
gateway.absenceError = false; gateway.tests = [row()]
await assert.rejects(() => repository.rollbackTestOperation(testId, context), /invalid Soil Rx data/)

const queueStorage = new MemoryStorage(); const queueKey = soilRxWriteQueueKey('test-project', user, farm); const queue = new SoilRxWriteQueue(queueStorage, queueKey)
const entry = createSoilRxQueueEntry({ version: 1, module: 'soilRx', kind: 'saveTest', operationId: operation, userId: user, farmId: farm, enqueuedAt: stamp, operationContext: context, draft: draft as SoilTestDraft & { id: string } })
queue.append(entry); assert.equal(queue.read().entries[0]?.draft.id, testId); queue.removeConfirmedHead(operation); assert.equal(queue.read().entries.length, 0)
assert.throws(() => parseSoilRxQueue(JSON.stringify({ version: 1, entries: [{ ...entry, farmId: 'wrong' }] })), /need attention/)
assert.throws(() => parseSoilRxQueue(JSON.stringify({ version: 1, entries: [{ ...entry, draft: { ...entry.draft, lab_name: 'Changed without byte binding' } }] })), /need attention/)

const cleanupKey = soilRxCleanupOutboxKey('test-project', user)
assert.equal(recordSoilRxCleanup(queueStorage, cleanupKey, { path, userId: user, farmId: farm, recordedAt: stamp }), true)
const cleanup = readSoilRxCleanupOutbox(queueStorage, cleanupKey)[0]
assert.equal(cleanup?.kind, 'report_path')
assert.equal(cleanup?.kind === 'report_path' ? cleanup.path : null, path)

const mockStorage = new MemoryStorage(); mockStorage.setItem('unrelated', 'keep-byte-for-byte')
const mock = new MockSoilRxRepository({ storage: mockStorage, key: 'soil-rx-mock', farmId: farm, userId: user, createId: () => testId, clock: () => stamp })
assert.equal((await mock.saveTest({ ...draft, id: undefined })).id, testId)
assert.equal((await mock.getData(field)).tests.length, 1)
assert.equal(mockStorage.getItem('unrelated'), 'keep-byte-for-byte')

const migration = readFileSync(new URL('../../supabase/migrations/20260810223508_soil_rx_storage.sql', import.meta.url), 'utf8')
for (const required of ['create table public.soil_tests', 'foreign key (field_id, farm_id)', 'create policy soil_tests_select', 'public.can_access_farm(farm_id)', 'create policy soil_tests_update', 'using (public.can_edit_farm(farm_id))', 'with check (public.can_edit_farm(farm_id))', "'soil-test-reports'", '20971520', "'application/pdf'", "'image/heic'", "t.field_id::text = split_part(name, '/', 2)", "t.id::text = split_part(name, '/', 3)"]) assert.ok(migration.includes(required), `Migration is missing: ${required}`)
assert.equal(/create\s+(?:table|function|view)\s+storage\./i.test(migration), false, 'Migration must not create custom Storage-schema objects.')
console.log('SOIL_RX_REPOSITORY_REGRESSION_PASS')
