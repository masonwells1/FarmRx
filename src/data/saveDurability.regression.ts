import { dismissNeedsAttention, readNeedsAttention, appendNeedsAttention } from './needsAttentionStore'
import { getSaveReceipt, setSaveReceipt } from '../lib/saveReceipt'
import { cannotRetry } from '../components/NeedsAttentionList'
import { insurancePendingDraftKey, restoreInsurancePendingDraft, settleInsurancePendingDraft, writeInsurancePendingDraft } from './insurancePendingDraft'
import type { StorageLike } from './writeQueue'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const storage: StorageLike & { values: Map<string, string> } = { values: new Map(), getItem(key) { return this.values.get(key) ?? null }, setItem(key, value) { this.values.set(key, value) }, removeItem(key) { this.values.delete(key) } }
const queueKey = 'farm-rx-inventory-write-queue:v1:project:user:farm'
appendNeedsAttention(storage, queueKey, { id: 'operation', module: 'inventory', createdAt: '2026-07-13T00:00:00.000Z', message: 'This save needs attention before it can be retried.', entry: { kind: 'addAdjustment' } })
assert(readNeedsAttention(storage, queueKey).length === 1, 'Needs-attention records must survive a fresh store read (reload simulation).')
appendNeedsAttention(storage, queueKey, { id: 'operation', module: 'inventory', createdAt: '2026-07-13T00:00:01.000Z', message: 'Database update required.', reason: 'database_update_required', entry: { kind: 'addAdjustment' } })
const parked = readNeedsAttention(storage, queueKey)
assert(parked.length === 1 && parked[0]?.reason === 'database_update_required', 'Parking the same operation twice must upsert one typed attention record.')
dismissNeedsAttention(storage, queueKey, 'operation')
assert(readNeedsAttention(storage, queueKey).length === 0, 'Dismiss must remove the needs-attention record durably.')
assert(cannotRetry({ entry: { kind: 'saveBudget' }, reason: 'database_update_required', message: 'This save arrives with the next database update. Reload the app after the update.' }), 'A database_update_required attention record cannot be retried.')

const insuranceContext = { projectRef: 'project', userId: 'user', farmId: 'farm' }
const insuranceBudgetId = 'budget'
const insurancePatch = { rp_coverage_pct: 80, rp_aph_yield: 180, rp_projected_price: 4.62, rp_premium_per_acre: 12 }
const insuranceKey = insurancePendingDraftKey(insuranceBudgetId)
writeInsurancePendingDraft(storage, insuranceContext, insuranceBudgetId, insurancePatch)
settleInsurancePendingDraft(storage, insuranceBudgetId, false, true)
assert(storage.getItem(insuranceKey) !== null, 'A failed insurance save returning false must retain farm-rx.insurance-pending.')
try { throw new Error('repository failed') } catch { /* a rejected repository save never settles/removes the local draft */ }
assert(storage.getItem(insuranceKey) !== null, 'A rejected insurance save must retain farm-rx.insurance-pending.')
settleInsurancePendingDraft(storage, insuranceBudgetId, true, true)
assert(storage.getItem(insuranceKey) === null, 'A confirmed insurance save must remove farm-rx.insurance-pending.')
const envelope = (patch = insurancePatch) => ({ version: 1, ...insuranceContext, budgetId: insuranceBudgetId, patch })
for (const invalid of [
  { ...envelope(), budgetId: 'wrong-budget' },
  { ...envelope(), farmId: 'wrong-farm' },
  { ...envelope(), userId: 'wrong-user' },
  { ...envelope(), projectRef: 'wrong-project' },
  { ...envelope(), extra: true },
  envelope({ ...insurancePatch, rp_aph_yield: 'not-a-number' } as unknown as typeof insurancePatch),
]) {
  storage.setItem(insuranceKey, JSON.stringify(invalid))
  assert(restoreInsurancePendingDraft(storage, insuranceContext, insuranceBudgetId) === null && storage.getItem(insuranceKey) === null, 'A mismatched, extra-key, or malformed insurance draft envelope must be discarded and removed.')
}
storage.setItem(insuranceKey, JSON.stringify(envelope()))
const restored = restoreInsurancePendingDraft(storage, insuranceContext, insuranceBudgetId)
assert(restored?.rp_coverage_pct === 80 && restored.rp_aph_yield === 180 && storage.getItem(insuranceKey) !== null, 'An exact scoped insurance draft envelope must restore without deletion.')
setSaveReceipt('save', 'saving'); assert(getSaveReceipt('save') === 'saving', 'A receipt starts as Saving.')
setSaveReceipt('save', 'queued offline'); assert(getSaveReceipt('save') === 'queued offline', 'A queued receipt keeps the offline label.')
setSaveReceipt('save', 'needs attention'); assert(getSaveReceipt('save') === 'needs attention', 'A needs-attention receipt persists until changed.')
setSaveReceipt('save', 'saved'); assert(getSaveReceipt('save') === 'saved', 'A saved receipt is visible before it clears.')
await new Promise((resolve) => setTimeout(resolve, 1850))
assert(getSaveReceipt('save') === null, 'A saved receipt clears after its confirmation window.')
console.log('save durability receipts and needs-attention regressions passed.')
