import type { NotificationCategory } from './notifications'
import type { FarmOperationContext } from './farmOperationContext'

export interface NotificationsDataGateway {
  loadNotifications(): Promise<unknown[]>
  markRead(ids: string[], context: FarmOperationContext): Promise<unknown>
  createNotification(input: { farmId: string; recipientId: string; category: NotificationCategory; title: string; body: string; link: string; dedupeKey: string | null }, context: FarmOperationContext): Promise<unknown>
  savePushSubscription(input: { endpoint: string; p256dh: string; auth: string; userAgent: string }, context: FarmOperationContext): Promise<unknown>
  deletePushSubscription(endpoint: string, context: FarmOperationContext): Promise<unknown>
}
