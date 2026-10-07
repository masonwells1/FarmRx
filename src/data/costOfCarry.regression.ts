import { bestMonth, canFillFuturesFromNext, carryRow, fillFuturesFromNext, shiftCarryRows, verdict, type CarrySettings } from './costOfCarry'

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

// Grid helpers: moving the harvest month keeps typed prices on their calendar month, and fill-down copies the next typed futures price.
const gridRow = (marketPrice: string, basis = '-0.30') => ({ marketPrice, basis })
const blankRow = () => gridRow('', '-0.25')
const octoberGrid = Array.from({ length: 13 }, (_, index) => gridRow(index === 0 ? '4.10' : index === 1 ? '4.15' : index === 2 ? '4.25' : ''))
const toSeptember = shiftCarryRows(octoberGrid, 9, 8, blankRow)
check('harvest month Oct to Sep moves the Dec price from row 2 to row 3', toSeptember.rows[3].marketPrice, '4.25')
check('harvest month Oct to Sep moves the Oct price to row 1', toSeptember.rows[1].marketPrice, '4.10')
check('harvest month Oct to Sep opens a blank September row with the default basis', toSeptember.rows[0].basis, '-0.25')
check('harvest month Oct to Sep loses no typed price', toSeptember.lost, 0)
check('harvest month Oct to Sep keeps 13 rows', toSeptember.rows.length, 13)
const toDecember = shiftCarryRows(octoberGrid, 9, 11, blankRow)
check('harvest month Oct to Dec counts the Oct and Nov prices as lost', toDecember.lost, 2)
check('harvest month Oct to Dec keeps the Dec price as the harvest row', toDecember.rows[0].marketPrice, '4.25')
check('an unchanged harvest month loses nothing', shiftCarryRows(octoberGrid, 9, 9, blankRow).lost, 0)
// A month with no typed price but a basis changed from the default is cleared too, so it is counted separately for the question.
const customBasisGrid = Array.from({ length: 13 }, (_, index) => gridRow(index === 0 ? '4.10' : '', index === 1 ? '-0.40' : '-0.25'))
const customBasisShift = shiftCarryRows(customBasisGrid, 9, 11, blankRow)
check('harvest month Oct to Dec counts the typed Oct price as lost', customBasisShift.lost, 1)
check('harvest month Oct to Dec counts the Nov custom basis as lost', customBasisShift.lostBasis, 1)
check('a basis left at the default is not counted as lost', shiftCarryRows(Array.from({ length: 13 }, () => gridRow('', '-0.25')), 9, 11, blankRow).lostBasis, 0)
check('a basis written differently from the default (-0.250 vs -0.25) is not counted as lost', shiftCarryRows(Array.from({ length: 13 }, () => gridRow('', '-0.250')), 9, 11, blankRow).lostBasis, 0)
check('a basis box the farmer cleared is not counted as lost', shiftCarryRows(Array.from({ length: 13 }, () => gridRow('', '')), 9, 11, blankRow).lostBasis, 0)
const sparse = ['', '', '4.60', '', '4.75', '', ''].map((price) => gridRow(price))
check('fill-down copies the next typed futures price into blank months', fillFuturesFromNext(sparse).map((row) => row.marketPrice).join('|'), '4.60|4.60|4.60|4.75|4.75||')
check('fill-down keeps each row basis', fillFuturesFromNext(sparse)[0].basis, '-0.30')
check('fill-down is offered when a blank month has a typed month below it', canFillFuturesFromNext(sparse), true)
check('fill-down is not offered once nothing can be filled', canFillFuturesFromNext(fillFuturesFromNext(sparse)), false)

if (failures > 0) { console.error(`${failures} cost-of-carry regression check(s) FAILED`); process.exit(1) }
console.log('costOfCarry regression: all checks passed')
