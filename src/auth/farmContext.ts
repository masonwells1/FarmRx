import { supabase } from '../lib/supabaseClient'
import { supabaseConfig } from '../lib/supabaseConfig'
import type { Farm } from '../data/fields'
import { deleteUserWorkspaceCaches, maximumClockSkewMs } from '../data/workspaceCache'
import { quarantineRevokedFarmWork } from '../data/revokedFarmRecovery'
import { captureFarmRevocationFence, inspectFarmRevocationState, listFarmRevocationScopes, markFarmGranted, markFarmRevoked, resetFarmGrantFromLive, resetFarmRevokedFromLive, verifyFarmRevocationFence, type FarmRevocationSnapshot } from '../data/farmRevocationFence'
import { coordinatedDeviceTransaction } from '../data/queueTransaction'
import { clearDeviceClockHighWater, DeviceClockRollbackError, observeDeviceTime, verifyObservedDeviceTime } from '../data/deviceClockFence'
import { FarmReplayContextChangedError, type StorageLike } from '../data/writeQueue'
import { clearFarmAccessEpochs, farmActiveContextKey, readFarmAccessEpochs, writeFarmAccessEpochs } from './farmAccessEpoch'

export type FarmAccessSource = 'live' | 'offline'
export type FarmAccess = { userId: string; farms: Farm[]; selectedFarmId: string | null; validatedAt: string; source: FarmAccessSource }
type StoredAccess = Omit<FarmAccess, 'source'> & { version: 1 }

export class FarmAccessStorageUnsafeError extends Error {
  constructor() {
    super('Farm Rx could not safely save your farm choice. Reopen Farm Rx and try again.')
    this.name = 'FarmAccessStorageUnsafeError'
  }
}

export type FarmAccessProfileKind = 'owner' | 'manager' | 'worker' | 'financial_worker' | 'read_only' | 'named_rep'
export type FarmAccessCapabilities = {
  canViewOperational: boolean
  canEditOperational: boolean
  canManageFarm: boolean
  canReadPrivateFinancials: boolean
  canUseMembershipOnlyModules: boolean
}
export type FarmAccessProfile = {
  userId: string
  farmId: string
  kind: FarmAccessProfileKind
  memberRole: 'owner' | 'manager' | 'worker' | 'read_only' | null
  memberCanViewFinancials: boolean
  isNamedRep: boolean
  accessEpoch: number
  validatedAt: string
  source: FarmAccessSource
  capabilities: FarmAccessCapabilities
}
export type LoadedFarmAccessProfile = FarmAccessProfile & { operationContext: FarmRevocationSnapshot }
export type FarmAppModule = 'fields' | 'grain' | 'inventory' | 'profitability' | 'equipment' | 'tasks' | 'weather' | 'field_log' | 'scouting' | 'harvest' | 'programs' | 'notifications'
const membershipOnlyModules = new Set<FarmAppModule>(['equipment', 'tasks', 'field_log', 'scouting', 'harvest', 'programs'])
const privateFinancialModules = new Set<FarmAppModule>(['grain', 'profitability'])
export function canAccessFarmModule(profile: FarmAccessProfile, module: FarmAppModule): boolean {
  if (!profile.capabilities.canViewOperational) return false
  if (module === 'weather' && !profile.capabilities.canEditOperational) return false
  if (membershipOnlyModules.has(module) && !profile.capabilities.canUseMembershipOnlyModules) return false
  if (privateFinancialModules.has(module) && !profile.capabilities.canReadPrivateFinancials) return false
  return true
}
export function canEditFarmModule(profile: FarmAccessProfile, module: FarmAppModule): boolean { return canAccessFarmModule(profile, module) && profile.capabilities.canEditOperational }
export function canReplayFarmModule(profile: FarmAccessProfile, module: FarmAppModule): boolean { return module === 'notifications' ? canAccessFarmModule(profile, module) : canEditFarmModule(profile, module) }
type StoredAccessProfile = Omit<FarmAccessProfile, 'source'> & {
  version: 1
  accessValidatedAt: string
  clockHighWaterAt: string
  generation: number
  fenceToken: string
}
type MembershipRow = { farm_id: unknown; user_id: unknown; role: unknown; status: unknown; can_view_financials: unknown }
type RepAccessRow = { farm_id: unknown; rep_user_id: unknown; enabled: unknown; revoked_at: unknown }
export type FarmAccessProfileEvidence = {
  membership: MembershipRow | null
  repAccess: RepAccessRow | null
  shareWithRep: unknown
  helpers: {
    canAccessFarm: unknown
    isActiveFarmMember: unknown
    canEditFarm: unknown
    canManageFarm: unknown
    hasExplicitRepAccess: unknown
    canReadPrivateFinancials: unknown
  }
}
export type FarmAccessProfileLoadDependencies = {
  storage: Storage
  isOffline: () => boolean
  /** Returns the current in-memory access token. The token is compared, never persisted. */
  requireSession: (userId: string, signal?: AbortSignal) => Promise<string>
  loadServerEpoch: (userId: string, farmId: string, signal?: AbortSignal) => Promise<number>
  loadEvidence: (userId: string, farmId: string, signal?: AbortSignal) => Promise<FarmAccessProfileEvidence>
  now: () => string
}

const maximumAccessAgeMs = 7 * 24 * 60 * 60 * 1_000
const liveReuseMs = 30_000
const farmAccessReadDeadlineMs = 10_000
const activeKey = farmActiveContextKey(supabaseConfig.projectRef)
const authSessionKey = `farm-rx-auth:${supabaseConfig.projectRef}`
const accessKey = (userId: string) => `farm-rx-access:v1:${supabaseConfig.projectRef}:${userId}`
const validationKey = (userId: string) => `farm-rx-access-validation:v1:${supabaseConfig.projectRef}:${userId}`
const validationLockKey = (userId: string) => `farm-rx-access-validation-lock:v1:${supabaseConfig.projectRef}:${userId}`
const profileKey = (userId: string, farmId: string) => `farm-rx-access-profile:v1:${supabaseConfig.projectRef}:${userId}:${farmId}`
const refreshes = new Map<string, { epoch: number; promise: Promise<FarmAccess> }>()
const accountEpochs = new Map<string, number>()
const replayContextChanged = 'The signed-in account or selected farm changed while saved work was being checked.'
type ExactOfflineAuthorizationEvidence = { activeBytes: string; accessBytes: string; profileBytes: string; expiresAtMs: number; memoryHighWaterMs: number; persistedHighWaterMs: number }
type ActiveFarmReplayGrant = { kind: 'replay'; token: symbol; operationContext: FarmRevocationSnapshot; storage: StorageLike; source: FarmAccessSource; offlineEvidence: ExactOfflineAuthorizationEvidence | null }
type FarmReplayCancellation = { kind: 'cancelled'; token: symbol }
type ActiveFarmReplayAuthorization = ActiveFarmReplayGrant | FarmReplayCancellation
type ActiveFarmReadyAuthorization = { token: symbol; operationContext: FarmRevocationSnapshot; storage: StorageLike; source: FarmAccessSource; offlineEvidence: ExactOfflineAuthorizationEvidence | null }
let activeFarmReplayAuthorization: ActiveFarmReplayAuthorization | null = null
let activeFarmReadyAuthorization: ActiveFarmReadyAuthorization | null = null

