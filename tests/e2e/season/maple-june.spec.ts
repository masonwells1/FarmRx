import { expect, test, type Page } from '@playwright/test'

const ownerEmail = 'maple.owner@farmrx.local.test'
const fixedInstant = new Date('2027-06-18T08:20:00-05:00')
const applicationProductId = '27044000-0000-4000-8000-000000000000'
const applicationId = '27043000-0000-4000-8000-000000000000'
const operationId = '27ff0000-0000-4000-8000-000000000006'

declare global {
  interface Window {
    __farmRxJuneArmManifestIds: () => void
    __farmRxJuneLockManifestIds: () => void
    __farmRxJuneIdentityObservations: string[]
    __farmRxJuneIdentityConsumptions: { product: number; application: number; operation: number }
    __farmRxJuneClockObservations: string[]
  }
}

async function installDeterminismAndFence(page: Page) {
  const localPorts = new Set(['4178', '55321'])
  const external: string[] = []
  const unsafe: string[] = []
  const rpcs: string[] = []
  let signedIn = false
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url())
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && (url.hostname !== '127.0.0.1' || !localPorts.has(url.port))) { external.push(`${request.method()} ${url.href}`); await route.abort('blockedbyclient'); return }
    if (signedIn && url.origin === 'http://127.0.0.1:55321' && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      const description = `${request.method()} ${url.pathname}`; unsafe.push(description)
      if (url.pathname.startsWith('/rest/v1/rpc/')) rpcs.push(url.pathname)
    }
    await route.continue()
  })
  await page.routeWebSocket(/^(?:ws|wss):\/\//, async route => {
    const url = new URL(route.url())
    if (url.hostname !== '127.0.0.1' || !localPorts.has(url.port)) { external.push(`WEBSOCKET ${url.href}`); await route.close({ code: 1008, reason: 'June proof permits loopback only' }); return }
    route.connectToServer()
  })
  await page.addInitScript(({ fixedMs, product, application, operation }) => {
    const RealDate = Date; const clocks: string[] = []
    window.Date = new Proxy(RealDate, {
      construct(target, args) { const stack = new Error().stack ?? ''; const fixed = args.length === 0 && stack.includes('/src/data/index.ts'); const result = Reflect.construct(target, fixed ? [fixedMs] : args) as Date; if (fixed) clocks.push(result.toISOString()); return result },
      apply(target, receiver, args) { return Reflect.apply(target, receiver, args) },
    }) as DateConstructor
    const original = crypto.randomUUID.bind(crypto); let phase: 'idle' | 'armed' | 'locked' = 'idle'
    const observations: string[] = []; const consumptions = { product: 0, application: 0, operation: 0 }
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => {
      const stack = new Error().stack ?? ''
      // After the queued operation identity is captured, later UI-only keys
      // (including the blank spray-line reset after a successful save) must use
      // normal randomness rather than being mistaken for manifest identities.
      if (phase === 'locked') return original()
      const target = stack.includes('/src/InventoryModule.tsx') && stack.includes('submit')
        ? consumptions.product === 0 ? 'product' : 'application'
        : stack.includes('/src/data/QueuedInventoryRepository.ts') && stack.includes('base') ? 'operation' : null
      if (!target) return original()
      if (phase !== 'armed') { observations.push(`${phase}:${target}`); throw new Error(`June manifest identity requested while ${phase}`) }
      if (target === 'product' && consumptions.product++ === 0) { observations.push(`product:${product}`); return product }
      if (target === 'application' && consumptions.application++ === 0) { observations.push(`application:${application}`); return application }
      if (target === 'operation' && consumptions.operation++ === 0) { observations.push(`operation:${operation}`); phase = 'locked'; return operation }
      observations.push(`duplicate:${target}`); throw new Error(`June manifest identity requested more than once: ${target}`)
    } })
    Object.defineProperties(window, {
      __farmRxJuneArmManifestIds: { value: () => { if (phase !== 'idle') throw new Error('June identity phase was not idle'); phase = 'armed' } },
      __farmRxJuneLockManifestIds: { value: () => { phase = 'locked' } },
      __farmRxJuneIdentityObservations: { value: observations }, __farmRxJuneIdentityConsumptions: { value: consumptions }, __farmRxJuneClockObservations: { value: clocks },
    })
  }, { fixedMs: fixedInstant.getTime(), product: applicationProductId, application: applicationId, operation: operationId })
  return { armSignedIn: () => { signedIn = true }, external, unsafe, rpcs }
}

async function signIn(page: Page, arm: () => void) {
  const password = process.env.FARMRX_SEASON_OWNER_PASSWORD
  if (!password) throw new Error('FARMRX_SEASON_OWNER_PASSWORD is required for the local synthetic owner.')
  await page.goto('/login'); await page.getByLabel('Email address').fill(ownerEmail); await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click(); arm(); await expect(page).toHaveURL(/\/fields(?:$|\/)/)
}

