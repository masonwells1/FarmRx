import type { FieldsRepository } from './fields'
import { QueuedHarvestRepository } from './QueuedHarvestRepository'
import { SupabaseHarvestDataGateway } from './SupabaseHarvestDataGateway'
import { SupabaseHarvestRepository } from './SupabaseHarvestRepository'
import type { StorageLike } from './writeQueue'

export function createSupabaseHarvestServices(d: { fieldsRepository: FieldsRepository; getFarmId: () => Promise<string>; getUserId: () => Promise<string>; getContext: () => Promise<{ userId: string; farmId: string }>; projectRef: string; storage: StorageLike; createId: () => string; isOffline: () => boolean }) {
  const live = new SupabaseHarvestRepository({ gateway: new SupabaseHarvestDataGateway(), fieldsRepository: d.fieldsRepository, getFarmId: d.getFarmId, getUserId: d.getUserId, createId: d.createId })
  const queued = new QueuedHarvestRepository(live, { getContext: d.getContext, projectRef: d.projectRef, storage: d.storage, createId: d.createId, clock: () => new Date().toISOString(), isOffline: d.isOffline })
  return { harvestRepository: queued, replayHarvestQueue: () => queued.inspectAndReplay() }
}
