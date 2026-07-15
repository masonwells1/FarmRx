import type { BudgetCostLine, BudgetFieldAllocation, CropBudget, InsuranceBudgetPatch, ProfitabilityMatrixStep } from './profitability'

/** DB has `sort_order`; the public `BudgetCostLine` interface deliberately omits it. */
export type BudgetCostLineWrite = BudgetCostLine & { sort_order: number }

/** The network boundary deliberately exposes untrusted rows only. */
export interface ProfitabilityRowBundle {
  budgets: unknown[]
  cost_lines: unknown[]
  matrix_steps: unknown[]
  allocations: unknown[]
}

export interface ReplaceMatrixStepsInput { farmId: string; budgetId: string; steps: ProfitabilityMatrixStep[]; expectedSteps?: ProfitabilityMatrixStep[] | null }
export interface CopyBudgetInput { farmId: string; sourceId: string; budget: CropBudget; costLines: BudgetCostLineWrite[]; matrixSteps: ProfitabilityMatrixStep[] }

export interface ProfitabilityDataGateway {
  /** Runs the harmless unauthorized 0034 RPC probe once per app session. */
  getSaveDurabilityCapability?(): Promise<boolean>
  loadWorkspace(farmId: string): Promise<ProfitabilityRowBundle>
  upsertBudget(farmId: string, row: CropBudget): Promise<unknown>
  patchBudgetInsurance(farmId: string, budgetId: string, patch: InsuranceBudgetPatch, expectedUpdatedAt?: string | null): Promise<unknown>
  upsertCostLine(farmId: string, row: BudgetCostLineWrite): Promise<unknown>
  deleteCostLine(farmId: string, id: string): Promise<unknown>
  upsertAllocation(farmId: string, row: BudgetFieldAllocation): Promise<unknown>
  deleteAllocation(farmId: string, id: string): Promise<unknown>
  replaceMatrixSteps(input: ReplaceMatrixStepsInput): Promise<unknown[]>
  createBudgetWithMatrix(input: { farmId: string; budget: CropBudget; matrixSteps: ProfitabilityMatrixStep[] }): Promise<unknown>
  copyBudget(input: CopyBudgetInput): Promise<unknown>
}
