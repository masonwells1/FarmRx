import type { FieldsData } from './fields'
import type { PositionScope } from './grain'

export type CostCategory = 'seed' | 'chemical' | 'fertilizer' | 'fuel' | 'repairs' | 'labor' | 'land' | 'crop_insurance' | 'equipment_depreciation' | 'interest' | 'custom'
export type MatrixAxis = 'price' | 'yield'

export interface CropBudget extends PositionScope {
  id: string
  name: string
  expected_yield_per_acre: number
  expected_price_per_bushel: number
  copied_from_budget_id: string | null
  created_at: string
  updated_at: string
}

export interface BudgetCostLine {
  id: string
  budget_id: string
  category: CostCategory
  name: string
  amount_per_acre: number
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

export interface ProfitabilityRepository {
  getWorkspace(): Promise<ProfitabilityWorkspace>
  createBudget(budget: CropBudget): Promise<void>
  saveBudget(budget: CropBudget): Promise<void>
  saveCostLine(line: BudgetCostLine): Promise<void>
  deleteCostLine(id: string): Promise<void>
  replaceMatrixSteps(budgetId: string, steps: ProfitabilityMatrixStep[]): Promise<void>
  saveAllocation(allocation: BudgetFieldAllocation): Promise<void>
  deleteAllocation(id: string): Promise<void>
  copyBudget(sourceBudgetId: string, copy: CropBudget): Promise<void>
  getBreakeven(scope: PositionScope, fields: FieldsData): Promise<number | null>
}

export interface ProfitabilityRepositoryOptions {
  storage?: Storage
  createId?: () => string
  clock?: () => string
}
