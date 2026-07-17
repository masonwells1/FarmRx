import { readFileSync } from 'node:fs'
import * as React from 'react'
import { act, createElement } from 'react'
import { Window } from 'happy-dom'
import { QueuedEquipmentTasksRepository } from './QueuedEquipmentTasksRepository'
import { QueuedGrainRepository } from './QueuedGrainRepository'
import { QueuedInventoryRepository } from './QueuedInventoryRepository'
import { QueuedProfitabilityRepository } from './QueuedProfitabilityRepository'
import { QueuedFieldLogRepository } from './QueuedFieldLogRepository'
import { QueuedScoutingRepository } from './QueuedScoutingRepository'
import { QueuedProgramsRepository } from './QueuedProgramsRepository'
import { QueuedNotificationsRepository } from './QueuedNotificationsRepository'
import { EquipmentTasksWriteQueue, equipmentTasksWriteQueueKey } from './equipmentTasksWriteQueue'
import { GrainWriteQueue, grainWriteQueueKey } from './grainWriteQueue'
import { InventoryWriteQueue, inventoryWriteQueueKey } from './inventoryWriteQueue'
import { ProfitabilityWriteQueue, profitabilityWriteQueueKey } from './profitabilityWriteQueue'
import { FieldLogWriteQueue, fieldLogWriteQueueKey } from './fieldLogWriteQueue'
import { ScoutingWriteQueue, scoutingWriteQueueKey } from './scoutingWriteQueue'
import { ProgramsWriteQueue, programsWriteQueueKey } from './programsWriteQueue'
import { NotificationsWriteQueue, notificationsWriteQueueKey } from './notificationsWriteQueue'
import { SupabaseEquipmentTasksRepository } from './SupabaseEquipmentTasksRepository'
import { SupabaseGrainRepository } from './SupabaseGrainRepository'
import { SupabaseInventoryRepository } from './SupabaseInventoryRepository'
import { SupabaseProfitabilityRepository } from './SupabaseProfitabilityRepository'
import { FarmReplayContextChangedError, launchReplayInBackground, type StorageLike } from './writeQueue'
import { bindFarmOperationRequest, type FarmOperationContext } from './farmOperationContext'
import { captureFarmRevocationFence, resetFarmGrantFromLive } from './farmRevocationFence'
import { createFieldLocationClient, parseFieldLocationQueue } from './fieldLocation'
import { beginFarmReplayAuthorization, captureFarmReplayContextGuard, captureFarmReplayUserGuard, createFarmAccessValidationGate, currentFarmContext, type FarmAccess, type LoadedFarmAccessProfile } from '../auth/farmContext'
import { farmActiveContextKey, writeFarmAccessEpochs } from '../auth/farmAccessEpoch'
import { supabaseConfig } from '../lib/supabaseConfig'
import { createDeviceTransactionCoordinator, queueTransaction } from './queueTransaction'
import { getSyncStatus, retrySavedChanges, setModuleSyncRetryAction, setModuleSyncStatus } from './syncStatus'
import { getSaveReceipt, setSaveReceipt } from '../lib/saveReceipt'
import { fieldsSeedForRegression } from './MockFieldsRepository'
import type { EquipmentTasksDataGateway } from './EquipmentTasksDataGateway'
import type { AuthProviderDependencies } from '../auth/AuthProvider'

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const userA = id(1); const userB = id(2); const userC = id(7); const farmA = id(3); const farmB = id(4); const rowId = id(5)
const projectRef = 'queued-context-regression'
const stamp = '2026-07-15T12:00:00.000000+00:00'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function isReadContextError(error: unknown) { return error instanceof Error && (error.name === 'WorkspaceMemoryChangedError' || /signed-in account or selected farm changed/i.test(error.message)) }
function memory(): StorageLike { const values = new Map<string, string>(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) } }
class SharedTabStorageHub {
  readonly values = new Map<string, string>()
  readonly tabs: Array<{ target: Window; storage: Storage }> = []
  beforeSetItem: ((source: Window, key: string, value: string) => void) | null = null
  create(target: Window): Storage {
    const hub = this
    const storage: Storage = {
      get length() { return hub.values.size },
      clear() { for (const key of [...hub.values.keys()]) storage.removeItem(key) },
      getItem(key) { return hub.values.get(String(key)) ?? null },
      key(index) { return [...hub.values.keys()][index] ?? null },
      removeItem(key) {
        const normalized = String(key); const oldValue = hub.values.get(normalized) ?? null
        if (oldValue === null) return
        hub.values.delete(normalized)
        hub.publish(target, storage, normalized, oldValue, null)
      },
      setItem(key, value) {
        const normalized = String(key); const serialized = String(value); const oldValue = hub.values.get(normalized) ?? null
        hub.beforeSetItem?.(target, normalized, serialized)
        hub.values.set(normalized, serialized)
        if (oldValue !== serialized) hub.publish(target, storage, normalized, oldValue, serialized)
      },
    }
    this.tabs.push({ target, storage })
    return storage
  }
  private publish(source: Window, sourceStorage: Storage, key: string, oldValue: string | null, newValue: string | null) {
    for (const tab of this.tabs) {
      if (tab.target === source) continue
      setTimeout(() => { tab.target.dispatchEvent(new tab.target.StorageEvent('storage', { key, oldValue: oldValue ?? undefined, newValue: newValue ?? undefined, storageArea: tab.storage, url: source.location.href } as never)) }, 0)
    }
    void sourceStorage
  }
}
function switchingContext() { let calls = 0; return async () => { calls += 1; return calls === 1 ? { userId: userA, farmId: farmA } : { userId: userB, farmId: farmA } } }
function sameContextAcrossRegrant(storage: StorageLike, ref: string) { let calls = 0; return async () => { calls += 1; if (calls === 2) resetFarmGrantFromLive(storage, { projectRef: ref, userId: userA, farmId: farmA }, 2, '2026-07-15T12:01:00.000Z'); return { userId: userA, farmId: farmA } } }
function forbiddenWriter(counter: { calls: number }) { return new Proxy({}, { get: () => async () => { counter.calls += 1; throw new Error('writer reached') } }) }
async function rejects(action: () => Promise<unknown>, message: string) { let rejected = false; try { await action() } catch { rejected = true } assert(rejected, message) }
async function rejectsChangedContext(action: () => Promise<unknown>, message: string) { try { await action() } catch (error) { assert(error instanceof Error && /signed-in account or selected farm changed/i.test(error.message), message); return } throw new Error(message) }
async function settleCrossTabEvents() { await act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); await new Promise((resolve) => setTimeout(resolve, 0)) }) }
const operationContext = (userId: string, farmId: string, generation = 1, serverEpoch = 1): FarmOperationContext => ({ projectRef, userId, farmId, generation, token: id(900 + generation), serverEpoch })

// A delayed startup validation cannot publish after a newer reconnect validation.
const validationGate = createFarmAccessValidationGate()
let releaseValidationA!: () => void
const validationAHold = new Promise<void>((resolve) => { releaseValidationA = resolve })
let publishedValidation = 'none'
const validationAIsCurrent = validationGate.begin()
const delayedValidationA = (async () => { await validationAHold; if (validationAIsCurrent()) publishedValidation = 'A' })()
const validationBIsCurrent = validationGate.begin()
if (validationBIsCurrent()) publishedValidation = 'B'
releaseValidationA()
await delayedValidationA
assert(publishedValidation === 'B' && !validationAIsCurrent() && validationBIsCurrent(), 'An older farm-access validation reclaimed readiness after a newer validation completed.')
validationGate.invalidate()
assert(!validationBIsCurrent(), 'Farm-access validation cleanup did not invalidate the latest generation.')

const equipmentStorage = memory(); const equipmentCalls = { calls: 0 }
const queuedEquipment = new QueuedEquipmentTasksRepository(forbiddenWriter(equipmentCalls) as never, { getContext: switchingContext(), projectRef, storage: equipmentStorage, createId: () => id(10), clock: () => stamp, isOffline: () => true })
await rejects(() => queuedEquipment.deleteTask(rowId), 'Equipment entry was allowed to cross from context A into context B.')
assert(equipmentCalls.calls === 0 && new EquipmentTasksWriteQueue(equipmentStorage, equipmentTasksWriteQueueKey(projectRef, userA, farmA)).read().entries.length === 0 && new EquipmentTasksWriteQueue(equipmentStorage, equipmentTasksWriteQueueKey(projectRef, userB, farmA)).read().entries.length === 0, 'Equipment context switch reached a writer or appended into the wrong queue.')

const grainStorage = memory(); const grainCalls = { calls: 0 }
const queuedGrain = new QueuedGrainRepository(forbiddenWriter(grainCalls) as never, { getContext: switchingContext(), projectRef, storage: grainStorage, createId: () => id(11), clock: () => stamp, isOffline: () => true })
await rejects(() => queuedGrain.deleteMarketingAlertRule(rowId), 'Grain entry was allowed to cross from context A into context B.')
assert(grainCalls.calls === 0 && new GrainWriteQueue(grainStorage, grainWriteQueueKey(projectRef, userA, farmA)).read().entries.length === 0 && new GrainWriteQueue(grainStorage, grainWriteQueueKey(projectRef, userB, farmA)).read().entries.length === 0, 'Grain context switch reached a writer or appended into the wrong queue.')

const inventoryStorage = memory(); const inventoryCalls = { calls: 0 }
const queuedInventory = new QueuedInventoryRepository(forbiddenWriter(inventoryCalls) as never, { getContext: switchingContext(), projectRef, storage: inventoryStorage, createId: () => id(12), clock: () => stamp, isOffline: () => true })
await rejects(() => queuedInventory.addAdjustment({ id: rowId, product_id: id(6), quantity: 1, reason: 'correction', notes: 'Count correction', adjusted_at: '2026-07-15' }), 'Inventory entry was allowed to cross from context A into context B.')
assert(inventoryCalls.calls === 0 && new InventoryWriteQueue(inventoryStorage, inventoryWriteQueueKey(projectRef, userA, farmA)).read().entries.length === 0 && new InventoryWriteQueue(inventoryStorage, inventoryWriteQueueKey(projectRef, userB, farmA)).read().entries.length === 0, 'Inventory context switch reached a writer or appended into the wrong queue.')

const profitabilityStorage = memory(); const profitabilityCalls = { calls: 0 }
const queuedProfitability = new QueuedProfitabilityRepository(forbiddenWriter(profitabilityCalls) as never, { getContext: switchingContext(), projectRef, storage: profitabilityStorage, createId: () => id(13), clock: () => stamp, isOffline: () => true })
await rejects(() => queuedProfitability.deleteAllocation(rowId), 'Profitability entry was allowed to cross from context A into context B.')
assert(profitabilityCalls.calls === 0 && new ProfitabilityWriteQueue(profitabilityStorage, profitabilityWriteQueueKey(projectRef, userA, farmA)).read().entries.length === 0 && new ProfitabilityWriteQueue(profitabilityStorage, profitabilityWriteQueueKey(projectRef, userB, farmA)).read().entries.length === 0, 'Profitability context switch reached a writer or appended into the wrong queue.')

const fieldLogStorage = memory(); const fieldLogCalls = { calls: 0 }
const queuedFieldLog = new QueuedFieldLogRepository(forbiddenWriter(fieldLogCalls) as never, { getContext: switchingContext(), projectRef, storage: fieldLogStorage, createId: () => id(40), clock: () => stamp, isOffline: () => true })
await rejects(() => queuedFieldLog.deleteEntry(rowId), 'Field Log entry was allowed to cross from context A into context B.')
assert(fieldLogCalls.calls === 0 && new FieldLogWriteQueue(fieldLogStorage, fieldLogWriteQueueKey(projectRef, userA, farmA)).read().entries.length === 0, 'Field Log context switch reached a writer or appended a queue entry.')

const scoutingStorage = memory(); const scoutingCalls = { calls: 0 }
const queuedScouting = new QueuedScoutingRepository(forbiddenWriter(scoutingCalls) as never, { getContext: switchingContext(), projectRef, storage: scoutingStorage, createId: () => id(41), clock: () => stamp, isOffline: () => true })
await rejects(() => queuedScouting.deleteNote(rowId), 'Scouting entry was allowed to cross from context A into context B.')
assert(scoutingCalls.calls === 0 && new ScoutingWriteQueue(scoutingStorage, scoutingWriteQueueKey(projectRef, userA, farmA)).read().entries.length === 0, 'Scouting context switch reached a writer or appended a queue entry.')

const programsStorage = memory(); const programsCalls = { calls: 0 }
const queuedPrograms = new QueuedProgramsRepository(forbiddenWriter(programsCalls) as never, { getContext: switchingContext(), projectRef, storage: programsStorage, createId: () => id(42), clock: () => stamp, isOffline: () => true })
await rejects(() => queuedPrograms.deleteProgram(rowId), 'Programs entry was allowed to cross from context A into context B.')
assert(programsCalls.calls === 0 && new ProgramsWriteQueue(programsStorage, programsWriteQueueKey(projectRef, userA, farmA)).read().entries.length === 0, 'Programs context switch reached a writer or appended a queue entry.')

const notificationsStorage = memory(); const notificationsCalls = { calls: 0 }
const queuedNotifications = new QueuedNotificationsRepository(forbiddenWriter(notificationsCalls) as never, { getContext: switchingContext(), projectRef, storage: notificationsStorage, createId: () => id(43), clock: () => stamp, isOffline: () => true })
await rejects(() => queuedNotifications.markRead([rowId]), 'Notifications entry was allowed to cross from context A into context B.')
assert(notificationsCalls.calls === 0 && new NotificationsWriteQueue(notificationsStorage, notificationsWriteQueueKey(projectRef, userA, farmA)).read().entries.length === 0, 'Notifications context switch reached a writer or appended a queue entry.')

const locationStorage = memory(); const locationCalls = { calls: 0 }
const locationClient = createFieldLocationClient({ gateway: forbiddenWriter(locationCalls) as never, getContext: switchingContext(), projectRef, storage: locationStorage, createId: () => id(44), clock: () => stamp, isOffline: () => true })
await rejects(() => locationClient.saveLocation(rowId, 38, -88, 'manual'), 'Field Location entry was allowed to cross from context A into context B.')
const locationKey = `farm-rx-field-location-queue:v1:${projectRef}:${userA}:${farmA}`; const locationBytes = locationStorage.getItem(locationKey)
assert(locationCalls.calls === 0 && (locationBytes === null || parseFieldLocationQueue(locationBytes).entries.length === 0), 'Field Location context switch reached a writer or appended a queue entry.')

const equipmentRegrantRef = `${projectRef}-equipment-regrant`; const equipmentRegrantStorage = memory(); const equipmentRegrantCalls = { calls: 0 }
const equipmentRegrant = new QueuedEquipmentTasksRepository(forbiddenWriter(equipmentRegrantCalls) as never, { getContext: sameContextAcrossRegrant(equipmentRegrantStorage, equipmentRegrantRef), projectRef: equipmentRegrantRef, storage: equipmentRegrantStorage, createId: () => id(14), clock: () => stamp, isOffline: () => true })
await rejectsChangedContext(() => equipmentRegrant.deleteTask(rowId), 'Equipment operation rebound to a newer same-account access epoch.')
assert(equipmentRegrantCalls.calls === 0 && new EquipmentTasksWriteQueue(equipmentRegrantStorage, equipmentTasksWriteQueueKey(equipmentRegrantRef, userA, farmA)).read().entries.length === 0, 'Equipment regrant race wrote or queued under the new epoch.')

const grainRegrantRef = `${projectRef}-grain-regrant`; const grainRegrantStorage = memory(); const grainRegrantCalls = { calls: 0 }
const grainRegrant = new QueuedGrainRepository(forbiddenWriter(grainRegrantCalls) as never, { getContext: sameContextAcrossRegrant(grainRegrantStorage, grainRegrantRef), projectRef: grainRegrantRef, storage: grainRegrantStorage, createId: () => id(15), clock: () => stamp, isOffline: () => true })
await rejectsChangedContext(() => grainRegrant.deleteMarketingAlertRule(rowId), 'Grain operation rebound to a newer same-account access epoch.')
assert(grainRegrantCalls.calls === 0 && new GrainWriteQueue(grainRegrantStorage, grainWriteQueueKey(grainRegrantRef, userA, farmA)).read().entries.length === 0, 'Grain regrant race wrote or queued under the new epoch.')

const inventoryRegrantRef = `${projectRef}-inventory-regrant`; const inventoryRegrantStorage = memory(); const inventoryRegrantCalls = { calls: 0 }
const inventoryRegrant = new QueuedInventoryRepository(forbiddenWriter(inventoryRegrantCalls) as never, { getContext: sameContextAcrossRegrant(inventoryRegrantStorage, inventoryRegrantRef), projectRef: inventoryRegrantRef, storage: inventoryRegrantStorage, createId: () => id(16), clock: () => stamp, isOffline: () => true })
await rejectsChangedContext(() => inventoryRegrant.addAdjustment({ id: rowId, product_id: id(6), quantity: 1, reason: 'correction', notes: 'Count correction', adjusted_at: '2026-07-15' }), 'Inventory operation rebound to a newer same-account access epoch.')
assert(inventoryRegrantCalls.calls === 0 && new InventoryWriteQueue(inventoryRegrantStorage, inventoryWriteQueueKey(inventoryRegrantRef, userA, farmA)).read().entries.length === 0, 'Inventory regrant race wrote or queued under the new epoch.')

const profitabilityRegrantRef = `${projectRef}-profitability-regrant`; const profitabilityRegrantStorage = memory(); const profitabilityRegrantCalls = { calls: 0 }
const profitabilityRegrant = new QueuedProfitabilityRepository(forbiddenWriter(profitabilityRegrantCalls) as never, { getContext: sameContextAcrossRegrant(profitabilityRegrantStorage, profitabilityRegrantRef), projectRef: profitabilityRegrantRef, storage: profitabilityRegrantStorage, createId: () => id(17), clock: () => stamp, isOffline: () => true })
await rejectsChangedContext(() => profitabilityRegrant.deleteAllocation(rowId), 'Profitability operation rebound to a newer same-account access epoch.')
assert(profitabilityRegrantCalls.calls === 0 && new ProfitabilityWriteQueue(profitabilityRegrantStorage, profitabilityWriteQueueKey(profitabilityRegrantRef, userA, farmA)).read().entries.length === 0, 'Profitability regrant race wrote or queued under the new epoch.')

const fieldLogRegrantRef = `${projectRef}-field-log-regrant`; const fieldLogRegrantStorage = memory(); const fieldLogRegrantCalls = { calls: 0 }
const fieldLogRegrant = new QueuedFieldLogRepository(forbiddenWriter(fieldLogRegrantCalls) as never, { getContext: sameContextAcrossRegrant(fieldLogRegrantStorage, fieldLogRegrantRef), projectRef: fieldLogRegrantRef, storage: fieldLogRegrantStorage, createId: () => id(45), clock: () => stamp, isOffline: () => true })
await rejectsChangedContext(() => fieldLogRegrant.deleteEntry(rowId), 'Field Log operation rebound to a newer same-account access epoch.')
assert(fieldLogRegrantCalls.calls === 0 && new FieldLogWriteQueue(fieldLogRegrantStorage, fieldLogWriteQueueKey(fieldLogRegrantRef, userA, farmA)).read().entries.length === 0, 'Field Log regrant race wrote or queued under the new epoch.')

const scoutingRegrantRef = `${projectRef}-scouting-regrant`; const scoutingRegrantStorage = memory(); const scoutingRegrantCalls = { calls: 0 }
const scoutingRegrant = new QueuedScoutingRepository(forbiddenWriter(scoutingRegrantCalls) as never, { getContext: sameContextAcrossRegrant(scoutingRegrantStorage, scoutingRegrantRef), projectRef: scoutingRegrantRef, storage: scoutingRegrantStorage, createId: () => id(46), clock: () => stamp, isOffline: () => true })
await rejectsChangedContext(() => scoutingRegrant.deleteNote(rowId), 'Scouting operation rebound to a newer same-account access epoch.')
assert(scoutingRegrantCalls.calls === 0 && new ScoutingWriteQueue(scoutingRegrantStorage, scoutingWriteQueueKey(scoutingRegrantRef, userA, farmA)).read().entries.length === 0, 'Scouting regrant race wrote or queued under the new epoch.')

const programsRegrantRef = `${projectRef}-programs-regrant`; const programsRegrantStorage = memory(); const programsRegrantCalls = { calls: 0 }
const programsRegrant = new QueuedProgramsRepository(forbiddenWriter(programsRegrantCalls) as never, { getContext: sameContextAcrossRegrant(programsRegrantStorage, programsRegrantRef), projectRef: programsRegrantRef, storage: programsRegrantStorage, createId: () => id(47), clock: () => stamp, isOffline: () => true })
await rejectsChangedContext(() => programsRegrant.deleteProgram(rowId), 'Programs operation rebound to a newer same-account access epoch.')
assert(programsRegrantCalls.calls === 0 && new ProgramsWriteQueue(programsRegrantStorage, programsWriteQueueKey(programsRegrantRef, userA, farmA)).read().entries.length === 0, 'Programs regrant race wrote or queued under the new epoch.')

