import type { BinInventory, BinTransaction, GrainContract, GrainContractDelivery } from './grain'
import {
  contractUndeliveredBushels,
  deriveBinLotOnHand,
  deriveCommittedBushels,
  deriveCommittedFree,
  deriveCommittedFreeLot,
  deriveFarmLotOnHand,
  deriveUnknownCropYearBushels,
} from './committedFree'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

const farm = '00000000-0000-4000-8000-000000000900'
const binA = '00000000-0000-4000-8000-000000000901'
const binB = '00000000-0000-4000-8000-000000000902'
const stamp = '2026-01-01T00:00:00.000Z'

let sequence = 0
const nextId = () => `00000000-0000-4000-8000-${String(910 + sequence++).padStart(12, '0')}`

const baseline = (grain_bin_id: string, crop_year: number, commodity_id: string, bushels: number): BinInventory => ({
  id: nextId(), farm_id: farm, grain_bin_id, crop_year, commodity_id, bushels,
  committed_bushels: 0, measured_at: stamp, notes: null, created_at: stamp, updated_at: stamp,
})

const movement = (
  grain_bin_id: string,
  direction: 'in' | 'out',
  bushels: number,
  commodity_id: string,
  crop_year: number | null,
  occurred_on: string,
): BinTransaction => ({
  id: nextId(), farm_id: farm, grain_bin_id, direction, bushels, commodity_id, crop_year,
  occurred_on, note: null, source_kind: null, grain_load_id: null, created_at: stamp,
})

const contract = (crop_year: number, commodity_id: string, bushels: number): GrainContract => ({
  id: nextId(), farm_id: farm, crop_year, commodity_id, operating_entity_id: null, enterprise_label: null,
  contract_type: 'forward_cash', buyer: 'Test Elevator', bushels, futures_price: null, basis: null,
  cash_price: 4.5, delivery_start: null, delivery_end: null, contract_number: null,
  premium_cents_per_bu: 0, notes: null, created_at: stamp, updated_at: stamp,
})

const delivery = (grain_contract_id: string, bushels: number): GrainContractDelivery => ({
  id: nextId(), farm_id: farm, grain_contract_id, bushels, delivered_on: '2026-10-01', note: null, created_at: stamp,
})

// ---- 1. Carry-over grain is never charged against a current-year contract ----
// The defect Initiative LD exists to prevent, stated as arithmetic. One bin, one commodity, two crop
// years; one contract, for the newer year only.
{
  const inventories = [baseline(binA, 2025, 'corn_yellow', 6_000)]
  const transactions = [movement(binA, 'in', 4_000, 'corn_yellow', 2026, '2026-10-01')]
  const contracts = [contract(2026, 'corn_yellow', 3_000)]
  const source = { bin_inventory: inventories, bin_transactions: transactions, grain_contracts: contracts, grain_contract_deliveries: [] }

  const current = deriveCommittedFreeLot(source, 'corn_yellow', 2026)
  assert(current.onHand === 4_000, `The 2026 lot holds 4,000 bushels, not ${current.onHand}.`)
  assert(current.committed === 3_000, `The 2026 lot owes 3,000 bushels, not ${current.committed}.`)
  assert(current.free === 1_000, `The 2026 lot has 1,000 free bushels, not ${current.free}.`)

  const carryover = deriveCommittedFreeLot(source, 'corn_yellow', 2025)
  assert(carryover.onHand === 6_000, `The 2025 lot holds 6,000 bushels, not ${carryover.onHand}.`)
  // The whole point: the 2026 contract does not reach back into the 2025 crop.
  assert(carryover.committed === 0, `Carry-over grain was charged ${carryover.committed} bushels against a current-year contract.`)
  assert(carryover.free === 6_000, `The 2025 lot has 6,000 free bushels, not ${carryover.free}.`)

  // And the commodity total is deliberately NOT how this is computed: 10,000 bushels of corn against
  // a 3,000 bushel contract would have read 7,000 free in both years.
  assert(current.free + carryover.free === 7_000, 'The two lots together should still reconcile to the commodity total.')
}

// ---- 2. A movement with no crop year is its own bucket ----
{
  const inventories = [baseline(binA, 2026, 'corn_yellow', 5_000)]
  const transactions = [
    movement(binA, 'out', 1_200, 'corn_yellow', null, '2026-11-01'),
    movement(binA, 'out', 800, 'corn_yellow', 2026, '2026-11-02'),
  ]
  const source = { bin_inventory: inventories, bin_transactions: transactions, grain_contracts: [], grain_contract_deliveries: [] }

  const lot = deriveCommittedFreeLot(source, 'corn_yellow', 2026)
  // The unstamped 1,200 is invisible to the year. Counting it here would be the silent guess the
  // amendment forbids; the figure is honest about what it knows.
  assert(lot.onHand === 4_200, `The 2026 lot reads ${lot.onHand}; an unstamped movement was credited to it.`)

  const unknown = deriveUnknownCropYearBushels(transactions)
  assert(unknown.length === 1, `Expected one unknown-crop-year commodity, saw ${unknown.length}.`)
  assert(unknown[0]!.commodity_id === 'corn_yellow', 'The unknown bucket names the wrong commodity.')
  assert(unknown[0]!.bushels === -1_200, `The unknown bucket reads ${unknown[0]!.bushels}, expected -1,200.`)
  assert(unknown[0]!.movementCount === 1, 'The unknown bucket should count exactly the unstamped movements.')

  // A lot that exists only as unstamped movements never appears as a crop year at all.
  assert(!deriveCommittedFree(source).some((row) => row.crop_year === null as unknown as number), 'An unstamped movement became a crop year.')
}

