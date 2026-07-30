import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

const ids = {
  project: 'farmrxlocalsimplicity2027',
  owner: '27000000-0000-4000-8000-000000000001',
  manager: '27000000-0000-4000-8000-000000000002',
  worker: '27000000-0000-4000-8000-000000000003',
  readOnly: '27000000-0000-4000-8000-000000000004',
  rep: '27000000-0000-4000-8000-000000000005',
  outsider: '27000000-0000-4000-8000-000000000006',
  maple: '27010000-0000-4000-8000-000000000001',
  north: '27010000-0000-4000-8000-000000000002',
  field: '27020000-0000-4000-8000-000000000002',
  task: '27061000-0000-4000-8000-000000000002',
  deniedTask: '27061000-0000-4000-8000-000000000003',
  estimate: '27070000-0000-4000-8000-000000000002',
  budget: '27077000-0000-4000-8000-000000000002',
  createOperation: '27092000-0000-4000-8000-000000000001',
  completeOperation: '27092000-0000-4000-8000-000000000002',
  ownerMapleToken: '27093000-0000-4000-8000-000000000001',
  ownerNorthToken: '27093000-0000-4000-8000-000000000002',
  managerToken: '27093000-0000-4000-8000-000000000003',
  workerToken: '27093000-0000-4000-8000-000000000004',
  readOnlyToken: '27093000-0000-4000-8000-000000000005',
  repInitialToken: '27093000-0000-4000-8000-000000000006',
  repRevokedToken: '27093000-0000-4000-8000-000000000007',
}

const emails = {
  owner: 'north.owner@farmrx.local.test',
  manager: 'north.manager@farmrx.local.test',
  worker: 'north.worker@farmrx.local.test',
  readOnly: 'north.readonly@farmrx.local.test',
  rep: 'north.rep@farmrx.local.test',
  outsider: 'north.outsider@farmrx.local.test',
}

declare global {
  interface Window {
    __nfInstant: string
    __nfFenceTokens: string[]
    __nfTaskIds: string[]
    __nfTaskOperationIds: string[]
  }
}

type NetworkEvidence = { external: string[]; writes: string[]; results: string[] }
type RestResult = { status: number; body: unknown }

