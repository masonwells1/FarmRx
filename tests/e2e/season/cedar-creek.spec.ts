import { expect, test, type Locator, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSeasonRequestClassifier } from './season-request-classifier'

const manifest = JSON.parse(readFileSync(resolve('tests/season/season-2027.manifest.json'), 'utf8')) as { fixtures: Array<{ label: string; uuid: string }> }
const fixture = (label: string) => { const value = manifest.fixtures.find(item => item.label === label)?.uuid; if (!value) throw new Error(`Missing Cedar fixture ${label}`); return value }
const ids = { farm: fixture('Cedar Creek farm'), field: fixture('Cedar West 40 field'), crop: fixture('Cedar 2027 soybean crop assignment'), product: fixture('Cedar known inventory product'), application: fixture('Cedar completed application record'), line: fixture('Cedar completed application product'), note: fixture('Cedar scouting note'), scoutingOperation: fixture('Cedar scouting save operation') }
const fixed = new Date('2027-07-07T13:20:00-05:00')
const weatherUrl = 'https://api.open-meteo.com/v1/forecast?latitude=38.21&longitude=-89.12&current=temperature_2m%2Crelative_humidity_2m%2Cprecipitation%2Cwind_speed_10m%2Cwind_direction_10m%2Cwind_gusts_10m%2Ccloud_cover&hourly=temperature_2m%2Crelative_humidity_2m%2Cprecipitation%2Cprecipitation_probability%2Cwind_speed_10m%2Cwind_direction_10m%2Cwind_gusts_10m%2Ccloud_cover&daily=precipitation_sum%2Cprecipitation_probability_max%2Ctemperature_2m_max%2Ctemperature_2m_min%2Csunrise%2Csunset&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=7'
const weatherPayload = { current: { time: '2027-07-07T13:20', temperature_2m: 74, relative_humidity_2m: 52, precipitation: 0, wind_speed_10m: 8, wind_direction_10m: 225, wind_gusts_10m: 10, cloud_cover: 30 }, hourly: { time: ['2027-07-07T13:20','2027-07-07T14:20','2027-07-07T15:20','2027-07-07T16:20','2027-07-07T17:20'], temperature_2m: [74,75,77,78,77], relative_humidity_2m: [52,50,48,47,49], precipitation: [0,0,0,0,0], precipitation_probability: [10,10,10,10,10], wind_speed_10m: [8,8,9,9.5,8.5], wind_direction_10m: [225,225,230,230,225], wind_gusts_10m: [10,10,11,12,11], cloud_cover: [30,28,25,25,28] }, daily: { time: ['2027-07-07','2027-07-08'], precipitation_sum: [0,0], precipitation_probability_max: [10,15], temperature_2m_max: [82,83], temperature_2m_min: [62,63], sunrise: ['2027-07-07T05:38','2027-07-08T05:39'], sunset: ['2027-07-07T20:27','2027-07-08T20:27'] } }
const freshEnvelope = { version: 1, fetched_at: '2027-07-07T18:20:00.000Z', bundle: { current: { time: weatherPayload.current.time, temperature_f: weatherPayload.current.temperature_2m, relative_humidity: weatherPayload.current.relative_humidity_2m, precipitation_in: weatherPayload.current.precipitation, precipitation_probability: null, wind_speed_mph: weatherPayload.current.wind_speed_10m, wind_direction_degrees: weatherPayload.current.wind_direction_10m, wind_gusts_mph: weatherPayload.current.wind_gusts_10m, cloud_cover: weatherPayload.current.cloud_cover }, hourly: weatherPayload.hourly.time.map((time, index) => ({ time, temperature_f: weatherPayload.hourly.temperature_2m[index], relative_humidity: weatherPayload.hourly.relative_humidity_2m[index], precipitation_in: weatherPayload.hourly.precipitation[index], precipitation_probability: weatherPayload.hourly.precipitation_probability[index], wind_speed_mph: weatherPayload.hourly.wind_speed_10m[index], wind_direction_degrees: weatherPayload.hourly.wind_direction_10m[index], wind_gusts_mph: weatherPayload.hourly.wind_gusts_10m[index], cloud_cover: weatherPayload.hourly.cloud_cover[index] })), daily: weatherPayload.daily.time.map((date, index) => ({ date, precipitation_sum_in: weatherPayload.daily.precipitation_sum[index], precipitation_probability_max: weatherPayload.daily.precipitation_probability_max[index], temperature_max_f: weatherPayload.daily.temperature_2m_max[index], temperature_min_f: weatherPayload.daily.temperature_2m_min[index], sunrise: weatherPayload.daily.sunrise[index], sunset: weatherPayload.daily.sunset[index] })), fetched_at: '2027-07-07T18:20:00.000Z' } }
const staleEnvelope = { version: 1, fetched_at: '2027-07-07T11:40:00-05:00', bundle: { current: { time: '2027-07-07T13:20', temperature_f: 74, relative_humidity: 52, precipitation_in: 0, precipitation_probability: null, wind_speed_mph: 8, wind_direction_degrees: 225, wind_gusts_mph: 10, cloud_cover: 30 }, hourly: weatherPayload.hourly.time.map((time, index) => ({ time, temperature_f: weatherPayload.hourly.temperature_2m[index], relative_humidity: weatherPayload.hourly.relative_humidity_2m[index], precipitation_in: weatherPayload.hourly.precipitation[index], precipitation_probability: weatherPayload.hourly.precipitation_probability[index], wind_speed_mph: weatherPayload.hourly.wind_speed_10m[index], wind_direction_degrees: weatherPayload.hourly.wind_direction_10m[index], wind_gusts_mph: weatherPayload.hourly.wind_gusts_10m[index], cloud_cover: weatherPayload.hourly.cloud_cover[index] })), daily: [{ date: '2027-07-07', precipitation_sum_in: 0, precipitation_probability_max: 10, temperature_max_f: 82, temperature_min_f: 62, sunrise: '2027-07-07T05:38', sunset: '2027-07-07T20:27' }, { date: '2027-07-08', precipitation_sum_in: 0, precipitation_probability_max: 15, temperature_max_f: 83, temperature_min_f: 63, sunrise: '2027-07-08T05:39', sunset: '2027-07-08T20:27' }], fetched_at: '2027-07-07T11:40:00-05:00' } }

