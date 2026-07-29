import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const ids = {
  project: 'farmrxlocalsimplicity2027',
  worker: '27000000-0000-4000-8000-000000000003',
  control: '27000000-0000-4000-8000-000000000002',
  farm: '27010000-0000-4000-8000-000000000006',
  field: '27020000-0000-4000-8000-000000000006',
  connectedNote: '27080000-0000-4000-8000-000000000001',
  revokedNote: '27080000-0000-4000-8000-000000000002',
  connectedOperation: '27090000-0000-4000-8000-000000000001',
  revokedOperation: '27090000-0000-4000-8000-000000000002',
  initialToken: '27091000-0000-4000-8000-000000000001',
  revokedToken: '27091000-0000-4000-8000-000000000002',
}
const queueKey = `farm-rx-field-log-write-queue:v1:${ids.project}:${ids.worker}:${ids.farm}`
const fenceKey = `farm-rx-revocation-fence:v1:${ids.project}:${ids.worker}:${ids.farm}`
const generationKey = `farm-rx-revocation-generation:v1:${ids.project}:${ids.worker}:${ids.farm}`
const recoveryKey = `farm-rx-revoked-work-recovery:v1:${ids.project}:${ids.worker}`
const corruptQueueBytes = '{"version":1,"entries":[{"bad":true}]}'
const corruptRecoveryBytes = '{"version":1,"records":[{"bad":true}]}'

declare global {
  interface Window {
    __phInstant: string
    __phFieldLogIds: string[]
    __phFenceToken: string | null
  }
}

