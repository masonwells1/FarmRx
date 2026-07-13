import { fieldsSeedForRegression } from './MockFieldsRepository'
import { MockProfitabilityRepository, PROFITABILITY_STORAGE_KEY } from './MockProfitabilityRepository'
import { budgetAnalysis, computeStructuredFlexRent, fieldAdjustedCostPerAcre, fieldCardLand, landlordPaidInputCost, matrixProfitPerAcre, resolveFieldYearLand, settlementArrangementForCropYear, totalCostPerAcre } from './profitabilityCalculations'
import { calculateReportFieldRows } from '../ProfitabilityReport'
import type { Arrangement, CropAssignment, Field, FieldsRepository, StructuredFlexBonusFormula } from './fields'
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
function scenarioRent(arrangementRow: Arrangement, yieldPerAcre: number, pricePerBushel: number, lines: Parameters<typeof landlordPaidInputCost>[0]) {
  const field = { ...fieldData.fields[0], id: arrangementRow.field_id, total_acres: 1 } as Field
  const assignment = { ...fieldData.crop_assignments[0], id: `scenario-${arrangementRow.id}`, field_id: field.id, crop_year: 2026, planted_acres: 1, expected_yield_per_acre: yieldPerAcre, expected_price_per_bu: pricePerBushel } as CropAssignment
  const result = resolveFieldYearLand(field, [arrangementRow], [assignment], 2026, new Map([[assignment.id, lines]]))
  return result.status === 'resolved' ? result.rentPerFieldAcre : null
}

