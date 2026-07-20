import type { ForecastBundle } from './weather'
import { compassLabel, isActionablyFresh, sprayJudgmentMaxAgeMs } from './weatherService'

const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
export type WeatherSprayDirection = typeof directions[number]

export type WeatherSprayHandoff = {
  kind: 'weather-spray-handoff'
  version: 1
  fieldId: string
  sampleTime: string
  fetchedAt: string
  windSpeedMph: number
  windDirection: WeatherSprayDirection
  temperatureF: number
  relativeHumidityPct: number
}

export type WeatherSprayPrefill = WeatherSprayHandoff & {
  applicationDate: string
  applicationTime: string
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const sampleWallClock = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?$/
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function isWeatherSprayHandoffIntent(value: unknown) {
  return record(value) && value.kind === 'weather-spray-handoff'
}

export function createWeatherSprayHandoff(fieldId: string, bundle: Pick<ForecastBundle, 'current' | 'fetched_at' | 'stale'>, nowMs = Date.now()): WeatherSprayHandoff | null {
  if (!uuid.test(fieldId) || !isActionablyFresh(bundle, nowMs)) return null
  return {
    kind: 'weather-spray-handoff',
    version: 1,
    fieldId,
    sampleTime: bundle.current.time,
    fetchedAt: bundle.fetched_at,
    windSpeedMph: bundle.current.wind_speed_mph,
    windDirection: compassLabel(bundle.current.wind_direction_degrees) as WeatherSprayDirection,
    temperatureF: bundle.current.temperature_f,
    relativeHumidityPct: bundle.current.relative_humidity,
  }
}

export function parseWeatherSprayHandoff(value: unknown, validFieldIds: readonly string[], nowMs = Date.now()): WeatherSprayPrefill | null {
  if (!record(value)) return null
  const keys = Object.keys(value).sort().join(',')
  const expected = ['fetchedAt', 'fieldId', 'kind', 'relativeHumidityPct', 'sampleTime', 'temperatureF', 'version', 'windDirection', 'windSpeedMph'].sort().join(',')
  if (keys !== expected || value.kind !== 'weather-spray-handoff' || value.version !== 1 || typeof value.fieldId !== 'string' || !uuid.test(value.fieldId) || !validFieldIds.includes(value.fieldId)) return null
  if (typeof value.sampleTime !== 'string' || typeof value.fetchedAt !== 'string' || !sampleWallClock.test(value.sampleTime)) return null
  const sample = sampleWallClock.exec(value.sampleTime)
  const fetchedAt = Date.parse(value.fetchedAt)
  const age = nowMs - fetchedAt
  if (!sample || !Number.isFinite(Date.parse(value.sampleTime)) || !Number.isFinite(fetchedAt) || age < -5 * 60 * 1000 || age > sprayJudgmentMaxAgeMs) return null
  if (!finite(value.windSpeedMph) || value.windSpeedMph < 0 || value.windSpeedMph > 250 || !directions.includes(value.windDirection as WeatherSprayDirection)) return null
  if (!finite(value.temperatureF) || value.temperatureF < -100 || value.temperatureF > 150 || !finite(value.relativeHumidityPct) || value.relativeHumidityPct < 0 || value.relativeHumidityPct > 100) return null
  return {
    kind: 'weather-spray-handoff',
    version: 1,
    fieldId: value.fieldId,
    sampleTime: value.sampleTime,
    fetchedAt: value.fetchedAt,
    windSpeedMph: value.windSpeedMph,
    windDirection: value.windDirection as WeatherSprayDirection,
    temperatureF: value.temperatureF,
    relativeHumidityPct: value.relativeHumidityPct,
    applicationDate: sample[1],
    applicationTime: sample[2],
  }
}
