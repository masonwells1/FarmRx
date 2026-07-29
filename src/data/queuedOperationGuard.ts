import { captureFarmOperationContext, verifyFarmOperationContext, type FarmOperationContext, type FarmSelectionContext } from './farmOperationContext'
import { ensureQueueFarmGrant } from './farmRevocationFence'
import type { StorageLike } from './writeQueue'

export type QueuedOperationGuardDependencies = {
  getContext: () => Promise<FarmSelectionContext>
  projectRef: string
  storage: StorageLike
}

const changed = 'The signed-in account or selected farm changed before this operation could finish.'

export async function captureQueuedOperationContext(dependencies: QueuedOperationGuardDependencies): Promise<FarmOperationContext> {
  const context = await dependencies.getContext()
  ensureQueueFarmGrant(dependencies.storage, { projectRef: dependencies.projectRef, ...context })
  return captureFarmOperationContext(dependencies.storage, dependencies.projectRef, context)
}

/** Re-read both the active account/farm and the durable grant fence. Queue-key
 * equality alone is not enough: revoke/regrant can reuse the same IDs. */
export async function verifyQueuedOperationContext(
  dependencies: QueuedOperationGuardDependencies,
  expected: FarmOperationContext,
  entry?: FarmSelectionContext,
): Promise<void> {
  if (entry && (entry.userId !== expected.userId || entry.farmId !== expected.farmId)) throw new Error(changed)
  // Do this durable, synchronous fence check before asking FarmContext for
  // the current selection. Access removal may hold its validation boundary
  // while waiting for farm custody; a writer that already holds custody must
  // see the revocation and release instead of waiting for that validation.
  ensureQueueFarmGrant(dependencies.storage, { projectRef: dependencies.projectRef, userId: expected.userId, farmId: expected.farmId })
  const current = await captureQueuedOperationContext(dependencies)
  verifyFarmOperationContext(dependencies.storage, expected, current)
}

/** Read paths need the same fail-closed identity check as queued writes. This
 * must run after every awaited replay/live/cache boundary and before a value is
 * retained or returned, because those collaborators may resolve a new session. */
export async function verifyQueuedReadContext(
  dependencies: QueuedOperationGuardDependencies,
  expected: FarmOperationContext,
): Promise<void> {
  await verifyQueuedOperationContext(dependencies, expected, expected)
}
