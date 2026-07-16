export const SCHEDULED_WEATHER_LIMITS = Object.freeze({
  maximumObservationAgeMinutes: 90,
  maximumObservationFutureMinutes: 10,
  minimumTemperatureF: 40,
  maximumTemperatureF: 85,
  minimumWindMph: 3,
  maximumWindMph: 10,
  maximumGustMph: 15,
  maximumPrecipitationProbability: 40,
  requiredFutureHours: 4,
})

export interface ScheduledWeatherPoint {
  time: string
  temperature_2m: number
  relative_humidity_2m: number
  precipitation: number
  rain: number
  weather_code: number
  wind_speed_10m: number
  wind_gusts_10m: number
  precipitation_probability: number
}

export interface ScheduledWeatherObservation {
  observed_at: string
  local_date: string
  utc_offset_seconds: number
  current: ScheduledWeatherPoint
  next_four_hours: ScheduledWeatherPoint[]
}

const pointKeys = [
  'temperature_2m',
  'relative_humidity_2m',
  'precipitation',
  'rain',
  'weather_code',
  'wind_speed_10m',
  'wind_gusts_10m',
] as const

const plainObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

const localTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/

function finiteNumber(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} is missing or non-finite`)
  return value
}

function localTimeMilliseconds(value: string) {
  if (!localTimePattern.test(value)) throw new Error('weather time is malformed')
  const parsed = Date.parse(`${value}:00Z`)
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 16) !== value) throw new Error('weather time is invalid')
  return parsed
}

function inRange(value: number, minimum: number, maximum: number, label: string) {
  if (value < minimum || value > maximum) throw new Error(`${label} is outside the provider domain`)
  return value
}

function readPoint(source: Record<string, unknown>, time: string, probability: unknown, label: string): ScheduledWeatherPoint {
  const point = { time } as ScheduledWeatherPoint
  for (const key of pointKeys) point[key] = finiteNumber(source[key], `${label}.${key}`)
  point.precipitation_probability = finiteNumber(probability, `${label}.precipitation_probability`)
  inRange(point.temperature_2m, -150, 150, `${label}.temperature_2m`)
  inRange(point.relative_humidity_2m, 0, 100, `${label}.relative_humidity_2m`)
  inRange(point.precipitation, 0, 100, `${label}.precipitation`)
  inRange(point.rain, 0, 100, `${label}.rain`)
  if (!Number.isInteger(point.weather_code) || point.weather_code < 0 || point.weather_code > 99) throw new Error(`${label}.weather_code is outside the provider domain`)
  inRange(point.wind_speed_10m, 0, 300, `${label}.wind_speed_10m`)
  inRange(point.wind_gusts_10m, 0, 300, `${label}.wind_gusts_10m`)
  inRange(point.precipitation_probability, 0, 100, `${label}.precipitation_probability`)
  return point
}

/** Parse the production provider envelope and fail closed on every incomplete,
 * stale, future-dated, or misaligned shape. The current point is aligned to its
 * containing hourly bucket; four complete consecutive future hours are required. */
export function parseScheduledWeatherResponse(value: unknown, now: Date): ScheduledWeatherObservation {
  if (!plainObject(value) || !plainObject(value.current) || !plainObject(value.hourly)) throw new Error('weather response is malformed')
  if (!Number.isFinite(now.getTime())) throw new Error('scheduler clock is invalid')

  const offset = finiteNumber(value.utc_offset_seconds, 'utc_offset_seconds')
  if (!Number.isInteger(offset) || Math.abs(offset) > 64_800) throw new Error('utc_offset_seconds is invalid')
  const currentTime = value.current.time
  if (typeof currentTime !== 'string' || !localTimePattern.test(currentTime)) throw new Error('current weather time is malformed')

  const observedAtMs = localTimeMilliseconds(currentTime) - offset * 1_000
  const ageMinutes = (now.getTime() - observedAtMs) / 60_000
  if (ageMinutes > SCHEDULED_WEATHER_LIMITS.maximumObservationAgeMinutes) throw new Error('current weather observation is stale')
  if (ageMinutes < -SCHEDULED_WEATHER_LIMITS.maximumObservationFutureMinutes) throw new Error('current weather observation is materially future-dated')

  const times = value.hourly.time
  if (!Array.isArray(times) || !times.every((item): item is string => typeof item === 'string' && localTimePattern.test(item))) {
    throw new Error('hourly weather times are missing or malformed')
  }
  const hourlyKeys = [...pointKeys, 'precipitation_probability'] as const
  for (const key of hourlyKeys) {
    const series = value.hourly[key]
    if (!Array.isArray(series) || series.length !== times.length) throw new Error(`hourly ${key} is missing or misaligned`)
  }

  const alignedHour = `${currentTime.slice(0, 13)}:00`
  const start = times.indexOf(alignedHour)
  if (start < 0 || start + SCHEDULED_WEATHER_LIMITS.requiredFutureHours >= times.length) throw new Error('current and next-four-hour weather are not aligned')
  for (let index = start; index <= start + SCHEDULED_WEATHER_LIMITS.requiredFutureHours; index += 1) {
    if (localTimeMilliseconds(times[index]) !== localTimeMilliseconds(alignedHour) + (index - start) * 3_600_000) {
      throw new Error('hourly weather times are not consecutive')
    }
  }

  const probabilitySeries = value.hourly.precipitation_probability as unknown[]
  const current = readPoint(value.current, currentTime, probabilitySeries[start], 'current')
  const nextFourHours: ScheduledWeatherPoint[] = []
  for (let index = start + 1; index <= start + SCHEDULED_WEATHER_LIMITS.requiredFutureHours; index += 1) {
    const source: Record<string, unknown> = {}
    for (const key of pointKeys) source[key] = (value.hourly[key] as unknown[])[index]
    nextFourHours.push(readPoint(source, times[index], probabilitySeries[index], `hourly[${index}]`))
  }

  return {
    observed_at: new Date(observedAtMs).toISOString(),
    local_date: currentTime.slice(0, 10),
    utc_offset_seconds: offset,
    current,
    next_four_hours: nextFourHours,
  }
}

function pointIsClearlyGood(value: ScheduledWeatherPoint) {
  const limits = SCHEDULED_WEATHER_LIMITS
  return value.temperature_2m >= limits.minimumTemperatureF
    && value.temperature_2m <= limits.maximumTemperatureF
    && value.wind_speed_10m >= limits.minimumWindMph
    && value.wind_speed_10m <= limits.maximumWindMph
    && value.wind_gusts_10m <= limits.maximumGustMph
    && value.precipitation === 0
    && value.rain === 0
    && value.precipitation_probability < limits.maximumPrecipitationProbability
    && value.weather_code >= 0
    && value.weather_code <= 3
}

/** Product-agnostic guidance only. The notification and UI must continue to
 * tell the applicator to follow the product label and their own judgment. */
export function scheduledSprayIsGood(value: ScheduledWeatherObservation) {
  return pointIsClearlyGood(value.current)
    && value.next_four_hours.length === SCHEDULED_WEATHER_LIMITS.requiredFutureHours
    && value.next_four_hours.every(pointIsClearlyGood)
}

export function localDateFromForecast(value: ScheduledWeatherObservation) {
  return value.local_date
}
