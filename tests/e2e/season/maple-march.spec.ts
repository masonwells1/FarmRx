import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSeasonRequestClassifier } from './season-request-classifier'

const manifest = JSON.parse(readFileSync(resolve('tests/season/season-2027.manifest.json'), 'utf8')) as {
  fixtures: Array<{ label: string; uuid: string }>
}
const fixtures = new Map(manifest.fixtures.map(({ label, uuid }) => [label, uuid]))
const fixture = (label: string) => {
  const id = fixtures.get(label)
  if (!id) throw new Error(`Missing season fixture: ${label}`)
  return id
}

const fixedInstant = new Date('2027-03-22T07:30:00-05:00')
const ownerEmail = 'maple.owner@farmrx.local.test'
const productId = fixture('Maple known inventory product')
const receiptId = fixture('Maple receipt')
const lineId = fixture('Maple receipt line')
const operationId = '27ff0000-0000-4000-8000-000000000003'
const expectedMarchMutationRpcs = ['save_inventory_receipt_bundle']

declare global {
  interface Window {
    __farmRxMarchClockObservations: string[]
    __farmRxMarchIdentityObservations: string[]
  }
}

async function installDeterminism(page: Page, requests: ReturnType<typeof createSeasonRequestClassifier>) {
  const allowedNetworkOrigins = new Set(['http://127.0.0.1:4175', 'http://127.0.0.1:55321'])
  const forbiddenDestinations: string[] = []
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    const isNonNetworkAsset = url.protocol === 'data:' || url.protocol === 'blob:'
    if (!isNonNetworkAsset && !allowedNetworkOrigins.has(url.origin)) {
      forbiddenDestinations.push(route.request().url())
      await route.abort('blockedbyclient')
      return
    }
    if (url.origin === 'http://127.0.0.1:55321' && requests.observe(route.request().method(), route.request().url()).block) {
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
  await page.routeWebSocket(/^(?:ws|wss):\/\//, async (route) => {
    const url = new URL(route.url())
    if (url.hostname !== '127.0.0.1' || !['4175', '55321'].includes(url.port)) { forbiddenDestinations.push(route.url()); await route.close({ code: 1008, reason: 'March proof permits loopback only' }); return }
    route.connectToServer()
  })
  page.on('response', (response) => {
    if (response.url().startsWith('http://127.0.0.1:55321/') && response.status() >= 400) {
      console.log(`LOCAL_RESPONSE ${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`)
    }
  })
  page.on('requestfailed', (request) => {
    if (request.url().startsWith('http://127.0.0.1:55321/')) {
      console.log(`LOCAL_REQUEST_FAILED ${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText ?? 'unknown'}`)
    }
  })
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`BROWSER_CONSOLE_ERROR ${message.text()}`)
  })
  page.on('pageerror', (error) => console.log(`BROWSER_PAGE_ERROR ${error.message}`))
  await page.addInitScript(({ fixedMs, ids }) => {
    const RealDate = Date
    const clockObservations: string[] = []
    window.Date = new Proxy(RealDate, {
      construct(target, argumentsList) {
        const stack = new Error().stack ?? ''
        const useSeasonInstant = argumentsList.length === 0 && (stack.includes('/src/data/index.ts') || stack.includes('/src/data/createSupabaseInventoryServices.ts'))
        const result = Reflect.construct(target, useSeasonInstant ? [fixedMs] : argumentsList) as Date
        if (useSeasonInstant) clockObservations.push(result.toISOString())
        return result
      },
      apply(target, thisArgument, argumentsList) {
        return Reflect.apply(target, thisArgument, argumentsList)
      },
    }) as DateConstructor

    const original = crypto.randomUUID.bind(crypto)
    const dataIds = [ids.line, ids.operation]
    const observations: string[] = []
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: () => {
        const stack = new Error().stack ?? ''
        let value: string | undefined
        let source = ''
        if (stack.includes('/src/data/index.ts') && dataIds.length) {
          value = dataIds.shift()
          source = value === ids.line ? 'receipt-line' : 'queue-operation'
        } else if (stack.includes('/src/InventoryModule.tsx')) {
          value = ids.receipt
          source = 'ui-receipt'
        }
        if (!value) return original()
        observations.push(`${source}:${value}`)
        return value
      },
    })
    Object.defineProperty(window, '__farmRxMarchClockObservations', { value: clockObservations })
    Object.defineProperty(window, '__farmRxMarchIdentityObservations', { value: observations })
  }, { fixedMs: fixedInstant.getTime(), ids: { receipt: receiptId, line: lineId, operation: operationId } })
  return forbiddenDestinations
}

