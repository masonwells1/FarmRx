import { fieldsSeedForRegression } from './MockFieldsRepository'
import type { BudgetCostLineWrite, CopyBudgetInput, ProfitabilityDataGateway, ProfitabilityRowBundle, ReplaceMatrixStepsInput } from './ProfitabilityDataGateway'
import { ProfitabilityWriteQueue, type ProfitabilityQueueEntryV1, parseProfitabilityQueue, profitabilityWriteQueueKey } from './profitabilityWriteQueue'
import { QueuedProfitabilityRepository } from './QueuedProfitabilityRepository'
import { manualCostLineWrite, SupabaseProfitabilityRepository } from './SupabaseProfitabilityRepository'
import { InvalidInsurancePatchError, SupabaseProfitabilityDataGateway, durabilityCapabilityFromProbe } from './SupabaseProfitabilityDataGateway'
import { grainWriteQueueKey } from './grainWriteQueue'
import { writeQueueKey } from './writeQueue'
import { moduleBackends } from './backends'
import { supabaseConfig } from '../lib/supabaseConfig'
import { supabase } from '../lib/supabaseClient'
import { getSyncStatus } from './syncStatus'
import { readNeedsAttention } from './needsAttentionStore'
import { getSaveReceipt } from '../lib/saveReceipt'
import type { FieldsRepository } from './fields'
import type { BudgetCostLine, BudgetFieldAllocation, CropBudget, ProfitabilityMatrixStep } from './profitability'
import type { StorageLike } from './writeQueue'

const stamp = '2026-07-11T00:00:00.000Z'
const microStamp = '2026-07-11T23:35:28.807722+00:00'
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => Promise<unknown>, message: string) { let failed = false; try { await action() } catch { failed = true }; assert(failed, message) }