function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for North Fork proof.`)
  return value
}

const fenceKey = (user: string, farm = ids.north) => `farm-rx-revocation-fence:v1:${ids.project}:${user}:${farm}`
const generationKey = (user: string, farm = ids.north) => `farm-rx-revocation-generation:v1:${ids.project}:${user}:${farm}`
const queueKey = (user: string) => `farm-rx-equipment-tasks-queue:v1:${ids.project}:${user}:${ids.north}`
const recoveryKey = (user: string) => `farm-rx-revoked-work-recovery:v1:${ids.project}:${user}`

async function installDeterminism(page: Page, tokens: string[]) {
  const instant = required('FARMRX_NF_CLIENT_INSTANT')
  await page.addInitScript(({ fixed, fenceTokens }) => {
    const RealDate = Date
    window.__nfInstant = fixed
    window.__nfFenceTokens = [...fenceTokens]
    window.__nfTaskIds = []
    window.__nfTaskOperationIds = []
    const governed = () => {
      const stack = new Error().stack ?? ''
      const application = stack.indexOf('/src/')
      const dependencies = [stack.indexOf('/node_modules/'), stack.indexOf('/.vite/deps/'), stack.indexOf('/@fs/')].filter(index => index >= 0)
      const dependency = dependencies.length ? Math.min(...dependencies) : -1
      return application >= 0 && (dependency < 0 || application < dependency)
        && /(?:farmContext|farmRevocationFence|farmAccessEpoch|FarmPrivacyPage|SupabaseFarmSharing|EquipmentTasksModule|QueuedEquipmentTasksRepository|equipmentTasksWriteQueue|workspaceCache|deviceClockFence)\.(?:ts|tsx)/.test(stack)
    }
    window.Date = new Proxy(RealDate, {
      construct(target, args) { return Reflect.construct(target, args.length === 0 && governed() ? [RealDate.parse(window.__nfInstant)] : args) as Date },
      apply(target, receiver, args) { return Reflect.apply(target, receiver, args) },
      get(target, property, receiver) {
        if (property === 'now') return () => governed() ? RealDate.parse(window.__nfInstant) : RealDate.now()
        return Reflect.get(target, property, receiver)
      },
    }) as DateConstructor
    const original = crypto.randomUUID.bind(crypto)
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => {
      const stack = new Error().stack ?? ''
      if (stack.includes('/src/data/farmRevocationFence.ts') && window.__nfFenceTokens.length) return window.__nfFenceTokens.shift()!
      if (stack.includes('/src/data/QueuedEquipmentTasksRepository.ts') && window.__nfTaskOperationIds.length) return window.__nfTaskOperationIds.shift()!
      if (stack.includes('/src/EquipmentTasksModule.tsx') && window.__nfTaskIds.length) return window.__nfTaskIds.shift()!
      return original()
    } })
  }, { fixed: instant, fenceTokens: tokens })
}

async function fenceNetwork(context: BrowserContext): Promise<NetworkEvidence> {
  const evidence: NetworkEvidence = { external: [], writes: [], results: [] }
  context.on('request', request => {
    const url = new URL(request.url())
    if (url.port === '55321' && url.pathname.startsWith('/rest/v1/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      evidence.writes.push(`${request.method()} ${url.pathname}`)
    }
  })
  context.on('response', response => {
    const url = new URL(response.url())
    if (url.port === '55321' && url.pathname.startsWith('/rest/v1/') && !['GET', 'HEAD', 'OPTIONS'].includes(response.request().method())) {
      evidence.results.push(`${response.status()} ${response.request().method()} ${url.pathname}`)
    }
  })
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname === 's3.tradingview.com' && url.pathname === '/external-embedding/embed-widget-mini-symbol-overview.js') {
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
      return
    }
    if (url.hostname !== '127.0.0.1' || !['4182', '55321'].includes(url.port)) {
      evidence.external.push(`${route.request().method()} ${url.href}`)
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
  return evidence
}

async function signIn(page: Page, email: string, farm?: string, blocked = false) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(required('FARMRX_SEASON_OWNER_PASSWORD'))
  const unavailable = page.getByText('We could not reach Farm Rx. Check your signal and try again.', { exact: true })
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForTimeout(1000)
    if (!page.url().endsWith('/login')) break
    if (!(await unavailable.isVisible()) || attempt === 3) break
    await page.waitForTimeout(500)
  }
  if (farm) {
    await expect(page.getByRole('heading', { name: 'Choose a farm' })).toBeVisible()
    await page.getByRole('button', { name: farm }).click()
  }
  if (blocked) {
    await expect(page.getByText('Crop RX needs to finish your farm setup.')).toBeVisible()
    return
  }
  await expect(page).toHaveURL(/\/fields/)
  await expect(page.getByRole('heading', { name: 'Fields' })).toBeVisible()
}

async function directRest(page: Page, method: string, path: string, body?: unknown, epochOverride?: number): Promise<RestResult> {
  return page.evaluate(async ({ apiUrl, publishableKey, project, farm, method, path, body, epochOverride }) => {
    const session = JSON.parse(localStorage.getItem(`farm-rx-auth:${project}`) ?? 'null') as { access_token?: string; user?: { id?: string } } | null
    if (!session?.access_token || !session.user?.id) throw new Error('Synthetic browser session is missing.')
    const epochRaw = localStorage.getItem(`farm-rx-server-access-epochs:v1:${project}:${session.user.id}`)
    const epochs = epochOverride === undefined
      ? (JSON.parse(epochRaw ?? '{"epochs":{}}') as { epochs?: Record<string, number> }).epochs ?? {}
      : { [farm]: epochOverride }
    const headers: Record<string, string> = {
      apikey: publishableKey,
      Authorization: `Bearer ${session.access_token}`,
      'x-farm-rx-expected-user-id': session.user.id,
      'x-farm-rx-access-epochs': JSON.stringify(epochs),
      Accept: 'application/json',
      Prefer: 'return=representation',
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetch(`${apiUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    let parsed: unknown = text
    try { parsed = text ? JSON.parse(text) : null } catch { /* exact status plus body text remains evidence */ }
    return { status: response.status, body: parsed }
  }, { apiUrl: required('FARMRX_NF_API_URL'), publishableKey: required('FARMRX_NF_PUBLISHABLE_KEY'), project: ids.project, farm: ids.north, method, path, body, epochOverride })
}

