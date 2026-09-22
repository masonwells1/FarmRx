import { supabase } from '../lib/supabaseClient'
import { localCalendarDay } from './marketingAlerts'
import type { GrainDataGateway, GrainRowBundle, ReplaceMarketingPlanInput } from './GrainDataGateway'
import type { BinTransaction, CashBid, FirmOffer, GrainAlertSettings, GrainBin, GrainCarryGrid, GrainCarrySettings, GrainContract, GrainContractCorrection, GrainContractDelivery, GrainLoadDraft, GrainSaleLimit, MarketingAlertRule, ProductionEstimate } from './grain'
import { normalizeLoadEffects } from './grain'
import { DELETE_PERMISSION_MESSAGE } from './saveDurability'
import { optimisticSave } from './optimisticSave'
import { bindFarmOperationRequest, type FarmOperationContext } from './farmOperationContext'

function rows(data: unknown, error: { message: string } | null): unknown[] { if (error) throw error; if (!Array.isArray(data)) throw new Error('Farm Rx could not load the complete grain workspace.'); return data }

/** GL-2 repair: the bounded cash-bid slices, de-duplicated by id. A row appears in more than one slice
 * whenever it is both recent and the newest of its kind; it must be counted once. The two windowed
 * slices stay inside PostgREST's cap, and the per-commodity slice is at most two rows per commodity. */
export const RECENT_CASH_BID_LIMIT = 750
export const MANUAL_CASH_BID_LIMIT = 250
/** LD-1: the newest tickets. A farm hauling hard writes these faster than any other grain row. */
export const RECENT_GRAIN_LOAD_LIMIT = 500
/** LD-2 repair: the harvest figure SUMS its rows, so a display cap would understate it silently and
 * "Use load total" would overwrite a typed harvest with a partial total. This bound is generous
 * enough for a season's tickets, and one row past it is fetched deliberately so a farm that does
 * exceed it is told the figure is incomplete rather than shown a wrong number. */
export const HARVEST_LOAD_SUM_LIMIT = 5000
/** LD-4: a bin id no farm has, so the capability probe below asks whether the function exists
 * without reading a single row. */
const NIL_UUID = '00000000-0000-0000-0000-000000000000'
export function mergeCashBids(...slices: unknown[][]): unknown[] {
  const byId = new Map<unknown, unknown>()
  for (const row of slices.flat()) {
    const id = row && typeof row === 'object' ? (row as { id?: unknown }).id : undefined
    if (id === undefined) continue
    if (!byId.has(id)) byId.set(id, row)
  }
  return [...byId.values()]
}
function row(data: unknown, error: { message: string } | null): unknown { if (error) throw error; if (!data || typeof data !== 'object') throw new Error('Farm Rx could not confirm the grain save. Please try again.'); return data }
function productionColumns(value: ProductionEstimate) { const { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, planted_acres, aph_yield, expected_bushels, actual_bushels, drives_math, notes } = value; return { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, planted_acres, aph_yield, expected_bushels, actual_bushels, drives_math, notes } }
export function productionActualColumns(actualBushels: number) { return { actual_bushels: actualBushels, drives_math: 'actual' as const } }
function contractColumns(value: GrainContract) { const { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, contract_type, buyer, bushels, futures_price, basis, cash_price, delivery_start, delivery_end, contract_number, premium_cents_per_bu, notes } = value; return { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, contract_type, buyer, bushels, futures_price, basis, cash_price, delivery_start, delivery_end, contract_number, premium_cents_per_bu, notes } }
function bidColumns(value: CashBid) { const { id, farm_id, elevator, commodity_id, bid_date, basis, cash_price, delivery_start, delivery_end, notes } = value; return { id, farm_id, elevator, commodity_id, bid_date, basis, cash_price, delivery_start, delivery_end, notes } }
function alertRuleColumns(value: MarketingAlertRule) { const { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, rule_type, direction, threshold, remind_on, message, active, last_triggered_at } = value; return { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, rule_type, direction, threshold, remind_on, message, active, last_triggered_at } }
function offerColumns(value: FirmOffer) { const { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, buyer, offer_type, bushels, price, basis, contract_month, expires_on, delivery_location, notes, status, filled_contract_id } = value; return { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, buyer, offer_type, bushels, price, basis, contract_month, expires_on, delivery_location, notes, status, filled_contract_id } }
function binColumns(value: GrainBin) { const { id, farm_id, name, capacity_bu, location_type, location_name, notes, moisture_pct, moisture_checked_on } = value; return { id, farm_id, name, capacity_bu, location_type, location_name, notes, moisture_pct, moisture_checked_on } }
function binTransactionColumns(value: BinTransaction) { const { id, farm_id, grain_bin_id, direction, bushels, commodity_id, occurred_on, note, source_kind } = value; return { id, farm_id, grain_bin_id, direction, bushels, commodity_id, occurred_on, note, source_kind } }
function saleLimitColumns(value: GrainSaleLimit) { const { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, sale_limit_bushels } = value; return { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, sale_limit_bushels } }
function carrySettingsColumns(value: GrainCarrySettings) { const { farm_id, mode, monthly_rate_cents_per_bu_month, flat_rate_per_bu, interest_rate_pct, trucking_per_bu } = value; return { farm_id, mode, monthly_rate_cents_per_bu_month, flat_rate_per_bu, interest_rate_pct, trucking_per_bu } }
function carryGridColumns(value: GrainCarryGrid) { const { id, farm_id, production_estimate_id, harvest_month, default_basis, rows } = value; return { id, farm_id, production_estimate_id, harvest_month, default_basis, rows: rows.map(({ market_price, basis }) => ({ market_price, basis })) } }
/** A table that a not-yet-applied migration would add reports 42P01 (PostgreSQL) or PGRST205 (PostgREST). */
export const tableMissing = (error: { code?: string } | null | undefined) => error?.code === '42P01' || error?.code === 'PGRST205'
/** A function a not-yet-applied migration would add reports 42883 (PostgreSQL) or PGRST202 (PostgREST). */
export const functionMissing = (error: { code?: string } | null | undefined) => error?.code === '42883' || error?.code === 'PGRST202'
/** A column a not-yet-applied migration would add reports 42703 (PostgreSQL) or PGRST204 (PostgREST).
 * GL-1's feed columns and GL-2's function are approved and applied separately from the deploy that
 * references them, so a read that names one must tolerate its absence rather than fail the workspace. */
