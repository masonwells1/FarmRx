import { strict as assert } from 'node:assert'
import { dismissRevokedFarmRecovery, quarantineRevokedFarmWork, readRevokedFarmRecovery, revokedFarmRecoveryKey } from './revokedFarmRecovery'
import { legacyScoutingCleanupOutboxKey, scoutingCleanupOutboxKey, unownedScoutingCleanupRecoveryKey } from './scoutingCleanupOutbox'
import { captureFarmRevocationFence, resetFarmGrantFromLive, resetFarmRevokedFromLive } from './farmRevocationFence'
import { farmerError } from '../lib/farmerErrors'
import { beginSoilRxAttachmentCustody, confirmSoilRxAttachmentRemoval, isSoilRxStoredCleanupEntry, readSoilRxCleanupOutbox, soilRxCleanupOutboxKey } from './soilRxCleanupOutbox'
import { soilMeasurementKeys } from './soilRx'
import { createSoilRxQueueEntry } from './soilRxWriteQueue'

class MemoryStorage {
  values = new Map<string, string>(); failWrites = false
  get length() { return this.values.size } key(index: number) { return [...this.values.keys()][index] ?? null }
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { if (this.failWrites) throw new Error('quota'); this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}
const project = 'project', user = '00000000-0000-4000-8000-000000000001', farm = '00000000-0000-4000-8000-000000000010', otherFarm = '00000000-0000-4000-8000-000000000020', stamp = '2026-07-15T12:00:00.000Z'
const field = '00000000-0000-4000-8000-000000000011', note = '00000000-0000-4000-8000-000000000012', operation = '00000000-0000-4000-8000-000000000013'
const key = (prefix: string, targetFarm = farm) => `${prefix}:v1:${project}:${user}:${targetFarm}`
const queuePrefixes = ['farm-rx-write-queue', 'farm-rx-field-location-queue', 'farm-rx-field-log-write-queue', 'farm-rx-scouting-write-queue', 'farm-rx-harvest-write-queue', 'farm-rx-inventory-write-queue', 'farm-rx-grain-write-queue', 'farm-rx-profitability-write-queue', 'farm-rx-equipment-tasks-queue', 'farm-rx-notifications-write-queue', 'farm-rx-programs-write-queue', 'farm-rx-soil-rx-write-queue']
const envelope = () => JSON.stringify({ version: 1, entries: [] })
const notificationEntry = (targetFarm = farm) => ({ version: 1, module: 'notifications', kind: 'markRead', operationId: operation, userId: user, farmId: targetFarm, enqueuedAt: stamp, ids: ['00000000-0000-4000-8000-000000000014'] })
const soilEntry = createSoilRxQueueEntry({ version: 1, module: 'soilRx', kind: 'saveTest', operationId: operation, userId: user, farmId: farm, enqueuedAt: stamp, operationContext: { projectRef: project, userId: user, farmId: farm, generation: 1, token: 'soil-rx-recovery-token-0001', serverEpoch: 1 }, draft: { id: note, field_id: field, sample_date: '2026-07-15', lab_name: 'Saved Lab', ...Object.fromEntries(soilMeasurementKeys.map((measurement) => [measurement, null])) } as never })

// Persisted pre-receipt custody has exactly the original six own keys; current
// custody adds only an own removedPaths array. Unknown, inherited, or malformed
// seventh properties must never be mistaken for either shape.
{ const path = `${farm}/${field}/${note}/shape.pdf`; const legacy = { kind: 'attachment_save' as const, testId: note, paths: [path], userId: user, farmId: farm, recordedAt: stamp }; const current = { ...legacy, removedPaths: [path] }
  assert.equal(isSoilRxStoredCleanupEntry(legacy), true); assert.equal(isSoilRxStoredCleanupEntry(current), true)
  assert.equal(isSoilRxStoredCleanupEntry({ ...legacy, unexpected: [] }), false)
  assert.equal(isSoilRxStoredCleanupEntry({ ...legacy, removedPathz: [] }), false)
  assert.equal(isSoilRxStoredCleanupEntry({ ...current, unexpected: [] }), false)
  assert.equal(isSoilRxStoredCleanupEntry({ ...legacy, removedPaths: 'not-an-array' }), false)
  const inherited = Object.create({ removedPaths: [path] }) as Record<string, unknown>; Object.assign(inherited, legacy); assert.equal(isSoilRxStoredCleanupEntry(inherited), false)
  const storage = new MemoryStorage(); const cleanupKey = soilRxCleanupOutboxKey(project, user); storage.setItem(cleanupKey, JSON.stringify({ version: 2, entries: [legacy] })); assert.deepEqual(readSoilRxCleanupOutbox(storage, cleanupKey), [legacy])
}

// Empty revocations are harmless, and a later re-grant has no active queue to replay.
{ const storage = new MemoryStorage(); assert.equal(quarantineRevokedFarmWork(storage, { projectRef: project, userId: user, farmId: farm }, stamp), 0); assert.equal(storage.getItem(revokedFarmRecoveryKey(project, user)), null) }

// Empty envelopes are removed without alarming the user; only actual work is copied first, then removed.
{ const storage = new MemoryStorage(); for (const prefix of queuePrefixes) storage.setItem(key(prefix), envelope()); storage.setItem(key('farm-rx-notifications-write-queue'), JSON.stringify({ version: 1, entries: [notificationEntry()] })); storage.setItem(key('farm-rx-soil-rx-write-queue'), JSON.stringify({ version: 1, entries: [soilEntry] })); storage.setItem(`${key('farm-rx-notifications-write-queue')}:needs-attention`, JSON.stringify({ version: 1, records: [{ id: operation, module: 'notifications', createdAt: stamp, message: 'Review this save.', entry: notificationEntry() }] })); storage.setItem(`${key('farm-rx-grain-write-queue')}:lease`, 'coordination only'); storage.setItem(key('farm-rx-grain-write-queue', otherFarm), envelope())
  storage.setItem(scoutingCleanupOutboxKey(project, user), JSON.stringify({ version: 2, entries: [{ path: `${farm}/${field}/${note}/photo.jpg`, userId: user, farmId: farm, recordedAt: stamp }, { path: `${otherFarm}/${field}/${note}/photo.jpg`, userId: user, farmId: otherFarm, recordedAt: stamp }] }))
  storage.setItem(legacyScoutingCleanupOutboxKey(project), JSON.stringify({ version: 1, entries: [{ path: `${farm}/${field}/${note}/legacy.jpg`, farmId: farm, recordedAt: stamp }] }))
  storage.setItem(soilRxCleanupOutboxKey(project, user), JSON.stringify({ version: 2, entries: [{ kind: 'report_path', path: `${farm}/${field}/${note}/report.pdf`, userId: user, farmId: farm, recordedAt: stamp }, { kind: 'attachment_save', testId: note, paths: [`${farm}/${field}/${note}/custody.pdf`], userId: user, farmId: farm, recordedAt: stamp }, { kind: 'report_path', path: `${otherFarm}/${field}/${note}/report.pdf`, userId: user, farmId: otherFarm, recordedAt: stamp }] }))
  assert.equal(quarantineRevokedFarmWork(storage, { projectRef: project, userId: user, farmId: farm }, stamp), 5)
  for (const prefix of queuePrefixes) assert.equal(storage.getItem(key(prefix)), null)
  assert.equal(storage.getItem(`${key('farm-rx-notifications-write-queue')}:needs-attention`), null); assert.equal(storage.getItem(`${key('farm-rx-grain-write-queue')}:lease`), 'coordination only'); assert.notEqual(storage.getItem(key('farm-rx-grain-write-queue', otherFarm)), null)
  assert.deepEqual(JSON.parse(storage.getItem(scoutingCleanupOutboxKey(project, user))!).entries.map((entry: { farmId: string }) => entry.farmId), [otherFarm])
  const activeSoilCleanup = JSON.parse(storage.getItem(soilRxCleanupOutboxKey(project, user))!); assert.equal(activeSoilCleanup.version, 2); assert.deepEqual(activeSoilCleanup.entries.map((entry: { farmId: string }) => entry.farmId), [otherFarm])
  assert.equal(storage.getItem(legacyScoutingCleanupOutboxKey(project)), null)
  assert.equal(JSON.parse(storage.getItem(unownedScoutingCleanupRecoveryKey(project))!).entries[0].path, `${farm}/${field}/${note}/legacy.jpg`)
  const saved = readRevokedFarmRecovery(storage, project, user); assert.equal(saved.length, 5); assert(saved.every((record) => record.farmId === farm)); assert(saved.every((record) => record.id.length <= 25 && !record.id.includes(JSON.stringify(record.payload)))); assert(saved.some((record) => record.kind === 'needs_attention')); assert(saved.some((record) => record.kind === 'scouting_cleanup')); assert(saved.some((record) => record.kind === 'soil_rx_cleanup' && (record.payload as Array<{ kind?: string }>).some((entry) => entry.kind === 'attachment_save'))); assert(saved.some((record) => record.kind === 'queue' && (record.payload as { entries: Array<{ module: string }> }).entries[0]?.module === 'soilRx'))
  assert.equal(quarantineRevokedFarmWork(storage, { projectRef: project, userId: user, farmId: farm }, stamp), 0); assert.equal(readRevokedFarmRecovery(storage, project, user).length, saved.length)
  dismissRevokedFarmRecovery(storage, project, user, saved[0]!.id); assert.equal(readRevokedFarmRecovery(storage, project, user).length, saved.length - 1)
}

// Pre-repair v1 path cleanup is upgraded during revocation capture rather than
// becoming unreadable or escaping the recovery vault.
{ const storage = new MemoryStorage(); const cleanupKey = soilRxCleanupOutboxKey(project, user); storage.setItem(cleanupKey, JSON.stringify({ version: 1, entries: [{ path: `${farm}/${field}/${note}/legacy-report.pdf`, userId: user, farmId: farm, recordedAt: stamp }] })); assert.equal(quarantineRevokedFarmWork(storage, { projectRef: project, userId: user, farmId: farm }, stamp), 1); assert.deepEqual((readRevokedFarmRecovery(storage, project, user)[0]?.payload as Array<{ kind: string }>).map((entry) => entry.kind), ['report_path']); assert.equal(JSON.parse(storage.getItem(cleanupKey)!).version, 2) }

// Current attachment custody is produced through the real writer. Revocation
// must preserve an already-confirmed Storage removal in the recovery vault.
{ const storage = new MemoryStorage(); const cleanupKey = soilRxCleanupOutboxKey(project, user); const path = `${farm}/${field}/${note}/confirmed-removal.pdf`; beginSoilRxAttachmentCustody(storage, cleanupKey, { testId: note, path, userId: user, farmId: farm, recordedAt: stamp }); confirmSoilRxAttachmentRemoval(storage, cleanupKey, user, farm, note, [path]); assert.equal(quarantineRevokedFarmWork(storage, { projectRef: project, userId: user, farmId: farm }, stamp), 1); const saved = readRevokedFarmRecovery(storage, project, user); assert.equal(saved.length, 1); assert.deepEqual(saved[0]?.payload, [{ kind: 'attachment_save', testId: note, paths: [path], removedPaths: [path], userId: user, farmId: farm, recordedAt: stamp }]); assert.deepEqual(JSON.parse(storage.getItem(cleanupKey)!).entries, []) }

// A failed durable write is fail-closed: active work stays in place and no new access snapshot may be published by the caller.
{ const storage = new MemoryStorage(); const active = key('farm-rx-notifications-write-queue'); const work = JSON.stringify({ version: 1, entries: [notificationEntry()] }); storage.setItem(active, work); storage.failWrites = true; assert.throws(() => quarantineRevokedFarmWork(storage, { projectRef: project, userId: user, farmId: farm }, stamp)); assert.equal(storage.getItem(active), work) }

// A queue whose contents do not match its scoped key is corrupt and stays active for manual recovery.
{ const storage = new MemoryStorage(); const active = key('farm-rx-notifications-write-queue'); storage.setItem(active, JSON.stringify({ version: 1, entries: [notificationEntry(otherFarm)] })); assert.throws(() => quarantineRevokedFarmWork(storage, { projectRef: project, userId: user, farmId: farm }, stamp), (caught) => { assert.equal(farmerError(caught, 'open your farm'), 'Farm Rx found unreadable or mismatched saved work for a farm you can no longer open. Nothing was cleared.'); return true }); assert.notEqual(storage.getItem(active), null); assert.equal(storage.getItem(revokedFarmRecoveryKey(project, user)), null) }

// A valid v2 Field Log entry is captured with its pre-revocation fence, while
// changed or foreign custody remains byte-stable and never becomes recovery.
{ const storage = new MemoryStorage(); const scope = { projectRef: project, userId: user, farmId: farm }; const active = key('farm-rx-field-log-write-queue'); resetFarmGrantFromLive(storage, scope, 1, stamp); const priorFence = captureFarmRevocationFence(storage, scope); const entry = { version: 2 as const, module: 'fieldLog' as const, kind: 'saveEntry' as const, operationId: operation, userId: user, farmId: farm, enqueuedAt: stamp, operationContext: priorFence, draft: { id: note, field_id: field, entry_type: 'note', observed_on: '2026-07-15', rainfall_in: null, note: 'Saved before access removal' } }; const bytes = JSON.stringify({ version: 1, entries: [entry] }); storage.setItem(active, bytes); resetFarmRevokedFromLive(storage, scope, 1, stamp); assert.equal(quarantineRevokedFarmWork(storage, scope, stamp, priorFence), 1); assert.equal(storage.getItem(active), null); assert.equal(JSON.stringify(readRevokedFarmRecovery(storage, project, user)[0]?.payload), bytes)
  const invalidStorage = new MemoryStorage(); resetFarmGrantFromLive(invalidStorage, scope, 1, stamp); const invalidPriorFence = captureFarmRevocationFence(invalidStorage, scope); const invalidBytes = JSON.stringify({ version: 1, entries: [{ ...entry, operationContext: { ...invalidPriorFence, generation: invalidPriorFence.generation + 1 } }] }); invalidStorage.setItem(active, invalidBytes); resetFarmRevokedFromLive(invalidStorage, scope, 1, stamp); assert.throws(() => quarantineRevokedFarmWork(invalidStorage, scope, stamp, invalidPriorFence)); assert.equal(invalidStorage.getItem(active), invalidBytes); assert.equal(invalidStorage.getItem(revokedFarmRecoveryKey(project, user)), null)
  const foreignStorage = new MemoryStorage(); resetFarmGrantFromLive(foreignStorage, scope, 1, stamp); const foreignPriorFence = captureFarmRevocationFence(foreignStorage, scope); const foreignBytes = JSON.stringify({ version: 1, entries: [{ ...entry, operationContext: { ...foreignPriorFence, projectRef: 'other-project' } }] }); foreignStorage.setItem(active, foreignBytes); resetFarmRevokedFromLive(foreignStorage, scope, 1, stamp); assert.throws(() => quarantineRevokedFarmWork(foreignStorage, scope, stamp, foreignPriorFence)); assert.equal(foreignStorage.getItem(active), foreignBytes); assert.equal(foreignStorage.getItem(revokedFarmRecoveryKey(project, user)), null)
}

// Recovery belongs to exactly one project/user and is never a live queue.
{ const storage = new MemoryStorage(); storage.setItem(key('farm-rx-write-queue'), envelope()); quarantineRevokedFarmWork(storage, { projectRef: project, userId: user, farmId: farm }, stamp); assert.equal(readRevokedFarmRecovery(storage, project, 'user-b').length, 0); assert.equal(readRevokedFarmRecovery(storage, 'other-project', user).length, 0); assert.equal(storage.getItem(key('farm-rx-write-queue')), null) }

console.log('revokedFarmRecovery regression passed')
