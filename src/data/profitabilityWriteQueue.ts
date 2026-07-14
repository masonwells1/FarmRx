import type { BudgetCostLineWrite } from './ProfitabilityDataGateway'
import type { BudgetFieldAllocation, CropBudget, ProfitabilityMatrixStep } from './profitability'
import { validateRevenueProtectionInputs } from './insuranceMath'
import type { StorageLike } from './writeQueue'
import { appendNeedsAttention } from './needsAttentionStore'
import { LEGACY_MATRIX_PARK_MESSAGE } from './saveDurability'

export type ProfitabilityQueueEntryV1 =
  | { version: 1; module: 'profitability'; kind: 'createBudget'; operationId: string; userId: string; farmId: string; enqueuedAt: string; row: CropBudget; priceSteps: ProfitabilityMatrixStep[]; yieldSteps: ProfitabilityMatrixStep[] }
  | { version: 1; module: 'profitability'; kind: 'saveBudget'; operationId: string; userId: string; farmId: string; enqueuedAt: string; row: CropBudget }
  | { version: 1; module: 'profitability'; kind: 'saveCostLine'; operationId: string; userId: string; farmId: string; enqueuedAt: string; row: BudgetCostLineWrite }
  | { version: 1; module: 'profitability'; kind: 'deleteCostLine'; operationId: string; userId: string; farmId: string; enqueuedAt: string; id: string }
  | { version: 1; module: 'profitability'; kind: 'replaceMatrixSteps'; operationId: string; userId: string; farmId: string; enqueuedAt: string; budgetId: string; steps: ProfitabilityMatrixStep[]; expectedSteps: ProfitabilityMatrixStep[] }
  | { version: 1; module: 'profitability'; kind: 'replaceMatrixSteps'; operationId: string; userId: string; farmId: string; enqueuedAt: string; budgetId: string; steps: ProfitabilityMatrixStep[]; legacyUnknownSnapshot: true }
  | { version: 1; module: 'profitability'; kind: 'saveAllocation'; operationId: string; userId: string; farmId: string; enqueuedAt: string; row: BudgetFieldAllocation }
  | { version: 1; module: 'profitability'; kind: 'deleteAllocation'; operationId: string; userId: string; farmId: string; enqueuedAt: string; id: string }
  | { version: 1; module: 'profitability'; kind: 'copyBudget'; operationId: string; userId: string; farmId: string; enqueuedAt: string; sourceBudgetId: string; budget: CropBudget; costLines: BudgetCostLineWrite[]; matrixSteps: ProfitabilityMatrixStep[] }
export interface ProfitabilityQueueEnvelopeV1 { version: 1; entries: ProfitabilityQueueEntryV1[] }

