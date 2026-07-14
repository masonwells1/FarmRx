import { localCalendarDay } from './marketingAlerts'
import type { BinInventory, BinTransaction, GrainBin } from './grain'

const calendarDate = /^\d{4}-\d{2}-\d{2}$/
const validDate = (value: string) => calendarDate.test(value) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value

export const PRE_BASELINE_BIN_MOVEMENT_MESSAGE = "This movement is dated on or before the bin's baseline — use a date after the baseline."

export function validateGrainBin(value: GrainBin): string[] {
  const errors: string[] = []
  if (!value.name.trim() || value.name.trim().length > 160) errors.push('Bin name is required and must be 160 characters or fewer.')
  if (!Number.isFinite(value.capacity_bu) || value.capacity_bu <= 0) errors.push('Capacity must be greater than zero bushels.')
  if (value.location_type !== 'on_farm' && value.location_type !== 'commercial') errors.push('Choose on-farm or commercial storage.')
  if (value.moisture_pct !== null && (!Number.isFinite(value.moisture_pct) || value.moisture_pct < 0 || value.moisture_pct > 40)) errors.push('Moisture must be from 0 to 40%.')
  if ((value.moisture_pct === null) !== (value.moisture_checked_on === null)) errors.push('Enter both a moisture percentage and the date it was checked, or leave both blank.')
  if (value.moisture_checked_on !== null && !validDate(value.moisture_checked_on)) errors.push('Choose a real moisture check date.')
  if (value.moisture_checked_on !== null && value.moisture_checked_on > localCalendarDay(new Date())) errors.push('Moisture check date cannot be after today.')
  return errors
}

export function validateBinTransaction(value: BinTransaction): string[] {
  const errors: string[] = []
  if (value.direction !== 'in' && value.direction !== 'out') errors.push('Choose whether bushels moved in or out.')
  if (!Number.isFinite(value.bushels) || value.bushels <= 0) errors.push('Bushels must be greater than zero.')
  if (!value.commodity_id.trim()) errors.push('Choose a commodity.')
  if (!validDate(value.occurred_on)) errors.push('Choose a real movement date.')
  if (value.note !== null && (!value.note.trim() || value.note.trim().length > 4000)) errors.push('A movement note must be 1 to 4,000 characters when present.')
  if (value.source_kind !== null && (!value.source_kind.trim() || value.source_kind.trim().length > 80)) errors.push('A movement source must be 1 to 80 characters when present.')
  return errors
}

/** A baseline replaces only its own commodity's history through its measured day. */
export function isBinTransactionSuperseded(inventory: BinInventory | undefined, transaction: BinTransaction) {
  return !!inventory && transaction.commodity_id === inventory.commodity_id && transaction.occurred_on <= inventory.measured_at.slice(0, 10)
}

export function deriveBinOnHand(inventory: BinInventory | undefined, transactions: BinTransaction[]) {
  const baselineDate = inventory?.measured_at.slice(0, 10) ?? null
  // A measurement is a dated baseline, not another receipt. Earlier (and same-day)
  // movements are already represented in that measurement and must not be re-added.
  const movementsSinceBaseline = transactions.filter((transaction) => !isBinTransactionSuperseded(inventory, transaction))
  const recordedInventory = inventory?.bushels ?? 0
  const movementDelta = movementsSinceBaseline.reduce((sum, transaction) => sum + (transaction.direction === 'in' ? transaction.bushels : -transaction.bushels), 0)
  const rawOnHand = recordedInventory + movementDelta
  return { recordedInventory, baselineDate, movementsSinceBaseline, movementDelta, rawOnHand, onHand: rawOnHand, exceedsRecordedInventory: rawOnHand < 0 }
}

/** A bin has one established commodity: inventory takes precedence, then its first ledger movement. */
export function deriveBinPosition(inventory: BinInventory | undefined, transactions: BinTransaction[]) {
  const commodityIds = new Set(transactions.map((transaction) => transaction.commodity_id))
  if (inventory) commodityIds.add(inventory.commodity_id)
  const lots = [...commodityIds].sort().map((commodityId) => {
    const lotInventory = inventory?.commodity_id === commodityId ? inventory : undefined
    const lotTransactions = transactions.filter((transaction) => transaction.commodity_id === commodityId)
    return { commodityId, inventory: lotInventory, transactions: lotTransactions, ...deriveBinOnHand(lotInventory, lotTransactions) }
  })
  return { lots, transactions }
}

/** Lots with a nonzero balance are the only commodities a bin can currently hold. */
export function activeBinCommodityIds(inventory: BinInventory | undefined, transactions: BinTransaction[]) {
  return deriveBinPosition(inventory, transactions).lots.filter((lot) => Math.abs(lot.onHand) > 0.000001).map((lot) => lot.commodityId)
}

/** Bins are physical whole-farm inventory, not entity or crop-year scoped. */
export function deriveCommodityBinTotal(bins: GrainBin[], inventories: BinInventory[], transactions: BinTransaction[], commodityId: string, _cropYear?: number) {
  return bins.reduce((total, bin) => {
    const inventory = inventories.find((item) => item.grain_bin_id === bin.id)
    const position = deriveBinPosition(inventory, transactions.filter((item) => item.grain_bin_id === bin.id))
    return total + position.lots.filter((lot) => lot.commodityId === commodityId).reduce((sum, lot) => sum + lot.onHand, 0)
  }, 0)
}

export function moistureStatus(bin: GrainBin, now = new Date()) {
  if (bin.moisture_pct !== null && bin.moisture_checked_on === null) return { flagged: true, message: 'Moisture reading has no date.', daysSinceChecked: null }
  if (bin.moisture_pct === null && bin.moisture_checked_on !== null) return { flagged: true, message: 'Moisture check date has no reading.', daysSinceChecked: null }
  if (bin.moisture_pct === null || bin.moisture_checked_on === null) return { flagged: false, message: 'No moisture reading', daysSinceChecked: null }
  const today = localCalendarDay(now)
  const checkedOn = bin.moisture_checked_on > today ? today : bin.moisture_checked_on
  const daysSinceChecked = Math.max(0, Math.round((new Date(`${today}T00:00:00.000Z`).getTime() - new Date(`${checkedOn}T00:00:00.000Z`).getTime()) / 86_400_000))
  const high = bin.moisture_pct > 15
  const stale = daysSinceChecked > 30
  return { flagged: high || stale, message: high && stale ? 'Moisture is over 15% and the reading is more than 30 days old.' : high ? 'Moisture is over 15%.' : stale ? 'Moisture reading is more than 30 days old.' : 'Moisture reading is current.', daysSinceChecked }
}