function rows(result: RestResult): unknown[] {
  return Array.isArray(result.body) ? result.body : []
}

function expectDenied(result: RestResult) {
  expect(rows(result), `Denied request returned rows with status ${result.status}`).toHaveLength(0)
  expect(result.status).not.toBe(201)
}

async function noOverflow(page: Page, label: string) {
  const size = await page.evaluate(() => {
    const viewport = window.innerWidth
    const offenders = [...document.body.querySelectorAll<HTMLElement>('*')].map(element => {
      const rect = element.getBoundingClientRect()
      return { tag: element.tagName.toLowerCase(), className: element.className, text: (element.textContent ?? '').trim().slice(0, 80), left: rect.left, right: rect.right, width: rect.width, scrollWidth: element.scrollWidth }
    }).filter(item => item.right > viewport + 0.5 || item.left < -0.5).slice(0, 12)
    return { document: document.documentElement.scrollWidth, body: document.body.scrollWidth, viewport, offenders }
  })
  expect(size.document, `${label} document overflow: ${JSON.stringify(size.offenders)}`).toBeLessThanOrEqual(size.viewport)
  expect(size.body, `${label} body overflow: ${JSON.stringify(size.offenders)}`).toBeLessThanOrEqual(size.viewport)
}

async function setTaskIds(page: Page, taskIds: string[], operationIds: string[]) {
  await page.evaluate(({ taskIds, operationIds }) => {
    window.__nfTaskIds = [...taskIds]
    window.__nfTaskOperationIds = [...operationIds]
  }, { taskIds, operationIds })
}

async function scopeStorage(page: Page, user: string) {
  return page.evaluate(async ({ project, user, farm, fence, generation, queue, recovery, access, active, epochs }) => {
    const local: Record<string, string> = {}
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index)
      if (key && (
        key.includes(`${project}:${user}:${farm}`)
        || key === recovery
        || key === access
        || key === active
        || key === epochs
      )) local[key] = localStorage.getItem(key)!
    }
    const factory = indexedDB as IDBFactory & { databases?: () => Promise<Array<{ name?: string }>> }
    const databaseName = `farm-rx-offline-v1-${project}`
    const known = typeof factory.databases === 'function' ? await factory.databases() : []
    let workspaces: unknown[] = []
    if (known.some(entry => entry.name === databaseName)) {
      const request = indexedDB.open(databaseName)
      const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      try {
        if (database.objectStoreNames.contains('workspaces')) {
          const transaction = database.transaction('workspaces', 'readonly')
          workspaces = await new Promise<unknown[]>((resolve, reject) => {
            const get = transaction.objectStore('workspaces').getAll()
            get.onsuccess = () => resolve(get.result)
            get.onerror = () => reject(get.error)
          })
        }
      } finally { database.close() }
    }
    return {
      local,
      fence: JSON.parse(localStorage.getItem(fence) ?? 'null'),
      generation: JSON.parse(localStorage.getItem(generation) ?? 'null'),
      queue: localStorage.getItem(queue),
      recovery: localStorage.getItem(recovery),
      access: localStorage.getItem(access),
      workspaces: workspaces.filter(value => {
        const row = value as { projectRef?: string; userId?: string; farmId?: string }
        return row.projectRef === project && row.userId === user && row.farmId === farm
      }),
    }
  }, {
    project: ids.project,
    user,
    farm: ids.north,
    fence: fenceKey(user),
    generation: generationKey(user),
    queue: queueKey(user),
    recovery: recoveryKey(user),
    access: `farm-rx-access:v1:${ids.project}:${user}`,
    active: `farm-rx-active-context:v1:${ids.project}`,
    epochs: `farm-rx-server-access-epochs:v1:${ids.project}:${user}`,
  })
}

