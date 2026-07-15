import { createClient } from '@supabase/supabase-js'
import { supabaseConfig } from './supabaseConfig'

const hostname = new URL(supabaseConfig.url).hostname
if (hostname !== `${supabaseConfig.projectRef}.supabase.co`) {
  throw new Error('Farm Rx is not connected to its expected data service.')
}

const client = createClient(
  supabaseConfig.url,
  supabaseConfig.publishableKey,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: `farm-rx-auth:${supabaseConfig.projectRef}`,
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
