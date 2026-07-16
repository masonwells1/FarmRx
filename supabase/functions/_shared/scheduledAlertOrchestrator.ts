import { localDateFromForecast, parseScheduledWeatherResponse, scheduledSprayIsGood, type ScheduledWeatherObservation } from './scheduledAlertLogic.ts'

export interface ScheduledWeatherField {
  id: string
  farm_id: string
  name: string
  latitude: number
  longitude: number
}

export interface ScheduledAlertDatabase {
  runAlertSweep(nowIso: string, signal: AbortSignal): Promise<unknown>
  listWeatherFields(signal: AbortSignal): Promise<ScheduledWeatherField[]>
  recordSprayWindow(input: {
    farmId: string
    fieldId: string
    localDate: string
    isGood: boolean
    observedAt: string
    observation: ScheduledWeatherObservation
  }, signal: AbortSignal): Promise<{ fired?: boolean }>
}

export interface ScheduledAlertDependencies {
  now: () => Date
  database: ScheduledAlertDatabase
  fetchWeather: (field: ScheduledWeatherField, signal: AbortSignal) => Promise<unknown>
  runPushSweep: (signal: AbortSignal) => Promise<unknown>
  log?: (entry: Record<string, unknown>) => void
  weatherConcurrency?: number
  weatherDeadlineMs?: number
  schedulerDeadlineMs?: number
}

export interface ScheduledAlertRunResult {
  sweep: unknown
  weatherChecked: number
  weatherFailed: number
  weatherFailureFields: Array<{ farmId: string; fieldId: string; reason: string }>
  weatherTimedOut: boolean
  sprayFired: number
  push: unknown
}

const failureReason = (error: unknown) => error instanceof Error && error.name ? error.name : 'Error'

function positiveCount(value: unknown, key: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const count = (value as Record<string, unknown>)[key]
  return typeof count === 'number' && Number.isFinite(count) && count > 0
}

export function scheduledAlertRunHasFailures(result: ScheduledAlertRunResult) {
  return result.weatherFailed > 0 || positiveCount(result.sweep, 'farm_failure_count')
}

export async function runScheduledAlertSweep(dependencies: ScheduledAlertDependencies): Promise<ScheduledAlertRunResult> {
  const now = dependencies.now()
  if (!Number.isFinite(now.getTime())) throw new Error('scheduler clock is invalid')
  const nowIso = now.toISOString()
  const runController = new AbortController()
  const schedulerDeadlineMs = Math.max(1, Math.min(Math.trunc(dependencies.schedulerDeadlineMs ?? 50_000), 55_000))
  const runTimer = setTimeout(() => runController.abort(new DOMException('Scheduler deadline reached', 'TimeoutError')), schedulerDeadlineMs)
  try {
  const sweep = await dependencies.database.runAlertSweep(nowIso, runController.signal)
  if (runController.signal.aborted) throw new DOMException('Scheduler deadline reached', 'TimeoutError')
  const fields = await dependencies.database.listWeatherFields(runController.signal)
  if (runController.signal.aborted) throw new DOMException('Scheduler deadline reached', 'TimeoutError')
  let weatherChecked = 0
  let sprayFired = 0
  const failures: Array<ScheduledAlertRunResult['weatherFailureFields'][number] & { index: number }> = []
  const settled = fields.map(() => false)
  const controller = new AbortController()
  const abortWeatherForRun = () => controller.abort(runController.signal.reason)
  runController.signal.addEventListener('abort', abortWeatherForRun, { once: true })
  const concurrency = Math.max(1, Math.min(Math.trunc(dependencies.weatherConcurrency ?? 6), 12))
  const deadlineMs = Math.max(1, Math.min(Math.trunc(dependencies.weatherDeadlineMs ?? 20_000), 30_000))
  let nextIndex = 0
  let weatherTimedOut = false
  const fail = (index: number, reason: string) => {
    if (settled[index]) return
    settled[index] = true
    const field = fields[index]!
    const failure = { index, farmId: field.farm_id, fieldId: field.id, reason }
    failures.push(failure)
    dependencies.log?.({ event: 'scheduled_weather_field_failed', farmId: failure.farmId, fieldId: failure.fieldId, reason })
  }
  const worker = async () => {
    while (true) {
      if (controller.signal.aborted) return
      const index = nextIndex
      nextIndex += 1
      if (index >= fields.length) return
      const field = fields[index]!
      try {
        const observation = parseScheduledWeatherResponse(await dependencies.fetchWeather(field, controller.signal), now)
        if (controller.signal.aborted) throw new DOMException('Weather deadline reached', 'TimeoutError')
        const recorded = await dependencies.database.recordSprayWindow({
          farmId: field.farm_id,
          fieldId: field.id,
          localDate: localDateFromForecast(observation),
          isGood: scheduledSprayIsGood(observation),
          observedAt: observation.observed_at,
          observation,
        }, controller.signal)
        if (settled[index]) continue
        settled[index] = true
        weatherChecked += 1
        if (recorded.fired === true) sprayFired += 1
      } catch (error) {
        fail(index, failureReason(error))
      }
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, fields.length) }, () => worker())
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      weatherTimedOut = true
      controller.abort()
      for (let index = 0; index < fields.length; index += 1) fail(index, 'TimeoutError')
      resolve()
    }, deadlineMs)
  })
  if (workers.length) await Promise.race([Promise.all(workers).then(() => undefined), deadline])
  if (timer !== undefined) clearTimeout(timer)
  if (weatherTimedOut) controller.abort(new DOMException('Weather deadline reached', 'TimeoutError'))
  await Promise.allSettled(workers)
  runController.signal.removeEventListener('abort', abortWeatherForRun)
  const weatherFailureFields = failures.sort((left, right) => left.index - right.index).map(({ index: _index, ...failure }) => failure)

  // Deliberately last and deliberately not caught: a push sweep failure must
  // make the HTTP request fail so monitoring never reports false success.
  if (runController.signal.aborted) throw new DOMException('Scheduler deadline reached', 'TimeoutError')
  const push = await dependencies.runPushSweep(runController.signal)
  return { sweep, weatherChecked, weatherFailed: weatherFailureFields.length, weatherFailureFields, weatherTimedOut, sprayFired, push }
  } finally { clearTimeout(runTimer) }
}