// ---- 3. A baseline restates only its own lot ----
// binLedger's commodity-level rule would supersede both of these. The lot rule supersedes only the
// movement that is the same commodity AND the same crop year.
{
  const inventory = baseline(binA, 2026, 'corn_yellow', 5_000)
  const sameLotBefore = movement(binA, 'in', 900, 'corn_yellow', 2026, '2025-12-31')
  const otherYearBefore = movement(binA, 'in', 700, 'corn_yellow', 2025, '2025-12-31')

  const current = deriveBinLotOnHand(inventory, [sameLotBefore, otherYearBefore], 'corn_yellow', 2026)
  assert(current === 5_000, `A movement already inside the baseline was re-added: ${current}.`)

  const carryover = deriveBinLotOnHand(inventory, [sameLotBefore, otherYearBefore], 'corn_yellow', 2025)
  assert(carryover === 700, `A different crop year's movement was swallowed by the baseline: ${carryover}.`)
}

// ---- 4. Deliveries reduce what is committed, and over-delivery floors at zero ----
{
  const owed = contract(2026, 'soybeans', 10_000)
  const over = contract(2026, 'soybeans', 2_000)
  const deliveries = [delivery(owed.id, 4_000), delivery(over.id, 3_500)]

  assert(contractUndeliveredBushels(owed, deliveries) === 6_000, 'A partly delivered contract still owes the remainder.')
  // Floored per contract: letting this read -1,500 would quietly pay down the other contract.
  assert(contractUndeliveredBushels(over, deliveries) === 0, 'An over-delivered contract owes nothing, never a negative.')
  assert(deriveCommittedBushels([owed, over], deliveries, 'soybeans', 2026) === 6_000, 'Over-delivery on one contract must not reduce another.')
}

// ---- 5. Free is honest when the farm owes more than it holds ----
{
  const source = {
    bin_inventory: [baseline(binA, 2026, 'wheat', 1_000)],
    bin_transactions: [],
    grain_contracts: [contract(2026, 'wheat', 4_000)],
    grain_contract_deliveries: [],
  }
  const lot = deriveCommittedFreeLot(source, 'wheat', 2026)
  assert(lot.free === -3_000, `A farm owing more than it holds should read -3,000 free, not ${lot.free}.`)
}

// ---- 6. The figure is farm-level: it sums across bins and ignores per-bin committed ----
{
  const inventories = [
    { ...baseline(binA, 2026, 'corn_yellow', 3_000), committed_bushels: 3_000 },
    { ...baseline(binB, 2026, 'corn_yellow', 2_000), committed_bushels: 2_000 },
  ]
  const source = {
    bin_inventory: inventories,
    bin_transactions: [],
    grain_contracts: [contract(2026, 'corn_yellow', 1_500)],
    grain_contract_deliveries: [],
  }
  const farmTotal = deriveFarmLotOnHand(inventories, [], 'corn_yellow', 2026)
  assert(farmTotal === 5_000, `The farm holds 5,000 bushels of the lot across two bins, not ${farmTotal}.`)

  const lot = deriveCommittedFreeLot(source, 'corn_yellow', 2026)
  // The per-bin committed_bushels column says 5,000. It is deliberately not read: the contracts say
  // 1,500, and a farm-level figure shown again on each bin is the same number counted twice.
  assert(lot.committed === 1_500, `Committed must come from contracts, not the per-bin column (saw ${lot.committed}).`)
  assert(lot.free === 3_500, `Free should be 3,500, not ${lot.free}.`)
}

// ---- 7. The summary lists every lot the farm stores or owes, newest crop year first ----
{
  const source = {
    bin_inventory: [baseline(binA, 2025, 'corn_yellow', 500)],
    bin_transactions: [movement(binB, 'in', 300, 'soybeans', 2026, '2026-10-05')],
    grain_contracts: [contract(2026, 'wheat', 900)],
    grain_contract_deliveries: [],
  }
  const lots = deriveCommittedFree(source)
  assert(lots.length === 3, `Expected three lots, saw ${lots.length}.`)
  assert(lots[0]!.crop_year === 2026 && lots[2]!.crop_year === 2025, 'Lots should be newest crop year first.')
  // A lot owed but not stored still appears, because the farm has to know it owes it.
  const owedOnly = lots.find((row) => row.commodity_id === 'wheat')!
  assert(owedOnly.onHand === 0 && owedOnly.committed === 900 && owedOnly.free === -900, 'A contracted lot with no stored bushels must still be listed.')
}

console.log('Committed vs free regressions passed (7 coverage groups).')