async function regression_roundTripCopyAndBytes() {
  const storage = new MemoryStorage(); const fieldsBytes = JSON.stringify({ version: 2, fields: { untouched: true } }); storage.setItem('farm-rx-local-data', fieldsBytes)
  let id = 9000; const repo = new MockProfitabilityRepository(fieldsRepository, { storage, createId: () => `copy-${++id}` })
  const first = await repo.getWorkspace(); const corn = first.budgets.find((budget) => budget.commodity_id === 'corn_yellow')!; const seed = first.cost_lines.find((line) => line.budget_id === corn.id && line.category === 'seed')!
  await repo.saveCostLine({ ...seed, amount_per_acre: 121 })
  const saved = await repo.getWorkspace(); assert(saved.cost_lines.find((line) => line.id === seed.id)?.amount_per_acre === 121, 'Profitability cost line did not round-trip.')
  await repo.saveBudget({ ...corn, rp_coverage_pct: 80, rp_aph_yield: 180, rp_projected_price: 4.62, rp_premium_per_acre: 28 })
  const insuranceSaved = (await repo.getWorkspace()).budgets.find((budget) => budget.id === corn.id)!; assert(insuranceSaved.rp_coverage_pct === 80 && insuranceSaved.rp_aph_yield === 180 && insuranceSaved.rp_projected_price === 4.62 && insuranceSaved.rp_premium_per_acre === 28, 'Profitability insurance columns did not round-trip.')
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
  assert(scenarioRent(arrangement({ arrangement_type: 'owned' }), 200, 5, costs) === 0, 'Owned ground must have zero equivalent rent.')
  assert(scenarioRent(arrangement({ arrangement_type: 'crop_share', landlord_crop_pct: 25, landlord_seed_pct: 20 }), 200, 5, [{ ...costs[0], amount_per_acre: 100 }]) === 230, 'Crop share did not subtract landlord-paid inputs.')
  const laborAndCustom = [{ ...costs[0], category: 'labor' as const, amount_per_acre: 40 }, { ...costs[0], id: 'custom-cost', category: 'custom' as const, amount_per_acre: 60 }]
  assert(landlordPaidInputCost(laborAndCustom, arrangement({ landlord_labor_custom_pct: 50, landlord_other_input_pct: 100 })) === 50, 'Labor & custom share must include both labor and custom, while Other inputs must not reclassify custom work.')
  assert(scenarioRent(arrangement({ arrangement_type: 'flex_cash_rent', cash_rent_per_acre: 100, flex_bonus_formula: { type: 'revenue', trigger: 800, bonus_rate: 10 } }), 200, 5, []) === 120, 'Flex rent calculation is wrong.')
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

async function regression_legacyInsuranceBudgetUpgrade() {
  const storage = new MemoryStorage(); const repo = new MockProfitabilityRepository(fieldsRepository, { storage }); await repo.getWorkspace()
  const legacy = JSON.parse(storage.getItem(PROFITABILITY_STORAGE_KEY)!) as { data: { budgets: Array<Record<string, unknown>> } }
  for (const budget of legacy.data.budgets) { delete budget.rp_coverage_pct; delete budget.rp_aph_yield; delete budget.rp_projected_price; delete budget.rp_premium_per_acre }
  storage.setItem(PROFITABILITY_STORAGE_KEY, JSON.stringify(legacy))
  const upgraded = await repo.getWorkspace()
  assert(upgraded.budgets.every((budget) => budget.rp_coverage_pct === null && budget.rp_aph_yield === null && budget.rp_projected_price === null && budget.rp_premium_per_acre === null), 'A legacy mock budget without insurance fields was not normalized before validation.')
}

/** Structured flex formula with every field defaulted to null except the ones the caller overrides — matches "store only the fields each method uses" (docs/flex-lease-research.md §3). */
function structuredFormula(patch: Partial<StructuredFlexBonusFormula> & { method: StructuredFlexBonusFormula['method'] }): StructuredFlexBonusFormula {
  return { base_rent_per_acre: null, rate_pct: null, trigger_revenue_per_acre: null, base_price_per_bu: null, base_yield_per_acre: null, min_rent_per_acre: null, max_rent_per_acre: null, price_source_note: null, ...patch }
}

/** Worked examples straight from docs/flex-lease-research.md (U of I farmdoc S3/S5), plus the resolver's fail-closed contract. */
async function regression_flexLeaseMethods() {
  // Type A (pct_of_revenue), farmdoc's 2025 central-Illinois example: 30% x (244 bu x $4.30) = $314.76, unclamped when inside the min/max band.
  const pctOfRevenue = structuredFormula({ method: 'pct_of_revenue', rate_pct: 30 })
  const pctRent = computeStructuredFlexRent(pctOfRevenue, 244, 4.30)
  assert(pctRent !== null && Math.abs(pctRent - 314.76) < 0.001, `pct_of_revenue worked example is wrong: got ${pctRent}.`)
  const pctFloored = computeStructuredFlexRent(structuredFormula({ method: 'pct_of_revenue', rate_pct: 30, min_rent_per_acre: 350 }), 244, 4.30)
  assert(pctFloored === 350, `pct_of_revenue minimum did not clamp: got ${pctFloored}.`)
  const pctCapped = computeStructuredFlexRent(structuredFormula({ method: 'pct_of_revenue', rate_pct: 30, max_rent_per_acre: 300 }), 244, 4.30)
  assert(pctCapped === 300, `pct_of_revenue maximum did not clamp: got ${pctCapped}.`)

  // Type D (base_plus_bonus), farmdoc daily S3's own numbers: $200 + 40% x (190 bu x $6.00 - $720) = $200 + 40% x $420 = $368.
  const basePlusBonus = structuredFormula({ method: 'base_plus_bonus', base_rent_per_acre: 200, rate_pct: 40, trigger_revenue_per_acre: 720 })
  const bonusRent = computeStructuredFlexRent(basePlusBonus, 190, 6.00)
  assert(bonusRent !== null && Math.abs(bonusRent - 368) < 0.001, `base_plus_bonus worked example is wrong: got ${bonusRent}.`)
  const belowTrigger = computeStructuredFlexRent(basePlusBonus, 100, 6.00)
  assert(belowTrigger === 200, `base_plus_bonus below the trigger must return exactly the base rent: got ${belowTrigger}.`)
  const cappedBonus = computeStructuredFlexRent(structuredFormula({ method: 'base_plus_bonus', base_rent_per_acre: 200, rate_pct: 40, trigger_revenue_per_acre: 720, max_rent_per_acre: 350 }), 190, 6.00)
  assert(cappedBonus === 350, `base_plus_bonus maximum did not cap: got ${cappedBonus}.`)

  // Legacy shape (docs §3 "Translation of existing saved shapes") must keep computing identically after the refactor.
  assert(scenarioRent(arrangement({ arrangement_type: 'flex_cash_rent', cash_rent_per_acre: 100, flex_bonus_formula: { type: 'revenue', trigger: 800, bonus_rate: 10 } }), 200, 5, []) === 120, 'Legacy revenue-shape flex rent must keep computing exactly as before.')

  // Fail closed: an unrecognized/parked method, or a formula missing a field its method requires, returns null — never a guess.
  assert(computeStructuredFlexRent(structuredFormula({ method: 'base_flex_price' }), 200, 5) === null, 'An unrecognized/parked method must fail closed to null.')
  assert(computeStructuredFlexRent(structuredFormula({ method: 'pct_of_revenue', rate_pct: null }), 200, 5) === null, 'pct_of_revenue with a missing rate must fail closed to null.')
  assert(computeStructuredFlexRent(structuredFormula({ method: 'base_plus_bonus', base_rent_per_acre: 200, rate_pct: 40 }), 200, 5) === null, 'base_plus_bonus missing its trigger must fail closed to null.')
  assert(scenarioRent(arrangement({ arrangement_type: 'flex_cash_rent', cash_rent_per_acre: 0, flex_bonus_formula: structuredFormula({ method: 'pct_of_revenue', rate_pct: 30 }) }), 244, 4.30, []) !== null, 'A valid structured formula must still resolve through the full arrangement path.')

  // Double-crop: base rent is a fixed $/ac on the WHOLE field and must be counted once.
  // Wheat 80bu x $6 + double-crop beans 40bu x $12 on the same 100 ac -> blended revenue
  // $960/ac; rent = 200 + 40% x (960 - 720) = $296 (the pre-fix weighted path gave $400).
  const doubleCropField = { ...fieldData.fields[0], id: 'field-dc', total_acres: 100 } as Field
  const doubleCropAssignments = [
    { ...fieldData.crop_assignments[0], id: 'double-wheat', field_id: 'field-dc', crop_year: 2026, planted_acres: 100, expected_yield_per_acre: 80, expected_price_per_bu: 6 },
    { ...fieldData.crop_assignments[0], id: 'double-beans', field_id: 'field-dc', crop_year: 2026, planted_acres: 100, expected_yield_per_acre: 40, expected_price_per_bu: 12 },
  ] as CropAssignment[]
  const doubleCropResult = resolveFieldYearLand(doubleCropField, [arrangement({ field_id: 'field-dc', arrangement_type: 'flex_cash_rent', cash_rent_per_acre: 200, flex_bonus_formula: basePlusBonus })], doubleCropAssignments, 2026, new Map())
  const doubleCropRent = doubleCropResult.status === 'resolved' ? doubleCropResult.rentPerFieldAcre : null
  assert(doubleCropRent !== null && Math.abs(doubleCropRent - 296) < 0.001, `Double-crop structured flex rent must count base once and blend revenue: got ${doubleCropRent}.`)

  const agreementA = arrangement({ id: 'agreement-a', field_id: 'field-dc', effective_from: '2026-01-01', effective_to: '2026-06-30' })
  const agreementB = arrangement({ id: 'agreement-b', field_id: 'field-dc', effective_from: '2026-07-01', effective_to: null })
  assert(settlementArrangementForCropYear([agreementA, agreementB], 'field-dc', 2026).status === 'blocked', 'A crop year with two agreement-history rows must block settlement rather than selecting the newest one.')
}

async function regression_fieldYearLandResolverAndReportPath() {
  const field = { ...fieldData.fields[0], id: 'resolver-field', total_acres: 100 }
  const formula = structuredFormula({ method: 'base_plus_bonus', base_rent_per_acre: 200, rate_pct: 40, trigger_revenue_per_acre: 720 })
  const flex = arrangement({ id: 'resolver-flex', field_id: field.id, arrangement_type: 'flex_cash_rent', cash_rent_per_acre: 0, flex_bonus_formula: formula, effective_from: '2026-01-01', effective_to: null })
  const first = { ...fieldData.crop_assignments[0], id: 'resolver-wheat', field_id: field.id, crop_year: 2026, planted_acres: 50, expected_yield_per_acre: 100, expected_price_per_bu: 10 }
  const second = { ...first, id: 'resolver-beans', expected_yield_per_acre: 50, expected_price_per_bu: 10 }
  const flexResult = resolveFieldYearLand(field, [flex], [first, second], 2026, new Map())
  assert(flexResult.status === 'resolved' && Math.abs(flexResult.rentPerFieldAcre - 212) < .001 && Math.abs(flexResult.perAssignmentAllocation[0].rentTotal + flexResult.perAssignmentAllocation[1].rentTotal - 21200) < .001, 'Field-year structured flex must apply once to combined revenue ($212/ac, $21,200), not the old $25,600 per-crop result.')
  const nullSibling = resolveFieldYearLand(field, [flex], [first, { ...second, expected_price_per_bu: null }], 2026, new Map())
  assert(nullSibling.status === 'blocked', 'An unpriceable sibling crop must block field land money instead of being treated as $0 revenue.')
  const splitAgreement = resolveFieldYearLand(field, [flex, { ...flex, id: 'resolver-flex-2', effective_from: '2026-07-01' }], [first, second], 2026, new Map())
  assert(splitAgreement.status === 'blocked' && splitAgreement.reason.includes('more than one agreement'), 'A split-year agreement must block with the lease split/proration wording.')

  const cropShare = { ...flex, id: 'resolver-share', arrangement_type: 'crop_share' as const, landlord_crop_pct: 50, landlord_seed_pct: 50, flex_bonus_formula: null }
  const lines = [{ id: 'seed', budget_id: 'budget-a', category: 'seed' as const, name: 'Seed', amount_per_acre: 100, created_at: '', updated_at: '' }]
  const cropShareResult = resolveFieldYearLand(field, [cropShare], [first, second], 2026, new Map([[first.id, lines], [second.id, []]]))
  assert(cropShareResult.status === 'resolved' && Math.abs(cropShareResult.perAssignmentAllocation[0].rentPerAssignedAcre - 450) < .001 && Math.abs(cropShareResult.perAssignmentAllocation[1].rentPerAssignedAcre - 250) < .001, 'Crop-share rent must be calculated per crop (including that crop\'s landlord-paid inputs), not prorated from one blended rent.')
  assert(landlordPaidInputCost([{ ...lines[0], category: 'labor', amount_per_acre: 40 }, { ...lines[0], id: 'custom', category: 'custom', amount_per_acre: 60 }], { ...cropShare, landlord_labor_custom_pct: 50, landlord_other_input_pct: 100 }) === 50, 'Labor and custom must share one narrow bucket; Other must not silently reclassify custom work.')

  const repo = new MockProfitabilityRepository(fieldsRepository, { storage: new MemoryStorage() })
  const base = await repo.getWorkspace(); const budgetA = { ...base.budgets[0], id: 'binding-a', crop_year: 2026, expected_yield_per_acre: 100, expected_price_per_bushel: 10 }; const budgetB = { ...budgetA, id: 'binding-b', name: 'Binding B' }
  const reportFields = { ...base.fields, fields: [field], crop_assignments: [first, second], arrangements: [cropShare] }
  const allocationA = { id: 'binding-allocation-a', budget_id: budgetA.id, crop_assignment_id: first.id, allocated_acres: 50, expected_yield_override: null, expected_price_override: null, created_at: '', updated_at: '' }
  const allocationB = { ...allocationA, id: 'binding-allocation-b', budget_id: budgetB.id, crop_assignment_id: second.id }
  const reportWorkspace = { ...base, fields: reportFields, budgets: [budgetA, budgetB], cost_lines: [{ ...lines[0], budget_id: budgetA.id }], allocations: [allocationA] }
  assert(calculateReportFieldRows(reportWorkspace, budgetA, reportWorkspace.cost_lines).at(0)?.blockedReason?.includes('Allocate this field to a budget plan'), 'The report path must block crop-share settlement when a sibling has zero budget allocations.')
  const oneBound = { ...reportWorkspace, allocations: [allocationA, allocationB] }
  const reportRow = calculateReportFieldRows(oneBound, budgetA, oneBound.cost_lines).at(0)
  assert(reportRow?.blockedReason === null && reportRow.costPerAcre !== null, 'The report path must use exactly one explicit budget-field allocation, without an entity fallback.')
  const multipleBound = { ...oneBound, allocations: [...oneBound.allocations, { ...allocationB, id: 'binding-allocation-c', budget_id: budgetA.id }] }
  assert(calculateReportFieldRows(multipleBound, budgetA, multipleBound.cost_lines).at(0)?.blockedReason?.includes('More than one budget plan'), 'The report path must block, not substitute, when a crop has multiple budget allocations.')
  const partialOverride = { ...oneBound, allocations: [{ ...allocationA, allocated_acres: 25, expected_price_override: 11 }, allocationB] }
  assert(calculateReportFieldRows(partialOverride, budgetA, partialOverride.cost_lines).at(0)?.blockedReason?.includes('covers only part'), 'A partial allocation with an override must block rather than invent a whole-assignment scenario.')

  // Review Round 2b worked number: never divide an assignment-level $20,000
  // cash-rent total by this partial allocation's 25 acres.
  const cash = arrangement({ id: 'partial-cash', field_id: field.id, arrangement_type: 'cash_rent', cash_rent_per_acre: 200, flex_bonus_formula: null })
  const fullHundredAcCrop = { ...first, planted_acres: 100 }
  const partialCashWorkspace = { ...reportWorkspace, fields: { ...reportFields, arrangements: [cash], crop_assignments: [fullHundredAcCrop] }, allocations: [{ ...allocationA, allocated_acres: 25 }], cost_lines: [] }
  const partialCashRow = calculateReportFieldRows(partialCashWorkspace, budgetA, []).at(0)
  assert(partialCashRow?.costPerAcre === 200 && partialCashRow.netPerAcre !== null && partialCashRow.costPerAcre * partialCashRow.acres === 5000, 'A 25-ac allocation of a 100-ac crop at $200/ac must show $200/ac and $5,000, never $800/ac or $20,000.')

  const zeroPlanted = resolveFieldYearLand(field, [cash], [{ ...first, planted_acres: 0 }], 2026, new Map())
  assert(zeroPlanted.status === 'blocked' && zeroPlanted.reason.includes('planted acres'), 'Zero planted acres must block rather than resolve NaN.')
  const zeroField = resolveFieldYearLand({ ...field, total_acres: 0 }, [cash], [first], 2026, new Map())
  assert(zeroField.status === 'blocked' && zeroField.reason.includes('total acres'), 'Zero field acres must block rather than resolve Infinity.')
  const zeroRevenueAssignments = [{ ...first, id: 'zero-revenue-a', planted_acres: 25, expected_yield_per_acre: 0 }, { ...second, id: 'zero-revenue-b', planted_acres: 75, expected_yield_per_acre: 0 }]
  const zeroRevenue = resolveFieldYearLand(field, [cash], zeroRevenueAssignments, 2026, new Map())
  assert(zeroRevenue.status === 'resolved', 'Zero crop revenue with a cash-rent obligation must still resolve.')
  if (zeroRevenue.status === 'resolved') {
    assert(zeroRevenue.perAssignmentAllocation[0].rentTotal === 5000 && zeroRevenue.perAssignmentAllocation[1].rentTotal === 15000 && zeroRevenue.perAssignmentAllocation.every((item) => item.rentPerAssignedAcre === 200 && Object.values(item).filter((value): value is number => typeof value === 'number').every(Number.isFinite)), 'Zero revenue must allocate the $200/ac rent by planted acres, never $0, NaN, or Infinity.')
  }

  const reviewerFlex = arrangement({ id: 'reviewer-flex', field_id: field.id, arrangement_type: 'flex_cash_rent', cash_rent_per_acre: 200, flex_bonus_formula: formula })
  const reviewerCrop = { ...first, id: 'reviewer-crop', planted_acres: 100, expected_yield_per_acre: 200, expected_price_per_bu: 5 }
  const reviewerBase = resolveFieldYearLand(field, [reviewerFlex], [reviewerCrop], 2026, new Map())
  assert(reviewerBase.status === 'resolved' && reviewerBase.rentPerFieldAcre === 312, 'The reviewer flex example must resolve to $312/ac before an unsafe partial override is attempted.')
  const injectedPartial = resolveFieldYearLand(field, [reviewerFlex], [reviewerCrop], 2026, new Map(), { overrides: [{ allocationId: 'unsafe-25', cropAssignmentId: reviewerCrop.id, allocatedAcres: 25, expectedYieldPerAcre: 100, expectedPricePerBushel: 5 }] })
  assert(injectedPartial.status === 'blocked' && injectedPartial.reason.includes('covers only part'), 'The reviewer\'s $312-to-$200 partial override injection must be impossible at the resolver boundary.')

  const doubleCropBlockedWorkspace = { ...reportWorkspace, fields: { ...reportFields, crop_assignments: [first, second], arrangements: [cropShare] }, budgets: [budgetA, budgetB], allocations: [{ ...allocationA, id: 'blocked-a', budget_id: budgetA.id }, { ...allocationA, id: 'blocked-b', budget_id: budgetB.id }] }
  ;(globalThis as typeof globalThis & { localStorage: Storage }).localStorage = new MemoryStorage()
  const { wholeFarmTotals } = await import('../ProfitabilityModule')
  const blockedWholeFarm = wholeFarmTotals(doubleCropBlockedWorkspace, [budgetA, budgetB])
  assert(blockedWholeFarm.blockedFields === 1 && blockedWholeFarm.overlap, 'Two blocked allocations on one double-cropped field must count as one blocked field and still flag the overlapping assignment.')

  const fieldsStyleAgreementA = arrangement({ id: 'fields-split-a', field_id: field.id, effective_from: '2026-01-01', effective_to: '2026-06-30' })
  const fieldsStyleAgreementB = arrangement({ id: 'fields-split-b', field_id: field.id, effective_from: '2026-07-01', effective_to: null })
  const fieldsStyleSplit = fieldCardLand(field, [first, second], [fieldsStyleAgreementA, fieldsStyleAgreementB])
  assert(fieldsStyleSplit.status === 'blocked' && fieldsStyleSplit.reason.includes('split or proration rule'), 'The tested FieldsModule card seam must pass full agreement history and show the split-year proration block.')
}

await regression_roundTripCopyAndBytes()
await regression_sharedCalculations()
await regression_farmIsolationAndAllocationUniqueness()
await regression_failClosedAndVerifiedWrite()
await regression_legacyInsuranceBudgetUpgrade()
await regression_flexLeaseMethods()
await regression_fieldYearLandResolverAndReportPath()
console.log('MockProfitabilityRepository regressions passed.')
