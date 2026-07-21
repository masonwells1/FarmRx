import assert from 'node:assert/strict'

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>()
  writes = 0
  beforeWrite: (() => void) | null = null
  private onWrite() { const hook = this.beforeWrite; this.beforeWrite = null; hook?.() }
  get length() { return this.values.size }
  clear() { this.onWrite(); this.values.clear(); this.writes += 1 }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  removeItem(key: string) { this.onWrite(); this.values.delete(key); this.writes += 1 }
  setItem(key: string, value: string) { this.onWrite(); this.values.set(key, value); this.writes += 1 }
}

const storage = new MemoryStorage()
Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })

const { supabase } = await import('../lib/supabaseClient')
const { beginFarmReplayAuthorization, canAccessFarmModule, canEditFarmModule, canReplayFarmModule, captureFarmReplayContextGuard, clearFarmAccess, clearFarmReadyAuthorization, createFarmAccessValidationGate, currentFarmContext, currentUserId, deriveFarmAccessProfile, FarmAccessStorageUnsafeError, isDefiniteTransportFailure, isFarmReplayAuthoritativelyOffline, loadFarmAccess, loadFarmAccessProfile, publishFarmReadyAuthorization, restoreOfflineFarmUserId, selectFarm } = await import('./farmContext')
const { captureFarmRevocationFence, farmRevocationFenceKey, resetFarmGrantFromLive } = await import('../data/farmRevocationFence')
const { deviceClockHighWaterKey } = await import('../data/deviceClockFence')
const { farmActiveContextKey, writeFarmAccessEpochs } = await import('./farmAccessEpoch')
const { supabaseConfig } = await import('../lib/supabaseConfig')

const userA = '00000000-0000-4000-8000-000000000001'
const userB = '00000000-0000-4000-8000-000000000002'
const farmA = '00000000-0000-4000-8000-000000000011'
const farmB = '00000000-0000-4000-8000-000000000022'
const now = '2026-07-15T12:00:00.000Z'
const farm = (id: string, userId: string, name: string, shareWithRep = false) => ({ id, name, share_with_rep: shareWithRep, created_by: userId, created_at: now, updated_at: now })

let currentUser = userA
let currentToken = 'session-user-a'
let releaseA!: (value: { data: ReturnType<typeof farm>[]; error: null }) => void
const delayedA = new Promise<{ data: ReturnType<typeof farm>[]; error: null }>((resolve) => { releaseA = resolve })
let sawA!: () => void
const aStarted = new Promise<void>((resolve) => { sawA = resolve })

type SessionResult = { data: { session: { user: { id: string }; access_token: string } }; error: null }
;(supabase.auth as unknown as { getSession: () => Promise<SessionResult> }).getSession = async () => ({ data: { session: { user: { id: currentUser }, access_token: currentToken } }, error: null })

type QueryResult = { data: ReturnType<typeof farm>[]; error: null }
type Query = PromiseLike<QueryResult> & { select: () => Query; order: () => Query; abortSignal: () => Query }
;(supabase as unknown as { from: (table: string) => Query }).from = (table: string) => {
  assert.equal(table, 'farms')
  const requestedUser = currentUser
  const result = requestedUser === userA ? (sawA(), delayedA) : Promise.resolve({ data: [farm(farmB, userB, 'User B Farm')], error: null })
  const query = { select: () => query, order: () => query, abortSignal: () => query, then: result.then.bind(result) } as Query
  return query
}

type EpochRpcResult = { data: Array<{ farm_id: string; access_epoch: number }>; error: null }
type EpochRpcQuery = PromiseLike<EpochRpcResult> & { abortSignal: () => EpochRpcQuery }
;(supabase as unknown as { rpc: (name: string) => EpochRpcQuery }).rpc = (name: string) => {
  assert.equal(name, 'get_current_farm_access_epochs')
  assert.equal(currentUser, userB, 'User A reached the epoch RPC after the account switched.')
  const result = Promise.resolve({ data: [{ farm_id: farmB, access_epoch: 1 }], error: null })
  const query = { abortSignal: () => query, then: result.then.bind(result) } as EpochRpcQuery
  return query
}

// Existing account-isolation regression: a paused User A refresh cannot publish into User B.
const userALoad = loadFarmAccess(userA, true)
await aStarted
currentUser = userB
currentToken = 'session-user-b'
const userBAccess = await loadFarmAccess(userB, true)
releaseA({ data: [farm(farmA, userA, 'User A Farm')], error: null })
await assert.rejects(userALoad, /no longer matches the signed-in account/)

assert.equal(userBAccess.userId, userB)
assert.deepEqual(userBAccess.farms.map(({ id }) => id), [farmB])
assert.equal(storage.getItem(`farm-rx-access:v1:${supabaseConfig.projectRef}:${userA}`), null, 'User A access was persisted after switching to User B.')
assert.notEqual(storage.getItem(`farm-rx-access:v1:${supabaseConfig.projectRef}:${userB}`), null, 'User B access was not persisted independently.')
assert.equal(storage.getItem(farmRevocationFenceKey({ projectRef: supabaseConfig.projectRef, userId: userA, farmId: farmA })), null, 'User A farm fence was recreated after switching accounts.')
assert.equal((JSON.parse(storage.getItem(`farm-rx-active-context:v1:${supabaseConfig.projectRef}`) ?? '{}') as { userId?: string }).userId, userB)

type Evidence = Parameters<typeof deriveFarmAccessProfile>[4]
const helperEvidence = (overrides: Partial<Evidence['helpers']> = {}): Evidence['helpers'] => ({
  canAccessFarm: true,
  isActiveFarmMember: true,
  canEditFarm: true,
  canManageFarm: false,
  hasExplicitRepAccess: false,
  canReadPrivateFinancials: false,
  ...overrides,
})
const memberEvidence = (role: 'owner' | 'manager' | 'worker' | 'read_only', canViewFinancials = false, rep = false): Evidence => ({
  membership: { farm_id: farmA, user_id: userA, role, status: 'active', can_view_financials: canViewFinancials },
  repAccess: rep ? { farm_id: farmA, rep_user_id: userA, enabled: true, revoked_at: null } : null,
  shareWithRep: rep,
  helpers: helperEvidence({
    canEditFarm: role !== 'read_only',
    canManageFarm: role === 'owner' || role === 'manager',
    hasExplicitRepAccess: rep,
    canReadPrivateFinancials: rep || role === 'owner' || role === 'manager' || canViewFinancials,
  }),
})
const repEvidence = (enabled = true, shareWithRep = true): Evidence => ({
  membership: null,
  repAccess: { farm_id: farmA, rep_user_id: userA, enabled, revoked_at: null },
  shareWithRep,
  helpers: helperEvidence({ canAccessFarm: enabled && shareWithRep, isActiveFarmMember: false, canEditFarm: false, canManageFarm: false, hasExplicitRepAccess: enabled && shareWithRep, canReadPrivateFinancials: enabled && shareWithRep }),
})

