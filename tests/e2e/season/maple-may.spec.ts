import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createSeasonRequestClassifier } from './season-request-classifier'

const manifest = JSON.parse(readFileSync(resolve('tests/season/season-2027.manifest.json'), 'utf8')) as { fixtures: Array<{ label: string; uuid: string }> }
const fixtures = new Map(manifest.fixtures.map(({ label, uuid }) => [label, uuid]))
const fixture = (label: string) => { const id = fixtures.get(label); if (!id) throw new Error(`Missing season fixture: ${label}`); return id }
const ownerEmail = 'maple.owner@farmrx.local.test'
const fixedInstant = new Date('2027-05-20T10:15:00-05:00')
const draftId = fixture('Maple draft application record')
const operationId = '27ff0000-0000-4000-8000-000000000005'

declare global { interface Window { __farmRxMayArmManifestIds: () => void; __farmRxMayIdentityObservations: string[]; __farmRxMayIdentityConsumptions: { draft: number; operation: number }; __farmRxMayClockObservations: string[] } }

async function installDeterminismAndFence(page: Page, requests: ReturnType<typeof createSeasonRequestClassifier>) {
  const allowed = new Set(['http://127.0.0.1:4177', 'http://127.0.0.1:55321'])
  const forbidden: string[] = []
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (!['data:', 'blob:'].includes(url.protocol) && !allowed.has(url.origin)) { forbidden.push(route.request().url()); await route.abort('blockedbyclient'); return }
    if (url.origin === 'http://127.0.0.1:55321' && requests.observe(route.request().method(), route.request().url()).block) { await route.abort('blockedbyclient'); return }
    await route.continue()
  })
  await page.routeWebSocket(/^(?:ws|wss):\/\//, async route => {
    const url = new URL(route.url())
    if (url.hostname !== '127.0.0.1' || !['4177', '55321'].includes(url.port)) { forbidden.push(route.url()); await route.close({ code: 1008, reason: 'May proof permits loopback only' }); return }
    route.connectToServer()
  })
  await page.addInitScript(({ fixedMs, draft, operation }) => {
    const RealDate = Date
    const clocks: string[] = []
    window.Date = new Proxy(RealDate, {
      construct(target, args) { const stack = new Error().stack ?? ''; const fixed = args.length === 0 && (stack.includes('/src/data/index.ts') || stack.includes('/src/data/createSupabaseProgramsServices.ts')); const result = Reflect.construct(target, fixed ? [fixedMs] : args) as Date; if (fixed) clocks.push(result.toISOString()); return result },
      apply(target, receiver, args) { return Reflect.apply(target, receiver, args) },
    }) as DateConstructor
    const original = crypto.randomUUID.bind(crypto)
    const observations: string[] = []
    const consumptions = { draft: 0, operation: 0 }
    let phase: 'idle' | 'armed' | 'locked' = 'idle'
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => {
      const stack = new Error().stack ?? ''
      if (phase === 'armed' && stack.includes('/src/ProgramsModule.tsx') && consumptions.draft === 0) { consumptions.draft++; observations.push(`draft:${draft}`); return draft }
      if (phase === 'armed' && stack.includes('/src/data/QueuedProgramsRepository.ts') && consumptions.operation === 0) { consumptions.operation++; observations.push(`operation:${operation}`); phase = 'locked'; return operation }
      return original()
    } })
    Object.defineProperty(window, '__farmRxMayArmManifestIds', { value: () => { if (phase !== 'idle') throw new Error('May manifest identity phase was not idle'); phase = 'armed' } })
    Object.defineProperty(window, '__farmRxMayIdentityObservations', { value: observations })
    Object.defineProperty(window, '__farmRxMayIdentityConsumptions', { value: consumptions })
    Object.defineProperty(window, '__farmRxMayClockObservations', { value: clocks })
  }, { fixedMs: fixedInstant.getTime(), draft: draftId, operation: operationId })
  return forbidden
}

async function signIn(page: Page) {
  const password = process.env.FARMRX_SEASON_OWNER_PASSWORD
  if (!password) throw new Error('FARMRX_SEASON_OWNER_PASSWORD is required for the local synthetic owner.')
  await page.goto('/login'); await page.getByLabel('Email address').fill(ownerEmail); await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click(); await expect(page).toHaveURL(/\/fields(?:$|\/)/)
}