function storage(): Storage | null { return typeof window === 'undefined' ? null : window.localStorage }
function cancelActiveFarmReplayAuthorization() { activeFarmReplayAuthorization = { kind: 'cancelled', token: Symbol('farm-replay-cancelled') } }
export function clearFarmReadyAuthorization() { activeFarmReadyAuthorization = null }

function captureExactOfflineAuthorizationEvidence(profile: LoadedFarmAccessProfile, target: StorageLike): ExactOfflineAuthorizationEvidence | null {
  if (profile.source !== 'offline') return null
  const activeBytes = target.getItem(activeKey)
  const accessBytes = target.getItem(accessKey(profile.userId))
  const profileBytes = target.getItem(profileKey(profile.userId, profile.farmId))
  if (!activeBytes || !accessBytes || !profileBytes) return null
  const access = parseStored(profile.userId, target)
  const nowMs = Date.now()
  if (!access || access.selectedFarmId !== profile.farmId || !freshAt(nowMs, access.validatedAt, maximumAccessAgeMs) || !storedAccessIsFenced(access, target)) return null
  try {
    const fence = captureProfileFence(target, { ...access, source: 'offline' }, profile.farmId)
    const storedProfile = parseStoredProfile(target, { ...access, source: 'offline' }, profile.farmId, fence)
    if (!storedProfile || storedProfile.validatedAt !== profile.validatedAt || storedProfile.accessEpoch !== profile.accessEpoch || storedProfile.kind !== profile.kind || !freshAt(nowMs, storedProfile.validatedAt, maximumAccessAgeMs)) return null
    const clockHighWaterMs = Date.parse(storedProfile.clockHighWaterAt)
    const authorizationHighWaterMs = verifyObservedDeviceTime(target, { projectRef: profile.operationContext.projectRef, userId: profile.userId }, new Date(nowMs).toISOString(), clockHighWaterMs)
    return { activeBytes, accessBytes, profileBytes, expiresAtMs: Math.min(Date.parse(access.validatedAt), Date.parse(storedProfile.validatedAt)) + maximumAccessAgeMs, memoryHighWaterMs: authorizationHighWaterMs, persistedHighWaterMs: authorizationHighWaterMs }
  } catch { return null }
}

function verifyExactOfflineAuthorizationEvidence(target: StorageLike, context: FarmRevocationSnapshot, evidence: ExactOfflineAuthorizationEvidence | null) {
  if (!evidence || target.getItem(activeKey) !== evidence.activeBytes || target.getItem(accessKey(context.userId)) !== evidence.accessBytes || target.getItem(profileKey(context.userId, context.farmId)) !== evidence.profileBytes) throw new FarmReplayContextChangedError(replayContextChanged)
  const observedAt = new Date(Date.now()).toISOString()
  let nowMs: number
  try {
    nowMs = verifyObservedDeviceTime(target, { projectRef: context.projectRef, userId: context.userId }, observedAt, evidence.memoryHighWaterMs)
    evidence.memoryHighWaterMs = nowMs
    if (nowMs - evidence.persistedHighWaterMs >= maximumClockSkewMs) {
      nowMs = observeDeviceTime(target, { projectRef: context.projectRef, userId: context.userId }, observedAt)
      evidence.memoryHighWaterMs = nowMs
      evidence.persistedHighWaterMs = nowMs
    }
  } catch { throw new FarmReplayContextChangedError(replayContextChanged) }
  if (nowMs > evidence.expiresAtMs) throw new FarmReplayContextChangedError(replayContextChanged)
}

/**
 * Issues one current validation generation at a time. Starting a newer farm-access
 * validation permanently supersedes every older async validation sequence.
 */
export function createFarmAccessValidationGate() {
  let generation = 0
  return {
    begin() {
      generation += 1
      cancelActiveFarmReplayAuthorization()
      clearFarmReadyAuthorization()
      const expectedGeneration = generation
      return () => generation === expectedGeneration
    },
    invalidate() { generation += 1; cancelActiveFarmReplayAuthorization(); clearFarmReadyAuthorization() },
  }
}

/**
 * Binds a capability-approved replay to the exact account, farm, grant generation,
 * token, and server epoch that produced the profile. A newer gate supersedes an
 * older one permanently; an older async sequence can never become current again.
 */
export function beginFarmReplayAuthorization(profile: LoadedFarmAccessProfile, target: StorageLike | null = storage(), options: { supersede?: boolean } = {}) {
  if (!target || profile.userId !== profile.operationContext.userId || profile.farmId !== profile.operationContext.farmId || profile.accessEpoch !== profile.operationContext.serverEpoch || profile.operationContext.projectRef !== supabaseConfig.projectRef) throw new FarmReplayContextChangedError(replayContextChanged)
  if (activeFarmReplayAuthorization && options.supersede === false) throw new FarmReplayContextChangedError(replayContextChanged)
  verifyFarmRevocationFence(target, profile.operationContext)
  const current: ActiveFarmReplayGrant = { kind: 'replay', token: Symbol('farm-replay'), operationContext: profile.operationContext, storage: target, source: profile.source, offlineEvidence: captureExactOfflineAuthorizationEvidence(profile, target) }
  activeFarmReplayAuthorization = current
  const verify = () => {
    if (activeFarmReplayAuthorization?.kind !== 'replay' || activeFarmReplayAuthorization.token !== current.token) throw new FarmReplayContextChangedError(replayContextChanged)
    verifyFarmRevocationFence(current.storage, current.operationContext)
  }
  return { verify, end: () => { if (activeFarmReplayAuthorization?.token === current.token) activeFarmReplayAuthorization = null } }
}

/** Keeps ordinary reads and saves on the exact validated offline farm after the
 * startup replay has ended. Revalidation, switching, unmounting, and sign-out
 * clear this bounded grant synchronously. */
export function publishFarmReadyAuthorization(profile: LoadedFarmAccessProfile, target: StorageLike | null = storage()) {
  if (!target || profile.userId !== profile.operationContext.userId || profile.farmId !== profile.operationContext.farmId || profile.accessEpoch !== profile.operationContext.serverEpoch || profile.operationContext.projectRef !== supabaseConfig.projectRef) throw new FarmReplayContextChangedError(replayContextChanged)
  verifyFarmRevocationFence(target, profile.operationContext)
  const offlineEvidence = captureExactOfflineAuthorizationEvidence(profile, target)
  if (profile.source === 'offline' && !offlineEvidence) throw new FarmReplayContextChangedError(replayContextChanged)
  if (activeFarmReplayAuthorization?.kind === 'cancelled') activeFarmReplayAuthorization = null
  activeFarmReadyAuthorization = { token: Symbol('farm-ready'), operationContext: profile.operationContext, storage: target, source: profile.source, offlineEvidence }
}

