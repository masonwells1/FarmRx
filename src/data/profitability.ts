import type { FieldsData } from './fields'
import type { PositionScope } from './grain'

export type CostCategory = 'seed' | 'chemical' | 'fertilizer' | 'fuel' | 'repairs' | 'labor' | 'land' | 'crop_insurance' | 'equipment_depreciation' | 'interest' | 'custom'
export type MatrixAxis = 'price' | 'yield'

export interface CropBudget extends PositionScope {
  id: string
  name: string
  expected_yield_per_acre: number
  expected_price_per_bushel: number
  rp_coverage_pct: number | null
  rp_aph_yield: number | null
  rp_projected_price: number | null
  rp_premium_per_acre: number | null
  copied_from_budget_id: string | null
  created_at: string
  updated_at: string
}

export type CostLineSourceKind = 'manual' | 'inventory' | 'equipment'
/** Audit P2-14: a cost line sourced from Inventory or Equipment records is DB-valid and
 * must load; it just cannot be edited by hand here without severing its source link. */
export const SOURCED_COST_LINE_EDIT_MESSAGE = 'This cost line comes from your Inventory or Equipment records, so it cannot be edited by hand here. Remove it if you no longer want it in this budget.'

export interface BudgetCostLine {
  id: string
  budget_id: string
  category: CostCategory
  name: string
  amount_per_acre: number
  /** Missing means 'manual' (every line the app itself writes today). */
  source_kind?: CostLineSourceKind
  created_at: string
  updated_at: string
}

export interface ProfitabilityMatrixStep {
  id: string
  budget_id: string
  axis: MatrixAxis
  value: number
  sort_order: number
}

export interface BudgetFieldAllocation {
  id: string
  budget_id: string
  crop_assignment_id: string
  allocated_acres: number
  expected_yield_override: number | null
  expected_price_override: number | null
  created_at: string
  updated_at: string
}

export interface ProfitabilityData {
  budgets: CropBudget[]
  cost_lines: BudgetCostLine[]
  matrix_steps: ProfitabilityMatrixStep[]
  allocations: BudgetFieldAllocation[]
}

export interface ProfitabilityWorkspace extends ProfitabilityData { fields: FieldsData }
export type InsuranceBudgetPatch = Pick<CropBudget, 'rp_coverage_pct' | 'rp_aph_yield' | 'rp_projected_price' | 'rp_premium_per_acre'>
export type ProfitabilitySaveDisposition = 'saved' | 'queued offline'

export interface ProfitabilityRepository {
  getWorkspace(): Promise<ProfitabilityWorkspace>
  /** Exact device queue for the current signed-in farm; never a prefix scan. */
  getNeedsAttentionQueueKey?(): Promise<string>
  getInsuranceDraftContext?(): Promise<{ projectRef: string; userId: string; farmId: string }>
  /** True only when the 0034 atomic durability RPCs are available. */
  getSaveDurabilityCapability(): Promise<boolean>
  createBudget(budget: CropBudget): Promise<void | ProfitabilitySaveDisposition>
  saveBudget(budget: CropBudget): Promise<void | ProfitabilitySaveDisposition>
  saveBudgetInsurance(budgetId: string, patch: InsuranceBudgetPatch): Promise<void | ProfitabilitySaveDisposition>
  saveCostLine(line: BudgetCostLine): Promise<void | ProfitabilitySaveDisposition>
  deleteCostLine(id: string): Promise<void | ProfitabilitySaveDisposition>
  replaceMatrixSteps(budgetId: string, steps: ProfitabilityMatrixStep[]): Promise<void | ProfitabilitySaveDisposition>
  saveAllocation(allocation: BudgetFieldAllocation): Promise<void | ProfitabilitySaveDisposition>
  deleteAllocation(id: string): Promise<void | ProfitabilitySaveDisposition>
  copyBudget(sourceBudgetId: string, copy: CropBudget): Promise<void | ProfitabilitySaveDisposition>
  getBreakeven(scope: PositionScope, fields: FieldsData): Promise<number | null>
}

export interface ProfitabilityRepositoryOptions {
  storage?: Storage
  createId?: () => string
  clock?: () => string
}