test('@may-write marks the Maple pass applied and exposes its draft Inventory record', async ({ page }) => {
  const requests = createSeasonRequestClassifier({ targetMutationRpcs: ['mark_program_pass_applied'], blockUnexpectedNonReadRequests: true })
  const forbidden = await installDeterminismAndFence(page, requests)
  await signIn(page)
  await page.evaluate(() => window.__farmRxMayArmManifestIds())
  await page.getByRole('link', { name: 'Programs' }).click()
  await page.getByRole('button', { name: 'Season progress' }).click()
  await expect(page.getByRole('heading', { name: 'Season progress' })).toBeVisible()
  expect(requests.observedTargetMutationRpcs, 'target mutation RPC ran before the May write action').toEqual([])
  expect(requests.unexpectedRpcs, 'unexpected RPC ran after password authentication').toEqual([])
  expect(requests.blockedNonReadRequests, 'unexpected non-read request ran after password authentication').toEqual([])
  const pass = page.locator('section.tracker-pass').filter({ hasText: 'Post-emerge synthetic pass' })
  await pass.getByRole('button', { name: 'Mark applied' }).click()
  await pass.getByLabel('Applied date').fill('2027-05-20')
  await pass.getByLabel('Applied acres').fill('160')
  await pass.getByLabel('Application record (optional)').selectOption('create')
  await expect(pass.getByText(/creates a new draft application record/i)).toBeVisible()
  await pass.getByLabel('Product').fill('Free-Typed Program Herbicide')
  await pass.getByLabel('Rate').fill('10.00')
  await pass.getByLabel('Unit').fill('gal total')
  await pass.getByLabel('Actual $/ac').fill('7.00')
  await pass.getByRole('button', { name: 'Confirm applied' }).click()
  await expect(pass.getByText(/Applied 2027-05-20 · 160 acres/)).toBeVisible()
  await expect(pass.getByText(/Application record linked/)).toBeVisible()
  await page.getByRole('link', { name: 'Inventory' }).click()
  await page.getByRole('button', { name: 'Spray record' }).click()
  const records = page.locator('section.inventory-panel').filter({ hasText: 'Program records' })
  await expect(records.getByText(/2027-05-20 · 160 acres · Draft/)).toBeVisible()
  await records.getByRole('button', { name: 'Open record' }).click()
  await expect(records.getByText('Free-Typed Program Herbicide · 10.00 gal total · $7/ac')).toBeVisible()
  await expect(records.getByText('On-hand was not changed by these Program lines.')).toBeVisible()
  expect(requests.observedTargetMutationRpcs).toEqual(['mark_program_pass_applied'])
  expect(requests.unexpectedRpcs, 'unexpected RPC ran after password authentication').toEqual([])
  expect(requests.blockedNonReadRequests, 'unexpected non-read request ran after password authentication').toEqual([])
  expect(await page.evaluate(() => window.__farmRxMayIdentityObservations)).toEqual([`draft:${draftId}`, `operation:${operationId}`])
  expect(await page.evaluate(() => window.__farmRxMayIdentityConsumptions)).toEqual({ draft: 1, operation: 1 })
  expect(new Set(await page.evaluate(() => window.__farmRxMayClockObservations))).toEqual(new Set([fixedInstant.toISOString()]))
  expect(forbidden).toEqual([])
})

test('@may-write-phone phone view confirms the applied pass without writing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const requests = createSeasonRequestClassifier({ blockUnexpectedNonReadRequests: true })
  const forbidden = await installDeterminismAndFence(page, requests)
  await signIn(page); await page.getByRole('navigation').getByRole('button', { name: 'More' }).click(); await page.getByRole('link', { name: 'Programs' }).click(); await page.getByRole('button', { name: 'Season progress' }).click()
  const pass = page.locator('section.tracker-pass').filter({ hasText: 'Post-emerge synthetic pass' })
  await expect(pass.getByText(/Applied 2027-05-20 · 160 acres/)).toBeVisible(); await expect(pass.getByRole('button', { name: 'Mark applied' })).toHaveCount(0)
  expect(requests.observedTargetMutationRpcs).toEqual([])
  expect(requests.unexpectedRpcs, 'unexpected RPC ran after password authentication').toEqual([])
  expect(requests.blockedNonReadRequests, 'unexpected non-read request ran after password authentication').toEqual([])
  expect(await page.evaluate(() => window.__farmRxMayIdentityObservations)).toEqual([])
  expect(await page.evaluate(() => window.__farmRxMayIdentityConsumptions)).toEqual({ draft: 0, operation: 0 })
  expect(forbidden).toEqual([])
})