const notificationsRegrantRef = `${projectRef}-notifications-regrant`; const notificationsRegrantStorage = memory(); const notificationsRegrantCalls = { calls: 0 }
const notificationsRegrant = new QueuedNotificationsRepository(forbiddenWriter(notificationsRegrantCalls) as never, { getContext: sameContextAcrossRegrant(notificationsRegrantStorage, notificationsRegrantRef), projectRef: notificationsRegrantRef, storage: notificationsRegrantStorage, createId: () => id(48), clock: () => stamp, isOffline: () => true })
await rejectsChangedContext(() => notificationsRegrant.markRead([rowId]), 'Notifications operation rebound to a newer same-account access epoch.')
assert(notificationsRegrantCalls.calls === 0 && new NotificationsWriteQueue(notificationsRegrantStorage, notificationsWriteQueueKey(notificationsRegrantRef, userA, farmA)).read().entries.length === 0, 'Notifications regrant race wrote or queued under the new epoch.')

const locationRegrantRef = `${projectRef}-location-regrant`; const locationRegrantStorage = memory(); const locationRegrantCalls = { calls: 0 }
const locationRegrant = createFieldLocationClient({ gateway: forbiddenWriter(locationRegrantCalls) as never, getContext: sameContextAcrossRegrant(locationRegrantStorage, locationRegrantRef), projectRef: locationRegrantRef, storage: locationRegrantStorage, createId: () => id(49), clock: () => stamp, isOffline: () => true })
await rejectsChangedContext(() => locationRegrant.saveLocation(rowId, 38, -88, 'manual'), 'Field Location operation rebound to a newer same-account access epoch.')
const locationRegrantKey = `farm-rx-field-location-queue:v1:${locationRegrantRef}:${userA}:${farmA}`; const locationRegrantBytes = locationRegrantStorage.getItem(locationRegrantKey)
assert(locationRegrantCalls.calls === 0 && (locationRegrantBytes === null || parseFieldLocationQueue(locationRegrantBytes).entries.length === 0), 'Field Location regrant race wrote or queued under the new epoch.')

const neverGateway = new Proxy({}, { get: () => async () => { throw new Error('gateway reached before operation-context check') } })
const neverFields = new Proxy({}, { get: () => async () => { throw new Error('fields reached before operation-context check') } })
const contextA = operationContext(userA, farmA); const contextB = operationContext(userB, farmA)
const verifyAsB = async (expected: FarmOperationContext) => { if (Object.keys(expected).some((key) => expected[key as keyof FarmOperationContext] !== contextB[key as keyof FarmOperationContext])) throw new Error('The signed-in account or selected farm changed before this operation could start.') }
await rejectsChangedContext(() => new SupabaseEquipmentTasksRepository({ gateway: neverGateway as never, fieldsRepository: neverFields as never, getFarmId: async () => farmA, getUserId: async () => userB, getOperationContext: async () => contextB, verifyOperationContext: verifyAsB, verifySnapshotContext: () => undefined, createId: () => id(20), clock: () => stamp }).deleteTaskOperation(rowId, contextA), 'Equipment live writer did not bind the queued user before resolving its gateway operation.')
await rejectsChangedContext(() => new SupabaseGrainRepository({ gateway: neverGateway as never, fieldsRepository: neverFields as never, getFarmId: async () => farmA, getOperationContext: async () => contextB, verifyOperationContext: verifyAsB, createId: () => id(21), clock: () => stamp }).deleteMarketingAlertRuleOperation(rowId, contextA), 'Grain live writer did not bind the queued user before resolving its gateway operation.')
await rejectsChangedContext(() => new SupabaseInventoryRepository({ gateway: neverGateway as never, fieldsRepository: neverFields as never, getFarmId: async () => farmA, getOperationContext: async () => contextB, verifyOperationContext: verifyAsB, createId: () => id(22), clock: () => stamp }).addAdjustmentOperation({ id: rowId, product_id: id(6), adjustment_quantity_in_inventory_unit: 1, reason: 'correction', notes: 'Count correction', adjusted_at: '2026-07-15' }, contextA), 'Inventory live writer did not bind the queued user before resolving its gateway operation.')
await rejectsChangedContext(() => new SupabaseProfitabilityRepository({ gateway: neverGateway as never, fieldsRepository: neverFields as never, getFarmId: async () => farmA, getOperationContext: async () => contextB, verifyOperationContext: verifyAsB, createId: () => id(23), clock: () => stamp }).deleteAllocationOperation(rowId, contextA), 'Profitability live writer did not bind the queued user before resolving its gateway operation.')
const boundRequest = bindFarmOperationRequest({ headers: new Headers() }, contextA)
assert(boundRequest.headers.get('x-farm-rx-expected-user-id') === userA && boundRequest.headers.get('x-farm-rx-access-epochs') === JSON.stringify({ [farmA]: 1 }), 'Operation request headers did not preserve the captured user and server epoch.')

let activeFarm = farmA
let releaseFarmARaw!: () => void
let sawFarmARaw!: () => void
const farmARawStarted = new Promise<void>((resolve) => { sawFarmARaw = resolve })
const farmARawRelease = new Promise<void>((resolve) => { releaseFarmARaw = resolve })
const workspaceFor = (farmId: string) => ({ budgets: [{ id: farmId, name: farmId === farmA ? 'Farm A' : 'Farm B' }], cost_lines: [], matrix_steps: [], allocations: [], fields: { farm: { id: farmId } } })
const rawFor = (farmId: string) => [{ id: farmId, budget_id: farmId, name: farmId === farmA ? 'Farm A raw' : 'Farm B raw', category: 'seed', amount_per_acre: 1, sort_order: 0 }]
const profitabilityRaceWriter = {
  async getWorkspace() { return workspaceFor(activeFarm) },
  async rawCostLines() { const requestedFarm = activeFarm; if (requestedFarm === farmA) { sawFarmARaw(); await farmARawRelease } return rawFor(requestedFarm) },
}
const profitabilityRaceStorage = memory()
const profitabilityRace = new QueuedProfitabilityRepository(profitabilityRaceWriter as never, { getContext: async () => ({ userId: activeFarm === farmA ? userA : userB, farmId: activeFarm }), projectRef: `${projectRef}-profitability-race`, storage: profitabilityRaceStorage, createId: () => id(30), clock: () => stamp, isOffline: () => false })
const staleFarmARead = profitabilityRace.getWorkspace().then(() => 'resolved' as const).catch((error: unknown) => error)
await farmARawStarted
activeFarm = farmB
const farmBWorkspace = await profitabilityRace.getWorkspace() as unknown as { budgets: Array<{ name: string }> }
releaseFarmARaw()
const staleFarmAOutcome = await staleFarmARead
const retainedProfitability = profitabilityRace as unknown as { workspace: { budgets: Array<{ name: string }> } | null; rawCostLineCache: Array<{ name: string }> }
assert(isReadContextError(staleFarmAOutcome), 'The delayed Farm A profitability raw-cost read was not rejected after switching to Farm B.')
assert(farmBWorkspace.budgets[0]?.name === 'Farm B' && retainedProfitability.workspace?.budgets[0]?.name === 'Farm B' && retainedProfitability.rawCostLineCache[0]?.name === 'Farm B raw', 'The delayed Farm A profitability read overwrote Farm B retained workspace state.')

let activeGrainUser = userA
let releaseGrainAFinalLock!: () => void
let sawGrainAFinalLock!: () => void
const grainAFinalLockStarted = new Promise<void>((resolve) => { sawGrainAFinalLock = resolve })
const grainAFinalLockRelease = new Promise<void>((resolve) => { releaseGrainAFinalLock = resolve })
const grainWorkspaceFor = (userId: string) => ({
  production_estimates: [], grain_contracts: [{ id: userId, buyer: userId === userA ? 'User A grain' : 'User B grain' }], grain_contract_deliveries: [], marketing_plan_targets: [], insurance_units: [],
  grain_bins: [], bin_inventory: [], bin_transactions: [], cash_bids: [], usda_report_dates: [], marketing_alert_rules: [], firm_offers: [], grain_alert_settings: null, capabilities: {}, fields: { farm: { id: farmA } },
})
const grainFinalRace = new QueuedGrainRepository({ async getData() { return grainWorkspaceFor(activeGrainUser) } } as never, { getContext: async () => ({ userId: activeGrainUser, farmId: farmA }), projectRef: `${projectRef}-grain-final-lock`, storage: memory(), createId: () => id(31), clock: () => stamp, isOffline: () => false })
const grainFinalRaceInternal = grainFinalRace as unknown as { locked: (queue: GrainWriteQueue, task: (verify: () => void) => Promise<unknown>) => Promise<unknown>; workspace: { grain_contracts: Array<{ buyer: string }> } | null }
const grainOriginalLocked = grainFinalRaceInternal.locked.bind(grainFinalRaceInternal)
let grainALockCount = 0
grainFinalRaceInternal.locked = async (queue, task) => {
  if (queue.key === grainWriteQueueKey(`${projectRef}-grain-final-lock`, userA, farmA) && ++grainALockCount === 1) { sawGrainAFinalLock(); await grainAFinalLockRelease }
  return grainOriginalLocked(queue, task)
}
const staleGrainARead = grainFinalRace.getData().then(() => 'resolved' as const).catch((error: unknown) => error)
await grainAFinalLockStarted
activeGrainUser = userB
const grainBWorkspace = await grainFinalRace.getData() as unknown as { grain_contracts: Array<{ buyer: string }> }
releaseGrainAFinalLock()
const staleGrainAOutcome = await staleGrainARead
assert(isReadContextError(staleGrainAOutcome), 'The delayed User A grain final queue lock was not rejected after switching to User B on the same farm.')
assert(grainBWorkspace.grain_contracts[0]?.buyer === 'User B grain' && grainFinalRaceInternal.workspace?.grain_contracts[0]?.buyer === 'User B grain', 'The delayed User A grain final queue lock returned or displaced User B retained workspace state.')

let activeProfitabilityUser = userA
let releaseProfitabilityAFinalLock!: () => void
let sawProfitabilityAFinalLock!: () => void
const profitabilityAFinalLockStarted = new Promise<void>((resolve) => { sawProfitabilityAFinalLock = resolve })
const profitabilityAFinalLockRelease = new Promise<void>((resolve) => { releaseProfitabilityAFinalLock = resolve })
const profitabilityWorkspaceFor = (userId: string) => ({ budgets: [{ id: userId, name: userId === userA ? 'User A profitability' : 'User B profitability' }], cost_lines: [], matrix_steps: [], allocations: [], fields: { farm: { id: farmA } } })
const profitabilityFinalRace = new QueuedProfitabilityRepository({ async getWorkspace() { return profitabilityWorkspaceFor(activeProfitabilityUser) }, async rawCostLines() { return [] } } as never, { getContext: async () => ({ userId: activeProfitabilityUser, farmId: farmA }), projectRef: `${projectRef}-profitability-final-lock`, storage: memory(), createId: () => id(32), clock: () => stamp, isOffline: () => false })
const profitabilityFinalRaceInternal = profitabilityFinalRace as unknown as { locked: (queue: ProfitabilityWriteQueue, task: (verify: () => void) => Promise<unknown>) => Promise<unknown>; workspace: { budgets: Array<{ name: string }> } | null }
const profitabilityOriginalLocked = profitabilityFinalRaceInternal.locked.bind(profitabilityFinalRaceInternal)
let profitabilityALockCount = 0
profitabilityFinalRaceInternal.locked = async (queue, task) => {
  if (queue.key === profitabilityWriteQueueKey(`${projectRef}-profitability-final-lock`, userA, farmA) && ++profitabilityALockCount === 1) { sawProfitabilityAFinalLock(); await profitabilityAFinalLockRelease }
  return profitabilityOriginalLocked(queue, task)
}
const staleProfitabilityARead = profitabilityFinalRace.getWorkspace().then(() => 'resolved' as const).catch((error: unknown) => error)
await profitabilityAFinalLockStarted
activeProfitabilityUser = userB
const profitabilityBWorkspace = await profitabilityFinalRace.getWorkspace() as unknown as { budgets: Array<{ name: string }> }
releaseProfitabilityAFinalLock()
const staleProfitabilityAOutcome = await staleProfitabilityARead
assert(isReadContextError(staleProfitabilityAOutcome), 'The delayed User A profitability final queue lock was not rejected after switching to User B on the same farm.')
assert(profitabilityBWorkspace.budgets[0]?.name === 'User B profitability' && profitabilityFinalRaceInternal.workspace?.budgets[0]?.name === 'User B profitability', 'The delayed User A profitability final queue lock returned or displaced User B retained workspace state.')

let grainSaveUser = userA
let releaseGrainASave!: () => void
let sawGrainASave!: () => void
const grainASaveStarted = new Promise<void>((resolve) => { sawGrainASave = resolve })
const grainASaveRelease = new Promise<void>((resolve) => { releaseGrainASave = resolve })
const grainSaveRef = `${projectRef}-grain-save-lock`; const grainSaveStorage = memory()
const grainSaveRace = new QueuedGrainRepository({ async getData() { return grainWorkspaceFor(grainSaveUser) } } as never, { getContext: async () => ({ userId: grainSaveUser, farmId: farmA }), projectRef: grainSaveRef, storage: grainSaveStorage, createId: () => id(33), clock: () => stamp, isOffline: () => true })
const grainSaveInternal = grainSaveRace as unknown as { locked: (queue: GrainWriteQueue, task: (verify: () => void) => Promise<unknown>) => Promise<unknown>; workspace: { grain_contracts: Array<{ buyer: string }>; marketing_alert_rules: unknown[] } | null }
const grainSaveOriginalLocked = grainSaveInternal.locked.bind(grainSaveInternal)
let delayedGrainSave = false
grainSaveInternal.locked = async (queue, task) => { if (!delayedGrainSave && queue.key === grainWriteQueueKey(grainSaveRef, userA, farmA)) { delayedGrainSave = true; sawGrainASave(); await grainASaveRelease } return grainSaveOriginalLocked(queue, task) }
const grainAQueuedSave = grainSaveRace.deleteMarketingAlertRule(rowId).then(() => 'resolved' as const).catch((error: unknown) => error)
await grainASaveStarted
grainSaveUser = userB
const grainSaveBWorkspace = await grainSaveRace.getData() as unknown as { grain_contracts: Array<{ buyer: string }>; marketing_alert_rules: unknown[] }
releaseGrainASave()
const grainAQueuedOutcome = await grainAQueuedSave
assert(grainAQueuedOutcome instanceof Error, 'The delayed User A grain save was allowed to enqueue after User B loaded the same-farm workspace.')
assert(grainSaveBWorkspace.grain_contracts[0]?.buyer === 'User B grain' && grainSaveInternal.workspace?.grain_contracts[0]?.buyer === 'User B grain' && grainSaveInternal.workspace.marketing_alert_rules.length === 0, 'The delayed User A grain save mutated User B retained workspace state.')
assert(new GrainWriteQueue(grainSaveStorage, grainWriteQueueKey(grainSaveRef, userA, farmA)).read().entries.length === 0, 'The delayed User A grain save appended after the active account changed.')

let profitabilitySaveUser = userA
let releaseProfitabilityASave!: () => void
let sawProfitabilityASave!: () => void
const profitabilityASaveStarted = new Promise<void>((resolve) => { sawProfitabilityASave = resolve })
const profitabilityASaveRelease = new Promise<void>((resolve) => { releaseProfitabilityASave = resolve })
const profitabilitySaveRef = `${projectRef}-profitability-save-lock`; const profitabilitySaveStorage = memory()
const profitabilitySaveRace = new QueuedProfitabilityRepository({ async getWorkspace() { return profitabilityWorkspaceFor(profitabilitySaveUser) }, async rawCostLines() { return [] } } as never, { getContext: async () => ({ userId: profitabilitySaveUser, farmId: farmA }), projectRef: profitabilitySaveRef, storage: profitabilitySaveStorage, createId: () => id(34), clock: () => stamp, isOffline: () => true })
const profitabilitySaveInternal = profitabilitySaveRace as unknown as { locked: (queue: ProfitabilityWriteQueue, task: (verify: () => void) => Promise<unknown>) => Promise<unknown>; workspace: { budgets: Array<{ name: string }>; allocations: unknown[] } | null }
const profitabilitySaveOriginalLocked = profitabilitySaveInternal.locked.bind(profitabilitySaveInternal)
let delayedProfitabilitySave = false
profitabilitySaveInternal.locked = async (queue, task) => { if (!delayedProfitabilitySave && queue.key === profitabilityWriteQueueKey(profitabilitySaveRef, userA, farmA)) { delayedProfitabilitySave = true; sawProfitabilityASave(); await profitabilityASaveRelease } return profitabilitySaveOriginalLocked(queue, task) }
const profitabilityAQueuedSave = profitabilitySaveRace.deleteAllocation(rowId).then(() => 'resolved' as const).catch((error: unknown) => error)
await profitabilityASaveStarted
profitabilitySaveUser = userB
const profitabilitySaveBWorkspace = await profitabilitySaveRace.getWorkspace() as unknown as { budgets: Array<{ name: string }>; allocations: unknown[] }
releaseProfitabilityASave()
const profitabilityAQueuedOutcome = await profitabilityAQueuedSave
assert(profitabilityAQueuedOutcome instanceof Error, 'The delayed User A profitability save was allowed to enqueue after User B loaded the same-farm workspace.')
assert(profitabilitySaveBWorkspace.budgets[0]?.name === 'User B profitability' && profitabilitySaveInternal.workspace?.budgets[0]?.name === 'User B profitability' && profitabilitySaveInternal.workspace.allocations.length === 0, 'The delayed User A profitability save mutated User B retained workspace state.')
assert(new ProfitabilityWriteQueue(profitabilitySaveStorage, profitabilityWriteQueueKey(profitabilitySaveRef, userA, farmA)).read().entries.length === 0, 'The delayed User A profitability save appended after the active account changed.')

const equipmentConfirmRef = `${projectRef}-equipment-delete-confirm`; const equipmentConfirmStorage = memory(); let equipmentConfirmUser = userA; let equipmentConfirmReads = 0
resetFarmGrantFromLive(equipmentConfirmStorage, { projectRef: equipmentConfirmRef, userId: userA, farmId: farmA }, 1, stamp)
const equipmentConfirmQueue = new EquipmentTasksWriteQueue(equipmentConfirmStorage, equipmentTasksWriteQueueKey(equipmentConfirmRef, userA, farmA))
equipmentConfirmQueue.append({ version: 1, module: 'equipment_tasks', kind: 'deleteTask', operationId: id(35), userId: userA, farmId: farmA, enqueuedAt: stamp, id: rowId })
const equipmentConfirmRace = new QueuedEquipmentTasksRepository({ async deleteTaskOperation() { equipmentConfirmUser = userB; throw new Error('identity changed during delete') }, async getWorkspace() { equipmentConfirmReads += 1; return { equipment: [], meter_readings: [], intervals: [], service_log: [], service_due: [], members: [], tasks: [], fields: {} } } } as never, { getContext: async () => ({ userId: equipmentConfirmUser, farmId: farmA }), projectRef: equipmentConfirmRef, storage: equipmentConfirmStorage, createId: () => id(36), clock: () => stamp, isOffline: () => false })
await equipmentConfirmRace.inspectAndReplay()
assert(equipmentConfirmQueue.read().entries.length === 1 && equipmentConfirmReads === 0, 'Equipment replay treated a different account\'s RLS-hidden workspace as proof of deletion.')

const grainConfirmRef = `${projectRef}-grain-delete-confirm`; const grainConfirmStorage = memory(); let grainConfirmUser = userA; let grainConfirmReads = 0
resetFarmGrantFromLive(grainConfirmStorage, { projectRef: grainConfirmRef, userId: userA, farmId: farmA }, 1, stamp)
const grainConfirmQueue = new GrainWriteQueue(grainConfirmStorage, grainWriteQueueKey(grainConfirmRef, userA, farmA))
grainConfirmQueue.append({ version: 1, module: 'grain', kind: 'deleteMarketingAlertRule', operationId: id(37), userId: userA, farmId: farmA, enqueuedAt: stamp, id: rowId })
const grainConfirmRace = new QueuedGrainRepository({ async deleteMarketingAlertRuleOperation() { grainConfirmUser = userB; throw new Error('identity changed during delete') }, async getData() { grainConfirmReads += 1; return grainWorkspaceFor(grainConfirmUser) } } as never, { getContext: async () => ({ userId: grainConfirmUser, farmId: farmA }), projectRef: grainConfirmRef, storage: grainConfirmStorage, createId: () => id(38), clock: () => stamp, isOffline: () => false })
await grainConfirmRace.inspectAndReplay()
assert(grainConfirmQueue.read().entries.length === 1 && grainConfirmReads === 0, 'Grain replay treated a different account\'s RLS-hidden workspace as proof of deletion.')

