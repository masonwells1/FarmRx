import { MockMarketDataService, createGrainId } from './MockGrainRepository'
import { QueuedGrainRepository } from './QueuedGrainRepository'
import { SupabaseGrainDataGateway } from './SupabaseGrainDataGateway'
import { SupabaseGrainRepository } from './SupabaseGrainRepository'
import type { FieldsRepository } from './fields'
import type { GrainServices } from './grain'
import type { ProfitabilityRepository } from './profitability'
import type { StorageLike } from './writeQueue'
import { captureFarmOperationContext, verifyFarmOperationContext } from './farmOperationContext'

export function createSupabaseGrainServices(dependencies: { fieldsRepository: FieldsRepository; profitabilityRepository: ProfitabilityRepository; getFarmId: () => Promise<string>; getContext: () => Promise<{ userId: string; farmId: string }>; projectRef: string; storage: StorageLike; isOffline: () => boolean }) {
  const getOperationContext = async () => captureFarmOperationContext(dependencies.storage, dependencies.projectRef, await dependencies.getContext())
  const verifyOperationContext = async (expected: Awaited<ReturnType<typeof getOperationContext>>) => verifyFarmOperationContext(dependencies.storage, expected, await getOperationContext())
  const live = new SupabaseGrainRepository({ gateway: new SupabaseGrainDataGateway(), fieldsRepository: dependencies.fieldsRepository, getFarmId: dependencies.getFarmId, getOperationContext, verifyOperationContext, createId: createGrainId, clock: () => new Date().toISOString() })
  const queued = new QueuedGrainRepository(live, { getContext: dependencies.getContext, projectRef: dependencies.projectRef, storage: dependencies.storage, createId: createGrainId, clock: () => new Date().toISOString(), isOffline: dependencies.isOffline })
  const services: GrainServices = { grainRepository: queued, marketDataService: new MockMarketDataService(), profitabilityRepository: dependencies.profitabilityRepository, createGrainId }
  return { services, replayGrainQueue: () => queued.inspectAndReplay() }
}
