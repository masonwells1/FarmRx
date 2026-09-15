import type { FarmOperationContext } from './farmOperationContext'
import type { Farm } from './fields'

// GL-1: the farm's market region, the one setting that lets the USDA MARS basis feed reach
// a farm. It is set explicitly by an owner or manager, has no default, and is never inferred
// from field states or addresses. The write mirrors the privacy toggle: online only, the
// captured operation context verified before and after, the returned row confirmed.

/** US state codes the market region may hold, with the names the picker shows. Mirrors farms_market_region_valid. */
export const MARKET_REGIONS: ReadonlyArray<{ code: string; name: string }> = Object.freeze([
  { code: 'AL', name: 'Alabama' }, { code: 'AK', name: 'Alaska' }, { code: 'AZ', name: 'Arizona' }, { code: 'AR', name: 'Arkansas' }, { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' }, { code: 'CT', name: 'Connecticut' }, { code: 'DE', name: 'Delaware' }, { code: 'DC', name: 'District of Columbia' }, { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' }, { code: 'HI', name: 'Hawaii' }, { code: 'ID', name: 'Idaho' }, { code: 'IL', name: 'Illinois' }, { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' }, { code: 'KS', name: 'Kansas' }, { code: 'KY', name: 'Kentucky' }, { code: 'LA', name: 'Louisiana' }, { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' }, { code: 'MA', name: 'Massachusetts' }, { code: 'MI', name: 'Michigan' }, { code: 'MN', name: 'Minnesota' }, { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' }, { code: 'MT', name: 'Montana' }, { code: 'NE', name: 'Nebraska' }, { code: 'NV', name: 'Nevada' }, { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' }, { code: 'NM', name: 'New Mexico' }, { code: 'NY', name: 'New York' }, { code: 'NC', name: 'North Carolina' }, { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' }, { code: 'OK', name: 'Oklahoma' }, { code: 'OR', name: 'Oregon' }, { code: 'PA', name: 'Pennsylvania' }, { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' }, { code: 'SD', name: 'South Dakota' }, { code: 'TN', name: 'Tennessee' }, { code: 'TX', name: 'Texas' }, { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' }, { code: 'VA', name: 'Virginia' }, { code: 'WA', name: 'Washington' }, { code: 'WV', name: 'West Virginia' }, { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
])

export const isMarketRegion = (value: unknown): value is string => typeof value === 'string' && MARKET_REGIONS.some((region) => region.code === value)

export const marketRegionName = (code: string | null | undefined): string | null => MARKET_REGIONS.find((region) => region.code === code)?.name ?? null

export interface FarmMarketRegionInput {
  farmId: string
  /** A state code from MARKET_REGIONS, or null to clear the setting (no feed). */
  marketRegion: string | null
  expectedUpdatedAt: string
}

export interface FarmSettingsGateway {
  updateFarmMarketRegion(input: FarmMarketRegionInput, context: FarmOperationContext): Promise<unknown>
}

export interface FarmSettingsRepository {
  updateMarketRegion(input: FarmMarketRegionInput): Promise<Farm>
}
