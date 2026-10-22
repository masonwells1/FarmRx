import assert from 'node:assert/strict'
import type { CashBid, GrainContract, GrainWorkspace } from './grain'
import { calculateGrainPosition, finalCashPrice } from './grainPosition'
import { cropYearBids, latestBasis } from './basisMath'

const farm = '00000000-0000-4000-8000-000000000001'
const base: GrainContract = { id: 'c1', farm_id: farm, crop_year: 2026, commodity_id: 'corn_yellow', operating_entity_id: null, enterprise_label: null, contract_type: 'hta', buyer: 'Elevator', bushels: 10000, futures_price: null, basis: null, cash_price: null, delivery_start: null, delivery_end: null, contract_number: null, premium_cents_per_bu: 0, notes: null, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' }
const near = (actual: number | null, expected: number, message: string) => assert.ok(actual !== null && Math.abs(actual - expected) < 1e-9, `${message}: expected ${expected}, got ${actual}`)

// A finished HTA exactly as finalize_contract_price_leg stores it: cash_price already includes the premium.
// $5.00 futures - $0.30 basis + 10¢ premium = $4.80, never $4.90.
const finishedHta = { ...base, futures_price: 5, basis: -0.3, premium_cents_per_bu: 10, cash_price: 4.8 }
near(finalCashPrice(finishedHta), 4.8, 'A finished HTA counts its premium once')
near(finalCashPrice({ ...finishedHta, contract_type: 'basis' }), 4.8, 'A finished basis contract counts its premium once')
near(calculateGrainPosition(10000, [finishedHta], 0, null).finalRevenue, 48000, 'Revenue on 10,000 bu is $48,000, not $49,000')
assert.equal(finalCashPrice({ ...base, futures_price: 5 }), null, 'An HTA with basis open is not fully priced')
assert.equal(finalCashPrice({ ...base, contract_type: 'basis', basis: -0.3 }), null, 'A basis contract with futures open is not fully priced')
// A cash or purchase (forward cash) contract's cash price is the elevator's price; the premium is on top of it.
near(finalCashPrice({ ...base, contract_type: 'forward_cash', cash_price: 4.5, premium_cents_per_bu: 5 }), 4.55, 'A forward cash contract adds its premium to the cash price')
near(finalCashPrice({ ...base, contract_type: 'cash_spot', cash_price: 4.5 }), 4.5, 'A spot sale is its cash price')

// All grain under basis contracts with futures open: nothing is fully priced and nothing is outside a contract.
const allBasis = calculateGrainPosition(10000, [{ ...base, contract_type: 'basis', basis: -0.3 }], 0, null)
assert.equal(allBasis.finalBushels, 0, 'Nothing is fully priced')
assert.equal(allBasis.partiallyPricedBushels, 10000, 'Every bushel is partly priced')
assert.equal(allBasis.outrightOpen, 0, 'No bushels are outside a contract')

// Bids are matched to the crop year they can speak for.
const bid = (id: string, bidDate: string, basis: number, deliveryStart: string | null = null, deliveryEnd: string | null = null): CashBid => ({ id, farm_id: farm, elevator: 'Elevator', commodity_id: 'corn_yellow', bid_date: bidDate, basis, cash_price: null, delivery_start: deliveryStart, delivery_end: deliveryEnd, notes: null, feed_source: null, feed_report_id: null, feed_geography: null, created_at: `${bidDate}T12:00:00Z`, updated_at: `${bidDate}T12:00:00Z` })
const workspace = (cashBids: CashBid[]) => ({ cash_bids: cashBids, fields: { commodities: [{ id: 'corn_yellow', name: 'Yellow Corn', crop_family: 'corn', marketing_year_start_month: 9, marketing_year_start_day: 1 }] } }) as unknown as GrainWorkspace
const scope = (cropYear: number) => ({ farm_id: farm, crop_year: cropYear, commodity_id: 'corn_yellow', operating_entity_id: null, enterprise_label: null })
const spotOct2026 = bid('b-spot', '2026-10-15', -0.4)
const newCropNov2027 = bid('b-new', '2026-10-14', -0.25, '2027-11-01', '2027-11-30')
const both = workspace([spotOct2026, newCropNov2027])
assert.equal(latestBasis(both, scope(2026)), -0.4, "An October 2026 spot bid is the 2026 crop's basis")
assert.equal(latestBasis(both, scope(2027)), -0.25, "A November 2027 delivery bid is the 2027 crop's basis, not today's spot")
assert.equal(latestBasis(workspace([spotOct2026]), scope(2027)), 0, 'With no 2027-crop bid, a 2027 HTA gets no basis from the 2026 crop')
// Same day, two bids: the one entered later wins, every time.
const morning = { ...bid('b-a', '2026-10-15', -0.4), created_at: '2026-10-15T08:00:00Z' }
const afternoon = { ...bid('a-b', '2026-10-15', -0.35), created_at: '2026-10-15T15:00:00Z' }
assert.equal(cropYearBids(workspace([morning, afternoon]), scope(2026))[0].id, 'a-b', 'The later entry on the same day is the latest bid')
// USDA feed rows are never the farm's own bid.
assert.equal(latestBasis(workspace([{ ...spotOct2026, feed_source: 'usda_mars' }]), scope(2026)), 0, 'A USDA feed row is never used as basis')

console.log('grainPosition regression: ok')
