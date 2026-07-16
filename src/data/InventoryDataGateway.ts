import type { AdjustmentInput, ApplicationInput, InventoryProduct, ReceiptInput } from './inventory'
import type { FarmOperationContext } from './farmOperationContext'

/** The database boundary deliberately exposes untrusted rows only. */
export interface InventoryRowBundle { products: unknown[]; receipts: unknown[]; receipt_lines: unknown[]; adjustments: unknown[]; applications: unknown[]; application_products: unknown[]; program_application_products: unknown[]; on_hand: unknown[]; rup_completeness: unknown[] }
export type InventoryProductWrite = Omit<InventoryProduct, 'created_at' | 'updated_at'>
export type ReceiptBundleWrite = { farmId: string; receipt: Record<string, unknown>; lines: Array<Record<string, unknown>> }
export type ApplicationBundleWrite = { farmId: string; application: Record<string, unknown>; products: Array<Record<string, unknown>> }
export type CancelReceiptWrite = { farmId: string; id: string; reason: string; cancelledAt: string }
export type AdjustmentWrite = { id: string; product_id: string; adjustment_quantity_in_inventory_unit: number; reason: AdjustmentInput['reason']; notes: string; adjusted_at: string }
export interface InventoryDataGateway {
  loadWorkspace(farmId: string): Promise<InventoryRowBundle>
  upsertProduct(farmId: string, row: InventoryProductWrite, expectedUpdatedAt: string | null | undefined, context: FarmOperationContext): Promise<unknown>
  saveReceiptBundle(input: ReceiptBundleWrite, context: FarmOperationContext): Promise<unknown>
  cancelReceipt(input: CancelReceiptWrite, context: FarmOperationContext): Promise<unknown>
  insertAdjustment(farmId: string, row: AdjustmentWrite, context: FarmOperationContext): Promise<unknown>
  saveApplicationBundle(input: ApplicationBundleWrite, context: FarmOperationContext): Promise<unknown>
}
export type { ReceiptInput, ApplicationInput }