function expectNoPendingStorage(storage: Awaited<ReturnType<typeof scopeStorage>>) {
  for (const [key, value] of Object.entries(storage.local)) {
    const parsed = JSON.parse(value) as { entries?: unknown[]; records?: unknown[] }
    if (Array.isArray(parsed.entries)) expect(parsed.entries, `${key} retained queued work`).toEqual([])
    if (key.endsWith(':needs-attention')) expect(parsed.records, `${key} retained needs-attention work`).toEqual([])
  }
  expect(storage.recovery).toBeNull()
}

async function newGovernedContext(browser: Browser, viewport: { width: number; height: number } | null, tokens: string[]) {
  const context = await browser.newContext({ baseURL: required('FARMRX_NF_APP_URL'), viewport: viewport ?? { width: 1440, height: 900 }, serviceWorkers: 'block' })
  const network = await fenceNetwork(context)
  const page = await context.newPage()
  await installDeterminism(page, tokens)
  return { context, network, page }
}

async function followFarmRxLink(page: Page, label: string) {
  if ((page.viewportSize()?.width ?? 1440) <= 767 && !['Fields', 'Grain'].includes(label)) {
    const navigation = page.getByRole('navigation', { name: 'Farm Rx navigation' })
    await navigation.getByRole('button', { name: 'More' }).click()
    await page.getByRole('region', { name: 'More Farm Rx destinations' }).getByRole('link', { name: label, exact: true }).click()
    return
  }
  await page.getByRole('link', { name: label, exact: true }).click()
}

test('@north-fork-nf1 owner baseline, farm switching, rep/outsider denial', async ({ browser, context, page }) => {
  await installDeterminism(page, [ids.ownerMapleToken, ids.ownerNorthToken])
  const network = await fenceNetwork(context)
  await signIn(page, emails.owner, 'North Fork')
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: 'Farm privacy' })).toBeVisible()
  await expect(page.getByText('Private', { exact: true })).toBeVisible()
  await page.goto('/grain'); await expect(page.getByText(/15,200 bu/).first()).toBeVisible()
  await page.goto('/profitability'); await expect(page.getByText('Synthetic North 2027 Base').first()).toBeVisible()
  let mapleRequestStarted = false
  let releaseMapleRequest = () => {}
  const mapleRequestGate = new Promise<void>(resolve => { releaseMapleRequest = resolve })
  await page.route('**/rest/v1/farms?**', async route => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'GET' && url.searchParams.get('id') === `eq.${ids.maple}`) {
      mapleRequestStarted = true
      await mapleRequestGate
    }
    await route.continue()
  })
  await page.getByLabel('Active farm').selectOption(ids.maple)
  await expect.poll(() => mapleRequestStarted).toBe(true)
  await expect(page.getByText('Synthetic North 2027 Base')).toHaveCount(0)
  await expect(page.getByText(/15,200 bu/)).toHaveCount(0)
  await expect(page.getByLabel('Active farm')).toBeHidden()
  await expect(page.getByText('Opening your farm…')).toBeVisible()
  releaseMapleRequest()
  await expect(page).toHaveURL(/\/fields/)
  await expect(page.getByLabel('Active farm')).toHaveValue(ids.maple)
  await expect(page.getByText('Total fields').locator('..').getByText('0', { exact: true })).toBeVisible()
  await expect(page.getByText('North Home 80')).toHaveCount(0)
  await page.getByLabel('Active farm').selectOption(ids.north)
  await expect(page.getByText('North Home 80')).toBeVisible()

  const ownerStorage = await scopeStorage(page, ids.owner)
  expect(ownerStorage.fence).toMatchObject({ version: 2, generation: 2, token: ids.ownerNorthToken, serverEpoch: 1, revoked: false })
  expect(JSON.parse(ownerStorage.local[`farm-rx-active-context:v1:${ids.project}`] ?? 'null')).toEqual({ version: 1, userId: ids.owner, farmId: ids.north })
  expectNoPendingStorage(ownerStorage)

  const rep = await newGovernedContext(browser, page.viewportSize(), [])
  await signIn(rep.page, emails.rep, undefined, true)
  expect(rows(await directRest(rep.page, 'GET', `/rest/v1/farms?id=eq.${ids.north}&select=id`))).toEqual([])
  expect(rows(await directRest(rep.page, 'GET', `/rest/v1/production_estimates?id=eq.${ids.estimate}&select=id`))).toEqual([])
  const outsider = await newGovernedContext(browser, page.viewportSize(), [])
  await signIn(outsider.page, emails.outsider, undefined, true)
  expect(rows(await directRest(outsider.page, 'GET', `/rest/v1/fields?id=eq.${ids.field}&select=id`))).toEqual([])
  expectDenied(await directRest(outsider.page, 'POST', '/rest/v1/farm_tasks?select=id', {
    id: ids.deniedTask, farm_id: ids.north, title: 'Denied outsider task', details: null, status: 'todo', priority: 'normal',
    assigned_to: null, due_on: null, field_id: null, equipment_id: null, source: 'manual', interval_id: null, interval_cycle_key: null,
  }, 1))
  expect(rep.network.external).toEqual([]); expect(outsider.network.external).toEqual([])
  await rep.context.close(); await outsider.context.close()
  expect(network.external).toEqual([]); await noOverflow(page, 'NF-1')
})

