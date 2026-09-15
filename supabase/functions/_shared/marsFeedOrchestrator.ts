// GL-1: the run of the USDA MARS basis feed, with every side effect behind an interface so
// the run can be proved without a network, a database, or a clock.
//
// For each verified report: skip when this market day already has a successful run; fetch
// with a deadline; parse (skip, never guess); hand the observations to the database's
// service-only fan-out; record the run. A failure records a failed run and leaves the
// stored history untouched. Nothing here ever sees or repeats a secret.

import { marketDateFor, parseMarsReport, type MarsObservation } from './marsFeedLogic.ts'

export interface MarsFeedReport {
  report_id: string
  name: string
  geography: string
  geography_label: string
  verified_at: string | null
}

export type MarsFeedRunStatus = 'ok' | 'skipped' | 'failed'

export interface MarsFeedRunRecord {
  runId: string
  status: MarsFeedRunStatus
  reportDate: string | null
  fetchedRows: number
  writtenRows: number
  unchangedRows: number
  skippedRows: number
  farmsWritten: number
  detail: Record<string, unknown>
}

export interface MarsFeedDatabase {
  listVerifiedReports(signal: AbortSignal): Promise<MarsFeedReport[]>
  hasSuccessfulRun(reportId: string, marketDate: string, signal: AbortSignal): Promise<boolean>
  beginRun(input: { reportId: string; marketDate: string }, signal: AbortSignal): Promise<string>
  finishRun(record: MarsFeedRunRecord, signal: AbortSignal): Promise<void>
  ingest(input: { reportId: string; runId: string; observations: MarsObservation[] }, signal: AbortSignal): Promise<unknown>
}

export interface MarsFeedDependencies {
  now: () => Date
  timeZone?: string
  database: MarsFeedDatabase
  fetchReport: (reportId: string, signal: AbortSignal) => Promise<unknown>
  log?: (entry: Record<string, unknown>) => void
  runDeadlineMs?: number
  fetchDeadlineMs?: number
}

export interface MarsFeedReportResult {
  reportId: string
  status: MarsFeedRunStatus
  reason: string | null
  reportDate: string | null
  fetchedRows: number
  validObservations: number
  writtenRows: number
  unchangedRows: number
  skippedRows: number
  farmsEligible: number
  columns: string[]
}

export interface MarsFeedRunResult {
  marketDate: string
  reports: MarsFeedReportResult[]
  ok: number
  skipped: number
  failed: number
  timedOut: boolean
}

export function marsFeedRunHasFailures(result: MarsFeedRunResult) {
  return result.failed > 0 || result.timedOut
}

const count = (value: unknown, key: string) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 0
  const raw = (value as Record<string, unknown>)[key]
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? Math.trunc(raw) : 0
}
const field = (value: unknown, key: string) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>)[key] : undefined)
const failureName = (error: unknown) => (error instanceof Error && error.name ? error.name : 'Error')
/** Error text is kept short and never echoes a header or URL, where a credential could sit. */
const failureMessage = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, '[url]').replace(/basic\s+\S+/gi, '[auth]').slice(0, 300)

async function withDeadline<T>(task: (signal: AbortSignal) => Promise<T>, parent: AbortSignal, deadlineMs: number): Promise<T> {
  const controller = new AbortController()
  const abortForParent = () => controller.abort(parent.reason)
  if (parent.aborted) abortForParent()
  parent.addEventListener('abort', abortForParent, { once: true })
  const timer = setTimeout(() => controller.abort(new DOMException('Feed fetch deadline reached', 'TimeoutError')), deadlineMs)
  try {
    return await task(controller.signal)
  } finally {
    clearTimeout(timer)
    parent.removeEventListener('abort', abortForParent)
  }
}

