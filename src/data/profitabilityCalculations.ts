import type { Arrangement, CropAssignment, Field, FlexBonusFormula, StructuredFlexBonusFormula } from './fields'
import { isLegacyFlexBonusFormula } from './fields'
import type { BudgetCostLine, CropBudget, ProfitabilityMatrixStep } from './profitability'

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

export function landlordPaidInputCost(lines: BudgetCostLine[], arrangement: Arrangement) {
  const share = (categories: BudgetCostLine['category'][], percent: number) => lines.filter((line) => categories.includes(line.category)).reduce((total, line) => total + line.amount_per_acre, 0) * percent / 100
  return share(['seed'], arrangement.landlord_seed_pct)
    + share(['fertilizer'], arrangement.landlord_fertilizer_pct)
    + share(['chemical'], arrangement.landlord_chemical_pct)
    + share(['fuel'], arrangement.landlord_fuel_pct)
    + share(['labor'], arrangement.landlord_labor_custom_pct)
    + share(['crop_insurance'], arrangement.landlord_crop_insurance_pct)
    + share(['equipment_depreciation', 'repairs'], arrangement.landlord_equipment_pct)
    + share(['interest'], arrangement.landlord_interest_pct)
    + share(['custom'], arrangement.landlord_other_input_pct)
}

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

export function equivalentCashRentForScenario(arrangement: Arrangement, expectedYieldPerAcre: number, expectedPricePerBushel: number, lines: BudgetCostLine[]) {
  if (arrangement.arrangement_type === 'owned') return 0
  if (arrangement.arrangement_type === 'cash_rent') return arrangement.cash_rent_per_acre
  if (arrangement.arrangement_type === 'crop_share') return expectedYieldPerAcre * expectedPricePerBushel * (arrangement.landlord_crop_pct ?? 0) / 100 - landlordPaidInputCost(lines, arrangement)
  const formula = arrangement.flex_bonus_formula
  if (!formula) return null
  return computeFlexRent(formula, expectedYieldPerAcre, expectedPricePerBushel, arrangement.cash_rent_per_acre ?? 0)
}

/** Used by Fields and Profitability so lease math cannot drift between screens. */
export function equivalentCashRentForField(field: Field, assignments: CropAssignment[], arrangement: Arrangement, lines: BudgetCostLine[] = []) {
  if (arrangement.arrangement_type === 'owned') return 0
  if (arrangement.arrangement_type === 'cash_rent') return arrangement.cash_rent_per_acre
  if (assignments.length === 0 || assignments.some((assignment) => assignment.expected_yield_per_acre === null || assignment.expected_price_per_bu === null)) return null
  if (arrangement.arrangement_type === 'crop_share') return assignments.reduce((total, assignment) => total + assignment.planted_acres / field.total_acres * (equivalentCashRentForScenario(arrangement, assignment.expected_yield_per_acre!, assignment.expected_price_per_bu!, lines) ?? 0), 0)
  const formula = arrangement.flex_bonus_formula
  if (!formula) return null
  // Legacy formulas keep a base rent on the arrangement row, counted once (not per crop); the
  // structured schema carries its own base inside the formula, so the arrangement's placeholder
  // cash_rent_per_acre (kept only to satisfy the live DB's not-null constraint) must not be
  // added again — see SupabaseFieldsRepository / MockFieldsRepository save-time notes.
  if (isLegacyFlexBonusFormula(formula)) {
    const scenarioArrangement = { ...arrangement, cash_rent_per_acre: 0 }
    let unresolved = false
    const weighted = assignments.reduce((total, assignment) => {
      const scenario = equivalentCashRentForScenario(scenarioArrangement, assignment.expected_yield_per_acre!, assignment.expected_price_per_bu!, lines)
      if (scenario === null) unresolved = true
      return total + assignment.planted_acres / field.total_acres * (scenario ?? 0)
    }, 0)
    if (unresolved) return null
    return (arrangement.cash_rent_per_acre ?? 0) + weighted
  }
  // Structured formulas: blend the field's whole gross revenue per acre first (double-crop
  // revenue stacks on the same acres), then apply the formula ONCE so base rent and
  // min/max bounds are counted once for the field, matching how the lease is settled.
  const revenuePerAcre = assignments.reduce((total, assignment) => total + assignment.planted_acres * assignment.expected_yield_per_acre! * assignment.expected_price_per_bu!, 0) / field.total_acres
  return computeStructuredFlexRentFromRevenue(formula, revenuePerAcre)
}

export function latestArrangementForCropYear(arrangements: Arrangement[], fieldId: string, cropYear: number) {
  const start = `${cropYear}-01-01`; const end = `${cropYear}-12-31`
  return arrangements.filter((arrangement) => arrangement.field_id === fieldId && arrangement.effective_from <= end && (arrangement.effective_to === null || arrangement.effective_to >= start)).sort((left, right) => right.effective_from.localeCompare(left.effective_from) || right.id.localeCompare(left.id))[0] ?? null
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
