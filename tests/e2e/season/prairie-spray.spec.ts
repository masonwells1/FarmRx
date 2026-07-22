import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSeasonRequestClassifier } from './season-request-classifier'

const manifest = JSON.parse(readFileSync(resolve('tests/season/season-2027.manifest.json'), 'utf8')) as { fixtures: Array<{ label: string; uuid: string }> }
const fixtures = new Map(manifest.fixtures.map(({ label, uuid }) => [label, uuid]))
function fixture(label: string) { const value = fixtures.get(label); if (!value) throw new Error(`Missing season fixture: ${label}`); return value }

const fixedInstant = new Date('2027-06-15T14:10:00-05:00')
const managerEmail = 'prairie.manager@farmrx.local.test'
const farmId = fixture('Prairie Spray farm')
const productId = fixture('Prairie known inventory product')
const applicationId = fixture('Prairie application record')
const applicationProductId = fixture('Prairie application product')
const operationId = '27ff0000-0000-4000-8000-000000000015'

declare global {
  interface Window {
    __farmRxPrairieArmManifestIds: () => void
    __farmRxPrairieLockManifestIds: () => void
    __farmRxPrairieIdentityObservations: string[]
    __farmRxPrairieIdentityConsumptions: { product: number; application: number; operation: number }
    __farmRxPrairieClockObservations: string[]
  }
}

async function installDeterminismAndFence(page: Page, requests: ReturnType<typeof createSeasonRequestClassifier>) {
  const localPorts = new Set(['4179', '55321'])
  const external: string[] = []
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url())
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && (url.hostname !== '127.0.0.1' || !localPorts.has(url.port))) { external.push(`${request.method()} ${url.href}`); await route.abort('blockedbyclient'); return }
    if (url.origin === 'http://127.0.0.1:55321' && requests.observe(request.method(), request.url()).block) { await route.abort('blockedbyclient'); return }
    await route.continue()
  })
  await page.routeWebSocket(/^(?:ws|wss):\/\//, async route => {
    const url = new URL(route.url())
    if (url.hostname !== '127.0.0.1' || !localPorts.has(url.port)) { external.push(`WEBSOCKET ${url.href}`); await route.close({ code: 1008, reason: 'Prairie proof permits loopback only' }); return }
    route.connectToServer()
  })
  page.on('response', response => { if (response.url().startsWith('http://127.0.0.1:55321/') && response.status() >= 400) console.log(`LOCAL_RESPONSE ${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`) })
  page.on('requestfailed', request => { if (request.url().startsWith('http://127.0.0.1:55321/')) console.log(`LOCAL_REQUEST_FAILED ${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText ?? 'unknown'}`) })
  page.on('console', message => { if (message.type() === 'error') console.log(`BROWSER_CONSOLE_ERROR ${message.text()}`) })
  page.on('pageerror', error => console.log(`BROWSER_PAGE_ERROR ${error.message}`))
  await page.addInitScript(({ fixedMs, product, application, operation }) => {
    const RealDate = Date; const clocks: string[] = []
    window.Date = new Proxy(RealDate, {
      construct(target, args) { const stack = new Error().stack ?? ''; const fixed = args.length === 0 && (stack.includes('/src/data/index.ts') || stack.includes('/src/data/createSupabaseInventoryServices.ts')); const result = Reflect.construct(target, fixed ? [fixedMs] : args) as Date; if (fixed) clocks.push(result.toISOString()); return result },
      apply(target, receiver, args) { return Reflect.apply(target, receiver, args) },
    }) as DateConstructor
    const original = crypto.randomUUID.bind(crypto); let phase: 'idle' | 'armed' | 'locked' = 'idle'
    const observations: string[] = []; const consumptions = { product: 0, application: 0, operation: 0 }
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => {
      const stack = new Error().stack ?? ''
      if (phase === 'locked') return original()
      const target = stack.includes('/src/data/QueuedInventoryRepository.ts') && stack.includes('base')
        ? 'operation'
        : stack.includes('/src/InventoryModule.tsx') && stack.includes('submit') ? consumptions.product === 0 ? 'product' : 'application' : null
      if (!target) return original()
      if (phase !== 'armed') { observations.push(`${phase}:${target}`); throw new Error(`Prairie manifest identity requested while ${phase}`) }
      if (target === 'product' && consumptions.product++ === 0) { observations.push(`product:${product}`); return product }
      if (target === 'application' && consumptions.application++ === 0) { observations.push(`application:${application}`); return application }
      if (target === 'operation' && consumptions.operation++ === 0) { observations.push(`operation:${operation}`); phase = 'locked'; return operation }
      observations.push(`duplicate:${target}`); throw new Error(`Prairie manifest identity requested more than once: ${target}`)
    } })
    Object.defineProperties(window, {
      __farmRxPrairieArmManifestIds: { value: () => { if (phase !== 'idle') throw new Error('Prairie identity phase was not idle'); phase = 'armed' } },
      __farmRxPrairieLockManifestIds: { value: () => { phase = 'locked' } },
      __farmRxPrairieIdentityObservations: { value: observations }, __farmRxPrairieIdentityConsumptions: { value: consumptions }, __farmRxPrairieClockObservations: { value: clocks },
    })
  }, { fixedMs: fixedInstant.getTime(), product: applicationProductId, application: applicationId, operation: operationId })
  return { external }
}

