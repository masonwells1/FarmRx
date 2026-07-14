import type { FieldsData, FieldsRepository } from './fields'
import type { PositionScope } from './grain'
import type { BudgetCostLineWrite, ProfitabilityDataGateway, ProfitabilityRowBundle } from './ProfitabilityDataGateway'
import { defaultMatrixValues } from './profitabilityCalculations'
import { validateRevenueProtectionInputs } from './insuranceMath'
import { insuranceColumns } from './SupabaseProfitabilityDataGateway'
import type { BudgetCostLine, BudgetFieldAllocation, CropBudget, InsuranceBudgetPatch, MatrixAxis, ProfitabilityMatrixStep, ProfitabilityRepository, ProfitabilityWorkspace } from './profitability'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const categories = new Set(['seed', 'chemical', 'fertilizer', 'fuel', 'repairs', 'labor', 'land', 'crop_insurance', 'equipment_depreciation', 'interest', 'custom'])
const PRIVACY_DENIED = 'Profitability records are private on this farm. Ask the farm owner or manager if you need access.'
const fail = (message = 'Farm Rx found invalid profitability data. Please contact support.'): never => { throw new Error(message) }
const object = (value: unknown): Record<string, unknown> => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(); return value as Record<string, unknown> }
const required = (row: Record<string, unknown>, key: string) => { if (!Object.hasOwn(row, key)) fail(); return row[key] }
const id = (value: unknown): string => { if (typeof value !== 'string' || !uuid.test(value)) fail(); return value as string }
const text = (value: unknown, max = 10_000): string => { if (typeof value !== 'string' || value.length > max) fail(); return value as string }
const nullableText = (value: unknown, max = 10_000): string | null => value === null ? null : text(value, max)
const number = (value: unknown): number => { const parsed = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN; if (!Number.isFinite(parsed)) fail(); return parsed }
const integer = (value: unknown, min = 1900, max = 2200): number => { const parsed = number(value); if (!Number.isInteger(parsed) || parsed < min || parsed > max) fail(); return parsed }
/** Accepts PostgREST's microsecond-plus-offset shape, e.g. 2026-07-11T23:35:28.807722+00:00 */
const stamp = (value: unknown): string => { const result = text(value, 64); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(result) || Number.isNaN(Date.parse(result))) fail(); return result }

