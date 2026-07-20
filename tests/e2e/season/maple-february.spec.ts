import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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

declare global {
  interface Window {
    __farmRxFebruaryIdentityObservations: string[]
    __farmRxFebruaryClockObservations: string[]
  }
}

async function installDeterminism(page: Page) {
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
        const useSeasonInstant = argumentsList.length === 0 && stack.includes('/src/data/index.ts')
        const result = Reflect.construct(target, useSeasonInstant ? [fixedMs] : argumentsList) as Date
        if (useSeasonInstant) clockObservations.push(result.toISOString())
        return result
      },
      apply(target, thisArgument, argumentsList) {
        return Reflect.apply(target, thisArgument, argumentsList)
      },
    }) as DateConstructor

    const original = crypto.randomUUID.bind(crypto)
    const uiIds = [ids.program, ids.pass]
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
  await installDeterminism(page)
  const writes: string[] = []
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname
    if (path.includes('/rest/v1/rpc/') && request.method() === 'POST') writes.push(path)
  })

  await signIn(page)
  await page.getByRole('link', { name: 'Programs' }).click()
  await expect(page.getByRole('heading', { name: 'Programs', exact: true })).toBeVisible()
  expect(writes).toEqual([])

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

  expect(writes.filter((path) => path.endsWith('/save_program'))).toHaveLength(1)
  expect(writes.filter((path) => path.endsWith('/save_program_pass'))).toHaveLength(1)
  expect(writes.filter((path) => path.endsWith('/assign_program'))).toHaveLength(1)
  expect(await page.evaluate(() => new Set(window.__farmRxFebruaryClockObservations))).toEqual(new Set([fixedInstant.toISOString()]))
  expect(await page.evaluate(() => window.__farmRxFebruaryIdentityObservations)).toEqual([
    `ui:${programId}`,
    `ui:${passId}`,
    'pass-save:27ff0000-0000-4000-8000-000000000001',
    `pass-save:${productId}`,
    `assignment-plan:${assignmentId}`,
    `assignment-plan:${assignedPassId}`,
    `assignment-plan:${assignedProductId}`,
  ])
})
