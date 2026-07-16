import { supabase } from '../lib/supabaseClient'
import type { AdjustmentWrite, ApplicationBundleWrite, CancelReceiptWrite, InventoryDataGateway, InventoryProductWrite, InventoryRowBundle, ReceiptBundleWrite } from './InventoryDataGateway'
import { optimisticSave } from './optimisticSave'
import { bindFarmOperationRequest, type FarmOperationContext } from './farmOperationContext'

function rows(data: unknown, error: { message: string } | null): unknown[] { if (error) throw error; if (!Array.isArray(data)) throw new Error('Farm Rx could not load the complete inventory workspace.'); return data }
function row(data: unknown, error: { message: string } | null): unknown { if (error) throw error; if (!data || typeof data !== 'object') throw new Error('Farm Rx could not confirm the inventory save. Please try again.'); return data }
function productColumns(value: InventoryProductWrite & { farm_id: string }) { const { id, farm_id, product_kind, name, manufacturer, inventory_unit, epa_registration_number, is_restricted_use, signal_word, restricted_entry_interval_hours, preharvest_interval_hours, max_label_rate, max_label_rate_unit, max_label_rate_basis, commodity_id, variety_name, fertilizer_analysis, is_active } = value; return { id, farm_id, product_kind, name, manufacturer, inventory_unit, epa_registration_number, is_restricted_use, signal_word, restricted_entry_interval_hours, preharvest_interval_hours, max_label_rate, max_label_rate_unit, max_label_rate_basis, commodity_id, variety_name, fertilizer_analysis, is_active } }

export class SupabaseInventoryDataGateway implements InventoryDataGateway {
  async loadWorkspace(farmId: string): Promise<InventoryRowBundle> {
    const [products, receipts, receipt_lines, adjustments, applications, application_products, program_application_products, on_hand, rup_completeness] = await Promise.all([
      supabase.from('inventory_products').select('*').eq('farm_id', farmId).order('name').order('id'),
      supabase.from('inventory_receipts').select('*').eq('farm_id', farmId).order('created_at').order('id'),
      supabase.from('inventory_receipt_lines').select('*').eq('farm_id', farmId).order('receipt_id').order('id'),
      supabase.from('inventory_adjustments').select('*').eq('farm_id', farmId).order('adjusted_at').order('id'),
      supabase.from('application_records').select('*').eq('farm_id', farmId).order('application_date').order('id'),
      supabase.from('application_products').select('*').eq('farm_id', farmId).order('application_id').order('id'),
      supabase.from('program_application_products').select('*').eq('farm_id', farmId).order('application_record_id').order('sequence'),
      supabase.from('inventory_on_hand').select('*').eq('farm_id', farmId).order('product_id'),
      supabase.from('rup_application_completeness').select('*').eq('farm_id', farmId).order('application_id').order('application_product_id'),
    ])
    return { products: rows(products.data, products.error), receipts: rows(receipts.data, receipts.error), receipt_lines: rows(receipt_lines.data, receipt_lines.error), adjustments: rows(adjustments.data, adjustments.error), applications: rows(applications.data, applications.error), application_products: rows(application_products.data, application_products.error), program_application_products: rows(program_application_products.data, program_application_products.error), on_hand: rows(on_hand.data, on_hand.error), rup_completeness: rows(rup_completeness.data, rup_completeness.error) }
  }
  async upsertProduct(farmId: string, value: InventoryProductWrite, expectedUpdatedAt: string | null | undefined, context: FarmOperationContext) { return optimisticSave('inventory_products', farmId, value.id, productColumns({ ...value, farm_id: farmId }), expectedUpdatedAt, context) }
  async saveReceiptBundle(input: ReceiptBundleWrite, context: FarmOperationContext) { const { data, error } = await bindFarmOperationRequest(supabase.rpc('save_inventory_receipt_bundle', { p_farm_id: input.farmId, p_receipt: input.receipt, p_lines: input.lines }), context); return row(data, error) }
  async cancelReceipt(input: CancelReceiptWrite, context: FarmOperationContext) {
    const update = await bindFarmOperationRequest(supabase.from('inventory_receipts').update({ status: 'cancelled', cancellation_reason: input.reason, cancelled_at: input.cancelledAt }).eq('farm_id', input.farmId).eq('id', input.id).eq('status', 'received').select('*').maybeSingle(), context)
    if (update.error) throw update.error
    if (update.data) return update.data
    const existing = await supabase.from('inventory_receipts').select('*').eq('farm_id', input.farmId).eq('id', input.id).maybeSingle()
    return row(existing.data, existing.error)
  }
  async insertAdjustment(farmId: string, value: AdjustmentWrite, context: FarmOperationContext) { const existing = await supabase.from('inventory_adjustments').select('*').eq('farm_id', farmId).eq('id', value.id).maybeSingle(); if (existing.error) throw existing.error; if (existing.data) return row(existing.data, null); const result = await bindFarmOperationRequest(supabase.from('inventory_adjustments').insert({ ...value, farm_id: farmId, created_by: context.userId }).select('*').single(), context); return row(result.data, result.error) }
  async saveApplicationBundle(input: ApplicationBundleWrite, context: FarmOperationContext) { const { data, error } = await bindFarmOperationRequest(supabase.rpc('save_inventory_application_bundle', { p_farm_id: input.farmId, p_application: input.application, p_products: input.products }), context); return row(data, error) }
}
