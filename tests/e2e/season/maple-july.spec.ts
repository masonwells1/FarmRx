import { expect, test, type Page } from '@playwright/test'
import { createSeasonRequestClassifier } from './season-request-classifier'

const ownerEmail = 'maple.owner@farmrx.local.test'
const fixedInstant = new Date('2027-07-09T16:10:00-05:00')
const farmId = '27010000-0000-4000-8000-000000000001'
const fieldId = '27020000-0000-4000-8000-000000000001'
const ownerId = '27000000-0000-4000-8000-000000000001'
const noteId = '27060000-0000-4000-8000-000000000001'
const taskId = '27061000-0000-4000-8000-000000000001'
const scoutingOperationId = '27ff0000-0000-4000-8000-000000000007'
const taskOperationId = '27ff0000-0000-4000-8000-000000000107'
const taskMutationPath = '/rest/v1/farm_tasks'

declare global {
  interface Window {
    __farmRxJulyArm: (lane: 'scouting' | 'task') => void
    __farmRxJulyLockManifestIds: () => void
    __farmRxJulyIdentityObservations: string[]
    __farmRxJulyIdentityConsumptions: { note: number; scoutingOperation: number; task: number; taskOperation: number }
    __farmRxJulyClockObservations: string[]
  }
}

async function installDeterminismAndFence(page: Page, requests: ReturnType<typeof createSeasonRequestClassifier>) {
  const localPorts = new Set(['4178', '55321'])
  const external: string[] = []
  const taskBodies: unknown[] = []
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url())
    if (['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && (url.hostname !== '127.0.0.1' || !localPorts.has(url.port))) { external.push(`${request.method()} ${url.href}`); await route.abort('blockedbyclient'); return }
    if (url.origin === 'http://127.0.0.1:55321' && url.pathname === taskMutationPath && request.method() === 'POST') taskBodies.push(JSON.parse(request.postData() ?? 'null'))
    if (url.origin === 'http://127.0.0.1:55321' && requests.observe(request.method(), request.url()).block) { await route.abort('blockedbyclient'); return }
    await route.continue()
  })
  await page.routeWebSocket(/^(?:ws|wss):\/\//, async route => {
    const url = new URL(route.url())
    if (url.hostname !== '127.0.0.1' || !localPorts.has(url.port)) { external.push(`WEBSOCKET ${url.href}`); await route.close({ code: 1008, reason: 'July proof permits loopback only' }); return }
    route.connectToServer()
  })
  page.on('response', response => { if (response.url().startsWith('http://127.0.0.1:55321/') && response.status() >= 400) console.log(`LOCAL_RESPONSE ${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`) })
  page.on('requestfailed', request => { if (request.url().startsWith('http://127.0.0.1:55321/')) console.log(`LOCAL_REQUEST_FAILED ${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText ?? 'unknown'}`) })
  page.on('console', message => { if (message.type() === 'error') console.log(`BROWSER_CONSOLE_ERROR ${message.text()}`) })
  page.on('pageerror', error => console.log(`BROWSER_PAGE_ERROR ${error.message}`))
  await page.addInitScript(({ fixedMs, note, task, scoutingOperation, taskOperation }) => {
    const RealDate = Date; const clocks: string[] = []
    window.Date = new Proxy(RealDate, {
      construct(target, args) {
        const stack = new Error().stack ?? ''
        const fixed = args.length === 0 && (stack.includes('/src/data/farmDates.ts') || stack.includes('/src/data/createSupabaseScoutingServices.ts') || stack.includes('/src/data/createSupabaseEquipmentTasksServices.ts'))
        const result = Reflect.construct(target, fixed ? [fixedMs] : args) as Date
        if (fixed) clocks.push(result.toISOString())
        return result
      },
      apply(target, receiver, args) { return Reflect.apply(target, receiver, args) },
    }) as DateConstructor
    const original = crypto.randomUUID.bind(crypto); let phase: 'idle' | 'scouting' | 'task' | 'locked' = 'idle'
    const observations: string[] = []; const consumptions = { note: 0, scoutingOperation: 0, task: 0, taskOperation: 0 }
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => {
      const stack = new Error().stack ?? ''
      if (phase === 'scouting' && stack.includes('/src/ScoutingModule.tsx') && consumptions.note++ === 0) { observations.push(`note:${note}`); return note }
      if (phase === 'scouting' && stack.includes('/src/data/QueuedScoutingRepository.ts') && consumptions.scoutingOperation++ === 0) { observations.push(`scouting-operation:${scoutingOperation}`); return scoutingOperation }
      if (phase === 'task' && stack.includes('/src/EquipmentTasksModule.tsx') && consumptions.task++ === 0) { observations.push(`task:${task}`); return task }
      if (phase === 'task' && stack.includes('/src/data/QueuedEquipmentTasksRepository.ts') && consumptions.taskOperation++ === 0) { observations.push(`task-operation:${taskOperation}`); return taskOperation }
      return original()
    } })
    Object.defineProperties(window, {
      __farmRxJulyArm: { value: (next: 'scouting' | 'task') => { if (phase !== 'idle') throw new Error('July manifest identity phase was not idle'); phase = next } },
      __farmRxJulyLockManifestIds: { value: () => { phase = 'locked' } },
      __farmRxJulyIdentityObservations: { value: observations }, __farmRxJulyIdentityConsumptions: { value: consumptions }, __farmRxJulyClockObservations: { value: clocks },
    })
  }, { fixedMs: fixedInstant.getTime(), note: noteId, task: taskId, scoutingOperation: scoutingOperationId, taskOperation: taskOperationId })
  return { external, taskBodies }
}

