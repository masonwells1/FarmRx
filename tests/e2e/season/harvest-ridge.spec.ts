import { expect, test, type Page, type Request } from '@playwright/test'
import { createSeasonRequestClassifier } from './season-request-classifier'

const ids = {
  harvest: '27076000-0000-4000-8000-000000000004',
  bin: '27073000-0000-4000-8000-000000000005',
  inbound: '27074000-0000-4000-8000-000000000005',
  contract: '27071000-0000-4000-8000-000000000005',
  outbound: '27074000-0000-4000-8000-000000000004',
  delivery: '27072000-0000-4000-8000-000000000004',
}
const reverseIds = { outbound: '27074000-0000-4000-8000-000000000006', delivery: '27072000-0000-4000-8000-000000000005' }
type CapturedWrite = { label: string; url: string; method: string; body: string; headers: Record<string, string>; response?: { status: number; body: string } }

function clientInstant() {
  const value = process.env.FARMRX_HR_CLIENT_INSTANT
  if (!value || !/^2027-(?:10|11)-/.test(value) || Number.isNaN(Date.parse(value))) throw new Error('FARMRX_HR_CLIENT_INSTANT must be the exact governed Harvest Ridge 2027 instant.')
  return value
}

async function fence(page: Page, requests: ReturnType<typeof createSeasonRequestClassifier>) {
  const external: string[] = []
  const writes: CapturedWrite[] = []
  const captured = new Map<Request, CapturedWrite>()
  page.on('request', request => {
    const url = new URL(request.url())
    const label = request.method() === 'POST' && url.pathname.endsWith('/save_crop_harvest_versioned') ? 'harvest'
      : request.method() === 'POST' && url.pathname.endsWith('/append_bin_movement') ? 'movement'
        : request.method() === 'POST' && url.pathname.endsWith('/record_grain_contract_delivery') ? 'delivery' : null
    if (!label) return
    const all = request.headers()
    const write = { label, url: request.url(), method: request.method(), body: request.postData() ?? '', headers: Object.fromEntries(['apikey', 'authorization', 'content-type', 'x-farm-rx-expected-user-id', 'x-farm-rx-access-epochs'].flatMap(name => all[name] ? [[name, all[name]]] : [])) }
    writes.push(write)
    captured.set(request, write)
  })
  page.on('response', response => {
    const write = captured.get(response.request())
    if (write) void response.text().then(body => { write.response = { status: response.status(), body } })
  })
  await page.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname === 's3.tradingview.com' && url.pathname === '/external-embedding/embed-widget-mini-symbol-overview.js') { await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' }); return }
    if (url.hostname !== '127.0.0.1' || !['4180', '55321'].includes(url.port)) { external.push(`${route.request().method()} ${url.href}`); await route.abort('blockedbyclient'); return }
    if (url.port === '55321' && requests.observe(route.request().method(), url.href).block) { await route.abort('blockedbyclient'); return }
    await route.continue()
  })
  await page.addInitScript(fixedIso => {
    const RealDate = Date
    const fixed = Date.parse(fixedIso)
    window.Date = new Proxy(RealDate, {
      construct(target, args) {
        const stack = new Error().stack ?? ''
        const farmActionClock = args.length === 0 && (stack.includes('/src/HarvestModule.tsx') || stack.includes('/src/GrainModule.tsx') || stack.includes('/src/data/createSupabaseGrainServices.ts') || stack.includes('/src/data/harvest.ts'))
        return Reflect.construct(target, farmActionClock ? [fixed] : args) as Date
      },
      apply(target, receiver, args) { return Reflect.apply(target, receiver, args) },
    }) as DateConstructor
    let next: string | null = null
    const original = crypto.randomUUID.bind(crypto)
    Object.defineProperties(window, { __hrSetId: { value: (id: string) => { next = id } } })
    Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: () => {
      const stack = new Error().stack ?? ''
      const harvestOperation = stack.includes('/src/data/QueuedHarvestRepository.ts')
      const grainOperation = stack.includes('/src/data/MockGrainRepository.ts') && stack.includes('/src/GrainModule.tsx')
      if (next && (harvestOperation || grainOperation)) { const id = next; next = null; return id }
      return original()
    } })
  }, clientInstant())
  return { external, writes }
}

declare global { interface Window { __hrSetId(id: string): void } }

async function signIn(page: Page) {
  const password = process.env.FARMRX_SEASON_OWNER_PASSWORD
  if (!password) throw new Error('Missing synthetic local Harvest Ridge password.')
  await page.goto('/login')
  await page.getByLabel('Email address').fill('harvest.owner@farmrx.local.test')
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/fields/)
}
async function id(page: Page, value: string) { await page.evaluate(value => window.__hrSetId(value), value) }
function assertFence(requests: ReturnType<typeof createSeasonRequestClassifier>, external: string[]) { expect(requests.unexpectedRpcs).toEqual([]); expect(requests.blockedNonReadRequests).toEqual([]); expect(external).toEqual([]) }