// Capability matrix: roles are derived only from current membership/grant evidence and helpers.
assert.equal(deriveFarmAccessProfile(userA, farmA, 1, now, memberEvidence('owner')).kind, 'owner')
assert.equal(deriveFarmAccessProfile(userA, farmA, 1, now, memberEvidence('manager')).kind, 'manager')
assert.equal(deriveFarmAccessProfile(userA, farmA, 1, now, memberEvidence('worker')).kind, 'worker')
assert.equal(deriveFarmAccessProfile(userA, farmA, 1, now, memberEvidence('worker', true)).kind, 'financial_worker')
assert.equal(deriveFarmAccessProfile(userA, farmA, 1, now, memberEvidence('read_only')).kind, 'read_only')
const namedRep = deriveFarmAccessProfile(userA, farmA, 1, now, repEvidence())
assert.equal(namedRep.kind, 'named_rep')
assert.equal(namedRep.capabilities.canEditOperational, false)
assert.equal(namedRep.capabilities.canReadPrivateFinancials, true)
for (const module of ['equipment', 'tasks', 'weather', 'field_log', 'scouting', 'harvest', 'programs'] as const) assert.equal(canAccessFarmModule(namedRep, module), false, `Named reps must not enter write-capable or membership-only ${module}.`)
for (const module of ['fields', 'grain', 'inventory', 'profitability', 'notifications'] as const) assert.equal(canAccessFarmModule(namedRep, module), true, `Named reps should retain the proven ${module} read path.`)
assert.equal(canEditFarmModule(namedRep, 'fields'), false)
assert.equal(canReplayFarmModule(namedRep, 'grain'), false)
assert.equal(canReplayFarmModule(namedRep, 'notifications'), true)
const readOnly = deriveFarmAccessProfile(userA, farmA, 1, now, memberEvidence('read_only'))
assert.equal(canAccessFarmModule(readOnly, 'weather'), false)
assert.equal(canAccessFarmModule(readOnly, 'programs'), true)
assert.equal(canEditFarmModule(readOnly, 'programs'), false)
assert.equal(canReplayFarmModule(readOnly, 'programs'), false)
assert.equal(canReplayFarmModule(readOnly, 'notifications'), true)
const worker = deriveFarmAccessProfile(userA, farmA, 1, now, memberEvidence('worker'))
assert.equal(canAccessFarmModule(worker, 'grain'), false)
assert.equal(canAccessFarmModule(worker, 'profitability'), false)
assert.equal(canReplayFarmModule(worker, 'equipment'), true)
const dual = deriveFarmAccessProfile(userA, farmA, 1, now, memberEvidence('manager', false, true))
assert.equal(dual.kind, 'manager')
assert.equal(dual.isNamedRep, true)
assert.throws(() => deriveFarmAccessProfile(userA, farmA, 1, now, repEvidence(false, true)), /could not verify/)
assert.throws(() => deriveFarmAccessProfile(userA, farmA, 1, now, repEvidence(true, false)), /could not verify/)
assert.throws(() => deriveFarmAccessProfile(userA, farmA, 1, now, { ...memberEvidence('worker'), membership: { farm_id: farmA, user_id: userA, role: 'admin', status: 'active', can_view_financials: false } }), /could not verify/)
assert.throws(() => deriveFarmAccessProfile(userA, farmA, 1, now, { ...memberEvidence('worker'), membership: { farm_id: farmB, user_id: userA, role: 'worker', status: 'active', can_view_financials: false } }), /could not verify/)
assert.throws(() => deriveFarmAccessProfile(userA, farmA, 1, now, { ...memberEvidence('worker'), helpers: { ...memberEvidence('worker').helpers, canEditFarm: 'yes' } }), /could not verify/)

const activeContextKey = farmActiveContextKey(supabaseConfig.projectRef)
const accessFor = (shareWithRep = false) => ({ userId: userA, farms: [farm(farmA, userA, 'User A Farm', shareWithRep)], selectedFarmId: farmA, validatedAt: now, source: 'live' as const })
function seededProfileStorage(epoch = 1) {
  const target = new MemoryStorage()
  target.setItem(activeContextKey, JSON.stringify({ version: 1, userId: userA, farmId: farmA }))
  resetFarmGrantFromLive(target, { projectRef: supabaseConfig.projectRef, userId: userA, farmId: farmA }, epoch, now)
  writeFarmAccessEpochs(target, supabaseConfig.projectRef, userA, { [farmA]: epoch }, now)
  return target
}
const onlineDependencies = (target: MemoryStorage, evidence: Evidence, session = () => 'profile-session-a', epoch = () => 1) => ({
  storage: target,
  isOffline: () => false,
  requireSession: async (requestedUser: string) => { assert.equal(requestedUser, userA); return session() },
  loadServerEpoch: async (requestedUser: string, requestedFarm: string) => { assert.equal(requestedUser, userA); assert.equal(requestedFarm, farmA); return epoch() },
  loadEvidence: async () => evidence,
  now: () => now,
})

// Online verification stores no token; offline reuse is exact farm/account/fence and makes no writes.
const profileStorage = seededProfileStorage()
const onlineProfile = await loadFarmAccessProfile(accessFor(), onlineDependencies(profileStorage, memberEvidence('owner')))
assert.equal(onlineProfile.kind, 'owner')
const profileKey = `farm-rx-access-profile:v1:${supabaseConfig.projectRef}:${userA}:${farmA}`
assert.equal(profileStorage.getItem(profileKey)?.includes('profile-session-a'), false, 'The session token was persisted in the access profile.')
const beforeOfflineWrites = profileStorage.writes
const offlineProfile = await loadFarmAccessProfile(accessFor(), {
  storage: profileStorage,
  isOffline: () => true,
  requireSession: async () => { throw new Error('offline profile called auth') },
  loadServerEpoch: async () => { throw new Error('offline profile called server epoch') },
  loadEvidence: async () => { throw new Error('offline profile called evidence') },
  now: () => now,
})
assert.equal(offlineProfile.source, 'offline')
assert.equal(profileStorage.writes, beforeOfflineWrites, 'Offline profile reuse wrote device storage.')

