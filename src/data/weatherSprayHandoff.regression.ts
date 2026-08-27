import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createWeatherSprayPrefillIntent, isManualSprayRecordIntent, isWeatherSprayPrefillIntent, manualSprayRecordIntent, parseWeatherSprayHandoff } from './weatherSprayHandoff'

const prefill = { kind: 'weather-spray-prefill' as const, version: 1 as const, fieldId: '27020000-0000-4000-8000-000000000005', applicationDate: '2027-07-07', temperatureF: 74, windSpeedMph: 8, windDirection: 'SW' as const }

assert.deepEqual(manualSprayRecordIntent, { kind: 'manual-spray-record', version: 1 })
assert.equal(Object.isFrozen(manualSprayRecordIntent), true, 'The manual route intent must be immutable.')
assert.equal(isManualSprayRecordIntent(manualSprayRecordIntent), true, 'The exact manual route intent must open Spray record.')
assert.equal(isManualSprayRecordIntent({ ...manualSprayRecordIntent, fieldId: prefill.fieldId }), false, 'Field data must never ride the manual route intent.')
assert.equal(isManualSprayRecordIntent({ kind: 'manual-spray-record', version: 2 }), false, 'Unknown manual versions must fail closed.')

const created = createWeatherSprayPrefillIntent(prefill)
assert.deepEqual(created, prefill, 'The exact weather contract must preserve only its defined values.')
assert.equal(Object.isFrozen(created), true, 'Weather route state must be immutable.')
assert.notEqual(created, prefill, 'The route contract must copy caller-owned state before use.')
assert.equal(isWeatherSprayPrefillIntent(created), true, 'The exact weather route intent must be accepted.')
assert.deepEqual(parseWeatherSprayHandoff(created), created, 'The parser must preserve the valid weather handoff.')
assert.equal(Object.isFrozen(parseWeatherSprayHandoff(created)!), true, 'Parsed route state must remain immutable.')
assert.notEqual(parseWeatherSprayHandoff({ ...prefill, temperatureF: -100 }), null, 'The database minimum temperature must be accepted.')
assert.notEqual(parseWeatherSprayHandoff({ ...prefill, temperatureF: 160 }), null, 'The database maximum temperature must be accepted.')
assert.notEqual(parseWeatherSprayHandoff({ ...prefill, windSpeedMph: 0 }), null, 'A calm wind speed must be accepted.')
assert.notEqual(parseWeatherSprayHandoff({ ...prefill, windSpeedMph: 250 }), null, 'The database maximum wind speed must be accepted.')
for (const malformed of [
  { ...prefill, ignored: true },
  { ...prefill, version: 2 },
  { ...prefill, fieldId: 'not-a-uuid' },
  { ...prefill, applicationDate: '2027-02-29' },
  { ...prefill, temperatureF: Number.POSITIVE_INFINITY },
  { ...prefill, windSpeedMph: Number.NaN },
  { ...prefill, windSpeedMph: -1 },
  { ...prefill, windSpeedMph: 250.1 },
  { ...prefill, temperatureF: -100.1 },
  { ...prefill, temperatureF: 160.1 },
  { ...prefill, windDirection: 'CALM' },
  { kind: 'weather-spray-prefill', version: 1 },
]) assert.equal(parseWeatherSprayHandoff(malformed), null, 'Malformed or expanded weather state must fail closed.')
assert.equal(parseWeatherSprayHandoff({ ...manualSprayRecordIntent, temperatureF: 74 }), null, 'Manual intent must stay payload-free.')

const weatherModule = readFileSync(new URL('../WeatherModule.tsx', import.meta.url), 'utf8')
const inventoryModule = readFileSync(new URL('../InventoryModule.tsx', import.meta.url), 'utf8')
const cedarSpec = readFileSync(new URL('../../tests/e2e/season/cedar-creek.spec.ts', import.meta.url), 'utf8')

