import { expect, test, type BrowserContext, type Page, type Request, type Route } from '@playwright/test'
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

test('password recovery reports a failed storage preflight without claiming an email was sent', async ({ page }) => {
  test.skip(process.env.VITE_PASSWORD_EMAIL_DELIVERY_ENABLED !== 'true', 'This journey requires the guarded email-delivery configuration.')
  const resetRequests: string[] = []
  page.on('request', (request) => { if (request.url().includes('/auth/v1/recover')) resetRequests.push(request.url()) })
  await page.addInitScript(({ key }) => {
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = function guardedSetItem(storageKey: string, value: string) {
      if (storageKey === key) throw new DOMException('Storage denied', 'QuotaExceededError')
      return setItem.call(this, storageKey, value)
    }
  }, { key: `farm-rx-password-recovery-cleanup:v1:${projectRef}` })
  await page.goto('/login?forgotPassword=1')
  await page.getByLabel('Email address').fill('farmer@example.test')
  await page.getByRole('button', { name: 'Send reset link' }).click()
  await expect(page.getByRole('alert')).toContainText('cannot safely start password recovery in this browser')
  await expect(page.getByRole('status')).toHaveCount(0)
  expect(resetRequests).toEqual([])
})

function session(id = userId, lineage = `session-${id}`) {
  const expiresAt = Math.floor(Date.now() / 1000) + 86_400
  const payload = btoa(JSON.stringify({ sub: id, aud: 'authenticated', exp: expiresAt, session_id: lineage })).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
  return {
    access_token: `eyJhbGciOiJub25lIn0.${payload}.c2lnbmF0dXJl`, refresh_token: `offline-test-refresh-${id}`, expires_in: 86_400, expires_at: expiresAt, token_type: 'bearer',
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
const farmPatches: Array<Record<string, unknown>> = []
const farmRegions: Record<string, string | null> = {}
function farmRow(farm: FarmFixture, shareWithRep = false, marketRegion: string | null = null) { return { id: farm.id, name: farm.name, share_with_rep: shareWithRep, time_zone: 'America/Chicago', market_region: marketRegion, created_by: userId, created_at: now, updated_at: now } }
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

// Exact read shapes for the Equipment & Tasks workspace and the Field Log (FD-1: Today reads them through the pure snapshot path).
const equipmentReadQueries: Record<string, (farm: FarmFixture) => Record<string, string>> = {
  equipment: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'name.asc' }),
  equipment_meter_readings: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'read_on.asc,id.asc' }),
  equipment_service_intervals: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'name.asc' }),
  equipment_service_log: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'service_date.desc,id.asc' }),
  equipment_service_due: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'equipment_id.asc' }),
  farm_member_names: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'display_name.asc' }),
  farm_tasks: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'due_on.asc,id.asc' }),
  field_log_entries: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'observed_on.desc,created_at.desc,id.asc' }),
  scouting_notes: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'observed_on.desc,created_at.desc,id.asc' }),
  scouting_photos: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'created_at.asc,id.asc' }),
  inventory_products: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'name.asc,id.asc' }),
  inventory_receipts: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'created_at.asc,id.asc' }),
  inventory_receipt_lines: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'receipt_id.asc,id.asc' }),
  inventory_adjustments: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'adjusted_at.asc,id.asc' }),
  application_records: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'application_date.asc,id.asc' }),
  application_products: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'application_id.asc,id.asc' }),
  program_application_products: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'application_record_id.asc,sequence.asc' }),
  inventory_on_hand: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'product_id.asc' }),
  rup_application_completeness: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'application_id.asc,application_product_id.asc' }),
}
const equipmentA = '00000000-0000-4000-8000-000000000201'
const intervalA = '00000000-0000-4000-8000-000000000301'
const taskA = '00000000-0000-4000-8000-000000000401'
const passA = '00000000-0000-4000-8000-000000000601'
const passTaskA = '00000000-0000-4000-8000-000000000408'
// The pass's generated task is dated on the farm's current day (the fixture farm keeps Chicago time), so the journeys prove the
// due-today tile against the real clock; a task dated earlier would list the pass as overdue and earn no tile (FD-029).
const farmToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const productA = '00000000-0000-4000-8000-000000000701'
function todayRows(farm: FarmFixture): Readonly<Partial<Record<string, unknown[]>>> {
  return {
    // FD-2 grain line: 5,320 of the 15,200 bu estimate signed (35%); a plan whose cumulative percent is 40% from March on; two
    // farmer-entered Cargill bids (4.07 then 4.12) and a newer USDA feed row that must never count as a local bid.
    grain_contracts: [{ id: '00000000-0000-4000-8000-000000000061', farm_id: farm.id, crop_year: 2026, commodity_id: commodityId, operating_entity_id: null, enterprise_label: null, contract_type: 'forward_cash', buyer: 'Cargill Olney', bushels: 5320, futures_price: null, basis: null, cash_price: 4.2, delivery_start: '2026-10-01', delivery_end: '2026-11-30', contract_number: null, premium_cents_per_bu: 0, notes: null, created_at: now, updated_at: now }],
    marketing_plan_targets: [['00000000-0000-4000-8000-000000000071', '2026-01-01', 10], ['00000000-0000-4000-8000-000000000072', '2026-02-01', 15], ['00000000-0000-4000-8000-000000000073', '2026-03-01', 15]].map(([id, target_month, target_pct_of_production]) => ({ id, farm_id: farm.id, crop_year: 2026, commodity_id: commodityId, operating_entity_id: null, enterprise_label: null, target_month, target_pct_of_production, target_price: null, breakeven_relative_pct: null, deadline: null, notes: null, created_at: now, updated_at: now })),
    cash_bids: [
      { id: '00000000-0000-4000-8000-000000000081', farm_id: farm.id, elevator: 'Cargill Olney', commodity_id: commodityId, bid_date: '2026-07-10', basis: -0.35, cash_price: 4.07, delivery_start: null, delivery_end: null, notes: null, created_at: now, updated_at: now },
      { id: '00000000-0000-4000-8000-000000000082', farm_id: farm.id, elevator: 'Cargill Olney', commodity_id: commodityId, bid_date: '2026-07-14', basis: -0.3, cash_price: 4.12, delivery_start: null, delivery_end: null, notes: null, created_at: now, updated_at: now },
      { id: '00000000-0000-4000-8000-000000000083', farm_id: farm.id, elevator: 'Cedar Rapids', commodity_id: commodityId, bid_date: '2026-07-15', basis: -0.1, cash_price: 4.5, delivery_start: null, delivery_end: null, notes: '[USDA MARS 2850 · Iowa] basis range -0.15 to -0.05', feed_source: 'usda_mars', feed_report_id: '2850', feed_geography: 'IA', created_at: now, updated_at: now },
    ],
    equipment: [{ id: equipmentA, farm_id: farm.id, name: 'John Deere 8R 340', category: 'tractor', make: null, model: null, model_year: null, serial_or_vin: null, purchase_date: null, purchase_price: null, meter_unit: 'hours', warranty_expires_on: null, warranty_notes: null, status: 'active', notes: null, created_by: userId, created_at: now, updated_at: now }],
    equipment_meter_readings: [{ id: '00000000-0000-4000-8000-000000000901', farm_id: farm.id, equipment_id: equipmentA, reading: 262, read_on: '2026-07-14', source: 'manual', notes: null, created_by: userId, created_at: now, updated_at: now }],
    equipment_service_intervals: [{ id: intervalA, farm_id: farm.id, equipment_id: equipmentA, name: 'Engine oil', every_meter: 250, every_months: null, last_done_on: null, last_done_reading: 0, is_active: true, created_by: userId, created_at: now, updated_at: now }],
    equipment_service_due: [{ farm_id: farm.id, equipment_id: equipmentA, interval_id: intervalA, reason: 'meter', overdue_amount: 12 }],
    farm_tasks: [
      { id: taskA, farm_id: farm.id, title: 'Fix the planter', details: null, status: 'todo', priority: 'normal', assigned_to: null, due_on: '2026-07-13', field_id: null, equipment_id: null, source: 'manual', interval_id: null, interval_cycle_key: null, program_assigned_pass_id: null, program_cycle_key: null, completed_by: null, completed_at: null, created_by: userId, created_at: now, updated_at: now },
      // The due-generation function's own task for the overdue interval: the same work as the service-due row, never listed twice.
      { id: '00000000-0000-4000-8000-000000000402', farm_id: farm.id, title: 'Engine oil · John Deere 8R 340', details: null, status: 'todo', priority: 'normal', assigned_to: null, due_on: '2026-07-14', field_id: null, equipment_id: equipmentA, source: 'service_interval', interval_id: intervalA, interval_cycle_key: 'meter:1', program_assigned_pass_id: null, program_cycle_key: null, completed_by: null, completed_at: null, created_by: userId, created_at: now, updated_at: now },
      { id: passTaskA, farm_id: farm.id, title: 'Corn pass 2', details: null, status: 'todo', priority: 'normal', assigned_to: null, due_on: farmToday(), field_id: null, equipment_id: null, source: 'program', interval_id: null, interval_cycle_key: null, program_assigned_pass_id: passA, program_cycle_key: 'corn-pass-2-cycle', completed_by: null, completed_at: null, created_by: userId, created_at: now, updated_at: now },
    ],
    // The Inventory shelf's own low-on-hand rule (five units or fewer) is what Today lists as Low inventory.
    inventory_products: [{ id: productA, farm_id: farm.id, product_kind: 'chemical', name: 'Atrazine 4L', inventory_unit: 'gal', epa_registration_number: null, is_restricted_use: false, signal_word: null, restricted_entry_interval_hours: null, preharvest_interval_hours: null, max_label_rate: null, max_label_rate_unit: null, max_label_rate_basis: null, commodity_id: null, variety_name: null, fertilizer_analysis: null, manufacturer: null, is_active: true, created_at: now, updated_at: now }],
    inventory_on_hand: [{ farm_id: farm.id, product_id: productA, product_kind: 'chemical', inventory_unit: 'gal', received_quantity: 4, adjusted_quantity: 0, used_quantity: 0, on_hand_quantity: 4, weighted_known_receipt_cost_per_inventory_unit: null }],
  }
}
function todayNotifications(farm: FarmFixture, recipient = userId) {
  return [
    { id: '00000000-0000-4000-8000-000000000501', farm_id: farm.id, user_id: recipient, category: 'task', title: 'Corn pass 2 is due', body: null, link: `/programs?pass=${passA}`, dedupe_key: null, read_at: null, created_by: recipient, created_at: now },
    { id: '00000000-0000-4000-8000-000000000502', farm_id: farm.id, user_id: recipient, category: 'general', title: 'Corn hit your $4.60 target', body: null, link: '/grain', dedupe_key: null, read_at: null, created_by: recipient, created_at: '2026-07-15T11:00:00.000Z' },
    { id: '00000000-0000-4000-8000-000000000503', farm_id: farmB, user_id: recipient, category: 'general', title: 'River Bend corn hit $4.80', body: null, link: '/grain', dedupe_key: null, read_at: null, created_by: recipient, created_at: '2026-07-15T11:30:00.000Z' },
  ]
}
const fieldsReadQueries: Record<string, (farm: FarmFixture) => Record<string, string>> = {
  entities: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'name.asc' }),
  fields: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'name.asc' }),
  arrangements: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'effective_from.asc' }),
  crop_assignments: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_year.asc,planting_sequence.asc' }),
  commodities: () => ({ select: '*', is_active: 'eq.true', order: 'name.asc' }),
}
// Exact read shapes for the Programs workspace (FD-2: the "Pass due today" tile lands on Programs). Passes and products are read
// only when a program exists, so an empty farm never requests them. Three tables Programs shares with other modules are read
// through a narrower select and are accepted by shape in their own branches below.
const programsReadQueries: Record<string, (farm: FarmFixture) => Record<string, string>> = {
  programs: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'name.asc,id.asc' }),
  program_assignment_tracker: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'field_name.asc,crop_year.asc,planting_sequence.asc,program_name_snapshot.asc' }),
  program_assignment_costs: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'assignment_id.asc' }),
  program_crop_cost_rollups: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_assignment_id.asc' }),
  program_inventory_matches: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'assigned_product_id.asc,inventory_product_id.asc' }),
}
const programsSharedShapes: Record<string, (farm: FarmFixture) => Record<string, string>> = {
  crop_assignments: (farm) => ({ select: 'id,farm_id,field_id,commodity_id,crop_year,planting_sequence,planting_date,planted_acres,fields!inner(name,latitude,longitude,is_active),commodities!inner(name)', farm_id: `eq.${farm.id}`, 'fields.is_active': 'eq.true', order: 'crop_year.asc,planting_sequence.asc' }),
  application_records: (farm) => ({ select: 'id,farm_id,crop_assignment_id,application_date,applied_acres,status', farm_id: `eq.${farm.id}`, status: 'neq.voided', order: 'application_date.desc,id.asc' }),
  inventory_products: (farm) => ({ select: 'id,farm_id,name,inventory_unit,is_active', farm_id: `eq.${farm.id}`, order: 'name.asc,id.asc' }),
}
const grainReadQueries: Record<string, (farm: FarmFixture) => Record<string, string> | Array<Record<string, string>>> = {
  production_estimates: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_year.asc,commodity_id.asc,id.asc' }),
  grain_contracts: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_year.asc,commodity_id.asc,delivery_start.asc,id.asc' }),
  grain_contract_deliveries: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'delivered_on.asc,id.asc' }),
  marketing_plan_targets: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_year.asc,commodity_id.asc,target_month.asc,id.asc' }),
  insurance_units: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_year.asc,commodity_id.asc,unit_name.asc,id.asc' }),
  grain_bins: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'name.asc,id.asc' }),
  bin_inventory: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_year.asc,commodity_id.asc,id.asc' }),
  bin_transactions: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'occurred_on.desc,created_at.desc,id.desc' }),
  // GL-2 repair: two bounded slices, newest first -- the recent window, and the farm's own bids so they
  // survive however much USDA feed history sits in front of them.
  cash_bids: (farm) => [
    { select: '*', farm_id: `eq.${farm.id}`, order: 'bid_date.desc,id.desc', limit: '750' },
    { select: '*', farm_id: `eq.${farm.id}`, feed_source: 'is.null', or: '(notes.is.null,notes.not.like."[USDA MARS %")', order: 'bid_date.desc,id.desc', limit: '250' },
  ],
  // GL-3b capability probe: one indexed read of at most one row, whose contents are not used.
  grain_contract_audit: (farm) => ({ select: 'id', farm_id: `eq.${farm.id}`, limit: '1' }),
  // LD-1: newest first and bounded, and its own capability probe -- the table's absence is the one
  // truthful signal that the Loads tab cannot save anything.
  // LD-2 adds a second, narrower read for the "from loads" harvest figure. Both shapes are listed
  // rather than the table being claimed by name: matching by name would let any future grain_loads
  // query pass unexamined, which is the mock defect LD-1 recorded against `equipment`.
  grain_loads: (farm) => [
    { select: '*', farm_id: `eq.${farm.id}`, order: 'load_date.desc,created_at.desc,id.desc', limit: '500' },
    { select: '*', farm_id: `eq.${farm.id}`, effect_harvest: 'eq.true', voided_at: 'is.null', order: 'load_date.desc', limit: '5001' },
    // LD-2's capability probe: it has to name a column the migration adds, because select('*') on
    // this table succeeds against an LD-1 database and tells the client nothing.
    { select: 'id,effect_harvest', farm_id: `eq.${farm.id}`, limit: '1' },
  ],

  usda_report_dates: () => ({ select: '*', order: 'report_date.asc,id.asc' }),
  usda_market_reports: () => ({ select: '*', order: 'report_id.asc' }),
  marketing_alert_rules: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_year.asc,commodity_id.asc,created_at.asc,id.asc' }),
  firm_offers: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_year.asc,commodity_id.asc,created_at.asc,id.asc' }),
  grain_alert_settings: (farm) => ({ select: '*', farm_id: `eq.${farm.id}` }),
  grain_sale_limits: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_year.asc,commodity_id.asc,id.asc' }),
  grain_carry_settings: (farm) => ({ select: '*', farm_id: `eq.${farm.id}` }),
  grain_carry_grids: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'production_estimate_id.asc' }),
}
const profitabilityReadQueries: Record<string, (farm: FarmFixture) => Record<string, string>> = {
  crop_budgets: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'crop_year.asc,commodity_id.asc,id.asc' }),
  budget_cost_lines: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'budget_id.asc,sort_order.asc' }),
  profitability_matrix_steps: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'budget_id.asc,axis.asc,step_order.asc' }),
  budget_field_allocations: (farm) => ({ select: '*', farm_id: `eq.${farm.id}`, order: 'budget_id.asc,crop_assignment_id.asc' }),
  equipment: (farm) => ({ select: 'id,farm_id,name,status', farm_id: `eq.${farm.id}`, order: 'name.asc,id.asc' }),
}
// GL-3b: what the browser actually asked the server to change, so a journey can prove the payload
// rather than only the screen. Cleared by the test that reads it.
const contractRepairCalls: Array<{ rpc: string; body: Record<string, unknown> }> = []
// LD-1: what the browser actually asked the server to record, so a journey can prove the payload --
// in particular that it sends no commodity and no crop year, because the origin decides both.
const loadRecordCalls: Array<{ rpc: string; body: Record<string, unknown> }> = []

