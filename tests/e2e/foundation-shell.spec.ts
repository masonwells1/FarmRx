import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'
import { readFileSync } from 'node:fs'

const projectRef = 'agvsozfbstpekuqxpqjr'
const userId = '00000000-0000-4000-8000-000000000001'
const userBId = '00000000-0000-4000-8000-000000000002'
const farmA = '00000000-0000-4000-8000-000000000010'
const farmB = '00000000-0000-4000-8000-000000000020'
const entityA = '00000000-0000-4000-8000-000000000011'
const entityB = '00000000-0000-4000-8000-000000000021'
const fieldA = '00000000-0000-4000-8000-000000000012'
const fieldB = '00000000-0000-4000-8000-000000000022'
const arrangementA = '00000000-0000-4000-8000-000000000013'
const arrangementB = '00000000-0000-4000-8000-000000000023'
const commodityId = 'corn_yellow'
const notificationA = '00000000-0000-4000-8000-000000000041'
const notificationB = '00000000-0000-4000-8000-000000000042'
const now = '2026-07-15T12:00:00.000Z'

type FarmFixture = { id: string; name: string; entityId: string; fieldId: string; fieldName: string; arrangementId: string }
const farms: FarmFixture[] = [
  { id: farmA, name: 'Prairie View', entityId: entityA, fieldId: fieldA, fieldName: 'North Forty', arrangementId: arrangementA },
  { id: farmB, name: 'River Bend', entityId: entityB, fieldId: fieldB, fieldName: 'South Bottom', arrangementId: arrangementB },
]

test('login blocks empty credentials and keeps the login brand legible on dark green', async ({ page }) => {
  await page.goto('/login')
  const email = page.locator('#email')
  const password = page.locator('#password')
  await expect(email).toHaveAttribute('required', '')
  await expect(password).toHaveAttribute('required', '')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(email).toBeFocused()
  expect(await email.evaluate((input) => (input as HTMLInputElement).validity.valueMissing)).toBe(true)
  await expect(page.locator('.slogan')).toHaveCSS('color', 'rgb(188, 239, 207)')
  if (process.env.VITE_PASSWORD_EMAIL_DELIVERY_ENABLED === 'true') {
    await page.getByRole('button', { name: 'Forgot password?' }).click()
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
    await expect(page.locator('#reset-email')).toHaveAttribute('required', '')
  } else {
    await expect(page.getByRole('button', { name: 'Forgot password?' })).toHaveCount(0)
    await expect(page.getByText('Need password help? Contact your Crop RX representative.')).toBeVisible()
  }
})

function session(id = userId) {
  const expiresAt = Math.floor(Date.now() / 1000) + 86_400
  const payload = btoa(JSON.stringify({ sub: id, aud: 'authenticated', exp: expiresAt, session_id: `session-${id}` })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  return {
    access_token: `eyJhbGciOiJub25lIn0.${payload}.signature`, refresh_token: `offline-test-refresh-${id}`, expires_in: 86_400, expires_at: expiresAt, token_type: 'bearer',
    user: { id, aud: 'authenticated', role: 'authenticated', email: id === userId ? 'farmer@example.test' : 'other-farmer@example.test', app_metadata: {}, user_metadata: {}, identities: [], created_at: now },
  }
}

async function seedSession(context: BrowserContext) {
  await context.addInitScript(({ sessionKey, intentKey, value, intent }) => { localStorage.setItem(intentKey, JSON.stringify(intent)); localStorage.setItem(sessionKey, JSON.stringify(value)) }, {
    sessionKey: `farm-rx-auth:${projectRef}`,
    intentKey: `farm-rx-auth-intent:v1:${projectRef}`,
    value: session(),
    intent: { version: 1, nonce: 'playwright-session-a', phase: 'accepted', userId, sessionLineage: `session-${userId}`, startedAtMs: Date.now() },
  })
}

async function seedPendingWriteQueues(context: BrowserContext) {
  const fieldsKey = `farm-rx-write-queue:v1:${projectRef}:${userId}:${farmA}`
  const equipmentKey = `farm-rx-equipment-tasks-queue:v1:${projectRef}:${userId}:${farmA}`
  const fenceKey = `farm-rx-revocation-fence:v1:${projectRef}:${userId}:${farmA}`
  const generationKey = `farm-rx-revocation-generation:v1:${projectRef}:${userId}:${farmA}`
  const grantToken = '00000000-0000-4000-8000-000000000099'
  const fieldsQueue = { version: 1, entries: [{ version: 1, module: 'fields', kind: 'saveField', operationId: '00000000-0000-4000-8000-000000000061', userId, farmId: farmA, enqueuedAt: now, draft: { id: fieldA, name: 'North Forty queued edit', operating_entity_id: entityA, total_acres: 80, county: 'McLean', state: 'IL', legal_description: null, fsa_farm_number: null, fsa_tract_number: null, soil_productivity_index: 134, arrangement: { id: arrangementA, arrangement_type: 'owned', landlord_name: null, landlord_phone: null, landlord_contact_notes: null, effective_from: '2026-01-01', cash_rent_per_acre: null, flex_bonus_formula: null, landlord_crop_pct: null, landlord_seed_pct: 0, landlord_fertilizer_pct: 0, landlord_chemical_pct: 0, landlord_fuel_pct: 0, landlord_labor_custom_pct: 0, landlord_crop_insurance_pct: 0, landlord_equipment_pct: 0, landlord_interest_pct: 0, landlord_other_input_pct: 0, notes: null }, crop_assignments: [] } }] }
  const equipmentQueue = { version: 1, entries: [{ version: 1, module: 'equipment_tasks', kind: 'saveEquipment', operationId: '00000000-0000-4000-8000-000000000062', userId, farmId: farmA, enqueuedAt: now, value: { id: '00000000-0000-4000-8000-000000000063', farm_id: farmA, name: 'Queued tractor', category: 'tractor', make: null, model: null, model_year: null, serial_or_vin: null, purchase_date: null, purchase_price: null, meter_unit: 'hours', warranty_expires_on: null, warranty_notes: null, status: 'active', notes: null } }] }
  const fence = { version: 2, generation: 2, token: grantToken, serverEpoch: 1, revoked: false, changedAt: now }
  const generation = { version: 2, generation: 2, token: grantToken, serverEpoch: 1, changedAt: now }
  await context.addInitScript(({ values }) => { for (const [key, value] of Object.entries(values)) localStorage.setItem(key, JSON.stringify(value)) }, { values: { [fieldsKey]: fieldsQueue, [equipmentKey]: equipmentQueue, [fenceKey]: fence, [generationKey]: generation } })
  return { fieldsKey, equipmentKey }
}

type AccessProfileFixture = { memberRole: 'owner' | 'manager' | 'worker' | 'read_only' | null; canViewFinancials: boolean; namedRep: boolean }
const ownerProfile: AccessProfileFixture = { memberRole: 'owner', canViewFinancials: false, namedRep: false }
function farmRow(farm: FarmFixture, shareWithRep = false) { return { id: farm.id, name: farm.name, share_with_rep: shareWithRep, created_by: userId, created_at: now, updated_at: now } }
function membershipRow(farm: FarmFixture, memberId = userId, profile = ownerProfile) { return profile.memberRole === null ? null : { farm_id: farm.id, user_id: memberId, role: profile.memberRole, status: 'active', can_view_financials: profile.canViewFinancials } }
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

function exactQuery(url: URL, expected: Record<string, string>) {
  const actual = [...url.searchParams.entries()].sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
  const wanted = Object.entries(expected).sort(([leftKey, leftValue], [rightKey, rightValue]) => leftKey.localeCompare(rightKey) || leftValue.localeCompare(rightValue))
  return JSON.stringify(actual) === JSON.stringify(wanted)
}

const fieldsReadQueries: Record<string, (farm: FarmFixture) => Record<string, string>> = {
  entities: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'name.asc' }),
  fields: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'name.asc' }),
  arrangements: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'effective_from.asc' }),
  crop_assignments: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_year.asc,planting_sequence.asc' }),
  commodities: () => ({ select: '*', is_active: 'eq.true', order: 'name.asc' }),
}
const grainReadQueries: Record<string, (farm: FarmFixture) => Record<string, string>> = {
  production_estimates: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_year.asc,commodity_id.asc,id.asc' }),
  grain_contracts: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_year.asc,commodity_id.asc,delivery_start.asc,id.asc' }),
  grain_contract_deliveries: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'delivered_on.asc,id.asc' }),
  marketing_plan_targets: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_year.asc,commodity_id.asc,target_month.asc,id.asc' }),
  insurance_units: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_year.asc,commodity_id.asc,unit_name.asc,id.asc' }),
  grain_bins: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'name.asc,id.asc' }),
  bin_inventory: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_year.asc,commodity_id.asc,id.asc' }),
  bin_transactions: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'occurred_on.desc,created_at.desc,id.desc' }),
  cash_bids: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'bid_date.asc,id.asc' }),
  usda_report_dates: () => ({ select: '*', order: 'report_date.asc,id.asc' }),
  marketing_alert_rules: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_year.asc,commodity_id.asc,created_at.asc,id.asc' }),
  firm_offers: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_year.asc,commodity_id.asc,created_at.asc,id.asc' }),
  grain_alert_settings: (farm) => ({ select: '*', farm_id: `eq.${farm.id}` }),
}
const profitabilityReadQueries: Record<string, (farm: FarmFixture) => Record<string, string>> = {
  crop_budgets: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_year.asc,commodity_id.asc,id.asc' }),
  budget_cost_lines: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'budget_id.asc,sort_order.asc' }),
  profitability_matrix_steps: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'budget_id.asc,axis.asc,step_order.asc' }),
  budget_field_allocations: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'budget_id.asc,crop_assignment_id.asc' }),
}
function grainRows(table: string, farm: FarmFixture) {
  if (table === 'production_estimates') return [{ id: '00000000-0000-4000-8000-000000000051', farm_id: farm.id, crop_year: 2026, commodity_id: commodityId, operating_entity_id: null, enterprise_label: null, planted_acres: 80, aph_yield: 190, expected_bushels: 15_200, actual_bushels: null, drives_math: 'projected', notes: null, created_at: now, updated_at: now }]
  return table === 'grain_alert_settings' ? null : []
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
}