/** Capture an exact offline account/farm before any network-capable lookup. */
export function captureAuthorizedOfflineFarmContext(target: StorageLike | null = storage()) {
  const replay = activeFarmReplayAuthorization
  const ready = activeFarmReadyAuthorization
  return (): { userId: string; farmId: string } | null => {
    if (replay?.kind === 'cancelled') throw new FarmReplayContextChangedError(replayContextChanged)
    const captured = replay?.kind === 'replay' ? replay : ready
    if (!captured || captured.source !== 'offline') return null
    const replayIsCurrent = replay?.kind === 'replay'
      ? activeFarmReplayAuthorization?.kind === 'replay' && activeFarmReplayAuthorization.token === replay.token
      : activeFarmReplayAuthorization === replay
    const readyIsCurrent = replay?.kind === 'replay'
      ? true
      : !!ready && activeFarmReadyAuthorization?.token === ready.token
    if (!target || target !== captured.storage || !replayIsCurrent || !readyIsCurrent) throw new FarmReplayContextChangedError(replayContextChanged)
    verifyFarmRevocationFence(captured.storage, captured.operationContext)
    verifyExactOfflineAuthorizationEvidence(captured.storage, captured.operationContext, captured.offlineEvidence)
    return { userId: captured.operationContext.userId, farmId: captured.operationContext.farmId }
  }
}

/** Queue services use the exact authorized profile source rather than the
 * browser's unreliable connectivity hint while startup/retry replay is active. */
export function isFarmReplayAuthoritativelyOffline(target: StorageLike | null = storage()): boolean {
  if (activeFarmReplayAuthorization?.kind === 'cancelled') return false
  return captureAuthorizedOfflineFarmContext(target)() !== null
}

/** Capture synchronously before the first await in a repository context lookup. */
export function captureFarmReplayContextGuard(target: StorageLike | null = storage()) {
  const captured = activeFarmReplayAuthorization
  return <T extends { userId: string; farmId: string }>(context: T): T => {
    if (!captured) return context
    if (captured.kind === 'cancelled') throw new FarmReplayContextChangedError(replayContextChanged)
    if (!target || target !== captured.storage || activeFarmReplayAuthorization?.kind !== 'replay' || activeFarmReplayAuthorization.token !== captured.token || context.userId !== captured.operationContext.userId || context.farmId !== captured.operationContext.farmId) throw new FarmReplayContextChangedError(replayContextChanged)
    verifyFarmRevocationFence(captured.storage, captured.operationContext)
    return context
  }
}

/** Capture the replay grant before currentUserId performs its first async lookup. */
export function captureFarmReplayUserGuard(target: StorageLike | null = storage()) {
  const captured = activeFarmReplayAuthorization
  return <T extends string>(userId: T): T => {
    if (!captured) return userId
    if (captured.kind === 'cancelled') throw new FarmReplayContextChangedError(replayContextChanged)
    if (!target || target !== captured.storage || activeFarmReplayAuthorization?.kind !== 'replay' || activeFarmReplayAuthorization.token !== captured.token || userId !== captured.operationContext.userId) throw new FarmReplayContextChangedError(replayContextChanged)
    verifyFarmRevocationFence(captured.storage, captured.operationContext)
    return userId
  }
}

function removeStoredProfiles(target: Storage, userId: string, farmId?: string) {
  const prefix = farmId ? profileKey(userId, farmId) : `farm-rx-access-profile:v1:${supabaseConfig.projectRef}:${userId}:`
  const keys: string[] = []
  for (let index = 0; index < target.length; index += 1) { const key = target.key(index); if (key && (farmId ? key === prefix : key.startsWith(prefix))) keys.push(key) }
  for (const key of keys) target.removeItem(key)
}
function invalidateStoredAuthorization(target: Storage, userId: string) {
  target.removeItem(accessKey(userId)); removeStoredProfiles(target, userId)
  const active = target.getItem(activeKey)
  try { if ((JSON.parse(active ?? '') as { userId?: unknown }).userId === userId) target.removeItem(activeKey) } catch { target.removeItem(activeKey) }
}
function parseStored(userId: string, target: StorageLike | null = storage()): StoredAccess | null {
  const raw = target?.getItem(accessKey(userId)); if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<StoredAccess>
    if (value.version !== 1 || value.userId !== userId || !Array.isArray(value.farms) || typeof value.validatedAt !== 'string' || Number.isNaN(Date.parse(value.validatedAt)) || !(value.selectedFarmId === null || typeof value.selectedFarmId === 'string')) return null
    const farms = value.farms.filter((farm): farm is Farm => !!farm && typeof farm === 'object' && typeof farm.id === 'string' && typeof farm.name === 'string')
    if (farms.length !== value.farms.length || value.selectedFarmId !== null && !farms.some((farm) => farm.id === value.selectedFarmId)) return null
    return { version: 1, userId, farms, selectedFarmId: value.selectedFarmId, validatedAt: value.validatedAt }
  } catch { return null }
}
function restoreStoredValue(target: Storage, key: string, value: string | null) {
  if (value === null) target.removeItem(key)
  else target.setItem(key, value)
}

function persist(value: StoredAccess) {
  const target = storage(); if (!target) return
  const storedAccessKey = accessKey(value.userId)
  const priorAccess = target.getItem(storedAccessKey)
  const priorActive = target.getItem(activeKey)
  try {
    target.setItem(storedAccessKey, JSON.stringify(value))
    if (value.selectedFarmId) target.setItem(activeKey, JSON.stringify({ version: 1, userId: value.userId, farmId: value.selectedFarmId }))
    else target.removeItem(activeKey)
  } catch (error) {
    let rollbackFailed = false
    try { restoreStoredValue(target, storedAccessKey, priorAccess) } catch { rollbackFailed = true }
    try { restoreStoredValue(target, activeKey, priorActive) } catch { rollbackFailed = true }
    if (rollbackFailed) {
      try { invalidateStoredAuthorization(target, value.userId) } catch { /* storage is already unsafe; the caller fails closed */ }
      throw new FarmAccessStorageUnsafeError()
    }
    throw error
  }
}
function offline() { return typeof navigator !== 'undefined' && navigator.onLine === false }
export function isDefiniteTransportFailure(error: unknown): boolean {
  const pending: unknown[] = [error]
  const seen = new Set<unknown>()
  while (pending.length) {
    const current = pending.shift()
    if (current === null || current === undefined || seen.has(current)) continue
    seen.add(current)
    if (current instanceof TypeError) return true
    if (typeof current === 'object') {
      const value = current as { name?: unknown; status?: unknown; code?: unknown; message?: unknown; cause?: unknown }
      const name = typeof value.name === 'string' ? value.name : ''
      const status = typeof value.status === 'number' ? value.status : Number.NaN
      const code = typeof value.code === 'string' ? value.code : ''
      const message = typeof value.message === 'string' ? value.message : ''
      if (name === 'AbortError' || name === 'AuthRetryableFetchError' || name === 'TypeError' || status === 0 || status === 408 || status >= 500 && status <= 599 || /^(?:ABORT_ERR|ECONN|ENET|EHOST|ETIMEDOUT|EAI_AGAIN|UND_ERR)/i.test(code) || /aborted|network|fetch|timeout|connection|failed to send|socket|ECONN|ENET|EHOST|EAI_AGAIN/i.test(message)) return true
      if (value.cause !== undefined) pending.push(value.cause)
      continue
    }
    if (/aborted|network|fetch|timeout|connection|failed to send|socket|ECONN|ENET|EHOST|EAI_AGAIN/i.test(String(current))) return true
  }
  return false
}
function transport(error: unknown) { return offline() || isDefiniteTransportFailure(error) }
function accessReadTimeoutError() { const error = new Error('Farm access verification timed out.'); error.name = 'AbortError'; return error }
function withAbortSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(accessReadTimeoutError())
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(accessReadTimeoutError())
    signal.addEventListener('abort', aborted, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted))
  })
}
function readDeadline() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), farmAccessReadDeadlineMs)
  return { signal: controller.signal, clear: () => clearTimeout(timer) }
}
function storedAccessIsFenced(value: StoredAccess, target: StorageLike | null = storage()): boolean {
  if (!target && value.farms.length) return false
  const epochs = target ? readFarmAccessEpochs(target, supabaseConfig.projectRef, value.userId) : null
  if (!epochs || Object.keys(epochs).length !== value.farms.length) return false
  try {
    for (const farm of value.farms) {
      const snapshot = captureFarmRevocationFence(target!, { projectRef: supabaseConfig.projectRef, userId: value.userId, farmId: farm.id })
      if (snapshot.serverEpoch !== epochs[farm.id]) return false
    }
    return true
  } catch { return false }
}

