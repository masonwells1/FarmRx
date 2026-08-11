import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const weatherModule = readFileSync(new URL('../WeatherModule.tsx', import.meta.url), 'utf8')
const weatherService = readFileSync(new URL('./weatherService.ts', import.meta.url), 'utf8')
const inventoryModule = readFileSync(new URL('../InventoryModule.tsx', import.meta.url), 'utf8')
const refreshField = weatherModule.slice(weatherModule.indexOf('const refreshField'), weatherModule.indexOf('const refreshAll'))
const handoffs = weatherModule.slice(weatherModule.indexOf('onStartSprayRecord={() =>'), weatherModule.indexOf('} />)}</main>'))
const prefillSlice = inventoryModule.slice(inventoryModule.indexOf('export function SprayForm'), inventoryModule.indexOf('async function submit'))

assert.ok(refreshField.length > 0, 'The real Weather refresh path must remain present for this no-write guard.')
assert.match(weatherModule, /fieldsRepository\.getData\(\)/, 'Opening Weather must retain its field read path.')
assert.match(refreshField, /weatherService\.fetchForecast\(/, 'Loading and refreshing Weather must retain the forecast read path.')
assert.match(handoffs, /navigate\('\/inventory', \{ state: manualSprayRecordIntent \}\)/, 'The blank handoff must remain the exact payload-free route.')
assert.match(handoffs, /createWeatherSprayPrefillIntent/, 'The prefill handoff must use the strict route contract.')
assert.doesNotMatch(weatherModule, /notificationsRepository|raiseNotification|notification/i, 'Browser Weather must not depend on or call notification writes.')
assert.doesNotMatch(refreshField, /fieldLocationClient|navigate|\.insert\(|\.upsert\(|\.rpc\(/, 'Opening, loading, refreshing, cached, stale, and future Weather paths must contain no database write call.')
assert.doesNotMatch(handoffs, /fieldLocationClient|notificationsRepository|raiseNotification|\.insert\(|\.upsert\(|\.rpc\(/, 'Either Weather-to-spray handoff must contain no database or notification write call.')
assert.doesNotMatch(prefillSlice, /repository\.|\.insert\(|\.upsert\(|\.rpc\(/, 'Spray prefill must initialize local form state only; Save owns the existing repository call.')
assert.doesNotMatch(weatherService, /notificationsRepository|raiseNotification|\.insert\(|\.upsert\(|\.rpc\(/, 'Weather service must remain cache-and-provider only, with no database write dependency.')

console.log('Weather browser no-write regressions passed.')
