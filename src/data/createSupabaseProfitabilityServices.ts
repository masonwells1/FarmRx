import { QueuedProfitabilityRepository } from './QueuedProfitabilityRepository'
import { SupabaseProfitabilityDataGateway } from './SupabaseProfitabilityDataGateway'
import { SupabaseProfitabilityRepository } from './SupabaseProfitabilityRepository'
import type { FieldsRepository } from './fields'
import type { ProfitabilityRepository } from './profitability'
import type { StorageLike } from './writeQueue'

export function createSupabaseProfitabilityServices(dependencies: { fieldsRepository: FieldsRepository; getFarmId: () => Promise<string>; getContext: () => Promise<{ userId: string; farmId: string }>; projectRef: string; storage: StorageLike; createId: () => string; isOffline: () => boolean }) {
  const live = new SupabaseProfitabilityRepository({ gateway: new SupabaseProfitabilityDataGateway(), fieldsRepository: dependencies.fieldsRepository, getFarmId: dependencies.getFarmId, createId: dependencies.createId, clock: () => new Date().toISOString() })
  const queued = new QueuedProfitabilityRepository(live, { getContext: dependencies.getContext, projectRef: dependencies.projectRef, storage: dependencies.storage, createId: dependencies.createId, clock: () => new Date().toISOString(), isOffline: dependencies.isOffline })
  const profitabilityRepository: ProfitabilityRepository = queued
  return { profitabilityRepository, replayProfitabilityQueue: () => queued.inspectAndReplay() }
}