async function mockSupabase(page: Page, accessible = farms, notifications: unknown[] = [], emptyUnknownReads = false, accessEpoch = 1, profile = ownerProfile, activeUser: string | (() => string) = userId) {
  const unexpected: string[] = []
  await page.route('https://*.supabase.co/**', async (route) => {
    const url = new URL(route.request().url())
    const rest = url.pathname.match(/^\/rest\/v1\/([^/]+)$/)?.[1]
    const activeUserId = typeof activeUser === 'function' ? activeUser() : activeUser
    const rejectShape = async (label: string) => { unexpected.push(`INVALID ${label}`); await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: `Invalid mocked ${label}` }) }) }
    if (rest === 'farms') {
      if (route.request().method() !== 'GET') { await rejectShape('farms method'); return }
      if (url.searchParams.has('id')) { const farm = requestedFarm(url); if (!exactQuery(url, { select: '*', id: `eq.${farm.id}` })) { await rejectShape('farms selected query'); return }; await fulfillJson(route, farmRow(farm, profile.namedRep)) }
      else { if (!exactQuery(url, { select: '*', order: 'name.asc,id.asc' })) { await rejectShape('farms list query'); return }; await fulfillJson(route, accessible.map((farm) => farmRow(farm, profile.namedRep))) }
      return
    }
    if (rest === 'farm_memberships') { const farm = requestedFarm(url); if (route.request().method() !== 'GET' || !exactQuery(url, { select: 'farm_id,user_id,role,status,can_view_financials', farm_id: `eq.${farm.id}`, user_id: `eq.${activeUserId}` })) { await rejectShape('farm_memberships query'); return }; await fulfillJson(route, membershipRow(farm, activeUserId, profile)); return }
    if (rest === 'farm_rep_access') { const farm = requestedFarm(url); if (route.request().method() !== 'GET' || !exactQuery(url, { select: 'farm_id,rep_user_id,enabled,revoked_at', farm_id: `eq.${farm.id}`, rep_user_id: `eq.${activeUserId}` })) { await rejectShape('farm_rep_access query'); return }; await fulfillJson(route, profile.namedRep ? { farm_id: farm.id, rep_user_id: activeUserId, enabled: true, revoked_at: null } : null); return }
    if (rest && Object.hasOwn(fieldsReadQueries, rest)) { const farm = requestedFarm(url); if (route.request().method() !== 'GET' || !exactQuery(url, fieldsReadQueries[rest]!(farm))) { await rejectShape(`${rest} query`); return }; await fulfillJson(route, rowsFor(rest, farm)); return }
    if (rest === 'notifications') { if (route.request().method() !== 'GET' || !exactQuery(url, { select: '*', order: 'created_at.desc,id.desc' })) { await rejectShape('notifications query'); return }; await fulfillJson(route, notifications); return }
    if (url.pathname === '/rest/v1/rpc/get_current_farm_access_epochs') {
      let body: unknown = null; try { body = route.request().postDataJSON() } catch { /* rejected below */ }
      if (route.request().method() !== 'POST' || !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body as Record<string, unknown>).length !== 0) { await rejectShape('get_current_farm_access_epochs body'); return }
      await fulfillJson(route, accessible.map((farm) => ({ farm_id: farm.id, access_epoch: accessEpoch })))
      return
    }
    if (['can_access_farm', 'is_active_farm_member', 'can_edit_farm', 'can_manage_farm', 'can_read_private_financials', 'has_explicit_rep_access'].some((name) => url.pathname === `/rest/v1/rpc/${name}`)) {
      let body: unknown = null; try { body = route.request().postDataJSON() } catch { /* rejected below */ }
      const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
      if (route.request().method() !== 'POST' || !value || Object.keys(value).length !== 1 || !accessible.some((farm) => farm.id === value.target_farm_id)) { await rejectShape(`${url.pathname} body`); return }
      const helper = url.pathname.split('/').at(-1)
      const activeMember = profile.memberRole !== null
      const canEdit = activeMember && profile.memberRole !== 'read_only'
      const canManage = activeMember && (profile.memberRole === 'owner' || profile.memberRole === 'manager')
      const canReadPrivate = profile.namedRep || activeMember && (profile.memberRole === 'owner' || profile.memberRole === 'manager' || profile.canViewFinancials)
      const answers: Record<string, boolean> = { can_access_farm: activeMember || profile.namedRep, is_active_farm_member: activeMember, can_edit_farm: canEdit, can_manage_farm: canManage, can_read_private_financials: canReadPrivate, has_explicit_rep_access: profile.namedRep }
      await fulfillJson(route, answers[helper!] ?? false); return
    }
    if (['program_due_generation_status', 'service_due_generation_status'].some((name) => url.pathname === `/rest/v1/rpc/${name}`)) { const value = route.request().postDataJSON() as Record<string, unknown>; if (route.request().method() !== 'POST' || Object.keys(value).length !== 1 || !accessible.some((farm) => farm.id === value.p_farm_id)) { await rejectShape('due status body'); return }; await fulfillJson(route, { has_due: false, task_needed: false, notification_needed: false, local_date: '2026-07-12' }); return }
    if (['generate_due_program_items_v2', 'generate_due_service_tasks_v2'].some((name) => url.pathname === `/rest/v1/rpc/${name}`)) throw new Error(`False due preflight unexpectedly called ${url.pathname}`)
    if (url.pathname === '/rest/v1/rpc/operational_integrity_capability_probe') { let body: unknown = null; try { body = route.request().postDataJSON() } catch { /* rejected below */ }; const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null; if (route.request().method() !== 'POST' || !value || Object.keys(value).length !== 1 || typeof value.p_farm_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.p_farm_id)) { await rejectShape('operational_integrity_capability_probe body'); return }; await fulfillJson(route, true); return }
    if (url.pathname === '/rest/v1/rpc/generate_due_service_tasks' || url.pathname === '/rest/v1/rpc/generate_due_program_items') throw new Error(`False due preflight unexpectedly called legacy ${url.pathname}`)
    if (url.pathname === '/auth/v1/user') { await fulfillJson(route, session(activeUserId).user); return }
    if (url.pathname === '/auth/v1/logout') { await fulfillJson(route, {}); return }
    if (emptyUnknownReads && rest && Object.hasOwn(grainReadQueries, rest)) { const farm = requestedFarm(url); if (route.request().method() !== 'GET' || !exactQuery(url, grainReadQueries[rest]!(farm))) { await rejectShape(`${rest} query`); return }; await fulfillJson(route, grainRows(rest, farm)); return }
    if (emptyUnknownReads && rest && Object.hasOwn(profitabilityReadQueries, rest)) { const farm = requestedFarm(url); if (route.request().method() !== 'GET' || !exactQuery(url, profitabilityReadQueries[rest]!(farm))) { await rejectShape(`${rest} query`); return }; await fulfillJson(route, []); return }
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