assert.match(weatherModule, /navigate\('\/inventory', \{ state: manualSprayRecordIntent \}\)/, 'The blank path must retain its exact payload-free manual intent.')
assert.match(weatherModule, /createWeatherSprayPrefillIntent\(\{ kind: 'weather-spray-prefill', version: 1, fieldId: field\.id, applicationDate: bundle\.current\.time\.slice\(0, 10\), temperatureF: bundle\.current\.temperature_f, windSpeedMph: bundle\.current\.wind_speed_mph, windDirection: compassLabel\(bundle\.current\.wind_direction_degrees\) as SprayWindDirection \}\)/, 'Weather must create only the strict, local forecast prefill contract.')
assert.match(weatherModule, /Open blank spray record/, 'The original blank-record action must remain visible.')
assert.match(weatherModule, /Start spray record with this weather/, 'Fresh Weather must offer a separate prefill action.')
assert.match(weatherModule, /\{fresh && <div className="weather-spray-handoff">/, 'Both actions must remain unavailable for stale Weather.')
assert.match(weatherModule, /const timer = window\.setTimeout\(\(\) => setNowMs\(Date\.now\(\)\), Math\.max\(0, expiresAt - Date\.now\(\) \+ 1\)\)/, 'Open Weather must re-render immediately after the actionability ceiling expires.')
assert.match(weatherModule, /const startSpray = \(action: \(\) => void\) => \{ const clickedAt = Date\.now\(\); setNowMs\(clickedAt\); if \(!isActionablyFresh\(bundle, clickedAt\)\) return; action\(\) \}/, 'Each click must recheck freshness to close the expiry race.')
assert.match(weatherModule, /useEffect\(\(\) => \{ setNowMs\(Date\.now\(\)\); const expiresAt = Date\.parse\(bundle\.fetched_at\) \+ sprayJudgmentMaxAgeMs;/, 'A refreshed bundle must reset the freshness clock before scheduling its expiry.')
assert.match(inventoryModule, /parseWeatherSprayHandoff\(location\.state\)/, 'Inventory must fail closed before using route state.')
assert.match(inventoryModule, /<SprayForm key=\{location\.key\}/, 'Each route entry must remount Spray at the router-aware Inventory boundary so a same-path state change cannot retain old values.')
assert.match(inventoryModule, /props\.workspace\.fields\.fields\.some\(\(field\) => field\.id === requestedPrefill\.fieldId\)/, 'A prefilled field must exist in the loaded farm workspace.')
assert.match(inventoryModule, /prefill=\{sprayHandoff\?\.kind === 'weather-spray-prefill' \? sprayHandoff : null\}/, 'Inventory must pass only validated weather prefill into Spray.')
assert.match(inventoryModule, /onPrefillConsumed=\{\(\) => \{ const consumed = sprayHandoff; setSprayHandoff\(null\);/, 'A successful save must consume stale prefill state.')
assert.match(inventoryModule, /navigate\('\/inventory', \{ replace: true, state: null \}\)/, 'A successful weather-prefilled save must replace route history with null state.')
assert.match(inventoryModule, /newSprayLine\(prefill \? '' : workspace\.products\[0\]\?\.id\)/, 'A Weather-prefilled spray must leave Product blank while the existing manual path retains its first-product default.')
assert.match(inventoryModule, /onChange=\{\(event\) => updateLine\(line\.key, \{ product_id: event\.target\.value \}\)\} required><option value="">Choose product<\/option>/, 'The Weather-prefilled product choice must expose an explicit required blank state.')
assert.match(inventoryModule, /defaultValue=\{prefill\?\.applicationDate \?\? today\(\)\}/, 'The forecast-local date must be editable prefill.')
assert.match(inventoryModule, /defaultValue=\{prefill\?\.windSpeedMph \?\? ''\}/, 'Wind speed must be editable prefill.')
assert.match(inventoryModule, /defaultValue=\{prefill\?\.windDirection \?\? ''\}/, 'Compass direction must be editable prefill.')
assert.match(inventoryModule, /defaultValue=\{prefill\?\.temperatureF \?\? ''\}/, 'Temperature must be editable prefill.')
assert.match(inventoryModule, /name="wind" type="number" min="0" max="250"/, 'Wind input bounds must match the route and database bounds.')
assert.match(inventoryModule, /name="temp" type="number" min="-100" max="160"/, 'Temperature input bounds must match the route and database bounds.')
assert.doesNotMatch(inventoryModule, /prefill\?\.(?:relativeHumidity|humidity|crop|acres|time|applicator|pest|product)/, 'Only the approved weather values may prefill the form.')
assert.match(cedarSpec, /test\('@connect-workflows-cw1 weather prefill stays local until the farmer saves'/, 'CW-1 proof must stay out of the Cedar Creek default grep.')
assert.doesNotMatch(cedarSpec, /test\('@cedar-creek CW-1/, 'The default Cedar Creek suite must not run CW-1 proof.')
assert.match(cedarSpec, /await page\.evaluate\(\(\) => window\.__cedarArmInventory\?\.\(\)\)/, 'The dedicated desktop save must use deterministic application IDs.')
assert.match(cedarSpec, /await expect\(line\.getByLabel\('Product'\)\)\.toHaveValue\(''\)/, 'CW-1 browser proof must show Product starts blank.')
assert.match(cedarSpec, /await line\.getByLabel\('Product'\)\.selectOption\(\{ label: 'Synthetic Cedar Herbicide 41' \}\)/, 'CW-1 browser proof must require the farmer to select the product explicitly.')
assert.match(cedarSpec, /await page\.reload\(\)/, 'CW-1 browser proof must show consumed route state cannot repopulate after reload.')
assert.match(cedarSpec, /test\('@connect-workflows-cw1 refreshed Weather stays actionable'/, 'CW-1 browser proof must keep spray actions available after a newer bundle replaces an already-rendered forecast.')

console.log('Weather to spray prefill route regressions passed.')
