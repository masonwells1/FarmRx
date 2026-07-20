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
const fixedInstant = new Date('2027-01-12T08:00:00-06:00')
const fieldId = fixture('Maple East 160 field')
const arrangementId = fixture('Maple East owned arrangement')
const cropId = fixture('Maple 2027 corn crop assignment')

declare global {
  interface Window {
    __farmRxSeasonIds: (ids: string[] | null) => void
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
  await page.addInitScript(({ fixedMs }) => {
    const RealDate = Date
    window.Date = new Proxy(RealDate, {
      construct(target, argumentsList) {
        const stack = new Error().stack ?? ''
        const shouldUseSeasonInstant = argumentsList.length === 0 && stack.includes('/src/data/index.ts')
        return Reflect.construct(target, shouldUseSeasonInstant ? [fixedMs] : argumentsList)
      },
      apply(target, thisArgument, argumentsList) {
        return Reflect.apply(target, thisArgument, argumentsList)
      },
    }) as DateConstructor
    const original = crypto.randomUUID.bind(crypto)
    let recordIds: string[] = []
    const seasonRandomUuid = () => {
      const stack = new Error().stack ?? ''
      if (stack.includes('normalizeFieldDraft') && recordIds.length) return recordIds.shift()!
      return original()
    }
    Object.defineProperty(window, '__farmRxSeasonIds', {
      configurable: false,
      value: (ids: string[] | null) => {
        recordIds = [...(ids ?? [])]
        Object.defineProperty(crypto, 'randomUUID', {
          configurable: true,
          value: ids === null ? original : seasonRandomUuid,
        })
      },
    })
  }, { fixedMs: fixedInstant.getTime() })
}

async function queueRecordIds(page: Page, ids: string[]) {
  await page.evaluate((values) => window.__farmRxSeasonIds(values), ids)
}

async function restoreRandomIds(page: Page) {
  await page.evaluate(() => window.__farmRxSeasonIds(null))
}

async function signIn(page: Page) {
  const password = process.env.FARMRX_SEASON_OWNER_PASSWORD
  if (!password) throw new Error('FARMRX_SEASON_OWNER_PASSWORD is required for the local synthetic owner.')
  await page.goto('/login')
  await page.getByLabel('Email address').fill(ownerEmail)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/fields(?:$|\/)/)
  await expect(page.getByRole('heading', { name: 'Fields', exact: true })).toBeVisible()
}

const card = (page: Page, title: string) => page.locator('.detail-card').filter({ has: page.locator('.card-heading', { hasText: title }) })

test('@desktop-write creates the exact Maple January field through the real local UI', async ({ page }) => {
  await installDeterminism(page)
  let fieldWrites = 0
  page.on('request', (request) => {
    if (request.url().includes('/rest/v1/rpc/save_field_bundle_versioned')) fieldWrites += 1
  })

  await signIn(page)
  expect(fieldWrites).toBe(0)

  await page.getByRole('link', { name: 'Full field details' }).click()
  await expect(page.getByRole('heading', { name: 'Add a field' })).toBeVisible()
  expect(fieldWrites).toBe(0)

  await page.getByLabel('Field name').fill('Maple East 160')
  await page.getByLabel('Total acres').fill('160.00')
  await page.getByLabel('County / location').fill('Jackson County')
  await queueRecordIds(page, [fieldId, arrangementId])
  await page.getByRole('button', { name: 'Save field' }).click()
  await expect(page).toHaveURL(new RegExp(`/fields/${fieldId}$`))
  await expect(page.getByRole('heading', { name: 'Maple East 160' })).toBeVisible()
  await restoreRandomIds(page)
  expect(fieldWrites).toBe(1)

  const basics = card(page, 'Basics')
  await basics.getByRole('button', { name: 'Edit' }).click()
  await basics.getByLabel('State').fill('IL')
  await basics.getByRole('button', { name: 'Save' }).click()
  await expect(basics.getByRole('button', { name: 'Edit' })).toBeVisible()
  await expect(basics.getByText('Jackson County, IL', { exact: true })).toBeVisible()
  expect(fieldWrites).toBe(2)

  const agreement = card(page, 'Land agreement')
  await agreement.getByRole('button', { name: 'Edit' }).click()
  await expect(agreement.getByLabel('Arrangement type')).toHaveValue('owned')
  await agreement.getByLabel('Terms effective from').fill('2027-01-01')
  await agreement.getByRole('button', { name: 'Save' }).click()
  await expect(agreement.getByRole('button', { name: 'Edit' })).toBeVisible()
  await expect(agreement.locator('dd').filter({ hasText: /^Owned$/ })).toBeVisible()
  expect(fieldWrites).toBe(3)

  const records = card(page, 'Records')
  await records.getByRole('button', { name: 'Edit' }).click()
  await records.getByRole('combobox').selectOption('corn_yellow')
  await records.getByLabel('Crop year').fill('2027')
  await records.getByLabel('Sequence').fill('1')
  await records.getByLabel('Planted acres').fill('160.00')
  await queueRecordIds(page, [cropId])
  await records.getByRole('button', { name: 'Save' }).click()
  await expect(records.getByText(/Yellow Corn/)).toBeVisible()
  await restoreRandomIds(page)
  expect(fieldWrites).toBe(4)

  const yieldPrice = card(page, 'Yield & price')
  await yieldPrice.getByRole('button', { name: 'Edit' }).click()
  await yieldPrice.getByLabel('Expected yield (bu/ac)').fill('200.0000')
  await expect(yieldPrice.getByLabel('Manual planned price ($/bu)')).toHaveValue('')
  await yieldPrice.getByRole('button', { name: 'Save' }).click()
  await expect(yieldPrice.getByText(/200/)).toBeVisible()
  expect(fieldWrites).toBe(5)

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Maple East 160' })).toBeVisible()
  await expect(page.getByRole('paragraph').filter({ hasText: /^Jackson County, IL$/ })).toBeVisible()
  await page.getByRole('link', { name: 'All fields' }).click()
  await expect(page.getByText('Maple East 160')).toBeVisible()
  expect(fieldWrites).toBe(5)
})

test('@phone-read reloads the January state without another field write', async ({ page }) => {
  await installDeterminism(page)
  let fieldWrites = 0
  page.on('request', (request) => {
    if (request.url().includes('/rest/v1/rpc/save_field_bundle_versioned')) fieldWrites += 1
  })

  await signIn(page)
  await expect(page.getByText('Maple East 160')).toBeVisible()
  await page.getByText('Maple East 160').first().click()
  await expect(page.getByRole('heading', { name: 'Maple East 160' })).toBeVisible()
  await expect(page.getByRole('paragraph').filter({ hasText: /^Jackson County, IL$/ })).toBeVisible()
  expect(fieldWrites).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})