function grainRows(table: string, farm: FarmFixture) {
  if (table === 'production_estimates') return [{ id: '00000000-0000-4000-8000-000000000051', farm_id: farm.id, crop_year: 2026, commodity_id: commodityId, operating_entity_id: null, enterprise_label: null, planted_acres: 80, aph_yield: 190, expected_bushels: 15_200, actual_bushels: null, drives_math: 'projected', notes: null, created_at: now, updated_at: now }]
  return table === 'grain_alert_settings' || table === 'grain_carry_settings' ? null : []
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) })
}

function bearerUserId(request: Request): string | null {
  const bearer = /^Bearer ([^.]+\.([^.]+)\.[^.]+)$/i.exec(request.headers().authorization ?? '')
  if (!bearer) return null
  try { const payload = JSON.parse(Buffer.from(bearer[2]!, 'base64url').toString('utf8')) as { sub?: unknown; aud?: unknown }; return payload.aud === 'authenticated' && typeof payload.sub === 'string' ? payload.sub : null } catch { return null }
}

async function mockSupabase(page: Page, accessible = farms, notifications: unknown[] = [], emptyUnknownReads = false, accessEpoch = 1, profile = ownerProfile, activeUser: string | (() => string) = userId, removedFarmEpochs: Readonly<Record<string, Readonly<Record<string, number>>>> = {}, moduleRows: Readonly<Partial<Record<string, unknown[]>>> = {}) {
  const unexpected: string[] = []
  // GL-1: a saved market region lives only for the test that saved it.
  for (const key of Object.keys(farmRegions)) delete farmRegions[key]
  farmPatches.length = 0
  await page.route('https://*.supabase.co/**', async (route) => {
    const url = new URL(route.request().url())
    const rest = url.pathname.match(/^\/rest\/v1\/([^/]+)$/)?.[1]
    const activeUserId = typeof activeUser === 'function' ? activeUser() : activeUser
    const rejectShape = async (label: string) => { unexpected.push(`INVALID ${label}`); await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: `Invalid mocked ${label}` }) }) }
    if (rest === 'farms') {
      // GL-1: the Farm settings page saves the market region with an update fenced on the row's updated_at (like the privacy toggle).
      if (route.request().method() === 'PATCH') {
        const farm = requestedFarm(url); const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
        if (!exactQuery(url, { id: `eq.${farm.id}`, updated_at: `eq.${now}`, select: '*' }) || Object.keys(body).join() !== 'market_region' || !route.request().headers()['x-farm-rx-expected-user-id']) { await rejectShape('farms patch'); return }
        farmPatches.push(body)
        farmRegions[farm.id] = typeof body.market_region === 'string' ? body.market_region : null
        await fulfillJson(route, { ...farmRow(farm, profile.namedRep, farmRegions[farm.id]), updated_at: '2026-07-15T12:30:00.000Z' })
        return
      }
      if (route.request().method() !== 'GET') { await rejectShape('farms method'); return }
      if (url.searchParams.has('id')) { const farm = requestedFarm(url); if (!exactQuery(url, { select: '*', id: `eq.${farm.id}` })) { await rejectShape('farms selected query'); return }; await fulfillJson(route, farmRow(farm, profile.namedRep, farmRegions[farm.id] ?? null)) }
      else { if (!exactQuery(url, { select: '*', order: 'name.asc,id.asc' })) { await rejectShape('farms list query'); return }; await fulfillJson(route, accessible.map((farm) => farmRow(farm, profile.namedRep, farmRegions[farm.id] ?? null))) }
      return
    }
    if (rest === 'farm_memberships' && url.searchParams.get('select') === 'role') { const farm = requestedFarm(url); if (route.request().method() !== 'GET' || !exactQuery(url, { select: 'role', farm_id: `eq.${farm.id}`, user_id: `eq.${activeUserId}` })) { await rejectShape('farm_memberships viewer query'); return }; await fulfillJson(route, profile.memberRole === null ? null : { role: profile.memberRole }); return }
    if (rest === 'farm_memberships') { const farm = requestedFarm(url); if (route.request().method() !== 'GET' || !exactQuery(url, { select: 'farm_id,user_id,role,status,can_view_financials', farm_id: `eq.${farm.id}`, user_id: `eq.${activeUserId}` })) { await rejectShape('farm_memberships query'); return }; await fulfillJson(route, membershipRow(farm, activeUserId, profile)); return }
    if (rest === 'farm_rep_access') { const farm = requestedFarm(url); if (route.request().method() !== 'GET' || !exactQuery(url, { select: 'farm_id,rep_user_id,enabled,revoked_at', farm_id: `eq.${farm.id}`, rep_user_id: `eq.${activeUserId}` })) { await rejectShape('farm_rep_access query'); return }; await fulfillJson(route, profile.namedRep ? { farm_id: farm.id, rep_user_id: activeUserId, enabled: true, revoked_at: null } : null); return }
    if (emptyUnknownReads && rest && Object.hasOwn(programsSharedShapes, rest) && route.request().method() === 'GET' && exactQuery(url, programsSharedShapes[rest]!(requestedFarm(url)))) { await fulfillJson(route, []); return }
    if (emptyUnknownReads && rest && Object.hasOwn(programsReadQueries, rest)) { const farm = requestedFarm(url); if (route.request().method() !== 'GET' || !exactQuery(url, programsReadQueries[rest]!(farm))) { await rejectShape(`${rest} query`); return }; await fulfillJson(route, moduleRows[rest] ?? []); return }
    if (rest && Object.hasOwn(fieldsReadQueries, rest)) { const farm = requestedFarm(url); if (route.request().method() !== 'GET' || !exactQuery(url, fieldsReadQueries[rest]!(farm))) { await rejectShape(`${rest} query`); return }; await fulfillJson(route, rowsFor(rest, farm)); return }
    // LD-1: the farm's trucks, read only while the Loads form is open -- never as part of the grain
    // workspace, because Today serves its front door from that load and a named rep's Today must make
    // no equipment read at all. Matched by exact shape rather than by table name: Equipment and
    // Profitability read this table too, so it has to sit ahead of the handler that claims it by name.
    if (rest === 'equipment' && route.request().method() === 'GET' && exactQuery(url, { select: 'id,name', farm_id: `eq.${requestedFarm(url).id}`, category: 'eq.truck', status: 'eq.active', order: 'name.asc,id.asc' })) { await fulfillJson(route, moduleRows.load_trucks ?? []); return }
    if (rest && Object.hasOwn(equipmentReadQueries, rest)) {
      const farm = requestedFarm(url)
      // Profitability reads equipment names through a narrower exact shape than the Equipment workspace.
      const profitabilityEquipment = rest === 'equipment' && exactQuery(url, { select: 'id,farm_id,name,status', farm_id: `eq.${farm.id}`, order: 'name.asc,id.asc' })
      if (route.request().method() !== 'GET' || !(profitabilityEquipment || exactQuery(url, equipmentReadQueries[rest]!(farm)))) { await rejectShape(`${rest} query`); return }
      await fulfillJson(route, moduleRows[rest] ?? []); return
    }
    if (rest === 'notifications') { if (route.request().method() !== 'GET' || !exactQuery(url, { select: '*', order: 'created_at.desc,id.desc' })) { await rejectShape('notifications query'); return }; await fulfillJson(route, notifications); return }
    if (url.pathname === '/rest/v1/rpc/get_current_farm_access_epochs') {
      let body: unknown = null; try { body = route.request().postDataJSON() } catch { /* rejected below */ }
      if (route.request().method() !== 'POST' || !body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body as Record<string, unknown>).length !== 0) { await rejectShape('get_current_farm_access_epochs body'); return }
      await fulfillJson(route, accessible.map((farm) => ({ farm_id: farm.id, access_epoch: accessEpoch })))
      return
    }
    if (url.pathname === '/rest/v1/rpc/get_removed_farm_access_epoch') {
      let body: unknown = null; try { body = route.request().postDataJSON() } catch { /* rejected below */ }
      const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
      const targetFarmId = value?.target_farm_id
      const callerId = bearerUserId(route.request())
      const callerEpochs = callerId && Object.hasOwn(removedFarmEpochs, callerId) ? removedFarmEpochs[callerId] : undefined
      const removedEpoch = typeof targetFarmId === 'string' && callerEpochs ? callerEpochs[targetFarmId] : undefined
      if (route.request().method() !== 'POST' || !value || Object.keys(value).length !== 1 || typeof targetFarmId !== 'string' || !farms.some((farm) => farm.id === targetFarmId) || accessible.some((farm) => farm.id === targetFarmId) || !callerId || !callerEpochs || !Object.hasOwn(callerEpochs, targetFarmId) || !Number.isSafeInteger(removedEpoch) || removedEpoch < 1) { await rejectShape('get_removed_farm_access_epoch body'); return }
      await fulfillJson(route, [{ farm_id: targetFarmId, access_epoch: removedEpoch }])
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
    // GL-2 repair: the newest bid per commodity, fetched exactly rather than hoped for inside a cap.
    // Row-level security applies to it, so the mock answers only for a farm this member can reach and
    // serves the same rows the windowed reads do; the merge de-duplicates them by id.
    if (url.pathname === '/rest/v1/rpc/latest_cash_bids_per_commodity') { let body: unknown = null; try { body = route.request().postDataJSON() } catch { /* rejected below */ }; const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null; if (route.request().method() !== 'POST' || !value || Object.keys(value).length !== 1 || typeof value.p_farm_id !== 'string' || !accessible.some((farm) => farm.id === value.p_farm_id)) { await rejectShape('latest_cash_bids_per_commodity body'); return }; const perCommodityFarm = accessible.find((item) => item.id === value.p_farm_id)!; await fulfillJson(route, moduleRows.cash_bids ?? grainRows('cash_bids', perCommodityFarm)); return }
    if (url.pathname === '/rest/v1/rpc/edit_grain_contract' || url.pathname === '/rest/v1/rpc/delete_grain_contract') {
      let body: unknown = null; try { body = route.request().postDataJSON() } catch { /* rejected below */ }
      const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
      if (route.request().method() !== 'POST' || !value || typeof value.p_farm_id !== 'string' || typeof value.p_contract_id !== 'string' || typeof value.p_reason !== 'string') { await rejectShape(`${url.pathname.split('/').pop()} body`); return }
      contractRepairCalls.push({ rpc: url.pathname.split('/').pop()!, body: value })
      await fulfillJson(route, url.pathname.endsWith('edit_grain_contract') ? { id: value.p_contract_id } : { deleted: true, reopened_firm_offer_id: null, already_deleted: false }); return
    }
    if (url.pathname === '/rest/v1/rpc/save_grain_load' || url.pathname === '/rest/v1/rpc/void_grain_load') {
      let body: unknown = null; try { body = route.request().postDataJSON() } catch { /* rejected below */ }
      const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
      if (route.request().method() !== 'POST' || !value || typeof value.p_farm_id !== 'string') { await rejectShape(`${url.pathname.split('/').pop()} body`); return }
      loadRecordCalls.push({ rpc: url.pathname.split('/').pop()!, body: value })
      if (url.pathname.endsWith('save_grain_load')) {
        const draft = value.p_load as Record<string, unknown>
        // The server derives the lot; the fixture answers with one the browser never sent.
        const saved = { id: draft.id, farm_id: value.p_farm_id, load_date: draft.load_date, truck_equipment_id: draft.truck_equipment_id ?? null, truck_name: draft.truck_name ?? null, origin_kind: draft.origin_kind, origin_grain_bin_id: draft.origin_grain_bin_id ?? null, origin_crop_assignment_id: draft.origin_crop_assignment_id ?? null, destination_kind: draft.destination_kind, destination_buyer: draft.destination_buyer ?? null, destination_grain_contract_id: draft.destination_grain_contract_id ?? null, destination_grain_bin_id: draft.destination_grain_bin_id ?? null, commodity_id: commodityId, crop_year: 2026, gross_lbs: draft.gross_lbs ?? null, tare_lbs: draft.tare_lbs ?? null, net_bushels: draft.net_bushels, moisture_pct: draft.moisture_pct ?? null, ticket_number: draft.ticket_number ?? null, photo_path: null, notes: draft.notes ?? null, voided_at: null, void_reason: null, created_at: now, updated_at: now }
        await fulfillJson(route, saved); return
      }
      await fulfillJson(route, { status: 'voided', load: { ...(moduleRows.grain_loads?.[0] as Record<string, unknown> ?? {}), voided_at: now, void_reason: value.p_reason }, blocked_by: [] }); return
    }
    // LD-4: the capability probe asking whether public.bin_lots is installed. Declared by shape
    // rather than matched by name, so a future call with a different body is still rejected.
    // LD-4: the capability probe uses the nil bin id and reads nothing. The lot picker calls the
    // same function with a real bin id, and the rows it gets back are the fixture's own -- NOT
    // derived from bin_transactions here, because deriving them in the mock would make the test
    // agree with the browser by construction and prove nothing about the repair.
    if (url.pathname === '/rest/v1/rpc/bin_lots') { let body: unknown = null; try { body = route.request().postDataJSON() } catch { /* rejected below */ }; const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null; if (route.request().method() !== 'POST' || !value || Object.keys(value).length !== 2 || typeof value.p_farm_id !== 'string' || typeof value.p_grain_bin_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.p_grain_bin_id)) { await rejectShape('bin_lots body'); return }; if (value.p_grain_bin_id === '00000000-0000-0000-0000-000000000000') { await fulfillJson(route, []); return }; const declared = (moduleRows.bin_lots ?? (moduleRows.bin_inventory ?? []).map((entry) => entry as Record<string, unknown>)) as Record<string, unknown>[]; await fulfillJson(route, declared.filter((lot) => lot.grain_bin_id === value.p_grain_bin_id && Number(lot.bushels) > 0).map((lot) => ({ commodity_id: lot.commodity_id, crop_year: lot.crop_year, bushels: lot.bushels }))); return }
    if (url.pathname === '/rest/v1/rpc/operational_integrity_capability_probe') { let body: unknown = null; try { body = route.request().postDataJSON() } catch { /* rejected below */ }; const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null; if (route.request().method() !== 'POST' || !value || Object.keys(value).length !== 1 || typeof value.p_farm_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.p_farm_id)) { await rejectShape('operational_integrity_capability_probe body'); return }; await fulfillJson(route, true); return }
    if (url.pathname === '/rest/v1/rpc/generate_due_service_tasks' || url.pathname === '/rest/v1/rpc/generate_due_program_items') throw new Error(`False due preflight unexpectedly called legacy ${url.pathname}`)
    if (url.pathname === '/auth/v1/user') { await fulfillJson(route, session(activeUserId).user); return }
    if (url.pathname === '/auth/v1/logout') { await fulfillJson(route, {}); return }
    if (rest && Object.hasOwn(grainReadQueries, rest)) { const farm = requestedFarm(url); const expected = grainReadQueries[rest]!(farm); const shapes = Array.isArray(expected) ? expected : [expected]; if (route.request().method() !== 'GET' || !shapes.some((shape) => exactQuery(url, shape))) { await rejectShape(`${rest} query`); return }; await fulfillJson(route, moduleRows[rest] ?? grainRows(rest, farm)); return }
    // The profitability workspace load probes for the U of I badge column when the farm has no cost lines (an undefined column answers 42703 live); the mock's schema has it.
    if (emptyUnknownReads && rest === 'budget_cost_lines' && route.request().method() === 'GET' && exactQuery(url, { select: 'university_default_amount', farm_id: `eq.${requestedFarm(url).id}`, limit: '1' })) { await fulfillJson(route, []); return }
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
    await expect(page.getByRole('link', { name: 'Return to sign in' })).toHaveAttribute('href', 'http://127.0.0.1:4173/login')
  }
})

