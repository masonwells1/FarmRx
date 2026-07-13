import type { CashBid, FirmOffer, GrainAlertSettings, GrainContract, MarketingAlertRule, MarketingPlanTarget, PositionScope, ProductionEstimate } from './grain'

/** The network boundary deliberately exposes untrusted rows only. */
export interface GrainRowBundle {
  production_estimates: unknown[]
  grain_contracts: unknown[]
  marketing_plan_targets: unknown[]
  insurance_units: unknown[]
  grain_bins: unknown[]
  bin_inventory: unknown[]
  cash_bids: unknown[]
  usda_report_dates: unknown[]
  marketing_alert_rules: unknown[]
  firm_offers: unknown[]
  grain_alert_settings: unknown | null
}

export interface ReplaceMarketingPlanInput { farmId: string; scope: PositionScope; targets: MarketingPlanTarget[] }
export interface GrainDataGateway {
  loadWorkspace(farmId: string): Promise<GrainRowBundle>
  upsertProductionEstimate(farmId: string, row: ProductionEstimate): Promise<unknown>
  upsertContract(farmId: string, row: GrainContract): Promise<unknown>
  replaceMarketingPlan(input: ReplaceMarketingPlanInput): Promise<unknown[]>
  upsertCashBid(farmId: string, row: CashBid): Promise<unknown>
  upsertMarketingAlertRule(farmId: string, row: MarketingAlertRule): Promise<unknown>
  deleteMarketingAlertRule(farmId: string, id: string): Promise<void>
  upsertFirmOffer(farmId: string, row: FirmOffer): Promise<unknown>
  deleteFirmOffer(farmId: string, id: string): Promise<void>
  upsertGrainAlertSettings(farmId: string, row: GrainAlertSettings): Promise<unknown>
}