async function signIn(page: Page) {
  const password = process.env.FARMRX_SEASON_OWNER_PASSWORD
  if (!password) throw new Error('FARMRX_SEASON_OWNER_PASSWORD is required for the local synthetic Prairie manager.')
  await page.goto('/login'); await page.getByLabel('Email address').fill(managerEmail); await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click(); await expect(page).toHaveURL(/\/fields(?:$|\/)/)
}

test('@prairie-spray manager saves the exact completed application through the local desktop UI', async ({ page }) => {
  const requests = createSeasonRequestClassifier({ targetMutationRpcs: ['save_inventory_application_bundle'], blockUnexpectedNonReadRequests: true })
  const network = await installDeterminismAndFence(page, requests); let retry: { url: string; headers: Record<string, string>; body: string } | null = null
  page.on('request', request => {
    if (new URL(request.url()).pathname.endsWith('/rpc/save_inventory_application_bundle')) retry = { url: request.url(), headers: request.headers(), body: request.postData() ?? '' }
  })
  await signIn(page)
  await page.getByRole('link', { name: 'Inventory' }).click(); await page.getByRole('button', { name: 'Spray record' }).click()
  const form = page.locator('form.spray-form')
  await form.getByLabel('Field').selectOption({ label: 'Prairie South 120' })
  await form.getByLabel('Crop assignment').selectOption({ label: 'Soybeans · 120 ac' })
  await form.getByLabel('Applied acres').fill('120.00'); await form.getByLabel('Date').fill('2027-06-15'); await form.getByLabel('Time (good practice)').fill('14:10')
  await form.getByLabel('Target pest (good practice)').fill('Synthetic broadleaf')
  const product = form.locator('.spray-product-row').first()
  await product.getByLabel('Product').selectOption({ label: 'Synthetic Herbicide 41 — restricted use' })
  await product.getByRole('spinbutton', { name: 'Rate', exact: true }).fill('0.0625'); await product.getByLabel('Rate unit').selectOption('gal'); await product.getByLabel('Rate basis').selectOption('acre')
  await product.getByLabel('Total used').fill('7.50'); await product.getByLabel('Total unit').selectOption('gal'); await expect(product.getByLabel('Package factor if needed')).toHaveValue('')
  await form.getByLabel('Applicator name').fill('Scenario Operator'); await form.getByLabel('License no.').fill('PRESENCE-ONLY-2027')
  await form.getByLabel('Wind mph').fill('8.0'); await form.getByLabel('Wind direction').selectOption('SW'); await form.getByLabel('Temperature °F').fill('74.0'); await form.getByLabel('Relative humidity %').fill('52')
  await expect(form.getByLabel('Status')).toHaveValue('completed')
  expect(requests.observedTargetMutationRpcs, 'target mutation RPC ran before the Prairie write action').toEqual([])
  await page.evaluate(() => window.__farmRxPrairieArmManifestIds()); await form.getByRole('button', { name: 'Save spray record' }).click()
  await expect(page.locator('.inventory-success,.inventory-error')).toBeVisible()
  if (await page.locator('.inventory-error').isVisible()) {
    const identity = await page.evaluate(() => ({ observations: window.__farmRxPrairieIdentityObservations, consumptions: window.__farmRxPrairieIdentityConsumptions }))
    throw new Error(`Prairie save failed before durable confirmation: ${JSON.stringify({ identity, targetRpcs: requests.observedTargetMutationRpcs, unexpectedRpcs: requests.unexpectedRpcs, blocked: requests.blockedNonReadRequests })}`)
  }
  await expect(page.locator('.inventory-success')).toHaveText('Spray record saved. Product and label facts are copied into this record.')
  if (!retry || !retry.body) throw new Error('Prairie proof did not capture the exact completed-application request for idempotent replay.')
  const retryResult = await page.evaluate(async ({ url, headers, body }) => {
    const safeHeaders = Object.fromEntries(Object.entries(headers).filter(([name]) => ['apikey', 'authorization', 'content-type', 'x-client-info', 'x-farm-rx-expected-user-id', 'x-farm-rx-access-epochs'].includes(name.toLowerCase())))
    const response = await fetch(url, { method: 'POST', headers: safeHeaders, body })
    return { status: response.status, body: await response.json() as { application?: { id?: string }, products?: Array<{ id?: string }> } }
  }, retry)
  expect(retryResult.status, 'idempotent application replay was rejected').toBe(200)
  expect(retryResult.body.application?.id, 'idempotent replay returned a different application').toBe(applicationId)
  expect(retryResult.body.products?.map(product => product.id), 'idempotent replay returned a different product line').toEqual([applicationProductId])
  await page.evaluate(() => window.__farmRxPrairieLockManifestIds())
  await page.getByRole('button', { name: 'On-hand shelf' }).click(); await expect(page.getByText('92.5 gal', { exact: true })).toBeVisible()
  expect(requests.observedTargetMutationRpcs).toEqual(['save_inventory_application_bundle', 'save_inventory_application_bundle'])
  expect(requests.unexpectedRpcs, 'unexpected RPC ran after manager authentication').toEqual([])
  expect(requests.blockedNonReadRequests, 'unexpected non-read request ran after manager authentication').toEqual([])
  expect(network.external).toEqual([])
  expect(await page.evaluate(() => window.__farmRxPrairieIdentityObservations)).toEqual([`product:${applicationProductId}`, `application:${applicationId}`, `operation:${operationId}`])
  expect(await page.evaluate(() => window.__farmRxPrairieIdentityConsumptions)).toEqual({ product: 1, application: 1, operation: 1 })
  expect(new Set(await page.evaluate(() => window.__farmRxPrairieClockObservations))).toEqual(new Set([fixedInstant.toISOString()]))
  expect(farmId).toBe('27010000-0000-4000-8000-000000000003'); expect(productId).toBe('27040000-0000-4000-8000-000000000001')
})

