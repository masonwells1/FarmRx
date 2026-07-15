import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'
import { readFileSync } from 'node:fs'

const projectRef = 'agvsozfbstpekuqxpqjr'
const userId = '00000000-0000-4000-8000-000000000001'
const farmA = '00000000-0000-4000-8000-000000000010'
const farmB = '00000000-0000-4000-8000-000000000020'
const entityA = '00000000-0000-4000-8000-000000000011'
const entityB = '00000000-0000-4000-8000-000000000021'
const fieldA = '00000000-0000-4000-8000-000000000012'
const fieldB = '00000000-0000-4000-8000-000000000022'
const arrangementA = '00000000-0000-4000-8000-000000000013'
const arrangementB = '00000000-0000-4000-8000-000000000023'
const commodityId = '00000000-0000-4000-8000-000000000030'
const notificationA = '00000000-0000-4000-8000-000000000041'
const notificationB = '00000000-0000-4000-8000-000000000042'
const now = '2026-07-15T12:00:00.000Z'

type FarmFixture = { id: string; name: string; entityId: string; fieldId: string; fieldName: string; arrangementId: string }
const farms: FarmFixture[] = [
  { id: farmA, name: 'Prairie View', entityId: entityA, fieldId: fieldA, fieldName: 'North Forty', arrangementId: arrangementA },
  { id: farmB, name: 'River Bend', entityId: entityB, fieldId: fieldB, fieldName: 'South Bottom', arrangementId: arrangementB },
]

function session() {
  const expiresAt = Math.floor(Date.now() / 1000) + 86_400
  const payload = btoa(JSON.stringify({ sub: userId, aud: 'authenticated', exp: expiresAt })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  return {
    access_token: `eyJhbGciOiJub25lIn0.${payload}.signature`, refresh_token: 'offline-test-refresh', expires_in: 86_400, expires_at: expiresAt, token_type: 'bearer',
    user: { id: userId, aud: 'authenticated', role: 'authenticated', email: 'farmer@example.test', app_metadata: {}, user_metadata: {}, identities: [], created_at: now },
  }
}

async function seedSession(context: BrowserContext) {
  await context.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: `farm-rx-auth:${projectRef}`, value: session() })
}

function farmRow(farm: FarmFixture) { return { id: farm.id, name: farm.name, share_with_rep: false, created_by: userId, created_at: now, updated_at: now } }
function rowsFor(table: string, farm: FarmFixture) {
  if (table === 'entities') return [{ id: farm.entityId, farm_id: farm.id, name: `${farm.name} LLC`, entity_type: 'llc', is_active: true, created_at: now, updated_at: now }]
  if (table === 'fields') return [{ id: farm.fieldId, farm_id: farm.id, operating_entity_id: farm.entityId, name: farm.fieldName, legal_description: null, county: 'McLean', state: 'IL', total_acres: 80, fsa_farm_number: null, fsa_tract_number: null, soil_productivity_index: 134, latitude: null, longitude: null, location_source: null, is_active: true, created_at: now, updated_at: now }]
  if (table === 'arrangements') return [{ id: farm.arrangementId, farm_id: farm.id, field_id: farm.fieldId, arrangement_type: 'owned', landlord_name: null, landlord_phone: null, landlord_contact_notes: null, effective_from: '2026-01-01', effective_to: null, cash_rent_per_acre: null, flex_bonus_formula: null, landlord_crop_pct: null, landlord_seed_pct: 0, landlord_fertilizer_pct: 0, landlord_chemical_pct: 0, landlord_fuel_pct: 0, landlord_labor_custom_pct: 0, landlord_crop_insurance_pct: 0, landlord_equipment_pct: 0, landlord_interest_pct: 0, landlord_other_input_pct: 0, notes: null, created_at: now, updated_at: now }]
  if (table === 'crop_assignments') return [{ id: `${farm.fieldId.slice(0, -2)}31`, farm_id: farm.id, field_id: farm.fieldId, crop_year: 2026, commodity_id: commodityId, planting_sequence: 1, planted_acres: 80, variety: null, planting_date: '2026-04-20', harvest_date: null, harvested_bushels: null, expected_yield_per_acre: 190, expected_price_per_bu: 4.5, actual_price_per_bu: null, notes: null, created_at: now, updated_at: now }]
  if (table === 'commodities') return [{ id: commodityId, name: 'Corn', crop_family: 'corn', traits: {}, is_active: true, created_at: now, updated_at: now }]
  return []
}