const memberRoles = new Set(['owner', 'manager', 'worker', 'read_only'])
const memberStatuses = new Set(['invited', 'active', 'suspended', 'revoked'])
function malformedProfile(): never { throw new Error('Farm Rx could not verify your permissions for this farm.') }
function strictBoolean(value: unknown): boolean { if (typeof value !== 'boolean') malformedProfile(); return value }
function validStamp(value: unknown): value is string { return typeof value === 'string' && !Number.isNaN(Date.parse(value)) }
function freshAt(nowMs: number, value: unknown, maximumAgeMs: number): value is string {
  if (!validStamp(value)) return false
  const ageMs = nowMs - Date.parse(value)
  return ageMs >= -maximumClockSkewMs && ageMs <= maximumAgeMs
}

export function deriveFarmAccessProfile(userId: string, farmId: string, accessEpoch: number, validatedAt: string, evidence: FarmAccessProfileEvidence): FarmAccessProfile {
  if (!Number.isSafeInteger(accessEpoch) || accessEpoch < 1 || !validStamp(validatedAt) || typeof evidence.shareWithRep !== 'boolean') malformedProfile()
  const membership = evidence.membership
  let memberRole: FarmAccessProfile['memberRole'] = null
  let activeMember = false
  let memberCanViewFinancials = false
  if (membership !== null) {
    if (!membership || typeof membership !== 'object' || membership.farm_id !== farmId || membership.user_id !== userId || !memberRoles.has(String(membership.role)) || !memberStatuses.has(String(membership.status)) || typeof membership.can_view_financials !== 'boolean') malformedProfile()
    activeMember = membership.status === 'active'
    if (activeMember) {
      memberRole = membership.role as NonNullable<FarmAccessProfile['memberRole']>
      memberCanViewFinancials = membership.can_view_financials
    }
  }
  const repAccess = evidence.repAccess
  let activeNamedRep = false
  if (repAccess !== null) {
    if (!repAccess || typeof repAccess !== 'object' || repAccess.farm_id !== farmId || repAccess.rep_user_id !== userId || typeof repAccess.enabled !== 'boolean' || !(repAccess.revoked_at === null || validStamp(repAccess.revoked_at))) malformedProfile()
    activeNamedRep = evidence.shareWithRep && repAccess.enabled && repAccess.revoked_at === null
  }
  const helpers = evidence.helpers
  const canAccessFarm = strictBoolean(helpers.canAccessFarm)
  const isActiveFarmMember = strictBoolean(helpers.isActiveFarmMember)
  const canEditFarm = strictBoolean(helpers.canEditFarm)
  const canManageFarm = strictBoolean(helpers.canManageFarm)
  const hasExplicitRepAccess = strictBoolean(helpers.hasExplicitRepAccess)
  const canReadPrivateFinancials = strictBoolean(helpers.canReadPrivateFinancials)
  const expectedEdit = activeMember && (memberRole === 'owner' || memberRole === 'manager' || memberRole === 'worker')
  const expectedManage = activeMember && (memberRole === 'owner' || memberRole === 'manager')
  const expectedPrivate = activeNamedRep || activeMember && (memberRole === 'owner' || memberRole === 'manager' || memberCanViewFinancials)
  if (isActiveFarmMember !== activeMember || hasExplicitRepAccess !== activeNamedRep || canAccessFarm !== (activeMember || activeNamedRep) || canEditFarm !== expectedEdit || canManageFarm !== expectedManage || canReadPrivateFinancials !== expectedPrivate || !canAccessFarm) malformedProfile()
  const kind: FarmAccessProfileKind = memberRole === 'worker' && canReadPrivateFinancials ? 'financial_worker' : memberRole ?? 'named_rep'
  return {
    userId,
    farmId,
    kind,
    memberRole,
    memberCanViewFinancials,
    isNamedRep: activeNamedRep,
    accessEpoch,
    validatedAt,
    source: 'live',
    capabilities: {
      canViewOperational: true,
      canEditOperational: canEditFarm,
      canManageFarm,
      canReadPrivateFinancials,
      canUseMembershipOnlyModules: activeMember,
    },
  }
}

function parseStoredProfile(target: StorageLike, access: FarmAccess, farmId: string, fence: FarmRevocationSnapshot): StoredAccessProfile | null {
  const raw = target.getItem(profileKey(access.userId, farmId)); if (!raw) return null
  try {
    const value = JSON.parse(raw) as Partial<StoredAccessProfile>
    if (value.version !== 1 || value.userId !== access.userId || value.farmId !== farmId || value.accessValidatedAt !== access.validatedAt || !validStamp(value.clockHighWaterAt) || value.generation !== fence.generation || value.fenceToken !== fence.token || value.accessEpoch !== fence.serverEpoch || !validStamp(value.validatedAt) || !value.capabilities || typeof value.capabilities !== 'object' || ((!memberRoles.has(value.memberRole ?? '')) && value.memberRole !== null) || !['owner', 'manager', 'worker', 'financial_worker', 'read_only', 'named_rep'].includes(String(value.kind))) return null
    const capabilities = value.capabilities as Partial<FarmAccessCapabilities>
    if (typeof value.isNamedRep !== 'boolean' || typeof value.memberCanViewFinancials !== 'boolean' || [capabilities.canViewOperational, capabilities.canEditOperational, capabilities.canManageFarm, capabilities.canReadPrivateFinancials, capabilities.canUseMembershipOnlyModules].some((item) => typeof item !== 'boolean')) return null
    const expectedMembershipOnly = value.memberRole !== null
    const expectedEdit = value.memberRole === 'owner' || value.memberRole === 'manager' || value.memberRole === 'worker'
    const expectedManage = value.memberRole === 'owner' || value.memberRole === 'manager'
    const expectedKind: FarmAccessProfileKind = value.memberRole === 'worker' && capabilities.canReadPrivateFinancials ? 'financial_worker' : value.memberRole ?? 'named_rep'
    if (capabilities.canViewOperational !== true || capabilities.canUseMembershipOnlyModules !== expectedMembershipOnly || capabilities.canEditOperational !== expectedEdit || capabilities.canManageFarm !== expectedManage || value.kind !== expectedKind) return null
    if (capabilities.canReadPrivateFinancials !== (value.isNamedRep || value.memberRole === 'owner' || value.memberRole === 'manager' || value.memberCanViewFinancials)) return null
    if (value.memberRole === null && (!value.isNamedRep || capabilities.canReadPrivateFinancials !== true)) return null
    if ((value.memberRole === 'owner' || value.memberRole === 'manager') && capabilities.canReadPrivateFinancials !== true) return null
    return value as StoredAccessProfile
  } catch { return null }
}

