import { QueuedNotificationsRepository } from './QueuedNotificationsRepository'
import { SupabaseNotificationsDataGateway } from './SupabaseNotificationsDataGateway'
import { SupabaseNotificationsRepository } from './SupabaseNotificationsRepository'
import type { StorageLike } from './writeQueue'
export function createSupabaseNotificationsServices(d: { getUserId: () => Promise<string>; getContext: () => Promise<{ userId: string; farmId: string }>; projectRef: string; storage: StorageLike; createId: () => string; isOffline: () => boolean }) { const live = new SupabaseNotificationsRepository({ gateway: new SupabaseNotificationsDataGateway(), getUserId: d.getUserId }); const queued = new QueuedNotificationsRepository(live, { getContext: d.getContext, projectRef: d.projectRef, storage: d.storage, createId: d.createId, clock: () => new Date().toISOString(), isOffline: d.isOffline }); return { notificationsRepository: queued, replayNotificationsQueue: () => queued.inspectAndReplay() } }
