import type { Arrangement, CropAssignment, Field, FlexBonusFormula, StructuredFlexBonusFormula } from './fields'
import { isLegacyFlexBonusFormula } from './fields'
import type { BudgetCostLine, CostCategory, CropBudget, ProfitabilityMatrixStep } from './profitability'

export type MatrixCell = { price: number; yield: number; profit: number }

export function totalCostPerAcre(lines: BudgetCostLine[]) { return lines.reduce((total, line) => total + line.amount_per_acre, 0) }
export function nonLandCostPerAcre(lines: BudgetCostLine[]) { return lines.filter((line) => line.category !== 'land').reduce((total, line) => total + line.amount_per_acre, 0) }
export function matrixProfitPerAcre(price: number, yieldPerAcre: number, costPerAcre: number) { return price * yieldPerAcre - costPerAcre }
export function budgetAnalysis(budget: Pick<CropBudget, 'expected_yield_per_acre' | 'expected_price_per_bushel'>, costPerAcre: number) {
  const revenuePerAcre = budget.expected_yield_per_acre * budget.expected_price_per_bushel
  return {
    revenuePerAcre,
    expectedProfitPerAcre: revenuePerAcre - costPerAcre,
    breakevenPricePerBushel: costPerAcre / budget.expected_yield_per_acre,
    breakevenYieldPerAcre: costPerAcre / budget.expected_price_per_bushel,
  }
}

/** `other` is deliberately a future-only bucket.  It must not widen the real budget enum. */
type LandlordExpenseCategory = CostCategory | 'other'
type LandlordExpenseBucket = readonly LandlordExpenseCategory[]

export function landlordPaidInputCost(lines: BudgetCostLine[], arrangement: Arrangement) {
  const share = (categories: LandlordExpenseBucket, percent: number) => lines.filter((line) => categories.includes(line.category)).reduce((total, line) => total + line.amount_per_acre, 0) * percent / 100
  return share(['seed'], arrangement.landlord_seed_pct)
    + share(['fertilizer'], arrangement.landlord_fertilizer_pct)
    + share(['chemical'], arrangement.landlord_chemical_pct)
    + share(['fuel'], arrangement.landlord_fuel_pct)
    + share(['labor', 'custom'], arrangement.landlord_labor_custom_pct)
    + share(['crop_insurance'], arrangement.landlord_crop_insurance_pct)
    + share(['equipment_depreciation', 'repairs'], arrangement.landlord_equipment_pct)
    + share(['interest'], arrangement.landlord_interest_pct)
    // The current deployed budget-category enum has no `other` key. Keep this
    // mapping here so the stored percentage is never silently applied to custom
    // work; it will begin applying when `other` is introduced in a later schema
    // change.
    + share(['other'], arrangement.landlord_other_input_pct)
}

/** The one source of truth for crop-share expense buckets. */
export const landlordExpenseBuckets: Record<'seed' | 'fertilizer' | 'chemical' | 'fuel' | 'labor_custom' | 'crop_insurance' | 'equipment' | 'interest' | 'other_input', LandlordExpenseBucket> = {
  seed: ['seed'],
  fertilizer: ['fertilizer'],
  chemical: ['chemical'],
  fuel: ['fuel'],
  labor_custom: ['labor', 'custom'],
  crop_insurance: ['crop_insurance'],
  equipment: ['equipment_depreciation', 'repairs'],
  interest: ['interest'],
  other_input: ['other'],
} as const

