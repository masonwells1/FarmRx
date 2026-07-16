import { supabase } from '../lib/supabaseClient'
import type { FieldsDataGateway, FieldsRowBundle, SaveFieldBundleInput, SavedFieldBundle } from './FieldsDataGateway'
import { bindFarmOperationRequest, type FarmOperationContext } from './farmOperationContext'

function required<T>(data: T, error: { message: string } | null): T {
  if (error) throw error
  return data
}
function requiredArray(data: unknown[] | null, error: { message: string } | null): unknown[] {
  if (error) throw error
  if (!Array.isArray(data)) throw new Error('Farm Rx could not load the farm records.')
  return data
}

export class SupabaseFieldsDataGateway implements FieldsDataGateway {
  async loadWorkspace(farmId: string): Promise<FieldsRowBundle> {
    const farmResult = await supabase.from('farms').select('*').eq('id', farmId).single()
    const farm = required(farmResult.data, farmResult.error)
    const [entities, fields, cropAssignments, arrangements, commodities] = await Promise.all([
      supabase.from('entities').select('*').eq('farm_id', farmId).order('name'),
      supabase.from('fields').select('*').eq('farm_id', farmId).order('name'),
      supabase.from('crop_assignments').select('*').eq('farm_id', farmId).order('crop_year').order('planting_sequence'),
      supabase.from('arrangements').select('*').eq('farm_id', farmId).order('effective_from'),
      supabase.from('commodities').select('*').eq('is_active', true).order('name'),
    ])
    return {
      farm,
      entities: requiredArray(entities.data, entities.error),
      fields: requiredArray(fields.data, fields.error),
      crop_assignments: requiredArray(cropAssignments.data, cropAssignments.error),
      arrangements: requiredArray(arrangements.data, arrangements.error),
      commodities: requiredArray(commodities.data, commodities.error),
    }
  }

  async saveFieldBundle(input: SaveFieldBundleInput, context: FarmOperationContext): Promise<SavedFieldBundle> {
    const { data, error } = await bindFarmOperationRequest(supabase.rpc('save_field_bundle_versioned', { p_farm_id: input.farmId, p_operation_id: input.operationId, p_expected_versions: input.draft.expected_versions ?? null, p_draft: input.draft }), context)
    if (error) throw error
    if (!data || typeof data !== 'object') throw new Error('Farm Rx could not confirm the field save. Please try again.')
    const result = data as Record<string, unknown>
    const cropAssignments = result.crop_assignments ?? result.cropAssignments
    if (!result.field || !result.arrangement || !Array.isArray(cropAssignments)) throw new Error('Farm Rx could not confirm the field save. Please try again.')
    return { field: result.field, arrangement: result.arrangement, cropAssignments }
  }
}