async function signIn(page: Page) {
  const password = process.env.FARMRX_SEASON_OWNER_PASSWORD
  if (!password) throw new Error('FARMRX_SEASON_OWNER_PASSWORD is required for the local synthetic owner.')
  await page.goto('/login'); await page.getByLabel('Email address').fill(ownerEmail); await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click(); await expect(page).toHaveURL(/\/fields(?:$|\/)/)
}

function assertFence(requests: ReturnType<typeof createSeasonRequestClassifier>, external: string[]) {
  expect(requests.unexpectedRpcs, 'unexpected RPC ran after password authentication').toEqual([])
  expect(requests.blockedNonReadRequests, 'unexpected non-read request ran after password authentication').toEqual([])
  expect(external, 'external network traffic ran during July proof').toEqual([])
}

test('@july-scouting-write saves one exact note with a visible receipt and no follow-up task', async ({ page }) => {
  const requests = createSeasonRequestClassifier({ targetMutationRpcs: ['save_scouting_note'], blockUnexpectedNonReadRequests: true })
  const network = await installDeterminismAndFence(page, requests); await signIn(page)
  await page.getByRole('link', { name: 'Scouting' }).click()
  const maple = page.locator('article.scouting-card').filter({ hasText: 'Maple East 160' })
  await expect(maple.getByText('No scouting notes recorded yet.')).toBeVisible()
  expect(requests.observedTargetMutationRpcs, 'target mutation RPC ran before the July scouting action').toEqual([])
  assertFence(requests, network.external)
  await maple.getByRole('button', { name: 'New scouting note' }).click()
  const form = maple.locator('form.scouting-form')
  await form.getByLabel('Date').fill('2027-07-09'); await form.getByRole('button', { name: 'Weed' }).click(); await form.getByLabel('What did you find?').fill('Synthetic waterhemp at south gate')
  await expect(form.getByLabel('Add a follow-up task')).not.toBeChecked()
  await page.evaluate(() => window.__farmRxJulyArm('scouting')); await form.getByRole('button', { name: 'Save scouting note' }).click()
  await expect(maple.getByRole('status')).toHaveText('Saved'); await expect(maple.getByText('Synthetic waterhemp at south gate')).toBeVisible(); await expect(maple.getByText('Weed · 2027-07-09')).toBeVisible()
  await page.evaluate(() => window.__farmRxJulyLockManifestIds())
  expect(requests.observedTargetMutationRpcs).toEqual(['save_scouting_note'])
  assertFence(requests, network.external)
  expect(await page.evaluate(() => window.__farmRxJulyIdentityObservations)).toEqual([`note:${noteId}`, `scouting-operation:${scoutingOperationId}`])
  expect(await page.evaluate(() => window.__farmRxJulyIdentityConsumptions)).toEqual({ note: 1, scoutingOperation: 1, task: 0, taskOperation: 0 })
  expect(new Set(await page.evaluate(() => window.__farmRxJulyClockObservations))).toEqual(new Set([fixedInstant.toISOString()]))
})

