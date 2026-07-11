import { fieldsSeedForRegression } from './MockFieldsRepository'
import { MockProfitabilityRepository, PROFITABILITY_STORAGE_KEY } from './MockProfitabilityRepository'
import { budgetAnalysis, equivalentCashRentForScenario, fieldAdjustedCostPerAcre, matrixProfitPerAcre, totalCostPerAcre } from './profitabilityCalculations'
import type { Arrangement, FieldsRepository } from './fields'
import type { CropBudget } from './profitability'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>()
  get length() { return this.data.size }
  clear() { this.data.clear() }
  getItem(key: string) { return this.data.get(key) ?? null }
  key(index: number) { return [...this.data.keys()][index] ?? null }
  removeItem(key: string) { this.data.delete(key) }
  setItem(key: string, value: string) { this.data.set(key, value) }
}
class DropWritesStorage extends MemoryStorage { override setItem(_key: string, _value: string) { /* emulate a full or blocked browser store */ } }
const fieldData = fieldsSeedForRegression()
const fieldsRepository = { getData: async () => structuredClone(fieldData) } as unknown as FieldsRepository
const arrangement = (patch: Partial<Arrangement>): Arrangement => ({ ...fieldData.arrangements[0], arrangement_type: 'owned', cash_rent_per_acre: null, flex_bonus_formula: null, landlord_crop_pct: null, landlord_seed_pct: 0, landlord_fertilizer_pct: 0, landlord_chemical_pct: 0, landlord_fuel_pct: 0, landlord_labor_custom_pct: 0, landlord_crop_insurance_pct: 0, landlord_equipment_pct: 0, landlord_interest_pct: 0, landlord_other_input_pct: 0, ...patch })

async function regression_roundTripCopyAndBytes() {
  const storage = new MemoryStorage(); const fieldsBytes = JSON.stringify({ version: 2, fields: { untouched: true } }); storage.setItem('farm-rx-local-data', fieldsBytes)
  let id = 9000; const repo = new MockProfitabilityRepository(fieldsRepository, { storage, createId: () => `copy-${++id}` })
  const first = await repo.getWorkspace(); const corn = first.budgets.find((budget) => budget.commodity_id === 'corn_yellow')!; const seed = first.cost_lines.find((line) => line.budget_id === corn.id && line.category === 'seed')!
  await repo.saveCostLine({ ...seed, amount_per_acre: 121 })
  const saved = await repo.getWorkspace(); assert(saved.cost_lines.find((line) => line.id === seed.id)?.amount_per_acre === 121, 'Profitability cost line did not round-trip.')
  const copy: CropBudget = { ...corn, id: 'copied-budget', name: 'Corn copy', copied_from_budget_id: corn.id, created_at: '', updated_at: '' }
  await repo.copyBudget(corn.id, copy)
  const copied = await repo.getWorkspace(); const copiedSeed = copied.cost_lines.find((line) => line.budget_id === copy.id && line.category === 'seed')!; assert(copiedSeed && copiedSeed.id !== seed.id && copiedSeed.amount_per_acre === 121, 'Copy from budget did not deep-copy cost lines.')
  await repo.saveCostLine({ ...seed, amount_per_acre: 130 })
  assert((await repo.getWorkspace()).cost_lines.find((line) => line.id === copiedSeed.id)?.amount_per_acre === 121, 'Copied budget shares a cost-line reference with its source.')
  assert(storage.getItem('farm-rx-local-data') === fieldsBytes, 'Profitability save changed the Fields envelope bytes.')
}