function requestedFarm(url: URL) {
  const raw = url.searchParams.get('farm_id') ?? url.searchParams.get('id')
  const id = raw?.startsWith('eq.') ? raw.slice(3) : farmA
  return farms.find((farm) => farm.id === id) ?? farms[0]
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
}

async function mockSupabase(page: Page, accessible = farms, notifications: unknown[] = [], emptyUnknownReads = false) {
  const unexpected: string[] = []
  await page.route('https://*.supabase.co/**', async (route) => {
    const url = new URL(route.request().url())
    const rest = url.pathname.match(/^\/rest\/v1\/([^/]+)$/)?.[1]
    if (rest === 'farms') {
      if (url.searchParams.has('id')) await fulfillJson(route, farmRow(requestedFarm(url)))
      else await fulfillJson(route, accessible.map(farmRow))
      return
    }
    if (rest && ['entities', 'fields', 'arrangements', 'crop_assignments', 'commodities'].includes(rest)) { await fulfillJson(route, rowsFor(rest, requestedFarm(url))); return }
    if (rest === 'notifications') { await fulfillJson(route, notifications); return }
    if (url.pathname === '/rest/v1/rpc/can_read_private_financials') { await fulfillJson(route, true); return }
    if (url.pathname === '/rest/v1/rpc/operational_integrity_capability_probe') { await fulfillJson(route, true); return }
    if (url.pathname === '/rest/v1/rpc/generate_due_program_items') { await fulfillJson(route, { generated_count: 0 }); return }
    if (url.pathname === '/auth/v1/user') { await fulfillJson(route, session().user); return }
    if (url.pathname === '/auth/v1/logout') { await fulfillJson(route, {}); return }
    if (emptyUnknownReads && rest === 'production_estimates') { await fulfillJson(route, [{ id: '00000000-0000-4000-8000-000000000051', farm_id: farmA, crop_year: 2026, commodity_id: commodityId, operating_entity_id: null, enterprise_label: null, planted_acres: 80, aph_yield: 190, expected_bushels: 15_200, actual_bushels: null, drives_math: 'projected', notes: null, created_at: now, updated_at: now }]); return }
    if (emptyUnknownReads && route.request().method() === 'GET' && rest) { await fulfillJson(route, rest === 'grain_alert_settings' ? null : []); return }
    unexpected.push(`${route.request().method()} ${url.pathname}`)
    await route.abort('blockedbyclient')
  })
  return unexpected
}

test.beforeEach(async ({ page }) => {
  await page.route('https://*.supabase.co/**', async (route) => route.abort('blockedbyclient'))
})

test('built login route is usable and does not require a live data request', async ({ page }) => {
  const liveRequests: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('.supabase.co/')) liveRequests.push(request.url())
  })
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Farm Rx' })).toBeVisible()
  await expect(page.getByLabel('Email address')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
  expect(liveRequests).toEqual([])
})

test('PWA shell reopens offline after the service worker controls it', async ({ page, context }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Farm Rx' })).toBeVisible()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
  })
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Farm Rx' })).toBeVisible()
})

test('login has no horizontal overflow on a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/login')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(1)
})