declare global { interface Window { __cedarArmInventory?: () => void; __cedarArmScouting?: () => void; __cedarIds?: string[] } }

async function fence(page: Page, targetMutationRpcs: string[] = ['save_inventory_application_bundle', 'save_scouting_note']) {
  const requests = createSeasonRequestClassifier({ targetMutationRpcs, blockUnexpectedNonReadRequests: true })
  const external: string[] = []; const scoutingRpcResponses: string[] = []; let stale = false; let weatherRequests = 0
  await page.route('**/*', async route => { const request = route.request(); const url = new URL(request.url()); if (request.url() === weatherUrl) { weatherRequests += 1; if (stale) await route.abort('blockedbyclient'); else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(weatherPayload) }); return } if (url.hostname === 'api.open-meteo.com') { external.push(`UNEXPECTED_WEATHER ${request.method()} ${request.url()}`); await route.abort('blockedbyclient'); return } if (['http:','https:','ws:','wss:'].includes(url.protocol) && (url.hostname !== '127.0.0.1' || !['4186','4187','55321'].includes(url.port))) { external.push(`${request.method()} ${url.href}`); await route.abort('blockedbyclient'); return } if (url.origin === 'http://127.0.0.1:55321' && requests.observe(request.method(), request.url()).block) { await route.abort('blockedbyclient'); return } await route.continue() })
  await page.on('response', async response => { if (new URL(response.url()).pathname === '/rest/v1/rpc/save_scouting_note') scoutingRpcResponses.push(`${response.status()} ${await response.text()}`) })
  await page.addInitScript(({ fixedMs, ids: values }) => { const RealDate = Date; const realNow = RealDate.now.bind(RealDate); window.Date = new Proxy(RealDate, { construct(target, args) { const stack = new Error().stack ?? ''; const governed = args.length === 0 && (stack.includes('/src/data/weatherService.ts') || stack.includes('/src/data/index.ts') || stack.includes('/src/data/createSupabaseInventoryServices.ts') || stack.includes('/src/data/createSupabaseScoutingServices.ts') || stack.includes('/src/ScoutingModule.tsx') || stack.includes('/src/data/scouting.ts') || stack.includes('/src/data/farmDates.ts')); return Reflect.construct(target, governed ? [fixedMs] : args) as Date }, apply(target, self, args) { return Reflect.apply(target, self, args) } }) as DateConstructor; window.Date.now = () => { const caller = (new Error().stack ?? '').split('\n')[2] ?? ''; return caller.includes('/src/data/weatherService.ts') || caller.includes('/src/WeatherModule.tsx') ? fixedMs : realNow() }; const original = crypto.randomUUID.bind(crypto); let inventory = false; let scouting = false; let inventoryCount = 0; let scoutingCount = 0; const seen: string[] = []; Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => { if (inventory && inventoryCount < 2) { const value = inventoryCount++ === 0 ? values.application : values.line; seen.push(value); return value } if (scouting && scoutingCount < 2) { const value = scoutingCount++ === 0 ? values.note : values.operation; seen.push(value); return value } return original() } }); window.__cedarArmInventory = () => { inventory = true }; window.__cedarArmScouting = () => { scouting = true }; window.__cedarIds = seen }, { fixedMs: fixed.getTime(), ids: { application: ids.application, line: ids.line, note: ids.note, operation: ids.scoutingOperation } })
  return { requests, external, scoutingRpcResponses, stale: () => { stale = true }, weatherRequests: () => weatherRequests }
}

