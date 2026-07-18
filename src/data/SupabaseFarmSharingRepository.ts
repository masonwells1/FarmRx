import type { FarmOperationContext } from './farmOperationContext'
import type { FarmSharingGateway, FarmSharingInput, FarmSharingRepository } from './farmSharing'
import { mapFarm } from './SupabaseFieldsRepository'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const timestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/

type Dependencies = {
  gateway: FarmSharingGateway
  getOperationContext(): Promise<FarmOperationContext>
  verifyOperationContext(expected: FarmOperationContext): Promise<void>
  isOffline(): boolean
}

function validateInput(input: FarmSharingInput) {
  if (!uuid.test(input.farmId) || typeof input.shareWithRep !== 'boolean' || !timestamp.test(input.expectedUpdatedAt) || Number.isNaN(Date.parse(input.expectedUpdatedAt))) {
    throw new Error('Farm Rx could not prepare this privacy change. Reload the farm and try again.')
  }
}

export class SupabaseFarmSharingRepository implements FarmSharingRepository {
  constructor(private readonly dependencies: Dependencies) {}

  async updateShareWithRep(input: FarmSharingInput) {
    validateInput(input)
    if (this.dependencies.isOffline()) throw new Error('Connect to the internet to change who can see your grain position.')
    const context = await this.dependencies.getOperationContext()
    if (context.farmId !== input.farmId) throw new Error('The selected farm changed before this privacy setting could be saved.')
    await this.dependencies.verifyOperationContext(context)
    const raw = await this.dependencies.gateway.updateFarmSharing(input, context)
    await this.dependencies.verifyOperationContext(context)
    const saved = mapFarm(raw)
    if (saved.id !== input.farmId || saved.share_with_rep !== input.shareWithRep || saved.updated_at === input.expectedUpdatedAt || !timestamp.test(saved.updated_at) || Number.isNaN(Date.parse(saved.updated_at))) {
      throw new Error('Farm Rx could not confirm this privacy setting. Check the current setting before trying again.')
    }
    return saved
  }
}