test('@july-task-write saves one exact separate manual task with a visible receipt', async ({ page }) => {
  const requests = createSeasonRequestClassifier({ targetMutationPaths: [taskMutationPath], blockUnexpectedNonReadRequests: true })
  const network = await installDeterminismAndFence(page, requests); await signIn(page)
  await page.getByRole('link', { name: 'Tasks' }).click(); await expect(page.getByRole('heading', { name: 'Tasks' })).toBeVisible()
  expect(requests.observedTargetMutationPaths, 'target Task write ran before the July task action').toEqual([])
  assertFence(requests, network.external)
  await page.getByRole('button', { name: 'Add task' }).click()
  const form = page.locator('form.task-form')
  await form.getByLabel('Job').fill('Inspect Maple south gate'); await form.getByLabel('Details').fill('Check synthetic waterhemp patch.')
  await form.getByLabel('Assigned to').selectOption(ownerId); await form.getByLabel('Due date').fill('2027-07-10'); await form.getByLabel('Linked field').selectOption(fieldId)
  await page.evaluate(() => window.__farmRxJulyArm('task')); await form.getByRole('button', { name: 'Save task' }).click()
  await expect(page.getByRole('status')).toHaveText('Saved')
  const todo = page.locator('section.task-column').filter({ hasText: 'To Do' })
  await expect(todo.getByText('Inspect Maple south gate')).toBeVisible(); await expect(todo.getByText('Check synthetic waterhemp patch.')).toBeVisible()
  await page.evaluate(() => window.__farmRxJulyLockManifestIds())
  expect(requests.observedTargetMutationRpcs).toEqual([]); expect(requests.observedTargetMutationPaths).toEqual([taskMutationPath])
  assertFence(requests, network.external)
  expect(network.taskBodies).toEqual([{ id: taskId, farm_id: farmId, title: 'Inspect Maple south gate', details: 'Check synthetic waterhemp patch.', status: 'todo', priority: 'normal', assigned_to: ownerId, due_on: '2027-07-10', field_id: fieldId, equipment_id: null, source: 'manual', interval_id: null, interval_cycle_key: null, program_assigned_pass_id: null, program_cycle_key: null }])
  expect(await page.evaluate(() => window.__farmRxJulyIdentityObservations)).toEqual([`task:${taskId}`, `task-operation:${taskOperationId}`])
  expect(await page.evaluate(() => window.__farmRxJulyIdentityConsumptions)).toEqual({ note: 0, scoutingOperation: 0, task: 1, taskOperation: 1 })
  expect(new Set(await page.evaluate(() => window.__farmRxJulyClockObservations))).toEqual(new Set([fixedInstant.toISOString()]))
})

test('@july-read-only-phone shows the scouting timeline and To Do task without writing', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const requests = createSeasonRequestClassifier({ blockUnexpectedNonReadRequests: true })
  const network = await installDeterminismAndFence(page, requests); await signIn(page)
  await page.getByRole('navigation').getByRole('button', { name: 'More' }).click(); await page.getByRole('link', { name: 'Scouting' }).click()
  const maple = page.locator('article.scouting-card').filter({ hasText: 'Maple East 160' })
  await expect(maple.getByText('Synthetic waterhemp at south gate')).toBeVisible(); await expect(maple.getByText('Weed · 2027-07-09')).toBeVisible()
  await page.getByRole('navigation').getByRole('button', { name: 'More' }).click(); await page.getByRole('link', { name: 'Tasks' }).click()
  const todo = page.locator('section.task-column').filter({ hasText: 'To Do' })
  await expect(todo.getByText('Inspect Maple south gate')).toBeVisible(); await expect(todo.getByText('Check synthetic waterhemp patch.')).toBeVisible()
  expect(requests.observedTargetMutationRpcs).toEqual([]); expect(requests.observedTargetMutationPaths).toEqual([])
  assertFence(requests, network.external)
  expect(network.taskBodies).toEqual([])
  expect(await page.evaluate(() => window.__farmRxJulyIdentityObservations)).toEqual([])
  expect(await page.evaluate(() => window.__farmRxJulyIdentityConsumptions)).toEqual({ note: 0, scoutingOperation: 0, task: 0, taskOperation: 0 })
})