// A capability-approved replay must stay bound to the exact account/farm grant that
// authorized it, even when its first context lookup resumes after an A-to-B switch.
const staleProfileStorage = memory(); const staleProfileRef = supabaseConfig.projectRef
resetFarmGrantFromLive(staleProfileStorage, { projectRef: staleProfileRef, userId: userA, farmId: farmA }, 1, stamp)
resetFarmGrantFromLive(staleProfileStorage, { projectRef: staleProfileRef, userId: userB, farmId: farmA }, 1, stamp)
const replayProfile = (userId: string, role: 'owner' | 'read_only'): LoadedFarmAccessProfile => ({
  userId, farmId: farmA, kind: role, memberRole: role, memberCanViewFinancials: role === 'owner', isNamedRep: false, accessEpoch: 1, validatedAt: stamp, source: 'live',
  capabilities: { canViewOperational: true, canEditOperational: role === 'owner', canManageFarm: role === 'owner', canReadPrivateFinancials: role === 'owner', canUseMembershipOnlyModules: true },
  operationContext: captureFarmRevocationFence(staleProfileStorage, { projectRef: staleProfileRef, userId, farmId: farmA }),
})
const staleProfileA = replayProfile(userA, 'owner'); const staleProfileB = replayProfile(userB, 'read_only')
const staleProfileQueueKey = equipmentTasksWriteQueueKey(staleProfileRef, userB, farmA); const staleProfileQueue = new EquipmentTasksWriteQueue(staleProfileStorage, staleProfileQueueKey)
staleProfileQueue.append({ version: 1, module: 'equipment_tasks', kind: 'saveEquipment', operationId: id(80), userId: userB, farmId: farmA, enqueuedAt: stamp, value: { id: id(81), farm_id: farmA, name: 'User B queued machine', category: 'tractor', make: null, model: null, model_year: null, serial_or_vin: null, purchase_date: null, purchase_price: null, meter_unit: 'hours', warranty_expires_on: null, warranty_notes: null, status: 'active', notes: null } })
const staleProfileBytes = staleProfileStorage.getItem(staleProfileQueueKey); const staleProfileCalls = { calls: 0 }; let staleProfileUser = userA
let releaseStaleProfileContext!: () => void; let sawStaleProfileContext!: () => void
const staleProfileContextStarted = new Promise<void>((resolve) => { sawStaleProfileContext = resolve }); const staleProfileContextRelease = new Promise<void>((resolve) => { releaseStaleProfileContext = resolve })
const staleProfileReplay = new QueuedEquipmentTasksRepository(forbiddenWriter(staleProfileCalls) as never, { getContext: async () => { const verifyReplay = captureFarmReplayContextGuard(staleProfileStorage); sawStaleProfileContext(); await staleProfileContextRelease; return verifyReplay({ userId: staleProfileUser, farmId: farmA }) }, projectRef: staleProfileRef, storage: staleProfileStorage, createId: () => id(82), clock: () => stamp, isOffline: () => false })
const replayAuthorizationA = beginFarmReplayAuthorization(staleProfileA, staleProfileStorage)
const verifyStaleReplayUser = captureFarmReplayUserGuard(staleProfileStorage)
const delayedStaleProfileReplay = staleProfileReplay.inspectAndReplay()
await staleProfileContextStarted
staleProfileUser = userB
const replayCancellationGate = createFarmAccessValidationGate()
const cancelledValidationIsCurrent = replayCancellationGate.begin()
await rejectsChangedContext(async () => { verifyStaleReplayUser(userB) }, 'A split user/farm context lookup accepted User B after its User A replay grant was superseded.')
const verifyCancelledReplayUser = captureFarmReplayUserGuard(staleProfileStorage)
await rejectsChangedContext(async () => { verifyCancelledReplayUser(userA) }, 'A repository lookup captured during validation cancellation ignored the replay tombstone.')
await rejectsChangedContext(async () => { beginFarmReplayAuthorization(staleProfileA, staleProfileStorage, { supersede: false }) }, 'A stale replay retry replaced the validation-cancellation tombstone.')
releaseStaleProfileContext()
await rejectsChangedContext(() => delayedStaleProfileReplay, 'A delayed stale-profile replay swallowed its context-cancellation rejection.')
replayAuthorizationA.end()
assert(staleProfileCalls.calls === 0 && staleProfileStorage.getItem(staleProfileQueueKey) === staleProfileBytes && staleProfileQueue.read().entries.length === 1, 'A superseded owner profile reached User B\'s writer or changed User B\'s queue bytes after an account switch.')
assert(cancelledValidationIsCurrent(), 'The validation generation lost ownership while its replay-cancellation tombstone was active.')
const currentReplayAuthorizationB = beginFarmReplayAuthorization(staleProfileB, staleProfileStorage)
await rejects(async () => { beginFarmReplayAuthorization(staleProfileA, staleProfileStorage, { supersede: false }) }, 'A stale retry superseded the current account replay gate.')
currentReplayAuthorizationB.verify(); currentReplayAuthorizationB.end()

// Cancellation after source capture but before queue-lock acquisition must still
// reject before even an empty-queue status can be published.
const lockDelayStorage = memory(); const lockDelayRef = supabaseConfig.projectRef
resetFarmGrantFromLive(lockDelayStorage, { projectRef: lockDelayRef, userId: userA, farmId: farmA }, 1, stamp)
const lockDelayProfile: LoadedFarmAccessProfile = { ...staleProfileA, operationContext: captureFarmRevocationFence(lockDelayStorage, { projectRef: lockDelayRef, userId: userA, farmId: farmA }) }
const lockDelayKey = equipmentTasksWriteQueueKey(lockDelayRef, userA, farmA)
const lockDelayQueue = new EquipmentTasksWriteQueue(lockDelayStorage, lockDelayKey)
lockDelayQueue.append({ version: 1, module: 'equipment_tasks', kind: 'saveEquipment', operationId: id(86), userId: userA, farmId: farmA, enqueuedAt: stamp, value: { id: id(87), farm_id: farmA, name: 'Queued lock-delay machine', category: 'tractor', make: null, model: null, model_year: null, serial_or_vin: null, purchase_date: null, purchase_price: null, meter_unit: 'hours', warranty_expires_on: null, warranty_notes: null, status: 'active', notes: null } })
const lockDelayQueueBytesBefore = lockDelayStorage.getItem(lockDelayKey)
const lockDelayHead = lockDelayQueue.read().entries[0]
assert(lockDelayQueueBytesBefore !== null && lockDelayHead?.kind === 'saveEquipment', 'The lock-delay cancellation proof did not begin with one durable queued equipment save.')
const lockDelayReceiptId = lockDelayHead.value.id; setSaveReceipt(lockDelayReceiptId, 'queued offline')
const lockDelayReceiptBefore = getSaveReceipt(lockDelayReceiptId)
const priorLockDelayIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
let lockDelayCacheOpenCalls = 0
Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() { lockDelayCacheOpenCalls += 1; throw new Error('Replay reached workspace cache.') }, async databases() { return [] } } })
let releaseReplayLock!: () => void; let sawReplayLock!: () => void
const replayLockHeld = new Promise<void>((resolve) => { sawReplayLock = resolve }); const replayLockRelease = new Promise<void>((resolve) => { releaseReplayLock = resolve })
const replayBlocker = queueTransaction(lockDelayKey, lockDelayStorage, () => id(83), async () => { sawReplayLock(); await replayLockRelease })
await replayLockHeld
let lockDelayContextCalls = 0; let sawLockDelaySource!: () => void
const lockDelaySourceStarted = new Promise<void>((resolve) => { sawLockDelaySource = resolve })
const lockDelayWriterCalls = { calls: 0 }
const lockDelayRepository = new QueuedEquipmentTasksRepository(forbiddenWriter(lockDelayWriterCalls) as never, { getContext: async () => { const verifyReplay = captureFarmReplayContextGuard(lockDelayStorage); lockDelayContextCalls += 1; if (lockDelayContextCalls === 1) sawLockDelaySource(); return verifyReplay({ userId: userA, farmId: farmA }) }, projectRef: lockDelayRef, storage: lockDelayStorage, createId: () => id(84), clock: () => stamp, isOffline: () => false })
setModuleSyncStatus('equipment_tasks', { kind: 'blocked', pending: 1, message: 'preexisting' })
const statusBeforeLockDelay = JSON.stringify(getSyncStatus())
const lockDelayAuthorization = beginFarmReplayAuthorization(lockDelayProfile, lockDelayStorage)
const lockDelayedReplay = lockDelayRepository.inspectAndReplay()
await lockDelaySourceStarted
createFarmAccessValidationGate().begin()
releaseReplayLock(); await replayBlocker
await rejectsChangedContext(() => lockDelayedReplay, 'A replay cancelled while waiting for its queue lock published an empty-queue success state.')
lockDelayAuthorization.end()
assert(lockDelayContextCalls === 2 && lockDelayWriterCalls.calls === 0 && JSON.stringify(getSyncStatus()) === statusBeforeLockDelay, 'A cancelled lock-delayed replay reached a writer or changed sync status.')
const finalLockDelayHead = lockDelayQueue.read().entries[0]
assert(lockDelayStorage.getItem(lockDelayKey) === lockDelayQueueBytesBefore && finalLockDelayHead?.kind === 'saveEquipment' && finalLockDelayHead.value.id === lockDelayReceiptId && getSaveReceipt(lockDelayReceiptId) === lockDelayReceiptBefore && lockDelayCacheOpenCalls === 0, 'A cancelled lock-delayed replay changed queue bytes, queued work, receipts, or workspace cache state.')
if (priorLockDelayIndexedDb) Object.defineProperty(globalThis, 'indexedDB', priorLockDelayIndexedDb)
else Reflect.deleteProperty(globalThis, 'indexedDB')
const resetLockDelayAuthorization = beginFarmReplayAuthorization(lockDelayProfile, lockDelayStorage); resetLockDelayAuthorization.end()

// The single Retry button must serialize module replays because they share one
// farm authorization, and it must surface failures instead of swallowing them.
let retryActive = 0; let retryMaxActive = 0; const retryCompleted: string[] = []
const successfulRetry = (label: string) => async () => { retryActive += 1; retryMaxActive = Math.max(retryMaxActive, retryActive); await Promise.resolve(); retryCompleted.push(label); retryActive -= 1 }
setModuleSyncRetryAction('fields', successfulRetry('fields'))
setModuleSyncRetryAction('grain', successfulRetry('grain'))
await retrySavedChanges()
assert(retryMaxActive === 1 && retryCompleted.join(',') === 'fields,grain', 'Retry Saved Changes ran farm-authorized modules concurrently or skipped one.')
let retryAfterOrdinaryFailure = false
setModuleSyncRetryAction('fields', async () => { throw new Error('ordinary module failure') })
setModuleSyncRetryAction('grain', async () => { retryAfterOrdinaryFailure = true })
await rejects(() => retrySavedChanges(), 'Retry Saved Changes swallowed an ordinary module failure.')
assert(retryAfterOrdinaryFailure, 'Retry Saved Changes stopped before later modules after an ordinary failure.')
let retryAfterContextChange = false
setModuleSyncRetryAction('fields', async () => { throw new FarmReplayContextChangedError('The signed-in account or selected farm changed before this operation could finish.') })
setModuleSyncRetryAction('grain', async () => { retryAfterContextChange = true })
await rejectsChangedContext(() => retrySavedChanges(), 'Retry Saved Changes swallowed a farm-context cancellation.')
assert(!retryAfterContextChange, 'Retry Saved Changes invoked another stale module after farm context changed.')
setModuleSyncRetryAction('fields', null); setModuleSyncRetryAction('grain', null)

