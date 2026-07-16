import { supabase } from '../lib/supabaseClient'
import type { BudgetCostLineWrite, CopyBudgetInput, ProfitabilityDataGateway, ProfitabilityRowBundle, ReplaceMatrixStepsInput } from './ProfitabilityDataGateway'
import type { BudgetFieldAllocation, CropBudget, InsuranceBudgetPatch } from './profitability'
import { DELETE_PERMISSION_MESSAGE, SAVE_DURABILITY_UPDATE_MESSAGE } from './saveDurability'
import { optimisticSave } from './optimisticSave'
import { bindFarmOperationRequest, type FarmOperationContext } from './farmOperationContext'

function rows(data: unknown, error: { message: string } | null): unknown[] { if (error) throw error; if (!Array.isArray(data)) throw new Error('Farm Rx could not load the complete profitability workspace.'); return data }
function row(data: unknown, error: { message: string } | null): unknown { if (error) throw error; if (!data || typeof data !== 'object') throw new Error('Farm Rx could not confirm the profitability save. Please try again.'); return data }
function budgetColumns(value: CropBudget & { farm_id: string }) { const { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, name, expected_yield_per_acre, expected_price_per_bushel, rp_coverage_pct, rp_aph_yield, rp_projected_price, rp_premium_per_acre, copied_from_budget_id } = value; return { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, name, expected_yield_per_acre, expected_price_per_bushel, rp_coverage_pct, rp_aph_yield, rp_projected_price, rp_premium_per_acre, copied_from_budget_id, notes: null } }
function costLineColumns(value: BudgetCostLineWrite & { farm_id: string }) { const { id, farm_id, budget_id, category, name, amount_per_acre, sort_order } = value; return { id, farm_id, budget_id, category, label: name, amount_per_acre, source_kind: 'manual' as const, source_record_id: null, sort_order, notes: null } }
function allocationColumns(value: BudgetFieldAllocation & { farm_id: string }) { const { id, farm_id, budget_id, crop_assignment_id, allocated_acres, expected_yield_override, expected_price_override } = value; return { id, farm_id, budget_id, crop_assignment_id, allocated_acres, expected_yield_override, expected_price_override, notes: null } }
const insuranceKeys = ['rp_coverage_pct', 'rp_aph_yield', 'rp_projected_price', 'rp_premium_per_acre'] as const
export class InvalidInsurancePatchError extends Error { constructor() { super('Farm Rx rejected an invalid insurance-only save.'); this.name = 'InvalidInsurancePatchError' } }
export function durabilityCapabilityFromProbe(error: { code?: unknown; message?: unknown } | null): boolean {
  if (error === null) return true
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : ''
  // The draft RPC deliberately rejects this unauthenticated probe before any lock/write.
  return (error.code === '42501' || error.code === 'P0001') && (message.includes('authentication is required') || message.includes('permission to edit this farm'))
}
export function insuranceColumns(patch: InsuranceBudgetPatch) {
  if (!patch || typeof patch !== 'object' || Object.keys(patch).some((key) => !insuranceKeys.includes(key as typeof insuranceKeys[number]))) throw new InvalidInsurancePatchError()
  const { rp_coverage_pct, rp_aph_yield, rp_projected_price, rp_premium_per_acre } = patch
  return { rp_coverage_pct, rp_aph_yield, rp_projected_price, rp_premium_per_acre }
}
async function confirmDelete(table: 'budget_cost_lines' | 'budget_field_allocations', farmId: string, id: string, context: FarmOperationContext) {
  const deleted = await bindFarmOperationRequest(supabase.from(table).delete().eq('id', id).eq('farm_id', farmId).select('id'), context)
  if (deleted.error) throw deleted.error
  if (Array.isArray(deleted.data) && deleted.data.some((row) => row.id === id)) return id
  throw new Error(DELETE_PERMISSION_MESSAGE)
}

