/**
 * PUBLIC browser client credentials. These values ship to every Farm Rx user.
 * RLS protects the data. Secrets and service-role keys never belong here or
 * anywhere else in this repository.
 */

export type SupabaseConfig = Readonly<{
  mode: 'production' | 'local'
  projectRef: string
  url: string
  publishableKey: string
}>

export type SupabaseConfigEnvironment = Readonly<{
  VITE_LOCAL_SUPABASE_PROJECT_REF?: string
  VITE_LOCAL_SUPABASE_URL?: string
  VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY?: string
}>

const productionSupabaseConfig: SupabaseConfig = Object.freeze({
  mode: 'production',
  projectRef: 'agvsozfbstpekuqxpqjr',
  url: 'https://agvsozfbstpekuqxpqjr.supabase.co',
  publishableKey: 'sb_publishable_NonG7JNpCB3jqHwEq4xhLg_hY7fAwnM',
})

const localVariableNames = [
  'VITE_LOCAL_SUPABASE_PROJECT_REF',
  'VITE_LOCAL_SUPABASE_URL',
  'VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY',
] as const

function isLoopbackUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:'
      && (url.hostname === '127.0.0.1' || url.hostname === 'localhost')
      && url.username === ''
      && url.password === ''
      && (url.pathname === '' || url.pathname === '/')
      && url.search === ''
      && url.hash === ''
  } catch {
    return false
  }
}

function jwtRole(value: string): string | null {
  const payload = value.split('.')[1]
  if (!payload) return null
  try {
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='))
    const role = (JSON.parse(decoded) as { role?: unknown }).role
    return typeof role === 'string' ? role : null
  } catch {
    return null
  }
}

function isBrowserSafeKey(value: string): boolean {
  const normalized = value.toLowerCase()
  if (normalized.includes('service_role') || normalized.includes('service-role') || normalized.includes('secret')) return false
  if (/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(value)) return true
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value) && jwtRole(value) === 'anon'
}

function isLocalProjectRef(value: string): boolean {
  return value === value.trim()
    && /^[a-z0-9]{8,40}$/.test(value)
    && value.includes('local')
    && value !== productionSupabaseConfig.projectRef
}

/**
 * Resolve the only two browser data-service modes Farm Rx permits.
 *
 * Non-development builds intentionally ignore local variables, even malformed
 * or partial ones, and always return the immutable production configuration.
 * Development uses production by default and opts into local proof only when
 * all three local variables are present and pass the loopback/browser-key fence.
 */
export function resolveSupabaseConfig(
  isDevelopment: boolean,
  environment: SupabaseConfigEnvironment = {},
): SupabaseConfig {
  if (!isDevelopment) return productionSupabaseConfig

  const present = localVariableNames.filter((name) => environment[name] !== undefined)
  if (present.length === 0) return productionSupabaseConfig
  if (present.length !== localVariableNames.length) {
    throw new Error('Local Supabase proof requires project ref, URL, and publishable key together.')
  }

  const projectRef = environment.VITE_LOCAL_SUPABASE_PROJECT_REF!
  const url = environment.VITE_LOCAL_SUPABASE_URL!
  const publishableKey = environment.VITE_LOCAL_SUPABASE_PUBLISHABLE_KEY!

  if (!isLocalProjectRef(projectRef)) throw new Error('Local Supabase proof requires a distinct local project ref.')
  if (!isLoopbackUrl(url)) throw new Error('Local Supabase proof requires an HTTP loopback URL.')
  if (!isBrowserSafeKey(publishableKey)) throw new Error('Local Supabase proof requires a browser-safe publishable or anon key.')

  return Object.freeze({ mode: 'local', projectRef, url, publishableKey })
}

/** Re-check the runtime boundary before creating a browser client. */
export function isTrustedSupabaseConfig(config: SupabaseConfig): boolean {
  if (config.mode === 'production') {
    return config.projectRef === productionSupabaseConfig.projectRef
      && config.url === productionSupabaseConfig.url
      && config.publishableKey === productionSupabaseConfig.publishableKey
  }
  return isLocalProjectRef(config.projectRef)
    && isLoopbackUrl(config.url)
    && isBrowserSafeKey(config.publishableKey)
}

const viteEnvironment = import.meta.env

export const supabaseConfig = resolveSupabaseConfig(viteEnvironment?.DEV === true, viteEnvironment)
