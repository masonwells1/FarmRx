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

/** Grid helpers: they only move or copy prices the farmer typed, and never compute carry. */
type CarryGridRow = { marketPrice: string; basis: string }

/** The grid's rows are calendar months counted from the harvest month (row i is harvest month + i). Moving
 * the harvest month keeps every typed price on its own calendar month; `lost` counts the typed prices that
 * fall outside the new 13 months, and new months start blank with the default basis. */
export function shiftCarryRows<T extends CarryGridRow>(rows: readonly T[], fromMonth: number, toMonth: number, blank: () => T): { rows: T[]; lost: number; lostBasis: number } {
  const shift = toMonth - fromMonth
  const shifted = rows.map((_, index) => rows[index + shift] ?? blank())
  const dropped = rows.filter((_, index) => index - shift < 0 || index - shift >= rows.length)
  const lost = dropped.filter((row) => row.marketPrice.trim() !== '').length
  // A month with no typed price can still hold a basis the farmer changed from the default: it is cleared too. Compared as numbers,
  // so -0.30 against a default of -0.3 is the same basis, and a box the farmer cleared holds nothing to lose. A cleared default is
  // no basis at all, so any basis typed beside it (even 0, which Number('') would also read as) is the farmer's own.
  const defaultBasis = blank().basis
  const changedBasis = (basis: string) => basis.trim() !== '' && (defaultBasis.trim() === '' || Number(basis) !== Number(defaultBasis))
  const lostBasis = dropped.filter((row) => row.marketPrice.trim() === '' && changedBasis(row.basis)).length
  return { rows: shifted, lost, lostBasis }
}

/** A delivery month is priced off the next listed futures month, so each blank futures price takes the next
 * typed price below it. Months after the last typed price stay blank. */
export function fillFuturesFromNext<T extends CarryGridRow>(rows: readonly T[]): T[] {
  const filled = [...rows]; let next = ''
  for (let index = filled.length - 1; index >= 0; index -= 1) {
    if (filled[index].marketPrice.trim() !== '') next = filled[index].marketPrice
    else if (next !== '') filled[index] = { ...filled[index], marketPrice: next }
  }
  return filled
}

export function canFillFuturesFromNext(rows: readonly CarryGridRow[]): boolean {
  return rows.some((row, index) => row.marketPrice.trim() === '' && rows.slice(index + 1).some((later) => later.marketPrice.trim() !== ''))
}