test('the dedicated recovery origin is outside an installed main-app worker scope', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'One real cross-origin service-worker boundary is sufficient.')
  await page.goto('/login')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
  })
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true)

  await page.goto('http://recovery.localhost:4173/update-password')
  await expect(page.getByRole('alert')).toContainText('interrupted when the page closed or refreshed')
  expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(false)
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0)

  const exitLink = page.getByRole('link', { name: process.env.VITE_PASSWORD_EMAIL_DELIVERY_ENABLED === 'true' ? 'Request a new link' : 'Return to sign in' })
  const expectedExitUrl = process.env.VITE_PASSWORD_EMAIL_DELIVERY_ENABLED === 'true'
    ? 'http://127.0.0.1:4173/login?forgotPassword=1'
    : 'http://127.0.0.1:4173/login'
  await expect(exitLink).toHaveAttribute('href', expectedExitUrl)
  await exitLink.click()
  await expect(page).toHaveURL(expectedExitUrl)
  if (process.env.VITE_PASSWORD_EMAIL_DELIVERY_ENABLED === 'true') {
    await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
  }

  await page.goto('http://recovery.localhost:4173/login')
  await expect(page).toHaveURL('http://127.0.0.1:4173/login')
})

test('requesting a new link survives recovery-origin handoff with an ordinary session', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'One real cross-origin session boundary is sufficient.')
  test.skip(process.env.VITE_PASSWORD_EMAIL_DELIVERY_ENABLED !== 'true', 'This journey requires the guarded email-delivery configuration.')
  const unexpected = await mockSupabase(page)
  await page.goto('/login')
  const ordinarySession = session()
  await page.evaluate(({ sessionKey, intentKey, value, intent }) => {
    localStorage.setItem(intentKey, JSON.stringify(intent))
    localStorage.setItem(sessionKey, JSON.stringify(value))
  }, {
    sessionKey: `farm-rx-auth:${projectRef}`,
    intentKey: `farm-rx-auth-intent:v1:${projectRef}`,
    value: ordinarySession,
    intent: { version: 1, nonce: 'recovery-retry-existing-session', phase: 'accepted', userId, sessionLineage: `session-${userId}`, startedAtMs: Date.now() },
  })

  await page.goto('http://recovery.localhost:4173/update-password')
  await page.getByRole('link', { name: 'Request a new link' }).click()
  await expect(page).toHaveURL('http://127.0.0.1:4173/login?forgotPassword=1')
  await expect(page.getByRole('heading', { name: 'Reset your password' })).toBeVisible()
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.user?.id, `farm-rx-auth:${projectRef}`)).toBe(userId)
  expect(unexpected).toEqual([])
})

async function mockRecoveryAuth(page: Page) {
  const recovery = session()
  let passwordUpdates = 0
  const unexpected: string[] = []
  await page.unroute('https://*.supabase.co/**')
  await page.route('https://*.supabase.co/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PUT,OPTIONS' } })
      return
    }
    if (url.pathname === '/auth/v1/user' && ['GET', 'PUT'].includes(request.method())) {
      if (request.method() === 'PUT') passwordUpdates += 1
      await fulfillJson(route, recovery.user)
      return
    }
    if (url.pathname === '/auth/v1/logout') { await fulfillJson(route, {}); return }
    unexpected.push(`${request.method()} ${url.pathname}`)
    await route.abort('blockedbyclient')
  })
  const fragment = new URLSearchParams({
    access_token: recovery.access_token,
    refresh_token: recovery.refresh_token,
    expires_at: String(recovery.expires_at),
    expires_in: String(recovery.expires_in),
    token_type: recovery.token_type,
    type: 'recovery',
  })
  await page.goto(`http://recovery.localhost:4173/update-password#${fragment}`)
  await expect(page.getByRole('textbox', { name: 'New password', exact: true })).toBeVisible()
  return { unexpected, passwordUpdates: () => passwordUpdates }
}

test('recovery cancellation returns to the canonical app origin', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'One real cross-origin recovery cancellation is sufficient.')
  const cancelled = await mockRecoveryAuth(page)
  await page.getByRole('button', { name: 'Cancel and return to sign in' }).click()
  await expect(page).toHaveURL('http://127.0.0.1:4173/login')
  expect(cancelled.passwordUpdates()).toBe(0)
  expect(cancelled.unexpected).toEqual([])
})

test('successful recovery returns to the canonical app origin', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'One real cross-origin recovery completion is sufficient.')
  const completed = await mockRecoveryAuth(page)
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill('A secure recovery passphrase 2027!')
  await page.getByRole('textbox', { name: 'Confirm new password', exact: true }).fill('A secure recovery passphrase 2027!')
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page).toHaveURL('http://127.0.0.1:4173/login')
  await expect(page.getByLabel('Email address')).toBeVisible()
  expect(completed.passwordUpdates()).toBe(1)
  expect(completed.unexpected).toEqual([])
})

test('successful recovery with a local cleanup warning still returns automatically', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'One real terminal warning handoff is sufficient.')
  const completed = await mockRecoveryAuth(page)
  await page.evaluate(() => {
    const originalRemoveItem = Storage.prototype.removeItem
    let failedRecoveryFenceCleanup = false
    Storage.prototype.removeItem = function removeItem(key: string) {
      if (!failedRecoveryFenceCleanup && key.includes('farm-rx-password-recovery:v2:')) {
        failedRecoveryFenceCleanup = true
        throw new Error('controlled recovery-fence cleanup warning')
      }
      originalRemoveItem.call(this, key)
    }
  })
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill('A secure recovery passphrase 2027!')
  await page.getByRole('textbox', { name: 'Confirm new password', exact: true }).fill('A secure recovery passphrase 2027!')
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page).toHaveURL('http://127.0.0.1:4173/login')
  await expect(page.getByLabel('Email address')).toBeVisible()
  expect(completed.passwordUpdates()).toBe(1)
  expect(completed.unexpected).toEqual([])
})

