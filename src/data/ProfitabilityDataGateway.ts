import type { BudgetCostLine, BudgetFieldAllocation, CropBudget, ProfitabilityMatrixStep } from './profitability'

/** DB has `sort_order`; the public `BudgetCostLine` interface deliberately omits it. */
export type BudgetCostLineWrite = BudgetCostLine & { sort_order: number }

/** The network boundary deliberately exposes untrusted rows only. */
export interface ProfitabilityRowBundle {
  budgets: unknown[]
  cost_lines: unknown[]
  matrix_steps: unknown[]
  allocations: unknown[]
}

export interface ReplaceMatrixStepsInput { farmId: string; budgetId: string; steps: ProfitabilityMatrixStep[] }
export interface CopyBudgetInput { farmId: string; sourceId: string; budget: CropBudget; costLines: BudgetCostLineWrite[]; matrixSteps: ProfitabilityMatrixStep[] }

export interface ProfitabilityDataGateway {
  loadWorkspace(farmId: string): Promise<ProfitabilityRowBundle>
  upsertBudget(farmId: string, row: CropBudget): Promise<unknown>
  upsertCostLine(farmId: string, row: BudgetCostLineWrite): Promise<unknown>
  deleteCostLine(farmId: string, id: string): Promise<unknown>
  upsertAllocation(farmId: string, row: BudgetFieldAllocation): Promise<unknown>
  deleteAllocation(farmId: string, id: string): Promise<unknown>
  replaceMatrixSteps(input: ReplaceMatrixStepsInput): Promise<unknown[]>
  copyBudget(input: CopyBudgetInput): Promise<unknown>
}