function scope(row: Record<string, unknown>) { const operating_entity_id = required(row, 'operating_entity_id'); return { farm_id: id(required(row, 'farm_id')), crop_year: integer(required(row, 'crop_year')), commodity_id: text(required(row, 'commodity_id'), 160), operating_entity_id: operating_entity_id === null ? null : id(operating_entity_id), enterprise_label: nullableText(required(row, 'enterprise_label'), 160) } }
function mapBudget(value: unknown): CropBudget {
  const row = object(value)
  const copied_from_budget_id = required(row, 'copied_from_budget_id')
  const coverage = required(row, 'rp_coverage_pct'); const aph = required(row, 'rp_aph_yield'); const projectedPrice = required(row, 'rp_projected_price'); const premium = required(row, 'rp_premium_per_acre')
  const result: CropBudget = { id: id(required(row, 'id')), ...scope(row), name: text(required(row, 'name'), 160), expected_yield_per_acre: number(required(row, 'expected_yield_per_acre')), expected_price_per_bushel: number(required(row, 'expected_price_per_bushel')), rp_coverage_pct: coverage === null ? null : number(coverage), rp_aph_yield: aph === null ? null : number(aph), rp_projected_price: projectedPrice === null ? null : number(projectedPrice), rp_premium_per_acre: premium === null ? null : number(premium), copied_from_budget_id: copied_from_budget_id === null ? null : id(copied_from_budget_id), created_at: stamp(required(row, 'created_at')), updated_at: stamp(required(row, 'updated_at')) }
  if (!result.name.trim() || result.expected_yield_per_acre <= 0 || result.expected_price_per_bushel <= 0 || validateRevenueProtectionInputs(result).length) fail('Farm Rx found an invalid budget.')
  return result
}
function mapCostLine(value: unknown): BudgetCostLineWrite {
  const row = object(value)
  const category = text(required(row, 'category'))
  if (!categories.has(category)) fail('Farm Rx found an unknown cost category.')
  if (text(required(row, 'source_kind')) !== 'manual' || required(row, 'source_record_id') !== null) fail('Farm Rx only supports manually entered cost lines today.')
  const result: BudgetCostLineWrite = { id: id(required(row, 'id')), budget_id: id(required(row, 'budget_id')), category: category as BudgetCostLine['category'], name: text(required(row, 'label'), 160), amount_per_acre: number(required(row, 'amount_per_acre')), sort_order: integer(required(row, 'sort_order'), 0, 32_767), created_at: stamp(required(row, 'created_at')), updated_at: stamp(required(row, 'updated_at')) }
  if (!result.name.trim() || result.amount_per_acre < 0) fail('Farm Rx found an invalid cost line.')
  return result
}
function mapMatrixStep(value: unknown): ProfitabilityMatrixStep {
  const row = object(value)
  const axis = text(required(row, 'axis'))
  if (axis !== 'price' && axis !== 'yield') fail('Farm Rx found an unknown matrix axis.')
  const result: ProfitabilityMatrixStep = { id: id(required(row, 'id')), budget_id: id(required(row, 'budget_id')), axis: axis as MatrixAxis, value: number(required(row, 'value')), sort_order: integer(required(row, 'step_order'), 0, 32_767) }
  if (result.value <= 0) fail('Farm Rx found an invalid matrix step.')
  return result
}
function mapAllocation(value: unknown): BudgetFieldAllocation {
  const row = object(value)
  const yieldOverride = required(row, 'expected_yield_override'); const priceOverride = required(row, 'expected_price_override')
  const result: BudgetFieldAllocation = { id: id(required(row, 'id')), budget_id: id(required(row, 'budget_id')), crop_assignment_id: id(required(row, 'crop_assignment_id')), allocated_acres: number(required(row, 'allocated_acres')), expected_yield_override: yieldOverride === null ? null : number(yieldOverride), expected_price_override: priceOverride === null ? null : number(priceOverride), created_at: stamp(required(row, 'created_at')), updated_at: stamp(required(row, 'updated_at')) }
  if (result.allocated_acres <= 0 || (result.expected_yield_override !== null && result.expected_yield_override <= 0) || (result.expected_price_override !== null && result.expected_price_override <= 0)) fail('Farm Rx found an invalid field allocation.')
  return result
}
function mintCostLine(value: BudgetCostLine, siblings: BudgetCostLineWrite[]): BudgetCostLineWrite {
  const existing = siblings.find((line) => line.id === value.id)
  if (existing) return { ...value, sort_order: existing.sort_order }
  const budgetSiblings = siblings.filter((line) => line.budget_id === value.budget_id)
  return { ...value, sort_order: budgetSiblings.length ? Math.max(...budgetSiblings.map((line) => line.sort_order)) + 1 : 0 }
}

/** Trusted, pre-resolved write operations used directly by the live repository and replayed by the offline queue. */
export interface ProfitabilityOperationWriter {
  createBudgetOperation(value: CropBudget, priceSteps: ProfitabilityMatrixStep[], yieldSteps: ProfitabilityMatrixStep[]): Promise<{ budget: CropBudget; steps: ProfitabilityMatrixStep[] }>
  saveBudgetOperation(value: CropBudget): Promise<CropBudget>
  saveBudgetInsuranceOperation(budgetId: string, patch: InsuranceBudgetPatch): Promise<CropBudget>
  saveCostLineOperation(value: BudgetCostLineWrite): Promise<BudgetCostLine>
  deleteCostLineOperation(id: string): Promise<string>
  replaceMatrixStepsOperation(budgetId: string, steps: ProfitabilityMatrixStep[], expectedSteps?: ProfitabilityMatrixStep[] | null): Promise<ProfitabilityMatrixStep[]>
  saveAllocationOperation(value: BudgetFieldAllocation): Promise<BudgetFieldAllocation>
  deleteAllocationOperation(id: string): Promise<string>
  copyBudgetOperation(sourceBudgetId: string, budget: CropBudget, costLines: BudgetCostLineWrite[], matrixSteps: ProfitabilityMatrixStep[]): Promise<CropBudget>
  /** Raw cost lines (with sort_order) for the offline queue's client-side sort_order minting. */
  rawCostLines(): Promise<BudgetCostLineWrite[]>
}