export async function runMarsFeed(dependencies: MarsFeedDependencies): Promise<MarsFeedRunResult> {
  const now = dependencies.now()
  if (!Number.isFinite(now.getTime())) throw new Error('feed clock is invalid')
  const marketDate = marketDateFor(now, dependencies.timeZone ?? 'America/Chicago')
  const log = dependencies.log ?? (() => undefined)
  const runController = new AbortController()
  const runDeadlineMs = Math.max(1, Math.min(Math.trunc(dependencies.runDeadlineMs ?? 50_000), 55_000))
  const fetchDeadlineMs = Math.max(1, Math.min(Math.trunc(dependencies.fetchDeadlineMs ?? 15_000), runDeadlineMs))
  const runTimer = setTimeout(() => runController.abort(new DOMException('Feed run deadline reached', 'TimeoutError')), runDeadlineMs)
  const result: MarsFeedRunResult = { marketDate, reports: [], ok: 0, skipped: 0, failed: 0, timedOut: false }
  const signal = runController.signal

  try {
    const reports = await dependencies.database.listVerifiedReports(signal)
    for (const report of reports) {
      if (signal.aborted) { result.timedOut = true; break }
      if (report.verified_at === null) {
        // Belt and braces: the database only lists verified reports, and the fan-out refuses an unverified one anyway.
        result.reports.push({ reportId: report.report_id, status: 'skipped', reason: 'report_unverified', reportDate: null, fetchedRows: 0, validObservations: 0, writtenRows: 0, unchangedRows: 0, skippedRows: 0, farmsEligible: 0, columns: [] })
        result.skipped += 1
        continue
      }
      if (await dependencies.database.hasSuccessfulRun(report.report_id, marketDate, signal)) {
        result.reports.push({ reportId: report.report_id, status: 'skipped', reason: 'already_ingested_today', reportDate: null, fetchedRows: 0, validObservations: 0, writtenRows: 0, unchangedRows: 0, skippedRows: 0, farmsEligible: 0, columns: [] })
        result.skipped += 1
        continue
      }

      let runId: string | null = null
      try {
        runId = await dependencies.database.beginRun({ reportId: report.report_id, marketDate }, signal)
        const body = await withDeadline((fetchSignal) => dependencies.fetchReport(report.report_id, fetchSignal), signal, fetchDeadlineMs)
        const parsed = parseMarsReport(body, { reportId: report.report_id })
        if (parsed.shape === 'unrecognized') {
          const record: MarsFeedRunRecord = { runId, status: 'failed', reportDate: null, fetchedRows: 0, writtenRows: 0, unchangedRows: 0, skippedRows: 0, farmsWritten: 0, detail: { reason: 'unrecognized_shape' } }
          await dependencies.database.finishRun(record, signal)
          result.reports.push({ reportId: report.report_id, status: 'failed', reason: 'unrecognized_shape', reportDate: null, fetchedRows: 0, validObservations: 0, writtenRows: 0, unchangedRows: 0, skippedRows: 0, farmsEligible: 0, columns: [] })
          result.failed += 1
          continue
        }
        const skipReasons: Record<string, number> = {}
        for (const skip of parsed.skipped) skipReasons[skip.reason] = (skipReasons[skip.reason] ?? 0) + 1

        const ingested = await dependencies.database.ingest({ reportId: report.report_id, runId, observations: parsed.observations }, signal)
        const ingestStatus = field(ingested, 'status')
        if (ingestStatus === 'skipped') {
          const reason = typeof field(ingested, 'reason') === 'string' ? (field(ingested, 'reason') as string) : 'ingest_skipped'
          await dependencies.database.finishRun({ runId, status: 'skipped', reportDate: parsed.reportDate, fetchedRows: parsed.rowCount, writtenRows: 0, unchangedRows: 0, skippedRows: parsed.skipped.length, farmsWritten: 0, detail: { reason, columns: parsed.columns, skipReasons } }, signal)
          result.reports.push({ reportId: report.report_id, status: 'skipped', reason, reportDate: parsed.reportDate, fetchedRows: parsed.rowCount, validObservations: parsed.observations.length, writtenRows: 0, unchangedRows: 0, skippedRows: parsed.skipped.length, farmsEligible: 0, columns: parsed.columns })
          result.skipped += 1
          continue
        }
        if (ingestStatus !== 'ok') throw new Error('fan-out returned an unexpected status')
        const writtenRows = count(ingested, 'written_rows')
        const unchangedRows = count(ingested, 'unchanged_rows')
        const ingestSkipped = count(ingested, 'skipped_observations')
        const farmsEligible = count(ingested, 'farms_eligible')
        const validObservations = count(ingested, 'valid_observations')
        const skippedRows = parsed.skipped.length + ingestSkipped
        const farmsWritten = validObservations > 0 ? farmsEligible : 0
        await dependencies.database.finishRun({ runId, status: 'ok', reportDate: parsed.reportDate, fetchedRows: parsed.rowCount, writtenRows, unchangedRows, skippedRows, farmsWritten, detail: { columns: parsed.columns, skipReasons, ingestSkips: field(ingested, 'skips') ?? [] } }, signal)
        result.reports.push({ reportId: report.report_id, status: 'ok', reason: null, reportDate: parsed.reportDate, fetchedRows: parsed.rowCount, validObservations, writtenRows, unchangedRows, skippedRows, farmsEligible, columns: parsed.columns })
        result.ok += 1
      } catch (error) {
        const timedOut = signal.aborted
        if (timedOut) result.timedOut = true
        const reason = failureName(error)
        log({ event: 'usda_mars_feed_report_failed', reportId: report.report_id, reason })
        if (runId !== null) {
          try {
            await dependencies.database.finishRun({ runId, status: 'failed', reportDate: null, fetchedRows: 0, writtenRows: 0, unchangedRows: 0, skippedRows: 0, farmsWritten: 0, detail: { reason, message: failureMessage(error) } }, timedOut ? new AbortController().signal : signal)
          } catch (finishError) {
            log({ event: 'usda_mars_feed_run_record_failed', reportId: report.report_id, reason: failureName(finishError) })
          }
        }
        result.reports.push({ reportId: report.report_id, status: 'failed', reason, reportDate: null, fetchedRows: 0, validObservations: 0, writtenRows: 0, unchangedRows: 0, skippedRows: 0, farmsEligible: 0, columns: [] })
        result.failed += 1
        if (timedOut) break
      }
    }
  } finally {
    clearTimeout(runTimer)
  }
  return result
}
