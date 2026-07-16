import { QueuedFieldLogRepository } from './QueuedFieldLogRepository'
import { SupabaseFieldLogDataGateway } from './SupabaseFieldLogDataGateway'
import { SupabaseFieldLogRepository } from './SupabaseFieldLogRepository'
import type { StorageLike } from './writeQueue'
import { captureFarmOperationContext, verifyFarmOperationContext } from './farmOperationContext'

export function createSupabaseFieldLogServices(d: { getFarmId: () => Promise<string>; getUserId: () => Promise<string>; getContext: () => Promise<{ userId: string; farmId: string }>; projectRef: string; storage: StorageLike; createId: () => string; isOffline: () => boolean }) {
  const getOperationContext = async () => captureFarmOperationContext(d.storage, d.projectRef, await d.getContext())
  const verifyOperationContext = async (expected: Awaited<ReturnType<typeof getOperationContext>>) => verifyFarmOperationContext(d.storage, expected, await getOperationContext())
  const live = new SupabaseFieldLogRepository({ gateway: new SupabaseFieldLogDataGateway(), getFarmId: d.getFarmId, getUserId: d.getUserId, getOperationContext, verifyOperationContext, createId: d.createId })
  const queued = new QueuedFieldLogRepository(live, { getContext: d.getContext, projectRef: d.projectRef, storage: d.storage, createId: d.createId, clock: () => new Date().toISOString(), isOffline: d.isOffline })
  return { fieldLogRepository: queued, replayFieldLogQueue: () => queued.inspectAndReplay() }
}
