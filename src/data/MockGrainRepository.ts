import type { FieldsRepository } from './fields'
import { isLotMovementSuperseded } from './committedFree'
import type { BinTransaction, BinTransactionDirection, CashBid, FirmOffer, FuturesQuote, GrainAlertSettings, GrainBin, GrainCarryGrid, GrainCarrySettings, GrainContract, GrainContractCorrection, GrainContractDelivery, GrainData, GrainLoad, GrainLoadDraft, GrainRepository, GrainSaleLimit, GrainWorkspace, LoadVoidBlocker, LoadVoidResult, MarketDataService, MarketingAlertRule, MarketingPlanTarget, PositionScope, ProductionEstimate, UsdaMarketReport, UsdaReportDate } from './grain'
import { normalizeGrainCarryGrid, normalizeGrainCarrySettings, normalizeGrainSaleLimit, validateGrainCarryGrid, validateGrainCarrySettings, validateGrainSaleLimit } from './grainSettings'
import { contractIsCorrectable, loadEffectsAvailable, loadLotFor, lotsSaveResolvesAgainst, recordedBinLots, sameScope, scopeOf, validateAssignedCropYear, validateContractCorrectionReason, validateGrainContract, validateGrainLoad, validateLoadVoidReason } from './grain'
import { localCalendarDay, validateAlertEmails, validateMarketingAlertRule } from './marketingAlerts'
import { FILLED_OFFER_DELETE_MESSAGE, validateFirmOffer } from './firmOffers'
import { activeBinCommodityIds, deriveBinOnHand, PRE_BASELINE_BIN_MOVEMENT_MESSAGE, validateBinTransaction, validateGrainBin } from './binLedger'

const STORAGE_KEY = 'farm-rx-local-data'
const STORAGE_VERSION = 2
const now = () => new Date().toISOString()
export const mockFirmOfferIsExpired = (offer: FirmOffer, at = new Date()) => offer.expires_on !== null && offer.expires_on < localCalendarDay(at)
export const createGrainId = () => crypto.randomUUID()
const seedId = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const year = new Date().getFullYear()
type Envelope = { version: number; fields?: unknown; grain?: unknown }
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const requiredGrainArrays: Array<'production_estimates' | 'grain_contracts' | 'marketing_plan_targets' | 'insurance_units' | 'grain_bins' | 'bin_inventory' | 'cash_bids' | 'marketing_alert_rules'> = ['production_estimates', 'grain_contracts', 'marketing_plan_targets', 'insurance_units', 'grain_bins', 'bin_inventory', 'cash_bids', 'marketing_alert_rules']

export function readGrain(value: unknown): GrainData | null {
  if (!isRecord(value) || !requiredGrainArrays.every((key) => Array.isArray(value[key]))) return null
  // Explicit projection discards the old bad nested `fields` copy on read.
  return { ...Object.fromEntries(requiredGrainArrays.map((key) => [key, value[key]])), grain_contract_deliveries: Array.isArray(value.grain_contract_deliveries) ? value.grain_contract_deliveries as GrainContractDelivery[] : [], bin_transactions: Array.isArray(value.bin_transactions) ? value.bin_transactions as BinTransaction[] : [], usda_market_reports: Array.isArray(value.usda_market_reports) ? value.usda_market_reports as UsdaMarketReport[] : [], firm_offers: Array.isArray(value.firm_offers) ? value.firm_offers as FirmOffer[] : [], usda_report_dates: Array.isArray(value.usda_report_dates) ? value.usda_report_dates : [], grain_alert_settings: value.grain_alert_settings && isRecord(value.grain_alert_settings) ? value.grain_alert_settings as unknown as GrainAlertSettings : null, grain_sale_limits: Array.isArray(value.grain_sale_limits) ? value.grain_sale_limits as GrainSaleLimit[] : [], grain_carry_settings: value.grain_carry_settings && isRecord(value.grain_carry_settings) ? value.grain_carry_settings as unknown as GrainCarrySettings : null, grain_carry_grids: Array.isArray(value.grain_carry_grids) ? value.grain_carry_grids as GrainCarryGrid[] : [], capabilities: { bin_movements: true, contract_price_finalization: true, contract_deliveries: true, persisted_settings: true } } as GrainData
}

