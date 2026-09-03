import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page } from '@playwright/test'

const project = 'agvsozfbstpekuqxpqjr'; const user = '00000000-0000-4000-8000-000000000001'; const farm = '00000000-0000-4000-8000-000000000010'; const entity = '00000000-0000-4000-8000-000000000011'; const field = '00000000-0000-4000-8000-000000000012'; const secondField = '00000000-0000-4000-8000-000000000013'; const testId = '00000000-0000-4000-8000-000000000021'; const attachmentId = '00000000-0000-4000-8000-000000000022'; const reportPath = `${farm}/${field}/${testId}/lab-report.pdf`; const now = '2027-01-15T12:00:00.000Z'
const protectedTables = ['farms', 'farm_memberships', 'farm_rep_access', 'entities', 'fields', 'arrangements', 'crop_assignments', 'commodities', 'notifications'] as const
type ProtectedTable = typeof protectedTables[number]
const allowedSoilRestWrites = new Set(['POST soil_tests', 'DELETE soil_tests', 'POST soil_test_attachments'])
type WriteState = { tests: Array<Record<string, unknown>>; attachments: Array<Record<string, unknown>>; writes: string[]; uploaded: Set<string>; failSoilSaves: number; failAttachmentMetadata: number; failStorageRemovals: number; changeEpochAfterUpload: boolean; accessEpoch: number; protectedWriteAttempts: string[]; protectedState: Record<ProtectedTable, string[]> }
function writeState(): WriteState { return { tests: [], attachments: [], writes: [], uploaded: new Set(), failSoilSaves: 0, failAttachmentMetadata: 0, failStorageRemovals: 0, changeEpochAfterUpload: false, accessEpoch: 1, protectedWriteAttempts: [], protectedState: { farms: ['protected-farm-byte'], farm_memberships: ['protected-membership-byte'], farm_rep_access: ['protected-rep-access-byte'], entities: ['protected-entity-byte'], fields: ['protected-field-byte'], arrangements: ['protected-arrangement-byte'], crop_assignments: ['protected-crop-byte'], commodities: ['protected-commodity-byte'], notifications: ['protected-notification-byte'] } } }
function protectedSnapshot(state: WriteState) { return JSON.stringify(state.protectedState) }
function expectProtectedNonwrite(state: WriteState, before: string) { expect(state.protectedWriteAttempts).toEqual([]); expect(protectedSnapshot(state)).toBe(before) }
function soilRow(id: string, labName: string, sampleDate: string, fieldId = field) { return { id, farm_id: farm, field_id: fieldId, sample_date: sampleDate, lab_name: labName, ph: null, organic_matter_pct: null, cec_meq_100g: null, phosphorus_ppm: null, potassium_ppm: null, calcium_ppm: null, magnesium_ppm: null, sulfur_ppm: null, base_saturation_calcium_pct: null, base_saturation_magnesium_pct: null, base_saturation_potassium_pct: null, base_saturation_sodium_pct: null, base_saturation_hydrogen_pct: null, boron_ppm: null, chloride_ppm: null, copper_ppm: null, iron_ppm: null, manganese_ppm: null, molybdenum_ppm: null, zinc_ppm: null, created_by: user, created_at: now, updated_at: now } }
function historyState() { const state = writeState(); state.tests = [soilRow(testId, 'Old Lab', '2026-11-01')]; state.attachments = [{ id: attachmentId, farm_id: farm, field_id: field, test_id: testId, storage_path: reportPath, original_filename: 'lab-report.pdf', mime_type: 'application/pdf', size_bytes: 1024, created_by: user, created_at: now }]; return state }
function session() { const exp = Math.floor(Date.now() / 1000) + 86400; const payload = Buffer.from(JSON.stringify({ sub: user, aud: 'authenticated', exp, session_id: 'soil-rx-e2e' })).toString('base64url'); return { access_token: `eyJhbGciOiJub25lIn0.${payload}.signature`, refresh_token: 'soil-rx-refresh', expires_in: 86400, expires_at: exp, token_type: 'bearer', user: { id: user, aud: 'authenticated', role: 'authenticated', email: 'farmer@example.test', app_metadata: {}, user_metadata: {}, identities: [], created_at: now } } }
async function mock(page: Page, readOnly = false, state?: WriteState, denied = false) {
  const unexpected: string[] = []
  await page.route('https://*.supabase.co/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const table = url.pathname.match(/^\/rest\/v1\/([^/]+)$/)?.[1]; const cors = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'access-control-allow-headers': '*' }; const json = (body: unknown) => route.fulfill({ contentType: 'application/json', headers: cors, body: JSON.stringify(body) })
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (url.pathname === '/auth/v1/user') return json(session().user)
    if (url.pathname.includes('/rpc/get_current_farm_access_epochs')) return json([{ farm_id: farm, access_epoch: state?.accessEpoch ?? 1 }])
    if (/\/rpc\/(program_due_generation_status|service_due_generation_status)$/.test(url.pathname)) return json({ has_due: false, task_needed: false, notification_needed: false, local_date: '2027-01-15' })
    if (url.pathname.includes('/rpc/operational_integrity_capability_probe')) return json(true)
    if (/\/rpc\/(can_access_farm|is_active_farm_member|can_edit_farm|can_manage_farm|can_read_private_financials|has_explicit_rep_access)$/.test(url.pathname)) { const name = url.pathname.split('/').at(-1); return json(denied ? false : name === 'has_explicit_rep_access' ? false : name === 'can_edit_farm' || name === 'can_manage_farm' || name === 'can_read_private_financials' ? !readOnly : true) }
    if (url.pathname === `/storage/v1/object/sign/soil-test-reports/${reportPath}`) return json({ signedURL: `/storage/v1/object/sign/soil-test-reports/${reportPath}?token=soil-rx-e2e` })
    if (state && request.method() === 'POST' && url.pathname.startsWith('/storage/v1/object/soil-test-reports/')) { const path = decodeURIComponent(url.pathname.slice('/storage/v1/object/soil-test-reports/'.length)); state.uploaded.add(path); state.writes.push(`storage:upload:${path}`); if (state.changeEpochAfterUpload) { state.accessEpoch += 1; await page.evaluate(({ projectRef, userId, farmId, changedAt }) => { const scope = `${projectRef}:${userId}:${farmId}`; const fenceKey = `farm-rx-revocation-fence:v1:${scope}`; const ledgerKey = `farm-rx-revocation-generation:v1:${scope}`; const prior = JSON.parse(localStorage.getItem(fenceKey) ?? 'null') as { generation?: number; serverEpoch?: number }; const generation = Number(prior.generation ?? 1) + 1; const serverEpoch = Number(prior.serverEpoch ?? 1) + 1; const token = 'soil-rx-browser-epoch-change-0001'; localStorage.setItem(ledgerKey, JSON.stringify({ version: 2, generation, token, serverEpoch, changedAt })); localStorage.setItem(fenceKey, JSON.stringify({ version: 2, generation, token, serverEpoch, revoked: false, changedAt })) }, { projectRef: project, userId: user, farmId: farm, changedAt: now }) }; return json({ Key: path }) }
    if (state && request.method() === 'DELETE' && url.pathname === '/storage/v1/object/soil-test-reports') { const body = request.postDataJSON() as { prefixes?: string[] }; const paths = body.prefixes ?? []; if (state.failStorageRemovals > 0) { state.failStorageRemovals -= 1; state.writes.push(`storage:remove:rejected:${paths.join(',')}`); return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'storage cleanup failed' }) }) }; for (const path of paths) state.uploaded.delete(path); state.writes.push(`storage:remove:${paths.join(',')}`); return json(paths.map((name) => ({ name }))) }
    const restWriteKey = table ? `${request.method()} ${table}` : ''
    const rejectUnexpectedRestWrite = () => route.fulfill({ status: 405, contentType: 'application/json', headers: cors, body: JSON.stringify({ message: 'REST table write rejected by Soil Rx proof' }) })
    if (table && request.method() !== 'GET' && !allowedSoilRestWrites.has(restWriteKey)) {
      const attempt = restWriteKey
      state?.protectedWriteAttempts.push(attempt)
      unexpected.push(attempt)
      return rejectUnexpectedRestWrite()
    }
    if (table === 'farms') { const row = { id: farm, name: 'Prairie View', share_with_rep: false, created_by: user, created_at: now, updated_at: now }; return json(url.searchParams.has('id') ? row : [row]) }
    if (table === 'farm_memberships') return json({ farm_id: farm, user_id: user, role: readOnly ? 'read_only' : 'owner', status: 'active', can_view_financials: !readOnly })
    if (table === 'farm_rep_access') return json(null)
    if (table === 'entities') return json([{ id: entity, farm_id: farm, name: 'Prairie View LLC', entity_type: 'llc', is_active: true, created_at: now, updated_at: now }])
    if (table === 'fields') return json([
      { id: field, farm_id: farm, operating_entity_id: entity, name: 'North Forty', legal_description: null, county: null, state: 'IL', total_acres: 40, fsa_farm_number: null, fsa_tract_number: null, soil_productivity_index: null, latitude: null, longitude: null, location_source: null, is_active: true, created_at: now, updated_at: now },
      { id: secondField, farm_id: farm, operating_entity_id: entity, name: 'South Forty', legal_description: null, county: null, state: 'IL', total_acres: 40, fsa_farm_number: null, fsa_tract_number: null, soil_productivity_index: null, latitude: null, longitude: null, location_source: null, is_active: true, created_at: now, updated_at: now },
    ])
    if (protectedTables.includes((table ?? '') as ProtectedTable)) return json([])
    if (state && table === 'soil_test_attachments') {
      if (request.method() === 'POST') { const body = request.postDataJSON() as Record<string, unknown>; const saved = { ...body, created_by: user, created_at: now }; state.attachments = [...state.attachments.filter((row) => row.test_id !== saved.test_id), saved]; state.writes.push(`soil_test_attachments:insert:${saved.test_id}`); if (state.failAttachmentMetadata > 0) { state.failAttachmentMetadata -= 1; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'metadata response was lost' }) }) }; return json(saved) }
      const wanted = url.searchParams.get('test_id')?.replace(/^eq\./, ''); return json(state.attachments.filter((row) => !wanted || row.test_id === wanted))
    }
    if (state && table === 'soil_tests') {
      if (request.method() === 'POST') { if (state.failSoilSaves > 0) { state.failSoilSaves -= 1; state.writes.push('soil_tests:rejected'); return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ message: 'validation failed' }) }) }; const body = request.postDataJSON() as Record<string, unknown>; const saved = { ...body, created_by: user, created_at: now, updated_at: now }; state.tests = [...state.tests.filter((row) => row.id !== saved.id), saved]; state.writes.push(`soil_tests:upsert:${saved.id}`); return json(saved) }
      if (request.method() === 'DELETE') { const wanted = url.searchParams.get('id')?.replace(/^eq\./, ''); const deleted = state.tests.filter((row) => row.id === wanted).map((row) => ({ id: row.id })); state.tests = state.tests.filter((row) => row.id !== wanted); state.attachments = state.attachments.filter((row) => row.test_id !== wanted); state.writes.push(`soil_tests:delete:${wanted}`); return json(deleted) }
      const wantedField = url.searchParams.get('field_id')?.replace(/^eq\./, ''); return json(state.tests.filter((row) => !wantedField || row.field_id === wantedField))
    }
    if (table === 'soil_test_attachments') return json([{ id: attachmentId, farm_id: farm, field_id: field, test_id: testId, storage_path: reportPath, original_filename: 'lab-report.pdf', mime_type: 'application/pdf', size_bytes: 1024, created_by: user, created_at: now }])
    if (table === 'soil_tests') return json([{ id: testId, farm_id: farm, field_id: field, sample_date: '2026-11-01', lab_name: 'Old Lab', ph: 6.4, organic_matter_pct: null, cec_meq_100g: null, phosphorus_ppm: null, potassium_ppm: null, calcium_ppm: null, magnesium_ppm: null, sulfur_ppm: null, base_saturation_calcium_pct: null, base_saturation_magnesium_pct: null, base_saturation_potassium_pct: null, base_saturation_sodium_pct: null, base_saturation_hydrogen_pct: null, boron_ppm: null, chloride_ppm: null, copper_ppm: null, iron_ppm: null, manganese_ppm: null, molybdenum_ppm: null, zinc_ppm: null, created_by: user, created_at: now, updated_at: now }])
    unexpected.push(`${request.method()} ${url.pathname}`); await route.abort('blockedbyclient')
  })
  return unexpected
}
async function open(page: Page, readOnly = false, state?: WriteState) { await page.addInitScript(({ key, value, intentKey }) => { localStorage.setItem(key, JSON.stringify(value)); localStorage.setItem(intentKey, JSON.stringify({ version: 1, nonce: 'soil-rx', phase: 'accepted', userId: value.user.id, sessionLineage: 'soil-rx-e2e', startedAtMs: Date.now() })) }, { key: `farm-rx-auth:${project}`, intentKey: `farm-rx-auth-intent:v1:${project}`, value: session() }); const unexpected = await mock(page, readOnly, state); await page.goto('/soil-rx'); await expect(page.getByRole('heading', { name: 'Soil Rx' })).toBeVisible(); return unexpected }

