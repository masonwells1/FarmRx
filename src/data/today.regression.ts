import assert from 'node:assert/strict'
import { deriveFarmAccessProfile } from '../auth/farmContext'
import type { EquipmentTasksWorkspace, Equipment, FarmTask, ServiceInterval } from './equipmentTasks'
import type { Field, FieldsData } from './fields'
import type { Notification } from './notifications'
import { todayNextUp, todayRecordTiles, todaySprayWindow } from './today'
import { parseTodayRecordIntent, todayRecordIntent } from './todayIntents'
import { readCachedForecast, weatherCacheKey } from './weatherService'

// FD-1 proof (GOAL.md, Initiative FD-1): the Today screen is a pure projection, so its role matrix and its sources are proved
// here without a browser. The e2e lane proves the same rules through the built shell; the disposable database lane proves the
// row-level side (a member without financial access receives no grain row).

const userA = '00000000-0000-4000-8000-000000000001'
const farmA = '00000000-0000-4000-8000-000000000010'
const now = '2026-07-15T12:00:00.000Z'
type Evidence = Parameters<typeof deriveFarmAccessProfile>[4]
const helperEvidence = (overrides: Partial<Evidence['helpers']> = {}): Evidence['helpers'] => ({ canAccessFarm: true, isActiveFarmMember: true, canEditFarm: true, canManageFarm: false, hasExplicitRepAccess: false, canReadPrivateFinancials: false, ...overrides })
const memberEvidence = (role: 'owner' | 'manager' | 'worker' | 'read_only', canViewFinancials = false): Evidence => ({
  membership: { farm_id: farmA, user_id: userA, role, status: 'active', can_view_financials: canViewFinancials },
  repAccess: null,
  shareWithRep: false,
  helpers: helperEvidence({ canEditFarm: role !== 'read_only', canManageFarm: role === 'owner' || role === 'manager', canReadPrivateFinancials: role === 'owner' || role === 'manager' || canViewFinancials }),
})
const repEvidence = (): Evidence => ({ membership: null, repAccess: { farm_id: farmA, rep_user_id: userA, enabled: true, revoked_at: null }, shareWithRep: true, helpers: helperEvidence({ isActiveFarmMember: false, canEditFarm: false, hasExplicitRepAccess: true, canReadPrivateFinancials: true }) })
const owner = deriveFarmAccessProfile(userA, farmA, 1, now, memberEvidence('owner'))
const worker = deriveFarmAccessProfile(userA, farmA, 1, now, memberEvidence('worker'))
const financialWorker = deriveFarmAccessProfile(userA, farmA, 1, now, memberEvidence('worker', true))
const readOnly = deriveFarmAccessProfile(userA, farmA, 1, now, memberEvidence('read_only'))
const namedRep = deriveFarmAccessProfile(userA, farmA, 1, now, repEvidence())
assert.equal(owner.kind, 'owner'); assert.equal(worker.kind, 'worker'); assert.equal(financialWorker.kind, 'financial_worker'); assert.equal(readOnly.kind, 'read_only'); assert.equal(namedRep.kind, 'named_rep')

