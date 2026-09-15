import { marsFeedRunHasFailures, runMarsFeed, type MarsFeedDatabase, type MarsFeedReport, type MarsFeedRunRecord } from './marsFeedOrchestrator'
import type { MarsObservation } from './marsFeedLogic'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const now = () => new Date('2026-07-15T21:35:00.000Z') // 4:35 PM Chicago on a Wednesday
const iowa: MarsFeedReport = { report_id: '2850', name: 'Iowa Daily Cash Grain Bids', geography: 'IA', geography_label: 'Iowa', verified_at: '2026-07-01T12:00:00.000Z' }
const illinois: MarsFeedReport = { report_id: '3101', name: 'Illinois Daily Grain Bids', geography: 'IL', geography_label: 'Illinois', verified_at: '2026-07-01T12:00:00.000Z' }
const goodBody = { results: [
  { report_date: '07/15/2026', market_location_name: 'Cedar Rapids', commodity: 'Corn', basis: '-0.35', price: '4.12' },
  { report_date: '07/15/2026', market_location_name: 'Cedar Rapids', commodity: 'Oats', basis: '-0.10' },
] }

type Calls = { begun: Array<{ reportId: string; marketDate: string }>; finished: MarsFeedRunRecord[]; ingested: Array<{ reportId: string; runId: string; observations: MarsObservation[] }>; fetched: string[] }

function fakeDatabase(options: { reports: MarsFeedReport[]; successfulRuns?: Record<string, Array<string | null>>; ingestResult?: (input: { reportId: string; observations: MarsObservation[] }) => unknown; failBegin?: boolean }): { database: MarsFeedDatabase; calls: Calls } {
  const calls: Calls = { begun: [], finished: [], ingested: [], fetched: [] }
  let nextRun = 1
  const database: MarsFeedDatabase = {
    async listVerifiedReports() { return options.reports },
    async successfulRunReportDates(reportId, marketDate) { return (options.successfulRuns ?? {})[`${reportId}|${marketDate}`] ?? [] },
    async beginRun(input) { if (options.failBegin) throw new Error('run log unavailable'); calls.begun.push(input); return `run-${nextRun++}` },
    async finishRun(record) { calls.finished.push(record) },
    async ingest(input) {
      calls.ingested.push(input)
      return options.ingestResult ? options.ingestResult(input) : { status: 'ok', farms_eligible: 2, valid_observations: input.observations.length, written_rows: input.observations.length * 2, unchanged_rows: 0, skipped_observations: 0, skips: [] }
    },
  }
  return { database, calls }
}

// 1. A verified report on a fresh market day: one run begun, the body fetched, the whitelist applied before the fan-out, the run finished ok with counts.
{
  const { database, calls } = fakeDatabase({ reports: [iowa] })
  const result = await runMarsFeed({ now, database, fetchReport: async (reportId) => { calls.fetched.push(reportId); return goodBody } })
  assert(result.marketDate === '2026-07-15' && result.ok === 1 && result.failed === 0 && result.skipped === 0 && !marsFeedRunHasFailures(result), `A clean run: ${JSON.stringify(result)}`)
  assert(calls.fetched.join() === '2850' && calls.begun.length === 1 && calls.begun[0]!.marketDate === '2026-07-15', 'The report is fetched once and the run begun on the market day.')
  assert(calls.ingested.length === 1 && calls.ingested[0]!.runId === 'run-1' && calls.ingested[0]!.observations.length === 1 && calls.ingested[0]!.observations[0]!.commodity_id === 'corn_yellow', 'Only the whitelisted observation reaches the fan-out.')
  const finished = calls.finished[0]!
  assert(finished.status === 'ok' && finished.reportDate === '2026-07-15' && finished.fetchedRows === 2 && finished.writtenRows === 2 && finished.skippedRows === 1 && finished.farmsWritten === 2, `The run record carries the counts: ${JSON.stringify(finished)}`)
  assert(JSON.stringify(finished.detail).includes('commodity_not_whitelisted') && JSON.stringify(finished.detail).includes('market_location_name'), 'The run record says why rows were skipped and which columns were seen.')
  assert(result.reports[0]!.columns.includes('commodity') && result.reports[0]!.skippedRows === 1, 'The result mirrors the record.')
}

// 2. Once a market day has a successful run the report is not fetched again ("once per market day, cached server-side").
{
  const { database, calls } = fakeDatabase({ reports: [iowa], successfulRuns: { '2850|2026-07-15': ['2026-07-15'] } })
  const result = await runMarsFeed({ now, database, fetchReport: async (reportId) => { calls.fetched.push(reportId); return goodBody } })
  assert(result.skipped === 1 && result.reports[0]!.reason === 'already_ingested_today' && calls.fetched.length === 0 && calls.begun.length === 0 && calls.ingested.length === 0, 'A completed market day skips the fetch, the run row, and the fan-out.')
  assert(!marsFeedRunHasFailures(result), 'A skip is not a failure.')
}

