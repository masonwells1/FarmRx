import { readFileSync } from 'node:fs'
import * as React from 'react'
import { act, createElement } from 'react'
import { Window } from 'happy-dom'
import type { Session } from '@supabase/supabase-js'
import type { AuthProviderDependencies } from './AuthProvider'
import { createAuthSessionStorage } from './authSessionStorage'
import {
  isPasswordRecoveryEvent,
  minimumPasswordLength,
  passwordRecoveryRedirectTo,
  passwordResetPublicResponse,
  requestPasswordResetNonEnumerating,
  passwordStrength,
  passwordValidationMessage,
  updatePasswordFromRecovery,
  updatePasswordWithIsolatedRecoverySession,
} from './passwordRecovery'
import { createSubmitLock } from '../lib/submitLock'

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

const recoveryPayload = btoa(JSON.stringify({ sub: 'recovery-user', session_id: 'recovery-session-lineage' })).replaceAll('=', '')
const recoverySession = { access_token: `header.${recoveryPayload}.signature`, refresh_token: 'recovery-refresh-token', user: { id: 'recovery-user' } } as unknown as Session
const otherPayload = btoa(JSON.stringify({ sub: 'other-user', session_id: 'other-session-lineage' })).replaceAll('=', '')
const otherSession = { access_token: `header.${otherPayload}.signature`, refresh_token: 'other-refresh-token', user: { id: 'other-user' } } as unknown as Session
function acceptsRecoveryEvent(event: string, session: Session | null, pathname: string): boolean { return isPasswordRecoveryEvent(event, session, pathname) }

// Known, unknown/provider-error, and thrown/network-error cases must leave
// exactly the same public trace and exact same-origin redirect contract.
const resetCalls: Array<{ email: string; redirectTo: string }> = []
const resetOutcomes = await Promise.all([
  requestPasswordResetNonEnumerating(' known@example.test ', 'https://farm-rx.vercel.app', async (email, options) => { resetCalls.push({ email, redirectTo: options.redirectTo }); return { error: null } }),
  requestPasswordResetNonEnumerating('unknown@example.test', 'https://farm-rx.vercel.app', async (email, options) => { resetCalls.push({ email, redirectTo: options.redirectTo }); return { error: new Error('user not found') } }),
  requestPasswordResetNonEnumerating('network@example.test', 'https://farm-rx.vercel.app', async (email, options) => { resetCalls.push({ email, redirectTo: options.redirectTo }); throw new TypeError('network unavailable') }),
])
assert(resetOutcomes.every((outcome) => outcome === passwordResetPublicResponse), 'Password reset outcomes exposed account or delivery state.')
assert(resetCalls.length === 3 && resetCalls[0]?.email === 'known@example.test' && resetCalls.every((call) => call.redirectTo === 'https://farm-rx.vercel.app/update-password'), 'Password reset requests did not use one trimmed-email and exact same-origin redirect contract.')
assert(passwordRecoveryRedirectTo('https://farm-rx.vercel.app') === 'https://farm-rx.vercel.app/update-password', 'Password reset redirect was not the exact public update-password route.')
assert(passwordRecoveryRedirectTo('http://localhost:5173') === 'http://localhost:5173/update-password', 'Local password reset redirect was malformed.')
assert(acceptsRecoveryEvent('PASSWORD_RECOVERY', recoverySession, '/update-password'), 'A valid password recovery event was not accepted.')
assert(!acceptsRecoveryEvent('SIGNED_IN', recoverySession, '/update-password'), 'An ordinary signed-in event enabled password recovery.')
assert(!acceptsRecoveryEvent('PASSWORD_RECOVERY', recoverySession, '/fields'), 'A recovery event outside the public update route was accepted.')
assert(!acceptsRecoveryEvent('PASSWORD_RECOVERY', null, '/update-password'), 'A missing or expired recovery session was accepted.')

assert(passwordValidationMessage('short', 'short') === `Use at least ${minimumPasswordLength} characters.`, 'Short passwords were accepted.')
assert(passwordValidationMessage('a secure passphrase', 'different passphrase') === 'The passwords do not match.', 'Password mismatch was accepted.')
assert(passwordValidationMessage('a secure passphrase', 'a secure passphrase') === null, 'A valid password was rejected.')
assert(passwordStrength('a secure passphrase') === 'strong', 'Password strength feedback did not recognize a long passphrase.')

