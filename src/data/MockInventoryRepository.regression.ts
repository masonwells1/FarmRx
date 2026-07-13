import { fieldsSeedForRegression } from './MockFieldsRepository'
import { INVENTORY_STORAGE_KEY, MockInventoryRepository } from './inventory'
import type { FieldsRepository } from './fields'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
class MemoryStorage implements Storage { private readonly values = new Map<string, string>(); get length() { return this.values.size }; clear() { this.values.clear() }; getItem(key: string) { return this.values.get(key) ?? null }; key(index: number) { return [...this.values.keys()][index] ?? null }; removeItem(key: string) { this.values.delete(key) }; setItem(key: string, value: string) { this.values.set(key, value) } }
const fields = fieldsSeedForRegression()
const fieldsRepository = { getData: async () => structuredClone(fields) } as unknown as FieldsRepository
function repo(storage = new MemoryStorage()) { let next = 0; return { storage, repository: new MockInventoryRepository(fieldsRepository, { storage, createId: () => `row-${++next}`, clock: () => '2026-07-11T12:00:00.000Z' }) } }
async function receipt(repository: MockInventoryRepository, id: string, quantity: number, unit: 'gal' | 'case', factor?: number) { await repository.receiveReceipt({ id, product_id: 'inv-atrazine', quantity, unit, package_factor: factor, date: '2026-07-11', status: 'received' }) }

async function regressionLedgerAndConversions() {
  const { repository } = repo(); await receipt(repository, 'receipt-mixed', 8, 'gal'); await repository.addAdjustment({ id: 'adjust-1', product_id: 'inv-atrazine', quantity: 2, reason: 'physical_count', notes: 'Shed count.', adjusted_at: '2026-07-11' }); const initial = await repository.getWorkspace(); const assignment = initial.fields.crop_assignments[0]; assert(initial.adjustments[0]?.adjusted_at === '2026-07-11', 'Mock adjustment dates must surface as YYYY-MM-DD.')
  await repository.addAdjustment({ id: 'adjust-bad-date', product_id: 'inv-atrazine', quantity: 1, reason: 'physical_count', notes: 'Shed count.', adjusted_at: '2026-99-99' }).then(() => { throw new Error('Malformed adjustment date was accepted.') }, () => undefined)
  await repository.saveApplication({ id: 'application-mixed', field_id: assignment.field_id, crop_assignment_id: assignment.id, status: 'completed', application_date: '2026-07-11', applied_acres: .5, products: [{ id: 'application-line', product_id: 'inv-atrazine', rate: .5, rate_unit: 'qt', rate_basis: 'acre', total_quantity: .25, total_unit: 'qt' }] })
  const after = await repository.getWorkspace(); const onHand = after.on_hand.find((row) => row.product_id === 'inv-atrazine')!.quantity
  assert(Math.abs(onHand - 129.9375) < .000001, 'On-hand did not derive receipt + adjustment − application in converted units.')
  await receipt(repository, 'receipt-case', 2, 'case', 30); const packaged = (await repository.getWorkspace()).on_hand.find((row) => row.product_id === 'inv-atrazine')!.quantity
  assert(Math.abs(packaged - 189.9375) < .000001, 'Explicit package conversion did not add its saved factor.')
  await repository.receiveReceipt({ id: 'bad-density-receipt', product_id: 'inv-atrazine', quantity: 1, unit: 'lb', package_factor: 8, date: '2026-07-11', status: 'received' }).then(() => { throw new Error('Volume-to-weight receipt factor was accepted.') }, () => undefined)
  await repository.saveApplication({ id: 'bad-density-application', field_id: assignment.field_id, crop_assignment_id: assignment.id, status: 'completed', application_date: '2026-07-11', applied_acres: 1, products: [{ id: 'bad-density-line', product_id: 'inv-atrazine', rate: 1, rate_unit: 'qt', rate_basis: 'acre', total_quantity: 1, total_unit: 'lb', package_factor: 8 }] }).then(() => { throw new Error('Volume-to-weight application factor was accepted.') }, () => undefined)
}

async function regressionReceiptLockAndCancellation() {
  const { repository } = repo(); await receipt(repository, 'receipt-lock', 5, 'gal'); await repository.editReceipt('receipt-lock', { quantity: 7 }).then(() => { throw new Error('Received receipt edit was accepted.') }, () => undefined); await repository.cancelReceipt('receipt-lock', 'Vendor loaded the wrong product.'); const workspace = await repository.getWorkspace(); const row = workspace.receipts.find((item) => item.id === 'receipt-lock')!; assert(row.status === 'cancelled' && row.cancellation_reason === 'Vendor loaded the wrong product.', 'Received receipt did not cancel with its audit reason.'); assert(!workspace.on_hand.some((item) => item.product_id === 'inv-atrazine' && item.quantity === 125), 'Cancelled receipt still counted as on-hand.')
}

async function regressionFarmIsolationAndOtherKeys() {
  const { storage, repository } = repo(); const protectedBytes = '{"safe":"other module bytes"}'; storage.setItem('farm-rx-local-data', protectedBytes); await repository.getWorkspace(); const inventoryBytes = storage.getItem(INVENTORY_STORAGE_KEY); const otherFarm = structuredClone(fields); otherFarm.farm.id = 'other-farm'; const otherRepo = new MockInventoryRepository({ getData: async () => otherFarm } as FieldsRepository, { storage }); await otherRepo.getWorkspace().then(() => { throw new Error('Other farm opened this inventory envelope.') }, () => undefined); assert(storage.getItem(INVENTORY_STORAGE_KEY) === inventoryBytes, 'Farm-mismatched inventory envelope was overwritten.'); assert(storage.getItem('farm-rx-local-data') === protectedBytes, 'Inventory save changed another module’s envelope bytes.')
}

