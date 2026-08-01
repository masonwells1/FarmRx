import { createClient, type Session } from '@supabase/supabase-js'
import { supabaseConfig } from '../lib/supabaseConfig'

export const passwordRecoveryRoute = '/update-password'
export const passwordRecoveryOrigin = 'https://recovery.croprxsolutions.app'
export const passwordRecoveryHostname = new URL(passwordRecoveryOrigin).hostname
export const canonicalFarmRxOrigin = 'https://farm-rx.vercel.app'
export const passwordResetPublicResponse = 'If that email is in Farm Rx, we sent a password reset link. Check your inbox and spam folder.'
export const minimumPasswordLength = 12
export const passwordEmailDeliveryEnabled = import.meta.env?.VITE_PASSWORD_EMAIL_DELIVERY_ENABLED === 'true'
export const passwordRecoveryCleanupRequestKey = `farm-rx-password-recovery-cleanup:v1:${supabaseConfig.projectRef}`

const maximumPasswordRecoveryCleanupRequestAgeMs = 60 * 60 * 1000
type PasswordRecoveryCleanupRequest = { version: 1; requestId: string; email: string; sessionLineage: string | null; requestedAtMs: number }

function normalizedRecoveryEmail(email: string) {
  return email.trim().toLowerCase()
}

function recoverySessionLineage(session: Session | null): string | null {
  if (!session) return null
  try {
    const encoded = session.access_token.split('.')[1]
    if (!encoded) return null
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/')
    const payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))) as { session_id?: unknown; sub?: unknown }
    return typeof payload.session_id === 'string' && payload.session_id.length > 0 && payload.sub === session.user.id ? payload.session_id : null
  } catch { return null }
}

export function persistPasswordRecoveryCleanupRequest(storage: Storage, email: string, session: Session | null, requestId: string, nowMs: number) {
  const request = { version: 1, requestId, email: normalizedRecoveryEmail(email), sessionLineage: recoverySessionLineage(session), requestedAtMs: nowMs } satisfies PasswordRecoveryCleanupRequest
  const serialized = JSON.stringify(request)
  storage.setItem(passwordRecoveryCleanupRequestKey, serialized)
  if (storage.getItem(passwordRecoveryCleanupRequestKey) !== serialized) throw new Error('Farm Rx could not protect this password reset on this device.')
}

export function passwordRecoveryCleanupAuthority(storage: Storage, currentSession: Session | null, nowMs: number): string | null {
  try {
    const serialized = storage.getItem(passwordRecoveryCleanupRequestKey)
    const request = JSON.parse(serialized ?? 'null') as Partial<PasswordRecoveryCleanupRequest> | null
    const valid = request?.version === 1
      && typeof request.requestId === 'string' && request.requestId.length > 0
      && typeof request.email === 'string' && request.email.length > 0
      && (request.sessionLineage === null || typeof request.sessionLineage === 'string')
      && typeof request.requestedAtMs === 'number' && Number.isFinite(request.requestedAtMs)
      && request.requestedAtMs <= nowMs
      && nowMs - request.requestedAtMs <= maximumPasswordRecoveryCleanupRequestAgeMs
      && request.sessionLineage !== null
      && request.sessionLineage === recoverySessionLineage(currentSession)
      && request.email === normalizedRecoveryEmail(currentSession?.user.email ?? '')
    if (valid) return serialized
    if (storage.getItem(passwordRecoveryCleanupRequestKey) === serialized) storage.removeItem(passwordRecoveryCleanupRequestKey)
  } catch { /* unreadable storage is never cleanup authority */ }
  return null
}

export function clearPasswordRecoveryCleanupAuthority(storage: Storage, authority: string) {
  if (storage.getItem(passwordRecoveryCleanupRequestKey) === authority) storage.removeItem(passwordRecoveryCleanupRequestKey)
}

export type PasswordStrength = 'too_short' | 'okay' | 'strong'

type RecoveryLocation = Pick<Location, 'hostname' | 'origin' | 'port' | 'protocol'>
type PasswordRecoveryExitIntent = 'sign-in' | 'request-new-link' | 'completed'

export function isPasswordRecoveryHostname(hostname: string): boolean {
  return hostname === passwordRecoveryHostname || hostname === 'recovery.localhost'
}

