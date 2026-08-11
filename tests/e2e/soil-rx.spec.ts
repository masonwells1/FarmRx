import { expect, test, type Page } from '@playwright/test'

const project = 'agvsozfbstpekuqxpqjr'; const user = '00000000-0000-4000-8000-000000000001'; const farm = '00000000-0000-4000-8000-000000000010'; const entity = '00000000-0000-4000-8000-000000000011'; const field = '00000000-0000-4000-8000-000000000012'; const secondField = '00000000-0000-4000-8000-000000000013'; const testId = '00000000-0000-4000-8000-000000000021'; const attachmentId = '00000000-0000-4000-8000-000000000022'; const reportPath = `${farm}/${field}/${testId}/lab-report.pdf`; const now = '2027-01-15T12:00:00.000Z'
function session() { const exp = Math.floor(Date.now() / 1000) + 86400; const payload = Buffer.from(JSON.stringify({ sub: user, aud: 'authenticated', exp, session_id: 'soil-rx-e2e' })).toString('base64url'); return { access_token: `eyJhbGciOiJub25lIn0.${payload}.signature`, refresh_token: 'soil-rx-refresh', expires_in: 86400, expires_at: exp, token_type: 'bearer', user: { id: user, aud: 'authenticated', role: 'authenticated', email: 'farmer@example.test', app_metadata: {}, user_metadata: {}, identities: [], created_at: now } } }
async function mock(page: Page, readOnly = false) {
  const unexpected: string[] = []
  await page.route('https://*.supabase.co/**', async (route) => {
    const request = route.request(); const url = new URL(request.url()); const table = url.pathname.match(/^\/rest\/v1\/([^/]+)$/)?.[1]; const json = (body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
    if (url.pathname === '/auth/v1/user') return json(session().user)
    if (url.pathname.includes('/rpc/get_current_farm_access_epochs')) return json([{ farm_id: farm, access_epoch: 1 }])
    if (/\/rpc\/(program_due_generation_status|service_due_generation_status)$/.test(url.pathname)) return json({ has_due: false, task_needed: false, notification_needed: false, local_date: '2027-01-15' })
    if (url.pathname.includes('/rpc/operational_integrity_capability_probe')) return json(true)
    if (/\/rpc\/(can_access_farm|is_active_farm_member|can_edit_farm|can_manage_farm|can_read_private_financials|has_explicit_rep_access)$/.test(url.pathname)) { const name = url.pathname.split('/').at(-1); return json(name === 'has_explicit_rep_access' ? false : name === 'can_edit_farm' || name === 'can_manage_farm' || name === 'can_read_private_financials' ? !readOnly : true) }
    if (url.pathname === `/storage/v1/object/sign/soil-test-reports/${reportPath}`) return json({ signedURL: `/storage/v1/object/sign/soil-test-reports/${reportPath}?token=soil-rx-e2e` })
    if (table === 'farms') { const row = { id: farm, name: 'Prairie View', share_with_rep: false, created_by: user, created_at: now, updated_at: now }; return json(url.searchParams.has('id') ? row : [row]) }
    if (table === 'farm_memberships') return json({ farm_id: farm, user_id: user, role: readOnly ? 'read_only' : 'owner', status: 'active', can_view_financials: !readOnly })
    if (table === 'farm_rep_access') return json(null)
    if (table === 'entities') return json([{ id: entity, farm_id: farm, name: 'Prairie View LLC', entity_type: 'llc', is_active: true, created_at: now, updated_at: now }])
    if (table === 'fields') return json([
      { id: field, farm_id: farm, operating_entity_id: entity, name: 'North Forty', legal_description: null, county: null, state: 'IL', total_acres: 40, fsa_farm_number: null, fsa_tract_number: null, soil_productivity_index: null, latitude: null, longitude: null, location_source: null, is_active: true, created_at: now, updated_at: now },
      { id: secondField, farm_id: farm, operating_entity_id: entity, name: 'South Forty', legal_description: null, county: null, state: 'IL', total_acres: 40, fsa_farm_number: null, fsa_tract_number: null, soil_productivity_index: null, latitude: null, longitude: null, location_source: null, is_active: true, created_at: now, updated_at: now },
    ])
    if (['arrangements', 'crop_assignments', 'commodities', 'notifications'].includes(table ?? '')) return json([])
    if (table === 'soil_test_attachments') return json([{ id: attachmentId, farm_id: farm, field_id: field, test_id: testId, storage_path: reportPath, original_filename: 'lab-report.pdf', mime_type: 'application/pdf', size_bytes: 1024, created_by: user, created_at: now }])
    if (table === 'soil_tests') return json([{ id: testId, farm_id: farm, field_id: field, sample_date: '2026-11-01', lab_name: 'Old Lab', ph: 6.4, organic_matter_pct: null, cec_meq_100g: null, phosphorus_ppm: null, potassium_ppm: null, calcium_ppm: null, magnesium_ppm: null, sulfur_ppm: null, base_saturation_calcium_pct: null, base_saturation_magnesium_pct: null, base_saturation_potassium_pct: null, base_saturation_sodium_pct: null, base_saturation_hydrogen_pct: null, boron_ppm: null, chloride_ppm: null, copper_ppm: null, iron_ppm: null, manganese_ppm: null, molybdenum_ppm: null, zinc_ppm: null, created_by: user, created_at: now, updated_at: now }])
    unexpected.push(`${request.method()} ${url.pathname}`); await route.abort('blockedbyclient')
  })
  return unexpected
}
async function open(page: Page, readOnly = false) { await page.addInitScript(({ key, value, intentKey }) => { localStorage.setItem(key, JSON.stringify(value)); localStorage.setItem(intentKey, JSON.stringify({ version: 1, nonce: 'soil-rx', phase: 'accepted', userId: value.user.id, sessionLineage: 'soil-rx-e2e', startedAtMs: Date.now() })) }, { key: `farm-rx-auth:${project}`, intentKey: `farm-rx-auth-intent:v1:${project}`, value: session() }); const unexpected = await mock(page, readOnly); await page.goto('/soil-rx'); await expect(page.getByRole('heading', { name: 'Soil Rx' })).toBeVisible(); return unexpected }

test.use({ serviceWorkers: 'block' })

test('Soil Rx is phone-safe and shows newest history, partial measurements, privacy, and read-only locks', async ({ page }, testInfo) => {
  const ownerUnexpected = await open(page); await expect(page.getByText('Old Lab')).toBeVisible(); const missingMeasurement = page.locator('.soil-test-details').getByText('Not reported').first(); await expect(missingMeasurement).toBeVisible(); await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate((node) => node.clientWidth));
  const summary = page.locator('.soil-test-summary').filter({ hasText: 'Old Lab' }); await expect(summary).toHaveAttribute('aria-expanded', 'true'); await summary.click(); await expect(summary).toHaveAttribute('aria-expanded', 'false'); await expect(missingMeasurement).toBeHidden(); await summary.click(); await expect(summary).toHaveAttribute('aria-expanded', 'true')
  const formField = page.locator('.soil-rx-form select'); await expect(formField).toHaveValue(field); await page.getByRole('button', { name: /South Forty/ }).click(); await expect(formField).toHaveValue(secondField); await expect(page.getByText('No soil tests saved for this field yet.')).toBeVisible(); await page.getByRole('button', { name: /North Forty/ }).click(); await expect(formField).toHaveValue(field)
  await page.evaluate(() => { window.open = (url) => { document.body.dataset.openedSoilReport = String(url); return null } }); await page.getByRole('button', { name: 'Open lab report' }).click(); await expect(page.locator('body')).toHaveAttribute('data-opened-soil-report', /soil-test-reports/)
  if (testInfo.project.name === 'chromium-phone') { await page.getByRole('button', { name: 'More' }).click(); await page.getByRole('region', { name: 'More Farm Rx destinations' }).getByRole('link', { name: 'Privacy' }).click() } else await page.getByRole('link', { name: 'Privacy' }).click();
  await expect(page.getByText('Grain, financial, and Soil Rx information stays private')).toBeVisible(); expect(ownerUnexpected).toEqual([])
  const readOnlyUnexpected = await open(page, true); await expect(page.getByRole('heading', { name: 'Add a soil test' })).toHaveCount(0); await expect(page.getByRole('button', { name: 'Save soil test' })).toHaveCount(0); await expect(page.getByText('Old Lab')).toBeVisible(); await expect(page.getByRole('button', { name: 'Open lab report' })).toBeEnabled(); expect(readOnlyUnexpected).toEqual([])
  if (testInfo.project.name === 'chromium-phone') await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.locator('body').evaluate((node) => node.clientWidth));
})
