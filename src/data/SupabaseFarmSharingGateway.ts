import { supabase } from '../lib/supabaseClient'
import { bindFarmOperationRequest, type FarmOperationContext } from './farmOperationContext'
import type { FarmSharingGateway, FarmSharingInput } from './farmSharing'

export class SupabaseFarmSharingGateway implements FarmSharingGateway {
  async updateFarmSharing(input: FarmSharingInput, context: FarmOperationContext): Promise<unknown> {
    const request = supabase
      .from('farms')
      .update({ share_with_rep: input.shareWithRep })
      .eq('id', input.farmId)
      .eq('updated_at', input.expectedUpdatedAt)
      .select('*')
      .maybeSingle()
    const { data, error } = await bindFarmOperationRequest(request, context)
    if (error) throw error
    if (!data) throw new Error('This privacy setting changed somewhere else. Check the current setting and try again.')
    return data
  }
}
