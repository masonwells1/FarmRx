import type { FieldsRepository } from './fields'
import type { PositionScope } from './grain'
import { defaultMatrixValues } from './profitabilityCalculations'
import type { BudgetCostLine, BudgetFieldAllocation, CostCategory, CropBudget, ProfitabilityData, ProfitabilityMatrixStep, ProfitabilityRepository, ProfitabilityRepositoryOptions, ProfitabilityWorkspace } from './profitability'

export const PROFITABILITY_STORAGE_KEY = 'farm-rx-profitability-mock:v1'
const VERSION = 1
const categories = new Set<CostCategory>(['seed', 'chemical', 'fertilizer', 'fuel', 'repairs', 'labor', 'land', 'crop_insurance', 'equipment_depreciation', 'interest', 'custom'])
const year = new Date().getFullYear()
const seedId = (value: number) => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const timestamp = () => new Date().toISOString()

type Envelope = { version: 1; farm_id: string; data: ProfitabilityData }

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
function assertId(value: unknown, message: string): asserts value is string { assert(typeof value === 'string' && value.length > 0, message) }
function assertData(value: unknown): asserts value is ProfitabilityData {
  assert(isRecord(value) && Array.isArray(value.budgets) && Array.isArray(value.cost_lines) && Array.isArray(value.matrix_steps) && Array.isArray(value.allocations), 'Saved profitability data is incomplete.')
  const budgetIds = new Set<string>()
  for (const budget of value.budgets) {
    assert(isRecord(budget), 'A saved budget is invalid.'); const id = budget.id; assertId(id, 'A saved budget ID is invalid.'); assert(!budgetIds.has(id), 'A saved budget is duplicated.'); budgetIds.add(id)
    assert(typeof budget.name === 'string' && budget.name.trim().length > 0, 'A saved budget name is invalid.'); assert(Number.isInteger(budget.crop_year), 'A saved crop year is invalid.'); assert(typeof budget.farm_id === 'string' && typeof budget.commodity_id === 'string', 'A saved budget scope is invalid.')
    assert(isNumber(budget.expected_yield_per_acre) && budget.expected_yield_per_acre > 0 && isNumber(budget.expected_price_per_bushel) && budget.expected_price_per_bushel > 0, 'A saved budget yield or price is invalid.')
  }
  const lineIds = new Set<string>()
  for (const line of value.cost_lines) { assert(isRecord(line), 'A saved cost line is invalid.'); const id = line.id; assertId(id, 'A saved cost line ID is invalid.'); assert(!lineIds.has(id), 'A saved cost line is duplicated.'); lineIds.add(id); assert(typeof line.budget_id === 'string' && budgetIds.has(line.budget_id), 'A saved cost line budget is invalid.'); assert(categories.has(line.category as CostCategory), 'A saved cost category is invalid.'); assert(typeof line.name === 'string' && line.name.trim().length > 0 && isNumber(line.amount_per_acre) && line.amount_per_acre >= 0, 'A saved cost line amount is invalid.') }
  const matrixIds = new Set<string>()
  for (const step of value.matrix_steps) { assert(isRecord(step), 'A saved matrix step is invalid.'); const id = step.id; assertId(id, 'A saved matrix step ID is invalid.'); assert(!matrixIds.has(id), 'A saved matrix step is duplicated.'); matrixIds.add(id); assert(typeof step.budget_id === 'string' && budgetIds.has(step.budget_id) && (step.axis === 'price' || step.axis === 'yield') && isNumber(step.value) && step.value > 0 && Number.isInteger(step.sort_order), 'A saved matrix step is invalid.') }
  const allocationKeys = new Set<string>()
  for (const allocation of value.allocations) { assert(isRecord(allocation), 'A saved field allocation is invalid.'); assertId(allocation.id, 'A saved allocation ID is invalid.'); assert(typeof allocation.budget_id === 'string' && budgetIds.has(allocation.budget_id) && typeof allocation.crop_assignment_id === 'string' && isNumber(allocation.allocated_acres) && allocation.allocated_acres > 0, 'A saved field allocation is invalid.'); const key = `${allocation.budget_id}|${allocation.crop_assignment_id}`; assert(!allocationKeys.has(key), 'A saved field allocation is duplicated.'); allocationKeys.add(key); assert((allocation.expected_yield_override === null || isNumber(allocation.expected_yield_override)) && (allocation.expected_price_override === null || isNumber(allocation.expected_price_override)), 'A saved field override is invalid.') }
}

