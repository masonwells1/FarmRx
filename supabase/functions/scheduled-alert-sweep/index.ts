import { createClient } from 'jsr:@supabase/supabase-js@2'
import { runScheduledAlertSweep, scheduledAlertRunHasFailures, type ScheduledWeatherField } from '../_shared/scheduledAlertOrchestrator.ts'

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
function sameSecret(left: string, right: string) { if (left.length !== right.length) return false; let result = 0; for (let i=0;i<left.length;i++) result |= left.charCodeAt(i)^right.charCodeAt(i); return result===0 }

async function fetchWeather(field: ScheduledWeatherField, runSignal: AbortSignal) {
  const query = new URLSearchParams({
    latitude: String(field.latitude),
    longitude: String(field.longitude),
    current: 'temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m,wind_gusts_10m',
    hourly: 'temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m,wind_gusts_10m,precipitation_probability',
    temperature_unit: 'fahrenheit',
    wind_speed_unit: 'mph',
    precipitation_unit: 'inch',
    timezone: 'auto',
    forecast_days: '2',
  })
  const controller = new AbortController()
  const abortForRun = () => controller.abort()
  runSignal.addEventListener('abort', abortForRun, { once: true })
  const timeout = setTimeout(() => controller.abort(), 8_000)
  try {
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`, { signal: controller.signal })
    if (!response.ok) throw new Error(`weather provider returned ${response.status}`)
    return await response.json() as unknown
  } finally {
    clearTimeout(timeout)
    runSignal.removeEventListener('abort', abortForRun)
  }
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405,{ error:'method not allowed' })
  const expected = Deno.env.get('SCHEDULER_SECRET') ?? ''
  const supplied = request.headers.get('x-scheduler-key') ?? ''
  if (!expected || !sameSecret(expected,supplied)) return json(401,{ error:'scheduler authorization failed' })
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !service) return json(503,{ error:'scheduler service configuration is missing' })
  const admin = createClient(url,service,{ auth:{ persistSession:false,autoRefreshToken:false } })

  try {
    const result = await runScheduledAlertSweep({
      now: () => new Date(),
      database: {
        async runAlertSweep(nowIso, signal) {
          const { data, error } = await admin.rpc('run_scheduled_alert_sweep', { p_now: nowIso }).abortSignal(signal)
          if (error) throw error
          return data
        },
        async listWeatherFields(signal) {
          const { data, error } = await admin.from('fields').select('id,farm_id,name,latitude,longitude').eq('is_active',true).not('latitude','is',null).not('longitude','is',null).order('id').abortSignal(signal)
          if (error) throw error
          return (data ?? []) as ScheduledWeatherField[]
        },
        async recordSprayWindow(input, signal) {
          const { data, error } = await admin.rpc('record_scheduled_spray_window', {
            p_farm_id: input.farmId,
            p_field_id: input.fieldId,
            p_local_date: input.localDate,
            p_is_good: input.isGood,
            p_observed_at: input.observedAt,
            p_observation: input.observation,
          }).abortSignal(signal)
          if (error) throw error
          return data ?? {}
        },
      },
      fetchWeather,
      async runPushSweep(runSignal) {
        const controller = new AbortController()
        const abortForRun = () => controller.abort(runSignal.reason)
        runSignal.addEventListener('abort', abortForRun, { once: true })
        const timeout = setTimeout(() => controller.abort(), 22_000)
        try {
          const response = await fetch(`${url}/functions/v1/send-push`,{ method:'POST',headers:{ authorization:`Bearer ${service}`,apikey:service,'x-server-delivery-key':service,'content-type':'application/json' },body:'{}',signal:controller.signal })
          let body: unknown = null
          try { body = await response.json() } catch { body = null }
          if (!response.ok) throw new Error(`push sweep returned ${response.status}`)
          if (body && typeof body === 'object' && 'failed' in body && Number((body as { failed?: unknown }).failed) > 0) throw new Error('push sweep reported provider failures')
          return body
        } finally { clearTimeout(timeout); runSignal.removeEventListener('abort', abortForRun) }
      },
      log: (entry) => console.error(JSON.stringify(entry)),
    })
    if (scheduledAlertRunHasFailures(result)) {
      console.error(JSON.stringify({ event:'scheduled_alert_sweep_partial_failure', ...result }))
      return json(503,{ ...result, error:'scheduled alert sweep completed with partial failures' } as unknown as Record<string, unknown>)
    }
    console.info(JSON.stringify({ event:'scheduled_alert_sweep_complete', ...result }))
    return json(200,result as unknown as Record<string, unknown>)
  } catch (error) {
    console.error(JSON.stringify({ event:'scheduled_alert_sweep_failed',error:error instanceof Error?error.name:'Error' }))
    return json(503,{ error:'scheduled alert sweep failed' })
  }
})