// 2b. GL-004: an earlier run today that fetched a report still dated yesterday (USDA had not published yet) does not
// satisfy the market day. The later scheduled run fetches again, and once the day's report is dated today it is ingested.
{
  const { database, calls } = fakeDatabase({ reports: [iowa], successfulRuns: { '2850|2026-07-15': ['2026-07-14'] } })
  const result = await runMarsFeed({ now, database, fetchReport: async (reportId) => { calls.fetched.push(reportId); return goodBody } })
  assert(result.ok === 1 && result.skipped === 0 && calls.fetched.join() === '2850' && calls.begun.length === 1 && calls.ingested.length === 1, `A stale-report run must not block the day's later fetch: ${JSON.stringify(result)}`)
  assert(calls.finished[0]!.status === 'ok' && calls.finished[0]!.reportDate === '2026-07-15', 'The re-fetched, current report is recorded ok with its own date.')
}
{
  // An ok run whose report carried no date cannot be judged stale; the day stays satisfied as before.
  const { database, calls } = fakeDatabase({ reports: [iowa], successfulRuns: { '2850|2026-07-15': [null] } })
  const result = await runMarsFeed({ now, database, fetchReport: async (reportId) => { calls.fetched.push(reportId); return goodBody } })
  assert(result.skipped === 1 && result.reports[0]!.reason === 'already_ingested_today' && calls.fetched.length === 0, 'An undated ok run still satisfies the market day.')
}
{
  // A run from a different market day never satisfies today, whatever its report date.
  const { database, calls } = fakeDatabase({ reports: [iowa], successfulRuns: { '2850|2026-07-14': ['2026-07-14', '2026-07-15'] } })
  const result = await runMarsFeed({ now, database, fetchReport: async (reportId) => { calls.fetched.push(reportId); return goodBody } })
  assert(result.ok === 1 && calls.fetched.length === 1, 'Yesterday\'s run must not satisfy today.')
}

// 3. The fan-out's own refusal (report unverified at the database) is recorded as a skipped run with the reason; nothing is treated as written.
{
  const { database, calls } = fakeDatabase({ reports: [iowa], ingestResult: () => ({ status: 'skipped', reason: 'report_unverified' }) })
  const result = await runMarsFeed({ now, database, fetchReport: async () => goodBody })
  assert(result.skipped === 1 && result.reports[0]!.reason === 'report_unverified' && calls.finished[0]!.status === 'skipped' && calls.finished[0]!.writtenRows === 0, 'An unverified report is recorded as skipped, not ok.')
}

// 4. A fetch failure records a failed run without the fan-out and leaves the loop for the next report; the message never carries a URL or credential.
{
  const { database, calls } = fakeDatabase({ reports: [iowa, illinois] })
  const result = await runMarsFeed({ now, database, fetchReport: async (reportId) => { if (reportId === '2850') throw new Error('provider returned 503 for https://marsapi.example/reports/2850 with Basic abc123'); return goodBody } })
  assert(result.failed === 1 && result.ok === 1 && marsFeedRunHasFailures(result), `One report failed, the other ran: ${JSON.stringify(result)}`)
  const failed = calls.finished.find((record) => record.status === 'failed')!
  assert(failed && failed.runId === 'run-1' && calls.ingested.length === 1 && calls.ingested[0]!.reportId === '3101', 'The failed report never reached the fan-out; the next report did.')
  const message = String(failed.detail.message)
  assert(!message.includes('https://') && !message.includes('abc123') && message.includes('[url]') && message.includes('[auth]'), `The recorded message hides URLs and credentials: ${message}`)
}

// 5. A body of an unrecognized shape is a failed run, recorded, with no fan-out.
{
  const { database, calls } = fakeDatabase({ reports: [iowa] })
  const result = await runMarsFeed({ now, database, fetchReport: async () => ({ report: 'html error page' }) })
  assert(result.failed === 1 && result.reports[0]!.reason === 'unrecognized_shape' && calls.ingested.length === 0 && calls.finished[0]!.status === 'failed', 'An unrecognized body is a recorded failure with nothing written.')
}

// 6. A slow provider hits the fetch deadline: recorded as a failure, nothing written.
{
  const { database, calls } = fakeDatabase({ reports: [iowa] })
  const result = await runMarsFeed({ now, database, fetchDeadlineMs: 20, fetchReport: (_reportId, signal) => new Promise((_resolve, reject) => { signal.addEventListener('abort', () => reject(signal.reason), { once: true }) }) })
  assert(result.failed === 1 && result.reports[0]!.reason === 'TimeoutError' && calls.ingested.length === 0 && calls.finished[0]!.status === 'failed', `A fetch past its deadline is a recorded failure: ${JSON.stringify(result)}`)
}

// 7. When the run log itself cannot be written the report is a failure and nothing is fetched or ingested.
{
  const { database, calls } = fakeDatabase({ reports: [iowa], failBegin: true })
  const result = await runMarsFeed({ now, database, fetchReport: async (reportId) => { calls.fetched.push(reportId); return goodBody } })
  assert(result.failed === 1 && calls.fetched.length === 0 && calls.ingested.length === 0, 'Without a run row nothing is fetched or written.')
}

// 8. An invalid clock refuses to run.
{
  const { database } = fakeDatabase({ reports: [iowa] })
  let threw = false
  try { await runMarsFeed({ now: () => new Date('nope'), database, fetchReport: async () => goodBody }) } catch { threw = true }
  assert(threw, 'An invalid clock must not run the feed.')
}

console.log('MARS feed orchestrator regressions passed (clean run, daily skip, stale-report re-fetch, unverified skip, failures recorded without secrets, deadline, run log).')