test('password recovery fails closed after a page refresh or missing current-link event', async ({ page }) => {
  await page.goto('/update-password')
  await expect(page.getByRole('alert')).toContainText('interrupted when the page closed or refreshed')
  await expect(page.getByText('Request a fresh link or contact your Crop RX representative.')).toBeVisible()
  if (process.env.VITE_PASSWORD_EMAIL_DELIVERY_ENABLED === 'true') {
    await page.getByRole('link', { name: 'Request a new link' }).click()
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
  } else {
    await expect(page.getByRole('link', { name: 'Request a new link' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Return to sign in' })).toHaveAttribute('href', '/login')
  }
})

test('two-tab sign-in falls back to a fail-closed storage lease when Web Locks are unavailable', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'One real desktop browser context proves the shared two-tab fallback path.')

  const authSessionKey = `farm-rx-auth:${projectRef}`
  const authIntentKey = `farm-rx-auth-intent:v1:${projectRef}`
  const authLeaseKey = `${authIntentKey}:lease`
  await context.addInitScript(({ intentKey, leaseKey, sessionKey }) => {
    type LeaseAudit = { type: 'claim' | 'remove' | 'foreign-claim' | 'foreign-remove' | 'intent' | 'session-set' | 'session-remove'; tabId: string; token: string | null; value?: string }
    const currentTabId = window.name === 'farm-rx-fallback-test-tab' ? 'older-tab' : 'newer-tab'
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined })
    const audit: LeaseAudit[] = []
    Object.defineProperty(window, '__farmRxFallbackLeaseAudit', { configurable: true, value: audit })
    Object.defineProperty(window, '__farmRxHideForeignLeaseOnce', { configurable: true, writable: true, value: false })
    const token = (serialized: string | null) => {
      try { const value = JSON.parse(serialized ?? 'null') as { token?: unknown } | null; return typeof value?.token === 'string' ? value.token : null } catch { return null }
    }
    const originalGetItem = Storage.prototype.getItem
    const originalSetItem = Storage.prototype.setItem
    const originalRemoveItem = Storage.prototype.removeItem
    Storage.prototype.getItem = function getItem(key: string) {
      const value = originalGetItem.call(this, key)
      const harness = window as Window & { __farmRxHideForeignLeaseOnce: boolean }
      if (this === localStorage && key === leaseKey && value !== null && harness.__farmRxHideForeignLeaseOnce) {
        // Model the exact non-atomic localStorage race: tab B observed no lease
        // just before tab A's claim became visible, so B also attempts a claim.
        harness.__farmRxHideForeignLeaseOnce = false
        return null
      }
      return value
    }
    Storage.prototype.setItem = function setItem(key: string, value: string) {
      originalSetItem.call(this, key, value)
      if (this !== localStorage) return
      if (key === leaseKey) {
        const claimedToken = token(value)
        audit.push({ type: 'claim', tabId: currentTabId, token: claimedToken })
      }
      if (key === intentKey) audit.push({ type: 'intent', tabId: currentTabId, token: token(localStorage.getItem(leaseKey)), value })
      if (key === sessionKey) audit.push({ type: 'session-set', tabId: currentTabId, token: token(localStorage.getItem(leaseKey)), value })
    }
    Storage.prototype.removeItem = function removeItem(key: string) {
      const removedToken = this === localStorage && key === leaseKey ? token(localStorage.getItem(leaseKey)) : null
      const removedSession = this === localStorage && key === sessionKey ? originalGetItem.call(this, key) : null
      originalRemoveItem.call(this, key)
      if (this === localStorage && key === leaseKey) audit.push({ type: 'remove', tabId: currentTabId, token: removedToken })
      if (this === localStorage && key === sessionKey) audit.push({ type: 'session-remove', tabId: currentTabId, token: token(localStorage.getItem(leaseKey)), value: removedSession ?? undefined })
    }
    window.addEventListener('storage', (event) => {
      if (event.key !== leaseKey) return
      audit.push({ type: event.newValue === null ? 'foreign-remove' : 'foreign-claim', tabId: currentTabId, token: token(event.newValue) })
    })
  }, { intentKey: authIntentKey, leaseKey: authLeaseKey, sessionKey: authSessionKey })

  let authoritativeUserId = userId
  const newerUnexpected = await mockSupabase(page, [farms[0]], [], false, 1, ownerProfile, () => authoritativeUserId)
  await page.goto('/login')
  const popupOpened = context.waitForEvent('page')
  await page.evaluate(() => {
    const popup = window.open('/login?fallback-tab=older', 'farm-rx-fallback-test-tab')
    if (!popup) throw new Error('The fallback test tab could not be opened.')
    ;(window as Window & { __farmRxFallbackTestTab?: Window }).__farmRxFallbackTestTab = popup
  })
  const olderTab = await popupOpened
  const olderUnexpected = await mockSupabase(olderTab, [farms[0]], [], false, 1, ownerProfile, () => authoritativeUserId)
  await expect(olderTab.getByRole('button', { name: 'Sign in' })).toBeVisible()
  const olderSession = session(userBId)
  const newerSession = session(userId)
  let olderRequestStarted = false
  let newerRequestStarted = false
  let releaseOlderRequest = () => {}
  let releaseNewerRequest = () => {}
  const olderRequestGate = new Promise<void>((resolve) => { releaseOlderRequest = resolve })
  const newerRequestGate = new Promise<void>((resolve) => { releaseNewerRequest = resolve })

  await olderTab.route('https://*.supabase.co/auth/v1/token**', async (route) => {
    olderRequestStarted = true
    await olderRequestGate
    await fulfillJson(route, olderSession)
  })
  await page.route('https://*.supabase.co/auth/v1/token**', async (route) => {
    newerRequestStarted = true
    await newerRequestGate
    await fulfillJson(route, newerSession)
  })

  expect(await Promise.all([olderTab.evaluate(() => navigator.locks), page.evaluate(() => navigator.locks)])).toEqual([undefined, undefined])

  await olderTab.getByLabel('Email address').fill('other-farmer@example.test')
  await olderTab.getByLabel('Password').fill('older-password')
  await page.getByLabel('Email address').fill('farmer@example.test')
  await page.getByLabel('Password').fill('newer-password')

  // Both real tabs are same-origin, so the opener can dispatch both form
  // submissions in one JavaScript task. Tab B's one-time stale read above
  // injects localStorage's real non-atomic race, forcing both module realms to
  // claim before either 30-49ms arbitration wait can finish.
  await olderTab.evaluate(() => { (window as Window & { __farmRxHideForeignLeaseOnce: boolean }).__farmRxHideForeignLeaseOnce = true })
  await page.evaluate(() => {
    const popup = (window as Window & { __farmRxFallbackTestTab?: Window }).__farmRxFallbackTestTab
    if (!popup) throw new Error('The fallback test tab is unavailable.')
    ;(document.querySelector('form') as HTMLFormElement).requestSubmit()
    ;(popup.document.querySelector('form') as HTMLFormElement).requestSubmit()
  })
  await expect.poll(() => [olderRequestStarted, newerRequestStarted], { timeout: 10_000 }).toEqual([true, true])
  const authoritativePending = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null') as { phase?: string; email?: string } | null, authIntentKey)
  expect(authoritativePending?.phase).toBe('pending')
  expect(['farmer@example.test', 'other-farmer@example.test']).toContain(authoritativePending?.email)
  const newerRequestIsAuthoritative = authoritativePending?.email === 'farmer@example.test'
  authoritativeUserId = newerRequestIsAuthoritative ? userId : userBId
  const authoritativeSession = newerRequestIsAuthoritative ? newerSession : olderSession
  const supersededSession = newerRequestIsAuthoritative ? olderSession : newerSession
  const supersededTab = newerRequestIsAuthoritative ? olderTab : page
  const authoritativeTab = newerRequestIsAuthoritative ? page : olderTab
  const releaseSupersededRequest = newerRequestIsAuthoritative ? releaseOlderRequest : releaseNewerRequest
  const releaseAuthoritativeRequest = newerRequestIsAuthoritative ? releaseNewerRequest : releaseOlderRequest
  expect(await page.evaluate((key) => localStorage.getItem(key), authLeaseKey)).toBeNull()

  type LeaseAudit = { type: 'claim' | 'remove' | 'foreign-claim' | 'foreign-remove' | 'intent' | 'session-set' | 'session-remove'; tabId: string; token: string | null; value?: string }
  const readAudits = () => Promise.all([olderTab, page].map((tab) => tab.evaluate(() => (window as Window & { __farmRxFallbackLeaseAudit: LeaseAudit[] }).__farmRxFallbackLeaseAudit)))
  const acquisitionAudits = await readAudits()
  const lostClaimWasReclaimed = acquisitionAudits.some((entries) => entries.some((entry, claimIndex) => {
    if (entry.type !== 'claim' || !entry.token) return false
    const overwrittenAt = entries.findIndex((candidate, index) => index > claimIndex && candidate.type === 'foreign-claim' && candidate.token !== entry.token)
    return overwrittenAt > claimIndex && entries.some((candidate, index) => index > overwrittenAt && candidate.type === 'claim' && candidate.token === entry.token)
  }))
  expect(lostClaimWasReclaimed, JSON.stringify(acquisitionAudits)).toBe(true)

  releaseSupersededRequest()
  await expect(supersededTab.getByRole('alert')).toHaveText('Farm Rx could not sign you in right now. Please try again.')
  await expect(supersededTab).toHaveURL(/\/login(?:\?.*)?$/)
  await expect(authoritativeTab.getByRole('button', { name: 'Signing in…' })).toBeDisabled()
  const protectedPendingState = await page.evaluate(({ sessionKey, intentKey }) => ({
    session: JSON.parse(localStorage.getItem(sessionKey) ?? 'null') as { user?: { id?: string }; access_token?: string } | null,
    intent: JSON.parse(localStorage.getItem(intentKey) ?? 'null') as { phase?: string; email?: string },
  }), { sessionKey: authSessionKey, intentKey: authIntentKey })
  expect(protectedPendingState.intent).toMatchObject({ phase: 'pending', email: authoritativePending?.email })
  expect(protectedPendingState.intent.phase).not.toBe('accepted')
  expect(protectedPendingState.session?.user?.id).not.toBe(supersededSession.user.id)
  expect(protectedPendingState.session?.access_token).not.toBe(supersededSession.access_token)
  const supersededSessionWasPublished = (await readAudits()).flat().filter((entry) => entry.type === 'session-set').some((entry) => {
    const published = JSON.parse(entry.value ?? 'null') as { user?: { id?: string }; access_token?: string } | null
    return published?.user?.id === supersededSession.user.id || published?.access_token === supersededSession.access_token
  })
  expect(supersededSessionWasPublished).toBe(false)
  expect(await page.evaluate((key) => localStorage.getItem(key), authLeaseKey)).toBeNull()

  releaseAuthoritativeRequest()
  await Promise.all([
    expect(page.getByText('North Forty')).toBeVisible(),
    expect(olderTab.getByText('North Forty')).toBeVisible(),
  ])
  const finalState = await page.evaluate(({ sessionKey, intentKey, leaseKey }) => ({
    session: JSON.parse(localStorage.getItem(sessionKey) ?? 'null') as { user?: { id?: string }; access_token?: string },
    intent: JSON.parse(localStorage.getItem(intentKey) ?? 'null') as { phase?: string; userId?: string; sessionLineage?: string },
    lease: localStorage.getItem(leaseKey),
  }), { sessionKey: authSessionKey, intentKey: authIntentKey, leaseKey: authLeaseKey })
  expect(finalState.session.user?.id).toBe(authoritativeUserId)
  expect(finalState.session.access_token).toBe(authoritativeSession.access_token)
  expect(finalState.intent).toMatchObject({ phase: 'accepted', userId: authoritativeUserId, sessionLineage: `session-${authoritativeUserId}` })
  expect(finalState.lease).toBeNull()

  const intentWrites = (await readAudits()).flat().filter((entry) => entry.type === 'intent')
  const tokenOwners = new Map((await readAudits()).flat().filter((entry) => entry.type === 'claim' && entry.token).map((entry) => [entry.token!, entry.tabId]))
  expect(intentWrites.length).toBeGreaterThanOrEqual(3)
  expect(intentWrites.every((entry) => entry.token !== null && tokenOwners.get(entry.token) === entry.tabId)).toBe(true)
  expect(intentWrites.some((entry) => (JSON.parse(entry.value!) as { phase?: string }).phase === 'accepted')).toBe(true)
  expect(olderUnexpected).toEqual([])
  expect(newerUnexpected).toEqual([])
  await olderTab.close()
})

