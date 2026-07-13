import { supabase } from '../lib/supabaseClient'
import type { BudgetCostLineWrite, CopyBudgetInput, ProfitabilityDataGateway, ProfitabilityRowBundle, ReplaceMatrixStepsInput } from './ProfitabilityDataGateway'
import type { BudgetFieldAllocation, CropBudget } from './profitability'

function rows(data: unknown, error: { message: string } | null): unknown[] { if (error) throw error; if (!Array.isArray(data)) throw new Error('Farm Rx could not load the complete profitability workspace.'); return data }
function row(data: unknown, error: { message: string } | null): unknown { if (error) throw error; if (!data || typeof data !== 'object') throw new Error('Farm Rx could not confirm the profitability save. Please try again.'); return data }
function budgetColumns(value: CropBudget & { farm_id: string }) { const { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, name, expected_yield_per_acre, expected_price_per_bushel, rp_coverage_pct, rp_aph_yield, rp_projected_price, rp_premium_per_acre, copied_from_budget_id } = value; return { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, name, expected_yield_per_acre, expected_price_per_bushel, rp_coverage_pct, rp_aph_yield, rp_projected_price, rp_premium_per_acre, copied_from_budget_id, notes: null } }
function costLineColumns(value: BudgetCostLineWrite & { farm_id: string }) { const { id, farm_id, budget_id, category, name, amount_per_acre, sort_order } = value; return { id, farm_id, budget_id, category, label: name, amount_per_acre, source_kind: 'manual' as const, source_record_id: null, sort_order, notes: null } }
function allocationColumns(value: BudgetFieldAllocation & { farm_id: string }) { const { id, farm_id, budget_id, crop_assignment_id, allocated_acres, expected_yield_override, expected_price_override } = value; return { id, farm_id, budget_id, crop_assignment_id, allocated_acres, expected_yield_override, expected_price_override, notes: null } }

export class SupabaseProfitabilityDataGateway implements ProfitabilityDataGateway {
  async loadWorkspace(farmId: string): Promise<ProfitabilityRowBundle> {
    const [permission, budgets, cost_lines, matrix_steps, allocations] = await Promise.all([
      supabase.rpc('can_read_private_financials', { target_farm_id: farmId }),
      supabase.from('crop_budgets').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('id'),
      supabase.from('budget_cost_lines').select('*').eq('farm_id', farmId).order('budget_id').order('sort_order'),
      supabase.from('profitability_matrix_steps').select('*').eq('farm_id', farmId).order('budget_id').order('axis').order('step_order'),
      supabase.from('budget_field_allocations').select('*').eq('farm_id', farmId).order('budget_id').order('crop_assignment_id'),
    ])
    if (permission.error) throw permission.error
    if (permission.data !== true) throw new Error('PROFITABILITY_PRIVATE_ACCESS_DENIED')
    return { budgets: rows(budgets.data, budgets.error), cost_lines: rows(cost_lines.data, cost_lines.error), matrix_steps: rows(matrix_steps.data, matrix_steps.error), allocations: rows(allocations.data, allocations.error) }
  }
  async upsertBudget(farmId: string, value: CropBudget) { const result = await supabase.from('crop_budgets').upsert(budgetColumns({ ...value, farm_id: farmId }), { onConflict: 'id' }).select('*').single(); return row(result.data, result.error) }
  async upsertCostLine(farmId: string, value: BudgetCostLineWrite) { const result = await supabase.from('budget_cost_lines').upsert(costLineColumns({ ...value, farm_id: farmId }), { onConflict: 'id' }).select('*').single(); return row(result.data, result.error) }
  async deleteCostLine(farmId: string, id: string) { const result = await supabase.from('budget_cost_lines').delete().eq('id', id).eq('farm_id', farmId).select('id').maybeSingle(); if (result.error) throw result.error; return result.data?.id ?? id }
  async upsertAllocation(farmId: string, value: BudgetFieldAllocation) { const result = await supabase.from('budget_field_allocations').upsert(allocationColumns({ ...value, farm_id: farmId }), { onConflict: 'id' }).select('*').single(); return row(result.data, result.error) }
  async deleteAllocation(farmId: string, id: string) { const result = await supabase.from('budget_field_allocations').delete().eq('id', id).eq('farm_id', farmId).select('id').maybeSingle(); if (result.error) throw result.error; return result.data?.id ?? id }
  async replaceMatrixSteps(input: ReplaceMatrixStepsInput) { const { data, error } = await supabase.rpc('replace_profitability_matrix_steps', { p_farm_id: input.farmId, p_budget_id: input.budgetId, p_steps: input.steps.map(({ id, budget_id, axis, value, sort_order }) => ({ id, budget_id, axis, value, sort_order })) }); return rows(data, error) }
  async copyBudget(input: CopyBudgetInput) {
    const { data, error } = await supabase.rpc('copy_crop_budget', {
      p_farm_id: input.farmId,
      p_source_id: input.sourceId,
      p_budget: budgetColumns({ ...input.budget, farm_id: input.farmId }),
      p_cost_lines: input.costLines.map((line) => costLineColumns({ ...line, farm_id: input.farmId })),
      p_matrix_steps: input.matrixSteps.map(({ id, budget_id, axis, value, sort_order }) => ({ id, budget_id, axis, value, sort_order })),
    })
    return row(data, error)
  }
}
