import { supabase } from '../lib/supabaseClient'
import { localCalendarDay } from './marketingAlerts'
import type { GrainDataGateway, GrainRowBundle, ReplaceMarketingPlanInput } from './GrainDataGateway'
import type { BinTransaction, CashBid, FirmOffer, GrainAlertSettings, GrainBin, GrainContract, GrainContractDelivery, MarketingAlertRule, ProductionEstimate } from './grain'
import { DELETE_PERMISSION_MESSAGE } from './saveDurability'

function rows(data: unknown, error: { message: string } | null): unknown[] { if (error) throw error; if (!Array.isArray(data)) throw new Error('Farm Rx could not load the complete grain workspace.'); return data }
function row(data: unknown, error: { message: string } | null): unknown { if (error) throw error; if (!data || typeof data !== 'object') throw new Error('Farm Rx could not confirm the grain save. Please try again.'); return data }
function productionColumns(value: ProductionEstimate) { const { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, planted_acres, aph_yield, expected_bushels, actual_bushels, drives_math, notes } = value; return { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, planted_acres, aph_yield, expected_bushels, actual_bushels, drives_math, notes } }
function contractColumns(value: GrainContract) { const { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, contract_type, buyer, bushels, futures_price, basis, cash_price, delivery_start, delivery_end, contract_number, premium_cents_per_bu, notes } = value; return { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, contract_type, buyer, bushels, futures_price, basis, cash_price, delivery_start, delivery_end, contract_number, premium_cents_per_bu, notes } }
function bidColumns(value: CashBid) { const { id, farm_id, elevator, commodity_id, bid_date, basis, cash_price, delivery_start, delivery_end, notes } = value; return { id, farm_id, elevator, commodity_id, bid_date, basis, cash_price, delivery_start, delivery_end, notes } }
function alertRuleColumns(value: MarketingAlertRule) { const { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, rule_type, direction, threshold, remind_on, message, active, last_triggered_at } = value; return { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, rule_type, direction, threshold, remind_on, message, active, last_triggered_at } }
function offerColumns(value: FirmOffer) { const { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, buyer, offer_type, bushels, price, basis, contract_month, expires_on, delivery_location, notes, status, filled_contract_id } = value; return { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, buyer, offer_type, bushels, price, basis, contract_month, expires_on, delivery_location, notes, status, filled_contract_id } }
function binColumns(value: GrainBin) { const { id, farm_id, name, capacity_bu, location_type, location_name, notes, moisture_pct, moisture_checked_on } = value; return { id, farm_id, name, capacity_bu, location_type, location_name, notes, moisture_pct, moisture_checked_on } }
function binTransactionColumns(value: BinTransaction) { const { id, farm_id, grain_bin_id, direction, bushels, commodity_id, occurred_on, note, source_kind } = value; return { id, farm_id, grain_bin_id, direction, bushels, commodity_id, occurred_on, note, source_kind } }
function contractDeliveryColumns(value: GrainContractDelivery) { const { id, farm_id, grain_contract_id, bushels, delivered_on, note } = value; return { id, farm_id, grain_contract_id, bushels, delivered_on, note } }
async function confirmDelete(table: 'marketing_alert_rules' | 'firm_offers', farmId: string, id: string) { const deleted = await supabase.from(table).delete().eq('farm_id', farmId).eq('id', id).select('id'); if (deleted.error) throw deleted.error; if (Array.isArray(deleted.data) && deleted.data.some((row) => row.id === id)) return; const existing = await supabase.from(table).select('id').eq('farm_id', farmId).eq('id', id).maybeSingle(); if (existing.error) throw existing.error; if (!existing.data) return; throw new Error(DELETE_PERMISSION_MESSAGE) }