test('@north-fork-nf2 owner explicitly enables rep sharing once', async ({ context, page }) => {
  await installDeterminism(page, [ids.ownerMapleToken, ids.ownerNorthToken])
  const network = await fenceNetwork(context)
  await signIn(page, emails.owner, 'North Fork')
  await page.goto('/privacy')
  const before = await scopeStorage(page, ids.owner)
  expect(before.access).not.toBeNull()
  expectNoPendingStorage(before)
  const sharing = page.getByRole('switch', { name: 'Share my grain position with my Crop RX rep' })
  await expect(sharing).toHaveAttribute('aria-checked', 'false')
  page.once('dialog', dialog => { expect(dialog.message()).toContain('private financial information'); void dialog.accept() })
  await sharing.click()
  await expect(sharing).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByText('Shared with your assigned rep')).toBeVisible()
  const after = await scopeStorage(page, ids.owner)
  expect(after.access).not.toBeNull()
  expect(JSON.parse(after.access!)).toMatchObject({ version: 1, userId: ids.owner, selectedFarmId: ids.north })
  expect(after.workspaces.length).toBeGreaterThan(0)
  expectNoPendingStorage(after)
  expect(network.writes.filter(item => item === 'PATCH /rest/v1/farms')).toEqual(['PATCH /rest/v1/farms'])
  expect(network.external).toEqual([]); await noOverflow(page, 'NF-2')
})