// A transport timeout can make the access result authoritative-offline while
// the browser still reports online. Reuse the exact cached profile without
// touching server dependencies or changing device-storage bytes.
const transportFallbackProfileBytes = profileStorage.getItem(profileKey)
assert.notEqual(transportFallbackProfileBytes, null, 'Transport fallback fixture is missing its cached profile.')
const transportFallbackWrites = profileStorage.writes
const transportFallbackServerCalls: string[] = []
const transportFallbackProfile = await loadFarmAccessProfile(
  { ...accessFor(), source: 'offline' as const },
  {
    storage: profileStorage,
    isOffline: () => false,
    requireSession: async () => { transportFallbackServerCalls.push('requireSession'); throw new Error('transport fallback profile called auth') },
    loadServerEpoch: async () => { transportFallbackServerCalls.push('loadServerEpoch'); throw new Error('transport fallback profile called server epoch') },
    loadEvidence: async () => { transportFallbackServerCalls.push('loadEvidence'); throw new Error('transport fallback profile called evidence') },
    now: () => now,
  },
)
assert.equal(transportFallbackProfile.source, 'offline')
assert.deepEqual(transportFallbackServerCalls, [], 'Transport-fallback profile attempted server validation.')
assert.equal(profileStorage.getItem(profileKey), transportFallbackProfileBytes, 'Transport fallback changed cached profile bytes.')
assert.equal(profileStorage.writes, transportFallbackWrites, 'Transport fallback wrote device storage.')

const offlineDependencies = (target: MemoryStorage, nowStamp = now) => ({
  storage: target,
  isOffline: () => true,
  requireSession: async () => { throw new Error('offline profile called auth') },
  loadServerEpoch: async () => { throw new Error('offline profile called server epoch') },
  loadEvidence: async () => { throw new Error('offline profile called evidence') },
  now: () => nowStamp,
})
async function cachedProfileTarget() { const target = seededProfileStorage(); await loadFarmAccessProfile(accessFor(), onlineDependencies(target, memberEvidence('owner'))); return target }

const offlineAuthStorage = await cachedProfileTarget()
const offlineAuthAccessKey = `farm-rx-access:v1:${supabaseConfig.projectRef}:${userA}`
const offlineAuthSessionKey = `farm-rx-auth:${supabaseConfig.projectRef}`
const jwtFor = (userId: string) => `e30.${Buffer.from(JSON.stringify({ sub: userId })).toString('base64url')}.signature`
offlineAuthStorage.setItem(offlineAuthAccessKey, JSON.stringify({ version: 1, ...accessFor(), source: undefined }, (_key, value) => value === undefined ? undefined : value))
offlineAuthStorage.setItem(offlineAuthSessionKey, JSON.stringify({ access_token: jwtFor(userA), user: { id: userA } }))
assert.equal(restoreOfflineFarmUserId(offlineAuthStorage, now), userA, 'A retryable auth outage could not restore the exact user bound to fresh farm access and profile caches.')
offlineAuthStorage.setItem(offlineAuthSessionKey, JSON.stringify({ access_token: jwtFor(userB), user: { id: userB } }))
assert.equal(restoreOfflineFarmUserId(offlineAuthStorage, now), null, 'Offline auth restored a different stored session user over the active farm account.')
offlineAuthStorage.setItem(offlineAuthSessionKey, JSON.stringify({ access_token: jwtFor(userB), user: { id: userA } }))
assert.equal(restoreOfflineFarmUserId(offlineAuthStorage, now), null, 'Offline auth accepted a JWT subject that did not match the active farm account.')
offlineAuthStorage.removeItem(offlineAuthSessionKey)
assert.equal(restoreOfflineFarmUserId(offlineAuthStorage, now), null, 'Offline auth restored a user after the persisted auth session was cleared.')

// Access refresh can finish just before profile validation loses signal. The
// shared profile transaction must rebind the still-fresh prior capability proof
// to the new access stamp only for a definite transport failure.
const interruptedProfile = await cachedProfileTarget()
const refreshedAt = '2026-07-15T12:01:00.000Z'
const refreshedAccess = { ...accessFor(), validatedAt: refreshedAt }
const interruptedFallback = await loadFarmAccessProfile(refreshedAccess, {
  ...onlineDependencies(interruptedProfile, memberEvidence('owner')),
  loadEvidence: async () => { throw new TypeError('Failed to fetch profile evidence') },
  now: () => refreshedAt,
})
assert.equal(interruptedFallback.source, 'offline')
const reboundProfileBytes = interruptedProfile.getItem(profileKey)
assert.notEqual(reboundProfileBytes, null, 'A transport-interrupted profile refresh destroyed the last valid offline profile.')
assert.equal((JSON.parse(reboundProfileBytes!) as { accessValidatedAt?: unknown }).accessValidatedAt, refreshedAt, 'Transport fallback left a mismatched access/profile timestamp pair.')
const reusedInterruptedFallback = await loadFarmAccessProfile({ ...refreshedAccess, source: 'offline' as const }, {
  ...offlineDependencies(interruptedProfile, refreshedAt),
  isOffline: () => false,
})
assert.equal(reusedInterruptedFallback.source, 'offline', 'The rebound access/profile pair was not reusable on the next weak-signal launch.')

const retryable503Profile = await cachedProfileTarget()
const retryable503Fallback = await loadFarmAccessProfile(refreshedAccess, {
  ...onlineDependencies(retryable503Profile, memberEvidence('owner')),
  loadEvidence: async () => { throw { name: 'AuthRetryableFetchError', status: 503, message: 'Service temporarily unavailable' } },
  now: () => refreshedAt,
})
assert.equal(retryable503Fallback.source, 'offline', 'A Supabase AuthRetryableFetchError 503 did not use the exact cached profile.')
assert.equal(isDefiniteTransportFailure({ cause: { code: 'ECONNRESET', message: 'socket closed' } }), true, 'A nested transport cause was not recognized.')
assert.equal(isDefiniteTransportFailure({ status: 403, message: 'permission denied' }), false, 'A definite authorization denial was misclassified as a transport failure.')