function fixture() {
  const fields = fieldsSeedForRegression()
  const farm = fields.farm.id
  const commodity = fields.commodities[0].id
  const assignment = fields.crop_assignments.find((item) => item.commodity_id === commodity)!
  const budget = { id: uid(1), farm_id: farm, crop_year: assignment.crop_year, commodity_id: commodity, operating_entity_id: null, enterprise_label: null, name: 'Base', expected_yield_per_acre: '200', expected_price_per_bushel: 4.5, rp_coverage_pct: '80', rp_aph_yield: 180, rp_projected_price: '4.62', rp_premium_per_acre: 0, copied_from_budget_id: null, notes: null, created_at: microStamp, updated_at: stamp }
  const line1 = { id: uid(2), farm_id: farm, budget_id: budget.id, category: 'seed', label: 'Seed', amount_per_acre: '120', source_kind: 'manual', source_record_id: null, sort_order: 0, notes: null, created_at: stamp, updated_at: stamp }
  const line2 = { id: uid(3), farm_id: farm, budget_id: budget.id, category: 'fertilizer', label: 'Fertilizer', amount_per_acre: 150, source_kind: 'manual', source_record_id: null, sort_order: 1, notes: null, created_at: stamp, updated_at: stamp }
  const priceSteps = [3.8, 4.2, 4.6].map((value, index) => ({ id: uid(10 + index), farm_id: farm, budget_id: budget.id, axis: 'price', step_order: index, value, created_at: stamp, updated_at: stamp }))
  const yieldSteps = [180, 200, 220].map((value, index) => ({ id: uid(20 + index), farm_id: farm, budget_id: budget.id, axis: 'yield', step_order: index, value, created_at: stamp, updated_at: stamp }))
  const allocation = { id: uid(30), farm_id: farm, budget_id: budget.id, crop_assignment_id: assignment.id, allocated_acres: 50, expected_yield_override: null, expected_price_override: null, notes: null, created_at: stamp, updated_at: stamp }
  const scope = { farm_id: farm, crop_year: assignment.crop_year, commodity_id: commodity, operating_entity_id: null as string | null, enterprise_label: null as string | null }
  return { fields, scope, assignment, bundle: { budgets: [budget], cost_lines: [line1, line2], matrix_steps: [...priceSteps, ...yieldSteps], allocations: [allocation] } }
}
type Mutators = { budget?: (v: Record<string, unknown>) => Record<string, unknown>; costLine?: (v: Record<string, unknown>) => Record<string, unknown>; allocation?: (v: Record<string, unknown>) => Record<string, unknown>; matrix?: (v: Record<string, unknown>[]) => Record<string, unknown>[]; copy?: (v: Record<string, unknown>) => Record<string, unknown>; deleteEcho?: (id: string) => string }
class FakeGateway implements ProfitabilityDataGateway {
  readonly state = fixture(); fail = false; throwError: Error | null = null; mutate: Mutators = {}
  budgetInputs: CropBudget[] = []; costLineInputs: BudgetCostLineWrite[] = []; deletedCostLineIds: string[] = []
  allocationInputs: BudgetFieldAllocation[] = []; deletedAllocationIds: string[] = []
  matrixInputs: ReplaceMatrixStepsInput[] = []; copyInputs: CopyBudgetInput[] = []; insuranceCalls = 0; afterInsuranceMutation: (() => void) | null = null
  private guard() { if (this.throwError) throw this.throwError }
  async loadWorkspace(_farmId: string): Promise<ProfitabilityRowBundle> { if (this.fail) throw new Error('network timeout'); return structuredClone(this.state.bundle) }
  async upsertBudget(_farmId: string, row: CropBudget) {
    this.guard(); this.budgetInputs.push(structuredClone(row))
    const response = { ...structuredClone(row), notes: null } as unknown as Record<string, unknown>
    return this.mutate.budget ? this.mutate.budget(response) : response
  }
  async patchBudgetInsurance(_farmId: string, budgetId: string, patch: import('./profitability').InsuranceBudgetPatch) {
    this.guard(); this.insuranceCalls++; const current = this.state.bundle.budgets.find((item) => item.id === budgetId) as Record<string, unknown> | undefined
    if (!current) throw new Error('missing budget')
    const response = { ...current, ...patch }; this.afterInsuranceMutation?.(); return response
  }
  async upsertCostLine(_farmId: string, row: BudgetCostLineWrite) {
    this.guard(); this.costLineInputs.push(structuredClone(row))
    const siblings = this.state.bundle.cost_lines as Array<Record<string, unknown>>
    if (siblings.some((line) => line.budget_id === row.budget_id && line.id !== row.id && line.sort_order === row.sort_order)) throw Object.assign(new Error('duplicate key value violates unique constraint "budget_cost_lines_budget_id_sort_order_key"'), { code: '23505' })
    const response = { id: row.id, farm_id: this.state.scope.farm_id, budget_id: row.budget_id, category: row.category, label: row.name, amount_per_acre: row.amount_per_acre, source_kind: 'manual', source_record_id: null, sort_order: row.sort_order, notes: null, created_at: row.created_at, updated_at: row.updated_at }
    return this.mutate.costLine ? this.mutate.costLine(response) : response
  }
  async deleteCostLine(_farmId: string, id: string) { this.guard(); this.deletedCostLineIds.push(id); return this.mutate.deleteEcho ? this.mutate.deleteEcho(id) : id }
  async upsertAllocation(_farmId: string, row: BudgetFieldAllocation) {
    this.guard(); this.allocationInputs.push(structuredClone(row))
    const response = { id: row.id, farm_id: this.state.scope.farm_id, budget_id: row.budget_id, crop_assignment_id: row.crop_assignment_id, allocated_acres: row.allocated_acres, expected_yield_override: row.expected_yield_override, expected_price_override: row.expected_price_override, notes: null, created_at: row.created_at, updated_at: row.updated_at }
    return this.mutate.allocation ? this.mutate.allocation(response) : response
  }
  async deleteAllocation(_farmId: string, id: string) { this.guard(); this.deletedAllocationIds.push(id); return this.mutate.deleteEcho ? this.mutate.deleteEcho(id) : id }
  async replaceMatrixSteps(input: ReplaceMatrixStepsInput) {
    this.guard(); this.matrixInputs.push(structuredClone(input))
    const key = (step: ProfitabilityMatrixStep) => `${step.id}|${step.axis}|${step.sort_order}|${step.value}`
    const current = (this.state.bundle.matrix_steps as unknown as ProfitabilityMatrixStep[]).filter((step) => step.budget_id === input.budgetId)
    if (input.expectedSteps !== undefined && input.expectedSteps !== null && current.map(key).sort().join('|') !== input.expectedSteps.map(key).sort().join('|')) throw new Error('MATRIX_CHANGED_ON_ANOTHER_DEVICE')
    if (input.steps.length === 0) return []
    this.state.bundle.matrix_steps = [...this.state.bundle.matrix_steps.filter((step) => step.budget_id !== input.budgetId), ...input.steps.map((step) => ({ id: step.id, farm_id: this.state.scope.farm_id, budget_id: step.budget_id, axis: step.axis, step_order: step.sort_order, value: step.value, created_at: stamp, updated_at: stamp }))]
    const response = input.steps.map((step) => ({ id: step.id, farm_id: this.state.scope.farm_id, budget_id: step.budget_id, axis: step.axis, step_order: step.sort_order, value: step.value, created_at: stamp, updated_at: stamp }))
    return this.mutate.matrix ? this.mutate.matrix(response) : response
  }
  async createBudgetWithMatrix(input: { farmId: string; budget: CropBudget; matrixSteps: ProfitabilityMatrixStep[]; context: import('./farmOperationContext').FarmOperationContext }) {
    this.guard(); this.budgetInputs.push(structuredClone(input.budget)); this.matrixInputs.push({ farmId: input.farmId, budgetId: input.budget.id, steps: structuredClone(input.matrixSteps), expectedSteps: null, context: input.context })
    return { ...input.budget, farm_id: this.state.scope.farm_id, notes: null }
  }
  async copyBudget(input: CopyBudgetInput) {
    this.guard(); this.copyInputs.push(structuredClone(input))
    const { id, farm_id: _f, crop_year, commodity_id, operating_entity_id, enterprise_label, name, expected_yield_per_acre, expected_price_per_bushel, rp_coverage_pct, rp_aph_yield, rp_projected_price, rp_premium_per_acre, copied_from_budget_id } = input.budget
    const response = { id, farm_id: this.state.scope.farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, name, expected_yield_per_acre, expected_price_per_bushel, rp_coverage_pct, rp_aph_yield, rp_projected_price, rp_premium_per_acre, copied_from_budget_id, notes: null, created_at: stamp, updated_at: stamp }
    return this.mutate.copy ? this.mutate.copy(response) : response
  }
}
function repository(gateway: FakeGateway, verifyOperationContext: (context: import('./farmOperationContext').FarmOperationContext) => Promise<void> = async () => undefined) {
  const fields = gateway.state.fields
  const fieldsRepository: FieldsRepository = { getData: async () => structuredClone(fields), saveField: async () => { throw new Error('not used') } }
  let n = 900
  const operationContext = { projectRef: 'test', userId: uid(10), farmId: fields.farm.id, generation: 1, token: uid(999), serverEpoch: 1 }
  return new SupabaseProfitabilityRepository({ gateway, fieldsRepository, getFarmId: async () => fields.farm.id, getOperationContext: async () => operationContext, verifyOperationContext, createId: () => uid(n++), clock: () => stamp })
}
function memoryStorage(): StorageLike & { values: Map<string, string> } { return { values: new Map(), getItem(key) { return this.values.get(key) ?? null }, setItem(key, value) { this.values.set(key, value) }, removeItem(key) { this.values.delete(key) } } }

