import { farmCalendarDate } from './farmDates'
import type { Commodity, FieldsData, ReadOnlySnapshot } from './fields'
import type { FarmOperationContext } from './farmOperationContext'
import type { ProfitabilityRepository } from './profitability'

export type ProductionMathBasis = 'projected' | 'actual'
export type GrainContractType = 'cash_spot' | 'forward_cash' | 'basis' | 'hta'
export type GrainStorageLocationType = 'on_farm' | 'commercial'
export type MarketingAlertRuleType = 'price_target' | 'pct_marketed_goal' | 'deadline'
export type MarketingAlertDirection = 'at_or_above' | 'at_or_below'
export type FirmOfferType = 'cash' | 'basis' | 'hta'
export type FirmOfferStatus = 'open' | 'filled' | 'expired' | 'canceled'
export type BinTransactionDirection = 'in' | 'out'
/** Matches the tiny rounding allowance enforced by the plan RPC. */
export const MARKETING_PLAN_PERCENT_TOLERANCE = 100.000001

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
export interface GrainContractDelivery { id: string; farm_id: string; grain_contract_id: string; bushels: number; delivered_on: string; note: string | null; created_at: string; allow_overdelivery?: boolean }
export interface GrainCapabilities { bin_movements: boolean; contract_price_finalization: boolean; contract_deliveries: boolean; /** False until the slice-3 tables exist on the live database; the screens then keep their session-only behavior. */ persisted_settings?: boolean;
  /** GL-2: false until the live database carries the crop-year eligibility rule. A merge deploys this
   * client to production on its own, while applying the migration is a separate owner action, so the
   * two are guaranteed to be out of step for a while. In that window the browser and the sweep judge a
   * bid by different rules, and both write alert_rule_states -- which re-fires or suppresses the same
   * alert over and over. While this is false the browser records no transition at all and leaves the
   * rule state entirely to the sweep, which is exactly what the pre-GL-2 sweep expects. */
  gl2_alert_eligibility?: boolean;
  /** GL-3b: false until the live database carries the contract-repair RPCs and their audit table.
   * The same merge-before-migration window as above: while this is false the Contracts tab offers no
   * Correct or Delete control at all, rather than offering one that fails on the farmer's first try. */
  contract_edit_delete?: boolean }

/** GL-3b: the fields a contract correction may change. An absent key keeps the stored value; an
 * explicit null clears a nullable one. Crop year, commodity, contract type and every pricing column
 * are absent by design -- they are the contract's identity and its math, and pricing on a basis or
 * HTA contract belongs to the one-shot finalization rule. A farmer who got one of those wrong
 * deletes the contract with a reason and enters it again. */
export interface GrainContractCorrection {
  buyer?: string
  bushels?: number
  delivery_start?: string | null
  delivery_end?: string | null
  contract_number?: string | null
  notes?: string | null
}

/** The one message for "the GL-3b migration is not applied yet". The screens hide the controls when
 * the capability is false, so a farmer should never see it; it exists for the window between that
 * read and a click, and for a client that loaded before the capability was known. */
export const CONTRACT_REPAIR_PENDING = 'Correcting a contract arrives with the next database update.'

/** GL-3b: a contract with any delivery recorded against it is history, not a draft. The same test the
 * server applies under a row lock, so the screen offers a control the database will honour. */
export function contractIsCorrectable(workspace: Pick<GrainWorkspace, 'grain_contract_deliveries'>, contractId: string): boolean {
  return !workspace.grain_contract_deliveries.some((delivery) => delivery.grain_contract_id === contractId)
}

/** GL-3b: what the farmer actually changed, and nothing else. Sending every field the form holds
 * would make a buyer correction also rewrite the bushels this page loaded -- so a second member
 * correcting the buyer from a stale page silently reverses a bushels correction someone else just
 * made, and the audit would record both as deliberate. An empty result means nothing changed. */
export function contractCorrectionDiff(contract: GrainContract, draft: { buyer: string; bushels: string; delivery_start: string; delivery_end: string; contract_number: string }): GrainContractCorrection {
  const changes: GrainContractCorrection = {}
  const bushels = Number(draft.bushels)
  if (draft.buyer.trim() !== contract.buyer) changes.buyer = draft.buyer.trim()
  if (Number.isFinite(bushels) && bushels !== contract.bushels) changes.bushels = bushels
  if ((draft.delivery_start || null) !== contract.delivery_start) changes.delivery_start = draft.delivery_start || null
  if ((draft.delivery_end || null) !== contract.delivery_end) changes.delivery_end = draft.delivery_end || null
  if ((draft.contract_number.trim() || null) !== contract.contract_number) changes.contract_number = draft.contract_number.trim() || null
  return changes
}