const timeoutSetTimeout = globalThis.setTimeout
const timeoutProfileStorage = await cachedProfileTarget()
globalThis.setTimeout = ((handler: TimerHandler, milliseconds?: number, ...args: unknown[]) => timeoutSetTimeout(handler, milliseconds === 10_000 ? 0 : milliseconds, ...args)) as typeof setTimeout
try {
  const timedOutProfile = await loadFarmAccessProfile(refreshedAccess, {
    ...onlineDependencies(timeoutProfileStorage, memberEvidence('owner')),
    requireSession: async () => new Promise<string>(() => undefined),
    now: () => refreshedAt,
  })
  assert.equal(timedOutProfile.source, 'offline', 'A half-open profile auth request did not reach bounded offline fallback.')
} finally { globalThis.setTimeout = timeoutSetTimeout }

// Simulate a browser/process stop after the new access stamp was published but
// before profile validation began. The untouched prior profile is rebound only
// after its exact fence and age are rechecked under authoritative offline use.
const crashRecoveryProfile = await cachedProfileTarget()
const crashRecovered = await loadFarmAccessProfile({ ...refreshedAccess, source: 'offline' as const }, {
  ...offlineDependencies(crashRecoveryProfile, refreshedAt),
  isOffline: () => false,
})
assert.equal(crashRecovered.source, 'offline')
assert.equal((JSON.parse(crashRecoveryProfile.getItem(profileKey)!) as { accessValidatedAt?: unknown }).accessValidatedAt, refreshedAt, 'Crash recovery did not restore a matched access/profile pair.')

const deniedProfile = await cachedProfileTarget()
await assert.rejects(() => loadFarmAccessProfile(refreshedAccess, {
  ...onlineDependencies(deniedProfile, memberEvidence('owner')),
  loadEvidence: async () => { throw new Error('permission denied') },
  now: () => refreshedAt,
}), /permission denied/)
assert.equal(deniedProfile.getItem(profileKey), null, 'A non-transport permission failure restored stale offline capabilities.')

const regrantedDuringTransport = await cachedProfileTarget()
await assert.rejects(() => loadFarmAccessProfile(refreshedAccess, {
  ...onlineDependencies(regrantedDuringTransport, memberEvidence('owner')),
  loadEvidence: async () => {
    resetFarmGrantFromLive(regrantedDuringTransport, { projectRef: supabaseConfig.projectRef, userId: userA, farmId: farmA }, 2, refreshedAt)
    throw new TypeError('Failed to fetch after access changed')
  },
  now: () => refreshedAt,
}))
assert.equal(regrantedDuringTransport.getItem(profileKey), null, 'A transport-like error restored a profile after its farm grant changed.')

// A day-six offline check advances the durable high-water mark. Rolling the clock
// back cannot extend authorization, and the invalid profile is removed fail-closed.
const rollbackProfile = await cachedProfileTarget()
const daySix = '2026-07-21T12:00:00.000Z'
const daySixProfile = await loadFarmAccessProfile(accessFor(), offlineDependencies(rollbackProfile, daySix))
assert.equal(daySixProfile.source, 'offline')
const clockKey = deviceClockHighWaterKey({ projectRef: supabaseConfig.projectRef, userId: userA })
const daySixClockBytes = rollbackProfile.getItem(clockKey)
assert.equal((JSON.parse(daySixClockBytes ?? '{}') as { highWaterAt?: string }).highWaterAt, daySix)
await assert.rejects(() => loadFarmAccessProfile(accessFor(), offlineDependencies(rollbackProfile, now)), /clock|connection/i)
assert.equal(rollbackProfile.getItem(profileKey), null, 'Clock rollback retained an authorization profile.')
assert.equal(rollbackProfile.getItem(clockKey), daySixClockBytes, 'Clock rollback moved the high-water record backwards.')

const malformedJson = await cachedProfileTarget(); malformedJson.setItem(profileKey, '{bad')
await assert.rejects(() => loadFarmAccessProfile(accessFor(), offlineDependencies(malformedJson)), /connection/)
const inconsistentCapabilities = await cachedProfileTarget(); const inconsistent = JSON.parse(inconsistentCapabilities.getItem(profileKey)!) as { capabilities: { canEditOperational: boolean } }; inconsistent.capabilities.canEditOperational = false; inconsistentCapabilities.setItem(profileKey, JSON.stringify(inconsistent))
await assert.rejects(() => loadFarmAccessProfile(accessFor(), offlineDependencies(inconsistentCapabilities)), /connection/)
const futureAccess = { ...accessFor(), validatedAt: '2099-07-15T12:00:00.000Z' }
await assert.rejects(() => loadFarmAccessProfile(futureAccess, offlineDependencies(seededProfileStorage())), /connection/)
const futureProfile = await cachedProfileTarget(); const futureCached = JSON.parse(futureProfile.getItem(profileKey)!) as { validatedAt: string; clockHighWaterAt: string }; futureCached.validatedAt = '2099-07-15T12:00:00.000Z'; futureCached.clockHighWaterAt = futureCached.validatedAt; futureProfile.setItem(profileKey, JSON.stringify(futureCached))
await assert.rejects(() => loadFarmAccessProfile(accessFor(), offlineDependencies(futureProfile)), /connection/)
const expiredAccessNow = '2026-07-23T12:00:01.000Z'
const expiredAccess = await cachedProfileTarget()
await assert.rejects(() => loadFarmAccessProfile(accessFor(), offlineDependencies(expiredAccess, expiredAccessNow)), /connection/)

const mismatchedWrite = seededProfileStorage(); const originalSetItem = mismatchedWrite.setItem.bind(mismatchedWrite)
mismatchedWrite.setItem = (key: string, value: string) => originalSetItem(key, key === profileKey ? `${value}-corrupt` : value)
await assert.rejects(() => loadFarmAccessProfile(accessFor(), onlineDependencies(mismatchedWrite, memberEvidence('owner'))), /retain/)
assert.equal(mismatchedWrite.getItem(profileKey), null, 'A profile that failed publication read-back was retained.')

