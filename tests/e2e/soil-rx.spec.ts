import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expect, test, type Locator, type Page, type Route } from '@playwright/test'

const project = 'agvsozfbstpekuqxpqjr'; const user = '00000000-0000-4000-8000-000000000001'; const farm = '00000000-0000-4000-8000-000000000010'; const entity = '00000000-0000-4000-8000-000000000011'; const field = '00000000-0000-4000-8000-000000000012'; const secondField = '00000000-0000-4000-8000-000000000013'; const testId = '00000000-0000-4000-8000-000000000021'; const attachmentId = '00000000-0000-4000-8000-000000000022'; const reportPath = `${farm}/${field}/${testId}/lab-report.pdf`; const now = '2027-01-15T12:00:00.000Z'
const protectedTables = ['farms', 'farm_memberships', 'farm_rep_access', 'entities', 'fields', 'arrangements', 'crop_assignments', 'commodities', 'notifications'] as const
type ProtectedTable = typeof protectedTables[number]
const allowedSoilRestWrites = new Set(['POST soil_tests', 'DELETE soil_tests', 'POST soil_test_attachments'])
type WriteState = { tests: Array<Record<string, unknown>>; attachments: Array<Record<string, unknown>>; fieldRows: Array<Record<string, unknown>>; cropAssignments: Array<Record<string, unknown>>; commodities: Array<Record<string, unknown>>; writes: string[]; uploaded: Set<string>; failHarvestRead: boolean; failSoilSaves: number; failAttachmentMetadata: number; failStorageRemovals: number; failTerminalAbsenceChecks: number; loseStorageRemoveResponses: number; loseSoilDeleteResponses: number; changeEpochAfterUpload: boolean; accessEpoch: number; protectedWriteAttempts: string[]; protectedState: Record<ProtectedTable, string[]> }
function fieldRow(id: string, name: string, isActive = true) { return { id, farm_id: farm, operating_entity_id: entity, name, legal_description: null, county: null, state: 'IL', total_acres: 40, fsa_farm_number: null, fsa_tract_number: null, soil_productivity_index: null, latitude: null, longitude: null, location_source: null, is_active: isActive, created_at: now, updated_at: now } }
function writeState(): WriteState { return { tests: [], attachments: [], fieldRows: [fieldRow(field, 'North Forty'), fieldRow(secondField, 'South Forty')], cropAssignments: [{ id: '00000000-0000-4000-8000-000000000031', farm_id: farm, field_id: field, crop_year: 2026, commodity_id: 'corn', planting_sequence: 1, planted_acres: 40, variety: null, planting_date: null, harvest_date: '2026-10-20', harvested_bushels: 8000, expected_yield_per_acre: null, expected_price_per_bu: null, actual_price_per_bu: null, notes: null, created_at: now, updated_at: now }], commodities: [{ id: 'corn', name: 'Corn', crop_family: 'corn', traits: {}, is_active: true, created_at: now, updated_at: now }], writes: [], uploaded: new Set(), failHarvestRead: false, failSoilSaves: 0, failAttachmentMetadata: 0, failStorageRemovals: 0, failTerminalAbsenceChecks: 0, loseStorageRemoveResponses: 0, loseSoilDeleteResponses: 0, changeEpochAfterUpload: false, accessEpoch: 1, protectedWriteAttempts: [], protectedState: { farms: ['protected-farm-byte'], farm_memberships: ['protected-membership-byte'], farm_rep_access: ['protected-rep-access-byte'], entities: ['protected-entity-byte'], fields: ['protected-field-byte'], arrangements: ['protected-arrangement-byte'], crop_assignments: ['protected-crop-byte'], commodities: ['protected-commodity-byte'], notifications: ['protected-notification-byte'] } } }
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
    if (state && url.pathname.endsWith('/rpc/verify_soil_test_absent')) { const body = request.postDataJSON() as { p_farm_id?: string; p_test_id?: string }; state.writes.push(`soil_tests:verify-absent:${body.p_test_id}`); return json(body.p_farm_id === farm && !state.tests.some((row) => row.farm_id === body.p_farm_id && row.id === body.p_test_id)) }
    if (state && url.pathname.endsWith('/rpc/verify_soil_report_objects_absent')) { const body = request.postDataJSON() as { p_farm_id?: string; p_paths?: string[] }; const paths = body.p_paths ?? []; state.writes.push(`storage:verify-absent:${paths.join(',')}`); const ownsEveryPath = body.p_farm_id === farm && paths.every((path) => state.tests.some((row) => row.farm_id === farm && row.field_id === path.split('/')[1] && row.id === path.split('/')[2])); if (!ownsEveryPath) return route.fulfill({ status: 403, contentType: 'application/json', headers: cors, body: JSON.stringify({ code: '42501', message: 'soil report path is not owned by the current farm test' }) }); return json(paths.filter((path) => !state.uploaded.has(path)).map((name) => ({ name }))) }
    if (state && url.pathname.endsWith('/rpc/verify_soil_report_cleanup_terminal_absence')) { const body = request.postDataJSON() as { p_farm_id?: string; p_field_id?: string; p_test_id?: string; p_paths?: string[] }; const paths = body.p_paths ?? []; state.writes.push(`storage:verify-terminal-absence:${paths.join(',')}`); if (state.failTerminalAbsenceChecks > 0) { state.failTerminalAbsenceChecks -= 1; return route.fulfill({ status: 503, contentType: 'application/json', headers: cors, body: JSON.stringify({ message: 'terminal absence verification failed' }) }) }; const exact = body.p_farm_id === farm && paths.length > 0 && new Set(paths).size === paths.length && paths.every((path) => path.split('/').length === 4 && path.split('/')[0] === farm && path.split('/')[1] === body.p_field_id && path.split('/')[2] === body.p_test_id); if (!exact) return route.fulfill({ status: 400, contentType: 'application/json', headers: cors, body: JSON.stringify({ code: '22023', message: 'invalid Soil report terminal cleanup verification request' }) }); if (state.tests.some((row) => row.farm_id === body.p_farm_id && row.id === body.p_test_id) || paths.some((path) => state.uploaded.has(path))) return route.fulfill({ status: 403, contentType: 'application/json', headers: cors, body: JSON.stringify({ code: '42501', message: 'soil report terminal cleanup state still exists' }) }); return json(paths.map((name) => ({ name }))) }
    if (/\/rpc\/(program_due_generation_status|service_due_generation_status)$/.test(url.pathname)) return json({ has_due: false, task_needed: false, notification_needed: false, local_date: '2027-01-15' })
    if (url.pathname.includes('/rpc/operational_integrity_capability_probe')) return json(true)
    if (/\/rpc\/(can_access_farm|is_active_farm_member|can_edit_farm|can_manage_farm|can_read_private_financials|has_explicit_rep_access)$/.test(url.pathname)) { const name = url.pathname.split('/').at(-1); return json(denied ? false : name === 'has_explicit_rep_access' ? false : name === 'can_edit_farm' || name === 'can_manage_farm' || name === 'can_read_private_financials' ? !readOnly : true) }
    if (url.pathname === `/storage/v1/object/sign/soil-test-reports/${reportPath}`) return json({ signedURL: `/storage/v1/object/sign/soil-test-reports/${reportPath}?token=soil-rx-e2e` })
    if (state && request.method() === 'POST' && url.pathname.startsWith('/storage/v1/object/soil-test-reports/')) { const path = decodeURIComponent(url.pathname.slice('/storage/v1/object/soil-test-reports/'.length)); state.uploaded.add(path); state.writes.push(`storage:upload:${path}`); if (state.changeEpochAfterUpload) { state.accessEpoch += 1; await page.evaluate(({ projectRef, userId, farmId, changedAt }) => { const scope = `${projectRef}:${userId}:${farmId}`; const fenceKey = `farm-rx-revocation-fence:v1:${scope}`; const ledgerKey = `farm-rx-revocation-generation:v1:${scope}`; const prior = JSON.parse(localStorage.getItem(fenceKey) ?? 'null') as { generation?: number; serverEpoch?: number }; const generation = Number(prior.generation ?? 1) + 1; const serverEpoch = Number(prior.serverEpoch ?? 1) + 1; const token = 'soil-rx-browser-epoch-change-0001'; localStorage.setItem(ledgerKey, JSON.stringify({ version: 2, generation, token, serverEpoch, changedAt })); localStorage.setItem(fenceKey, JSON.stringify({ version: 2, generation, token, serverEpoch, revoked: false, changedAt })) }, { projectRef: project, userId: user, farmId: farm, changedAt: now }) }; return json({ Key: path }) }
    if (state && request.method() === 'DELETE' && url.pathname === '/storage/v1/object/soil-test-reports') { const body = request.postDataJSON() as { prefixes?: string[] }; const paths = body.prefixes ?? []; if (state.failStorageRemovals > 0) { state.failStorageRemovals -= 1; state.writes.push(`storage:remove:rejected:${paths.join(',')}`); return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'storage cleanup failed' }) }) }; const removed = paths.filter((path) => state.uploaded.delete(path)); state.writes.push(`storage:remove:${paths.join(',')}`); if (state.loseStorageRemoveResponses > 0) { state.loseStorageRemoveResponses -= 1; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Storage remove response was lost' }) }) }; return json(removed.map((name) => ({ name }))) }
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
    if (table === 'fields') return json(state?.fieldRows ?? [fieldRow(field, 'North Forty'), fieldRow(secondField, 'South Forty')])
    if (table === 'crop_assignments' && state?.failHarvestRead) return route.fulfill({ status: 503, contentType: 'application/json', headers: cors, body: JSON.stringify({ message: 'harvest query failed' }) })
    if (table === 'crop_assignments') return json(state?.cropAssignments ?? [])
    if (table === 'commodities') return json(state?.commodities ?? [])
    if (protectedTables.includes((table ?? '') as ProtectedTable)) return json([])
    if (state && table === 'soil_test_attachments') {
      if (request.method() === 'POST') { const body = request.postDataJSON() as Record<string, unknown>; const saved = { ...body, created_by: user, created_at: now }; state.attachments = [...state.attachments.filter((row) => row.test_id !== saved.test_id), saved]; state.writes.push(`soil_test_attachments:insert:${saved.test_id}`); if (state.failAttachmentMetadata > 0) { state.failAttachmentMetadata -= 1; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'metadata response was lost' }) }) }; return json(saved) }
      const wanted = url.searchParams.get('test_id')?.replace(/^eq\./, ''); return json(state.attachments.filter((row) => !wanted || row.test_id === wanted))
    }
    if (state && table === 'soil_tests') {
      if (request.method() === 'POST') { if (state.failSoilSaves > 0) { state.failSoilSaves -= 1; state.writes.push('soil_tests:rejected'); return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ message: 'validation failed' }) }) }; const body = request.postDataJSON() as Record<string, unknown>; const saved = { ...body, created_by: user, created_at: now, updated_at: now }; state.tests = [...state.tests.filter((row) => row.id !== saved.id), saved]; state.writes.push(`soil_tests:upsert:${saved.id}`); return json(saved) }
      if (request.method() === 'DELETE') { const wanted = url.searchParams.get('id')?.replace(/^eq\./, ''); const deleted = state.tests.filter((row) => row.id === wanted).map((row) => ({ id: row.id })); state.tests = state.tests.filter((row) => row.id !== wanted); state.attachments = state.attachments.filter((row) => row.test_id !== wanted); state.writes.push(`soil_tests:delete:${wanted}`); if (state.loseSoilDeleteResponses > 0) { state.loseSoilDeleteResponses -= 1; return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Soil DELETE response was lost' }) }) }; return json(deleted) }
      const wantedField = url.searchParams.get('field_id')?.replace(/^eq\./, ''); return json(state.tests.filter((row) => !wantedField || row.field_id === wantedField))
    }
    if (table === 'soil_test_attachments') return json([{ id: attachmentId, farm_id: farm, field_id: field, test_id: testId, storage_path: reportPath, original_filename: 'lab-report.pdf', mime_type: 'application/pdf', size_bytes: 1024, created_by: user, created_at: now }])
    if (table === 'soil_tests') return json([{ id: testId, farm_id: farm, field_id: field, sample_date: '2026-11-01', lab_name: 'Old Lab', ph: 6.4, organic_matter_pct: null, cec_meq_100g: null, phosphorus_ppm: null, potassium_ppm: null, calcium_ppm: null, magnesium_ppm: null, sulfur_ppm: null, base_saturation_calcium_pct: null, base_saturation_magnesium_pct: null, base_saturation_potassium_pct: null, base_saturation_sodium_pct: null, base_saturation_hydrogen_pct: null, boron_ppm: null, chloride_ppm: null, copper_ppm: null, iron_ppm: null, manganese_ppm: null, molybdenum_ppm: null, zinc_ppm: null, created_by: user, created_at: now, updated_at: now }])
    unexpected.push(`${request.method()} ${url.pathname}`); await route.abort('blockedbyclient')
  })
  return unexpected
}
async function open(page: Page, readOnly = false, state?: WriteState) { await page.addInitScript(({ key, value, intentKey }) => { localStorage.setItem(key, JSON.stringify(value)); localStorage.setItem(intentKey, JSON.stringify({ version: 1, nonce: 'soil-rx', phase: 'accepted', userId: value.user.id, sessionLineage: 'soil-rx-e2e', startedAtMs: Date.now() })) }, { key: `farm-rx-auth:${project}`, intentKey: `farm-rx-auth-intent:v1:${project}`, value: session() }); const unexpected = await mock(page, readOnly, state); await page.goto('/soil-rx'); await expect(page.getByRole('heading', { name: 'Soil Rx' })).toBeVisible(); return unexpected }
async function installReportPopup(page: Page) { await page.evaluate(() => { const popup = { opener: window as Window | null, closed: false, close() { document.body.dataset.closedSoilReport = 'true'; this.closed = true }, location: { replace(url: string) { document.body.dataset.openedSoilReport = String(url); document.body.dataset.soilReportOpenerCleared = String(popup.opener === null) } } }; window.open = () => popup as unknown as Window }) }