test('completed recovery clears an older canonical session before route adoption', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'One real cross-origin session cleanup is sufficient.')
  await page.goto('/login')
  const authSessionKey = `farm-rx-auth:${projectRef}`
  await page.evaluate(({ sessionKey, intentKey, cleanupKey, value, intent, cleanup }) => {
    localStorage.setItem(intentKey, JSON.stringify(intent))
    localStorage.setItem(sessionKey, JSON.stringify(value))
    localStorage.setItem(cleanupKey, JSON.stringify(cleanup))
  }, {
    sessionKey: authSessionKey,
    intentKey: `farm-rx-auth-intent:v1:${projectRef}`,
    cleanupKey: `farm-rx-password-recovery-cleanup:v1:${projectRef}`,
    value: session(),
    intent: { version: 1, nonce: 'pre-recovery-ordinary-session', phase: 'accepted', userId, sessionLineage: `session-${userId}`, startedAtMs: Date.now() },
    cleanup: { version: 1, requestId: 'playwright-recovery-request', email: 'farmer@example.test', sessionLineage: `session-${userId}`, requestedAtMs: Date.now() },
  })

  const completed = await mockRecoveryAuth(page)
  await page.getByRole('textbox', { name: 'New password', exact: true }).fill('A secure recovery passphrase 2027!')
  await page.getByRole('textbox', { name: 'Confirm new password', exact: true }).fill('A secure recovery passphrase 2027!')
  await page.getByRole('button', { name: 'Update password' }).click()
  await expect(page).toHaveURL('http://127.0.0.1:4173/login')
  await expect(page.getByRole('heading', { name: 'Farm Rx' })).toBeVisible()
  await expect(page.getByLabel('Email address')).toBeVisible()
  await expect.poll(() => page.evaluate((key) => localStorage.getItem(key), authSessionKey)).toBeNull()
  expect(completed.passwordUpdates()).toBe(1)
  expect(completed.unexpected).toEqual([])
  await page.goto('/fields')
  await expect(page).toHaveURL('http://127.0.0.1:4173/login')
})

test('a forged recovery-completion URL cannot clear an ordinary canonical session', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'One real canonical-origin authorization boundary is sufficient.')
  const unexpected = await mockSupabase(page)
  await page.goto('/login')
  const authSessionKey = `farm-rx-auth:${projectRef}`
  await page.evaluate(({ sessionKey, intentKey, value, intent }) => {
    localStorage.setItem(intentKey, JSON.stringify(intent))
    localStorage.setItem(sessionKey, JSON.stringify(value))
  }, {
    sessionKey: authSessionKey,
    intentKey: `farm-rx-auth-intent:v1:${projectRef}`,
    value: session(),
    intent: { version: 1, nonce: 'ordinary-session-without-reset-request', phase: 'accepted', userId, sessionLineage: `session-${userId}`, startedAtMs: Date.now() },
  })

  await page.goto('/login?recoveryComplete=1')
  await expect(page).toHaveURL('http://127.0.0.1:4173/today')
  await expect(page.getByRole('heading', { name: 'Choose a farm' })).toBeVisible()
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.user?.id, authSessionKey)).toBe(userId)
  expect(unexpected).toEqual([])
})

test('an older recovery request cannot clear a newer accepted same-user session', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'One real same-user lineage boundary is sufficient.')
  const unexpected = await mockSupabase(page)
  await page.goto('/login')
  const authSessionKey = `farm-rx-auth:${projectRef}`
  const newerLineage = 'newer-same-user-session'
  await page.evaluate(({ sessionKey, intentKey, cleanupKey, value, intent, cleanup }) => {
    localStorage.setItem(intentKey, JSON.stringify(intent))
    localStorage.setItem(sessionKey, JSON.stringify(value))
    localStorage.setItem(cleanupKey, JSON.stringify(cleanup))
  }, {
    sessionKey: authSessionKey,
    intentKey: `farm-rx-auth-intent:v1:${projectRef}`,
    cleanupKey: `farm-rx-password-recovery-cleanup:v1:${projectRef}`,
    value: session(userId, newerLineage),
    intent: { version: 1, nonce: 'newer-same-user-intent', phase: 'accepted', userId, sessionLineage: newerLineage, startedAtMs: Date.now() },
    cleanup: { version: 1, requestId: 'older-reset-request', email: 'farmer@example.test', sessionLineage: `session-${userId}`, requestedAtMs: Date.now() },
  })

  await page.goto('/login?recoveryComplete=1')
  await expect(page).toHaveURL('http://127.0.0.1:4173/today')
  await expect(page.getByRole('heading', { name: 'Choose a farm' })).toBeVisible()
  const storedLineage = await page.evaluate((key) => {
    const token = JSON.parse(localStorage.getItem(key) ?? 'null')?.access_token as string | undefined
    if (!token) return null
    return JSON.parse(atob(token.split('.')[1]!.replaceAll('-', '+').replaceAll('_', '/'))).session_id as string
  }, authSessionKey)
  expect(storedLineage).toBe(newerLineage)
  expect(unexpected).toEqual([])
})

test('cancelling recovery preserves an older canonical session', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-desktop', 'One real cross-origin cancellation boundary is sufficient.')
  await page.goto('/login')
  const authSessionKey = `farm-rx-auth:${projectRef}`
  await page.evaluate(({ sessionKey, intentKey, value, intent }) => {
    localStorage.setItem(intentKey, JSON.stringify(intent))
    localStorage.setItem(sessionKey, JSON.stringify(value))
  }, {
    sessionKey: authSessionKey,
    intentKey: `farm-rx-auth-intent:v1:${projectRef}`,
    value: session(),
    intent: { version: 1, nonce: 'pre-cancel-ordinary-session', phase: 'accepted', userId, sessionLineage: `session-${userId}`, startedAtMs: Date.now() },
  })

  await mockRecoveryAuth(page)
  await page.getByRole('button', { name: 'Cancel and return to sign in' }).click()
  await expect(page).toHaveURL('http://127.0.0.1:4173/today')
  expect(await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.user?.id, authSessionKey)).toBe(userId)
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
    expect(page.getByRole('heading', { name: 'What are you recording?' })).toBeVisible(),
    expect(olderTab.getByRole('heading', { name: 'What are you recording?' })).toBeVisible(),
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
  await expect(page).toHaveURL('http://127.0.0.1:4173/today')
  await expect(page.getByRole('heading', { name: 'What are you recording?' })).toBeVisible()
  await page.goto('/fields')
  await expect(page.getByText('North Forty')).toBeVisible()
  await expect(page.getByLabel('Active farm')).toHaveValue(farmA)
  await page.getByLabel('Active farm').selectOption(farmB)
  // Switching farms reopens the app on Today for the new farm; the field names live on Fields.
  await expect(page).toHaveURL('http://127.0.0.1:4173/today')
  await page.goto('/fields')
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

test('a long valid farm name keeps the phone farm switcher inside its summary', async ({ page, context }, testInfo) => {
  test.skip(testInfo.project.name !== 'chromium-phone', 'Phone layout proof runs in the phone browser project.')
  await page.setViewportSize({ width: 390, height: 844 })
  await seedSession(context)
  const longName = 'North Prairie Conservation Partnership Family Farm Operations and Stewardship Cooperative Holdings and Central Illinois Multigenerational Agricultural Partners.'
  expect(longName).toHaveLength(160)
  const longFarm = { ...farms[1], name: longName }
  const unexpected = await mockSupabase(page, [farms[0], longFarm])
  await page.goto('/fields')
  await page.getByRole('button', { name: 'Prairie View' }).click()
  await expect(page).toHaveURL('http://127.0.0.1:4173/today')
  await page.goto('/fields')
  await expect(page.getByText('North Forty')).toBeVisible()
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
    if (!navigator.serviceWorker.controller) await new Promise<void>((resolve) => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true }))
  })
  await context.setOffline(true)
  try {
    await page.reload()
    await expect(page.getByText('North Forty')).toBeVisible()
    await expect(page.getByText('Offline access')).toBeVisible()
    const select = page.getByLabel('Active farm')
    await expect(select).toBeVisible()
    expect(await select.locator('option').allTextContents()).toContain(longName)
    const widths = await page.locator('.farm-summary').evaluate((summary) => {
      const wrapper = summary.querySelector<HTMLElement>('.farm-switcher-wrap')
      const control = summary.querySelector<HTMLElement>('select')
      if (!wrapper || !control) throw new Error('Farm switcher layout nodes are missing.')
      const summaryBox = summary.getBoundingClientRect()
      const wrapperBox = wrapper.getBoundingClientRect()
      const controlBox = control.getBoundingClientRect()
      return {
        summary: Number.parseFloat(getComputedStyle(summary).width),
        wrapper: Number.parseFloat(getComputedStyle(wrapper).width),
        control: Number.parseFloat(getComputedStyle(control).width),
        controlHeight: controlBox.height,
        wrapperRight: wrapperBox.right,
        controlRight: controlBox.right,
        summaryRight: summaryBox.right,
        documentOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      }
    })
    expect(widths.wrapper).toBeLessThanOrEqual(widths.summary + 1)
    expect(widths.control).toBeLessThanOrEqual(widths.wrapper + 1)
    expect(widths.controlHeight).toBeGreaterThanOrEqual(44)
    expect(widths.wrapperRight).toBeLessThanOrEqual(widths.summaryRight + 1)
    expect(widths.controlRight).toBeLessThanOrEqual(widths.summaryRight + 1)
    expect(widths.documentOverflow).toBeLessThanOrEqual(1)
    expect(unexpected).toEqual([])
  } finally {
    await context.setOffline(false)
  }
})

test('a named rep receives only proven rep-safe navigation and direct routes', async ({ page, context }, testInfo) => {
  await seedSession(context)
  const pendingKeys = await seedPendingWriteQueues(context)
  // The rep may open Grain, so the Today landing at the end reads the grain tables through the exact-shape mock.
  const unexpected = await mockSupabase(page, [farms[0]], [], true, 1, { memberRole: null, canViewFinancials: false, namedRep: true })
  await page.goto('/fields')
  await expect(page.getByText('North Forty')).toBeVisible()
  const navigation = testInfo.project.name === 'chromium-phone' ? page.getByRole('navigation', { name: 'Farm Rx navigation' }) : page.locator('.sidebar')
  if (testInfo.project.name === 'chromium-phone') {
    for (const label of ['Today', 'Fields', 'Grain']) await expect(navigation.getByRole('link', { name: label })).toBeVisible()
    await expect(navigation.getByRole('button', { name: 'Record' })).toHaveCount(0)
    // FD-2: a bar with fewer targets still fills the width; the last target ends at the bar's right edge and all four share it.
    const bar = (await navigation.boundingBox())!
    const targets = await Promise.all((await navigation.locator('.nav-link').all()).map((target) => target.boundingBox()))
    expect(targets).toHaveLength(4)
    expect(Math.abs(targets.at(-1)!!.x + targets.at(-1)!!.width - (bar.x + bar.width))).toBeLessThanOrEqual(1)
    for (const target of targets) expect(Math.abs(target!.width - bar.width / 4)).toBeLessThanOrEqual(1)
    await navigation.getByRole('button', { name: 'More' }).click()
    const more = page.getByRole('region', { name: 'More Farm Rx destinations' })
    for (const label of ['Inventory', 'Profitability', 'Alerts']) await expect(more.getByRole('link', { name: label })).toBeVisible()
    for (const label of ['Equipment', 'Tasks', 'Weather', 'Field Log', 'Scouting', 'Harvest', 'Programs']) await expect(more.getByRole('link', { name: label })).toHaveCount(0)
  } else {
    for (const label of ['Today', 'Fields', 'Grain', 'Inventory', 'Profitability', 'Alerts']) await expect(navigation.getByRole('link', { name: label })).toBeVisible()
    for (const label of ['Equipment', 'Tasks', 'Weather', 'Field Log', 'Scouting', 'Harvest', 'Programs']) await expect(navigation.getByRole('link', { name: label })).toHaveCount(0)
  }
  await page.goto('/tasks')
  await expect(page).toHaveURL(/\/today$/)
  await expect(page.getByRole('heading', { name: 'Your farm today' })).toBeVisible()
  const pending = await page.evaluate((keys) => keys.map((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { entries?: unknown[] }).map((value) => value.entries?.length ?? 0), [pendingKeys.fieldsKey, pendingKeys.equipmentKey])
  expect(pending).toEqual([1, 1])
  expect(unexpected).toEqual([])
})

test('an owner sets the farm market region on Farm settings and a worker cannot', async ({ page, context }) => {
  await seedSession(context)
  farmPatches.length = 0
  delete farmRegions[farmA]
  const unexpected = await mockSupabase(page, [farms[0]], [], true)
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: 'Farm settings' })).toBeVisible()
  const card = page.getByRole('article', { name: 'Market region' })
  await expect(card.locator('.privacy-status')).toHaveText('NOT SET')
  await expect(card.getByText('Pick the state whose USDA cash-grain bids this farm should receive.', { exact: false })).toBeVisible()
  const save = card.getByRole('button', { name: 'Save region' })
  await expect(save).toBeDisabled()
  await card.getByLabel('State for USDA cash bids').selectOption('IL')
  await save.click()
  // The shell re-reads the farm after the save, so the confirmed row, not a transient message, is the proof.
  await expect(card.locator('.privacy-status')).toHaveText('IL')
  await expect(card.getByText('This farm receives USDA cash-grain bids for Illinois', { exact: false })).toBeVisible()
  await expect(card.getByRole('button', { name: 'Save region' })).toBeDisabled()
  expect(farmPatches).toEqual([{ market_region: 'IL' }])
  expect(unexpected).toEqual([])
})