test('multi-farm access requires an explicit choice and keeps both farms usable', async ({ page, context }) => {
  await seedSession(context)
  const unexpected = await mockSupabase(page)
  await page.goto('/fields')
  await expect(page.getByRole('heading', { name: 'Choose a farm' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Prairie View' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'River Bend' })).toBeVisible()
  await page.getByRole('button', { name: 'Prairie View' }).click()
  await expect(page.getByText('North Forty')).toBeVisible()
  await expect(page.getByLabel('Active farm')).toHaveValue(farmA)
  await page.getByLabel('Active farm').selectOption(farmB)
  await expect(page.getByText('South Bottom')).toBeVisible()
  await expect(page.getByLabel('Active farm')).toHaveValue(farmB)
  const cacheKeys = await page.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try { return await new Promise<IDBValidKey[]>((resolve, reject) => { const request = database.transaction('workspaces').objectStore('workspaces').getAllKeys(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) } finally { database.close() }
  }, `farm-rx-offline-v1-${projectRef}`)
  expect(cacheKeys.some((key) => String(key).includes(`:${userId}:${farmA}:fields`))).toBeTruthy()
  expect(cacheKeys.some((key) => String(key).includes(`:${userId}:${farmB}:fields`))).toBeTruthy()
  expect(unexpected).toEqual([])
})

test('a previously loaded farm reopens from its isolated cache while offline', async ({ page, context }) => {
  await seedSession(context)
  const unexpected = await mockSupabase(page, [farms[0]])
  await page.goto('/fields')
  await expect(page.getByText('North Forty')).toBeVisible()
  await expect.poll(() => page.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try { return await new Promise<number>((resolve, reject) => { const transaction = database.transaction('workspaces'); const request = transaction.objectStore('workspaces').count(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) } finally { database.close() }
  }, `farm-rx-offline-v1-${projectRef}`)).toBeGreaterThan(0)
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
  })
  await page.unroute('https://*.supabase.co/**')
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText('North Forty')).toBeVisible()
  await expect(page.getByText('Offline access')).toBeVisible()
  await expect(page.getByText(/Showing an offline copy/)).toBeVisible()
  await page.getByRole('link', { name: 'Full field details' }).click()
  await expect(page.getByRole('heading', { name: 'Add a field' })).toBeVisible()
  await page.getByLabel('Total acres').fill('42.5')
  await page.getByLabel('Field name').fill('Offline Added')
  await expect(page.getByLabel('Field name')).toHaveValue('Offline Added')
  await page.getByRole('button', { name: 'Save field' }).click()
  await expect(page.getByRole('heading', { name: 'Offline Added' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Offline Added' })).toBeVisible()
  const queued = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { entries?: Array<{ userId?: string; farmId?: string; draft?: { name?: string } }> }, `farm-rx-write-queue:v1:${projectRef}:${userId}:${farmA}`)
  expect(queued?.entries).toHaveLength(1)
  expect(queued?.entries?.[0]).toMatchObject({ userId, farmId: farmA, draft: { name: 'Offline Added' } })
  const keys = await page.evaluate(async (name) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try { return await new Promise<IDBValidKey[]>((resolve, reject) => { const request = database.transaction('workspaces').objectStore('workspaces').getAllKeys(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) } finally { database.close() }
  }, `farm-rx-offline-v1-${projectRef}`)
  expect(keys.every((key) => String(key).includes(`:${userId}:${farmA}:`))).toBeTruthy()
  expect(unexpected).toEqual([])
})

test('sign out removes farm access and readable IndexedDB workspaces', async ({ page, context }) => {
  await seedSession(context)
  const unexpected = await mockSupabase(page, [farms[0]])
  await page.goto('/fields')
  await expect(page.getByText('North Forty')).toBeVisible()
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page.getByRole('heading', { name: 'Farm Rx' })).toBeVisible()
  const remaining = await page.evaluate(async ({ databaseName, accessKey }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(databaseName); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try { const count = await new Promise<number>((resolve, reject) => { const request = database.transaction('workspaces').objectStore('workspaces').count(); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }); return { count, access: localStorage.getItem(accessKey) } } finally { database.close() }
  }, { databaseName: `farm-rx-offline-v1-${projectRef}`, accessKey: `farm-rx-access:v1:${projectRef}:${userId}` })
  expect(remaining).toEqual({ count: 0, access: null })
  expect(unexpected).toEqual([])
})

test('an expired offline workspace fails closed with a useful connection message', async ({ page, context }) => {
  await seedSession(context)
  await mockSupabase(page, [farms[0]])
  await page.goto('/fields')
  await expect(page.getByText('North Forty')).toBeVisible()
  await page.evaluate(async ({ databaseName, key, cachedAt }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(databaseName); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try {
      const transaction = database.transaction('workspaces', 'readwrite')
      const store = transaction.objectStore('workspaces')
      const value = await new Promise<Record<string, unknown>>((resolve, reject) => { const request = store.get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
      store.put({ ...value, cachedAt })
      await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error) })
    } finally { database.close() }
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
  }, { databaseName: `farm-rx-offline-v1-${projectRef}`, key: `${projectRef}:${userId}:${farmA}:fields`, cachedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1_000).toISOString() })
  await page.unroute('https://*.supabase.co/**')
  await context.setOffline(true)
  await page.reload()
  await expect(page.getByText('This offline copy is too old to show safely. Connect to update it.')).toBeVisible()
})