const soilRxSpecPath = fileURLToPath(import.meta.url)
const soilRxModulePath = fileURLToPath(new URL('../../src/SoilRxModule.tsx', import.meta.url))
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

function assertSoilReportGuideContract(source: string) {
  expect(source).toContain('Ask your Crop RX agronomist for recommendations specific to your farm.')
  for (const [label, fieldName] of [['Calcium', 'base_saturation_calcium_pct'], ['Magnesium', 'base_saturation_magnesium_pct'], ['Potassium', 'base_saturation_potassium_pct'], ['Sodium', 'base_saturation_sodium_pct'], ['Hydrogen', 'base_saturation_hydrogen_pct']]) expect(source).toContain(`['${label}', test.${fieldName}]`)
  expect(source).toContain("amount === null ? 'Not reported' : `${amount}%`")
}
function assertNutrientRemovalContract(source: string) {
  expect(source).toContain("key={estimate.id}")
  expect(source).toContain("{estimate.crop} · {estimate.cropYear} · planting {estimate.plantingSequence}")
  expect(source).toContain("Farm Rx does not combine years or planting sequences.")
  expect(source).toContain("cornNitrogen: { label: 'Illinois Agronomy Handbook, Nitrogen Management for Corn'")
  expect(source).toContain("soybeanWheatNitrogen: { label: 'University of Delaware Cooperative Extension, Nitrogen Removal by Delaware Crops'")
  expect(source).toContain("nitrogen: 0.60, phosphorus: 0.37, potassium: 0.24")
  expect(source).toContain("soybeans: { nitrogen: 3.44, phosphorus: 0.75, potassium: 1.17 }")
  expect(source).toContain("wheat: { nitrogen: 1.05, phosphorus: 0.47, potassium: 0.30 }")
  expect(source).toContain("{ label: 'N', amount: crop.harvested_bushels * coefficients.nitrogen }")
  expect(source).not.toContain('nitrogenUnavailable')
  expect(source).toContain("Source for corn N (0.60 lb/bu)")
  expect(source).toContain("Source for soybean N (3.44 lb/bu) and wheat N (1.05 lb/bu)")
  expect(source).toContain("stated 0.47 lb/bu actual wheat P₂O₅ removal, not its separately adjusted 0.90 lb/bu maintenance rate")
  expect(source).toContain("available for corn, soybeans, and wheat only")
}
function assertArchivedFieldHistoryContract(source: string) {
  expect(source).toContain("fieldData.fields.map(({ id, name, is_active }) => ({ id, name, isActive: is_active }))")
  expect(source).toContain("const activeFields = fields.filter((field) => field.isActive)")
  expect(source).toContain("!fields.length ? <p className=\"soil-rx-empty\">Add a field before saving a soil test.</p>")
  expect(source).toContain("{field.name}{!field.isActive && ' (Archived)'}")
  expect(source).toContain("? selectedFieldId : nextActiveFields[0]?.id ?? nextFields.find((field) => nextTests.some((test) => test.field_id === field.id))?.id")
  expect(source).toContain("canEdit && selectedField?.isActive")
  expect(source).toContain("{activeFields.map((field) => <option")
  expect(source).toContain('Its Soil Rx history remains available, but new tests can only be added to active fields.')
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

test('Soil Rx report guide rejects referral, field-binding, and unit mutations', () => {
  const source = readFileSync(soilRxModulePath, 'utf8')
  assertSoilReportGuideContract(source)
  const mutations: Array<[string, string]> = [
    ['remove agronomist referral', source.replaceAll('Ask your Crop RX agronomist for recommendations specific to your farm.', '')],
    ['swap calcium and magnesium bindings', source.replace("['Calcium', test.base_saturation_calcium_pct]", "['Calcium', test.base_saturation_magnesium_pct]")],
    ['drop percentage suffix', source.replace("amount === null ? 'Not reported' : `${amount}%`", "amount === null ? 'Not reported' : `${amount}`")],
  ]
  for (const [name, mutation] of mutations) expect(() => assertSoilReportGuideContract(mutation), `${name} mutation survived guide proof`).toThrow()
})

test('Soil Rx nutrient-removal source and assignment-identity guard rejects controlled mutations', () => {
  const source = readFileSync(soilRxModulePath, 'utf8')
  assertNutrientRemovalContract(source)
  const mutations: Array<[string, string]> = [
    ['display key replaces immutable assignment id', source.replace('key={estimate.id}', 'key={`${estimate.crop}-${estimate.bushels}-${estimate.acres}`}')],
    ['remove crop year', source.replace('{estimate.crop} · {estimate.cropYear} · planting {estimate.plantingSequence}', '{estimate.crop} · planting {estimate.plantingSequence}')],
    ['remove planting sequence', source.replace('{estimate.crop} · {estimate.cropYear} · planting {estimate.plantingSequence}', '{estimate.crop} · {estimate.cropYear}')],
    ['omit soybean nitrogen', source.replace('soybeans: { nitrogen: 3.44, phosphorus: 0.75, potassium: 1.17 }', 'soybeans: { phosphorus: 0.75, potassium: 1.17 }')],
    ['swap soybean nitrogen and phosphorus', source.replace('soybeans: { nitrogen: 3.44, phosphorus: 0.75, potassium: 1.17 }', 'soybeans: { nitrogen: 0.75, phosphorus: 3.44, potassium: 1.17 }')],
    ['omit wheat support', source.replace("  wheat: { nitrogen: 1.05, phosphorus: 0.47, potassium: 0.30 },\n", '')],
    ['swap wheat phosphorus and potassium', source.replace('wheat: { nitrogen: 1.05, phosphorus: 0.47, potassium: 0.30 }', 'wheat: { nitrogen: 1.05, phosphorus: 0.30, potassium: 0.47 }')],
    ['replace corn nitrogen coefficient', source.replace('nitrogen: 0.60, phosphorus: 0.37, potassium: 0.24', 'nitrogen: 0.61, phosphorus: 0.37, potassium: 0.24')],
    ['remove corn nitrogen source', source.replace("cornNitrogen: { label: 'Illinois Agronomy Handbook, Nitrogen Management for Corn'", "cornNitrogen: { label: 'Uncited corn nitrogen'" )],
    ['remove soybean and wheat nitrogen source', source.replace("soybeanWheatNitrogen: { label: 'University of Delaware Cooperative Extension, Nitrogen Removal by Delaware Crops'", "soybeanWheatNitrogen: { label: 'Uncited nitrogen'" )],
    ['drop generic nitrogen estimate', source.replace("      { label: 'N', amount: crop.harvested_bushels * coefficients.nitrogen },\n", '')],
  ]
  expect(mutations).toHaveLength(11)
  for (const [name, mutation] of mutations) { expect(mutation, `${name} mutation did not alter source`).not.toBe(source); expect(() => assertNutrientRemovalContract(mutation), `${name} mutation survived nutrient-removal proof`).toThrow() }
})

test('Soil Rx archived-history guard rejects active-only history and inactive-create mutations', () => {
  const source = readFileSync(soilRxModulePath, 'utf8')
  assertArchivedFieldHistoryContract(source)
  const mutations: Array<[string, string]> = [
    ['filter archived fields from history', source.replace('fieldData.fields.map(({ id, name, is_active })', 'fieldData.fields.filter((field) => field.is_active).map(({ id, name, is_active })')],
    ['show add-field empty state for all-inactive farms', source.replace('!fields.length ? <p className="soil-rx-empty">Add a field before saving a soil test.</p>', '!activeFields.length ? <p className="soil-rx-empty">Add a field before saving a soil test.</p>')],
    ['offer archived fields in create selector', source.replace('{activeFields.map((field) => <option', '{fields.map((field) => <option')],
    ['allow create form for archived selection', source.replace('canEdit && selectedField?.isActive', 'canEdit')],
    ['remove archived field semantics', source.replace("{field.name}{!field.isActive && ' (Archived)'}", '{field.name}')],
    ['prefer archived history over an available active field', source.replace('nextActiveFields[0]?.id ?? nextFields.find((field) => nextTests.some((test) => test.field_id === field.id))?.id', 'nextFields.find((field) => nextTests.some((test) => test.field_id === field.id))?.id ?? nextActiveFields[0]?.id')],
  ]
  expect(mutations).toHaveLength(6)
  for (const [name, mutation] of mutations) { expect(mutation, `${name} mutation did not alter source`).not.toBe(source); expect(() => assertArchivedFieldHistoryContract(mutation), `${name} mutation survived archived-history proof`).toThrow() }
})

test('Soil Rx preserves archived history while creation remains active-field only', async ({ page }) => {
  const state = historyState(); state.fieldRows = [fieldRow(field, 'North Forty', false), fieldRow(secondField, 'South Forty')]
  const protectedBefore = protectedSnapshot(state); const unexpected = await open(page, false, state)
  await expect(page.getByRole('heading', { name: 'South Forty history' })).toBeVisible()
  const createField = page.locator('.soil-rx-form select')
  await expect(createField).toHaveValue(secondField)
  await expect(createField.locator('option')).toHaveCount(1)
  await expect(createField.locator('option')).toHaveText(['South Forty'])
  await page.getByRole('button', { name: /North Forty \(Archived\)/ }).click()
  await expect(page.getByRole('heading', { name: 'North Forty history' })).toBeVisible()
  await expect(page.getByText('Old Lab')).toBeVisible()
  await expect(page.getByText('This field is archived. Its Soil Rx history remains available, but new tests can only be added to active fields.', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Add a soil test' })).toHaveCount(0)
  await expect(page.getByText('Add a field before saving a soil test.', { exact: true })).toHaveCount(0)

  state.fieldRows = [fieldRow(field, 'North Forty', false), fieldRow(secondField, 'South Forty', false)]
  await page.reload()
  await expect(page.getByRole('heading', { name: 'North Forty history' })).toBeVisible()
  await expect(page.getByText('Old Lab')).toBeVisible()
  await expect(page.getByRole('button', { name: /North Forty \(Archived\)/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /South Forty \(Archived\)/ })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Add a soil test' })).toHaveCount(0)
  await expect(page.getByText('Add a field before saving a soil test.', { exact: true })).toHaveCount(0)
  expect(state.writes).toEqual([])
  expectProtectedNonwrite(state, protectedBefore); expect(unexpected).toEqual([])
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

test('Soil Rx opens a safe placeholder synchronously and handles blocked and failed report windows', async ({ page }) => {
  const state = historyState(); const protectedBefore = protectedSnapshot(state); const unexpected = await open(page, false, state)
  let signedUrlRequests = 0
  page.on('request', (request) => { if (request.url().includes('/storage/v1/object/sign/soil-test-reports/')) signedUrlRequests += 1 })
  await page.evaluate(() => { window.open = () => null })
  await page.getByRole('button', { name: 'Open lab report' }).click()
  await expect(page.getByRole('alert')).toHaveText('Your browser blocked the lab report window. Allow pop-ups for Farm Rx and try again.')
  await page.waitForTimeout(50)
  expect(signedUrlRequests).toBe(0)

  await installReportPopup(page)
  await page.getByRole('button', { name: 'Open lab report' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-opened-soil-report', /soil-test-reports/)
  await expect(page.locator('body')).toHaveAttribute('data-soil-report-opener-cleared', 'true')
  expect(signedUrlRequests).toBe(1)

  const failSignedUrl = async (route: Route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'signed URL failed' }) })
  await page.route(`https://*.supabase.co/storage/v1/object/sign/soil-test-reports/${reportPath}`, failSignedUrl)
  await installReportPopup(page)
  await page.getByRole('button', { name: 'Open lab report' }).click()
  await expect(page.getByRole('alert')).toContainText('could not open this report')
  await expect(page.locator('body')).toHaveAttribute('data-closed-soil-report', 'true')
  expect(signedUrlRequests).toBe(2)
  expectProtectedNonwrite(state, protectedBefore); expect(unexpected).toEqual([])
})

test('Soil Rx report guide binds populated, missing, and zero lab values to their labels', async ({ page }) => {
  const populatedState = historyState(); populatedState.tests[0]!.ph = 6.4; populatedState.tests[0]!.organic_matter_pct = 3.1; populatedState.tests[0]!.cec_meq_100g = 14.2; populatedState.tests[0]!.base_saturation_calcium_pct = 61.1; populatedState.tests[0]!.base_saturation_magnesium_pct = 17.2; populatedState.tests[0]!.base_saturation_potassium_pct = 3.3; populatedState.tests[0]!.base_saturation_sodium_pct = 0.4; populatedState.tests[0]!.base_saturation_hydrogen_pct = 18.5; const populatedUnexpected = await open(page, false, populatedState); const removal = page.getByRole('region', { name: 'Harvest nutrient removal estimate' }); await expect(removal).toContainText('Corn · 2026 · planting 1 · 8,000 bu on 40 ac'); await expect(removal).toContainText('4,800 lb total · 120 lb/ac'); await expect(removal).toContainText('2,960 lb total · 74 lb/ac'); await expect(removal).toContainText('1,920 lb total · 48 lb/ac'); await expect(removal).toContainText('not a fertilizer recommendation'); const guide = page.getByRole('region', { name: 'Understand this report' }); const guideValue = (label: string) => guide.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=..').locator('dd'); const baseSaturation = page.getByRole('region', { name: 'Base saturation lab values' }); const baseSaturationValue = (label: string) => baseSaturation.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=..').locator('dd'); await expect(guide.getByText('These are descriptions of the values reported by your lab, not agronomic advice, target ranges, or a fertilizer recommendation.', { exact: true })).toBeVisible(); await expect(guide.getByText('Ask your Crop RX agronomist for recommendations specific to your farm.', { exact: true })).toBeVisible(); await expect(guideValue('pH')).toHaveText('pH describes how acidic or alkaline the lab found this sample. Lab result: 6.4'); await expect(guideValue('pH')).not.toContainText('%'); await expect(guideValue('Organic matter')).toHaveText('Organic matter is the portion of the sample made from decomposed plant and animal material. Lab result: 3.1 %'); await expect(guideValue('CEC')).toHaveText('CEC describes the sample’s measured capacity to hold positively charged nutrients. Lab result: 14.2 meq/100g'); await expect(baseSaturationValue('Calcium')).toHaveText('61.1%'); await expect(baseSaturationValue('Magnesium')).toHaveText('17.2%'); await expect(baseSaturationValue('Potassium')).toHaveText('3.3%'); await expect(baseSaturationValue('Sodium')).toHaveText('0.4%'); await expect(baseSaturationValue('Hydrogen')).toHaveText('18.5%'); expect(populatedUnexpected).toEqual([])
})

test('Soil Rx keeps recorded harvest assignments separate across years and plantings', async ({ page }) => {
  const state = writeState()
  const assignment = (id: string, cropYear: number, plantingSequence: number, commodityId: string, bushels: number | null, acres = 40) => ({ id, farm_id: farm, field_id: field, crop_year: cropYear, commodity_id: commodityId, planting_sequence: plantingSequence, planted_acres: acres, variety: null, planting_date: null, harvest_date: bushels === null ? null : '2026-10-20', harvested_bushels: bushels, expected_yield_per_acre: null, expected_price_per_bu: null, actual_price_per_bu: null, notes: null, created_at: now, updated_at: now })
  state.cropAssignments = [assignment('00000000-0000-4000-8000-000000000031', 2026, 1, 'corn', 8000), assignment('00000000-0000-4000-8000-000000000032', 2025, 1, 'corn', 8000), assignment('00000000-0000-4000-8000-000000000033', 2026, 2, 'corn', 8000), assignment('00000000-0000-4000-8000-000000000034', 2026, 1, 'soybeans', 1000, 25), assignment('00000000-0000-4000-8000-000000000035', 2027, 1, 'corn', 0), assignment('00000000-0000-4000-8000-000000000036', 2027, 2, 'corn', null), assignment('00000000-0000-4000-8000-000000000037', 2026, 1, 'wheat', 1000, 20)]
  state.commodities = [{ id: 'corn', name: 'Corn', crop_family: 'corn', traits: {}, is_active: true, created_at: now, updated_at: now }, { id: 'soybeans', name: 'Soybeans', crop_family: 'soybeans', traits: {}, is_active: true, created_at: now, updated_at: now }, { id: 'wheat', name: 'Wheat', crop_family: 'wheat', traits: {}, is_active: true, created_at: now, updated_at: now }]
  const protectedBefore = protectedSnapshot(state)
  const unexpected = await open(page, false, state)
  const removal = page.getByRole('region', { name: 'Harvest nutrient removal estimate' })
  await expect(removal.getByRole('heading', { name: 'Corn · 2025 · planting 1 · 8,000 bu on 40 ac' })).toBeVisible()
  await expect(removal.getByRole('heading', { name: 'Corn · 2026 · planting 1 · 8,000 bu on 40 ac' })).toBeVisible()
  await expect(removal.getByRole('heading', { name: 'Corn · 2026 · planting 2 · 8,000 bu on 40 ac' })).toBeVisible()
  await expect(removal.getByRole('heading', { name: 'Soybeans · 2026 · planting 1 · 1,000 bu on 25 ac' })).toBeVisible()
  await expect(removal.getByRole('heading', { name: 'Wheat · 2026 · planting 1 · 1,000 bu on 20 ac' })).toBeVisible()
  await expect(removal.getByRole('heading', { name: 'Corn · 2027 · planting 1 · 0 bu on 40 ac' })).toBeVisible()
  await expect(removal).toContainText('1,920 lb total · 48 lb/ac')
  const soybean = removal.getByRole('region', { name: 'Soybeans 2026 planting 1 removal estimate' })
  const wheat = removal.getByRole('region', { name: 'Wheat 2026 planting 1 removal estimate' })
  const nutrientValue = (estimate: Locator, label: string) => estimate.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=..').locator('dd')
  await expect(nutrientValue(soybean, 'N')).toHaveText('3,440 lb total · 137.6 lb/ac')
  await expect(nutrientValue(soybean, 'P₂O₅')).toHaveText('750 lb total · 30 lb/ac')
  await expect(nutrientValue(soybean, 'K₂O')).toHaveText('1,170 lb total · 46.8 lb/ac')
  await expect(nutrientValue(wheat, 'N')).toHaveText('1,050 lb total · 52.5 lb/ac')
  await expect(nutrientValue(wheat, 'P₂O₅')).toHaveText('470 lb total · 23.5 lb/ac')
  await expect(nutrientValue(wheat, 'K₂O')).toHaveText('300 lb total · 15 lb/ac')
  await expect(soybean.locator('dt')).toHaveText(['N', 'P₂O₅', 'K₂O'])
  await expect(wheat.locator('dt')).toHaveText(['N', 'P₂O₅', 'K₂O'])
  await expect(removal).not.toContainText('24,000 bu')
  expect(state.writes).toEqual([])
  expectProtectedNonwrite(state, protectedBefore)
  expect(unexpected).toEqual([])
})

test('Soil Rx harvest query failure fails closed without writes', async ({ page }) => {
  const state = writeState(); state.failHarvestRead = true
  const protectedBefore = protectedSnapshot(state)
  await page.addInitScript(({ key, value, intentKey }) => { localStorage.setItem(key, JSON.stringify(value)); localStorage.setItem(intentKey, JSON.stringify({ version: 1, nonce: 'soil-rx-query-failure', phase: 'accepted', userId: value.user.id, sessionLineage: 'soil-rx-e2e', startedAtMs: Date.now() })) }, { key: `farm-rx-auth:${project}`, intentKey: `farm-rx-auth-intent:v1:${project}`, value: session() })
  const unexpected = await mock(page, false, state); await page.goto('/soil-rx')
  await expect(page.getByText('Farm Rx could not open your farm right now. Please try again.', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Harvest nutrient removal estimate' })).toHaveCount(0)
  expect(state.writes).toEqual([])
  expectProtectedNonwrite(state, protectedBefore)
  expect(unexpected).toEqual([])
})

test('Soil Rx is phone-safe and shows newest history, partial measurements, privacy, and read-only locks', async ({ page }, testInfo) => {
  const ownerState = historyState(); ownerState.tests[0]!.base_saturation_potassium_pct = 0; const ownerProtectedBefore = protectedSnapshot(ownerState); const ownerUnexpected = await open(page, false, ownerState); await expect(page.getByText('Old Lab')).toBeVisible(); const missingMeasurement = page.locator('.soil-test-details').getByText('Not reported').first(); await expect(missingMeasurement).toBeVisible(); const guide = page.getByRole('region', { name: 'Understand this report' }); const guideValue = (label: string) => guide.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=..').locator('dd'); const baseSaturation = page.getByRole('region', { name: 'Base saturation lab values' }); const baseSaturationValue = (label: string) => baseSaturation.locator('dt', { hasText: new RegExp(`^${label}$`) }).locator('xpath=..').locator('dd'); await expect(guideValue('pH')).toHaveText('pH describes how acidic or alkaline the lab found this sample. Lab result: Not reported'); await expect(guideValue('Organic matter')).toHaveText('Organic matter is the portion of the sample made from decomposed plant and animal material. Lab result: Not reported'); await expect(guideValue('CEC')).toHaveText('CEC describes the sample’s measured capacity to hold positively charged nutrients. Lab result: Not reported'); await expect(baseSaturationValue('Calcium')).toHaveText('Not reported'); await expect(baseSaturationValue('Magnesium')).toHaveText('Not reported'); await expect(baseSaturationValue('Potassium')).toHaveText('0%'); await expect(baseSaturationValue('Sodium')).toHaveText('Not reported'); await expect(baseSaturationValue('Hydrogen')).toHaveText('Not reported'); await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate((node) => node.clientWidth));
  const summary = page.locator('.soil-test-summary').filter({ hasText: 'Old Lab' }); await expect(summary).toHaveAttribute('aria-expanded', 'true'); await summary.click(); await expect(summary).toHaveAttribute('aria-expanded', 'false'); await expect(missingMeasurement).toBeHidden(); await summary.click(); await expect(summary).toHaveAttribute('aria-expanded', 'true')
  const formField = page.locator('.soil-rx-form select'); await expect(formField).toHaveValue(field); await page.getByRole('button', { name: /South Forty/ }).click(); await expect(formField).toHaveValue(secondField); await expect(page.getByText('No soil tests saved for this field yet.')).toBeVisible(); await page.getByRole('button', { name: /North Forty/ }).click(); await expect(formField).toHaveValue(field); await formField.selectOption(secondField); await expect(page.getByRole('heading', { name: 'South Forty history' })).toBeVisible(); await formField.selectOption(field); await expect(page.getByRole('heading', { name: 'North Forty history' })).toBeVisible()
  await installReportPopup(page); await page.getByRole('button', { name: 'Open lab report' }).click(); await expect(page.locator('body')).toHaveAttribute('data-opened-soil-report', /soil-test-reports/)
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

test('Soil Rx drains never-created attachment custody only after terminal absence proof', async ({ page }) => {
  const state = writeState(); state.failSoilSaves = 1; state.failTerminalAbsenceChecks = 1
  const protectedBefore = protectedSnapshot(state); const unexpected = await open(page, false, state)
  await page.getByLabel('Lab name').fill('Pre-row Failure Lab')
  await page.getByLabel('Sample date').fill('2027-01-18')
  await page.getByLabel(/Lab report/).setInputFiles({ name: 'never-uploaded.pdf', mimeType: 'application/pdf', buffer: Buffer.from('never uploaded') })
  await page.getByRole('button', { name: 'Save soil test' }).click()
  await expect(page.locator('.auth-error')).toHaveText('Check the field details and try again.')
  await expect(page.locator('.sync-notice.blocked')).toContainText('needs attention. Nothing was deleted')
  const cleanupKey = `farm-rx-soil-rx-cleanup:v1:${project}:${user}`
  const retained = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), cleanupKey) as { version: number; entries: Array<{ testId?: string; paths?: string[] }> }
  const failedId = retained.entries[0]?.testId; const failedPath = retained.entries[0]?.paths?.[0]
  expect(failedId).toBeTruthy(); expect(failedPath).toBeTruthy()
  expect(state.tests.some((row) => row.id === failedId)).toBe(false)
  expect(state.uploaded.has(failedPath!)).toBe(false)
  expect(state.writes).toContain(`storage:verify-terminal-absence:${failedPath}`)

  await page.locator('.sync-notice.blocked').getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('.sync-notice.synced')).toHaveText('All changes synced.')
  const drained = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), cleanupKey)
  expect(drained).toEqual({ version: 2, entries: [] })
  expect(state.writes.filter((entry) => entry === `storage:verify-terminal-absence:${failedPath}`)).toHaveLength(2)
  expect(state.writes).toContain(`soil_tests:verify-absent:${failedId}`)
  expectProtectedNonwrite(state, protectedBefore); expect(unexpected).toEqual([])
})

test('Soil Rx drains custody after lost Storage and row-delete responses without unrelated writes', async ({ page }) => {
  const state = writeState(); state.failAttachmentMetadata = 1; state.loseStorageRemoveResponses = 1; state.loseSoilDeleteResponses = 1
  const protectedBefore = protectedSnapshot(state); const unexpected = await open(page, false, state)
  await page.getByLabel('Lab name').fill('Lost Cleanup Responses Lab')
  await page.getByLabel('Sample date').fill('2027-01-19')
  await page.getByLabel(/Lab report/).setInputFiles({ name: 'lost-response.pdf', mimeType: 'application/pdf', buffer: Buffer.from('lost response report') })
  await page.getByRole('button', { name: 'Save soil test' }).click()
  await expect(page.locator('.sync-notice.blocked')).toContainText('needs attention. Nothing was deleted')
  const failedId = state.writes.find((entry) => entry.startsWith('soil_tests:upsert:'))?.split(':').at(-1)
  const failedPath = state.writes.find((entry) => entry.startsWith('storage:upload:'))?.slice('storage:upload:'.length)
  expect(failedId).toBeTruthy(); expect(failedPath).toBeTruthy(); expect(state.uploaded.has(failedPath!)).toBe(false); expect(state.tests.some((row) => row.id === failedId)).toBe(true)

  await page.locator('.sync-notice.blocked').getByRole('button', { name: 'Try again' }).click()
  await expect.poll(() => state.writes.includes(`storage:verify-absent:${failedPath}`)).toBe(true)
  await expect(page.locator('.sync-notice.blocked')).toBeVisible()
  expect(state.tests.some((row) => row.id === failedId)).toBe(false)

  await page.locator('.sync-notice.blocked').getByRole('button', { name: 'Try again' }).click()
  await expect(page.locator('.sync-notice.synced')).toHaveText('All changes synced.')
  expect(state.writes).toContain(`soil_tests:verify-absent:${failedId}`)
  const cleanupKey = `farm-rx-soil-rx-cleanup:v1:${project}:${user}`
  const drained = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), cleanupKey)
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