test('@prairie-spray phone-sized Compliance shows saved facts without writing or horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const requests = createSeasonRequestClassifier({ blockUnexpectedNonReadRequests: true }); const network = await installDeterminismAndFence(page, requests); await signIn(page)
  await page.getByRole('navigation').getByRole('button', { name: 'More' }).click(); await page.getByRole('link', { name: 'Inventory' }).click(); await page.getByRole('button', { name: 'Compliance' }).click()
  const record = page.locator('article').filter({ hasText: 'Prairie South 120 · 2027-06-15' })
  await expect(record.getByText('Synthetic Herbicide 41 · 120 acres')).toBeVisible()
  for (const fact of ['Application time', '14:10:00', 'Target pest', 'Synthetic broadleaf', 'Applicator', 'Scenario Operator', 'License or certification number entered', 'PRESENCE-ONLY-2027', '8 mph · SW', '74 °F', '52%', '0.0625 gal per acre', '7.5 gal', '00000-000', 'caution', '12 hr', '0 hr', '0.125 gal per acre']) await expect(record.getByText(fact, { exact: true })).toBeVisible()
  await expect(record.getByText('Restricted-entry interval (REI)', { exact: true })).toBeVisible(); await expect(record.getByText('Preharvest interval (PHI)', { exact: true })).toBeVisible(); await expect(record.getByText('Maximum label rate', { exact: true })).toBeVisible()
  const rendered = await record.innerText()
  expect(rendered).not.toMatch(/(?:license|certification).{0,40}\b(?:valid|verified|approved|eligible|unexpired|expired)\b/i)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(await record.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  expect(requests.observedTargetMutationRpcs).toEqual([])
  expect(requests.unexpectedRpcs, 'unexpected RPC ran during phone Compliance read').toEqual([])
  expect(requests.blockedNonReadRequests, 'unexpected non-read request ran during phone Compliance read').toEqual([])
  expect(network.external).toEqual([])
  expect(await page.evaluate(() => window.__farmRxPrairieIdentityObservations)).toEqual([])
  expect(await page.evaluate(() => window.__farmRxPrairieIdentityConsumptions)).toEqual({ product: 0, application: 0, operation: 0 })
})