test('two tabs append notification work without losing either operation', async ({ page, context }) => {
  await seedSession(context)
  const notifications = [
    { id: notificationA, farm_id: farmA, user_id: userId, category: 'general', title: 'First tab alert', body: null, link: '/notifications', dedupe_key: null, read_at: null, created_by: userId, created_at: now },
    { id: notificationB, farm_id: farmA, user_id: userId, category: 'general', title: 'Second tab alert', body: null, link: '/notifications', dedupe_key: null, read_at: null, created_by: userId, created_at: now },
  ]
  const other = await context.newPage()
  await mockSupabase(page, [farms[0]], notifications)
  await mockSupabase(other, [farms[0]], notifications)
  await Promise.all([page.goto('/notifications'), other.goto('/notifications')])
  await Promise.all([expect(page.getByText('First tab alert')).toBeVisible(), expect(other.getByText('Second tab alert')).toBeVisible()])
  await context.setOffline(true)
  await Promise.all([
    page.locator('.notification-row').filter({ hasText: 'First tab alert' }).getByRole('button', { name: 'Mark read' }).click(),
    other.locator('.notification-row').filter({ hasText: 'Second tab alert' }).getByRole('button', { name: 'Mark read' }).click(),
  ])
  const queueKey = `farm-rx-notifications-write-queue:v1:${projectRef}:${userId}:${farmA}`
  await expect.poll(() => page.evaluate((key) => (JSON.parse(localStorage.getItem(key) ?? '{}') as { entries?: unknown[] }).entries?.length ?? 0, queueKey)).toBe(2)
  const envelope = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { entries?: Array<{ operationId: string; ids: string[] }> }, queueKey)
  expect(envelope.entries).toHaveLength(2)
  expect(new Set(envelope.entries?.map((entry) => entry.operationId)).size).toBe(2)
  expect(new Set(envelope.entries?.flatMap((entry) => entry.ids))).toEqual(new Set([notificationA, notificationB]))
  await other.close()
})