function makeSteps(budgetId: string, axis: 'price' | 'yield', values: number[]): ProfitabilityMatrixStep[] { return values.map((value, index) => ({ id: `${budgetId}-${axis}-${index}`, budget_id: budgetId, axis, value, sort_order: index })) }
function seedData(farmId: string): ProfitabilityData {
  const at = `${year}-01-01T00:00:00.000Z`
  const cornId = seedId(3001); const beanId = seedId(3002)
  const budget = (id: string, name: string, commodity_id: string, expected_yield_per_acre: number, expected_price_per_bushel: number): CropBudget => ({ id, farm_id: farmId, crop_year: year, commodity_id, operating_entity_id: null, enterprise_label: null, name, expected_yield_per_acre, expected_price_per_bushel, copied_from_budget_id: null, created_at: at, updated_at: at })
  const line = (id: number, budget_id: string, category: CostCategory, name: string, amount_per_acre: number): BudgetCostLine => ({ id: seedId(id), budget_id, category, name, amount_per_acre, created_at: at, updated_at: at })
  return {
    budgets: [budget(cornId, '2026 Yellow Corn', 'corn_yellow', 202, 4.6), budget(beanId, '2026 Soybeans', 'soybeans', 62, 10.4)],
    cost_lines: [line(3101, cornId, 'seed', 'Seed', 118), line(3102, cornId, 'chemical', 'Chemical', 74), line(3103, cornId, 'fertilizer', 'Fertilizer', 185), line(3104, cornId, 'fuel', 'Fuel', 28), line(3105, cornId, 'repairs', 'Repairs', 22), line(3106, cornId, 'labor', 'Labor', 34), line(3107, cornId, 'land', 'Planned land cost', 245), line(3108, cornId, 'crop_insurance', 'Crop insurance', 28), line(3109, cornId, 'equipment_depreciation', 'Equipment', 57), line(3110, cornId, 'interest', 'Interest', 24), line(3111, cornId, 'custom', 'Custom work', 18), line(3121, beanId, 'seed', 'Seed', 70), line(3122, beanId, 'chemical', 'Chemical', 58), line(3123, beanId, 'fertilizer', 'Fertilizer', 42), line(3124, beanId, 'land', 'Planned land cost', 245)],
    matrix_steps: [...makeSteps(cornId, 'price', [3.8, 4.2, 4.6, 5, 5.4]), ...makeSteps(cornId, 'yield', [160, 180, 200, 220, 240]), ...makeSteps(beanId, 'price', [8.8, 9.6, 10.4, 11.2, 12]), ...makeSteps(beanId, 'yield', [45, 55, 65, 75, 85])],
    allocations: [],
  }
}