function seedGrain(farmId: string): Omit<GrainData, 'bin_transactions' | 'grain_contract_deliveries'> {
  const timestamp = `${year}-01-01T00:00:00.000Z`
  const production = (value: number, commodity_id: string, aph: number, actual: number | null = null, drives_math: ProductionEstimate['drives_math'] = 'projected'): ProductionEstimate => ({ id: seedId(500 + value), farm_id: farmId, crop_year: year, commodity_id, operating_entity_id: null, enterprise_label: null, planted_acres: null, aph_yield: aph, expected_bushels: 0, actual_bushels: actual, drives_math, notes: null, created_at: timestamp, updated_at: timestamp })
  const contract = (value: number, commodity_id: string, contract_type: GrainContract['contract_type'], buyer: string, bushels: number, cash_price: number | null, futures_price: number | null, basis: number | null, premium = 0): GrainContract => ({ id: seedId(600 + value), farm_id: farmId, crop_year: year, commodity_id, operating_entity_id: null, enterprise_label: null, contract_type, buyer, bushels, futures_price, basis, cash_price, delivery_start: `${year}-09-01`, delivery_end: `${year}-11-30`, contract_number: `WR-${year}-${101 + value}`, premium_cents_per_bu: premium, notes: null, created_at: timestamp, updated_at: timestamp })
  const target = (value: number, commodity_id: string, month: number, pct: number, price: number | null): MarketingPlanTarget => ({ id: seedId(700 + value), farm_id: farmId, crop_year: year, commodity_id, operating_entity_id: null, enterprise_label: null, target_month: `${year}-${String(month).padStart(2, '0')}-01`, target_pct_of_production: pct, target_price: price, breakeven_relative_pct: null, deadline: `${year}-${String(month).padStart(2, '0')}-28`, notes: null, created_at: timestamp, updated_at: timestamp })
  const insurance = (value: number, commodity_id: string, name: string, acres: number, aph: number, coverage: number, revenue: number) => ({ id: seedId(800 + value), farm_id: farmId, crop_year: year, commodity_id, operating_entity_id: null, enterprise_label: null, unit_name: name, insured_acres: acres, aph, coverage_level_pct: coverage, revenue_guarantee_per_acre: revenue, guarantee_per_bu: revenue / aph, notes: null, created_at: timestamp, updated_at: timestamp })
  const bins = [{ id: seedId(901), farm_id: farmId, name: 'North dryer bin', capacity_bu: 42000, location_type: 'on_farm' as const, location_name: 'Home farm', notes: null, moisture_pct: 14.2, moisture_checked_on: `${year}-01-01`, created_at: timestamp, updated_at: timestamp }, { id: seedId(902), farm_id: farmId, name: 'South storage bin', capacity_bu: 30000, location_type: 'on_farm' as const, location_name: 'Home farm', notes: null, moisture_pct: null, moisture_checked_on: null, created_at: timestamp, updated_at: timestamp }, { id: seedId(903), farm_id: farmId, name: 'White corn IP bin', capacity_bu: 18000, location_type: 'on_farm' as const, location_name: 'Home farm', notes: null, moisture_pct: 15.4, moisture_checked_on: `${year}-01-01`, created_at: timestamp, updated_at: timestamp }]
  const bid = (value: number, elevator: string, commodity_id: string, date: string, basis: number, cash_price: number | null): CashBid => ({ id: seedId(1000 + value), farm_id: farmId, elevator, commodity_id, bid_date: date, basis, cash_price, delivery_start: null, delivery_end: null, notes: null, feed_source: null, feed_report_id: null, feed_geography: null, created_at: timestamp, updated_at: timestamp })
  const report = (value: number, report_name: string, report_date: string, release_at: string | null, source_url: string): UsdaReportDate => ({ id: seedId(1100 + value), report_name, report_date, release_at, source_url, notes: null, created_at: timestamp, updated_at: timestamp })
  const usda = 'https://www.nass.usda.gov/Publications/Calendar/2026/2026ReleaseCalendar_12Months_11x17_Color.pdf'
  return { production_estimates: [production(1, 'corn_yellow', 202, 199850), production(2, 'corn_white', 190), production(3, 'corn_non_gmo', 180), production(4, 'soybeans', 62, 33240), production(5, 'soybeans_double_crop', 46, 4140), production(6, 'wheat', 82, 11460, 'actual')], grain_contracts: [contract(1, 'corn_yellow', 'forward_cash', 'Cargill - Olney', 72000, 4.86, null, null), contract(2, 'corn_yellow', 'hta', 'ADM - Mt. Carmel', 30000, null, 4.74, null), contract(3, 'soybeans', 'forward_cash', 'Cargill - Olney', 12000, 10.68, null, null), contract(4, 'corn_white', 'basis', 'Premier White Corn', 18000, null, null, -0.12, 28)], marketing_plan_targets: [target(1, 'corn_yellow', 3, 10, 4.8), target(2, 'corn_yellow', 6, 10, 4.95), target(3, 'corn_yellow', 9, 15, 5.05), target(4, 'corn_yellow', 11, 15, null), target(5, 'soybeans', 5, 10, 10.7), target(6, 'soybeans', 8, 10, 10.95), target(7, 'soybeans', 10, 15, null)], insurance_units: [insurance(1, 'corn_yellow', 'Corn enterprise unit', 1014.25, 202, 80, 790), insurance(2, 'corn_white', 'White corn enterprise unit', 280, 190, 80, 780), insurance(3, 'corn_non_gmo', 'Non-GMO corn unit', 155.5, 180, 80, 710), insurance(4, 'soybeans', 'Soybean enterprise unit', 544.25, 62, 80, 405), insurance(5, 'wheat', 'Wheat enterprise unit', 142, 82, 75, 405)], grain_bins: bins, bin_inventory: [{ id: seedId(951), farm_id: farmId, grain_bin_id: bins[0].id, crop_year: year, commodity_id: 'corn_yellow', bushels: 27800, committed_bushels: 18400, measured_at: timestamp, notes: null, created_at: timestamp, updated_at: timestamp }, { id: seedId(952), farm_id: farmId, grain_bin_id: bins[1].id, crop_year: year, commodity_id: 'soybeans', bushels: 16500, committed_bushels: 4200, measured_at: timestamp, notes: null, created_at: timestamp, updated_at: timestamp }, { id: seedId(953), farm_id: farmId, grain_bin_id: bins[2].id, crop_year: year, commodity_id: 'corn_white', bushels: 11250, committed_bushels: 6000, measured_at: timestamp, notes: null, created_at: timestamp, updated_at: timestamp }], cash_bids: [bid(1, 'Cargill - Olney', 'corn_yellow', `${year}-07-08`, -0.24, 4.44), bid(2, 'Cargill - Olney', 'corn_yellow', `${year}-07-10`, -0.22, 4.46), bid(3, 'ADM - Mt. Carmel', 'corn_yellow', `${year}-07-09`, -0.28, 4.4), bid(4, 'ADM - Mt. Carmel', 'corn_yellow', `${year}-07-10`, -0.26, 4.42), bid(5, 'Cargill - Olney', 'soybeans', `${year}-07-10`, -0.35, 10.07), bid(6, 'ADM - Mt. Carmel', 'soybeans', `${year}-07-10`, -0.39, 10.03), bid(7, 'Premier White Corn', 'corn_white', `${year}-07-10`, -0.12, null)], usda_market_reports: [], usda_report_dates: [...['01-12', '02-10', '03-10', '04-09', '05-12', '06-11', '07-10', '08-12', '09-11', '10-09', '11-10', '12-10'].map((date, index) => report(index + 1, 'WASDE', `${year}-${date}`, `${year}-${date}T12:00:00-04:00`, 'https://www.usda.gov/about-usda/general-information/staff-offices/office-chief-economist/commodity-markets/wasde-report')), report(20, 'Grain Stocks', `${year}-03-31`, `${year}-03-31T12:00:00-04:00`, usda), report(21, 'Grain Stocks', `${year}-06-30`, `${year}-06-30T12:00:00-04:00`, usda), report(22, 'Grain Stocks', `${year}-09-30`, `${year}-09-30T12:00:00-04:00`, usda), report(23, 'Prospective Plantings', `${year}-03-31`, `${year}-03-31T12:00:00-04:00`, usda), ...['04-06', '05-04', '06-01', '07-06', '08-03', '09-08', '10-05', '11-02'].map((date, index) => report(30 + index, 'Crop Progress', `${year}-${date}`, `${year}-${date}T16:00:00-04:00`, usda))], marketing_alert_rules: [], firm_offers: [], grain_alert_settings: null, grain_sale_limits: [], grain_carry_settings: null, grain_carry_grids: [], grain_loads: [] }
}

