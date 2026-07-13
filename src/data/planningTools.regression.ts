/* Regression suite for plan-comparison / ROI planning math. Every expected number
 * below is taken verbatim from Mason's "2026 Cost of Production Calculator.xlsx"
 * (Breakeven Calculator + Input ROI Analyzer sheets) so the app provably matches
 * the spreadsheet it replaces. Run via `npm run regression` (tsx). */
import type { Arrangement } from './fields'
import type { BudgetCostLine, CropBudget } from './profitability'
import { FARMDOC_2026 } from './farmdocDefaults'
import { extraBushelsToJustify, missingCoachCategories, planCushions, planGroup, planProfitAsBudgeted, planProfitUnderArrangement, roiPriceLadder, roiThresholdsForCommodity, roiVerdict, roiWhatIfPerAcre } from './planningTools'

let failures = 0
function check(name: string, actual: number | string | boolean, expected: number | string | boolean, tolerance = 0.005) {
  const pass = typeof actual === 'number' && typeof expected === 'number' ? Math.abs(actual - expected) <= tolerance : actual === expected
  if (!pass) { failures += 1; console.error(`FAIL ${name}: expected ${expected}, got ${actual}`) } else { console.log(`ok ${name}`) }
}

const at = '2026-01-01T00:00:00.000Z'
const budget = (id: string, name: string, yieldPerAcre: number, price: number): CropBudget => ({ id, farm_id: 'farm', crop_year: 2026, commodity_id: 'corn', operating_entity_id: null, enterprise_label: null, name, expected_yield_per_acre: yieldPerAcre, expected_price_per_bushel: price, copied_from_budget_id: null, created_at: at, updated_at: at })
const line = (budgetId: string, category: BudgetCostLine['category'], amount: number): BudgetCostLine => ({ id: `${budgetId}-${category}-${amount}`, budget_id: budgetId, category, name: category, amount_per_acre: amount, created_at: at, updated_at: at })
const cashRent = (rent: number): Arrangement => ({ id: 'arr-cash', farm_id: 'farm', field_id: 'field', arrangement_type: 'cash_rent', cash_rent_per_acre: rent, landlord_name: null, landlord_phone: null, landlord_contact_notes: null, landlord_crop_pct: null, landlord_seed_pct: 0, landlord_fertilizer_pct: 0, landlord_chemical_pct: 0, landlord_fuel_pct: 0, landlord_labor_custom_pct: 0, landlord_crop_insurance_pct: 0, landlord_equipment_pct: 0, landlord_interest_pct: 0, landlord_other_input_pct: 0, flex_bonus_formula: null, effective_from: '2026-01-01', effective_to: null, notes: null, created_at: at, updated_at: at })
const cropShare = (landlordPct: number): Arrangement => ({ ...cashRent(0), id: 'arr-share', arrangement_type: 'crop_share', cash_rent_per_acre: 0, landlord_crop_pct: landlordPct })

// ---- Excel "Breakeven Calculator": corn plans at $4.20 / 205 bu, cash rent $275 ----
const planA = budget('a', 'Plan A (Full)', 205, 4.2)
const planB = budget('b', 'Plan B (Cheap)', 205, 4.2)
const linesA = [line('a', 'seed', 120), line('a', 'custom', 491.5)] // total 611.5 non-land, Excel C17
const linesB = [line('b', 'seed', 115), line('b', 'custom', 458.5)] // total 573.5, Excel C18
check('Plan A cash-rent profit (Excel D17 = -25.5)', planProfitUnderArrangement(planA, linesA, cashRent(275))!, -25.5)
check('Plan B cash-rent profit (Excel D18 = 12.5)', planProfitUnderArrangement(planB, linesB, cashRent(275))!, 12.5)
// Crop share 2/3-1/3, landlord pays no inputs (Excel E17): (4.2*205*(1-1/3)) - 611.5 = -37.5 with exact 1/3.
// Excel used 0.33 → -34.63; the app uses the exact landlord pct the farmer enters.
check('Plan A crop-share profit at exact 1/3 (Excel E17 shape)', planProfitUnderArrangement(planA, linesA, cropShare(100 / 3))!, 574 - 611.5)
// Breakeven cushions, Excel I10/J10: Plan A price cushion -0.1244, yield cushion -6.0714 (incl land 275)
const cushA = planCushions(planA, [...linesA, line('a', 'land', 275)])
check('Plan A price cushion (Excel I10)', cushA.priceCushion, -0.1243902439)
check('Plan A yield cushion (Excel J10)', cushA.yieldCushion, -6.071428571)
const cushB = planCushions(planB, [...linesB, line('b', 'land', 275)])
check('Plan B price cushion (Excel I11)', cushB.priceCushion, 0.06097560976)
check('Plan B yield cushion (Excel J11)', cushB.yieldCushion, 2.976190476)
check('Plan A as-budgeted profit equals cash-rent profit when land line = rent', planProfitAsBudgeted(planA, [...linesA, line('a', 'land', 275)]), -25.5)

