import { QueuedFieldLogRepository } from './QueuedFieldLogRepository'
import { SupabaseFieldLogDataGateway } from './SupabaseFieldLogDataGateway'
import { SupabaseFieldLogRepository } from './SupabaseFieldLogRepository'
import type { StorageLike } from './writeQueue'

export function createSupabaseFieldLogServices(d: { getFarmId: () => Promise<string>; getUserId: () => Promise<string>; getContext: () => Promise<{ userId: string; farmId: string }>; projectRef: string; storage: StorageLike; createId: () => string; isOffline: () => boolean }) {
  const live = new SupabaseFieldLogRepository({ gateway: new SupabaseFieldLogDataGateway(), getFarmId: d.getFarmId, getUserId: d.getUserId, createId: d.createId })
  const queued = new QueuedFieldLogRepository(live, { getContext: d.getContext, projectRef: d.projectRef, storage: d.storage, createId: d.createId, clock: () => new Date().toISOString(), isOffline: d.isOffline })
  return { fieldLogRepository: queued, replayFieldLogQueue: () => queued.inspectAndReplay() }
}
