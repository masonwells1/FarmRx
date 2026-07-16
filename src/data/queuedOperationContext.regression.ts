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
import type { StorageLike } from './writeQueue'
import { bindFarmOperationRequest, type FarmOperationContext } from './farmOperationContext'
import { resetFarmGrantFromLive } from './farmRevocationFence'
import { createFieldLocationClient, parseFieldLocationQueue } from './fieldLocation'

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const userA = id(1); const userB = id(2); const farmA = id(3); const farmB = id(4); const rowId = id(5)
const projectRef = 'queued-context-regression'
const stamp = '2026-07-15T12:00:00.000000+00:00'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function isReadContextError(error: unknown) { return error instanceof Error && (error.name === 'WorkspaceMemoryChangedError' || /signed-in account or selected farm changed/i.test(error.message)) }
function memory(): StorageLike { const values = new Map<string, string>(); return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) } }
function switchingContext() { let calls = 0; return async () => { calls += 1; return calls === 1 ? { userId: userA, farmId: farmA } : { userId: userB, farmId: farmA } } }
function sameContextAcrossRegrant(storage: StorageLike, ref: string) { let calls = 0; return async () => { calls += 1; if (calls === 2) resetFarmGrantFromLive(storage, { projectRef: ref, userId: userA, farmId: farmA }, 2, '2026-07-15T12:01:00.000Z'); return { userId: userA, farmId: farmA } } }
function forbiddenWriter(counter: { calls: number }) { return new Proxy({}, { get: () => async () => { counter.calls += 1; throw new Error('writer reached') } }) }
async function rejects(action: () => Promise<unknown>, message: string) { let rejected = false; try { await action() } catch { rejected = true } assert(rejected, message) }
async function rejectsChangedContext(action: () => Promise<unknown>, message: string) { try { await action() } catch (error) { assert(error instanceof Error && /signed-in account or selected farm changed/i.test(error.message), message); return } throw new Error(message) }
const operationContext = (userId: string, farmId: string, generation = 1, serverEpoch = 1): FarmOperationContext => ({ projectRef, userId, farmId, generation, token: id(900 + generation), serverEpoch })

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
await rejectsChangedContext(() => new SupabaseEquipmentTasksRepository({ gateway: neverGateway as never, fieldsRepository: neverFields as never, getFarmId: async () => farmA, getUserId: async () => userB, getOperationContext: async () => contextB, verifyOperationContext: verifyAsB, createId: () => id(20) }).deleteTaskOperation(rowId, contextA), 'Equipment live writer did not bind the queued user before resolving its gateway operation.')
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
  if (queue.key === grainWriteQueueKey(`${projectRef}-grain-final-lock`, userA, farmA) && ++grainALockCount === 2) { sawGrainAFinalLock(); await grainAFinalLockRelease }
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
  if (queue.key === profitabilityWriteQueueKey(`${projectRef}-profitability-final-lock`, userA, farmA) && ++profitabilityALockCount === 2) { sawProfitabilityAFinalLock(); await profitabilityAFinalLockRelease }
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

console.log('Queued operation-context regression passed (A-to-B and regrant rejection, live writer binding, retained-cache/save-lock fencing, stale-read/cache rejection, and RLS-hidden delete replay protection).')