export class SupabaseProfitabilityRepository implements ProfitabilityRepository, ProfitabilityOperationWriter {
  constructor(private readonly dependencies: { gateway: ProfitabilityDataGateway; fieldsRepository: FieldsRepository; getFarmId: () => Promise<string>; createId: () => string; clock: () => string }) {}
  private async fields() { return this.dependencies.fieldsRepository.getData() }
  async getSaveDurabilityCapability() { return this.dependencies.gateway.getSaveDurabilityCapability ? this.dependencies.gateway.getSaveDurabilityCapability() : false }
  private async loadRaw(farmId: string) {
    let bundle: ProfitabilityRowBundle
    try { bundle = await this.dependencies.gateway.loadWorkspace(farmId) }
    catch (error) { if (error instanceof Error && error.message === 'PROFITABILITY_PRIVATE_ACCESS_DENIED') fail(PRIVACY_DENIED); throw error }
    return { budgets: bundle.budgets.map(mapBudget), cost_lines: bundle.cost_lines.map(mapCostLine), matrix_steps: bundle.matrix_steps.map(mapMatrixStep), allocations: bundle.allocations.map(mapAllocation) }
  }
  private validateBudget(value: CropBudget, farmId: string, fields: FieldsData) {
    if (value.farm_id !== farmId) fail('Farm Rx could not verify the farm for this budget.')
    if (!value.name.trim() || value.expected_yield_per_acre <= 0 || value.expected_price_per_bushel <= 0) fail('Farm Rx found an invalid budget.')
    const rpErrors = validateRevenueProtectionInputs(value); if (rpErrors.length) fail(rpErrors[0])
    if (!fields.commodities.some((item) => item.id === value.commodity_id)) fail('Farm Rx could not verify this budget’s commodity.')
    if (value.operating_entity_id !== null && !fields.entities.some((item) => item.id === value.operating_entity_id && item.farm_id === farmId)) fail('Farm Rx could not verify this budget’s entity.')
  }
  private validateMatrix(steps: ProfitabilityMatrixStep[]) {
    for (const axis of ['price', 'yield'] as const) {
      const axisSteps = steps.filter((step) => step.axis === axis)
      if (axisSteps.length < 2) fail('Enter at least two price steps and two yield steps.')
      const values = new Set<number>(); const orders = new Set<number>()
      for (const step of axisSteps) {
        if (!uuid.test(step.id) || !Number.isFinite(step.value) || step.value <= 0 || !Number.isInteger(step.sort_order) || step.sort_order < 0) fail('Farm Rx found an invalid matrix step.')
        if (values.has(step.value)) fail('Matrix values must be distinct.')
        values.add(step.value)
        if (orders.has(step.sort_order)) fail('Matrix step order must be distinct.')
        orders.add(step.sort_order)
      }
    }
  }