// Exercise the actual production Equipment replay -> due-generation action
// through the mounted SyncNotice button, without launching a browser.
const noticeWindow = new Window({ url: 'http://localhost/' })
const domGlobalNames = ['window', 'document', 'navigator', 'localStorage', 'sessionStorage', 'location', 'Node', 'Element', 'HTMLElement', 'HTMLButtonElement', 'Event', 'MouseEvent', 'CustomEvent', 'MutationObserver'] as const
const priorDomGlobals = new Map<string, PropertyDescriptor | undefined>()
for (const name of domGlobalNames) { priorDomGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name)); Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: (noticeWindow as unknown as Record<string, unknown>)[name] }) }
const priorActEnvironment = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, writable: true, value: true })
const priorReactGlobal = Object.getOwnPropertyDescriptor(globalThis, 'React')
Object.defineProperty(globalThis, 'React', { configurable: true, writable: true, value: React })
const noticeUnhandled: unknown[] = []
const recordNoticeUnhandled = (error: unknown) => { noticeUnhandled.push(error) }
const recordWindowUnhandled = (event: unknown) => { noticeUnhandled.push((event as { reason?: unknown }).reason) }
process.on('unhandledRejection', recordNoticeUnhandled)
noticeWindow.addEventListener('unhandledrejection', recordWindowUnhandled)
try {
  const { createSupabaseEquipmentTasksServices } = await import('./createSupabaseEquipmentTasksServices')
  const { farmReplayIsOffline } = await import('./index')
  const { createRoot } = await import('react-dom/client')
  const { FarmAccessGateForUser, FarmSwitcher, SyncNotice, installFarmRetryActions, replayAuthorizedFarmWork } = await import('../App')
  const { FarmAccessProvider, useFarmAccess } = await import('../auth/FarmAccessContext')
  const { AuthProvider, useAuth } = await import('../auth/AuthProvider')
  const { supabase } = await import('../lib/supabaseClient')
  const noticeRef = supabaseConfig.projectRef; const noticeStorage = memory(); resetFarmGrantFromLive(noticeStorage, { projectRef: noticeRef, userId: userA, farmId: farmA }, 1, stamp)
  const noticeFields = fieldsSeedForRegression(); noticeFields.farm.id = farmA; for (const row of [...noticeFields.entities, ...noticeFields.fields, ...noticeFields.crop_assignments, ...noticeFields.arrangements]) row.farm_id = farmA
  const noticeCalls = { save: 0, due: 0 }
  const unused = async () => { throw new Error('Unexpected Equipment gateway operation.') }
  const noticeGateway: EquipmentTasksDataGateway = {
    async generateDueServiceTasks() { noticeCalls.due += 1; throw new TypeError('network timeout after replay') },
    async loadWorkspace() { return { viewer: { role: 'owner' }, equipment: [], meter_readings: [], intervals: [], service_log: [], service_due: [], members: [{ farm_id: farmA, user_id: userA, display_name: 'Notice Operator' }], tasks: [] } },
    async saveEquipment(farmId, value) { noticeCalls.save += 1; return { ...value, farm_id: farmId, created_by: userA, created_at: stamp, updated_at: stamp } },
    addMeterReading: unused, saveInterval: unused, addServiceLogEntry: unused, saveTask: unused, deleteTask: unused, deleteServiceLogEntry: unused, deleteInterval: unused,
  }
  let noticeId = 880
  const noticeServices = createSupabaseEquipmentTasksServices({ fieldsRepository: { getData: async () => structuredClone(noticeFields), saveField: async () => { throw new Error('Unexpected field save.') } }, getFarmId: async () => farmA, getContext: async () => ({ userId: userA, farmId: farmA }), projectRef: noticeRef, storage: noticeStorage, createId: () => id(noticeId++), isOffline: () => false, gateway: noticeGateway })
  const noticeQueue = new EquipmentTasksWriteQueue(noticeStorage, equipmentTasksWriteQueueKey(noticeRef, userA, farmA))
  noticeQueue.append({ version: 1, module: 'equipment_tasks', kind: 'saveEquipment', operationId: id(886), userId: userA, farmId: farmA, enqueuedAt: stamp, value: { id: id(887), farm_id: farmA, name: 'Notice retry machine', category: 'tractor', make: null, model: null, model_year: null, serial_or_vin: null, purchase_date: null, purchase_price: null, meter_unit: 'hours', warranty_expires_on: null, warranty_notes: null, status: 'active', notes: null } })
  for (const module of ['fields', 'grain', 'profitability', 'inventory', 'equipment_tasks', 'weather', 'fieldLog', 'scouting', 'harvest', 'programs', 'notifications'] as const) setModuleSyncStatus(module, { kind: 'synced', pending: 0 })
  setModuleSyncStatus('equipment_tasks', { kind: 'blocked', pending: 1, message: 'Retry the saved Equipment change.' })
  setModuleSyncRetryAction('equipment_tasks', noticeServices.replayEquipmentTasksQueue)
  const container = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(container); const root = createRoot(container as unknown as HTMLElement)
  try {
    const noticeProfile: LoadedFarmAccessProfile = { ...staleProfileA, userId: userA, farmId: farmA, operationContext: captureFarmRevocationFence(noticeStorage, { projectRef: noticeRef, userId: userA, farmId: farmA }) }
    const noticeFarm = noticeFields.farm
    await act(async () => { root.render(createElement(FarmAccessProvider, { value: { farms: [noticeFarm], activeFarm: noticeFarm, profile: noticeProfile, source: 'live', chooseFarm: async () => undefined, checkSignal: async () => undefined }, children: createElement(SyncNotice) })) })
    const retryButton = container.querySelector('button') as unknown as HTMLButtonElement | null
    assert(retryButton?.textContent === 'Try again', 'The mounted SyncNotice did not expose its real retry button.')
    await act(async () => { retryButton.click(); await Promise.resolve() })
    const expectedNoticeError = 'We could not reach Farm Rx. Check your signal and try again.'
    for (let attempt = 0; attempt < 50 && !container.textContent?.includes(expectedNoticeError); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    launchReplayInBackground(async () => { throw new FarmReplayContextChangedError('The signed-in account or selected farm changed before this operation could finish.') })
    await act(async () => { await new Promise<void>((resolve) => setImmediate(resolve)) })
    assert(noticeCalls.save === 1 && noticeCalls.due === 1 && noticeQueue.read().entries.length === 0 && getSyncStatus().kind === 'synced', 'The real Equipment retry action did not replay the queue before its late due-generation failure.')
    assert(container.textContent?.includes(expectedNoticeError) && !container.textContent.includes('All changes synced') && container.textContent.includes('Try again'), 'The mounted SyncNotice hid a late retry failure or removed its recovery action.')
    assert(noticeUnhandled.length === 0, 'The mounted retry click or background cancellation leaked an unhandled rejection.')
  } finally { await act(async () => { root.unmount() }); container.remove(); setModuleSyncRetryAction('equipment_tasks', null) }

  const gateStorage = noticeWindow.localStorage as unknown as StorageLike
  resetFarmGrantFromLive(gateStorage, { projectRef: supabaseConfig.projectRef, userId: userA, farmId: farmA }, 1, stamp)
  const gateProfile: LoadedFarmAccessProfile = { ...staleProfileA, userId: userA, farmId: farmA, operationContext: captureFarmRevocationFence(gateStorage, { projectRef: supabaseConfig.projectRef, userId: userA, farmId: farmA }) }
  const gateFarm = { id: farmA, name: 'Gate Farm A', share_with_rep: false, created_by: userA, created_at: stamp, updated_at: stamp }
  const gateAccess = { userId: userA, farms: [gateFarm], selectedFarmId: farmA, validatedAt: stamp, source: 'live' as const }
  const gateUser = { id: userA, email: 'account-a@example.test', app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: stamp }
  const gateFields = fieldsSeedForRegression(); gateFields.farm.id = farmA; for (const row of [...gateFields.entities, ...gateFields.fields, ...gateFields.crop_assignments, ...gateFields.arrangements]) row.farm_id = farmA
  let releaseGateRetry!: () => void
  const gateRetryHold = new Promise<void>((resolve) => { releaseGateRetry = resolve })
  const gateCalls = { save: 0, due: 0, install: 0 }
  const gateUnused = async () => { throw new Error('Unexpected gate Equipment operation.') }
  const gateGateway: EquipmentTasksDataGateway = {
    async generateDueServiceTasks() { gateCalls.due += 1; if (gateCalls.due === 1) throw new TypeError('network timeout after replay'); if (gateCalls.due === 2) await gateRetryHold; return { created_count: 0 } },
    async loadWorkspace() { return { viewer: { role: 'owner' }, equipment: [], meter_readings: [], intervals: [], service_log: [], service_due: [], members: [{ farm_id: farmA, user_id: userA, display_name: 'Gate Operator' }], tasks: [] } },
    async saveEquipment(farmId, value) { gateCalls.save += 1; return { ...value, farm_id: farmId, created_by: userA, created_at: stamp, updated_at: stamp } },
    addMeterReading: gateUnused, saveInterval: gateUnused, addServiceLogEntry: gateUnused, saveTask: gateUnused, deleteTask: gateUnused, deleteServiceLogEntry: gateUnused, deleteInterval: gateUnused,
  }
  let gateId = 910
  const gateServices = createSupabaseEquipmentTasksServices({ fieldsRepository: { getData: async () => structuredClone(gateFields), saveField: async () => { throw new Error('Unexpected gate field save.') } }, getFarmId: async () => farmA, getContext: async () => ({ userId: userA, farmId: farmA }), projectRef: supabaseConfig.projectRef, storage: gateStorage, createId: () => id(gateId++), isOffline: () => false, gateway: gateGateway })
  const gateQueue = new EquipmentTasksWriteQueue(gateStorage, equipmentTasksWriteQueueKey(supabaseConfig.projectRef, userA, farmA))
  gateQueue.append({ version: 1, module: 'equipment_tasks', kind: 'saveEquipment', operationId: id(911), userId: userA, farmId: farmA, enqueuedAt: stamp, value: { id: id(912), farm_id: farmA, name: 'Gate retry machine', category: 'tractor', make: null, model: null, model_year: null, serial_or_vin: null, purchase_date: null, purchase_price: null, meter_unit: 'hours', warranty_expires_on: null, warranty_notes: null, status: 'active', notes: null } })
  const gateDependencies = {
    loadAccess: async () => gateAccess,
    loadProfile: async () => gateProfile,
    replayWork: async (latestProfile: LoadedFarmAccessProfile, isCurrent: () => boolean = () => true) => { const authorization = beginFarmReplayAuthorization(latestProfile, gateStorage); try { authorization.verify(); assert(isCurrent(), 'Gate replay was superseded before it started.'); await gateServices.replayEquipmentTasksQueue(); authorization.verify(); assert(isCurrent(), 'Gate replay published after supersession.') } finally { authorization.end() } },
    installRetryActions: () => { gateCalls.install += 1 },
    clearRetryActions: () => undefined,
    selectFarm: async () => undefined,
  }
  const gateContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(gateContainer); const gateRoot = createRoot(gateContainer as unknown as HTMLElement)
  try {
    await act(async () => { gateRoot.render(createElement(FarmAccessGateForUser, { user: gateUser as never, dependencies: gateDependencies, children: createElement('div', null, 'Farm ready') })) })
    for (let attempt = 0; attempt < 100 && !gateContainer.textContent?.includes('Try again'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const gateRetryButton = [...gateContainer.querySelectorAll('button')].find((button) => button.textContent === 'Try again') as unknown as HTMLButtonElement | undefined
    assert(gateRetryButton && gateCalls.save === 1 && gateCalls.due === 1 && gateQueue.read().entries.length === 0 && gateCalls.install === 0, 'A startup due-generation failure did not leave a retryable blocked gate after replaying the queued save exactly once.')
    await act(async () => { gateRetryButton.click(); gateRetryButton.click(); await Promise.resolve() })
    for (let attempt = 0; attempt < 100 && Number(gateCalls.due) < 2; attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    assert(Number(gateCalls.due) === 2, 'Double-clicking the blocked gate launched duplicate retry attempts.')
    releaseGateRetry()
    for (let attempt = 0; attempt < 100 && !gateContainer.textContent?.includes('Farm ready'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    assert(gateContainer.textContent?.includes('Farm ready') && Number(gateCalls.save) === 1 && Number(gateCalls.due) === 2 && Number(gateCalls.install) === 1 && gateQueue.read().entries.length === 0, 'The retryable farm gate duplicated a durable save or failed to publish ready after due generation recovered.')
    assert(noticeUnhandled.length === 0, 'The farm gate retry leaked an unhandled rejection.')
  } finally { await act(async () => { gateRoot.unmount() }); gateContainer.remove() }

  // A sibling tab may publish an equivalent fresh access snapshot after this
  // tab loads access but before it loads permissions. Retry the whole live
  // validation once instead of leaving the farmer on a recoverable error gate.
  let siblingAccessLoads = 0
  let siblingProfileLoads = 0
  const siblingDependencies = {
    loadAccess: async () => { siblingAccessLoads += 1; return gateAccess },
    loadProfile: async () => { siblingProfileLoads += 1; if (siblingProfileLoads === 1) throw new Error('Farm access changed while permissions were loading.'); return gateProfile },
    replayWork: async () => undefined,
    installRetryActions: () => undefined,
    clearRetryActions: () => undefined,
    selectFarm: async () => undefined,
  }
  const siblingContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(siblingContainer); const siblingRoot = createRoot(siblingContainer as unknown as HTMLElement)
  try {
    await act(async () => { siblingRoot.render(createElement(FarmAccessGateForUser, { user: gateUser as never, dependencies: siblingDependencies, children: createElement('div', null, 'Sibling retry ready') })) })
    for (let attempt = 0; attempt < 100 && !siblingContainer.textContent?.includes('Sibling retry ready'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
    assert(siblingContainer.textContent?.includes('Sibling retry ready') && siblingAccessLoads === 2 && siblingProfileLoads === 2 && !siblingContainer.textContent.includes('Try again'), 'A same-account sibling access refresh did not recover through one bounded fresh validation.')
  } finally { await act(async () => { siblingRoot.unmount() }); siblingContainer.remove() }

  // A current cached offline profile must run every queue inspection while
  // skipping only server-side due generation, then publish the real gate ready.
  resetFarmGrantFromLive(gateStorage, { projectRef: supabaseConfig.projectRef, userId: userA, farmId: farmA }, 1, stamp)
  const offlineProfile: LoadedFarmAccessProfile = { ...gateProfile, source: 'offline', operationContext: captureFarmRevocationFence(gateStorage, { projectRef: supabaseConfig.projectRef, userId: userA, farmId: farmA }) }
  const offlineAccess = { ...gateAccess, source: 'offline' as const }
  const gateActiveKey = farmActiveContextKey(supabaseConfig.projectRef)
  const gateAccessKey = `farm-rx-access:v1:${supabaseConfig.projectRef}:${userA}`
  const gateProfileKey = `farm-rx-access-profile:v1:${supabaseConfig.projectRef}:${userA}:${farmA}`
  gateStorage.setItem(gateActiveKey, JSON.stringify({ version: 1, userId: userA, farmId: farmA }))
  gateStorage.setItem(gateAccessKey, JSON.stringify({ version: 1, userId: userA, farms: [gateFarm], selectedFarmId: farmA, validatedAt: stamp }))
  writeFarmAccessEpochs(gateStorage, supabaseConfig.projectRef, userA, { [farmA]: 1 }, stamp)
  const { source: _gateSource, operationContext: gateOperationContext, ...gateStoredProfile } = offlineProfile
  gateStorage.setItem(gateProfileKey, JSON.stringify({ ...gateStoredProfile, version: 1, accessValidatedAt: stamp, clockHighWaterAt: stamp, generation: gateOperationContext.generation, fenceToken: gateOperationContext.token }))

  // If a live startup blocks on strict server work and signal then drops, the
  // gate-level Try again may open a valid offline farm. Only saved-work sync
  // recovery requires a live source.
  let blockedOfflineLoads = 0
  let blockedOfflineReplays = 0
  const blockedOfflineDependencies = {
    loadAccess: async () => { blockedOfflineLoads += 1; return blockedOfflineLoads === 1 ? gateAccess : offlineAccess },
    loadProfile: async (latest: FarmAccess) => latest.source === 'offline' ? offlineProfile : gateProfile,
    replayWork: async (latestProfile: LoadedFarmAccessProfile) => { blockedOfflineReplays += 1; if (latestProfile.source === 'live') throw new TypeError('live due generation failed') },
    installRetryActions: () => undefined,
    clearRetryActions: () => undefined,
    selectFarm: async () => undefined,
  }
  function BlockedOfflineProbe() { const value = useFarmAccess(); return createElement('div', null, `${value.source} recovered farm`) }
  const blockedOfflineContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(blockedOfflineContainer); const blockedOfflineRoot = createRoot(blockedOfflineContainer as unknown as HTMLElement)
  try {
    await act(async () => { blockedOfflineRoot.render(createElement(FarmAccessGateForUser, { user: gateUser as never, dependencies: blockedOfflineDependencies, children: createElement(BlockedOfflineProbe) })) })
    for (let attempt = 0; attempt < 100 && !blockedOfflineContainer.textContent?.includes('Try again'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const blockedOfflineRetry = [...blockedOfflineContainer.querySelectorAll('button')].find((button) => button.textContent === 'Try again') as unknown as HTMLButtonElement | undefined
    assert(blockedOfflineRetry, 'The live startup failure did not expose a gate retry action.')
    await act(async () => { blockedOfflineRetry.click(); await Promise.resolve() })
    for (let attempt = 0; attempt < 100 && !blockedOfflineContainer.textContent?.includes('offline recovered farm'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    assert(blockedOfflineContainer.textContent?.includes('offline recovered farm') && blockedOfflineLoads === 2 && blockedOfflineReplays === 2, 'A blocked live startup could not recover to an offline-ready farm without returning to the blocked gate.')
  } finally { await act(async () => { blockedOfflineRoot.unmount() }); blockedOfflineContainer.remove() }

  // A retryable expired-token refresh may reach the offline farm gate only when
  // the persisted Supabase session user and JWT subject exactly match the same
  // fresh fenced farm cache. A different account remains signed out.
  const authSessionKey = `farm-rx-auth:${supabaseConfig.projectRef}`
  const authIntentStorageKey = `farm-rx-auth-intent:v1:${supabaseConfig.projectRef}`
  const authJwt = (userId: string, sessionId = `session-${userId}`) => `e30.${Buffer.from(JSON.stringify({ sub: userId, session_id: sessionId })).toString('base64url')}.signature`
  const matchingAuthBytes = JSON.stringify({ access_token: authJwt(userA), refresh_token: 'off', user: gateUser })
  const crossTabSessionA = { access_token: authJwt(userA, 'session-a'), refresh_token: 'tab-a', token_type: 'bearer', expires_in: 3600, expires_at: 1, user: gateUser }
  const crossTabSessionB = { ...crossTabSessionA, access_token: authJwt(userB, 'session-b'), refresh_token: 'tab-b', user: { ...gateUser, id: userB, email: 'account-b@example.test' } }
  const crossTabSessionC = { ...crossTabSessionA, access_token: authJwt(userC, 'session-c'), refresh_token: 'tab-c', user: { ...gateUser, id: userC, email: 'account-c@example.test' } }
  gateStorage.setItem(authSessionKey, matchingAuthBytes)
  const authClient = supabase.auth as unknown as {
    getSession: () => Promise<{ data: { session: unknown }; error: unknown }>
    onAuthStateChange: (callback: (...args: unknown[]) => void) => { data: { subscription: { unsubscribe: () => void } } }
  }
  const priorAuthGetSession = authClient.getSession
  const priorAuthStateChange = authClient.onAuthStateChange
  let crossTabAuthStateCallback: ((event: string, session: unknown) => void) | null = null
  authClient.getSession = async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 503, message: 'Service temporarily unavailable' } })
  authClient.onAuthStateChange = (callback) => { crossTabAuthStateCallback = callback as unknown as (event: string, session: unknown) => void; return { data: { subscription: { unsubscribe: () => undefined } } } }
  const offlineAuthDependencies = { loadAccess: async () => offlineAccess, loadProfile: async () => offlineProfile, replayWork: async () => undefined, installRetryActions: () => undefined, clearRetryActions: () => undefined, selectFarm: async () => undefined }
  function OfflineAuthGateProbe() { const { phase, user } = useAuth(); return user ? createElement(FarmAccessGateForUser, { user, dependencies: offlineAuthDependencies, children: createElement('div', null, 'offline auth farm ready') }) : createElement('div', null, `${phase} no offline user`) }
  const authContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(authContainer); const authRoot = createRoot(authContainer as unknown as HTMLElement)
  try {
    await act(async () => { authRoot.render(createElement(AuthProvider, null, createElement(OfflineAuthGateProbe))) })
    for (let attempt = 0; attempt < 100 && !authContainer.textContent?.includes('offline auth farm ready'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    assert(authContainer.textContent?.includes('offline auth farm ready'), 'An expired-session transport outage redirected before the exact cached offline farm gate could render.')
    await act(async () => { noticeWindow.dispatchEvent(new noticeWindow.StorageEvent('storage', { key: authSessionKey, oldValue: matchingAuthBytes, newValue: null as unknown as string })); await Promise.resolve() })
    for (let attempt = 0; attempt < 100 && !authContainer.textContent?.includes('signed_out no offline user'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    assert(authContainer.textContent?.includes('signed_out no offline user'), 'A local sign-out in another tab left an offline-auth farm visible in this tab.')
    gateStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionA))
    await act(async () => { crossTabAuthStateCallback?.('TOKEN_REFRESHED', crossTabSessionA); await Promise.resolve() })
    for (let attempt = 0; attempt < 100 && gateStorage.getItem(authSessionKey) !== null; attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    assert(authContainer.textContent?.includes('signed_out no offline user') && gateStorage.getItem(authSessionKey) === null, 'A half-open refresh resurrected a signed-out account in another open tab.')
  } finally { await act(async () => { authRoot.unmount() }); authContainer.remove() }

  // Exact bytes alone do not prove SIGNED_IN came from a deliberate password
  // action. Without a shared intent marker this is treated as a stale rewrite.
  gateStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionA))
  authClient.getSession = async () => ({ data: { session: crossTabSessionA }, error: null })
  authClient.onAuthStateChange = (callback) => { crossTabAuthStateCallback = callback as unknown as (event: string, session: unknown) => void; return { data: { subscription: { unsubscribe: () => undefined } } } }
  function CrossTabAuthProbe() { const auth = useAuth(); return createElement('div', null, `${auth.phase}:${auth.user?.id ?? 'none'}`) }
  const crossTabContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(crossTabContainer); const crossTabRoot = createRoot(crossTabContainer as unknown as HTMLElement)
  try {
    await act(async () => { crossTabRoot.render(createElement(AuthProvider, null, createElement(CrossTabAuthProbe))) })
    for (let attempt = 0; attempt < 100 && !crossTabContainer.textContent?.includes(`signed_in:${userA}`); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    gateStorage.removeItem(authSessionKey)
    await act(async () => { noticeWindow.dispatchEvent(new noticeWindow.StorageEvent('storage', { key: authSessionKey, oldValue: JSON.stringify(crossTabSessionA), newValue: null as unknown as string })); await Promise.resolve() })
    for (let attempt = 0; attempt < 100 && !crossTabContainer.textContent?.includes('signed_out:none'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    assert(crossTabContainer.textContent?.includes('signed_out:none'), 'The recipient tab did not close account A after the other tab signed out.')
    gateStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionB))
    await act(async () => { crossTabAuthStateCallback?.('SIGNED_IN', crossTabSessionB); await Promise.resolve() })
    for (let attempt = 0; attempt < 100 && gateStorage.getItem(authSessionKey) !== null; attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    assert(crossTabContainer.textContent?.includes('signed_out:none') && gateStorage.getItem(authSessionKey) === null, 'A SIGNED_IN storage rewrite without a deliberate shared intent marker replaced the signed-out account.')
  } finally { await act(async () => { crossTabRoot.unmount() }); crossTabContainer.remove() }

  gateStorage.setItem(authSessionKey, JSON.stringify({ access_token: authJwt(userB), refresh_token: 'other', user: { ...gateUser, id: userB } }))
  authClient.getSession = async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 503, message: 'Service temporarily unavailable' } })
  authClient.onAuthStateChange = () => ({ data: { subscription: { unsubscribe: () => undefined } } })
  const mismatchAuthContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(mismatchAuthContainer); const mismatchAuthRoot = createRoot(mismatchAuthContainer as unknown as HTMLElement)
  try {
    await act(async () => { mismatchAuthRoot.render(createElement(AuthProvider, null, createElement(OfflineAuthGateProbe))) })
    for (let attempt = 0; attempt < 100 && !mismatchAuthContainer.textContent?.includes('signed_out'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    assert(mismatchAuthContainer.textContent?.includes('signed_out no offline user') && !mismatchAuthContainer.textContent.includes('offline auth farm ready'), 'A retryable auth outage restored a different persisted account over the active farm cache.')
  } finally {
    await act(async () => { mismatchAuthRoot.unmount() }); mismatchAuthContainer.remove()
    gateStorage.setItem(authSessionKey, matchingAuthBytes)
    gateStorage.removeItem(authIntentStorageKey)
    authClient.getSession = priorAuthGetSession
    authClient.onAuthStateChange = priorAuthStateChange
  }

  const signOutWindow = new Window({ url: 'http://sign-out.local/' })
  const signOutStorage = signOutWindow.localStorage
  for (let index = 0; index < (gateStorage as Storage).length; index += 1) { const key = (gateStorage as Storage).key(index); if (key && !key.endsWith(':lease')) signOutStorage.setItem(key, gateStorage.getItem(key)!) }
  const priorNoticeStorage = noticeWindow.localStorage
  const signOutAuthClient = supabase.auth as unknown as typeof authClient & { signOut: () => Promise<{ error: unknown }> }
  const priorOfflineSignOut = signOutAuthClient.signOut
  let offlineSupabaseSignOutCalls = 0
  Object.defineProperty(noticeWindow, 'localStorage', { configurable: true, value: signOutStorage })
  signOutAuthClient.getSession = async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 503, message: 'Service temporarily unavailable' } })
  signOutAuthClient.onAuthStateChange = () => ({ data: { subscription: { unsubscribe: () => undefined } } })
  signOutAuthClient.signOut = async () => { offlineSupabaseSignOutCalls += 1; return { error: { name: 'AuthRetryableFetchError', status: 503, message: 'Service temporarily unavailable' } } }
  function OfflineSignOutProbe() { const { phase, user, signOut } = useAuth(); return user ? createElement('button', { type: 'button', onClick: () => { void signOut() } }, 'Sign out offline') : createElement('div', null, `${phase} signed out`) }
  const signOutContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(signOutContainer); const signOutRoot = createRoot(signOutContainer as unknown as HTMLElement)
  try {
    await act(async () => { signOutRoot.render(createElement(AuthProvider, null, createElement(OfflineSignOutProbe))) })
    for (let attempt = 0; attempt < 100 && !signOutContainer.textContent?.includes('Sign out offline'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const offlineSignOutButton = signOutContainer.querySelector('button') as unknown as HTMLButtonElement | null
    assert(offlineSignOutButton, 'The offline-auth sign-out fixture did not restore its exact user.')
    await act(async () => { offlineSignOutButton.click(); await new Promise((resolve) => setTimeout(resolve, 0)) })
    for (let attempt = 0; attempt < 100 && (!signOutContainer.textContent?.includes('signed_out signed out') || signOutStorage.getItem(gateAccessKey) !== null || signOutStorage.getItem(gateActiveKey) !== null || signOutStorage.getItem(gateProfileKey) !== null); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    assert(signOutContainer.textContent?.includes('signed_out signed out') && signOutStorage.getItem(gateAccessKey) === null && signOutStorage.getItem(gateActiveKey) === null && signOutStorage.getItem(gateProfileKey) === null && signOutStorage.getItem(authSessionKey) === null && offlineSupabaseSignOutCalls === 0, `Explicit offline sign-out did not clear local auth/farm caches without queueing auth-js cleanup behind a half-open refresh. phase=${signOutContainer.textContent} access=${signOutStorage.getItem(gateAccessKey)} active=${signOutStorage.getItem(gateActiveKey)} profile=${signOutStorage.getItem(gateProfileKey)} auth=${signOutStorage.getItem(authSessionKey)} remoteCalls=${offlineSupabaseSignOutCalls}`)
  } finally {
    await act(async () => { signOutRoot.unmount() }); signOutContainer.remove()
    Object.defineProperty(noticeWindow, 'localStorage', { configurable: true, value: priorNoticeStorage })
    signOutAuthClient.getSession = priorAuthGetSession
    signOutAuthClient.onAuthStateChange = priorAuthStateChange
    signOutAuthClient.signOut = priorOfflineSignOut
    signOutWindow.close()
  }

  const liveSignOutWindow = new Window({ url: 'http://live-sign-out.local/' })
  const liveSignOutStorage = liveSignOutWindow.localStorage
  for (let index = 0; index < (gateStorage as Storage).length; index += 1) { const key = (gateStorage as Storage).key(index); if (key && !key.endsWith(':lease')) liveSignOutStorage.setItem(key, gateStorage.getItem(key)!) }
  liveSignOutStorage.removeItem(authIntentStorageKey)
  Object.defineProperty(noticeWindow, 'localStorage', { configurable: true, value: liveSignOutStorage })
  const liveSignOutClient = supabase.auth as unknown as {
    getSession: () => Promise<{ data: { session: unknown }; error: null }>
    onAuthStateChange: typeof authClient.onAuthStateChange
    signOut: () => Promise<{ error: unknown }>
  }
  let liveSupabaseSignOutCalls = 0
  let liveAuthStateCallback: ((event: string, session: unknown) => void) | null = null
  const liveSession = { access_token: authJwt(userA), refresh_token: 'live', token_type: 'bearer', expires_in: 3600, expires_at: 1, user: gateUser }
  liveSignOutClient.getSession = async () => ({ data: { session: liveSession }, error: null })
  liveSignOutClient.onAuthStateChange = (callback) => { liveAuthStateCallback = callback as unknown as (event: string, session: unknown) => void; return { data: { subscription: { unsubscribe: () => undefined } } } }
  liveSignOutClient.signOut = async () => { liveSupabaseSignOutCalls += 1; return new Promise<{ error: unknown }>(() => undefined) }
  const liveSignOutContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(liveSignOutContainer); const liveSignOutRoot = createRoot(liveSignOutContainer as unknown as HTMLElement)
  try {
    await act(async () => { liveSignOutRoot.render(createElement(AuthProvider, null, createElement(OfflineSignOutProbe))) })
    for (let attempt = 0; attempt < 100 && !liveSignOutContainer.textContent?.includes('Sign out offline'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const liveSignOutButton = liveSignOutContainer.querySelector('button') as unknown as HTMLButtonElement | null
    assert(liveSignOutButton, 'The live-session sign-out fixture did not restore its user.')
    await act(async () => { liveSignOutButton.click(); await new Promise((resolve) => setTimeout(resolve, 0)) })
    for (let attempt = 0; attempt < 100 && (!liveSignOutContainer.textContent?.includes('signed_out signed out') || liveSignOutStorage.getItem(gateAccessKey) !== null); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    assert(liveSignOutContainer.textContent?.includes('signed_out signed out') && liveSignOutStorage.getItem(gateAccessKey) === null && liveSignOutStorage.getItem(authSessionKey) === null && liveSupabaseSignOutCalls === 0, 'A half-open live-session sign-out kept the farm visible or queued auth cleanup that could later remove a newer session.')
    liveSignOutStorage.setItem(authSessionKey, JSON.stringify(liveSession))
    await act(async () => { liveAuthStateCallback?.('TOKEN_REFRESHED', liveSession); await Promise.resolve() })
    for (let attempt = 0; attempt < 100 && liveSignOutStorage.getItem(authSessionKey) !== null; attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    assert(liveSignOutContainer.textContent?.includes('signed_out signed out') && liveSignOutStorage.getItem(authSessionKey) === null, 'A late token refresh resurrected the user or rewrote auth bytes after explicit sign-out.')
  } finally {
    await act(async () => { liveSignOutRoot.unmount() }); liveSignOutContainer.remove()
    Object.defineProperty(noticeWindow, 'localStorage', { configurable: true, value: priorNoticeStorage })
    liveSignOutClient.getSession = priorAuthGetSession as never
    liveSignOutClient.onAuthStateChange = priorAuthStateChange
    liveSignOutClient.signOut = priorOfflineSignOut
    liveSignOutWindow.close()
  }

  // A half-open restore for account A may finish after the farmer has signed
  // out and started a password sign-in for account B. Events from A are ignored
  // while B is pending, B becomes the only trusted lineage on success, and an
  // A event after B succeeds cannot replace either the screen or persisted B.
  const lineageWindow = new Window({ url: 'http://auth-lineage.local/' })
  const lineageStorage = lineageWindow.localStorage
  for (let index = 0; index < (gateStorage as Storage).length; index += 1) { const key = (gateStorage as Storage).key(index); if (key && !key.endsWith(':lease')) lineageStorage.setItem(key, gateStorage.getItem(key)!) }
  lineageStorage.setItem(authSessionKey, matchingAuthBytes)
  lineageStorage.removeItem(authIntentStorageKey)
  Object.defineProperty(noticeWindow, 'localStorage', { configurable: true, value: lineageStorage })
  const lineageClient = supabase.auth as unknown as {
    getSession: () => Promise<{ data: { session: unknown }; error: unknown }>
    onAuthStateChange: typeof authClient.onAuthStateChange
    signInWithPassword: (credentials: { email: string; password: string }) => Promise<{ data: { session: unknown }; error: unknown }>
    signOut: () => Promise<{ error: unknown }>
  }
  const priorLineageSignIn = lineageClient.signInWithPassword
  let resolveOldRestore!: (value: { data: { session: unknown }; error: null }) => void
  const oldRestore = new Promise<{ data: { session: unknown }; error: null }>((resolve) => { resolveOldRestore = resolve })
  let resolveAccountB!: (value: { data: { session: unknown }; error: null }) => void
  const accountBSignIn = new Promise<{ data: { session: unknown }; error: null }>((resolve) => { resolveAccountB = resolve })
  let lineageAuthStateCallback: ((event: string, session: unknown) => void) | null = null
  const accountBSession = { ...liveSession, access_token: authJwt(userB), refresh_token: 'acct-b', user: { ...gateUser, id: userB } }
  lineageClient.getSession = () => oldRestore
  lineageClient.onAuthStateChange = (callback) => { lineageAuthStateCallback = callback as unknown as (event: string, session: unknown) => void; return { data: { subscription: { unsubscribe: () => undefined } } } }
  lineageClient.signInWithPassword = async () => accountBSignIn
  lineageClient.signOut = async () => ({ error: null })
  let lineageSignIn!: (email: string, password: string) => Promise<void>
  let lineageSignOut!: () => Promise<void>
  function AuthLineageProbe() { const auth = useAuth(); lineageSignIn = auth.signIn; lineageSignOut = auth.signOut; return createElement('div', null, `${auth.phase}:${auth.user?.id ?? 'none'}`) }
  const lineageContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(lineageContainer); const lineageRoot = createRoot(lineageContainer as unknown as HTMLElement)
  const authTimeoutSetTimeout = globalThis.setTimeout
  try {
    globalThis.setTimeout = ((handler: TimerHandler, milliseconds?: number, ...args: unknown[]) => authTimeoutSetTimeout(handler, milliseconds === 10_000 ? 0 : milliseconds, ...args)) as typeof setTimeout
    await act(async () => { lineageRoot.render(createElement(AuthProvider, null, createElement(AuthLineageProbe))) })
    for (let attempt = 0; attempt < 100 && !lineageContainer.textContent?.includes(`signed_in:${userA}`); attempt += 1) await act(async () => { await new Promise((resolve) => authTimeoutSetTimeout(resolve, 0)) })
    globalThis.setTimeout = authTimeoutSetTimeout
    assert(lineageContainer.textContent?.includes(`signed_in:${userA}`), 'The deferred account-A restore fixture did not reach its exact offline user after the bounded timeout.')
    await act(async () => { await lineageSignOut() })
    assert(lineageContainer.textContent?.includes('signed_out:none') && lineageStorage.getItem(authSessionKey) === null, 'The lineage fixture did not become locally signed out before account B sign-in.')
    let accountBResult!: Promise<void>
    await act(async () => { accountBResult = lineageSignIn('account-b@example.test', 'password'); await Promise.resolve() })
    lineageStorage.setItem(authSessionKey, JSON.stringify(liveSession))
    await act(async () => { lineageAuthStateCallback?.('TOKEN_REFRESHED', liveSession); await Promise.resolve() })
    assert(lineageContainer.textContent?.includes('signed_out:none'), 'A deferred account-A refresh rendered while account B sign-in was pending.')
    await act(async () => { resolveAccountB({ data: { session: accountBSession }, error: null }); await accountBResult })
    assert(lineageContainer.textContent?.includes(`signed_in:${userB}`), 'The explicit account-B sign-in did not establish the new trusted session lineage.')
    lineageStorage.setItem(authSessionKey, JSON.stringify(liveSession))
    await act(async () => { lineageAuthStateCallback?.('TOKEN_REFRESHED', liveSession); resolveOldRestore({ data: { session: liveSession }, error: null }); await Promise.resolve() })
    for (let attempt = 0; attempt < 100 && lineageStorage.getItem(authSessionKey) !== null; attempt += 1) await act(async () => { await new Promise((resolve) => authTimeoutSetTimeout(resolve, 0)) })
    const lateRestoreFence = JSON.parse(lineageStorage.getItem(authIntentStorageKey) ?? '{}') as { phase?: string }
    assert(lineageContainer.textContent?.includes('signed_out:none') && lineageStorage.getItem(authSessionKey) === null && lateRestoreFence.phase === 'signed_out', 'A late account-A restore was not failed closed after mixing bytes with the accepted account-B lineage.')
    await act(async () => { await lineageSignOut() })
    let resolveRejectedSignIn!: (value: { data: { session: null }; error: Error }) => void
    lineageClient.signInWithPassword = () => new Promise((resolve) => { resolveRejectedSignIn = resolve })
    let rejectedSignIn!: Promise<void>
    await act(async () => { rejectedSignIn = lineageSignIn('rejected@example.test', 'password'); await Promise.resolve() })
    for (let attempt = 0; attempt < 100 && !resolveRejectedSignIn; attempt += 1) await act(async () => { await new Promise((resolve) => authTimeoutSetTimeout(resolve, 0)) })
    assert(resolveRejectedSignIn, 'The rejected sign-in fixture did not reach its deferred network response.')
    lineageStorage.setItem(authSessionKey, JSON.stringify(liveSession))
    await act(async () => { lineageAuthStateCallback?.('TOKEN_REFRESHED', liveSession); resolveRejectedSignIn({ data: { session: null }, error: new Error('Invalid login') }); await rejects(() => rejectedSignIn, 'The rejected sign-in fixture unexpectedly succeeded.') })
    assert(lineageContainer.textContent?.includes('signed_out:none') && lineageStorage.getItem(authSessionKey) === null, 'A rejected account-B sign-in left ignored account-A refresh bytes available for reload.')
    lineageClient.signInWithPassword = async () => {
      lineageStorage.setItem(authSessionKey, JSON.stringify(liveSession))
      lineageAuthStateCallback?.('TOKEN_REFRESHED', liveSession)
      throw new TypeError('network request failed')
    }
    await act(async () => { await rejects(() => lineageSignIn('throws@example.test', 'password'), 'The thrown sign-in fixture unexpectedly succeeded.') })
    assert(lineageContainer.textContent?.includes('signed_out:none') && lineageStorage.getItem(authSessionKey) === null, 'A thrown sign-in transport error left ignored account-A refresh bytes available for reload.')
  } finally {
    globalThis.setTimeout = authTimeoutSetTimeout
    await act(async () => { lineageRoot.unmount() }); lineageContainer.remove()
    Object.defineProperty(noticeWindow, 'localStorage', { configurable: true, value: priorNoticeStorage })
    lineageClient.getSession = priorAuthGetSession as never
    lineageClient.onAuthStateChange = priorAuthStateChange
    lineageClient.signInWithPassword = priorLineageSignIn
    lineageClient.signOut = priorOfflineSignOut
    lineageWindow.close()
  }

  // Two independent providers, auth clients, event targets, and Storage views
  // share one browser-origin backing map. Storage propagation is automatic and
  // auth broadcasts are emitted by the client that owns each tab.
  const tabHub = new SharedTabStorageHub()
  const tabAWindow = new Window({ url: 'http://auth-tabs.local/a' })
  const tabBWindow = new Window({ url: 'http://auth-tabs.local/b' })
  const tabAStorage = tabHub.create(tabAWindow)
  const tabBStorage = tabHub.create(tabBWindow)
  tabHub.values.set(authSessionKey, JSON.stringify(crossTabSessionA))
  type AcceptedAuthBytes = { sessionBytes: string; intentBytes: string }
  const captureAcceptedAuthBytes = (expectedSession: unknown, expectedUserId: string, expectedLineage: string, label: string): AcceptedAuthBytes => {
    const sessionBytes = tabHub.values.get(authSessionKey)
    const intentBytes = tabHub.values.get(authIntentStorageKey)
    const intent = JSON.parse(intentBytes ?? 'null') as { version?: number; nonce?: string; phase?: string; userId?: string; sessionLineage?: string; startedAtMs?: number }
    assert(sessionBytes === JSON.stringify(expectedSession), `${label}: wrong raw session bytes.`)
    assert(intentBytes !== undefined && intent.version === 1 && typeof intent.nonce === 'string' && intent.nonce.length > 0 && intent.phase === 'accepted' && intent.userId === expectedUserId && intent.sessionLineage === expectedLineage && Number.isFinite(intent.startedAtMs), `${label}: wrong accepted intent.`)
    return { sessionBytes, intentBytes }
  }
  const assertAcceptedAuthUnchanged = (expected: AcceptedAuthBytes, label: string) => {
    assert(tabHub.values.get(authSessionKey) === expected.sessionBytes && tabHub.values.get(authIntentStorageKey) === expected.intentBytes, `${label}: changed newer raw session or accepted-intent bytes.`)
  }
  const waitForNewPendingIntent = async (previousBytes: string | undefined, label: string) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const bytes = tabHub.values.get(authIntentStorageKey)
      if (bytes !== previousBytes) {
        try { if ((JSON.parse(bytes ?? '{}') as { phase?: string }).phase === 'pending') return } catch { /* keep waiting */ }
      }
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
    }
    throw new Error(`${label}: the production coordinator did not publish a new pending intent.`)
  }
  type TestAuthCallback = (event: string, session: unknown) => void
  const testAuthClients: Array<{ emit(event: string, nextSession: unknown): void }> = []
  function testAuthClient(getSession: () => Promise<unknown>) {
    let callback: TestAuthCallback | null = null
    let signInWithPassword: (credentials: { email: string; password: string }) => Promise<unknown> = async () => ({ data: { session: null }, error: new Error('sign-in fixture not installed') })
    const client = {
      auth: {
        getSession,
        onAuthStateChange(next: unknown) { callback = next as TestAuthCallback; return { data: { subscription: { unsubscribe: () => { callback = null } } } } },
        signInWithPassword(credentials: { email: string; password: string }) { return signInWithPassword(credentials) },
      } as unknown as AuthProviderDependencies['auth'],
      emit(event: string, nextSession: unknown) { callback?.(event, nextSession) },
      broadcast(event: string, nextSession: unknown) { for (const target of testAuthClients) setTimeout(() => target.emit(event, nextSession), 0) },
      installSignIn(action: typeof signInWithPassword) { signInWithPassword = action },
    }
    testAuthClients.push(client)
    return client
  }
  const tabAClient = testAuthClient(async () => ({ data: { session: crossTabSessionA }, error: null }))
  const tabBClient = testAuthClient(async () => ({ data: { session: crossTabSessionA }, error: null }))
  let tabId = 0
  const tabACoordinate = createDeviceTransactionCoordinator()
  const tabBCoordinate = createDeviceTransactionCoordinator()
  const tabDependencies = (auth: AuthProviderDependencies['auth'], storage: Storage, target: Window): AuthProviderDependencies => {
    let intentional = false
    const coordinate = target === tabBWindow ? tabBCoordinate : tabACoordinate
    return {
      auth,
      storage,
      addStorageListener: (listener) => target.addEventListener('storage', listener as never),
      removeStorageListener: (listener) => target.removeEventListener('storage', listener as never),
      clearFarmAccess: async () => undefined,
      restoreOfflineFarmUserId: () => null,
      intentionalSignOut: { get: () => intentional, set: (value) => { intentional = value } },
      now: () => Date.now(),
      createId: () => `tab-intent-${++tabId}`,
      coordinateAuthState: (task) => coordinate(authIntentStorageKey, storage, () => `tab-lease-${++tabId}`, task),
    }
  }
  const tabADependencies = tabDependencies(tabAClient.auth, tabAStorage, tabAWindow)
  const tabBDependencies = tabDependencies(tabBClient.auth, tabBStorage, tabBWindow)
  let tabAClearFarmAccessAction: () => Promise<void> = async () => undefined
  tabADependencies.clearFarmAccess = () => tabAClearFarmAccessAction()
  let tabASignIn!: (email: string, password: string) => Promise<void>
  let tabASignOut!: () => Promise<void>
  let tabBSignIn!: (email: string, password: string) => Promise<void>
  function TabAProbe() { const auth = useAuth(); tabASignIn = auth.signIn; tabASignOut = auth.signOut; return createElement('div', null, `${auth.phase}:${auth.user?.id ?? 'none'}`) }
  function TabBProbe() { const auth = useAuth(); tabBSignIn = auth.signIn; return createElement('div', null, `${auth.phase}:${auth.user?.id ?? 'none'}`) }
  const tabAContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(tabAContainer); const tabARoot = createRoot(tabAContainer as unknown as HTMLElement)
  const tabBContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(tabBContainer); const tabBRoot = createRoot(tabBContainer as unknown as HTMLElement)
  let publishAccountBAuthEvent!: () => void
  let finishAccountBSignIn!: () => void
  tabAClient.installSignIn(() => new Promise((resolve) => {
    publishAccountBAuthEvent = () => {
      tabAStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionB))
      tabAClient.broadcast('SIGNED_IN', crossTabSessionB)
    }
    finishAccountBSignIn = () => {
      resolve({ data: { session: crossTabSessionB }, error: null })
    }
  }))
  try {
    await act(async () => {
      tabARoot.render(createElement(AuthProvider, { dependencies: tabADependencies, children: createElement(TabAProbe) }))
      tabBRoot.render(createElement(AuthProvider, { dependencies: tabBDependencies, children: createElement(TabBProbe) }))
    })
    for (let attempt = 0; attempt < 100 && (!tabAContainer.textContent?.includes(`signed_in:${userA}`) || !tabBContainer.textContent?.includes(`signed_in:${userA}`)); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    assert(tabAContainer.textContent?.includes(`signed_in:${userA}`) && tabBContainer.textContent?.includes(`signed_in:${userA}`), 'The independent-tab fixture did not restore account A in both providers.')
    await act(async () => { await tabASignOut(); await Promise.resolve() })
    await settleCrossTabEvents()
    assert(tabAContainer.textContent?.includes('signed_out:none') && tabBContainer.textContent?.includes('signed_out:none') && tabHub.values.get(authSessionKey) === undefined, 'Account-A sign-out did not propagate its auth-key deletion to the independent recipient provider.')
    tabBStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionA))
    await act(async () => { tabBClient.broadcast('TOKEN_REFRESHED', crossTabSessionA); await Promise.resolve() })
    await settleCrossTabEvents()
    assert(tabAContainer.textContent?.includes('signed_out:none') && tabBContainer.textContent?.includes('signed_out:none') && tabHub.values.get(authSessionKey) === undefined, 'A late account-A refresh resurrected one of the independently mounted tabs.')
    tabBStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionA))
    await act(async () => { tabBClient.broadcast('SIGNED_IN', crossTabSessionA); await Promise.resolve() })
    await settleCrossTabEvents()
    assert(tabAContainer.textContent?.includes('signed_out:none') && tabBContainer.textContent?.includes('signed_out:none') && tabHub.values.get(authSessionKey) === undefined, 'A late account-A SIGNED_IN event resurrected one of the independently mounted tabs after sign-out.')
    let accountBSignInResult!: Promise<void>
    const beforeAccountBPending = tabHub.values.get(authIntentStorageKey)
    await act(async () => { accountBSignInResult = tabASignIn('account-b@example.test', 'password'); await Promise.resolve() })
    await waitForNewPendingIntent(beforeAccountBPending, 'Account-B sign-in')
    await act(async () => { tabBClient.broadcast('SIGNED_OUT', null); await Promise.resolve() })
    await settleCrossTabEvents()
    const pendingAfterSiblingSignOut = JSON.parse(tabHub.values.get(authIntentStorageKey) ?? '{}') as { phase?: string }
    assert(tabAContainer.textContent?.includes('signed_out:none') && tabBContainer.textContent?.includes('signed_out:none') && pendingAfterSiblingSignOut.phase === 'pending', 'A sibling delayed SIGNED_OUT event replaced the newer shared password intent.')
    tabBStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionA))
    await act(async () => { tabBClient.broadcast('TOKEN_REFRESHED', crossTabSessionA); await Promise.resolve() })
    await settleCrossTabEvents()
    assert(tabHub.values.get(authSessionKey) === undefined && tabHub.values.has(authIntentStorageKey), 'A stale refresh during account-B sign-in deleted the deliberate shared sign-in intent.')
    await act(async () => { publishAccountBAuthEvent(); await Promise.resolve() })
    await settleCrossTabEvents()
    assert(tabAContainer.textContent?.includes('signed_out:none') && tabBContainer.textContent?.includes('signed_out:none') && tabHub.values.get(authSessionKey) === undefined && JSON.parse(tabHub.values.get(authIntentStorageKey) ?? '{}').phase === 'pending', 'A pending password intent authorized or retained account B before the origin client returned server success.')
    await act(async () => { finishAccountBSignIn(); await accountBSignInResult })
    await settleCrossTabEvents()
    const sharedAccountB = JSON.parse(tabHub.values.get(authSessionKey) ?? '{}') as { user?: { id?: string }; refresh_token?: string }
    assert(tabAContainer.textContent?.includes(`signed_in:${userB}`) && tabBContainer.textContent?.includes(`signed_in:${userB}`) && sharedAccountB.user?.id === userB && sharedAccountB.refresh_token === crossTabSessionB.refresh_token, 'The deliberate account-B sign-in intent was not accepted and preserved across independent tabs.')
    const acceptedAccountBBeforeHistoricalDelete = captureAcceptedAuthBytes(crossTabSessionB, userB, 'session-b', 'Historical deletion setup')
    await act(async () => {
      tabBWindow.dispatchEvent(new tabBWindow.StorageEvent('storage', { key: authSessionKey, oldValue: JSON.stringify(crossTabSessionA), newValue: null as unknown as string, storageArea: tabBStorage, url: tabAWindow.location.href } as never))
      await Promise.resolve()
    })
    await settleCrossTabEvents()
    assert(tabAContainer.textContent?.includes(`signed_in:${userB}`) && tabBContainer.textContent?.includes(`signed_in:${userB}`), 'A historical auth-key deletion signed out a newer accepted account-B session.')
    assertAcceptedAuthUnchanged(acceptedAccountBBeforeHistoricalDelete, 'Historical auth-key deletion')
    tabBStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionA))
    await act(async () => { tabBClient.broadcast('SIGNED_IN', crossTabSessionA); await Promise.resolve() })
    await settleCrossTabEvents()
    const staleAccountFence = JSON.parse(tabHub.values.get(authIntentStorageKey) ?? '{}') as { phase?: string }
    assert(tabAContainer.textContent?.includes('signed_out:none') && tabBContainer.textContent?.includes('signed_out:none') && tabHub.values.get(authSessionKey) === undefined && staleAccountFence.phase === 'signed_out', 'A stale account-A SIGNED_IN broadcast was not failed closed after mixing the trusted account-B lineage.')
    const establishAccountB = async () => {
      tabAClient.installSignIn(async () => {
        tabAStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionB))
        tabAClient.broadcast('SIGNED_IN', crossTabSessionB)
        return { data: { session: crossTabSessionB }, error: null }
      })
      await act(async () => { await tabASignIn('account-b@example.test', 'password') })
      await settleCrossTabEvents()
      assert(tabAContainer.textContent?.includes(`signed_in:${userB}`) && tabBContainer.textContent?.includes(`signed_in:${userB}`), 'The fixture could not deliberately re-establish account B after a fail-closed lineage mismatch.')
    }
    await establishAccountB()
    const staleSameAccountB = { ...crossTabSessionB, access_token: authJwt(userB, 'stale-session-b'), refresh_token: 'sbrt' }
    tabBStorage.setItem(authSessionKey, JSON.stringify(staleSameAccountB))
    await act(async () => { tabBClient.broadcast('SIGNED_IN', staleSameAccountB); await Promise.resolve() })
    await settleCrossTabEvents()
    const staleSameAccountFence = JSON.parse(tabHub.values.get(authIntentStorageKey) ?? '{}') as { phase?: string }
    assert(tabAContainer.textContent?.includes('signed_out:none') && tabBContainer.textContent?.includes('signed_out:none') && tabHub.values.get(authSessionKey) === undefined && staleSameAccountFence.phase === 'signed_out', 'A stale same-account SIGNED_IN lineage was not failed closed after replacing the exact accepted token pair.')
    await establishAccountB()

    // A bare delayed SIGNED_OUT broadcast cannot override a newer coherent
    // accepted tuple. The accompanying auth-key deletion is the durable proof
    // that must publish a signed-out fence.
    const beforeBareSignedOut = captureAcceptedAuthBytes(crossTabSessionB, userB, 'session-b', 'Bare SIGNED_OUT setup')
    await act(async () => { tabAClient.broadcast('SIGNED_OUT', null); await Promise.resolve() })
    await settleCrossTabEvents()
    assertAcceptedAuthUnchanged(beforeBareSignedOut, 'Bare historical SIGNED_OUT')
    tabAStorage.removeItem(authSessionKey)
    await act(async () => { tabAClient.broadcast('SIGNED_OUT', null); await Promise.resolve() })
    await settleCrossTabEvents()
    const signedOutLineage = JSON.parse(tabHub.values.get(authIntentStorageKey) ?? '{}') as { phase?: string }
    assert(tabAContainer.textContent?.includes('signed_out:none') && tabBContainer.textContent?.includes('signed_out:none') && tabHub.values.get(authSessionKey) === undefined && signedOutLineage.phase === 'signed_out', 'An auth-key deletion plus SIGNED_OUT event did not publish a durable signed-out lineage fence.')
    tabBStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionB))
    await act(async () => { tabBClient.broadcast('SIGNED_IN', crossTabSessionB); await Promise.resolve() })
    await settleCrossTabEvents()
    assert(tabAContainer.textContent?.includes('signed_out:none') && tabBContainer.textContent?.includes('signed_out:none') && tabHub.values.get(authSessionKey) === undefined, 'The previously accepted account-B session_id resurrected after a raw auth-js sign-out.')

    tabAClient.installSignIn(async () => {
      tabAStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionB))
      tabAClient.broadcast('SIGNED_IN', crossTabSessionB)
      return { data: { session: crossTabSessionB }, error: null }
    })
    await act(async () => { await tabASignIn('account-b@example.test', 'password') })
    await settleCrossTabEvents()
    assert(tabAContainer.textContent?.includes(`signed_in:${userB}`) && tabBContainer.textContent?.includes(`signed_in:${userB}`), 'The competing-intent fixture could not re-establish account B after the raw sign-out fence.')

    // A second attempt may supersede a shared pending nonce, but its own
    // failure must not restore that older pending marker (nonce ABA). The first
    // request remains canceled even if its server response arrives later.
    let finishSupersededPendingSuccess!: () => void
    tabAClient.installSignIn(() => new Promise((resolve) => { finishSupersededPendingSuccess = () => resolve({ data: { session: crossTabSessionC }, error: null }) }))
    let supersededPending!: Promise<void>
    const beforeSupersededPending = tabHub.values.get(authIntentStorageKey)
    await act(async () => { supersededPending = tabASignIn('pending-one@example.test', 'password'); await Promise.resolve() })
    await waitForNewPendingIntent(beforeSupersededPending, 'Superseded pending sign-in')
    tabBClient.installSignIn(async () => ({ data: { session: null }, error: new Error('Pending two failed') }))
    await act(async () => { await rejects(() => tabBSignIn('pending-two@example.test', 'password'), 'The newer failed pending attempt unexpectedly succeeded.') })
    await settleCrossTabEvents()
    const failClosedPendingIntentBytes = tabHub.values.get(authIntentStorageKey)
    const failClosedPendingIntent = JSON.parse(failClosedPendingIntentBytes ?? 'null') as { phase?: string }
    assert(tabHub.values.get(authSessionKey) === undefined && failClosedPendingIntent.phase === 'signed_out', 'A failed superseding attempt restored an older pending nonce instead of failing closed.')
    await act(async () => { finishSupersededPendingSuccess(); await rejects(() => supersededPending, 'The superseded pending request regained ownership after the newer attempt failed.') })
    await settleCrossTabEvents()
    assert(tabAContainer.textContent?.includes('signed_out:none') && tabBContainer.textContent?.includes('signed_out:none') && tabHub.values.get(authSessionKey) === undefined && tabHub.values.get(authIntentStorageKey) === failClosedPendingIntentBytes, 'A superseded pending request changed the durable signed-out fence after its late response.')
    tabAClient.installSignIn(async () => {
      tabAStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionB))
      tabAClient.broadcast('SIGNED_IN', crossTabSessionB)
      return { data: { session: crossTabSessionB }, error: null }
    })
    await act(async () => { await tabASignIn('account-b@example.test', 'password') })
    await settleCrossTabEvents()
    assert(tabAContainer.textContent?.includes(`signed_in:${userB}`) && tabBContainer.textContent?.includes(`signed_in:${userB}`), 'The pending-ABA fixture could not re-establish account B for later races.')

    // A newer successful sign-in in tab B owns the shared nonce. An older tab
    // A failure cannot roll back its bytes or accepted marker.
    let finishOlderFailure!: () => void
    tabAClient.installSignIn(() => new Promise((resolve) => { finishOlderFailure = () => resolve({ data: { session: null }, error: new Error('Older sign-in failed') }) }))
    let olderFailure!: Promise<void>
    const beforeOlderFailurePending = tabHub.values.get(authIntentStorageKey)
    await act(async () => { olderFailure = tabASignIn('older@example.test', 'password'); await Promise.resolve() })
    await waitForNewPendingIntent(beforeOlderFailurePending, 'Older returned-error sign-in')
    tabBClient.installSignIn(async () => {
      tabBStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionC))
      tabBClient.broadcast('SIGNED_IN', crossTabSessionC)
      return { data: { session: crossTabSessionC }, error: null }
    })
    await act(async () => { await tabBSignIn('account-c@example.test', 'password') })
    await settleCrossTabEvents()
    const expectedAccountCAfterReturnedError = captureAcceptedAuthBytes(crossTabSessionC, userC, 'session-c', 'Returned-error race setup')
    await act(async () => { finishOlderFailure(); await rejects(() => olderFailure, 'The older competing failure unexpectedly succeeded.') })
    await settleCrossTabEvents()
    assert(tabAContainer.textContent?.includes(`signed_in:${userC}`) && tabBContainer.textContent?.includes(`signed_in:${userC}`), 'An older tab failure rolled back a newer accepted account-C sign-in.')
    assertAcceptedAuthUnchanged(expectedAccountCAfterReturnedError, 'Returned-error race')

    // A rejected older password request follows a different catch path from a
    // returned auth error. It still cannot restore its prior bytes after a
    // sibling tab has accepted a newer nonce.
    let rejectOlderThrow!: (error: Error) => void
    tabAClient.installSignIn(() => new Promise((_resolve, reject) => { rejectOlderThrow = reject }))
    let olderThrow!: Promise<void>
    const beforeOlderThrowPending = tabHub.values.get(authIntentStorageKey)
    await act(async () => { olderThrow = tabASignIn('older-throw@example.test', 'password'); await Promise.resolve() })
    await waitForNewPendingIntent(beforeOlderThrowPending, 'Older rejected-promise sign-in')
    tabBClient.installSignIn(async () => {
      tabBStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionB))
      tabBClient.broadcast('SIGNED_IN', crossTabSessionB)
      return { data: { session: crossTabSessionB }, error: null }
    })
    await act(async () => { await tabBSignIn('account-b@example.test', 'password') })
    await settleCrossTabEvents()
    const expectedAccountBAfterThrow = captureAcceptedAuthBytes(crossTabSessionB, userB, 'session-b', 'Thrown-error race setup')
    await act(async () => { rejectOlderThrow(new Error('Older sign-in threw')); await rejects(() => olderThrow, 'The older competing throw unexpectedly succeeded.') })
    await settleCrossTabEvents()
    assert(tabAContainer.textContent?.includes(`signed_in:${userB}`) && tabBContainer.textContent?.includes(`signed_in:${userB}`), 'An older thrown sign-in restored prior bytes over the newer accepted account-B session.')
    assertAcceptedAuthUnchanged(expectedAccountBAfterThrow, 'Thrown-error race')

    // Shared C can commit before tab A receives its storage event. A later
    // account-D failure in A must restore the coherent shared C tuple, not A's
    // stale provider-local B snapshot beneath C's accepted intent.
    const laggedSharedCIntentBytes = JSON.stringify({ version: 1, nonce: 'lagged-shared-c', phase: 'accepted', userId: userC, sessionLineage: 'session-c', startedAtMs: Date.now() })
    tabBStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionC))
    tabBStorage.setItem(authIntentStorageKey, laggedSharedCIntentBytes)
    let finishLaggedRollbackFailure!: () => void
    tabAClient.installSignIn(() => new Promise((resolve) => { finishLaggedRollbackFailure = () => resolve({ data: { session: null }, error: new Error('Lagged rollback failed') }) }))
    let laggedRollbackFailure!: Promise<void>
    await act(async () => { laggedRollbackFailure = tabASignIn('account-d@example.test', 'password'); await Promise.resolve() })
    for (let attempt = 0; attempt < 100 && !finishLaggedRollbackFailure; attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    assert(finishLaggedRollbackFailure, 'The lagged rollback fixture did not reach its deferred network response.')
    await act(async () => { finishLaggedRollbackFailure(); await rejects(() => laggedRollbackFailure, 'The lagged rollback failure unexpectedly succeeded.') })
    await settleCrossTabEvents()
    assert(tabAContainer.textContent?.includes(`signed_in:${userC}`) && tabBContainer.textContent?.includes(`signed_in:${userC}`) && tabHub.values.get(authSessionKey) === JSON.stringify(crossTabSessionC) && tabHub.values.get(authIntentStorageKey) === laggedSharedCIntentBytes, 'A failed sign-in mixed a stale provider-local session with the newer shared accepted lineage.')

    // Start a new tab-B sign-in at the exact old-intent write in tab A's
    // rollback. The shared coordinator must queue B until A has restored the
    // complete tuple, so A cannot overwrite B between its ownership check and
    // intent write.
    const postRollbackWindowSession = { ...crossTabSessionA, access_token: authJwt(userA, 'post-rollback-window'), refresh_token: 'window' }
    let queuedPostRollbackSignIn: Promise<void> | null = null
    tabBClient.installSignIn(async () => {
      tabBStorage.setItem(authSessionKey, JSON.stringify(postRollbackWindowSession))
      tabBClient.broadcast('SIGNED_IN', postRollbackWindowSession)
      return { data: { session: postRollbackWindowSession }, error: null }
    })
    tabHub.beforeSetItem = (source, key, value) => {
      if (source !== tabAWindow || key !== authIntentStorageKey || value !== laggedSharedCIntentBytes) return
      tabHub.beforeSetItem = null
      queuedPostRollbackSignIn = tabBSignIn('post-window@example.test', 'password')
    }
    tabAClient.installSignIn(async () => ({ data: { session: null }, error: new Error('Rollback window failure') }))
    await act(async () => { await rejects(() => tabASignIn('rollback-window@example.test', 'password'), 'The rollback-window failure unexpectedly succeeded.') })
    assert(queuedPostRollbackSignIn, 'The exact rollback intent-write window was not exercised.')
    await act(async () => { await queuedPostRollbackSignIn })
    await settleCrossTabEvents()
    captureAcceptedAuthBytes(postRollbackWindowSession, userA, 'post-rollback-window', 'Post-check/pre-intent rollback window')
    assert(tabAContainer.textContent?.includes(`signed_in:${userA}`) && tabBContainer.textContent?.includes(`signed_in:${userA}`), 'A rollback intent write overwrote the newer queued tab-B sign-in.')

    // Lose nonce ownership between the final ownership check and the first
    // auth-byte commit. The injected storage failure models a current commit
    // yielding to a sibling accepted session; the catch path must adopt C and
    // must never roll the shared bytes back.
    let injectedCommitRace = false
    const commitRaceIntentBytes = JSON.stringify({ version: 1, nonce: 'commit-race-c', phase: 'accepted', userId: userC, sessionLineage: 'session-c', startedAtMs: Date.now() })
    tabHub.beforeSetItem = (source, key) => {
      if (injectedCommitRace || source !== tabAWindow || key !== authSessionKey) return
      injectedCommitRace = true
      tabHub.beforeSetItem = null
      tabBStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionC))
      tabBStorage.setItem(authIntentStorageKey, commitRaceIntentBytes)
      tabBClient.broadcast('SIGNED_IN', crossTabSessionC)
      throw new Error('Injected auth commit failure')
    }
    tabAClient.installSignIn(async () => ({ data: { session: crossTabSessionA }, error: null }))
    await act(async () => { await rejects(() => tabASignIn('commit-race@example.test', 'password'), 'The injected competing commit error unexpectedly succeeded.') })
    await settleCrossTabEvents()
    const commitRaceIntent = JSON.parse(tabHub.values.get(authIntentStorageKey) ?? '{}') as { phase?: string; userId?: string; sessionLineage?: string }
    assert(injectedCommitRace && tabAContainer.textContent?.includes(`signed_in:${userC}`) && tabBContainer.textContent?.includes(`signed_in:${userC}`) && tabHub.values.get(authSessionKey) === JSON.stringify(crossTabSessionC) && tabHub.values.get(authIntentStorageKey) === commitRaceIntentBytes && commitRaceIntent.phase === 'accepted' && commitRaceIntent.userId === userC && commitRaceIntent.sessionLineage === 'session-c', `A competing auth commit error rolled back the newer accepted account-C bytes or intent. tabA=${tabAContainer.textContent} tabB=${tabBContainer.textContent} session=${tabHub.values.get(authSessionKey)} intent=${tabHub.values.get(authIntentStorageKey)}`)

    // Auth-js writes and broadcasts before its password promise returns. Even
    // that older successful response cannot replace the newer nonce owner.
    let finishOlderSuccess!: () => void
    tabAClient.installSignIn(() => new Promise((resolve) => {
      finishOlderSuccess = () => {
        tabAStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionB))
        tabAClient.broadcast('SIGNED_IN', crossTabSessionB)
        resolve({ data: { session: crossTabSessionB }, error: null })
      }
    }))
    let olderSuccess!: Promise<void>
    const beforeOlderSuccessPending = tabHub.values.get(authIntentStorageKey)
    await act(async () => { olderSuccess = tabASignIn('older-b@example.test', 'password'); await Promise.resolve() })
    await waitForNewPendingIntent(beforeOlderSuccessPending, 'Older early-success sign-in')
    const newestAccountA = { ...crossTabSessionA, access_token: authJwt(userA, 'session-a-new'), refresh_token: 'a-new' }
    tabBClient.installSignIn(async () => {
      tabBStorage.setItem(authSessionKey, JSON.stringify(newestAccountA))
      tabBClient.broadcast('SIGNED_IN', newestAccountA)
      return { data: { session: newestAccountA }, error: null }
    })
    await act(async () => { await tabBSignIn('account-a@example.test', 'password') })
    await settleCrossTabEvents()
    const expectedNewestAccountA = captureAcceptedAuthBytes(newestAccountA, userA, 'session-a-new', 'Auth-js early-success race setup')
    await act(async () => { finishOlderSuccess(); await rejects(() => olderSuccess, 'The older competing success was not canceled.') })
    await settleCrossTabEvents()
    const olderSuccessFence = JSON.parse(tabHub.values.get(authIntentStorageKey) ?? '{}') as { phase?: string }
    assert(tabAContainer.textContent?.includes('signed_out:none') && tabBContainer.textContent?.includes('signed_out:none') && tabHub.values.get(authSessionKey) === undefined && olderSuccessFence.phase === 'signed_out' && expectedNewestAccountA.sessionBytes === JSON.stringify(newestAccountA), 'An older auth-js success was not failed closed after mixing bytes with the newer accepted account-A lineage.')
    tabAClient.installSignIn(async () => {
      tabAStorage.setItem(authSessionKey, JSON.stringify(newestAccountA))
      tabAClient.broadcast('SIGNED_IN', newestAccountA)
      return { data: { session: newestAccountA }, error: null }
    })
    await act(async () => { await tabASignIn('account-a@example.test', 'password') })
    await settleCrossTabEvents()
    assert(tabAContainer.textContent?.includes(`signed_in:${userA}`) && tabBContainer.textContent?.includes(`signed_in:${userA}`), 'The delayed sign-out fixture could not deliberately re-establish account A after fail-closed recovery.')

    // Shared auth must be fenced before farm-cache cleanup yields. An old
    // account-A sign-out that resumes after tab B accepts C cannot erase C.
    let releaseDelayedFarmClear!: () => void
    tabAClearFarmAccessAction = () => new Promise<void>((resolve) => { releaseDelayedFarmClear = resolve })
    let delayedAccountASignOut!: Promise<void>
    await act(async () => { delayedAccountASignOut = tabASignOut(); await Promise.resolve() })
    await settleCrossTabEvents()
    assert(tabAContainer.textContent?.includes('signed_out:none') && tabBContainer.textContent?.includes('signed_out:none') && tabHub.values.get(authSessionKey) === undefined, 'Account-A sign-out waited for farm-cache cleanup before fencing shared auth.')
    tabBClient.installSignIn(async () => {
      tabBStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionC))
      tabBClient.broadcast('SIGNED_IN', crossTabSessionC)
      return { data: { session: crossTabSessionC }, error: null }
    })
    await act(async () => { await tabBSignIn('account-c@example.test', 'password') })
    await settleCrossTabEvents()
    const expectedAccountCAfterDelayedClear = captureAcceptedAuthBytes(crossTabSessionC, userC, 'session-c', 'Delayed sign-out cleanup setup')
    await act(async () => { releaseDelayedFarmClear(); await delayedAccountASignOut })
    await settleCrossTabEvents()
    const afterDelayedFarmClear = JSON.parse(tabHub.values.get(authSessionKey) ?? '{}') as { user?: { id?: string }; refresh_token?: string }
    assert(tabAContainer.textContent?.includes(`signed_in:${userC}`) && tabBContainer.textContent?.includes(`signed_in:${userC}`) && afterDelayedFarmClear.user?.id === userC && afterDelayedFarmClear.refresh_token === crossTabSessionC.refresh_token && tabHub.values.get(authSessionKey) === JSON.stringify(crossTabSessionC), 'An older sign-out erased or changed the newer accepted account-C session after delayed farm-cache cleanup.')
    assertAcceptedAuthUnchanged(expectedAccountCAfterDelayedClear, 'Delayed sign-out cleanup')
    tabAClearFarmAccessAction = async () => undefined
  } finally {
    await act(async () => { tabARoot.unmount(); tabBRoot.unmount() })
    tabAContainer.remove(); tabBContainer.remove(); tabAWindow.close(); tabBWindow.close()
  }

  // Malformed non-null intent bytes are corrupted state, not an absent legacy
  // marker. Startup must fail closed before trusting an auth-js session.
  const malformedStartupHub = new SharedTabStorageHub()
  const malformedStartupWindow = new Window({ url: 'http://auth-malformed-startup.local/' })
  const malformedStartupStorage = malformedStartupHub.create(malformedStartupWindow)
  malformedStartupHub.values.set(authSessionKey, JSON.stringify(crossTabSessionA))
  malformedStartupHub.values.set(authIntentStorageKey, '{malformed-intent')
  const malformedStartupClient = testAuthClient(async () => ({ data: { session: crossTabSessionA }, error: null }))
  const malformedStartupDependencies = tabDependencies(malformedStartupClient.auth, malformedStartupStorage, malformedStartupWindow)
  function MalformedStartupProbe() { const auth = useAuth(); return createElement('div', null, `${auth.phase}:${auth.user?.id ?? 'none'}`) }
  const malformedStartupContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(malformedStartupContainer); const malformedStartupRoot = createRoot(malformedStartupContainer as unknown as HTMLElement)
  try {
    await act(async () => { malformedStartupRoot.render(createElement(AuthProvider, { dependencies: malformedStartupDependencies, children: createElement(MalformedStartupProbe) })) })
    await settleCrossTabEvents()
    const startupReplacement = JSON.parse(malformedStartupHub.values.get(authIntentStorageKey) ?? '{}') as { phase?: string }
    assert(malformedStartupContainer.textContent?.includes('signed_out:none') && malformedStartupHub.values.get(authSessionKey) === undefined && startupReplacement.phase === 'signed_out', 'Malformed startup intent bytes were treated as an absent legacy marker and restored a persisted session.')
  } finally {
    await act(async () => { malformedStartupRoot.unmount() }); malformedStartupContainer.remove(); malformedStartupWindow.close()
  }

  // Both an ordinary auth error and a rejected network promise must refuse to
  // roll a newly corrupted tuple backward after a legitimate legacy mount.
  const verifyMalformedIntentFailure = async (mode: 'returned-error' | 'rejected-promise') => {
    const malformedHub = new SharedTabStorageHub()
    const malformedWindow = new Window({ url: `http://auth-malformed-${mode}.local/` })
    const malformedStorage = malformedHub.create(malformedWindow)
    malformedHub.values.set(authSessionKey, JSON.stringify(crossTabSessionA))
    const malformedClient = testAuthClient(async () => ({ data: { session: crossTabSessionA }, error: null }))
    malformedClient.installSignIn(mode === 'returned-error'
      ? async () => ({ data: { session: null }, error: new Error('Invalid login') })
      : async () => { throw new TypeError('network request failed') })
    const malformedDependencies = tabDependencies(malformedClient.auth, malformedStorage, malformedWindow)
    let malformedSignIn!: (email: string, password: string) => Promise<void>
    function MalformedIntentProbe() { const auth = useAuth(); malformedSignIn = auth.signIn; return createElement('div', null, `${auth.phase}:${auth.user?.id ?? 'none'}`) }
    const malformedContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(malformedContainer); const malformedRoot = createRoot(malformedContainer as unknown as HTMLElement)
    try {
      await act(async () => { malformedRoot.render(createElement(AuthProvider, { dependencies: malformedDependencies, children: createElement(MalformedIntentProbe) })) })
      for (let attempt = 0; attempt < 100 && !malformedContainer.textContent?.includes(`signed_in:${userA}`); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
      assert(malformedContainer.textContent?.includes(`signed_in:${userA}`), `The ${mode} malformed-intent fixture did not mount its legacy session.`)
      malformedStorage.setItem(authIntentStorageKey, '{malformed-intent')
      await act(async () => { await rejects(() => malformedSignIn(`${mode}@example.test`, 'password'), `The ${mode} malformed-intent sign-in unexpectedly succeeded.`) })
      await settleCrossTabEvents()
      const replacement = JSON.parse(malformedHub.values.get(authIntentStorageKey) ?? '{}') as { phase?: string }
      assert(malformedContainer.textContent?.includes('signed_out:none') && malformedHub.values.get(authSessionKey) === undefined && replacement.phase === 'signed_out', `The ${mode} sign-in restored a session paired with malformed intent bytes.`)
    } finally {
      await act(async () => { malformedRoot.unmount() }); malformedContainer.remove(); malformedWindow.close()
    }
  }
  await verifyMalformedIntentFailure('returned-error')
  await verifyMalformedIntentFailure('rejected-promise')

  // Sign-out alone also cancels an in-flight initial restore. This is separate
  // from the account-replacement case so a later sign-in cannot mask the guard.
  const signOutRestoreHub = new SharedTabStorageHub()
  const signOutRestoreWindow = new Window({ url: 'http://auth-restore-signout.local/' })
  const signOutRestoreStorage = signOutRestoreHub.create(signOutRestoreWindow)
  signOutRestoreHub.values.set(authSessionKey, JSON.stringify(crossTabSessionA))
  let resolveSignOutRestore!: (value: unknown) => void
  const signOutRestorePromise = new Promise<unknown>((resolve) => { resolveSignOutRestore = resolve })
  const signOutRestoreClient = testAuthClient(() => signOutRestorePromise)
  const signOutRestoreDependencies = tabDependencies(signOutRestoreClient.auth, signOutRestoreStorage, signOutRestoreWindow)
  let cancelInitialRestore!: () => Promise<void>
  function SignOutRestoreProbe() { const auth = useAuth(); cancelInitialRestore = auth.signOut; return createElement('div', null, `${auth.phase}:${auth.user?.id ?? 'none'}`) }
  const signOutRestoreContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(signOutRestoreContainer); const signOutRestoreRoot = createRoot(signOutRestoreContainer as unknown as HTMLElement)
  try {
    await act(async () => { signOutRestoreRoot.render(createElement(AuthProvider, { dependencies: signOutRestoreDependencies, children: createElement(SignOutRestoreProbe) })); await Promise.resolve() })
    assert(signOutRestoreContainer.textContent?.includes('restoring:none'), 'The sign-out-only restore fixture settled before its deferred session was released.')
    await act(async () => { await cancelInitialRestore() })
    resolveSignOutRestore({ data: { session: crossTabSessionA }, error: null })
    await settleCrossTabEvents()
    assert(signOutRestoreContainer.textContent?.includes('signed_out:none') && signOutRestoreHub.values.get(authSessionKey) === undefined, 'A deferred initial restore resurrected account A after sign-out alone.')
  } finally {
    await act(async () => { signOutRestoreRoot.unmount() }); signOutRestoreContainer.remove(); signOutRestoreWindow.close()
  }

  // An abandoned pending password marker must fail closed after its five-minute
  // window. It is not equivalent to a legacy device with no intent record.
  const expiredPendingHub = new SharedTabStorageHub()
  const expiredPendingWindow = new Window({ url: 'http://auth-expired-pending.local/' })
  const expiredPendingStorage = expiredPendingHub.create(expiredPendingWindow)
  const expiredPendingStart = Date.parse('2026-07-17T12:00:00.000Z')
  expiredPendingHub.values.set(authSessionKey, JSON.stringify(crossTabSessionA))
  expiredPendingHub.values.set(authIntentStorageKey, JSON.stringify({ version: 1, nonce: 'expired-pending', phase: 'pending', email: 'account-a@example.test', startedAtMs: expiredPendingStart }))
  const expiredPendingClient = testAuthClient(async () => ({ data: { session: crossTabSessionA }, error: null }))
  const expiredPendingDependencies = { ...tabDependencies(expiredPendingClient.auth, expiredPendingStorage, expiredPendingWindow), now: () => expiredPendingStart + (6 * 60 * 1000) }
  function ExpiredPendingProbe() { const auth = useAuth(); return createElement('div', null, `${auth.phase}:${auth.user?.id ?? 'none'}`) }
  const expiredPendingContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(expiredPendingContainer); const expiredPendingRoot = createRoot(expiredPendingContainer as unknown as HTMLElement)
  try {
    await act(async () => { expiredPendingRoot.render(createElement(AuthProvider, { dependencies: expiredPendingDependencies, children: createElement(ExpiredPendingProbe) })) })
    for (let attempt = 0; attempt < 100 && !expiredPendingContainer.textContent?.includes('signed_out:none'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
    const expiredReplacement = JSON.parse(expiredPendingHub.values.get(authIntentStorageKey) ?? '{}') as { phase?: string }
    assert(expiredPendingContainer.textContent?.includes('signed_out:none') && expiredPendingHub.values.get(authSessionKey) === undefined && expiredReplacement.phase === 'signed_out', 'An expired pending password marker was treated as absent and authorized its persisted session.')
    expiredPendingStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionA))
    await act(async () => { expiredPendingClient.emit('SIGNED_IN', crossTabSessionA); await Promise.resolve() })
    await settleCrossTabEvents()
    assert(expiredPendingContainer.textContent?.includes('signed_out:none') && expiredPendingHub.values.get(authSessionKey) === undefined, 'A session from an expired pending password attempt resurrected after fail-closed restore.')
  } finally {
    await act(async () => { expiredPendingRoot.unmount() }); expiredPendingContainer.remove(); expiredPendingWindow.close()
  }

  const signedOutOfflineHub = new SharedTabStorageHub()
  const signedOutOfflineWindow = new Window({ url: 'http://auth-signedout-offline.local/' })
  const signedOutOfflineStorage = signedOutOfflineHub.create(signedOutOfflineWindow)
  signedOutOfflineHub.values.set(authSessionKey, JSON.stringify(crossTabSessionA))
  signedOutOfflineHub.values.set(authIntentStorageKey, JSON.stringify({ version: 1, nonce: 'durable-signout', phase: 'signed_out', startedAtMs: expiredPendingStart }))
  const signedOutOfflineClient = testAuthClient(async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 503, message: 'Service unavailable' } }))
  const signedOutOfflineDependencies = { ...tabDependencies(signedOutOfflineClient.auth, signedOutOfflineStorage, signedOutOfflineWindow), restoreOfflineFarmUserId: () => userA, now: () => expiredPendingStart + (24 * 60 * 60 * 1000) }
  const signedOutOfflineContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(signedOutOfflineContainer); const signedOutOfflineRoot = createRoot(signedOutOfflineContainer as unknown as HTMLElement)
  try {
    await act(async () => { signedOutOfflineRoot.render(createElement(AuthProvider, { dependencies: signedOutOfflineDependencies, children: createElement(ExpiredPendingProbe) })) })
    for (let attempt = 0; attempt < 100 && !signedOutOfflineContainer.textContent?.includes('signed_out:none'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
    assert(signedOutOfflineContainer.textContent?.includes('signed_out:none') && signedOutOfflineHub.values.get(authSessionKey) === undefined, 'A durable signed-out fence was bypassed by transport-failure offline restoration.')
  } finally {
    await act(async () => { signedOutOfflineRoot.unmount() }); signedOutOfflineContainer.remove(); signedOutOfflineWindow.close()
  }

  const durableFenceBytes = signedOutOfflineHub.values.get(authIntentStorageKey)
  const signedOutRemountWindow = new Window({ url: 'http://auth-signedout-offline.local/remount' })
  const signedOutRemountStorage = signedOutOfflineHub.create(signedOutRemountWindow)
  signedOutOfflineHub.values.set(authSessionKey, JSON.stringify(crossTabSessionA))
  const signedOutRemountClient = testAuthClient(async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 503, message: 'Service unavailable' } }))
  const signedOutRemountDependencies = { ...tabDependencies(signedOutRemountClient.auth, signedOutRemountStorage, signedOutRemountWindow), restoreOfflineFarmUserId: () => userA, now: () => expiredPendingStart + (48 * 60 * 60 * 1000) }
  const signedOutRemountContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(signedOutRemountContainer); const signedOutRemountRoot = createRoot(signedOutRemountContainer as unknown as HTMLElement)
  try {
    await act(async () => { signedOutRemountRoot.render(createElement(AuthProvider, { dependencies: signedOutRemountDependencies, children: createElement(ExpiredPendingProbe) })) })
    for (let attempt = 0; attempt < 100 && !signedOutRemountContainer.textContent?.includes('signed_out:none'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
    assert(signedOutRemountContainer.textContent?.includes('signed_out:none') && signedOutOfflineHub.values.get(authSessionKey) === undefined && signedOutOfflineHub.values.get(authIntentStorageKey) === durableFenceBytes, 'A remount did not preserve the exact durable signed-out fence against offline restoration.')
  } finally {
    await act(async () => { signedOutRemountRoot.unmount() }); signedOutRemountContainer.remove(); signedOutRemountWindow.close()
  }

  // An accepted marker binds offline fallback to its exact session_id. A stale
  // JWT for the same user must be fenced even when the farm cache is otherwise
  // valid and the session request fails only because the network is unavailable.
  const staleLineageOfflineHub = new SharedTabStorageHub()
  const staleLineageOfflineWindow = new Window({ url: 'http://auth-stale-lineage-offline.local/' })
  const staleLineageOfflineStorage = staleLineageOfflineHub.create(staleLineageOfflineWindow)
  const staleSameUserSession = { ...crossTabSessionA, access_token: authJwt(userA, 'session-a-stale'), refresh_token: 'stale' }
  staleLineageOfflineHub.values.set(authSessionKey, JSON.stringify(staleSameUserSession))
  staleLineageOfflineHub.values.set(authIntentStorageKey, JSON.stringify({ version: 1, nonce: 'accepted-session-a', phase: 'accepted', userId: userA, sessionLineage: 'session-a', startedAtMs: expiredPendingStart }))
  const staleLineageOfflineClient = testAuthClient(async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 503, message: 'Service unavailable' } }))
  const staleLineageOfflineDependencies = { ...tabDependencies(staleLineageOfflineClient.auth, staleLineageOfflineStorage, staleLineageOfflineWindow), restoreOfflineFarmUserId: () => userA, now: () => expiredPendingStart + 1000 }
  const staleLineageOfflineContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(staleLineageOfflineContainer); const staleLineageOfflineRoot = createRoot(staleLineageOfflineContainer as unknown as HTMLElement)
  try {
    await act(async () => { staleLineageOfflineRoot.render(createElement(AuthProvider, { dependencies: staleLineageOfflineDependencies, children: createElement(ExpiredPendingProbe) })) })
    for (let attempt = 0; attempt < 100 && !staleLineageOfflineContainer.textContent?.includes('signed_out:none'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)) })
    const staleLineageFence = JSON.parse(staleLineageOfflineHub.values.get(authIntentStorageKey) ?? '{}') as { phase?: string }
    assert(staleLineageOfflineContainer.textContent?.includes('signed_out:none') && staleLineageOfflineHub.values.get(authSessionKey) === undefined && staleLineageFence.phase === 'signed_out', 'A stale same-user session_id reopened accepted offline farm access during a retryable transport failure.')
  } finally {
    await act(async () => { staleLineageOfflineRoot.unmount() }); staleLineageOfflineContainer.remove(); staleLineageOfflineWindow.close()
  }

  // A local auth action advances the restore generation. Even if the original
  // getSession promise resolves afterward, it cannot replace the newer account.
  const restoreHub = new SharedTabStorageHub()
  const restoreWindow = new Window({ url: 'http://auth-restore-generation.local/' })
  const restoreStorage = restoreHub.create(restoreWindow)
  restoreHub.values.set(authSessionKey, JSON.stringify(crossTabSessionA))
  let resolveInitialRestore!: (value: unknown) => void
  const initialRestore = new Promise<unknown>((resolve) => { resolveInitialRestore = resolve })
  const restoreClient = testAuthClient(() => initialRestore)
  restoreClient.installSignIn(async () => {
    restoreStorage.setItem(authSessionKey, JSON.stringify(crossTabSessionB))
    restoreClient.broadcast('SIGNED_IN', crossTabSessionB)
    return { data: { session: crossTabSessionB }, error: null }
  })
  const restoreDependencies = tabDependencies(restoreClient.auth, restoreStorage, restoreWindow)
  let restoreSignIn!: (email: string, password: string) => Promise<void>
  let restoreSignOut!: () => Promise<void>
  function RestoreGenerationProbe() { const auth = useAuth(); restoreSignIn = auth.signIn; restoreSignOut = auth.signOut; return createElement('div', null, `${auth.phase}:${auth.user?.id ?? 'none'}`) }
  const restoreContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(restoreContainer); const restoreRoot = createRoot(restoreContainer as unknown as HTMLElement)
  try {
    await act(async () => { restoreRoot.render(createElement(AuthProvider, { dependencies: restoreDependencies, children: createElement(RestoreGenerationProbe) })); await Promise.resolve() })
    assert(restoreContainer.textContent?.includes('restoring:none'), 'The initial restore-generation fixture settled before its deferred session was released.')
    await act(async () => { await restoreSignOut(); await restoreSignIn('account-b@example.test', 'password') })
    resolveInitialRestore({ data: { session: crossTabSessionA }, error: null })
    await act(async () => { await Promise.resolve(); await new Promise((resolve) => setTimeout(resolve, 0)) })
    const restoreWinner = JSON.parse(restoreHub.values.get(authSessionKey) ?? '{}') as { user?: { id?: string } }
    assert(restoreContainer.textContent?.includes(`signed_in:${userB}`) && restoreWinner.user?.id === userB, 'The deferred initial account-A restore replaced the newer account-B auth action.')
  } finally {
    await act(async () => { restoreRoot.unmount() }); restoreContainer.remove(); restoreWindow.close()
  }

  const offlineConnectivityAuthorization = beginFarmReplayAuthorization(offlineProfile, gateStorage)
  assert(farmReplayIsOffline(), 'Production queue wiring ignored an exact offline replay grant while the browser reported online.')
  offlineConnectivityAuthorization.end()
  assert(!farmReplayIsOffline(), 'Production queue wiring retained authoritative-offline state after the exact replay grant ended.')
  const offlineReplayEvents: string[] = []
  const offlineAction = (name: string) => async () => { offlineReplayEvents.push(name) }
  const offlineReplayActions = {
    replayFieldsQueue: offlineAction('fields-queue'),
    replayFieldLocationQueue: offlineAction('field-location-queue'),
    replayProgramsQueue: offlineAction('programs-queue'),
    generateDueProgramItems: async () => { offlineReplayEvents.push('programs-due-server'); return 'generated' as const },
    replayHarvestQueue: offlineAction('harvest-queue'),
    replayGrainQueue: offlineAction('grain-queue'),
    replayInventoryQueue: offlineAction('inventory-queue'),
    replayProfitabilityQueue: offlineAction('profitability-queue'),
    inspectEquipmentTasksQueue: offlineAction('equipment-queue'),
    generateDueEquipmentTasks: offlineAction('equipment-due-server'),
    replayFieldLogQueue: offlineAction('field-log-queue'),
    replayScoutingQueue: offlineAction('scouting-queue'),
    replayNotificationsQueue: offlineAction('notifications-queue'),
  }
  let offlineRetryInstalls = 0
  let offlineAccessLoads = 0
  type GateRetryAction = Exclude<Parameters<typeof setModuleSyncRetryAction>[1], null>
  const gateInstalledRetryActions = new Map<string, GateRetryAction>()
  const captureGateRetryAction: typeof setModuleSyncRetryAction = (module, action) => {
    if (action) gateInstalledRetryActions.set(module, action)
    else gateInstalledRetryActions.delete(module)
  }
  const liveRetryGateProfile: LoadedFarmAccessProfile = { ...offlineProfile, source: 'live' }
  const offlineDependencies = {
    loadAccess: async () => { offlineAccessLoads += 1; return offlineAccessLoads === 1 ? offlineAccess : gateAccess },
    loadProfile: async (latest: FarmAccess) => latest.source === 'offline' ? offlineProfile : liveRetryGateProfile,
    replayWork: (latestProfile: LoadedFarmAccessProfile, isCurrent: () => boolean = () => true) => replayAuthorizedFarmWork(latestProfile, isCurrent, offlineReplayActions),
    installRetryActions: (latestProfile: LoadedFarmAccessProfile, revalidateAccess?: () => Promise<void>) => { offlineRetryInstalls += 1; installFarmRetryActions(latestProfile, offlineReplayActions, captureGateRetryAction, () => gateInstalledRetryActions.clear(), revalidateAccess) },
    clearRetryActions: () => gateInstalledRetryActions.clear(),
    selectFarm: async () => undefined,
  }
  function OfflineSourceProbe() { const value = useFarmAccess(); return createElement('div', null, createElement('div', null, `${value.source} farm ready`), createElement(SyncNotice)) }
  const offlineContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(offlineContainer); const offlineRoot = createRoot(offlineContainer as unknown as HTMLElement)
  try {
    await act(async () => { offlineRoot.render(createElement(FarmAccessGateForUser, { user: gateUser as never, dependencies: offlineDependencies, children: createElement(OfflineSourceProbe) })) })
    for (let attempt = 0; attempt < 100 && !offlineContainer.textContent?.includes('offline farm ready'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const expectedOfflineQueues = ['fields-queue', 'field-location-queue', 'programs-queue', 'harvest-queue', 'grain-queue', 'inventory-queue', 'profitability-queue', 'equipment-queue', 'field-log-queue', 'scouting-queue', 'notifications-queue']
    assert(offlineContainer.textContent?.includes('offline farm ready') && offlineRetryInstalls === 1, 'A valid cached offline profile did not publish the mounted farm gate ready state.')
    assert(offlineReplayEvents.join(',') === expectedOfflineQueues.join(','), 'Offline startup skipped a queue inspection or attempted server-only due generation.')
    assert(!offlineReplayEvents.includes('programs-due-server') && !offlineReplayEvents.includes('equipment-due-server'), 'Offline startup attempted a server due-generation RPC.')
    assert(farmReplayIsOffline(), 'The mounted ready shell lost its exact offline authorization after startup replay ended.')
    const readySaveCallsBefore = gateCalls.save
    const readySaveServices = createSupabaseEquipmentTasksServices({ fieldsRepository: { getData: async () => structuredClone(gateFields), saveField: async () => { throw new Error('Unexpected ready-save field operation.') } }, getFarmId: async () => farmA, getContext: currentFarmContext, projectRef: supabaseConfig.projectRef, storage: gateStorage, createId: () => id(gateId++), isOffline: farmReplayIsOffline, gateway: gateGateway })
    const readySaveQueueKey = equipmentTasksWriteQueueKey(supabaseConfig.projectRef, userA, farmA)
    await act(async () => {
      await readySaveServices.equipmentTasksRepository.saveEquipment({ id: id(918), farm_id: farmA, name: 'Ready offline machine', category: 'tractor', make: null, model: null, model_year: null, serial_or_vin: null, purchase_date: null, purchase_price: null, meter_unit: 'hours', warranty_expires_on: null, warranty_notes: null, status: 'active', notes: null })
      await new Promise<void>((resolve) => setImmediate(resolve))
    })
    assert(gateCalls.save === readySaveCallsBefore && new EquipmentTasksWriteQueue(gateStorage, readySaveQueueKey).read().entries.length === 1, 'A normal save after offline startup touched the gateway or failed to queue locally while navigator still reported online.')
    const oldOfflineProgramRetry = gateInstalledRetryActions.get('programs')
    const oldOfflineEquipmentRetry = gateInstalledRetryActions.get('equipment_tasks')
    assert(oldOfflineProgramRetry && oldOfflineEquipmentRetry, 'Mounted offline startup did not install its shared revalidation recovery action.')
    const checkSignalButton = [...offlineContainer.querySelectorAll('button')].find((button) => button.textContent === 'Check signal') as unknown as HTMLButtonElement | undefined
    assert(checkSignalButton, 'The mounted offline sync notice did not expose a farmer-facing Check signal action.')
    offlineReplayEvents.length = 0
    await act(async () => { checkSignalButton.click(); checkSignalButton.click(); await Promise.resolve() })
    for (let attempt = 0; attempt < 100 && !offlineContainer.textContent?.includes('live farm ready'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const expectedLiveRecovery = ['fields-queue', 'field-location-queue', 'programs-queue', 'programs-due-server', 'harvest-queue', 'grain-queue', 'inventory-queue', 'profitability-queue', 'equipment-queue', 'equipment-due-server', 'field-log-queue', 'scouting-queue', 'notifications-queue']
    assert(Number(offlineAccessLoads) === 2 && Number(offlineRetryInstalls) === 2, 'Multiple offline retry callbacks launched duplicate forced farm revalidations.')
    assert(offlineContainer.textContent?.includes('live farm ready') && offlineReplayEvents.join(',') === expectedLiveRecovery.join(','), 'Weak-signal recovery without an online event did not reinstall live access and run strict due generation exactly once.')
    gateStorage.removeItem(readySaveQueueKey)
  } finally { await act(async () => { offlineRoot.unmount() }); offlineContainer.remove() }
  assert(!farmReplayIsOffline(), 'Unmounting the farm gate left its ready offline authorization active.')

  // Installed recovery actions must remain queue-only for an authoritative
  // offline profile, even when the farmer taps Try again. A newly validated
  // live profile reinstalls strict queue-plus-generation callbacks.
  type CapturedFarmRetryAction = Exclude<Parameters<typeof setModuleSyncRetryAction>[1], null>
  const installedFarmRetryActions = new Map<string, CapturedFarmRetryAction>()
  const captureFarmRetryAction: typeof setModuleSyncRetryAction = (module, action) => {
    if (action) installedFarmRetryActions.set(module, action)
    else installedFarmRetryActions.delete(module)
  }
  // Mirror production ordering after the mounted gate cleanup invalidated its
  // prior grant: a completed replay establishes and releases the current grant
  // before retry callbacks are installed.
  await replayAuthorizedFarmWork(offlineProfile, () => true, offlineReplayActions)
  offlineReplayEvents.length = 0
  installFarmRetryActions(offlineProfile, offlineReplayActions, captureFarmRetryAction, () => installedFarmRetryActions.clear())
  const offlineProgramRetry = installedFarmRetryActions.get('programs')
  const offlineEquipmentRetry = installedFarmRetryActions.get('equipment_tasks')
  assert(offlineProgramRetry && offlineEquipmentRetry, 'Offline recovery did not install Program and Equipment retry actions.')
  await offlineProgramRetry()
  await offlineEquipmentRetry()
  assert(offlineReplayEvents.join(',') === 'programs-queue,equipment-queue', 'An offline Try again action called server-only due generation or skipped its local queue inspection.')

  const liveRetryEvents: string[] = []
  const liveRetryActions = {
    ...offlineReplayActions,
    replayProgramsQueue: async () => { liveRetryEvents.push('programs-queue') },
    generateDueProgramItems: async () => { liveRetryEvents.push('programs-due-server'); return 'generated' as const },
    inspectEquipmentTasksQueue: async () => { liveRetryEvents.push('equipment-queue') },
    generateDueEquipmentTasks: async () => { liveRetryEvents.push('equipment-due-server'); throw new TypeError('live due generation failed') },
  }
  const liveRetryProfile: LoadedFarmAccessProfile = { ...offlineProfile, source: 'live' }
  installFarmRetryActions(liveRetryProfile, liveRetryActions, captureFarmRetryAction, () => installedFarmRetryActions.clear())
  const liveProgramRetry = installedFarmRetryActions.get('programs')
  const liveEquipmentRetry = installedFarmRetryActions.get('equipment_tasks')
  assert(liveProgramRetry && liveEquipmentRetry, 'Live recovery did not install Program and Equipment retry actions.')
  await liveProgramRetry()
  await rejects(async () => { await liveEquipmentRetry() }, 'Live Equipment retry swallowed a strict due-generation failure.')
  assert(liveRetryEvents.join(',') === 'programs-queue,programs-due-server,equipment-queue,equipment-due-server', 'Live Try again did not await queue replay and strict due generation in order.')

  // A failed farm switch must restore Farm A's validated retry capability and
  // surface the failure in the real switcher without touching Farm A's queue.
  gateStorage.removeItem(equipmentTasksWriteQueueKey(supabaseConfig.projectRef, userA, farmA))
  resetFarmGrantFromLive(gateStorage, { projectRef: supabaseConfig.projectRef, userId: userA, farmId: farmA }, 1, stamp)
  const switchProfile: LoadedFarmAccessProfile = { ...gateProfile, operationContext: captureFarmRevocationFence(gateStorage, { projectRef: supabaseConfig.projectRef, userId: userA, farmId: farmA }) }
  const switchFarmB = { ...gateFarm, id: farmB, name: 'Gate Farm B' }
  const switchAccess = { ...gateAccess, farms: [gateFarm, switchFarmB] }
  const switchCalls = { save: 0, due: 0, install: 0, select: 0 }
  const switchGateway: EquipmentTasksDataGateway = {
    async generateDueServiceTasks() { switchCalls.due += 1; return { created_count: 0 } },
    async loadWorkspace() { return { viewer: { role: 'owner' }, equipment: [], meter_readings: [], intervals: [], service_log: [], service_due: [], members: [{ farm_id: farmA, user_id: userA, display_name: 'Switch Operator' }], tasks: [] } },
    async saveEquipment(farmId, value) { switchCalls.save += 1; return { ...value, farm_id: farmId, created_by: userA, created_at: stamp, updated_at: stamp } },
    addMeterReading: gateUnused, saveInterval: gateUnused, addServiceLogEntry: gateUnused, saveTask: gateUnused, deleteTask: gateUnused, deleteServiceLogEntry: gateUnused, deleteInterval: gateUnused,
  }
  let switchId = 920
  const switchServices = createSupabaseEquipmentTasksServices({ fieldsRepository: { getData: async () => structuredClone(gateFields), saveField: async () => { throw new Error('Unexpected switch field save.') } }, getFarmId: async () => farmA, getContext: async () => ({ userId: userA, farmId: farmA }), projectRef: supabaseConfig.projectRef, storage: gateStorage, createId: () => id(switchId++), isOffline: () => false, gateway: switchGateway })
  const switchQueue = new EquipmentTasksWriteQueue(gateStorage, equipmentTasksWriteQueueKey(supabaseConfig.projectRef, userA, farmA))
  switchQueue.append({ version: 1, module: 'equipment_tasks', kind: 'saveEquipment', operationId: id(921), userId: userA, farmId: farmA, enqueuedAt: stamp, value: { id: id(922), farm_id: farmA, name: 'Switch recovery machine', category: 'tractor', make: null, model: null, model_year: null, serial_or_vin: null, purchase_date: null, purchase_price: null, meter_unit: 'hours', warranty_expires_on: null, warranty_notes: null, status: 'active', notes: null } })
  const switchQueueBytes = gateStorage.getItem(equipmentTasksWriteQueueKey(supabaseConfig.projectRef, userA, farmA))
  const installSwitchRetry = () => { switchCalls.install += 1; setModuleSyncRetryAction('equipment_tasks', async () => { const authorization = beginFarmReplayAuthorization(switchProfile, gateStorage, { supersede: false }); try { authorization.verify(); await switchServices.replayEquipmentTasksQueue(); authorization.verify() } finally { authorization.end() } }) }
  const switchDependencies = {
    loadAccess: async () => switchAccess,
    loadProfile: async () => switchProfile,
    replayWork: async () => undefined,
    installRetryActions: installSwitchRetry,
    clearRetryActions: () => setModuleSyncRetryAction('equipment_tasks', null),
    selectFarm: async () => { switchCalls.select += 1; createFarmAccessValidationGate().begin(); throw new TypeError('network timeout during farm switch') },
  }
  function SwitchHarness() { const value = useFarmAccess(); return createElement(FarmSwitcher, { farms: value.farms, activeFarm: value.activeFarm, chooseFarm: value.chooseFarm }) }
  const confirmWindow = noticeWindow as unknown as { confirm: (message?: string) => boolean }
  const priorConfirm = confirmWindow.confirm; confirmWindow.confirm = () => true
  const switchContainer = noticeWindow.document.createElement('div'); noticeWindow.document.body.append(switchContainer); const switchRoot = createRoot(switchContainer as unknown as HTMLElement)
  try {
    await act(async () => { switchRoot.render(createElement(FarmAccessGateForUser, { user: gateUser as never, dependencies: switchDependencies, children: createElement(SwitchHarness) })) })
    for (let attempt = 0; attempt < 100 && !switchContainer.querySelector('select'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    const switchSelect = switchContainer.querySelector('select') as unknown as HTMLSelectElement | null
    assert(switchSelect?.value === farmA && switchCalls.install === 1, 'The mounted switch fixture did not open Farm A with retry actions installed.')
    switchSelect.value = farmB
    await act(async () => { switchSelect.dispatchEvent(new noticeWindow.Event('change', { bubbles: true }) as unknown as Event); await Promise.resolve() })
    for (let attempt = 0; attempt < 100 && !switchContainer.querySelector('[role="alert"]'); attempt += 1) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
    assert(switchContainer.querySelector('[role="alert"]') && switchSelect.value === farmA && Number(switchCalls.select) === 1 && Number(switchCalls.install) === 2, 'A failed farm switch was swallowed, changed the selected farm, or failed to reinstall Farm A retry actions.')
    assert(gateStorage.getItem(equipmentTasksWriteQueueKey(supabaseConfig.projectRef, userA, farmA)) === switchQueueBytes && switchQueue.read().entries.length === 1, 'A failed farm switch changed Farm A queue bytes before recovery.')
    await retrySavedChanges()
    assert(switchCalls.save === 1 && switchCalls.due === 1 && switchQueue.read().entries.length === 0 && noticeUnhandled.length === 0, 'Farm A retry did not recover exactly once after a failed switch, or the switch leaked an unhandled rejection.')
  } finally { confirmWindow.confirm = priorConfirm; await act(async () => { switchRoot.unmount() }); switchContainer.remove(); setModuleSyncRetryAction('equipment_tasks', null) }
} finally {
  process.off('unhandledRejection', recordNoticeUnhandled); noticeWindow.removeEventListener('unhandledrejection', recordWindowUnhandled); noticeWindow.close()
  for (const [name, descriptor] of priorDomGlobals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name) }
  if (priorActEnvironment) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', priorActEnvironment); else Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
  if (priorReactGlobal) Object.defineProperty(globalThis, 'React', priorReactGlobal); else Reflect.deleteProperty(globalThis, 'React')
}

let activeScoutingReadUser = userA
let releaseScoutingRead!: () => void
let sawScoutingRead!: () => void
const scoutingReadStarted = new Promise<void>((resolve) => { sawScoutingRead = resolve })
const scoutingReadRelease = new Promise<void>((resolve) => { releaseScoutingRead = resolve })
let cacheOpenCalls = 0
const priorIndexedDb = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB')
try {
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: { open() { cacheOpenCalls += 1; throw new Error('stale read reached IndexedDB') } } })
  const scoutingReadRace = new QueuedScoutingRepository({
    async getData() {
      sawScoutingRead(); await scoutingReadRelease
      const userId = activeScoutingReadUser
      return { notes: [{ id: userId, farm_id: farmA, field_id: rowId, observed_on: '2026-07-15', category: 'general', note: userId === userA ? 'User A scouting' : 'User B scouting', latitude: null, longitude: null, created_by: userId, created_at: stamp, updated_at: stamp, photos: [] }], viewer: { user_id: userId, role: 'worker' } }
    },
  } as never, { getContext: async () => ({ userId: activeScoutingReadUser, farmId: farmA }), projectRef: `${projectRef}-scouting-read-race`, storage: memory(), createId: () => id(50), clock: () => stamp, isOffline: () => false })
  const staleScoutingRead = scoutingReadRace.getData().then(() => 'resolved' as const).catch((error: unknown) => error)
  await scoutingReadStarted
  activeScoutingReadUser = userB
  releaseScoutingRead()
  const staleScoutingOutcome = await staleScoutingRead
  assert(staleScoutingOutcome instanceof Error && /signed-in account or selected farm changed/i.test(staleScoutingOutcome.message), 'A stale User A scouting read returned User B data after the live repository resolved the replacement session.')
  assert(cacheOpenCalls === 0, 'A stale User A scouting read reached the cache after resolving User B data.')
} finally {
  if (priorIndexedDb) Object.defineProperty(globalThis, 'indexedDB', priorIndexedDb)
  else Reflect.deleteProperty(globalThis, 'indexedDB')
}

const appSource = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const farmContextSource = readFileSync(new URL('../auth/farmContext.ts', import.meta.url), 'utf8')
const dataIndexSource = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')
const expectedRoutes = ['/fields', '/fields/new', '/fields/:id', '/fields/:id/edit', '/grain/*', '/inventory', '/profitability/*', '/equipment', '/tasks', '/weather', '/field-log', '/scouting', '/harvest', '/programs', '/notifications', '*', '/login', '/*']
const actualRoutes = [...appSource.matchAll(/<Route\b[^>]*?\bpath="([^"]+)"/g)].map((match) => match[1])
assert(actualRoutes.length === expectedRoutes.length && actualRoutes.every((route, index) => route === expectedRoutes[index]), `The ordered route manifest changed. Expected ${expectedRoutes.join(',')}; received ${actualRoutes.join(',')}.`)
assert(dataIndexSource.includes('const fieldsGetContext = currentFarmContext') && dataIndexSource.includes('getContext: currentFarmContext'), 'Fields or field-location production wiring still assembles user and farm identity in separate asynchronous lookups.')
assert((dataIndexSource.match(/isOffline: farmReplayIsOffline/g) ?? []).length === 11, 'A production queue lane still trusts only navigator.onLine instead of the exact offline replay grant.')
for (const replayGuardFile of ['./QueuedEquipmentTasksRepository.ts', './QueuedFieldsRepository.ts', './QueuedGrainRepository.ts', './QueuedInventoryRepository.ts', './QueuedProfitabilityRepository.ts', './QueuedFieldLogRepository.ts', './QueuedHarvestRepository.ts', './QueuedProgramsRepository.ts', './QueuedScoutingRepository.ts', './QueuedNotificationsRepository.ts', './fieldLocation.ts']) {
  const replayGuardSource = readFileSync(new URL(replayGuardFile, import.meta.url), 'utf8')
  assert((replayGuardSource.match(/isFarmReplayContextChangedError\(error\)/g) ?? []).length >= 2, `${replayGuardFile} can still swallow a typed replay-context cancellation at its source or outer replay catch.`)
  assert(replayGuardSource.includes('launchReplayInBackground') && !/void (?:this\.)?(?:replayCurrent|inspectAndReplay|replay)\(/.test(replayGuardSource), `${replayGuardFile} still launches background replay without a rejection sink.`)
  const replayIndex = Math.max(replayGuardSource.lastIndexOf('async replayCurrent'), replayGuardSource.lastIndexOf('private async replayCurrent'), replayGuardSource.lastIndexOf('async inspectAndReplay'), replayGuardSource.lastIndexOf('async function replay'))
  const lockIndex = Math.max(replayGuardSource.indexOf('await this.locked', replayIndex), replayGuardSource.indexOf('await locked(', replayIndex))
  const contextVerifyIndex = replayGuardSource.indexOf('verifyQueuedOperationContext(', lockIndex)
  const lockVerifyIndex = replayGuardSource.indexOf('verify()', contextVerifyIndex)
  const queueReadCandidates = [replayGuardSource.indexOf('queue.read()', lockIndex), replayGuardSource.indexOf('read(d.storage', lockIndex)].filter((index) => index >= 0)
  const queueReadIndex = Math.min(...queueReadCandidates)
  assert(replayIndex >= 0 && lockIndex > replayIndex && contextVerifyIndex > lockIndex && lockVerifyIndex > contextVerifyIndex && lockVerifyIndex < queueReadIndex, `${replayGuardFile} can publish replay status after waiting for a queue lock without rechecking the active farm context.`)
}
assert(!appSource.includes('generateDueItems='), 'An ordinary Notification or Programs read can still receive a due-generation mutation callback.')
assert(appSource.indexOf('notice.kind === "retry_failed"') < appSource.indexOf('notice.kind === "synced"'), 'SyncNotice can still render All changes synced before surfacing a caught retry failure.')
const replayStart = appSource.indexOf('async function replayAuthorizedFarmWork')
const replayEnd = appSource.indexOf('function FarmAccessGateForUser', replayStart)
const authorizedReplaySource = appSource.slice(replayStart, replayEnd)
for (const replay of ['replayFieldsQueue', 'replayFieldLocationQueue', 'replayProgramsQueue', 'replayHarvestQueue', 'replayGrainQueue', 'replayInventoryQueue', 'replayProfitabilityQueue', 'inspectEquipmentTasksQueue', 'replayFieldLogQueue', 'replayScoutingQueue', 'replayNotificationsQueue']) assert(authorizedReplaySource.includes(`actions.${replay}`), `The central ready gate does not await its bound ${replay} step.`)
for (const serverAction of ['generateDueProgramItems', 'generateDueEquipmentTasks']) assert(authorizedReplaySource.includes(`if (latestProfile.source === "live") await replay`) && authorizedReplaySource.includes(`actions.${serverAction}`), `The central ready gate does not keep ${serverAction} strict for live access while skipping it offline.`)
assert(!authorizedReplaySource.includes('void replay'), 'The central ready gate launches a replay after readiness instead of awaiting it.')
assert(authorizedReplaySource.indexOf('if (!isCurrent())') < authorizedReplaySource.indexOf('beginFarmReplayAuthorization(latestProfile)') && authorizedReplaySource.includes('authorization.verify()'), 'The central ready gate is not bound to one exact profile grant with pre-start and between-step cancellation.')
assert(appSource.includes('authorizedFarmRetry(latestProfile') && farmContextSource.includes('const verifyReplayContext = captureFarmReplayContextGuard()'), 'A retry or repository context lookup can bypass the exact capability-profile replay grant.')
const accessStart = appSource.indexOf('const acceptValidatedAccess = async')
const accessEnd = appSource.indexOf('const replayOnReconnect = async', accessStart)
const validatedAccessSource = appSource.slice(accessStart, accessEnd)
const centralGeneration = validatedAccessSource.indexOf('await dependencies.replayWork(latestProfile, isCurrent)')
const readyPublication = validatedAccessSource.indexOf('setProfile(latestProfile)')
assert(accessStart >= 0 && accessEnd > accessStart && replayStart >= 0 && replayEnd > replayStart && centralGeneration >= 0 && readyPublication > centralGeneration, 'The central capability-gated path does not finish every authorized replay and generation step before publishing the ready profile.')
assert(appSource.includes('replayWork: replayAuthorizedFarmWork') && appSource.split('await dependencies.replayWork(latestProfile').length - 1 === 2 && appSource.includes('const isCurrent = beginEffectValidation()') && appSource.includes('const isCurrent = beginValidation()'), 'Startup, reconnect, and initial-farm setup do not each capture a fresh validation generation before their first await.')
const currentUserStart = farmContextSource.indexOf('export async function currentUserId')
const currentUserEnd = farmContextSource.indexOf('async function fetchAccessibleFarms', currentUserStart)
const currentUserSource = farmContextSource.slice(currentUserStart, currentUserEnd)
assert(currentUserStart >= 0 && currentUserEnd > currentUserStart && currentUserSource.indexOf('const verifyReplayUser = captureFarmReplayUserGuard()') < currentUserSource.indexOf('const offlineContext = authorizedOfflineContext()') && currentUserSource.indexOf('const offlineContext = authorizedOfflineContext()') < currentUserSource.indexOf('withAbortSignal(supabase.auth.getSession()') && currentUserSource.split('return verifyReplayUser(').length - 1 === 3, 'currentUserId does not resolve an exact offline grant before network-capable auth or bind later live/browser-offline identity results to the replay grant captured before its first await.')
assert(farmContextSource.includes('target !== captured.storage') && farmContextSource.includes('verifyFarmRevocationFence(captured.storage, captured.operationContext)'), 'Replay context guards can verify a different storage scope from the one that issued the grant.')

console.log('Queued operation-context regression passed (A-to-B and regrant rejection, validation supersession, queue-lock cancellation with byte invariance, serialized aggregate retry with visible late failure, background replay rejection sinking, atomic user/farm wiring, typed replay-cancellation propagation, live writer binding, retained-cache/save-lock fencing, stale-read/cache rejection, RLS-hidden delete protection, and stale-profile replay binding).')
