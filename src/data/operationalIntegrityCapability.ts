import { supabase } from '../lib/supabaseClient'

/** One 0035 probe gates every client control introduced by that database update. */
export const OPERATIONAL_INTEGRITY_UPDATE_MESSAGE = 'This control arrives with the next database update. Reload the app after the update.'

export function operationalIntegrityCapabilityFromProbe(error: { code?: unknown; message?: unknown } | null): boolean {
  if (error === null) return true
  const message = typeof error.message === 'string' ? error.message.toLowerCase() : ''
  return (error.code === '42501' || error.code === 'P0001') && (message.includes('authentication is required') || message.includes('permission to edit this farm'))
}

let capability: Promise<boolean> | null = null
export function getOperationalIntegrityCapability() {
  if (!capability) capability = (async () => {
    try {
      const { error } = await supabase.rpc('operational_integrity_capability_probe', { p_farm_id: crypto.randomUUID() })
      return operationalIntegrityCapabilityFromProbe(error)
    } catch { capability = null; return false }
  })()
  return capability
}
