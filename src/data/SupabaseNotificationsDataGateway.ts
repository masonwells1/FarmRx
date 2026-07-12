import { supabase } from '../lib/supabaseClient'
import type { NotificationsDataGateway } from './NotificationsDataGateway'
import type { NotificationCategory } from './notifications'

const rows = (data: unknown, error: { message: string } | null) => { if (error) throw error; if (!Array.isArray(data)) throw new Error('Farm Rx could not load alerts.'); return data }
const row = (data: unknown, error: { message: string } | null) => { if (error) throw error; if (!data || typeof data !== 'object') throw new Error('Farm Rx could not confirm the alert change.'); return data }

export class SupabaseNotificationsDataGateway implements NotificationsDataGateway {
  async loadNotifications() { const result = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }); return rows(result.data, result.error) }
  async markRead(ids: string[]) { const result = await supabase.rpc('mark_notifications_read', { p_ids: ids }); return row(result.data, result.error) }
  async createNotification(input: { farmId: string; recipientId: string; category: NotificationCategory; title: string; body: string; link: string; dedupeKey: string | null }) { const result = await supabase.rpc('create_notification', { p_farm_id: input.farmId, p_recipient: input.recipientId, p_category: input.category, p_title: input.title, p_body: input.body, p_link: input.link, p_dedupe_key: input.dedupeKey }); return row(result.data, result.error) }
  async savePushSubscription(input: { endpoint: string; p256dh: string; auth: string; userAgent: string }) { const result = await supabase.rpc('save_push_subscription', { p_endpoint: input.endpoint, p_p256dh: input.p256dh, p_auth: input.auth, p_user_agent: input.userAgent }); return row(result.data, result.error) }
  async deletePushSubscription(endpoint: string) { const result = await supabase.rpc('delete_push_subscription', { p_endpoint: endpoint }); return row(result.data, result.error) }
}
