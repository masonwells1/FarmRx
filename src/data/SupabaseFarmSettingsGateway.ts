import { supabase } from '../lib/supabaseClient'
import { bindFarmOperationRequest, type FarmOperationContext } from './farmOperationContext'
import type { FarmMarketRegionInput, FarmSettingsGateway } from './farmSettings'

export class SupabaseFarmSettingsGateway implements FarmSettingsGateway {
  async updateFarmMarketRegion(input: FarmMarketRegionInput, context: FarmOperationContext): Promise<unknown> {
    const request = supabase
      .from('farms')
      .update({ market_region: input.marketRegion })
      .eq('id', input.farmId)
      .eq('updated_at', input.expectedUpdatedAt)
      .select('*')
      .maybeSingle()
    const { data, error } = await bindFarmOperationRequest(request, context)
    if (error) throw error
    if (!data) throw new Error('This farm setting changed somewhere else. Check the current setting and try again.')
    return data
  }
}