function isFiniteNumber(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function clampToBounds(value: number, min: number | null | undefined, max: number | null | undefined) {
  let result = value
  if (isFiniteNumber(min)) result = Math.max(result, min)
  if (isFiniteNumber(max)) result = Math.min(result, max)
  return result
}

/**
 * v1 methods from docs/flex-lease-research.md §2/§4 (U of I farmdoc Types A and D). Fails
 * closed — returns null, never a guess — for an unrecognized method or a formula missing a
 * field its method requires. `base_flex_price` / `base_flex_price_yield` are schema-reserved
 * for later and are treated as unrecognized here (not yet computed).
 */
export function computeStructuredFlexRent(formula: StructuredFlexBonusFormula, expectedYieldPerAcre: number, expectedPricePerBushel: number): number | null {
  return computeStructuredFlexRentFromRevenue(formula, expectedYieldPerAcre * expectedPricePerBushel)
}

/** The formula applies once to the field's gross revenue per acre — base rent is a fixed
 * $/ac on the whole field, so multi-crop (double-crop) revenue must be blended BEFORE the
 * formula runs, never weighted after (which double-counts the base). */
export function computeStructuredFlexRentFromRevenue(formula: StructuredFlexBonusFormula, revenuePerAcre: number): number | null {
  if (formula.method === 'base_plus_bonus') {
    if (!isFiniteNumber(formula.base_rent_per_acre) || !isFiniteNumber(formula.rate_pct) || !isFiniteNumber(formula.trigger_revenue_per_acre)) return null
    const raw = formula.base_rent_per_acre + Math.max(0, revenuePerAcre - formula.trigger_revenue_per_acre) * formula.rate_pct / 100
    return isFiniteNumber(formula.max_rent_per_acre) ? Math.min(raw, formula.max_rent_per_acre) : raw
  }
  if (formula.method === 'pct_of_revenue') {
    if (!isFiniteNumber(formula.rate_pct)) return null
    return clampToBounds(revenuePerAcre * formula.rate_pct / 100, formula.min_rent_per_acre, formula.max_rent_per_acre)
  }
  return null
}

/** Fails closed (null) for a corrupt or unrecognized stored formula — see computeStructuredFlexRent. */
export function computeFlexRent(formula: FlexBonusFormula, expectedYieldPerAcre: number, expectedPricePerBushel: number, legacyBaseRentPerAcre: number): number | null {
  if (isLegacyFlexBonusFormula(formula)) {
    if (formula.type !== 'price' && formula.type !== 'yield' && formula.type !== 'revenue') return null
    if (!isFiniteNumber(formula.trigger) || !isFiniteNumber(formula.bonus_rate)) return null
    const bonus = formula.type === 'price'
      ? Math.max(0, expectedPricePerBushel - formula.trigger) * formula.bonus_rate
      : formula.type === 'yield'
        ? Math.max(0, expectedYieldPerAcre - formula.trigger) * formula.bonus_rate
        : Math.max(0, expectedYieldPerAcre * expectedPricePerBushel - formula.trigger) * formula.bonus_rate / 100
    return legacyBaseRentPerAcre + bonus
  }
  return computeStructuredFlexRent(formula, expectedYieldPerAcre, expectedPricePerBushel)
}

export type SettlementArrangementResolution =
  | { status: 'resolved'; arrangement: Arrangement; overlapping: Arrangement[] }
  | { status: 'missing'; overlapping: Arrangement[] }
  | { status: 'blocked'; overlapping: Arrangement[] }

/**
 * Settlement is annual. A lease history that has more than one agreement
 * touching that year cannot be safely repriced without a written proration
 * rule, so reports must stop instead of choosing the newest row.
 */
export function settlementArrangementForCropYear(arrangements: Arrangement[], fieldId: string, cropYear: number): SettlementArrangementResolution {
  const start = `${cropYear}-01-01`; const end = `${cropYear}-12-31`
  const overlapping = arrangements
    .filter((arrangement) => arrangement.field_id === fieldId && arrangement.effective_from <= end && (arrangement.effective_to === null || arrangement.effective_to >= start))
    .sort((left, right) => left.effective_from.localeCompare(right.effective_from) || left.id.localeCompare(right.id))
  if (overlapping.length === 1) return { status: 'resolved', arrangement: overlapping[0], overlapping }
  if (overlapping.length === 0) return { status: 'missing', overlapping }
  return { status: 'blocked', overlapping }
}

export type FieldYearLandAssignment = CropAssignment
/**
 * An allocation may replace an assignment's yield and/or price only when the
 * allocation covers that entire planted crop.  Keeping the source allocation
 * and its acres here makes that rule enforceable by the resolver rather than
 * relying on every caller to remember it.
 */
export type FieldYearLandOverride = {
  allocationId: string
  cropAssignmentId: string
  allocatedAcres: number
  expectedYieldPerAcre?: number | null
  expectedPricePerBushel?: number | null
}
/** Budget defaults are fallbacks, not allocation overrides. */
export type FieldYearLandBudgetFallback = {
  cropAssignmentId: string
  expectedYieldPerAcre?: number | null
  expectedPricePerBushel?: number | null
}
export type FieldYearLandResolverInputs = {
  overrides?: readonly FieldYearLandOverride[]
  budgetFallbacks?: readonly FieldYearLandBudgetFallback[]
}
export type FieldYearLandAllocation = {
  cropAssignmentId: string
  yieldPerAcre: number
  pricePerBushel: number
  revenue: number
  rentTotal: number
  rentPerAssignedAcre: number
}
export type FieldYearLandResolution =
  | { status: 'resolved'; arrangement: Arrangement; rentPerFieldAcre: number; perAssignmentAllocation: FieldYearLandAllocation[] }
  | { status: 'blocked'; reason: string }

function budgetLinesForAssignment(budgetsByAssignment: ReadonlyMap<string, BudgetCostLine[] | undefined> | Record<string, BudgetCostLine[] | undefined>, assignmentId: string) {
  if (budgetsByAssignment instanceof Map) return budgetsByAssignment.get(assignmentId)
  return (budgetsByAssignment as Record<string, BudgetCostLine[] | undefined>)[assignmentId]
}

/**
 * The only authority for field-year land money.  It deliberately fails closed:
 * a lease is settled across the whole field-year, so an unknown sibling crop is
 * never valued as $0 and a generic budget land line is never substituted.
 */
export function resolveFieldYearLand(
  field: Field,
  allArrangements: Arrangement[],
  allAssignments: FieldYearLandAssignment[],
  cropYear: number,
  budgetsByAssignment: ReadonlyMap<string, BudgetCostLine[] | undefined> | Record<string, BudgetCostLine[] | undefined>,
  inputs: FieldYearLandResolverInputs = {},
): FieldYearLandResolution {
  const arrangementResult = settlementArrangementForCropYear(allArrangements, field.id, cropYear)
  if (arrangementResult.status === 'missing') return { status: 'blocked', reason: `No land agreement covers ${cropYear}. Add the field's agreement before using land costs.` }
  if (arrangementResult.status === 'blocked') return { status: 'blocked', reason: `${cropYear} has more than one agreement. Settlement needs the lease's own split or proration rule before Farm Rx can show land costs.` }
  const assignments = allAssignments.filter((assignment) => assignment.field_id === field.id && assignment.crop_year === cropYear)
  if (!assignments.length) return { status: 'blocked', reason: `This field has no planting record for ${cropYear}.` }
  if (!isFiniteNumber(field.total_acres) || field.total_acres <= 0) return { status: 'blocked', reason: 'This field needs more than zero total acres before Farm Rx can calculate land costs.' }
  const assignmentsById = new Map(assignments.map((assignment) => [assignment.id, assignment]))
  const overridesByAssignment = new Map<string, FieldYearLandOverride>()
  for (const override of inputs.overrides ?? []) {
    const assignment = assignmentsById.get(override.cropAssignmentId)
    if (!assignment) return { status: 'blocked', reason: 'A land-cost override could not be matched to a crop on this field.' }
    if (overridesByAssignment.has(assignment.id)) return { status: 'blocked', reason: 'This crop has more than one allocation override. Use one full field-crop allocation before calculating land costs.' }
    if (!isFiniteNumber(override.allocatedAcres) || override.allocatedAcres < assignment.planted_acres) return { status: 'blocked', reason: 'This allocation covers only part of the crop with a yield or price override. Use one full field-crop allocation before calculating land costs.' }
    if ((override.expectedYieldPerAcre !== undefined && override.expectedYieldPerAcre !== null && !isFiniteNumber(override.expectedYieldPerAcre)) || (override.expectedPricePerBushel !== undefined && override.expectedPricePerBushel !== null && !isFiniteNumber(override.expectedPricePerBushel))) return { status: 'blocked', reason: 'A land-cost yield or price override is not a valid number.' }
    overridesByAssignment.set(assignment.id, override)
  }
  const fallbacksByAssignment = new Map((inputs.budgetFallbacks ?? []).map((fallback) => [fallback.cropAssignmentId, fallback]))
  const priced = assignments.map((assignment) => ({
    assignment,
    yieldPerAcre: overridesByAssignment.get(assignment.id)?.expectedYieldPerAcre ?? fallbacksByAssignment.get(assignment.id)?.expectedYieldPerAcre ?? assignment.expected_yield_per_acre,
    pricePerBushel: overridesByAssignment.get(assignment.id)?.expectedPricePerBushel ?? fallbacksByAssignment.get(assignment.id)?.expectedPricePerBushel ?? assignment.expected_price_per_bu,
  }))
  const missing = priced.filter((item) => !isFiniteNumber(item.yieldPerAcre) || !isFiniteNumber(item.pricePerBushel))
  if (missing.length) return { status: 'blocked', reason: `Enter a yield and price for every crop on this field before Farm Rx can calculate this field's land cost.` }
  if (priced.some(({ assignment }) => !isFiniteNumber(assignment.planted_acres) || assignment.planted_acres <= 0)) return { status: 'blocked', reason: 'Every crop on this field needs more than zero planted acres before Farm Rx can calculate land costs.' }
  const arrangement = arrangementResult.arrangement
  if (arrangement.arrangement_type === 'crop_share') {
    const unbound = priced.find(({ assignment }) => budgetLinesForAssignment(budgetsByAssignment, assignment.id) === undefined)
    if (unbound) return { status: 'blocked', reason: 'Allocate this field to a budget plan on the Budgets page, then reopen this report.' }
    const perAssignmentAllocation = priced.map(({ assignment, yieldPerAcre, pricePerBushel }) => {
      const revenue = assignment.planted_acres * yieldPerAcre! * pricePerBushel!
      const rentTotal = revenue * (arrangement.landlord_crop_pct ?? 0) / 100 - landlordPaidInputCost(budgetLinesForAssignment(budgetsByAssignment, assignment.id)!, arrangement) * assignment.planted_acres
      return { cropAssignmentId: assignment.id, yieldPerAcre: yieldPerAcre!, pricePerBushel: pricePerBushel!, revenue, rentTotal, rentPerAssignedAcre: rentTotal / assignment.planted_acres }
    })
    const totalRent = perAssignmentAllocation.reduce((total, item) => total + item.rentTotal, 0)
    if (!Number.isFinite(totalRent) || perAssignmentAllocation.some((item) => !Number.isFinite(item.revenue) || !Number.isFinite(item.rentTotal) || !Number.isFinite(item.rentPerAssignedAcre) || !Number.isFinite(item.yieldPerAcre) || !Number.isFinite(item.pricePerBushel))) return { status: 'blocked', reason: 'Farm Rx found an invalid land-cost number. Check field acres, planted acres, yield, and price before continuing.' }
    return { status: 'resolved', arrangement, rentPerFieldAcre: totalRent / field.total_acres, perAssignmentAllocation }
  }
  const revenueByAssignment = priced.map(({ assignment, yieldPerAcre, pricePerBushel }) => ({ assignment, yieldPerAcre: yieldPerAcre!, pricePerBushel: pricePerBushel!, revenue: assignment.planted_acres * yieldPerAcre! * pricePerBushel! }))
  const totalRevenue = revenueByAssignment.reduce((total, item) => total + item.revenue, 0)
  let rentPerFieldAcre: number | null
  if (arrangement.arrangement_type === 'owned') rentPerFieldAcre = 0
  else if (arrangement.arrangement_type === 'cash_rent') rentPerFieldAcre = arrangement.cash_rent_per_acre
  else {
    const formula = arrangement.flex_bonus_formula
    rentPerFieldAcre = formula && !isLegacyFlexBonusFormula(formula)
      ? computeStructuredFlexRentFromRevenue(formula, totalRevenue / field.total_acres)
      : formula && isLegacyFlexBonusFormula(formula)
        ? (arrangement.cash_rent_per_acre ?? 0) + revenueByAssignment.reduce((total, item) => {
          const perCrop = computeFlexRent(formula, item.yieldPerAcre, item.pricePerBushel, 0)
          return perCrop === null ? NaN : total + item.assignment.planted_acres / field.total_acres * perCrop
        }, 0)
        : null
  }
  if (rentPerFieldAcre === null || !Number.isFinite(rentPerFieldAcre)) return { status: 'blocked', reason: 'This flex-rent formula is incomplete. Complete it in Fields before using land costs.' }
  const totalRent = rentPerFieldAcre * field.total_acres
  const perAssignmentAllocation = revenueByAssignment.map(({ assignment, yieldPerAcre, pricePerBushel, revenue }) => {
    const rentTotal = totalRevenue === 0 && totalRent > 0
      ? totalRent * assignment.planted_acres / assignments.reduce((total, item) => total + item.planted_acres, 0)
      : totalRevenue === 0 ? 0 : totalRent * revenue / totalRevenue
    return { cropAssignmentId: assignment.id, yieldPerAcre, pricePerBushel, revenue, rentTotal, rentPerAssignedAcre: rentTotal / assignment.planted_acres }
  })
  if (!Number.isFinite(totalRent) || perAssignmentAllocation.some((item) => !Number.isFinite(item.revenue) || !Number.isFinite(item.rentTotal) || !Number.isFinite(item.rentPerAssignedAcre) || !Number.isFinite(item.yieldPerAcre) || !Number.isFinite(item.pricePerBushel))) return { status: 'blocked', reason: 'Farm Rx found an invalid land-cost number. Check field acres, planted acres, yield, and price before continuing.' }
  return {
    status: 'resolved', arrangement, rentPerFieldAcre,
    perAssignmentAllocation,
  }
}

/** Tested field-detail seam: it deliberately receives the full agreement history. */
export function fieldCardLand(field: Field, currentRows: CropAssignment[], allArrangements: Arrangement[]) {
  return resolveFieldYearLand(field, allArrangements, currentRows, currentRows[0]?.crop_year ?? new Date().getFullYear(), new Map())
}

export function matrixCells(prices: ProfitabilityMatrixStep[], yields: ProfitabilityMatrixStep[], costPerAcre: number): MatrixCell[] { return prices.flatMap((price) => yields.map((yieldStep) => ({ price: price.value, yield: yieldStep.value, profit: matrixProfitPerAcre(price.value, yieldStep.value, costPerAcre) }))) }
/** Outline actual zero crossings; if the grid has none, outline its closest cell(s). */
export function breakevenCellKeys(cells: MatrixCell[]) {
  const key = (cell: MatrixCell) => `${cell.price}|${cell.yield}`
  const crossing = new Set<string>()
  const prices = [...new Set(cells.map((cell) => cell.price))].sort((left, right) => left - right)
  const yields = [...new Set(cells.map((cell) => cell.yield))].sort((left, right) => left - right)
  const byKey = new Map(cells.map((cell) => [key(cell), cell]))
  for (const price of prices) for (const yieldPerAcre of yields) {
    const cell = byKey.get(`${price}|${yieldPerAcre}`)
    if (!cell) continue
    for (const neighborKey of [`${prices[prices.indexOf(price) + 1]}|${yieldPerAcre}`, `${price}|${yields[yields.indexOf(yieldPerAcre) + 1]}`]) {
      const neighbor = byKey.get(neighborKey)
      if (neighbor && (cell.profit === 0 || neighbor.profit === 0 || cell.profit < 0 !== neighbor.profit < 0)) { crossing.add(key(cell)); crossing.add(key(neighbor)) }
    }
  }
  if (crossing.size > 0) return crossing
  const nearest = Math.min(...cells.map((cell) => Math.abs(cell.profit)))
  return new Set(cells.filter((cell) => Math.abs(cell.profit) === nearest).map(key))
}

export function fieldAdjustedCostPerAcre(lines: BudgetCostLine[], equivalentRent: number | null) { return equivalentRent === null ? totalCostPerAcre(lines) : nonLandCostPerAcre(lines) + equivalentRent }

/** Shared by the mock and live repositories so a new budget's default price/yield matrix cannot drift between backends. */
export function defaultMatrixValues(budget: Pick<CropBudget, 'expected_price_per_bushel' | 'expected_yield_per_acre'>) {
  const priceStep = Math.max(.1, Number((budget.expected_price_per_bushel * .08).toFixed(2)))
  const yieldStep = Math.max(1, Math.round(budget.expected_yield_per_acre * .1))
  // Shift the whole window up instead of clamping each entry: per-entry clamping
  // collapsed low expectations into duplicate values, which the live matrix
  // (distinct-values rule) correctly rejects.
  const priceBase = Math.max(budget.expected_price_per_bushel, .01 + 2 * priceStep)
  const yieldBase = Math.max(budget.expected_yield_per_acre, 1 + 2 * yieldStep)
  const priceValues = [-2, -1, 0, 1, 2].map((offset) => Number((priceBase + offset * priceStep).toFixed(2)))
  const yieldValues = [-2, -1, 0, 1, 2].map((offset) => yieldBase + offset * yieldStep)
  return { priceValues, yieldValues }
}