test('@north-fork-nf3 rep reads private sentinels and writes nothing', async ({ context, page }) => {
  await installDeterminism(page, [ids.repInitialToken])
  const network = await fenceNetwork(context)
  await signIn(page, emails.rep)
  await page.goto('/grain'); await expect(page.getByText(/15,200 bu/).first()).toBeVisible()
  await page.goto('/profitability'); await expect(page.getByText('Synthetic North 2027 Base').first()).toBeVisible()
  await page.goto('/tasks'); await expect(page).toHaveURL(/\/fields/)
  expect(rows(await directRest(page, 'GET', `/rest/v1/production_estimates?id=eq.${ids.estimate}&select=id`))).toHaveLength(1)
  expect(rows(await directRest(page, 'GET', `/rest/v1/crop_budgets?id=eq.${ids.budget}&select=id`))).toHaveLength(1)
  expect(rows(await directRest(page, 'GET', `/rest/v1/farm_tasks?farm_id=eq.${ids.north}&select=id`))).toEqual([])
  expectDenied(await directRest(page, 'PATCH', `/rest/v1/farms?id=eq.${ids.north}&select=id`, { share_with_rep: false }))
  expectDenied(await directRest(page, 'PATCH', `/rest/v1/production_estimates?id=eq.${ids.estimate}&select=id`, { notes: 'rep denied' }))
  expectDenied(await directRest(page, 'PATCH', `/rest/v1/crop_budgets?id=eq.${ids.budget}&select=id`, { notes: 'rep denied' }))
  expectDenied(await directRest(page, 'POST', '/rest/v1/farm_tasks?select=id', {
    id: ids.deniedTask, farm_id: ids.north, title: 'Denied rep task', details: null, status: 'todo', priority: 'normal',
    assigned_to: null, due_on: null, field_id: null, equipment_id: null, source: 'manual', interval_id: null, interval_cycle_key: null,
  }))
  const storage = await scopeStorage(page, ids.rep)
  expect(storage.fence).toMatchObject({ version: 2, generation: 3, token: ids.repInitialToken, serverEpoch: 2, revoked: false })
  expectNoPendingStorage(storage)
  expect(network.external).toEqual([]); await noOverflow(page, 'NF-3')
})

test('@north-fork-nf4 worker creates only the manifest task', async ({ context, page }) => {
  await installDeterminism(page, [ids.workerToken])
  const network = await fenceNetwork(context)
  await signIn(page, emails.worker)
  await page.goto('/grain'); await expect(page).toHaveURL(/\/fields/)
  await page.goto('/profitability'); await expect(page).toHaveURL(/\/fields/)
  expectDenied(await directRest(page, 'GET', `/rest/v1/production_estimates?id=eq.${ids.estimate}&select=id`))
  expectDenied(await directRest(page, 'GET', `/rest/v1/crop_budgets?id=eq.${ids.budget}&select=id`))
  await page.goto('/tasks')
  await setTaskIds(page, [ids.task], [ids.createOperation])
  await page.getByRole('button', { name: 'Add task' }).click()
  const form = page.locator('form.task-form')
  await form.getByLabel('Job').fill('Inspect North Home gate')
  await form.getByLabel('Details').fill('Check synthetic gate latch.')
  await form.getByLabel('Assigned to').selectOption(ids.worker)
  await form.getByLabel('Due date').fill('2027-02-10')
  await form.getByLabel('Linked field').selectOption(ids.field)
  await form.getByRole('button', { name: 'Save task' }).click()
  await expect(page.getByRole('heading', { name: 'Inspect North Home gate' })).toBeVisible()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  const storage = await scopeStorage(page, ids.worker)
  expect(storage.fence).toMatchObject({ version: 2, generation: 2, token: ids.workerToken, serverEpoch: 1, revoked: false })
  expect(await page.evaluate(() => ({ taskIds: window.__nfTaskIds, operationIds: window.__nfTaskOperationIds }))).toEqual({ taskIds: [], operationIds: [] })
  expectNoPendingStorage(storage)
  expect(network.writes.filter(item => item === 'POST /rest/v1/farm_tasks')).toEqual(['POST /rest/v1/farm_tasks'])
  expect(network.external).toEqual([]); await noOverflow(page, 'NF-4')
})

