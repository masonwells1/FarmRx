import { createFieldLocationClient, mapFieldLocationEcho, type FieldLocationGateway } from './fieldLocation'
import { fieldsSeedForRegression } from './MockFieldsRepository'
import { mapField } from './SupabaseFieldsRepository'
import { bestWindowToday, compassLabel, createWeatherService, evaluateSprayWindow, growingDegreeDays, hasContinuousDailyHistory, isActionablyFresh, latestSafeArchiveDate, sprayJudgmentMaxAgeMs, weatherCacheKey, weatherHistoryCacheKey } from './weatherService'
import type { WeatherSample } from './weather'

function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
async function rejects(action: () => Promise<unknown>, message: string) { let failed = false; try { await action() } catch { failed = true }; assert(failed, message) }
function throws(action: () => unknown, message: string) { let failed = false; try { action() } catch { failed = true }; assert(failed, message) }
class Storage {
  values = new Map<string, string>(); throwOnGet = false; throwOnSet = false
  getItem(key: string) { if (this.throwOnGet) throw new Error('storage unavailable'); return this.values.get(key) ?? null }
  setItem(key: string, value: string) { if (this.throwOnSet) throw new Error('storage unavailable'); this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}
const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`
const sample = (patch: Partial<WeatherSample> = {}): WeatherSample => ({ time: '2026-07-12T10:00', temperature_f: 72, relative_humidity: 65, precipitation_in: 0, precipitation_probability: 0, wind_speed_mph: 6, wind_direction_degrees: 90, wind_gusts_mph: 8, cloud_cover: 20, ...patch })
const context = (patch: Partial<Parameters<typeof evaluateSprayWindow>[1]> = {}) => ({ now: '2026-07-12T10:00', hourly: [sample(), sample({ time: '2026-07-12T11:00' }), sample({ time: '2026-07-12T12:00' }), sample({ time: '2026-07-12T13:00' })], sunrise: '2026-07-12T05:45', sunset: '2026-07-12T20:20', ...patch })
const payload = { current: { time: '2026-07-12T10:00', temperature_2m: 72, relative_humidity_2m: 65, precipitation: 0, wind_speed_10m: 6, wind_direction_10m: 90, wind_gusts_10m: 8, cloud_cover: 20 }, hourly: { time: ['2026-07-12T10:00'], temperature_2m: [72], relative_humidity_2m: [65], precipitation: [0], precipitation_probability: [0], wind_speed_10m: [6], wind_direction_10m: [90], wind_gusts_10m: [8], cloud_cover: [20] }, daily: { time: ['2026-07-12'], precipitation_sum: [0], precipitation_probability_max: [0], temperature_2m_max: [82], temperature_2m_min: [61], sunrise: ['2026-07-12T05:45'], sunset: ['2026-07-12T20:20'] } }
const clone = <T,>(value: T): T => structuredClone(value)
const response = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
const historyPayload = (dates: string[], highs = dates.map(() => 80), lows = dates.map(() => 60)) => ({ daily: { time: dates, temperature_2m_max: highs, temperature_2m_min: lows } })

async function run() {
  // Group 1: spray boundaries, including the evaluated hour's rain chance.
  assert(evaluateSprayWindow(sample({ wind_speed_mph: 2, time: '2026-07-12T06:00' }), context()).level === 'caution', 'Calm dawn weather must be caution by default.')
  assert(evaluateSprayWindow(sample({ wind_speed_mph: 2, time: '2026-07-12T06:00' }), context({ inversionDriftProne: true })).level === 'poor', 'Drift-prone inversion estimate must be poor.')
  assert(evaluateSprayWindow(sample({ wind_speed_mph: 3 }), context()).level === 'good' && evaluateSprayWindow(sample({ wind_speed_mph: 10 }), context()).level === 'good', 'The ideal wind band must be good at both boundaries.')
  assert(evaluateSprayWindow(sample({ wind_speed_mph: 10.1 }), context()).level === 'caution', 'Wind above 10 mph must be caution.')
  assert(evaluateSprayWindow(sample({ wind_speed_mph: 15.1, wind_gusts_mph: 22 }), context()).level === 'poor', 'Wind above 15 mph must be poor.')
  assert(evaluateSprayWindow(sample(), context({ hourly: [sample(), sample({ time: '2026-07-12T12:00', precipitation_probability: 70 })] })).level === 'caution', 'Future rain within four hours must be caution.')
  const ownRain = evaluateSprayWindow(sample({ precipitation_probability: 90 }), context()); assert(ownRain.level === 'poor' && ownRain.reasons.filter((reason) => reason.includes('chance of rain this hour')).length === 1, 'A 90% chance of rain this hour must never be good or duplicate its reason.')
  assert(evaluateSprayWindow(sample({ precipitation_probability: 50 }), context()).level === 'caution', 'A 50% chance of rain this hour must be caution.')
  assert(evaluateSprayWindow(sample({ temperature_f: 86 }), context()).level === 'caution', 'Heat above 85 F must be caution.')
  assert(evaluateSprayWindow(sample({ temperature_f: 90, wind_speed_mph: 16 }), context()).level === 'poor', 'Worst-of composition must keep the poor wind verdict.')

  // Group 2: best-window scan, local Open-Meteo timestamps, and a DST-adjacent day.
  const hours = [sample({ time: '2026-07-12T08:00' }), sample({ time: '2026-07-12T09:00' }), sample({ time: '2026-07-12T10:00', wind_speed_mph: 12 }), sample({ time: '2026-07-12T11:00' })]
  assert(bestWindowToday(hours, context({ now: hours[0].time }))?.hours === 2, 'Best window must select the longest good run.')
  assert(bestWindowToday(hours.map((hour) => ({ ...hour, wind_speed_mph: 16 })), context({ now: hours[0].time })) === null, 'No good hours must return none.')
  const dstHours = [sample({ time: '2026-11-01T01:00' }), sample({ time: '2026-11-01T02:00' })]
  assert(bestWindowToday(dstHours, context({ now: dstHours[0].time, hourly: dstHours, sunrise: '2026-11-01T06:20', sunset: '2026-11-01T17:00' })) === null, 'DST-adjacent local timestamps must respect daylight instead of inventing a window.')
  assert(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'].map((label, index) => compassLabel(index * 45) === label).every(Boolean), 'Compass mapping must cover all eight directions.')

  // Group 3: incomplete network forecasts are unavailable unless a valid stale forecast exists.
  const unavailable = async (body: unknown, message: string) => rejects(() => createWeatherService({ storage: new Storage(), clock: () => new Date('2026-07-12T15:00:00Z'), fetch: async () => response(body) }).fetchForecast(38, -88), message)
  const emptyHourly = clone(payload); emptyHourly.hourly.time = []; await unavailable(emptyHourly, 'An empty hourly array must not produce a spray verdict.')
  const emptyDaily = clone(payload); emptyDaily.daily.time = []; await unavailable(emptyDaily, 'An empty daily array must not produce a spray verdict.')
  const noSunrise = clone(payload); delete (noSunrise.daily as Partial<typeof noSunrise.daily>).sunrise; await unavailable(noSunrise, 'Missing sunrise data must not produce a spray verdict.')
  const misaligned = clone(payload); misaligned.hourly.wind_speed_10m = [6, 7]; await unavailable(misaligned, 'Misaligned hourly arrays must not produce a spray verdict.')
  const emptyCurrent = clone(payload); emptyCurrent.current = {} as typeof emptyCurrent.current; await unavailable(emptyCurrent, 'An empty current forecast must not produce a spray verdict.')
  const staleStorage = new Storage(); let staleNow = new Date('2026-07-12T15:00:00Z'); const live = createWeatherService({ storage: staleStorage, clock: () => staleNow, fetch: async () => response(payload) }); await live.fetchForecast(38, -88); staleNow = new Date(staleNow.getTime() + 31 * 60 * 1000); const stale = await createWeatherService({ storage: staleStorage, clock: () => staleNow, fetch: async () => response(emptyHourly) }).fetchForecast(38, -88); assert(stale.stale, 'A valid stale cache must be used when a new forecast is incomplete.')
  staleNow = new Date(staleNow.getTime() + sprayJudgmentMaxAgeMs); await rejects(() => createWeatherService({ storage: staleStorage, clock: () => staleNow, fetch: async () => response(emptyHourly) }).fetchForecast(38, -88), 'A forecast older than the two-hour spray-judgment ceiling must never be served after a failed refresh.')

  // Group 4: corrupt cache bodies are ignored and storage is best-effort.
  const cacheStorage = new Storage(); const cacheKey = weatherCacheKey(38, -88); cacheStorage.setItem(cacheKey, JSON.stringify({ version: 1, fetched_at: '2026-07-12T15:00:00.000Z', bundle: {} })); let cacheCalls = 0; const cacheService = createWeatherService({ storage: cacheStorage, clock: () => new Date('2026-07-12T15:01:00Z'), fetch: async () => { cacheCalls += 1; return response(payload) } }); const cacheLive = await cacheService.fetchForecast(38, -88); assert(cacheCalls === 1 && cacheLive.current.time === payload.current.time, 'A corrupt cache body must be ignored instead of served.')
  const failingStorage = new Storage(); failingStorage.throwOnGet = true; failingStorage.throwOnSet = true; const uncachedLive = await createWeatherService({ storage: failingStorage, clock: () => new Date('2026-07-12T15:00:00Z'), fetch: async () => response(payload) }).fetchForecast(38, -88); assert(!uncachedLive.stale && uncachedLive.current.temperature_f === 72, 'Storage failures must not hide a good live forecast.')

  // Group 5: RPC echoes and the live Field mapper fail closed on location provenance.
  const farmId = id(1); const fieldId = id(2); const good = mapFieldLocationEcho({ id: fieldId, farm_id: farmId, latitude: '38', longitude: '-88', location_source: 'gps' }, { farmId, fieldId }); assert(good.latitude === 38, 'String-numeric location echoes must map.')
  throws(() => mapFieldLocationEcho({ id: id(3), farm_id: farmId, latitude: 38, longitude: -88, location_source: 'gps' }, { farmId, fieldId }), 'A field-ID echo mismatch must fail closed.')
  const rawField = fieldsSeedForRegression().fields[0]
  assert(mapField({ ...rawField, latitude: null, longitude: null, location_source: null }).location_source === null, 'A null point with null provenance must map.')
  assert(mapField({ ...rawField, latitude: '38.125', longitude: '-88.125', location_source: 'gps' }).latitude === 38.125, 'Numeric and string-numeric coordinates must map.')
  throws(() => mapField({ ...rawField, latitude: 38, longitude: null, location_source: 'manual' }), 'A half-set location must fail closed.')
  throws(() => mapField({ ...rawField, latitude: null, longitude: null, location_source: 'gps' }), 'Coordinates and provenance must agree.')
  throws(() => mapField({ ...rawField, latitude: 38, longitude: -88, location_source: null }), 'A coordinate pair requires provenance.')

  // Group 6: offline replay is idempotent and a pin queued during an in-flight replay survives.
  let online = false; let nextId = 10; const next = () => id(nextId++); const queueStorage = new Storage(); const calls: Array<{ latitude: number; longitude: number }> = []
  const gateway: FieldLocationGateway = { setFieldLocation: async (input) => { calls.push({ latitude: input.latitude, longitude: input.longitude }); return { id: input.fieldId, farm_id: input.farmId, latitude: input.latitude, longitude: input.longitude, location_source: input.source } } }
  const client = createFieldLocationClient({ gateway, getContext: async () => ({ userId: id(4), farmId }), projectRef: 'test', storage: queueStorage, createId: next, clock: () => '2026-07-12T15:00:00.000Z', isOffline: () => !online })
  await client.saveLocation(fieldId, 38, -88, 'manual'); online = true; await client.replay(); await client.replay(); assert(calls.length === 1, 'Replaying a confirmed offline pin twice must not duplicate its RPC.')
  online = false; let startSend!: () => void; const sending = new Promise<void>((resolve) => { startSend = resolve }); let releaseSend!: () => void; const held = new Promise<void>((resolve) => { releaseSend = resolve }); const raceStorage = new Storage(); const raceCalls: number[] = []
  const raceGateway: FieldLocationGateway = { setFieldLocation: async (input) => { raceCalls.push(input.latitude); if (raceCalls.length === 1) { startSend(); await held } return { id: input.fieldId, farm_id: input.farmId, latitude: input.latitude, longitude: input.longitude, location_source: input.source } } }
  const raceClient = createFieldLocationClient({ gateway: raceGateway, getContext: async () => ({ userId: id(5), farmId }), projectRef: 'race', storage: raceStorage, createId: next, clock: () => '2026-07-12T15:00:00.000Z', isOffline: () => !online })
  await raceClient.saveLocation(fieldId, 38, -88, 'manual'); await raceClient.replay(); online = true; const replayA = raceClient.replay(); await sending; online = false; const queueB = raceClient.saveLocation(fieldId, 39, -89, 'gps'); releaseSend(); await replayA; await queueB
  const queuedBytes = [...raceStorage.values.entries()].find(([storageKey]) => storageKey.includes('farm-rx-field-location-queue:'))?.[1]; const queued = queuedBytes ? JSON.parse(queuedBytes).entries : []; assert(queued.length === 1 && queued[0].latitude === 39, 'A pin queued during A\'s in-flight send must survive in the queue.')
  online = true; await raceClient.replay(); await raceClient.replay(); assert(raceCalls.join('|') === '38|39', 'The surviving pin must replay exactly once after reconnecting.')

  // Group 7: archive-backed GDD requires a lag-safe, complete daily history range.
  const historyNow = new Date('2026-07-12T15:00:00Z'); assert(latestSafeArchiveDate(historyNow) === '2026-07-07', 'The archive end cap must stay five full days behind today.')
  let requestedHistoryUrl = ''; const fullHistory = historyPayload(['2026-07-05', '2026-07-06', '2026-07-07'])
  const historyService = createWeatherService({ storage: new Storage(), clock: () => historyNow, fetch: async (url) => { requestedHistoryUrl = String(url); return response(fullHistory) } })
  const history = await historyService.fetchDailyHistory(38, -88, '2026-07-05', '2026-07-12'); assert(history.daily.length === 3 && requestedHistoryUrl.includes('end_date=2026-07-07'), 'GDD history must request only through the archive lag cap and accept a complete range.')
  await rejects(() => createWeatherService({ storage: new Storage(), clock: () => historyNow, fetch: async () => response(historyPayload(['2026-07-07'])) }).fetchDailyHistory(38, -88, '2026-07-05', '2026-07-12'), 'A one-day partial history must never become a season GDD total.')
  await rejects(() => createWeatherService({ storage: new Storage(), clock: () => historyNow, fetch: async () => response(fullHistory) }).fetchDailyHistory(38, -88, '2026-07-12', '2026-07-12'), 'A future planting date without archive history must not produce GDD.')
  assert(!hasContinuousDailyHistory([{ date: '2026-07-05', temperature_max_f: 80, temperature_min_f: 60 }, { date: '2026-07-07', temperature_max_f: 80, temperature_min_f: 60 }], '2026-07-05', '2026-07-07'), 'Missing calendar days must fail continuous GDD coverage.')
  const corruptHistoryStorage = new Storage(); corruptHistoryStorage.setItem(weatherHistoryCacheKey(38, -88, '2026-07-05', '2026-07-07'), JSON.stringify({ version: 1, fetched_at: historyNow.toISOString(), daily: [{ date: '2026-07-07', temperature_max_f: 80, temperature_min_f: 60 }] })); let corruptHistoryCalls = 0
  const refreshedHistory = await createWeatherService({ storage: corruptHistoryStorage, clock: () => historyNow, fetch: async () => { corruptHistoryCalls += 1; return response(fullHistory) } }).fetchDailyHistory(38, -88, '2026-07-05', '2026-07-12'); assert(corruptHistoryCalls === 1 && refreshedHistory.daily.length === 3, 'A corrupt short history cache must be ignored and refreshed, not rendered as GDD.')

  // Group 8: pure growing-degree-day math keeps below-base days at zero and rounds only after the full sum.
  assert(growingDegreeDays([{ date: '2026-05-01', temperature_max_f: 48, temperature_min_f: 36 }]) === 0, 'Below-base days must add zero GDD.')
  assert(growingDegreeDays([{ date: '2026-05-02', temperature_max_f: 80, temperature_min_f: 60 }]) === 20, 'An above-base day must use the average high and low.')
  assert(growingDegreeDays([{ date: '2026-05-03', temperature_max_f: 40, temperature_min_f: 20 }, { date: '2026-05-04', temperature_max_f: 70, temperature_min_f: 50 }]) === 10, 'Negative daily values must clamp before summing.')
  assert(growingDegreeDays([{ date: '2026-05-05', temperature_max_f: 53, temperature_min_f: 50 }]) === 2, 'Fractional daily GDD must round the final farmer-facing total.')
  assert(growingDegreeDays([]) === 0, 'An empty history range must have zero GDD.')
  // Group 9: the ONE shared actionability gate — a stale or over-age bundle can never be actionable.
  const gateNow = Date.parse('2026-07-14T12:00:00Z')
  assert(isActionablyFresh({ stale: false, fetched_at: '2026-07-14T11:00:00Z' }, gateNow) === true, 'A fresh in-cap bundle is actionable.')
  assert(isActionablyFresh({ stale: true, fetched_at: '2026-07-14T11:59:00Z' }, gateNow) === false, 'A stale-flagged bundle is never actionable, no matter how recent.')
  assert(isActionablyFresh({ stale: false, fetched_at: '2026-07-14T09:59:00Z' }, gateNow) === false, 'A bundle older than the spray-judgment cap is never actionable.')
  console.log('Weather service regressions passed (9 coverage groups).')
}
void run()
