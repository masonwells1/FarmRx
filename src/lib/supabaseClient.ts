import { createClient } from '@supabase/supabase-js'
import { supabaseConfig } from './supabaseConfig'

const hostname = new URL(supabaseConfig.url).hostname
if (hostname !== `${supabaseConfig.projectRef}.supabase.co`) {
  throw new Error('Farm Rx is not connected to its expected data service.')
}

export const supabase = createClient(
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
