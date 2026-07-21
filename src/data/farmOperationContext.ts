import { captureFarmRevocationFence, verifyFarmRevocationFence, type FarmRevocationSnapshot } from './farmRevocationFence'
import { FarmReplayContextChangedError, type StorageLike } from './writeQueue'

export type FarmOperationContext = FarmRevocationSnapshot
export type FarmSelectionContext = Pick<FarmOperationContext, 'userId' | 'farmId'>

const changed = 'The signed-in account or selected farm changed before this operation could finish.'

export function captureFarmOperationContext(storage: StorageLike, projectRef: string, context: FarmSelectionContext): FarmOperationContext {
  return captureFarmRevocationFence(storage, { projectRef, ...context })
}

export function verifyFarmOperationContext(storage: StorageLike, expected: FarmOperationContext, current: FarmOperationContext): void {
  if (expected.projectRef !== current.projectRef || expected.userId !== current.userId || expected.farmId !== current.farmId || expected.generation !== current.generation || expected.token !== current.token || expected.serverEpoch !== current.serverEpoch) throw new FarmReplayContextChangedError(changed)
  try { verifyFarmRevocationFence(storage, expected) } catch (error) { throw new FarmReplayContextChangedError(error instanceof Error ? error.message : changed) }
}

export function farmOperationRequestHeaders(context: FarmOperationContext): Record<string, string> {
  return {
    'x-farm-rx-expected-user-id': context.userId,
    'x-farm-rx-access-epochs': JSON.stringify({ [context.farmId]: context.serverEpoch }),
  }
}

/** PostgREST builders clone a private Headers object into the eventual request.
 * Binding that builder before it executes makes the operation's user and epoch
 * immutable even if Supabase publishes a different session a moment later. */
export function bindFarmOperationRequest<T>(request: T, context: FarmOperationContext): T {
  const headers = (request as { headers?: unknown }).headers
  if (!(headers instanceof Headers)) throw new Error('Farm Rx could not bind this save to the signed-in account.')
  for (const [name, value] of Object.entries(farmOperationRequestHeaders(context))) headers.set(name, value)
  return request
}