test('@north-fork-nf5 read-only member reads but direct writes fail closed', async ({ context, page }) => {
  await installDeterminism(page, [ids.readOnlyToken])
  const network = await fenceNetwork(context)
  await signIn(page, emails.readOnly)
  await page.goto('/tasks')
  await expect(page.getByRole('heading', { name: 'Inspect North Home gate' })).toBeVisible()
  await expect(page.locator('fieldset[aria-label="Read-only farm data"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add task' })).toBeDisabled()
  await page.goto('/grain'); await expect(page).toHaveURL(/\/fields/)
  expectDenied(await directRest(page, 'GET', `/rest/v1/production_estimates?id=eq.${ids.estimate}&select=id`))
  expectDenied(await directRest(page, 'GET', `/rest/v1/crop_budgets?id=eq.${ids.budget}&select=id`))
  expectDenied(await directRest(page, 'POST', '/rest/v1/farm_tasks?select=id', {
    id: ids.deniedTask, farm_id: ids.north, title: 'Denied read-only task', details: null, status: 'todo', priority: 'normal',
    assigned_to: ids.readOnly, due_on: null, field_id: ids.field, equipment_id: null, source: 'manual', interval_id: null, interval_cycle_key: null,
  }))
  expectDenied(await directRest(page, 'PATCH', `/rest/v1/farm_tasks?id=eq.${ids.task}&select=id`, { status: 'doing' }))
  expectDenied(await directRest(page, 'DELETE', `/rest/v1/farm_tasks?id=eq.${ids.task}&select=id`))
  const storage = await scopeStorage(page, ids.readOnly)
  expect(storage.fence).toMatchObject({ version: 2, generation: 2, token: ids.readOnlyToken, serverEpoch: 1, revoked: false })
  expectNoPendingStorage(storage)
  expect(network.external).toEqual([]); await noOverflow(page, 'NF-5')
})