/** Restores only the account id that is already bound to a fresh, exact farm
 * access record, capability profile, access epoch, and revocation fence. This
 * lets the auth shell reach the offline farm gate after a retryable token-refresh
 * outage without treating an arbitrary local Supabase user as authorized. */
export function restoreOfflineFarmUserId(target: Storage | null = storage(), nowStamp = new Date().toISOString()): string | null {
  if (!target || !validStamp(nowStamp)) return null
  const activeRaw = target.getItem(activeKey)
  let active: { version: 1; userId: string; farmId: string }
  try {
    const value = JSON.parse(activeRaw ?? '') as { version?: unknown; userId?: unknown; farmId?: unknown }
    if (value.version !== 1 || typeof value.userId !== 'string' || typeof value.farmId !== 'string') return null
    active = { version: 1, userId: value.userId, farmId: value.farmId }
  } catch { return null }
  const authRaw = target.getItem(authSessionKey)
  try {
    const session = JSON.parse(authRaw ?? '') as { access_token?: unknown; user?: { id?: unknown } }
    if (typeof session.access_token !== 'string' || session.user?.id !== active.userId) return null
    const payload = session.access_token.split('.')[1]
    if (!payload || typeof atob !== 'function') return null
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='))
    if ((JSON.parse(decoded) as { sub?: unknown }).sub !== active.userId) return null
  } catch { return null }
  const cached = parseStored(active.userId, target)
  const nowMs = Date.parse(nowStamp)
  if (!cached || cached.selectedFarmId !== active.farmId || !freshAt(nowMs, cached.validatedAt, maximumAccessAgeMs) || !storedAccessIsFenced(cached, target)) return null
  try {
    const access: FarmAccess = { ...cached, source: 'offline' }
    const fence = captureProfileFence(target, access, active.farmId)
    const profile = parseStoredProfile(target, access, active.farmId, fence)
    if (!profile || !freshAt(nowMs, profile.validatedAt, maximumAccessAgeMs) || nowMs < Date.parse(profile.clockHighWaterAt) - maximumClockSkewMs) return null
    return active.userId
  } catch { return null }
}

function captureProfileFence(target: StorageLike, access: FarmAccess, farmId: string): FarmRevocationSnapshot {
  if (access.selectedFarmId !== farmId || !access.farms.some((farm) => farm.id === farmId)) throw new Error('You no longer have access to that farm.')
  const active = target.getItem(activeKey)
  try { const value = JSON.parse(active ?? '') as { version?: unknown; userId?: unknown; farmId?: unknown }; if (value.version !== 1 || value.userId !== access.userId || value.farmId !== farmId) throw new Error() }
  catch { throw new Error('The signed-in account or selected farm changed before permissions could finish loading.') }
  const epochs = readFarmAccessEpochs(target, supabaseConfig.projectRef, access.userId)
  const fence = captureFarmRevocationFence(target, { projectRef: supabaseConfig.projectRef, userId: access.userId, farmId })
  if (!epochs || epochs[farmId] !== fence.serverEpoch) throw new Error('This device needs a connection to verify your farm permissions.')
  return fence
}

function verifyProfileFence(target: StorageLike, access: FarmAccess, farmId: string, expected: FarmRevocationSnapshot): void {
  const current = captureProfileFence(target, access, farmId)
  verifyFarmRevocationFence(target, expected)
  if (current.generation !== expected.generation || current.token !== expected.token || current.serverEpoch !== expected.serverEpoch) throw new Error('The signed-in account or selected farm changed before permissions could finish loading.')
}

async function requireCurrentSession(userId: string, signal?: AbortSignal): Promise<string> {
  const { data, error } = await withAbortSignal(supabase.auth.getSession(), signal)
  if (error) throw error
  if (data.session?.user.id !== userId || typeof data.session.access_token !== 'string' || !data.session.access_token) throw new Error('Farm access validation no longer matches the signed-in account.')
  return data.session.access_token
}

