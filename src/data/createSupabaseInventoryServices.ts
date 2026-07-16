import { QueuedInventoryRepository } from './QueuedInventoryRepository'
import { SupabaseInventoryDataGateway } from './SupabaseInventoryDataGateway'
import { SupabaseInventoryRepository } from './SupabaseInventoryRepository'
import type { FieldsRepository } from './fields'
import type { InventoryRepository } from './inventory'
import type { StorageLike } from './writeQueue'
import { captureFarmOperationContext, verifyFarmOperationContext } from './farmOperationContext'

export function createSupabaseInventoryServices(dependencies: { fieldsRepository: FieldsRepository; getFarmId: () => Promise<string>; getContext: () => Promise<{ userId: string; farmId: string }>; projectRef: string; storage: StorageLike; createId: () => string; isOffline: () => boolean }) {
  const getOperationContext = async () => captureFarmOperationContext(dependencies.storage, dependencies.projectRef, await dependencies.getContext())
  const verifyOperationContext = async (expected: Awaited<ReturnType<typeof getOperationContext>>) => verifyFarmOperationContext(dependencies.storage, expected, await getOperationContext())
  const live = new SupabaseInventoryRepository({ gateway: new SupabaseInventoryDataGateway(), fieldsRepository: dependencies.fieldsRepository, getFarmId: dependencies.getFarmId, getOperationContext, verifyOperationContext, createId: dependencies.createId, clock: () => new Date().toISOString() })
  const queued = new QueuedInventoryRepository(live, { getContext: dependencies.getContext, projectRef: dependencies.projectRef, storage: dependencies.storage, createId: dependencies.createId, clock: () => new Date().toISOString(), isOffline: dependencies.isOffline })
  const inventoryRepository: InventoryRepository = queued
  return { inventoryRepository, replayInventoryQueue: () => queued.inspectAndReplay() }
}
