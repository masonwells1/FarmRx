import { expect, test, type Page, type Request } from '@playwright/test'
import { createSeasonRequestClassifier } from './season-request-classifier'
import { seasonLoopbackPort } from './season-loopback-port'

const owner = 'maple.owner@farmrx.local.test'
const ids = { task: '27061000-0000-4000-8000-000000000001', crop: '27030000-0000-4000-8000-000000000001', estimate: '27070000-0000-4000-8000-000000000001', bin: '27073000-0000-4000-8000-000000000001', inbound: '27074000-0000-4000-8000-000000000000', contract: '27071000-0000-4000-8000-000000000001', outbound: '27074000-0000-4000-8000-000000000001', delivery: '27072000-0000-4000-8000-000000000001' }
type Captured = { url: string; method: string; body: string; headers: Record<string, string>; response?: { status: number; body: string } }
declare global { interface Window { __mapleSetId(value: string): void } }

function instant() {
  const value = process.env.FARMRX_MAPLE_CLIENT_INSTANT
  if (!value || !/^2027-(?:08|09|10|11|12)-/.test(value) || Number.isNaN(Date.parse(value))) throw new Error('FARMRX_MAPLE_CLIENT_INSTANT must be a governed Maple August-December instant.')
  return value
}
async function fence(page: Page, requests: ReturnType<typeof createSeasonRequestClassifier>) {
  const external: string[] = []; const writes: Captured[] = []; const captured = new Map<Request, Captured>()
  page.on('request', request => {
    const url = new URL(request.url())
    if (url.origin !== 'http://127.0.0.1:55321' || request.method() === 'GET') return
    const headers = request.headers(); const write = { url: request.url(), method: request.method(), body: request.postData() ?? '', headers: Object.fromEntries(['apikey', 'authorization', 'accept', 'accept-profile', 'content-profile', 'content-type', 'prefer', 'x-client-info', 'x-farm-rx-expected-user-id', 'x-farm-rx-access-epochs'].flatMap(name => headers[name] ? [[name, headers[name]]] : [])) }
    writes.push(write); captured.set(request, write)
  })
  page.on('response', response => { const write = captured.get(response.request()); if (write) void response.text().then(body => { write.response = { status: response.status(), body } }) })
  page.on('response', response => { if (response.url().startsWith('http://127.0.0.1:55321/') && response.status() >= 400) console.log(`LOCAL_RESPONSE ${response.request().method()} ${new URL(response.url()).pathname} ${response.status()}`) })
  page.on('requestfailed', request => { if (request.url().startsWith('http://127.0.0.1:55321/')) console.log(`LOCAL_REQUEST_FAILED ${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText ?? 'unknown'}`) })
  page.on('console', message => { if (message.type() === 'error') console.log(`BROWSER_CONSOLE_ERROR ${message.text()}`) })
  page.on('pageerror', error => console.log(`BROWSER_PAGE_ERROR ${error.message}`))
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()); const port = String(seasonLoopbackPort('FARMRX_SEASON_AUGUST_DECEMBER_PORT', 4280))
    if (url.hostname === 's3.tradingview.com' && url.pathname === '/external-embedding/embed-widget-mini-symbol-overview.js') { await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }); return }
    if (url.hostname !== '127.0.0.1' || ![port, '55321'].includes(url.port)) { external.push(`${route.request().method()} ${url.href}`); await route.abort('blockedbyclient'); return }
    if (url.port === '55321' && requests.observe(route.request().method(), url.href).block) { await route.abort('blockedbyclient'); return }
    await route.continue()
  })
  await page.addInitScript(fixedIso => {
    const RealDate = Date; const fixed = Date.parse(fixedIso); let next: string | null = null; const original = crypto.randomUUID.bind(crypto)
    window.Date = new Proxy(RealDate, {
      construct(target, args) {
        const stack = new Error().stack ?? ''
        const businessClock = args.length === 0 && [
          '/src/data/farmDates.ts',
          '/src/data/index.ts',
          '/src/EquipmentTasksModule.tsx',
          '/src/data/createSupabaseEquipmentTasksServices.ts',
          '/src/HarvestModule.tsx',
          '/src/data/harvest.ts',
          '/src/GrainModule.tsx',
          '/src/data/createSupabaseGrainServices.ts',
          '/src/ProgramsModule.tsx',
          '/src/data/createSupabaseProgramsServices.ts',
          '/src/InventoryModule.tsx',
          '/src/data/createSupabaseInventoryServices.ts',
          '/src/data/scouting.ts',
        ].some(source => stack.includes(source))
        return Reflect.construct(target, businessClock ? [fixed] : args) as Date
      },
      apply(target, receiver, args) { return Reflect.apply(target, receiver, args) },
    }) as DateConstructor
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => { const stack = new Error().stack ?? ''; if (next && stack.includes('/src/')) { const value = next; next = null; return value } return original() } })
    Object.defineProperty(window, '__mapleSetId', { value: (value: string) => { if (next) throw new Error('Maple deterministic identity already armed.'); next = value } })
  }, instant())
  return { external, writes }
}
async function signIn(page: Page) {
  const password = process.env.FARMRX_SEASON_OWNER_PASSWORD
  if (!password) throw new Error('Missing local synthetic Maple owner password.')
  await page.goto('/login')
  await page.getByLabel('Email address').fill(owner)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/fields/)
  const ready = page.getByRole('link', { name: 'Fields' })
  const retry = page.getByRole('button', { name: 'Try again' })
  await expect(ready.or(retry)).toBeVisible()
  if (await retry.isVisible()) await retry.click()
  await expect(ready).toBeVisible()
}
function assertFence(requests: ReturnType<typeof createSeasonRequestClassifier>, external: string[]) { expect(requests.unexpectedRpcs).toEqual([]); expect(requests.blockedNonReadRequests).toEqual([]); expect(external).toEqual([]) }
async function id(page: Page, value: string) { await page.evaluate(value => window.__mapleSetId(value), value) }
async function replay(page: Page, writes: Captured[]) { const write = writes.at(-1); if (!write) throw new Error('Maple proof did not capture the target write.'); await expect.poll(() => write.response).not.toBeUndefined(); const result = await page.evaluate(async write => { const response = await fetch(write.url, { method: write.method, headers: write.headers, body: write.body, credentials: 'same-origin' }); return { status: response.status, body: await response.text() } }, write); expect(result.status).toBe(write.response!.status); expect(result.body).toBe(write.response!.body) }
async function replayOptimisticNoOp(page: Page, writes: Captured[]) { const write = writes.at(-1); if (!write) throw new Error('Maple proof did not capture the optimistic target write.'); await expect.poll(() => write.response).not.toBeUndefined(); expect(write.response!.status).toBe(200); expect(JSON.parse(write.response!.body)).toHaveLength(1); const result = await page.evaluate(async write => { const response = await fetch(write.url, { method: write.method, headers: write.headers, body: write.body, credentials: 'same-origin' }); return { status: response.status, body: await response.text() } }, write); expect(result).toEqual({ status: 200, body: '[]' }) }
function phase(options: { rpcs?: string[]; direct?: string[] } = {}) { return createSeasonRequestClassifier({ targetMutationRpcs: options.rpcs, targetMutationRequests: options.direct, blockUnexpectedNonReadRequests: true }) }
async function phoneViewport(page: Page) { await page.setViewportSize({ width: 390, height: 844 }) }
async function assertNoOverflow(page: Page) { const widths = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth })); expect(widths.document).toBeLessThanOrEqual(widths.viewport); expect(widths.body).toBeLessThanOrEqual(widths.viewport) }
async function loseFirstRpcResponse(page: Page, requests: ReturnType<typeof createSeasonRequestClassifier>, writes: Captured[], rpc: string) {
  let lose = true
  const target = () => writes.filter(write => write.method === 'POST' && new URL(write.url).pathname === `/rest/v1/rpc/${rpc}`)
  await page.route(`**/rest/v1/rpc/${rpc}`, async route => {
    if (!lose || route.request().method() !== 'POST') return route.fallback()
    lose = false
    expect(requests.observe('POST', route.request().url()).kind).toBe('target-mutation-rpc')
    const response = await route.fetch()
    await expect.poll(() => target().length).toBe(1)
    target()[0]!.response = { status: response.status(), body: await response.text() }
    await route.abort('connectionreset')
  })
  return target
}
async function assertIdenticalAttempts(attempts: () => Captured[]) {
  await expect.poll(() => attempts().length).toBe(2)
  await expect.poll(() => attempts()[1]?.response).not.toBeUndefined()
  expect(attempts()[1]!.body).toBe(attempts()[0]!.body)
  expect(attempts()[1]!.response).toEqual(attempts()[0]!.response)
}