function reconcileProduction(fields: GrainWorkspace['fields'], data: GrainData): GrainData {
  return { ...data, production_estimates: data.production_estimates.map((estimate) => {
    const planted_acres = fields.crop_assignments.filter((assignment) => assignment.crop_year === estimate.crop_year && assignment.commodity_id === estimate.commodity_id && (estimate.operating_entity_id === null || fields.fields.find((field) => field.id === assignment.field_id)?.operating_entity_id === estimate.operating_entity_id)).reduce((total, assignment) => total + assignment.planted_acres, 0)
    return { ...estimate, planted_acres, expected_bushels: planted_acres * estimate.aph_yield }
  }) }
}

async function load(fieldsRepository: FieldsRepository): Promise<GrainWorkspace> {
  const fields = await fieldsRepository.getData()
  try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) { const envelope = JSON.parse(saved) as Envelope; const grain = envelope.version === STORAGE_VERSION ? readGrain(envelope.grain) : null; if (grain) { const updated = grain.usda_report_dates.length ? grain : { ...grain, usda_report_dates: seedGrain(fields.farm.id).usda_report_dates }; return { ...reconcileProduction(fields, updated), fields } } } } catch { /* seed without compromising the authoritative Fields slice */ }
  const grain = reconcileProduction(fields, { ...seedGrain(fields.farm.id), bin_transactions: [], grain_contract_deliveries: [], capabilities: { bin_movements: true, contract_price_finalization: true, contract_deliveries: true, persisted_settings: true } }); persist(grain); return { ...grain, fields }
}

export function writeGrainEnvelope(existing: string | null, grain: GrainData & { fields?: unknown }): string {
  let fields: unknown
  try { const parsed = existing ? JSON.parse(existing) : null; if (isRecord(parsed) && parsed.version === STORAGE_VERSION) fields = parsed.fields } catch { /* current write still succeeds */ }
  // Grain owns only its own slice; it never serializes GrainWorkspace.fields.
  const { fields: _fields, ...grainSlice } = grain as GrainData & { fields?: unknown }
  return JSON.stringify({ version: STORAGE_VERSION, ...(fields === undefined ? {} : { fields }), grain: grainSlice } satisfies Envelope)
}
function persist(grain: GrainData) {
  const { fields: _fields, ...grainSlice } = grain as GrainData & { fields?: unknown }
  localStorage.setItem(STORAGE_KEY, writeGrainEnvelope(localStorage.getItem(STORAGE_KEY), grainSlice))
}
/** LD-2: one bin movement a load causes. The mock writes these for real rather than recording the
 * flag and stopping, because a fake that quietly skips the effect would let a test prove the
 * opposite of what the product does. */
function loadMovement(load: GrainLoad, binId: string, direction: BinTransactionDirection, note: string, sourceKind: string): BinTransaction {
  return {
    id: createGrainId(), farm_id: load.farm_id, grain_bin_id: binId, direction,
    bushels: load.net_bushels, commodity_id: load.commodity_id, crop_year: load.crop_year,
    occurred_on: load.load_date, note, source_kind: sourceKind, grain_load_id: load.id,
    created_at: now(),
  }
}

/** LD-2: the bushels of one lot -- a commodity AND a crop year -- in one bin. The baseline counts
 * only for its own crop year, and rows carrying no crop year are their own bucket and are never
 * credited to a named year. */
function lotBalance(workspace: GrainWorkspace, binId: string, commodityId: string, cropYear: number | null): number {
  const baseline = workspace.bin_inventory.find((row) => row.grain_bin_id === binId)
  const base = baseline && baseline.commodity_id === commodityId && baseline.crop_year === cropYear ? baseline.bushels : 0
  return workspace.bin_transactions
    .filter((row) => row.grain_bin_id === binId && row.commodity_id === commodityId && row.crop_year === cropYear)
    // LD-4 repair (Codex P2 on ceb547b): a movement the baseline already measured is not counted
    // again, which is the rule assign_bin_movement_crop_year applies and the rule this function
    // was missing entirely. Without it an older outbound movement is subtracted twice and the mock
    // refuses a crop-year assignment the server accepts -- the same mock-against-server divergence
    // found two rounds ago in saveLoad, in the one helper that had not been checked against it.
    //
    // isLotMovementSuperseded, not a fourth copy of the predicate: it is the browser's single
    // statement of "the baseline already covers this", and bin_lots derives through it too.
    .filter((row) => !isLotMovementSuperseded(baseline, row))
    .reduce((total, row) => total + (row.direction === 'in' ? row.bushels : -row.bushels), base)
}

