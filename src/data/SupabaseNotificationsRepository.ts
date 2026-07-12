import type { NotificationsDataGateway } from './NotificationsDataGateway'
import { notificationCategories, type MarkReadResult, type Notification, type NotificationCategory, type NotificationsData, type NotificationsRepository } from './notifications'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const fail = (): never => { throw new Error('Farm Rx found invalid alert data. Please contact support.') }
const obj = (value: unknown) => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(); return value as Record<string, unknown> }
const id = (value: unknown) => typeof value === 'string' && uuid.test(value) ? value : fail()
const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max ? value : fail()
const nullableText = (value: unknown, max: number) => value === null ? null : text(value, max)
const stamp = (value: unknown) => { const result = text(value, 64); return Number.isNaN(Date.parse(result)) ? fail() : result }
const nullableRoute = (value: unknown) => { if (value === null) return null; const result = text(value, 200); return result.startsWith('/') && !result.startsWith('//') ? result : fail() }

export function mapNotification(value: unknown, expected?: { farmId?: string; recipientId?: string }): Notification {
  const row = obj(value); const category = text(row.category, 20)
  if (!notificationCategories.includes(category as NotificationCategory)) fail()
  const result: Notification = { id: id(row.id), farm_id: id(row.farm_id), user_id: id(row.user_id), category: category as NotificationCategory, title: text(row.title, 160), body: nullableText(row.body, 500), link: nullableRoute(row.link), dedupe_key: nullableText(row.dedupe_key, 200), read_at: row.read_at === null ? null : stamp(row.read_at), created_by: id(row.created_by), created_at: stamp(row.created_at) }
  if ((expected?.farmId && result.farm_id !== expected.farmId) || (expected?.recipientId && result.user_id !== expected.recipientId)) fail()
  return result
}
function validateRaise(input: { farmId: string; recipientId: string; category: NotificationCategory; title: string; body: string; link: string; dedupeKey: string | null }) { if (!uuid.test(input.farmId) || !uuid.test(input.recipientId) || !notificationCategories.includes(input.category) || !input.title.trim() || input.title.length > 160 || !input.body.trim() || input.body.length > 500 || !input.link.startsWith('/') || input.link.startsWith('//') || (input.dedupeKey !== null && (typeof input.dedupeKey !== 'string' || !input.dedupeKey || input.dedupeKey.length > 200))) fail() }
function validateIds(ids: string[]) { if (!Array.isArray(ids) || !ids.length || ids.some((value) => !uuid.test(value))) fail() }

export class SupabaseNotificationsRepository implements NotificationsRepository {
  constructor(private readonly d: { gateway: NotificationsDataGateway; getUserId: () => Promise<string> }) {}
  async getData(): Promise<NotificationsData> { const userId = await this.d.getUserId(); const notifications = (await this.d.gateway.loadNotifications()).map((row) => mapNotification(row, { recipientId: userId })); return { notifications, unreadCount: notifications.filter((notification) => notification.read_at === null).length } }
  async markRead(ids: string[]): Promise<MarkReadResult> { validateIds(ids); const userId = await this.d.getUserId(); const receipt = obj(await this.d.gateway.markRead(ids)); const count = receipt.updated_count; if (typeof count !== 'number' || !Number.isInteger(count) || count < 0 || count > ids.length) fail(); void userId; return { kind: 'confirmed', updatedCount: Number(count) } }
  async markReadOperation(ids: string[]) { return this.markRead(ids) }
  async raiseNotification(farmId: string, recipientId: string, category: NotificationCategory, title: string, body: string, link: string, dedupeKey: string | null) { const input = { farmId, recipientId, category, title, body, link, dedupeKey }; validateRaise(input); return mapNotification(await this.d.gateway.createNotification(input), { farmId, recipientId }) }
  async savePushSubscription(subscription: { endpoint: string; p256dh: string; auth: string; userAgent: string }) { if (!subscription.endpoint || !subscription.p256dh || !subscription.auth || !subscription.userAgent) fail(); const receipt = obj(await this.d.gateway.savePushSubscription(subscription)); if (receipt.saved !== true && receipt.endpoint !== subscription.endpoint) fail() }
  async deletePushSubscription(endpoint: string) { if (!endpoint) fail(); const receipt = obj(await this.d.gateway.deletePushSubscription(endpoint)); if (receipt.deleted !== true && receipt.endpoint !== endpoint && (typeof receipt.deleted_count !== 'number' || !Number.isInteger(receipt.deleted_count) || receipt.deleted_count < 0 || receipt.deleted_count > 1)) fail() }
}