export const columnMissing = (error: { code?: string } | null | undefined) => error?.code === '42703' || error?.code === 'PGRST204'
type QueryResult = { data: unknown; error: { code?: string; message: string } | null }
/** The slice-3 settings tables ship in one migration; any one of them missing means the release is not applied yet and the screens keep their session-only behavior. */
export function settingsSlicesFromResults(saleLimits: QueryResult, carrySettings: QueryResult, carryGrids: QueryResult) {
  const persisted = !(tableMissing(saleLimits.error) || tableMissing(carrySettings.error) || tableMissing(carryGrids.error))
  if (!persisted) return { persisted, grain_sale_limits: [] as unknown[], grain_carry_settings: null as unknown, grain_carry_grids: [] as unknown[] }
  if (carrySettings.error) throw carrySettings.error
  return { persisted, grain_sale_limits: rows(saleLimits.data, saleLimits.error), grain_carry_settings: carrySettings.data, grain_carry_grids: rows(carryGrids.data, carryGrids.error) }
}
/** LD-1: what the browser sends. A blank field is omitted rather than sent as an empty string, so the
 * server's own "absent means derive it" rules stay in force -- notably the commodity and crop year,
 * which the origin decides. Numbers are sent as numbers only when the farmer actually typed one. */
export function grainLoadPayload(id: string, draft: GrainLoadDraft): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    id,
    load_date: draft.load_date,
    origin_kind: draft.origin_kind,
    destination_kind: draft.destination_kind,
    net_bushels: Number(draft.net_bushels),
  }
  if (draft.origin_kind === 'bin') {
    payload.origin_grain_bin_id = draft.origin_grain_bin_id
    // LD-4: the lot the farmer named, sent only when they named one. An absent crop year is the
    // server's cue to default, which it does only for a bin holding a single lot -- so sending a
    // guess here instead would be the one thing the amendment forbids. A field origin sends
    // nothing: its crop assignment already names the lot, and the server refuses any disagreement.
    if (draft.origin_crop_year.trim()) {
      payload.crop_year = Number(draft.origin_crop_year)
      // Both halves of the lot, because a crop year alone does not identify one: a bin can have a
      // record of 2025 soybeans and 2025 corn, and the server refuses rather than picking.
      if (draft.origin_commodity_id) payload.commodity_id = draft.origin_commodity_id
    }
  } else {
    payload.origin_crop_assignment_id = draft.origin_crop_assignment_id
  }
  if (draft.destination_kind === 'buyer') payload.destination_buyer = draft.destination_buyer.trim()
  if (draft.destination_kind === 'contract') payload.destination_grain_contract_id = draft.destination_grain_contract_id
  if (draft.destination_kind === 'bin') payload.destination_grain_bin_id = draft.destination_grain_bin_id
  // LD-2: each effect the farmer confirmed, narrowed to the ones this load's shape can reach. This
  // is the one place the narrowing happens, so a preference the farmer expressed for a different
  // shape can never be sent. All four are sent explicitly, false included, so the server never has
  // to guess what an absent effect meant.
  const effective = normalizeLoadEffects(draft)
  payload.effect_bin_out = effective.effect_bin_out
  payload.effect_bin_in = effective.effect_bin_in
  payload.effect_contract_delivery = effective.effect_contract_delivery
  payload.effect_harvest = effective.effect_harvest
  if (draft.truck_equipment_id) payload.truck_equipment_id = draft.truck_equipment_id
  if (draft.truck_name.trim()) payload.truck_name = draft.truck_name.trim()
  if (draft.gross_lbs.trim()) payload.gross_lbs = Number(draft.gross_lbs)
  if (draft.tare_lbs.trim()) payload.tare_lbs = Number(draft.tare_lbs)
  if (draft.moisture_pct.trim()) payload.moisture_pct = Number(draft.moisture_pct)
  if (draft.ticket_number.trim()) payload.ticket_number = draft.ticket_number.trim()
  if (draft.notes.trim()) payload.notes = draft.notes.trim()
  return payload
}
function contractDeliveryColumns(value: GrainContractDelivery) { const { id, farm_id, grain_contract_id, bushels, delivered_on, note } = value; return { id, farm_id, grain_contract_id, bushels, delivered_on, note } }
async function confirmDelete(table: 'marketing_alert_rules' | 'firm_offers', farmId: string, id: string, context: FarmOperationContext) { const deleted = await bindFarmOperationRequest(supabase.from(table).delete().eq('farm_id', farmId).eq('id', id).select('id'), context); if (deleted.error) throw deleted.error; if (Array.isArray(deleted.data) && deleted.data.some((row) => row.id === id)) return; throw new Error(DELETE_PERMISSION_MESSAGE) }