async function replay(page: Page, writes: CapturedWrite[], label: string, expectedId: string) {
  const write = [...writes].reverse().find(candidate => candidate.label === label)
  if (!write) throw new Error(`Harvest Ridge did not capture the ${label} browser write.`)
  await expect.poll(() => write.response, { message: `${label} original response was not captured` }).not.toBeUndefined()
  const original = write.response!
  expect(original.status, `${label} original response: ${original.body}`).toBeGreaterThanOrEqual(200)
  expect(original.status, `${label} original response: ${original.body}`).toBeLessThan(300)
  const result = await page.evaluate(async ({ url, method, body, headers }) => { const response = await fetch(url, { method, headers, body, credentials: 'same-origin' }); return { status: response.status, body: await response.text() } }, write)
  expect(result.status, `${label} replay response: ${result.body}`).toBe(original.status)
  expect(JSON.parse(result.body)).toEqual(JSON.parse(original.body))
  expect(JSON.parse(result.body).id).toBe(expectedId)
}

function phaseRequests(options: { rpcs?: string[]; direct?: string[] } = {}) {
  return createSeasonRequestClassifier({ targetMutationRpcs: options.rpcs, targetMutationRequests: options.direct, blockUnexpectedNonReadRequests: true })
}

test('@harvest-ridge-canonical-hr1 harvest records one exact actual with a durable replay receipt', async ({ page }) => {
  const requests = phaseRequests({ rpcs: ['save_crop_harvest_versioned'] }); const { external, writes } = await fence(page, requests); await signIn(page)
  await page.getByRole('link', { name: 'Harvest' }).click(); await page.getByRole('button', { name: 'Enter harvest' }).click()
  const form = page.locator('form.harvest-form'); await form.getByLabel('Harvested bushels').fill('27600'); await form.getByLabel('Harvest date').fill('2027-10-11'); await id(page, ids.harvest); await form.getByRole('button', { name: 'Save harvest' }).click()
  await expect(page.getByText('Saved', { exact: true })).toBeVisible(); await replay(page, writes, 'harvest', '27030000-0000-4000-8000-000000000004')
  expect(requests.observedTargetMutationRpcs).toEqual(['save_crop_harvest_versioned', 'save_crop_harvest_versioned']); assertFence(requests, external)
})

test('@harvest-ridge-canonical-hr2 Grain reads harvest without automatic reconciliation or other writes', async ({ page }) => {
  const requests = phaseRequests(); const { external } = await fence(page, requests); await signIn(page); await page.getByRole('link', { name: 'Grain' }).click()
  await expect(page.locator('.grain-reconciliation p').first()).toContainText('Harvest actuals: 27,600 bu · Grain actual production: not entered')
  expect(requests.observedTargetMutationRpcs).toEqual([]); expect(requests.observedTargetMutationPaths).toEqual([]); assertFence(requests, external)
})

test('@harvest-ridge-canonical-hr3 explicit reconciliation changes Grain actual only', async ({ page }) => {
  const requests = phaseRequests({ direct: ['PATCH /rest/v1/production_estimates'] }); const { external } = await fence(page, requests); await signIn(page); await page.getByRole('link', { name: 'Grain' }).click()
  await page.once('dialog', dialog => dialog.accept()); const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/rest/v1/production_estimates' && response.request().method() === 'PATCH' && response.ok())
  await page.getByRole('button', { name: 'Use harvest total as Grain actual' }).click(); await saved
  await expect(page.locator('.grain-reconciliation p').first()).toContainText('Harvest actuals: 27,600 bu · Grain actual production: 27,600 bu')
  expect(requests.observedTargetMutationPaths).toEqual(['PATCH /rest/v1/production_estimates']); assertFence(requests, external)
})

test('@harvest-ridge-canonical-extension-bin creates one empty proof bin without moving grain', async ({ page }) => {
  const requests = phaseRequests({ direct: ['POST /rest/v1/grain_bins'] }); const { external } = await fence(page, requests); await signIn(page); await page.goto('/grain/storage'); await page.getByRole('button', { name: 'Add bin' }).click()
  const form = page.locator('form.bin-form'); await form.getByRole('textbox', { name: 'Name', exact: true }).fill('Harvest Ridge Proof Bin'); await form.getByLabel('Capacity bushels').fill('40000'); await id(page, ids.bin); await form.getByRole('button', { name: 'Save bin' }).click()
  const proof = page.locator('article.bin-card').filter({ hasText: 'Harvest Ridge Proof Bin' }); await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible(); await expect(proof).toContainText('0 bu'); await expect(proof).toContainText('Movement ledger (0)')
  expect(requests.observedTargetMutationPaths).toEqual(['POST /rest/v1/grain_bins']); assertFence(requests, external)
})