test('TradingView runs only inside an opaque sandbox and cannot reach Farm Rx storage', async ({ page, context }) => {
  await seedSession(context)
  const unexpected = await mockSupabase(page, [farms[0]], [], true)
  await page.route('https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/javascript', body: `document.documentElement.dataset.widgetScript='executed';try{parent.__farmRxWidgetEscaped=true}catch(e){}try{parent.localStorage.setItem('farm-rx-widget-escape','bad')}catch(e){}` })
  })
  await page.goto('/grain')
  const marketHeading = page.getByRole('heading', { name: 'Delayed market quotes' })
  await expect(marketHeading).toBeVisible()
  await marketHeading.scrollIntoViewIfNeeded()
  const widgets = page.locator('iframe.market-quote__widget')
  await expect(widgets).toHaveCount(6)
  for (let index = 0; index < 6; index += 1) {
    await expect(widgets.nth(index)).toHaveAttribute('sandbox', 'allow-scripts')
    await expect(widgets.nth(index)).toHaveAttribute('referrerpolicy', 'no-referrer')
  }
  await expect.poll(() => page.frameLocator('iframe.market-quote__widget').first().locator('html').getAttribute('data-widget-script')).toBe('executed')
  expect(await page.evaluate(() => ({ marker: (window as Window & { __farmRxWidgetEscaped?: boolean }).__farmRxWidgetEscaped, storage: localStorage.getItem('farm-rx-widget-escape') }))).toEqual({ marker: undefined, storage: null })
  expect(unexpected).toEqual([])
})

test('security headers keep first-party code and embedded market data narrowly scoped', async () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as { headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }> }
  const appRule = config.headers.find((rule) => rule.source.includes('?!market-quote-frame'))!
  const frameRule = config.headers.find((rule) => rule.source === '/market-quote-frame.html')!
  const headers = Object.fromEntries(appRule.headers.map(({ key, value }) => [key, value]))
  const frameHeaders = Object.fromEntries(frameRule.headers.map(({ key, value }) => [key, value]))
  const csp = headers['Content-Security-Policy']
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("object-src 'none'")
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).toContain('https://agvsozfbstpekuqxpqjr.supabase.co')
  expect(csp.match(/script-src[^;]*/)?.[0]).toBe("script-src 'self'")
  expect(frameHeaders['Content-Security-Policy']).toContain('https://s3.tradingview.com')
  expect(frameHeaders['Content-Security-Policy']).toContain("frame-ancestors 'self'")
  expect(csp).not.toContain("script-src *")
  expect(headers['Referrer-Policy']).toBe('no-referrer')
  expect(headers['X-Content-Type-Options']).toBe('nosniff')
  expect(headers['X-Frame-Options']).toBe('DENY')
})

test('mobile navigation keeps five non-overlapping targets and exposes every destination', async ({ page, context }) => {
  await seedSession(context)
  const unexpected = await mockSupabase(page, [farms[0]], [], true)
  for (const width of [320, 375, 390, 430]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/fields')
    await expect(page.getByText('North Forty')).toBeVisible()
    const nav = page.getByRole('navigation', { name: 'Farm Rx navigation' })
    const targets = nav.locator('.nav-link')
    await expect(targets).toHaveCount(5)
    await expect(nav.getByText('Fields', { exact: true })).toBeVisible()
    await expect(nav.getByText('Grain', { exact: true })).toBeVisible()
    await expect(nav.getByText('Tasks', { exact: true })).toBeVisible()
    await expect(nav.getByText('Weather', { exact: true })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'More' })).toBeVisible()
    const boxes = await targets.evaluateAll((items) => items.map((item) => { const box = item.getBoundingClientRect(); return { left: box.left, right: box.right, width: box.width, height: box.height } }))
    expect(boxes.every((box) => box.width >= 48 && box.height >= 48)).toBeTruthy()
    expect(boxes.every((box, index) => index === 0 || box.left >= boxes[index - 1].right - 1)).toBeTruthy()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    await nav.getByRole('button', { name: 'More' }).click()
    const more = page.getByRole('region', { name: 'More Farm Rx destinations' })
    for (const label of ['Inventory', 'Profitability', 'Equipment', 'Field Log', 'Scouting', 'Harvest', 'Programs', 'Alerts']) await expect(more.getByRole('link', { name: label })).toBeVisible()
    await more.getByRole('button', { name: 'Close more navigation' }).click()
    await expect(more).toBeHidden()
  }
  expect(unexpected).toEqual([])
})
