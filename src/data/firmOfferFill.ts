import type { FirmOffer, FirmOfferFill, GrainContract, GrainRepository } from './grain'
import { localCalendarDay } from './marketingAlerts'

export const FIRM_OFFER_FILL_PARTIAL_SUCCESS = 'FIRM_OFFER_FILL_PARTIAL_SUCCESS'

/** A namespaced SHA-256 UUID keeps fallback contracts distinct from ordinary IDs. */
export async function firmOfferContractId(offer: FirmOffer): Promise<string> {
  const bytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(`farm-rx:firm-offer-fill:${offer.id}`)))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes.subarray(0, 16), (value) => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function belongsToOffer(contract: GrainContract, offer: FirmOffer) {
  return contract.farm_id === offer.farm_id && contract.crop_year === offer.crop_year && contract.commodity_id === offer.commodity_id
}

export async function fillFirmOfferFallback(repository: Pick<GrainRepository, 'getData' | 'saveContract' | 'saveFirmOffer'>, offer: FirmOffer, draft: GrainContract, now = new Date()): Promise<FirmOfferFill> {
  const current = await repository.getData()
  const currentOffer = current.firm_offers.find((row) => row.id === offer.id)
  const contractId = await firmOfferContractId(offer)
  const existing = current.grain_contracts.find((row) => row.id === contractId)
  if (!currentOffer) throw new Error('This firm offer is no longer available. Reload before trying again.')
  if (existing && !belongsToOffer(existing, currentOffer)) throw new Error('A different contract already uses this record — review your contracts before filling this offer.')
  if (currentOffer.expires_on !== null && currentOffer.expires_on < localCalendarDay(now)) throw new Error('This firm offer has expired and cannot be filled.')
  if (currentOffer.status !== 'open' || currentOffer.filled_contract_id) {
    if (existing) return { contract: existing, offer: currentOffer }
    throw new Error('This firm offer is no longer open. No second sale was created. Reload before trying again.')
  }
  const contract = existing ?? { ...draft, id: contractId }
  if (!existing) await repository.saveContract(contract)
  const filled: FirmOffer = { ...currentOffer, status: 'filled', filled_contract_id: contractId, updated_at: now.toISOString() }
  try {
    await repository.saveFirmOffer(filled)
  } catch (error) {
    throw new Error(FIRM_OFFER_FILL_PARTIAL_SUCCESS, { cause: error })
  }
  return { contract, offer: filled }
}
