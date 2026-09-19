import { createClient } from 'jsr:@supabase/supabase-js@2'
import { marsFeedRunHasFailures, runMarsFeed, type MarsFeedReport, type MarsFeedRunRecord } from '../_shared/marsFeedOrchestrator.ts'
import type { MarsObservation } from '../_shared/marsFeedLogic.ts'

// GL-1: the scheduled USDA MARS basis feed. Invoked by the GitHub Actions cron with the
// scheduler secret, exactly like scheduled-alert-sweep. Reads the verified report mapping,
// fetches each report with the MARS API key (HTTP Basic, key as the user name), parses it,
// and hands the observations to the service-only database fan-out. The key never leaves
// this process: it is not logged, not returned, and not written to the run log.

const MARS_REPORT_BASE = 'https://marsapi.ams.usda.gov/services/v1.2/reports/'

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
function sameSecret(left: string, right: string) { if (left.length !== right.length) return false; let result = 0; for (let i = 0; i < left.length; i++) result |= left.charCodeAt(i) ^ right.charCodeAt(i); return result === 0 }

Deno.serve(async (request) => {
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' })
  const expected = Deno.env.get('SCHEDULER_SECRET') ?? ''
  const supplied = request.headers.get('x-scheduler-key') ?? ''
  if (!expected || !sameSecret(expected, supplied)) return json(401, { error: 'scheduler authorization failed' })
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  const marsKey = Deno.env.get('USDA_MARS_API_KEY') ?? ''
  if (!url || !service) return json(503, { error: 'feed service configuration is missing' })
  if (!marsKey) return json(503, { error: 'feed provider configuration is missing' })
  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const authorization = `Basic ${btoa(`${marsKey}:`)}`

  try {
    const result = await runMarsFeed({
      now: () => new Date(),
      database: {
        async listVerifiedReports(signal) {
          const { data, error } = await admin.from('usda_market_reports').select('report_id,name,geography,geography_label,verified_at').not('verified_at', 'is', null).order('report_id').abortSignal(signal)
          if (error) throw error
          return (data ?? []) as MarsFeedReport[]
        },
        async successfulRunReportDates(reportId, marketDate, signal) {
          const { data, error } = await admin.from('usda_market_report_runs').select('report_date').eq('report_id', reportId).eq('market_date', marketDate).eq('status', 'ok').abortSignal(signal)
          if (error) throw error
          return ((data ?? []) as Array<{ report_date: string | null }>).map((row) => (typeof row.report_date === 'string' ? row.report_date : null))
        },
        async beginRun(input, signal) {
          const { data, error } = await admin.from('usda_market_report_runs').insert({ report_id: input.reportId, market_date: input.marketDate, status: 'started' }).select('id').abortSignal(signal).single()
          if (error) throw error
          return String((data as { id: string }).id)
        },
        async finishRun(record: MarsFeedRunRecord, signal) {
          const { error } = await admin.from('usda_market_report_runs').update({
            status: record.status,
            report_date: record.reportDate,
            fetched_rows: record.fetchedRows,
            written_rows: record.writtenRows,
            unchanged_rows: record.unchangedRows,
            skipped_rows: record.skippedRows,
            farms_written: record.farmsWritten,
            detail: record.detail,
            finished_at: new Date().toISOString(),
          }).eq('id', record.runId).abortSignal(signal)
          if (error) throw error
        },
        async ingest(input: { reportId: string; runId: string; observations: MarsObservation[] }, signal) {
          const { data, error } = await admin.rpc('ingest_usda_mars_observations', { p_report_id: input.reportId, p_run_id: input.runId, p_observations: input.observations }).abortSignal(signal)
          if (error) throw error
          return data
        },
      },
      async fetchReport(reportId, signal) {
        if (!/^[0-9]{3,6}$/.test(reportId)) throw new Error('report id is malformed')
        const response = await fetch(`${MARS_REPORT_BASE}${reportId}`, { headers: { authorization, accept: 'application/json' }, signal })
        if (!response.ok) throw new Error(`feed provider returned ${response.status}`)
        return await response.json() as unknown
      },
      log: (entry) => console.error(JSON.stringify(entry)),
    })
    if (marsFeedRunHasFailures(result)) {
      console.error(JSON.stringify({ event: 'usda_mars_feed_partial_failure', ...result }))
      return json(503, { ...result, error: 'usda mars feed completed with failures' } as unknown as Record<string, unknown>)
    }
    console.info(JSON.stringify({ event: 'usda_mars_feed_complete', ...result }))
    return json(200, result as unknown as Record<string, unknown>)
  } catch (error) {
    console.error(JSON.stringify({ event: 'usda_mars_feed_failed', error: error instanceof Error ? error.name : 'Error' }))
    return json(503, { error: 'usda mars feed failed' })
  }
})
