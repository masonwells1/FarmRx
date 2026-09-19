import type { FarmOperationContext } from './farmOperationContext'
import { isMarketRegion, type FarmMarketRegionInput, type FarmSettingsGateway, type FarmSettingsRepository } from './farmSettings'
import { mapFarm } from './SupabaseFieldsRepository'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/

type Dependencies = {
  gateway: FarmSettingsGateway
  getOperationContext(): Promise<FarmOperationContext>
  verifyOperationContext(expected: FarmOperationContext): Promise<void>
  isOffline(): boolean
}

function validateInput(input: FarmMarketRegionInput) {
  if (!uuid.test(input.farmId) || (input.marketRegion !== null && !isMarketRegion(input.marketRegion)) || !timestamp.test(input.expectedUpdatedAt) || Number.isNaN(Date.parse(input.expectedUpdatedAt))) {
    throw new Error('Farm Rx could not prepare this market region change. Reload the farm and try again.')
  }
}

/** The farm's market region: written online only, against the captured context, and confirmed from the returned row. */
export class SupabaseFarmSettingsRepository implements FarmSettingsRepository {
  constructor(private readonly dependencies: Dependencies) {}

  async updateMarketRegion(input: FarmMarketRegionInput) {
    validateInput(input)
    if (this.dependencies.isOffline()) throw new Error('Connect to the internet to change your market region.')
    const context = await this.dependencies.getOperationContext()
    if (context.farmId !== input.farmId) throw new Error('The selected farm changed before this market region could be saved.')
    await this.dependencies.verifyOperationContext(context)
    const raw = await this.dependencies.gateway.updateFarmMarketRegion(input, context)
    await this.dependencies.verifyOperationContext(context)
    const saved = mapFarm(raw)
    if (saved.id !== input.farmId || (saved.market_region ?? null) !== input.marketRegion || saved.updated_at === input.expectedUpdatedAt || !timestamp.test(saved.updated_at) || Number.isNaN(Date.parse(saved.updated_at))) {
      throw new Error('Farm Rx could not confirm this market region. Check the current setting before trying again.')
    }
    return saved
  }
}