// Revalidation removes a previously accepted profile before any final await, so
// another tab cannot reuse the old capabilities while a replacement token races.
const staleDuringRevalidation = await cachedProfileTarget(); let staleEpochCalls = 0; let staleToken = 'profile-session-a'; let releaseStaleEpoch!: () => void; let staleEpochStarted!: () => void
const staleEpochWaiting = new Promise<void>((resolve) => { releaseStaleEpoch = resolve }); const staleEpochEntered = new Promise<void>((resolve) => { staleEpochStarted = resolve })
const staleRevalidation = loadFarmAccessProfile(accessFor(), { ...onlineDependencies(staleDuringRevalidation, memberEvidence('owner'), () => staleToken), loadServerEpoch: async () => { staleEpochCalls += 1; if (staleEpochCalls === 3) { staleEpochStarted(); await staleEpochWaiting }; return 1 } })
await staleEpochEntered
assert.equal(staleDuringRevalidation.getItem(profileKey), null, 'A prior profile remained visible while online revalidation waited on its final epoch check.')
await assert.rejects(() => loadFarmAccessProfile(accessFor(), offlineDependencies(staleDuringRevalidation)), /connection/, 'Another tab reused a prior profile during online revalidation.')
staleToken = 'profile-session-b'; releaseStaleEpoch()
await assert.rejects(staleRevalidation, /changed while permissions were loading/)
assert.equal(staleDuringRevalidation.getItem(profileKey), null, 'A replaced session restored the prior profile after revalidation failed.')

async function delayedFinalEpochProfile(label: string, mutate?: (target: MemoryStorage) => void) {
  const target = seededProfileStorage(); let calls = 0; let release!: () => void; let started!: () => void
  const waiting = new Promise<void>((resolve) => { release = resolve }); const entered = new Promise<void>((resolve) => { started = resolve })
  const loading = loadFarmAccessProfile(accessFor(), { ...onlineDependencies(target, memberEvidence('owner')), loadServerEpoch: async () => { calls += 1; if (calls === 3) { started(); await waiting }; return 1 } })
  await entered
  assert.equal(target.getItem(profileKey), null, `${label} exposed profile bytes before the final epoch check completed.`)
  mutate?.(target); release()
  if (mutate) { await assert.rejects(loading); assert.equal(target.getItem(profileKey), null, `${label} retained a profile after final authorization changed.`) }
  else { await loading; assert.notEqual(target.getItem(profileKey), null, `${label} did not publish after every final check completed.`) }
  assert.equal(calls, 3, `${label} did not reach the final epoch check.`)
}
await delayedFinalEpochProfile('Delayed final epoch')
await delayedFinalEpochProfile('Farm switch during final epoch', (target) => target.setItem(activeContextKey, JSON.stringify({ version: 1, userId: userA, farmId: farmB })))
await delayedFinalEpochProfile('Generation change during final epoch', (target) => { resetFarmGrantFromLive(target, { projectRef: supabaseConfig.projectRef, userId: userA, farmId: farmA }, 2, now); writeFarmAccessEpochs(target, supabaseConfig.projectRef, userA, { [farmA]: 2 }, now) })

const replacedDuringFinalSession = seededProfileStorage(); let sessionCalls = 0; let finalToken = 'profile-session-a'; let releaseSession!: () => void; let sessionStarted!: () => void
const sessionWaiting = new Promise<void>((resolve) => { releaseSession = resolve }); const sessionEntered = new Promise<void>((resolve) => { sessionStarted = resolve })
const finalSessionLoad = loadFarmAccessProfile(accessFor(), { ...onlineDependencies(replacedDuringFinalSession, memberEvidence('owner')), requireSession: async () => { sessionCalls += 1; if (sessionCalls === 3) { sessionStarted(); await sessionWaiting }; return finalToken } })
await sessionEntered; assert.equal(replacedDuringFinalSession.getItem(profileKey), null, 'Profile bytes became visible before the final session check completed.'); finalToken = 'profile-session-b'; releaseSession()
await assert.rejects(finalSessionLoad, /changed while permissions were loading/)
assert.equal(sessionCalls, 3, 'The final session race fixture did not reach the publication fence.')
assert.equal(replacedDuringFinalSession.getItem(profileKey), null, 'A profile survived a token replacement during the final session request.')

// Exercise the production shared transaction and exact-access-byte checks by
// making window.localStorage the target. A second validation must wait behind
// the first, and a stale first attempt must preserve newer access/profile bytes.
const productionLocalStorage = window.localStorage
const sharedProfileStorage = seededProfileStorage()
const storedAccessBytes = (access: ReturnType<typeof accessFor>) => JSON.stringify({ version: 1, userId: access.userId, farms: access.farms, selectedFarmId: access.selectedFarmId, validatedAt: access.validatedAt })
sharedProfileStorage.setItem(offlineAuthAccessKey, storedAccessBytes(accessFor()))
Object.defineProperty(window, 'localStorage', { configurable: true, value: sharedProfileStorage })
try {
  await loadFarmAccessProfile(accessFor(), onlineDependencies(sharedProfileStorage, memberEvidence('owner')))
  const priorSharedProfile = sharedProfileStorage.getItem(profileKey)
  assert.notEqual(priorSharedProfile, null, 'The production-lock fixture did not publish its initial profile.')
  sharedProfileStorage.setItem(offlineAuthAccessKey, storedAccessBytes(refreshedAccess))
  let releaseSharedA!: () => void
  let enterSharedA!: () => void
  const sharedAHold = new Promise<void>((resolve) => { releaseSharedA = resolve })
  const sharedAEntered = new Promise<void>((resolve) => { enterSharedA = resolve })
  const sharedA = loadFarmAccessProfile(refreshedAccess, {
    ...onlineDependencies(sharedProfileStorage, memberEvidence('owner')),
    loadEvidence: async () => { enterSharedA(); await sharedAHold; throw { name: 'AuthRetryableFetchError', status: 503, message: 'Service temporarily unavailable' } },
    now: () => refreshedAt,
  }).then((value) => value, (error: unknown) => error)
  await sharedAEntered
  let sharedBSettled = false
  let sharedBServerCalls = 0
  const sharedB = loadFarmAccessProfile(refreshedAccess, {
    ...onlineDependencies(sharedProfileStorage, memberEvidence('owner')),
    requireSession: async () => { sharedBServerCalls += 1; return 'profile-session-a' },
    now: () => refreshedAt,
  }).then((value) => value, (error: unknown) => error).finally(() => { sharedBSettled = true })
  await Promise.resolve()
  assert.equal(sharedBSettled, false, 'A second production profile validation entered before the shared transaction released.')
  assert.equal(sharedBServerCalls, 0, 'A waiting production profile validation touched a server collaborator before the shared lock released.')

  const newestAt = '2026-07-15T12:02:00.000Z'
  const newestAccess = { ...accessFor(), validatedAt: newestAt }
  const newestAccessBytes = storedAccessBytes(newestAccess)
  const newestProfileBytes = JSON.stringify({ ...(JSON.parse(priorSharedProfile!) as object), accessValidatedAt: newestAt })
  sharedProfileStorage.setItem(offlineAuthAccessKey, newestAccessBytes)
  sharedProfileStorage.setItem(profileKey, newestProfileBytes)
  releaseSharedA()
  const sharedAResult = await sharedA
  const sharedBResult = await sharedB
  assert(sharedAResult instanceof Error && sharedBResult instanceof Error, 'A stale shared-lock validation unexpectedly published after exact access bytes changed.')
  assert.equal(sharedBServerCalls, 0, 'The second validation touched a server collaborator after detecting newer exact access bytes.')
  assert.equal(sharedProfileStorage.getItem(offlineAuthAccessKey), newestAccessBytes, 'A stale profile validation changed the newer access bytes.')
  assert.equal(sharedProfileStorage.getItem(profileKey), newestProfileBytes, 'A stale profile validation deleted or rebound the newer profile bytes.')
} finally {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: productionLocalStorage })
}