test('a worker sees the market region but cannot change it', async ({ page, context }) => {
  await seedSession(context)
  farmPatches.length = 0
  const unexpected = await mockSupabase(page, [farms[0]], [], true, 1, { memberRole: 'worker', canViewFinancials: false, namedRep: false })
  await page.goto('/privacy')
  await expect(page.getByRole('heading', { name: 'Farm settings' })).toBeVisible()
  const card = page.getByRole('article', { name: 'Market region' })
  await expect(card.getByText('Only a farm owner or manager can change this setting.')).toBeVisible()
  await expect(card.getByRole('button', { name: 'Save region' })).toHaveCount(0)
  expect(farmPatches).toEqual([])
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
    await expect(navigation.getByRole('button', { name: 'Record' })).toHaveCount(0)
  } else {
    await expect(navigation.getByRole('link', { name: 'Programs' })).toBeVisible()
    await expect(navigation.getByRole('link', { name: 'Weather' })).toHaveCount(0)
    await expect(navigation.getByRole('link', { name: 'Grain' })).toHaveCount(0)
  }
  await page.goto('/fields/new')
  await expect(page).toHaveURL(/\/today$/)
  await expect(page.getByRole('heading', { name: 'Your farm today' })).toBeVisible()
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
    // GL-2 repair: the newest bid per commodity, fetched exactly rather than hoped for inside a cap.
    // Row-level security applies to it, so the mock answers only for a farm this member can reach and
    // serves the same rows the windowed reads do; the merge de-duplicates them by id.
    if (url.pathname === '/rest/v1/rpc/latest_cash_bids_per_commodity') { let body: unknown = null; try { body = route.request().postDataJSON() } catch { /* rejected below */ }; const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null; if (route.request().method() !== 'POST' || !value || Object.keys(value).length !== 1 || typeof value.p_farm_id !== 'string' || !accessible.some((farm) => farm.id === value.p_farm_id)) { await rejectShape('latest_cash_bids_per_commodity body'); return }; const perCommodityFarm = accessible.find((item) => item.id === value.p_farm_id)!; await fulfillJson(route, moduleRows.cash_bids ?? grainRows('cash_bids', perCommodityFarm)); return }
    if (url.pathname === '/rest/v1/rpc/edit_grain_contract' || url.pathname === '/rest/v1/rpc/delete_grain_contract') {
      let body: unknown = null; try { body = route.request().postDataJSON() } catch { /* rejected below */ }
      const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
      if (route.request().method() !== 'POST' || !value || typeof value.p_farm_id !== 'string' || typeof value.p_contract_id !== 'string' || typeof value.p_reason !== 'string') { await rejectShape(`${url.pathname.split('/').pop()} body`); return }
      contractRepairCalls.push({ rpc: url.pathname.split('/').pop()!, body: value })
      await fulfillJson(route, url.pathname.endsWith('edit_grain_contract') ? { id: value.p_contract_id } : { deleted: true, reopened_firm_offer_id: null, already_deleted: false }); return
    }
    if (url.pathname === '/rest/v1/rpc/save_grain_load' || url.pathname === '/rest/v1/rpc/void_grain_load') {
      let body: unknown = null; try { body = route.request().postDataJSON() } catch { /* rejected below */ }
      const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
      if (route.request().method() !== 'POST' || !value || typeof value.p_farm_id !== 'string') { await rejectShape(`${url.pathname.split('/').pop()} body`); return }
      loadRecordCalls.push({ rpc: url.pathname.split('/').pop()!, body: value })
      if (url.pathname.endsWith('save_grain_load')) {
        const draft = value.p_load as Record<string, unknown>
        // The server derives the lot; the fixture answers with one the browser never sent.
        const saved = { id: draft.id, farm_id: value.p_farm_id, load_date: draft.load_date, truck_equipment_id: draft.truck_equipment_id ?? null, truck_name: draft.truck_name ?? null, origin_kind: draft.origin_kind, origin_grain_bin_id: draft.origin_grain_bin_id ?? null, origin_crop_assignment_id: draft.origin_crop_assignment_id ?? null, destination_kind: draft.destination_kind, destination_buyer: draft.destination_buyer ?? null, destination_grain_contract_id: draft.destination_grain_contract_id ?? null, destination_grain_bin_id: draft.destination_grain_bin_id ?? null, commodity_id: commodityId, crop_year: 2026, gross_lbs: draft.gross_lbs ?? null, tare_lbs: draft.tare_lbs ?? null, net_bushels: draft.net_bushels, moisture_pct: draft.moisture_pct ?? null, ticket_number: draft.ticket_number ?? null, photo_path: null, notes: draft.notes ?? null, voided_at: null, void_reason: null, created_at: now, updated_at: now }
        await fulfillJson(route, saved); return
      }
      await fulfillJson(route, { status: 'voided', load: { ...(moduleRows.grain_loads?.[0] as Record<string, unknown> ?? {}), voided_at: now, void_reason: value.p_reason }, blocked_by: [] }); return
    }
    // LD-4: the capability probe asking whether public.bin_lots is installed. Declared by shape
    // rather than matched by name, so a future call with a different body is still rejected.
    // LD-4: the capability probe uses the nil bin id and reads nothing. The lot picker calls the
    // same function with a real bin id, and the rows it gets back are the fixture's own -- NOT
    // derived from bin_transactions here, because deriving them in the mock would make the test
    // agree with the browser by construction and prove nothing about the repair.
    if (url.pathname === '/rest/v1/rpc/bin_lots') { let body: unknown = null; try { body = route.request().postDataJSON() } catch { /* rejected below */ }; const value = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null; if (route.request().method() !== 'POST' || !value || Object.keys(value).length !== 2 || typeof value.p_farm_id !== 'string' || typeof value.p_grain_bin_id !== 'string' || !/^[0-9a-f-]{36}$/i.test(value.p_grain_bin_id)) { await rejectShape('bin_lots body'); return }; if (value.p_grain_bin_id === '00000000-0000-0000-0000-000000000000') { await fulfillJson(route, []); return }; const declared = (moduleRows.bin_lots ?? (moduleRows.bin_inventory ?? []).map((entry) => entry as Record<string, unknown>)) as Record<string, unknown>[]; await fulfillJson(route, declared.filter((lot) => lot.grain_bin_id === value.p_grain_bin_id && Number(lot.bushels) > 0).map((lot) => ({ commodity_id: lot.commodity_id, crop_year: lot.crop_year, bushels: lot.bushels }))); return }
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
  const fenceKey = `farm-rx-revocation-fence:v1:${projectRef}:${userId}:${farmA}`
  const generationKey = `farm-rx-revocation-generation:v1:${projectRef}:${userId}:${farmA}`
  const epochKey = `farm-rx-server-access-epochs:v1:${projectRef}:${userId}`
  await context.addInitScript(({ accessKey, access, queueKey: targetQueue, queue, fenceKey, generationKey, epochKey, changedAt, targetUserId, targetFarmId }) => {
    localStorage.setItem(accessKey, JSON.stringify(access))
    localStorage.setItem(targetQueue, JSON.stringify(queue))
    const fence = { version: 2, generation: 1, token: '00000000-0000-4000-8000-000000000099', serverEpoch: 1, revoked: false, changedAt }
    localStorage.setItem(fenceKey, JSON.stringify(fence))
    localStorage.setItem(generationKey, JSON.stringify({ version: fence.version, generation: fence.generation, token: fence.token, serverEpoch: fence.serverEpoch, changedAt: fence.changedAt }))
    localStorage.setItem(epochKey, JSON.stringify({ version: 1, userId: targetUserId, epochs: { [targetFarmId]: 1 }, validatedAt: changedAt }))
  }, {
    accessKey: `farm-rx-access:v1:${projectRef}:${userId}`,
    access: { version: 1, userId, farms: [farmRow(farms[0])], selectedFarmId: farmA, validatedAt: now },
    queueKey,
    queue: { version: 1, entries: [{ version: 1, module: 'notifications', kind: 'markRead', operationId, userId, farmId: farmA, enqueuedAt: now, ids: [notificationA] }] },
    fenceKey,
    generationKey,
    epochKey,
    changedAt: now,
    targetUserId: userId,
    targetFarmId: farmA,
  })
  const unexpected = await mockSupabase(page, [], [], false, 1, ownerProfile, userId, { [userId]: { [farmA]: 2 } })
  await page.goto('/fields')
  await expect(page.getByRole('heading', { name: 'Saved work needs your review' })).toBeVisible()
  await expect(page.getByText(/will never send them automatically/i)).toBeVisible()
  expect(await page.evaluate((key) => localStorage.getItem(key), queueKey)).toBeNull()
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { revoked?: boolean; serverEpoch?: number }, fenceKey)).toMatchObject({ revoked: true, serverEpoch: 2 })
  expect((await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { generation?: number }, fenceKey)).generation).toBeGreaterThan(1)
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
  const callerScopedStatuses = await page.evaluate(async ({ base, mappedFarmId, arbitraryFarmId, otherBearer }) => {
    const request = (targetFarmId: string, headers?: HeadersInit) => fetch(`${base}/rest/v1/rpc/get_removed_farm_access_epoch`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ target_farm_id: targetFarmId }) })
    const [arbitraryKnownFarm, missingBearer, otherCaller] = await Promise.all([request(arbitraryFarmId), request(mappedFarmId), request(mappedFarmId, { authorization: `Bearer ${otherBearer}` })])
    return { arbitraryKnownFarm: arbitraryKnownFarm.status, missingBearer: missingBearer.status, otherCaller: otherCaller.status }
  }, { base: `https://${projectRef}.supabase.co`, mappedFarmId: farmA, arbitraryFarmId: farmB, otherBearer: session(userBId).access_token })
  expect(callerScopedStatuses).toEqual({ arbitraryKnownFarm: 400, missingBearer: 400, otherCaller: 400 })
  expect(unexpected).toEqual(['INVALID get_removed_farm_access_epoch body', 'INVALID get_removed_farm_access_epoch body', 'INVALID get_removed_farm_access_epoch body'])
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
  expect(staleCache).toMatchObject({ version: 3, cacheCustody: 0, farmId: farmA, serverEpoch: 1 })
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
  await mockSupabase(page, [], notifications, false, 1, ownerProfile, userId, { [userId]: { [farmA]: 2 } })
  const accessKey = `farm-rx-access:v1:${projectRef}:${userId}`
  await page.evaluate((key) => { const value = JSON.parse(localStorage.getItem(key) ?? '{}'); value.validatedAt = '2020-01-01T00:00:00.000Z'; localStorage.setItem(key, JSON.stringify(value)) }, accessKey)
  await page.reload()
  const fenceKey = `farm-rx-revocation-fence:v1:${projectRef}:${userId}:${farmA}`
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { revoked?: boolean; generation?: number; serverEpoch?: number }, fenceKey)).toMatchObject({ revoked: true, serverEpoch: 2 })
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
  await mockSupabase(page, [], [], false, 1, ownerProfile, userId, { [userId]: { [farmA]: 2 } })
  await page.goto('/fields')
  await page.evaluate((key) => { const value = JSON.parse(localStorage.getItem(key) ?? '{}'); value.validatedAt = '2020-01-01T00:00:00.000Z'; localStorage.setItem(key, JSON.stringify(value)) }, accessKey)
  await page.reload()
  await expect.poll(() => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}') as { revoked?: boolean; serverEpoch?: number }, fenceKey)).toMatchObject({ revoked: true, serverEpoch: 2 })

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
    await expect(nav.getByText('Today', { exact: true })).toBeVisible()
    await expect(nav.getByText('Grain', { exact: true })).toBeVisible()
    await expect(nav.getByText('Fields', { exact: true })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Record' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'More' })).toBeVisible()
    const boxes = await targets.evaluateAll((items) => items.map((item) => { const box = item.getBoundingClientRect(); return { left: box.left, right: box.right, width: box.width, height: box.height } }))
    expect(boxes.every((box) => box.width >= 48 && box.height >= 48)).toBeTruthy()
    expect(boxes.every((box, index) => index === 0 || box.left >= boxes[index - 1].right - 1)).toBeTruthy()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
    await nav.getByRole('button', { name: 'Record' }).click()
    const sheet = page.getByRole('region', { name: 'Record' })
    await expect(sheet.getByRole('list', { name: 'Record options' }).getByRole('button')).toHaveText(['Rain', 'Scouting note', 'Spray record', 'Task', 'Harvest', 'Grain delivery'])
    await sheet.getByRole('button', { name: 'Close record options' }).click()
    await expect(sheet).toHaveCount(0)
    await nav.getByRole('button', { name: 'More' }).click()
    const more = page.getByRole('region', { name: 'More Farm Rx destinations' })
    for (const label of ['Tasks', 'Weather', 'Inventory', 'Profitability', 'Equipment', 'Field Log', 'Scouting', 'Harvest', 'Programs', 'Alerts']) await expect(more.getByRole('link', { name: label })).toBeVisible()
    await expect(more.getByRole('link', { name: 'Grain' })).toHaveCount(0)
    await more.getByRole('button', { name: 'Close more navigation' }).click()
    await expect(more).toBeHidden()
  }
  expect(unexpected).toEqual([])
})

