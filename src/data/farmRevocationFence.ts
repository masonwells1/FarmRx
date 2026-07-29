import type { StorageLike } from './writeQueue'

export type FarmRevocationScope = { projectRef: string; userId: string; farmId: string }
export type FarmRevocationSnapshot = FarmRevocationScope & { generation: number; token: string; serverEpoch: number }
type Fence = { version: 2; generation: number; token: string; serverEpoch: number; revoked: boolean; changedAt: string }
type GenerationLedger = { version: 2; generation: number; token: string; serverEpoch: number; changedAt: string }
type RevocationRecoveryFence = { version: 1; prior: FarmRevocationSnapshot }
type EnumeratedStorage = StorageLike & { readonly length: number; key(index: number): string | null }

const blocked = 'Access to this farm changed while work was being saved. Nothing was queued or replayed.'
const queueKeyPattern = /^farm-rx-[^:]+:v1:([^:]+):([^:]+):([^:]+)$/
const fenceKeyPattern = /^farm-rx-revocation-(?:fence|generation):v1:([^:]+):([^:]+):([^:]+)$/
const tokenPattern = /^[a-z0-9-]{16,128}$/i

function nextToken() { return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}` }
function browserStorage(storage: StorageLike) { return typeof window !== 'undefined' && storage === window.localStorage }

export function farmRevocationFenceKey(scope: FarmRevocationScope) {
  return `farm-rx-revocation-fence:v1:${scope.projectRef}:${scope.userId}:${scope.farmId}`
}

export function farmRevocationGenerationKey(scope: FarmRevocationScope) {
  return `farm-rx-revocation-generation:v1:${scope.projectRef}:${scope.userId}:${scope.farmId}`
}

function farmRevocationRecoveryKey(scope: FarmRevocationScope) {
  return `farm-rx-revocation-recovery:v1:${scope.projectRef}:${scope.userId}:${scope.farmId}`
}

function parseFence(raw: string): Fence {
  try {
    const value = JSON.parse(raw) as Partial<Fence>
    if (value.version !== 2 || !Number.isSafeInteger(value.generation) || value.generation! < 1 || typeof value.token !== 'string' || !tokenPattern.test(value.token) || !Number.isSafeInteger(value.serverEpoch) || value.serverEpoch! < 1 || typeof value.revoked !== 'boolean' || typeof value.changedAt !== 'string' || Number.isNaN(Date.parse(value.changedAt))) throw new Error()
    return value as Fence
  } catch { throw new Error(blocked) }
}

function parseLedger(raw: string): GenerationLedger {
  try {
    const value = JSON.parse(raw) as Partial<GenerationLedger>
    if (value.version !== 2 || !Number.isSafeInteger(value.generation) || value.generation! < 1 || typeof value.token !== 'string' || !tokenPattern.test(value.token) || !Number.isSafeInteger(value.serverEpoch) || value.serverEpoch! < 1 || typeof value.changedAt !== 'string' || Number.isNaN(Date.parse(value.changedAt))) throw new Error()
    return value as GenerationLedger
  } catch { throw new Error(blocked) }
}

function readState(storage: StorageLike, scope: FarmRevocationScope) {
  const fenceRaw = storage.getItem(farmRevocationFenceKey(scope))
  const ledgerRaw = storage.getItem(farmRevocationGenerationKey(scope))
  const fence = fenceRaw === null ? null : parseFence(fenceRaw)
  const ledger = ledgerRaw === null ? null : parseLedger(ledgerRaw)
  if (fence && ledger && (fence.generation !== ledger.generation || fence.token !== ledger.token || fence.serverEpoch !== ledger.serverEpoch)) throw new Error(blocked)
  return { fence, ledger }
}

/** Read each durable half independently only while repairing an interrupted
 * write. Normal authorization continues to require the matching pair. */
function readIndependentState(storage: StorageLike, scope: FarmRevocationScope) {
  let fence: Fence | null = null; let ledger: GenerationLedger | null = null
  try { const raw = storage.getItem(farmRevocationFenceKey(scope)); if (raw !== null) fence = parseFence(raw) } catch { /* not independently valid */ }
  try { const raw = storage.getItem(farmRevocationGenerationKey(scope)); if (raw !== null) ledger = parseLedger(raw) } catch { /* not independently valid */ }
  return { fence, ledger }
}

/** The local removed-epoch fallback may finish only this exact interrupted
 * mark: an active fence followed by its one-generation ledger at the same
 * authoritative epoch. Every other invalid state remains blocked. */
function readExactLocalRevocationPartial(storage: StorageLike, scope: FarmRevocationScope, serverEpoch: number): GenerationLedger | undefined {
  const { fence, ledger } = readIndependentState(storage, scope)
  if (!fence || !ledger || fence.revoked || fence.serverEpoch !== serverEpoch || ledger.serverEpoch !== serverEpoch || ledger.generation !== fence.generation + 1) return undefined
  return ledger
}

function readFence(storage: StorageLike, scope: FarmRevocationScope): Fence {
  const { fence, ledger } = readState(storage, scope)
  if (!fence || !ledger) throw new Error(blocked)
  return fence
}

function parseRecoveryFence(raw: string, scope: FarmRevocationScope): FarmRevocationSnapshot {
  try {
    const value = JSON.parse(raw) as Partial<RevocationRecoveryFence>
    const prior = value.prior
    if (!prior || typeof prior !== 'object' || Array.isArray(prior) || Object.keys(value).length !== 2 || value.version !== 1 || Object.keys(prior).length !== 6 || prior.projectRef !== scope.projectRef || prior.userId !== scope.userId || prior.farmId !== scope.farmId || !Number.isSafeInteger(prior.generation) || prior.generation < 1 || typeof prior.token !== 'string' || !tokenPattern.test(prior.token) || !Number.isSafeInteger(prior.serverEpoch) || prior.serverEpoch < 1) throw new Error()
    return prior
  } catch { throw new Error(blocked) }
}

function writeFence(storage: StorageLike, scope: FarmRevocationScope, value: Fence) {
  const ledgerKey = farmRevocationGenerationKey(scope)
  const fenceKey = farmRevocationFenceKey(scope)
  const ledgerBytes = JSON.stringify({ version: 2, generation: value.generation, token: value.token, serverEpoch: value.serverEpoch, changedAt: value.changedAt } satisfies GenerationLedger)
  const fenceBytes = JSON.stringify(value)
  // Advance the independent generation ledger first. A tab observing a partial
  // write sees a mismatch and fails closed instead of accepting the old fence.
  storage.setItem(ledgerKey, ledgerBytes)
  if (storage.getItem(ledgerKey) !== ledgerBytes || JSON.stringify(parseLedger(ledgerBytes)) !== ledgerBytes) throw new Error(blocked)
  storage.setItem(fenceKey, fenceBytes)
  if (storage.getItem(fenceKey) !== fenceBytes || JSON.stringify(readFence(storage, scope)) !== fenceBytes) throw new Error(blocked)
}

export function queueFarmRevocationScope(key: string): FarmRevocationScope | null {
  const match = queueKeyPattern.exec(key)
  return match ? { projectRef: match[1]!, userId: match[2]!, farmId: match[3]! } : null
}

export function listFarmRevocationScopes(storage: EnumeratedStorage, projectRef: string, userId: string): FarmRevocationScope[] {
  const farmIds = new Set<string>()
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index); if (!key || key.endsWith(':lease')) continue
    const match = queueKeyPattern.exec(key) ?? fenceKeyPattern.exec(key)
    if (match?.[1] === projectRef && match[2] === userId) farmIds.add(match[3]!)
  }
  return [...farmIds].sort().map((farmId) => ({ projectRef, userId, farmId }))
}

export function inspectFarmRevocationState(storage: StorageLike, scope: FarmRevocationScope): { kind: 'missing' | 'invalid' | 'active' | 'revoked'; generation?: number; serverEpoch?: number } {
  const fenceRaw = storage.getItem(farmRevocationFenceKey(scope)); const ledgerRaw = storage.getItem(farmRevocationGenerationKey(scope))
  if (fenceRaw === null && ledgerRaw === null) return { kind: 'missing' }
  try {
    const { fence, ledger } = readState(storage, scope)
    if (!fence || !ledger) return { kind: 'invalid', generation: fence?.generation ?? ledger?.generation, serverEpoch: fence?.serverEpoch ?? ledger?.serverEpoch }
    return { kind: fence.revoked ? 'revoked' : 'active', generation: fence.generation, serverEpoch: fence.serverEpoch }
  } catch {
    let fence: Fence | null = null; let ledger: GenerationLedger | null = null
    try { if (fenceRaw !== null) fence = parseFence(fenceRaw) } catch { /* retain any independently valid ledger */ }
    try { if (ledgerRaw !== null) ledger = parseLedger(ledgerRaw) } catch { /* retain any independently valid fence */ }
    const generation = Math.max(fence?.generation ?? 0, ledger?.generation ?? 0) || undefined
    const serverEpoch = Math.max(fence?.serverEpoch ?? 0, ledger?.serverEpoch ?? 0) || undefined
    return { kind: 'invalid', generation, serverEpoch }
  }
}

/** Authoritative live recovery after queues are quarantined and caches deleted. */
export function resetFarmGrantFromLive(storage: StorageLike, scope: FarmRevocationScope, serverEpoch: number, changedAt = new Date().toISOString()): number {
  if (!Number.isSafeInteger(serverEpoch) || serverEpoch < 1 || Number.isNaN(Date.parse(changedAt))) throw new Error(blocked)
  let generation = serverEpoch
  try { const state = readState(storage, scope); generation = Math.max(serverEpoch, state.fence?.generation ?? 0, state.ledger?.generation ?? 0) + 1 } catch { /* invalid metadata is replaced only after durable quarantine/cache cleanup */ }
  writeFence(storage, scope, { version: 2, generation, token: nextToken(), serverEpoch, revoked: false, changedAt })
  return generation
}

export function resetFarmRevokedFromLive(storage: StorageLike, scope: FarmRevocationScope, serverEpoch: number, changedAt = new Date().toISOString()): number {
  if (!Number.isSafeInteger(serverEpoch) || serverEpoch < 1 || Number.isNaN(Date.parse(changedAt))) throw new Error(blocked)
  let generation = serverEpoch
  try { const state = readState(storage, scope); generation = Math.max(serverEpoch, state.fence?.generation ?? 0, state.ledger?.generation ?? 0) + 1 } catch {
    const { fence, ledger } = readIndependentState(storage, scope)
    const highestEpoch = Math.max(fence?.serverEpoch ?? 0, ledger?.serverEpoch ?? 0)
    if (highestEpoch > serverEpoch) throw new Error(blocked)
    // The ledger is written first. Resume it only when it is exactly the next
    // authoritative revoked generation from an active, non-regressing fence.
    // Equal-generation token mismatches are corrupt state, never an intent.
    const expectedGeneration = fence && !fence.revoked && fence.serverEpoch <= serverEpoch
      ? Math.max(serverEpoch, fence.generation) + 1
      : null
    if (ledger && expectedGeneration !== null && ledger.serverEpoch === serverEpoch && ledger.generation === expectedGeneration) {
      writeFence(storage, scope, { version: 2, generation: ledger.generation, token: ledger.token, serverEpoch, revoked: true, changedAt: ledger.changedAt })
      return ledger.generation
    }
    generation = Math.max(serverEpoch, fence?.generation ?? 0, ledger?.generation ?? 0) + 1
    // A non-exact partial state is not eligible to consume a retained receipt.
    // Advance past its formula so only an exact ledger-before-fence resume can
    // quarantine already-saved v2 work.
    try {
      const prior = parseRecoveryFence(storage.getItem(farmRevocationRecoveryKey(scope)) ?? '', scope)
      if (generation === Math.max(serverEpoch, prior.generation) + 1) generation += 1
    } catch { /* no independently valid retained receipt */ }
  }
  writeFence(storage, scope, { version: 2, generation, token: nextToken(), serverEpoch, revoked: true, changedAt })
  return generation
}

export function captureFarmRevocationFence(storage: StorageLike, scope: FarmRevocationScope): FarmRevocationSnapshot {
  const current = readFence(storage, scope)
  if (current.revoked) throw new Error(blocked)
  return { ...scope, generation: current.generation, token: current.token, serverEpoch: current.serverEpoch }
}

/** Retain an active custody snapshot before publishing a revoked fence. It is
 * not authorization: it can only prove which already-queued v2 Field Log
 * bytes may be moved into recovery if custody acquisition is interrupted. */
export function prepareFarmRevocationRecoveryFence(storage: StorageLike, scope: FarmRevocationScope): FarmRevocationSnapshot {
  const prior = captureFarmRevocationFence(storage, scope)
  const key = farmRevocationRecoveryKey(scope)
  const bytes = JSON.stringify({ version: 1, prior } satisfies RevocationRecoveryFence)
  storage.setItem(key, bytes)
  if (storage.getItem(key) !== bytes || JSON.stringify({ version: 1, prior: parseRecoveryFence(bytes, scope) }) !== bytes) throw new Error(blocked)
  return prior
}

/** A retained prior fence is usable only for the exact revoked generation a
 * live reset would create. A removal may advance the server epoch; this never permits
 * queue replay or a grant. */
export function readFarmRevocationRecoveryFence(storage: StorageLike, scope: FarmRevocationScope): FarmRevocationSnapshot | undefined {
  const raw = storage.getItem(farmRevocationRecoveryKey(scope))
  if (raw === null) return undefined
  let prior: FarmRevocationSnapshot
  try { prior = parseRecoveryFence(raw, scope) } catch { return undefined }
  let current: Fence
  try { current = readFence(storage, scope) } catch { return undefined }
  if (!current.revoked || current.serverEpoch < prior.serverEpoch || current.generation !== Math.max(current.serverEpoch, prior.generation) + 1 || current.token === prior.token) return undefined
  return prior
}

export function clearFarmRevocationRecoveryFence(storage: StorageLike, scope: FarmRevocationScope, prior: FarmRevocationSnapshot): void {
  const key = farmRevocationRecoveryKey(scope)
  const raw = storage.getItem(key)
  if (raw === null) return
  try {
    const stored = parseRecoveryFence(raw, scope)
    if (stored.generation !== prior.generation || stored.token !== prior.token || stored.serverEpoch !== prior.serverEpoch) return
  } catch { return }
  storage.removeItem(key)
  if (storage.getItem(key) !== null) throw new Error(blocked)
}

export function verifyFarmRevocationFence(storage: StorageLike, snapshot: FarmRevocationSnapshot): void {
  const current = readFence(storage, snapshot)
  if (current.revoked || current.generation !== snapshot.generation || current.token !== snapshot.token || current.serverEpoch !== snapshot.serverEpoch) throw new Error(blocked)
}

export function markFarmRevoked(storage: StorageLike, scope: FarmRevocationScope, changedAt = new Date().toISOString(), serverEpoch?: number): number {
  let fence: Fence | null; let ledger: GenerationLedger | null
  try { ({ fence, ledger } = readState(storage, scope)) } catch {
    if (!serverEpoch || !Number.isSafeInteger(serverEpoch) || serverEpoch < 1) throw new Error(blocked)
    const partial = readExactLocalRevocationPartial(storage, scope, serverEpoch)
    if (!partial) throw new Error(blocked)
    writeFence(storage, scope, { version: 2, generation: partial.generation, token: partial.token, serverEpoch, revoked: true, changedAt: partial.changedAt })
    return partial.generation
  }
  if (fence?.revoked && ledger) return fence.generation
  const generation = Math.max(fence?.generation ?? 0, ledger?.generation ?? 0) + 1
  const authoritativeEpoch = serverEpoch ?? fence?.serverEpoch ?? ledger?.serverEpoch
  if (!authoritativeEpoch) throw new Error(blocked)
  writeFence(storage, scope, { version: 2, generation, token: nextToken(), serverEpoch: authoritativeEpoch, revoked: true, changedAt })
  return generation
}

export function markFarmGranted(storage: StorageLike, scope: FarmRevocationScope, changedAt = new Date().toISOString(), serverEpoch?: number): number {
  const { fence, ledger } = readState(storage, scope)
  if (Number.isNaN(Date.parse(changedAt))) throw new Error(blocked)
  const authoritativeEpoch = serverEpoch ?? (!browserStorage(storage) ? fence?.serverEpoch ?? ledger?.serverEpoch ?? 1 : undefined)
  if (!authoritativeEpoch || !Number.isSafeInteger(authoritativeEpoch) || authoritativeEpoch < 1) throw new Error(blocked)
  const lastChangedAt = fence?.changedAt ?? ledger?.changedAt
  // A live farm list is authoritative only for the snapshot time at which its
  // request began. A delayed older response must not undo a newer revocation.
  if ((!fence || fence.revoked) && lastChangedAt && Date.parse(lastChangedAt) > Date.parse(changedAt)) throw new Error(blocked)
  const epochChanged = !!fence && fence.serverEpoch !== authoritativeEpoch
  const generation = Math.max(fence?.generation ?? 0, ledger?.generation ?? 0, 1) + (epochChanged ? 1 : 0)
  if (fence && ledger && !fence.revoked && !epochChanged) return generation
  writeFence(storage, scope, { version: 2, generation, token: nextToken(), serverEpoch: authoritativeEpoch, revoked: false, changedAt })
  return generation
}

/** Upgrade a previously stored access snapshot without letting a cached tab
 * undo a revocation. Only an entirely absent pre-upgrade fence is initialized;
 * partial, corrupt, or revoked state remains blocked until a live access check. */
export function ensureStoredFarmGrant(storage: StorageLike, scope: FarmRevocationScope): number {
  const snapshot = captureFarmRevocationFence(storage, scope)
  return snapshot.generation
}

/** Repository compatibility for isolated tests and pre-access bootstrap only.
 * In the browser, an existing access snapshot with missing fence metadata is a
 * known farm and therefore fails closed instead of being silently re-created. */
export function ensureQueueFarmGrant(storage: StorageLike, scope: FarmRevocationScope): number {
  const { fence, ledger } = readState(storage, scope)
  if (!fence && !ledger) {
    if (browserStorage(storage)) throw new Error(blocked)
    return resetFarmGrantFromLive(storage, scope, 1)
  }
  return captureFarmRevocationFence(storage, scope).generation
}
