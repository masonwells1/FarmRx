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
const appCss = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8')
const standingGoal = readFileSync(new URL('../../docs/GOAL.md', import.meta.url), 'utf8')

assert.match(weatherModule, /navigate\('\/inventory', \{ state: manualSprayRecordIntent \}\)/, 'Weather must navigate with the exact payload-free manual intent.')
assert.doesNotMatch(weatherModule, /navigate\('\/inventory', \{ state: \{[^}]+\} \}\)/, 'Weather must not construct any inline handoff payload.')
assert.match(weatherModule, /Open blank spray record/, 'The Weather action must tell the farmer it opens a blank record.')
assert.match(weatherModule, /type what you observed at application time/, 'The Weather copy must require manual transcription of observed conditions.')
assert.doesNotMatch(weatherModule, /createWeatherSprayHandoff|kind: 'weather-spray-handoff'/, 'Weather must not construct a field or forecast payload for Inventory.')
assert.doesNotMatch(weatherModule, /notificationsRepository|raiseNotification|notification/i, 'The manual Weather-to-spray route must not retain a browser notification write path.')
assert.match(inventoryModule, /isManualSprayRecordIntent\(location\.state\) \? 'spray' : 'shelf'/, 'The payload-free intent must open the Spray tab.')
assert.match(inventoryModule, /const tabListRef = useRef<HTMLElement>\(null\)[\s\S]*const activeTabRef = useRef<HTMLButtonElement>\(null\)/, 'Inventory must keep bounded refs for its own horizontal tab scroller and selected tab.')
assert.match(inventoryModule, /const workspaceReady = workspace !== null/, 'Initial payload-free Spray selection must re-run tab visibility after the async Inventory workspace renders.')
assert.match(inventoryModule, /useLayoutEffect\(\(\) => \{[\s\S]*const tabListRect = tabList\.getBoundingClientRect\(\)[\s\S]*const activeTabRect = activeTab\.getBoundingClientRect\(\)[\s\S]*const visibleLeft = tabList\.scrollLeft[\s\S]*const visibleRight = visibleLeft \+ tabList\.clientWidth[\s\S]*const activeLeft = activeTabRect\.left - tabListRect\.left \+ visibleLeft[\s\S]*const activeRight = activeLeft \+ activeTabRect\.width[\s\S]*activeLeft < visibleLeft[\s\S]*tabList\.scrollLeft = activeLeft[\s\S]*activeRight > visibleRight[\s\S]*tabList\.scrollLeft = activeRight - tabList\.clientWidth[\s\S]*\}, \[view, workspaceReady\]\)/, 'A selected Inventory tab must assign an idempotent absolute nearest-edge target when the view changes or first becomes ready.')
assert.doesNotMatch(inventoryModule, /tabList\.scrollLeft\s*(?:\+=|-=)/, 'StrictMode replay must never compound a relative Inventory tab scroll delta.')
assert.match(inventoryModule, /<nav ref=\{tabListRef\} className="inventory-tabs"[\s\S]*ref=\{view === key \? activeTabRef : undefined\} className=\{view === key \? 'active' : ''\}/, 'The Inventory tab list and active button must attach the bounded visibility refs.')
assert.doesNotMatch(inventoryModule, /scrollIntoView|scrollTo\(|window\.scroll|document\.(?:body|documentElement)\.scroll/, 'Inventory tab selection must not use broad element or document scrolling.')
assert.match(inventoryModule, /className=\{view === key \? 'active' : ''\} aria-current=\{view === key \? 'page' : undefined\}/, 'The selected Inventory section must expose both its visible active class and current-page semantics.')
assert.match(appCss, /\.inventory-tabs button\.active \{[^}]*border-color: var\(--deep-green\);[^}]*background: var\(--deep-green\);[^}]*color: var\(--on-dark\);/, 'The active Inventory section must retain a high-contrast visible style on desktop and phone.')
assert.doesNotMatch(inventoryModule, /weatherPrefill|parseWeatherSprayHandoff|weather-prefill-warning/, 'The spray form must preserve its original manual defaults with no route prefill or warning.')
assert.match(standingGoal, /A farmer manually transcribes weather into a spray record; there is no weather-to-spray provenance link\./, 'The standing goal must continue to define weather entry as manual transcription with no provenance link.')

console.log('Weather to manual spray route regressions passed.')
