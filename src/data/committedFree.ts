import type { BinInventory, BinTransaction, GrainContract, GrainContractDelivery } from './grain'

/** LD-3: committed and free bushels, per commodity AND crop year, as one farm-level figure.
 *
 * Three rules decide everything here.
 *
 * 1. **A lot is a commodity in a crop year.** Carry-over grain is never charged against a
 *    current-year contract, which is the whole reason Initiative LD exists. Every figure below is
 *    keyed on both, never on the commodity alone.
 * 2. **The figure is farm-level and is never allocated per bin.** A farm's contracts are not written
 *    against particular bins, so splitting committed bushels across them would be an invention. The
 *    per-bin `committed_bushels` column still exists in the database and is deliberately not read
 *    here: a farm-level figure shown again on each bin is the same number counted twice.
 * 3. **A movement with no crop year is never credited to a year.** Those rows are their own bucket,
 *    reported separately and excluded from every year-specific figure, because assigning them to the
 *    bin baseline's year would be exactly the guess the 2026-09-05 amendment forbids.
 *
 * The lot arithmetic below mirrors, line for line, the lot balance `append_bin_movement` computes in
 * migration 20260921120000. The two must agree: the database refuses a bin-out the browser would
 * have shown as affordable, and a farmer who saw "free" bushels they cannot actually move has been
 * misled. The disposable assertions check both answers against the same fixture.
 */

/** A baseline restates only its own lot -- its commodity in its crop year -- through its measured
 * day. A movement of a different crop year is a different lot and survives, which is the difference
 * from the commodity-level rule in `binLedger`. */
export function isLotMovementSuperseded(inventory: BinInventory | undefined, movement: BinTransaction): boolean {
  if (!inventory) return false
  if (movement.commodity_id !== inventory.commodity_id) return false
  if (movement.crop_year !== inventory.crop_year) return false
  return movement.occurred_on <= inventory.measured_at.slice(0, 10)
}

/** The bushels of one lot in one bin. */
export function deriveBinLotOnHand(
  inventory: BinInventory | undefined,
  transactions: readonly BinTransaction[],
  commodityId: string,
  cropYear: number,
): number {
  const baseline = inventory && inventory.commodity_id === commodityId && inventory.crop_year === cropYear
    ? inventory.bushels
    : 0
  return transactions
    .filter((movement) => movement.commodity_id === commodityId && movement.crop_year === cropYear)
    .filter((movement) => !isLotMovementSuperseded(inventory, movement))
    .reduce((total, movement) => total + (movement.direction === 'in' ? movement.bushels : -movement.bushels), baseline)
}

/** LD-4: one lot a bin has a record of, with what that lot currently holds. A `crop_year` of null
 * is the unstamped bucket -- real bushels in the bin that belong to no crop year, and so can be
 * neither picked as a load's lot nor defaulted to. */
export interface BinLot {
  commodity_id: string
  crop_year: number | null
  bushels: number
}

/** LD-4: the browser's twin of the `public.bin_lots` function migration 20260921180000 installs.
 *
 * Two evaluators of one fact is the shape this initiative keeps finding, and this is one of the two
 * -- unavoidably, because a truck cab with no signal cannot ask the database which lots a bin holds.
 * The disposable assertions check both answers against the same fixture for exactly that reason.
 *
 * A lot the bin has emptied is still returned, at zero. "This bin has no record of that crop year"
 * and "this bin is out of that crop year" are different answers, and a farmer deserves the right
 * one. */
export function deriveBinLots(
  inventory: BinInventory | undefined,
  transactions: readonly BinTransaction[],
): BinLot[] {
  const keys = new Map<string, { commodity_id: string; crop_year: number | null }>()
  const remember = (commodity_id: string, crop_year: number | null) => {
    keys.set(`${commodity_id}:${crop_year ?? ''}`, { commodity_id, crop_year })
  }
  if (inventory) remember(inventory.commodity_id, inventory.crop_year)
  for (const movement of transactions) remember(movement.commodity_id, movement.crop_year)
  return [...keys.values()]
    .map((key) => {
      const baseline = inventory && inventory.commodity_id === key.commodity_id && inventory.crop_year === key.crop_year
        ? inventory.bushels
        : 0
      const bushels = transactions
        .filter((movement) => movement.commodity_id === key.commodity_id && movement.crop_year === key.crop_year)
        .filter((movement) => !isLotMovementSuperseded(inventory, movement))
        .reduce((total, movement) => total + (movement.direction === 'in' ? movement.bushels : -movement.bushels), baseline)
      return { commodity_id: key.commodity_id, crop_year: key.crop_year, bushels }
    })
    .sort((a, b) => {
      // The unstamped bucket sorts last wherever it appears: it is never an answer to "which year".
      if (a.crop_year === null && b.crop_year === null) return a.commodity_id.localeCompare(b.commodity_id)
      if (a.crop_year === null) return 1
      if (b.crop_year === null) return -1
      return b.crop_year - a.crop_year || a.commodity_id.localeCompare(b.commodity_id)
    })
}

/** LD-4: a lot a load may actually be hauled out of -- one with a crop year, holding something. */
export interface BinLotOnHand {
  commodity_id: string
  crop_year: number
  bushels: number
}

/** LD-4: the lots the form offers. Whether the bin will really let those bushels go is
 * append_bin_movement's question, asked under a row lock when the movement is written; this decides
 * only which lots are worth showing a farmer. */
