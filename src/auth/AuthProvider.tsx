import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabaseClient'
import { supabaseConfig } from '../lib/supabaseConfig'
import { coordinatedDeviceTransaction } from '../data/queueTransaction'
import { clearFarmAccess, isDefiniteTransportFailure, restoreOfflineFarmUserId } from './farmContext'
import { consumeAuthSessionRemovalTicket, type AuthSessionRemovalTicket } from './authSessionStorage'
import { isPasswordRecoveryEvent, passwordEmailDeliveryEnabled, passwordRecoveryRoute, requestPasswordResetNonEnumerating, updatePasswordWithIsolatedRecoverySession } from './passwordRecovery'

export type AuthPhase = 'restoring' | 'signed_out' | 'signed_in'
export type PasswordRecoveryPhase = 'idle' | 'checking' | 'ready' | 'invalid' | 'complete' | 'complete_with_warning'

interface AuthContextValue {
  phase: AuthPhase
  session: Session | null
  user: User | null
  signIn(email: string, password: string): Promise<void>
  signOut(): Promise<void>
  passwordRecoveryPhase: PasswordRecoveryPhase
  requestPasswordReset(email: string): Promise<string>
  updatePassword(password: string): Promise<void>
  cancelPasswordRecovery(): Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export interface AuthProviderDependencies {
  auth: Pick<typeof supabase.auth, 'getSession' | 'onAuthStateChange' | 'signInWithPassword' | 'resetPasswordForEmail'>
  updateRecoveryPassword(session: Session, password: string): Promise<void>
  storage: Storage
  addStorageListener(listener: (event: StorageEvent) => void): void
  removeStorageListener(listener: (event: StorageEvent) => void): void
  clearFarmAccess(userId: string): Promise<void>
  restoreOfflineFarmUserId(): string | null
  intentionalSignOut: { get(): boolean; set(value: boolean): void }
  now(): number
  createId(): string
  coordinateAuthState<T>(task: (verify: () => void) => Promise<T>): Promise<T>
  pathname?(): string
  addPageHideListener?(listener: (event?: PageTransitionEvent) => void): void
  removePageHideListener?(listener: (event?: PageTransitionEvent) => void): void
  addPageShowListener?(listener: (event: PageTransitionEvent) => void): void
  removePageShowListener?(listener: (event: PageTransitionEvent) => void): void
}

const authIntentKey = `farm-rx-auth-intent:v1:${supabaseConfig.projectRef}`
const passwordRecoveryFenceKey = `farm-rx-password-recovery:v2:${supabaseConfig.projectRef}`
const maximumPasswordRecoveryFenceAgeMs = 10 * 60 * 1000

type PersistedPasswordRecoveryFence = { version: 2; ownerId: string; userId: string; sessionLineage: string; createdAtMs: number }

function passwordRecoveryOwnerLeaseKey(ownerId: string) {
  return `${passwordRecoveryFenceKey}:owner:${ownerId}`
}

function parsePasswordRecoveryFence(serialized: string | null): PersistedPasswordRecoveryFence | null {
  try {
    const value = JSON.parse(serialized ?? 'null') as Partial<PersistedPasswordRecoveryFence> | null
    return value?.version === 2
      && typeof value.ownerId === 'string' && value.ownerId.length > 0
      && typeof value.userId === 'string' && typeof value.sessionLineage === 'string'
      && typeof value.createdAtMs === 'number' && Number.isFinite(value.createdAtMs)
      ? value as PersistedPasswordRecoveryFence
      : null
  } catch { return null }
}

function readPasswordRecoveryFence(target: Storage): PersistedPasswordRecoveryFence | null {
  return parsePasswordRecoveryFence(target.getItem(passwordRecoveryFenceKey))
}

function activePasswordRecoveryFence(target: Storage, nowMs: number): PersistedPasswordRecoveryFence | null {
  const fence = readPasswordRecoveryFence(target)
  if (!fence || fence.createdAtMs > nowMs || nowMs - fence.createdAtMs > maximumPasswordRecoveryFenceAgeMs) return null
  const serialized = JSON.stringify(fence)
  return target.getItem(passwordRecoveryOwnerLeaseKey(fence.ownerId)) === serialized ? fence : null
}

function passwordRecoveryFenceMatches(target: Storage, session: Session | null, ownerId: string, nowMs: number): session is Session {
  const fence = activePasswordRecoveryFence(target, nowMs)
  return Boolean(fence && fence.ownerId === ownerId && session && fence.userId === session.user.id && fence.sessionLineage === sessionLineage(session))
}

function sameSessionLineage(left: Session | null, right: Session | null): left is Session {
  if (!left || !right || left.user.id !== right.user.id) return false
  const leftLineage = sessionLineage(left)
  return Boolean(leftLineage && leftLineage === sessionLineage(right))
}

function hasPasswordRecoveryFence(target: Storage, nowMs = Date.now()): boolean {
  try { return activePasswordRecoveryFence(target, nowMs) !== null }
  catch { return true }
}

function persistPasswordRecoveryFence(target: Storage, session: Session, ownerId: string, nowMs: number): string {
  const lineage = sessionLineage(session)
  if (!lineage) throw new Error('Farm Rx could not verify this password-reset link.')
  const existing = activePasswordRecoveryFence(target, nowMs)
  if (existing) return existing.ownerId
  const fence = { version: 2, ownerId, userId: session.user.id, sessionLineage: lineage, createdAtMs: nowMs } satisfies PersistedPasswordRecoveryFence
  const serialized = JSON.stringify(fence)
  target.setItem(passwordRecoveryOwnerLeaseKey(ownerId), serialized)
  target.setItem(passwordRecoveryFenceKey, serialized)
  if (target.getItem(passwordRecoveryOwnerLeaseKey(ownerId)) !== serialized || target.getItem(passwordRecoveryFenceKey) !== serialized) {
    throw new Error('Farm Rx could not protect this password-reset link on this device.')
  }
  return ownerId
}

function abandonOwnedPasswordRecoveryFence(target: Storage, ownerId: string) {
  target.removeItem(passwordRecoveryOwnerLeaseKey(ownerId))
}

function clearOwnedPasswordRecoveryFence(target: Storage, ownerId: string) {
  abandonOwnedPasswordRecoveryFence(target, ownerId)
  const serialized = target.getItem(passwordRecoveryFenceKey)
  const fence = parsePasswordRecoveryFence(serialized)
  if (fence?.ownerId === ownerId && target.getItem(passwordRecoveryFenceKey) === serialized) target.removeItem(passwordRecoveryFenceKey)
}

function clearInactivePasswordRecoveryFence(target: Storage, nowMs: number) {
  if (activePasswordRecoveryFence(target, nowMs)) return
  const serialized = target.getItem(passwordRecoveryFenceKey)
  const fence = parsePasswordRecoveryFence(serialized)
  if (fence) target.removeItem(passwordRecoveryOwnerLeaseKey(fence.ownerId))
  if (target.getItem(passwordRecoveryFenceKey) === serialized) target.removeItem(passwordRecoveryFenceKey)
}

function browserDependencies(): AuthProviderDependencies {
  if (typeof window === 'undefined') throw new Error('Farm Rx could not access this device sign-in.')
  const createId = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
  return {
    auth: supabase.auth,
    updateRecoveryPassword: updatePasswordWithIsolatedRecoverySession,
    storage: window.localStorage,
    addStorageListener: (listener) => window.addEventListener('storage', listener),
    removeStorageListener: (listener) => window.removeEventListener('storage', listener),
    clearFarmAccess,
    restoreOfflineFarmUserId,
    intentionalSignOut: { get: wasIntentionalSignOut, set: (value) => { if (value) markIntentionalSignOut(); else clearIntentionalSignOut() } },
    now: () => Date.now(),
    createId,
    coordinateAuthState: (task) => coordinatedDeviceTransaction(authIntentKey, window.localStorage, createId, task),
    pathname: () => window.location.pathname,
    addPageHideListener: (listener) => window.addEventListener('pagehide', listener),
    removePageHideListener: (listener) => window.removeEventListener('pagehide', listener),
    addPageShowListener: (listener) => window.addEventListener('pageshow', listener),
    removePageShowListener: (listener) => window.removeEventListener('pageshow', listener),
  }
}

function isUpdatePasswordRoute(pathname?: string) {
  return (pathname ?? (typeof window === 'undefined' ? '' : window.location.pathname)) === passwordRecoveryRoute
}

// A deliberate "Sign out" and an expired session both land on /login; this flag
// lets RequireSession tell them apart so we never scold a farmer who just left.
// Read-only during render (React may render twice); cleared on the next sign-in.
let intentionalSignOut = false
export function markIntentionalSignOut() { intentionalSignOut = true }
export function clearIntentionalSignOut() { intentionalSignOut = false }
export function wasIntentionalSignOut() { return intentionalSignOut }

const maximumAuthIntentAgeMs = 5 * 60 * 1000
type PersistedAuthIntent =
  | { version: 1; nonce: string; phase: 'signed_out'; startedAtMs: number }
  | { version: 1; nonce: string; phase: 'pending'; email: string; startedAtMs: number }
  | { version: 1; nonce: string; phase: 'accepted'; userId: string; sessionLineage: string; startedAtMs: number }

function clearPersistedAuthSession(target: Storage, clearIntent = true) {
  const key = `farm-rx-auth:${supabaseConfig.projectRef}`
  for (const suffix of ['', '-code-verifier', '-user']) target.removeItem(`${key}${suffix}`)
  if (clearIntent) target.removeItem(authIntentKey)
  if (target.getItem(key) !== null) throw new Error('Farm Rx could not clear this device sign-in.')
}

interface PersistedAuthSnapshot {
  entries: Array<readonly [key: string, value: string | null]>
}

interface PersistedAuthCleanupAuthority {
  snapshot: PersistedAuthSnapshot
  intentBytes: string | null
}

interface PersistedAuthRollbackState {
  session: Session
  snapshot: PersistedAuthSnapshot
  intentBytes: string | null
}

function authStorageEntries(target: Storage): Array<readonly [string, string | null]> {
  const key = `farm-rx-auth:${supabaseConfig.projectRef}`
  return ['', '-code-verifier', '-user'].map((suffix) => {
    const entryKey = `${key}${suffix}`
    return [entryKey, target.getItem(entryKey)] as const
  })
}

function authStorageEntriesMatch(left: PersistedAuthSnapshot['entries'], right: PersistedAuthSnapshot['entries']): boolean {
  return left.length === right.length && left.every(([key, value], index) => right[index]?.[0] === key && right[index]?.[1] === value)
}

function capturePersistedAuthCleanupAuthority(target: Storage): PersistedAuthCleanupAuthority | null {
  const intentBytesBefore = target.getItem(authIntentKey)
  const entriesBefore = authStorageEntries(target)
  const intentBytesAfter = target.getItem(authIntentKey)
  const entriesAfter = authStorageEntries(target)
  if (intentBytesBefore !== intentBytesAfter || !authStorageEntriesMatch(entriesBefore, entriesAfter)) return null
  return { snapshot: { entries: entriesBefore }, intentBytes: intentBytesBefore }
}

function persistedAuthCleanupAuthorityMatches(target: Storage, authority: PersistedAuthCleanupAuthority): boolean {
  const current = capturePersistedAuthCleanupAuthority(target)
  return Boolean(current
    && current.intentBytes === authority.intentBytes
    && authStorageEntriesMatch(current.snapshot.entries, authority.snapshot.entries))
}

function restorePersistedAuthSnapshot(target: Storage, snapshot: PersistedAuthSnapshot) {
  for (const [key, value] of snapshot.entries) {
    if (value === null) target.removeItem(key)
    else target.setItem(key, value)
  }
}

function persistTrustedAuthSession(target: Storage, session: Session): PersistedAuthSnapshot {
  const key = `farm-rx-auth:${supabaseConfig.projectRef}`
  target.setItem(key, JSON.stringify(session))
  target.removeItem(`${key}-code-verifier`)
  target.removeItem(`${key}-user`)
  return { entries: authStorageEntries(target) }
}

function persistedAuthSessionMatches(target: Storage, session: Session): boolean {
  const key = `farm-rx-auth:${supabaseConfig.projectRef}`
  try {
    const stored = JSON.parse(target.getItem(key) ?? 'null') as Partial<Session> | null
    return stored?.user?.id === session.user.id
      && stored.access_token === session.access_token
      && stored.refresh_token === session.refresh_token
  } catch {
    return false
  }
}

function parsePersistedAuthSession(serialized: string | null): Session | null {
  try {
    const stored = JSON.parse(serialized ?? 'null') as Session | null
    return stored?.user?.id && typeof stored.access_token === 'string' && typeof stored.refresh_token === 'string' ? stored : null
  } catch {
    return null
  }
}

function readPersistedAuthSession(target: Storage): Session | null {
  const key = `farm-rx-auth:${supabaseConfig.projectRef}`
  return parsePersistedAuthSession(target.getItem(key))
}

function sessionLineage(session: Session): string | null {
  try {
    const encodedPayload = session.access_token.split('.')[1]
    if (!encodedPayload) return null
    const normalized = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const payload = JSON.parse(atob(padded)) as { session_id?: unknown; sub?: unknown }
    return typeof payload.session_id === 'string' && payload.session_id.length > 0 && payload.sub === session.user.id
      ? payload.session_id
      : null
  } catch {
    return null
  }
}

function parsePersistedAuthIntentRecord(serialized: string | null): PersistedAuthIntent | null {
  try {
    const value = JSON.parse(serialized ?? 'null') as Partial<PersistedAuthIntent> | null
    if (!value || value.version !== 1 || typeof value.nonce !== 'string' || typeof value.startedAtMs !== 'number') return null
    if (value.phase === 'signed_out') return value as PersistedAuthIntent
    if (value.phase === 'accepted' && typeof value.userId === 'string' && typeof value.sessionLineage === 'string') return value as PersistedAuthIntent
    if (value.phase === 'pending' && typeof value.email === 'string') return value as PersistedAuthIntent
  } catch { /* malformed intent is never trusted */ }
  return null
}

function readPersistedAuthIntentRecord(target: Storage): PersistedAuthIntent | null {
  return parsePersistedAuthIntentRecord(target.getItem(authIntentKey))
}

function hasMalformedPersistedAuthIntent(target: Storage): boolean {
  const serialized = target.getItem(authIntentKey)
  return serialized !== null && parsePersistedAuthIntentRecord(serialized) === null
}

function readPersistedAuthIntent(target: Storage, nowMs: number): PersistedAuthIntent | null {
  const value = readPersistedAuthIntentRecord(target)
  if (!value) return null
  // Accepted and signed-out records are durable lineage fences. Only a
  // password request is time-bounded.
  if (value.phase !== 'pending') return value
  return nowMs >= value.startedAtMs && nowMs - value.startedAtMs <= maximumAuthIntentAgeMs ? value : null
}

function persistSignedOutIntent(target: Storage, nowMs: number, nonce: string) {
  const intent: PersistedAuthIntent = { version: 1, nonce, phase: 'signed_out', startedAtMs: nowMs }
  const serialized = JSON.stringify(intent)
  target.setItem(authIntentKey, serialized)
  if (target.getItem(authIntentKey) !== serialized) throw new Error('Farm Rx could not protect this signed-out device.')
}

function restorePersistedAuthIntent(target: Storage, serialized: string | null) {
  if (serialized === null) target.removeItem(authIntentKey)
  else target.setItem(authIntentKey, serialized)
}

function beginPersistedAuthIntent(target: Storage, email: string, nowMs: number, nonce: string) {
  const intent: PersistedAuthIntent = { version: 1, nonce, phase: 'pending', email: email.trim().toLowerCase(), startedAtMs: nowMs }
  target.setItem(authIntentKey, JSON.stringify(intent))
  if (target.getItem(authIntentKey) !== JSON.stringify(intent)) throw new Error('Farm Rx could not protect this sign-in attempt.')
  return intent
}

function acceptPersistedAuthIntent(target: Storage, pending: PersistedAuthIntent, session: Session, nowMs: number) {
  const current = readPersistedAuthIntent(target, nowMs)
  if (!current || current.nonce !== pending.nonce || current.phase !== 'pending') throw new Error('This sign-in was replaced by a newer attempt.')
  const lineage = sessionLineage(session)
  if (!lineage) throw new Error('Farm Rx could not verify this sign-in session. Please try again.')
  const accepted: PersistedAuthIntent = { version: 1, nonce: pending.nonce, phase: 'accepted', userId: session.user.id, sessionLineage: lineage, startedAtMs: pending.startedAtMs }
  target.setItem(authIntentKey, JSON.stringify(accepted))
}

function persistedAuthIntentMatches(target: Storage, session: Session, nowMs: number): boolean {
  const intent = readPersistedAuthIntent(target, nowMs)
  return intent?.phase === 'accepted'
    && intent.userId === session.user.id
    && intent.sessionLineage === sessionLineage(session)
}

function capturePersistedAuthRollbackState(target: Storage): PersistedAuthRollbackState | null {
  const intentBytesBefore = target.getItem(authIntentKey)
  const entriesBefore = authStorageEntries(target)
  const intentBytesAfter = target.getItem(authIntentKey)
  const entriesAfter = authStorageEntries(target)
  if (intentBytesBefore !== intentBytesAfter || !authStorageEntriesMatch(entriesBefore, entriesAfter)) return null

  const authSessionKey = `farm-rx-auth:${supabaseConfig.projectRef}`
  const session = parsePersistedAuthSession(entriesBefore.find(([key]) => key === authSessionKey)?.[1] ?? null)
  if (!session) return null
  const intent = parsePersistedAuthIntentRecord(intentBytesBefore)
  // Non-null bytes that do not parse as an exact intent are corrupted state,
  // not a legacy session. They can never be restored after a failed sign-in.
  if (intentBytesBefore !== null && !intent) return null
  // A pending or signed-out marker cannot be rolled backward into an accepted
  // session. A legacy session without an intent is allowed until its next
  // successful password sign-in establishes an exact lineage marker.
  if (intent?.phase === 'pending' || intent?.phase === 'signed_out') return null
  if (intent?.phase === 'accepted' && (intent.userId !== session.user.id || intent.sessionLineage !== sessionLineage(session))) return null
  return { session, snapshot: { entries: entriesBefore }, intentBytes: intentBytesBefore }
}

function restoreSessionWithDeadline(auth: AuthProviderDependencies['auth']) {
  const session = auth.getSession()
  let timer: ReturnType<typeof setTimeout> | null = null
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => { const error = new Error('Session restore timed out.'); error.name = 'AbortError'; reject(error) }, 10_000)
  })
  return Promise.race([session, timeout]).finally(() => { if (timer) clearTimeout(timer) })
}