async function regression_sharedCalculations() {
  const repo = new MockProfitabilityRepository(fieldsRepository, { storage: new MemoryStorage() }); const workspace = await repo.getWorkspace(); const corn = workspace.budgets.find((budget) => budget.commodity_id === 'corn_yellow')!; const costs = workspace.cost_lines.filter((line) => line.budget_id === corn.id)
  const costPerAcre = totalCostPerAcre(costs); const analysis = budgetAnalysis(corn, costPerAcre)
  assert(analysis.breakevenPricePerBushel > 0 && analysis.breakevenYieldPerAcre > 0, 'Shared breakeven calculations are not finite.')
  assert(Math.abs(matrixProfitPerAcre(4.6, 200, costPerAcre) - 87) < .000001, 'Shared matrix calculation returned the wrong known cell.')
  assert(equivalentCashRentForScenario(arrangement({ arrangement_type: 'owned' }), 200, 5, costs) === 0, 'Owned ground must have zero equivalent rent.')
  assert(equivalentCashRentForScenario(arrangement({ arrangement_type: 'crop_share', landlord_crop_pct: 25, landlord_seed_pct: 20 }), 200, 5, [{ ...costs[0], amount_per_acre: 100 }]) === 230, 'Crop share did not subtract landlord-paid inputs.')
  assert(equivalentCashRentForScenario(arrangement({ arrangement_type: 'flex_cash_rent', cash_rent_per_acre: 100, flex_bonus_formula: { type: 'revenue', trigger: 800, bonus_rate: 10 } }), 200, 5, []) === 120, 'Flex rent calculation is wrong.')
  const zero = budgetAnalysis(corn, 0); assert(zero.breakevenPricePerBushel === 0 && zero.breakevenYieldPerAcre === 0 && fieldAdjustedCostPerAcre([], 0) === 0, 'Zero-cost calculations must stay finite and zero.')
}

async function regression_farmIsolationAndAllocationUniqueness() {
  const storage = new MemoryStorage(); const repo = new MockProfitabilityRepository(fieldsRepository, { storage }); const workspace = await repo.getWorkspace(); const bytes = storage.getItem(PROFITABILITY_STORAGE_KEY)
  const otherFarm = structuredClone(fieldData); otherFarm.farm.id = 'another-farm'
  const otherRepository = { getData: async () => otherFarm } as unknown as FieldsRepository
  await new MockProfitabilityRepository(otherRepository, { storage }).getWorkspace().then(() => { throw new Error('Another farm opened this profitability envelope.') }, () => undefined)
  assert(storage.getItem(PROFITABILITY_STORAGE_KEY) === bytes, 'Farm-mismatched profitability data was overwritten.')
  const budget = workspace.budgets[0]; const assignment = workspace.fields.crop_assignments.find((item) => item.crop_year === budget.crop_year && item.commodity_id === budget.commodity_id)!; const at = new Date().toISOString(); const allocation = { id: 'allocation-one', budget_id: budget.id, crop_assignment_id: assignment.id, allocated_acres: assignment.planted_acres, expected_yield_override: null, expected_price_override: null, created_at: at, updated_at: at }
  await repo.saveAllocation(allocation)
  await repo.saveAllocation({ ...allocation, id: 'allocation-two' }).then(() => { throw new Error('Duplicate allocation was accepted.') }, () => undefined)
}

async function regression_failClosedAndVerifiedWrite() {
  const corruptStorage = new MemoryStorage(); corruptStorage.setItem(PROFITABILITY_STORAGE_KEY, '{"version":99,"data":{}}'); const original = corruptStorage.getItem(PROFITABILITY_STORAGE_KEY)
  await new MockProfitabilityRepository(fieldsRepository, { storage: corruptStorage }).getWorkspace().then(() => { throw new Error('Corrupt profitability envelope was accepted.') }, () => undefined)
  assert(corruptStorage.getItem(PROFITABILITY_STORAGE_KEY) === original, 'Corrupt profitability envelope was overwritten instead of failing closed.')
  const seedStorage = new MemoryStorage(); const seedRepo = new MockProfitabilityRepository(fieldsRepository, { storage: seedStorage }); const seeded = await seedRepo.getWorkspace(); const valid = seedStorage.getItem(PROFITABILITY_STORAGE_KEY)!; const dropStorage = new DropWritesStorage(); MemoryStorage.prototype.setItem.call(dropStorage, PROFITABILITY_STORAGE_KEY, valid)
  const failingRepo = new MockProfitabilityRepository(fieldsRepository, { storage: dropStorage }); const line = seeded.cost_lines[0]
  await failingRepo.saveCostLine({ ...line, amount_per_acre: line.amount_per_acre + 1 }).then(() => { throw new Error('Unverified profitability write was accepted.') }, () => undefined)
}

await regression_roundTripCopyAndBytes()
await regression_sharedCalculations()
await regression_farmIsolationAndAllocationUniqueness()
await regression_failClosedAndVerifiedWrite()
console.log('MockProfitabilityRepository regressions passed.')
