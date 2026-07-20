import { expect, test, type Page } from '@playwright/test'

const ownerEmail = 'maple.owner@farmrx.local.test'
const localPorts = new Set(['4176', '55321'])
const fixedInstant = new Date('2027-04-16T06:45:00-05:00')

declare global {
  interface Window {
    __farmRxAprilClockObservations: string[]
  }
}

async function installAprilClock(page: Page) {
  await page.addInitScript(({ fixedMs }) => {
    const RealDate = Date
    const observations: string[] = []
    window.Date = new Proxy(RealDate, {
      construct(target, argumentsList) {
        const stack = new Error().stack ?? ''
        const useSeasonInstant = argumentsList.length === 0 && stack.includes('/src/data/index.ts')
        const result = Reflect.construct(target, useSeasonInstant ? [fixedMs] : argumentsList) as Date
        if (useSeasonInstant) observations.push(result.toISOString())
        return result
      },
      apply(target, thisArgument, argumentsList) {
        return Reflect.apply(target, thisArgument, argumentsList)
      },
    }) as DateConstructor
    Object.defineProperty(window, '__farmRxAprilClockObservations', { value: observations })
  }, { fixedMs: fixedInstant.getTime() })
}

async function installAprilNetworkFence(page: Page) {
  const unsafeLocalRequests: string[] = []
  const externalRequests: string[] = []
  let postSignIn = false

  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const networkProtocol = ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)
    if (networkProtocol && (url.hostname !== '127.0.0.1' || !localPorts.has(url.port))) {
      externalRequests.push(`${request.method()} ${url.href}`)
      await route.abort('blockedbyclient')
      return
    }
    if (postSignIn && url.origin === 'http://127.0.0.1:55321' && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      unsafeLocalRequests.push(`${request.method()} ${url.pathname}`)
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })

  await page.routeWebSocket(/^(?:ws|wss):\/\//, async (route) => {
    const url = new URL(route.url())
    if (url.hostname !== '127.0.0.1' || !localPorts.has(url.port)) {
      externalRequests.push(`WEBSOCKET ${url.href}`)
      await route.close({ code: 1008, reason: 'April proof permits loopback only' })
      return
    }
    route.connectToServer()
  })

  return {
    armPostSignIn: () => { postSignIn = true },
    unsafeLocalRequests,
    externalRequests,
  }
}

async function signIn(page: Page, armPostSignIn: () => void) {
  const password = process.env.FARMRX_SEASON_OWNER_PASSWORD
  if (!password) throw new Error('FARMRX_SEASON_OWNER_PASSWORD is required for the local synthetic owner.')
  await page.goto('/login')
  await page.getByLabel('Email address').fill(ownerEmail)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  // Arm immediately after the explicit authentication request is dispatched,
  // before the first authenticated /fields load can issue any local API call.
  armPostSignIn()
  await expect(page).toHaveURL(/\/fields(?:$|\/)/)
}

function recordsCard(page: Page) {
  return page.locator('section.detail-card').filter({
    has: page.locator('.card-heading', { hasText: /^Records/ }),
  })
}

async function assertAprilRecordEditor(page: Page) {
  const records = recordsCard(page)
  await records.getByRole('button', { name: 'Edit' }).click()
  const existing = records.locator('.assignment-edit-row').filter({ hasText: '2027 · Yellow Corn · #1' })
  await expect(existing.getByLabel('Planted acres')).toHaveValue('160')
  await expect(existing.getByLabel('Harvested bushels')).toHaveValue('')
  await expect(records.getByLabel(/planting date/i)).toHaveCount(0)
  await expect(records.getByLabel(/harvest date/i)).toHaveCount(0)
  await expect(records.locator('input[type="date"]')).toHaveCount(0)
  await records.getByRole('button', { name: 'Cancel' }).click()
  await expect(records.getByRole('button', { name: 'Edit' })).toBeVisible()
  await expect(records.getByText('160 ac', { exact: true })).toBeVisible()
  await expect(records.getByText('Yield not entered', { exact: true })).toBeVisible()
}

test('@april-no-write inspects and cancels Maple records without writing', async ({ page }) => {
  await installAprilClock(page)
  const network = await installAprilNetworkFence(page)
  await signIn(page, network.armPostSignIn)

  await expect(page.getByText('Maple East 160')).toBeVisible()
  await page.getByText('Maple East 160').first().click()
  await expect(page.getByRole('heading', { name: 'Maple East 160' })).toBeVisible()
  await assertAprilRecordEditor(page)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Maple East 160' })).toBeVisible()
  await assertAprilRecordEditor(page)
  expect(network.unsafeLocalRequests, 'post-sign-in browser attempted an unsafe method against the disposable API').toEqual([])
  expect(network.externalRequests, 'browser attempted an external HTTP(S) or WS(S) destination').toEqual([])
  expect(await page.evaluate(() => new Set(window.__farmRxAprilClockObservations))).toEqual(new Set([fixedInstant.toISOString()]))
})
