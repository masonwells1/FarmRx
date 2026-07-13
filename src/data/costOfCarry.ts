export type CarrySettings = {
  mode: 'monthly' | 'flat'
  monthlyRateCentsPerBuMonth: number
  flatRatePerBu: number
  interestRatePct: number
  truckingPerBu: number
}

export type CarryRowInput = {
  monthsStored: number
  harvestCashPrice: number
  cashPrice: number
  settings: CarrySettings
}

export type CarryRow = CarryRowInput & {
  storageCost: number
  interestCost: number
  truckingCost: number
  totalCarry: number
  netVsHarvest: number
}

/** Math for one delivery month. Prices are farmer-entered cash-price inputs; market quotes
 * elsewhere in Grain are display-only and never feed this calculation. */
export function carryRow(inputs: CarryRowInput): CarryRow {
  const monthsStored = Math.max(0, inputs.monthsStored)
  const { settings } = inputs
  const storageCost = monthsStored === 0 ? 0 : settings.mode === 'monthly'
    ? monthsStored * settings.monthlyRateCentsPerBuMonth / 100
    : settings.flatRatePerBu
  const interestCost = inputs.harvestCashPrice * settings.interestRatePct / 100 * monthsStored / 12
  const truckingCost = monthsStored === 0 ? 0 : settings.truckingPerBu
  const totalCarry = storageCost + interestCost + truckingCost
  return { ...inputs, monthsStored, storageCost, interestCost, truckingCost, totalCarry, netVsHarvest: inputs.cashPrice - inputs.harvestCashPrice - totalCarry }
}

/** The best non-harvest delivery row, even when every storage choice loses money. */
export function bestMonth(rows: CarryRow[]): CarryRow | null {
  const storedRows = rows.filter((row) => row.monthsStored > 0)
  return storedRows.length ? storedRows.reduce((best, row) => row.netVsHarvest > best.netVsHarvest ? row : best) : null
}

export type CarryVerdict = { kind: 'harvest' | 'store'; month?: number; netPerBu: number }

/** Harvest is the factual baseline: storing only wins when it clears every carry cost. */
export function verdict(rows: CarryRow[]): CarryVerdict {
  const best = bestMonth(rows)
  return !best || best.netVsHarvest <= 0
    ? { kind: 'harvest', netPerBu: 0 }
    : { kind: 'store', month: best.monthsStored, netPerBu: best.netVsHarvest }
}