test('strict Supabase mocks reject unknown tables, extra parameters, wrong methods, and wrong RPC bodies', async ({ page }) => {
  const unexpected = await mockSupabase(page, [farms[0]], [], true)
  await page.goto('/login')
  await page.evaluate(async ({ base, farmId }) => {
    await Promise.allSettled([
      fetch(`${base}/rest/v1/misspelled_table?select=*`),
      fetch(`${base}/rest/v1/production_estimates?select=*&farm_id=eq.${farmId}&order=crop_year.asc%2Ccommodity_id.asc%2Cid.asc&extra=bad`),
      fetch(`${base}/rest/v1/grain_contracts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }),
      fetch(`${base}/rest/v1/rpc/operational_integrity_capability_probe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ unexpected: true }) }),
      fetch(`${base}/rest/v1/rpc/operational_integrity_capability_probe`),
    ])
  }, { base: `https://${projectRef}.supabase.co`, farmId: farmA })
  expect(unexpected).toContain('GET /rest/v1/misspelled_table')
  expect(unexpected).toContain('INVALID production_estimates query')
  expect(unexpected).toContain('INVALID grain_contracts query')
  expect(unexpected.filter((value) => value === 'INVALID operational_integrity_capability_probe body')).toHaveLength(2)
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

test('a named rep receives only proven rep-safe navigation and direct routes', async ({ page, context }, testInfo) => {
  await seedSession(context)
  const pendingKeys = await seedPendingWriteQueues(context)
  const unexpected = await mockSupabase(page, [farms[0]], [], false, 1, { memberRole: null, canViewFinancials: false, namedRep: true })
  await page.goto('/fields')
  await expect(page.getByText('North Forty')).toBeVisible()
  const navigation = testInfo.project.name === 'chromium-phone' ? page.getByRole('navigation', { name: 'Farm Rx navigation' }) : page.locator('.sidebar')
  if (testInfo.project.name === 'chromium-phone') {
    for (const label of ['Fields', 'Grain']) await expect(navigation.getByRole('link', { name: label })).toBeVisible()
    await navigation.getByRole('button', { name: 'More' }).click()
    const more = page.getByRole('region', { name: 'More Farm Rx destinations' })
    for (const label of ['Inventory', 'Profitability', 'Alerts']) await expect(more.getByRole('link', { name: label })).toBeVisible()
    for (const label of ['Equipment', 'Tasks', 'Weather', 'Field Log', 'Scouting', 'Harvest', 'Programs']) await expect(more.getByRole('link', { name: label })).toHaveCount(0)
  } else {
    for (const label of ['Fields', 'Grain', 'Inventory', 'Profitability', 'Alerts']) await expect(navigation.getByRole('link', { name: label })).toBeVisible()
    for (const label of ['Equipment', 'Tasks', 'Weather', 'Field Log', 'Scouting', 'Harvest', 'Programs']) await expect(navigation.getByRole('link', { name: label })).toHaveCount(0)
  }
  await page.goto('/tasks')
  await expect(page).toHaveURL(/\/fields$/)
  await expect(page.getByText('North Forty')).toBeVisible()
  const pending = await page.evaluate((keys) => keys.map((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { entries?: unknown[] }).map((value) => value.entries?.length ?? 0), [pendingKeys.fieldsKey, pendingKeys.equipmentKey])
  expect(pending).toEqual([1, 1])
  expect(unexpected).toEqual([])
})

test('a read-only member can view member modules but cannot enter edit routes or replay writes', async ({ page, context }, testInfo) => {
  await seedSession(context)
  const pendingKeys = await seedPendingWriteQueues(context)
  const unexpected = await mockSupabase(page, [farms[0]], [], false, 1, { memberRole: 'read_only', canViewFinancials: false, namedRep: false })
  await page.goto('/fields')
  await expect(page.getByText('North Forty')).toBeVisible()
  await expect(page.locator('fieldset[disabled][aria-label="Read-only farm data"]')).toBeVisible()
  const navigation = testInfo.project.name === 'chromium-phone' ? page.getByRole('navigation', { name: 'Farm Rx navigation' }) : page.locator('.sidebar')
  if (testInfo.project.name === 'chromium-phone') {
    await navigation.getByRole('button', { name: 'More' }).click()
    const more = page.getByRole('region', { name: 'More Farm Rx destinations' })
    await expect(more.getByRole('link', { name: 'Programs' })).toBeVisible()
    await expect(navigation.getByRole('link', { name: 'Weather' })).toHaveCount(0)
    await expect(navigation.getByRole('link', { name: 'Grain' })).toHaveCount(0)
  } else {
    await expect(navigation.getByRole('link', { name: 'Programs' })).toBeVisible()
    await expect(navigation.getByRole('link', { name: 'Weather' })).toHaveCount(0)
    await expect(navigation.getByRole('link', { name: 'Grain' })).toHaveCount(0)
  }
  await page.goto('/fields/new')
  await expect(page).toHaveURL(/\/fields$/)
  await expect(page.getByText('North Forty')).toBeVisible()
  const pending = await page.evaluate((keys) => keys.map((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { entries?: unknown[] }).map((value) => value.entries?.length ?? 0), [pendingKeys.fieldsKey, pendingKeys.equipmentKey])
  expect(pending).toEqual([1, 1])
  expect(unexpected).toEqual([])
})

test('a direct signed-in A to B replacement hides Farm A before B access validation finishes', async ({ page, context }) => {
  await seedSession(context)
  const sessionB = session(userBId)
  let bFarmRequestStarted = false
  const unexpected: string[] = []
  let releaseBFarmRequest = () => {}
  const bFarmRequest = new Promise<void>((resolve) => { releaseBFarmRequest = resolve })
  await page.route('https://*.supabase.co/**', async (route) => {
    const url = new URL(route.request().url())
    const rest = url.pathname.match(/^\/rest\/v1\/([^/]+)$/)?.[1]
    const isUserB = route.request().headers().authorization?.includes(sessionB.access_token) === true
    const ownerId = isUserB ? userBId : userId
    const accessible = [isUserB ? farms[1] : farms[0]]
    const rejectShape = async (label: string) => { unexpected.push(`INVALID ${label}`); await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: `Invalid replacement ${label}` }) }) }
    if (rest === 'farms') {
      if (isUserB && !url.searchParams.has('id')) { bFarmRequestStarted = true; await bFarmRequest }
      const farm = requestedFarm(url)
    const query: Record<string, string> = url.searchParams.has('id') ? { select: '*', id: `eq.${farm.id}` } : { select: '*', order: 'name.asc,id.asc' }
      if (route.request().method() !== 'GET' || !exactQuery(url, query)) { await rejectShape('farms query'); return }
      const response = { ...farmRow(farm), created_by: ownerId }
      await fulfillJson(route, url.searchParams.has('id') ? response : accessible.map((item) => ({ ...farmRow(item), created_by: ownerId })))
      return
    }
    if (rest === 'farm_memberships') { const farm = requestedFarm(url); if (route.request().method() !== 'GET' || !exactQuery(url, { select: 'farm_id,user_id,role,status,can_view_financials', farm_id: `eq.${farm.id}`, user_id: `eq.${ownerId}` })) { await rejectShape('membership query'); return }; await fulfillJson(route, membershipRow(farm, ownerId)); return }
    if (rest === 'farm_rep_access') { const farm = requestedFarm(url); if (route.request().method() !== 'GET' || !exactQuery(url, { select: 'farm_id,rep_user_id,enabled,revoked_at', farm_id: `eq.${farm.id}`, rep_user_id: `eq.${ownerId}` })) { await rejectShape('rep query'); return }; await fulfillJson(route, null); return }
    if (rest && Object.hasOwn(fieldsReadQueries, rest)) { const farm = requestedFarm(url); if (route.request().method() !== 'GET' || !exactQuery(url, fieldsReadQueries[rest]!(farm))) { await rejectShape(`${rest} query`); return }; await fulfillJson(route, rowsFor(rest, farm)); return }
    if (rest === 'notifications') { if (route.request().method() !== 'GET' || !exactQuery(url, { select: '*', order: 'created_at.desc,id.desc' })) { await rejectShape('notifications query'); return }; await fulfillJson(route, []); return }
    if (url.pathname === '/rest/v1/rpc/get_current_farm_access_epochs') { let body: unknown = null; try { body = route.request().postDataJSON() } catch { /* rejected below */ }; if (route.request().method() !== 'POST' || !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body as Record<string, unknown>).length !== 0) { await rejectShape('epoch body'); return }; await fulfillJson(route, accessible.map((farm) => ({ farm_id: farm.id, access_epoch: 1 }))); return }
    if (['can_access_farm', 'is_active_farm_member', 'can_edit_farm', 'can_manage_farm', 'can_read_private_financials', 'has_explicit_rep_access'].some((name) => url.pathname === `/rest/v1/rpc/${name}`)) { let body: unknown = null; try { body = route.request().postDataJSON() } catch { /* rejected below */ }; const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null; if (route.request().method() !== 'POST' || !value || Object.keys(value).length !== 1 || value.target_farm_id !== accessible[0]!.id) { await rejectShape(`${url.pathname} body`); return }; await fulfillJson(route, !url.pathname.endsWith('/has_explicit_rep_access')); return }
    if (['program_due_generation_status', 'service_due_generation_status'].some((name) => url.pathname === `/rest/v1/rpc/${name}`)) { const value = route.request().postDataJSON() as Record<string, unknown>; if (route.request().method() !== 'POST' || Object.keys(value).length !== 1 || value.p_farm_id !== accessible[0]!.id) { await rejectShape('due status body'); return }; await fulfillJson(route, { has_due: false, task_needed: false, notification_needed: false, local_date: '2026-07-12' }); return }
    if (['generate_due_program_items_v2', 'generate_due_service_tasks_v2'].some((name) => url.pathname === `/rest/v1/rpc/${name}`)) throw new Error(`False due preflight unexpectedly called ${url.pathname}`)
    if (url.pathname === '/rest/v1/rpc/operational_integrity_capability_probe') { let body: unknown = null; try { body = route.request().postDataJSON() } catch { /* rejected below */ }; const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null; if (route.request().method() !== 'POST' || !value || Object.keys(value).length !== 1 || typeof value.p_farm_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.p_farm_id)) { await rejectShape('operational_integrity_capability_probe body'); return }; await fulfillJson(route, true); return }
    if (url.pathname === '/rest/v1/rpc/generate_due_service_tasks' || url.pathname === '/rest/v1/rpc/generate_due_program_items') throw new Error(`False due preflight unexpectedly called legacy ${url.pathname}`)
    if (url.pathname === '/auth/v1/user') { await fulfillJson(route, isUserB ? sessionB.user : session().user); return }
    unexpected.push(`${route.request().method()} ${url.pathname}`)
    await route.abort('blockedbyclient')
  })

  await page.goto('/fields')
  await expect(page.getByText('North Forty')).toBeVisible()
  await page.evaluate(async ({ key, intentKey, value, intent }) => {
    localStorage.setItem(intentKey, JSON.stringify(intent))
    localStorage.setItem(key, JSON.stringify(value))
    const channel = new BroadcastChannel(key)
    channel.postMessage({ event: 'SIGNED_IN', session: value })
    await new Promise((resolve) => setTimeout(resolve, 0))
    channel.close()
  }, { key: `farm-rx-auth:${projectRef}`, intentKey: `farm-rx-auth-intent:v1:${projectRef}`, value: sessionB, intent: { version: 1, nonce: 'playwright-session-b', phase: 'accepted', userId: userBId, sessionLineage: `session-${userBId}`, startedAtMs: Date.now() } })
  await expect.poll(() => bFarmRequestStarted).toBe(true)
  await expect(page.getByText('North Forty')).toBeHidden()
  await expect(page.getByLabel('Active farm')).toBeHidden()
  await expect(page.getByText('Opening your farm…')).toBeVisible()
  releaseBFarmRequest()
  await expect(page.getByText('South Bottom')).toBeVisible()
  await expect(page.getByText('North Forty')).toBeHidden()
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

