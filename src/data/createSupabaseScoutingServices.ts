import { QueuedScoutingRepository } from './QueuedScoutingRepository'
import { removeScoutingPhotos } from './scoutingStorage'
import { SupabaseScoutingDataGateway } from './SupabaseScoutingDataGateway'
import { SupabaseScoutingRepository } from './SupabaseScoutingRepository'
import type { StorageLike } from './writeQueue'
export function createSupabaseScoutingServices(d: { getFarmId: () => Promise<string>; getUserId: () => Promise<string>; getContext: () => Promise<{ userId: string; farmId: string }>; projectRef: string; storage: StorageLike; createId: () => string; isOffline: () => boolean }) { const live = new SupabaseScoutingRepository({ gateway: new SupabaseScoutingDataGateway(), getFarmId: d.getFarmId, getUserId: d.getUserId, createId: d.createId }); const queued = new QueuedScoutingRepository(live, { getContext: d.getContext, projectRef: d.projectRef, storage: d.storage, createId: d.createId, clock: () => new Date().toISOString(), isOffline: d.isOffline, removeStoragePaths: removeScoutingPhotos }); return { scoutingRepository: queued, replayScoutingQueue: () => queued.inspectAndReplay() } }
