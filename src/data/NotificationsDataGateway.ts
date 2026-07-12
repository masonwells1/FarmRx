import type { NotificationCategory } from './notifications'

export interface NotificationsDataGateway {
  loadNotifications(): Promise<unknown[]>
  markRead(ids: string[]): Promise<unknown>
  createNotification(input: { farmId: string; recipientId: string; category: NotificationCategory; title: string; body: string; link: string; dedupeKey: string | null }): Promise<unknown>
  savePushSubscription(input: { endpoint: string; p256dh: string; auth: string; userAgent: string }): Promise<unknown>
  deletePushSubscription(endpoint: string): Promise<unknown>
}
