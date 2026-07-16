import { supabase } from '../lib/supabaseClient'
import type { HarvestDataGateway } from './HarvestDataGateway'
import type { HarvestDraft } from './harvest'
import { bindFarmOperationRequest, type FarmOperationContext } from './farmOperationContext'

function row(data: unknown, error: { message: string } | null) { if (error) throw error; if (!data || typeof data !== 'object') throw new Error('Farm Rx could not confirm the harvest change.'); return data }

export class SupabaseHarvestDataGateway implements HarvestDataGateway {
  async loadViewerRole(farmId: string, userId: string) {
    const result = await supabase.from('farm_memberships').select('role').eq('farm_id', farmId).eq('user_id', userId).single()
    return row(result.data, result.error)
  }
  async saveHarvest(input: { farmId: string; operationId: string; entry: HarvestDraft }, context: FarmOperationContext) {
    const entry = { crop_assignment_id: input.entry.crop_assignment_id, harvested_bushels: input.entry.harvested_bushels, harvest_date: input.entry.harvest_date, actual_price_per_bu: input.entry.actual_price_per_bu }
    const result = await bindFarmOperationRequest(supabase.rpc('save_crop_harvest_versioned', { p_farm_id: input.farmId, p_operation_id: input.operationId, p_expected_updated_at: input.entry.expected_updated_at ?? null, p_entry: entry }), context)
    return row(result.data, result.error)
  }
}
