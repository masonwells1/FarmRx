import type { BinTransaction, CashBid, FirmOffer, GrainAlertSettings, GrainBin, GrainCapabilities, GrainCarryGrid, GrainCarrySettings, GrainContract, GrainContractCorrection, GrainContractDelivery, GrainLoadDraft, GrainSaleLimit, MarketingAlertRule, MarketingPlanTarget, PositionScope, ProductionEstimate } from './grain'
import type { FarmOperationContext } from './farmOperationContext'

/** The network boundary deliberately exposes untrusted rows only. */
export interface GrainRowBundle {
  production_estimates: unknown[]
  grain_contracts: unknown[]
  grain_contract_deliveries: unknown[]
  grain_loads: unknown[]
  marketing_plan_targets: unknown[]
  insurance_units: unknown[]
  grain_bins: unknown[]
  bin_inventory: unknown[]
  bin_transactions: unknown[]
  cash_bids: unknown[]
  usda_report_dates: unknown[]
  usda_market_reports: unknown[]
  marketing_alert_rules: unknown[]
  firm_offers: unknown[]
  grain_alert_settings: unknown | null
  grain_sale_limits: unknown[]
  grain_carry_settings: unknown | null
  grain_carry_grids: unknown[]
  capabilities?: GrainCapabilities
}

export interface ReplaceMarketingPlanInput { farmId: string; scope: PositionScope; targets: MarketingPlanTarget[]; context: FarmOperationContext }
export interface GrainDataGateway {
  loadWorkspace(farmId: string): Promise<GrainRowBundle>
  upsertProductionEstimate(farmId: string, row: ProductionEstimate, context: FarmOperationContext): Promise<unknown>
  updateProductionActual(farmId: string, id: string, actualBushels: number, expectedUpdatedAt: string, context: FarmOperationContext): Promise<unknown>
  upsertContract(farmId: string, row: GrainContract, context: FarmOperationContext): Promise<unknown>
  replaceMarketingPlan(input: ReplaceMarketingPlanInput): Promise<unknown[]>
  upsertCashBid(farmId: string, row: CashBid, context: FarmOperationContext): Promise<unknown>
  upsertMarketingAlertRule(farmId: string, row: MarketingAlertRule, context: FarmOperationContext): Promise<unknown>
  deleteMarketingAlertRule(farmId: string, id: string, context: FarmOperationContext): Promise<void>
  upsertFirmOffer(farmId: string, row: FirmOffer, context: FarmOperationContext): Promise<unknown>
  fillFirmOffer(farmId: string, offerId: string, contract: GrainContract, context: FarmOperationContext): Promise<unknown>
  deleteFirmOffer(farmId: string, id: string, context: FarmOperationContext): Promise<void>
  upsertGrainBin(farmId: string, row: GrainBin, context: FarmOperationContext): Promise<unknown>
  appendBinTransactionRpc?(farmId: string, row: BinTransaction, context: FarmOperationContext): Promise<unknown>
  appendContractDeliveryRpc?(farmId: string, row: GrainContractDelivery, allowOverdelivery: boolean, context: FarmOperationContext): Promise<unknown>
  finalizeContractPriceLegRpc?(farmId: string, contractId: string, leg: 'futures_price' | 'basis', value: number, context: FarmOperationContext): Promise<unknown>
  editContractRpc?(farmId: string, contractId: string, reason: string, changes: GrainContractCorrection, expectedUpdatedAt: string, operationId: string, context: FarmOperationContext): Promise<unknown>
  deleteContractRpc?(farmId: string, contractId: string, reason: string, expectedUpdatedAt: string, operationId: string, context: FarmOperationContext): Promise<unknown>
  listBinLots?(farmId: string, binId: string, context: FarmOperationContext): Promise<unknown[]>
  listLoadTrucks?(farmId: string, context: FarmOperationContext): Promise<unknown[]>
  listHarvestLoads?(farmId: string, context: FarmOperationContext): Promise<unknown[]>
  assignBinMovementCropYearRpc?(farmId: string, transactionId: string, cropYear: number, context: FarmOperationContext): Promise<unknown>
  saveGrainLoadRpc?(farmId: string, id: string, draft: GrainLoadDraft, context: FarmOperationContext): Promise<unknown>
  voidGrainLoadRpc?(farmId: string, loadId: string, reason: string, context: FarmOperationContext): Promise<unknown>
  upsertGrainAlertSettings(farmId: string, row: GrainAlertSettings, context: FarmOperationContext): Promise<unknown>
  upsertGrainSaleLimit(farmId: string, row: GrainSaleLimit, context: FarmOperationContext): Promise<unknown>
  upsertGrainCarrySettings(farmId: string, row: GrainCarrySettings, context: FarmOperationContext): Promise<unknown>
  upsertGrainCarryGrid(farmId: string, row: GrainCarryGrid, context: FarmOperationContext): Promise<unknown>
}
