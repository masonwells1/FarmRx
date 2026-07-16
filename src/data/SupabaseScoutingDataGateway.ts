import { supabase } from '../lib/supabaseClient'
import type { ScoutingDataGateway } from './ScoutingDataGateway'
import type { ScoutingNoteDraft } from './scouting'
import { bindFarmOperationRequest, type FarmOperationContext } from './farmOperationContext'
const rows = (data: unknown, error: { message: string } | null) => { if (error) throw error; if (!Array.isArray(data)) throw new Error('Farm Rx could not load scouting notes.'); return data }
const row = (data: unknown, error: { message: string } | null) => { if (error) throw error; if (!data || typeof data !== 'object') throw new Error('Farm Rx could not confirm the scouting change.'); return data }
export class SupabaseScoutingDataGateway implements ScoutingDataGateway {
  async loadNotes(farmId: string, fieldId?: string) { let query = supabase.from('scouting_notes').select('*').eq('farm_id', farmId).order('observed_on', { ascending: false }).order('created_at', { ascending: false }).order('id'); if (fieldId) query = query.eq('field_id', fieldId); const result = await query; return rows(result.data, result.error) }
  async loadPhotos(farmId: string) { const result = await supabase.from('scouting_photos').select('*').eq('farm_id', farmId).order('created_at').order('id'); return rows(result.data, result.error) }
  async loadViewerRole(farmId: string, userId: string) { const result = await supabase.from('farm_memberships').select('role').eq('farm_id', farmId).eq('user_id', userId).single(); return row(result.data, result.error) }
  async saveNote(input: { farmId: string; operationId: string; note: ScoutingNoteDraft }, context: FarmOperationContext) { const { id, field_id, observed_on, category, note, latitude, longitude, photos, create_task } = input.note; const p_note = { ...(id ? { id } : {}), field_id, observed_on, category, note, latitude, longitude, photos, create_task }; const result = await bindFarmOperationRequest(supabase.rpc('save_scouting_note', { p_farm_id: input.farmId, p_operation_id: input.operationId, p_note }), context); return row(result.data, result.error) }
  async deleteNote(input: { farmId: string; noteId: string }, context: FarmOperationContext) { const result = await bindFarmOperationRequest(supabase.rpc('delete_scouting_note', { p_farm_id: input.farmId, p_note_id: input.noteId }), context); return row(result.data, result.error) }
}