function grainSlice(workspace: GrainWorkspace): GrainData { const { fields: _fields, ...grain } = workspace; return grain }

export class MockMarketDataService implements MarketDataService {
  async getQuotes(): Promise<FuturesQuote[]> { const as_of = `Delayed · ${new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Chicago' }).format(new Date(Date.now() - 15 * 60_000))} CT`; const suffix = String(year).slice(-2); const next = String(year + 1).slice(-2); return [{ symbol: 'ZC', contract: `Sep ${suffix}`, label: 'Sep corn', price: 4.44, crop_year: year, new_crop: false, delayed: true, as_of }, { symbol: 'ZC', contract: `Dec ${suffix}`, label: 'Dec corn', price: 4.68, crop_year: year, new_crop: true, delayed: true, as_of }, { symbol: 'ZS', contract: `Aug ${suffix}`, label: 'Aug beans', price: 10.18, crop_year: year, new_crop: false, delayed: true, as_of }, { symbol: 'ZS', contract: `Nov ${suffix}`, label: 'Nov beans', price: 10.42, crop_year: year, new_crop: true, delayed: true, as_of }, { symbol: 'ZW', contract: `Sep ${suffix}`, label: 'Sep wheat', price: 5.33, crop_year: year, new_crop: false, delayed: true, as_of }, { symbol: 'ZW', contract: `Jul ${next}`, label: 'Jul wheat', price: 5.61, crop_year: year, new_crop: true, delayed: true, as_of }] }
}