async function signIn(page: Page) { const password = process.env.FARMRX_SEASON_OWNER_PASSWORD; if (!password) throw new Error('FARMRX_SEASON_OWNER_PASSWORD is required for Cedar disposable proof.'); await page.goto('/login'); await page.getByLabel('Email address').fill('cedar.owner@farmrx.local.test'); await page.getByLabel('Password').fill(password); await page.getByRole('button', { name: 'Sign in' }).click(); await expect(page).toHaveURL(/\/fields/) }
async function noOverflow(page: Page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth && document.body.scrollWidth <= window.innerWidth)).toBe(true) }
async function journeyActionsAtLeast48(...targets: Locator[]) { for (const target of targets) { await expect(target.first()).toBeVisible(); const heights = await target.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height)); expect(heights.length).toBeGreaterThan(0); expect(heights.every(height => height >= 48)).toBe(true) } }
async function entirelyWithinViewport(page: Page, target: Locator) { await expect(target).toBeVisible(); const box = await target.boundingBox(); const viewport = page.viewportSize(); expect(box).not.toBeNull(); expect(viewport).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height) }

test('@cedar-creek continuous CC-1 through CC-4 stays local, manual, and exactly once', async ({ page }) => {
  const network = await fence(page); await signIn(page); await page.goto('/weather')
  await expect(page.getByText('74°F', { exact: true })).toBeVisible(); await expect(page.getByText('8 mph SW', { exact: true })).toBeVisible(); await expect(page.locator('.spray-summary .spray-light strong')).toHaveText('Good'); await expect(page.getByText('Spray now', { exact: true })).toBeVisible(); await journeyActionsAtLeast48(page.getByRole('button', { name: 'Open blank spray record' })); await noOverflow(page); expect(network.weatherRequests()).toBe(1)
  const cache = await page.evaluate(() => localStorage.getItem('farm-rx-weather:v1:38.210:-89.120')); expect(cache).toBe(JSON.stringify(freshEnvelope)); expect(network.requests.observedTargetMutationRpcs).toEqual([])
  await page.getByRole('button', { name: 'Open blank spray record' }).click(); await expect(page).toHaveURL(/\/inventory/); const spray = page.locator('form.spray-form'); const sprayTab = page.getByRole('button', { name: 'Spray record', exact: true }); await entirelyWithinViewport(page, sprayTab); await expect(sprayTab).toHaveAttribute('aria-current', 'page'); await expect(sprayTab).toHaveClass(/(^|\s)active(\s|$)/); const activeTabColors = await sprayTab.evaluate((element) => { const tabStyles = getComputedStyle(element); const probe = document.createElement('button'); probe.style.background = 'var(--deep-green)'; probe.style.color = 'var(--on-dark)'; probe.style.position = 'fixed'; probe.style.visibility = 'hidden'; document.body.append(probe); const probeStyles = getComputedStyle(probe); const result = { actual: { background: tabStyles.backgroundColor, color: tabStyles.color }, expected: { background: probeStyles.backgroundColor, color: probeStyles.color } }; probe.remove(); return result }); expect(activeTabColors.actual).toEqual(activeTabColors.expected); await journeyActionsAtLeast48(page.locator('.inventory-tabs button'), spray.getByRole('button', { name: 'Save spray record' })); await noOverflow(page); for (const name of ['field','crop','acres','time','pest','applicator','license','wind','direction','temp','humidity']) await expect(spray.locator(`[name="${name}"]`)).toHaveValue('')
  await spray.getByLabel('Field').selectOption({ label: 'Cedar West 40' }); await spray.getByLabel('Crop assignment').selectOption({ label: 'Soybeans · 40 ac' }); await spray.getByLabel('Applied acres').fill('40.00'); await spray.getByLabel('Date').fill('2027-07-07'); await spray.getByLabel('Time (good practice)').fill('13:20'); await spray.getByLabel('Target pest (good practice)').fill('Synthetic broadleaf'); const line = spray.locator('.spray-product-row').first(); await line.getByLabel('Product').selectOption({ label: 'Synthetic Cedar Herbicide 41' }); await line.getByRole('spinbutton', { name: 'Rate', exact: true }).fill('0.125'); await line.getByLabel('Rate unit').selectOption('gal'); await line.getByLabel('Rate basis').selectOption('acre'); await line.getByLabel('Total used').fill('5.00'); await line.getByLabel('Total unit').selectOption('gal'); await spray.getByLabel('Applicator name').fill('Scenario Operator'); await spray.getByLabel('License no.').fill('PRESENCE-ONLY-2027'); await spray.getByLabel('Wind mph').fill('8'); await spray.getByLabel('Wind direction').selectOption('SW'); await spray.getByLabel('Temperature °F').fill('74'); await spray.getByLabel('Relative humidity %').fill('52')
  expect(network.requests.observedTargetMutationRpcs).toEqual([]); await page.evaluate(() => window.__cedarArmInventory?.()); await spray.getByRole('button', { name: 'Save spray record' }).click(); await expect(page.getByText('Spray record confirmed on Farm Rx. Product and label facts are copied into this record.')).toBeVisible(); await expect(spray.getByLabel('Field')).toHaveValue(''); expect(network.requests.observedTargetMutationRpcs).toEqual(['save_inventory_application_bundle'])
  await page.goto('/weather'); await page.evaluate(value => localStorage.setItem('farm-rx-weather:v1:38.210:-89.120', JSON.stringify(value)), staleEnvelope); network.stale(); await page.reload(); await expect(page.getByText('Weather data is 2 hours old — refresh before spraying.')).toBeVisible(); await expect(page.getByText('Refresh before spraying', { exact: true })).toBeVisible(); await expect(page.getByText('Spray window unknown until refreshed')).toBeVisible(); await expect(page.getByText('Showing your last forecast — reconnect for the latest.')).toBeVisible(); await expect(page.getByRole('button', { name: 'Open blank spray record' })).toHaveCount(0); expect(network.weatherRequests()).toBe(2)
  await page.goto('/scouting'); await journeyActionsAtLeast48(page.getByRole('button', { name: 'New scouting note' })); await page.getByRole('button', { name: 'New scouting note' }).click(); const scouting = page.locator('form.scouting-form'); await journeyActionsAtLeast48(scouting.getByRole('button', { name: 'Save scouting note' })); await expect(scouting.getByLabel('Date')).toHaveAttribute('max', '2027-07-08'); await scouting.getByLabel('Date').fill('2027-07-07'); await scouting.getByLabel('What did you find?').fill('Synthetic waterhemp along west edge'); await page.evaluate(() => window.__cedarArmScouting?.()); await scouting.getByRole('button', { name: 'Save scouting note' }).click(); await expect(page.getByText('Saved', { exact: true }).or(page.getByText('Farm Rx could not save this scouting note right now. Please try again.'))).toBeVisible(); await expect.poll(() => network.scoutingRpcResponses.length).toBe(1); expect(network.scoutingRpcResponses[0]).toMatch(/^200 /); await expect(page.getByText('Saved', { exact: true })).toBeVisible(); expect(await page.evaluate(() => window.__cedarIds)).toEqual([ids.note, ids.scoutingOperation]); expect(network.requests.observedTargetMutationRpcs).toEqual(['save_inventory_application_bundle','save_scouting_note']); expect(network.requests.unexpectedRpcs).toEqual([]); expect(network.requests.blockedNonReadRequests).toEqual([]); expect(network.external).toEqual([]); await noOverflow(page)
})