  async getWorkspace(): Promise<ProfitabilityWorkspace> {
    const farmId = await this.dependencies.getFarmId()
    const [raw, fields] = await Promise.all([this.loadRaw(farmId), this.fields()])
    if (fields.farm.id !== farmId) fail('Farm Rx could not verify the selected farm.')
    const budgetIds = new Set<string>()
    for (const item of raw.budgets) { if (budgetIds.has(item.id)) fail('Farm Rx found a duplicated budget.'); budgetIds.add(item.id); this.validateBudget(item, farmId, fields) }
    const lineIds = new Set<string>()
    for (const item of raw.cost_lines) { if (lineIds.has(item.id)) fail('Farm Rx found a duplicated cost line.'); lineIds.add(item.id); if (!budgetIds.has(item.budget_id)) fail('Farm Rx found a cost line for an unknown budget.') }
    const stepIds = new Set<string>(); const stepOrders = new Set<string>(); const stepValues = new Set<string>()
    for (const item of raw.matrix_steps) {
      if (stepIds.has(item.id)) fail('Farm Rx found a duplicated matrix step.')
      stepIds.add(item.id)
      if (!budgetIds.has(item.budget_id)) fail('Farm Rx found a matrix step for an unknown budget.')
      const orderKey = `${item.budget_id}|${item.axis}|${item.sort_order}`; const valueKey = `${item.budget_id}|${item.axis}|${item.value}`
      if (stepOrders.has(orderKey)) fail('Farm Rx found a duplicated matrix step order.')
      stepOrders.add(orderKey)
      if (stepValues.has(valueKey)) fail('Farm Rx found a duplicated matrix value.')
      stepValues.add(valueKey)
    }
    const allocationIds = new Set<string>(); const allocationKeys = new Set<string>()
    for (const item of raw.allocations) {
      if (allocationIds.has(item.id)) fail('Farm Rx found a duplicated field allocation.')
      allocationIds.add(item.id)
      if (!budgetIds.has(item.budget_id)) fail('Farm Rx found a field allocation for an unknown budget.')
      if (!fields.crop_assignments.some((item2) => item2.id === item.crop_assignment_id && item2.farm_id === farmId)) fail('Farm Rx found a field allocation for an unknown field.')
      const key = `${item.budget_id}|${item.crop_assignment_id}`
      if (allocationKeys.has(key)) fail('Farm Rx found a duplicated field allocation.')
      allocationKeys.add(key)
    }
    const budgets = [...raw.budgets].sort((left, right) => left.crop_year - right.crop_year || left.commodity_id.localeCompare(right.commodity_id) || (left.operating_entity_id ?? '').localeCompare(right.operating_entity_id ?? '') || (left.enterprise_label ?? '').localeCompare(right.enterprise_label ?? '') || left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
    const cost_lines = [...raw.cost_lines].sort((left, right) => left.budget_id.localeCompare(right.budget_id) || left.sort_order - right.sort_order || left.id.localeCompare(right.id)).map(({ sort_order: _sortOrder, ...rest }) => rest)
    const matrix_steps = [...raw.matrix_steps].sort((left, right) => left.budget_id.localeCompare(right.budget_id) || left.axis.localeCompare(right.axis) || left.sort_order - right.sort_order)
    const allocations = [...raw.allocations].sort((left, right) => left.budget_id.localeCompare(right.budget_id) || left.crop_assignment_id.localeCompare(right.crop_assignment_id))
    return { budgets, cost_lines, matrix_steps, allocations, fields }
  }

  async createBudget(value: CropBudget) {
    const farmId = await this.dependencies.getFarmId(); const fields = await this.fields()
    const normalized: CropBudget = { ...value, farm_id: farmId, copied_from_budget_id: null }
    this.validateBudget(normalized, farmId, fields)
    const { priceValues, yieldValues } = defaultMatrixValues(normalized)
    const priceSteps: ProfitabilityMatrixStep[] = priceValues.map((amount, index) => ({ id: this.dependencies.createId(), budget_id: normalized.id, axis: 'price', value: amount, sort_order: index }))
    const yieldSteps: ProfitabilityMatrixStep[] = yieldValues.map((amount, index) => ({ id: this.dependencies.createId(), budget_id: normalized.id, axis: 'yield', value: amount, sort_order: index }))
    await this.createBudgetOperation(normalized, priceSteps, yieldSteps)
  }
  async createBudgetOperation(value: CropBudget, priceSteps: ProfitabilityMatrixStep[], yieldSteps: ProfitabilityMatrixStep[]) {
    const farmId = await this.dependencies.getFarmId(); const fields = await this.fields()
    const normalized: CropBudget = { ...value, farm_id: farmId, copied_from_budget_id: null }
    this.validateBudget(normalized, farmId, fields)
    const steps = [...priceSteps, ...yieldSteps].map((step) => ({ ...step, budget_id: normalized.id }))
    this.validateMatrix(steps)
    const savedBudget = mapBudget(await this.dependencies.gateway.createBudgetWithMatrix({ farmId, budget: normalized, matrixSteps: steps }))
    const savedSteps = steps
    if (savedBudget.id !== normalized.id || savedBudget.farm_id !== farmId) fail('Farm Rx could not confirm this budget saved.')
    return { budget: savedBudget, steps: savedSteps }
  }

  async saveBudget(value: CropBudget) { await this.saveBudgetOperation(value) }
  async saveBudgetInsurance(budgetId: string, patch: InsuranceBudgetPatch) { await this.saveBudgetInsuranceOperation(budgetId, patch) }
  async saveBudgetInsuranceOperation(budgetId: string, patch: InsuranceBudgetPatch): Promise<CropBudget> {
    insuranceColumns(patch)
    const farmId = await this.dependencies.getFarmId(); const fields = await this.fields()
    if (!uuid.test(budgetId)) fail('Farm Rx could not save this insurance detail.')
    const current = (await this.loadRaw(farmId)).budgets.find((item) => item.id === budgetId)
    if (!current) fail('That budget changed before its insurance details could be saved.')
    const next = { ...(current as CropBudget), ...patch }; this.validateBudget(next, farmId, fields)
    const saved = mapBudget(await this.dependencies.gateway.patchBudgetInsurance(farmId, budgetId, patch))
    if (saved.id !== budgetId || saved.farm_id !== farmId || Object.keys(patch).some((key) => saved[key as keyof CropBudget] !== patch[key as keyof InsuranceBudgetPatch])) fail('Farm Rx could not confirm the insurance save.')
    return saved
  }
  async saveBudgetOperation(value: CropBudget): Promise<CropBudget> {
    const farmId = await this.dependencies.getFarmId(); const fields = await this.fields()
    const normalized: CropBudget = { ...value, farm_id: farmId }
    this.validateBudget(normalized, farmId, fields)
    const raw = await this.loadRaw(farmId)
    const existing = raw.budgets.find((item) => item.id === normalized.id)
    if (existing && (existing.crop_year !== normalized.crop_year || existing.commodity_id !== normalized.commodity_id || existing.operating_entity_id !== normalized.operating_entity_id) && raw.allocations.some((item) => item.budget_id === normalized.id)) fail('Remove field allocations before changing this budget’s crop, year, or entity.')
    const saved = mapBudget(await this.dependencies.gateway.upsertBudget(farmId, normalized))
    this.validateBudget(saved, farmId, fields)
    if (saved.id !== normalized.id || saved.farm_id !== farmId || saved.crop_year !== normalized.crop_year || saved.commodity_id !== normalized.commodity_id || saved.operating_entity_id !== normalized.operating_entity_id || saved.enterprise_label !== normalized.enterprise_label) fail('Farm Rx could not confirm this budget saved.')
    return saved
  }

  async saveCostLine(value: BudgetCostLine) {
    const farmId = await this.dependencies.getFarmId()
    const raw = await this.loadRaw(farmId)
    if (!raw.budgets.some((item) => item.id === value.budget_id)) fail('That budget changed before this cost line could be saved. Refresh and try again.')
    await this.saveCostLineOperation(mintCostLine(value, raw.cost_lines))
  }
  async saveCostLineOperation(value: BudgetCostLineWrite): Promise<BudgetCostLine> {
    const farmId = await this.dependencies.getFarmId()
    if (!uuid.test(value.id) || !uuid.test(value.budget_id) || !value.name.trim() || value.amount_per_acre < 0 || !Number.isInteger(value.sort_order) || value.sort_order < 0) fail('Farm Rx could not save this cost line.')
    const saved = mapCostLine(await this.dependencies.gateway.upsertCostLine(farmId, value))
    if (saved.id !== value.id || saved.budget_id !== value.budget_id || saved.name !== value.name || saved.amount_per_acre !== value.amount_per_acre) fail('Farm Rx could not confirm this cost line saved.')
    const { sort_order: _sortOrder, ...publicLine } = saved
    return publicLine
  }
  async rawCostLines(): Promise<BudgetCostLineWrite[]> { const farmId = await this.dependencies.getFarmId(); return (await this.loadRaw(farmId)).cost_lines }

  async deleteCostLine(costLineId: string) { await this.deleteCostLineOperation(costLineId) }
  async deleteCostLineOperation(costLineId: string): Promise<string> {
    const farmId = await this.dependencies.getFarmId()
    if (!uuid.test(costLineId)) fail('Farm Rx could not remove this cost line.')
    const deletedId = await this.dependencies.gateway.deleteCostLine(farmId, costLineId)
    if (typeof deletedId !== 'string' || deletedId !== costLineId) fail('Farm Rx could not confirm this cost line was removed.')
    return deletedId as string
  }

  async replaceMatrixSteps(budgetId: string, steps: ProfitabilityMatrixStep[]) { const raw = await this.loadRaw(await this.dependencies.getFarmId()); await this.replaceMatrixStepsOperation(budgetId, steps, raw.matrix_steps.filter((step) => step.budget_id === budgetId)) }
  async replaceMatrixStepsOperation(budgetId: string, steps: ProfitabilityMatrixStep[], expectedSteps?: ProfitabilityMatrixStep[] | null): Promise<ProfitabilityMatrixStep[]> {
    const farmId = await this.dependencies.getFarmId()
    if (!uuid.test(budgetId)) fail('Farm Rx could not save this matrix.')
    const normalized = steps.map((step) => ({ ...step, budget_id: budgetId }))
    this.validateMatrix(normalized)
    const savedAll = (await this.dependencies.gateway.replaceMatrixSteps({ farmId, budgetId, steps: normalized, expectedSteps })).map(mapMatrixStep)
    const saved = savedAll.filter((step) => step.budget_id === budgetId)
    this.validateMatrix(saved)
    const key = (step: ProfitabilityMatrixStep) => `${step.id}|${step.axis}|${step.sort_order}|${step.value}`
    const expected = normalized.map(key).sort(); const actual = saved.map(key).sort()
    if (expected.length !== actual.length || expected.some((value, index) => value !== actual[index])) fail('Farm Rx could not confirm the matrix saved.')
    return saved
  }

  async saveAllocation(value: BudgetFieldAllocation) { await this.saveAllocationOperation(value) }
  async saveAllocationOperation(value: BudgetFieldAllocation): Promise<BudgetFieldAllocation> {
    const farmId = await this.dependencies.getFarmId(); const fields = await this.fields(); const raw = await this.loadRaw(farmId)
    const budgetRow = raw.budgets.find((item) => item.id === value.budget_id)
    const assignmentRow = fields.crop_assignments.find((item) => item.id === value.crop_assignment_id && item.farm_id === farmId)
    if (!budgetRow || !assignmentRow) fail('That field crop does not match this budget.')
    const confirmedBudget = budgetRow as NonNullable<typeof budgetRow>
    const assignment = assignmentRow as NonNullable<typeof assignmentRow>
    if (assignment.crop_year !== confirmedBudget.crop_year || assignment.commodity_id !== confirmedBudget.commodity_id) fail('That field crop does not match this budget.')
    if (!uuid.test(value.id) || value.allocated_acres <= 0) fail('Farm Rx could not save this field allocation.')
    if (value.allocated_acres > assignment.planted_acres) fail('Allocated acres cannot be more than planted acres.')
    if (raw.allocations.some((item) => item.id !== value.id && item.budget_id === value.budget_id && item.crop_assignment_id === value.crop_assignment_id)) fail('That field is already allocated to this budget.')
    const saved = mapAllocation(await this.dependencies.gateway.upsertAllocation(farmId, value))
    if (saved.id !== value.id || saved.budget_id !== value.budget_id || saved.crop_assignment_id !== value.crop_assignment_id || saved.allocated_acres !== value.allocated_acres) fail('Farm Rx could not confirm this field allocation saved.')
    return saved
  }

  async deleteAllocation(allocationId: string) { await this.deleteAllocationOperation(allocationId) }
  async deleteAllocationOperation(allocationId: string): Promise<string> {
    const farmId = await this.dependencies.getFarmId()
    if (!uuid.test(allocationId)) fail('Farm Rx could not remove this field allocation.')
    const deletedId = await this.dependencies.gateway.deleteAllocation(farmId, allocationId)
    if (typeof deletedId !== 'string' || deletedId !== allocationId) fail('Farm Rx could not confirm this field allocation was removed.')
    return deletedId as string
  }

  async copyBudget(sourceBudgetId: string, copy: CropBudget) {
    const farmId = await this.dependencies.getFarmId()
    const raw = await this.loadRaw(farmId)
    const source = raw.budgets.find((item) => item.id === sourceBudgetId)
    if (!source || copy.farm_id !== farmId) fail('Choose a budget from this farm to copy.')
    const costLines: BudgetCostLineWrite[] = raw.cost_lines.filter((line) => line.budget_id === sourceBudgetId).map((line) => ({ ...structuredClone(line), id: this.dependencies.createId(), budget_id: copy.id }))
    const matrixSteps: ProfitabilityMatrixStep[] = raw.matrix_steps.filter((step) => step.budget_id === sourceBudgetId).map((step) => ({ ...structuredClone(step), id: this.dependencies.createId(), budget_id: copy.id }))
    await this.copyBudgetOperation(sourceBudgetId, { ...copy, copied_from_budget_id: sourceBudgetId }, costLines, matrixSteps)
  }
  async copyBudgetOperation(sourceBudgetId: string, value: CropBudget, costLines: BudgetCostLineWrite[], matrixSteps: ProfitabilityMatrixStep[]): Promise<CropBudget> {
    const farmId = await this.dependencies.getFarmId(); const fields = await this.fields()
    const normalized: CropBudget = { ...value, farm_id: farmId, copied_from_budget_id: sourceBudgetId }
    this.validateBudget(normalized, farmId, fields)
    if (!uuid.test(sourceBudgetId) || normalized.id === sourceBudgetId) fail('Farm Rx could not copy this budget.')
    for (const line of costLines) if (line.budget_id !== normalized.id) fail('Farm Rx could not copy this budget.')
    for (const step of matrixSteps) if (step.budget_id !== normalized.id) fail('Farm Rx could not copy this budget.')
    this.validateMatrix(matrixSteps)
    const saved = mapBudget(await this.dependencies.gateway.copyBudget({ farmId, sourceId: sourceBudgetId, budget: normalized, costLines, matrixSteps }))
    if (saved.id !== normalized.id || saved.copied_from_budget_id !== sourceBudgetId || saved.farm_id !== farmId || saved.crop_year !== normalized.crop_year || saved.commodity_id !== normalized.commodity_id || saved.operating_entity_id !== normalized.operating_entity_id || saved.enterprise_label !== normalized.enterprise_label) fail('Farm Rx could not confirm this budget was copied.')
    return saved
  }

  async getBreakeven(scope: PositionScope, _fields: FieldsData): Promise<number | null> {
    const workspace = await this.getWorkspace()
    const match = workspace.budgets.find((item) => item.farm_id === scope.farm_id && item.crop_year === scope.crop_year && item.commodity_id === scope.commodity_id && item.operating_entity_id === scope.operating_entity_id && item.enterprise_label === scope.enterprise_label)
    if (!match) return null
    const cost = workspace.cost_lines.filter((line) => line.budget_id === match.id).reduce((total, line) => total + line.amount_per_acre, 0)
    return cost / match.expected_yield_per_acre
  }
}