async function run() {
  assert(durabilityCapabilityFromProbe(null) === true, 'A successful durability probe must enable the capability.')
  assert(durabilityCapabilityFromProbe({ code: undefined, message: 'fetch failed' }) === false, 'An unknown/transport durability probe error must fail closed.')
  assert(durabilityCapabilityFromProbe({ code: 'P0001', message: 'authentication is required' }) === true, 'The RPC authentication sentinel must prove the durability capability.')
  assert(durabilityCapabilityFromProbe({ code: '42501', message: 'unexpected permission text' }) === false && durabilityCapabilityFromProbe({ code: 'P0001', message: 'unexpected permission text' }) === false, 'Non-sentinel 42501/P0001 durability probe messages must fail closed.')
  assert(durabilityCapabilityFromProbe({ message: 'authentication is required' }) === false && durabilityCapabilityFromProbe({ code: 'unknown', message: 'permission to edit this farm' }) === false, 'Unknown or absent durability probe codes must fail closed.')
  assert(durabilityCapabilityFromProbe({ code: '42501', message: 'Authentication is required.' }) === true && durabilityCapabilityFromProbe({ code: 'P0001', message: 'permission to edit this farm' }) === true, 'Both recognized durability probe codes must require and accept their matching sentinel messages.')
  const probeClient = supabase as unknown as { rpc: (name: string, args: Record<string, unknown>) => Promise<{ error: { code?: unknown; message?: unknown } | null }> }; const originalRpc = probeClient.rpc; let probeCalls = 0
  try { probeClient.rpc = async () => { probeCalls += 1; if (probeCalls === 1) throw new Error('network reset'); return { error: { code: '42501', message: 'authentication is required' } } }; const probeGateway = new SupabaseProfitabilityDataGateway(); assert(await probeGateway.getSaveDurabilityCapability() === false && await probeGateway.getSaveDurabilityCapability() === true && probeCalls === 2, 'A rejected durability probe must resolve false and clear its cache so the next call re-probes.') } finally { probeClient.rpc = originalRpc }
  const gateway = new FakeGateway(); const repo = repository(gateway); const workspace = await repo.getWorkspace()
  // 1: strict mapping — numeric strings, microsecond+offset timestamps, label->name, step_order->sort_order round-trip.
  assert(workspace.budgets.length === 1 && workspace.budgets[0].expected_yield_per_acre === 200 && workspace.budgets[0].created_at === microStamp && workspace.budgets[0].rp_coverage_pct === 80 && workspace.budgets[0].rp_projected_price === 4.62, 'Budget mapping must round-trip RP columns, coerce numeric strings, and accept microsecond+offset timestamps.')
  assert(workspace.cost_lines.find((line) => line.id === uid(2))?.name === 'Seed' && workspace.cost_lines.find((line) => line.id === uid(2))?.amount_per_acre === 120, 'Cost line label->name mapping failed.')
  assert(workspace.matrix_steps.find((step) => step.id === uid(10))?.sort_order === 0, 'Matrix step_order->sort_order mapping failed.')
  assert(!('sort_order' in (workspace.cost_lines[0] as object)) || (workspace.cost_lines[0] as { sort_order?: unknown }).sort_order === undefined, 'Public cost lines must not leak the DB-only sort_order column.')
  // 2: ordering is deterministic.
  assert(workspace.cost_lines[0].id === uid(2) && workspace.cost_lines[1].id === uid(3), 'Cost lines must be ordered by budget_id, sort_order.')
  assert(workspace.matrix_steps[0].axis === 'price' && workspace.matrix_steps[0].sort_order === 0 && workspace.matrix_steps[3].axis === 'yield', 'Matrix steps must be ordered by budget_id, axis, step_order.')
  // 3: transport failure rejects; a live failure never falls back to mock or partial data.
  gateway.fail = true; await rejects(() => repo.getWorkspace(), 'Gateway failure must reject.'); gateway.fail = false
  // 4: fail-closed mapping — missing key, bad enum, non-positive matrix value, malformed timestamp.
  const missingKey = structuredClone(gateway.state.bundle); delete (missingKey.budgets[0] as Record<string, unknown>).name; gateway.state.bundle.budgets = missingKey.budgets; await rejects(() => repo.getWorkspace(), 'A budget missing a required key must reject.'); gateway.state.bundle.budgets = fixture().bundle.budgets
  const badCategory = structuredClone(gateway.state.bundle); (badCategory.cost_lines[0] as Record<string, unknown>).category = 'mystery'; gateway.state.bundle.cost_lines = badCategory.cost_lines; await rejects(() => repo.getWorkspace(), 'An unknown cost category must reject.'); gateway.state.bundle.cost_lines = fixture().bundle.cost_lines
  const badStamp = structuredClone(gateway.state.bundle); (badStamp.budgets[0] as Record<string, unknown>).updated_at = 'not-a-date'; gateway.state.bundle.budgets = badStamp.budgets; await rejects(() => repo.getWorkspace(), 'A malformed timestamp must reject.'); gateway.state.bundle.budgets = fixture().bundle.budgets
  // 5: farm/scope isolation — an orphaned child row referencing an unknown budget or unknown field fails closed.
  const orphanLine = structuredClone(gateway.state.bundle); (orphanLine.cost_lines[0] as Record<string, unknown>).budget_id = uid(999); gateway.state.bundle.cost_lines = orphanLine.cost_lines; await rejects(() => repo.getWorkspace(), 'A cost line referencing an unknown budget must reject.'); gateway.state.bundle.cost_lines = fixture().bundle.cost_lines
  const orphanAllocation = structuredClone(gateway.state.bundle); (orphanAllocation.allocations[0] as Record<string, unknown>).crop_assignment_id = uid(999); gateway.state.bundle.allocations = orphanAllocation.allocations; await rejects(() => repo.getWorkspace(), 'An allocation referencing an unknown field must reject.'); gateway.state.bundle.allocations = fixture().bundle.allocations
  const foreignBudget = structuredClone(gateway.state.bundle); (foreignBudget.budgets[0] as Record<string, unknown>).commodity_id = 'not-a-real-commodity'; gateway.state.bundle.budgets = foreignBudget.budgets; await rejects(() => repo.getWorkspace(), 'A budget with an unverifiable commodity must reject.'); gateway.state.bundle.budgets = fixture().bundle.budgets
  // 6: canonical-confirmation rejections — the repository must confirm the server's echoed rows, never trust its own request.
  const savedBudget = workspace.budgets[0]
  let insuranceError: unknown = null
  const insuranceCallsBefore = gateway.insuranceCalls
  try { await repo.saveBudgetInsurance(savedBudget.id, { rp_coverage_pct: 80, expected_price_per_bushel: 5 } as unknown as import('./profitability').InsuranceBudgetPatch) } catch (error) { insuranceError = error }
  assert(insuranceError instanceof InvalidInsurancePatchError && gateway.insuranceCalls === insuranceCallsBefore, 'An insurance patch with an extra key must throw InvalidInsurancePatchError before reaching the fake gateway.')
  await repo.saveBudget(savedBudget)
  assert(gateway.budgetInputs.at(-1)?.rp_coverage_pct === 80 && gateway.budgetInputs.at(-1)?.rp_aph_yield === 180 && gateway.budgetInputs.at(-1)?.rp_projected_price === 4.62 && gateway.budgetInputs.at(-1)?.rp_premium_per_acre === 0, 'Saving a budget must preserve every RP column.')
  gateway.mutate.budget = (row) => ({ ...row, id: uid(500) })
  await rejects(() => repo.saveBudget(savedBudget), 'A budget response with a wrong id must reject.')
  gateway.mutate = {}
  gateway.mutate.budget = (row) => ({ ...row, commodity_id: `${row.commodity_id}-other` })
  await rejects(() => repo.saveBudget(savedBudget), 'A budget response with a wrong scope must reject.')
  gateway.mutate = {}
  gateway.mutate.costLine = (row) => ({ ...row, id: uid(501) })
  await rejects(() => repo.saveCostLine(workspace.cost_lines[0]), 'A cost line response with a wrong id must reject.')
  gateway.mutate = {}
  gateway.mutate.allocation = (row) => ({ ...row, budget_id: uid(502) })
  await rejects(() => repo.saveAllocation(workspace.allocations[0]), 'An allocation response with a wrong budget must reject.')
  gateway.mutate = {}
  gateway.mutate.matrix = (rows) => rows.slice(0, rows.length - 1)
  await rejects(() => repo.replaceMatrixSteps(savedBudget.id, workspace.matrix_steps.filter((step) => step.budget_id === savedBudget.id)), 'An incomplete matrix response must reject.')
  gateway.mutate = {}
  gateway.mutate.copy = (row) => ({ ...row, copied_from_budget_id: uid(503) })
  const copyTarget: CropBudget = { ...savedBudget, id: uid(600), name: 'Copy', copied_from_budget_id: null }
  await rejects(() => repo.copyBudget(savedBudget.id, copyTarget), 'A copy response with a wrong lineage must reject.')
  gateway.mutate = {}
  gateway.mutate.copy = (row) => ({ ...row, crop_year: (row.crop_year as number) + 1 })
  await rejects(() => repo.copyBudget(savedBudget.id, { ...copyTarget, id: uid(601) }), 'A copy response with a wrong scope must reject.')
  gateway.mutate = {}
  gateway.mutate.deleteEcho = () => uid(504)
  await rejects(() => repo.deleteCostLine(workspace.cost_lines[0].id), 'A delete echoing a wrong cost-line id must reject.')
  await rejects(() => repo.deleteAllocation(workspace.allocations[0].id), 'A delete echoing a wrong allocation id must reject.')
  gateway.mutate = {}
  // 7: live failure stays live — no mock fallback exists to fall back to.
  gateway.fail = true; await rejects(() => repo.getWorkspace(), 'Live failure must never become a mock success.'); gateway.fail = false
  // 8: privacy — the sentinel becomes one calm farmer-English denial, and nothing loads.
  gateway.fail = false
  const originalLoad = gateway.loadWorkspace.bind(gateway)
  gateway.loadWorkspace = async () => { throw new Error('PROFITABILITY_PRIVATE_ACCESS_DENIED') }
  try { await repo.getWorkspace(); assert(false, 'Privacy denial must reject.') } catch (error) { assert(error instanceof Error && /private/i.test(error.message) && !/PROFITABILITY_PRIVATE_ACCESS_DENIED/.test(error.message), 'Privacy denial must be a calm farmer-English message, not the raw sentinel.') }
  gateway.loadWorkspace = originalLoad
  // 9: sort_order assignment — a new cost line gets max+1; an existing id keeps its own sort_order.
  const newLine: BudgetCostLine = { id: uid(700), budget_id: savedBudget.id, category: 'fuel', name: 'Fuel', amount_per_acre: 30, created_at: stamp, updated_at: stamp }
  await repo.saveCostLine(newLine)
  assert(gateway.costLineInputs.at(-1)?.sort_order === 2, 'A brand-new cost line must be assigned max(sort_order)+1.')
  await repo.saveCostLine({ ...workspace.cost_lines[0], amount_per_acre: 999 })
  assert(gateway.costLineInputs.at(-1)?.sort_order === 0, 'Updating an existing cost line must keep its own sort_order.')
  // 10: a forced duplicate sort_order fails closed (simulating the DB's unique constraint).
  const operationContext = { projectRef: 'test', userId: uid(10), farmId: gateway.state.fields.farm.id, generation: 1, token: uid(999), serverEpoch: 1 }
  await rejects(() => repo.saveCostLineOperation({ id: uid(701), budget_id: savedBudget.id, category: 'labor', name: 'Labor', amount_per_acre: 10, sort_order: 0, created_at: stamp, updated_at: stamp }, operationContext), 'A forced duplicate sort_order must fail closed.')
  // 11: matrix validation — fewer than two steps per axis, and duplicate values, are rejected before the gateway is called.
  const matrixCallsBefore = gateway.matrixInputs.length
  await rejects(() => repo.replaceMatrixSteps(savedBudget.id, [{ id: uid(710), budget_id: savedBudget.id, axis: 'price', value: 4, sort_order: 0 }]), 'Fewer than two steps per axis must reject.')
  assert(gateway.matrixInputs.length === matrixCallsBefore, 'An invalid matrix must reject before reaching the gateway.')
  await rejects(() => repo.replaceMatrixSteps(savedBudget.id, [{ id: uid(711), budget_id: savedBudget.id, axis: 'price', value: 4, sort_order: 0 }, { id: uid(712), budget_id: savedBudget.id, axis: 'price', value: 4, sort_order: 1 }, { id: uid(713), budget_id: savedBudget.id, axis: 'yield', value: 200, sort_order: 0 }, { id: uid(714), budget_id: savedBudget.id, axis: 'yield', value: 220, sort_order: 1 }]), 'Duplicate matrix values per axis must reject.')
  // 12: matrix idempotency — replaying the identical desired state succeeds twice with the same set.
  const validSteps = workspace.matrix_steps.filter((step) => step.budget_id === savedBudget.id)
  const first = await repo.replaceMatrixStepsOperation(savedBudget.id, validSteps, undefined, operationContext)
  const second = await repo.replaceMatrixStepsOperation(savedBudget.id, validSteps, undefined, operationContext)
  assert(first.length === second.length && first.length === validSteps.length, 'Replaying the identical matrix desired-state must be idempotent.')
  await rejects(() => repo.replaceMatrixStepsOperation(savedBudget.id, validSteps, validSteps.map((step, index) => index === 0 ? { ...step, value: step.value + 1 } : step), operationContext), 'The fake gateway must enforce the expected matrix snapshot with MATRIX_CHANGED_ON_ANOTHER_DEVICE.')
  // 13: deep-copy integrity — new ids for the budget and every child, re-parented, no shared references.
  const sourceLine = workspace.cost_lines.find((line) => line.budget_id === savedBudget.id)!
  await repo.copyBudget(savedBudget.id, { ...savedBudget, id: uid(720), name: 'Deep copy', copied_from_budget_id: null })
  const copyCall = gateway.copyInputs.at(-1)!
  assert(copyCall.budget.id === uid(720) && copyCall.budget.copied_from_budget_id === savedBudget.id, 'copyBudget must mint a new budget id and set lineage.')
  assert(copyCall.costLines.every((line) => line.budget_id === uid(720) && line.id !== sourceLine.id), 'copyBudget must mint new cost-line ids and re-parent them.')
  assert(copyCall.matrixSteps.every((step) => step.budget_id === uid(720)), 'copyBudget must re-parent every matrix step to the new budget.')
  assert((copyCall.costLines[0] as unknown as object) !== (sourceLine as unknown as object), 'copyBudget must not share object references with the source.')
  // 14: farm isolation — a budget copy request outside this farm rejects.
  await rejects(() => repo.copyBudget(savedBudget.id, { ...savedBudget, id: uid(721), farm_id: uid(999), copied_from_budget_id: null }), 'Copying into another farm must reject.')
  // 15: allocation business rules — over-allocated acres and crop/year mismatch reject with calm messages.
  const assignment = gateway.state.assignment
  await rejects(() => repo.saveAllocation({ id: uid(730), budget_id: savedBudget.id, crop_assignment_id: assignment.id, allocated_acres: assignment.planted_acres + 1, expected_yield_override: null, expected_price_override: null, created_at: stamp, updated_at: stamp }), 'Allocating more than planted acres must reject.')
  // 16: queue round-trips — all eight entry kinds parse, persist, and read back.
  const queueKey = profitabilityWriteQueueKey(supabaseConfig.projectRef, uid(10), gateway.state.scope.farm_id)
  assert(queueKey.startsWith('farm-rx-profitability-write-queue:v1:') && queueKey !== grainWriteQueueKey(supabaseConfig.projectRef, uid(10), gateway.state.scope.farm_id) && queueKey !== writeQueueKey(supabaseConfig.projectRef, uid(10), gateway.state.scope.farm_id), 'Profitability queue key must be isolated from Grain and Fields.')
  const storage = memoryStorage(); const queue = new ProfitabilityWriteQueue(storage, queueKey)
  const common = (kind: ProfitabilityQueueEntryV1['kind'], n: number) => ({ version: 1 as const, module: 'profitability' as const, kind, operationId: uid(800 + n), userId: uid(10), farmId: gateway.state.scope.farm_id, enqueuedAt: stamp })
  // 16a: pre-insurance v1 entries normalize the four missing fields, then replay successfully.
  const legacyRow = structuredClone(savedBudget) as unknown as Record<string, unknown>; delete legacyRow.rp_coverage_pct; delete legacyRow.rp_aph_yield; delete legacyRow.rp_projected_price; delete legacyRow.rp_premium_per_acre
  const legacyStorage = memoryStorage(); legacyStorage.setItem(queueKey, JSON.stringify({ version: 1, entries: [{ ...common('saveBudget', 90), row: legacyRow }] }))
  const parsedLegacy = parseProfitabilityQueue(legacyStorage.getItem(queueKey)!); const parsedLegacyRow = parsedLegacy.entries[0]?.kind === 'saveBudget' ? parsedLegacy.entries[0].row : null
  assert(parsedLegacyRow?.rp_coverage_pct === null && parsedLegacyRow.rp_aph_yield === null && parsedLegacyRow.rp_projected_price === null && parsedLegacyRow.rp_premium_per_acre === null, 'A legacy queue entry was not normalized with null insurance fields.')
  const legacyGateway = new FakeGateway(); const legacyReplay = new QueuedProfitabilityRepository(repository(legacyGateway), { getContext: async () => ({ userId: uid(10), farmId: gateway.state.scope.farm_id }), projectRef: supabaseConfig.projectRef, storage: legacyStorage, createId: () => uid(890), clock: () => stamp, isOffline: () => false })
  await legacyReplay.inspectAndReplay()
  assert(legacyGateway.budgetInputs.length === 1 && legacyGateway.budgetInputs[0]?.rp_coverage_pct === null && new ProfitabilityWriteQueue(legacyStorage, queueKey).read().entries.length === 0, 'A legacy queue entry without insurance fields did not replay.')
  const costLineWrite: BudgetCostLineWrite = manualCostLineWrite({ ...workspace.cost_lines[0], sort_order: 0 })
  const matrixSteps: ProfitabilityMatrixStep[] = validSteps
  const entries: ProfitabilityQueueEntryV1[] = [
    { ...common('createBudget', 1), kind: 'createBudget', row: savedBudget, priceSteps: matrixSteps.filter((s) => s.axis === 'price'), yieldSteps: matrixSteps.filter((s) => s.axis === 'yield') },
    { ...common('saveBudget', 2), kind: 'saveBudget', row: savedBudget },
    { ...common('saveCostLine', 3), kind: 'saveCostLine', row: costLineWrite },
    { ...common('deleteCostLine', 4), kind: 'deleteCostLine', id: uid(2) },
    { ...common('replaceMatrixSteps', 5), kind: 'replaceMatrixSteps', budgetId: savedBudget.id, steps: matrixSteps, expectedSteps: matrixSteps },
    { ...common('saveAllocation', 6), kind: 'saveAllocation', row: workspace.allocations[0] },
    { ...common('deleteAllocation', 7), kind: 'deleteAllocation', id: uid(30) },
    { ...common('copyBudget', 8), kind: 'copyBudget', sourceBudgetId: savedBudget.id, budget: { ...savedBudget, id: uid(731), copied_from_budget_id: savedBudget.id }, costLines: [costLineWrite], matrixSteps },
  ]
  for (const item of entries) queue.append(item)
  queue.append(entries[0]!)
  assert(queue.read().entries.length === 8, 'Appending the same Profitability operationId twice must retain exactly one queue entry.')
  const bytesBefore = storage.getItem(queueKey)
  await rejects(async () => { parseProfitabilityQueue(JSON.stringify({ version: 1, entries: [{ ...common('saveBudget', 9), kind: 'saveBudget', row: { ...savedBudget, extra: true } }] })) }, 'Queue accepted an extra row field.')
  assert(storage.getItem(queueKey) === bytesBefore, 'Invalid bytes replaced a valid queue.')
  await rejects(async () => { parseProfitabilityQueue('{bad') }, 'Corrupt queue bytes were accepted.')
  await rejects(async () => { parseProfitabilityQueue(JSON.stringify({ version: 2, entries: [] })) }, 'Unknown queue version was accepted.')
  // 17: the queued repository overlays pending writes, isolates context keys, and replays FIFO.
  const offlineStorage = memoryStorage()
  const offlineDependencies = { getContext: async () => ({ userId: uid(10), farmId: gateway.state.scope.farm_id }), projectRef: supabaseConfig.projectRef, storage: offlineStorage, createId: (() => { let n = 200; return () => uid(n++) })(), clock: () => stamp, isOffline: () => true }
  const queuedGateway = new FakeGateway(); const queuedWriter = repository(queuedGateway); const queued = new QueuedProfitabilityRepository(queuedWriter, offlineDependencies)
  const newAllocation: BudgetFieldAllocation = { id: uid(740), budget_id: savedBudget.id, crop_assignment_id: assignment.id, allocated_acres: 10, expected_yield_override: null, expected_price_override: null, created_at: stamp, updated_at: stamp }
  const offlineDisposition = await queued.saveAllocation(newAllocation)
  const overlaid = await queued.getWorkspace()
  assert(offlineDisposition === 'queued offline' && getSaveReceipt(uid(740)) === 'queued offline' && overlaid.allocations.some((row) => row.id === uid(740)), 'An offline profitability write must return queued offline and transition its receipt to Queued offline.')
  const otherKey = profitabilityWriteQueueKey(supabaseConfig.projectRef, uid(11), gateway.state.scope.farm_id)
  const exactQueueKey = `farm-rx-profitability-write-queue:v1:${supabaseConfig.projectRef}:${uid(10)}:${gateway.state.scope.farm_id}`
  const otherFarm = uid(12); const alternateContext = new QueuedProfitabilityRepository(queuedWriter, { ...offlineDependencies, getContext: async () => ({ userId: uid(11), farmId: otherFarm }) })
  assert(await queued.getNeedsAttentionQueueKey() === exactQueueKey && await alternateContext.getNeedsAttentionQueueKey() === `farm-rx-profitability-write-queue:v1:${supabaseConfig.projectRef}:${uid(11)}:${otherFarm}` && otherKey !== queueKey && offlineStorage.getItem(otherKey) === null, 'QueuedProfitabilityRepository must return exactly its project, user, and farm-scoped needs-attention queue key.')
  // 18: FIFO replay preserves operation order and ids.
  const replayGateway = new FakeGateway(); const replayWriter = repository(replayGateway); let online = false
  const replayStorage = memoryStorage()
  const replay = new QueuedProfitabilityRepository(replayWriter, { ...offlineDependencies, storage: replayStorage, isOffline: () => !online })
  await replay.saveBudget({ ...savedBudget, id: uid(750), name: 'Replay A' })
  await replay.deleteAllocation(uid(30))
  online = true
  await replay.inspectAndReplay()
  assert(replayGateway.budgetInputs[0]?.id === uid(750) && replayGateway.deletedAllocationIds[0] === uid(30), 'FIFO replay did not preserve operation order and ids.')
  assert(getSyncStatus().kind !== 'blocked', 'A clean FIFO replay must not classify as blocked.')
  // 19: the queued matrix keeps its enqueue-time snapshot; a different server matrix parks instead of overwriting it.
  const casGateway = new FakeGateway(); const casStorage = memoryStorage(); let casOnline = false
  const casKey = profitabilityWriteQueueKey(supabaseConfig.projectRef, uid(10), gateway.state.scope.farm_id)
  const casRepo = new QueuedProfitabilityRepository(repository(casGateway), { ...offlineDependencies, storage: casStorage, isOffline: () => !casOnline })
  const casSteps = (await casRepo.getWorkspace()).matrix_steps.filter((step) => step.budget_id === savedBudget.id).map((step, index) => ({ ...step, value: step.value + (index < 3 ? .1 : 1) }))
  await casRepo.replaceMatrixSteps(savedBudget.id, casSteps)
  const queuedCas = new ProfitabilityWriteQueue(casStorage, casKey).read().entries[0] as Extract<ProfitabilityQueueEntryV1, { kind: 'replaceMatrixSteps' }>
  assert(!('legacyUnknownSnapshot' in queuedCas) && queuedCas.expectedSteps.length === 6, 'A queued matrix replay must retain the enqueue-time expected snapshot.')
  ;(casGateway.state.bundle.matrix_steps[0] as Record<string, unknown>).value = 9.99
  casOnline = true; await casRepo.inspectAndReplay()
  { const status = getSyncStatus(); assert(new ProfitabilityWriteQueue(casStorage, casKey).read().entries.length === 0 && readNeedsAttention(casStorage, casKey).length === 1 && status.kind === 'blocked' && status.message === '1 saves need attention.', 'A changed server matrix must park the queued CAS replay instead of replacing it.') }
  // 20: canonical-confirmation failure is durably parked before the head is removed.
  const retentionGateway = new FakeGateway(); const retentionWriter = repository(retentionGateway); let retentionOnline = false
  const retentionStorage = memoryStorage()
  const retentionKey = profitabilityWriteQueueKey(supabaseConfig.projectRef, uid(10), gateway.state.scope.farm_id)
  const retentionRepo = new QueuedProfitabilityRepository(retentionWriter, { getContext: async () => ({ userId: uid(10), farmId: gateway.state.scope.farm_id }), projectRef: supabaseConfig.projectRef, storage: retentionStorage, createId: (() => { let n = 300; return () => uid(n++) })(), clock: () => stamp, isOffline: () => !retentionOnline })
  await retentionRepo.saveBudget({ ...savedBudget, id: uid(760), name: 'Retention' })
  assert(new ProfitabilityWriteQueue(retentionStorage, retentionKey).read().entries.length === 1, 'Setup for the queue-retention test failed to enqueue offline.')
  retentionGateway.mutate.budget = (row) => ({ ...row, id: uid(761) })
  retentionOnline = true
  await retentionRepo.inspectAndReplay()
  const afterWrongIdReplay = new ProfitabilityWriteQueue(retentionStorage, retentionKey).read().entries
  assert(afterWrongIdReplay.length === 0 && readNeedsAttention(retentionStorage, retentionKey).length === 1, 'A canonical-confirmation rejection during replay must be durably parked before the queue advances.')
  assert(getSyncStatus().kind === 'blocked', 'A canonical-confirmation rejection during replay must classify as blocked, not synced.')
  // 20: a permission-shaped (403) gateway error must classify as blocked, not be retried as a transport failure.
  const permissionGateway = new FakeGateway(); const permissionWriter = repository(permissionGateway); let permissionOnline = false
  const permissionKey = profitabilityWriteQueueKey(supabaseConfig.projectRef, uid(10), gateway.state.scope.farm_id)
  const permissionStorage = memoryStorage()
  const permissionRepo = new QueuedProfitabilityRepository(permissionWriter, { getContext: async () => ({ userId: uid(10), farmId: gateway.state.scope.farm_id }), projectRef: supabaseConfig.projectRef, storage: permissionStorage, createId: (() => { let n = 400; return () => uid(n++) })(), clock: () => stamp, isOffline: () => !permissionOnline })
  await permissionRepo.deleteAllocation(uid(30))
  assert(new ProfitabilityWriteQueue(permissionStorage, permissionKey).read().entries.length === 1, 'Setup for the 403 test failed to enqueue offline.')
  permissionGateway.throwError = Object.assign(new Error('permission denied for table budget_field_allocations'), { status: 403 })
  permissionOnline = true
  await permissionRepo.inspectAndReplay()
  assert(new ProfitabilityWriteQueue(permissionStorage, permissionKey).read().entries.length === 0 && readNeedsAttention(permissionStorage, permissionKey).length === 1, 'A 403/permission-shaped gateway error must be durably parked — it is not transport-retryable.')
  assert(getSyncStatus().kind === 'blocked', 'A 403/permission-shaped gateway error must classify as blocked.')
  // 21: a corrupt on-device queue envelope fails closed with the calm sentinel rather than losing or corrupting data.
  const corruptStorage = memoryStorage(); const corruptKey = profitabilityWriteQueueKey(supabaseConfig.projectRef, uid(10), gateway.state.scope.farm_id)
  corruptStorage.setItem(corruptKey, '{"version":1,"entries":[{"bad":true}]}')
  await rejects(async () => { new ProfitabilityWriteQueue(corruptStorage, corruptKey).read() }, 'A corrupt queue envelope must fail closed.')
  // 22 (FRX-D8-003): insurance is online-only, so it must re-check the captured
  // access fence after the server accepts the patch and before publishing success.
  const fenceGateway = new FakeGateway(); let insuranceRevoked = false; fenceGateway.afterInsuranceMutation = () => { insuranceRevoked = true }
  const fenceRepo = repository(fenceGateway, async () => { if (insuranceRevoked) throw new Error('The signed-in account or selected farm changed before this operation could finish.') })
  await rejects(() => fenceRepo.saveBudgetInsurance(String(fenceGateway.state.bundle.budgets[0].id), { rp_coverage_pct: 75, rp_aph_yield: 180, rp_projected_price: 4.62, rp_premium_per_acre: 0 }), 'An insurance patch published success after its access fence changed.')
  assert(insuranceRevoked && fenceGateway.insuranceCalls === 1, 'The insurance fence regression did not reach an accepted server mutation.')
  // 23: release composition selected the live backend.
  assert(moduleBackends.profitability === 'supabase', 'Release composition did not select the live Profitability backend.')
  console.log('SupabaseProfitabilityRepository regressions passed.')
}
void run().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
