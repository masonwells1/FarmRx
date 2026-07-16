import type { BudgetCostLine, BudgetFieldAllocation, CropBudget, InsuranceBudgetPatch, ProfitabilityMatrixStep } from './profitability'
import type { FarmOperationContext } from './farmOperationContext'

/** DB has `sort_order`; the public `BudgetCostLine` interface deliberately omits it. */
export type BudgetCostLineWrite = BudgetCostLine & { sort_order: number }

/** The network boundary deliberately exposes untrusted rows only. */
export interface ProfitabilityRowBundle {
  budgets: unknown[]
  cost_lines: unknown[]
  matrix_steps: unknown[]
  allocations: unknown[]
}

export interface ReplaceMatrixStepsInput { farmId: string; budgetId: string; steps: ProfitabilityMatrixStep[]; expectedSteps?: ProfitabilityMatrixStep[] | null; context: FarmOperationContext }
export interface CopyBudgetInput { farmId: string; sourceId: string; budget: CropBudget; costLines: BudgetCostLineWrite[]; matrixSteps: ProfitabilityMatrixStep[]; context: FarmOperationContext }

export interface ProfitabilityDataGateway {
  /** Runs the harmless unauthorized 0034 RPC probe once per app session. */
  getSaveDurabilityCapability?(): Promise<boolean>
  loadWorkspace(farmId: string): Promise<ProfitabilityRowBundle>
  upsertBudget(farmId: string, row: CropBudget, context: FarmOperationContext): Promise<unknown>
  patchBudgetInsurance(farmId: string, budgetId: string, patch: InsuranceBudgetPatch, expectedUpdatedAt: string | null | undefined, context: FarmOperationContext): Promise<unknown>
  upsertCostLine(farmId: string, row: BudgetCostLineWrite, context: FarmOperationContext): Promise<unknown>
  deleteCostLine(farmId: string, id: string, context: FarmOperationContext): Promise<unknown>
  upsertAllocation(farmId: string, row: BudgetFieldAllocation, context: FarmOperationContext): Promise<unknown>
  deleteAllocation(farmId: string, id: string, context: FarmOperationContext): Promise<unknown>
  replaceMatrixSteps(input: ReplaceMatrixStepsInput): Promise<unknown[]>
  createBudgetWithMatrix(input: { farmId: string; budget: CropBudget; matrixSteps: ProfitabilityMatrixStep[]; context: FarmOperationContext }): Promise<unknown>
  copyBudget(input: CopyBudgetInput): Promise<unknown>
}