test('@connect-workflows-cw1 weather prefill stays local until the farmer saves', async ({ page }) => {
  const network = await fence(page)
  await signIn(page)
  await page.goto('/weather')
  const blank = page.getByRole('button', { name: 'Open blank spray record' })
  const prefill = page.getByRole('button', { name: 'Start spray record with this weather' })
  await expect(blank).toBeVisible()
  await expect(prefill).toBeVisible()
  await journeyActionsAtLeast48(blank, prefill)

  await blank.click()
  const blankSpray = page.locator('form.spray-form')
  for (const name of ['field', 'crop', 'acres', 'time', 'pest', 'applicator', 'license', 'wind', 'direction', 'temp', 'humidity']) await expect(blankSpray.locator(`[name="${name}"]`)).toHaveValue('')
  expect(network.requests.observedTargetMutationRpcs).toEqual([])
  await page.goto('/weather')
  expect(network.requests.observedTargetMutationRpcs).toEqual([])

  await prefill.click()
  const spray = page.locator('form.spray-form')
  const line = spray.locator('.spray-product-row').first()
  await expect(spray.getByLabel('Field')).toHaveValue(ids.field)
  await expect(spray.getByLabel('Date')).toHaveValue('2027-07-07')
  await expect(spray.getByLabel('Wind mph')).toHaveValue('8')
  await expect(spray.getByLabel('Wind direction')).toHaveValue('SW')
  await expect(spray.getByLabel('Temperature °F')).toHaveValue('74')
  for (const name of ['crop', 'acres', 'time', 'pest', 'applicator', 'license', 'humidity']) await expect(spray.locator(`[name="${name}"]`)).toHaveValue('')
  await expect(line.getByLabel('Product')).toHaveValue('')
  await spray.getByLabel('Wind mph').fill('9')
  await spray.getByLabel('Wind direction').selectOption('W')
  await spray.getByLabel('Temperature °F').fill('75')
  await expect(spray.getByLabel('Wind mph')).toHaveValue('9')
  await expect(spray.getByLabel('Wind direction')).toHaveValue('W')
  await expect(spray.getByLabel('Temperature °F')).toHaveValue('75')
  expect(network.requests.observedTargetMutationRpcs).toEqual([])

  await spray.getByLabel('Crop assignment').selectOption({ label: 'Soybeans · 40 ac' })
  await spray.getByLabel('Applied acres').fill('40.00')
  await line.getByLabel('Product').selectOption({ label: 'Synthetic Cedar Herbicide 41' })
  await line.getByRole('spinbutton', { name: 'Rate', exact: true }).fill('0.125')
  await line.getByLabel('Rate unit').selectOption('gal')
  await line.getByLabel('Total used').fill('5.00')
  await page.evaluate(() => window.__cedarArmInventory?.())
  await spray.getByRole('button', { name: 'Save spray record' }).click()
  await expect(page.getByText('Spray record confirmed on Farm Rx. Product and label facts are copied into this record.')).toBeVisible()
  expect(network.requests.observedTargetMutationRpcs).toEqual(['save_inventory_application_bundle'])
  for (const name of ['field', 'wind', 'direction', 'temp']) await expect(spray.locator(`[name="${name}"]`)).toHaveValue('')
  await page.reload()
  await page.getByRole('button', { name: 'Spray record', exact: true }).click()
  for (const name of ['field', 'wind', 'direction', 'temp']) await expect(page.locator('form.spray-form').locator(`[name="${name}"]`)).toHaveValue('')

  await page.goto('/weather')
  await page.evaluate(value => localStorage.setItem('farm-rx-weather:v1:38.210:-89.120', JSON.stringify(value)), staleEnvelope)
  network.stale()
  await page.reload()
  await expect(page.getByRole('button', { name: 'Start spray record with this weather' })).toHaveCount(0)
  expect(network.requests.observedTargetMutationRpcs).toEqual(['save_inventory_application_bundle'])
  expect(network.requests.unexpectedRpcs).toEqual([])
  expect(network.requests.blockedNonReadRequests).toEqual([])
  expect(network.external).toEqual([])
})

