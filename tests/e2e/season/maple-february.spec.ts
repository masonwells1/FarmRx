import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSeasonRequestClassifier } from './season-request-classifier'

const manifest = JSON.parse(readFileSync(resolve('tests/season/season-2027.manifest.json'), 'utf8')) as {
  fixtures: Array<{ label: string; uuid: string }>
}
const fixtures = new Map(manifest.fixtures.map(({ label, uuid }) => [label, uuid]))
const fixture = (label: string) => {
  const value = fixtures.get(label)
  if (!value) throw new Error(`Missing season fixture: ${label}`)
  return value
}

const ownerEmail = 'maple.owner@farmrx.local.test'
const fixedInstant = new Date('2027-02-18T09:00:00-06:00')
const programId = fixture('Maple synthetic program')
const passId = fixture('Maple program pass')
const productId = fixture('Maple program-pass product')
const assignmentId = fixture('Maple program assignment')
const assignedPassId = fixture('Maple assigned pass')
const assignedProductId = fixture('Maple assigned-program-pass product')
const expectedFebruaryMutationRpcs = ['save_program', 'save_program_pass', 'assign_program']

declare global {
  interface Window {
    __farmRxFebruaryIdentityObservations: string[]
    __farmRxFebruaryClockObservations: string[]
  }
}

async function installDeterminism(page: Page, requests: ReturnType<typeof createSeasonRequestClassifier>) {
  const allowedOrigins = new Set(['http://127.0.0.1:4174', 'http://127.0.0.1:55321'])
  const forbiddenDestinations: string[] = []
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (!['data:', 'blob:'].includes(url.protocol) && !allowedOrigins.has(url.origin)) { forbiddenDestinations.push(route.request().url()); await route.abort('blockedbyclient'); return }
    if (url.origin === 'http://127.0.0.1:55321' && requests.observe(route.request().method(), route.request().url()).block) { await route.abort('blockedbyclient'); return }
    await route.continue()
  })
  await page.routeWebSocket(/^(?:ws|wss):\/\//, async (route) => {
    const url = new URL(route.url())
    if (url.hostname !== '127.0.0.1' || !['4174', '55321'].includes(url.port)) { forbiddenDestinations.push(route.url()); await route.close({ code: 1008, reason: 'February proof permits loopback only' }); return }
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
        const useSeasonInstant = argumentsList.length === 0 && (stack.includes('/src/data/index.ts') || stack.includes('/src/data/createSupabaseProgramsServices.ts'))
        const result = Reflect.construct(target, useSeasonInstant ? [fixedMs] : argumentsList) as Date
        if (useSeasonInstant) clockObservations.push(result.toISOString())
        return result
      },
      apply(target, thisArgument, argumentsList) {
        return Reflect.apply(target, thisArgument, argumentsList)
      },
    }) as DateConstructor

    const original = crypto.randomUUID.bind(crypto)
    // React development StrictMode mounts the new Pass editor twice. Return
    // the same manifest ID for both mount attempts so the retained state is
    // deterministic rather than whichever random ID the second mount gets.
    const uiIds = [ids.program, ids.pass, ids.pass]
    const passSaveIds = ['27ff0000-0000-4000-8000-000000000001', ids.product]
    const assignmentIds = [ids.assignment, ids.assignedPass, ids.assignedProduct]
    const observations: string[] = []
    Object.defineProperty(crypto, 'randomUUID', {
      configurable: true,
      value: () => {
        const stack = new Error().stack ?? ''
        let value: string | undefined
        let source = ''
        if (stack.includes('/src/ProgramsModule.tsx') && uiIds.length) {
          value = uiIds.shift()
          source = 'ui'
        } else if (stack.includes('assignmentPlans') && assignmentIds.length) {
          value = assignmentIds.shift()
          source = 'assignment-plan'
        } else if (stack.includes('saveProgramPass') && passSaveIds.length) {
          value = passSaveIds.shift()
          source = 'pass-save'
        }
        if (!value) return original()
        observations.push(`${source}:${value}`)
        return value
      },
    })
    Object.defineProperty(window, '__farmRxFebruaryIdentityObservations', { value: observations })
    Object.defineProperty(window, '__farmRxFebruaryClockObservations', { value: clockObservations })
  }, {
    fixedMs: fixedInstant.getTime(),
    ids: { program: programId, pass: passId, product: productId, assignment: assignmentId, assignedPass: assignedPassId, assignedProduct: assignedProductId },
  })
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

