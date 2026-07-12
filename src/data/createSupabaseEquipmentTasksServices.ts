import { QueuedEquipmentTasksRepository } from './QueuedEquipmentTasksRepository'
import { SupabaseEquipmentTasksDataGateway } from './SupabaseEquipmentTasksDataGateway'
import { SupabaseEquipmentTasksRepository } from './SupabaseEquipmentTasksRepository'
import type { FieldsRepository } from './fields'
import type { StorageLike } from './writeQueue'
export function createSupabaseEquipmentTasksServices(d: { fieldsRepository: FieldsRepository; getFarmId: () => Promise<string>; getContext: () => Promise<{ userId: string; farmId: string }>; projectRef: string; storage: StorageLike; createId: () => string; isOffline: () => boolean }) { const live = new SupabaseEquipmentTasksRepository({ gateway: new SupabaseEquipmentTasksDataGateway(), fieldsRepository: d.fieldsRepository, getFarmId: d.getFarmId, getUserId: async () => (await d.getContext()).userId, createId: d.createId }); const queued = new QueuedEquipmentTasksRepository(live, { ...d, clock: () => new Date().toISOString() }); return { equipmentTasksRepository: queued, replayEquipmentTasksQueue: () => queued.inspectAndReplay() } }