async function loadServerEpochForFarm(userId: string, farmId: string, signal?: AbortSignal): Promise<number> {
  await requireCurrentSession(userId, signal)
  const { data, error } = await supabase.rpc('get_current_farm_access_epochs').abortSignal(signal ?? new AbortController().signal)
  if (error || !Array.isArray(data)) throw error ?? new Error('Farm access versions were unavailable.')
  let found: number | null = null
  for (const value of data as unknown[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Farm access versions were malformed.')
    const row = value as { farm_id?: unknown; access_epoch?: unknown }
    const epoch = typeof row.access_epoch === 'string' ? Number(row.access_epoch) : row.access_epoch
    if (typeof row.farm_id !== 'string' || !Number.isSafeInteger(epoch) || Number(epoch) < 1) throw new Error('Farm access versions were malformed.')
    if (row.farm_id === farmId) { if (found !== null) throw new Error('Farm access versions were malformed.'); found = Number(epoch) }
  }
  if (found === null) throw new Error('You no longer have access to that farm.')
  return found
}

async function loadProfileEvidence(userId: string, farmId: string, signal?: AbortSignal): Promise<FarmAccessProfileEvidence> {
  const requestSignal = signal ?? new AbortController().signal
  const membershipRequest = supabase.from('farm_memberships').select('farm_id,user_id,role,status,can_view_financials').eq('farm_id', farmId).eq('user_id', userId).abortSignal(requestSignal).maybeSingle()
  const repRequest = supabase.from('farm_rep_access').select('farm_id,rep_user_id,enabled,revoked_at').eq('farm_id', farmId).eq('rep_user_id', userId).abortSignal(requestSignal).maybeSingle()
  const helper = (name: 'can_access_farm' | 'is_active_farm_member' | 'can_edit_farm' | 'can_manage_farm' | 'has_explicit_rep_access' | 'can_read_private_financials') => supabase.rpc(name, { target_farm_id: farmId }).abortSignal(requestSignal)
  const [membership, repAccess, canAccessFarm, isActiveFarmMember, canEditFarm, canManageFarm, hasExplicitRepAccess, canReadPrivateFinancials] = await Promise.all([
    membershipRequest,
    repRequest,
    helper('can_access_farm'),
    helper('is_active_farm_member'),
    helper('can_edit_farm'),
    helper('can_manage_farm'),
    helper('has_explicit_rep_access'),
    helper('can_read_private_financials'),
  ])
  const error = membership.error ?? repAccess.error ?? canAccessFarm.error ?? isActiveFarmMember.error ?? canEditFarm.error ?? canManageFarm.error ?? hasExplicitRepAccess.error ?? canReadPrivateFinancials.error
  if (error) throw error
  return {
    membership: membership.data as MembershipRow | null,
    repAccess: repAccess.data as RepAccessRow | null,
    shareWithRep: false,
    helpers: {
      canAccessFarm: canAccessFarm.data,
      isActiveFarmMember: isActiveFarmMember.data,
      canEditFarm: canEditFarm.data,
      canManageFarm: canManageFarm.data,
      hasExplicitRepAccess: hasExplicitRepAccess.data,
      canReadPrivateFinancials: canReadPrivateFinancials.data,
    },
  }
}

export async function loadFarmAccessProfile(access: FarmAccess, dependencies?: FarmAccessProfileLoadDependencies): Promise<LoadedFarmAccessProfile> {
  const farmId = access.selectedFarmId
  const farm = farmId ? access.farms.find((value) => value.id === farmId) : null
  if (!farmId || !farm) throw new Error('Choose which farm you want to open.')
  const target = dependencies?.storage ?? storage()
  if (!target) throw new Error('Farm Rx could not verify farm permissions without device storage.')
  const d: FarmAccessProfileLoadDependencies = dependencies ?? {
    storage: target,
    isOffline: offline,
    requireSession: requireCurrentSession,
    loadServerEpoch: loadServerEpochForFarm,
    loadEvidence: async (userId, selectedFarmId, signal) => ({ ...(await loadProfileEvidence(userId, selectedFarmId, signal)), shareWithRep: farm.share_with_rep }),
    now: () => new Date().toISOString(),
  }
  const createId = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  const run = async (verifyCoordination: () => void): Promise<LoadedFarmAccessProfile> => {
    verifyCoordination()
    const key = profileKey(access.userId, farmId)
    const expectedAccessBytes = JSON.stringify({ version: 1, userId: access.userId, farms: access.farms, selectedFarmId: access.selectedFarmId, validatedAt: access.validatedAt } satisfies StoredAccess)
    const currentAccessBytes = target.getItem(accessKey(access.userId))
    if (currentAccessBytes !== null && currentAccessBytes !== expectedAccessBytes) throw new Error('Farm access changed while permissions were loading.')
    const fence = captureProfileFence(target, access, farmId)
    const nowStamp = d.now()
    let nowMs: number
    try { nowMs = observeDeviceTime(target, { projectRef: supabaseConfig.projectRef, userId: access.userId }, nowStamp) }
    catch { removeStoredProfiles(target, access.userId, farmId); throw new Error('This device needs a connection to verify your farm permissions.') }
    if (!freshAt(nowMs, access.validatedAt, maximumAccessAgeMs)) { removeStoredProfiles(target, access.userId, farmId); throw new Error('This device needs a connection to verify your farm permissions.') }

    const priorRaw = target.getItem(key)
    let transportFallback: StoredAccessProfile | null = null
    if (priorRaw !== null) {
      try {
        const priorStamp = (JSON.parse(priorRaw) as { accessValidatedAt?: unknown }).accessValidatedAt
        if (validStamp(priorStamp) && freshAt(nowMs, priorStamp, maximumAccessAgeMs)) {
          const priorAccess: FarmAccess = { ...access, validatedAt: priorStamp }
          const candidate = parseStoredProfile(target, priorAccess, farmId, fence)
          if (candidate && freshAt(nowMs, candidate.validatedAt, maximumAccessAgeMs) && nowMs >= Date.parse(candidate.clockHighWaterAt) - maximumClockSkewMs) transportFallback = candidate
        }
      } catch { /* malformed prior profiles are removed below and never restored */ }
    }
    if (access.source === 'offline' || d.isOffline()) {
      let cached = parseStoredProfile(target, access, farmId, fence)
      if (!cached && transportFallback) {
        const rebound: StoredAccessProfile = { ...transportFallback, accessValidatedAt: access.validatedAt }
        const reboundBytes = JSON.stringify(rebound)
        target.setItem(key, reboundBytes)
        if (target.getItem(key) !== reboundBytes) throw new Error('Farm Rx could not retain your verified permissions.')
        cached = rebound
      }
      if (!cached || !freshAt(nowMs, cached.validatedAt, maximumAccessAgeMs) || nowMs < Date.parse(cached.clockHighWaterAt) - maximumClockSkewMs) { removeStoredProfiles(target, access.userId, farmId); throw new Error('This device needs a connection to verify your farm permissions.') }
      verifyCoordination()
      verifyProfileFence(target, access, farmId, fence)
      const { version: _version, accessValidatedAt: _accessValidatedAt, clockHighWaterAt: _clockHighWaterAt, generation: _generation, fenceToken: _fenceToken, ...profile } = cached
      return { ...profile, source: 'offline', operationContext: fence }
    }

    // Hold a previously verified profile only in memory while the shared
    // access/profile transaction makes it unavailable to every other tab.
    // Production readers share this lock, so the prior profile can stay
    // crash-recoverable while no other tab can consume it. Isolated injected
    // stores have no cross-tab coordinator and retain the older fail-closed test behavior.
    if (target !== storage()) {
      try {
        target.removeItem(key)
        if (target.getItem(key) !== null) throw new Error('Farm Rx could not clear old permissions before verifying this session.')
      } catch { throw new Error('Farm Rx could not clear old permissions before verifying this session.') }
    }

    try {
       const sessionToken = await withAbortSignal(d.requireSession(access.userId, deadline.signal), deadline.signal)
      verifyCoordination(); verifyProfileFence(target, access, farmId, fence)
       const beforeEpoch = await withAbortSignal(d.loadServerEpoch(access.userId, farmId, deadline.signal), deadline.signal)
      if (beforeEpoch !== fence.serverEpoch) throw new Error('Farm access changed while permissions were loading.')
      verifyCoordination(); verifyProfileFence(target, access, farmId, fence)
       const evidence = await withAbortSignal(d.loadEvidence(access.userId, farmId, deadline.signal), deadline.signal)
      verifyCoordination(); verifyProfileFence(target, access, farmId, fence)
       const afterEpoch = await withAbortSignal(d.loadServerEpoch(access.userId, farmId, deadline.signal), deadline.signal)
       const currentSessionToken = await withAbortSignal(d.requireSession(access.userId, deadline.signal), deadline.signal)
      verifyCoordination(); verifyProfileFence(target, access, farmId, fence)
      if (afterEpoch !== beforeEpoch || currentSessionToken !== sessionToken) throw new Error('Farm access changed while permissions were loading.')
      const profile = deriveFarmAccessProfile(access.userId, farmId, afterEpoch, nowStamp, { ...evidence, shareWithRep: farm.share_with_rep })
      const { source: _source, ...storableProfile } = profile
      const stored: StoredAccessProfile = { ...storableProfile, version: 1, accessValidatedAt: access.validatedAt, clockHighWaterAt: new Date(nowMs).toISOString(), generation: fence.generation, fenceToken: fence.token }
      const serialized = JSON.stringify(stored)
       const finalEpoch = await withAbortSignal(d.loadServerEpoch(access.userId, farmId, deadline.signal), deadline.signal)
       const finalSessionToken = await withAbortSignal(d.requireSession(access.userId, deadline.signal), deadline.signal)
      if (finalSessionToken !== sessionToken || finalEpoch !== afterEpoch) throw new Error('Farm access changed while permissions were loading.')
      verifyCoordination(); verifyProfileFence(target, access, farmId, fence)
      if (currentAccessBytes !== null && target.getItem(accessKey(access.userId)) !== expectedAccessBytes) throw new Error('Farm access changed while permissions were loading.')
      // Publication is synchronous inside the shared access/profile lock.
      target.setItem(key, serialized)
      if (target.getItem(key) !== serialized) throw new Error('Farm Rx could not retain your verified permissions.')
      return { ...profile, operationContext: fence }
    } catch (error) {
      const definiteTransportFailure = isDefiniteTransportFailure(error)
      if (definiteTransportFailure && transportFallback) {
        let attemptedReboundBytes: string | null = null
        try {
          verifyCoordination(); verifyProfileFence(target, access, farmId, fence)
          if (currentAccessBytes !== null && target.getItem(accessKey(access.userId)) !== expectedAccessBytes) throw new Error('Farm access changed while permissions were loading.')
          const rebound: StoredAccessProfile = { ...transportFallback, accessValidatedAt: access.validatedAt }
          const reboundBytes = JSON.stringify(rebound)
          attemptedReboundBytes = reboundBytes
          target.setItem(key, reboundBytes)
          if (target.getItem(key) !== reboundBytes) throw new Error('Farm Rx could not retain your verified permissions.')
          const { version: _version, accessValidatedAt: _accessValidatedAt, clockHighWaterAt: _clockHighWaterAt, generation: _generation, fenceToken: _fenceToken, ...profile } = rebound
          return { ...profile, source: 'offline', operationContext: fence }
        } catch (fallbackError) {
          try {
            const current = target.getItem(key)
            if (target !== storage() || current === priorRaw || current === attemptedReboundBytes) target.removeItem(key)
          } catch { /* fail closed when storage is unsafe */ }
          throw fallbackError
        }
      }
      try { if (target !== storage() || target.getItem(key) === priorRaw) target.removeItem(key) } catch { /* fail closed even when cleanup is unavailable */ }
      throw error
    }
  }
  const deadline = readDeadline()
  try {
    if (target === storage()) return await coordinatedDeviceTransaction(validationLockKey(access.userId), target, createId, run)
    return await run(() => undefined)
  } finally { deadline.clear() }
}

async function loadServerEpochs(userId: string, farms: Farm[], signal?: AbortSignal): Promise<Record<string, number>> {
  await requireCurrentSession(userId, signal)
  const { data, error } = await supabase.rpc('get_current_farm_access_epochs').abortSignal(signal ?? new AbortController().signal)
  if (error || !Array.isArray(data)) throw error ?? new Error('Farm access versions were unavailable.')
  const epochs: Record<string, number> = {}
  for (const value of data as unknown[]) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Farm access versions were malformed.')
    const row = value as { farm_id?: unknown; access_epoch?: unknown }
    const epoch = typeof row.access_epoch === 'string' ? Number(row.access_epoch) : row.access_epoch
    if (typeof row.farm_id !== 'string' || !farms.some((farm) => farm.id === row.farm_id) || !Number.isSafeInteger(epoch) || Number(epoch) < 1 || Object.hasOwn(epochs, row.farm_id)) throw new Error('Farm access versions were malformed.')
    epochs[row.farm_id] = Number(epoch)
  }
  if (Object.keys(epochs).length !== farms.length) throw new Error('Farm access versions did not match the accessible farms.')
  return epochs
}