test('@june-write records one exact manual Maple application after a read-only Weather check', async ({ page }) => {
  const network = await installDeterminismAndFence(page); await signIn(page, network.armSignedIn)
  await page.getByRole('link', { name: /Weather/ }).click()
  const maple = page.locator('section.weather-card').filter({ hasText: 'Maple East 160' })
  await expect(maple.getByText('Set location to see weather.')).toBeVisible()
  await expect(maple.getByRole('button', { name: 'Use my current location' })).toBeVisible()
  await expect(maple.getByRole('button', { name: 'Enter latitude and longitude' })).toBeVisible()
  expect(network.unsafe).toEqual([]); expect(network.external).toEqual([])

  await page.getByRole('link', { name: 'Inventory' }).click(); await page.getByRole('button', { name: 'Spray record' }).click()
  const form = page.locator('form.spray-form')
  await form.getByLabel('Field').selectOption({ label: 'Maple East 160' })
  await form.getByLabel('Crop assignment').selectOption({ label: 'Yellow Corn · 160 ac' })
  await form.getByLabel('Applied acres').fill('160'); await form.getByLabel('Date').fill('2027-06-18'); await form.getByLabel('Time (good practice)').fill('08:20')
  await form.getByLabel('Target pest (good practice)').fill('Synthetic broadleaf')
  const product = form.locator('.spray-product-row').first(); await product.getByLabel('Product').selectOption({ label: 'Synthetic Herbicide 41 — Maple' })
  await product.getByLabel('Rate').fill('0.0625'); await product.getByLabel('Rate unit').selectOption('gal'); await product.getByLabel('Rate basis').selectOption('acre')
  await product.getByLabel('Total used').fill('10.00'); await product.getByLabel('Total unit').selectOption('gal'); await expect(product.getByLabel('Package factor if needed')).toHaveValue('')
  await form.getByLabel('Applicator name').fill('Scenario Operator'); await form.getByLabel('License no.').fill('PRESENCE-ONLY-2027')
  await form.getByLabel('Wind mph').fill('8.0'); await form.getByLabel('Wind direction').selectOption('SW'); await form.getByLabel('Temperature °F').fill('74.0'); await form.getByLabel('Relative humidity %').fill('52')
  await expect(form.getByLabel('Status')).toHaveValue('completed')
  await page.evaluate(() => window.__farmRxJuneArmManifestIds()); await form.getByRole('button', { name: 'Save spray record' }).click()
  await expect(page.getByRole('status')).toHaveText('Spray record saved. Product and label facts are copied into this record.')
  await page.evaluate(() => window.__farmRxJuneLockManifestIds())
  await page.getByRole('button', { name: 'On-hand shelf' }).click(); await expect(page.getByText('90 gal', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Spray record' }).click()
  const records = page.locator('section.inventory-panel').filter({ hasText: 'Program records' }); await expect(records.getByText(/2027-05-20 · 160 acres · Draft/)).toBeVisible(); await records.getByRole('button', { name: 'Open record' }).click()
  await expect(records.getByText('Free-Typed Program Herbicide · 10.00 gal total · $7/ac')).toBeVisible(); await expect(records.getByText('On-hand was not changed by these Program lines.')).toBeVisible()
  expect(network.rpcs).toEqual(['/rest/v1/rpc/save_inventory_application_bundle'])
  expect(network.unsafe).toEqual(['POST /rest/v1/rpc/save_inventory_application_bundle'])
  expect(network.external).toEqual([])
  expect(await page.evaluate(() => window.__farmRxJuneIdentityObservations)).toEqual([`product:${applicationProductId}`, `application:${applicationId}`, `operation:${operationId}`])
  expect(await page.evaluate(() => window.__farmRxJuneIdentityConsumptions)).toEqual({ product: 1, application: 1, operation: 1 })
  expect(new Set(await page.evaluate(() => window.__farmRxJuneClockObservations))).toEqual(new Set([fixedInstant.toISOString()]))
})

test('@june-write-phone shows 90 gallons and completed compliance without writing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const network = await installDeterminismAndFence(page); await signIn(page, network.armSignedIn)
  await page.getByRole('link', { name: 'Inventory' }).click(); await page.getByRole('button', { name: 'On-hand shelf' }).click(); await expect(page.getByText('90 gal', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Compliance' }).click(); const record = page.locator('article').filter({ hasText: 'Maple East 160 · 2027-06-18' })
  await expect(record.getByText('Synthetic Herbicide 41 — Maple · 160 acres')).toBeVisible()
  await expect(record.getByText('No restricted-use product in this record.')).toBeVisible()
  await expect(record.getByText('REI hours unknown')).toBeVisible(); await expect(record.getByText('PHI hours unknown')).toBeVisible()
  expect(network.rpcs).toEqual([]); expect(network.unsafe).toEqual([]); expect(network.external).toEqual([])
  expect(await page.evaluate(() => window.__farmRxJuneIdentityObservations)).toEqual([])
  expect(await page.evaluate(() => window.__farmRxJuneIdentityConsumptions)).toEqual({ product: 0, application: 0, operation: 0 })
})
