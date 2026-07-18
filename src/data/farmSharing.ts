import type { FarmOperationContext } from './farmOperationContext'
import type { Farm } from './fields'

export interface FarmSharingInput {
  farmId: string
  shareWithRep: boolean
  expectedUpdatedAt: string
}

export interface FarmSharingGateway {
  updateFarmSharing(input: FarmSharingInput, context: FarmOperationContext): Promise<unknown>
}

export interface FarmSharingRepository {
  updateShareWithRep(input: FarmSharingInput): Promise<Farm>
}