test('@february-write creates and assigns the exact Maple Program through the real local UI', async ({ page }) => {
  const requests = createSeasonRequestClassifier({ targetMutationRpcs: expectedFebruaryMutationRpcs, blockUnexpectedNonReadRequests: true })
  const forbiddenDestinations = await installDeterminism(page, requests)

  await signIn(page)
  await page.getByRole('link', { name: 'Programs' }).click()
  await expect(page.getByRole('heading', { name: 'Programs', exact: true })).toBeVisible()
  expect(requests.observedTargetMutationRpcs, 'target mutation RPC ran before the February write action').toEqual([])
  expect(requests.unexpectedRpcs, 'unexpected RPC ran after password authentication').toEqual([])
  expect(requests.blockedNonReadRequests, 'unexpected non-read request ran after password authentication').toEqual([])

  await page.getByRole('button', { name: 'New program' }).click()
  await page.getByLabel('Program name').fill('Maple 2027 Corn Program')
  await page.getByLabel('Program type').selectOption('chemical')
  await page.getByLabel('Crop year').fill('2027')
  await page.getByRole('button', { name: 'Save program' }).click()
  await expect(page.getByRole('heading', { name: 'Programs', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Maple 2027 Corn Program' })).toBeVisible()

  const programCard = page.locator('.program-card').filter({ hasText: 'Maple 2027 Corn Program' })
  await programCard.getByRole('button', { name: 'Open' }).click()
  await page.getByRole('button', { name: 'Add pass' }).click()
  const editor = page.locator('.pass-editor')
  await editor.getByLabel('Name').fill('Post-emerge synthetic pass')
  await editor.getByLabel('Pass type').selectOption('post')
  await editor.getByLabel('Activity').selectOption('spray')
  await editor.getByLabel('Target date').fill('2027-05-20')
  await editor.getByLabel('Reminder lead days').fill('3')
  await editor.getByLabel('Product').fill('Free-Typed Program Herbicide')
  await editor.getByLabel('Rate').fill('10.00')
  await editor.getByLabel('Unit').fill('gal total')
  await editor.getByLabel('Est. $/ac').fill('7.00')
  await editor.getByRole('button', { name: 'Save pass' }).click()
  await expect(page.getByRole('heading', { name: 'Post-emerge synthetic pass' })).toBeVisible()

  await page.getByRole('button', { name: '← My programs' }).click()
  await page.getByRole('button', { name: 'Assign to fields' }).click()
  await expect(page.getByRole('heading', { name: 'Assign to fields' })).toBeVisible()
  await page.getByLabel('Program').selectOption({ label: 'Maple 2027 Corn Program — chemical' })
  await page.getByText(/Maple East 160 — Yellow Corn — 2027, planting 1/).click()
  await page.getByRole('button', { name: 'Assign to 1 field' }).click()
  await page.getByLabel('Program').selectOption(programId)
  await expect(page.getByText(/Already assigned/)).toBeVisible()

  await page.getByRole('button', { name: 'My programs' }).click()
  await programCard.getByRole('button', { name: 'Open' }).click()
  await expect(page.getByRole('heading', { name: 'Maple 2027 Corn Program' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Post-emerge synthetic pass' })).toBeVisible()
  await page.getByRole('button', { name: '← My programs' }).click()
  await page.getByRole('button', { name: 'Season progress' }).click()
  await expect(page.getByRole('heading', { name: 'Season progress' })).toBeVisible()
  await expect(page.getByText('Maple East 160').first()).toBeVisible()
  await expect(page.getByText('Maple 2027 Corn Program').first()).toBeVisible()
  await expect(page.getByText('Post-emerge synthetic pass').first()).toBeVisible()

  expect(requests.observedTargetMutationRpcs.filter((name) => name === 'save_program')).toHaveLength(1)
  expect(requests.observedTargetMutationRpcs.filter((name) => name === 'save_program_pass')).toHaveLength(1)
  expect(requests.observedTargetMutationRpcs.filter((name) => name === 'assign_program')).toHaveLength(1)
  expect(requests.unexpectedRpcs, 'unexpected RPC ran after password authentication').toEqual([])
  expect(requests.blockedNonReadRequests, 'unexpected non-read request ran after password authentication').toEqual([])
  const clockObservations = await page.evaluate(() => window.__farmRxFebruaryClockObservations)
  expect(clockObservations.length).toBeGreaterThan(0)
  expect(new Set(clockObservations)).toEqual(new Set([fixedInstant.toISOString()]))
  expect(forbiddenDestinations).toEqual([])
  expect(await page.evaluate(() => window.__farmRxFebruaryIdentityObservations)).toEqual([
    `ui:${programId}`,
    `ui:${passId}`,
    `ui:${passId}`,
    'pass-save:27ff0000-0000-4000-8000-000000000001',
    `pass-save:${productId}`,
    `assignment-plan:${assignmentId}`,
    `assignment-plan:${assignedPassId}`,
    `assignment-plan:${assignedProductId}`,
  ])
})
