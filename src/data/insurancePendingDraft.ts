import type { InsuranceBudgetPatch } from './profitability'
import type { StorageLike } from './writeQueue'

export type InsuranceDraftContext = { projectRef: string; userId: string; farmId: string }
export type InsurancePendingDraft = { version: 1; projectRef: string; userId: string; farmId: string; budgetId: string; patch: InsuranceBudgetPatch }

const patchKeys = ['rp_coverage_pct', 'rp_aph_yield', 'rp_projected_price', 'rp_premium_per_acre'] as const

export function insurancePendingDraftKey(budgetId: string) { return `farm-rx.insurance-pending:${budgetId}` }

export function isInsurancePendingDraft(value: unknown, context: InsuranceDraftContext, budgetId: string): value is InsurancePendingDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const envelope = value as Record<string, unknown>
  if (Object.keys(envelope).length !== 6 || envelope.version !== 1 || envelope.projectRef !== context.projectRef || envelope.userId !== context.userId || envelope.farmId !== context.farmId || envelope.budgetId !== budgetId) return false
  const patch = envelope.patch
  return !!patch && typeof patch === 'object' && !Array.isArray(patch) && Object.keys(patch).length === patchKeys.length && patchKeys.every((key) => Object.hasOwn(patch, key) && ((patch as Record<string, unknown>)[key] === null || (typeof (patch as Record<string, unknown>)[key] === 'number' && Number.isFinite((patch as Record<string, unknown>)[key]))))
}

export function writeInsurancePendingDraft(storage: StorageLike, context: InsuranceDraftContext, budgetId: string, patch: InsuranceBudgetPatch) {
  storage.setItem(insurancePendingDraftKey(budgetId), JSON.stringify({ version: 1, ...context, budgetId, patch } satisfies InsurancePendingDraft))
}

/** Returns only a fully scoped, exact draft; invalid local bytes are removed fail-closed. */
export function restoreInsurancePendingDraft(storage: StorageLike, context: InsuranceDraftContext | null, budgetId: string): InsuranceBudgetPatch | null {
  const key = insurancePendingDraftKey(budgetId)
  const stored = storage.getItem(key)
  if (!stored || !context) return null
  try {
    const parsed: unknown = JSON.parse(stored)
    if (isInsurancePendingDraft(parsed, context, budgetId)) return parsed.patch
  } catch { /* invalid bytes are removed below */ }
  storage.removeItem(key)
  return null
}

/** A failed or superseded save deliberately leaves the latest draft in place. */
export function settleInsurancePendingDraft(storage: StorageLike, budgetId: string, saved: boolean, isCurrentRevision: boolean) {
  if (saved && isCurrentRevision) storage.removeItem(insurancePendingDraftKey(budgetId))
}