export class SupabaseProfitabilityDataGateway implements ProfitabilityDataGateway {
  private durabilityCapability: Promise<boolean> | null = null
  getSaveDurabilityCapability() {
    if (!this.durabilityCapability) this.durabilityCapability = (async () => {
      // 0034 and 0013 both reject auth/permission before taking locks or writing.
      // A random farm and empty desired state therefore prove only RPC availability.
      const { error } = await supabase.rpc('replace_profitability_matrix_steps', { p_farm_id: crypto.randomUUID(), p_budget_id: crypto.randomUUID(), p_steps: [], p_expected_steps: [] })
      return durabilityCapabilityFromProbe(error)
    })().catch(() => { this.durabilityCapability = null; return false })
    return this.durabilityCapability
  }
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
  async upsertBudget(farmId: string, value: CropBudget, context: FarmOperationContext) { return optimisticSave('crop_budgets', farmId, value.id, budgetColumns({ ...value, farm_id: farmId }), value.updated_at, context) }
  async patchBudgetInsurance(farmId: string, budgetId: string, patch: InsuranceBudgetPatch, expectedUpdatedAt: string | null | undefined, context: FarmOperationContext) { return optimisticSave('crop_budgets', farmId, budgetId, insuranceColumns(patch), expectedUpdatedAt, context) }
  async upsertCostLine(farmId: string, value: BudgetCostLineWrite, context: FarmOperationContext) { return optimisticSave('budget_cost_lines', farmId, value.id, costLineColumns({ ...value, farm_id: farmId }), value.updated_at, context) }
  async deleteCostLine(farmId: string, id: string, context: FarmOperationContext) { return confirmDelete('budget_cost_lines', farmId, id, context) }
  async upsertAllocation(farmId: string, value: BudgetFieldAllocation, context: FarmOperationContext) { return optimisticSave('budget_field_allocations', farmId, value.id, allocationColumns({ ...value, farm_id: farmId }), value.updated_at, context) }
  async deleteAllocation(farmId: string, id: string, context: FarmOperationContext) { return confirmDelete('budget_field_allocations', farmId, id, context) }
  async replaceMatrixSteps(input: ReplaceMatrixStepsInput) { const encode = (steps: import('./profitability').ProfitabilityMatrixStep[]) => steps.slice().sort((a, b) => a.axis.localeCompare(b.axis) || a.sort_order - b.sort_order || a.id.localeCompare(b.id)).map(({ id, budget_id, axis, value, sort_order }) => ({ id, budget_id, axis, value, sort_order })); const { data, error } = await bindFarmOperationRequest(supabase.rpc('replace_profitability_matrix_steps', { p_farm_id: input.farmId, p_budget_id: input.budgetId, p_steps: encode(input.steps), p_expected_steps: input.expectedSteps === undefined ? null : encode(input.expectedSteps ?? []) }), input.context); if (error && (error.code === 'PGRST202' || error.code === '42883')) throw new Error(SAVE_DURABILITY_UPDATE_MESSAGE); return rows(data, error) }
  async createBudgetWithMatrix(input: { farmId: string; budget: CropBudget; matrixSteps: import('./profitability').ProfitabilityMatrixStep[]; context: FarmOperationContext }) { const { data, error } = await bindFarmOperationRequest(supabase.rpc('create_crop_budget_with_matrix', { p_farm_id: input.farmId, p_budget: budgetColumns({ ...input.budget, farm_id: input.farmId }), p_matrix_steps: input.matrixSteps.map(({ id, budget_id, axis, value, sort_order }) => ({ id, budget_id, axis, value, sort_order })) }), input.context); if (error && (error.code === 'PGRST202' || error.code === '42883')) throw new Error(SAVE_DURABILITY_UPDATE_MESSAGE); return row(data, error) }
  async copyBudget(input: CopyBudgetInput) {
    const { data, error } = await bindFarmOperationRequest(supabase.rpc('copy_crop_budget_durable', {
      p_farm_id: input.farmId,
      p_source_id: input.sourceId,
      p_budget: budgetColumns({ ...input.budget, farm_id: input.farmId }),
      p_cost_lines: input.costLines.map((line) => costLineColumns({ ...line, farm_id: input.farmId })),
      p_matrix_steps: input.matrixSteps.map(({ id, budget_id, axis, value, sort_order }) => ({ id, budget_id, axis, value, sort_order })),
    }), input.context)
    if (error && (error.code === 'PGRST202' || error.code === '42883')) throw new Error(SAVE_DURABILITY_UPDATE_MESSAGE)
    return row(data, error)
  }
}
