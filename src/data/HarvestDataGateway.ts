import type { HarvestDraft } from './harvest'

export interface HarvestDataGateway {
  loadViewerRole(farmId: string, userId: string): Promise<unknown>
  saveHarvest(input: { farmId: string; operationId: string; entry: HarvestDraft }): Promise<unknown>
}
