import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isManualSprayRecordIntent, manualSprayRecordIntent } from './weatherSprayHandoff'

assert.deepEqual(manualSprayRecordIntent, { kind: 'manual-spray-record', version: 1 })
assert.equal(Object.isFrozen(manualSprayRecordIntent), true, 'The route intent must be immutable.')
assert.equal(isManualSprayRecordIntent(manualSprayRecordIntent), true, 'The exact manual route intent must open Spray record.')
assert.equal(isManualSprayRecordIntent({ ...manualSprayRecordIntent, fieldId: '27020000-0000-4000-8000-000000000005' }), false, 'Field data must never ride the manual route intent.')
assert.equal(isManualSprayRecordIntent({ ...manualSprayRecordIntent, windSpeedMph: 8 }), false, 'Weather data must never ride the manual route intent.')
assert.equal(isManualSprayRecordIntent({ kind: 'manual-spray-record', version: 2 }), false, 'Unknown intent versions must fail closed.')

const weatherModule = readFileSync(new URL('../WeatherModule.tsx', import.meta.url), 'utf8')
const inventoryModule = readFileSync(new URL('../InventoryModule.tsx', import.meta.url), 'utf8')
const standingGoal = readFileSync(new URL('../../docs/GOAL.md', import.meta.url), 'utf8')

assert.match(weatherModule, /navigate\('\/inventory', \{ state: manualSprayRecordIntent \}\)/, 'Weather must navigate with the exact payload-free manual intent.')
assert.match(weatherModule, /Open blank spray record/, 'The Weather action must tell the farmer it opens a blank record.')
assert.match(weatherModule, /type what you observed at application time/, 'The Weather copy must require manual transcription of observed conditions.')
assert.doesNotMatch(weatherModule, /createWeatherSprayHandoff|kind: 'weather-spray-handoff'/, 'Weather must not construct a field or forecast payload for Inventory.')
assert.match(inventoryModule, /isManualSprayRecordIntent\(location\.state\) \? 'spray' : 'shelf'/, 'The payload-free intent must open the Spray tab.')
assert.doesNotMatch(inventoryModule, /weatherPrefill|parseWeatherSprayHandoff|weather-prefill-warning/, 'The spray form must preserve its original manual defaults with no route prefill or warning.')
assert.match(standingGoal, /A farmer manually transcribes weather into a spray record; there is no weather-to-spray provenance link\./, 'The standing goal must continue to define weather entry as manual transcription with no provenance link.')

console.log('Weather to manual spray route regressions passed.')
