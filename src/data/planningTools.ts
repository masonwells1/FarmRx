import type { Arrangement, CropAssignment, Field } from './fields'
import type { BudgetCostLine, CropBudget } from './profitability'
import { nonLandCostPerAcre, resolveFieldYearLand, totalCostPerAcre } from './profitabilityCalculations'

/** Sibling budgets sharing a crop year + commodity are one comparison set of "plans". */
export function planGroup(budgets: CropBudget[], budget: CropBudget) {
  return budgets.filter((item) => item.crop_year === budget.crop_year && item.commodity_id === budget.commodity_id)
}

/** How far price/yield can fall from expectations before this plan loses money (its own cost lines). */
export function planCushions(budget: CropBudget, lines: BudgetCostLine[]) {
  const cost = totalCostPerAcre(lines)
  return {
    priceCushion: budget.expected_price_per_bushel - cost / budget.expected_yield_per_acre,
    yieldCushion: budget.expected_yield_per_acre - cost / budget.expected_price_per_bushel,
  }
}

/** Profit/acre for a plan under a specific land arrangement: the arrangement's equivalent
 * cash rent replaces any land lines in the budget, so land is never counted twice. */
export function planProfitUnderArrangement(budget: CropBudget, lines: BudgetCostLine[], arrangement: Arrangement): number | null {
  const field = { id: arrangement.field_id, total_acres: 1 } as Field
  const assignment = { id: `planning-${budget.id}`, field_id: field.id, crop_year: budget.crop_year, planted_acres: 1, expected_yield_per_acre: budget.expected_yield_per_acre, expected_price_per_bu: budget.expected_price_per_bushel } as CropAssignment
  const resolved = resolveFieldYearLand(field, [arrangement], [assignment], budget.crop_year, new Map([[assignment.id, lines]]))
  if (resolved.status === 'blocked') return null
  return budget.expected_yield_per_acre * budget.expected_price_per_bushel - nonLandCostPerAcre(lines) - resolved.rentPerFieldAcre
}

/** Profit/acre exactly as budgeted (the budget's own cost lines, including its land line). */
export function planProfitAsBudgeted(budget: CropBudget, lines: BudgetCostLine[]) {
  return budget.expected_yield_per_acre * budget.expected_price_per_bushel - totalCostPerAcre(lines)
}

export type RoiThresholds = { easyYes: number; likely: number; marginal: number }
/** Verdict tiers mirror Mason's Excel Input ROI Analyzer; per-crop scale (corn vs beans). */
export function roiThresholdsForCommodity(commodityName: string): RoiThresholds {
  return /bean|soy/i.test(commodityName) ? { easyYes: 1, likely: 2, marginal: 3 } : { easyYes: 6, likely: 10, marginal: 15 }
}

export function extraBushelsToJustify(costDifferencePerAcre: number, pricePerBushel: number) {
  return pricePerBushel > 0 ? costDifferencePerAcre / pricePerBushel : Number.POSITIVE_INFINITY
}

export type RoiVerdict = 'Easy YES' | 'Likely worth it' | 'Marginal' | 'Probably NO'
export function roiVerdict(extraBushelsNeeded: number, thresholds: RoiThresholds): RoiVerdict {
  if (extraBushelsNeeded <= thresholds.easyYes) return 'Easy YES'
  if (extraBushelsNeeded <= thresholds.likely) return 'Likely worth it'
  if (extraBushelsNeeded <= thresholds.marginal) return 'Marginal'
  return 'Probably NO'
}

/** $/acre won (or lost) by choosing the higher-cost plan when you expect `expectedExtraYield` more bushels. */
export function roiWhatIfPerAcre(costDifferencePerAcre: number, expectedExtraYield: number, pricePerBushel: number) {
  return (expectedExtraYield - extraBushelsToJustify(costDifferencePerAcre, pricePerBushel)) * pricePerBushel
}

/** A small ladder of prices around the expected price for the ROI table. */
export function roiPriceLadder(expectedPrice: number) {
  return [-2, -1, 0, 1, 2].map((offset) => Number((expectedPrice * (1 + offset * .05)).toFixed(2)))
}

/** Gold-standard cost categories a full budget usually carries; used by the
 * "what am I forgetting?" coach. Land is checked separately per arrangement. */
export const COACH_CATEGORIES = ['fuel', 'repairs', 'labor', 'equipment_depreciation', 'interest', 'crop_insurance'] as const
export function missingCoachCategories(lines: BudgetCostLine[]) {
  const present = new Set(lines.map((line) => line.category))
  return COACH_CATEGORIES.filter((category) => !present.has(category))
}