// Record tiles: the same capability checks that gate module routes gate the tiles.
const kinds = (profile: Parameters<typeof todayRecordTiles>[0]) => todayRecordTiles(profile).map((tile) => tile.kind)
assert.deepEqual(kinds(owner), ['rain', 'scouting', 'spray', 'task', 'harvest', 'grain_delivery'], 'An owner sees every record tile in mockup order.')
assert.deepEqual(kinds(worker), ['rain', 'scouting', 'spray', 'task', 'harvest'], 'A worker without financial access never sees the Grain delivery tile.')
assert.deepEqual(kinds(financialWorker), ['rain', 'scouting', 'spray', 'task', 'harvest', 'grain_delivery'], 'A worker with financial access sees Grain delivery.')
assert.deepEqual(kinds(readOnly), [], 'A read-only member sees no record tiles.')
assert.deepEqual(kinds(namedRep), [], 'A named rep sees no record tiles.')
const ownerTiles = todayRecordTiles(owner)
assert.deepEqual(ownerTiles.find((tile) => tile.kind === 'rain')?.state, todayRecordIntent('rainfall'), 'The Rain tile carries the rainfall intent.')
assert.deepEqual(ownerTiles.find((tile) => tile.kind === 'task')?.state, todayRecordIntent('task'), 'The Task tile carries the task intent.')
assert.equal(ownerTiles.find((tile) => tile.kind === 'spray')?.to, '/inventory', 'The Spray tile opens the Inventory spray record.')
assert.deepEqual(ownerTiles.find((tile) => tile.kind === 'scouting')?.state, todayRecordIntent('scouting'), 'The Scouting note tile carries the scouting intent.')
assert.deepEqual(ownerTiles.find((tile) => tile.kind === 'harvest')?.state, todayRecordIntent('harvest'), 'The Harvest tile carries the harvest intent.')
assert.deepEqual(ownerTiles.find((tile) => tile.kind === 'grain_delivery')?.state, todayRecordIntent('grain_delivery'), 'The Grain delivery tile carries the delivery intent, so Grain opens in delivery mode rather than on the new-sale form.')
assert.ok(ownerTiles.every((tile) => tile.kind === 'spray' || tile.state !== null), 'Every record tile that opens a form carries an intent.')
assert.equal(ownerTiles.find((tile) => tile.kind === 'grain_delivery')?.to, '/grain/contracts', 'The Grain delivery tile opens grain contracts.')

// Intents: only the exact shape opens a form; anything else is ignored.
assert.deepEqual(parseTodayRecordIntent(todayRecordIntent('rainfall')), todayRecordIntent('rainfall'))
assert.deepEqual(parseTodayRecordIntent(JSON.parse(JSON.stringify(todayRecordIntent('task')))), todayRecordIntent('task'))
for (const record of ['scouting', 'harvest', 'grain_delivery'] as const) assert.deepEqual(parseTodayRecordIntent(todayRecordIntent(record)), todayRecordIntent(record))
for (const bad of [null, undefined, 'today-record', 7, {}, { kind: 'today-record' }, { kind: 'today-record', version: 2, record: 'task' }, { kind: 'today-record', version: 1, record: 'spray' }, { kind: 'weather-spray-record', version: 1, record: 'task' }]) assert.equal(parseTodayRecordIntent(bad), null, `Rejected ${JSON.stringify(bad)}`)