test('@harvest-ridge-canonical-extension-in adds one independent inbound movement', async ({ page }) => {
  const requests = phaseRequests({ rpcs: ['append_bin_movement'] }); const { external, writes } = await fence(page, requests); await signIn(page); await page.goto('/grain/storage')
  const proof = page.locator('article.bin-card').filter({ hasText: 'Harvest Ridge Proof Bin' }); await proof.getByText('Movement ledger (0)', { exact: true }).click(); const form = proof.locator('form.movement-form')
  await form.getByLabel('Bushels').fill('2600'); await form.getByLabel('Commodity').selectOption('corn_yellow'); await form.getByLabel('Date').fill('2027-11-06'); await id(page, ids.inbound); await form.getByRole('button', { name: 'Add movement' }).click()
  await expect(proof).toContainText('2,600 bu'); await replay(page, writes, 'movement', ids.inbound); expect(requests.observedTargetMutationRpcs).toEqual(['append_bin_movement', 'append_bin_movement']); assertFence(requests, external)
})

test('@harvest-ridge-canonical-extension-contract creates one contract without changing either bin', async ({ page }) => {
  const requests = phaseRequests({ direct: ['POST /rest/v1/grain_contracts'] }); const { external } = await fence(page, requests); await signIn(page); await page.goto('/grain/contracts')
  const form = page.locator('form.contract-entry'); await form.getByLabel('Type').selectOption('cash_spot'); await form.getByLabel('Bushels').fill('2600'); await form.getByLabel('Cash $/bu').fill('4.25'); await form.getByText('Delivery, contract #, premium', { exact: true }).click(); await form.getByLabel('Start').fill('2027-11-01'); await form.getByLabel('End').fill('2027-12-15'); await form.getByLabel('Contract #').fill('HR-2027-PROOF-001'); await id(page, ids.contract); await form.getByRole('button', { name: 'Add contract' }).click()
  await expect(page.getByText('Saved', { exact: true }).first()).toBeVisible(); await expect(page.locator('tr').filter({ hasText: 'HR-2027-PROOF-001' })).toContainText('2,600.00')
  await page.goto('/grain/storage'); await expect(page.locator('article.bin-card').filter({ hasText: 'Harvest Ridge Main Bin' })).toContainText('30,000 bu'); await expect(page.locator('article.bin-card').filter({ hasText: 'Harvest Ridge Proof Bin' })).toContainText('2,600 bu')
  expect(requests.observedTargetMutationPaths).toEqual(['POST /rest/v1/grain_contracts']); assertFence(requests, external)
})

test('@harvest-ridge-canonical-hr4 bin-out changes only the selected bin', async ({ page }) => {
  const requests = phaseRequests({ rpcs: ['append_bin_movement'] }); const { external, writes } = await fence(page, requests); await signIn(page); await page.goto('/grain/storage')
  const bin = page.locator('article.bin-card').filter({ hasText: 'Harvest Ridge Main Bin' }); await bin.getByText('Movement ledger (0)', { exact: true }).click(); const form = bin.locator('form.movement-form'); await form.getByLabel('Direction').selectOption('out'); await form.getByLabel('Bushels').fill('5000'); await form.getByLabel('Date').fill('2027-11-06'); await form.getByLabel('Note').fill('Delivery to Synthetic Elevator'); await expect(form.getByText('Bin-out changes this bin only. It does not mark a contract delivered.')).toBeVisible(); await id(page, ids.outbound); await form.getByRole('button', { name: 'Add movement' }).click()
  await expect(bin).toContainText('25,000 bu'); await replay(page, writes, 'movement', ids.outbound); await page.goto('/grain/contracts'); await expect(page.locator('tr').filter({ hasText: 'HR-2027-001' })).toContainText('0.00 / 5,000.00 bu')
  expect(requests.observedTargetMutationRpcs).toEqual(['append_bin_movement', 'append_bin_movement']); assertFence(requests, external)
})