// FD-1: Today is the front door. These journeys prove the role matrix through the built shell; src/data/today.regression.ts proves
// the projection and scripts/sql/fd-today-role-assertions.sql proves the row-level side on a disposable database.
test('Today opens by default with record tiles and Next up, and hands the Rain and Task tiles to the owning forms', async ({ page, context }, testInfo) => {
  await seedSession(context)
  const unexpected = await mockSupabase(page, [farms[0]], todayNotifications(farms[0]), true, 1, ownerProfile, userId, {}, todayRows(farms[0]))
  await page.goto('/')
  await expect(page).toHaveURL('http://127.0.0.1:4173/today')
  await expect(page.getByRole('heading', { name: 'What are you recording?' })).toBeVisible()
  const tiles = page.getByRole('list', { name: 'Record' }).getByRole('button')
  await expect(tiles).toHaveText(['Rain', 'Scouting note', 'Spray record', 'Task', 'Harvest', 'Grain delivery', 'Pass due today'])
  const grainLine = page.getByRole('link', { name: /^Grain: Corn 2026: 35% sold/ })
  await expect(grainLine).toContainText('Corn 2026: 35% sold')
  await expect(grainLine).toContainText('Plan says 40% by now · Cargill Olney $4.12, up 5¢ since Jul 10')
  const boxes = await tiles.evaluateAll((items) => items.map((item) => { const box = item.getBoundingClientRect(); return { width: box.width, height: box.height } }))
  expect(boxes.every((box) => box.width >= 48 && box.height >= 48)).toBeTruthy()
  const nextUp = page.getByRole('region', { name: 'Next up' })
  const rows = nextUp.getByRole('link')
  await expect(rows).toHaveCount(5)
  await expect(rows.nth(0)).toContainText('Service overdue')
  await expect(rows.nth(0)).toContainText('John Deere 8R 340 · Engine oil')
  await expect(rows.nth(0)).toContainText('12 hours over')
  await expect(rows.nth(0)).toHaveAttribute('href', '/equipment')
  await expect(rows.nth(1)).toContainText('Task overdue')
  await expect(rows.nth(1)).toContainText('Fix the planter')
  await expect(rows.nth(2)).toContainText('Program pass due')
  await expect(rows.nth(2)).toHaveAttribute('href', `/programs?pass=${passA}`)
  await expect(rows.nth(3)).toContainText('Low inventory')
  await expect(rows.nth(3)).toContainText('Atrazine 4L')
  await expect(rows.nth(3)).toContainText('4 gal left')
  await expect(rows.nth(3)).toHaveAttribute('href', '/inventory')
  await expect(rows.nth(4)).toContainText('Grain alert')
  await expect(rows.nth(4)).toContainText('Corn hit your $4.60 target')
  await expect(page.getByText('River Bend corn hit $4.80')).toHaveCount(0)
  // The due-generation function's own task for the overdue interval is the same work as the service-due row and is not listed twice.
  await expect(page.getByText('Engine oil · John Deere 8R 340')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Check the spray window/ })).toHaveAttribute('href', '/weather')
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1)
  await page.screenshot({ path: testInfo.outputPath('today-owner.png'), fullPage: true })
  await page.getByRole('list', { name: 'Record' }).getByRole('button', { name: 'Rain', exact: true }).click()
  await expect(page).toHaveURL('http://127.0.0.1:4173/field-log')
  await expect(page.getByRole('heading', { name: 'Add rain' })).toBeVisible()
  await page.goto('/today')
  await page.getByRole('list', { name: 'Record' }).getByRole('button', { name: 'Task' }).click()
  await expect(page).toHaveURL('http://127.0.0.1:4173/tasks')
  await expect(page.getByRole('heading', { name: 'Add task' })).toBeVisible()
  // FD-2: the pass tile opens Programs on the pass the alert names.
  await page.goto('/today')
  await page.getByRole('list', { name: 'Record' }).getByRole('button', { name: 'Pass due today' }).click()
  await expect(page).toHaveURL(`http://127.0.0.1:4173/programs?pass=${passA}`)
  await expect(page.getByRole('heading', { name: 'Season progress' })).toBeVisible()
  if (testInfo.project.name === 'chromium-phone') {
    // FD-2: the bar's Record button offers the same tiles from any page, loaded through the same pure reads.
    await page.goto('/fields')
    await expect(page.getByText('North Forty')).toBeVisible()
    const nav = page.getByRole('navigation', { name: 'Farm Rx navigation' })
    await nav.getByRole('button', { name: 'Record' }).click()
    const sheet = page.getByRole('region', { name: 'Record' })
    await expect(sheet.getByText('What are you recording?')).toBeVisible()
    await expect(sheet.getByRole('list', { name: 'Record options' }).getByRole('button')).toHaveText(['Rain', 'Scouting note', 'Spray record', 'Task', 'Harvest', 'Grain delivery', 'Pass due today'])
    await sheet.getByRole('button', { name: 'Pass due today' }).click()
    await expect(page).toHaveURL(`http://127.0.0.1:4173/programs?pass=${passA}`)
    await expect(sheet).toHaveCount(0)
  }
  await page.goto('/today')
  await page.getByRole('list', { name: 'Record' }).getByRole('button', { name: 'Scouting note' }).click()
  await expect(page).toHaveURL('http://127.0.0.1:4173/scouting')
  await expect(page.getByRole('heading', { name: 'New scouting note' })).toBeVisible()
  await page.goto('/today')
  await page.getByRole('list', { name: 'Record' }).getByRole('button', { name: 'Harvest' }).click()
  await expect(page).toHaveURL('http://127.0.0.1:4173/harvest')
  await expect(page.getByRole('heading', { name: 'Enter harvest' })).toBeVisible()
  // The grain line opens the Overview on the same estimate, whose progress bar shows the same percent.
  await page.goto('/today')
  await page.getByRole('link', { name: /^Grain: Corn 2026: 35% sold/ }).click()
  await expect(page).toHaveURL('http://127.0.0.1:4173/grain')
  // GL-3: the card leads with one line and three tiles. The same 35% the grain line quoted is the first
  // thing on it, and the detail the farmer used to have to read past is one tap away, not gone.
  const positionCard = page.locator('article.position-card').first()
  await expect(positionCard.getByText('35% priced', { exact: true })).toBeVisible()
  await expect(positionCard.getByText('Fully priced', { exact: true })).toBeVisible()
  await expect(positionCard.getByText('Already contracted')).toBeHidden()
  await positionCard.getByRole('button', { name: 'More details' }).click()
  await expect(positionCard.getByText('Already contracted')).toBeVisible()
  await expect(positionCard.getByText('5,320 bu', { exact: true }).first()).toBeVisible()
  // GL-1: on the storage tab the feed row is named for its report and geography, and a farm without a market region is told how to get bids.
  await page.goto('/grain/storage')
  await expect(page.getByText(/USDA MARS 2850 · Iowa, display-only; last dated 2026-07-15\./)).toBeVisible()
  await expect(page.getByText("Set your farm's market region in Farm settings to receive USDA cash bids for your state.")).toBeVisible()
  await page.goto('/today')
  await page.getByRole('list', { name: 'Record' }).getByRole('button', { name: 'Grain delivery' }).click()
  await expect(page).toHaveURL('http://127.0.0.1:4173/grain/contracts')
  await expect(page.getByRole('status').filter({ hasText: 'Recording a grain delivery' })).toBeVisible()
  await expect(page.getByLabel('Crop and year')).toHaveValue('00000000-0000-4000-8000-000000000051')
  await expect(page.getByLabel('Crop and year').locator('option:checked')).toHaveText(/^2026 Corn/)
  await expect(page.getByRole('button', { name: 'Add contract' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Record a sale instead' }).click()
  await expect(page.getByRole('button', { name: 'Add contract' })).toBeVisible()
  expect(unexpected).toEqual([])
})

// GL-3b: a contract typed wrong was a dead end -- no edit, no delete, and a marketing position that
// stayed wrong forever. The control appears only for a contract with no deliveries, it requires a
// reason, and it sends only the fields the farmer actually touched.
test('a contract with no deliveries can be corrected with a reason, and one already delivered against cannot', async ({ page, context }) => {
  await seedSession(context)
  contractRepairCalls.length = 0
  const farm = farms[0]!
  const contractRows = [
    { id: '00000000-0000-4000-8000-000000000061', farm_id: farm.id, crop_year: 2026, commodity_id: commodityId, operating_entity_id: null, enterprise_label: null, contract_type: 'forward_cash', buyer: 'Buyer Typo', bushels: 10_000, futures_price: null, basis: null, cash_price: 4.75, delivery_start: '2026-11-01', delivery_end: '2026-11-30', contract_number: null, premium_cents_per_bu: 0, notes: null, firm_offer_id: null, created_at: now, updated_at: now },
    { id: '00000000-0000-4000-8000-000000000062', farm_id: farm.id, crop_year: 2026, commodity_id: commodityId, operating_entity_id: null, enterprise_label: null, contract_type: 'forward_cash', buyer: 'Already Delivered', bushels: 8_000, futures_price: null, basis: null, cash_price: 4.80, delivery_start: '2026-12-01', delivery_end: '2026-12-31', contract_number: null, premium_cents_per_bu: 0, notes: null, firm_offer_id: null, created_at: now, updated_at: now },
  ]
  const deliveryRows = [{ id: '00000000-0000-4000-8000-000000000063', farm_id: farm.id, grain_contract_id: '00000000-0000-4000-8000-000000000062', bushels: 1_000, delivered_on: '2026-12-05', note: null, created_at: now }]
  const unexpected = await mockSupabase(page, [farm], [], false, 1, ownerProfile, userId, {}, { grain_contracts: contractRows, grain_contract_deliveries: deliveryRows, grain_contract_audit: [] })
  await page.goto('/grain/contracts')

  const typo = page.getByRole('row').filter({ hasText: 'Buyer Typo' })
  const delivered = page.getByRole('row').filter({ hasText: 'Already Delivered' })
  await expect(typo.getByRole('button', { name: 'Correct or delete' })).toBeVisible()
  // A contract with delivered bushels is history, not a draft. The screen offers nothing the database
  // would refuse, so the control is absent rather than present and failing.
  await expect(delivered.getByRole('button', { name: 'Correct or delete' })).toHaveCount(0)

  await typo.getByRole('button', { name: 'Correct or delete' }).click()
  await expect(typo.getByText('Crop year, commodity, type and price cannot be corrected here.', { exact: false })).toBeVisible()
  // The reason is not optional, and refusing it must cost nothing: no request leaves the browser.
  await typo.getByRole('button', { name: 'Save correction' }).click()
  await expect(typo.getByText('Say why you are changing this contract', { exact: false })).toBeVisible()
  expect(contractRepairCalls).toEqual([])

  // A reason with no actual change is not a correction, and must not write an audit row for nothing.
  await typo.getByLabel('Why are you changing this?').fill('nothing actually changed')
  await typo.getByRole('button', { name: 'Save correction' }).click()
  await expect(typo.getByText('Nothing has changed on this contract yet.')).toBeVisible()
  expect(contractRepairCalls).toEqual([])

  await typo.getByLabel('Buyer', { exact: true }).fill('Corrected Buyer')
  await typo.getByLabel('Contract bushels').fill('9250')
  await typo.getByLabel('Why are you changing this?').fill('buyer was typed wrong')
  await typo.getByRole('button', { name: 'Save correction' }).click()
  await expect.poll(() => contractRepairCalls.length).toBe(1)
  expect(contractRepairCalls[0]!.rpc).toBe('edit_grain_contract')
  expect(contractRepairCalls[0]!.body.p_contract_id).toBe('00000000-0000-4000-8000-000000000061')
  expect(contractRepairCalls[0]!.body.p_reason).toBe('buyer was typed wrong')
  // Only what was touched. The delivery window and the contract number were not, so they are absent
  // entirely -- a whole-form payload would let this save undo someone else's correction to them.
  expect(contractRepairCalls[0]!.body.p_changes).toEqual({ buyer: 'Corrected Buyer', bushels: 9250 })
  // Setting a basis or futures price tells the farmer to add a contract note, so the only form that
  // can change one has to offer it.
  await expect(typo.getByLabel('Contract note')).toBeVisible()
  // And the version this page loaded rides along, so the server refuses the write if the row moved.
  expect(contractRepairCalls[0]!.body.p_expected_updated_at).toBe(now)
  expect(unexpected).toEqual([])
})

// LD-1: a scale ticket had nowhere to go. The form records one, the origin decides its crop and crop
// year rather than the farmer typing them, a contract from another crop year is not even offered, and
// a saved ticket can only be voided with a reason -- never edited.
test('a load records its ticket, takes its crop year from the origin, and can only be voided with a reason', async ({ page, context }) => {
  await seedSession(context)
  loadRecordCalls.length = 0
  const farm = farms[0]!
  const binId = '00000000-0000-4000-8000-000000000071'
  const contractRows = [
    { id: '00000000-0000-4000-8000-000000000072', farm_id: farm.id, crop_year: 2026, commodity_id: commodityId, operating_entity_id: null, enterprise_label: null, contract_type: 'forward_cash', buyer: 'This Year Buyer', bushels: 10_000, futures_price: null, basis: null, cash_price: 4.75, delivery_start: null, delivery_end: null, contract_number: null, premium_cents_per_bu: 0, notes: null, firm_offer_id: null, created_at: now, updated_at: now },
    { id: '00000000-0000-4000-8000-000000000073', farm_id: farm.id, crop_year: 2025, commodity_id: commodityId, operating_entity_id: null, enterprise_label: null, contract_type: 'forward_cash', buyer: 'Carryover Buyer', bushels: 6_000, futures_price: null, basis: null, cash_price: 4.20, delivery_start: null, delivery_end: null, contract_number: null, premium_cents_per_bu: 0, notes: null, firm_offer_id: null, created_at: now, updated_at: now },
  ]
  const binRows = [{ id: binId, farm_id: farm.id, name: 'North dryer bin', capacity_bu: 42_000, location_type: 'on_farm', location_name: null, notes: null, moisture_pct: null, moisture_checked_on: null, created_at: now, updated_at: now }]
  const inventoryRows = [{ id: '00000000-0000-4000-8000-000000000074', farm_id: farm.id, grain_bin_id: binId, crop_year: 2026, commodity_id: commodityId, bushels: 20_000, committed_bushels: 0, measured_at: now, notes: null, created_at: now, updated_at: now }]
  const unexpected = await mockSupabase(page, [farm], [], false, 1, ownerProfile, userId, {}, { grain_contracts: contractRows, grain_bins: binRows, bin_inventory: inventoryRows, grain_contract_deliveries: [], grain_contract_audit: [], grain_loads: [] })
  await page.goto('/grain/loads')

  await expect(page.getByRole('heading', { name: 'Loads', exact: true })).toBeVisible()
  // LD-2: what saving will do is on the screen before the button is pressed. LD-1's "this does not
  // move bushels" sentence is gone because it stopped being true.
  await expect(page.getByRole('group', { name: 'What saving this will do' })).toBeVisible()

  await page.getByRole('combobox', { name: 'Bin', exact: true }).selectOption(binId)
  // The origin decides the lot, and the farmer is shown what it decided rather than typing it.
  await expect(page.getByText('This load is', { exact: false })).toContainText('2026 crop')

  await page.getByRole('radio', { name: 'Against a contract' }).click()
  // A contract from another crop year would be refused by the server, so it is not offered at all.
  await expect(page.getByRole('combobox', { name: 'Contract', exact: true }).getByRole('option')).toHaveText(['Pick a contract', /This Year Buyer/])

  await page.getByRole('combobox', { name: 'Contract', exact: true }).selectOption('00000000-0000-4000-8000-000000000072')
  await page.getByRole('spinbutton', { name: 'Net bushels' }).fill('910.5')
  await page.getByRole('textbox', { name: 'Ticket number' }).fill('A-1001')
  await page.getByRole('button', { name: 'Save load' }).click()

  await expect.poll(() => loadRecordCalls.length).toBe(1)
  expect(loadRecordCalls[0]!.rpc).toBe('save_grain_load')
  const sent = loadRecordCalls[0]!.body.p_load as Record<string, unknown>
  expect(sent.net_bushels).toBe(910.5)
  expect(sent.destination_grain_contract_id).toBe('00000000-0000-4000-8000-000000000072')
  // The browser never sends a lot. Two evaluators of one fact is the defect this tranche prevents.
  expect('commodity_id' in sent).toBe(false)
  expect('crop_year' in sent).toBe(false)
  // Nothing the farmer left blank is sent as an empty value, so the server's own defaults stay in force.
  expect('gross_lbs' in sent).toBe(false)
  expect('truck_equipment_id' in sent).toBe(false)
  // LD-2: the effects the farmer saw and left ticked travel with the save, and the ones this load's
  // shape cannot reach are sent as false rather than omitted -- the server should never have to
  // guess what an absent effect meant.
  expect(sent.effect_bin_out).toBe(true)
  expect(sent.effect_contract_delivery).toBe(true)
  expect(sent.effect_bin_in).toBe(false)
  expect(sent.effect_harvest).toBe(false)
  expect(unexpected).toEqual([])
})

test('a load offers only the effects its shape can reach, and unticking one drops it from the save', async ({ page, context }) => {
  await seedSession(context)
  loadRecordCalls.length = 0
  const farm = farms[0]!
  const binId = '00000000-0000-4000-8000-000000000071'
  const binRows = [{ id: binId, farm_id: farm.id, name: 'North dryer bin', capacity_bu: 42_000, location_type: 'on_farm', location_name: null, notes: null, moisture_pct: null, moisture_checked_on: null, created_at: now, updated_at: now }]
  const inventoryRows = [{ id: '00000000-0000-4000-8000-000000000074', farm_id: farm.id, grain_bin_id: binId, crop_year: 2026, commodity_id: commodityId, bushels: 20_000, committed_bushels: 0, measured_at: now, notes: null, created_at: now, updated_at: now }]
  const unexpected = await mockSupabase(page, [farm], [], false, 1, ownerProfile, userId, {}, { grain_contracts: [], grain_bins: binRows, bin_inventory: inventoryRows, grain_contract_deliveries: [], grain_contract_audit: [], grain_loads: [] })
  await page.goto('/grain/loads')

  const effects = page.getByRole('group', { name: 'What saving this will do' })
  await page.getByRole('combobox', { name: 'Bin', exact: true }).selectOption(binId)

  // A load out of a bin to an elevator can take bushels out of that bin and do nothing else. The
  // other three boxes are not merely disabled -- they are not offered, because the server would
  // refuse them and a box that always fails is a dead end.
  await expect(effects.getByRole('checkbox')).toHaveCount(1)
  await expect(effects.getByRole('checkbox', { name: /Take .* out of North dryer bin/ })).toBeChecked()
  await expect(effects.getByText(/Saving this records the ticket and takes/)).toBeVisible()

  // Unticking it leaves a ticket that changes nothing, and the sentence says exactly that.
  await effects.getByRole('checkbox').uncheck()
  await expect(effects.getByText('Saving this records the ticket and changes nothing else.')).toBeVisible()

  await page.getByRole('textbox', { name: 'Buyer or elevator' }).fill('Riverside Elevator')
  await page.getByRole('spinbutton', { name: 'Net bushels' }).fill('640')
  await page.getByRole('button', { name: 'Save load' }).click()

  await expect.poll(() => loadRecordCalls.length).toBe(1)
  const sent = loadRecordCalls[0]!.body.p_load as Record<string, unknown>
  expect(sent.effect_bin_out).toBe(false)
  expect(sent.effect_bin_in).toBe(false)
  expect(sent.effect_contract_delivery).toBe(false)
  expect(sent.effect_harvest).toBe(false)
  expect(unexpected).toEqual([])
})

test('committed and free are one farm-level figure per crop year, and carry-over is not charged against this year', async ({ page, context }) => {
  await seedSession(context)
  const farm = farms[0]!
  const binId = '00000000-0000-4000-8000-000000000081'
  // One bin, one commodity, two crop years: 6,000 bushels of the 2025 crop as the baseline and
  // 4,000 of the 2026 crop moved in after it. One contract, for the 2026 crop only.
  const binRows = [{ id: binId, farm_id: farm.id, name: 'Home bin', capacity_bu: 40_000, location_type: 'on_farm', location_name: null, notes: null, moisture_pct: null, moisture_checked_on: null, created_at: now, updated_at: now }]
  const inventoryRows = [{ id: '00000000-0000-4000-8000-000000000082', farm_id: farm.id, grain_bin_id: binId, crop_year: 2025, commodity_id: commodityId, bushels: 6_000, committed_bushels: 5_500, measured_at: now, notes: null, created_at: now, updated_at: now }]
  const movementRows = [{ id: '00000000-0000-4000-8000-000000000083', farm_id: farm.id, grain_bin_id: binId, direction: 'in', bushels: 4_000, commodity_id: commodityId, crop_year: 2026, occurred_on: '2026-10-01', note: null, source_kind: null, grain_load_id: null, created_at: now }]
  const contractRows = [{ id: '00000000-0000-4000-8000-000000000084', farm_id: farm.id, crop_year: 2026, commodity_id: commodityId, operating_entity_id: null, enterprise_label: null, contract_type: 'forward_cash', buyer: 'This Year Buyer', bushels: 3_000, futures_price: null, basis: null, cash_price: 4.75, delivery_start: null, delivery_end: null, contract_number: null, premium_cents_per_bu: 0, notes: null, firm_offer_id: null, created_at: now, updated_at: now }]
  const unexpected = await mockSupabase(page, [farm], [], false, 1, ownerProfile, userId, {}, { grain_contracts: contractRows, grain_bins: binRows, bin_inventory: inventoryRows, bin_transactions: movementRows, grain_contract_deliveries: [], grain_contract_audit: [], grain_loads: [] })
  await page.goto('/grain/storage')

  const summary = page.getByRole('region', { name: 'Committed and free bushels' })
  await expect(summary).toBeVisible()

  // The 2026 crop owes 3,000 of the 4,000 it holds. The 2025 crop owes nothing, because a
  // current-year contract never reaches back into carry-over grain -- the defect Initiative LD
  // exists to prevent, read off the screen.
  await expect(summary.getByRole('listitem').filter({ hasText: '2026' })).toContainText('3,000')
  await expect(summary.getByRole('listitem').filter({ hasText: '2026' })).toContainText('1,000')
  await expect(summary.getByRole('listitem').filter({ hasText: '2025' })).toContainText('nothing committed')
  await expect(summary.getByRole('listitem').filter({ hasText: '2025' })).toContainText('6,000')

  // The per-bin committed_bushels column says 5,500 for this bin. It is no longer read anywhere, so
  // that number must appear nowhere on the page: a farm-level figure repeated per bin is the same
  // bushels counted twice.
  await expect(page.getByText('5,500')).toHaveCount(0)
  expect(unexpected).toEqual([])
})

test('a bin holding two crop years asks which one a load came from, and hauls the year the farmer picks', async ({ page, context }) => {
  await seedSession(context)
  loadRecordCalls.length = 0
  const farm = farms[0]!
  const carryOverBin = '00000000-0000-4000-8000-000000000091'
  const singleLotBin = '00000000-0000-4000-8000-000000000092'
  // The bin from the LD-3 journey: 6,000 bushels of 2025 carry-over measured as the baseline, and
  // 4,000 of the 2026 crop moved in on top. LD-3 shows 1,000 of the 2026 crop as free; before LD-4
  // this form would not let a farmer record hauling any of it, because the baseline said 2025.
  const binRows = [
    { id: carryOverBin, farm_id: farm.id, name: 'Home bin', capacity_bu: 40_000, location_type: 'on_farm', location_name: null, notes: null, moisture_pct: null, moisture_checked_on: null, created_at: now, updated_at: now },
    { id: singleLotBin, farm_id: farm.id, name: 'North dryer bin', capacity_bu: 42_000, location_type: 'on_farm', location_name: null, notes: null, moisture_pct: null, moisture_checked_on: null, created_at: now, updated_at: now },
  ]
  const inventoryRows = [
    { id: '00000000-0000-4000-8000-000000000093', farm_id: farm.id, grain_bin_id: carryOverBin, crop_year: 2025, commodity_id: commodityId, bushels: 6_000, committed_bushels: 0, measured_at: now, notes: null, created_at: now, updated_at: now },
    { id: '00000000-0000-4000-8000-000000000094', farm_id: farm.id, grain_bin_id: singleLotBin, crop_year: 2026, commodity_id: commodityId, bushels: 20_000, committed_bushels: 0, measured_at: now, notes: null, created_at: now, updated_at: now },
  ]
  // THE MOVEMENT LIST IS DELIBERATELY SHORT. It carries no 2026 row for the carry-over bin, which
  // is what a farm past PostgREST's cap looks like: loadWorkspace reads bin_transactions newest
  // first and unbounded, so the oldest movements -- and an older still-active crop year with them
  // -- simply are not there. Derived from this array the carry-over bin looks like a one-lot 2025
  // bin, and before the LD-4 repair the form would have offered no choice, sent no crop year, and
  // had the save refused with "pick which one this load came from" and no picker to answer with.
  const movementRows: unknown[] = []
  // What the database actually holds, which is what public.bin_lots returns and what
  // save_grain_load reads. The picker must believe this and not the array above.
  const lotRows = [
    { grain_bin_id: carryOverBin, commodity_id: commodityId, crop_year: 2026, bushels: 4_000 },
    { grain_bin_id: carryOverBin, commodity_id: commodityId, crop_year: 2025, bushels: 6_000 },
    { grain_bin_id: singleLotBin, commodity_id: commodityId, crop_year: 2026, bushels: 20_000 },
  ]
  const unexpected = await mockSupabase(page, [farm], [], false, 1, ownerProfile, userId, {}, { grain_contracts: [], grain_bins: binRows, bin_inventory: inventoryRows, bin_transactions: movementRows, bin_lots: lotRows, grain_contract_deliveries: [], grain_contract_audit: [], grain_loads: [] })
  await page.goto('/grain/loads')
  await expect(page.getByRole('heading', { name: 'Loads', exact: true })).toBeVisible()

  // The common case first: a bin holding one crop year answers for itself and asks nothing. A
  // farmer hauling out of it all afternoon taps the bin and nothing else.
  await page.getByRole('combobox', { name: 'Bin', exact: true }).selectOption(singleLotBin)
  await expect(page.getByText('This bin holds one crop year')).toContainText('2026')
  await expect(page.getByRole('combobox', { name: 'Crop year', exact: true })).toHaveCount(0)

  // The carry-over bin holds two, so it asks -- with what each lot holds beside it, so the choice
  // is made against the bin rather than from memory. Neither lot appears in the movement array, so
  // this can only come from the database: the repair, proved.
  await page.getByRole('combobox', { name: 'Bin', exact: true }).selectOption(carryOverBin)
  const cropYear = page.getByRole('combobox', { name: 'Crop year', exact: true })
  await expect(cropYear).toBeVisible()
  await expect(cropYear.getByRole('option')).toHaveText([/Pick which crop year/, /2026.*4,000 bu/, /2025.*6,000 bu/])

  // Saving without answering is refused in the farmer's own words, not the database's. Everything
  // else the form needs is filled first, so the unanswered crop year is the only thing left to
  // complain about and the message below is provably about it.
  await page.getByRole('textbox', { name: 'Buyer or elevator' }).fill('Riverside Elevator')
  await page.getByRole('spinbutton', { name: 'Net bushels' }).fill('1000')
  await page.getByRole('button', { name: 'Save load' }).click()
  await expect(page.getByText('That bin holds more than one crop year')).toBeVisible()
  expect(loadRecordCalls.length).toBe(0)

  // The 2026 crop: the newer lot, which before LD-4 this bin could never be hauled as.
  await cropYear.selectOption('2026')
  await page.getByRole('button', { name: 'Save load' }).click()

  await expect.poll(() => loadRecordCalls.length).toBe(1)
  const sent = loadRecordCalls[0]!.body.p_load as Record<string, unknown>
  expect(sent.origin_grain_bin_id).toBe(carryOverBin)
  // The one thing LD-4 adds to what the browser sends, and only because the farmer named it. A bin
  // holding a single lot still sends nothing at all and lets the server decide, as LD-1 required.
  expect(sent.crop_year).toBe(2026)
  expect('commodity_id' in sent).toBe(false)
  expect(unexpected).toEqual([])
})

test('movements with no crop year are named even when they cancel out, and an empty bin is never called empty', async ({ page, context }) => {
  await seedSession(context)
  const farm = farms[0]!
  const binId = '00000000-0000-4000-8000-000000000096'
  // A bin with no baseline and no contracts, holding only two pre-LD-2 movements that net to zero:
  // 1,000 bushels in and 1,000 out, neither carrying a crop year. Both Codex findings on #52 live
  // here. Filtering the unknown bucket by its NET hid these two rows entirely, and the empty state
  // that then rendered said "Nothing stored or contracted yet" about a farm with unresolved grain.
  const binRows = [{ id: binId, farm_id: farm.id, name: 'Legacy bin', capacity_bu: 40_000, location_type: 'on_farm', location_name: null, notes: null, moisture_pct: null, moisture_checked_on: null, created_at: now, updated_at: now }]
  const movementRows = [
    { id: '00000000-0000-4000-8000-000000000097', farm_id: farm.id, grain_bin_id: binId, direction: 'in', bushels: 1_000, commodity_id: commodityId, crop_year: null, occurred_on: '2026-09-01', note: null, source_kind: null, grain_load_id: null, created_at: now },
    { id: '00000000-0000-4000-8000-000000000098', farm_id: farm.id, grain_bin_id: binId, direction: 'out', bushels: 1_000, commodity_id: commodityId, crop_year: null, occurred_on: '2026-09-02', note: null, source_kind: null, grain_load_id: null, created_at: now },
  ]
  const unexpected = await mockSupabase(page, [farm], [], false, 1, ownerProfile, userId, {}, { grain_contracts: [], grain_bins: binRows, bin_inventory: [], bin_transactions: movementRows, grain_contract_deliveries: [], grain_contract_audit: [], grain_loads: [] })
  await page.goto('/grain/storage')

  const summary = page.getByRole('region', { name: 'Committed and free bushels' })
  await expect(summary).toBeVisible()

  // The two movements are named, and named as movements rather than as a net of zero. Their crop
  // years are still unassigned, and assigning them can move two different years' figures.
  await expect(summary).toContainText('2 movements that cancel out today')
  await expect(summary).toContainText('can change the figures above even where the movements cancel out today')

  // There are no crop-year figures to show, and that is not the same as nothing being stored. The
  // sentence that said so could never be true here, because this component renders nothing at all
  // when it has neither lots nor unresolved movements.
  await expect(page.getByText('Nothing stored or contracted yet')).toHaveCount(0)
  expect(unexpected).toEqual([])
})

test('Today shows a worker without financial access no grain tile and no grain line, and reads no grain table', async ({ page, context }) => {
  await seedSession(context)
  const reads: string[] = []
  page.on('request', (request) => { const url = new URL(request.url()); if (url.pathname.startsWith('/rest/v1/')) reads.push(url.pathname) })
  const unexpected = await mockSupabase(page, [farms[0]], todayNotifications(farms[0]), false, 1, { memberRole: 'worker', canViewFinancials: false, namedRep: false }, userId, {}, todayRows(farms[0]))
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'What are you recording?' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Record' }).getByRole('button')).toHaveText(['Rain', 'Scouting note', 'Spray record', 'Task', 'Harvest', 'Pass due today'])
  await expect(page.getByRole('link', { name: /^Grain:/ })).toHaveCount(0)
  const nextUp = page.getByRole('region', { name: 'Next up' })
  await expect(nextUp.getByRole('link')).toHaveCount(4)
  await expect(nextUp.getByText('Service overdue')).toBeVisible()
  await expect(nextUp.getByText('Task overdue')).toBeVisible()
  await expect(nextUp.getByText('Program pass due')).toBeVisible()
  await expect(nextUp.getByText('Low inventory')).toBeVisible()
  await expect(page.getByText('Grain alert')).toHaveCount(0)
  await expect(page.getByText('$4.60')).toHaveCount(0)
  expect(reads.filter((path) => /grain|production_estimates|marketing_plan|insurance_units|budget|cost_lines/.test(path))).toEqual([])
  expect(unexpected).toEqual([])
})

test('Today hides a pass skipped on this device before it syncs, reading the queue as it stands', async ({ page, context }) => {
  await seedSession(context)
  const queueKey = `farm-rx-programs-write-queue:v1:${projectRef}:${userId}:${farmA}`
  // A device holding queued work also holds the grant records the app wrote when it opened the farm; the gate verifies pending
  // work against them, so they are seeded as the app would have left them (epoch 1, not revoked).
  await context.addInitScript(({ accessKey, access, queueKey: targetQueue, queue, fenceKey, generationKey, epochKey, changedAt, targetUserId, targetFarmId }) => {
    localStorage.setItem(accessKey, JSON.stringify(access))
    localStorage.setItem(targetQueue, JSON.stringify(queue))
    const fence = { version: 2, generation: 1, token: '00000000-0000-4000-8000-000000000099', serverEpoch: 1, revoked: false, changedAt }
    localStorage.setItem(fenceKey, JSON.stringify(fence))
    localStorage.setItem(generationKey, JSON.stringify({ version: fence.version, generation: fence.generation, token: fence.token, serverEpoch: fence.serverEpoch, changedAt: fence.changedAt }))
    localStorage.setItem(epochKey, JSON.stringify({ version: 1, userId: targetUserId, epochs: { [targetFarmId]: 1 }, validatedAt: changedAt }))
  }, {
    accessKey: `farm-rx-access:v1:${projectRef}:${userId}`,
    access: { version: 1, userId, farms: [farmRow(farms[0])], selectedFarmId: farmA, validatedAt: now },
    queueKey,
    queue: { version: 1, entries: [{ version: 1, module: 'programs', operationId: '00000000-0000-4000-8000-000000000a51', userId, farmId: farmA, enqueuedAt: '2026-07-15T11:00:00.000Z', kind: 'skip_program_pass', assignedPassId: passA, skippedOn: '2026-07-15', reason: 'Too wet to spray' }] },
    fenceKey: `farm-rx-revocation-fence:v1:${projectRef}:${userId}:${farmA}`,
    generationKey: `farm-rx-revocation-generation:v1:${projectRef}:${userId}:${farmA}`,
    epochKey: `farm-rx-server-access-epochs:v1:${projectRef}:${userId}`,
    changedAt: now,
    targetUserId: userId,
    targetFarmId: farmA,
  })
  const unexpected = await mockSupabase(page, [farms[0]], todayNotifications(farms[0]), true, 1, ownerProfile, userId, {}, todayRows(farms[0]))
  // The startup replay of that entry fails the way a dead network does, so the entry stays queued; Today reads the queue as it stands.
  await page.route('**/rest/v1/rpc/skip_program_pass', async (route) => { await route.abort('internetdisconnected') })
  await page.goto('/today')
  const nextUp = page.getByRole('region', { name: 'Next up' })
  await expect(nextUp.getByRole('link')).toHaveCount(4)
  await expect(page.getByText('Program pass due')).toHaveCount(0)
  await expect(page.getByText('Corn pass 2 is due')).toHaveCount(0)
  await expect(nextUp.getByText('Fix the planter')).toBeVisible()
  await expect(nextUp.getByText('Grain alert')).toBeVisible()
  expect(await page.evaluate((key) => (JSON.parse(localStorage.getItem(key) ?? '{"entries":[]}') as { entries: unknown[] }).entries.length, queueKey)).toBe(1)
  expect(unexpected).toEqual([])
})

test('Today gives a named rep a view-only front door with grain alerts and no equipment or task reads', async ({ page, context }) => {
  await seedSession(context)
  const reads: string[] = []
  page.on('request', (request) => { const url = new URL(request.url()); if (url.pathname.startsWith('/rest/v1/')) reads.push(url.pathname) })
  const unexpected = await mockSupabase(page, [farms[0]], todayNotifications(farms[0]), true, 1, { memberRole: null, canViewFinancials: false, namedRep: true }, userId, {}, todayRows(farms[0]))
  await page.goto('/today')
  await expect(page.getByRole('heading', { name: 'Your farm today' })).toBeVisible()
  await expect(page.getByRole('list', { name: 'Record' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /^Grain: Corn 2026: 35% sold/ })).toBeVisible()
  const nextUp = page.getByRole('region', { name: 'Next up' })
  await expect(nextUp.getByRole('link')).toHaveCount(2)
  await expect(nextUp.getByText('Low inventory')).toBeVisible()
  await expect(nextUp.getByText('Grain alert')).toBeVisible()
  await expect(page.getByText('Service overdue')).toHaveCount(0)
  await expect(page.getByText('Program pass due')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /spray window|Weather & Spray/ })).toHaveCount(0)
  expect(reads.filter((path) => /equipment|farm_tasks|farm_member_names/.test(path))).toEqual([])
  expect(unexpected).toEqual([])
})
