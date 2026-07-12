import { fieldsSeedForRegression } from './MockFieldsRepository'
import type { FieldsData, FieldsRepository } from './fields'
import type { AdjustmentWrite, ApplicationBundleWrite, CancelReceiptWrite, InventoryDataGateway, InventoryProductWrite, InventoryRowBundle, ReceiptBundleWrite } from './InventoryDataGateway'
import { inventoryWriteQueueKey, InventoryWriteQueue, parseInventoryQueue, type InventoryQueueEntryV1 } from './inventoryWriteQueue'
import { QueuedInventoryRepository } from './QueuedInventoryRepository'
import { SupabaseInventoryRepository } from './SupabaseInventoryRepository'
import { moduleBackends } from './backends'
import type { StorageLike } from './writeQueue'

const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const farm = uid(1); const actor = uid(2); const micro = '2026-07-11T23:35:28.807722+00:00'
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
async function rejects(action: () => Promise<unknown>, message: string) { let failed = false; try { await action() } catch { failed = true }; assert(failed, message) }

function product(id: string, inventory_unit: 'gal' | 'lb', restricted = false) {
  return { id, farm_id: farm, product_kind: 'chemical', name: inventory_unit === 'gal' ? 'Atrazine' : 'Dry Blend', manufacturer: null, inventory_unit, epa_registration_number: restricted ? '100-497' : null, is_restricted_use: restricted, signal_word: restricted ? 'caution' : null, restricted_entry_interval_hours: restricted ? '12' : null, preharvest_interval_hours: restricted ? '60' : null, max_label_rate: restricted ? '2.5' : null, max_label_rate_unit: restricted ? 'qt' : null, max_label_rate_basis: restricted ? 'acre' : null, commodity_id: null, variety_name: null, fertilizer_analysis: null, is_active: true, created_at: micro, updated_at: micro }
}
function canonicalFixture(): InventoryRowBundle {
  const liquid = product(uid(501), 'gal', true); const dry = product(uid(502), 'lb')
  return { products: [liquid, dry], receipts: [], receipt_lines: [], adjustments: [], applications: [], application_products: [], on_hand: [liquid, dry].map((p) => ({ product_id: p.id, farm_id: farm, product_kind: p.product_kind, name: p.name, inventory_unit: p.inventory_unit, received_quantity: '0', adjusted_quantity: '0', used_quantity: '0', on_hand_quantity: '0', weighted_known_receipt_cost_per_inventory_unit: null })), rup_completeness: [] }
}
function fieldsFor(farmId: string): FieldsData {
  const fields = fieldsSeedForRegression(); fields.farm.id = farmId
  fields.fields.forEach((field) => { field.farm_id = farmId }); fields.crop_assignments.forEach((assignment) => { assignment.farm_id = farmId })
  return fields
}
const row = (value: unknown) => value as Record<string, unknown>
const conversion = (from: string, to: string, supplied: unknown) => {
  if (typeof supplied === 'number') return supplied
  if (from === to) return 1
  if (from === 'qt' && to === 'gal') return .25
  if (from === 'gal' && to === 'qt') return 4
  if (from === 'lb' && to === 'oz') return 16
  if (from === 'oz' && to === 'lb') return .0625
  const volume = new Set(['gal', 'qt', 'pt', 'fl_oz', 'l', 'ml']); const weight = new Set(['lb', 'oz', 'ton', 'kg', 'g'])
  if (volume.has(from) !== volume.has(to) && weight.has(from) !== weight.has(to)) throw new Error('server rejected unsafe volume-to-weight conversion')
  throw new Error('server requires a package conversion factor')
}
type Mutators = {
  receipt?: (value: { receipt: Record<string, unknown>; lines: Record<string, unknown>[] }) => unknown
  cancel?: (value: Record<string, unknown>) => unknown
  adjustment?: (value: Record<string, unknown>) => unknown
  application?: (value: { application: Record<string, unknown>; products: Record<string, unknown>[] }) => unknown
}
class FakeGateway implements InventoryDataGateway {
  state: InventoryRowBundle = canonicalFixture(); fail = false; mutate: Mutators = {}; calls = { load: 0, receipt: 0, cancel: 0, adjustment: 0, application: 0 }
  async loadWorkspace(_farmId: string) { this.calls.load++; if (this.fail) throw new Error('network timeout'); return structuredClone(this.state) }
  async upsertProduct(farmId: string, input: InventoryProductWrite) { const saved = { ...input, farm_id: farmId, created_at: micro, updated_at: micro }; this.state.products = [...this.state.products.filter((p) => row(p).id !== input.id), saved]; return structuredClone(saved) }
  async saveReceiptBundle(input: ReceiptBundleWrite) {
    this.calls.receipt++
    const prior = this.state.receipts.find((item) => row(item).id === input.receipt.id) as Record<string, unknown> | undefined
    const receipt = { id: input.receipt.id, farm_id: input.farmId, status: input.receipt.status, source: input.receipt.source, vendor_name: input.receipt.vendor_name, purchase_date: input.receipt.purchase_date, received_at: input.receipt.received_at, cancelled_at: null, cancellation_reason: null, created_at: prior?.created_at ?? micro, cancelled_by: null, created_by: actor }
    const lines = input.lines.map((line) => { const factor = conversion(String(line.entered_unit), String(this.product(line.product_id).inventory_unit), line.inventory_units_per_entered_unit); return { id: line.id, receipt_id: receipt.id, product_id: line.product_id, entered_quantity: line.entered_quantity, entered_unit: line.entered_unit, inventory_units_per_entered_unit: factor, quantity_in_inventory_unit: Number(line.entered_quantity) * factor, unit_cost_per_inventory_unit: line.unit_cost_per_inventory_unit } })
    this.state.receipts = [...this.state.receipts.filter((item) => row(item).id !== receipt.id), receipt]
    const lineIds = new Set(lines.map((line) => line.id)); this.state.receipt_lines = [...this.state.receipt_lines.filter((item) => row(item).receipt_id !== receipt.id && !lineIds.has(String(row(item).id))), ...lines]
    const reply = { receipt, lines }; return structuredClone(this.mutate.receipt ? this.mutate.receipt(reply) : reply)
  }
  async cancelReceipt(input: CancelReceiptWrite) {
    this.calls.cancel++; const existing = this.state.receipts.find((item) => row(item).id === input.id); if (!existing || row(existing).status !== 'received') throw new Error('server only cancels received receipts')
    const saved = { ...row(existing), status: 'cancelled', cancelled_at: input.cancelledAt, cancellation_reason: input.reason, cancelled_by: actor }
    this.state.receipts = this.state.receipts.map((item) => row(item).id === input.id ? saved : item)
    return structuredClone(this.mutate.cancel ? this.mutate.cancel(saved) : saved)
  }
  async insertAdjustment(farmId: string, input: AdjustmentWrite) {
    this.calls.adjustment++; const saved = { ...input, farm_id: farmId, created_at: micro, created_by: actor }
    this.state.adjustments = [...this.state.adjustments.filter((item) => row(item).id !== input.id), saved]
    return structuredClone(this.mutate.adjustment ? this.mutate.adjustment(saved) : saved)
  }
  async saveApplicationBundle(input: ApplicationBundleWrite) {
    this.calls.application++; const a = input.application
    const application = { id: a.id, farm_id: input.farmId, field_id: a.field_id, crop_assignment_id: a.crop_assignment_id, status: a.status, application_date: a.application_date, start_time: a.start_time, applied_acres: a.applied_acres, target_pest: a.target_pest, applicator_name_snapshot: a.applicator_name_snapshot, applicator_license_number_snapshot: a.applicator_license_number_snapshot, wind_speed_mph: a.wind_speed_mph, wind_direction: a.wind_direction, temperature_f: a.temperature_f, relative_humidity_pct: a.relative_humidity_pct, completed_at: a.completed_at, void_reason: null, corrects_application_id: null, created_at: micro, created_by: actor }
    const products = input.products.map((line) => { const p = this.product(line.product_id); const factor = conversion(String(line.total_unit), String(p.inventory_unit), line.inventory_units_per_total_unit); return { id: line.id, application_id: application.id, product_id: p.id, product_kind_snapshot: p.product_kind, product_name_snapshot: p.name, epa_registration_number_snapshot: p.epa_registration_number, is_restricted_use_snapshot: p.is_restricted_use, signal_word_snapshot: p.signal_word, restricted_entry_interval_hours_snapshot: p.restricted_entry_interval_hours, preharvest_interval_hours_snapshot: p.preharvest_interval_hours, max_label_rate_snapshot: p.max_label_rate, max_label_rate_unit_snapshot: p.max_label_rate_unit, max_label_rate_basis_snapshot: p.max_label_rate_basis, inventory_unit_snapshot: p.inventory_unit, rate: line.rate, rate_unit: line.rate_unit, rate_basis: line.rate_basis, total_quantity: line.total_quantity, total_unit: line.total_unit, inventory_units_per_total_unit: factor, quantity_in_inventory_unit: Number(line.total_quantity) * factor, unit_cost_per_inventory_unit_snapshot: null } })
    this.state.applications = [...this.state.applications.filter((item) => row(item).id !== application.id), application]
    this.state.application_products = [...this.state.application_products.filter((item) => row(item).application_id !== application.id), ...products]
    this.state.rup_completeness = products.filter((p) => p.is_restricted_use_snapshot && application.status === 'completed').map((p) => ({ application_id: application.id, application_product_id: p.id, farm_id: input.farmId, application_date: application.application_date, field_id: application.field_id, crop_assignment_id: application.crop_assignment_id, product_name_snapshot: p.product_name_snapshot, epa_registration_number_snapshot: p.epa_registration_number_snapshot, is_restricted_use: true, missing_federal_rup_fields: [], federal_rup_record_complete: true, missing_farm_rx_operational_fields: [] }))
    const reply = { application, products }; return structuredClone(this.mutate.application ? this.mutate.application(reply) : reply)
  }
  private product(id: unknown) { const found = this.state.products.find((item) => row(item).id === id); if (!found) throw new Error('server product not found'); return row(found) }
}
function repo(gateway: FakeGateway) { const fields = fieldsFor(farm); const fieldsRepository: FieldsRepository = { getData: async () => structuredClone(fields), saveField: async () => { throw new Error('not used') } }; let next = 900; return new SupabaseInventoryRepository({ gateway, fieldsRepository, getFarmId: async () => farm, createId: () => uid(next++), clock: () => micro }) }
function memory(): StorageLike & { values: Map<string, string> } { return { values: new Map(), getItem(key) { return this.values.get(key) ?? null }, setItem(key, value) { this.values.set(key, value) }, removeItem(key) { this.values.delete(key) } } }
function receiptWrite(id: string, lineId: string, productId = uid(501)): ReceiptBundleWrite { return { farmId: farm, receipt: { id, source: 'other_vendor', status: 'received', vendor_name: 'Acme Supply', purchase_date: '2026-07-11', received_at: micro, invoice_number: null, notes: null }, lines: [{ id: lineId, product_id: productId, entered_quantity: 4, entered_unit: 'gal', inventory_units_per_entered_unit: null, unit_cost_per_inventory_unit: 18.5, lot_number: null, expiration_date: null, external_delivery_line_id: null, notes: null }] } }
function applicationInput(id: string) { const fields = fieldsFor(farm); const assignment = fields.crop_assignments[0]; return { id, field_id: assignment.field_id, crop_assignment_id: assignment.id, status: 'completed' as const, application_date: '2026-07-11', start_time: '08:30', applied_acres: 10, target_pest: 'Waterhemp', applicator_name: 'A. Applicator', applicator_license_number: 'IL-123', wind_speed_mph: 8, wind_direction: 'NW', temperature_f: 75, relative_humidity_pct: 55, products: [{ id: uid(601), product_id: uid(501), rate: 1, rate_unit: 'gal' as const, rate_basis: 'acre' as const, total_quantity: 10, total_unit: 'gal' as const }, { id: uid(602), product_id: uid(502), rate: 2, rate_unit: 'lb' as const, rate_basis: 'each' as const, total_quantity: 5, total_unit: 'lb' as const }] } }

