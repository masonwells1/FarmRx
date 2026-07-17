import { QueuedEquipmentTasksRepository } from './QueuedEquipmentTasksRepository'
import type { EquipmentTasksDataGateway } from './EquipmentTasksDataGateway'
import { SupabaseEquipmentTasksDataGateway } from './SupabaseEquipmentTasksDataGateway'
import { SupabaseEquipmentTasksRepository } from './SupabaseEquipmentTasksRepository'
import type { FieldsRepository } from './fields'
import type { StorageLike } from './writeQueue'
import { captureFarmOperationContext, verifyFarmOperationContext } from './farmOperationContext'
export function createSupabaseEquipmentTasksServices(d: { fieldsRepository: FieldsRepository; getFarmId: () => Promise<string>; getContext: () => Promise<{ userId: string; farmId: string }>; projectRef: string; storage: StorageLike; createId: () => string; isOffline: () => boolean; gateway?: EquipmentTasksDataGateway }) {
  const getOperationContext = async () => captureFarmOperationContext(d.storage, d.projectRef, await d.getContext())
  const verifyOperationContext = async (expected: Awaited<ReturnType<typeof getOperationContext>>) => verifyFarmOperationContext(d.storage, expected, await getOperationContext())
  const verifySnapshotContext = (expected: Awaited<ReturnType<typeof getOperationContext>>) => verifyFarmOperationContext(d.storage, expected, captureFarmOperationContext(d.storage, d.projectRef, { userId: expected.userId, farmId: expected.farmId }))
  const clock = () => new Date().toISOString()
  const live = new SupabaseEquipmentTasksRepository({ gateway: d.gateway ?? new SupabaseEquipmentTasksDataGateway(), fieldsRepository: d.fieldsRepository, getFarmId: d.getFarmId, getUserId: async () => (await d.getContext()).userId, getOperationContext, verifyOperationContext, verifySnapshotContext, createId: d.createId, clock })
  const queued = new QueuedEquipmentTasksRepository(live, { ...d, clock })
  const inspectEquipmentTasksQueue = () => queued.inspectAndReplay()
  const generateDueEquipmentTasks = () => live.generateDueTasks()
  return {
    equipmentTasksRepository: queued,
    inspectEquipmentTasksQueue,
    generateDueEquipmentTasks,
    replayEquipmentTasksQueue: async () => { await inspectEquipmentTasksQueue(); await generateDueEquipmentTasks() },
  }
}
