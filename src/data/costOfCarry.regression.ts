import { bestMonth, carryRow, verdict, type CarrySettings } from './costOfCarry'

let failures = 0
function check(name: string, actual: number | string | boolean | undefined, expected: number | string | boolean | undefined, tolerance = 0.0001) {
  const pass = typeof actual === 'number' && typeof expected === 'number' ? Math.abs(actual - expected) <= tolerance : actual === expected
  if (!pass) { failures += 1; console.error(`FAIL ${name}: expected ${expected}, got ${actual}`) } else { console.log(`ok ${name}`) }
}

const monthly: CarrySettings = { mode: 'monthly', monthlyRateCentsPerBuMonth: 4, flatRatePerBu: 0.18, interestRatePct: 6, truckingPerBu: 0.12 }
const monthlyTwoMonths = carryRow({ monthsStored: 2, harvestCashPrice: 4, cashPrice: 4.45, settings: monthly })
// Storage $0.08 + interest $0.04 + second haul $0.12 = $0.24; $4.45 - $4.00 - $0.24 = $0.21.
check('monthly storage cost accumulates', monthlyTwoMonths.storageCost, 0.08)
check('monthly carry total uses storage, interest, and trucking', monthlyTwoMonths.totalCarry, 0.24)
check('monthly net versus harvest is hand-computed', monthlyTwoMonths.netVsHarvest, 0.21)

const flat: CarrySettings = { ...monthly, mode: 'flat', flatRatePerBu: 0.3, interestRatePct: 0, truckingPerBu: 0 }
check('flat storage is charged once after harvest', carryRow({ monthsStored: 4, harvestCashPrice: 4, cashPrice: 4.5, settings: flat }).storageCost, 0.3)
check('flat storage is zero at harvest', carryRow({ monthsStored: 0, harvestCashPrice: 4, cashPrice: 4, settings: flat }).storageCost, 0)

const interestOnly: CarrySettings = { ...monthly, interestRatePct: 7, monthlyRateCentsPerBuMonth: 0, truckingPerBu: 0 }
check('interest accrues $4.3675 at 7% for two months', carryRow({ monthsStored: 2, harvestCashPrice: 4.3675, cashPrice: 4.3675, settings: interestOnly }).interestCost, 0.0509541667, 0.0001)

const harvest = carryRow({ monthsStored: 0, harvestCashPrice: 4, cashPrice: 4, settings: monthly })
check('harvest row has all-zero carry baseline', harvest.totalCarry, 0)
check('harvest row has all-zero storage baseline', harvest.storageCost, 0)
check('harvest row has all-zero interest baseline', harvest.interestCost, 0)
check('harvest row has all-zero trucking baseline', harvest.truckingCost, 0)
const winningStore = carryRow({ monthsStored: 3, harvestCashPrice: 4, cashPrice: 4.65, settings: monthly })
check('best month finds strongest stored row', bestMonth([harvest, monthlyTwoMonths, winningStore])?.monthsStored, 3)
check('verdict flips to store when carry clears', verdict([harvest, winningStore]).kind, 'store')
check('store verdict keeps the winning month', verdict([harvest, winningStore]).month, 3)
const losingStore = carryRow({ monthsStored: 2, harvestCashPrice: 4, cashPrice: 4.1, settings: monthly })
check('verdict stays harvest when no stored month clears carry', verdict([harvest, losingStore]).kind, 'harvest')

if (failures > 0) { console.error(`${failures} cost-of-carry regression check(s) FAILED`); process.exit(1) }
console.log('costOfCarry regression: all checks passed')