let updatedPassword: string | null = null
await updatePasswordFromRecovery(recoverySession, 'a secure passphrase', async ({ password }) => { updatedPassword = password; return { error: null } })
assert(updatedPassword === 'a secure passphrase', 'A valid recovery session did not update the password.')
let noRecoveryRejected = false
try { await updatePasswordFromRecovery(null, 'a secure passphrase', async () => ({ error: null })) } catch { noRecoveryRejected = true }
assert(noRecoveryRejected, 'A missing or expired recovery session could update a password.')

let isolatedOptions: { auth?: { persistSession?: boolean; autoRefreshToken?: boolean; detectSessionInUrl?: boolean } } | null = null
let isolatedSetSession: { access_token: string; refresh_token: string } | null = null
let isolatedUpdates = 0
await updatePasswordWithIsolatedRecoverySession(recoverySession, 'an isolated secure passphrase', ((_url: string, _key: string, options: typeof isolatedOptions) => {
  isolatedOptions = options
  return { auth: {
    async setSession(input: typeof isolatedSetSession) { isolatedSetSession = input; return { data: { session: recoverySession }, error: null } },
    async updateUser() { isolatedUpdates += 1; return { data: { user: recoverySession.user }, error: null } },
  } }
}) as never)
const capturedIsolatedOptions = isolatedOptions as { auth?: { persistSession?: boolean; autoRefreshToken?: boolean; detectSessionInUrl?: boolean } } | null
assert(capturedIsolatedOptions?.auth?.persistSession === false && capturedIsolatedOptions.auth.autoRefreshToken === false && capturedIsolatedOptions.auth.detectSessionInUrl === false, 'Recovery mutation client was not isolated from persistent/shared Auth state.')
const capturedSetSession = isolatedSetSession as { access_token: string; refresh_token: string } | null
assert(capturedSetSession?.access_token === recoverySession.access_token && capturedSetSession?.refresh_token === recoverySession.refresh_token && isolatedUpdates === 1, 'Isolated recovery mutation was not bound to the captured recovery credentials.')

const lock = createSubmitLock()
assert(lock.acquire() && !lock.acquire(), 'Password update double-submit was not blocked.')
lock.release()
assert(lock.acquire(), 'Password update lock did not release after a completed update.')

const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
const tokens = readFileSync(new URL('../styles/tokens.css', import.meta.url), 'utf8')
const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8')
assert(/name="email"[\s\S]*?required/.test(app) && /name="password"[\s\S]*?required/.test(app), 'Sign-in fields are missing native required validation.')
assert(tokens.includes('--on-dark-accent: #BCEFCF;') && css.includes('.slogan {') && css.includes('color: var(--on-dark-accent)'), 'Login slogan does not use the accessible on-dark brand token.')
assert(app.includes('keep this page open until your password is updated') && app.includes('Request a fresh link or contact your Crop RX representative'), 'The recovery UI does not explain fail-closed refresh behavior and the support path.')