const soilRxSpecPath = fileURLToPath(import.meta.url)
const earlyReadStubMarkers = ["if (table === 'farms')", "if (table === 'farm_memberships')", "if (table === 'farm_rep_access')", "if (table === 'entities')", "if (table === 'fields')"]
const restWriteGate = "if (table && request.method() !== 'GET' && !allowedSoilRestWrites.has(restWriteKey))"
const restWriteRecorder = 'state?.protectedWriteAttempts.push(attempt)\n      unexpected.push(attempt)\n      return rejectUnexpectedRestWrite()'
function assertEarlyRestWriteGuard(source: string) {
  const gateIndex = source.indexOf(restWriteGate)
  expect(gateIndex, 'missing exact fail-closed REST method gate').toBeGreaterThanOrEqual(0)
  const earlyStubRegionEnd = source.indexOf("if (protectedTables.includes((table ?? '') as ProtectedTable))", gateIndex)
  expect(earlyStubRegionEnd, 'missing end of early REST read-stub region').toBeGreaterThan(gateIndex)
  const earlyStubRegion = source.slice(gateIndex, earlyStubRegionEnd)
  for (const marker of earlyReadStubMarkers) expect(earlyStubRegion, `missing early REST read stub ${marker}`).toContain(marker)
  expect(source).toContain("const allowedSoilRestWrites = new Set(['POST soil_tests', 'DELETE soil_tests', 'POST soil_test_attachments'])")
  const recorderIndex = source.indexOf(restWriteRecorder, gateIndex)
  expect(recorderIndex, 'missing exact record-before-refusal sequence').toBeGreaterThan(gateIndex)
  expect(source.indexOf('return rejectUnexpectedRestWrite()', recorderIndex), 'REST rejection must follow recording').toBeGreaterThan(recorderIndex)
}
function expectRequestGuardMutationRejected(name: string, source: string) {
  expect(source, `${name} did not alter request-guard source`).not.toBe(readFileSync(soilRxSpecPath, 'utf8'))
  expect(() => assertEarlyRestWriteGuard(source), `${name} mutation survived request-guard proof`).toThrow()
}

