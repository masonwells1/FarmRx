import type { CurrentConditions, DailyForecast, ForecastBundle, HourlyForecast, SprayContext, SprayLevel, SprayVerdict, SprayWindow, WeatherSample } from './weather'
import type { StorageLike } from './writeQueue'

export const weatherCacheVersion = 'v1'
const cacheAgeMs = 30 * 60 * 1000
type Deps = { fetch: typeof fetch; clock: () => Date; storage: StorageLike }
type CacheEnvelope = { version: 1; fetched_at: string; bundle: Omit<ForecastBundle, 'stale'> }
const rank: Record<SprayLevel, number> = { good: 0, caution: 1, poor: 2 }
const at = (time: string) => Date.parse(time)
const number = (value: unknown, label: string) => { const result = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN; if (!Number.isFinite(result)) throw new Error(`Weather ${label} was unavailable.`); return result }
const array = (value: unknown, label: string) => { if (!Array.isArray(value)) throw new Error(`Weather ${label} was unavailable.`); return value }
const text = (value: unknown, label: string) => { if (typeof value !== 'string') throw new Error(`Weather ${label} was unavailable.`); return value }
const nullableNumber = (value: unknown) => value === null || value === undefined ? null : number(value, 'data')
const records = (value: unknown) => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Weather data was unavailable.'); return value as Record<string, unknown> }
const timestamp = (value: unknown, label: string) => { const result = text(value, label); if (!Number.isFinite(at(result))) throw new Error(`Weather ${label} was unavailable.`); return result }

export function weatherCacheKey(lat: number, lon: number) { return `farm-rx-weather:${weatherCacheVersion}:${lat.toFixed(3)}:${lon.toFixed(3)}` }
function parseCache(raw: string): CacheEnvelope { const data = records(JSON.parse(raw)); if (data.version !== 1 || typeof data.fetched_at !== 'string' || !Number.isFinite(at(data.fetched_at)) || !data.bundle || typeof data.bundle !== 'object') throw new Error('Saved forecast needs to be refreshed.'); return data as unknown as CacheEnvelope }
function sample(values: Record<string, unknown>, index?: number): WeatherSample {
  const value = (key: string) => index === undefined ? values[key] : array(values[key], key)[index]
  return { time: timestamp(value('time'), 'time'), temperature_f: number(value('temperature_2m'), 'temperature'), relative_humidity: number(value('relative_humidity_2m'), 'humidity'), precipitation_in: number(value('precipitation'), 'rain'), precipitation_probability: nullableNumber(value('precipitation_probability')), wind_speed_mph: number(value('wind_speed_10m'), 'wind'), wind_direction_degrees: number(value('wind_direction_10m'), 'wind direction'), wind_gusts_mph: number(value('wind_gusts_10m'), 'gusts'), cloud_cover: number(value('cloud_cover'), 'cloud cover') }
}
function nonEmptyArray(value: unknown, label: string) { const result = array(value, label); if (!result.length) throw new Error(`Weather ${label} was unavailable.`); return result }
function aligned(values: Record<string, unknown>, key: string, length: number) { const result = nonEmptyArray(values[key], key); if (result.length !== length) throw new Error(`Weather ${key} was unavailable.`); return result }
function cachedSample(values: Record<string, unknown>, index?: number): WeatherSample {
  const value = (key: string) => index === undefined ? values[key] : aligned(values, key, aligned(values, 'time', nonEmptyArray(values.time, 'time').length).length)[index]
  return { time: timestamp(value('time'), 'time'), temperature_f: number(value('temperature_f'), 'temperature'), relative_humidity: number(value('relative_humidity'), 'humidity'), precipitation_in: number(value('precipitation_in'), 'rain'), precipitation_probability: nullableNumber(value('precipitation_probability')), wind_speed_mph: number(value('wind_speed_mph'), 'wind'), wind_direction_degrees: number(value('wind_direction_degrees'), 'wind direction'), wind_gusts_mph: number(value('wind_gusts_mph'), 'gusts'), cloud_cover: number(value('cloud_cover'), 'cloud cover') }
}
function usableDaylight(value: string | null, label: string) { if (value === null || !Number.isFinite(at(value))) throw new Error(`Weather ${label} was unavailable.`); return value }
function validateBundle(payload: unknown, fetched_at: string): Omit<ForecastBundle, 'stale'> {
  if (!Number.isFinite(at(fetched_at))) throw new Error('Weather fetch time was unavailable.')
  const root = records(payload); const current = cachedSample(records(root.current)); const hourly = nonEmptyArray(root.hourly, 'hourly forecast').map((hour) => cachedSample(records(hour))) as HourlyForecast[]
  const daily = nonEmptyArray(root.daily, 'daily forecast').map((value) => { const day = records(value); return { date: text(day.date, 'date'), precipitation_sum_in: number(day.precipitation_sum_in, 'daily rain'), precipitation_probability_max: nullableNumber(day.precipitation_probability_max), temperature_max_f: number(day.temperature_max_f, 'daily high'), temperature_min_f: number(day.temperature_min_f, 'daily low'), sunrise: day.sunrise === null ? null : text(day.sunrise, 'sunrise'), sunset: day.sunset === null ? null : text(day.sunset, 'sunset') } }) as DailyForecast[]
  const today = daily.find((day) => day.date === current.time.slice(0, 10)); if (!today) throw new Error('Weather daylight data was unavailable.')
  const sunrise = usableDaylight(today.sunrise, 'sunrise'); const sunset = usableDaylight(today.sunset, 'sunset'); if (at(sunrise) >= at(sunset)) throw new Error('Weather daylight data was unavailable.')
  return { current: current as CurrentConditions, hourly, daily, fetched_at }
}
function normalize(payload: unknown, fetched_at: string): Omit<ForecastBundle, 'stale'> {
  const root = records(payload); const current = sample(records(root.current)); const hourlyRaw = records(root.hourly); const times = nonEmptyArray(hourlyRaw.time, 'hourly time'); ['temperature_2m', 'relative_humidity_2m', 'precipitation', 'precipitation_probability', 'wind_speed_10m', 'wind_direction_10m', 'wind_gusts_10m', 'cloud_cover'].forEach((key) => aligned(hourlyRaw, key, times.length)); const hourly: HourlyForecast[] = times.map((_, index) => sample(hourlyRaw, index)); const dailyRaw = records(root.daily); const dates = nonEmptyArray(dailyRaw.time, 'daily time'); const daily: DailyForecast[] = dates.map((_, index) => ({ date: text(aligned(dailyRaw, 'time', dates.length)[index], 'date'), precipitation_sum_in: number(aligned(dailyRaw, 'precipitation_sum', dates.length)[index], 'daily rain'), precipitation_probability_max: nullableNumber(aligned(dailyRaw, 'precipitation_probability_max', dates.length)[index]), temperature_max_f: number(aligned(dailyRaw, 'temperature_2m_max', dates.length)[index], 'daily high'), temperature_min_f: number(aligned(dailyRaw, 'temperature_2m_min', dates.length)[index], 'daily low'), sunrise: aligned(dailyRaw, 'sunrise', dates.length)[index] === null ? null : text(aligned(dailyRaw, 'sunrise', dates.length)[index], 'sunrise'), sunset: aligned(dailyRaw, 'sunset', dates.length)[index] === null ? null : text(aligned(dailyRaw, 'sunset', dates.length)[index], 'sunset') })); return validateBundle({ current, hourly, daily }, fetched_at)
}