export function binLotsOnHand(
  inventory: BinInventory | undefined,
  transactions: readonly BinTransaction[],
): BinLotOnHand[] {
  return deriveBinLots(inventory, transactions)
    .filter((lot): lot is BinLotOnHand => lot.crop_year !== null && lot.bushels > 0.000001)
}

/** The bushels of one lot across every bin on the farm. */
export function deriveFarmLotOnHand(
  inventories: readonly BinInventory[],
  transactions: readonly BinTransaction[],
  commodityId: string,
  cropYear: number,
): number {
  const binIds = new Set<string>([
    ...inventories.map((row) => row.grain_bin_id),
    ...transactions.map((row) => row.grain_bin_id),
  ])
  let total = 0
  for (const binId of binIds) {
    const inventory = inventories.find((row) => row.grain_bin_id === binId)
    const binMovements = transactions.filter((row) => row.grain_bin_id === binId)
    total += deriveBinLotOnHand(inventory, binMovements, commodityId, cropYear)
  }
  return total
}

/** Bushels still owed on one contract. Floored at zero per contract: an over-delivered contract owes
 * nothing, and letting it go negative would quietly pay down a different contract's obligation. */
export function contractUndeliveredBushels(
  contract: GrainContract,
  deliveries: readonly GrainContractDelivery[],
): number {
  const delivered = deliveries
    .filter((row) => row.grain_contract_id === contract.id)
    .reduce((total, row) => total + row.bushels, 0)
  return Math.max(0, contract.bushels - delivered)
}

/** Committed bushels for one lot: what the farm still owes on contracts for that commodity in that
 * crop year. A contract for another year never counts, however much of that commodity is stored. */
export function deriveCommittedBushels(
  contracts: readonly GrainContract[],
  deliveries: readonly GrainContractDelivery[],
  commodityId: string,
  cropYear: number,
): number {
  return contracts
    .filter((contract) => contract.commodity_id === commodityId && contract.crop_year === cropYear)
    .reduce((total, contract) => total + contractUndeliveredBushels(contract, deliveries), 0)
}

export interface CommittedFreeLot {
  commodity_id: string
  crop_year: number
  /** Stored bushels of this lot across the whole farm. */
  onHand: number
  /** Bushels still owed on this lot's contracts. */
  committed: number
  /** onHand minus committed. Negative means the farm owes more of this lot than it is holding, which
   * is a real and important answer rather than an error -- grain can be bought or hauled from the
   * field to cover it. */
  free: number
}

/** LD-3: bushels the farm holds that carry no crop year, per commodity. These are movements written
 * before LD-2 added the column. They are shown so a farmer can see that the year-specific figures
 * are not the whole story, and they are counted in no lot. */
export interface UnknownCropYearBushels {
  commodity_id: string
  bushels: number
  movementCount: number
}

export function deriveUnknownCropYearBushels(
  transactions: readonly BinTransaction[],
): UnknownCropYearBushels[] {
  const byCommodity = new Map<string, { bushels: number; movementCount: number }>()
  for (const movement of transactions) {
    if (movement.crop_year !== null) continue
    const current = byCommodity.get(movement.commodity_id) ?? { bushels: 0, movementCount: 0 }
    current.bushels += movement.direction === 'in' ? movement.bushels : -movement.bushels
    current.movementCount += 1
    byCommodity.set(movement.commodity_id, current)
  }
  return [...byCommodity.entries()]
    .map(([commodity_id, value]) => ({ commodity_id, ...value }))
    .sort((a, b) => a.commodity_id.localeCompare(b.commodity_id))
}

export function deriveCommittedFreeLot(
  source: {
    bin_inventory: readonly BinInventory[]
    bin_transactions: readonly BinTransaction[]
    grain_contracts: readonly GrainContract[]
    grain_contract_deliveries: readonly GrainContractDelivery[]
  },
  commodityId: string,
  cropYear: number,
): CommittedFreeLot {
  const onHand = deriveFarmLotOnHand(source.bin_inventory, source.bin_transactions, commodityId, cropYear)
  const committed = deriveCommittedBushels(source.grain_contracts, source.grain_contract_deliveries, commodityId, cropYear)
  return { commodity_id: commodityId, crop_year: cropYear, onHand, committed, free: onHand - committed }
}

/** Every lot the farm has a reason to show: one it stores, or one it owes. A lot with neither is not
 * a lot. */
export function deriveCommittedFree(
  source: {
    bin_inventory: readonly BinInventory[]
    bin_transactions: readonly BinTransaction[]
    grain_contracts: readonly GrainContract[]
    grain_contract_deliveries: readonly GrainContractDelivery[]
  },
): CommittedFreeLot[] {
  const keys = new Map<string, { commodity_id: string; crop_year: number }>()
  const remember = (commodity_id: string, crop_year: number | null) => {
    if (crop_year === null) return
    keys.set(`${commodity_id}:${crop_year}`, { commodity_id, crop_year })
  }
  for (const row of source.bin_inventory) remember(row.commodity_id, row.crop_year)
  for (const row of source.bin_transactions) remember(row.commodity_id, row.crop_year)
  for (const row of source.grain_contracts) remember(row.commodity_id, row.crop_year)
  return [...keys.values()]
    .map((key) => deriveCommittedFreeLot(source, key.commodity_id, key.crop_year))
    .filter((lot) => Math.abs(lot.onHand) > 0.000001 || lot.committed > 0.000001)
    .sort((a, b) => b.crop_year - a.crop_year || a.commodity_id.localeCompare(b.commodity_id))
}
