import { supabase } from '../lib/supabaseClient'
import type { NotificationsDataGateway } from './NotificationsDataGateway'
import type { NotificationCategory } from './notifications'
import { bindFarmOperationRequest, type FarmOperationContext } from './farmOperationContext'

const rows = (data: unknown, error: { message: string } | null) => { if (error) throw error; if (!Array.isArray(data)) throw new Error('Farm Rx could not load alerts.'); return data }
const row = (data: unknown, error: { message: string } | null) => { if (error) throw error; if (!data || typeof data !== 'object') throw new Error('Farm Rx could not confirm the alert change.'); return data }

export class SupabaseNotificationsDataGateway implements NotificationsDataGateway {
  async loadNotifications() { const result = await supabase.from('notifications').select('*').order('created_at', { ascending: false }).order('id', { ascending: false }); return rows(result.data, result.error) }
  async markRead(ids: string[], context: FarmOperationContext) { const result = await bindFarmOperationRequest(supabase.rpc('mark_notifications_read', { p_ids: ids }), context); return row(result.data, result.error) }
  async createNotification(input: { farmId: string; recipientId: string; category: NotificationCategory; title: string; body: string; link: string; dedupeKey: string | null }, context: FarmOperationContext) { const result = await bindFarmOperationRequest(supabase.rpc('create_notification', { p_farm_id: input.farmId, p_recipient: input.recipientId, p_category: input.category, p_title: input.title, p_body: input.body, p_link: input.link, p_dedupe_key: input.dedupeKey }), context); return row(result.data, result.error) }
  async savePushSubscription(input: { endpoint: string; p256dh: string; auth: string; userAgent: string }, context: FarmOperationContext) { const result = await bindFarmOperationRequest(supabase.rpc('save_push_subscription', { p_farm_id: context.farmId, p_endpoint: input.endpoint, p_p256dh: input.p256dh, p_auth: input.auth, p_user_agent: input.userAgent }), context); return row(result.data, result.error) }
  async deletePushSubscription(endpoint: string, context: FarmOperationContext) { const result = await bindFarmOperationRequest(supabase.rpc('delete_push_subscription', { p_farm_id: context.farmId, p_endpoint: endpoint }), context); return row(result.data, result.error) }
}
