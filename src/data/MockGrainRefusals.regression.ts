import type { FieldsRepository } from './fields'
import { fieldsSeedForRegression } from './MockFieldsRepository'
import { MockGrainRepository } from './MockGrainRepository'
import { contractIsDeletable, enterpriseLabelFits, validateGrainContract, type BinTransaction, type FirmOffer, type GrainContract, type GrainData, type GrainLoadDraft, type MarketingAlertRule } from './grain'
import { DELETE_PERMISSION_MESSAGE } from './saveDurability'

/** Refusal audit (LD-010): the grain mock stands in for the live repository AND the database behind
 * it, so what it refuses has to match what they refuse. Six earlier disagreements were found one at a
 * time, each by accident, and five of them were in what a stand-in returned. This file pins the
 * refusals the audit found missing -- and the three it found the mock making that production does not.
 */

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, String(value)) }, removeItem: (key: string) => { store.delete(key) }, clear: () => store.clear(), key: () => null, get length() { return store.size } } })
const fields = fieldsSeedForRegression()
const fieldsRepository = { getData: async () => fields } as unknown as FieldsRepository
const KEY = 'farm-rx-local-data'
const year = new Date().getFullYear()
const today = new Date().toISOString().slice(0, 10)
const uid = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`
const seed = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

let repo = new MockGrainRepository(fieldsRepository)
async function fresh() { store.clear(); repo = new MockGrainRepository(fieldsRepository); await repo.getData() }
function edit(change: (grain: GrainData) => void) { const envelope = JSON.parse(store.get(KEY)!) as { grain: GrainData }; change(envelope.grain); store.set(KEY, JSON.stringify(envelope)) }
async function data() { return repo.getData() }
async function refused(action: () => Promise<unknown>, expected: string | RegExp, label: string) {
  try { await action() } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    assert(typeof expected === 'string' ? message === expected : expected.test(message), `${label}: refused with the wrong message: ${message}`)
    return
  }
  throw new Error(`${label}: the mock accepted what production refuses.`)
}
const draft = (patch: Partial<GrainLoadDraft>): GrainLoadDraft => ({ load_date: today, truck_equipment_id: '', truck_name: '', origin_kind: 'bin', origin_grain_bin_id: '', origin_crop_assignment_id: '', origin_crop_year: '', origin_commodity_id: '', destination_kind: 'buyer', destination_buyer: 'Riverside Elevator', destination_grain_contract_id: '', destination_grain_bin_id: '', gross_lbs: '', tare_lbs: '', net_bushels: '100', moisture_pct: '', ticket_number: '', notes: '', effect_bin_out: false, effect_bin_in: false, effect_contract_delivery: false, effect_harvest: false, ...patch })

// 1. A price leg is finalized only once the other is set. The mock read the missing leg as zero and
//    wrote a cash price nobody agreed to.
await fresh()
{
  const forwardCash = seed(601)
  await refused(() => repo.finalizeContractPriceLeg(forwardCash, 'futures_price', 4.2), 'Set the basis before finalizing the futures price.', 'finalize futures with no basis')
  await refused(() => repo.finalizeContractPriceLeg(forwardCash, 'basis', -0.2), 'Set the futures price before finalizing the basis.', 'finalize basis with no futures')
  const after = (await data()).grain_contracts.find((row) => row.id === forwardCash)!
  assert(after.cash_price === 4.86 && after.futures_price === null && after.basis === null, 'A refused finalization must leave the contract as it was.')
  await repo.finalizeContractPriceLeg(seed(602), 'basis', -0.25)
  assert((await data()).grain_contracts.find((row) => row.id === seed(602))!.cash_price === 4.49, 'An HTA contract with its futures set still finalizes its basis.')
}

// 2. Filling a firm offer inserts its contract: an id another contract holds is refused, not replaced.
await fresh()
{
  const offer: FirmOffer = { id: uid(1), farm_id: fields.farm.id, crop_year: year, commodity_id: 'corn_yellow', operating_entity_id: null, enterprise_label: null, buyer: 'Riverside', offer_type: 'cash', bushels: 5000, price: 4.9, basis: null, contract_month: null, expires_on: null, delivery_location: null, notes: null, status: 'open', filled_contract_id: null, created_at: `${today}T00:00:00.000Z`, updated_at: `${today}T00:00:00.000Z` }
  edit((grain) => { grain.firm_offers = [offer] })
  const existing = (await data()).grain_contracts.find((row) => row.id === seed(601))!
  await refused(() => repo.fillFirmOffer(offer, { ...existing, buyer: 'Riverside', bushels: 5000 }), 'Farm Rx could not record this grain contract.', 'fill an offer onto an existing contract id')
  const after = await data()
  assert(after.grain_contracts.find((row) => row.id === seed(601))!.buyer === 'Cargill - Olney' && after.firm_offers[0]!.status === 'open', 'A refused fill must change neither the other contract nor the offer.')
}

// 3. A contract a load ticket names cannot be deleted, voided ticket or not; it can still be corrected.
await fresh()
{
  const contractId = seed(601)
  const assignment = fields.crop_assignments.find((row) => row.commodity_id === 'corn_yellow' && row.crop_year === year) ?? fields.crop_assignments[0]!
  await repo.saveLoad(uid(2), draft({ origin_kind: 'field', origin_crop_assignment_id: assignment.id, destination_kind: 'contract', destination_grain_contract_id: contractId, destination_buyer: '' }))
  const voided = await repo.voidLoad(uid(2), 'wrong truck')
  assert(voided.status === 'voided', 'A load with no effects voids.')
  const workspace = await data()
  assert(!contractIsDeletable(workspace, contractId), 'A contract a load names must not be offered for deletion.')
  const contract = workspace.grain_contracts.find((row) => row.id === contractId)!
  await refused(() => repo.deleteContract(contractId, 'entered twice', contract.updated_at, uid(3)), 'A load ticket names this contract, so it can be corrected but not deleted.', 'delete a contract a load names')
  assert((await data()).grain_contracts.some((row) => row.id === contractId), 'A refused delete must keep the contract.')
}

// 4. A correction must change something, and an empty one is refused before it is sent.
await fresh()
{
  const contract = (await data()).grain_contracts.find((row) => row.id === seed(601))!
  await refused(() => repo.editContract(contract.id, 'fixing the buyer', {}, contract.updated_at, uid(4)), 'Change something before saving this correction.', 'an empty correction')
  await refused(() => repo.editContract(contract.id, 'fixing the buyer', { buyer: contract.buyer }, contract.updated_at, uid(5)), 'A correction must change something.', 'a correction that changes nothing')
  assert((await data()).grain_contracts.find((row) => row.id === contract.id)!.updated_at === contract.updated_at, 'A refused correction must not move updated_at.')
}

// 5. Contracts are insert-only from the browser: an identical retry is fine, a changed one is not.
await fresh()
{
  const contract = (await data()).grain_contracts.find((row) => row.id === seed(601))!
  await repo.saveContract(contract)
  await refused(() => repo.saveContract({ ...contract, bushels: contract.bushels + 1 }), 'FARM_RX_STALE_WRITE', 'overwrite a contract through saveContract')
}

// 6. A delivery note is trimmed as the live path trims it, and a delivery needs a real date.
await fresh()
{
  const base = { id: uid(6), farm_id: fields.farm.id, grain_contract_id: seed(601), bushels: 100, delivered_on: today, note: 'Load 12', grain_load_id: null, created_at: `${today}T00:00:00.000Z` }
  await repo.recordContractDelivery(base)
  await repo.recordContractDelivery({ ...base, note: '  Load 12  ' })
  assert((await data()).grain_contract_deliveries.filter((row) => row.id === uid(6)).length === 1, 'A retry differing only in note whitespace is the same delivery.')
  await refused(() => repo.recordContractDelivery({ ...base, id: uid(7), delivered_on: `${year}-02-30` }), 'Enter the date these bushels were delivered.', 'a delivery on a day that does not exist')
}

// 7. A marketing plan cannot hold one month twice, or take over another scope's target id.
await fresh()
{
  const workspace = await data()
  const corn = workspace.marketing_plan_targets.filter((row) => row.commodity_id === 'corn_yellow')
  const scope = { farm_id: fields.farm.id, crop_year: year, commodity_id: 'corn_yellow', operating_entity_id: null, enterprise_label: null }
  await refused(() => repo.replaceMarketingPlanTargets(scope, [...corn.slice(0, 2), { ...corn[0]!, id: uid(8), target_pct_of_production: 1 }]), 'Farm Rx found an invalid marketing plan target.', 'two targets in one month')
  const soybean = workspace.marketing_plan_targets.find((row) => row.commodity_id === 'soybeans')!
  await refused(() => repo.replaceMarketingPlanTargets(scope, [...corn.slice(0, 2), { ...corn[2]!, id: soybean.id }]), 'Farm Rx found an invalid marketing plan target.', 'a target id another scope owns')
  assert((await data()).marketing_plan_targets.length === workspace.marketing_plan_targets.length, 'A refused plan must change nothing.')
}

// 8. A cash bid needs an elevator, and a USDA feed row cannot be edited from the browser.
await fresh()
{
  const bid = (await data()).cash_bids[0]!
  await refused(() => repo.saveCashBid({ ...bid, id: uid(9), elevator: '   ' }), 'Enter the elevator and the date of this bid.', 'a bid with no elevator')
  edit((grain) => { grain.cash_bids = grain.cash_bids.map((row) => row.id === bid.id ? { ...row, feed_source: 'usda_mars', feed_report_id: '2850', feed_geography: 'IA', feed_observation_key: 'k' } as typeof row : row) })
  await refused(() => repo.saveCashBid({ ...bid, basis: -0.1 }), 'USDA feed prices cannot be edited here.', 'editing a feed row')
}

// 9. What the mock refused that production accepts: blank optional text is "none", not an error.
await fresh()
{
  const rule: MarketingAlertRule = { id: uid(10), farm_id: fields.farm.id, crop_year: year, commodity_id: 'corn_yellow', operating_entity_id: null, enterprise_label: null, rule_type: 'deadline', direction: null, threshold: null, remind_on: `${year}-12-01`, message: '   ', active: true, last_triggered_at: null, created_at: `${today}T00:00:00.000Z`, updated_at: `${today}T00:00:00.000Z` }
  await repo.saveMarketingAlertRule(rule)
  assert((await data()).marketing_alert_rules.find((row) => row.id === uid(10))!.message === null, 'A blank alert message is stored as no message, as the live path stores it.')
  const offer: FirmOffer = { id: uid(11), farm_id: fields.farm.id, crop_year: year, commodity_id: 'corn_yellow', operating_entity_id: null, enterprise_label: null, buyer: ' Riverside ', offer_type: 'cash', bushels: 5000, price: 4.9, basis: null, contract_month: '  ', expires_on: null, delivery_location: ' ', notes: '', status: 'open', filled_contract_id: null, created_at: `${today}T00:00:00.000Z`, updated_at: `${today}T00:00:00.000Z` }
  await repo.saveFirmOffer(offer)
  const stored = (await data()).firm_offers.find((row) => row.id === uid(11))!
  assert(stored.contract_month === null && stored.delivery_location === null && stored.notes === null && stored.buyer === 'Riverside', 'Blank firm-offer fields are stored empty, and the buyer trimmed, as the live path stores them.')
  // And deleting what is not there says so, as the live delete does.
  await refused(() => repo.deleteMarketingAlertRule(uid(12)), DELETE_PERMISSION_MESSAGE, 'delete an alert rule that does not exist')
  await refused(() => repo.deleteFirmOffer(uid(13)), DELETE_PERMISSION_MESSAGE, 'delete a firm offer that does not exist')
}

// 10. Bin names are unique on a farm; a movement retry is compared on every column; a crop year is 1900-2200.
await fresh()
{
  const workspace = await data()
  const [north, south] = workspace.grain_bins
  await refused(() => repo.upsertGrainBin({ ...south!, name: ` ${north!.name} ` }), 'Another bin already has that name.', 'a second bin with the same name')
  const movement: BinTransaction = { id: uid(14), farm_id: fields.farm.id, grain_bin_id: north!.id, direction: 'in', bushels: 100, commodity_id: 'corn_yellow', crop_year: year, occurred_on: today, note: 'first', source_kind: 'manual entry', grain_load_id: null, created_at: `${today}T00:00:00.000Z` }
  await repo.appendBinTransaction(movement)
  await refused(() => repo.appendBinTransaction({ ...movement, note: 'second' }), 'Movement id was already used with different content.', 'a movement retry with a different note')
  await refused(() => repo.appendBinTransaction({ ...movement, id: uid(15), crop_year: 1800 }), /crop year/, 'a movement in crop year 1800')
}

// 11. Production estimates: a new one is saved, one per scope, and an enterprise scope is refused.
await fresh()
{
  const workspace = await data()
  const existing = workspace.production_estimates[0]!
  await repo.saveProductionEstimate({ ...existing, id: uid(16), crop_year: year + 1 })
  assert((await data()).production_estimates.some((row) => row.id === uid(16)), 'A new production estimate must be saved; it used to be dropped.')
  await refused(() => repo.saveProductionEstimate({ ...existing, id: uid(17) }), 'This crop already has a production estimate. Reload to see it.', 'a second estimate for one scope')
  await refused(() => repo.saveProductionEstimate({ ...existing, enterprise_label: 'North farm' }), /cannot verify acreage for this enterprise/, 'an enterprise-scoped estimate')
}

// 12. A sale limit cannot move onto another limit's scope, whatever order the rows are in, and a
//     carry grid needs the estimate it prices.
await fresh()
{
  const limit = (id: string, commodity_id: string) => ({ id, farm_id: fields.farm.id, crop_year: year, commodity_id, operating_entity_id: null, enterprise_label: null, sale_limit_bushels: 1000, created_at: `${today}T00:00:00.000Z`, updated_at: `${today}T00:00:00.000Z` })
  await repo.saveGrainSaleLimit(limit(uid(18), 'corn_yellow'))
  await repo.saveGrainSaleLimit(limit(uid(19), 'soybeans'))
  await refused(() => repo.saveGrainSaleLimit(limit(uid(18), 'soybeans')), 'This position already has a sale limit. Reload to see it.', 'move a sale limit onto another scope')
  const rows = Array.from({ length: 13 }, () => ({ market_price: null, basis: null }))
  await refused(() => repo.saveGrainCarryGrid({ id: uid(20), farm_id: fields.farm.id, production_estimate_id: uid(21), harvest_month: 9, default_basis: 0, rows, updated_at: `${today}T00:00:00.000Z` }), 'This production estimate is no longer available. Reload before trying again.', 'a carry grid for an estimate that does not exist')
}

// 13. A load's delivery effect is refused where the delivery would over-deliver its contract.
await fresh()
{
  const contract: GrainContract = (await data()).grain_contracts.find((row) => row.id === seed(603))!
  edit((grain) => { grain.grain_contract_deliveries = [{ id: uid(22), farm_id: fields.farm.id, grain_contract_id: contract.id, bushels: contract.bushels - 50, delivered_on: today, note: null, grain_load_id: null, created_at: `${today}T00:00:00.000Z` }] })
  const crop = fields.crop_assignments.find((row) => row.commodity_id === contract.commodity_id && row.crop_year === contract.crop_year)
  if (crop) {
    await refused(() => repo.saveLoad(uid(23), draft({ origin_kind: 'field', origin_crop_assignment_id: crop.id, destination_kind: 'contract', destination_buyer: '', destination_grain_contract_id: contract.id, net_bushels: '100', effect_contract_delivery: true })), 'Delivery would exceed the remaining contract bushels; confirm over-delivery to record it.', 'a load that over-delivers its contract')
    assert(!(await data()).grain_loads.some((row) => row.id === uid(23)), 'A refused load must not be saved.')
    // Confirmed by the farmer, the same load is recorded and the contract shows over-delivered, as
    // save_grain_load does when it passes allow_overdelivery through.
    await repo.saveLoad(uid(23), draft({ origin_kind: 'field', origin_crop_assignment_id: crop.id, destination_kind: 'contract', destination_buyer: '', destination_grain_contract_id: contract.id, net_bushels: '100', effect_contract_delivery: true, allow_overdelivery: true }))
    const delivered = (await data()).grain_contract_deliveries.filter((row) => row.grain_contract_id === contract.id).reduce((sum, row) => sum + row.bushels, 0)
    assert(delivered === contract.bushels + 50, `A confirmed over-delivery must be recorded (delivered ${delivered} of ${contract.bushels}).`)
  }
}

// 14. A void is refused -- as "blocked", changing nothing -- whenever a reversal would be refused.
await fresh()
{
  const north = (await data()).grain_bins[0]!
  const saved = await repo.saveLoad(uid(24), draft({ origin_grain_bin_id: north.id, net_bushels: '1000', effect_bin_out: true }))
  // Fill the bin to capacity after the load took 1,000 bushels out, so putting them back overfills it.
  const workspace = await data()
  const onHand = 27800 - 1000
  edit((grain) => { grain.bin_transactions = [{ id: uid(25), farm_id: fields.farm.id, grain_bin_id: north.id, direction: 'in', bushels: north.capacity_bu - onHand, commodity_id: 'corn_yellow', crop_year: year, occurred_on: today, note: null, source_kind: 'manual entry', grain_load_id: null, created_at: new Date(Date.now() + 1000).toISOString() }, ...grain.bin_transactions] })
  const result = await repo.voidLoad(saved.id, 'hauled from the wrong bin')
  assert(result.status === 'blocked' && result.reason === 'This movement would put more grain in the bin than it holds.', `A void that would overfill the bin must be blocked, not done: ${result.status} ${result.reason}`)
  const after = await data()
  assert(after.grain_loads.find((row) => row.id === saved.id)!.voided_at === null && after.bin_transactions.length === workspace.bin_transactions.length + 1, 'A blocked void must change nothing.')
  // With room again it voids, and the reversal is dated today, as the server dates it.
  edit((grain) => { grain.bin_transactions = grain.bin_transactions.filter((row) => row.id !== uid(25)) })
  const voided = await repo.voidLoad(saved.id, 'hauled from the wrong bin')
  const reversal = (await data()).bin_transactions.find((row) => row.grain_load_id === saved.id && row.source_kind === 'grain_load_void')
  assert(voided.status === 'voided' && reversal?.occurred_on === today, 'An allowed void reverses its movement dated today.')
}

// 15. The demo keeps its load tickets across a reload. readGrain projected every stored array but
//     grain_loads, so the first reload dropped them and the next save read an undefined list.
await fresh()
{
  const assignment = fields.crop_assignments.find((row) => row.commodity_id === 'corn_yellow' && row.crop_year === year) ?? fields.crop_assignments[0]!
  await repo.saveLoad(uid(90), draft({ origin_kind: 'field', origin_crop_assignment_id: assignment.id }))
  repo = new MockGrainRepository(fieldsRepository)
  const reloaded = await data()
  assert(Array.isArray(reloaded.grain_loads) && reloaded.grain_loads.some((row) => row.id === uid(90)), 'A saved load must survive a reload of the demo.')
  assert((await repo.listHarvestLoads()).complete, 'Harvest loads still list after a reload.')
}

// 16. The enterprise label rule is shared: every enterprise_label column takes nothing, or 1-160
//     characters once trimmed. It lived in the mock alone, so the live repository sent a label the
//     column refuses and learned of it from the database.
await fresh()
{
  assert(enterpriseLabelFits(null) && enterpriseLabelFits('x'.repeat(160)) && enterpriseLabelFits(' North farm '), 'A label the column accepts must fit.')
  assert(!enterpriseLabelFits('') && !enterpriseLabelFits('   ') && !enterpriseLabelFits('x'.repeat(161)), 'A label the column refuses must not fit.')
  const contract = (await data()).grain_contracts.find((row) => row.id === seed(601))!
  const commodities = new Set(fields.commodities.map((row) => row.id))
  assert(validateGrainContract({ ...contract, enterprise_label: 'x'.repeat(161) }, commodities).includes('Enterprise label must be 1 to 160 characters.'), 'The shared contract validator must refuse an over-long label.')
  assert(validateGrainContract({ ...contract, enterprise_label: 'x'.repeat(160) }, commodities).length === 0, 'The shared contract validator must accept a 160-character label.')
  await refused(() => repo.saveContract({ ...contract, id: uid(160), enterprise_label: 'x'.repeat(161) }), 'Enterprise label must be 1 to 160 characters.', 'a contract with an over-long enterprise label')
  assert(!(await data()).grain_contracts.some((row) => row.id === uid(160)), 'A refused label must save nothing.')
}

console.log('Mock grain refusal regressions passed (16 coverage groups).')
