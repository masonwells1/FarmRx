export type ManualSprayRecordIntent = Readonly<{ kind: 'manual-spray-record'; version: 1 }>
export const sprayWindDirections = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const
export type SprayWindDirection = typeof sprayWindDirections[number]
export type WeatherSprayPrefillIntent = Readonly<{ kind: 'weather-spray-prefill'; version: 1; fieldId: string; applicationDate: string; temperatureF: number; windSpeedMph: number; windDirection: SprayWindDirection }>
export type WeatherSprayHandoff = ManualSprayRecordIntent | WeatherSprayPrefillIntent

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const directionSet = new Set<string>(sprayWindDirections)
const minimumTemperatureF = -100
const maximumTemperatureF = 160
const maximumWindSpeedMph = 250

function validISODate(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function isWeatherSprayPrefillShape(value: unknown): value is WeatherSprayPrefillIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return Object.keys(row).sort().join(',') === 'applicationDate,fieldId,kind,temperatureF,version,windDirection,windSpeedMph'
    && row.kind === 'weather-spray-prefill'
    && row.version === 1
    && typeof row.fieldId === 'string' && uuid.test(row.fieldId)
    && validISODate(row.applicationDate)
    && typeof row.temperatureF === 'number' && Number.isFinite(row.temperatureF) && row.temperatureF >= minimumTemperatureF && row.temperatureF <= maximumTemperatureF
    && typeof row.windSpeedMph === 'number' && Number.isFinite(row.windSpeedMph) && row.windSpeedMph >= 0 && row.windSpeedMph <= maximumWindSpeedMph
    && typeof row.windDirection === 'string' && directionSet.has(row.windDirection)
}

export const manualSprayRecordIntent: ManualSprayRecordIntent = Object.freeze({
  kind: 'manual-spray-record',
  version: 1,
})

export function isManualSprayRecordIntent(value: unknown): value is ManualSprayRecordIntent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return Object.keys(row).sort().join(',') === 'kind,version'
    && row.kind === 'manual-spray-record'
    && row.version === 1
}

export function createWeatherSprayPrefillIntent(value: WeatherSprayPrefillIntent): WeatherSprayPrefillIntent {
  const parsed = parseWeatherSprayHandoff(value)
  if (!parsed || parsed.kind !== 'weather-spray-prefill') throw new Error('Weather spray prefill was invalid.')
  return parsed
}

export function isWeatherSprayPrefillIntent(value: unknown): value is WeatherSprayPrefillIntent {
  return isWeatherSprayPrefillShape(value)
}

/**
 * Route state is untrusted browser input. Accept only the two exact, versioned
 * handoff shapes and copy weather values before a form can use them.
 */
export function parseWeatherSprayHandoff(value: unknown): WeatherSprayHandoff | null {
  if (isManualSprayRecordIntent(value)) return manualSprayRecordIntent
  if (!isWeatherSprayPrefillShape(value)) return null
  return Object.freeze({
    kind: 'weather-spray-prefill',
    version: 1,
    fieldId: value.fieldId,
    applicationDate: value.applicationDate,
    temperatureF: value.temperatureF,
    windSpeedMph: value.windSpeedMph,
    windDirection: value.windDirection,
  })
}