export async function currentUserId(): Promise<string> {
  const verifyReplayUser = captureFarmReplayUserGuard()
  const authorizedOfflineContext = captureAuthorizedOfflineFarmContext()
  const offlineContext = authorizedOfflineContext()
  if (offlineContext) return verifyReplayUser(offlineContext.userId)
  let sessionResult: Awaited<ReturnType<typeof supabase.auth.getSession>> | null = null
  const deadline = readDeadline()
  try { sessionResult = await withAbortSignal(supabase.auth.getSession(), deadline.signal) } catch { /* fail closed below */ }
  finally { deadline.clear() }
  if (sessionResult && !sessionResult.error && sessionResult.data.session?.user.id) return verifyReplayUser(sessionResult.data.session.user.id)
  const raw = storage()?.getItem(activeKey)
  let offlineUserId: string | null = null
  if (offline() && raw) { try { const value = JSON.parse(raw) as { version?: unknown; userId?: unknown }; if (value.version === 1 && typeof value.userId === 'string') offlineUserId = value.userId } catch { /* fail closed below */ } }
  if (offlineUserId) return verifyReplayUser(offlineUserId)
  throw new Error('Your sign-in ended. Please sign in again.')
}

async function fetchAccessibleFarms(userId: string, accountEpoch: number): Promise<FarmAccess> {
  const target = storage(); if (!target) throw new Error('Farm Rx could not verify farm access without device storage.')
  const createId = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  const deadline = readDeadline()
  try { return await coordinatedDeviceTransaction(validationLockKey(userId), target, createId, async (verifyCoordination) => {
    const prior = parseStored(userId)
    const validationToken = createId()
    target.setItem(validationKey(userId), validationToken)
    const verifyValidation = () => {
      verifyCoordination()
      if (target.getItem(validationKey(userId)) !== validationToken || (accountEpochs.get(userId) ?? 0) !== accountEpoch) throw new Error('Farm access changed while it was being verified.')
    }
    verifyValidation()
    const validationStartedAt = new Date().toISOString()
    await requireCurrentSession(userId, deadline.signal)
    verifyValidation()
    const { data, error } = await supabase.from('farms').select('*').order('name').order('id').abortSignal(deadline.signal)
    verifyValidation()
    if (error) throw error
    const farms = (data ?? []) as Farm[]
    const serverEpochs = await loadServerEpochs(userId, farms, deadline.signal)
    verifyValidation()
    const priorEpochs = readFarmAccessEpochs(target, supabaseConfig.projectRef, userId) ?? {}
    const knownFarmIds = new Set([...(prior?.farms.map((farm) => farm.id) ?? []), ...listFarmRevocationScopes(target, supabaseConfig.projectRef, userId).map((scope) => scope.farmId)])
    const removed = [...knownFarmIds].filter((farmId) => !farms.some((next) => next.id === farmId))
    // Do not publish a new live access snapshot until every removed farm's unsent work
    // is durably separated from active queues and its readable cache is gone.
    for (const farmId of removed) {
      verifyValidation()
      const scope = { projectRef: supabaseConfig.projectRef, userId, farmId }
      const state = inspectFarmRevocationState(target, scope)
      const serverEpoch = priorEpochs[farmId] ?? state.serverEpoch ?? 1
      if (state.kind === 'active' || state.kind === 'revoked') markFarmRevoked(target, scope, validationStartedAt, serverEpoch)
      else resetFarmRevokedFromLive(target, scope, serverEpoch, validationStartedAt)
      quarantineRevokedFarmWork(target, scope)
      await deleteUserWorkspaceCaches(supabaseConfig.projectRef, userId, farmId)
      verifyValidation()
    }
    for (const farm of farms) {
      verifyValidation()
      const scope = { projectRef: supabaseConfig.projectRef, userId, farmId: farm.id }
      const state = inspectFarmRevocationState(target, scope)
      const serverEpoch = serverEpochs[farm.id]!
      const wasKnown = knownFarmIds.has(farm.id) || Object.hasOwn(priorEpochs, farm.id)
      if (state.kind === 'active' && state.serverEpoch === serverEpoch) {
        markFarmGranted(target, scope, validationStartedAt, serverEpoch)
        continue
      }
      // A delayed or cached access response must never move a device backwards,
      // and a revoked/partially deleted scope can only be reactivated by a
      // strictly newer server epoch. First use on a clean device may begin at 1.
      const priorServerEpoch = Math.max(state.serverEpoch ?? 0, priorEpochs[farm.id] ?? 0)
      const recoveringKnownScope = state.kind === 'revoked' || state.kind === 'invalid' || state.kind === 'missing' && wasKnown
      if (serverEpoch < priorServerEpoch || recoveringKnownScope && (priorServerEpoch === 0 || serverEpoch <= priorServerEpoch)) {
        throw new Error('Farm access changed while it was being verified.')
      }
      if (state.kind !== 'active' || state.serverEpoch !== serverEpoch) {
        quarantineRevokedFarmWork(target, scope)
        await deleteUserWorkspaceCaches(supabaseConfig.projectRef, userId, farm.id)
        verifyValidation()
        resetFarmGrantFromLive(target, scope, serverEpoch, validationStartedAt)
      }
    }
    verifyValidation()
    writeFarmAccessEpochs(target, supabaseConfig.projectRef, userId, serverEpochs, validationStartedAt)
    const selectedFarmId = prior?.selectedFarmId && farms.some((farm) => farm.id === prior.selectedFarmId) ? prior.selectedFarmId : farms.length === 1 ? farms[0].id : null
    const value: StoredAccess = { version: 1, userId, farms, selectedFarmId, validatedAt: new Date().toISOString() }
    verifyValidation()
    await requireCurrentSession(userId, deadline.signal)
    verifyValidation()
    persist(value)
    return { ...value, source: 'live' }
  }) } finally { deadline.clear() }
}

