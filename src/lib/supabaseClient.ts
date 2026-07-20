import { createClient } from '@supabase/supabase-js'
import { createAuthSessionStorage } from '../auth/authSessionStorage'
import { farmAccessEpochRequestHeader } from '../auth/farmAccessEpoch'
import { isTrustedSupabaseConfig, supabaseConfig } from './supabaseConfig'

function jwtSubject(authorization: string | null): string | null {
  const token = authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1]
  if (!token) return null
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const decoded = atob(payload.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payload.length / 4) * 4, '='))
    const subject = (JSON.parse(decoded) as { sub?: unknown }).sub
    return typeof subject === 'string' ? subject : null
  } catch { return null }
}

if (!isTrustedSupabaseConfig(supabaseConfig)) {
  throw new Error('Farm Rx is not connected to its expected data service.')
}

const authStorage = typeof localStorage === 'undefined'
  ? undefined
  : createAuthSessionStorage(localStorage, supabaseConfig.projectRef)

const client = createClient(
  supabaseConfig.url,
  supabaseConfig.publishableKey,
  {
    global: {
      fetch: (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input))
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
        if ((url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/storage/v1/')) && typeof localStorage !== 'undefined') {
          const epochs = farmAccessEpochRequestHeader(localStorage, supabaseConfig.projectRef)
          if (epochs && !headers.has('x-farm-rx-access-epochs')) headers.set('x-farm-rx-access-epochs', epochs)
          // Ordinary requests bind to their JWT subject. Operation writers set
          // this header earlier to the identity captured for the queued/direct
          // save; preserving it makes an A-to-B session switch fail in SQL.
          if (!headers.has('x-farm-rx-expected-user-id')) {
            const subject = jwtSubject(headers.get('authorization'))
            if (subject) headers.set('x-farm-rx-expected-user-id', subject)
          }
        }
        return fetch(input, { ...init, headers })
      },
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: `farm-rx-auth:${supabaseConfig.projectRef}`,
      storage: authStorage,
    },
  },
)

// PostgREST retries failed reads for roughly seven seconds by default. That is
// useful for an online-only app, but it prevents Farm Rx from promptly falling
// back to a verified IndexedDB workspace when the connection disappears.
// supabase-js does not currently expose this PostgREST setting in createClient.
const rest = (client as unknown as { rest?: { retry?: boolean } }).rest
if (!rest) throw new Error('Farm Rx could not configure its data service.')
rest.retry = false

export const supabase = client