export function AuthProvider({ children, dependencies }: { children: ReactNode; dependencies?: AuthProviderDependencies }) {
  const d = useMemo(() => dependencies ?? browserDependencies(), [dependencies])
  const currentPathname = () => d.pathname?.() ?? (typeof window === 'undefined' ? '' : window.location.pathname)
  const [phase, setPhase] = useState<AuthPhase>('restoring')
  const [session, setSession] = useState<Session | null>(null)
  const [offlineUser, setOfflineUser] = useState<User | null>(null)
  const [passwordRecoveryPhase, setPasswordRecoveryPhase] = useState<PasswordRecoveryPhase>(() => isUpdatePasswordRoute(currentPathname()) ? 'checking' : 'idle')
  const authActionVersion = useRef(0)
  const signInInFlight = useRef(false)
  const blockAuthEventsUntilManualSignIn = useRef(false)
  const acceptedSession = useRef<Session | null>(null)
  const trustedAuthSnapshot = useRef<PersistedAuthSnapshot | null>(null)
  const recoverySession = useRef<Session | null>(null)
  const recoveryConflictDuringSignIn = useRef(false)
  const recoveryCompleted = useRef(false)
  const recoveryOwnerId = useRef<string | null>(null)
  if (recoveryOwnerId.current === null) recoveryOwnerId.current = d.createId()

  useEffect(() => {
    let active = true
    let eventVersion = 0
    const authSessionKey = `farm-rx-auth:${supabaseConfig.projectRef}`
    const initialIntentPhase = readPersistedAuthIntentRecord(d.storage)?.phase
    const initialIntentMalformed = hasMalformedPersistedAuthIntent(d.storage)
    const initialRecoveryFence = isUpdatePasswordRoute(currentPathname()) && hasPasswordRecoveryFence(d.storage, d.now())
    if (initialIntentPhase === 'signed_out' || initialIntentPhase === 'pending' || initialIntentMalformed || initialRecoveryFence) blockAuthEventsUntilManualSignIn.current = true
    const applySession = (next: Session | null) => {
      if (!active) return
      acceptedSession.current = next
      trustedAuthSnapshot.current = next ? { entries: authStorageEntries(d.storage) } : null
      setSession(next)
      setOfflineUser(null)
      setPhase(next ? 'signed_in' : 'signed_out')
    }
    const applyOfflineUser = (userId: string) => {
      if (!active) return
      acceptedSession.current = null
      trustedAuthSnapshot.current = null
      setSession(null)
      setOfflineUser({ id: userId, app_metadata: {}, user_metadata: {}, aud: 'authenticated', created_at: '' } as User)
      setPhase('signed_in')
    }
    const applySignedOutFence = async (removalTicket: AuthSessionRemovalTicket | null = null) => {
      if (isUpdatePasswordRoute(currentPathname()) && !recoveryCompleted.current && !recoverySession.current && !hasPasswordRecoveryFence(d.storage, d.now())) {
        setPasswordRecoveryPhase('invalid')
      }
      await d.coordinateAuthState(async (verify) => {
        verify()
        // A verified recovery-only fence wins over an older signed-out intent
        // on the one public reset route. It still produces no app session.
        if (isUpdatePasswordRoute(currentPathname()) && hasPasswordRecoveryFence(d.storage, d.now())) {
          blockAuthEventsUntilManualSignIn.current = true
          applySession(null)
          return
        }
        clearInactivePasswordRecoveryFence(d.storage, d.now())
        verify()
        const coherent = capturePersistedAuthRollbackState(d.storage)
        const intent = readPersistedAuthIntent(d.storage, d.now())
        const authorizedLocalRemoval = removalTicket !== null
          && d.storage.getItem(authSessionKey) === removalTicket.sessionBytes
          && d.storage.getItem(authIntentKey) === removalTicket.intentBytes
        if (removalTicket && !authorizedLocalRemoval && intent?.phase !== 'accepted') return
        if (coherent && intent?.phase === 'accepted' && !authorizedLocalRemoval) {
          blockAuthEventsUntilManualSignIn.current = false
          d.intentionalSignOut.set(false)
          eventVersion += 1
          applySession(coherent.session)
          return
        }
        // A live password attempt owns the intent. Remove any auth-js bytes
        // from an early or stale broadcast, but preserve that pending nonce.
        if (intent?.phase === 'pending') {
          clearPersistedAuthSession(d.storage, false)
          verify()
          return
        }
        blockAuthEventsUntilManualSignIn.current = true
        clearPersistedAuthSession(d.storage, false)
        verify()
        if (intent?.phase !== 'signed_out') persistSignedOutIntent(d.storage, d.now(), d.createId())
        verify()
        eventVersion += 1
        applySession(null)
      }).catch(() => {
        blockAuthEventsUntilManualSignIn.current = true
        eventVersion += 1
        applySession(null)
      })
    }
    const publishTrustedAuthEventSession = (nextSession: Session) => {
      void d.coordinateAuthState(async (verify) => {
        verify()
        if (hasMalformedPersistedAuthIntent(d.storage) || blockAuthEventsUntilManualSignIn.current) {
          throw new Error('Farm Rx rejected an untrusted sign-in event.')
        }
        const intentRecord = readPersistedAuthIntentRecord(d.storage)
        const intent = readPersistedAuthIntent(d.storage, d.now())
        if (intentRecord?.phase === 'pending' || intent?.phase === 'signed_out') {
          throw new Error('Farm Rx rejected an auth event behind an active intent fence.')
        }
        const trustedSession = acceptedSession.current
        if (trustedSession && nextSession.user.id !== trustedSession.user.id) {
          throw new Error('Farm Rx rejected an auth event from another account.')
        }
        if (intent?.phase === 'accepted') {
          if (!persistedAuthIntentMatches(d.storage, nextSession, d.now())) {
            throw new Error('Farm Rx rejected an auth event from another session lineage.')
          }
        } else {
          if (intentRecord !== null) throw new Error('Farm Rx rejected malformed auth intent state.')
          const legacySession = readPersistedAuthSession(d.storage)
          if (!legacySession || legacySession.user.id !== nextSession.user.id) {
            throw new Error('Farm Rx rejected an auth event without trusted legacy state.')
          }
        }
        persistTrustedAuthSession(d.storage, nextSession)
        verify()
        if (!persistedAuthSessionMatches(d.storage, nextSession)) {
          throw new Error('Farm Rx could not preserve a trusted auth event.')
        }
        if (intent?.phase === 'accepted' && !persistedAuthIntentMatches(d.storage, nextSession, d.now())) {
          throw new Error('Farm Rx auth intent changed while preserving a trusted event.')
        }
        blockAuthEventsUntilManualSignIn.current = false
        d.intentionalSignOut.set(false)
        eventVersion += 1
        applySession(nextSession)
      }).catch(() => { void applySignedOutFence() })
    }
    if (initialIntentPhase === 'signed_out' || initialIntentMalformed) void applySignedOutFence()
    const { data: listener } = d.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') {
        // Never turn a recovery token into an ordinary Farm Rx session. The
        // update form can use it only while it is held in memory on its exact
        // public route; arbitrary SIGNED_IN broadcasts stay fenced below.
        if (isPasswordRecoveryEvent(event, nextSession, currentPathname())) {
          eventVersion += 1
          void d.coordinateAuthState(async (verify) => {
            verify()
            const claimedOwnerId = persistPasswordRecoveryFence(d.storage, nextSession, recoveryOwnerId.current!, d.now())
            verify()
            if (claimedOwnerId !== recoveryOwnerId.current
              || !passwordRecoveryFenceMatches(d.storage, nextSession, recoveryOwnerId.current!, d.now())) {
              throw new Error('Another Farm Rx tab already owns this password-reset link.')
            }
            recoveryCompleted.current = false
            recoverySession.current = nextSession
            if (signInInFlight.current) recoveryConflictDuringSignIn.current = true
            setPasswordRecoveryPhase('ready')
          }).catch(() => {
            recoverySession.current = null
            setPasswordRecoveryPhase('invalid')
            try { abandonOwnedPasswordRecoveryFence(d.storage, recoveryOwnerId.current!) } catch { /* signed-out fence below */ }
            void applySignedOutFence()
          })
        } else {
          // auth-js broadcasts PASSWORD_RECOVERY to every tab and does not
          // identify the source. A normal-route recipient must neither adopt
          // the capability nor clear the recovery owner's shared fence.
          if (signInInFlight.current) recoveryConflictDuringSignIn.current = true
        }
        return
      }
      if (event === 'SIGNED_OUT') {
        const removalTicket = consumeAuthSessionRemovalTicket(d.storage, supabaseConfig.projectRef)
        if (recoverySession.current && isUpdatePasswordRoute(currentPathname())) {
          recoverySession.current = null
          try { abandonOwnedPasswordRecoveryFence(d.storage, recoveryOwnerId.current!) } catch { /* signed-out fence below */ }
          setPasswordRecoveryPhase('invalid')
          void applySignedOutFence(removalTicket)
          return
        }
        if (signInInFlight.current && !removalTicket) return
        if (readPersistedAuthIntent(d.storage, d.now())?.phase === 'pending' && !removalTicket) return
        void applySignedOutFence(removalTicket)
        return
      }
      if (event === 'SIGNED_IN') {
        if (recoveryCompleted.current) return
        if (recoverySession.current) {
          const recoveryMatches = passwordRecoveryFenceMatches(d.storage, nextSession, recoveryOwnerId.current!, d.now())
            && sameSessionLineage(recoverySession.current, nextSession)
          if (signInInFlight.current && !recoveryMatches) {
            recoveryConflictDuringSignIn.current = true
            return
          }
          if (!isUpdatePasswordRoute(currentPathname()) || !recoveryMatches) {
            abandonOwnedPasswordRecoveryFence(d.storage, recoveryOwnerId.current!)
            recoverySession.current = null
            setPasswordRecoveryPhase('invalid')
            void applySignedOutFence()
          }
          return
        }
        if (recoverySession.current && isUpdatePasswordRoute(currentPathname())) return
        if (signInInFlight.current) return
        const trustedSession = acceptedSession.current
        const intent = readPersistedAuthIntent(d.storage, d.now())
        const intentRecord = readPersistedAuthIntentRecord(d.storage)
        if (hasMalformedPersistedAuthIntent(d.storage)) {
          void applySignedOutFence()
          return
        }
        if (nextSession && persistedAuthSessionMatches(d.storage, nextSession) && persistedAuthIntentMatches(d.storage, nextSession, d.now())) {
          blockAuthEventsUntilManualSignIn.current = false
          d.intentionalSignOut.set(false)
          eventVersion += 1
          applySession(nextSession)
          return
        }
        if (nextSession && intent?.phase === 'accepted' && persistedAuthIntentMatches(d.storage, nextSession, d.now())) {
          publishTrustedAuthEventSession(nextSession)
          return
        }
        if (intentRecord?.phase === 'pending') {
          if (intent?.phase === 'pending') {
            void applySignedOutFence()
            return
          }
          void applySignedOutFence()
          return
        }
        if (intent?.phase === 'accepted') {
          void applySignedOutFence()
          return
        }
        if (nextSession && trustedSession && nextSession.user.id !== trustedSession.user.id) {
          void applySignedOutFence()
          return
        }
        if (blockAuthEventsUntilManualSignIn.current) {
          void applySignedOutFence()
          return
        }
        if (nextSession && persistedAuthSessionMatches(d.storage, nextSession) && (!trustedSession || nextSession.user.id === trustedSession.user.id)) {
          eventVersion += 1
          applySession(nextSession)
        }
      }
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        if (recoveryCompleted.current) return
        if (recoverySession.current) {
          const recoveryMatches = passwordRecoveryFenceMatches(d.storage, nextSession, recoveryOwnerId.current!, d.now())
            && sameSessionLineage(recoverySession.current, nextSession)
          if (signInInFlight.current && !recoveryMatches) {
            recoveryConflictDuringSignIn.current = true
            return
          }
          if (!isUpdatePasswordRoute(currentPathname()) || !recoveryMatches) {
            abandonOwnedPasswordRecoveryFence(d.storage, recoveryOwnerId.current!)
            recoverySession.current = null
            setPasswordRecoveryPhase('invalid')
            void applySignedOutFence()
          }
          return
        }
        if (recoverySession.current && isUpdatePasswordRoute(currentPathname())) return
        if (signInInFlight.current) return
        if (hasMalformedPersistedAuthIntent(d.storage)) {
          void applySignedOutFence()
          return
        }
        if (readPersistedAuthIntentRecord(d.storage)?.phase === 'pending' && readPersistedAuthIntent(d.storage, d.now())?.phase !== 'pending') {
          void applySignedOutFence()
          return
        }
        if (blockAuthEventsUntilManualSignIn.current) {
          void applySignedOutFence()
          return
        }
        const trustedSession = acceptedSession.current
        if (nextSession && trustedSession && nextSession.user.id !== trustedSession.user.id) {
          void applySignedOutFence()
          return
        }
        const intent = readPersistedAuthIntent(d.storage, d.now())
        if (intent?.phase === 'accepted' && (!nextSession || !persistedAuthIntentMatches(d.storage, nextSession, d.now()))) {
          void applySignedOutFence()
          return
        }
        if (nextSession) publishTrustedAuthEventSession(nextSession)
        else void applySignedOutFence()
      }
    })
    const storageChanged = (event: StorageEvent) => {
      // This tab has already consumed and revoked its one-purpose recovery
      // capability. A sibling may legitimately publish a newer accepted
      // session, but the stale recovery page must remain terminal and signed
      // out rather than adopting that ordinary session.
      if (recoveryCompleted.current) return
      if (event.key === authSessionKey && event.newValue === null) {
        // A sibling tab may remove stale auth bytes while a newer password
        // attempt owns the shared pending nonce. That cleanup must not turn
        // the newer attempt into a durable sign-out.
        const currentSession = readPersistedAuthSession(d.storage)
        if (currentSession && persistedAuthIntentMatches(d.storage, currentSession, d.now())) return
        if (readPersistedAuthIntent(d.storage, d.now())?.phase === 'pending') return
        void applySignedOutFence()
        return
      }
      if (event.key === authIntentKey) {
        if (hasMalformedPersistedAuthIntent(d.storage)) {
          void applySignedOutFence()
          return
        }
        const intent = readPersistedAuthIntent(d.storage, d.now())
        if (intent?.phase === 'signed_out') {
          void applySignedOutFence()
          return
        }
        if (intent?.phase === 'accepted') {
          const nextSession = readPersistedAuthSession(d.storage)
          if (nextSession && persistedAuthIntentMatches(d.storage, nextSession, d.now())) {
            blockAuthEventsUntilManualSignIn.current = false
            d.intentionalSignOut.set(false)
            eventVersion += 1
            applySession(nextSession)
          }
        }
      }
    }
    d.addStorageListener(storageChanged)
    const routeChanged = () => {
      if (isUpdatePasswordRoute(currentPathname()) || !recoverySession.current) return
      recoverySession.current = null
      try { abandonOwnedPasswordRecoveryFence(d.storage, recoveryOwnerId.current!) } catch { /* signed-out fence below */ }
      setPasswordRecoveryPhase('invalid')
      void applySignedOutFence()
    }
    if (typeof window !== 'undefined') window.addEventListener('popstate', routeChanged)
    const pageHiding = (_event?: PageTransitionEvent) => {
      if (!recoverySession.current) return
      recoverySession.current = null
      // Removing this mount's unique lease is synchronous and cannot delete a
      // newer owner's fence. Any inert index left by a hard close is pruned by
      // the next coordinated sign-in.
      try { abandonOwnedPasswordRecoveryFence(d.storage, recoveryOwnerId.current!) } catch { /* bounded expiry remains */ }
    }
    if (d.addPageHideListener) d.addPageHideListener(pageHiding)
    else if (typeof window !== 'undefined') window.addEventListener('pagehide', pageHiding)
    const pageShown = (event: PageTransitionEvent) => {
      if (!event.persisted || recoveryCompleted.current || !isUpdatePasswordRoute(currentPathname())) return
      const currentRecoverySession = recoverySession.current
      let recoveryStillValid = false
      try {
        recoveryStillValid = Boolean(currentRecoverySession
          && passwordRecoveryFenceMatches(d.storage, currentRecoverySession, recoveryOwnerId.current!, d.now()))
      } catch { /* unreadable storage is not proof of recovery ownership */ }
      if (recoveryStillValid) return

      // A back/forward-cache restore resumes the old JavaScript heap. It may
      // not revive a capability whose exact owner lease was revoked when the
      // page hid, even though the rendered form still looked ready.
      eventVersion += 1
      recoverySession.current = null
      acceptedSession.current = null
      trustedAuthSnapshot.current = null
      blockAuthEventsUntilManualSignIn.current = true
      try { abandonOwnedPasswordRecoveryFence(d.storage, recoveryOwnerId.current!) } catch { /* bounded expiry remains */ }
      setSession(null)
      setOfflineUser(null)
      setPhase('signed_out')
      setPasswordRecoveryPhase('invalid')
    }
    if (d.addPageShowListener) d.addPageShowListener(pageShown)
    else if (typeof window !== 'undefined') window.addEventListener('pageshow', pageShown)
    const restoreVersion = eventVersion
    const restoreActionVersion = authActionVersion.current
    const settleRestoreFailure = (error: unknown) => {
      if (isUpdatePasswordRoute(currentPathname())) {
        recoverySession.current = null
        try { abandonOwnedPasswordRecoveryFence(d.storage, recoveryOwnerId.current!) } catch { /* signed-out fence below */ }
        setPasswordRecoveryPhase('invalid')
        void applySignedOutFence()
        return
      }
      if (hasMalformedPersistedAuthIntent(d.storage)) {
        void applySignedOutFence()
        return
      }
      const intent = readPersistedAuthIntent(d.storage, d.now())
      const intentRecord = readPersistedAuthIntentRecord(d.storage)
      if (intentRecord?.phase === 'pending') {
        if (intent?.phase === 'pending') applySession(null)
        else void applySignedOutFence()
        return
      }
      if (intent?.phase === 'signed_out') {
        void applySignedOutFence()
        return
      }
      if (intent?.phase === 'accepted') {
        const persistedSession = readPersistedAuthSession(d.storage)
        if (!persistedSession || !persistedAuthIntentMatches(d.storage, persistedSession, d.now())) {
          void applySignedOutFence()
          return
        }
      }
      const offlineUserId = isDefiniteTransportFailure(error) ? d.restoreOfflineFarmUserId() : null
      if (offlineUserId) applyOfflineUser(offlineUserId); else applySession(null)
    }
    void restoreSessionWithDeadline(d.auth).then(({ data, error }) => {
      if (eventVersion !== restoreVersion || authActionVersion.current !== restoreActionVersion) return
      if (!error) {
        if (isUpdatePasswordRoute(currentPathname())) {
          // Recovery credentials are memory-only. A persisted lineage fence
          // proves that recovery started, but never recreates the capability
          // after a reload without this mount's PASSWORD_RECOVERY event.
          if (recoverySession.current && passwordRecoveryFenceMatches(d.storage, recoverySession.current, recoveryOwnerId.current!, d.now())) {
            applySession(null)
          } else {
            recoverySession.current = null
            try { abandonOwnedPasswordRecoveryFence(d.storage, recoveryOwnerId.current!) } catch { /* signed-out fence below */ }
            setPasswordRecoveryPhase('invalid')
            void applySignedOutFence()
          }
          return
        }
        // Another tab's memory-only recovery fence must not disturb this
        // tab's legitimate ordinary session. Recovery credentials never reach
        // shared Auth storage, so normal restore can continue independently.
        if (hasMalformedPersistedAuthIntent(d.storage)) {
          void applySignedOutFence()
          return
        }
        const intent = readPersistedAuthIntent(d.storage, d.now())
        const intentRecord = readPersistedAuthIntentRecord(d.storage)
        if (intentRecord?.phase === 'pending') {
          if (intent?.phase === 'pending') applySession(null)
          else void applySignedOutFence()
          return
        }
        if (intent?.phase === 'signed_out') { void applySignedOutFence(); return }
        if (intent?.phase === 'accepted' && (!data.session || !persistedAuthIntentMatches(d.storage, data.session, d.now()))) { void applySignedOutFence(); return }
        applySession(data.session)
        return
      }
      settleRestoreFailure(error)
    }).catch((error: unknown) => {
      if (eventVersion !== restoreVersion || authActionVersion.current !== restoreActionVersion) return
      settleRestoreFailure(error)
    })
    return () => {
      active = false
      pageHiding()
      d.removeStorageListener(storageChanged)
      if (typeof window !== 'undefined') window.removeEventListener('popstate', routeChanged)
      if (d.removePageHideListener) d.removePageHideListener(pageHiding)
      else if (typeof window !== 'undefined') window.removeEventListener('pagehide', pageHiding)
      if (d.removePageShowListener) d.removePageShowListener(pageShown)
      else if (typeof window !== 'undefined') window.removeEventListener('pageshow', pageShown)
      listener.subscription.unsubscribe()
    }
  }, [d])

  const value = useMemo<AuthContextValue>(() => ({
    phase,
    session,
    user: session?.user ?? offlineUser,
    passwordRecoveryPhase,
    async requestPasswordReset(email) {
      if (!passwordEmailDeliveryEnabled) throw new Error('Farm Rx password email delivery is not enabled yet.')
      const origin = typeof window === 'undefined' ? '' : window.location.origin
      return requestPasswordResetNonEnumerating(email, origin, d.auth.resetPasswordForEmail.bind(d.auth))
    },
    async updatePassword(password) {
      const currentRecoverySession = recoverySession.current
      if (!currentRecoverySession || passwordRecoveryPhase !== 'ready') {
        throw new Error('This password-reset link is invalid or has expired. Request a new one from the sign-in page.')
      }
      let serverUpdated = false
      let recoveryContextInvalid = false
      let cleanupFailed = false
      let cleanupAuthority: PersistedAuthCleanupAuthority | null = null
      try {
        await d.coordinateAuthState(async (verify) => {
          verify()
          if (!isUpdatePasswordRoute(currentPathname())
            || recoverySession.current !== currentRecoverySession
            || !passwordRecoveryFenceMatches(d.storage, currentRecoverySession, recoveryOwnerId.current!, d.now())) {
            recoveryContextInvalid = true
            throw new Error('This password-reset link is invalid or has expired. Request a new one from the sign-in page.')
          }
          cleanupAuthority = capturePersistedAuthCleanupAuthority(d.storage)
          if (!cleanupAuthority) throw new Error('Farm Rx could not protect this device session before updating the password.')
          // Keep the ready fence through a confirmed server failure so the
          // farmer can retry. The shared transaction excludes every competing
          // tab until this remote operation and its final fence are complete.
          await d.updateRecoveryPassword(currentRecoverySession, password)
          serverUpdated = true
          recoveryCompleted.current = true

          // From this point forward the password is already changed. Revoke
          // the one-purpose capability immediately and never present cleanup
          // trouble as a retryable server failure.
          recoverySession.current = null
          acceptedSession.current = null
          trustedAuthSnapshot.current = null
          blockAuthEventsUntilManualSignIn.current = true
          setSession(null)
          setOfflineUser(null)
          setPhase('signed_out')
          setPasswordRecoveryPhase('complete')
          verify()
          if (!persistedAuthCleanupAuthorityMatches(d.storage, cleanupAuthority)) {
            throw new Error('Farm Rx preserved a newer device sign-in after the password changed.')
          }
          clearOwnedPasswordRecoveryFence(d.storage, recoveryOwnerId.current!)
          verify()
          clearPersistedAuthSession(d.storage, false)
          verify()
          if (d.storage.getItem(authIntentKey) !== cleanupAuthority.intentBytes) {
            throw new Error('Farm Rx preserved a newer device sign-in intent after the password changed.')
          }
          persistSignedOutIntent(d.storage, d.now(), d.createId())
          verify()
        })
      } catch (error) {
        if (!serverUpdated) {
          if (recoveryContextInvalid) {
            recoverySession.current = null
            blockAuthEventsUntilManualSignIn.current = true
            setPasswordRecoveryPhase('invalid')
            setSession(null)
            setOfflineUser(null)
            setPhase('signed_out')
            try { abandonOwnedPasswordRecoveryFence(d.storage, recoveryOwnerId.current!) } catch { /* bounded expiry remains */ }
          }
          throw error
        }
        cleanupFailed = true
        // The server save is already true. Direct cleanup may revoke only this
        // mount's unique lease. Shared Auth bytes are retried under the lock
        // and only while they still exactly match the pre-save authority;
        // a newer accepted session is never overwritten by this old recovery.
        try { abandonOwnedPasswordRecoveryFence(d.storage, recoveryOwnerId.current!) } catch { /* warning below */ }
        if (cleanupAuthority) {
          try {
            await d.coordinateAuthState(async (verify) => {
              verify()
              if (!persistedAuthCleanupAuthorityMatches(d.storage, cleanupAuthority!)) return
              clearOwnedPasswordRecoveryFence(d.storage, recoveryOwnerId.current!)
              verify()
              if (!persistedAuthCleanupAuthorityMatches(d.storage, cleanupAuthority!)) return
              clearPersistedAuthSession(d.storage, false)
              verify()
              if (d.storage.getItem(authIntentKey) !== cleanupAuthority!.intentBytes) return
              persistSignedOutIntent(d.storage, d.now(), d.createId())
              verify()
            })
          } catch { /* keep successful server truth and preserve newer shared state */ }
        }
      }
      if (cleanupFailed) setPasswordRecoveryPhase('complete_with_warning')
    },
    async cancelPasswordRecovery() {
      authActionVersion.current += 1
      recoverySession.current = null
      recoveryCompleted.current = false
      recoveryConflictDuringSignIn.current = false
      signInInFlight.current = false
      blockAuthEventsUntilManualSignIn.current = true
      await d.coordinateAuthState(async (verify) => {
        verify()
        clearOwnedPasswordRecoveryFence(d.storage, recoveryOwnerId.current!)
        verify()
        clearPersistedAuthSession(d.storage, false)
        verify()
        persistSignedOutIntent(d.storage, d.now(), d.createId())
        verify()
      })
      acceptedSession.current = null
      trustedAuthSnapshot.current = null
      setSession(null)
      setOfflineUser(null)
      setPhase('signed_out')
      setPasswordRecoveryPhase('idle')
    },
    async signIn(email, password) {
      if (recoverySession.current) {
        throw new Error('Finish or cancel password recovery before signing in to another account.')
      }
      recoveryConflictDuringSignIn.current = false
      const actionVersion = ++authActionVersion.current
      blockAuthEventsUntilManualSignIn.current = true
      signInInFlight.current = true
      let priorSharedState: PersistedAuthRollbackState | null
      let pendingIntent: PersistedAuthIntent
      try {
        ;({ priorSharedState, pendingIntent } = await d.coordinateAuthState(async (verify) => {
          verify()
          clearInactivePasswordRecoveryFence(d.storage, d.now())
          verify()
          if (recoverySession.current || hasPasswordRecoveryFence(d.storage, d.now())) {
            throw new Error('Finish or cancel password recovery before signing in to another account.')
          }
          const prior = capturePersistedAuthRollbackState(d.storage)
          const pending = beginPersistedAuthIntent(d.storage, email, d.now(), d.createId())
          verify()
          return { priorSharedState: prior, pendingIntent: pending }
        }))
      } catch (error) {
        if (actionVersion === authActionVersion.current) signInInFlight.current = false
        throw error
      }
      const ownsPersistedIntent = () => {
        const current = readPersistedAuthIntent(d.storage, d.now())
        return current?.phase === 'pending' && current.nonce === pendingIntent.nonce
      }
      const applySignedInLocal = (nextSession: Session, snapshot: PersistedAuthSnapshot) => {
        acceptedSession.current = nextSession
        trustedAuthSnapshot.current = snapshot
        blockAuthEventsUntilManualSignIn.current = false
        d.intentionalSignOut.set(false)
        setSession(nextSession)
        setOfflineUser(null)
        setPhase('signed_in')
      }
      const applySignedOutLocal = () => {
        acceptedSession.current = null
        trustedAuthSnapshot.current = null
        blockAuthEventsUntilManualSignIn.current = true
        d.intentionalSignOut.set(true)
        setSession(null)
        setOfflineUser(null)
        setPhase('signed_out')
      }
      const abortRecoverySignInConflict = async () => {
        recoverySession.current = null
        recoveryConflictDuringSignIn.current = false
        signInInFlight.current = false
        setPasswordRecoveryPhase('invalid')
        applySignedOutLocal()
        try { abandonOwnedPasswordRecoveryFence(d.storage, recoveryOwnerId.current!) } catch { /* bounded expiry remains */ }
        try {
          await d.coordinateAuthState(async (verify) => {
            verify()
            if (!ownsPersistedIntent()) return
            clearPersistedAuthSession(d.storage, false)
            verify()
            if (!ownsPersistedIntent()) return
            persistSignedOutIntent(d.storage, d.now(), d.createId())
            verify()
          })
        } catch { /* preserve any newer accepted session */ }
      }
      const restoreOwnedPriorState = () => d.coordinateAuthState(async (verify) => {
        verify()
        if (!ownsPersistedIntent()) return false
        const priorSessionBytes = priorSharedState?.snapshot.entries.find(([key]) => key === `farm-rx-auth:${supabaseConfig.projectRef}`)?.[1]
        if (priorSharedState && d.storage.getItem(`farm-rx-auth:${supabaseConfig.projectRef}`) === priorSessionBytes) {
          restorePersistedAuthSnapshot(d.storage, priorSharedState.snapshot)
          verify()
          if (!ownsPersistedIntent()) return false
          restorePersistedAuthIntent(d.storage, priorSharedState.intentBytes)
          verify()
          if (!persistedAuthSessionMatches(d.storage, priorSharedState.session) || d.storage.getItem(authIntentKey) !== priorSharedState.intentBytes) return false
          applySignedInLocal(priorSharedState.session, priorSharedState.snapshot)
          return true
        }
        // Never restore a prior pending, malformed, or mixed lineage. That can
        // re-authorize a superseded request (nonce ABA). Fail closed instead.
        clearPersistedAuthSession(d.storage, false)
        verify()
        if (!ownsPersistedIntent()) return false
        persistSignedOutIntent(d.storage, d.now(), d.createId())
        verify()
        applySignedOutLocal()
        return true
      })
      const adoptFreshlyPersistedState = () => d.coordinateAuthState(async (verify) => {
        verify()
        const coherent = capturePersistedAuthRollbackState(d.storage)
        const intent = readPersistedAuthIntent(d.storage, d.now())
        if (coherent && intent?.phase === 'accepted') {
          applySignedInLocal(coherent.session, coherent.snapshot)
          return
        }
        if (intent?.phase === 'pending') {
          // Another tab owns a still-live request. Do not rewrite its tuple;
          // its accepted storage event will update this provider.
          applySignedOutLocal()
          return
        }
        clearPersistedAuthSession(d.storage, false)
        verify()
        if (intent?.phase !== 'signed_out') {
          persistSignedOutIntent(d.storage, d.now(), d.createId())
          verify()
        }
        applySignedOutLocal()
      })
      const recoverAfterFailure = async () => {
        if (!await restoreOwnedPriorState()) await adoptFreshlyPersistedState()
      }
      let response: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>
      try {
        response = await d.auth.signInWithPassword({ email: email.trim(), password })
      } catch (error) {
        if (recoveryConflictDuringSignIn.current || recoverySession.current || hasPasswordRecoveryFence(d.storage, d.now())) {
          await abortRecoverySignInConflict()
          throw new Error('Sign-in was canceled because password recovery started in another tab.')
        }
        if (actionVersion === authActionVersion.current) {
          signInInFlight.current = false
          await recoverAfterFailure()
        }
        throw error
      }
      if (recoveryConflictDuringSignIn.current || recoverySession.current || hasPasswordRecoveryFence(d.storage, d.now())) {
        await abortRecoverySignInConflict()
        throw new Error('Sign-in was canceled because password recovery started in another tab.')
      }
      if (actionVersion !== authActionVersion.current) {
        throw new Error('This sign-in was canceled. Please try again.')
      }
      const { data, error } = response
      if (error || !data.session) {
        signInInFlight.current = false
        await recoverAfterFailure()
        throw error ?? new Error('Farm Rx could not sign you in right now. Please try again.')
      }
      if (!ownsPersistedIntent()) {
        signInInFlight.current = false
        await adoptFreshlyPersistedState()
        throw new Error('This sign-in was replaced by a newer attempt.')
      }
      let acceptedSnapshot: PersistedAuthSnapshot
      try {
        acceptedSnapshot = await d.coordinateAuthState(async (verify) => {
          verify()
          if (recoveryConflictDuringSignIn.current || recoverySession.current || hasPasswordRecoveryFence(d.storage, d.now())) {
            recoveryConflictDuringSignIn.current = true
            throw new Error('Sign-in was canceled because password recovery started in another tab.')
          }
          if (!ownsPersistedIntent()) throw new Error('This sign-in was replaced by a newer attempt.')
          const snapshot = persistTrustedAuthSession(d.storage, data.session)
          verify()
          acceptPersistedAuthIntent(d.storage, pendingIntent, data.session, d.now())
          verify()
          if (!persistedAuthSessionMatches(d.storage, data.session) || !persistedAuthIntentMatches(d.storage, data.session, d.now())) throw new Error('Farm Rx could not preserve this sign-in session.')
          return snapshot
        })
      } catch (commitError) {
        if (recoveryConflictDuringSignIn.current || recoverySession.current || hasPasswordRecoveryFence(d.storage, d.now())) {
          await abortRecoverySignInConflict()
          throw new Error('Sign-in was canceled because password recovery started in another tab.')
        }
        signInInFlight.current = false
        blockAuthEventsUntilManualSignIn.current = true
        await recoverAfterFailure()
        throw commitError
      }
      applySignedInLocal(data.session, acceptedSnapshot)
      signInInFlight.current = false
    },
    async signOut() {
      authActionVersion.current += 1
      signInInFlight.current = false
      blockAuthEventsUntilManualSignIn.current = true
      const userId = session?.user.id ?? offlineUser?.id
      // Fence shared auth as one cross-tab transaction before any IndexedDB or
      // cache cleanup can yield. A later sign-in can then safely follow it.
      await d.coordinateAuthState(async (verify) => {
        verify()
        clearPersistedAuthSession(d.storage)
        verify()
        persistSignedOutIntent(d.storage, d.now(), d.createId())
        verify()
      })
      acceptedSession.current = null
      trustedAuthSnapshot.current = null
      d.intentionalSignOut.set(true)
      setSession(null)
      setOfflineUser(null)
      setPhase('signed_out')
      if (userId) await d.clearFarmAccess(userId)
      // Do not enqueue auth-js cleanup behind a half-open refresh. If that old
      // lock were released after a new password sign-in, the queued cleanup
      // could sign out the new account. Removing the shared storage key already
      // broadcasts the local sign-out to the other tabs on this device.
    },
  }), [d, offlineUser, passwordRecoveryPhase, phase, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth must be used inside AuthProvider.')
  return context
}