test.use({ serviceWorkers: 'block' })

test('Soil Rx early REST request guard rejects controlled source mutations', () => {
  const source = readFileSync(soilRxSpecPath, 'utf8')
  assertEarlyRestWriteGuard(source)
  const gateBlock = `    ${restWriteGate} {\n      const attempt = restWriteKey\n      ${restWriteRecorder}\n    }\n`
  const mutations: Array<[string, string]> = [
    ['move method gate after early stubs', source.replace(gateBlock, '').replace("    if (protectedTables.includes((table ?? '') as ProtectedTable))", `${gateBlock}    if (protectedTables.includes((table ?? '') as ProtectedTable))`)],
    ['omit fields early stub', source.replace("if (table === 'fields')", "if (table === 'soil_fields')")],
    ['allow DELETE', source.replace("request.method() !== 'GET'", "request.method() !== 'GET' && request.method() !== 'DELETE'")],
    ['broaden Soil write exception', source.replace('allowedSoilRestWrites.has(restWriteKey)', 'allowedSoilRestWrites.has(table)')],
    ['drop request recording', source.replace('state?.protectedWriteAttempts.push(attempt)\n      ', '')],
    ['fulfill before refusal', source.replace(restWriteRecorder, 'return rejectUnexpectedRestWrite()\n      state?.protectedWriteAttempts.push(attempt)\n      unexpected.push(attempt)')],
  ]
  expect(mutations).toHaveLength(6)
  for (const [name, mutation] of mutations) expectRequestGuardMutationRejected(name, mutation)
})

