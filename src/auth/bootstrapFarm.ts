import { supabase } from '../lib/supabaseClient'
import type { EntityType, Farm } from '../data/fields'

export async function findOnlyAccessibleFarm(): Promise<Farm | null> {
  const { data, error } = await supabase.from('farms').select('*')
  if (error) throw error
  if (data.length > 1) throw new Error('We found more than one farm for this account. Crop RX needs to finish your setup.')
  return data.length === 1 ? data[0] as Farm : null
}

export async function bootstrapInitialOwnerFarm(input: { farmName: string; entityName: string; selectedEntityType: EntityType }) {
  const { data, error } = await supabase.rpc('bootstrap_first_farm', { p_farm_name: input.farmName.trim(), p_entity_name: input.entityName.trim(), p_entity_type: input.selectedEntityType })
  if (error || !data || typeof data !== 'object' || !('farm' in data) || !('entity' in data)) {
    const detail = error?.message?.toLowerCase() ?? ''
    if (/permission|not allowed|onboarding/.test(detail)) throw new Error('Crop RX needs to finish your farm setup.')
    if (/network|fetch|timeout|connection/.test(detail)) throw new Error('We could not reach Farm Rx. Check your signal and try again.')
    throw new Error('Farm Rx could not finish your setup right now. Please try again.')
  }
  return data as { farm: Farm; entity: { id: string } }
}