const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const categories = new Set(['seed', 'chemical', 'fertilizer', 'fuel', 'repairs', 'labor', 'land', 'crop_insurance', 'equipment_depreciation', 'interest', 'custom'])
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const isId = (value: unknown) => typeof value === 'string' && uuid.test(value)
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
const stamp = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value))
const nullableString = (value: unknown) => value === null || typeof value === 'string'
function scopeFields(value: Record<string, unknown>): boolean { return isId(value.farm_id) && Number.isInteger(value.crop_year) && typeof value.commodity_id === 'string' && nullableString(value.operating_entity_id) && nullableString(value.enterprise_label) && (value.operating_entity_id === null || isId(value.operating_entity_id)) }
function budget(value: unknown): value is CropBudget { return record(value) && exact(value, ['id', 'farm_id', 'crop_year', 'commodity_id', 'operating_entity_id', 'enterprise_label', 'name', 'expected_yield_per_acre', 'expected_price_per_bushel', 'rp_coverage_pct', 'rp_aph_yield', 'rp_projected_price', 'rp_premium_per_acre', 'copied_from_budget_id', 'created_at', 'updated_at']) && isId(value.id) && scopeFields(value) && typeof value.name === 'string' && value.name.trim().length > 0 && finite(value.expected_yield_per_acre) && finite(value.expected_price_per_bushel) && [value.rp_coverage_pct, value.rp_aph_yield, value.rp_projected_price, value.rp_premium_per_acre].every((item) => item === null || finite(item)) && validateRevenueProtectionInputs(value as unknown as CropBudget).length === 0 && (value.copied_from_budget_id === null || isId(value.copied_from_budget_id)) && stamp(value.created_at) && stamp(value.updated_at) }
function costLine(value: unknown): value is BudgetCostLineWrite { return record(value) && exact(value, ['id', 'budget_id', 'category', 'name', 'amount_per_acre', 'sort_order', 'created_at', 'updated_at']) && isId(value.id) && isId(value.budget_id) && categories.has(String(value.category)) && typeof value.name === 'string' && value.name.trim().length > 0 && finite(value.amount_per_acre) && Number.isInteger(value.sort_order) && (value.sort_order as number) >= 0 && stamp(value.created_at) && stamp(value.updated_at) }
function matrixStep(value: unknown): value is ProfitabilityMatrixStep { return record(value) && exact(value, ['id', 'budget_id', 'axis', 'value', 'sort_order']) && isId(value.id) && isId(value.budget_id) && (value.axis === 'price' || value.axis === 'yield') && finite(value.value) && (value.value as number) > 0 && Number.isInteger(value.sort_order) && (value.sort_order as number) >= 0 }
function allocation(value: unknown): value is BudgetFieldAllocation { return record(value) && exact(value, ['id', 'budget_id', 'crop_assignment_id', 'allocated_acres', 'expected_yield_override', 'expected_price_override', 'created_at', 'updated_at']) && isId(value.id) && isId(value.budget_id) && isId(value.crop_assignment_id) && finite(value.allocated_acres) && (value.expected_yield_override === null || finite(value.expected_yield_override)) && (value.expected_price_override === null || finite(value.expected_price_override)) && stamp(value.created_at) && stamp(value.updated_at) }

/** Insurance fields were added after v1 queue entries already existed on farmers' devices.
 * Preserve the strict v1 envelope after filling only genuinely missing legacy fields. */
function normalizeLegacyBudget(value: unknown): unknown {
  if (!record(value)) return value
  return {
    ...value,
    rp_coverage_pct: Object.hasOwn(value, 'rp_coverage_pct') ? value.rp_coverage_pct : null,
    rp_aph_yield: Object.hasOwn(value, 'rp_aph_yield') ? value.rp_aph_yield : null,
    rp_projected_price: Object.hasOwn(value, 'rp_projected_price') ? value.rp_projected_price : null,
    rp_premium_per_acre: Object.hasOwn(value, 'rp_premium_per_acre') ? value.rp_premium_per_acre : null,
  }
}
function normalizeLegacyEntry(value: unknown): unknown {
  if (!record(value)) return value
  if (value.kind === 'createBudget' || value.kind === 'saveBudget') return { ...value, row: normalizeLegacyBudget(value.row) }
  if (value.kind === 'copyBudget') return { ...value, budget: normalizeLegacyBudget(value.budget) }
  if (value.kind === 'replaceMatrixSteps' && !Object.hasOwn(value, 'expectedSteps')) return { ...value, legacyUnknownSnapshot: true }
  return value
}
function normalizeLegacyEnvelope(value: unknown): unknown { return record(value) && Array.isArray(value.entries) ? { ...value, entries: value.entries.map(normalizeLegacyEntry) } : value }

