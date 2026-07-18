import { createClient, type Session } from '@supabase/supabase-js'
import { supabaseConfig } from '../lib/supabaseConfig'

export const passwordRecoveryRoute = '/update-password'
export const passwordResetPublicResponse = 'If that email is in Farm Rx, we sent a password reset link. Check your inbox and spam folder.'
export const minimumPasswordLength = 12
export const passwordEmailDeliveryEnabled = import.meta.env?.VITE_PASSWORD_EMAIL_DELIVERY_ENABLED === 'true'

export type PasswordStrength = 'too_short' | 'okay' | 'strong'

export function passwordRecoveryRedirectTo(origin: string): string {
  const base = new URL(origin)
  if (base.protocol !== 'https:' && base.protocol !== 'http:') throw new Error('Farm Rx could not create a password reset link for this site.')
  return new URL(passwordRecoveryRoute, base).toString()
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