export class SupabaseGrainDataGateway implements GrainDataGateway {
  async loadWorkspace(farmId: string): Promise<GrainRowBundle> {
    const [permission, production_estimates, grain_contracts, grain_contract_deliveries, marketing_plan_targets, insurance_units, grain_bins, bin_inventory, bin_transactions, cash_bids, usda_report_dates, marketing_alert_rules, firm_offers, grain_alert_settings] = await Promise.all([
      supabase.rpc('can_read_private_financials', { target_farm_id: farmId }),
      supabase.from('production_estimates').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('id'),
      supabase.from('grain_contracts').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('delivery_start').order('id'),
      supabase.from('grain_contract_deliveries').select('*').eq('farm_id', farmId).order('delivered_on').order('id'),
      supabase.from('marketing_plan_targets').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('target_month').order('id'),
      supabase.from('insurance_units').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('unit_name').order('id'),
      supabase.from('grain_bins').select('*').eq('farm_id', farmId).order('name').order('id'),
      supabase.from('bin_inventory').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('id'),
      supabase.from('bin_transactions').select('*').eq('farm_id', farmId).order('occurred_on', { ascending: false }).order('created_at', { ascending: false }).order('id', { ascending: false }),
      supabase.from('cash_bids').select('*').eq('farm_id', farmId).order('bid_date').order('id'),
      supabase.from('usda_report_dates').select('*').order('report_date').order('id'),
      supabase.from('marketing_alert_rules').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('created_at').order('id'),
      supabase.from('firm_offers').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('created_at').order('id'),
      supabase.from('grain_alert_settings').select('*').eq('farm_id', farmId).maybeSingle(),
    ])
    if (permission.error) throw permission.error
    if (permission.data !== true) throw new Error('GRAIN_PRIVATE_ACCESS_DENIED')
    if (grain_alert_settings.error) throw grain_alert_settings.error
    const deliveriesUnavailable = grain_contract_deliveries.error?.code === '42P01' || grain_contract_deliveries.error?.code === 'PGRST205'
    if (grain_contract_deliveries.error && !deliveriesUnavailable) throw grain_contract_deliveries.error
    // 0033 introduces this table and both dependent RPCs as one release. Its
    // absence is the one truthful compatibility signal for all three controls.
    const post0033 = !deliveriesUnavailable
    return { production_estimates: rows(production_estimates.data, production_estimates.error), grain_contracts: rows(grain_contracts.data, grain_contracts.error), grain_contract_deliveries: deliveriesUnavailable ? [] : rows(grain_contract_deliveries.data, grain_contract_deliveries.error), marketing_plan_targets: rows(marketing_plan_targets.data, marketing_plan_targets.error), insurance_units: rows(insurance_units.data, insurance_units.error), grain_bins: rows(grain_bins.data, grain_bins.error), bin_inventory: rows(bin_inventory.data, bin_inventory.error), bin_transactions: rows(bin_transactions.data, bin_transactions.error), cash_bids: rows(cash_bids.data, cash_bids.error), usda_report_dates: rows(usda_report_dates.data, usda_report_dates.error), marketing_alert_rules: rows(marketing_alert_rules.data, marketing_alert_rules.error), firm_offers: rows(firm_offers.data, firm_offers.error), grain_alert_settings: grain_alert_settings.data, capabilities: { bin_movements: post0033, contract_price_finalization: post0033, contract_deliveries: post0033 } }
  }
  async upsertProductionEstimate(farmId: string, value: ProductionEstimate) { const result = await supabase.from('production_estimates').upsert({ ...productionColumns(value), farm_id: farmId }, { onConflict: 'id' }).select('*').single(); return row(result.data, result.error) }
  async upsertContract(farmId: string, value: GrainContract) { const result = await supabase.from('grain_contracts').upsert({ ...contractColumns(value), farm_id: farmId }, { onConflict: 'id' }).select('*').single(); return row(result.data, result.error) }
  async replaceMarketingPlan(input: ReplaceMarketingPlanInput) {
    const { scope, targets, farmId } = input
    const { data, error } = await supabase.rpc('replace_marketing_plan_targets', { p_farm_id: farmId, p_crop_year: scope.crop_year, p_commodity_id: scope.commodity_id, p_operating_entity_id: scope.operating_entity_id, p_enterprise_label: scope.enterprise_label, p_targets: targets.map(({ created_at: _created, updated_at: _updated, ...target }) => target) })
    return rows(data, error)
  }
  async upsertCashBid(farmId: string, value: CashBid) { const result = await supabase.from('cash_bids').upsert({ ...bidColumns(value), farm_id: farmId }, { onConflict: 'id' }).select('*').single(); return row(result.data, result.error) }
  async upsertMarketingAlertRule(farmId: string, value: MarketingAlertRule) { const result = await supabase.from('marketing_alert_rules').upsert({ ...alertRuleColumns(value), farm_id: farmId }, { onConflict: 'id' }).select('*').single(); return row(result.data, result.error) }
  async deleteMarketingAlertRule(farmId: string, id: string) { return confirmDelete('marketing_alert_rules', farmId, id) }
  async upsertFirmOffer(farmId: string, value: FirmOffer) { const result = await supabase.from('firm_offers').upsert({ ...offerColumns(value), farm_id: farmId }, { onConflict: 'id' }).select('*').single(); return row(result.data, result.error) }
  async fillFirmOffer(_farmId: string, offerId: string, value: GrainContract) { const { data, error } = await supabase.rpc('fill_firm_offer', { p_offer_id: offerId, p_contract: contractColumns(value), p_local_date: localCalendarDay(new Date()) }); if (error) throw error; return row(data, null) }
  async deleteFirmOffer(farmId: string, id: string) { return confirmDelete('firm_offers', farmId, id) }
  async upsertGrainBin(farmId: string, value: GrainBin) { const result = await supabase.from('grain_bins').upsert({ ...binColumns(value), farm_id: farmId }, { onConflict: 'id' }).select('*').single(); return row(result.data, result.error) }
  async appendBinTransactionRpc(farmId: string, value: BinTransaction) { const { data, error } = await supabase.rpc('append_bin_movement', { p_farm_id: farmId, p_transaction: binTransactionColumns(value) }); if (error) throw error; return row(data, null) }
  async appendContractDeliveryRpc(farmId: string, value: GrainContractDelivery, allowOverdelivery: boolean) { const { data, error } = await supabase.rpc('record_grain_contract_delivery', { p_farm_id: farmId, p_delivery: { ...contractDeliveryColumns(value), allow_overdelivery: allowOverdelivery } }); if (error) throw error; return row(data, null) }
  async finalizeContractPriceLegRpc(farmId: string, contractId: string, leg: 'futures_price' | 'basis', value: number) { const { data, error } = await supabase.rpc('finalize_contract_price_leg', { p_farm_id: farmId, p_contract_id: contractId, p_leg: leg, p_value: value }); if (error) throw error; return row(data, null) }
  async upsertGrainAlertSettings(farmId: string, value: GrainAlertSettings) { const result = await supabase.from('grain_alert_settings').upsert({ farm_id: farmId, alert_emails: value.alert_emails }, { onConflict: 'farm_id' }).select('*').single(); return row(result.data, result.error) }
}