function envelope(value: unknown): value is ProfitabilityQueueEnvelopeV1 { return record(value) && exact(value, ['version', 'entries']) && value.version === 1 && Array.isArray(value.entries) && value.entries.every(entry) }
function entry(value: unknown): value is ProfitabilityQueueEntryV1 {
  if (!record(value) || !isId(value.operationId) || !isId(value.userId) || !isId(value.farmId) || !stamp(value.enqueuedAt) || value.version !== 1 || value.module !== 'profitability') return false
  const common = ['version', 'module', 'kind', 'operationId', 'userId', 'farmId', 'enqueuedAt'] as const
  if (value.kind === 'createBudget') return exact(value, [...common, 'row', 'priceSteps', 'yieldSteps']) && budget(value.row) && Array.isArray(value.priceSteps) && value.priceSteps.every(matrixStep) && Array.isArray(value.yieldSteps) && value.yieldSteps.every(matrixStep)
  if (value.kind === 'saveBudget') return exact(value, [...common, 'row']) && budget(value.row)
  if (value.kind === 'saveCostLine') return exact(value, [...common, 'row']) && costLine(value.row)
  if (value.kind === 'deleteCostLine') return exact(value, [...common, 'id']) && isId(value.id)
  if (value.kind === 'replaceMatrixSteps') return (exact(value, [...common, 'budgetId', 'steps', 'expectedSteps']) && isId(value.budgetId) && Array.isArray(value.steps) && value.steps.every(matrixStep) && Array.isArray(value.expectedSteps) && value.expectedSteps.every(matrixStep)) || (exact(value, [...common, 'budgetId', 'steps', 'legacyUnknownSnapshot']) && isId(value.budgetId) && Array.isArray(value.steps) && value.steps.every(matrixStep) && value.legacyUnknownSnapshot === true)
  if (value.kind === 'saveAllocation') return exact(value, [...common, 'row']) && allocation(value.row)
  if (value.kind === 'deleteAllocation') return exact(value, [...common, 'id']) && isId(value.id)
  if (value.kind === 'copyBudget') return exact(value, [...common, 'sourceBudgetId', 'budget', 'costLines', 'matrixSteps']) && isId(value.sourceBudgetId) && budget(value.budget) && Array.isArray(value.costLines) && value.costLines.every(costLine) && Array.isArray(value.matrixSteps) && value.matrixSteps.every(matrixStep)
  return false
}
export function parseProfitabilityQueue(serialized: string): ProfitabilityQueueEnvelopeV1 { let parsed: unknown; try { parsed = normalizeLegacyEnvelope(JSON.parse(serialized)) } catch { throw new Error(blocked) }; if (!envelope(parsed)) throw new Error(blocked); return parsed }
export class ProfitabilityWriteQueue {
  constructor(private readonly storage: StorageLike, readonly key: string) {}
  read(): ProfitabilityQueueEnvelopeV1 { const bytes = this.storage.getItem(this.key); return bytes === null ? { version: 1, entries: [] } : parseProfitabilityQueue(bytes) }
  private persist(next: ProfitabilityQueueEnvelopeV1) { const serialized = JSON.stringify(next); parseProfitabilityQueue(serialized); this.storage.setItem(this.key, serialized); const actual = this.storage.getItem(this.key); if (actual !== serialized) throw new Error('This entry could not be saved on this device. Keep this screen open and try again.'); parseProfitabilityQueue(actual) }
  append(value: ProfitabilityQueueEntryV1) { const current = this.read(); const next = { version: 1 as const, entries: current.entries.some((entry) => entry.operationId === value.operationId) ? current.entries : [...current.entries, value] }; this.persist(next); return next }
  removeConfirmedHead(operationId: string) { const current = this.read(); if (current.entries[0]?.operationId !== operationId) throw new Error(blocked); const next = { version: 1 as const, entries: current.entries.slice(1) }; this.persist(next); return next }
  parkHead(operationId: string, message = LEGACY_MATRIX_PARK_MESSAGE, reason?: import('./needsAttentionStore').NeedsAttentionReason) { const current = this.read(); const head = current.entries[0]; if (!head || head.operationId !== operationId) throw new Error(blocked); appendNeedsAttention(this.storage, this.key, { id: head.operationId, module: 'profitability', createdAt: head.enqueuedAt, message, entry: head, ...(reason ? { reason } : {}) }); const next = { version: 1 as const, entries: current.entries.slice(1) }; this.persist(next); return next }
}
export const profitabilityWriteQueueKey = (projectRef: string, userId: string, farmId: string) => `farm-rx-profitability-write-queue:v1:${projectRef}:${userId}:${farmId}`
