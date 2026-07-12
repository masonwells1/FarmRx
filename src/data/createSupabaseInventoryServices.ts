import { QueuedInventoryRepository } from './QueuedInventoryRepository'
import { SupabaseInventoryDataGateway } from './SupabaseInventoryDataGateway'
import { SupabaseInventoryRepository } from './SupabaseInventoryRepository'
import type { FieldsRepository } from './fields'
import type { InventoryRepository } from './inventory'
import type { StorageLike } from './writeQueue'

export function createSupabaseInventoryServices(dependencies: { fieldsRepository: FieldsRepository; getFarmId: () => Promise<string>; getContext: () => Promise<{ userId: string; farmId: string }>; projectRef: string; storage: StorageLike; createId: () => string; isOffline: () => boolean }) {
  const live = new SupabaseInventoryRepository({ gateway: new SupabaseInventoryDataGateway(), fieldsRepository: dependencies.fieldsRepository, getFarmId: dependencies.getFarmId, createId: dependencies.createId, clock: () => new Date().toISOString() })
  const queued = new QueuedInventoryRepository(live, { getContext: dependencies.getContext, projectRef: dependencies.projectRef, storage: dependencies.storage, createId: dependencies.createId, clock: () => new Date().toISOString(), isOffline: dependencies.isOffline })
  const inventoryRepository: InventoryRepository = queued
  return { inventoryRepository, replayInventoryQueue: () => queued.inspectAndReplay() }
}