export function createWeatherService(deps: Deps) {
  async function fetchForecast(lat: number, lon: number): Promise<ForecastBundle> {
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error('Enter a valid field location.')
    const key = weatherCacheKey(lat, lon); const now = deps.clock(); let cached: Omit<ForecastBundle, 'stale'> | null = null
    try { const raw = deps.storage.getItem(key); if (raw) { const envelope = parseCache(raw); cached = validateBundle(envelope.bundle, envelope.fetched_at) } } catch { cached = null }
    if (cached && now.getTime() - at(cached.fetched_at) < cacheAgeMs) return { ...cached, stale: false }
    const query = new URLSearchParams({ latitude: String(lat), longitude: String(lon), current: 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover', hourly: 'temperature_2m,relative_humidity_2m,precipitation,precipitation_probability,wind_speed_10m,wind_direction_10m,wind_gusts_10m,cloud_cover', daily: 'precipitation_sum,precipitation_probability_max,temperature_2m_max,temperature_2m_min,sunrise,sunset', temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', precipitation_unit: 'inch', timezone: 'auto', forecast_days: '7' })
    try { const response = await deps.fetch(`https://api.open-meteo.com/v1/forecast?${query}`); if (!response.ok) throw new Error('Weather service did not respond.'); const fetched_at = now.toISOString(); const bundle = normalize(await response.json(), fetched_at); const envelope: CacheEnvelope = { version: 1, fetched_at, bundle }; try { deps.storage.setItem(key, JSON.stringify(envelope)) } catch { /* Caching is optional; live weather remains usable. */ } return { ...bundle, stale: false } } catch (error) { if (cached) return { ...cached, stale: true }; throw new Error('Forecast unavailable — reconnect for the latest.') }
  }
  return { fetchForecast }
}
export const weatherService = typeof window === 'undefined' ? null : createWeatherService({ fetch: window.fetch.bind(window), clock: () => new Date(), storage: window.localStorage })

