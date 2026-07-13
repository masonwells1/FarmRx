import type { FirmOffer, GrainContract, GrainWorkspace, PositionScope } from './grain'
import { sameScope } from './grain'
import { localCalendarDay } from './marketingAlerts'

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function deliveryWindow(contractMonth: string | null): { start: string | null; end: string | null } {
  const match = /^(\d{4})-(\d{2})$/.exec(contractMonth ?? '')
  if (!match) return { start: null, end: null }
  const year = Number(match[1]); const month = Number(match[2])
  if (month < 1 || month > 12) return { start: null, end: null }
  const first = new Date(Date.UTC(year, month - 1, 1)); const last = new Date(Date.UTC(year, month, 0))
  if (first.getUTCFullYear() !== year || first.getUTCMonth() !== month - 1) return { start: null, end: null }
  return { start: first.toISOString().slice(0, 10), end: last.toISOString().slice(0, 10) }
}

/** Mirrors public.firm_offers checks before a row is sent or queued. */
export function validateFirmOffer(value: FirmOffer): string[] {
  const errors: string[] = []
  if (!Number.isInteger(value.crop_year) || value.crop_year < 1900 || value.crop_year > 2200) errors.push('Choose a valid crop year.')
  if (!value.commodity_id.trim()) errors.push('Choose a commodity.')
  if (value.enterprise_label !== null && (value.enterprise_label.trim().length < 1 || value.enterprise_label.trim().length > 160)) errors.push('Enterprise name must be 1 to 160 characters when present.')
  if (value.buyer.trim().length < 1 || value.buyer.trim().length > 200) errors.push('Buyer is required and must be 200 characters or fewer.')
  if (!['cash', 'basis', 'hta'].includes(value.offer_type)) errors.push('Choose cash price, basis, or HTA.')
  if (!Number.isFinite(value.bushels) || value.bushels <= 0) errors.push('Bushels must be greater than zero.')
  if (value.price !== null && (!Number.isFinite(value.price) || value.price < 0)) errors.push('Price must be zero or more.')
  if (value.basis !== null && !Number.isFinite(value.basis)) errors.push('Basis must be a valid number.')
  if (value.offer_type === 'cash' && value.price === null) errors.push('Cash offers need a cash price per bushel.')
  if (value.offer_type === 'basis' && value.basis === null) errors.push('Basis offers need a basis per bushel.')
  if (value.offer_type === 'hta' && value.price === null) errors.push('HTA offers need a futures price per bushel.')
  if (value.contract_month !== null && (value.contract_month.trim().length < 1 || value.contract_month.trim().length > 80)) errors.push('Contract month must be 1 to 80 characters when present.')
  if (value.expires_on !== null && !isCalendarDate(value.expires_on)) errors.push('Expiration date must be a real calendar date (YYYY-MM-DD) or left blank.')
  if (value.delivery_location !== null && (value.delivery_location.trim().length < 1 || value.delivery_location.trim().length > 200)) errors.push('Delivery location must be 1 to 200 characters when present.')
  if (value.notes !== null && (value.notes.trim().length < 1 || value.notes.trim().length > 4000)) errors.push('Note must be 1 to 4,000 characters when present.')
  if (!['open', 'filled', 'expired', 'canceled'].includes(value.status)) errors.push('Choose a valid offer status.')
  if (value.filled_contract_id !== null && value.status !== 'filled') errors.push('A linked contract requires the offer to be marked filled.')
  return errors
}

/** Display only: an open row past the farmer device's local calendar day is expired. */
export function displayFirmOfferStatus(offer: FirmOffer, now = new Date()): FirmOffer['status'] {
  return offer.status === 'open' && offer.expires_on !== null && offer.expires_on < localCalendarDay(now) ? 'expired' : offer.status
}

export function pendingFirmOfferBushels(workspace: GrainWorkspace, scope?: PositionScope, now = new Date()): number {
  return workspace.firm_offers.filter((offer) => displayFirmOfferStatus(offer, now) === 'open' && (!scope || sameScope(offer, scope))).reduce((total, offer) => total + offer.bushels, 0)
}

export function offerToContract(offer: FirmOffer, id: string, timestamp: string): GrainContract {
  const delivery = deliveryWindow(offer.contract_month)
  const locationNote = offer.delivery_location ? `Delivery location: ${offer.delivery_location}` : null
  const note = [locationNote, offer.notes].filter((item): item is string => !!item).join('\n') || null
  return { id, farm_id: offer.farm_id, crop_year: offer.crop_year, commodity_id: offer.commodity_id, operating_entity_id: offer.operating_entity_id, enterprise_label: offer.enterprise_label, contract_type: offer.offer_type === 'cash' ? 'cash_spot' : offer.offer_type, buyer: offer.buyer, bushels: offer.bushels, cash_price: offer.offer_type === 'cash' ? offer.price : null, futures_price: offer.offer_type === 'hta' ? offer.price : null, basis: offer.offer_type === 'basis' ? offer.basis : null, delivery_start: delivery.start, delivery_end: delivery.end, contract_number: null, premium_cents_per_bu: 0, notes: note, created_at: timestamp, updated_at: timestamp }
}
