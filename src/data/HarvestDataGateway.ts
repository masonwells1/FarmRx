import type { HarvestDraft } from './harvest'
import type { FarmOperationContext } from './farmOperationContext'

export interface HarvestDataGateway {
  loadViewerRole(farmId: string, userId: string): Promise<unknown>
  saveHarvest(input: { farmId: string; operationId: string; entry: HarvestDraft }, context: FarmOperationContext): Promise<unknown>
}