export class SupabaseGrainDataGateway implements GrainDataGateway {
  async loadWorkspace(farmId: string): Promise<GrainRowBundle> {
    const [permission, production_estimates, grain_contracts, grain_contract_deliveries, marketing_plan_targets, insurance_units, grain_bins, bin_inventory, bin_transactions, cash_bids, manual_cash_bids, per_commodity_cash_bids, usda_report_dates, usda_market_reports, marketing_alert_rules, firm_offers, grain_alert_settings, grain_sale_limits, grain_carry_settings, grain_carry_grids, contract_audit_probe, load_effects_probe, bin_lots_probe, grain_loads] = await Promise.all([
      supabase.rpc('can_read_private_financials', { target_farm_id: farmId }),
      supabase.from('production_estimates').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('id'),
      supabase.from('grain_contracts').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('delivery_start').order('id'),
      supabase.from('grain_contract_deliveries').select('*').eq('farm_id', farmId).order('delivered_on').order('id'),
      supabase.from('marketing_plan_targets').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('target_month').order('id'),
      supabase.from('insurance_units').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('unit_name').order('id'),
      supabase.from('grain_bins').select('*').eq('farm_id', farmId).order('name').order('id'),
      supabase.from('bin_inventory').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('id'),
      supabase.from('bin_transactions').select('*').eq('farm_id', farmId).order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false }),
      // GL-2 repair (Codex P1 on 64cf24c): newest first, and bounded. GL-1 turned cash_bids from a
      // handful of typed rows into a table the USDA feed writes to every market day, so it will cross
      // PostgREST's row cap. Ascending and unbounded, the browser would then receive the OLDEST rows,
      // find no fresh eligible bid, and record the rule condition false while the server still sees a
      // current one -- which the next sweep reads as a new transition and notifies on, again and again.
      // The second slice keeps the farm's own bids reachable however much feed history sits in front of
      // them, so valuation never loses a manual bid to feed volume. The repository re-sorts ascending.
      // It names feed_source, which GL-1's migration adds and which is applied separately from this
      // deploy, so its absence is tolerated: before GL-1 there are no feed rows at all and the recent
      // window above already holds every bid the farm has.
      supabase.from('cash_bids').select('*').eq('farm_id', farmId).order('bid_date', { ascending: false }).order('id', { ascending: false }).limit(RECENT_CASH_BID_LIMIT),
      // A row written before GL-1 added feed_source carries its provenance in the note, and isMarsBid
      // honours both. Excluding only by column would let legacy feed rows fill this slice and crowd out
      // the farm's real manual bids, which is what the slice exists to protect.
      // The null branch is not optional. A manual bid normally stores no note at all, and in SQL
      // `not (null like '...')` is null, not true -- so a bare not.like would have dropped every
      // ordinary manual bid from the slice built to keep them, which is worse than the legacy rows it
      // was added to exclude. Null notes are admitted explicitly.
      supabase.from('cash_bids').select('*').eq('farm_id', farmId).is('feed_source', null).or('notes.is.null,notes.not.like."[USDA MARS %"').order('bid_date', { ascending: false }).order('id', { ascending: false }).limit(MANUAL_CASH_BID_LIMIT),
      // A cap keeps the newest rows; it cannot promise the newest row FOR EACH COMMODITY, which is what
      // latestBasis, the counterparty suggestions and the Today grain line actually read. Those rows are
      // few and knowable, so they are fetched exactly. Tolerated as absent before the GL-2 migration is
      // applied, exactly as the other not-yet-applied reads are.
      supabase.rpc('latest_cash_bids_per_commodity', { p_farm_id: farmId }),
      supabase.from('usda_report_dates').select('*').order('report_date').order('id'),
      supabase.from('usda_market_reports').select('*').order('report_id'),
      supabase.from('marketing_alert_rules').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('created_at').order('id'),
      supabase.from('firm_offers').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('created_at').order('id'),
      supabase.from('grain_alert_settings').select('*').eq('farm_id', farmId).maybeSingle(),
      supabase.from('grain_sale_limits').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('id'),
      supabase.from('grain_carry_settings').select('*').eq('farm_id', farmId).maybeSingle(),
      supabase.from('grain_carry_grids').select('*').eq('farm_id', farmId).order('production_estimate_id'),
      // GL-3b capability probe. The audit table and the two contract-repair RPCs are one release, so
      // the table's absence is the one truthful signal that the Correct and Delete controls would fail.
      // One indexed read of at most one row; its contents are not used.
      supabase.from('grain_contract_audit').select('id').eq('farm_id', farmId).limit(1),
      // LD-2 probe: naming a column the migration adds is the only way to tell an LD-1 database
      // from an LD-2 one. `select('*')` on the same table succeeds either way and tells us nothing.
      supabase.from('grain_loads').select('id,effect_harvest').eq('farm_id', farmId).limit(1),
      // LD-4: whether public.bin_lots is installed, which is whether save_grain_load will accept a
      // crop year that is not the bin's baseline. Asked as a function call because that is the only
      // honest question: the columns it reads have existed since LD-2. The nil bin id returns no
      // rows on any farm, so this costs one round trip and reads nothing.
      supabase.rpc('bin_lots', { p_farm_id: farmId, p_grain_bin_id: NIL_UUID }),
      // LD-1. This read is its own capability probe: grain_loads and its two RPCs are one release, so
      // the table's absence is the one truthful signal that the Loads tab cannot save anything. Newest
      // first, and bounded -- a farm hauling all week generates loads faster than any other grain row,
      // and an unbounded ascending read would hand the browser the oldest tickets once the table
      // crosses PostgREST's cap, which is the GL-2 cash-bid defect repeated.
      supabase.from('grain_loads').select('*').eq('farm_id', farmId).order('load_date', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(RECENT_GRAIN_LOAD_LIMIT),
    ])
    if (permission.error) throw permission.error
    if (permission.data !== true) throw new Error('GRAIN_PRIVATE_ACCESS_DENIED')
    if (grain_alert_settings.error) throw grain_alert_settings.error
    const deliveriesUnavailable = grain_contract_deliveries.error?.code === '42P01' || grain_contract_deliveries.error?.code === 'PGRST205'
    if (grain_contract_deliveries.error && !deliveriesUnavailable) throw grain_contract_deliveries.error
    // 0033 introduces this table and both dependent RPCs as one release. Its
    // absence is the one truthful compatibility signal for all three controls.
    const post0033 = !deliveriesUnavailable
    // GL-1 introduces the report mapping; before that migration is applied live the Grain page simply has no reports to name.
    const marketReportsUnavailable = usda_market_reports.error?.code === '42P01' || usda_market_reports.error?.code === 'PGRST205'
    // LD-1 is applied separately from the deploy that reads it, like every migration before it.
    const loadsUnavailable = tableMissing(grain_loads.error)
    const settingsSlices = settingsSlicesFromResults(grain_sale_limits, grain_carry_settings, grain_carry_grids)
    return { production_estimates: rows(production_estimates.data, production_estimates.error), grain_contracts: rows(grain_contracts.data, grain_contracts.error), grain_contract_deliveries: deliveriesUnavailable ? [] : rows(grain_contract_deliveries.data, grain_contract_deliveries.error), marketing_plan_targets: rows(marketing_plan_targets.data, marketing_plan_targets.error), insurance_units: rows(insurance_units.data, insurance_units.error), grain_bins: rows(grain_bins.data, grain_bins.error), bin_inventory: rows(bin_inventory.data, bin_inventory.error), bin_transactions: rows(bin_transactions.data, bin_transactions.error), cash_bids: mergeCashBids(rows(cash_bids.data, cash_bids.error), columnMissing(manual_cash_bids.error) ? [] : rows(manual_cash_bids.data, manual_cash_bids.error), functionMissing(per_commodity_cash_bids.error) ? [] : rows(per_commodity_cash_bids.data, per_commodity_cash_bids.error)), usda_report_dates: rows(usda_report_dates.data, usda_report_dates.error), usda_market_reports: marketReportsUnavailable ? [] : rows(usda_market_reports.data, usda_market_reports.error), marketing_alert_rules: rows(marketing_alert_rules.data, marketing_alert_rules.error), firm_offers: rows(firm_offers.data, firm_offers.error), grain_alert_settings: grain_alert_settings.data, grain_sale_limits: settingsSlices.grain_sale_limits, grain_carry_settings: settingsSlices.grain_carry_settings, grain_carry_grids: settingsSlices.grain_carry_grids, grain_loads: loadsUnavailable ? [] : rows(grain_loads.data, grain_loads.error), capabilities: { bin_movements: post0033, contract_price_finalization: post0033, contract_deliveries: post0033, persisted_settings: settingsSlices.persisted, gl2_alert_eligibility: !functionMissing(per_commodity_cash_bids.error), contract_edit_delete: !tableMissing(contract_audit_probe.error), grain_loads: !loadsUnavailable, grain_load_effects: !(tableMissing(load_effects_probe.error) || columnMissing(load_effects_probe.error)), grain_load_bin_lot: !functionMissing(bin_lots_probe.error) } }
  }
  async upsertProductionEstimate(farmId: string, value: ProductionEstimate, context: FarmOperationContext) { return optimisticSave('production_estimates', farmId, value.id, { ...productionColumns(value), farm_id: farmId }, value.updated_at, context) }
  async updateProductionActual(farmId: string, id: string, actualBushels: number, expectedUpdatedAt: string, context: FarmOperationContext) { return optimisticSave('production_estimates', farmId, id, productionActualColumns(actualBushels), expectedUpdatedAt, context) }
  async upsertContract(farmId: string, value: GrainContract, context: FarmOperationContext) { return optimisticSave('grain_contracts', farmId, value.id, { ...contractColumns(value), farm_id: farmId }, value.updated_at, context) }
  async replaceMarketingPlan(input: ReplaceMarketingPlanInput) {
    const { scope, targets, farmId, context } = input
    const { data, error } = await bindFarmOperationRequest(supabase.rpc('replace_marketing_plan_targets', { p_farm_id: farmId, p_crop_year: scope.crop_year, p_commodity_id: scope.commodity_id, p_operating_entity_id: scope.operating_entity_id, p_enterprise_label: scope.enterprise_label, p_targets: targets.map(({ created_at: _created, updated_at: _updated, ...target }) => target) }), context)
    return rows(data, error)
  }
  async upsertCashBid(farmId: string, value: CashBid, context: FarmOperationContext) { return optimisticSave('cash_bids', farmId, value.id, { ...bidColumns(value), farm_id: farmId }, value.updated_at, context) }
  async upsertMarketingAlertRule(farmId: string, value: MarketingAlertRule, context: FarmOperationContext) { return optimisticSave('marketing_alert_rules', farmId, value.id, { ...alertRuleColumns(value), farm_id: farmId }, value.updated_at, context) }
  async deleteMarketingAlertRule(farmId: string, id: string, context: FarmOperationContext) { return confirmDelete('marketing_alert_rules', farmId, id, context) }
  async upsertFirmOffer(farmId: string, value: FirmOffer, context: FarmOperationContext) { return optimisticSave('firm_offers', farmId, value.id, { ...offerColumns(value), farm_id: farmId }, value.updated_at, context) }
  async fillFirmOffer(_farmId: string, offerId: string, value: GrainContract, context: FarmOperationContext) { const { data, error } = await bindFarmOperationRequest(supabase.rpc('fill_firm_offer', { p_offer_id: offerId, p_contract: contractColumns(value), p_local_date: localCalendarDay(new Date()) }), context); if (error) throw error; return row(data, null) }
  async deleteFirmOffer(farmId: string, id: string, context: FarmOperationContext) { return confirmDelete('firm_offers', farmId, id, context) }
  async upsertGrainBin(farmId: string, value: GrainBin, context: FarmOperationContext) { return optimisticSave('grain_bins', farmId, value.id, { ...binColumns(value), farm_id: farmId }, value.updated_at, context) }
  async appendBinTransactionRpc(farmId: string, value: BinTransaction, context: FarmOperationContext) { const { data, error } = await bindFarmOperationRequest(supabase.rpc('append_bin_movement', { p_farm_id: farmId, p_transaction: binTransactionColumns(value) }), context); if (error) throw error; return row(data, null) }
  async appendContractDeliveryRpc(farmId: string, value: GrainContractDelivery, allowOverdelivery: boolean, context: FarmOperationContext) { const { data, error } = await bindFarmOperationRequest(supabase.rpc('record_grain_contract_delivery', { p_farm_id: farmId, p_delivery: { ...contractDeliveryColumns(value), allow_overdelivery: allowOverdelivery } }), context); if (error) throw error; return row(data, null) }
  async finalizeContractPriceLegRpc(farmId: string, contractId: string, leg: 'futures_price' | 'basis', value: number, context: FarmOperationContext) { const { data, error } = await bindFarmOperationRequest(supabase.rpc('finalize_contract_price_leg', { p_farm_id: farmId, p_contract_id: contractId, p_leg: leg, p_value: value }), context); if (error) throw error; return row(data, null) }
  // GL-3b: the correction and the delete are server-owned. "This contract has no deliveries" has to be
  // decided under a row lock, the reason is not optional, and the audit row and the change are one
  // transaction -- none of which a direct table write from the browser can promise.
  async editContractRpc(farmId: string, contractId: string, reason: string, changes: GrainContractCorrection, expectedUpdatedAt: string, operationId: string, context: FarmOperationContext) { const { data, error } = await bindFarmOperationRequest(supabase.rpc('edit_grain_contract', { p_farm_id: farmId, p_contract_id: contractId, p_reason: reason, p_changes: changes, p_expected_updated_at: expectedUpdatedAt, p_operation_id: operationId }), context); if (error) throw error; return row(data, null) }
  async deleteContractRpc(farmId: string, contractId: string, reason: string, expectedUpdatedAt: string, operationId: string, context: FarmOperationContext) { const { data, error } = await bindFarmOperationRequest(supabase.rpc('delete_grain_contract', { p_farm_id: farmId, p_contract_id: contractId, p_reason: reason, p_expected_updated_at: expectedUpdatedAt, p_operation_id: operationId }), context); if (error) throw error; return data }
  // LD-1: both load writes are server-owned. The commodity and crop year are derived from the origin
  // under a row lock, the idempotency key is checked there, and the void is one transaction -- none of
  // which a direct table write from the browser can promise. The table grants SELECT and nothing else.
  // LD-1: read only when the Loads form is open. Today serves its front door from loadWorkspace
  // above, and a named rep's Today must make no equipment read at all, so this cannot live there.
  /** LD-4 repair (Codex P1 on ba64007): the lots one bin holds, from the database rather than from
   * the workspace's movement array. loadWorkspace reads bin_transactions unbounded, so PostgREST's
   * row cap can drop the OLDEST movements -- and an older still-active crop year with them. The
   * browser would then see one lot where the server sees two, offer no choice, send no crop year,
   * and the save would be refused with "pick which one this load came from" while the form shows
   * no picker to answer with. That is a load a farmer cannot record at all.
   *
   * This asks public.bin_lots for one bin, which is at most a handful of rows and is the same
   * function save_grain_load itself reads -- so the picker and the save can no longer disagree. */
  async listBinLots(farmId: string, binId: string, context: FarmOperationContext) { const { data, error } = await bindFarmOperationRequest(supabase.rpc('bin_lots', { p_farm_id: farmId, p_grain_bin_id: binId }), context); if (error) throw error; return rows(data, null) }
  async listLoadTrucks(farmId: string, context: FarmOperationContext) { const { data, error } = await bindFarmOperationRequest(supabase.from('equipment').select('id,name').eq('farm_id', farmId).eq('category', 'truck').eq('status', 'active').order('name').order('id'), context); return rows(data, error) }
  /** LD-2: only the tickets that actually contribute -- confirmed for harvest and not voided. A row
   * the migration has not reached reports 42703/PGRST204 on effect_harvest, and an LD-1 database has
   * no effect column at all, so an absent column reads as no contributing loads rather than an error
   * on a screen that has nothing to do with grain. */
  async listHarvestLoads(farmId: string, context: FarmOperationContext) { const { data, error } = await bindFarmOperationRequest(supabase.from('grain_loads').select('*').eq('farm_id', farmId).eq('effect_harvest', true).is('voided_at', null).order('load_date', { ascending: false }).limit(HARVEST_LOAD_SUM_LIMIT + 1), context); if (error && (columnMissing(error) || tableMissing(error))) return []; return rows(data, error) }
  async assignBinMovementCropYearRpc(farmId: string, transactionId: string, cropYear: number, context: FarmOperationContext) { const { data, error } = await bindFarmOperationRequest(supabase.rpc('assign_bin_movement_crop_year', { p_farm_id: farmId, p_transaction_id: transactionId, p_crop_year: cropYear }), context); if (error) throw error; return row(data, null) }
  async saveGrainLoadRpc(farmId: string, id: string, draft: GrainLoadDraft, context: FarmOperationContext) { const { data, error } = await bindFarmOperationRequest(supabase.rpc('save_grain_load', { p_farm_id: farmId, p_load: grainLoadPayload(id, draft) }), context); if (error) throw error; return row(data, null) }
  async voidGrainLoadRpc(farmId: string, loadId: string, reason: string, context: FarmOperationContext) { const { data, error } = await bindFarmOperationRequest(supabase.rpc('void_grain_load', { p_farm_id: farmId, p_load_id: loadId, p_reason: reason }), context); if (error) throw error; return row(data, null) }
  async upsertGrainAlertSettings(farmId: string, value: GrainAlertSettings, context: FarmOperationContext) { return optimisticSave('grain_alert_settings', farmId, farmId, { farm_id: farmId, alert_emails: value.alert_emails }, value.updated_at, context, 'farm_id') }
  async upsertGrainSaleLimit(farmId: string, value: GrainSaleLimit, context: FarmOperationContext) { return optimisticSave('grain_sale_limits', farmId, value.id, { ...saleLimitColumns(value), farm_id: farmId }, value.updated_at, context) }
  async upsertGrainCarrySettings(farmId: string, value: GrainCarrySettings, context: FarmOperationContext) { return optimisticSave('grain_carry_settings', farmId, farmId, { ...carrySettingsColumns(value), farm_id: farmId }, value.updated_at, context, 'farm_id') }
  async upsertGrainCarryGrid(farmId: string, value: GrainCarryGrid, context: FarmOperationContext) { return optimisticSave('grain_carry_grids', farmId, value.id, { ...carryGridColumns(value), farm_id: farmId }, value.updated_at, context) }
}