test('revoked farm work is quarantined, exportable, and never returned to an active queue', async ({ page, context }) => {
  await seedSession(context)
  const operationId = '00000000-0000-4000-8000-000000000043'
  const queueKey = `farm-rx-notifications-write-queue:v1:${projectRef}:${userId}:${farmA}`
  const recoveryKey = `farm-rx-revoked-work-recovery:v1:${projectRef}:${userId}`
  await context.addInitScript(({ accessKey, access, queueKey: targetQueue, queue }) => {
    localStorage.setItem(accessKey, JSON.stringify(access))
    localStorage.setItem(targetQueue, JSON.stringify(queue))
  }, {
    accessKey: `farm-rx-access:v1:${projectRef}:${userId}`,
    access: { version: 1, userId, farms: [farmRow(farms[0])], selectedFarmId: farmA, validatedAt: now },
    queueKey,
    queue: { version: 1, entries: [{ version: 1, module: 'notifications', kind: 'markRead', operationId, userId, farmId: farmA, enqueuedAt: now, ids: [notificationA] }] },
  })
  const unexpected = await mockSupabase(page, [])
  await page.goto('/fields')
  await expect(page.getByRole('heading', { name: 'Saved work needs your review' })).toBeVisible()
  await expect(page.getByText(/will never send them automatically/i)).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), queueKey)).toBeNull()
  const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { records?: Array<{ payload?: { entries?: Array<{ operationId?: string }> } }> }, recoveryKey)
  expect(saved.records).toHaveLength(1)
  expect(saved.records?.[0]?.payload?.entries?.[0]?.operationId).toBe(operationId)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export copy' }).click()
  expect((await download).suggestedFilename()).toMatch(/^farm-rx-recovery-.*\.json$/)
  await page.getByRole('button', { name: 'Dismiss' }).click()
  await page.getByRole('button', { name: 'Yes, dismiss' }).click()
  await expect(page.getByRole('heading', { name: 'Saved work needs your review' })).toBeHidden()
  expect(await page.evaluate((key) => localStorage.getItem(key), queueKey)).toBeNull()
  expect(await page.evaluate((key) => (JSON.parse(localStorage.getItem(key) ?? '{}') as { records?: unknown[] }).records?.length, recoveryKey)).toBe(0)
  expect(unexpected).toEqual([])
})

