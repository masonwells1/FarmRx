import type { AdjustmentWrite, ApplicationBundleWrite, CancelReceiptWrite, InventoryProductWrite, ReceiptBundleWrite } from './InventoryDataGateway'
import type { StorageLike } from './writeQueue'

export type InventoryQueueEntryV1 =
  | { version: 1; module: 'inventory'; kind: 'saveProduct'; operationId: string; userId: string; farmId: string; enqueuedAt: string; row: InventoryProductWrite }
  | { version: 1; module: 'inventory'; kind: 'saveReceiptBundle'; operationId: string; userId: string; farmId: string; enqueuedAt: string; write: ReceiptBundleWrite }
  | { version: 1; module: 'inventory'; kind: 'cancelReceipt'; operationId: string; userId: string; farmId: string; enqueuedAt: string; write: CancelReceiptWrite }
  | { version: 1; module: 'inventory'; kind: 'addAdjustment'; operationId: string; userId: string; farmId: string; enqueuedAt: string; row: AdjustmentWrite }
  | { version: 1; module: 'inventory'; kind: 'saveApplicationBundle'; operationId: string; userId: string; farmId: string; enqueuedAt: string; write: ApplicationBundleWrite }
export interface InventoryQueueEnvelopeV1 { version: 1; entries: InventoryQueueEntryV1[] }
const blocked = 'Saved changes on this device need attention. Nothing was deleted.'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const stamp = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value))
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const isId = (value: unknown) => typeof value === 'string' && uuid.test(value)
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
const row = (value: unknown) => record(value) && Object.values(value).every((item) => item === null || typeof item === 'string' || typeof item === 'boolean' || finite(item) || record(item))
function entry(value: unknown): value is InventoryQueueEntryV1 {
  if (!record(value) || value.version !== 1 || value.module !== 'inventory' || !isId(value.operationId) || !isId(value.userId) || !isId(value.farmId) || !stamp(value.enqueuedAt)) return false
  const common = ['version', 'module', 'kind', 'operationId', 'userId', 'farmId', 'enqueuedAt']
  if (value.kind === 'saveProduct') { if (!exact(value, [...common, 'row']) || !row(value.row)) return false; const product = value.row as Record<string, unknown>; return isId(product.id) && isId(product.farm_id) }
  if (value.kind === 'saveReceiptBundle') return exact(value, [...common, 'write']) && record(value.write) && exact(value.write, ['farmId', 'receipt', 'lines']) && isId(value.write.farmId) && row(value.write.receipt) && Array.isArray(value.write.lines) && value.write.lines.length > 0 && value.write.lines.every(row)
  if (value.kind === 'cancelReceipt') return exact(value, [...common, 'write']) && record(value.write) && exact(value.write, ['farmId', 'id', 'reason', 'cancelledAt']) && isId(value.write.farmId) && isId(value.write.id) && typeof value.write.reason === 'string' && value.write.reason.trim().length > 0 && stamp(value.write.cancelledAt)
  if (value.kind === 'addAdjustment') return exact(value, [...common, 'row']) && record(value.row) && exact(value.row, ['id', 'product_id', 'adjustment_quantity_in_inventory_unit', 'reason', 'notes', 'adjusted_at']) && isId(value.row.id) && isId(value.row.product_id) && finite(value.row.adjustment_quantity_in_inventory_unit) && value.row.adjustment_quantity_in_inventory_unit !== 0 && typeof value.row.notes === 'string' && value.row.notes.trim().length > 0 && stamp(value.row.adjusted_at)
  if (value.kind === 'saveApplicationBundle') return exact(value, [...common, 'write']) && record(value.write) && exact(value.write, ['farmId', 'application', 'products']) && isId(value.write.farmId) && row(value.write.application) && Array.isArray(value.write.products) && value.write.products.length > 0 && value.write.products.every(row)
  return false
}
export function parseInventoryQueue(serialized: string): InventoryQueueEnvelopeV1 { let parsed: unknown; try { parsed = JSON.parse(serialized) } catch { throw new Error(blocked) }; if (!record(parsed) || !exact(parsed, ['version', 'entries']) || parsed.version !== 1 || !Array.isArray(parsed.entries) || !parsed.entries.every(entry)) throw new Error(blocked); return parsed as unknown as InventoryQueueEnvelopeV1 }
export class InventoryWriteQueue {
  constructor(private readonly storage: StorageLike, readonly key: string) {}
  read(): InventoryQueueEnvelopeV1 { const raw = this.storage.getItem(this.key); return raw === null ? { version: 1, entries: [] } : parseInventoryQueue(raw) }
  private persist(next: InventoryQueueEnvelopeV1) { const serialized = JSON.stringify(next); parseInventoryQueue(serialized); this.storage.setItem(this.key, serialized); const actual = this.storage.getItem(this.key); if (actual !== serialized) throw new Error('This entry could not be saved on this device. Keep this screen open and try again.'); parseInventoryQueue(actual) }
  append(entry: InventoryQueueEntryV1) { const next = { version: 1 as const, entries: [...this.read().entries, entry] }; this.persist(next); return next }
  removeConfirmedHead(operationId: string) { const current = this.read(); if (current.entries[0]?.operationId !== operationId) throw new Error(blocked); const next = { version: 1 as const, entries: current.entries.slice(1) }; this.persist(next); return next }
}
export const inventoryWriteQueueKey = (projectRef: string, userId: string, farmId: string) => `farm-rx-inventory-write-queue:v1:${projectRef}:${userId}:${farmId}`