export function passwordRecoveryExitUrl(location: RecoveryLocation, intent: PasswordRecoveryExitIntent = 'sign-in'): string {
  const base = location.hostname === passwordRecoveryHostname
    ? canonicalFarmRxOrigin
    : location.hostname === 'recovery.localhost'
      ? `${location.protocol}//127.0.0.1${location.port ? `:${location.port}` : ''}`
      : location.origin
  const target = new URL('/login', base)
  if (intent === 'request-new-link') target.searchParams.set('forgotPassword', '1')
  if (intent === 'completed') target.searchParams.set('recoveryComplete', '1')
  return target.toString()
}

export function passwordRecoveryRedirectTo(origin: string): string {
  const base = new URL(origin)
  if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new Error('Farm Rx could not create a password reset link for this site.')
  const recoveryBase = ['localhost', '127.0.0.1'].includes(base.hostname) ? base : new URL(passwordRecoveryOrigin)
  return new URL(passwordRecoveryRoute, recoveryBase).toString()
}

export async function requestPasswordResetNonEnumerating(
  email: string,
  origin: string,
  request: (targetEmail: string, options: { redirectTo: string }) => Promise<unknown>,
): Promise<string> {
  try {
    await request(email.trim(), { redirectTo: passwordRecoveryRedirectTo(origin) })
  } catch {
    // Known, unknown, provider-error, and transport-error cases deliberately
    // resolve to one public result so the form cannot reveal account state.
  }
  return passwordResetPublicResponse
}

// A recovery capability is deliberately narrower than a signed-in session.
// Supabase emits this event only after redeeming a password-recovery link.
export function isPasswordRecoveryEvent(event: string, session: Session | null, pathname: string): session is Session {
  return event === 'PASSWORD_RECOVERY' && pathname === passwordRecoveryRoute && session !== null
}

export function passwordStrength(password: string): PasswordStrength {
  if (password.length < minimumPasswordLength) return 'too_short'
  const characterGroups = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z\d]/].filter((pattern) => pattern.test(password)).length
  return characterGroups >= 3 || password.length >= 16 ? 'strong' : 'okay'
}

export function passwordValidationMessage(password: string, confirmation: string): string | null {
  if (password.length < minimumPasswordLength) return `Use at least ${minimumPasswordLength} characters.`
  if (password !== confirmation) return 'The passwords do not match.'
  return null
}

export async function updatePasswordFromRecovery(
  recoverySession: Session | null,
  password: string,
  updateUser: (attributes: { password: string }) => Promise<{ error: Error | null }>,
): Promise<void> {
  if (!recoverySession) throw new Error('This password-reset link is invalid or has expired. Request a new one from the sign-in page.')
  const { error } = await updateUser({ password })
  if (error) throw error
}

function recoveryLineage(session: Session): string | null {
  try {
    const encodedPayload = session.access_token.split('.')[1]
    if (!encodedPayload) return null
    const normalized = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const payload = JSON.parse(atob(padded)) as { session_id?: unknown; sub?: unknown }
    return typeof payload.session_id === 'string' && payload.session_id.length > 0 && payload.sub === session.user.id
      ? payload.session_id
      : null
  } catch { return null }
}

function sameRecoveryLineage(expected: Session, actual: Session | null): actual is Session {
  if (!actual || expected.user.id !== actual.user.id) return false
  const expectedLineage = recoveryLineage(expected)
  return Boolean(expectedLineage && expectedLineage === recoveryLineage(actual))
}

/** Password recovery never mutates through the app's persistent singleton.
 * This one-purpose client has no shared storage and is seeded only with the
 * captured recovery credentials that were validated by AuthProvider. */
export async function updatePasswordWithIsolatedRecoverySession(
  recoverySession: Session,
  password: string,
  createClientImpl: typeof createClient = createClient,
): Promise<void> {
  const isolated = createClientImpl(supabaseConfig.url, supabaseConfig.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  const { data, error } = await isolated.auth.setSession({
    access_token: recoverySession.access_token,
    refresh_token: recoverySession.refresh_token,
  })
  if (error || !sameRecoveryLineage(recoverySession, data.session)) {
    throw new Error('This password-reset link no longer matches the verified recovery session. Request a new link and try again.')
  }
  await updatePasswordFromRecovery(recoverySession, password, isolated.auth.updateUser.bind(isolated.auth))
}