// Next up: from existing records only, gated by module access.
const farm: FieldsData['farm'] = { id: farmA, name: 'Wells Farm', share_with_rep: false, created_by: userA, created_at: now, updated_at: now }
const field = (id: string, name: string, latitude: number | null, longitude: number | null, is_active = true): Field => ({ id, farm_id: farmA, operating_entity_id: '00000000-0000-4000-8000-000000000020', name, legal_description: null, county: null, state: null, total_acres: 80, fsa_farm_number: null, fsa_tract_number: null, soil_productivity_index: null, latitude, longitude, location_source: latitude === null ? null : 'gps', is_active } as Field)
const fieldsData: FieldsData = { farm, entities: [], fields: [field('00000000-0000-4000-8000-000000000101', 'North Forty', 41.5, -93.6), field('00000000-0000-4000-8000-000000000102', 'Home Place', null, null)], crop_assignments: [], arrangements: [], commodities: [] }
const machine = (id: string, name: string, meter_unit: Equipment['meter_unit']): Equipment => ({ id, farm_id: farmA, name, category: 'tractor', make: null, model: null, model_year: null, serial_or_vin: null, purchase_date: null, purchase_price: null, meter_unit, warranty_expires_on: null, warranty_notes: null, status: 'active', notes: null, created_by: userA, created_at: now, updated_at: now } as Equipment)
const interval = (id: string, equipment_id: string, name: string): ServiceInterval => ({ id, farm_id: farmA, equipment_id, name, every_meter: 250, every_months: null, last_done_on: null, last_done_reading: null, is_active: true, created_by: userA, created_at: now, updated_at: now })
const task = (id: string, title: string, due_on: string | null, status: FarmTask['status'] = 'todo'): FarmTask => ({ id, farm_id: farmA, title, details: null, status, priority: 'normal', assigned_to: null, due_on, field_id: null, equipment_id: null, source: 'manual', interval_id: null, interval_cycle_key: null, program_assigned_pass_id: null, program_cycle_key: null, completed_by: null, completed_at: null, created_by: userA, created_at: now, updated_at: now } as FarmTask)
const tractor = machine('00000000-0000-4000-8000-000000000201', 'John Deere 8R 340', 'hours'); const truck = machine('00000000-0000-4000-8000-000000000202', 'Grain truck', 'miles')
const oil = interval('00000000-0000-4000-8000-000000000301', tractor.id, 'Engine oil'); const tires = interval('00000000-0000-4000-8000-000000000302', truck.id, 'Tire rotation')
const workspace: EquipmentTasksWorkspace = {
  fields: fieldsData, viewer: { user_id: userA, role: 'owner' }, equipment: [tractor, truck], meter_readings: [], intervals: [oil, tires], service_log: [],
  service_due: [{ farm_id: farmA, equipment_id: tractor.id, interval_id: oil.id, reason: 'meter', overdue_amount: 12.4 }, { farm_id: farmA, equipment_id: truck.id, interval_id: tires.id, reason: 'calendar', overdue_amount: 3 }, { farm_id: farmA, equipment_id: '00000000-0000-4000-8000-000000000299', interval_id: oil.id, reason: 'meter', overdue_amount: 1 }],
  members: [], tasks: [task('00000000-0000-4000-8000-000000000401', 'Fix the planter', '2026-07-13'), task('00000000-0000-4000-8000-000000000402', 'Walk beans', '2026-07-15'), task('00000000-0000-4000-8000-000000000403', 'Spray corn', '2026-07-16'), task('00000000-0000-4000-8000-000000000404', 'Done job', '2026-07-01', 'done'), task('00000000-0000-4000-8000-000000000405', 'No date', null), { ...task('00000000-0000-4000-8000-000000000406', 'Engine oil · John Deere 8R 340', '2026-07-14'), source: 'service_interval', interval_id: oil.id, equipment_id: tractor.id }, { ...task('00000000-0000-4000-8000-000000000407', 'Corn pass 2', '2026-07-15'), source: 'program', program_assigned_pass_id: '00000000-0000-4000-8000-000000000601' }],
}
const notification = (id: string, title: string, link: string | null, read_at: string | null, created_at: string): Notification => ({ id, farm_id: farmA, user_id: userA, category: 'general', title, body: null, link, dedupe_key: null, read_at, created_by: userA, created_at })
const notifications: Notification[] = [
  notification('00000000-0000-4000-8000-000000000501', 'Corn pass 2 is due', '/programs?pass=00000000-0000-4000-8000-000000000601', null, '2026-07-15T06:00:00.000Z'),
  notification('00000000-0000-4000-8000-000000000502', 'Corn hit your $4.60 target', '/grain', null, '2026-07-15T07:00:00.000Z'),
  notification('00000000-0000-4000-8000-000000000503', 'Already read grain alert', '/grain', '2026-07-15T08:00:00.000Z', '2026-07-14T07:00:00.000Z'),
  notification('00000000-0000-4000-8000-000000000504', 'A note with nowhere to go', null, null, '2026-07-15T09:00:00.000Z'),
  notification('00000000-0000-4000-8000-000000000505', 'Service reminder written as an alert', '/equipment', null, '2026-07-15T10:00:00.000Z'),
  { ...notification('00000000-0000-4000-8000-000000000506', 'River Bend corn hit $4.80', '/grain', null, '2026-07-15T11:00:00.000Z'), farm_id: '00000000-0000-4000-8000-000000000020' },
  { ...notification('00000000-0000-4000-8000-000000000507', 'River Bend pass due', '/programs?pass=00000000-0000-4000-8000-000000000602', null, '2026-07-15T11:30:00.000Z'), farm_id: '00000000-0000-4000-8000-000000000020' },
]
const today = '2026-07-15'
const ownerNextUp = todayNextUp({ profile: owner, today, equipment: workspace, notifications })
assert.deepEqual(ownerNextUp.map((item) => [item.kind, item.title, item.detail, item.badge, item.urgency, item.to]), [
  ['service', 'Service overdue', 'John Deere 8R 340 · Engine oil', '12 hours over', 'overdue', '/equipment'],
  ['service', 'Service overdue', 'Grain truck · Tire rotation', '3 days over', 'overdue', '/equipment'],
  ['task', 'Task overdue', 'Fix the planter', '2 days late', 'overdue', '/tasks'],
  ['task', 'Task due today', 'Walk beans', null, 'due', '/tasks'],
  ['program', 'Program pass due', 'Corn pass 2 is due', null, 'due', '/programs?pass=00000000-0000-4000-8000-000000000601'],
  ['grain_alert', 'Grain alert', 'Corn hit your $4.60 target', null, 'info', '/grain'],
], 'An owner sees overdue service, overdue and due tasks, program passes due, and unread grain alerts, overdue first; future, done, undated, read, unlinked and unknown-link rows are absent; another farm\'s alerts are absent; the generated service task and program task are not listed beside the service-due row and the pass alert they duplicate.')
assert.ok(!ownerNextUp.some((item) => item.detail.includes('River Bend')), 'No alert from another farm reaches the selected farm\'s Today.')
const withoutPassAlert = todayNextUp({ profile: owner, today, equipment: workspace, notifications: notifications.filter((notification) => notification.id !== '00000000-0000-4000-8000-000000000501') })
assert.deepEqual(withoutPassAlert.filter((item) => item.kind === 'task').map((item) => item.detail), ['Fix the planter', 'Corn pass 2', 'Walk beans'], 'Once the pass alert is read, the generated program task is the only representation of that pass and is listed.')
assert.ok(!withoutPassAlert.some((item) => item.kind === 'program'), 'No pass alert, no program row.')
const appliedPass = todayNextUp({ profile: owner, today, equipment: { ...workspace, tasks: workspace.tasks.map((task) => task.id === '00000000-0000-4000-8000-000000000407' ? { ...task, status: 'done' as const, completed_by: userA, completed_at: now } : task) }, notifications })
assert.ok(!appliedPass.some((item) => item.kind === 'program' || item.detail === 'Corn pass 2'), 'A pass that was applied (its generated task closed) is finished work even while its alert is still unread, and is not listed.')
assert.ok(appliedPass.some((item) => item.kind === 'grain_alert'), 'Other alerts are unaffected by the applied pass.')
const withoutServiceDue = todayNextUp({ profile: owner, today, equipment: { ...workspace, service_due: [] }, notifications })
assert.ok(withoutServiceDue.some((item) => item.kind === 'task' && item.detail === 'Engine oil · John Deere 8R 340'), 'Without a service-due row the generated service task is listed on its own.')
assert.equal(new Set(ownerNextUp.map((item) => item.id)).size, ownerNextUp.length, 'Next up ids are unique.')
const workerNextUp = todayNextUp({ profile: worker, today, equipment: workspace, notifications })
assert.ok(workerNextUp.some((item) => item.kind === 'service') && workerNextUp.some((item) => item.kind === 'task') && workerNextUp.some((item) => item.kind === 'program'), 'A worker without financial access still sees service, tasks and program passes.')
assert.ok(!workerNextUp.some((item) => item.kind === 'grain_alert' || item.to.startsWith('/grain') || item.detail.includes('$4.60')), 'A worker without financial access sees no grain line on Today.')
assert.ok(todayNextUp({ profile: financialWorker, today, equipment: workspace, notifications }).some((item) => item.kind === 'grain_alert'), 'A worker with financial access sees the grain alert.')
const repNextUp = todayNextUp({ profile: namedRep, today, equipment: workspace, notifications })
assert.deepEqual(repNextUp.map((item) => [item.kind, item.detail]), [['grain_alert', 'Corn hit your $4.60 target']], 'A named rep sees only the selected farm\'s grain alerts, never service, tasks or program passes, even when handed the rows.')
assert.deepEqual(todayNextUp({ profile: owner, today, equipment: null, notifications: null }), [], 'Sources the screen could not load are simply absent.')
assert.deepEqual(todayNextUp({ profile: owner, today: '2026-07-12', equipment: workspace, notifications: [] }).map((item) => item.kind), ['service', 'service'], 'Tasks are due only from their due date on.')
assert.deepEqual(todayNextUp({ profile: worker, today, equipment: null, notifications }).map((item) => item.kind), ['program'], 'A worker without financial access handed only alerts sees the selected farm\'s pass alert and nothing from another farm.')