function daylight(time: string, sunrise: string | null, sunset: string | null) { if (!sunrise || !sunset) return false; const value = at(time); const start = at(sunrise); const end = at(sunset); return Number.isFinite(value) && Number.isFinite(start) && Number.isFinite(end) && value >= start && value <= end }
function inversionLikely(sample: WeatherSample, ctx: SprayContext) { if (sample.wind_speed_mph >= 3) return false; if (!ctx.sunrise || !ctx.sunset) return false; const hour = at(sample.time); return hour < at(ctx.sunrise) || hour > at(ctx.sunset) || hour <= at(ctx.sunrise) + 2 * 60 * 60 * 1000 }
function rainSoon(sample: WeatherSample, ctx: SprayContext) { const now = at(sample.time); return ctx.hourly.filter((hour) => at(hour.time) > now && at(hour.time) <= now + 4 * 60 * 60 * 1000).find((hour) => hour.precipitation_in > 0 || (hour.precipitation_probability ?? 0) >= 50) ?? null }
function hoursAway(from: string, to: string) { return Math.max(0, Math.round((at(to) - at(from)) / 3600000)) }
export function evaluateSprayWindow(sample: WeatherSample, ctx: SprayContext): SprayVerdict {
  const parts: Array<{ level: SprayLevel; reason: string }> = []
  if (sample.wind_speed_mph < 3) parts.push({ level: inversionLikely(sample, ctx) && ctx.inversionDriftProne ? 'poor' : 'caution', reason: inversionLikely(sample, ctx) ? 'very calm — possible temperature-inversion drift risk' : 'very calm — temperature-inversion drift risk' })
  else if (sample.wind_speed_mph <= 10) parts.push({ level: 'good', reason: 'wind is in the 3–10 mph range' })
  else if (sample.wind_speed_mph <= 15) parts.push({ level: 'caution', reason: `getting windy — ${formatMph(sample.wind_speed_mph)}` })
  else parts.push({ level: 'poor', reason: `too windy — ${formatMph(sample.wind_speed_mph)}, gusting ${formatMph(sample.wind_gusts_mph)}` })
  if (sample.precipitation_in > 0) parts.push({ level: 'poor', reason: 'rain is falling — product needs a dry window' })
  else if ((sample.precipitation_probability ?? 0) >= 70) parts.push({ level: 'poor', reason: `${Math.round(sample.precipitation_probability!)}% chance of rain this hour — product needs a dry window` })
  else if ((sample.precipitation_probability ?? 0) >= 50) parts.push({ level: 'caution', reason: `${Math.round(sample.precipitation_probability!)}% chance of rain this hour — product needs a dry window` })
  const rain = rainSoon(sample, ctx); if (rain) { const near = hoursAway(sample.time, rain.time); parts.push({ level: near <= 1 && (rain.precipitation_probability ?? 0) >= 70 ? 'poor' : 'caution', reason: `rain in ~${near || 1} h — product needs a dry window` }) }
  if (sample.temperature_f > 85) parts.push({ level: 'caution', reason: `hot — ${formatF(sample.temperature_f)}, higher evaporation/volatility` })
  const level = parts.reduce<SprayLevel>((worst, part) => rank[part.level] > rank[worst] ? part.level : worst, 'good')
  return { level, reasons: parts.filter((part) => part.level === level).map((part) => part.reason) }
}
export function bestWindowToday(hours: WeatherSample[], ctx: SprayContext): SprayWindow | null { const remaining = hours.filter((hour) => at(hour.time) >= at(ctx.now) && daylight(hour.time, ctx.sunrise, ctx.sunset)); let best: WeatherSample[] = []; let run: WeatherSample[] = []; for (const hour of remaining) { if (evaluateSprayWindow(hour, ctx).level === 'good') run.push(hour); else { if (run.length > best.length) best = run; run = [] } } if (run.length > best.length) best = run; if (!best.length) return null; const end = new Date(at(best.at(-1)!.time) + 3600000).toISOString(); return { start: best[0].time, end, hours: best.length, label: `Best window today: ~${formatHour(best[0].time)}–${formatHour(end)}` } }
export function compassLabel(degrees: number) { const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']; return directions[Math.round((((degrees % 360) + 360) % 360) / 45) % 8] }
export function formatF(value: number) { return `${Math.round(value)}°F` }
export function formatMph(value: number) { return `${Math.round(value)} mph` }
export function formatHour(value: string) { return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(value)) }
