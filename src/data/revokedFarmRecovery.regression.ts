import { strict as assert } from 'node:assert'
import { dismissRevokedFarmRecovery, quarantineRevokedFarmWork, readRevokedFarmRecovery, revokedFarmRecoveryKey } from './revokedFarmRecovery'
import { legacyScoutingCleanupOutboxKey, scoutingCleanupOutboxKey, unownedScoutingCleanupRecoveryKey } from './scoutingCleanupOutbox'

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
const queuePrefixes = ['farm-rx-write-queue', 'farm-rx-field-location-queue', 'farm-rx-field-log-write-queue', 'farm-rx-scouting-write-queue', 'farm-rx-harvest-write-queue', 'farm-rx-inventory-write-queue', 'farm-rx-grain-write-queue', 'farm-rx-profitability-write-queue', 'farm-rx-equipment-tasks-queue', 'farm-rx-notifications-write-queue', 'farm-rx-programs-write-queue']
const envelope = () => JSON.stringify({ version: 1, entries: [] })
const notificationEntry = (targetFarm = farm) => ({ version: 1, module: 'notifications', kind: 'markRead', operationId: operation, userId: user, farmId: targetFarm, enqueuedAt: stamp, ids: ['00000000-0000-4000-8000-000000000014'] })

// Empty revocations are harmless, and a later re-grant has no active queue to replay.
{ const storage = new MemoryStorage(); assert.equal(quarantineRevokedFarmWork(storage, { projectRef: project, userId: user, farmId: farm }, stamp), 0); assert.equal(storage.getItem(revokedFarmRecoveryKey(project, user)), null) }

// Empty envelopes are removed without alarming the user; only actual work is copied first, then removed.
{ const storage = new MemoryStorage(); for (const prefix of queuePrefixes) storage.setItem(key(prefix), envelope()); storage.setItem(key('farm-rx-notifications-write-queue'), JSON.stringify({ version: 1, entries: [notificationEntry()] })); storage.setItem(`${key('farm-rx-notifications-write-queue')}:needs-attention`, JSON.stringify({ version: 1, records: [{ id: operation, module: 'notifications', createdAt: stamp, message: 'Review this save.', entry: notificationEntry() }] })); storage.setItem(`${key('farm-rx-grain-write-queue')}:lease`, 'coordination only'); storage.setItem(key('farm-rx-grain-write-queue', otherFarm), envelope())
  storage.setItem(scoutingCleanupOutboxKey(project, user), JSON.stringify({ version: 2, entries: [{ path: `${farm}/${field}/${note}/photo.jpg`, userId: user, farmId: farm, recordedAt: stamp }, { path: `${otherFarm}/${field}/${note}/photo.jpg`, userId: user, farmId: otherFarm, recordedAt: stamp }] }))
  storage.setItem(legacyScoutingCleanupOutboxKey(project), JSON.stringify({ version: 1, entries: [{ path: `${farm}/${field}/${note}/legacy.jpg`, farmId: farm, recordedAt: stamp }] }))
  assert.equal(quarantineRevokedFarmWork(storage, { projectRef: project, userId: user, farmId: farm }, stamp), 3)
  for (const prefix of queuePrefixes) assert.equal(storage.getItem(key(prefix)), null)
  assert.equal(storage.getItem(`${key('farm-rx-notifications-write-queue')}:needs-attention`), null); assert.equal(storage.getItem(`${key('farm-rx-grain-write-queue')}:lease`), 'coordination only'); assert.notEqual(storage.getItem(key('farm-rx-grain-write-queue', otherFarm)), null)
  assert.deepEqual(JSON.parse(storage.getItem(scoutingCleanupOutboxKey(project, user))!).entries.map((entry: { farmId: string }) => entry.farmId), [otherFarm])
  assert.equal(storage.getItem(legacyScoutingCleanupOutboxKey(project)), null)
  assert.equal(JSON.parse(storage.getItem(unownedScoutingCleanupRecoveryKey(project))!).entries[0].path, `${farm}/${field}/${note}/legacy.jpg`)
  const saved = readRevokedFarmRecovery(storage, project, user); assert.equal(saved.length, 3); assert(saved.every((record) => record.farmId === farm)); assert(saved.every((record) => record.id.length <= 25 && !record.id.includes(JSON.stringify(record.payload)))); assert(saved.some((record) => record.kind === 'needs_attention')); assert(saved.some((record) => record.kind === 'scouting_cleanup'))
  assert.equal(quarantineRevokedFarmWork(storage, { projectRef: project, userId: user, farmId: farm }, stamp), 0); assert.equal(readRevokedFarmRecovery(storage, project, user).length, saved.length)
  dismissRevokedFarmRecovery(storage, project, user, saved[0]!.id); assert.equal(readRevokedFarmRecovery(storage, project, user).length, saved.length - 1)
}

// A failed durable write is fail-closed: active work stays in place and no new access snapshot may be published by the caller.
{ const storage = new MemoryStorage(); const active = key('farm-rx-notifications-write-queue'); const work = JSON.stringify({ version: 1, entries: [notificationEntry()] }); storage.setItem(active, work); storage.failWrites = true; assert.throws(() => quarantineRevokedFarmWork(storage, { projectRef: project, userId: user, farmId: farm }, stamp)); assert.equal(storage.getItem(active), work) }

// A queue whose contents do not match its scoped key is corrupt and stays active for manual recovery.
{ const storage = new MemoryStorage(); const active = key('farm-rx-notifications-write-queue'); storage.setItem(active, JSON.stringify({ version: 1, entries: [notificationEntry(otherFarm)] })); assert.throws(() => quarantineRevokedFarmWork(storage, { projectRef: project, userId: user, farmId: farm }, stamp)); assert.notEqual(storage.getItem(active), null); assert.equal(storage.getItem(revokedFarmRecoveryKey(project, user)), null) }

// Recovery belongs to exactly one project/user and is never a live queue.
{ const storage = new MemoryStorage(); storage.setItem(key('farm-rx-write-queue'), envelope()); quarantineRevokedFarmWork(storage, { projectRef: project, userId: user, farmId: farm }, stamp); assert.equal(readRevokedFarmRecovery(storage, project, 'user-b').length, 0); assert.equal(readRevokedFarmRecovery(storage, 'other-project', user).length, 0); assert.equal(storage.getItem(key('farm-rx-write-queue')), null) }

console.log('revokedFarmRecovery regression passed')