export async function loadFarmAccess(userId: string, force = false): Promise<FarmAccess> {
  const target = storage()
  const raw = target?.getItem(accessKey(userId)) ?? null
  let cached = parseStored(userId)
  if (raw !== null && !cached && target) target.removeItem(accessKey(userId))
  let nowMs = Date.now()
  if (target) {
    try { nowMs = observeDeviceTime(target, { projectRef: supabaseConfig.projectRef, userId }, new Date(nowMs).toISOString()) }
    catch (error) { invalidateStoredAuthorization(target, userId); throw error instanceof DeviceClockRollbackError ? error : new Error('This device needs a connection to verify your farm access.') }
  }
  if (cached && !freshAt(nowMs, cached.validatedAt, maximumAccessAgeMs)) { if (target) invalidateStoredAuthorization(target, userId); cached = null }
  if (!force && !offline() && cached && freshAt(nowMs, cached.validatedAt, liveReuseMs) && storedAccessIsFenced(cached)) return { ...cached, source: 'live' }
  if (offline()) {
    if (!cached || !storedAccessIsFenced(cached)) { if (target) invalidateStoredAuthorization(target, userId); throw new Error('This device needs a connection to verify your farm access.') }
    return { ...cached, source: 'offline' }
  }
  const accountEpoch = accountEpochs.get(userId) ?? 0
  let refresh = refreshes.get(userId)
  if (!refresh || refresh.epoch !== accountEpoch) {
    const promise = fetchAccessibleFarms(userId, accountEpoch).finally(() => { if (refreshes.get(userId)?.promise === promise) refreshes.delete(userId) })
    refresh = { epoch: accountEpoch, promise }; refreshes.set(userId, refresh)
  }
  try { const result = await refresh.promise; if (result.userId !== userId || (accountEpochs.get(userId) ?? 0) !== accountEpoch) throw new Error('Farm access changed while it was being verified.'); return result } catch (error) {
    if (cached && transport(error) && freshAt(nowMs, cached.validatedAt, maximumAccessAgeMs) && storedAccessIsFenced(cached)) return { ...cached, source: 'offline' }
    throw error
  }
}

export async function currentFarmContext(): Promise<{ userId: string; farmId: string }> {
  const verifyReplayContext = captureFarmReplayContextGuard()
  const authorizedOfflineContext = captureAuthorizedOfflineFarmContext()
  const offlineContext = authorizedOfflineContext()
  if (offlineContext) return verifyReplayContext(offlineContext)
  const userId = await currentUserId()
  const access = await loadFarmAccess(userId)
  if (!access.selectedFarmId) throw new Error(access.farms.length > 1 ? 'Choose which farm you want to open.' : 'Crop RX needs to finish your farm setup.')
  return verifyReplayContext({ userId, farmId: access.selectedFarmId })
}

export async function selectFarm(userId: string, farmId: string): Promise<void> {
  cancelActiveFarmReplayAuthorization()
  clearFarmReadyAuthorization()
  const access = await loadFarmAccess(userId)
  if (!access.farms.some((farm) => farm.id === farmId)) throw new Error('You no longer have access to that farm.')
  persist({ version: 1, userId, farms: access.farms, selectedFarmId: farmId, validatedAt: access.validatedAt })
}

export function hasPendingFarmWork(userId: string, farmId: string): boolean {
  const target = storage(); if (!target) return false
  for (let index = 0; index < target.length; index += 1) {
    const key = target.key(index); if (!key || !key.includes(supabaseConfig.projectRef) || !key.includes(userId) || !key.includes(farmId) || key.endsWith(':lease')) continue
    const raw = target.getItem(key); if (!raw) continue
    try { const value = JSON.parse(raw) as { entries?: unknown }; if (Array.isArray(value.entries) && value.entries.length > 0) return true } catch { /* corrupt records are handled by their owning queue */ }
  }
  return false
}

export async function clearFarmAccess(userId: string): Promise<void> {
  cancelActiveFarmReplayAuthorization()
  clearFarmReadyAuthorization()
  accountEpochs.set(userId, (accountEpochs.get(userId) ?? 0) + 1)
  const target = storage()
  if (target) {
    target.setItem(validationKey(userId), typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)
    target.removeItem(accessKey(userId)); clearFarmAccessEpochs(target, supabaseConfig.projectRef, userId); clearDeviceClockHighWater(target, { projectRef: supabaseConfig.projectRef, userId })
    const profilePrefix = `farm-rx-access-profile:v1:${supabaseConfig.projectRef}:${userId}:`
    const profileKeys: string[] = []
    for (let index = 0; index < target.length; index += 1) { const key = target.key(index); if (key?.startsWith(profilePrefix)) profileKeys.push(key) }
    profileKeys.forEach((key) => target.removeItem(key))
    try { const active = JSON.parse(target.getItem(activeKey) ?? '{}') as { userId?: unknown }; if (active.userId === userId) target.removeItem(activeKey) } catch { target.removeItem(activeKey) }
  }
  await deleteUserWorkspaceCaches(supabaseConfig.projectRef, userId)
}