export class MockGrainRepository implements GrainRepository {
  constructor(private readonly fieldsRepository: FieldsRepository) {}
  async getData() { return load(this.fieldsRepository) }
  async saveProductionEstimate(estimate: ProductionEstimate) { if (!Number.isFinite(estimate.aph_yield) || estimate.aph_yield <= 0 || (estimate.actual_bushels !== null && (!Number.isFinite(estimate.actual_bushels) || estimate.actual_bushels < 0)) || (estimate.drives_math === 'actual' && estimate.actual_bushels === null)) throw new Error('APH must be above zero and actual bushels must be available before using actual production.'); const workspace = await load(this.fieldsRepository); const rows = workspace.production_estimates.map((row) => row.id === estimate.id ? { ...estimate, updated_at: now() } : row); persist({ ...grainSlice(workspace), production_estimates: rows }); }
  async reconcileHarvestActual(estimate: ProductionEstimate, harvestActual: number) { if (!Number.isFinite(harvestActual) || harvestActual < 0) throw new Error('Farm Rx could not reconcile this harvest total.'); const workspace = await load(this.fieldsRepository); const current = workspace.production_estimates.find((row) => row.id === estimate.id); if (!current) throw new Error('This production estimate is no longer available. Reload before trying again.'); persist({ ...grainSlice(workspace), production_estimates: workspace.production_estimates.map((row) => row.id === estimate.id ? { ...row, actual_bushels: harvestActual, drives_math: 'actual', updated_at: now() } : row) }); }
  async saveContract(contract: GrainContract) { const workspace = await load(this.fieldsRepository); const errors = validateGrainContract(contract, new Set(workspace.fields.commodities.map((commodity) => commodity.id))); if (errors.length) throw new Error(errors.join(' ')); const rows = workspace.grain_contracts.some((row) => row.id === contract.id) ? workspace.grain_contracts.map((row) => row.id === contract.id ? { ...contract, updated_at: now() } : row) : [...workspace.grain_contracts, contract]; persist({ ...grainSlice(workspace), grain_contracts: rows }); }
  async editContract(contractId: string, reason: string, changes: GrainContractCorrection, expectedUpdatedAt: string, _operationId: string) { const problem = validateContractCorrectionReason(reason); if (problem) throw new Error(problem); const workspace = await load(this.fieldsRepository); const current = workspace.grain_contracts.find((row) => row.id === contractId); if (!current) throw new Error('This contract is no longer available. Reload before trying again.'); if (current.updated_at !== expectedUpdatedAt) throw new Error('FARM_RX_STALE_WRITE'); if (!contractIsCorrectable(workspace, contractId)) throw new Error('This contract already has delivered bushels and can no longer be changed.'); const next = { ...current, ...(changes.buyer !== undefined ? { buyer: changes.buyer.trim() } : {}), ...(changes.bushels !== undefined ? { bushels: changes.bushels } : {}), ...(changes.delivery_start !== undefined ? { delivery_start: changes.delivery_start || null } : {}), ...(changes.delivery_end !== undefined ? { delivery_end: changes.delivery_end || null } : {}), ...(changes.contract_number !== undefined ? { contract_number: changes.contract_number?.trim() || null } : {}), ...(changes.notes !== undefined ? { notes: changes.notes?.trim() || null } : {}), updated_at: now() }; const errors = validateGrainContract(next, new Set(workspace.fields.commodities.map((commodity) => commodity.id))); if (errors.length) throw new Error(errors.join(' ')); persist({ ...grainSlice(workspace), grain_contracts: workspace.grain_contracts.map((row) => row.id === contractId ? next : row) }); return next }
  async listLoadTrucks() { return [{ id: seedId(1201), name: 'Red semi' }, { id: seedId(1202), name: 'Blue tandem' }] }
  /** LD-4 repair: the mock's workspace is complete by construction, so deriving here IS the
   * authoritative answer -- there is no row cap in front of an in-memory array.
   *
   * LD-4 repair (Codex P2 on 178208c): every RECORDED lot, including the ones the bin has emptied.
   * public.bin_lots keeps those rows on purpose -- it is how a ticket that moves no bushels names
   * the year it really was -- and a mock that dropped them would reject a path production accepts,
   * so no mock-backed test could ever cover it. Filtering to what the bin still holds belongs to
   * the form, which knows whether the load moves anything. */
  async listBinLots(binId: string) {
    const workspace = await load(this.fieldsRepository)
    return [...recordedBinLots(workspace, binId)]
      .sort((a, b) => b.crop_year - a.crop_year || a.commodity_id.localeCompare(b.commodity_id))
  }
  async listHarvestLoads(): Promise<{ loads: GrainLoad[]; complete: boolean }> { const workspace = await load(this.fieldsRepository); return { loads: workspace.grain_loads.filter((row) => row.effect_harvest && row.voided_at === null), complete: true } }
  async assignBinMovementCropYear(transactionId: string, cropYear: number): Promise<BinTransaction> {
    const problem = validateAssignedCropYear(cropYear)
    if (problem) throw new Error(problem)
    const workspace = await load(this.fieldsRepository)
    const existing = workspace.bin_transactions.find((row) => row.id === transactionId)
    if (!existing) throw new Error('That movement is no longer available. Reload before trying again.')
    if (existing.crop_year !== null) {
      if (existing.crop_year === cropYear) return existing
      throw new Error(`This movement already names the ${existing.crop_year} crop and cannot be changed.`)
    }
    // The same refusal the server makes: naming a year the bin never held that grain in would
    // create a lot out of nothing.
    const named: BinTransaction = { ...existing, crop_year: cropYear }
    const after = { ...workspace, bin_transactions: workspace.bin_transactions.map((row) => row.id === transactionId ? named : row) }
    if (lotBalance(after, existing.grain_bin_id, existing.commodity_id, cropYear) < 0) {
      throw new Error(`Calling this the ${cropYear} crop would leave that year short.`)
    }
    persist({ ...grainSlice(workspace), bin_transactions: after.bin_transactions })
    return named
  }
  async saveLoad(id: string, draft: GrainLoadDraft) {
    const workspace = await load(this.fieldsRepository)
    // LD-4 repair (Codex P2 on ef8a29e): this method stands in for save_grain_load, so it resolves
    // the draft against the list THAT function uses -- see lotsSaveResolvesAgainst. It passed no
    // list at all before, and both calls below then fell through to binLotsOnHand, which drops the
    // emptied lots. So a ticket-only load naming a lot the bin has already emptied was refused
    // here while the real RPC accepts it, and the path listBinLots had just been repaired for
    // could not be reached through the mock by any test.
    const lots = draft.origin_kind === 'bin' && draft.origin_grain_bin_id
      ? lotsSaveResolvesAgainst(recordedBinLots(workspace, draft.origin_grain_bin_id), draft)
      : undefined
    // LD-4 repair (Codex P2 on 052ba8d): the replay check comes FIRST, as it does in the real
    // function, where the lookup happens inside the bin lock before any lot is resolved. A retry of
    // a blank-year load that drained the bin's sole lot finds no on-hand lot to default from, so
    // validating first refused the retry outright -- while the server recovers the stored lot and
    // returns the ticket it already saved. That is the exact lost-response path LD-1 keeps the
    // ticket id for, and the mock could not exercise it.
    const existing = workspace.grain_loads.find((row) => row.id === id)
    if (existing) return existing
    const problems = validateGrainLoad(draft, workspace, lots)
    if (problems.length) throw new Error(problems[0])
    const lot = loadLotFor(workspace, draft, lots)
    if (!lot) throw new Error('Farm Rx cannot tell which crop year this load is.')
    const stamp = now()
    const available = loadEffectsAvailable(draft)
    const confirmed = (key: 'bin_out' | 'bin_in' | 'contract_delivery' | 'harvest') => available.includes(key) && (
      key === 'bin_out' ? draft.effect_bin_out
        : key === 'bin_in' ? draft.effect_bin_in
        : key === 'contract_delivery' ? draft.effect_contract_delivery
        : draft.effect_harvest)
    const saved: GrainLoad = {
      id, farm_id: workspace.fields.farm.id, load_date: draft.load_date,
      truck_equipment_id: draft.truck_equipment_id || null,
      truck_name: draft.truck_name.trim() || null,
      origin_kind: draft.origin_kind,
      origin_grain_bin_id: draft.origin_kind === 'bin' ? draft.origin_grain_bin_id : null,
      origin_crop_assignment_id: draft.origin_kind === 'field' ? draft.origin_crop_assignment_id : null,
      destination_kind: draft.destination_kind,
      destination_buyer: draft.destination_kind === 'buyer' ? draft.destination_buyer.trim() : null,
      destination_grain_contract_id: draft.destination_kind === 'contract' ? draft.destination_grain_contract_id : null,
      destination_grain_bin_id: draft.destination_kind === 'bin' ? draft.destination_grain_bin_id : null,
      commodity_id: lot.commodity_id, crop_year: lot.crop_year,
      gross_lbs: draft.gross_lbs.trim() ? Number(draft.gross_lbs) : null,
      tare_lbs: draft.tare_lbs.trim() ? Number(draft.tare_lbs) : null,
      net_bushels: Number(draft.net_bushels),
      moisture_pct: draft.moisture_pct.trim() ? Number(draft.moisture_pct) : null,
      ticket_number: draft.ticket_number.trim() || null,
      photo_path: null,
      notes: draft.notes.trim() || null,
      effect_bin_out: confirmed('bin_out'),
      effect_bin_in: confirmed('bin_in'),
      effect_contract_delivery: confirmed('contract_delivery'),
      effect_harvest: confirmed('harvest'),
      voided_at: null, void_reason: null,
      created_at: stamp, updated_at: stamp,
    }
    // LD-2: every effect the farmer confirmed, applied here the way the server applies it. The
    // harvest effect writes nothing -- it is the flag above, and the figure is derived from it.
    const note = saved.ticket_number ? `Scale ticket ${saved.ticket_number}` : 'Recorded from a load'
    const movements: BinTransaction[] = []
    if (saved.effect_bin_out && saved.origin_grain_bin_id) movements.push(loadMovement(saved, saved.origin_grain_bin_id, 'out', note, 'grain_load'))
    if (saved.effect_bin_in && saved.destination_grain_bin_id) movements.push(loadMovement(saved, saved.destination_grain_bin_id, 'in', note, 'grain_load'))
    const deliveries: GrainContractDelivery[] = saved.effect_contract_delivery && saved.destination_grain_contract_id
      ? [{ id: createGrainId(), farm_id: saved.farm_id, grain_contract_id: saved.destination_grain_contract_id, bushels: saved.net_bushels, delivered_on: saved.load_date, note, grain_load_id: saved.id, created_at: stamp }]
      : []
    persist({
      ...grainSlice(workspace),
      grain_loads: [saved, ...workspace.grain_loads],
      bin_transactions: [...movements, ...workspace.bin_transactions],
      grain_contract_deliveries: [...deliveries, ...workspace.grain_contract_deliveries],
    })
    return saved
  }
  async voidLoad(loadId: string, reason: string): Promise<LoadVoidResult> {
    const problem = validateLoadVoidReason(reason)
    if (problem) throw new Error(problem)
    const workspace = await load(this.fieldsRepository)
    const existing = workspace.grain_loads.find((row) => row.id === loadId)
    if (!existing) throw new Error('That load is no longer available. Reload before trying again.')
    if (existing.voided_at !== null) {
      if (existing.void_reason === reason.trim()) return { status: 'voided', load: existing, blockedBy: [], reason: null }
      throw new Error('FARM_RX_LOAD_ALREADY_VOIDED')
    }

    // LD-2: the rows this load created, found by link rather than guesswork.
    const created = workspace.bin_transactions.filter((row) => row.grain_load_id === loadId && row.source_kind === 'grain_load')

    // A compensating out cannot take grain that has since left the bin. When it cannot, nothing
    // changes at all and the later movements standing in the way are named.
    const blockedBy: LoadVoidBlocker[] = []
    for (const movement of created) {
      if (movement.direction !== 'in') continue
      if (lotBalance(workspace, movement.grain_bin_id, movement.commodity_id, movement.crop_year) >= movement.bushels) continue
      for (const later of workspace.bin_transactions) {
        if (later.grain_load_id === loadId) continue
        if (later.grain_bin_id !== movement.grain_bin_id) continue
        if (later.commodity_id !== movement.commodity_id || later.crop_year !== movement.crop_year) continue
        if (later.created_at <= movement.created_at) continue
        blockedBy.push({ id: later.id, grain_bin_id: later.grain_bin_id, direction: later.direction, bushels: later.bushels, commodity_id: later.commodity_id, crop_year: later.crop_year, occurred_on: later.occurred_on, source_kind: later.source_kind })
      }
    }
    if (blockedBy.length) {
      return { status: 'blocked', load: existing, blockedBy, reason: 'This bin no longer holds the bushels this load put in.' }
    }

    const reversalNote = `Reversing a voided load: ${reason.trim()}`
    const compensating = created.map((movement) => loadMovement(
      existing,
      movement.grain_bin_id,
      movement.direction === 'in' ? 'out' : 'in',
      reversalNote,
      'grain_load_void',
    ))
    const voided: GrainLoad = { ...existing, voided_at: now(), void_reason: reason.trim(), updated_at: now() }
    persist({
      ...grainSlice(workspace),
      grain_loads: workspace.grain_loads.map((row) => row.id === loadId ? voided : row),
      bin_transactions: [...compensating, ...workspace.bin_transactions],
      // A delivery is a claim rather than a physical event, so it is removed outright and every
      // reader of delivered bushels stays correct with no second rule to learn.
      grain_contract_deliveries: workspace.grain_contract_deliveries.filter((row) => row.grain_load_id !== loadId),
    })
    return { status: 'voided', load: voided, blockedBy: [], reason: null }
  }
  async deleteContract(contractId: string, reason: string, expectedUpdatedAt: string, _operationId: string) { const problem = validateContractCorrectionReason(reason); if (problem) throw new Error(problem); const workspace = await load(this.fieldsRepository); const existing = workspace.grain_contracts.find((row) => row.id === contractId); if (!existing) return { reopenedFirmOfferId: null, reopenedFirmOfferStatus: null }; if (existing.updated_at !== expectedUpdatedAt) throw new Error('FARM_RX_STALE_WRITE'); if (!contractIsCorrectable(workspace, contractId)) throw new Error('This contract already has delivered bushels and can no longer be deleted.'); const reopenedOffer = workspace.firm_offers.find((row) => row.filled_contract_id === contractId); const reopened = reopenedOffer?.id ?? null; persist({ ...grainSlice(workspace), grain_contracts: workspace.grain_contracts.filter((row) => row.id !== contractId), firm_offers: workspace.firm_offers.map((row) => row.filled_contract_id === contractId ? { ...row, status: 'open' as const, filled_contract_id: null, updated_at: now() } : row) }); return { reopenedFirmOfferId: reopened, reopenedFirmOfferStatus: reopened ? 'open' : null } }
  async finalizeContractPriceLeg(contractId: string, leg: 'futures_price' | 'basis', value: number) { if (!Number.isFinite(value) || (leg === 'futures_price' && value <= 0)) throw new Error(leg === 'basis' ? 'Enter a valid basis.' : 'Enter a futures price above zero.'); const workspace = await load(this.fieldsRepository); const current = workspace.grain_contracts.find((row) => row.id === contractId); if (!current) throw new Error('This contract is no longer available. Reload before trying again.'); if (current[leg] !== null) throw new Error('This price leg is already finalized. Add a contract note for a correction.'); const next = { ...current, [leg]: value, cash_price: (leg === 'basis' ? current.futures_price! + value : value + current.basis!) + current.premium_cents_per_bu / 100, updated_at: now() }; persist({ ...grainSlice(workspace), grain_contracts: workspace.grain_contracts.map((row) => row.id === contractId ? next : row) }); }
  async recordContractDelivery(delivery: GrainContractDelivery) { if (!Number.isFinite(delivery.bushels) || delivery.bushels <= 0) throw new Error('Delivered bushels must be greater than zero.'); const workspace = await load(this.fieldsRepository); const contract = workspace.grain_contracts.find((item) => item.id === delivery.grain_contract_id); const existing = workspace.grain_contract_deliveries.find((item) => item.id === delivery.id); if (existing) { if (existing.grain_contract_id === delivery.grain_contract_id && existing.bushels === delivery.bushels && existing.delivered_on === delivery.delivered_on && existing.note === delivery.note) return; throw new Error('Delivery id was already used with different content.'); } if (!contract) throw new Error('Farm Rx could not record this delivery.'); const delivered = workspace.grain_contract_deliveries.filter((item) => item.grain_contract_id === contract.id).reduce((sum, item) => sum + item.bushels, 0); if (delivered + delivery.bushels > contract.bushels && delivery.allow_overdelivery !== true) throw new Error('Delivery would exceed the remaining contract bushels; confirm over-delivery to record it.'); persist({ ...grainSlice(workspace), grain_contract_deliveries: [...workspace.grain_contract_deliveries, delivery] }); }
  async saveMarketingPlanTarget(target: MarketingPlanTarget) { const workspace = await load(this.fieldsRepository); const scope = scopeOf(target); const unchanged = workspace.marketing_plan_targets.filter((row) => !sameScope(row, scope) || row.id !== target.id); const replacement = [...unchanged, { ...target, updated_at: now() }]; await this.replaceMarketingPlanTargets(scope, replacement.filter((row) => sameScope(row, scope))) }
  async replaceMarketingPlanTargets(scope: PositionScope, targets: MarketingPlanTarget[]) { const total = targets.reduce((sum, target) => sum + target.target_pct_of_production, 0); if (!Number.isFinite(total) || total > 100.0001 || targets.some((target) => !sameScope(target, scope) || target.target_pct_of_production <= 0 || target.target_pct_of_production > 100)) throw new Error('Marketing plan totals must be greater than 0% per month and no more than 100% for this crop scope.'); const workspace = await load(this.fieldsRepository); persist({ ...grainSlice(workspace), marketing_plan_targets: [...workspace.marketing_plan_targets.filter((row) => !sameScope(row, scope)), ...targets.map((target) => ({ ...target, updated_at: now() }))] }); }
  async saveCashBid(bid: CashBid) { if (!Number.isFinite(bid.basis) || (bid.cash_price !== null && (!Number.isFinite(bid.cash_price) || bid.cash_price < 0)) || (bid.delivery_start && bid.delivery_end && bid.delivery_end < bid.delivery_start)) throw new Error('Enter a valid basis, cash price, and delivery window.'); const workspace = await load(this.fieldsRepository); if (!workspace.fields.commodities.some((commodity) => commodity.id === bid.commodity_id)) throw new Error('Choose a valid commodity.'); const rows = workspace.cash_bids.some((row) => row.id === bid.id) ? workspace.cash_bids.map((row) => row.id === bid.id ? { ...bid, updated_at: now() } : row) : [...workspace.cash_bids, bid]; persist({ ...grainSlice(workspace), cash_bids: rows }); }
  async saveMarketingAlertRule(rule: MarketingAlertRule) { if (validateMarketingAlertRule(rule).length) throw new Error('Enter a complete alert rule with the right price, percent, or date.'); const workspace = await load(this.fieldsRepository); const rows = workspace.marketing_alert_rules.some((row) => row.id === rule.id) ? workspace.marketing_alert_rules.map((row) => row.id === rule.id ? { ...rule, updated_at: now() } : row) : [...workspace.marketing_alert_rules, rule]; persist({ ...grainSlice(workspace), marketing_alert_rules: rows }); }
  async deleteMarketingAlertRule(id: string) { const workspace = await load(this.fieldsRepository); persist({ ...grainSlice(workspace), marketing_alert_rules: workspace.marketing_alert_rules.filter((rule) => rule.id !== id) }); }
  async saveFirmOffer(offer: FirmOffer) { if (validateFirmOffer(offer).length) throw new Error('Enter a complete firm offer with the right price or basis.'); const workspace = await load(this.fieldsRepository); const rows = workspace.firm_offers.some((row) => row.id === offer.id) ? workspace.firm_offers.map((row) => row.id === offer.id ? { ...offer, updated_at: now() } : row) : [...workspace.firm_offers, offer]; persist({ ...grainSlice(workspace), firm_offers: rows }); }
  async fillFirmOffer(offer: FirmOffer, contract: GrainContract) { const workspace = await load(this.fieldsRepository); const current = workspace.firm_offers.find((row) => row.id === offer.id); if (!current) throw new Error('This firm offer is no longer available. Reload before trying again.'); if (current.status === 'filled' && current.filled_contract_id) { const existing = workspace.grain_contracts.find((row) => row.id === current.filled_contract_id); if (existing) return { contract: existing, offer: current }; throw new Error('This firm offer is marked filled but its contract cannot be found. Reload before retrying.'); }
    if (current.status !== 'open' || mockFirmOfferIsExpired(current)) throw new Error('This firm offer is no longer open. Reload before trying again.');
    if (validateGrainContract(contract, new Set(workspace.fields.commodities.map((commodity) => commodity.id))).length) throw new Error('Farm Rx could not record this grain contract.');
    const savedOffer = { ...current, status: 'filled' as const, filled_contract_id: contract.id, updated_at: now() }; persist({ ...grainSlice(workspace), grain_contracts: [...workspace.grain_contracts.filter((row) => row.id !== contract.id), contract], firm_offers: workspace.firm_offers.map((row) => row.id === current.id ? savedOffer : row) }); return { contract, offer: savedOffer }
  }
  async deleteFirmOffer(id: string) { const workspace = await load(this.fieldsRepository); const current = workspace.firm_offers.find((offer) => offer.id === id); if (current && (current.status === 'filled' || current.filled_contract_id !== null)) throw new Error(FILLED_OFFER_DELETE_MESSAGE); persist({ ...grainSlice(workspace), firm_offers: workspace.firm_offers.filter((offer) => offer.id !== id) }); }
  async upsertGrainBin(bin: GrainBin) { if (validateGrainBin(bin).length) throw new Error('Check the bin name, capacity, and moisture reading.'); const workspace = await load(this.fieldsRepository); const rows = workspace.grain_bins.some((row) => row.id === bin.id) ? workspace.grain_bins.map((row) => row.id === bin.id ? { ...bin, updated_at: now() } : row) : [...workspace.grain_bins, bin]; persist({ ...grainSlice(workspace), grain_bins: rows }); }
  async appendBinTransaction(transaction: BinTransaction) { if (validateBinTransaction(transaction).length) throw new Error('Check the direction, bushels, and movement date.'); const workspace = await load(this.fieldsRepository); const bin = workspace.grain_bins.find((item) => item.id === transaction.grain_bin_id); const inventory = workspace.bin_inventory.find((item) => item.grain_bin_id === transaction.grain_bin_id); const prior = workspace.bin_transactions.filter((item) => item.grain_bin_id === transaction.grain_bin_id); if (!bin || !workspace.fields.commodities.some((commodity) => commodity.id === transaction.commodity_id)) throw new Error('Choose a bin and commodity from this farm.'); if (inventory && transaction.occurred_on <= inventory.measured_at.slice(0, 10)) throw new Error(PRE_BASELINE_BIN_MOVEMENT_MESSAGE); const existing = workspace.bin_transactions.find((row) => row.id === transaction.id); if (existing) { if (existing.grain_bin_id === transaction.grain_bin_id && existing.direction === transaction.direction && existing.bushels === transaction.bushels && existing.commodity_id === transaction.commodity_id && existing.occurred_on === transaction.occurred_on) return; throw new Error('Movement id was already used with different content.'); } const active = activeBinCommodityIds(inventory, prior); if (active.length && !active.includes(transaction.commodity_id)) throw new Error(`This bin still holds ${active.join(' and ')}. Empty those lots before storing another crop.`); const lotInventory = inventory?.commodity_id === transaction.commodity_id ? inventory : undefined; const next = deriveBinOnHand(lotInventory, prior.filter((item) => item.commodity_id === transaction.commodity_id)).rawOnHand + (transaction.direction === 'in' ? transaction.bushels : -transaction.bushels); if (next < 0) throw new Error('This movement would make the bin balance negative.'); const total = active.reduce((sum, commodity) => sum + deriveBinOnHand(inventory?.commodity_id === commodity ? inventory : undefined, prior.filter((item) => item.commodity_id === commodity)).rawOnHand, 0) + (transaction.direction === 'in' ? transaction.bushels : -transaction.bushels); if (total > bin.capacity_bu) throw new Error('This movement would put more grain in the bin than it holds.'); persist({ ...grainSlice(workspace), bin_transactions: [...workspace.bin_transactions, transaction] }); }
  async saveGrainSaleLimit(value: GrainSaleLimit) { const limit = normalizeGrainSaleLimit(value); if (validateGrainSaleLimit(limit).length) throw new Error('Enter a sale limit of zero or more bushels.'); const workspace = await load(this.fieldsRepository); const existing = workspace.grain_sale_limits.find((row) => row.id === limit.id || sameScope(row, limit)); if (existing && existing.id !== limit.id) throw new Error('This position already has a sale limit. Reload to see it.'); const saved = existing ? { ...limit, created_at: existing.created_at, updated_at: now() } : { ...limit, created_at: now(), updated_at: now() }; persist({ ...grainSlice(workspace), grain_sale_limits: existing ? workspace.grain_sale_limits.map((row) => row.id === existing.id ? saved : row) : [...workspace.grain_sale_limits, saved] }); return saved }
  async saveGrainCarrySettings(value: GrainCarrySettings) { const settings = normalizeGrainCarrySettings(value); if (validateGrainCarrySettings(settings).length) throw new Error('Storage costs and rates must be zero or more.'); const workspace = await load(this.fieldsRepository); const saved = { ...settings, updated_at: now() }; persist({ ...grainSlice(workspace), grain_carry_settings: saved }); return saved }
  async saveGrainCarryGrid(value: GrainCarryGrid) { const grid = normalizeGrainCarryGrid(value); if (validateGrainCarryGrid(grid).length) throw new Error('Each price and basis must be a number or blank.'); const workspace = await load(this.fieldsRepository); const existing = workspace.grain_carry_grids.find((row) => row.id === grid.id || row.production_estimate_id === grid.production_estimate_id); if (existing && existing.id !== grid.id) throw new Error('This crop already has a carry grid. Reload to see it.'); const saved = { ...grid, updated_at: now() }; persist({ ...grainSlice(workspace), grain_carry_grids: existing ? workspace.grain_carry_grids.map((row) => row.id === existing.id ? saved : row) : [...workspace.grain_carry_grids, saved] }); return saved }
  async saveGrainAlertSettings(settings: GrainAlertSettings) { const emails = settings.alert_emails.map((email) => email.trim()); if (validateAlertEmails(emails).length) throw new Error('Enter up to three complete email addresses.'); const workspace = await load(this.fieldsRepository); persist({ ...grainSlice(workspace), grain_alert_settings: { ...settings, alert_emails: emails, updated_at: now() } }); }
}