/** The reason is the farmer's own record of why the number changed, so it is required and is stored
 * verbatim. The bounds match the column's check constraint exactly. */
export function validateContractCorrectionReason(reason: string): string | null {
  const trimmed = reason.trim()
  if (trimmed.length < 3) return 'Say why you are changing this contract, in at least three characters.'
  if (trimmed.length > 2000) return 'Keep the reason to 2000 characters or fewer.'
  return null
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

export interface GrainBin { id: string; farm_id: string; name: string; capacity_bu: number; location_type: GrainStorageLocationType; location_name: string | null; notes: string | null; moisture_pct: number | null; moisture_checked_on: string | null; created_at: string; updated_at: string }
export interface BinInventory { id: string; farm_id: string; grain_bin_id: string; crop_year: number; commodity_id: string; bushels: number; committed_bushels: number; measured_at: string; notes: string | null; created_at: string; updated_at: string }
/** Immutable record. Fixes are represented by a new movement in the other direction. */
export interface BinTransaction { id: string; farm_id: string; grain_bin_id: string; direction: BinTransactionDirection; bushels: number; commodity_id: string; occurred_on: string; note: string | null; source_kind: string | null; created_at: string }
/** A farmer's bid keeps the three feed columns null; a GL-1 USDA MARS feed row sets them (display-and-history only, never position math). */
export interface CashBid { id: string; farm_id: string; elevator: string; commodity_id: string; bid_date: string; basis: number; cash_price: number | null; delivery_start: string | null; delivery_end: string | null; notes: string | null; feed_source: string | null; feed_report_id: string | null; feed_geography: string | null; created_at: string; updated_at: string }
export interface MarketingAlertRule extends PositionScope { id: string; rule_type: MarketingAlertRuleType; direction: MarketingAlertDirection | null; threshold: number | null; remind_on: string | null; message: string | null; active: boolean; last_triggered_at: string | null; created_at: string; updated_at: string }
export interface FirmOffer extends PositionScope { id: string; buyer: string; offer_type: FirmOfferType; bushels: number; price: number | null; basis: number | null; contract_month: string | null; expires_on: string | null; delivery_location: string | null; notes: string | null; status: FirmOfferStatus; filled_contract_id: string | null; created_at: string; updated_at: string }
export interface FirmOfferFill { contract: GrainContract; offer: FirmOffer }
export interface GrainAlertSettings { farm_id: string; alert_emails: string[]; updated_at: string }
/** The farmer's own planning limit for one crop-year position; null means no limit set. Never an insurance guarantee. */
export interface GrainSaleLimit extends PositionScope { id: string; sale_limit_bushels: number | null; created_at: string; updated_at: string }
export type GrainCarryMode = 'monthly' | 'flat'
export interface GrainCarrySettings { farm_id: string; mode: GrainCarryMode; monthly_rate_cents_per_bu_month: number; flat_rate_per_bu: number; interest_rate_pct: number; trucking_per_bu: number; updated_at: string }
export interface GrainCarryGridRow { market_price: number | null; basis: number | null }
/** Thirteen delivery-month rows (harvest plus twelve stored months) for one production estimate. */
export interface GrainCarryGrid { id: string; farm_id: string; production_estimate_id: string; harvest_month: number; default_basis: number; rows: GrainCarryGridRow[]; updated_at: string }

/** Mirrors public.usda_market_reports (GL-1): the verified mapping from a USDA report id to the geography it covers; verified_at null means no row is written for it yet. */
export interface UsdaMarketReport { report_id: string; name: string; geography: string; geography_label: string; verified_at: string | null; verification_note: string | null; created_at: string; updated_at: string }
/** Mirrors public.usda_report_dates in 20260711222703_module2_grain.sql. */
export interface UsdaReportDate { id: string; report_name: string; report_date: string; release_at: string | null; source_url: string | null; notes: string | null; created_at: string; updated_at: string }

export interface FuturesQuote { symbol: 'ZC' | 'ZS' | 'ZW'; contract: string; label: string; price: number; crop_year: number; new_crop: boolean; delayed: true; as_of: string }
export interface MarketDataService { getQuotes(): Promise<FuturesQuote[]> }
export interface GrainData { production_estimates: ProductionEstimate[]; grain_contracts: GrainContract[]; grain_contract_deliveries: GrainContractDelivery[]; marketing_plan_targets: MarketingPlanTarget[]; insurance_units: InsuranceUnit[]; grain_bins: GrainBin[]; bin_inventory: BinInventory[]; bin_transactions: BinTransaction[]; cash_bids: CashBid[]; usda_report_dates: UsdaReportDate[]; usda_market_reports: UsdaMarketReport[]; marketing_alert_rules: MarketingAlertRule[]; firm_offers: FirmOffer[]; grain_alert_settings: GrainAlertSettings | null; grain_sale_limits: GrainSaleLimit[]; grain_carry_settings: GrainCarrySettings | null; grain_carry_grids: GrainCarryGrid[]; capabilities?: GrainCapabilities }
export interface GrainWorkspace extends GrainData { fields: FieldsData }
export interface GrainRepository {
  getData(): Promise<GrainWorkspace>
  /** Pure read for projections such as Today: consumes an already-published context and performs no access resolution, queue
   * replay, due generation, or cache write; private financial rows behind `can_read_private_financials` as the database returns them. */
  getSnapshot?(context: FarmOperationContext): Promise<ReadOnlySnapshot<GrainWorkspace>>
  getNeedsAttentionQueueKey?(): Promise<string>
  saveProductionEstimate(estimate: ProductionEstimate): Promise<void>
  reconcileHarvestActual(estimate: ProductionEstimate, harvestActual: number): Promise<void>
  saveContract(contract: GrainContract): Promise<void>
  finalizeContractPriceLeg(contractId: string, leg: 'futures_price' | 'basis', value: number): Promise<void>
  editContract(contractId: string, reason: string, changes: GrainContractCorrection, expectedUpdatedAt: string): Promise<void>
  deleteContract(contractId: string, reason: string, expectedUpdatedAt: string): Promise<void>
  recordContractDelivery(delivery: GrainContractDelivery): Promise<void>
  saveMarketingPlanTarget(target: MarketingPlanTarget): Promise<void>
  replaceMarketingPlanTargets(scope: PositionScope, targets: MarketingPlanTarget[]): Promise<void>
  saveCashBid(bid: CashBid): Promise<void>
  saveMarketingAlertRule(rule: MarketingAlertRule): Promise<void>
  deleteMarketingAlertRule(id: string): Promise<void>
  saveFirmOffer(offer: FirmOffer): Promise<void>
  fillFirmOffer(offer: FirmOffer, contract: GrainContract): Promise<FirmOfferFill>
  deleteFirmOffer(id: string): Promise<void>
  upsertGrainBin(bin: GrainBin): Promise<void>
  appendBinTransaction(transaction: BinTransaction): Promise<void>
  saveGrainAlertSettings(settings: GrainAlertSettings): Promise<void>
  /** These three return the saved row so the screen can adopt the server's updated_at without a full workspace reload. */
  saveGrainSaleLimit(limit: GrainSaleLimit): Promise<GrainSaleLimit>
  saveGrainCarrySettings(settings: GrainCarrySettings): Promise<GrainCarrySettings>
  saveGrainCarryGrid(grid: GrainCarryGrid): Promise<GrainCarryGrid>
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

export function activeProductionForScope(workspace: GrainWorkspace, scope: PositionScope): number {
  const estimate = workspace.production_estimates.find((item) => sameScope(item, scope))
  if (!estimate) return 0
  return estimate.drives_math === 'actual' && estimate.actual_bushels !== null ? estimate.actual_bushels : estimate.expected_bushels
}

/** The newest crop year's estimate: where a Today grain-delivery intent lands and the position Today's grain line summarizes (the
 * repository sorts estimates oldest first, which is right for planning but wrong for work being recorded now); between estimates
 * of the same year the first stays. */
export function deliveryDefaultEstimate<T extends { crop_year: number }>(estimates: readonly T[]): T | undefined {
  return estimates.reduce<T | undefined>((newest, estimate) => (!newest || estimate.crop_year > newest.crop_year ? estimate : newest), undefined)
}

/** The calendar month (1-12) the marketing plan is judged against: the farm's current day in its stored time zone, the same day
 * Today places, so the Overview and the grain line count the same targets on either side of a month boundary wherever the
 * device happens to be. */
export function planMonthFor(now: Date, timeZone: string | null | undefined): number {
  return Number(farmCalendarDate(now, timeZone).slice(5, 7))
}

/** The marketing plan's cumulative target through a calendar month (1-12), as the Overview's plan status accumulates it: every
 * target whose month number is at or before the given month counts, whatever year its date carries. Today's grain line and the
 * Overview share this rule so the two screens report the same planned percent. */
export function plannedPercentThroughMonth(targets: readonly { target_month: string; target_pct_of_production: number }[], month: number): number {
  return targets.filter((target) => Number(target.target_month.slice(5, 7)) <= month).reduce((total, target) => total + target.target_pct_of_production, 0)
}

/** Shared by the marketing plan and alert rules: signed contract bushels / active production. */
export function marketedPercent(workspace: GrainWorkspace, scope: PositionScope): number {
  const production = activeProductionForScope(workspace, scope)
  if (!production) return 0
  return workspace.grain_contracts.filter((item) => sameScope(item, scope)).reduce((sum, item) => sum + item.bushels, 0) / production * 100
}