test('Soil Rx records and rejects POST PATCH DELETE to the early fields stub without changing protected state', async ({ page }) => {
  const state = historyState(); const protectedBefore = protectedSnapshot(state); const writesBefore = JSON.stringify(state.writes); const unexpected = await open(page, false, state)
  const responses = await page.evaluate(async ({ projectRef, fieldId }) => Promise.all(['POST', 'PATCH', 'DELETE'].map(async (method) => {
    const response = await fetch(`https://${projectRef}.supabase.co/rest/v1/fields?id=eq.${fieldId}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'DELETE' ? undefined : '{}' })
    return { method, status: response.status, body: await response.json() }
  })), { projectRef: project, fieldId: field })
  expect(responses).toEqual(['POST', 'PATCH', 'DELETE'].map((method) => ({ method, status: 405, body: { message: 'REST table write rejected by Soil Rx proof' } })))
  expect(state.protectedWriteAttempts).toEqual(['POST fields', 'PATCH fields', 'DELETE fields'])
  expect(unexpected).toEqual(['POST fields', 'PATCH fields', 'DELETE fields'])
  expect(protectedSnapshot(state)).toBe(protectedBefore)
  expect(JSON.stringify(state.writes)).toBe(writesBefore)
})

test('Soil Rx is phone-safe and shows newest history, partial measurements, privacy, and read-only locks', async ({ page }, testInfo) => {
  const ownerState = historyState(); ownerState.tests[0]!.ph = 6.4; ownerState.tests[0]!.organic_matter_pct = 3.1; ownerState.tests[0]!.cec_meq_100g = 14.2; ownerState.tests[0]!.base_saturation_calcium_pct = 68; ownerState.tests[0]!.base_saturation_potassium_pct = 0; const ownerProtectedBefore = protectedSnapshot(ownerState); const ownerUnexpected = await open(page, false, ownerState); await expect(page.getByText('Old Lab')).toBeVisible(); const missingMeasurement = page.locator('.soil-test-details').getByText('Not reported').first(); await expect(missingMeasurement).toBeVisible(); const guide = page.getByRole('region', { name: 'Understand this report' }); const guideValue = (label: string) => guide.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=..').locator('dd'); await expect(guide).toContainText('not agronomic advice, target ranges, or a fertilizer recommendation'); await expect(guideValue('pH')).toContainText('Lab result: 6.4'); await expect(guideValue('pH')).not.toContainText('%'); await expect(guideValue('Organic matter')).toContainText('Lab result: 3.1 %'); await expect(guideValue('CEC')).toContainText('Lab result: 14.2 meq/100g'); await expect(guideValue('Base saturation')).toContainText('Calcium: 68%'); await expect(guideValue('Base saturation')).toContainText('Magnesium: Not reported'); await expect(guideValue('Base saturation')).toContainText('Potassium: 0%'); await expect(guideValue('Base saturation')).toContainText('Sodium: Not reported'); await expect(guideValue('Base saturation')).toContainText('Hydrogen: Not reported'); await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate((node) => node.clientWidth));
  const summary = page.locator('.soil-test-summary').filter({ hasText: 'Old Lab' }); await expect(summary).toHaveAttribute('aria-expanded', 'true'); await summary.click(); await expect(summary).toHaveAttribute('aria-expanded', 'false'); await expect(missingMeasurement).toBeHidden(); await summary.click(); await expect(summary).toHaveAttribute('aria-expanded', 'true')
  const formField = page.locator('.soil-rx-form select'); await expect(formField).toHaveValue(field); await page.getByRole('button', { name: /South Forty/ }).click(); await expect(formField).toHaveValue(secondField); await expect(page.getByText('No soil tests saved for this field yet.')).toBeVisible(); await page.getByRole('button', { name: /North Forty/ }).click(); await expect(formField).toHaveValue(field); await formField.selectOption(secondField); await expect(page.getByRole('heading', { name: 'South Forty history' })).toBeVisible(); await formField.selectOption(field); await expect(page.getByRole('heading', { name: 'North Forty history' })).toBeVisible()
  await page.evaluate(() => { window.open = (url) => { document.body.dataset.openedSoilReport = String(url); return null } }); await page.getByRole('button', { name: 'Open lab report' }).click(); await expect(page.locator('body')).toHaveAttribute('data-opened-soil-report', /soil-test-reports/)
  if (testInfo.project.name === 'chromium-phone') { await page.getByRole('button', { name: 'More' }).click(); await page.getByRole('region', { name: 'More Farm Rx destinations' }).getByRole('link', { name: 'Privacy' }).click() } else await page.getByRole('link', { name: 'Privacy' }).click();
  await expect(page.getByText('Grain, financial, and Soil Rx information stays private')).toBeVisible(); expect(ownerUnexpected).toEqual([]); expectProtectedNonwrite(ownerState, ownerProtectedBefore)
  const readOnlyState = historyState(); const readOnlyProtectedBefore = protectedSnapshot(readOnlyState); const readOnlyUnexpected = await open(page, true, readOnlyState); await expect(page.getByRole('heading', { name: 'Add a soil test' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Save soil test' })).toHaveCount(0); await expect(page.getByText('Old Lab')).toBeVisible(); await expect(page.getByRole('button', { name: 'Open lab report' })).toBeEnabled(); expect(readOnlyUnexpected).toEqual([]); expectProtectedNonwrite(readOnlyState, readOnlyProtectedBefore)
  if (testInfo.project.name === 'chromium-phone') await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate((node) => node.clientWidth));
})

test('Soil Rx saves text and attachments atomically without unrelated writes', async ({ page }) => {
  const state = writeState(); state.tests = [soilRow(testId, 'Old Lab', '2026-11-01')]
  const protectedBefore = protectedSnapshot(state)
  const unexpected = await open(page, false, state)
  await page.getByLabel('Lab name').fill('Newest Text Lab')
  await page.getByLabel('Sample date').fill('2027-01-14')
  await page.getByRole('button', { name: 'Save soil test' }).click()
  await expect(page.locator('.save-success')).toHaveText('Soil test saved.')
  const newest = page.locator('.soil-test-summary').filter({ hasText: 'Newest Text Lab' })
  await expect(newest).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.soil-test-summary').filter({ hasText: 'Old Lab' })).toHaveAttribute('aria-expanded', 'false')
  const textWrites = state.writes.filter((entry) => entry.startsWith('soil_tests:upsert:'))
  expect(textWrites).toHaveLength(1)

  await page.getByLabel('Lab name').fill('Attached Lab')
  await page.getByLabel('Sample date').fill('2027-01-15')
  await page.getByLabel(/Lab report/).setInputFiles({ name: 'attached.pdf', mimeType: 'application/pdf', buffer: Buffer.from('soil report') })
  await page.getByRole('button', { name: 'Save soil test' }).click()
  await expect(page.locator('.save-success')).toHaveText('Soil test saved.')
  await expect(page.locator('.soil-test-summary').filter({ hasText: 'Attached Lab' })).toHaveAttribute('aria-expanded', 'true')
  expect(state.writes.some((entry) => entry.startsWith('storage:upload:'))).toBe(true)
  expect(state.writes.some((entry) => entry.startsWith('soil_test_attachments:insert:'))).toBe(true)

  state.failAttachmentMetadata = 1
  await page.getByLabel('Lab name').fill('Retry Same Draft')
  await page.getByLabel('Sample date').fill('2027-01-16')
  await page.getByLabel(/Lab report/).setInputFiles({ name: 'retry.pdf', mimeType: 'application/pdf', buffer: Buffer.from('retry report') })
  const beforeFailure = state.writes.length
  await page.getByRole('button', { name: 'Save soil test' }).click()
  await expect(page.locator('.auth-error')).toContainText('could not save this soil test')
  const failedWrites = state.writes.slice(beforeFailure)
  const failedId = failedWrites.find((entry) => entry.startsWith('soil_tests:upsert:'))?.split(':').at(-1)
  expect(failedWrites).toContain(`soil_tests:delete:${failedId}`)
  expect(failedWrites.some((entry) => entry.startsWith('storage:remove:'))).toBe(true)
  expect(state.tests.some((row) => row.id === failedId)).toBe(false)
  expect([...state.uploaded].some((path) => path.split('/')[2] === failedId)).toBe(false)
  await page.getByRole('button', { name: 'Save soil test' }).click()
  await expect(page.locator('.save-success')).toHaveText('Soil test saved.')
  const retryIds = state.writes.filter((entry) => entry.startsWith('soil_tests:upsert:')).map((entry) => entry.split(':').at(-1)).filter((id) => id === failedId)
  expect(retryIds).toHaveLength(2)
  expect(state.tests.filter((row) => row.id === failedId)).toHaveLength(1)

  state.changeEpochAfterUpload = true
  await page.getByLabel('Lab name').fill('Context Retry')
  await page.getByLabel('Sample date').fill('2027-01-17')
  await page.getByLabel(/Lab report/).setInputFiles({ name: 'context.pdf', mimeType: 'application/pdf', buffer: Buffer.from('context report') })
  const beforeContextFailure = state.writes.length
  await page.getByRole('button', { name: 'Save soil test' }).click()
  await expect(page.locator('.auth-error')).toContainText('could not save this soil test')
  const contextFailureWrites = state.writes.slice(beforeContextFailure)
  const contextId = contextFailureWrites.find((entry) => entry.startsWith('soil_tests:upsert:'))?.split(':').at(-1)
  expect(contextFailureWrites.some((entry) => entry.startsWith('soil_test_attachments:insert:'))).toBe(false)
  expect(state.tests.some((row) => row.id === contextId)).toBe(true)
  expect([...state.uploaded].some((path) => path.split('/')[2] === contextId)).toBe(true)
  state.changeEpochAfterUpload = false
  await page.getByRole('button', { name: 'Save soil test' }).click()
  await expect(page.locator('.save-success')).toHaveText('Soil test saved.')
  const contextRetryWrites = state.writes.slice(beforeContextFailure)
  expect(contextRetryWrites).toContain(`soil_tests:delete:${contextId}`)
  expect(contextRetryWrites.some((entry) => entry.startsWith('storage:remove:'))).toBe(true)
  expect(contextRetryWrites.filter((entry) => entry === `soil_tests:upsert:${contextId}`)).toHaveLength(2)
  expect(state.tests.filter((row) => row.id === contextId)).toHaveLength(1)
  expectProtectedNonwrite(state, protectedBefore)
  expect(unexpected).toEqual([])
})

test('Soil Rx offline replay surfaces guarded Retry and Dismiss', async ({ page, context }) => {
  const state = writeState(); const protectedBefore = protectedSnapshot(state); const unexpected = await open(page, false, state)
  await context.setOffline(true)
  await page.getByLabel('Lab name').fill('Offline Lab')
  await page.getByLabel('Sample date').fill('2027-01-15')
  await page.getByRole('button', { name: 'Save soil test' }).click()
  await expect(page.locator('.save-success')).toContainText('Saved on this device')
  expect(state.writes.filter((entry) => entry.startsWith('soil_tests:'))).toEqual([])
  state.failSoilSaves = 1
  await context.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online')))
  const attention = page.getByRole('region', { name: 'Saves that need attention' })
  await expect(attention).toBeVisible()
  await expect(attention.getByRole('button', { name: 'Retry' })).toBeVisible()
  await attention.getByRole('button', { name: 'Retry' }).click()
  await expect(attention).toBeHidden()
  await expect(page.getByText('Offline Lab')).toBeVisible()

  await context.setOffline(true)
  await page.getByLabel('Lab name').fill('Dismiss Lab')
  await page.getByLabel('Sample date').fill('2027-01-16')
  await page.getByRole('button', { name: 'Save soil test' }).click()
  await expect(page.locator('.save-success')).toContainText('Saved on this device')
  state.failSoilSaves = 1
  await context.setOffline(false); await page.evaluate(() => window.dispatchEvent(new Event('online')))
  await expect(attention).toBeVisible()
  await attention.getByRole('button', { name: 'Dismiss' }).click()
  await attention.getByRole('button', { name: 'Yes, dismiss' }).click()
  await expect(attention).toBeHidden()
  expectProtectedNonwrite(state, protectedBefore); expect(unexpected).toEqual([])
})

test('Soil Rx visibly retains failed attachment cleanup until matching-context recovery', async ({ page }) => {
  const state = writeState(); state.failAttachmentMetadata = 1; state.failStorageRemovals = 1
  const protectedBefore = protectedSnapshot(state); const unexpected = await open(page, false, state)
  await page.getByLabel('Lab name').fill('Cleanup Recovery Lab')
  await page.getByLabel('Sample date').fill('2027-01-18')
  await page.getByLabel(/Lab report/).setInputFiles({ name: 'cleanup.pdf', mimeType: 'application/pdf', buffer: Buffer.from('cleanup report') })
  await page.getByRole('button', { name: 'Save soil test' }).click()
  await expect(page.locator('.auth-error')).toContainText('could not save this soil test')
  await expect(page.locator('.sync-notice.blocked')).toContainText('needs attention. Nothing was deleted')
  await expect(page.locator('.sync-notice.blocked').getByRole('button', { name: 'Try again' })).toBeVisible()
  const failedId = state.writes.find((entry) => entry.startsWith('soil_tests:upsert:'))?.split(':').at(-1)
  const failedPath = [...state.uploaded].find((path) => path.split('/')[2] === failedId)
  expect(failedId).toBeTruthy(); expect(failedPath).toBeTruthy()
  expect(state.tests.some((row) => row.id === failedId)).toBe(true)
  const cleanupKey = `farm-rx-soil-rx-cleanup:v1:${project}:${user}`
  const retained = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), cleanupKey) as { version: number; entries: Array<{ kind: string; testId?: string; paths?: string[] }> }
  expect(retained.version).toBe(2)
  expect(retained.entries).toEqual([expect.objectContaining({ kind: 'attachment_save', testId: failedId, paths: [failedPath] })])
  expectProtectedNonwrite(state, protectedBefore); expect(unexpected).toEqual([])

  await page.locator('.sync-notice.blocked').getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('.sync-notice.synced')).toHaveText('All changes synced.')
  expect(state.uploaded.has(failedPath!)).toBe(false)
  const drained = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), cleanupKey) as { version: number; entries: unknown[] }
  expect(drained).toEqual({ version: 2, entries: [] })
  expectProtectedNonwrite(state, protectedBefore); expect(unexpected).toEqual([])
})

test('a denied actor cannot open Soil Rx or issue a write', async ({ page }) => {
  const state = writeState()
  const protectedBefore = protectedSnapshot(state)
  await page.addInitScript(({ key, value, intentKey }) => { localStorage.setItem(key, JSON.stringify(value)); localStorage.setItem(intentKey, JSON.stringify({ version: 1, nonce: 'soil-rx-denied', phase: 'accepted', userId: value.user.id, sessionLineage: 'soil-rx-e2e', startedAtMs: Date.now() })) }, { key: `farm-rx-auth:${project}`, intentKey: `farm-rx-auth-intent:v1:${project}`, value: session() })
  const unexpected = await mock(page, false, state, true)
  await page.goto('/soil-rx')
  await expect(page.getByText('You do not have permission to make that change.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Soil Rx' })).toHaveCount(0)
  expect(state.writes).toEqual([])
  expectProtectedNonwrite(state, protectedBefore); expect(unexpected).toEqual([])
})