async function signIn(page: Page) {
  const password = process.env.FARMRX_SEASON_OWNER_PASSWORD
  if (!password) throw new Error('FARMRX_SEASON_OWNER_PASSWORD is required for the local synthetic owner.')
  await page.goto('/login')
  await page.getByLabel('Email address').fill(ownerEmail)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/fields(?:$|\/)/)
}

test('@march-write receives the exact Maple product through the real local UI', async ({ page }) => {
  const requests = createSeasonRequestClassifier({ targetMutationRpcs: expectedMarchMutationRpcs, blockUnexpectedNonReadRequests: true })
  const forbiddenDestinations = await installDeterminism(page, requests)

  await signIn(page)
  await page.getByRole('link', { name: 'Inventory' }).click()
  await expect(page.getByRole('heading', { name: 'Your shed, your records.' })).toBeVisible()
  await expect(page.getByText('Synthetic Herbicide 41 — Maple')).toBeVisible()
  expect(requests.observedTargetMutationRpcs, 'target mutation RPC ran before the March write action').toEqual([])
  expect(requests.unexpectedRpcs, 'unexpected RPC ran after password authentication').toEqual([])
  expect(requests.blockedNonReadRequests, 'unexpected non-read request ran after password authentication').toEqual([])

  await page.getByRole('button', { name: 'Receive product' }).click()
  const form = page.locator('form.inventory-form')
  await form.getByLabel('Product').selectOption(productId)
  await form.getByLabel('Quantity').fill('100.00')
  await form.locator('select[name="unit"]').selectOption('gal')
  await form.getByLabel('Received date').fill('2027-03-22')
  await form.getByLabel('Vendor (optional)').fill('Synthetic Ag Supply')
  await form.getByLabel('Status').selectOption('received')
  await form.getByRole('button', { name: 'Save receipt' }).click()

  await expect(page.locator('.inventory-success')).toHaveText('Receipt received and added to on-hand.')
  const history = page.locator('.receipt-history article').filter({ hasText: 'Synthetic Herbicide 41 — Maple' })
  await expect(history.getByText('Synthetic Herbicide 41 — Maple · 100 gal')).toBeVisible()
  await expect(history.getByText('received · 2027-03-22')).toBeVisible()

  await page.getByRole('button', { name: 'On-hand shelf' }).click()
  const shelf = page.locator('.shelf-card').filter({ hasText: 'Synthetic Herbicide 41 — Maple' })
  await expect(shelf.getByText('100')).toBeVisible()
  await expect(shelf.getByText('gal')).toBeVisible()

  expect(requests.observedTargetMutationRpcs.filter((name) => name === 'save_inventory_receipt_bundle')).toHaveLength(1)
  expect(requests.unexpectedRpcs, 'unexpected RPC ran after password authentication').toEqual([])
  expect(requests.blockedNonReadRequests, 'unexpected non-read request ran after password authentication').toEqual([])
  const clockObservations = await page.evaluate(() => window.__farmRxMarchClockObservations)
  expect(clockObservations.length).toBeGreaterThan(0)
  expect(new Set(clockObservations)).toEqual(new Set([fixedInstant.toISOString()]))
  const identityObservations = await page.evaluate(() => window.__farmRxMarchIdentityObservations)
  expect(new Set(identityObservations)).toEqual(new Set([`ui-receipt:${receiptId}`, `receipt-line:${lineId}`, `queue-operation:${operationId}`]))
  expect(identityObservations.filter((value) => value === `receipt-line:${lineId}`)).toHaveLength(1)
  expect(identityObservations.filter((value) => value === `queue-operation:${operationId}`)).toHaveLength(1)
  expect(forbiddenDestinations, 'browser attempted a destination outside the local app and disposable Supabase').toEqual([])
})
