import { supabase } from '../lib/supabaseClient'
import type { GrainDataGateway, GrainRowBundle, ReplaceMarketingPlanInput } from './GrainDataGateway'
import type { CashBid, GrainAlertSettings, GrainContract, MarketingAlertRule, ProductionEstimate } from './grain'

function rows(data: unknown, error: { message: string } | null): unknown[] { if (error) throw error; if (!Array.isArray(data)) throw new Error('Farm Rx could not load the complete grain workspace.'); return data }
function row(data: unknown, error: { message: string } | null): unknown { if (error) throw error; if (!data || typeof data !== 'object') throw new Error('Farm Rx could not confirm the grain save. Please try again.'); return data }
function productionColumns(value: ProductionEstimate) { const { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, planted_acres, aph_yield, expected_bushels, actual_bushels, drives_math, notes } = value; return { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, planted_acres, aph_yield, expected_bushels, actual_bushels, drives_math, notes } }
function contractColumns(value: GrainContract) { const { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, contract_type, buyer, bushels, futures_price, basis, cash_price, delivery_start, delivery_end, contract_number, premium_cents_per_bu, notes } = value; return { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, contract_type, buyer, bushels, futures_price, basis, cash_price, delivery_start, delivery_end, contract_number, premium_cents_per_bu, notes } }
function bidColumns(value: CashBid) { const { id, farm_id, elevator, commodity_id, bid_date, basis, cash_price, delivery_start, delivery_end, notes } = value; return { id, farm_id, elevator, commodity_id, bid_date, basis, cash_price, delivery_start, delivery_end, notes } }
function alertRuleColumns(value: MarketingAlertRule) { const { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, rule_type, direction, threshold, remind_on, message, active, last_triggered_at } = value; return { id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, rule_type, direction, threshold, remind_on, message, active, last_triggered_at } }

export class SupabaseGrainDataGateway implements GrainDataGateway {
  async loadWorkspace(farmId: string): Promise<GrainRowBundle> {
    const [permission, production_estimates, grain_contracts, marketing_plan_targets, insurance_units, grain_bins, bin_inventory, cash_bids, usda_report_dates, marketing_alert_rules, grain_alert_settings] = await Promise.all([
      supabase.rpc('can_read_private_financials', { target_farm_id: farmId }),
      supabase.from('production_estimates').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('id'),
      supabase.from('grain_contracts').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('delivery_start').order('id'),
      supabase.from('marketing_plan_targets').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('target_month').order('id'),
      supabase.from('insurance_units').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('unit_name').order('id'),
      supabase.from('grain_bins').select('*').eq('farm_id', farmId).order('name').order('id'),
      supabase.from('bin_inventory').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('id'),
      supabase.from('cash_bids').select('*').eq('farm_id', farmId).order('bid_date').order('id'),
      supabase.from('usda_report_dates').select('*').order('report_date').order('id'),
      supabase.from('marketing_alert_rules').select('*').eq('farm_id', farmId).order('crop_year').order('commodity_id').order('created_at').order('id'),
      supabase.from('grain_alert_settings').select('*').eq('farm_id', farmId).maybeSingle(),
    ])
    if (permission.error) throw permission.error
    if (permission.data !== true) throw new Error('GRAIN_PRIVATE_ACCESS_DENIED')
    if (grain_alert_settings.error) throw grain_alert_settings.error
    return { production_estimates: rows(production_estimates.data, production_estimates.error), grain_contracts: rows(grain_contracts.data, grain_contracts.error), marketing_plan_targets: rows(marketing_plan_targets.data, marketing_plan_targets.error), insurance_units: rows(insurance_units.data, insurance_units.error), grain_bins: rows(grain_bins.data, grain_bins.error), bin_inventory: rows(bin_inventory.data, bin_inventory.error), cash_bids: rows(cash_bids.data, cash_bids.error), usda_report_dates: rows(usda_report_dates.data, usda_report_dates.error), marketing_alert_rules: rows(marketing_alert_rules.data, marketing_alert_rules.error), grain_alert_settings: grain_alert_settings.data }
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
  async deleteMarketingAlertRule(farmId: string, id: string) { const result = await supabase.from('marketing_alert_rules').delete().eq('farm_id', farmId).eq('id', id).select('id'); if (result.error) throw result.error; if (!Array.isArray(result.data) || !result.data.some((item) => item && typeof item === 'object' && (item as { id?: unknown }).id === id)) throw new Error('Farm Rx could not delete this alert rule. You may not have permission.') }
  async upsertGrainAlertSettings(farmId: string, value: GrainAlertSettings) { const result = await supabase.from('grain_alert_settings').upsert({ farm_id: farmId, alert_emails: value.alert_emails }, { onConflict: 'farm_id' }).select('*').single(); return row(result.data, result.error) }
}