const missingFence = new MemoryStorage()
missingFence.setItem(activeContextKey, JSON.stringify({ version: 1, userId: userA, farmId: farmA }))
writeFarmAccessEpochs(missingFence, supabaseConfig.projectRef, userA, { [farmA]: 1 }, now)
await assert.rejects(() => loadFarmAccessProfile(accessFor(), { ...onlineDependencies(missingFence, memberEvidence('owner')), isOffline: () => true }), /Access to this farm changed|connection/)
resetFarmGrantFromLive(profileStorage, { projectRef: supabaseConfig.projectRef, userId: userA, farmId: farmA }, 2, now)
writeFarmAccessEpochs(profileStorage, supabaseConfig.projectRef, userA, { [farmA]: 2 }, now)
await assert.rejects(() => loadFarmAccessProfile(accessFor(), { ...onlineDependencies(profileStorage, memberEvidence('owner')), isOffline: () => true }), /connection/)

async function delayedProfileAttack(label: string, mutate: (target: MemoryStorage, state: { token: string; epoch: number }) => void) {
  const target = seededProfileStorage()
  const state = { token: 'profile-session-a', epoch: 1 }
  let release!: (value: Evidence) => void
  let started!: () => void
  const evidenceStarted = new Promise<void>((resolve) => { started = resolve })
  const loading = loadFarmAccessProfile(accessFor(), {
    ...onlineDependencies(target, memberEvidence('owner'), () => state.token, () => state.epoch),
    loadEvidence: () => { started(); return new Promise<Evidence>((resolve) => { release = resolve }) },
  })
  await evidenceStarted
  mutate(target, state)
  release(memberEvidence('owner'))
  await assert.rejects(loading)
  assert.equal(target.getItem(profileKey), null, `${label} persisted a stale profile.`)
}

await delayedProfileAttack('Account replacement', (target) => target.setItem(activeContextKey, JSON.stringify({ version: 1, userId: userB, farmId: farmB })))
await delayedProfileAttack('Farm switch', (target) => target.setItem(activeContextKey, JSON.stringify({ version: 1, userId: userA, farmId: farmB })))
await delayedProfileAttack('Same-farm server epoch change', (_target, state) => { state.epoch = 2 })
await delayedProfileAttack('Same-account session token replacement', (_target, state) => { state.token = 'profile-session-b' })

const userBAccessKey = `farm-rx-access:v1:${supabaseConfig.projectRef}:${userB}`
const futureStoredAccess = JSON.parse(storage.getItem(userBAccessKey)!) as { validatedAt: string }; futureStoredAccess.validatedAt = '2099-07-15T12:00:00.000Z'; storage.setItem(userBAccessKey, JSON.stringify(futureStoredAccess))
;(navigator as { onLine: boolean }).onLine = false
await assert.rejects(() => loadFarmAccess(userB), /connection/)
;(navigator as { onLine: boolean }).onLine = true

// General farm access uses the same durable high-water fence.
await loadFarmAccess(userB, true)

// Supabase can report a token-refresh transport failure while navigator.onLine
// remains true. Preserve that provenance so the exact fenced access cache is
// returned authoritative-offline without being rewritten.
const transportAuthClient = supabase.auth as unknown as { getSession: () => Promise<{ data: { session: null }; error: TypeError }> }
const transportPriorGetSession = transportAuthClient.getSession
const transportAccessBytes = storage.getItem(userBAccessKey)
transportAuthClient.getSession = async () => ({ data: { session: null }, error: new TypeError('network timeout while refreshing session') })
try {
  const transportFallbackAccess = await loadFarmAccess(userB, true)
  assert.equal(transportFallbackAccess.source, 'offline')
  assert.equal(storage.getItem(userBAccessKey), transportAccessBytes, 'Auth transport fallback changed cached access bytes.')
  transportAuthClient.getSession = async () => ({ data: { session: null }, error: { name: 'AuthRetryableFetchError', status: 503, message: 'Service temporarily unavailable' } as never })
  const retryable503Access = await loadFarmAccess(userB, true)
  assert.equal(retryable503Access.source, 'offline', 'A Supabase AuthRetryableFetchError 503 did not use the exact fenced access cache.')
  globalThis.setTimeout = ((handler: TimerHandler, milliseconds?: number, ...args: unknown[]) => timeoutSetTimeout(handler, milliseconds === 10_000 ? 0 : milliseconds, ...args)) as typeof setTimeout
  transportAuthClient.getSession = async () => new Promise<never>(() => undefined)
  const timedOutAccess = await loadFarmAccess(userB, true)
  assert.equal(timedOutAccess.source, 'offline', 'A half-open access auth request did not reach bounded offline fallback.')
} finally { transportAuthClient.getSession = transportPriorGetSession; globalThis.setTimeout = timeoutSetTimeout }