test('@harvest-ridge-canonical-hr5 delivery changes only the assigned contract', async ({ page }) => {
  const requests = phaseRequests({ rpcs: ['record_grain_contract_delivery'] }); const { external, writes } = await fence(page, requests); await signIn(page); await page.goto('/grain/contracts')
  const contract = page.locator('tr').filter({ hasText: 'HR-2027-001' }); await expect(contract.getByText('Recording a delivery does not remove grain from a bin.')).toBeVisible(); await contract.getByLabel('Delivered bushels').fill('5000'); await id(page, ids.delivery); await contract.getByRole('button', { name: 'Record delivery' }).click()
  await expect(contract).toContainText('5,000.00 / 0.00 bu'); await replay(page, writes, 'delivery', ids.delivery); await page.goto('/grain/storage'); await expect(page.locator('article.bin-card').filter({ hasText: 'Harvest Ridge Main Bin' })).toContainText('25,000 bu')
  expect(requests.observedTargetMutationRpcs).toEqual(['record_grain_contract_delivery', 'record_grain_contract_delivery']); assertFence(requests, external)
})

async function noOverflow(page: Page, label: string) {
  const sizes = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, body: document.body.scrollWidth, viewport: window.innerWidth }))
  expect(sizes.document, `${label} document overflow`).toBeLessThanOrEqual(sizes.viewport); expect(sizes.body, `${label} body overflow`).toBeLessThanOrEqual(sizes.viewport)
}

test('@harvest-ridge-canonical-phone phone Grain, Storage, and Contracts remain readable and read-only', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 }); const requests = phaseRequests(); const { external } = await fence(page, requests); await signIn(page)
  await page.getByRole('navigation').getByRole('button', { name: 'More' }).click(); await page.getByRole('link', { name: 'Grain' }).click(); await expect(page.getByText('Harvest reconciliation')).toBeVisible(); await expect(page.locator('.grain-reconciliation p').first()).toContainText('Harvest actuals: 27,600 bu · Grain actual production: 27,600 bu'); await noOverflow(page, 'Grain')
  await page.goto('/grain/storage'); await expect(page.locator('article.bin-card').filter({ hasText: 'Harvest Ridge Main Bin' })).toContainText('25,000 bu'); await expect(page.locator('article.bin-card').filter({ hasText: 'Harvest Ridge Proof Bin' })).toContainText('2,600 bu'); await noOverflow(page, 'Storage')
  await page.goto('/grain/contracts'); await expect(page.locator('tr').filter({ hasText: 'HR-2027-001' })).toContainText('5,000.00 / 0.00 bu'); await expect(page.locator('tr').filter({ hasText: 'HR-2027-PROOF-001' })).toContainText('2,600.00'); await noOverflow(page, 'Contracts')
  expect(requests.observedTargetMutationRpcs).toEqual([]); expect(requests.observedTargetMutationPaths).toEqual([]); assertFence(requests, external)
})

test('@harvest-ridge-reverse-hr5 delivery first leaves the bin untouched', async ({ page }) => {
  const requests = phaseRequests({ rpcs: ['record_grain_contract_delivery'] }); const { external, writes } = await fence(page, requests); await signIn(page); await page.goto('/grain/contracts')
  const contract = page.locator('tr').filter({ hasText: 'HR-2027-001' }); await contract.getByLabel('Delivered bushels').fill('5000'); await id(page, reverseIds.delivery); await contract.getByRole('button', { name: 'Record delivery' }).click(); await expect(contract).toContainText('5,000.00 / 0.00 bu'); await replay(page, writes, 'delivery', reverseIds.delivery)
  await page.goto('/grain/storage'); const bin = page.locator('article.bin-card').filter({ hasText: 'Harvest Ridge Main Bin' }); await expect(bin).toContainText('30,000 bu'); await expect(bin).toContainText('Movement ledger (0)'); expect(requests.observedTargetMutationRpcs).toEqual(['record_grain_contract_delivery', 'record_grain_contract_delivery']); assertFence(requests, external)
})

test('@harvest-ridge-reverse-hr4 earlier canonical bin-out instant remains independent after later delivery ran first', async ({ page }) => {
  const requests = phaseRequests({ rpcs: ['append_bin_movement'] }); const { external, writes } = await fence(page, requests); await signIn(page); await page.goto('/grain/storage')
  const bin = page.locator('article.bin-card').filter({ hasText: 'Harvest Ridge Main Bin' }); await bin.getByText('Movement ledger (0)', { exact: true }).click(); const form = bin.locator('form.movement-form'); await form.getByLabel('Direction').selectOption('out'); await form.getByLabel('Bushels').fill('5000'); await form.getByLabel('Date').fill('2027-11-06'); await form.getByLabel('Note').fill('Reverse-order delivery movement'); await id(page, reverseIds.outbound); await form.getByRole('button', { name: 'Add movement' }).click()
  await expect(bin).toContainText('25,000 bu'); await replay(page, writes, 'movement', reverseIds.outbound); expect(requests.observedTargetMutationRpcs).toEqual(['append_bin_movement', 'append_bin_movement']); assertFence(requests, external)
})
