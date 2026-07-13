import type { FirmOffer, GrainWorkspace } from './grain'
import { displayFirmOfferStatus, offerToContract, pendingFirmOfferBushels, validateFirmOffer } from './firmOffers'
import { GrainWriteQueue } from './grainWriteQueue'
import type { StorageLike } from './writeQueue'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const stamp = '2026-07-13T12:00:00.000Z'; const farm = '00000000-0000-4000-8000-000000000001'; const id = '00000000-0000-4000-8000-000000000002'
const base: FirmOffer = { id, farm_id: farm, crop_year: 2026, commodity_id: 'corn', operating_entity_id: null, enterprise_label: null, buyer: 'Local elevator', offer_type: 'cash', bushels: 12000, price: 4.5, basis: null, contract_month: '2026-12', expires_on: '2026-07-13', delivery_location: 'Main elevator', notes: 'Call first', status: 'open', filled_contract_id: null, created_at: stamp, updated_at: stamp }

// DB firm_offers_price_by_type: cash and HTA require price; basis requires basis.
assert(validateFirmOffer(base).length === 0, 'A complete cash offer must pass the DB-matching validation.')
assert(validateFirmOffer({ ...base, offer_type: 'cash', price: null }).some((x) => x.includes('Cash offers')), 'Cash without price must be blocked before write.')
assert(validateFirmOffer({ ...base, offer_type: 'basis', price: null, basis: -0.2 }).length === 0, 'Basis with a signed basis must pass.')
assert(validateFirmOffer({ ...base, offer_type: 'basis', basis: null }).some((x) => x.includes('Basis offers')), 'Basis without basis must be blocked before write.')
assert(validateFirmOffer({ ...base, offer_type: 'hta', price: 4.72, basis: null }).length === 0, 'HTA with futures price must pass.')
assert(validateFirmOffer({ ...base, offer_type: 'hta', price: null }).some((x) => x.includes('HTA offers')), 'HTA without price must be blocked before write.')
assert(validateFirmOffer({ ...base, status: 'open', filled_contract_id: id }).some((x) => x.includes('linked contract')), 'A linked contract must require filled status.')
assert(validateFirmOffer({ ...base, expires_on: '' }).some((x) => x.includes('Expiration date')), 'A blank-string expiration date must be blocked before write.')
assert(validateFirmOffer({ ...base, expires_on: '2026-02-31' }).some((x) => x.includes('Expiration date')), 'An impossible calendar expiration date must be blocked before write.')

assert(displayFirmOfferStatus(base, new Date('2026-07-13T23:59:00')) === 'open', 'An offer expiring today must remain open on the device calendar.')
assert(displayFirmOfferStatus({ ...base, expires_on: '2026-07-12' }, new Date('2026-07-13T00:01:00')) === 'expired', 'An offer expiring yesterday must display expired.')
const workspace = { firm_offers: [base, { ...base, id: '00000000-0000-4000-8000-000000000003', bushels: 5000, status: 'filled', filled_contract_id: id }, { ...base, id: '00000000-0000-4000-8000-000000000004', bushels: 3000, expires_on: '2026-07-12' }, { ...base, id: '00000000-0000-4000-8000-000000000005', bushels: 2000, status: 'canceled' }] } as GrainWorkspace
assert(pendingFirmOfferBushels(workspace, base, new Date('2026-07-13T12:00:00')) === 12000, 'Pending math must exclude filled, expired, and canceled offer bushels.')
const contractId = '00000000-0000-4000-8000-000000000010'
const fillCases: Array<{ name: string; offer: FirmOffer; contractType: 'cash_spot' | 'basis' | 'hta'; cash: number | null; futures: number | null; basis: number | null; start: string | null; end: string | null }> = [
  { name: 'cash month', offer: { ...base, offer_type: 'cash', price: 4.5, basis: null, contract_month: '2026-12' }, contractType: 'cash_spot', cash: 4.5, futures: null, basis: null, start: '2026-12-01', end: '2026-12-31' },
  { name: 'basis month', offer: { ...base, offer_type: 'basis', price: null, basis: -0.18, contract_month: '2026-02' }, contractType: 'basis', cash: null, futures: null, basis: -0.18, start: '2026-02-01', end: '2026-02-28' },
  { name: 'hta month', offer: { ...base, offer_type: 'hta', price: 4.72, basis: null, contract_month: '2028-02' }, contractType: 'hta', cash: null, futures: 4.72, basis: null, start: '2028-02-01', end: '2028-02-29' },
  { name: 'blank month', offer: { ...base, contract_month: null }, contractType: 'cash_spot', cash: 4.5, futures: null, basis: null, start: null, end: null },
]
for (const testCase of fillCases) {
  const contract = offerToContract(testCase.offer, contractId, stamp)
  assert(contract.contract_type === testCase.contractType && contract.cash_price === testCase.cash && contract.futures_price === testCase.futures && contract.basis === testCase.basis && contract.delivery_start === testCase.start && contract.delivery_end === testCase.end && contract.bushels === 12000 && contract.buyer === 'Local elevator' && contract.notes?.includes('Main elevator'), `Fill mapping failed for ${testCase.name}.`)
}

class MemoryStorage implements StorageLike { private readonly values = new Map<string, string>(); getItem(key: string) { return this.values.get(key) ?? null }; setItem(key: string, value: string) { this.values.set(key, value) }; removeItem(key: string) { this.values.delete(key) } }
const queue = new GrainWriteQueue(new MemoryStorage(), 'firm-offer-replay')
queue.append({ version: 1, module: 'grain', kind: 'saveFirmOffer', operationId: '00000000-0000-4000-8000-000000000011', userId: '00000000-0000-4000-8000-000000000012', farmId: farm, enqueuedAt: stamp, row: base })
const queuedOffer = queue.read().entries[0]
assert(queuedOffer?.kind === 'saveFirmOffer' && queuedOffer.row.id === base.id && queuedOffer.row.expires_on === base.expires_on, 'A valid firm-offer save must survive queue serialization for replay.')
queue.removeConfirmedHead(queuedOffer.operationId)
assert(queue.read().entries.length === 0, 'A confirmed firm-offer replay must remove only its queue entry.')
console.log('Firm offer regressions passed.')