// A farm choice is a context boundary. It must cancel the old replay grant
// synchronously, before access refresh performs its first await.
const selectionProfile = {
  userId: userB, farmId: farmB, kind: 'owner' as const, memberRole: 'owner' as const, memberCanViewFinancials: true, isNamedRep: false, accessEpoch: 1, validatedAt: now, source: 'live' as const,
  capabilities: { canViewOperational: true, canEditOperational: true, canManageFarm: true, canReadPrivateFinancials: true, canUseMembershipOnlyModules: true },
  operationContext: captureFarmRevocationFence(storage, { projectRef: supabaseConfig.projectRef, userId: userB, farmId: farmB }),
}
const selectionAuthorization = beginFarmReplayAuthorization(selectionProfile, storage)
const verifyPreselectionGrant = captureFarmReplayContextGuard(storage)
const selectingFarm = selectFarm(userB, farmB)
assert.throws(() => verifyPreselectionGrant({ userId: userB, farmId: farmB }), /signed-in account or selected farm changed/i, 'selectFarm left the old replay grant active until after its first await.')
await selectingFarm
selectionAuthorization.end()
const resetSelectionAuthorization = beginFarmReplayAuthorization(selectionProfile, storage); resetSelectionAuthorization.end()

// A weak-signal auth refresh can fail while the browser still reports online.
// An exact offline replay grant may use only its matching active account/farm;
// no other stored identity can cross that grant.
const authClient = supabase.auth as unknown as { getSession: () => Promise<{ data: { session: { user: { id: string } } | null }; error: unknown }> }
const priorGetSession = authClient.getSession
authClient.getSession = async () => ({ data: { session: null }, error: new TypeError('network timeout while refreshing session') })
const offlineIdentityProfile = { ...selectionProfile, source: 'offline' as const, operationContext: captureFarmRevocationFence(storage, { projectRef: supabaseConfig.projectRef, userId: userB, farmId: farmB }) }
const userBStoredAccess = JSON.parse(storage.getItem(userBAccessKey)!) as { validatedAt: string }
const userBProfileKey = `farm-rx-access-profile:v1:${supabaseConfig.projectRef}:${userB}:${farmB}`
const { source: _offlineIdentitySource, operationContext: offlineIdentityFence, ...offlineIdentityStored } = offlineIdentityProfile
storage.setItem(userBProfileKey, JSON.stringify({ ...offlineIdentityStored, version: 1, accessValidatedAt: userBStoredAccess.validatedAt, clockHighWaterAt: now, generation: offlineIdentityFence.generation, fenceToken: offlineIdentityFence.token }))
const offlineIdentityAuthorization = beginFarmReplayAuthorization(offlineIdentityProfile, storage)
try {
  assert.equal(isFarmReplayAuthoritativelyOffline(storage), true, 'The exact offline replay grant did not override the unreliable browser connectivity hint.')
  assert.equal(await currentUserId(), userB, 'A transport-failed offline replay could not resolve its exact cached account while the browser reported online.')
  authClient.getSession = async () => ({ data: { session: { user: { id: userA } } }, error: null })
  assert.equal(await currentUserId(), userB, 'An exact offline replay touched a network-capable session lookup instead of its bound identity.')
  authClient.getSession = async () => ({ data: { session: null }, error: null })
  assert.equal(await currentUserId(), userB, 'An exact offline replay could not resolve its bound identity after the local session expired.')
  offlineIdentityAuthorization.end()
  await assert.rejects(() => currentUserId(), /sign-in ended/i, 'Offline replay identity remained usable after its exact grant ended.')
} finally {
  offlineIdentityAuthorization.end()
  authClient.getSession = priorGetSession
}
assert.equal(isFarmReplayAuthoritativelyOffline(storage), false, 'Offline replay connectivity leaked beyond its authorization lifetime.')

// Once the startup replay ends, the ready shell keeps the same exact offline
// account/farm grant. Ordinary reads must resolve it before any auth or farm
// request, and a newer validation clears it synchronously.
const readyOfflineProfile = { ...selectionProfile, source: 'offline' as const, operationContext: captureFarmRevocationFence(storage, { projectRef: supabaseConfig.projectRef, userId: userB, farmId: farmB }) }
let readySessionCalls = 0
authClient.getSession = async () => { readySessionCalls += 1; throw new Error('ready offline context touched auth') }
publishFarmReadyAuthorization(readyOfflineProfile, storage)
try {
  assert.equal(isFarmReplayAuthoritativelyOffline(storage), true, 'The ready offline grant did not keep production queue wiring local after startup replay ended.')
  assert.deepEqual(await currentFarmContext(), { userId: userB, farmId: farmB }, 'The ready offline farm context did not resolve its exact bound farm.')
  assert.equal(await currentUserId(), userB, 'The ready offline identity did not resolve its exact bound user.')
  assert.equal(readySessionCalls, 0, 'A ready offline context performed a network-capable auth lookup.')
  const readyActiveBytes = storage.getItem(activeContextKey)
  const readyAccessBytes = storage.getItem(userBAccessKey)
  storage.setItem(activeContextKey, JSON.stringify({ version: 1, userId: userA, farmId: farmA }))
  await assert.rejects(() => currentFarmContext(), /signed-in account or selected farm changed/i, 'A cross-tab farm switch left the prior ready grant usable.')
  storage.setItem(activeContextKey, readyActiveBytes!)
  storage.removeItem(userBAccessKey)
  await assert.rejects(() => currentFarmContext(), /signed-in account or selected farm changed/i, 'Cross-tab sign-out cleanup left the prior ready grant usable after access bytes disappeared.')
  storage.setItem(userBAccessKey, readyAccessBytes!)
  createFarmAccessValidationGate().begin()
  assert.equal(isFarmReplayAuthoritativelyOffline(storage), false, 'A newer farm validation left the prior ready offline grant active.')
} finally {
  clearFarmReadyAuthorization()
  authClient.getSession = priorGetSession
}

const clockGrantStorage = await cachedProfileTarget()
clockGrantStorage.setItem(offlineAuthAccessKey, storedAccessBytes(accessFor()))
const clockGrantProfile = await loadFarmAccessProfile({ ...accessFor(), source: 'offline' as const }, offlineDependencies(clockGrantStorage, now))
const readyClockNow = Date.now
try {
  Date.now = () => Date.parse(now)
  publishFarmReadyAuthorization(clockGrantProfile, clockGrantStorage)
  Date.now = () => Date.parse('2026-07-21T12:00:00.000Z')
  assert.equal(isFarmReplayAuthoritativelyOffline(clockGrantStorage), true, 'A long-open offline ready grant did not remain valid before its seven-day limit.')
  clearFarmReadyAuthorization()
  Date.now = () => Date.parse(now)
  assert.throws(() => publishFarmReadyAuthorization(clockGrantProfile, clockGrantStorage), /signed-in account or selected farm changed/i, 'Closing after a day-six observation and rolling the clock back reopened the offline grant.')
  Date.now = () => Date.parse('2026-07-21T12:00:00.000Z')
  publishFarmReadyAuthorization(clockGrantProfile, clockGrantStorage)
  Date.now = () => Date.parse('2026-07-23T12:00:01.000Z')
  assert.throws(() => isFarmReplayAuthoritativelyOffline(clockGrantStorage), /signed-in account or selected farm changed/i, 'A continuously open offline ready grant remained usable beyond its seven-day authorization limit.')
} finally {
  clearFarmReadyAuthorization()
  Date.now = readyClockNow
}