test('@north-fork-nf6 manager completes only the manifest task', async ({ context, page }) => {
  await installDeterminism(page, [ids.managerToken])
  const network = await fenceNetwork(context)
  await signIn(page, emails.manager)
  await page.goto('/tasks')
  await setTaskIds(page, [], [ids.completeOperation])
  const task = page.locator('article.task-card').filter({ hasText: 'Inspect North Home gate' })
  await task.getByRole('button', { name: 'Done' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible()
  await expect(task.getByText('Done by north.manager · 2/9/2027', { exact: true })).toBeVisible()
  const storage = await scopeStorage(page, ids.manager)
  expect(storage.fence).toMatchObject({ version: 2, generation: 2, token: ids.managerToken, serverEpoch: 1, revoked: false })
  expect(await page.evaluate(() => ({ taskIds: window.__nfTaskIds, operationIds: window.__nfTaskOperationIds }))).toEqual({ taskIds: [], operationIds: [] })
  expectNoPendingStorage(storage)
  expect(network.writes.filter(item => item === 'PATCH /rest/v1/farm_tasks')).toEqual(['PATCH /rest/v1/farm_tasks'])
  expect(network.external).toEqual([]); await noOverflow(page, 'NF-6')
})

test('@north-fork-nf7 concurrent owner disables sharing and stale rep loses private state', async ({ browser, context, page }) => {
  await installDeterminism(page, [ids.repInitialToken, ids.repRevokedToken])
  const repNetwork = await fenceNetwork(context)
  await signIn(page, emails.rep)
  await followFarmRxLink(page, 'Grain')
  await expect(page.getByText(/15,200 bu/).first()).toBeVisible()
  await followFarmRxLink(page, 'Profitability')
  await expect(page.getByText('Synthetic North 2027 Base').first()).toBeVisible()
  const before = await scopeStorage(page, ids.rep)
  expect(before.workspaces.length).toBeGreaterThan(0)
  expect(before.fence).toMatchObject({ generation: 3, token: ids.repInitialToken, serverEpoch: 2, revoked: false })
  expect(await page.evaluate(() => window.__nfFenceTokens)).toEqual([ids.repRevokedToken])

  const owner = await newGovernedContext(browser, page.viewportSize(), [ids.ownerMapleToken, ids.ownerNorthToken])
  await signIn(owner.page, emails.owner, 'North Fork')
  await followFarmRxLink(owner.page, 'Privacy')
  const sharing = owner.page.getByRole('switch', { name: 'Share my grain position with my Crop RX rep' })
  await expect(sharing).toHaveAttribute('aria-checked', 'true')
  await sharing.click()
  await expect(sharing).toHaveAttribute('aria-checked', 'false')
  await expect(owner.page.getByText('Private', { exact: true })).toBeVisible()

  await expect(page.getByText('Synthetic North 2027 Base').first()).toBeVisible()
  expectDenied(await directRest(page, 'GET', `/rest/v1/production_estimates?id=eq.${ids.estimate}&select=id`, undefined, 2))
  expectDenied(await directRest(page, 'GET', `/rest/v1/crop_budgets?id=eq.${ids.budget}&select=id`, undefined, 2))
  expectDenied(await directRest(page, 'PATCH', `/rest/v1/production_estimates?id=eq.${ids.estimate}&select=id`, { notes: 'stale rep denied' }, 2))
  await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(page.getByText('Crop RX needs to finish your farm setup.')).toBeVisible()
  await expect(page.getByText('Synthetic North 2027 Base')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()

  const after = await scopeStorage(page, ids.rep)
  expect(JSON.parse(after.access!)).toEqual({
    version: 1,
    userId: ids.rep,
    farms: [],
    selectedFarmId: null,
    validatedAt: '2027-02-09T16:00:00.000Z',
  })
  expect(after.fence).toEqual({ version: 2, generation: 4, token: ids.repRevokedToken, serverEpoch: 2, revoked: true, changedAt: '2027-02-09T16:00:00.000Z' })
  expect(after.generation).toEqual({ version: 2, generation: 4, token: ids.repRevokedToken, serverEpoch: 2, changedAt: '2027-02-09T16:00:00.000Z' })
  expect(await page.evaluate(() => window.__nfFenceTokens)).toEqual([])
  expect(after.workspaces).toEqual([])
  expect(Object.keys(after.local).filter(key => key.startsWith(`farm-rx-access-profile:v1:${ids.project}:${ids.rep}:`))).toEqual([])
  expectNoPendingStorage(after)
  const active = await page.evaluate(project => localStorage.getItem(`farm-rx-active-context:v1:${project}`), ids.project)
  expect(active).toBeNull()
  const epochBytes = await page.evaluate(({ project, user }) => localStorage.getItem(`farm-rx-server-access-epochs:v1:${project}:${user}`), { project: ids.project, user: ids.rep })
  expect(JSON.parse(epochBytes!).epochs).toEqual({})
  expect(owner.network.external).toEqual([]); expect(repNetwork.external).toEqual([])
  await noOverflow(page, 'NF-7 rep'); await noOverflow(owner.page, 'NF-7 owner')
  await owner.context.close()
})

test('@north-fork-nf8 outsider remains denied after final privacy state', async ({ context, page }) => {
  await installDeterminism(page, [])
  const network = await fenceNetwork(context)
  await signIn(page, emails.outsider, undefined, true)
  for (const path of [
    `/rest/v1/farms?id=eq.${ids.north}&select=id`,
    `/rest/v1/fields?id=eq.${ids.field}&select=id`,
    `/rest/v1/production_estimates?id=eq.${ids.estimate}&select=id`,
    `/rest/v1/crop_budgets?id=eq.${ids.budget}&select=id`,
    `/rest/v1/farm_tasks?farm_id=eq.${ids.north}&select=id`,
  ]) expect(rows(await directRest(page, 'GET', path))).toEqual([])
  expectDenied(await directRest(page, 'POST', '/rest/v1/farm_tasks?select=id', {
    id: ids.deniedTask, farm_id: ids.north, title: 'Denied outsider final task', details: null, status: 'todo', priority: 'normal',
    assigned_to: null, due_on: null, field_id: null, equipment_id: null, source: 'manual', interval_id: null, interval_cycle_key: null,
  }, 1))
  expectDenied(await directRest(page, 'PATCH', `/rest/v1/farms?id=eq.${ids.north}&select=id`, { share_with_rep: true }, 1))
  expect(network.external).toEqual([]); await noOverflow(page, 'NF-8')
})