test('@connect-workflows-cw1 refreshed Weather stays actionable', async ({ page }) => {
  const network = await fence(page)
  await signIn(page)
  await page.goto('/weather')
  const card = page.locator('.weather-card').filter({ hasText: 'Cedar West 40' })
  await expect(card.getByRole('button', { name: 'Open blank spray record' })).toBeVisible()
  await page.evaluate(next => {
    const PriorDate = window.Date
    window.Date = new Proxy(PriorDate, { construct(target, args) { const caller = new Error().stack ?? ''; const governed = caller.includes('/src/data/weatherService.ts') || caller.includes('/src/WeatherModule.tsx'); return Reflect.construct(target, governed ? [next] : args) as Date }, apply(target, self, args) { return Reflect.apply(target, self, args) } }) as DateConstructor
    window.Date.now = () => next
  }, fixed.getTime() + 60_000)
  await card.getByRole('button', { name: 'Refresh' }).click()
  await expect(card.getByRole('button', { name: 'Open blank spray record' })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Start spray record with this weather' })).toBeVisible()
  expect(network.weatherRequests()).toBe(2)
  expect(network.requests.observedTargetMutationRpcs).toEqual([])
  expect(network.requests.unexpectedRpcs).toEqual([])
  expect(network.requests.blockedNonReadRequests).toEqual([])
  expect(network.external).toEqual([])
})

test('@connect-workflows-cw2 exact Program match changes Inventory only after explicit no-record confirmation', async ({ page }) => {
  const network = await fence(page, ['mark_program_pass_applied'])
  await signIn(page)
  await page.goto('/programs')
  await page.getByRole('button', { name: 'Season progress' }).click()

  const assignment = page.locator('.assignment-track').filter({ hasText: 'Cedar CW-2 exact Inventory program' })
  const pass = assignment.locator('.tracker-pass').filter({ hasText: 'CW-2 confirmed draw-down pass' })
  await expect(pass.getByText('Planned', { exact: true })).toBeVisible()
  await journeyActionsAtLeast48(pass.getByRole('button', { name: 'Mark applied' }))
  await pass.getByRole('button', { name: 'Mark applied' }).click()

  const form = pass.locator('form.tracker-form')
  const recordChoice = form.getByLabel('Application record (optional)')
  const productName = form.getByLabel('Product', { exact: true })
  await expect(recordChoice).toHaveValue('create')
  await expect(form.getByText('Choose “Do not add an application record” to confirm a Program-to-Inventory draw-down.')).toBeVisible()
  await expect(form.getByLabel('Confirm exact Inventory product: Synthetic Cedar Herbicide 41')).toHaveCount(0)
  expect(network.requests.observedTargetMutationRpcs).toEqual([])

  await recordChoice.selectOption('none')
  const confirmMatch = form.getByLabel('Confirm exact Inventory product: Synthetic Cedar Herbicide 41')
  await expect(confirmMatch).toBeVisible()
  await expect(confirmMatch).not.toBeChecked()
  await expect(form.getByLabel('Quantity to remove (gal)')).toHaveCount(0)
  expect(network.requests.observedTargetMutationRpcs).toEqual([])

  await productName.fill('Free-typed Cedar product')
  await expect(confirmMatch).toHaveCount(0)
  await expect(form.getByText('No single active Inventory product exactly matches this product name. Inventory on hand will not change for this line.')).toBeVisible()
  expect(network.requests.observedTargetMutationRpcs).toEqual([])

  await productName.fill('Synthetic Cedar Herbicide 41')
  await confirmMatch.check()
  const quantity = form.getByLabel('Quantity to remove (gal)')
  await expect(form.getByText(/exact Inventory match will reduce on hand/i)).toHaveCount(0)
  await expect(form.getByText(/does NOT change inventory on hand/i)).toBeVisible()
  await expect(form).not.toContainText('NaN')
  await quantity.fill('0.001')
  await expect(quantity).toHaveValue('0.001')
  await expect(form.getByText('1 exact Inventory match will reduce on hand by the quantities you confirm.')).toBeVisible()

  await recordChoice.selectOption('create')
  await expect(confirmMatch).toHaveCount(0)
  await expect(quantity).toHaveCount(0)
  expect(network.requests.observedTargetMutationRpcs).toEqual([])
  await recordChoice.selectOption('none')
  await confirmMatch.check()
  await form.getByLabel('Quantity to remove (gal)').fill('0.001')

  await journeyActionsAtLeast48(form.getByRole('button', { name: 'Confirm applied' }))
  expect(network.requests.observedTargetMutationRpcs).toEqual([])
  await form.getByRole('button', { name: 'Confirm applied' }).click()
  await expect(pass.getByText('Applied 2027-07-07 · 40 acres · 1 confirmed Inventory match reduced on hand.')).toBeVisible()
  await expect(pass.getByText('Synthetic Cedar Herbicide 41 · Inventory reduced by 0.001 gal')).toBeVisible()
  expect(network.requests.observedTargetMutationRpcs).toEqual(['mark_program_pass_applied'])

  await page.reload()
  await page.getByRole('button', { name: 'Season progress' }).click()
  const reloadedPass = page.locator('.tracker-pass').filter({ hasText: 'CW-2 confirmed draw-down pass' })
  await expect(reloadedPass.getByText('Synthetic Cedar Herbicide 41 · Inventory reduced by 0.001 gal')).toBeVisible()
  await page.goto('/inventory')
  const shelf = page.locator('.shelf-card').filter({ hasText: 'Synthetic Cedar Herbicide 41' })
  await expect(shelf.locator('strong')).toHaveText('19.999 gal')
  await noOverflow(page)
  expect(network.requests.observedTargetMutationRpcs).toEqual(['mark_program_pass_applied'])
  expect(network.requests.unexpectedRpcs).toEqual([])
  expect(network.requests.blockedNonReadRequests).toEqual([])
  expect(network.external).toEqual([])
})
