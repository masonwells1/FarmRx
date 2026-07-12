export type NotificationCategory = 'spray' | 'rain' | 'scouting' | 'harvest' | 'service' | 'task' | 'general'

export interface Notification {
  id: string
  farm_id: string
  user_id: string
  category: NotificationCategory
  title: string
  body: string | null
  link: string | null
  dedupe_key: string | null
  read_at: string | null
  created_by: string
  created_at: string
}

export interface NotificationsData { notifications: Notification[]; unreadCount: number }
export type MarkReadResult = { kind: 'confirmed'; updatedCount: number } | { kind: 'pending' }

export interface NotificationsRepository {
  getData(): Promise<NotificationsData>
  markRead(ids: string[]): Promise<MarkReadResult>
  raiseNotification(farmId: string, recipientId: string, category: NotificationCategory, title: string, body: string, link: string, dedupeKey: string | null): Promise<Notification>
  savePushSubscription(subscription: { endpoint: string; p256dh: string; auth: string; userAgent: string }): Promise<void>
  deletePushSubscription(endpoint: string): Promise<void>
}

export const notificationCategories: readonly NotificationCategory[] = ['spray', 'rain', 'scouting', 'harvest', 'service', 'task', 'general']