async function run() {
  const gateway = new FakeGateway(); const live = repo(gateway); const workspace = await live.getWorkspace()
  assert(workspace.products[0].created_at === micro && workspace.products[0].restricted_entry_interval_hours === 12, 'Inventory mapping must accept PostgREST numeric strings and microsecond offset timestamps.')
  assert(workspace.on_hand.every((item) => item.quantity === 0), 'On-hand must come from the authoritative view row, not a client ledger calculation.')
  gateway.fail = true; await rejects(() => live.getWorkspace(), 'A gateway failure must reject without a mock fallback.'); gateway.fail = false
  const bad = canonicalFixture(); row(bad.on_hand[0]).on_hand_quantity = '99'; gateway.state = bad; await rejects(() => live.getWorkspace(), 'Invalid view arithmetic must fail closed.'); gateway.state = canonicalFixture()
  const foreign = canonicalFixture(); row(foreign.products[0]).farm_id = uid(999); gateway.state = foreign; await rejects(() => live.getWorkspace(), 'Cross-farm rows must fail closed.'); gateway.state = canonicalFixture()

  // Receipt lifecycle: draft save, draft edit, received save, and server-side cancellation identity.
  await live.receiveReceipt({ id: uid(10), product_id: uid(501), quantity: 4, unit: 'gal', unit_cost: 18.5, date: '2026-07-11', status: 'draft', vendor_name: 'Acme Supply' })
  await live.editReceipt(uid(10), { quantity: 6, unit_cost: 19 })
  assert(row(gateway.state.receipt_lines[0]).entered_quantity === 6, 'Draft receipt edits must reach the canonical line echo.')
  await live.receiveReceipt({ id: uid(11), product_id: uid(501), quantity: 4, unit: 'gal', unit_cost: 18.5, date: '2026-07-11', status: 'received', vendor_name: 'Acme Supply' })
  await live.cancelReceipt(uid(11), 'Damaged')
  const cancelled = row(gateway.state.receipts.find((item) => row(item).id === uid(11)))
  assert(cancelled.status === 'cancelled' && cancelled.cancelled_by === actor && cancelled.cancelled_at === micro && cancelled.cancellation_reason === 'Damaged', 'Cancellation must emulate the trigger-owned cancelled_by echo.')

  const badReceipt = new FakeGateway(); badReceipt.mutate.receipt = (reply) => ({ ...reply, lines: reply.lines.map((line) => ({ ...line, entered_quantity: 99, quantity_in_inventory_unit: 99 })) }); await rejects(() => repo(badReceipt).receiveReceipt({ id: uid(12), product_id: uid(501), quantity: 4, unit: 'gal', date: '2026-07-11', status: 'received', vendor_name: 'Acme Supply' }), 'A wrong receipt-line echo must be rejected.')
  const badReceiptStatus = new FakeGateway(); badReceiptStatus.mutate.receipt = (reply) => ({ ...reply, receipt: { ...reply.receipt, status: 'draft', received_at: null } }); await rejects(() => repo(badReceiptStatus).receiveReceipt({ id: uid(13), product_id: uid(501), quantity: 4, unit: 'gal', date: '2026-07-11', status: 'received', vendor_name: 'Acme Supply' }), 'A wrong receipt status echo must be rejected.')
  const badCancel = new FakeGateway(); const badCancelRepo = repo(badCancel); await badCancelRepo.receiveReceipt({ id: uid(14), product_id: uid(501), quantity: 4, unit: 'gal', date: '2026-07-11', status: 'received', vendor_name: 'Acme Supply' }); badCancel.mutate.cancel = (saved) => ({ ...saved, cancellation_reason: 'Wrong reason' }); await rejects(() => badCancelRepo.cancelReceipt(uid(14), 'Damaged'), 'A wrong cancellation reason echo must be rejected.')
  const nullCancelledBy = new FakeGateway(); const nullCancelledByRepo = repo(nullCancelledBy); await nullCancelledByRepo.receiveReceipt({ id: uid(15), product_id: uid(501), quantity: 4, unit: 'gal', date: '2026-07-11', status: 'received', vendor_name: 'Acme Supply' }); nullCancelledBy.mutate.cancel = (saved) => ({ ...saved, cancelled_by: null }); await rejects(() => nullCancelledByRepo.cancelReceipt(uid(15), 'Damaged'), 'A cancelled receipt with null cancelled_by must fail the strict mapper.')

  await live.addAdjustment({ id: uid(20), product_id: uid(501), quantity: -2, reason: 'correction', notes: 'Physical count', adjusted_at: micro })
  assert(row(gateway.state.adjustments[0]).created_by === actor, 'Adjustment write must receive a canonical server row.')
  const badAdjustment = new FakeGateway(); badAdjustment.mutate.adjustment = (saved) => ({ ...saved, notes: 'Wrong echo' }); await rejects(() => repo(badAdjustment).addAdjustment({ id: uid(21), product_id: uid(501), quantity: -2, reason: 'correction', notes: 'Physical count', adjusted_at: micro }), 'A wrong adjustment echo must be rejected.')

  const app = applicationInput(uid(30)); await live.saveApplication(app)
  assert(gateway.calls.application === 1 && gateway.state.application_products.length === 2, 'A multi-product, mixed-rate-basis application must save end-to-end.')
  const badApplication = new FakeGateway(); badApplication.mutate.application = (reply) => ({ ...reply, products: reply.products.map((line, index) => index === 0 ? { ...line, rate: 99 } : line) }); await rejects(() => repo(badApplication).saveApplication(applicationInput(uid(31))), 'A wrong application-product echo must be rejected.')
  const missingApplicationProduct = new FakeGateway(); missingApplicationProduct.mutate.application = (reply) => ({ ...reply, products: reply.products.slice(0, 1) }); await rejects(() => repo(missingApplicationProduct).saveApplication(applicationInput(uid(32))), 'A missing application-product echo must be rejected.')

  row(gateway.state.rup_completeness[0]).missing_farm_rx_operational_fields = ['rei_hours', 'phi_hours', 'rate_exceeds_snapshotted_label_maximum']
  await live.getWorkspace()
  row(gateway.state.rup_completeness[0]).missing_farm_rx_operational_fields = ['label_rate_exceeded']
  await rejects(() => live.getWorkspace(), 'Unknown retired operational RUP tokens must fail closed.')
  row(gateway.state.rup_completeness[0]).missing_farm_rx_operational_fields = []

  const conversionGateway = new FakeGateway(); const conversionRepo = repo(conversionGateway)
  await rejects(() => conversionRepo.receiveReceipt({ id: uid(40), product_id: uid(502), quantity: 4, unit: 'gal', date: '2026-07-11', status: 'received', vendor_name: 'Acme Supply' }), 'A volume-to-weight receipt write must be rejected.')
  await conversionRepo.receiveReceipt({ id: uid(41), product_id: uid(501), quantity: 3, unit: 'case', package_factor: 4, date: '2026-07-11', status: 'received', vendor_name: 'Acme Supply' })
  assert(row(conversionGateway.state.receipt_lines[0]).inventory_units_per_entered_unit === 4 && row(conversionGateway.state.receipt_lines[0]).quantity_in_inventory_unit === 12, 'Package-factor receipt writes must preserve the snapshotted factor.')

  const store = memory(); const key = inventoryWriteQueueKey('project', actor, farm); const queue = new InventoryWriteQueue(store, key); const replayGateway = new FakeGateway(); const replayLive = repo(replayGateway)
  const base = { version: 1 as const, module: 'inventory' as const, userId: actor, farmId: farm, enqueuedAt: micro }
  const queuedReceipt = (operationId: string): InventoryQueueEntryV1 => ({ ...base, operationId, kind: 'saveReceiptBundle', write: receiptWrite(uid(50), uid(51)) })
  const queued = new QueuedInventoryRepository(replayLive, { getContext: async () => ({ userId: actor, farmId: farm }), projectRef: 'project', storage: store, createId: () => uid(99), clock: () => micro, isOffline: () => false })
  assert(typeof queued.inspectAndReplay === 'function', 'The exported startup replay function must exist.')
  queue.append(queuedReceipt(uid(52))); await queued.inspectAndReplay(); assert(queue.read().entries.length === 0 && replayGateway.calls.load === 0, 'Startup replay must drain an entry without a workspace load.')
  queue.append(queuedReceipt(uid(53))); await queued.inspectAndReplay(); assert(queue.read().entries.length === 0 && replayGateway.calls.receipt === 2, 'An idempotent second replay with the exact canonical echo must be accepted.')
  replayGateway.mutate.receipt = (reply) => ({ ...reply, lines: reply.lines.map((line) => ({ ...line, entered_quantity: 7, quantity_in_inventory_unit: 7 })) }); queue.append(queuedReceipt(uid(54))); const callsBeforeConflict = replayGateway.calls.receipt; await queued.inspectAndReplay(); assert(replayGateway.calls.receipt === callsBeforeConflict + 1 && queue.read().entries.length === 1, 'A conflicting replay echo must be blocked after one attempt, not retried forever.')

  const entries: InventoryQueueEntryV1[] = [
    { ...base, operationId: uid(60), kind: 'saveProduct', row: { ...product(uid(700), 'gal'), farm_id: farm } as InventoryProductWrite },
    queuedReceipt(uid(61)),
    { ...base, operationId: uid(62), kind: 'cancelReceipt', write: { farmId: farm, id: uid(50), reason: 'Damaged', cancelledAt: micro } },
    { ...base, operationId: uid(63), kind: 'addAdjustment', row: { id: uid(64), product_id: uid(501), adjustment_quantity_in_inventory_unit: -1, reason: 'correction', notes: 'count', adjusted_at: micro } },
    { ...base, operationId: uid(65), kind: 'saveApplicationBundle', write: { farmId: farm, application: { id: uid(66), field_id: fieldsFor(farm).fields[0].id, crop_assignment_id: fieldsFor(farm).crop_assignments[0].id, status: 'draft', application_date: '2026-07-11', start_time: null, end_time: null, applied_acres: 1, target_pest: null, applicator_user_id: null, applicator_name_snapshot: null, applicator_license_number_snapshot: null, applicator_license_state_snapshot: null, wind_speed_mph: null, wind_direction: null, temperature_f: null, relative_humidity_pct: null, corrects_application_id: null, correction_reason: null, completed_at: null, notes: null }, products: [{ id: uid(67), product_id: uid(501), rate: 1, rate_unit: 'gal', rate_basis: 'acre', total_quantity: 1, total_unit: 'gal', inventory_units_per_total_unit: null, lot_number_snapshot: null, notes: null }] } },
  ]
  const parserStore = memory(); const parserQueue = new InventoryWriteQueue(parserStore, key); entries.forEach((entry) => parserQueue.append(entry))
  assert(parserQueue.read().entries.length === 5 && key.startsWith('farm-rx-inventory-write-queue:v1:'), 'All five fully-shaped inventory queue entries must round-trip on an isolated versioned key.')
  await rejects(async () => { parseInventoryQueue('{"version":2,"entries":[]}') }, 'Unknown queue versions must fail closed.')
  parserStore.setItem(key, '{bad'); await rejects(async () => { parserQueue.read() }, 'Corrupt inventory queue bytes must fail closed and remain untouched.')
  assert(moduleBackends.inventory === 'supabase', 'The backend manifest must select the live inventory repository.')
  console.log('SupabaseInventoryRepository regression passed (8 coverage groups)')
}
void run()