// Exercise the provider, not just its helpers: auth-js persists recovery
// sessions before PASSWORD_RECOVERY. A recovery marker must therefore block a
// route change/reload from adopting that session as ordinary app access.
// Import the production module before installing browser globals. Otherwise
// the module-level Supabase client opens a real Node BroadcastChannel that is
// unrelated to the injected auth fixture and keeps the regression alive.
const { AuthProvider, useAuth } = await import('./AuthProvider')
const { supabaseConfig } = await import('../lib/supabaseConfig')
const authWindow = new Window({ url: 'http://recovery.test/update-password' })
const globalNames = ['window', 'document', 'navigator', 'location', 'localStorage', 'sessionStorage', 'Node', 'Element', 'HTMLElement', 'HTMLButtonElement', 'Event', 'MutationObserver'] as const
const previousGlobals = new Map<string, PropertyDescriptor | undefined>()
for (const name of globalNames) {
  previousGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: (authWindow as unknown as Record<string, unknown>)[name] })
}
const previousActEnvironment = Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', { configurable: true, writable: true, value: true })
const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React')
Object.defineProperty(globalThis, 'React', { configurable: true, writable: true, value: React })
try {
  const { createRoot } = await import('react-dom/client')
  type ProbeAuth = { phase: string; user: { id: string } | null; passwordRecoveryPhase: string; signIn(email: string, password: string): Promise<void>; updatePassword(password: string): Promise<void>; cancelPasswordRecovery(): Promise<void> }
  const current = { value: null as ProbeAuth | null }
  let authEvent: ((event: string, session: typeof recoverySession | null) => void) | null = null
  let updateCalls = 0
  let signInCalls = 0
  let ambientUpdateCalls = 0
  const isolatedCapturedUsers: string[] = []
  let updateFailuresRemaining = 0
  let failAfterUpdateCall: number | null = null
  let injectNewerAcceptedOnCoordinationFailure = false
  let newerAcceptedInjected = false
  let injectedNewerSessionBytes: string | null = null
  let injectedNewerIntentBytes: string | null = null
  const authSessionKey = `farm-rx-auth:${supabaseConfig.projectRef}`
  const authIntentKey = `farm-rx-auth-intent:v1:${supabaseConfig.projectRef}`
  const recoveryFenceKey = `farm-rx-password-recovery:v2:${supabaseConfig.projectRef}`
  const productionAuthStorage = createAuthSessionStorage(authWindow.localStorage, supabaseConfig.projectRef)
  let transactionTail = Promise.resolve()
  const coordinateAuthState = async <T,>(task: (verify: () => void) => Promise<T>) => {
    const previous = transactionTail
    let release: () => void = () => undefined
    transactionTail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await task(() => {
        if (failAfterUpdateCall !== null && updateCalls >= failAfterUpdateCall) {
          if (injectNewerAcceptedOnCoordinationFailure && !newerAcceptedInjected) {
            newerAcceptedInjected = true
            injectedNewerSessionBytes = JSON.stringify(otherSession)
            injectedNewerIntentBytes = JSON.stringify({ version: 1, nonce: 'newer-accepted-after-recovery', phase: 'accepted', userId: otherSession.user.id, sessionLineage: 'other-session-lineage', startedAtMs: Date.now() })
            authWindow.localStorage.setItem(authSessionKey, injectedNewerSessionBytes)
            authWindow.localStorage.setItem(authIntentKey, injectedNewerIntentBytes)
          }
          throw new Error('simulated coordination loss after server update')
        }
      })
    } finally { release() }
  }
  const client = {
    // Production auth-js reloads through createAuthSessionStorage, which
    // deliberately exposes no raw recovery session to getSession().
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: (listener: unknown) => { authEvent = listener as typeof authEvent; return { data: { subscription: { unsubscribe: () => { authEvent = null } } } } },
    signInWithPassword: async () => { signInCalls += 1; return { data: { session: otherSession }, error: null } },
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    updateUser: async () => { ambientUpdateCalls += 1; return { data: { user: otherSession.user }, error: null } },
  }
  const updateRecoveryPassword: AuthProviderDependencies['updateRecoveryPassword'] = async (capturedSession, _password) => {
      isolatedCapturedUsers.push(capturedSession.user.id)
      updateCalls += 1
      if (updateFailuresRemaining > 0) { updateFailuresRemaining -= 1; throw new Error('temporary provider error') }
  }
  const dependencies = {
    auth: client,
    updateRecoveryPassword,
    storage: authWindow.localStorage,
    addStorageListener: (listener: (event: StorageEvent) => void) => authWindow.addEventListener('storage', listener as never),
    removeStorageListener: (listener: (event: StorageEvent) => void) => authWindow.removeEventListener('storage', listener as never),
    clearFarmAccess: async () => undefined,
    restoreOfflineFarmUserId: () => null,
    intentionalSignOut: { get: () => false, set: () => undefined },
    now: () => Date.now(),
    createId: () => 'recovery-regression-intent',
    coordinateAuthState,
  } as unknown as AuthProviderDependencies
  function currentAuth() { if (!current.value) throw new Error('The recovery auth probe did not render.'); return current.value }
  function Probe() { current.value = useAuth() as ProbeAuth; const auth = currentAuth(); return createElement('div', null, `${auth.phase}:${auth.passwordRecoveryPhase}`) }
  const container = authWindow.document.createElement('div'); authWindow.document.body.append(container)
  const renderProvider = async () => {
    const root = createRoot(container as unknown as HTMLElement)
    await act(async () => { root.render(createElement(AuthProvider, { dependencies, children: createElement(Probe) })); await Promise.resolve() })
    return root
  }
  const beginRecovery = async (listener: typeof authEvent = authEvent) => {
    // Exercise auth-js's production storage boundary: its pre-event save is
    // suppressed, while the event's credentials remain usable in this mount.
    productionAuthStorage.setItem(authSessionKey, JSON.stringify(recoverySession))
    assert(authWindow.localStorage.getItem(authSessionKey) === null, 'The production Auth adapter persisted a reusable raw recovery credential.')
    await act(async () => { listener?.('PASSWORD_RECOVERY', recoverySession); await Promise.resolve() })
  }
  let root = await renderProvider()
  await beginRecovery()
  assert(currentAuth().passwordRecoveryPhase === 'ready', 'The provider did not accept its valid PASSWORD_RECOVERY event.')
  await act(async () => { root.unmount() })
  root = await renderProvider()
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  assert(currentAuth().phase === 'signed_out' && currentAuth().passwordRecoveryPhase === 'invalid' && authWindow.localStorage.getItem(recoveryFenceKey) === null && authWindow.localStorage.getItem(authSessionKey) === null, `Reloading update-password did not fail closed without this mount's recovery event (${currentAuth().phase}:${currentAuth().passwordRecoveryPhase}:${authWindow.localStorage.getItem(recoveryFenceKey) ? 'fence' : 'no-fence'}:${authWindow.localStorage.getItem(authSessionKey) ? 'session' : 'no-session'}).`)

  await beginRecovery()
  assert(currentAuth().passwordRecoveryPhase === 'ready', 'A fresh recovery event could not begin after fail-closed reload cleanup.')
  await act(async () => { await currentAuth().cancelPasswordRecovery(); await Promise.resolve() })
  assert(currentAuth().phase === 'signed_out' && currentAuth().passwordRecoveryPhase === 'idle' && authWindow.localStorage.getItem(recoveryFenceKey) === null && authWindow.localStorage.getItem(authSessionKey) === null, 'Cancelling recovery did not revoke the in-memory capability and persisted fence.')
  await beginRecovery()
  assert(currentAuth().passwordRecoveryPhase === 'ready', 'A fresh recovery event could not begin after explicit cancellation.')

  authWindow.history.pushState({}, '', '/fields')
  await act(async () => {
    authWindow.dispatchEvent(new authWindow.PopStateEvent('popstate'))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  assert(currentAuth().phase === 'signed_out' && currentAuth().passwordRecoveryPhase === 'invalid' && authWindow.localStorage.getItem(recoveryFenceKey) === null && authWindow.localStorage.getItem(authSessionKey) === null, 'Mounted SPA navigation away from update-password kept a reusable recovery capability.')
  authWindow.history.pushState({}, '', '/update-password')
  await beginRecovery()
  assert(currentAuth().passwordRecoveryPhase === 'ready', 'A fresh recovery event could not begin after mounted route-escape cleanup.')

  await act(async () => { root.unmount() })
  authWindow.history.pushState({}, '', '/fields')
  root = await renderProvider()
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)) })
  assert(currentAuth().phase === 'signed_out' && currentAuth().user === null && authWindow.localStorage.getItem(authSessionKey) === null && authWindow.localStorage.getItem(recoveryFenceKey) === null, `Reloading away from update-password allowed a persisted recovery session to become an ordinary app session (${currentAuth().phase}:${currentAuth().user?.id ?? 'none'}:${authWindow.localStorage.getItem(authSessionKey) ? 'stored' : 'cleared'}).`)

  await act(async () => { root.unmount() })
  authWindow.history.pushState({}, '', '/update-password')
  root = await renderProvider()
  await beginRecovery()
  assert(currentAuth().passwordRecoveryPhase === 'ready', 'The provider could not begin the second recovery test.')

  let recoverySignInRejected = false
  await act(async () => {
    try { await currentAuth().signIn('other@example.test', 'another secure passphrase') }
    catch { recoverySignInRejected = true }
    await Promise.resolve()
  })
  assert(recoverySignInRejected && signInCalls === 0, 'A same-tab recovery session invoked sign-in for another account.')
  assert(currentAuth().passwordRecoveryPhase === 'ready' && authWindow.localStorage.getItem(recoveryFenceKey) !== null, 'Blocking another-account sign-in destroyed the valid recovery capability.')

  await act(async () => { authEvent?.('SIGNED_IN', otherSession); await Promise.resolve() })
  assert(updateCalls === 0 && currentAuth().passwordRecoveryPhase === 'invalid' && currentAuth().phase === 'signed_out' && currentAuth().user === null, 'An ambient signed-in event became app access or preserved a stale recovery capability.')
  assert(authWindow.localStorage.getItem(authSessionKey) === null && authWindow.localStorage.getItem(recoveryFenceKey) === null, 'Rejecting an ambient signed-in event left reusable recovery state.')

  await beginRecovery()
  assert(currentAuth().passwordRecoveryPhase === 'ready', 'A fresh recovery event did not restore the form after the mismatched session was rejected.')

  updateFailuresRemaining = 1
  let retryableUpdateRejected = false
  await act(async () => {
    try { await currentAuth().updatePassword('a secure passphrase') }
    catch { retryableUpdateRejected = true }
    await Promise.resolve()
  })
  assert(retryableUpdateRejected && Number(updateCalls) === 1, 'A provider-declared password update failure was not surfaced.')
  assert(currentAuth().passwordRecoveryPhase === 'ready' && authWindow.localStorage.getItem(recoveryFenceKey) !== null, 'A confirmed pre-save failure consumed the valid recovery capability instead of allowing retry.')
  await act(async () => { await currentAuth().updatePassword('a secure passphrase'); await Promise.resolve() })
  assert(Number(updateCalls) === 2 && currentAuth().passwordRecoveryPhase === 'complete' && currentAuth().phase === 'signed_out', 'A successful password update did not complete in a signed-out state.')
  assert(isolatedCapturedUsers.at(-1) === recoverySession.user.id && ambientUpdateCalls === 0, 'Password recovery used the ambient singleton instead of the captured recovery account.')
  await act(async () => { authEvent?.('TOKEN_REFRESHED', recoverySession); authEvent?.('USER_UPDATED', recoverySession); await new Promise((resolve) => setTimeout(resolve, 0)) })
  assert(currentAuth().phase === 'signed_out' && currentAuth().user === null && currentAuth().passwordRecoveryPhase === 'complete', 'A later refresh/update event resurrected a completed recovery session.')
  await act(async () => { root.unmount() })

  authWindow.history.pushState({}, '', '/update-password')
  root = await renderProvider()
  await beginRecovery()
  assert(currentAuth().passwordRecoveryPhase === 'ready', 'The provider could not begin the cleanup-failure recovery test.')
  const cleanupFailureFence = JSON.parse(authWindow.localStorage.getItem(recoveryFenceKey) ?? 'null') as { ownerId?: string } | null
  assert(cleanupFailureFence?.ownerId, 'The cleanup-failure fixture did not capture the recovery owner.')
  injectNewerAcceptedOnCoordinationFailure = true
  failAfterUpdateCall = updateCalls + 1
  await act(async () => { await currentAuth().updatePassword('a different secure passphrase'); await Promise.resolve() })
  assert(Number(updateCalls) === 3, 'A successful server update was lost during local cleanup failure.')
  assert(currentAuth().phase === 'signed_out' && currentAuth().user === null && currentAuth().passwordRecoveryPhase === 'complete_with_warning', 'A post-save cleanup failure was presented as a retryable password failure.')
  assert(newerAcceptedInjected && authWindow.localStorage.getItem(authSessionKey) === injectedNewerSessionBytes && authWindow.localStorage.getItem(authIntentKey) === injectedNewerIntentBytes, 'Post-save fallback cleanup overwrote a newer accepted session outside the coordinator.')
  assert(authWindow.localStorage.getItem(`${recoveryFenceKey}:owner:${cleanupFailureFence!.ownerId}`) === null, 'Post-save coordination failure left the exact recovery owner lease active.')
  await act(async () => { authEvent?.('TOKEN_REFRESHED', recoverySession); authEvent?.('USER_UPDATED', recoverySession); await new Promise((resolve) => setTimeout(resolve, 0)) })
  assert(currentAuth().phase === 'signed_out' && currentAuth().passwordRecoveryPhase === 'complete_with_warning', 'A refresh event resurrected a recovery session after cleanup warning.')
  await act(async () => { root.unmount() })

  // auth-js broadcasts PASSWORD_RECOVERY without source metadata. A recovery
  // tab may claim the capability, but an ordinary signed-in tab must ignore
  // the same event without clearing the owner's fence or adopting its user.
  authWindow.localStorage.clear()
  transactionTail = Promise.resolve()
  failAfterUpdateCall = null
  injectNewerAcceptedOnCoordinationFailure = false
  authWindow.localStorage.setItem(authSessionKey, JSON.stringify(otherSession))
  authWindow.localStorage.setItem(authIntentKey, JSON.stringify({ version: 1, nonce: 'ordinary-tab-session', phase: 'accepted', userId: otherSession.user.id, sessionLineage: 'other-session-lineage', startedAtMs: Date.now() }))
  let ownerEvent: ((event: string, session: typeof recoverySession | null) => void) | null = null
  let ordinaryEvent: ((event: string, session: typeof recoverySession | null) => void) | null = null
  let ownerPageHide: ((event?: PageTransitionEvent) => void) | null = null
  let ownerPageShow: ((event: PageTransitionEvent) => void) | null = null
  let crossRouteUpdates = 0
  let crossRouteId = 0
  const crossRouteDependencies = (route: '/update-password' | '/login', capture: (listener: typeof ownerEvent) => void, getSession: typeof recoverySession | typeof otherSession | null, capturePageHide?: (listener: ((event?: PageTransitionEvent) => void) | null) => void, capturePageShow?: (listener: ((event: PageTransitionEvent) => void) | null) => void) => ({
    ...dependencies,
    auth: {
      getSession: async () => ({ data: { session: getSession }, error: null }),
      onAuthStateChange: (listener: unknown) => { capture(listener as typeof ownerEvent); return { data: { subscription: { unsubscribe: () => capture(null) } } } },
      signInWithPassword: async () => ({ data: { session: otherSession }, error: null }),
      resetPasswordForEmail: async () => ({ data: {}, error: null }),
    },
    pathname: () => route,
    createId: () => `cross-route-${route}-${++crossRouteId}`,
    addPageHideListener: (listener: (event?: PageTransitionEvent) => void) => capturePageHide?.(listener),
    removePageHideListener: () => capturePageHide?.(null),
    addPageShowListener: (listener: (event: PageTransitionEvent) => void) => capturePageShow?.(listener),
    removePageShowListener: () => capturePageShow?.(null),
    updateRecoveryPassword: async (captured: typeof recoverySession) => {
      assert(route === '/update-password' && captured.user.id === recoverySession.user.id, 'The ordinary tab adopted or invoked the recovery capability.')
      crossRouteUpdates += 1
    },
  }) as unknown as AuthProviderDependencies
  const ownerState = { value: null as ProbeAuth | null }
  const ordinaryState = { value: null as ProbeAuth | null }
  function OwnerProbe() { ownerState.value = useAuth() as ProbeAuth; return createElement('div', null, `${ownerState.value.phase}:${ownerState.value.passwordRecoveryPhase}`) }
  function OrdinaryProbe() { ordinaryState.value = useAuth() as ProbeAuth; return createElement('div', null, `${ordinaryState.value.phase}:${ordinaryState.value.user?.id ?? 'none'}:${ordinaryState.value.passwordRecoveryPhase}`) }
  const ownerContainer = authWindow.document.createElement('div')
  const ordinaryContainer = authWindow.document.createElement('div')
  authWindow.document.body.append(ownerContainer, ordinaryContainer)
  const ownerRoot = createRoot(ownerContainer as unknown as HTMLElement)
  const ordinaryRoot = createRoot(ordinaryContainer as unknown as HTMLElement)
  await act(async () => {
    ownerRoot.render(createElement(AuthProvider, { dependencies: crossRouteDependencies('/update-password', (listener) => { ownerEvent = listener }, null, (listener) => { ownerPageHide = listener }), children: createElement(OwnerProbe) }))
    ordinaryRoot.render(createElement(AuthProvider, { dependencies: crossRouteDependencies('/login', (listener) => { ordinaryEvent = listener }, otherSession), children: createElement(OrdinaryProbe) }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await act(async () => {
    ownerEvent?.('PASSWORD_RECOVERY', recoverySession)
    ordinaryEvent?.('PASSWORD_RECOVERY', recoverySession)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  assert(ownerState.value?.passwordRecoveryPhase === 'ready', 'The recovery owner lost readiness after the ordinary tab received the broadcast.')
  assert(ordinaryState.value?.phase === 'signed_in' && ordinaryState.value.user?.id === otherSession.user.id && ordinaryState.value.passwordRecoveryPhase === 'idle', 'The ordinary tab adopted recovery or lost its legitimate session.')
  assert(authWindow.localStorage.getItem(recoveryFenceKey) !== null, 'The ordinary broadcast recipient cleared the recovery owner fence.')
  await act(async () => { ordinaryRoot.unmount(); await Promise.resolve() })
  assert(ownerState.value?.passwordRecoveryPhase === 'ready' && authWindow.localStorage.getItem(recoveryFenceKey) !== null, 'Closing the non-owner ordinary tab revoked the recovery owner lease.')
  await act(async () => { await ownerState.value!.updatePassword('owner-only secure passphrase'); await Promise.resolve() })
  assert(crossRouteUpdates === 1 && String(ownerState.value?.passwordRecoveryPhase) === 'complete', 'The recovery owner did not complete exactly one isolated password mutation.')
  await act(async () => { ownerRoot.unmount() })

  // A normal page close synchronously drops only the exact owner's lease. The
  // inert shared index cannot block the next sign-in and is pruned under the
  // normal coordinated sign-in transaction.
  authWindow.localStorage.clear()
  transactionTail = Promise.resolve()
  ownerEvent = null
  ownerPageHide = null
  ownerPageShow = null
  crossRouteUpdates = 0
  const closingState = { value: null as ProbeAuth | null }
  function ClosingProbe() { closingState.value = useAuth() as ProbeAuth; return createElement('div', null, closingState.value.passwordRecoveryPhase) }
  const closingContainer = authWindow.document.createElement('div'); authWindow.document.body.append(closingContainer)
  const closingRoot = createRoot(closingContainer as unknown as HTMLElement)
  await act(async () => {
    closingRoot.render(createElement(AuthProvider, { dependencies: crossRouteDependencies('/update-password', (listener) => { ownerEvent = listener }, null, (listener) => { ownerPageHide = listener }, (listener) => { ownerPageShow = listener }), children: createElement(ClosingProbe) }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await act(async () => {
    ownerEvent?.('PASSWORD_RECOVERY', recoverySession)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  const closingFence = JSON.parse(authWindow.localStorage.getItem(recoveryFenceKey) ?? 'null') as { ownerId?: string } | null
  assert(closingState.value?.passwordRecoveryPhase === 'ready' && closingFence?.ownerId, 'The page-close fixture did not establish an owned recovery lease.')
  const closingOwnerLeaseKey = `${recoveryFenceKey}:owner:${closingFence!.ownerId}`
  await act(async () => { ownerPageShow?.({ persisted: false } as PageTransitionEvent); await Promise.resolve() })
  assert(closingState.value?.passwordRecoveryPhase === 'ready' && authWindow.localStorage.getItem(closingOwnerLeaseKey) !== null, 'A normal non-persisted pageshow disrupted an active recovery capability.')
  await act(async () => { ownerPageHide?.({ persisted: true } as PageTransitionEvent); await Promise.resolve() })
  assert(authWindow.localStorage.getItem(closingOwnerLeaseKey) === null, 'Pagehide did not revoke the exact recovery-owner lease.')
  await act(async () => { ownerPageShow?.({ persisted: true } as PageTransitionEvent); await Promise.resolve() })
  assert(closingState.value?.phase === 'signed_out' && String(closingState.value.passwordRecoveryPhase) === 'invalid', 'A persisted pageshow revived a recovery page after its owner lease was revoked.')
  let restoredSubmitRejected = false
  await act(async () => {
    try { await closingState.value!.updatePassword('must never reach the isolated updater') } catch { restoredSubmitRejected = true }
    await Promise.resolve()
  })
  assert(restoredSubmitRejected && crossRouteUpdates === 0, 'A back/forward-cache restore mutated a password after recovery ownership was revoked.')
  await act(async () => { closingRoot.unmount() })

  // A hard crash may leave both bytes. The bounded timestamp makes them
  // inactive, and sign-in removes only that stale tuple before proceeding.
  const staleOwnerId = 'crashed-recovery-owner'
  const staleFence = { version: 2, ownerId: staleOwnerId, userId: recoverySession.user.id, sessionLineage: 'recovery-session-lineage', createdAtMs: Date.now() - (11 * 60 * 1000) }
  const staleBytes = JSON.stringify(staleFence)
  authWindow.localStorage.setItem(recoveryFenceKey, staleBytes)
  authWindow.localStorage.setItem(`${recoveryFenceKey}:owner:${staleOwnerId}`, staleBytes)
  let staleEvent: ((event: string, session: typeof recoverySession | null) => void) | null = null
  const staleState = { value: null as ProbeAuth | null }
  function StaleProbe() { staleState.value = useAuth() as ProbeAuth; return createElement('div', null, `${staleState.value.phase}:${staleState.value.user?.id ?? 'none'}`) }
  const staleContainer = authWindow.document.createElement('div'); authWindow.document.body.append(staleContainer)
  const staleRoot = createRoot(staleContainer as unknown as HTMLElement)
  await act(async () => {
    staleRoot.render(createElement(AuthProvider, { dependencies: crossRouteDependencies('/login', (listener) => { staleEvent = listener }, null), children: createElement(StaleProbe) }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await act(async () => { await staleState.value!.signIn('farmer@example.test', 'a secure passphrase'); await Promise.resolve() })
  assert(staleState.value?.phase === 'signed_in' && staleState.value.user?.id === otherSession.user.id, 'A stale crashed recovery fence blocked a legitimate sign-in.')
  assert(authWindow.localStorage.getItem(recoveryFenceKey) === null && authWindow.localStorage.getItem(`${recoveryFenceKey}:owner:${staleOwnerId}`) === null, 'Sign-in did not prune the exact stale recovery tuple.')
  void staleEvent
  await act(async () => { staleRoot.unmount() })

  // Two tabs may submit the same recovery capability at nearly the same time.
  // The shared transaction must let exactly one reach updateUser; after the
  // winner consumes the fence, the loser must become invalid rather than sit
  // on a permanently failing ready form.
  failAfterUpdateCall = null
  authWindow.localStorage.clear()
  productionAuthStorage.setItem(authSessionKey, JSON.stringify(recoverySession))
  assert(authWindow.localStorage.getItem(authSessionKey) === null, 'The production Auth adapter persisted the competing recovery credential.')
  transactionTail = Promise.resolve()
  let competingUpdateCalls = 0
  let authEventA: ((event: string, session: typeof recoverySession | null) => void) | null = null
  let authEventB: ((event: string, session: typeof recoverySession | null) => void) | null = null
  const competingClient = (capture: (listener: typeof authEventA) => void) => ({
    getSession: async () => ({ data: { session: null }, error: null }),
    onAuthStateChange: (listener: unknown) => { capture(listener as typeof authEventA); return { data: { subscription: { unsubscribe: () => capture(null) } } } },
    signInWithPassword: async () => ({ data: { session: otherSession }, error: null }),
    resetPasswordForEmail: async () => ({ data: {}, error: null }),
    updateUser: async () => { competingUpdateCalls += 1; await Promise.resolve(); return { data: { user: null }, error: null } },
  })
  const competingDependencies = (auth: ReturnType<typeof competingClient>, id: string) => ({
    ...dependencies,
    auth,
    createId: () => id,
    coordinateAuthState,
    updateRecoveryPassword: async () => { competingUpdateCalls += 1; await Promise.resolve() },
  }) as unknown as AuthProviderDependencies
  const currentA = { value: null as ProbeAuth | null }
  const currentB = { value: null as ProbeAuth | null }
  function ProbeA() { currentA.value = useAuth() as ProbeAuth; return createElement('div', null, currentA.value.passwordRecoveryPhase) }
  function ProbeB() { currentB.value = useAuth() as ProbeAuth; return createElement('div', null, currentB.value.passwordRecoveryPhase) }
  const containerA = authWindow.document.createElement('div')
  const containerB = authWindow.document.createElement('div')
  authWindow.document.body.append(containerA, containerB)
  const rootA = createRoot(containerA as unknown as HTMLElement)
  const rootB = createRoot(containerB as unknown as HTMLElement)
  await act(async () => {
    rootA.render(createElement(AuthProvider, { dependencies: competingDependencies(competingClient((listener) => { authEventA = listener }), 'recovery-tab-a'), children: createElement(ProbeA) }))
    rootB.render(createElement(AuthProvider, { dependencies: competingDependencies(competingClient((listener) => { authEventB = listener }), 'recovery-tab-b'), children: createElement(ProbeB) }))
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  await act(async () => {
    authEventA?.('PASSWORD_RECOVERY', recoverySession)
    authEventB?.('PASSWORD_RECOVERY', recoverySession)
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  assert(currentA.value?.passwordRecoveryPhase === 'ready' && String(currentB.value?.passwordRecoveryPhase) === 'invalid', 'A foreign-owner recovery tab exposed a ready password form.')
  let competingResults: PromiseSettledResult<void>[] = []
  await act(async () => {
    competingResults = await Promise.allSettled([
      currentA.value!.updatePassword('one secure passphrase'),
      currentB.value!.updatePassword('two secure passphrase'),
    ])
    await Promise.resolve()
  })
  assert(competingUpdateCalls === 1, `Competing recovery tabs invoked updateUser ${competingUpdateCalls} times instead of once.`)
  assert(competingResults.filter((result) => result.status === 'fulfilled').length === 1 && competingResults.filter((result) => result.status === 'rejected').length === 1, 'Competing recovery tabs did not produce one winner and one loser.')
  const phases = [currentA.value?.passwordRecoveryPhase, currentB.value?.passwordRecoveryPhase]
  assert(phases.includes('complete') && phases.includes('invalid'), `Competing recovery tabs did not finish complete/invalid (${phases.join('/')}).`)
  const loser = String(currentA.value?.passwordRecoveryPhase) === 'invalid' ? currentA.value : currentB.value
  assert(loser?.phase === 'signed_out' && loser.user === null, 'The losing recovery tab remained signed in or retryable after the shared fence was consumed.')
  assert(authWindow.localStorage.getItem(recoveryFenceKey) === null, 'The winning recovery tab left the shared recovery fence reusable.')
  await act(async () => { rootA.unmount(); rootB.unmount() })
} finally {
  for (const name of globalNames) {
    const prior = previousGlobals.get(name)
    if (prior) Object.defineProperty(globalThis, name, prior)
    else delete (globalThis as Record<string, unknown>)[name]
  }
  if (previousActEnvironment) Object.defineProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT', previousActEnvironment)
  else delete (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT
  if (previousReact) Object.defineProperty(globalThis, 'React', previousReact)
  else delete (globalThis as Record<string, unknown>).React
  await authWindow.happyDOM.close()
}

console.log('password recovery regressions passed')