function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for Pine Hill proof.`)
  return value
}

async function installDeterminism(page: Page) {
  const instant = required('FARMRX_PH_CLIENT_INSTANT')
  const fenceToken = process.env.FARMRX_PH_FENCE_TOKEN ?? null
  await page.addInitScript(({ fixed, forcedFence, initialFence, initialGeneration, initialToken }) => {
    const RealDate = Date
    window.__phInstant = fixed
    window.__phFieldLogIds = []
    window.__phFenceToken = forcedFence
    if (forcedFence === initialToken && localStorage.getItem(initialFence) === null && localStorage.getItem(initialGeneration) === null) {
      localStorage.setItem(initialGeneration, JSON.stringify({ version: 2, generation: 1, token: initialToken, serverEpoch: 1, changedAt: '2027-08-04T18:55:00.000Z' }))
      localStorage.setItem(initialFence, JSON.stringify({ version: 2, generation: 1, token: initialToken, serverEpoch: 1, revoked: false, changedAt: '2027-08-04T18:55:00.000Z' }))
      window.__phFenceToken = null
    }
    const governed = () => {
      const stack = new Error().stack ?? ''
      const application = stack.indexOf('/src/')
      const dependencyPositions = [stack.indexOf('/node_modules/'), stack.indexOf('/@fs/'), stack.indexOf('/.vite/deps/')].filter(index => index >= 0)
      const dependency = dependencyPositions.length ? Math.min(...dependencyPositions) : -1
      return application >= 0 && (dependency < 0 || application < dependency)
        && /(?:farmContext|farmRevocationFence|QueuedFieldLogRepository|fieldLogWriteQueue|fieldLog|createSupabaseFieldLogServices|FieldLogModule|workspaceCache|deviceClockFence)\.(?:ts|tsx)/.test(stack)
    }
    window.Date = new Proxy(RealDate, {
      construct(target, args) { return Reflect.construct(target, args.length === 0 && governed() ? [Date.parse(window.__phInstant)] : args) as Date },
      apply(target, receiver, args) { return Reflect.apply(target, receiver, args) },
      get(target, property, receiver) {
        if (property === 'now') return () => governed() ? Date.parse(window.__phInstant) : RealDate.now()
        return Reflect.get(target, property, receiver)
      },
    }) as DateConstructor
    const original = crypto.randomUUID.bind(crypto)
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => {
      const stack = new Error().stack ?? ''
      if (stack.includes('/src/data/farmRevocationFence.ts') && window.__phFenceToken) {
        const value = window.__phFenceToken; window.__phFenceToken = null; return value
      }
      if (stack.includes('/src/data/QueuedFieldLogRepository.ts') && window.__phFieldLogIds.length) return window.__phFieldLogIds.shift()!
      return original()
    } })
  }, { fixed: instant, forcedFence: fenceToken, initialFence: fenceKey, initialGeneration: generationKey, initialToken: ids.initialToken })
}

async function fenceNetwork(page: Page) {
  const external: string[] = []
  const restWrites: string[] = []
  const restResults: string[] = []
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.port === '55321' && url.pathname.startsWith('/rest/v1/') && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
      restWrites.push(`${request.method()} ${url.pathname}`)
    }
  })
  page.on('response', response => {
    const url = new URL(response.url())
    if (url.port === '55321' && url.pathname === '/rest/v1/rpc/save_field_log_entry') restResults.push(`${response.status()} ${url.pathname}`)
  })
  page.on('requestfailed', request => {
    const url = new URL(request.url())
    if (url.port === '55321' && url.pathname === '/rest/v1/rpc/save_field_log_entry') restResults.push(`FAILED ${request.failure()?.errorText ?? 'unknown'} ${url.pathname}`)
  })
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname !== '127.0.0.1' || !['4181', '55321'].includes(url.port)) {
      external.push(`${route.request().method()} ${url.href}`)
      await route.abort('blockedbyclient')
      return
    }
    await route.continue()
  })
  return { external, restWrites, restResults }
}

async function saveState(context: BrowserContext) {
  await context.storageState({ path: required('FARMRX_PH_STATE_OUT'), indexedDB: true })
}

async function signIn(page: Page, email: string) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password').fill(required('FARMRX_SEASON_OWNER_PASSWORD'))
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/fields/)
}

async function noOverflow(page: Page, label: string) {
  const size = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, body: document.body.scrollWidth, viewport: window.innerWidth }))
  expect(size.document, `${label} document overflow`).toBeLessThanOrEqual(size.viewport)
  expect(size.body, `${label} body overflow`).toBeLessThanOrEqual(size.viewport)
}

async function setFieldLogIds(page: Page, operation: string, note: string) {
  await page.evaluate(values => { window.__phFieldLogIds = values }, [operation, note])
}

async function addNote(page: Page, operation: string, noteId: string, note: string) {
  await setFieldLogIds(page, operation, noteId)
  const card = page.locator('article.field-log-card').filter({ hasText: 'Pine North 60' })
  await card.getByRole('button', { name: 'Add note' }).click()
  const form = card.locator('form.field-log-form')
  await form.getByLabel('Date').fill('2027-08-04')
  await form.getByLabel('Note').fill(note)
  await form.getByRole('button', { name: 'Save entry' }).click()
  await expect(card.getByText('Pending sync')).toBeVisible()
  await expect(page.getByText(/Saved on this device — waiting for signal/)).toBeVisible()
}

function exactQueue(operation: string, noteId: string, note: string, enqueuedAt: string) {
  return {
    version: 1,
    entries: [{
      version: 2, module: 'fieldLog', kind: 'saveEntry', operationId: operation,
      userId: ids.worker, farmId: ids.farm, enqueuedAt,
      operationContext: { projectRef: ids.project, userId: ids.worker, farmId: ids.farm, generation: 1, token: ids.initialToken, serverEpoch: 1 },
      draft: { field_id: ids.field, entry_type: 'note', observed_on: '2027-08-04', rainfall_in: null, note, id: noteId },
    }],
  }
}

test('@pine-hill-init primes exact Pine custody and offline cache', async ({ page, context }) => {
  await installDeterminism(page); const network = await fenceNetwork(page); await signIn(page, 'pine.worker@farmrx.local.test')
  await page.goto('/field-log'); await expect(page.getByRole('heading', { name: 'Pine North 60' })).toBeVisible()
  const state = await page.evaluate(({ fence, generation }) => ({ fence: JSON.parse(localStorage.getItem(fence) ?? 'null'), generation: JSON.parse(localStorage.getItem(generation) ?? 'null') }), { fence: fenceKey, generation: generationKey })
  expect(state).toEqual({
    fence: { version: 2, generation: 1, token: ids.initialToken, serverEpoch: 1, revoked: false, changedAt: '2027-08-04T18:55:00.000Z' },
    generation: { version: 2, generation: 1, token: ids.initialToken, serverEpoch: 1, changedAt: '2027-08-04T18:55:00.000Z' },
  })
  expect(network.external).toEqual([]); await noOverflow(page, 'Pine init'); await saveState(context)
})

test('@pine-hill-ph1 queues the connected note with exact operation-era custody', async ({ page, context }) => {
  await installDeterminism(page); const network = await fenceNetwork(page); await page.goto('/field-log'); await expect(page.getByRole('heading', { name: 'Pine North 60' })).toBeVisible()
  await context.setOffline(true); await addNote(page, ids.connectedOperation, ids.connectedNote, 'Synthetic north fence washed out')
  const bytes = await page.evaluate(key => localStorage.getItem(key), queueKey)
  expect(JSON.parse(bytes!)).toEqual(exactQueue(ids.connectedOperation, ids.connectedNote, 'Synthetic north fence washed out', '2027-08-04T19:00:00.000Z'))
  expect(network.restWrites.filter(item => item.includes('save_field_log_entry'))).toEqual([])
  expect(network.external).toEqual([]); await noOverflow(page, 'PH-1'); await saveState(context)
})

test('@pine-hill-ph2 reconnects once and two more retries are no-ops', async ({ page, context }) => {
  await installDeterminism(page); const network = await fenceNetwork(page); await page.goto('/field-log')
  await expect(page.getByText('Synthetic north fence washed out')).toBeVisible()
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{"entries":[]}').entries.length, queueKey)).toBe(0)
  await page.evaluate(() => { window.dispatchEvent(new Event('online')); window.dispatchEvent(new Event('online')) })
  await page.waitForTimeout(750)
  expect(network.restWrites.filter(item => item.endsWith('/save_field_log_entry'))).toEqual(['POST /rest/v1/rpc/save_field_log_entry'])
  expect(network.restResults).toEqual(['200 /rest/v1/rpc/save_field_log_entry'])
  expect(network.external).toEqual([]); await noOverflow(page, 'PH-2 confirm'); await saveState(context)
})

test('@pine-hill-ph3 queues revoked work without a server write', async ({ page, context }) => {
  await installDeterminism(page); const network = await fenceNetwork(page); await page.goto('/field-log'); await expect(page.getByText('Synthetic north fence washed out')).toBeVisible()
  await context.setOffline(true); await addNote(page, ids.revokedOperation, ids.revokedNote, 'Synthetic revoked-user note')
  const bytes = await page.evaluate(key => localStorage.getItem(key), queueKey)
  expect(JSON.parse(bytes!)).toEqual(exactQueue(ids.revokedOperation, ids.revokedNote, 'Synthetic revoked-user note', '2027-08-04T19:30:00.000Z'))
  expect(network.restWrites.filter(item => item.includes('save_field_log_entry'))).toEqual([])
  expect(network.external).toEqual([]); await noOverflow(page, 'PH-3'); await saveState(context)
})

test('@pine-hill-ph5 quarantines exact revoked work and exports it', async ({ page, context }) => {
  await installDeterminism(page); const network = await fenceNetwork(page); await page.goto('/fields')
  await expect(page.getByRole('heading', { name: 'Saved work needs your review' })).toBeVisible()
  await expect(page.getByText(/will never send them automatically/)).toBeVisible()
  const storage = await page.evaluate(({ queue, fence, generation, recovery }) => ({
    queue: localStorage.getItem(queue),
    fence: JSON.parse(localStorage.getItem(fence) ?? 'null'),
    generation: JSON.parse(localStorage.getItem(generation) ?? 'null'),
    recovery: JSON.parse(localStorage.getItem(recovery) ?? 'null'),
  }), { queue: queueKey, fence: fenceKey, generation: generationKey, recovery: recoveryKey })
  expect(storage.queue).toBeNull()
  expect(storage.fence).toEqual({ version: 2, generation: 3, token: ids.revokedToken, serverEpoch: 2, revoked: true, changedAt: '2027-08-04T19:45:00.000Z' })
  expect(storage.generation).toEqual({ version: 2, generation: 3, token: ids.revokedToken, serverEpoch: 2, changedAt: '2027-08-04T19:45:00.000Z' })
  expect(storage.recovery.version).toBe(1); expect(storage.recovery.records).toHaveLength(1)
  expect(storage.recovery.records[0]).toMatchObject({ projectRef: ids.project, userId: ids.worker, farmId: ids.farm, originalKey: queueKey, kind: 'queue', reason: 'farm_access_removed' })
  expect(storage.recovery.records[0].payload).toEqual(exactQueue(ids.revokedOperation, ids.revokedNote, 'Synthetic revoked-user note', '2027-08-04T19:30:00.000Z'))
  const pineCacheCount = await page.evaluate(async ({ project, farm, worker }) => {
    const request = indexedDB.open(`farm-rx-offline-v1-${project}`)
    const database = await new Promise<IDBDatabase>((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try {
      const transaction = database.transaction('workspaces', 'readonly')
      const values = await new Promise<unknown[]>((resolve, reject) => { const get = transaction.objectStore('workspaces').getAll(); get.onsuccess = () => resolve(get.result); get.onerror = () => reject(get.error) })
      return values.filter(value => { const row = value as { farmId?: string; userId?: string }; return row.farmId === farm && row.userId === worker }).length
    } finally { database.close() }
  }, { project: ids.project, farm: ids.farm, worker: ids.worker })
  expect(pineCacheCount).toBe(0)
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export copy' }).click()
  const exported = await download; expect(exported.suggestedFilename()).toMatch(/^farm-rx-recovery-/)
  expect(network.restWrites.filter(item => item.includes('save_field_log_entry'))).toEqual([])
  expect(network.external).toEqual([]); await noOverflow(page, 'PH-5'); await saveState(context)
})

test('@pine-hill-ph6 account switch never exposes or replays revoked Pine work', async ({ page, context }) => {
  await installDeterminism(page); const network = await fenceNetwork(page); await page.goto('/fields')
  await expect(page.getByRole('heading', { name: 'Saved work needs your review' })).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click(); await expect(page).toHaveURL(/\/login/)
  await signIn(page, 'pine.control@farmrx.local.test'); await expect(page.getByRole('heading', { name: 'Fields' })).toBeVisible()
  await expect(page.getByText('Pine North 60')).toHaveCount(0)
  const state = await page.evaluate(({ queue, recovery }) => ({ queue: localStorage.getItem(queue), recovery: localStorage.getItem(recovery) }), { queue: queueKey, recovery: recoveryKey })
  expect(state.queue).toBeNull(); expect(state.recovery).not.toBeNull()
  expect(network.restWrites.filter(item => item.includes('save_field_log_entry'))).toEqual([])
  expect(network.external).toEqual([]); await noOverflow(page, 'PH-6'); await saveState(context)
})

test('@pine-hill-corrupt-active preserves unreadable revoked queue bytes without publishing recovery', async ({ page, context }) => {
  await installDeterminism(page); const network = await fenceNetwork(page)
  // This must run before FarmAccessGate opens the saved PH-3 state. The corrupt
  // bytes are an isolated negative fixture, never a replacement for canonical PH.
  await page.addInitScript(({ key, bytes }) => localStorage.setItem(key, bytes), { key: queueKey, bytes: corruptQueueBytes })
  await page.goto('/fields')
  await expect(page.getByText('Farm Rx found unreadable or mismatched saved work for a farm you can no longer open. Nothing was cleared.')).toBeVisible()
  const storage = await page.evaluate(({ queue, recovery }) => ({ queue: localStorage.getItem(queue), recovery: localStorage.getItem(recovery) }), { queue: queueKey, recovery: recoveryKey })
  expect(storage.queue).toBe(corruptQueueBytes); expect(storage.recovery).toBeNull()
  expect(network.restWrites.filter(item => item.includes('save_field_log_entry'))).toEqual([])
  expect(network.external).toEqual([]); await noOverflow(page, 'Pine corrupt active queue'); await saveState(context)
})

test('@pine-hill-corrupt-vault fails visibly without changing unreadable recovery bytes', async ({ page, context }) => {
  await installDeterminism(page); const network = await fenceNetwork(page); await signIn(page, 'pine.worker@farmrx.local.test')
  const validQueue = exactQueue(ids.revokedOperation, ids.revokedNote, 'Synthetic revoked-user note', '2027-08-04T19:30:00.000Z')
  await page.evaluate(({ queue, recovery, recoveryBytes, valid }) => { localStorage.setItem(queue, valid); localStorage.setItem(recovery, recoveryBytes) }, { queue: queueKey, recovery: recoveryKey, recoveryBytes: corruptRecoveryBytes, valid: JSON.stringify(validQueue) })
  // Keep the browser reachable for reload while the next app document sees the
  // existing valid queue as offline custody; no replay request may be sent.
  await page.addInitScript(() => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false }))
  await page.reload()
  const alert = page.getByRole('alert')
  await expect(alert.getByRole('heading', { name: 'Saved work needs attention' })).toBeVisible()
  await expect(alert.getByText('Farm Rx could not safely read the saved recovery work on this device.')).toBeVisible()
  await expect(alert.getByRole('button', { name: 'Dismiss' })).toHaveCount(0)
  await expect(alert.getByRole('button', { name: 'Export copy' })).toHaveCount(0)
  const storage = await page.evaluate(({ queue, recovery }) => ({ queue: localStorage.getItem(queue), recovery: localStorage.getItem(recovery) }), { queue: queueKey, recovery: recoveryKey })
  expect(storage.queue).toBe(JSON.stringify(validQueue)); expect(storage.recovery).toBe(corruptRecoveryBytes)
  expect(network.restWrites.filter(item => item.includes('save_field_log_entry'))).toEqual([])
  expect(network.external).toEqual([]); await noOverflow(page, 'Pine corrupt recovery vault'); await saveState(context)
})