// ---- Excel "Input ROI Analyzer": A vs B diff $38/ac ----
check('Extra bu needed at $4.00 (Excel C14 = 9.5)', extraBushelsToJustify(38, 4), 9.5)
check('Extra bu needed at $4.20 (Excel C32 = 9.0476)', extraBushelsToJustify(38, 4.2), 9.047619048)
const cornTiers = roiThresholdsForCommodity('Corn')
check('Verdict 9.5 bu corn (Excel D14 = Likely worth it)', roiVerdict(9.5, cornTiers), 'Likely worth it')
check('Verdict 6.33 bu corn (Excel D21 = Likely worth it)', roiVerdict(6.333333, cornTiers), 'Likely worth it')
check('Verdict 5 bu corn = Easy YES', roiVerdict(5, cornTiers), 'Easy YES')
check('Verdict 16 bu corn = Probably NO', roiVerdict(16, cornTiers), 'Probably NO')
check('What-if +10 bu at $4.20 (Excel C34 = $4.00/ac)', roiWhatIfPerAcre(38, 10, 4.2), 4)
const beanTiers = roiThresholdsForCommodity('Soybeans')
check('Bean extra bu at $11 (Excel C60 = 1.2727)', extraBushelsToJustify(14, 11), 1.272727273)
check('Bean what-if +1.5 bu at $11 (Excel C62 = $2.50/ac)', roiWhatIfPerAcre(14, 1.5, 11), 2.5)
check('Verdict 1.4 bu beans (Excel D47 = Likely worth it)', roiVerdict(1.4, beanTiers), 'Likely worth it')
check('Verdict 1.0 bu beans (Excel D51 = Easy YES)', roiVerdict(1, beanTiers), 'Easy YES')

// ---- plan grouping, ladder, coach, farmdoc totals ----
const otherYear = { ...budget('c', 'Old', 205, 4.2), crop_year: 2025 }
check('planGroup keeps same year+commodity only', planGroup([planA, planB, otherYear], planA).length, 2)
check('roiPriceLadder centers on expected price', roiPriceLadder(4.2)[2], 4.2)
check('roiPriceLadder low rung', roiPriceLadder(4.2)[0], 3.78)
check('coach flags all six when only seed exists', missingCoachCategories([line('x', 'seed', 100)]).length, 6)
check('coach silent when full', missingCoachCategories(['fuel', 'repairs', 'labor', 'equipment_depreciation', 'interest', 'crop_insurance'].map((category) => line('x', category as BudgetCostLine['category'], 1))).length, 0)
const cornTotal = FARMDOC_2026.corn.lines.reduce((sum, item) => sum + item.amount_per_acre, 0)
const soyTotal = FARMDOC_2026.soybeans.lines.reduce((sum, item) => sum + item.amount_per_acre, 0)
check('farmdoc 2026 corn non-land total = $833/ac', cornTotal - 321, 833)
check('farmdoc 2026 soybean non-land total = $511/ac', soyTotal - 321, 511)

if (failures > 0) { console.error(`${failures} planning-tools regression check(s) FAILED`); process.exit(1) }
console.log('planningTools regression: all checks passed')
