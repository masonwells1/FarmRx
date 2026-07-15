import { createClient } from 'jsr:@supabase/supabase-js@2'
import { localDateFromForecast, scheduledSprayIsGood, type ScheduledWeatherObservation } from '../_shared/scheduledAlertLogic.ts'

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
function sameSecret(left: string, right: string) { if (left.length !== right.length) return false; let result = 0; for (let i=0;i<left.length;i++) result |= left.charCodeAt(i)^right.charCodeAt(i); return result===0 }

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405,{ error:'method not allowed' })
  const expected = Deno.env.get('SCHEDULER_SECRET') ?? ''
  const supplied = request.headers.get('x-scheduler-key') ?? ''
  if (!expected || !sameSecret(expected,supplied)) return json(401,{ error:'scheduler authorization failed' })
  const url = Deno.env.get('SUPABASE_URL') ?? ''; const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !service) return json(503,{ error:'scheduler service configuration is missing' })
  const admin = createClient(url,service,{ auth:{ persistSession:false,autoRefreshToken:false } })
  try {
    const { data:sweep,error:sweepError } = await admin.rpc('run_scheduled_alert_sweep',{ p_now:new Date().toISOString() })
    if (sweepError) throw sweepError
    const { data:fields,error:fieldsError } = await admin.from('fields').select('id,farm_id,name,latitude,longitude').eq('is_active',true).not('latitude','is',null).not('longitude','is',null).order('id')
    if (fieldsError) throw fieldsError
    let weatherChecked=0; let weatherFailed=0; let sprayFired=0
    for (const field of fields ?? []) {
      try {
        const query = new URLSearchParams({ latitude:String(field.latitude),longitude:String(field.longitude),current:'temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m,wind_gusts_10m',hourly:'precipitation_probability',temperature_unit:'fahrenheit',wind_speed_unit:'mph',precipitation_unit:'inch',timezone:'auto',forecast_days:'1' })
        const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`); if (!response.ok) throw new Error(`weather ${response.status}`)
        const body = await response.json() as { current?: ScheduledWeatherObservation; hourly?: { time?: string[]; precipitation_probability?: number[] } }
        if (!body.current) throw new Error('weather observation missing')
        const index = body.hourly?.time?.indexOf(body.current.time) ?? -1
        const observation: ScheduledWeatherObservation = { ...body.current, precipitation_probability:index>=0 ? body.hourly?.precipitation_probability?.[index] ?? null : null }
        const { data:recorded,error } = await admin.rpc('record_scheduled_spray_window',{ p_farm_id:field.farm_id,p_field_id:field.id,p_local_date:localDateFromForecast(observation),p_is_good:scheduledSprayIsGood(observation),p_observed_at:new Date().toISOString(),p_observation:observation })
        if (error) throw error; weatherChecked++; if (recorded?.fired===true) sprayFired++
      } catch (error) { weatherFailed++; console.error(JSON.stringify({ event:'scheduled_weather_field_failed',farmId:field.farm_id,fieldId:field.id,error:error instanceof Error?error.message:'unknown' })) }
    }
    const push = await fetch(`${url}/functions/v1/send-push`,{ method:'POST',headers:{ authorization:`Bearer ${service}`,apikey:service,'x-server-delivery-key':service,'content-type':'application/json' },body:'{}' })
    if (!push.ok) throw new Error(`push sweep returned ${push.status}`)
    const pushResult = await push.json()
    console.info(JSON.stringify({ event:'scheduled_alert_sweep_complete',sweep,weatherChecked,weatherFailed,sprayFired,push:pushResult }))
    return json(200,{ sweep,weatherChecked,weatherFailed,sprayFired,push:pushResult })
  } catch (error) { console.error(JSON.stringify({ event:'scheduled_alert_sweep_failed',error:error instanceof Error?error.message:'unknown' })); return json(503,{ error:'scheduled alert sweep failed' }) }
})
