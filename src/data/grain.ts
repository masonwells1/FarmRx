import type { Commodity, FieldsData } from './fields'

export type ProductionMathBasis = 'projected' | 'actual'
export type GrainContractType = 'cash_spot' | 'forward_cash' | 'basis' | 'hta'
export type GrainStorageLocationType = 'on_farm' | 'commercial'

export interface PositionScope {
  farm_id: string
  crop_year: number
  commodity_id: string
  operating_entity_id: string | null
  enterprise_label: string | null
}

/** The one join identity for every crop-year grain record. */
export function scopeKey(scope: PositionScope): string {
  return [scope.farm_id, scope.crop_year, scope.commodity_id, scope.operating_entity_id ?? '', scope.enterprise_label ?? ''].join('|')
}

export function scopeOf(row: PositionScope): PositionScope {
  return { farm_id: row.farm_id, crop_year: row.crop_year, commodity_id: row.commodity_id, operating_entity_id: row.operating_entity_id, enterprise_label: row.enterprise_label }
}

export const sameScope = (row: PositionScope, scope: PositionScope) => scopeKey(row) === scopeKey(scope)

export interface ProductionEstimate extends PositionScope {
  id: string
  planted_acres: number | null
  aph_yield: number
  expected_bushels: number
  actual_bushels: number | null
  drives_math: ProductionMathBasis
  notes: string | null
  created_at: string
  updated_at: string
}

export interface GrainContract extends PositionScope {
  id: string
  contract_type: GrainContractType
  buyer: string
  bushels: number
  futures_price: number | null
  basis: number | null
  cash_price: number | null
  delivery_start: string | null
  delivery_end: string | null
  contract_number: string | null
  premium_cents_per_bu: number
  notes: string | null
  created_at: string
  updated_at: string
}

export interface MarketingPlanTarget extends PositionScope {
  id: string
  target_month: string
  target_pct_of_production: number
  target_price: number | null
  breakeven_relative_pct: number | null
  deadline: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface InsuranceUnit extends PositionScope {
  id: string
  unit_name: string
  insured_acres: number
  aph: number
  coverage_level_pct: number
  revenue_guarantee_per_acre: number
  guarantee_per_bu: number
  notes: string | null
  created_at: string
  updated_at: string
}

export interface GrainBin { id: string; farm_id: string; name: string; capacity_bu: number; location_type: GrainStorageLocationType; location_name: string | null; notes: string | null; created_at: string; updated_at: string }
export interface BinInventory { id: string; farm_id: string; grain_bin_id: string; crop_year: number; commodity_id: string; bushels: number; committed_bushels: number; measured_at: string; notes: string | null; created_at: string; updated_at: string }
export interface CashBid { id: string; farm_id: string; elevator: string; commodity_id: string; bid_date: string; basis: number; cash_price: number | null; delivery_start: string | null; delivery_end: string | null; notes: string | null; created_at: string; updated_at: string }

/** Mirrors public.usda_report_dates in 0004_module2_grain.sql. */
export interface UsdaReportDate { id: string; report_name: string; report_date: string; release_at: string | null; source_url: string | null; notes: string | null; created_at: string; updated_at: string }

export interface FuturesQuote { symbol: 'ZC' | 'ZS' | 'ZW'; contract: string; label: string; price: number; crop_year: number; new_crop: boolean; delayed: true; as_of: string }
export interface MarketDataService { getQuotes(): Promise<FuturesQuote[]> }
export interface ProfitabilityRepository { getBreakeven(scope: PositionScope, fields: FieldsData): Promise<number | null> }

export interface GrainData { production_estimates: ProductionEstimate[]; grain_contracts: GrainContract[]; marketing_plan_targets: MarketingPlanTarget[]; insurance_units: InsuranceUnit[]; grain_bins: GrainBin[]; bin_inventory: BinInventory[]; cash_bids: CashBid[]; usda_report_dates: UsdaReportDate[] }
export interface GrainWorkspace extends GrainData { fields: FieldsData }
export interface GrainRepository {
  getData(): Promise<GrainWorkspace>
  saveProductionEstimate(estimate: ProductionEstimate): Promise<void>
  saveContract(contract: GrainContract): Promise<void>
  saveMarketingPlanTarget(target: MarketingPlanTarget): Promise<void>
  replaceMarketingPlanTargets(scope: PositionScope, targets: MarketingPlanTarget[]): Promise<void>
  saveCashBid(bid: CashBid): Promise<void>
}
export interface GrainServices { grainRepository: GrainRepository; marketDataService: MarketDataService; profitabilityRepository: ProfitabilityRepository; createGrainId: () => string }
export interface GrainContext { commodity: Commodity; data: GrainWorkspace }

const finite = (value: number | null) => value === null || Number.isFinite(value)
export function validateGrainContract(contract: GrainContract, commodityIds: Set<string>): string[] {
  const errors: string[] = []
  if (!Number.isInteger(contract.crop_year) || contract.crop_year < 1900 || contract.crop_year > 2200) errors.push('Crop year must be between 1900 and 2200.')
  if (!commodityIds.has(contract.commodity_id)) errors.push('Choose a valid commodity.')
  if (!Object.values<GrainContractType>({ cash_spot: 'cash_spot', forward_cash: 'forward_cash', basis: 'basis', hta: 'hta' }).includes(contract.contract_type)) errors.push('Choose a valid contract type.')
  if (contract.buyer.trim().length < 1 || contract.buyer.trim().length > 200) errors.push('Buyer is required and must be 200 characters or fewer.')
  if (!Number.isFinite(contract.bushels) || contract.bushels <= 0) errors.push('Bushels must be greater than zero.')
  if (!finite(contract.cash_price) || !finite(contract.futures_price) || !finite(contract.basis) || (contract.cash_price !== null && contract.cash_price < 0) || (contract.futures_price !== null && contract.futures_price < 0)) errors.push('Prices and basis must be finite; cash and futures prices cannot be negative.')
  if (!Number.isFinite(contract.premium_cents_per_bu) || contract.premium_cents_per_bu < 0) errors.push('Premium must be a finite value of zero or more cents per bushel.')
  if (contract.delivery_start && contract.delivery_end && contract.delivery_end < contract.delivery_start) errors.push('Delivery end must be on or after delivery start.')
  if ((contract.contract_type === 'cash_spot' || contract.contract_type === 'forward_cash') && contract.cash_price === null) errors.push('Cash and forward cash contracts require a cash price.')
  if (contract.contract_type === 'basis' && contract.basis === null) errors.push('Basis contracts require a basis.')
  if (contract.contract_type === 'hta' && contract.futures_price === null) errors.push('HTA contracts require a futures price.')
  return errors
}