export class MockProfitabilityRepository implements ProfitabilityRepository {
  private readonly storage: Storage
  private readonly createId: () => string
  private readonly clock: () => string
  constructor(private readonly fieldsRepository: FieldsRepository, options: ProfitabilityRepositoryOptions = {}) { this.storage = options.storage ?? localStorage; this.createId = options.createId ?? (() => crypto.randomUUID()); this.clock = options.clock ?? timestamp }
  private read(fieldsFarmId: string): ProfitabilityData {
    const raw = this.storage.getItem(PROFITABILITY_STORAGE_KEY)
    if (raw === null) { const data = seedData(fieldsFarmId); this.persist(fieldsFarmId, data); return data }
    try { const envelope = JSON.parse(raw) as unknown; assert(isRecord(envelope) && envelope.version === VERSION && typeof envelope.farm_id === 'string' && isRecord(envelope.data), 'Saved profitability data has an unknown format.'); assert(envelope.farm_id === fieldsFarmId, 'Saved profitability data belongs to another farm.'); assertData(envelope.data); assert(envelope.data.budgets.every((budget) => budget.farm_id === fieldsFarmId), 'Saved profitability data belongs to another farm.'); return structuredClone(envelope.data) } catch (error) { throw new Error(error instanceof Error ? `Profitability data could not be opened safely: ${error.message}` : 'Profitability data could not be opened safely.') }
  }
  private persist(farmId: string, data: ProfitabilityData) {
    assertData(data)
    assert(data.budgets.every((budget) => budget.farm_id === farmId), 'A profitability budget belongs to another farm.')
    const serialized = JSON.stringify({ version: VERSION, farm_id: farmId, data } satisfies Envelope)
    this.storage.setItem(PROFITABILITY_STORAGE_KEY, serialized)
    const saved = this.storage.getItem(PROFITABILITY_STORAGE_KEY)
    assert(saved === serialized, 'Farm Rx could not verify this profitability save. Nothing else was changed.')
    try { const checked = JSON.parse(saved) as unknown; assert(isRecord(checked) && checked.version === VERSION && checked.farm_id === farmId && isRecord(checked.data), 'Saved profitability data has an unknown format.'); assertData(checked.data) } catch { throw new Error('Farm Rx could not verify this profitability save. Nothing else was changed.') }
  }
  private async data() { const fields = await this.fieldsRepository.getData(); return { fields, data: this.read(fields.farm.id) } }
  async getWorkspace(): Promise<ProfitabilityWorkspace> { const { fields, data } = await this.data(); return { ...structuredClone(data), fields } }
  async createBudget(budget: CropBudget) { const { fields, data } = await this.data(); assert(budget.farm_id === fields.farm.id && !data.budgets.some((item) => item.id === budget.id), 'That budget could not be created. Refresh and try again.'); const at = this.clock(); const { priceValues, yieldValues } = defaultMatrixValues(budget); this.persist(fields.farm.id, { ...data, budgets: [...data.budgets, { ...budget, created_at: at, updated_at: at }], matrix_steps: [...data.matrix_steps, ...makeSteps(budget.id, 'price', priceValues).map((step) => ({ ...step, id: this.createId() })), ...makeSteps(budget.id, 'yield', yieldValues).map((step) => ({ ...step, id: this.createId() }))] }) }
  async saveBudget(budget: CropBudget) { const { fields, data } = await this.data(); assert(budget.farm_id === fields.farm.id, 'Budget belongs to another farm.'); const budgets = data.budgets.some((item) => item.id === budget.id) ? data.budgets.map((item) => item.id === budget.id ? { ...budget, updated_at: this.clock() } : item) : [...data.budgets, { ...budget, created_at: this.clock(), updated_at: this.clock() }]; this.persist(fields.farm.id, { ...data, budgets }) }
  async saveCostLine(line: BudgetCostLine) { const { fields, data } = await this.data(); const rows = data.cost_lines.some((item) => item.id === line.id) ? data.cost_lines.map((item) => item.id === line.id ? { ...line, updated_at: this.clock() } : item) : [...data.cost_lines, { ...line, created_at: this.clock(), updated_at: this.clock() }]; this.persist(fields.farm.id, { ...data, cost_lines: rows }) }
  async deleteCostLine(id: string) { const { fields, data } = await this.data(); assert(data.cost_lines.some((item) => item.id === id), 'That cost line changed before it could be removed. Refresh and try again.'); this.persist(fields.farm.id, { ...data, cost_lines: data.cost_lines.filter((item) => item.id !== id) }) }
  async replaceMatrixSteps(budgetId: string, steps: ProfitabilityMatrixStep[]) { const { fields, data } = await this.data(); assert(data.budgets.some((item) => item.id === budgetId), 'That budget changed before the matrix could be saved.'); assert(steps.length > 1 && steps.every((item) => item.budget_id === budgetId), 'Enter at least two price steps and two yield steps.'); this.persist(fields.farm.id, { ...data, matrix_steps: [...data.matrix_steps.filter((item) => item.budget_id !== budgetId), ...structuredClone(steps)] }) }
  async saveAllocation(allocation: BudgetFieldAllocation) { const { fields, data } = await this.data(); const budget = data.budgets.find((item) => item.id === allocation.budget_id); const assignment = fields.crop_assignments.find((item) => item.id === allocation.crop_assignment_id); assert(budget && assignment && assignment.crop_year === budget.crop_year && assignment.commodity_id === budget.commodity_id, 'That field crop does not match this budget.'); assert(allocation.allocated_acres <= assignment.planted_acres, 'Allocated acres cannot be more than planted acres.'); assert(!data.allocations.some((item) => item.id !== allocation.id && item.budget_id === allocation.budget_id && item.crop_assignment_id === allocation.crop_assignment_id), 'That field is already allocated to this budget.'); const rows = data.allocations.some((item) => item.id === allocation.id) ? data.allocations.map((item) => item.id === allocation.id ? { ...allocation, updated_at: this.clock() } : item) : [...data.allocations, { ...allocation, created_at: this.clock(), updated_at: this.clock() }]; this.persist(fields.farm.id, { ...data, allocations: rows }) }
  async deleteAllocation(id: string) { const { fields, data } = await this.data(); this.persist(fields.farm.id, { ...data, allocations: data.allocations.filter((item) => item.id !== id) }) }
  async copyBudget(sourceBudgetId: string, copy: CropBudget) { const { fields, data } = await this.data(); const source = data.budgets.find((item) => item.id === sourceBudgetId); assert(source && copy.farm_id === fields.farm.id, 'Choose a budget from this farm to copy.'); const at = this.clock(); const clonedLines = data.cost_lines.filter((line) => line.budget_id === sourceBudgetId).map((line) => ({ ...structuredClone(line), id: this.createId(), budget_id: copy.id, created_at: at, updated_at: at })); const clonedSteps = data.matrix_steps.filter((step) => step.budget_id === sourceBudgetId).map((step) => ({ ...structuredClone(step), id: this.createId(), budget_id: copy.id })); this.persist(fields.farm.id, { ...data, budgets: [...data.budgets, { ...copy, copied_from_budget_id: sourceBudgetId, created_at: at, updated_at: at }], cost_lines: [...data.cost_lines, ...clonedLines], matrix_steps: [...data.matrix_steps, ...clonedSteps] }) }
  async getBreakeven(scope: PositionScope, _fields: import('./fields').FieldsData) { const { data } = await this.data(); const budget = data.budgets.find((item) => item.farm_id === scope.farm_id && item.crop_year === scope.crop_year && item.commodity_id === scope.commodity_id && item.operating_entity_id === scope.operating_entity_id && item.enterprise_label === scope.enterprise_label); if (!budget) return null; const cost = data.cost_lines.filter((line) => line.budget_id === budget.id).reduce((total, line) => total + line.amount_per_acre, 0); return cost / budget.expected_yield_per_acre }
}