async function regressionSnapshotsAndRateValidation() {
  const { repository } = repo(); const workspace = await repository.getWorkspace(); const assignment = workspace.fields.crop_assignments[0]
  await repository.saveApplication({ id: 'snapshot-application', field_id: assignment.field_id, crop_assignment_id: assignment.id, status: 'completed', application_date: '2026-07-11', applied_acres: 1, products: [{ id: 'snapshot-line', product_id: 'inv-atrazine', rate: 1, rate_unit: 'qt', rate_basis: 'acre', total_quantity: 1, total_unit: 'qt' }] })
  const product = (await repository.getWorkspace()).products.find((item) => item.id === 'inv-atrazine')!
  await repository.saveProduct({ ...product, product_kind: 'biological', name: 'Atrazine changed later', epa_registration_number: 'changed-epa', is_restricted_use: false, signal_word: 'danger', restricted_entry_interval_hours: 24, preharvest_interval_hours: 48, max_label_rate: 5, max_label_rate_unit: 'gal', max_label_rate_basis: 'acre', manufacturer: 'Changed maker', is_active: false })
  const saved = await repository.getWorkspace(); const line = saved.application_products.find((item) => item.id === 'snapshot-line')!
  assert(line.product_kind_snapshot === 'chemical' && line.product_name_snapshot === 'Atrazine 4L' && line.epa_registration_number_snapshot === '100-497' && line.is_restricted_use_snapshot && line.signal_word_snapshot === 'caution', 'Application product did not preserve its historical product identity snapshots.')
  assert(line.restricted_entry_interval_hours_snapshot === 12 && line.preharvest_interval_hours_snapshot === 60 && line.max_label_rate_snapshot === 2.5 && line.max_label_rate_unit_snapshot === 'qt' && line.max_label_rate_basis_snapshot === 'acre', 'Application product did not preserve all regulatory snapshots.')
  assert(line.inventory_unit_snapshot === 'gal' && line.rate === 1 && line.rate_unit === 'qt' && line.rate_basis === 'acre' && line.total_quantity === 1 && line.total_unit === 'qt' && Math.abs(line.inventory_units_per_total_unit - .25) < .000001 && Math.abs(line.quantity_in_inventory_unit - .25) < .000001 && line.unit_cost_per_inventory_unit_snapshot === 18.5, 'Application product did not preserve every historical scalar and saved factor.')
  await repository.saveProduct({ ...(await repository.getWorkspace()).products.find((item) => item.id === 'inv-atrazine')!, inventory_unit: 'lb' }).then(() => { throw new Error('Historical product inventory unit changed.') }, () => undefined)
  await repository.saveApplication({ id: 'bad-rate', field_id: assignment.field_id, crop_assignment_id: assignment.id, status: 'completed', application_date: '2026-07-11', applied_acres: 1, products: [{ id: 'bad-rate-line', product_id: 'inv-atrazine', rate: 1, rate_unit: 'qt', rate_basis: 'acre', total_quantity: 2, total_unit: 'qt' }] }).then(() => { throw new Error('Rate × acres mismatch was accepted.') }, () => undefined)
}

async function regressionFailClosedCorruption() {
  const { storage, repository } = repo(); await repository.getWorkspace(); const safe = storage.getItem(INVENTORY_STORAGE_KEY)!
  const corruptions: Array<(envelope: any) => void> = [
    (envelope) => { envelope.data.receipt_lines[0].inventory_units_per_entered_unit = -1 },
    (envelope) => { envelope.data.receipt_lines[0].product_id = 'dangling-product' },
    (envelope) => { envelope.data.receipts[0].farm_id = 'other-farm' },
    (envelope) => { envelope.data.applications.push({ id: 'bad-application', farm_id: fields.farm.id, field_id: 'missing-field', crop_assignment_id: 'missing-crop', status: 'completed', application_date: '2026-07-11', start_time: null, applied_acres: 1, target_pest: null, applicator_name_snapshot: null, applicator_license_number_snapshot: null, wind_speed_mph: null, wind_direction: null, temperature_f: null, relative_humidity_pct: null, completed_at: '2026-07-11T00:00:00.000Z', void_reason: null, corrects_application_id: null, created_at: '2026-07-11T00:00:00.000Z' }) },
  ]
  for (const corrupt of corruptions) { const envelope = JSON.parse(safe); corrupt(envelope); const bytes = JSON.stringify(envelope); storage.setItem(INVENTORY_STORAGE_KEY, bytes); await new MockInventoryRepository(fieldsRepository, { storage }).getWorkspace().then(() => { throw new Error('Semantically corrupt inventory envelope was accepted.') }, () => undefined); assert(storage.getItem(INVENTORY_STORAGE_KEY) === bytes, 'Corrupt inventory envelope was changed instead of failing closed.') }
  storage.setItem(INVENTORY_STORAGE_KEY, '{"version":99,"data":{}}'); const before = storage.getItem(INVENTORY_STORAGE_KEY); await new MockInventoryRepository(fieldsRepository, { storage }).getWorkspace().then(() => { throw new Error('Corrupt inventory envelope was accepted.') }, () => undefined); assert(storage.getItem(INVENTORY_STORAGE_KEY) === before, 'Corrupt inventory envelope was changed instead of failing closed.')
}

await regressionLedgerAndConversions()
await regressionReceiptLockAndCancellation()
await regressionFarmIsolationAndOtherKeys()
await regressionSnapshotsAndRateValidation()
await regressionFailClosedCorruption()
console.log('MockInventoryRepository regressions passed.')