// Farm selection spans the stored access record and active-context record. A
// failure on the second write must restore the exact prior bytes rather than
// leaving the visible shell on one farm while repositories resolve another.
const originalLocalStorage = window.localStorage
const splitWriteStorage = new MemoryStorage()
const splitValidatedAt = new Date().toISOString()
const splitAccessKey = `farm-rx-access:v1:${supabaseConfig.projectRef}:${userB}`
const splitAccessBytes = JSON.stringify({ version: 1, userId: userB, farms: [farm(farmA, userB, 'Farm A'), farm(farmB, userB, 'Farm B')], selectedFarmId: farmA, validatedAt: splitValidatedAt })
const splitActiveBytes = JSON.stringify({ version: 1, userId: userB, farmId: farmA })
splitWriteStorage.setItem(splitAccessKey, splitAccessBytes)
splitWriteStorage.setItem(activeContextKey, splitActiveBytes)
for (const farmId of [farmA, farmB]) resetFarmGrantFromLive(splitWriteStorage, { projectRef: supabaseConfig.projectRef, userId: userB, farmId }, 1, splitValidatedAt)
writeFarmAccessEpochs(splitWriteStorage, supabaseConfig.projectRef, userB, { [farmA]: 1, [farmB]: 1 }, splitValidatedAt)
Object.defineProperty(window, 'localStorage', { configurable: true, value: splitWriteStorage })
;(navigator as { onLine: boolean }).onLine = false
const splitSetItem = splitWriteStorage.setItem.bind(splitWriteStorage)
splitWriteStorage.setItem = (key: string, value: string) => {
  if (key === activeContextKey && value.includes(farmB)) throw new Error('simulated active-context write failure')
  splitSetItem(key, value)
}
try {
  await assert.rejects(() => selectFarm(userB, farmB), /simulated active-context write failure/)
  assert.equal(splitWriteStorage.getItem(splitAccessKey), splitAccessBytes, 'A partial farm-selection write left the stored access record on the target farm.')
  assert.equal(splitWriteStorage.getItem(activeContextKey), splitActiveBytes, 'A partial farm-selection write changed the active-context record.')

  let failedActiveWrite = false
  splitWriteStorage.setItem = (key: string, value: string) => {
    if (key === activeContextKey && value.includes(farmB)) { failedActiveWrite = true; throw new Error('simulated active-context write failure') }
    if (failedActiveWrite && key === splitAccessKey && value === splitAccessBytes) throw new Error('simulated rollback write failure')
    splitSetItem(key, value)
  }
  await assert.rejects(() => selectFarm(userB, farmB), (error: unknown) => error instanceof FarmAccessStorageUnsafeError)
  assert.equal(splitWriteStorage.getItem(splitAccessKey), null, 'An unsafe farm-selection rollback retained a split access record.')
  assert.equal(splitWriteStorage.getItem(activeContextKey), null, 'An unsafe farm-selection rollback retained an active-context record.')
} finally {
  Object.defineProperty(window, 'localStorage', { configurable: true, value: originalLocalStorage })
  ;(navigator as { onLine: boolean }).onLine = true
}

const realDateNow = Date.now
try {
  ;(navigator as { onLine: boolean }).onLine = false
  const userBClockKey = deviceClockHighWaterKey({ projectRef: supabaseConfig.projectRef, userId: userB })
  const priorUserBHighWater = Date.parse(String((JSON.parse(storage.getItem(userBClockKey) ?? '{}') as { highWaterAt?: unknown }).highWaterAt ?? ''))
  const controlledForwardMs = Math.max(Date.parse('2026-07-21T12:00:00.000Z'), Number.isFinite(priorUserBHighWater) ? priorUserBHighWater : 0)
  Date.now = () => controlledForwardMs
  assert.equal((await loadFarmAccess(userB)).source, 'offline')
  const userBClockBytes = storage.getItem(userBClockKey)
  Date.now = () => Date.parse('2026-07-15T12:00:00.000Z')
  await assert.rejects(() => loadFarmAccess(userB), /clock/i)
  assert.equal(storage.getItem(userBAccessKey), null, 'Clock rollback retained the general farm access record.')
  assert.equal(storage.getItem(userBClockKey), userBClockBytes, 'General access rollback moved the high-water record backwards.')
} finally { Date.now = realDateNow; (navigator as { onLine: boolean }).onLine = true }

// Sign-out cleanup is also a context boundary and must install the typed
// cancellation tombstone before it mutates account-scoped storage.
resetFarmGrantFromLive(storage, { projectRef: supabaseConfig.projectRef, userId: userB, farmId: farmB }, 1, now)
const signOutProfile = { ...selectionProfile, operationContext: captureFarmRevocationFence(storage, { projectRef: supabaseConfig.projectRef, userId: userB, farmId: farmB }) }
const signOutAuthorization = beginFarmReplayAuthorization(signOutProfile, storage)
const verifyPreSignOutGrant = captureFarmReplayContextGuard(storage)
let cancellationObservedBeforeFirstCleanupWrite = false
storage.beforeWrite = () => {
  assert.throws(() => verifyPreSignOutGrant({ userId: userB, farmId: farmB }), /signed-in account or selected farm changed/i, 'clearFarmAccess mutated account storage before cancelling the old replay grant.')
  cancellationObservedBeforeFirstCleanupWrite = true
}
const clearingFarmAccess = clearFarmAccess(userB)
assert.equal(cancellationObservedBeforeFirstCleanupWrite, true, 'clearFarmAccess did not reach the first cleanup write under the cancellation hook.')
assert.throws(() => verifyPreSignOutGrant({ userId: userB, farmId: farmB }), /signed-in account or selected farm changed/i, 'clearFarmAccess left the old replay grant active until cleanup finished.')
await clearingFarmAccess
signOutAuthorization.end()

console.log('Farm access regressions passed (account isolation, capability matrix, atomic farm-selection storage, synchronous farm-switch/sign-out cancellation, offline fencing, and delayed-profile attacks).')
