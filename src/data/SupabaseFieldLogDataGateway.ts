import { supabase } from '../lib/supabaseClient'
import type { FieldLogDataGateway } from './FieldLogDataGateway'
import type { FieldLogEntryDraft } from './fieldLog'

function rows(data: unknown, error: { message: string } | null) { if (error) throw error; if (!Array.isArray(data)) throw new Error('Farm Rx could not load the field log.'); return data }
function row(data: unknown, error: { message: string } | null) { if (error) throw error; if (!data || typeof data !== 'object') throw new Error('Farm Rx could not confirm the field log change.'); return data }

export class SupabaseFieldLogDataGateway implements FieldLogDataGateway {
  async loadEntries(farmId: string, fieldId?: string) {
    let query = supabase.from('field_log_entries').select('*').eq('farm_id', farmId).order('observed_on', { ascending: false }).order('created_at', { ascending: false }).order('id')
    if (fieldId) query = query.eq('field_id', fieldId)
    const result = await query
    return rows(result.data, result.error)
  }
  async loadViewerRole(farmId: string, userId: string) {
    const result = await supabase.from('farm_memberships').select('role').eq('farm_id', farmId).eq('user_id', userId).single()
    return row(result.data, result.error)
  }
  async saveEntry(input: { farmId: string; operationId: string; entry: FieldLogEntryDraft }) {
    const { id, field_id, entry_type, observed_on, rainfall_in, note } = input.entry
    const entry = id ? { id, field_id, entry_type, observed_on, rainfall_in, note } : { field_id, entry_type, observed_on, rainfall_in, note }
    const result = await supabase.rpc('save_field_log_entry', { p_farm_id: input.farmId, p_operation_id: input.operationId, p_entry: entry })
    return row(result.data, result.error)
  }
  async deleteEntry(input: { farmId: string; entryId: string }) {
    const result = await supabase.rpc('delete_field_log_entry', { p_farm_id: input.farmId, p_entry_id: input.entryId })
    return row(result.data, result.error)
  }
}