test('a stale tab cannot recreate revoked queue or readable cache work after regrant', async ({ page, context }) => {
  await seedSession(context)
  const staleTab = await context.newPage()
  const notifications = [{ id: notificationA, farm_id: farmA, user_id: userId, category: 'general', title: 'Stale tab alert', body: null, link: '/notifications', dedupe_key: null, read_at: null, created_by: userId, created_at: now }]
  await mockSupabase(page, [farms[0]], notifications)
  await mockSupabase(staleTab, [farms[0]], notifications)
  await Promise.all([page.goto('/fields'), staleTab.goto('/fields')])
  await Promise.all([expect(page.getByText('North Forty')).toBeVisible(), expect(staleTab.getByText('North Forty')).toBeVisible()])
  const databaseName = `farm-rx-offline-v1-${projectRef}`
  const cacheKey = `${projectRef}:${userId}:${farmA}:fields`
  const staleCache = await staleTab.evaluate(async ({ databaseName: name, key }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try { return await new Promise<Record<string, unknown>>((resolve, reject) => { const request = database.transaction('workspaces').objectStore('workspaces').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) } finally { database.close() }
  }, { databaseName, key: cacheKey })
  expect(staleCache).toMatchObject({ version: 2, farmId: farmA, serverEpoch: 1 })
  expect(staleCache.generation).toEqual(expect.any(Number))
  expect(staleCache.fenceToken).toEqual(expect.any(String))

  await staleTab.goto('/notifications')
  await expect(staleTab.getByText('Stale tab alert')).toBeVisible()
  let releasePatch!: () => void
  const patchRelease = new Promise<void>((resolve) => { releasePatch = resolve })
  let sawPatch!: () => void
  const patchStarted = new Promise<void>((resolve) => { sawPatch = resolve })
  let patchAttempts = 0
  await staleTab.route(/\/rest\/v1\/rpc\/mark_notifications_read(?:\?|$)/, async (route) => {
    if (route.request().method() !== 'POST') { await route.fallback(); return }
    patchAttempts += 1
    sawPatch()
    await patchRelease
    await route.abort('timedout')
  })
  const click = staleTab.locator('.notification-row').filter({ hasText: 'Stale tab alert' }).getByRole('button', { name: 'Mark read' }).click()
  await patchStarted

  await page.unroute('https://*.supabase.co/**')
  await mockSupabase(page, [], notifications)
  const accessKey = `farm-rx-access:v1:${projectRef}:${userId}`
  await page.evaluate((key) => { const value = JSON.parse(localStorage.getItem(key) ?? '{}'); value.validatedAt = '2020-01-01T00:00:00.000Z'; localStorage.setItem(key, JSON.stringify(value)) }, accessKey)
  await page.reload()
  const fenceKey = `farm-rx-revocation-fence:v1:${projectRef}:${userId}:${farmA}`
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { revoked?: boolean; generation?: number }, fenceKey)).toMatchObject({ revoked: true })
  await page.evaluate((key) => localStorage.removeItem(key), fenceKey)

  releasePatch()
  await click
  const queueKey = `farm-rx-notifications-write-queue:v1:${projectRef}:${userId}:${farmA}`
  expect(await staleTab.evaluate((key) => localStorage.getItem(key), queueKey)).toBeNull()
  await staleTab.evaluate(async ({ databaseName: name, value }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(name); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try { const transaction = database.transaction('workspaces', 'readwrite'); transaction.objectStore('workspaces').put(value); await new Promise<void>((resolve, reject) => { transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error) }) } finally { database.close() }
  }, { databaseName, value: staleCache })

  await page.unroute('https://*.supabase.co/**')
  await mockSupabase(page, [farms[0]], notifications, false, 3)
  await page.evaluate((key) => { const value = JSON.parse(localStorage.getItem(key) ?? '{}'); value.validatedAt = '2020-01-01T00:00:00.000Z'; localStorage.setItem(key, JSON.stringify(value)) }, accessKey)
  await page.reload()
  await page.waitForTimeout(750)
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { revoked?: boolean; generation?: number }, fenceKey)).toMatchObject({ revoked: false })
  expect((await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { generation?: number }, fenceKey)).generation).toBeGreaterThanOrEqual(2)

  await context.setOffline(true)
  await staleTab.goto('/fields')
  await expect(staleTab.getByText('North Forty')).toBeHidden()
  expect(patchAttempts).toBe(1)
  expect(await staleTab.evaluate((key) => localStorage.getItem(key), queueKey)).toBeNull()
  await context.setOffline(false)
  await staleTab.close()
})

