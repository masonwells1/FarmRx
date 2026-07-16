import { QueuedProfitabilityRepository } from './QueuedProfitabilityRepository'
import { SupabaseProfitabilityDataGateway } from './SupabaseProfitabilityDataGateway'
import { SupabaseProfitabilityRepository } from './SupabaseProfitabilityRepository'
import type { FieldsRepository } from './fields'
import type { ProfitabilityRepository } from './profitability'
import type { StorageLike } from './writeQueue'
import { captureFarmOperationContext, verifyFarmOperationContext } from './farmOperationContext'

export function createSupabaseProfitabilityServices(dependencies: { fieldsRepository: FieldsRepository; getFarmId: () => Promise<string>; getContext: () => Promise<{ userId: string; farmId: string }>; projectRef: string; storage: StorageLike; createId: () => string; isOffline: () => boolean }) {
  const getOperationContext = async () => captureFarmOperationContext(dependencies.storage, dependencies.projectRef, await dependencies.getContext())
  const verifyOperationContext = async (expected: Awaited<ReturnType<typeof getOperationContext>>) => verifyFarmOperationContext(dependencies.storage, expected, await getOperationContext())
  const live = new SupabaseProfitabilityRepository({ gateway: new SupabaseProfitabilityDataGateway(), fieldsRepository: dependencies.fieldsRepository, getFarmId: dependencies.getFarmId, getOperationContext, verifyOperationContext, createId: dependencies.createId, clock: () => new Date().toISOString() })
  const queued = new QueuedProfitabilityRepository(live, { getContext: dependencies.getContext, projectRef: dependencies.projectRef, storage: dependencies.storage, createId: dependencies.createId, clock: () => new Date().toISOString(), isOffline: dependencies.isOffline })
  const profitabilityRepository: ProfitabilityRepository = queued
  return { profitabilityRepository, replayProfitabilityQueue: () => queued.inspectAndReplay() }
}