// Spray card: cached forecasts only, freshness-gated, no writes.
class MemoryStorage { private readonly values = new Map<string, string>(); writes = 0; getItem(key: string) { return this.values.get(key) ?? null }; setItem(key: string, value: string) { this.writes += 1; this.values.set(key, value) } }
const storage = new MemoryStorage()
const hour = (time: string, wind = 6, precipitation_probability = 5): Record<string, unknown> => ({ time, temperature_f: 72, relative_humidity: 60, precipitation_in: 0, precipitation_probability, wind_speed_mph: wind, wind_direction_degrees: 225, wind_gusts_mph: wind + 3, cloud_cover: 30 })
const hours = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00'].map((clock, index) => hour(`2026-07-15T${clock}`, index >= 4 ? 16 : 6))
const cachedBundle = (fetched_at: string) => JSON.stringify({ version: 1, fetched_at, bundle: { current: hour('2026-07-15T07:00'), hourly: hours, daily: [{ date: '2026-07-15', precipitation_sum_in: 0, precipitation_probability_max: 10, temperature_max_f: 84, temperature_min_f: 61, sunrise: '2026-07-15T05:58', sunset: '2026-07-15T20:47' }], fetched_at } })
const nowMs = Date.parse(now)
storage.setItem(weatherCacheKey(41.5, -93.6), cachedBundle(new Date(nowMs - 30 * 60_000).toISOString())); storage.writes = 0
const readForecast = (latitude: number, longitude: number) => readCachedForecast(storage, latitude, longitude)
const card = todaySprayWindow(fieldsData.fields, readForecast, nowMs)
assert.ok(card, 'A fresh cached forecast produces a spray card.')
assert.equal(card.level, 'good'); assert.equal(card.fieldName, 'North Forty')
assert.match(card.headline, /^Good spray window until 10 AM$/, `Headline was ${card.headline}`)
assert.deepEqual(card.details, ['Wind 6 mph SW', 'No rain expected'])
assert.equal(storage.writes, 0, 'Reading the spray card wrote nothing.')
storage.setItem(weatherCacheKey(41.5, -93.6), cachedBundle(new Date(nowMs - 3 * 60 * 60_000).toISOString())); storage.writes = 0
assert.equal(todaySprayWindow(fieldsData.fields, readForecast, nowMs), null, 'A forecast too old to act on is skipped, so Today never shows a green verdict from stale weather.')
assert.equal(todaySprayWindow([field('00000000-0000-4000-8000-000000000103', 'No pin', null, null)], readForecast, nowMs), null, 'A field without a location has no spray card.')
assert.equal(todaySprayWindow([field('00000000-0000-4000-8000-000000000101', 'Retired', 41.5, -93.6, false)], readForecast, nowMs), null, 'An inactive field has no spray card.')
storage.setItem(weatherCacheKey(41.5, -93.6), '{not json'); assert.equal(readCachedForecast(storage, 41.5, -93.6), null, 'A corrupt cache reads as no forecast.')
assert.equal(readCachedForecast(storage, 40, -90), null, 'A missing cache reads as no forecast.')
assert.equal(storage.writes, 1, 'Nothing beyond the fixture write touched storage.')

console.log('Today regressions passed (role matrix, next-up sources, spray card, intents).')