test('a delayed old farm read cannot overwrite the cache after revoke and regrant', async ({ page, context }) => {
  await seedSession(context)
  const staleTab = await context.newPage()
  await mockSupabase(page, [farms[0]], [], false, 1)
  await mockSupabase(staleTab, [farms[0]], [], false, 1)
  await staleTab.goto('/fields')
  await expect(staleTab.getByText('North Forty')).toBeVisible()

  let releaseRead!: () => void
  const readRelease = new Promise<void>((resolve) => { releaseRead = resolve })
  let sawRead!: () => void
  const readStarted = new Promise<void>((resolve) => { sawRead = resolve })
  await staleTab.route(/\/rest\/v1\/fields(?:\?|$)/, async (route) => {
    if (route.request().method() !== 'GET') { await route.fallback(); return }
    sawRead()
    await readRelease
    await route.fallback()
  })
  const staleReload = staleTab.reload()
  await readStarted

  const accessKey = `farm-rx-access:v1:${projectRef}:${userId}`
  const fenceKey = `farm-rx-revocation-fence:v1:${projectRef}:${userId}:${farmA}`
  await page.unroute('https://*.supabase.co/**')
  await mockSupabase(page, [], [], false, 2)
  await page.goto('/fields')
  await page.evaluate((key) => { const value = JSON.parse(localStorage.getItem(key) ?? '{}'); value.validatedAt = '2020-01-01T00:00:00.000Z'; localStorage.setItem(key, JSON.stringify(value)) }, accessKey)
  await page.reload()
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { revoked?: boolean }, fenceKey)).toMatchObject({ revoked: true })

  await page.unroute('https://*.supabase.co/**')
  await mockSupabase(page, [farms[0]], [], false, 3)
  await page.evaluate((key) => { const value = JSON.parse(localStorage.getItem(key) ?? '{}'); value.validatedAt = '2020-01-01T00:00:00.000Z'; localStorage.setItem(key, JSON.stringify(value)) }, accessKey)
  await page.reload()
  await expect(page.getByText('North Forty')).toBeVisible()
  const currentFence = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { token: string; serverEpoch: number }, fenceKey)
  expect(currentFence.serverEpoch).toBe(3)

  await staleTab.unroute('https://*.supabase.co/**')
  await mockSupabase(staleTab, [farms[0]], [], false, 3)
  releaseRead()
  await staleReload
  await expect(staleTab.getByText('North Forty')).toBeVisible()
  const cachedFence = await page.evaluate(async ({ databaseName, key }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open(databaseName); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    try { return await new Promise<{ fenceToken?: string; serverEpoch?: number }>((resolve, reject) => { const request = database.transaction('workspaces').objectStore('workspaces').get(key); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) }) } finally { database.close() }
  }, { databaseName: `farm-rx-offline-v1-${projectRef}`, key: `${projectRef}:${userId}:${farmA}:fields` })
  expect(cachedFence).toMatchObject({ fenceToken: currentFence.token, serverEpoch: 3 })
  await staleTab.close()
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
  for (const directive of ['img-src', 'connect-src', 'frame-src']) expect(csp.match(new RegExp(`${directive}[^;]*`))?.[0]).not.toContain('tradingview')
  expect(csp.match(/frame-src[^;]*/)?.[0]).toBe("frame-src 'self'")
  expect(frameHeaders['Content-Security-Policy']).toContain("default-src 'none'")
  expect(csp).not.toContain("script-src *")
  expect(headers['Referrer-Policy']).toBe('no-referrer')
  expect(headers['X-Content-Type-Options']).toBe('nosniff')
  expect(headers['X-Frame-Options']).toBe('DENY')
})

test('installed PWA metadata supplies local raster and Apple icons', async () => {
  const vite = readFileSync('vite.config.ts', 'utf8'); const html = readFileSync('index.html', 'utf8')
  expect(vite).toContain("src: '/farm-rx-icon-192.png'"); expect(vite).toContain("src: '/farm-rx-icon-512.png'")
  expect(html).toContain('apple-touch-icon'); expect(readFileSync('public/farm-rx-icon-192.png').byteLength).toBeGreaterThan(100); expect(readFileSync('public/farm-rx-icon-512.png').byteLength).toBeGreaterThan(100); expect(readFileSync('public/apple-touch-icon.png').byteLength).toBeGreaterThan(100)
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
