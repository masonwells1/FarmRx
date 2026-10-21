import { readdirSync, readFileSync } from 'node:fs'
import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WeatherCredit } from './WeatherCredit'

// Open-Meteo's free API is CC BY 4.0: their licence asks for a link next to any place their weather data shows.
// The Today spray card is rendered for real in TodayModule.sprayClock.regression.tsx; the other screens are held here.

Object.assign(globalThis, { React })
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

const html = renderToStaticMarkup(createElement(WeatherCredit))
assert(html === '<p class="town-credit">Weather data by <a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Open-Meteo.com</a> <span class="credit-keep">(<a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>).</span></p>', `The credit lost its wording or links (saw: ${html}).`)

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const screens: Array<{ file: string; after: string; where: string }> = [
  { file: 'WeatherModule.tsx', after: "As of {displayTime(bundle.fetched_at)}.</p><WeatherCredit />", where: 'the Weather forecast' },
  { file: 'TodayModule.tsx', after: "<span className=\"today-chevron\" aria-hidden=\"true\">›</span></Link><WeatherCredit /></>", where: 'the Today spray verdict' },
  { file: 'FieldLogModule.tsx', after: "'Based on daily high and low temperatures.'}</small></p><WeatherCredit /></>", where: 'the Field Log growing degree days' },
  { file: 'ProgramsModule.tsx', after: '</p>\n      {state.level && <WeatherCredit />}', where: 'the Programs spray light' },
]
for (const screen of screens) {
  const text = source(screen.file)
  assert(text.includes(screen.after), `${screen.where} (${screen.file}) no longer shows the Open-Meteo credit next to its weather data.`)
}
// Every screen that reads Open-Meteo data must carry the credit; a new reader fails here until it does.
const readers = readdirSync(new URL('../', import.meta.url)).filter((file) => file.endsWith('.tsx') && !file.includes('.regression.') && /from ['"]\.\/data\/weatherService['"]/.test(source(file))).sort()
assert(readers.join() === screens.map((screen) => screen.file).sort().join(), `Screens reading weather data changed (now: ${readers.join(', ')}); add <WeatherCredit /> next to the new one and list it here.`)

// The credit is licence-required text, so it follows the farmer rules: 18px text and 48px link tap targets.
const css = source('styles/app.css')
const creditRules = [...css.matchAll(/([^{}]*\.town-credit[^{}]*)\{([^}]*)\}/g)].map((match) => ({ selector: match[1].trim(), body: match[2] }))
const rule = (selector: string) => creditRules.find((item) => item.selector === selector)?.body ?? ''
assert(/font-size:\s*18px/.test(rule('.town-credit')), 'The credit text must be at least 18px (Farm Rx text contract).')
assert(/min-height:\s*48px/.test(rule('.town-credit a')) && /display:\s*inline-flex/.test(rule('.town-credit a')), 'Each credit link needs a 48px tap target.')
for (const item of creditRules) {
  // Compare each declared value; a unit other than px or rem cannot be checked here, so it fails.
  const px = (value: string) => { const match = /^([\d.]+)(px|rem)$/.exec(value.trim()); return match ? Number(match[1]) * (match[2] === 'rem' ? 16 : 1) : Number.NaN }
  for (const size of item.body.matchAll(/font-size:([^;]*)/g)) assert(px(size[1]) >= 18, `${item.selector} sets the credit text below 18px (${size[1].trim()}).`)
  for (const height of item.body.matchAll(/min-height:([^;]*)/g)) assert(px(height[1]) >= 48, `${item.selector} sets a credit link tap target below 48px (${height[1].trim()}).`)
}

console.log('Weather credit regression passed')
