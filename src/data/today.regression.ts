import assert from 'node:assert/strict'
import { deriveFarmAccessProfile } from '../auth/farmContext'
import type { EquipmentTasksWorkspace, Equipment, FarmTask, MeterReading, ServiceInterval } from './equipmentTasks'
import { pendingPassOutcomes, type ProgramsQueueEntryV1 } from './programsWriteQueue'
import type { InventoryProduct, InventoryWorkspace } from './inventory'
import type { Field, FieldsData } from './fields'
import type { Notification } from './notifications'
import { addMonthsClamped, fieldWallClockNow, todayNextUp, todayRecordTiles, todaySprayWindow } from './today'
import { isTransportFailure } from './QueuedFieldsRepository'
import { SupabaseInventoryRepository } from './SupabaseInventoryRepository'
import type { InventoryDataGateway } from './InventoryDataGateway'
import type { FieldsRepository } from './fields'
import { parseTodayRecordIntent, todayRecordIntent } from './todayIntents'
import { readCachedForecast, weatherCacheKey } from './weatherService'
import { farmCalendarDate, farmLocalCalendarDate } from './farmDates'

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
const interval = (id: string, equipment_id: string, name: string, calendar: { every_months: number; last_done_on: string | null } | null = null): ServiceInterval => ({ id, farm_id: farmA, equipment_id, name, every_meter: calendar ? null : 250, every_months: calendar?.every_months ?? null, last_done_on: calendar?.last_done_on ?? null, last_done_reading: null, is_active: true, created_by: userA, created_at: now, updated_at: now })
const task = (id: string, title: string, due_on: string | null, status: FarmTask['status'] = 'todo'): FarmTask => ({ id, farm_id: farmA, title, details: null, status, priority: 'normal', assigned_to: null, due_on, field_id: null, equipment_id: null, source: 'manual', interval_id: null, interval_cycle_key: null, program_assigned_pass_id: null, program_cycle_key: null, completed_by: null, completed_at: null, created_by: userA, created_at: now, updated_at: now } as FarmTask)
const tractor = machine('00000000-0000-4000-8000-000000000201', 'John Deere 8R 340', 'hours'); const truck = machine('00000000-0000-4000-8000-000000000202', 'Grain truck', 'miles')
const reading = (id: string, equipment_id: string, value: number, read_on: string, created_at = now, source: MeterReading['source'] = 'manual'): MeterReading => ({ id, farm_id: farmA, equipment_id, reading: value, read_on, source, notes: null, created_by: userA, created_at, updated_at: created_at })
const hours262 = reading('00000000-0000-4000-8000-000000000901', tractor.id, 262.4, '2026-07-14')
const oil = interval('00000000-0000-4000-8000-000000000301', tractor.id, 'Engine oil'); const tires = interval('00000000-0000-4000-8000-000000000302', truck.id, 'Tire rotation', { every_months: 6, last_done_on: '2026-01-12' })
const workspace: EquipmentTasksWorkspace = {
  fields: fieldsData, viewer: { user_id: userA, role: 'owner' }, equipment: [tractor, truck], meter_readings: [hours262], intervals: [oil, tires], service_log: [],
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
const rescheduledPass = todayNextUp({ profile: owner, today, equipment: { ...workspace, tasks: workspace.tasks.map((task) => task.id === '00000000-0000-4000-8000-000000000407' ? { ...task, due_on: '2026-07-20' } : task) }, notifications })
assert.ok(!rescheduledPass.some((item) => item.kind === 'program' || item.detail === 'Corn pass 2'), 'A pass rescheduled to a later date is neither listed from its old unread alert nor as a task before that date.')
const rescheduledArrived = todayNextUp({ profile: owner, today: '2026-07-20', equipment: { ...workspace, tasks: workspace.tasks.map((task) => task.id === '00000000-0000-4000-8000-000000000407' ? { ...task, due_on: '2026-07-20' } : task) }, notifications })
assert.ok(rescheduledArrived.some((item) => item.kind === 'program'), 'When the rescheduled date arrives the pass is listed again (through its still-unread alert).')
const twoReminders = todayNextUp({ profile: owner, today, equipment: workspace, notifications: [...notifications, notification('00000000-0000-4000-8000-000000000508', 'Corn pass 2 is due (again)', '/programs?pass=00000000-0000-4000-8000-000000000601', null, '2026-07-15T11:45:00.000Z')] })
assert.equal(twoReminders.filter((item) => item.kind === 'program').length, 1, 'Two unread reminders for one pass are one row.')
// Work queued on this device for a pass but not yet synced is projected the way the server will land it.
const passA = '00000000-0000-4000-8000-000000000601'
const queuedBase = { version: 1 as const, module: 'programs' as const, operationId: '00000000-0000-4000-8000-000000000a01', userId: userA, farmId: farmA, enqueuedAt: now }
const queuedSkip: ProgramsQueueEntryV1 = { ...queuedBase, kind: 'skip_program_pass', assignedPassId: passA.toUpperCase(), skippedOn: today, reason: 'Too wet' }
const queuedApply: ProgramsQueueEntryV1 = { ...queuedBase, operationId: '00000000-0000-4000-8000-000000000a02', kind: 'mark_program_pass_applied', assignedPassId: passA, appliedOn: today, appliedAcres: 80, actualProducts: [], applicationLink: { kind: 'none' } }
const queuedReschedule: ProgramsQueueEntryV1 = { ...queuedBase, operationId: '00000000-0000-4000-8000-000000000a03', kind: 'reschedule_program_pass', assignedPassId: passA, dueOn: '2026-07-20', timingLabel: null }
assert.deepEqual([...pendingPassOutcomes([queuedSkip]).entries()], [[passA, { kind: 'skipped' }]], 'A queued skip closes the pass; ids are matched case-insensitively.')
assert.deepEqual(pendingPassOutcomes([queuedReschedule, queuedApply]).get(passA), { kind: 'applied' }, 'The later queued outcome for a pass wins, as replay applies them in order.')
assert.deepEqual(pendingPassOutcomes([queuedApply, queuedReschedule]).get(passA), { kind: 'rescheduled', dueOn: '2026-07-20' }, 'A reschedule queued after an apply is the later word.')
assert.equal(pendingPassOutcomes([{ ...queuedBase, kind: 'delete_program', programId: passA }]).size, 0, 'Other queued work carries no pass outcome.')
const skippedOffline = todayNextUp({ profile: owner, today, equipment: workspace, notifications, pendingPasses: pendingPassOutcomes([queuedSkip]) })
assert.ok(!skippedOffline.some((item) => item.kind === 'program' || item.detail === 'Corn pass 2'), 'A pass skipped on this device before sync is neither listed from its unread alert nor as its still-open generated task.')
assert.ok(skippedOffline.some((item) => item.kind === 'grain_alert') && skippedOffline.some((item) => item.detail === 'Fix the planter') && skippedOffline.some((item) => item.kind === 'service'), 'Other rows are unaffected by the queued skip.')
const appliedOffline = todayNextUp({ profile: owner, today, equipment: workspace, notifications, pendingPasses: pendingPassOutcomes([queuedApply]) })
assert.ok(!appliedOffline.some((item) => item.kind === 'program' || item.detail === 'Corn pass 2'), 'A pass applied on this device before sync is finished work.')
const rescheduledOffline = todayNextUp({ profile: owner, today, equipment: workspace, notifications, pendingPasses: pendingPassOutcomes([queuedReschedule]) })
assert.ok(!rescheduledOffline.some((item) => item.kind === 'program' || item.detail === 'Corn pass 2'), 'A pass rescheduled on this device to a later date is not listed until then, from neither its alert nor its task.')
const rescheduledOfflineArrived = todayNextUp({ profile: owner, today: '2026-07-20', equipment: workspace, notifications, pendingPasses: pendingPassOutcomes([queuedReschedule]) })
assert.ok(rescheduledOfflineArrived.some((item) => item.kind === 'program'), 'On the queued date the pass is listed again.')
const movedEarlierOffline = todayNextUp({ profile: owner, today, equipment: { ...workspace, tasks: workspace.tasks.map((task) => task.id === '00000000-0000-4000-8000-000000000407' ? { ...task, due_on: '2026-07-20' } : task) }, notifications: notifications.filter((notification) => notification.id !== '00000000-0000-4000-8000-000000000501'), pendingPasses: pendingPassOutcomes([{ ...queuedReschedule, dueOn: '2026-07-14' }]) })
assert.deepEqual(movedEarlierOffline.filter((item) => item.detail === 'Corn pass 2').map((item) => [item.kind, item.title, item.badge]), [['task', 'Task overdue', '1 day late']], 'A pass moved earlier on this device shows its generated task on the queued date, not the task\'s stale later one.')
const outcomesUnknown = todayNextUp({ profile: owner, today, equipment: workspace, notifications, pendingPasses: null })
assert.ok(!outcomesUnknown.some((item) => item.kind === 'program'), 'When the queued outcomes could not be read, pass state is unknown and no pass alert is listed.')
const withoutReading = todayNextUp({ profile: owner, today, equipment: { ...workspace, meter_readings: [] }, notifications })
assert.ok(!withoutReading.some((item) => item.id === 'service:' + oil.id), 'A machine without a reading has no meter row, whatever the view returned.')
assert.ok(withoutReading.some((item) => item.kind === 'task' && item.detail === 'Engine oil · John Deere 8R 340'), 'Without a service row the generated service task is listed on its own.')
assert.equal(new Set(ownerNextUp.map((item) => item.id)).size, ownerNextUp.length, 'Next up ids are unique.')
const workerNextUp = todayNextUp({ profile: worker, today, equipment: workspace, notifications })
assert.ok(workerNextUp.some((item) => item.kind === 'service') && workerNextUp.some((item) => item.kind === 'task') && workerNextUp.some((item) => item.kind === 'program'), 'A worker without financial access still sees service, tasks and program passes.')
assert.ok(!workerNextUp.some((item) => item.kind === 'grain_alert' || item.to.startsWith('/grain') || item.detail.includes('$4.60')), 'A worker without financial access sees no grain line on Today.')
assert.ok(todayNextUp({ profile: financialWorker, today, equipment: workspace, notifications }).some((item) => item.kind === 'grain_alert'), 'A worker with financial access sees the grain alert.')
const repNextUp = todayNextUp({ profile: namedRep, today, equipment: workspace, notifications })
assert.deepEqual(repNextUp.map((item) => [item.kind, item.detail]), [['grain_alert', 'Corn hit your $4.60 target']], 'A named rep sees only the selected farm\'s grain alerts, never service, tasks or program passes, even when handed the rows.')
assert.deepEqual(todayNextUp({ profile: owner, today, equipment: null, notifications: null }), [], 'Sources the screen could not load are simply absent.')
// On-time service is due, not late.
// Service candidates come from the intervals and readings themselves, so meter-only cases carry only the meter interval and the
// view's rows are not needed.
const reached = (value: number) => [reading('00000000-0000-4000-8000-000000000902', tractor.id, value, '2026-07-15')]
const dueNow = todayNextUp({ profile: owner, today, equipment: { ...workspace, intervals: [oil], meter_readings: reached(250), service_due: [], tasks: [] }, notifications: [] })
assert.deepEqual(dueNow.map((item) => [item.title, item.badge, item.urgency]), [['Service due', 'Due now', 'due']], 'An interval reached exactly is listed as due now, never as overdue by zero.')
const slightlyOver = todayNextUp({ profile: owner, today, equipment: { ...workspace, intervals: [oil], meter_readings: reached(250.25), service_due: [], tasks: [] }, notifications: [] })
assert.deepEqual(slightlyOver.map((item) => [item.title, item.badge, item.urgency]), [['Service overdue', 'Less than 1 hour over', 'overdue']], 'A quarter hour past the interval is late, not due now; the amount is rounded only for display.')
const bothRules = todayNextUp({ profile: owner, today, equipment: { ...workspace, intervals: [{ ...oil, every_months: 6, last_done_on: '2026-01-12' }], meter_readings: reached(262), service_due: [], tasks: [] }, notifications: [] })
assert.deepEqual(bothRules.map((item) => [item.id, item.badge]), [['service:' + oil.id, '12 hours over']], 'An interval due on both its meter and calendar rules is one card, represented by the overdue meter row as the due-generation SQL orders.')
const calendarOnlyLate = todayNextUp({ profile: owner, today, equipment: { ...workspace, intervals: [{ ...oil, every_months: 6, last_done_on: '2026-01-13' }], meter_readings: reached(250), service_due: [], tasks: [] }, notifications: [] })
assert.deepEqual(calendarOnlyLate.map((item) => [item.title, item.badge]), [['Service overdue', '2 days over']], 'When only the calendar rule is late, the late row represents the interval.')
// Calendar rows are judged against the farm's day, not the database's: the view's amount is recomputed from the interval's dates.
assert.equal(addMonthsClamped('2026-01-31', 1), '2026-02-28', 'Month arithmetic clamps to the shorter month, as Postgres does.')
assert.equal(addMonthsClamped('2026-11-15', 3), '2027-02-15', 'Month arithmetic crosses the year.')
const calendarOnly: EquipmentTasksWorkspace = { ...workspace, meter_readings: [], tasks: [] }
const dbAheadOfFarm = todayNextUp({ profile: owner, today: '2026-07-11', equipment: { ...calendarOnly, service_due: [{ farm_id: farmA, equipment_id: truck.id, interval_id: tires.id, reason: 'calendar', overdue_amount: 0 }], tasks: [] }, notifications: [] })
assert.deepEqual(dbAheadOfFarm, [], 'A calendar interval the database already calls due (its day has turned) is not listed while the farm\'s day is still the day before.')
const farmDay = todayNextUp({ profile: owner, today: '2026-07-12', equipment: { ...calendarOnly, service_due: [{ farm_id: farmA, equipment_id: truck.id, interval_id: tires.id, reason: 'calendar', overdue_amount: 1 }], tasks: [] }, notifications: [] })
assert.deepEqual(farmDay.map((item) => [item.title, item.badge]), [['Service due', 'Due now']], 'On the farm\'s due day the interval is due now, whatever the database session counted.')
const firstDay = todayNextUp({ profile: owner, today: '2026-07-15', equipment: { ...calendarOnly, intervals: [oil, { ...tires, last_done_on: null }], equipment: [tractor, { ...truck, created_at: '2026-01-15T03:00:00.000Z' }], service_due: [{ farm_id: farmA, equipment_id: truck.id, interval_id: tires.id, reason: 'calendar', overdue_amount: 9 }], tasks: [] }, notifications: [] })
assert.deepEqual(firstDay.map((item) => item.badge), ['Due now'], 'Without a last service the machine\'s first day starts the interval, as the view does.')
// The farm's day can also run ahead of the database's: a calendar interval due on the farm's day is listed even when the view has
// not yet returned it, because calendar candidates come from the loaded intervals, not from the view.
const farmAhead = todayNextUp({ profile: owner, today: '2026-07-12', equipment: { ...calendarOnly, service_due: [] }, notifications: [] })
assert.deepEqual(farmAhead.map((item) => [item.title, item.detail, item.badge]), [['Service due', 'Grain truck · Tire rotation', 'Due now']], 'A calendar interval due on the farm\'s day is listed even before the database\'s day turns.')
const retiredOrSold = todayNextUp({ profile: owner, today: '2026-07-15', equipment: { ...calendarOnly, service_due: [], intervals: [oil, { ...tires, is_active: false }] }, notifications: [] })
assert.deepEqual(retiredOrSold, [], 'An inactive interval is never a calendar candidate.')
const soldMachine = todayNextUp({ profile: owner, today: '2026-07-15', equipment: { ...calendarOnly, service_due: [], equipment: [tractor, { ...truck, status: 'sold' }] }, notifications: [] })
assert.deepEqual(soldMachine, [], 'A sold machine\'s intervals are never calendar candidates, as the view excludes them.')
// Service recorded on this device but not yet synced resets the interval on Today.
const logEntry = (id: string, interval_id: string, equipment_id: string, service_date: string, meter_reading: number | null) => ({ id, farm_id: farmA, equipment_id, service_date, work_performed: 'Serviced', parts: null, vendor: null, cost: null, meter_reading, interval_id, created_by: userA, created_at: now, updated_at: now })
const justServiced = todayNextUp({ profile: owner, today, equipment: { ...workspace, tasks: [], service_log: [logEntry('00000000-0000-4000-8000-000000000801', oil.id, tractor.id, '2026-07-15', 262), logEntry('00000000-0000-4000-8000-000000000802', tires.id, truck.id, '2026-07-14', null)] }, notifications: [] })
assert.deepEqual(justServiced, [], 'Oil (meter) and tires (calendar) serviced on this device today and yesterday are no longer due, even though the view rows and interval dates have not synced yet.')
const syncedAlready = todayNextUp({ profile: owner, today, equipment: { ...workspace, tasks: [], intervals: [oil, { ...tires, last_done_on: '2026-07-14' }], service_log: [logEntry('00000000-0000-4000-8000-000000000802', tires.id, truck.id, '2026-07-14', null)] }, notifications: [] })
assert.deepEqual(syncedAlready.map((item) => item.detail), ['John Deere 8R 340 · Engine oil'], 'Once the entry has synced the interval dates agree and the ordinary rule applies; the oil meter row still shows.')
const olderLog = todayNextUp({ profile: owner, today, equipment: { ...workspace, tasks: [], service_log: [logEntry('00000000-0000-4000-8000-000000000803', tires.id, truck.id, '2025-12-01', null)] }, notifications: [] })
assert.equal(olderLog.length, 2, 'A log entry older than the interval\'s last service changes nothing.')
// The server advances an interval's last-done reading only from an entry that carries a meter reading, so an entry without one
// leaves a meter reminder due (the server would return it after sync); a calendar rule still counts from the entry's date.
const noReading = todayNextUp({ profile: owner, today, equipment: { ...workspace, tasks: [], service_log: [logEntry('00000000-0000-4000-8000-000000000804', oil.id, tractor.id, '2026-07-15', null), logEntry('00000000-0000-4000-8000-000000000805', tires.id, truck.id, '2026-07-14', null)] }, notifications: [] })
assert.deepEqual(noReading.map((item) => item.detail), ['John Deere 8R 340 · Engine oil'], 'A service entry without a meter reading does not reset a meter interval on Today; the calendar interval it also covers is reset by the date.')
const hydraulics: ServiceInterval = { ...interval('00000000-0000-4000-8000-000000000303', tractor.id, 'Hydraulic fluid', { every_months: 6, last_done_on: '2026-01-12' }), every_meter: 100, last_done_reading: 162.4 }
const dualRuleWorkspace: EquipmentTasksWorkspace = { ...workspace, tasks: [], intervals: [tires, hydraulics], service_due: [] }
const dualNoReading = todayNextUp({ profile: owner, today, equipment: { ...dualRuleWorkspace, service_log: [logEntry('00000000-0000-4000-8000-000000000806', hydraulics.id, tractor.id, '2026-07-15', null), logEntry('00000000-0000-4000-8000-000000000807', tires.id, truck.id, '2026-07-14', null)] }, notifications: [] })
assert.deepEqual(dualNoReading.map((item) => [item.detail, item.badge]), [['John Deere 8R 340 · Hydraulic fluid', 'Due now']], 'On an interval with both rules, an entry without a reading resets the calendar rule but leaves the meter row due.')
const dualWithReading = todayNextUp({ profile: owner, today, equipment: { ...dualRuleWorkspace, service_log: [logEntry('00000000-0000-4000-8000-000000000806', hydraulics.id, tractor.id, '2026-07-15', 262.4), logEntry('00000000-0000-4000-8000-000000000807', tires.id, truck.id, '2026-07-14', null)] }, notifications: [] })
assert.deepEqual(dualWithReading, [], 'The same entry with a reading resets both rules.')
// Meter candidates come from the loaded readings, so a reading recorded on this device (the queue overlays it) that carries the
// machine past an interval is listed before the view has been re-read, and the view's stale rows never decide.
const crossedOffline = todayNextUp({ profile: owner, today, equipment: { ...workspace, intervals: [oil], tasks: [], service_due: [], meter_readings: [reading('00000000-0000-4000-8000-000000000903', tractor.id, 249, '2026-07-13'), reading('00000000-0000-4000-8000-000000000904', tractor.id, 250, '2026-07-15', '2026-07-15T13:00:00.000Z')] }, notifications: [] })
assert.deepEqual(crossedOffline.map((item) => [item.title, item.detail, item.badge]), [['Service due', 'John Deere 8R 340 · Engine oil', 'Due now']], 'A reading recorded offline that reaches the interval lists the service even though the view returned no row.')
const notYet = todayNextUp({ profile: owner, today, equipment: { ...workspace, intervals: [oil], tasks: [], meter_readings: [reading('00000000-0000-4000-8000-000000000903', tractor.id, 249, '2026-07-13')] }, notifications: [] })
assert.deepEqual(notYet, [], 'A stale view row is ignored when the readings do not reach the interval.')
const sameDay = todayNextUp({ profile: owner, today, equipment: { ...workspace, intervals: [oil], tasks: [], service_due: [], meter_readings: [reading('00000000-0000-4000-8000-000000000905', tractor.id, 251, '2026-07-15', '2026-07-15T08:00:00.000Z'), reading('00000000-0000-4000-8000-000000000906', tractor.id, 249.5, '2026-07-15', '2026-07-15T09:00:00.000Z')] }, notifications: [] })
assert.deepEqual(sameDay, [], 'The latest reading is chosen as the view orders it (date, then entry time), not by its value; a corrected later reading below the interval clears it.')
const sinceLastDone = todayNextUp({ profile: owner, today, equipment: { ...workspace, intervals: [{ ...oil, last_done_reading: 12.4 }], tasks: [], service_due: [] }, notifications: [] })
assert.deepEqual(sinceLastDone.map((item) => item.badge), ['Due now'], 'Hours since the last-done reading decide, and a float remainder is rounded to the columns\' two decimals rather than called late.')
const serviceReading = todayNextUp({ profile: owner, today, equipment: { ...workspace, intervals: [oil], tasks: [], service_due: [], meter_readings: [hours262, reading('00000000-0000-4000-8000-000000000907', tractor.id, 262.4, '2026-07-15', now, 'service')], service_log: [logEntry('00000000-0000-4000-8000-000000000808', oil.id, tractor.id, '2026-07-15', 262.4)] }, notifications: [] })
assert.deepEqual(serviceReading, [], 'An unsynced service entry with a reading, and the reading the queue writes beside it, reset the meter rule on Today.')
// A second service later on the same day: the server takes the newest reading-bearing entry (date, then entry time, then id), so
// an unsynced entry dated the last service day is that entry and resets the meter rule on Today too.
const servicedThisMorning: ServiceInterval = { ...oil, last_done_on: '2026-07-15', last_done_reading: 12.4 }
const dueAgainToday = todayNextUp({ profile: owner, today, equipment: { ...workspace, intervals: [servicedThisMorning], tasks: [], service_due: [] }, notifications: [] })
assert.deepEqual(dueAgainToday.map((item) => item.badge), ['Due now'], 'Reached again after this morning\'s service, the interval is due now.')
const sameDayEntry = todayNextUp({ profile: owner, today, equipment: { ...workspace, intervals: [servicedThisMorning], tasks: [], service_due: [], meter_readings: [hours262, reading('00000000-0000-4000-8000-000000000908', tractor.id, 262.4, '2026-07-15', now, 'service')], service_log: [logEntry('00000000-0000-4000-8000-000000000809', oil.id, tractor.id, '2026-07-15', 262.4)] }, notifications: [] })
assert.deepEqual(sameDayEntry, [], 'An unsynced service entry dated the same day as the last service resets the meter rule, as the server will.')
// Low inventory: the Inventory shelf's own rule (zero through five units on hand), only for members who can open Inventory.
const product = (id: string, name: string, inventory_unit: InventoryProduct['inventory_unit'], is_active = true): InventoryProduct => ({ id, farm_id: farmA, product_kind: 'chemical', name, inventory_unit, epa_registration_number: null, is_restricted_use: false, signal_word: null, restricted_entry_interval_hours: null, preharvest_interval_hours: null, max_label_rate: null, max_label_rate_unit: null, max_label_rate_basis: null, commodity_id: null, variety_name: null, fertilizer_analysis: null, manufacturer: null, is_active, created_at: now, updated_at: now })
const atrazine = product('00000000-0000-4000-8000-000000000701', 'Atrazine 4L', 'gal'); const roundup = product('00000000-0000-4000-8000-000000000702', 'Roundup PowerMax', 'gal'); const seed = product('00000000-0000-4000-8000-000000000703', 'DKC 62-08', 'seed_unit'); const retired = product('00000000-0000-4000-8000-000000000704', 'Old blend', 'gal', false); const shortfall = product('00000000-0000-4000-8000-000000000705', 'Miscounted', 'lb'); const never = product('00000000-0000-4000-8000-000000000706', 'Never received', 'qt')
const inventory: InventoryWorkspace = { fields: fieldsData, products: [roundup, atrazine, seed, retired, shortfall, never], receipts: [], receipt_lines: [], adjustments: [], applications: [], application_products: [], program_application_products: [], rup_completeness: [], on_hand: [{ product_id: atrazine.id, quantity: 4 }, { product_id: roundup.id, quantity: 120 }, { product_id: seed.id, quantity: 5 }, { product_id: retired.id, quantity: 1 }, { product_id: shortfall.id, quantity: -3 }] }
const lowRows = todayNextUp({ profile: owner, today, equipment: null, notifications: null, inventory })
assert.deepEqual(lowRows.map((item) => [item.kind, item.title, item.detail, item.badge, item.urgency, item.to]), [
  ['low_inventory', 'Low inventory', 'Atrazine 4L', '4 gal left', 'due', '/inventory'],
  ['low_inventory', 'Low inventory', 'DKC 62-08', '5 seed units left', 'due', '/inventory'],
  ['low_inventory', 'Low inventory', 'Never received', '0 qt left', 'due', '/inventory'],
], 'Low inventory lists active products at five units or fewer (a product with no on-hand row counts as zero, as on the shelf); plentiful, retired and over-used products are absent.')
assert.ok(todayNextUp({ profile: namedRep, today, equipment: null, notifications: null, inventory }).some((item) => item.kind === 'low_inventory'), 'A named rep can open Inventory, so low inventory is listed for them too.')
assert.ok(todayNextUp({ profile: worker, today, equipment: null, notifications: null, inventory }).some((item) => item.kind === 'low_inventory'), 'A worker without financial access sees low inventory.')
const combined = todayNextUp({ profile: owner, today, equipment: workspace, notifications, inventory })
assert.ok(combined.findIndex((item) => item.kind === 'low_inventory') > combined.findIndex((item) => item.urgency === 'overdue'), 'Low inventory sorts after overdue work.')
assert.deepEqual(todayNextUp({ profile: owner, today: '2026-07-12', equipment: workspace, notifications: [] }).map((item) => item.kind), ['service', 'service'], 'Tasks are due only from their due date on.')
assert.deepEqual(todayNextUp({ profile: worker, today, equipment: null, notifications }), [], 'Without the tasks snapshot a pass alert\'s state (applied, rescheduled) is unknown, so a worker handed only alerts sees no pass row; the section error explains the gap.')
assert.deepEqual(todayNextUp({ profile: owner, today, equipment: null, notifications }).map((item) => item.kind), ['grain_alert'], 'Grain alerts do not depend on task state and still list when tasks could not load.')

// Spray card: cached forecasts only, freshness-gated, no writes. The field sits at UTC-5 (Central Daylight); `wall` is the instant
// at which the field's wall clock reads the given time on 2026-07-15, and every case names the fetch and the read by that clock.
class MemoryStorage { private readonly values = new Map<string, string>(); writes = 0; getItem(key: string) { return this.values.get(key) ?? null }; setItem(key: string, value: string) { this.writes += 1; this.values.set(key, value) } }
const storage = new MemoryStorage()
const centralDaylight = -5 * 3600
const wall = (clock: string) => Date.parse(`2026-07-15T${clock}:00.000Z`) - centralDaylight * 1000
const hour = (time: string, wind = 6, precipitation_probability = 5): Record<string, unknown> => ({ time, temperature_f: 72, relative_humidity: 60, precipitation_in: 0, precipitation_probability, wind_speed_mph: wind, wind_direction_degrees: 225, wind_gusts_mph: wind + 3, cloud_cover: 30 })
const hours = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00'].map((clock, index) => hour(`2026-07-15T${clock}`, index >= 4 ? 16 : 6))
const daily = [{ date: '2026-07-15', precipitation_sum_in: 0, precipitation_probability_max: 10, temperature_max_f: 84, temperature_min_f: 61, sunrise: '2026-07-15T05:58', sunset: '2026-07-15T20:47' }]
const forecast = (fetched_at: string, current: Record<string, unknown>, hourly: Record<string, unknown>[] = hours, utc_offset_seconds: number | null = centralDaylight) => JSON.stringify({ version: 1, fetched_at, bundle: { current, hourly, daily, fetched_at, ...(utc_offset_seconds === null ? {} : { utc_offset_seconds }) } })
const cachedBundle = (fetched_at: string) => forecast(fetched_at, hour('2026-07-15T07:00'))
const seedForecast = (fetchClock: string, current: Record<string, unknown>, hourly: Record<string, unknown>[] = hours, utc_offset_seconds: number | null = centralDaylight) => { storage.setItem(weatherCacheKey(41.5, -93.6), forecast(new Date(wall(fetchClock)).toISOString(), current, hourly, utc_offset_seconds)); storage.writes = 0 }
const nowMs = wall('07:00')
assert.equal(nowMs, Date.parse(now), 'The fixture clock reads 7:00 at the field when the regression\'s instant is noon UTC.')
seedForecast('07:00', hour('2026-07-15T07:00'))
const readForecast = (latitude: number, longitude: number) => readCachedForecast(storage, latitude, longitude)
const card = todaySprayWindow(fieldsData.fields, readForecast, nowMs)
assert.ok(card, 'A fresh cached forecast produces a spray card.')
assert.equal(card.level, 'good'); assert.equal(card.fieldName, 'North Forty')
assert.match(card.headline, /^Good spray window until 10 AM$/, `Headline was ${card.headline}`)
assert.deepEqual(card.details, ['Wind 6 mph SW', 'No rain expected'])
assert.equal(storage.writes, 0, 'Reading the spray card wrote nothing.')
// The field's wall clock now is placed from the instant and the provider's offset, never from the observation's own stamp.
assert.equal(fieldWallClockNow(Date.parse('2026-07-15T12:00:00.000Z'), centralDaylight), '2026-07-15T07:00', 'Noon UTC is 7:00 at a Central Daylight field.')
assert.equal(fieldWallClockNow(Date.parse('2026-07-15T12:00:00.000Z'), 19800), '2026-07-15T17:30', 'A half-hour offset is honoured.')
assert.equal(fieldWallClockNow(Date.parse('2026-07-16T03:30:00.000Z'), centralDaylight), '2026-07-15T22:30', 'The field\'s date follows its clock, not the device\'s.')
const laterButFresh = todaySprayWindow(fieldsData.fields, readForecast, wall('08:20'))
assert.ok(laterButFresh && laterButFresh.headline === 'Good spray window until 10 AM', `At 8:20, with the cache 80 minutes old and still inside the ceiling, the window still runs to 10 AM (saw ${laterButFresh?.headline}).`)
seedForecast('09:30', hour('2026-07-15T09:30'))
const windowPassed = todaySprayWindow(fieldsData.fields, readForecast, wall('10:00'))
assert.ok(windowPassed && windowPassed.level !== 'good' && !windowPassed.headline.startsWith('Good spray window'), `A forecast fetched at 9:30 read at 10:00 must not offer the window that closed at 10 (saw ${windowPassed?.level} · ${windowPassed?.headline}).`)
assert.equal(windowPassed.details[0], 'Wind 16 mph SW', 'Conditions come from the hourly sample at the field\'s wall clock now, not the fetched current sample.')
// A fresh current observation between hourly rows outranks the older hourly row before it.
const gusty = { ...hour('2026-07-15T10:45'), wind_speed_mph: 20, wind_gusts_mph: 28 }
const calmHours = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00'].map((clock) => hour(`2026-07-15T${clock}`))
seedForecast('10:45', gusty, calmHours)
const freshGust = todaySprayWindow(fieldsData.fields, readForecast, wall('10:50'))
assert.ok(freshGust && freshGust.level !== 'good' && freshGust.details[0] === 'Wind 20 mph SW', `A 10:45 observation of 20 mph must outrank the calm 10:00 hourly row (saw ${freshGust?.level} · ${freshGust?.details[0]}).`)
const gustThenCalmHour = todaySprayWindow(fieldsData.fields, readForecast, wall('11:10'))
assert.ok(gustThenCalmHour && gustThenCalmHour.details[0] === 'Wind 6 mph SW', `Once the 11:00 hourly row is newer than the observation it takes over (saw ${gustThenCalmHour?.details[0]}).`)
// The provider stamps current conditions at its last observation interval, so a 10:59 fetch carries a 10:45 observation. The
// clock is the instant plus the offset (11:05), so the unsafe 11:00 row has arrived; shifting the observation by the cache age
// would have read 10:51 and kept the calm 10:45 verdict.
seedForecast('10:59', hour('2026-07-15T10:45'))
const laggedObservation = todaySprayWindow(fieldsData.fields, readForecast, wall('11:05'))
assert.ok(laggedObservation && laggedObservation.level !== 'good' && laggedObservation.details[0] === 'Wind 16 mph SW', `At 11:05 the 11:00 hourly row decides even though the observation fetched at 10:59 was stamped 10:45 (saw ${laggedObservation?.level} · ${laggedObservation?.details[0]}).`)
seedForecast('10:59', hour('2026-07-15T10:45'), hours, null)
assert.equal(todaySprayWindow(fieldsData.fields, readForecast, wall('11:05')), null, 'A forecast saved before the field\'s offset was recorded cannot place the field\'s clock and is not judged; the Weather link stands in.')
// Good now, an unsafe hour next, then a later good run: never "until 2 PM" across the gap.
const gapHours = [['10:00', 6], ['11:00', 16], ['12:00', 6], ['13:00', 6], ['14:00', 6], ['15:00', 16]].map(([clock, wind]) => ({ ...hour(`2026-07-15T${clock}`), wind_speed_mph: wind as number, wind_gusts_mph: (wind as number) + 3 }))
seedForecast('10:45', hour('2026-07-15T10:45'), gapHours)
const gapped = todaySprayWindow(fieldsData.fields, readForecast, wall('10:50'))
assert.ok(gapped && gapped.level === 'good' && gapped.headline === 'Good spray conditions right now', `Good now with an unsafe 11:00 must not claim a window through 2 PM (saw ${gapped?.headline}).`)
assert.ok(gapped.details.includes('Next window opens at 12 PM'), `The later opening is named separately (saw ${gapped.details.join(' | ')}).`)
const continuous = todaySprayWindow(fieldsData.fields, readForecast, wall('12:05'))
assert.ok(continuous && continuous.headline === 'Good spray window until 3 PM' && !continuous.details.some((detail) => detail.startsWith('Next window')), `At 12:05, standing in the good run, "until 3 PM" is right (saw ${continuous?.headline} | ${continuous?.details.join(' | ')}).`)
// The farm's calendar day comes from its stored time zone; the device's day only when the zone is unknown or unusable.
const lateEvening = new Date('2026-07-16T03:30:00.000Z')
assert.equal(farmCalendarDate(lateEvening, 'America/Chicago'), '2026-07-15', 'At 10:30 PM Central the farm\'s day is still the 15th.')
assert.equal(farmCalendarDate(lateEvening, 'Asia/Tokyo'), '2026-07-16', 'A device in Tokyo does not change the farm\'s day; the farm\'s zone does.')
assert.equal(farmCalendarDate(lateEvening, null), farmLocalCalendarDate(lateEvening), 'Without a stored zone the device\'s day is used.')
assert.equal(farmCalendarDate(lateEvening, 'Not/AZone'), farmLocalCalendarDate(lateEvening), 'An unusable zone falls back to the device\'s day rather than failing.')
storage.setItem(weatherCacheKey(41.5, -93.6), cachedBundle(new Date(nowMs - 30 * 60_000).toISOString())); storage.writes = 0
storage.setItem(weatherCacheKey(41.5, -93.6), cachedBundle(new Date(nowMs - 3 * 60 * 60_000).toISOString())); storage.writes = 0
assert.equal(todaySprayWindow(fieldsData.fields, readForecast, nowMs), null, 'A forecast too old to act on is skipped, so Today never shows a green verdict from stale weather.')
assert.equal(todaySprayWindow([field('00000000-0000-4000-8000-000000000103', 'No pin', null, null)], readForecast, nowMs), null, 'A field without a location has no spray card.')
assert.equal(todaySprayWindow([field('00000000-0000-4000-8000-000000000101', 'Retired', 41.5, -93.6, false)], readForecast, nowMs), null, 'An inactive field has no spray card.')
storage.setItem(weatherCacheKey(41.5, -93.6), '{not json'); assert.equal(readCachedForecast(storage, 41.5, -93.6), null, 'A corrupt cache reads as no forecast.')
assert.equal(readCachedForecast(storage, 40, -90), null, 'A missing cache reads as no forecast.')
assert.equal(storage.writes, 1, 'Nothing beyond the fixture write touched storage.')

// Offline inventory: a Fields snapshot answered from its cache is a network failure the queued layer must recognize, so it can
// answer Today from the complete cached Inventory workspace instead of surfacing a validation error.
{
  const gateway = { loadWorkspace: async () => ({ products: [], receipts: [], receipt_lines: [], adjustments: [], applications: [], application_products: [], program_application_products: [], on_hand: [], rup_completeness: [] }) } as unknown as InventoryDataGateway
  const offlineFields = { getData: async () => fieldsData, getSnapshot: async () => ({ data: fieldsData, source: 'offline' as const, capturedAt: now }) } as unknown as FieldsRepository
  const repository = new SupabaseInventoryRepository({ gateway, fieldsRepository: offlineFields, getFarmId: async () => farmA, getOperationContext: async () => { throw new Error('not used') }, verifyOperationContext: async () => {}, verifySnapshotContext: () => {}, createId: () => '00000000-0000-4000-8000-000000000999', clock: () => now })
  let caught: unknown = null
  try { await repository.getSnapshot({ projectRef: 'test', userId: userA, farmId: farmA, generation: 1, token: '00000000-0000-4000-8000-000000000900', serverEpoch: 1 }) } catch (error) { caught = error }
  assert.ok(caught instanceof Error && isTransportFailure(caught, false), `An offline Fields snapshot under the pure Inventory read must surface as a transport failure (saw ${caught instanceof Error ? caught.message : String(caught)}).`)
}
console.log('Today regressions passed (role matrix, next-up sources, spray card, intents, offline inventory).')