test('@maple-august-write completes only the retained manual task once', async ({ page }) => {
  const requests = phase({ direct: ['PATCH /rest/v1/farm_tasks'] }); const network = await fence(page, requests); await signIn(page); await page.getByRole('link', { name: 'Tasks' }).click()
  const todo = page.locator('section.task-column').filter({ hasText: 'To Do' }); const task = todo.locator('article.task-card').filter({ hasText: 'Inspect Maple south gate' }); await task.getByRole('button', { name: 'Done' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
  await expect(page.locator('section.task-column').filter({ hasText: 'Done' }).getByText('Inspect Maple south gate')).toBeVisible(); await expect(page.locator('.save-receipt[role="status"]')).toHaveText('Saved'); expect(requests.observedTargetMutationPaths).toEqual(['PATCH /rest/v1/farm_tasks']); await replayOptimisticNoOp(page, network.writes); expect(requests.observedTargetMutationPaths).toEqual(['PATCH /rest/v1/farm_tasks', 'PATCH /rest/v1/farm_tasks']); await page.reload(); await expect(page.getByText(/Done by/)).toBeVisible(); assertFence(requests, network.external)
})
test('@maple-august-phone reads Done without writing', async ({ page }) => { const requests = phase(); const network = await fence(page, requests); await phoneViewport(page); await signIn(page); await page.goto('/tasks'); await expect(page.locator('section.task-column').filter({ hasText: 'Done' }).getByText('Inspect Maple south gate')).toBeVisible(); await assertNoOverflow(page); expect(requests.observedTargetMutationPaths).toEqual([]); assertFence(requests, network.external) })

test('@maple-september-write records harvest once despite a rapid double-submit and supports an identical replay', async ({ page }) => {
  const requests = phase({ rpcs: ['save_crop_harvest_versioned'] }); const network = await fence(page, requests); await signIn(page); await page.getByRole('link', { name: 'Harvest' }).click(); await page.getByRole('button', { name: 'Enter harvest' }).click(); const form = page.locator('form.harvest-form'); await form.getByLabel('Harvested bushels').fill('30800'); await form.getByLabel('Harvest date').fill('2027-09-28'); await form.getByLabel('Actual price per bu').fill('4.25'); await id(page, ids.crop); await form.getByRole('button', { name: 'Save harvest' }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() }); await expect(page.getByText('Saved', { exact: true })).toBeVisible(); expect(requests.observedTargetMutationRpcs).toEqual(['save_crop_harvest_versioned']); await replay(page, network.writes); await page.reload(); await expect(page.getByText(/192.5/)).toBeVisible(); await expect(page.getByText(/7.5/)).toBeVisible(); await expect(page.getByText(/130,900/)).toBeVisible(); assertFence(requests, network.external)
})
test('@maple-september-phone reads harvest without writing', async ({ page }) => { const requests = phase(); const network = await fence(page, requests); await phoneViewport(page); await signIn(page); await page.goto('/harvest'); await expect(page.getByText(/192.5/)).toBeVisible(); await assertNoOverflow(page); assertFence(requests, network.external) })

test('@maple-october-write creates then explicitly reconciles one estimate through a lost-response-safe replay', async ({ page }) => {
  const requests = phase({ direct: ['POST /rest/v1/production_estimates', 'PATCH /rest/v1/production_estimates'] }); const network = await fence(page, requests); let losePatchResponse = true
  const patchWrites = () => network.writes.filter(write => write.method === 'PATCH' && new URL(write.url).pathname === '/rest/v1/production_estimates')
  await page.route('**/rest/v1/production_estimates*', async route => {
    if (!losePatchResponse || route.request().method() !== 'PATCH') return route.fallback()
    losePatchResponse = false
    expect(requests.observe('PATCH', route.request().url()).kind).toBe('target-mutation-path')
    const response = await route.fetch()
    await expect.poll(() => patchWrites().length).toBe(1)
    patchWrites()[0]!.response = { status: response.status(), body: await response.text() }
    await route.abort('connectionreset')
  })
  await signIn(page); await page.getByRole('link', { name: 'Grain' }).click(); await page.getByLabel('APH / expected yield').fill('200'); await id(page, ids.estimate); await page.getByRole('button', { name: 'Create estimate' }).click(); await expect(page.locator('.grain-reconciliation')).toContainText('not entered'); expect(requests.observedTargetMutationPaths).toEqual(['POST /rest/v1/production_estimates']); await page.once('dialog', dialog => { expect(dialog.message()).toBe('Use the harvest total as Grain actual? This changes Grain actual only; it does not change bins.'); return dialog.accept() }); await page.getByRole('button', { name: 'Use harvest total as Grain actual' }).click(); await expect(page.getByText('Needs attention — this save was not applied. Reopen it to review.')).toBeVisible(); expect(requests.observedTargetMutationPaths).toEqual(['POST /rest/v1/production_estimates', 'PATCH /rest/v1/production_estimates']); await replay(page, patchWrites()); expect(requests.observedTargetMutationPaths).toEqual(['POST /rest/v1/production_estimates', 'PATCH /rest/v1/production_estimates', 'PATCH /rest/v1/production_estimates']); await page.reload(); await expect(page.locator('.grain-reconciliation')).toContainText('30,800'); assertFence(requests, network.external)
})
test('@maple-october-phone reads Grain without writing', async ({ page }) => { const requests = phase(); const network = await fence(page, requests); await phoneViewport(page); await signIn(page); await page.goto('/grain'); await expect(page.locator('.grain-reconciliation')).toContainText('30,800'); await assertNoOverflow(page); assertFence(requests, network.external) })

test('@maple-november-write performs independent bin, movement, contract, movement, and delivery actions', async ({ page }) => {
  const requests = phase({ rpcs: ['append_bin_movement', 'record_grain_contract_delivery'], direct: ['POST /rest/v1/grain_bins', 'POST /rest/v1/grain_contracts'] }); const network = await fence(page, requests); await signIn(page); await page.goto('/grain/storage'); await page.getByRole('button', { name: 'Add bin' }).click(); let form = page.locator('form.bin-form'); await form.getByLabel('Name', { exact: true }).fill('Maple North Bin'); await form.getByLabel('Capacity bushels').fill('40000'); await form.getByLabel('Location name').fill('Maple Ridge'); await id(page, ids.bin); await form.getByRole('button', { name: 'Save bin' }).click(); const bin = page.locator('article.bin-card').filter({ hasText: 'Maple North Bin' }); await bin.getByText('Movement ledger (0)', { exact: true }).click(); form = bin.locator('form.movement-form'); await form.getByLabel('Bushels').fill('30800'); await form.getByLabel('Commodity').selectOption('corn_yellow'); await form.getByLabel('Date').fill('2027-09-28'); await form.getByLabel('Note').fill('2027 harvest load-in'); await id(page, ids.inbound); await form.getByRole('button', { name: 'Add movement' }).click(); await expect(bin).toContainText('30,800 bu'); await replay(page, network.writes); await page.goto('/grain/contracts'); form = page.locator('form.contract-entry'); await form.getByLabel('Type').selectOption('cash_spot'); await form.getByLabel('Bushels').fill('5000'); await form.getByLabel('Cash $/bu').fill('4.25'); await form.getByText('Delivery, contract #, premium', { exact: true }).click(); await form.getByLabel('Start').fill('2027-11-10'); await form.getByLabel('End').fill('2027-12-15'); await form.getByLabel('Contract #').fill('MR-2027-001'); await id(page, ids.contract); await form.getByRole('button', { name: 'Add contract' }).click(); await page.goto('/grain/storage'); await bin.getByText(/Movement ledger/).click(); form = bin.locator('form.movement-form'); await form.getByLabel('Direction').selectOption('out'); await form.getByLabel('Bushels').fill('5000'); await form.getByLabel('Date').fill('2027-11-10'); await form.getByLabel('Note').fill('Delivery to Synthetic Elevator'); await id(page, ids.outbound); await form.getByRole('button', { name: 'Add movement' }).click(); await expect(bin).toContainText('25,800 bu'); await replay(page, network.writes); await page.goto('/grain/contracts'); const contract = page.locator('tr').filter({ hasText: 'MR-2027-001' }); await contract.getByLabel('Delivered bushels').fill('5000'); await id(page, ids.delivery); await contract.getByRole('button', { name: 'Record delivery' }).click(); await replay(page, network.writes); await expect(contract).toContainText('5,000.00 / 0.00 bu'); assertFence(requests, network.external)
})
test('@maple-november-phone reads Storage and Contracts without writing', async ({ page }) => { const requests = phase(); const network = await fence(page, requests); await phoneViewport(page); await signIn(page); await page.goto('/grain/storage'); await expect(page.getByText('Maple North Bin')).toBeVisible(); await assertNoOverflow(page); await page.goto('/grain/contracts'); await expect(page.getByText('MR-2027-001')).toBeVisible(); await assertNoOverflow(page); assertFence(requests, network.external) })

test('@maple-november-bin writes only the empty Maple bin', async ({ page }) => { const requests = phase({ direct: ['POST /rest/v1/grain_bins'] }); const network = await fence(page, requests); await signIn(page); await page.goto('/grain/storage'); await page.getByRole('button', { name: 'Add bin' }).click(); const form = page.locator('form.bin-form'); await form.getByLabel('Name', { exact: true }).fill('Maple North Bin'); await form.getByLabel('Capacity bushels').fill('40000'); await form.getByLabel('Location name').fill('Maple Ridge'); await id(page, ids.bin); await form.getByRole('button', { name: 'Save bin' }).click(); await expect(page.locator('article.bin-card').filter({ hasText: 'Maple North Bin' })).toContainText('0 bu'); assertFence(requests, network.external) })
test('@maple-november-in appends the exact independent inbound movement through a lost-response retry', async ({ page }) => { const requests = phase({ rpcs: ['append_bin_movement'] }); const network = await fence(page, requests); const attempts = await loseFirstRpcResponse(page, requests, network.writes, 'append_bin_movement'); await signIn(page); await page.goto('/grain/storage'); const bin = page.locator('article.bin-card').filter({ hasText: 'Maple North Bin' }); await bin.getByText('Movement ledger (0)', { exact: true }).click(); const form = bin.locator('form.movement-form'); await form.getByLabel('Bushels').fill('30800'); await form.getByLabel('Commodity').selectOption('corn_yellow'); await form.getByLabel('Date').fill('2027-09-28'); await form.getByLabel('Note').fill('2027 harvest load-in'); await id(page, ids.inbound); await form.getByRole('button', { name: 'Add movement' }).click(); await expect(form.getByRole('button', { name: 'Retry movement' })).toBeVisible(); await form.getByRole('button', { name: 'Retry movement' }).click(); await expect(bin).toContainText('30,800 bu'); await assertIdenticalAttempts(attempts); assertFence(requests, network.external) })
test('@maple-november-contract creates the independent cash contract', async ({ page }) => { const requests = phase({ direct: ['POST /rest/v1/grain_contracts'] }); const network = await fence(page, requests); await signIn(page); await page.goto('/grain/contracts'); const form = page.locator('form.contract-entry'); await form.getByLabel('Type').selectOption('cash_spot'); await form.getByLabel('Bushels').fill('5000'); await form.getByLabel('Cash $/bu').fill('4.25'); await form.getByText('Delivery, contract #, premium', { exact: true }).click(); await form.getByLabel('Start').fill('2027-11-10'); await form.getByLabel('End').fill('2027-12-15'); await form.getByLabel('Contract #').fill('MR-2027-001'); await id(page, ids.contract); await form.getByRole('button', { name: 'Add contract' }).click(); await expect(page.getByText('MR-2027-001')).toBeVisible(); assertFence(requests, network.external) })
test('@maple-november-out appends the independent bin-out movement through a lost-response retry', async ({ page }) => { const requests = phase({ rpcs: ['append_bin_movement'] }); const network = await fence(page, requests); const attempts = await loseFirstRpcResponse(page, requests, network.writes, 'append_bin_movement'); await signIn(page); await page.goto('/grain/storage'); const bin = page.locator('article.bin-card').filter({ hasText: 'Maple North Bin' }); await bin.getByText(/Movement ledger/).click(); const form = bin.locator('form.movement-form'); await form.getByLabel('Direction').selectOption('out'); await form.getByLabel('Bushels').fill('5000'); await form.getByLabel('Date').fill('2027-11-10'); await form.getByLabel('Note').fill('Delivery to Synthetic Elevator'); await id(page, ids.outbound); await form.getByRole('button', { name: 'Add movement' }).click(); await expect(form.getByRole('button', { name: 'Retry movement' })).toBeVisible(); await form.getByRole('button', { name: 'Retry movement' }).click(); await expect(bin).toContainText('25,800 bu'); await assertIdenticalAttempts(attempts); assertFence(requests, network.external) })
test('@maple-november-delivery records the independent contract delivery through a lost-response retry', async ({ page }) => { const requests = phase({ rpcs: ['record_grain_contract_delivery'] }); const network = await fence(page, requests); const attempts = await loseFirstRpcResponse(page, requests, network.writes, 'record_grain_contract_delivery'); await signIn(page); await page.goto('/grain/contracts'); const contract = page.locator('tr').filter({ hasText: 'MR-2027-001' }); await contract.getByLabel('Delivered bushels').fill('5000'); await id(page, ids.delivery); await contract.getByRole('button', { name: 'Record delivery' }).click(); await expect(contract.getByText('Delivery may be recorded but could not be confirmed. Retry keeps the same delivery and will not create another.')).toBeVisible(); await contract.getByRole('button', { name: 'Retry delivery' }).click(); await expect(contract).toContainText('5,000.00 / 0.00 bu'); await assertIdenticalAttempts(attempts); assertFence(requests, network.external) })

async function assertDecemberClean(page: Page) { const queueKeys = await page.evaluate(() => Object.keys(localStorage).filter(key => key.includes('-queue:') || key.includes('needs-attention'))); expect(queueKeys, 'December begins with no browser write queue or parked recovery record').toEqual([]); await expect(page.locator('[role="status"]').filter({ hasText: /Saving|Queued offline|Needs attention/ })).toHaveCount(0) }
test('@maple-december-continuous @maple-december-read-only reconciles the full year without a write', async ({ page }) => { const requests = phase(); const network = await fence(page, requests); await signIn(page); await page.goto('/fields'); await expect(page.getByText('Maple East 160')).toBeVisible(); await page.reload(); for (const path of ['/grain', '/grain/contracts', '/grain/storage', '/inventory', '/programs', '/harvest', '/scouting', '/tasks']) { await page.goto(path); await page.reload() }; await expect(page.getByText('Inspect Maple south gate')).toBeVisible(); await assertDecemberClean(page); assertFence(requests, network.external) })
test('@maple-december-continuous @maple-december-phone reads the year closeout without writing', async ({ page }) => { const requests = phase(); const network = await fence(page, requests); await phoneViewport(page); await signIn(page); await page.goto('/grain'); await expect(page.locator('.grain-reconciliation')).toContainText('30,800'); await assertNoOverflow(page); await page.goto('/tasks'); await expect(page.getByText('Inspect Maple south gate')).toBeVisible(); await assertNoOverflow(page); await assertDecemberClean(page); assertFence(requests, network.external) })
async function expectVisibleText(page: Page, value: string | RegExp) { await expect.poll(async () => { for (const match of await page.getByText(value).all()) if (await match.isVisible()) return true; return false }).toBe(true) }
async function decemberRoute(page: Page, path: string, visible: Array<string | RegExp>, tab?: string) { const requests = phase(); const network = await fence(page, requests); await signIn(page); await page.goto(path); if (tab) await page.getByRole('button', { name: tab }).click(); await page.reload(); if (tab) await page.getByRole('button', { name: tab }).click(); for (const value of visible) await expectVisibleText(page, value); await assertDecemberClean(page); assertFence(requests, network.external) }
test('@maple-december-continuous @maple-december-fields', async ({ page }) => { await decemberRoute(page, '/fields', ['Maple East 160', 'Yellow Corn', 'Owned', '1/1']) })
test('@maple-december-continuous @maple-december-grain', async ({ page }) => { await decemberRoute(page, '/grain', [/Harvest actuals:.*30,800/, /Grain actual production:.*30,800/, /All bins holding.*25,800/, /Harvest minus Grain actual: 0/]) })
test('@maple-december-continuous @maple-december-contracts', async ({ page }) => { await decemberRoute(page, '/grain/contracts', ['MR-2027-001', 'Synthetic Elevator', 'Cash / spot', /\$4\.25/, /5,000\.00 \/ 0\.00 bu/]) })
test('@maple-december-continuous @maple-december-storage', async ({ page }) => { await decemberRoute(page, '/grain/storage', ['Maple North Bin', 'Maple Ridge', '25,800 bu', /\/ 40,000 bu · 65%/]) })
test('@maple-december-continuous @maple-december-inventory-compliance', async ({ page }) => { await decemberRoute(page, '/inventory', [/Maple East 160 · 2027-06-18/, 'Synthetic Herbicide 41 — Maple', /160 acres/, /Not recorded/], 'Compliance') })
test('@maple-december-continuous @maple-december-programs-progress', async ({ page }) => { await decemberRoute(page, '/programs', ['Post-emerge synthetic pass', /Applied/, /160 acres/], 'Season progress') })
test('@maple-december-continuous @maple-december-harvest', async ({ page }) => { await decemberRoute(page, '/harvest', [/192\.5/, /7\.5/, /130,900/]) })
test('@maple-december-continuous @maple-december-scouting', async ({ page }) => { await decemberRoute(page, '/scouting', ['Synthetic waterhemp at south gate', 'Weed', '2027-07-09']) })
test('@maple-december-continuous @maple-december-tasks', async ({ page }) => { await decemberRoute(page, '/tasks', ['Inspect Maple south gate', /Done by/]) })
test('@maple-december-continuous @maple-december-concurrent-preflight remains read-only in two fresh browser contexts', async ({ browser }) => {
  const port = seasonLoopbackPort('FARMRX_SEASON_AUGUST_DECEMBER_PORT', 4280); const first = await browser.newContext({ baseURL: `http://127.0.0.1:${port}` }); const second = await browser.newContext({ baseURL: `http://127.0.0.1:${port}` })
  try { const left = await first.newPage(); const right = await second.newPage(); const leftRequests = phase(); const rightRequests = phase(); const leftNetwork = await fence(left, leftRequests); const rightNetwork = await fence(right, rightRequests); await Promise.all([signIn(left), signIn(right)]); await Promise.all([left.goto('/tasks'), right.goto('/programs')]); await right.getByRole('button', { name: 'Season progress' }).click(); await expect(left.locator('section.task-column').filter({ hasText: 'Done' }).getByText('Inspect Maple south gate')).toBeVisible(); await expect(right.getByText('Post-emerge synthetic pass')).toBeVisible(); for (const observed of [leftRequests.observedReadOnlyRpcs, rightRequests.observedReadOnlyRpcs]) { expect(observed).toContain('program_due_generation_status'); expect(observed).toContain('service_due_generation_status') }; await assertDecemberClean(left); await assertDecemberClean(right); assertFence(leftRequests, leftNetwork.external); assertFence(rightRequests, rightNetwork.external) } finally { await first.close(); await second.close() }
})
