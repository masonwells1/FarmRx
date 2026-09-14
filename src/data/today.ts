import { canAccessFarmModule, canEditFarmModule, type FarmAccessProfile, type FarmAppModule } from '../auth/farmContext'
import type { EquipmentTasksWorkspace } from './equipmentTasks'
import type { InventoryUnit, InventoryWorkspace } from './inventory'
import type { Field } from './fields'
import type { Notification } from './notifications'
import type { ForecastBundle, SprayLevel } from './weather'
import { bestWindowToday, compassLabel, evaluateSprayWindow, fieldWallClockDate, formatHour, formatMph, isActionablyFresh } from './weatherService'
import { manualSprayRecordIntent } from './weatherSprayHandoff'
import { todayRecordIntent } from './todayIntents'

// Today is a read-only projection of records the modules already produce (GOAL.md, Initiative FD-1). Everything here is a pure
// function of data the screen was handed: nothing is fetched, replayed, generated, or cached in this file.

export type TodayRecordKind = 'rain' | 'scouting' | 'spray' | 'task' | 'harvest' | 'grain_delivery'
export type TodayRecordTile = { kind: TodayRecordKind; label: string; module: FarmAppModule; to: string; state: unknown }

const recordTiles: readonly TodayRecordTile[] = [
  { kind: 'rain', label: 'Rain', module: 'field_log', to: '/field-log', state: todayRecordIntent('rainfall') },
  { kind: 'scouting', label: 'Scouting note', module: 'scouting', to: '/scouting', state: todayRecordIntent('scouting') },
  { kind: 'spray', label: 'Spray record', module: 'inventory', to: '/inventory', state: manualSprayRecordIntent },
  { kind: 'task', label: 'Task', module: 'tasks', to: '/tasks', state: todayRecordIntent('task') },
  { kind: 'harvest', label: 'Harvest', module: 'harvest', to: '/harvest', state: todayRecordIntent('harvest') },
  { kind: 'grain_delivery', label: 'Grain delivery', module: 'grain', to: '/grain/contracts', state: todayRecordIntent('grain_delivery') },
]

/** The record tiles this member may both reach and complete: a read-only member sees none, and a member without financial access
 * never sees Grain delivery, because the same checks that gate the module routes gate the tiles. */
export function todayRecordTiles(profile: FarmAccessProfile): TodayRecordTile[] {
  return recordTiles.filter((tile) => canAccessFarmModule(profile, tile.module) && canEditFarmModule(profile, tile.module))
}

export type TodayNextUpKind = 'service' | 'task' | 'program' | 'grain_alert' | 'low_inventory'
export type TodayNextUpUrgency = 'overdue' | 'due' | 'info'
export type TodayNextUpItem = { id: string; kind: TodayNextUpKind; title: string; detail: string; badge: string | null; urgency: TodayNextUpUrgency; to: string }

const urgencyOrder: Record<TodayNextUpUrgency, number> = { overdue: 0, due: 1, info: 2 }
const wholeNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
/** Postgres `date + make_interval(months => n)`: the same day n months on, clamped to the end of a shorter month. */
export function addMonthsClamped(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number)
  const target = new Date(Date.UTC(year, month - 1 + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${target.getUTCFullYear()}-${pad(target.getUTCMonth() + 1)}-${pad(Math.min(day, lastDay))}`
}
function daysBetween(earlier: string, later: string): number { return Math.max(0, Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000)) }
const plural = (count: number, unit: string) => `${wholeNumber.format(count)} ${unit}${count === 1 ? '' : 's'}`
const quantity = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const unitLabels: Partial<Record<InventoryUnit, string>> = { fl_oz: 'fl oz', l: 'L', ml: 'mL', bag: 'bags', case: 'cases', tote: 'totes', seed_unit: 'seed units', bulk_unit: 'bulk units' }
/** The Inventory shelf's own low-on-hand rule: a confirmed count from zero through five inventory units. Negative counts are a
 * different problem (more used than received) that the shelf explains itself, so they are not "low". */
export const lowOnHandMaximum = 5
export const isLowOnHand = (onHand: number) => onHand >= 0 && onHand <= lowOnHandMaximum

const programPassLink = /^\/programs\?pass=([0-9a-f-]{36})$/i
const passIdOf = (link: string) => programPassLink.exec(link)?.[1]?.toLowerCase() ?? null

/** Next up, from existing records only: overdue service (the equipment service-due view), tasks due or overdue, program passes due
 * and fired grain alerts (both already written to the alerts table by the modules that own them). Each source is included only
 * when this member may open the module it points to, and grain alerts only with financial access, so a member without it never
 * sees a grain line. Alerts belong to the selected farm only. The due-generation functions also write a task for an overdue
 * service interval and for a due program pass; when the service-due row or the pass alert is already shown, that generated task
 * is the same work and is not listed twice. Applying a pass closes its generated task but leaves the alert unread, so an unread
 * pass alert whose generated task is already done is finished work and is not listed, and one whose task was rescheduled to a
 * later date is a past reminder and is not listed until that date; when the tasks could not be loaded at all, pass state is
 * unknown and no pass alert is listed. Low inventory is the Inventory shelf's own
 * low-on-hand rule applied to the same on-hand view. A source the screen could not load is simply absent. */
export function todayNextUp(input: { profile: FarmAccessProfile; today: string; equipment: EquipmentTasksWorkspace | null; notifications: readonly Notification[] | null; inventory?: InventoryWorkspace | null }): TodayNextUpItem[] {
  const { profile, today, equipment, notifications } = input
  const inventory = input.inventory ?? null
  const items: TodayNextUpItem[] = []
  const farmNotifications = (notifications ?? []).filter((notification) => notification.farm_id === profile.farmId)
  const unread = farmNotifications.filter((notification) => notification.read_at === null && notification.link !== null).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
  const appliedPassIds = new Set((equipment?.tasks ?? []).filter((task) => task.source === 'program' && task.status === 'done' && task.program_assigned_pass_id !== null).map((task) => task.program_assigned_pass_id!.toLowerCase()))
  // Rescheduling a pass moves its generated task to the new date but leaves the old alert unread; an alert whose task is now due
  // in the future is a past reminder, not work for today, and the task itself returns to Next up when its new date arrives.
  const rescheduledPassIds = new Set((equipment?.tasks ?? []).filter((task) => task.source === 'program' && task.status !== 'done' && task.program_assigned_pass_id !== null && task.due_on !== null && task.due_on > today).map((task) => task.program_assigned_pass_id!.toLowerCase()))
  // Whether a pass is applied or rescheduled is read from its generated task, so without the Equipment and Tasks snapshot the
  // state of every pass alert is unknown and none is listed (the section's own error is shown instead).
  const passStateKnown = equipment !== null
  const passAlertIsOpen = (link: string) => { const passId = passIdOf(link); return passId === null || (passStateKnown && !appliedPassIds.has(passId) && !rescheduledPassIds.has(passId)) }
  const shownPassIds = new Set(canAccessFarmModule(profile, 'programs') ? unread.filter((notification) => passAlertIsOpen(notification.link!)).map((notification) => passIdOf(notification.link!)).filter((id): id is string => id !== null) : [])
  const shownServiceIntervalIds = new Set<string>()
  if (equipment && canAccessFarmModule(profile, 'equipment')) {
    const machines = new Map(equipment.equipment.map((machine) => [machine.id, machine]))
    const intervals = new Map(equipment.intervals.map((interval) => [interval.id, interval]))
    // The view judges calendar intervals against the database's own date, which can sit a day either side of the farm's day,
    // and its meter rows are only as current as the last sync. Today therefore derives both kinds of candidate itself from the
    // loaded intervals, machines and readings, exactly as the view does, and ignores the view's rows. Calendar: an active
    // interval with a months rule on an active machine, due from the last service, or the machine's first day, plus the
    // interval's months, judged against the farm's day, the same day the tasks use. Meter: an active interval with a meter rule
    // on an active machine that has a reading; the machine's latest reading (by date, then entry time, then id, as the view
    // orders) less the interval's last-done reading, or zero, less the interval's length, due at zero or more. A reading recorded
    // on this device but not yet synced is already among the loaded readings, so a machine carried past an interval offline is
    // listed before the view knows. Amounts are rounded to the columns' two decimals so a float remainder is never called late.
    type Due = EquipmentTasksWorkspace['service_due'][number]
    type Reading = EquipmentTasksWorkspace['meter_readings'][number]
    type LogEntry = EquipmentTasksWorkspace['service_log'][number]
    const newerReading = (a: Reading, b: Reading) => a.read_on.localeCompare(b.read_on) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
    const latestReading = new Map<string, Reading>()
    for (const reading of equipment.meter_readings) { const current = latestReading.get(reading.equipment_id); if (!current || newerReading(reading, current) > 0) latestReading.set(reading.equipment_id, reading) }
    // Service recorded on this device but not yet synced sits in the service log ahead of the interval's last-done values (the
    // server resets those when the entry lands). A log entry for the interval dated after its last service means the interval
    // has been reset since, so its calendar rule counts from that entry; once synced the dates agree again. The server advances
    // the last-done date from any entry but the last-done reading only from an entry that carries a meter reading, so the
    // meter rule takes its last-done reading from the newest such entry dated after the last service, else from the interval.
    const newerEntry = (a: LogEntry, b: LogEntry) => a.service_date.localeCompare(b.service_date) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)
    const latestEntry = new Map<string, LogEntry>()
    const latestReadingEntry = new Map<string, LogEntry>()
    for (const entry of equipment.service_log) {
      if (entry.interval_id === null) continue
      const current = latestEntry.get(entry.interval_id); if (!current || newerEntry(entry, current) > 0) latestEntry.set(entry.interval_id, entry)
      if (entry.meter_reading !== null) { const read = latestReadingEntry.get(entry.interval_id); if (!read || newerEntry(entry, read) > 0) latestReadingEntry.set(entry.interval_id, entry) }
    }
    const meterRows = equipment.intervals.flatMap((interval): Array<{ due: Due; amount: number }> => {
      const machine = machines.get(interval.equipment_id); const reading = latestReading.get(interval.equipment_id)
      if (!interval.is_active || interval.every_meter === null || !machine || machine.status !== 'active' || !reading) return []
      const unsynced = latestReadingEntry.get(interval.id)
      // On or after the last service day: the server picks the newest reading-bearing entry by date, then entry time, then id,
      // so a second service later the same day is that entry, and on the synced day the entry's reading is the interval's own.
      const lastDoneReading = unsynced && unsynced.service_date >= (interval.last_done_on ?? '') ? unsynced.meter_reading! : interval.last_done_reading
      const amount = Math.round((reading.reading - (lastDoneReading ?? 0) - interval.every_meter) * 100) / 100
      if (amount < 0) return []
      return [{ due: { farm_id: interval.farm_id, equipment_id: interval.equipment_id, interval_id: interval.id, reason: 'meter', overdue_amount: amount }, amount }]
    })
    const calendarRows = equipment.intervals.flatMap((interval): Array<{ due: Due; amount: number }> => {
      const machine = machines.get(interval.equipment_id)
      if (!interval.is_active || interval.every_months === null || !machine || machine.status !== 'active') return []
      const unsynced = latestEntry.get(interval.id)
      const lastServiceOn = [interval.last_done_on ?? machine.created_at.slice(0, 10), unsynced?.service_date ?? ''].sort()[1]
      const dueOn = addMonthsClamped(lastServiceOn, interval.every_months)
      if (dueOn > today) return []
      const amount = daysBetween(dueOn, today)
      return [{ due: { farm_id: interval.farm_id, equipment_id: interval.equipment_id, interval_id: interval.id, reason: 'calendar', overdue_amount: amount }, amount }]
    })
    const judged = [...meterRows, ...calendarRows]
    // One card per interval: an interval with both a meter and a calendar rule can be due on both, and recording the service
    // resets the one interval. The overdue row represents it; between equals the meter row does, as the due-generation SQL orders.
    const representative = new Map<string, { due: Due; amount: number }>()
    const rank = (entry: { due: Due; amount: number }) => (entry.amount > 0 ? 0 : 2) + (entry.due.reason === 'meter' ? 0 : 1)
    for (const entry of judged) { const current = representative.get(entry.due.interval_id); if (!current || rank(entry) < rank(current)) representative.set(entry.due.interval_id, entry) }
    for (const { due, amount } of representative.values()) {
      const machine = machines.get(due.equipment_id); const interval = intervals.get(due.interval_id)
      if (!machine || !interval) continue
      // An interval reached exactly (amount 0) is due now, not late. Any positive amount is late, however small; rounding is for
      // display only.
      const overdue = amount > 0
      const unit = due.reason === 'meter' ? (machine.meter_unit === 'miles' ? 'mile' : 'hour') : 'day'
      const badge = !overdue ? 'Due now' : amount < 1 ? `Less than 1 ${unit} over` : `${plural(Math.round(amount), unit)} over`
      items.push({ id: `service:${due.interval_id}`, kind: 'service', title: overdue ? 'Service overdue' : 'Service due', detail: `${machine.name} · ${interval.name}`, badge, urgency: overdue ? 'overdue' : 'due', to: '/equipment' })
      shownServiceIntervalIds.add(due.interval_id)
    }
  }
  if (equipment && canAccessFarmModule(profile, 'tasks')) {
    const generatedElsewhere = (task: EquipmentTasksWorkspace['tasks'][number]) => (task.source === 'service_interval' && task.interval_id !== null && shownServiceIntervalIds.has(task.interval_id)) || (task.source === 'program' && task.program_assigned_pass_id !== null && shownPassIds.has(task.program_assigned_pass_id.toLowerCase()))
    const due = equipment.tasks.filter((task) => task.status !== 'done' && task.due_on !== null && task.due_on <= today && !generatedElsewhere(task)).sort((a, b) => (a.due_on ?? '').localeCompare(b.due_on ?? '') || a.title.localeCompare(b.title))
    for (const task of due) {
      const overdue = (task.due_on ?? today) < today
      items.push({ id: `task:${task.id}`, kind: 'task', title: overdue ? 'Task overdue' : 'Task due today', detail: task.title, badge: overdue ? `${plural(daysBetween(task.due_on!, today), 'day')} late` : null, urgency: overdue ? 'overdue' : 'due', to: '/tasks' })
    }
  }
  if (notifications) {
    // A pass rescheduled and reached again can carry two unread reminders (the dedupe key includes the date); one row per pass.
    const listedPassIds = new Set<string>()
    for (const notification of unread) {
      const link = notification.link!
      const passId = passIdOf(link)
      if (link.startsWith('/programs') && passId !== null && listedPassIds.has(passId)) continue
      if (passId !== null) listedPassIds.add(passId)
      if (link.startsWith('/programs') && canAccessFarmModule(profile, 'programs') && passAlertIsOpen(link)) items.push({ id: `program:${notification.id}`, kind: 'program', title: 'Program pass due', detail: notification.title, badge: null, urgency: 'due', to: link })
      else if (link.startsWith('/grain') && canAccessFarmModule(profile, 'grain')) items.push({ id: `grain_alert:${notification.id}`, kind: 'grain_alert', title: 'Grain alert', detail: notification.title, badge: null, urgency: 'info', to: link })
    }
  }
  if (inventory && canAccessFarmModule(profile, 'inventory')) {
    const onHand = new Map(inventory.on_hand.map((row) => [row.product_id, row.quantity]))
    const low = inventory.products.filter((product) => product.is_active && isLowOnHand(onHand.get(product.id) ?? 0)).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    for (const product of low) { const left = onHand.get(product.id) ?? 0; items.push({ id: `low_inventory:${product.id}`, kind: 'low_inventory', title: 'Low inventory', detail: product.name, badge: `${quantity.format(left)} ${unitLabels[product.inventory_unit] ?? product.inventory_unit} left`, urgency: 'due', to: '/inventory' }) }
  }
  return items.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency])
}

export type TodaySprayCard = { level: SprayLevel; headline: string; details: string[]; fieldName: string }

const dailyFor = (bundle: ForecastBundle, time: string) => bundle.daily.find((day) => day.date === time.slice(0, 10)) ?? bundle.daily[0]
const naiveWallClock = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/
/** The field's wall clock at an instant, in the forecast's own notation (a naive local time), from the UTC offset the provider
 * reported with the forecast. The forecast's observation time is not used as a clock: the provider stamps its current conditions
 * at the last observation interval, which can sit up to a quarter hour behind the moment they were fetched. */
export function fieldWallClockNow(nowMs: number, utcOffsetSeconds: number): string {
  const date = new Date(nowMs + utcOffsetSeconds * 1000)
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
}
const wallClockMs = (time: string) => naiveWallClock.test(time) ? fieldWallClockDate(time).getTime() : Date.parse(time)
const levelOrder: Record<SprayLevel, number> = { good: 0, caution: 1, poor: 2 }

/** The spray-window card from forecasts this browser already holds (the Weather page fetched and cached them). A forecast that is
 * missing or too old to act on is skipped, so Today never fetches or writes on its own; with no usable forecast the caller shows a
 * link to Weather instead. The field with the best current verdict is shown. */
export function todaySprayWindow(fields: readonly Field[], readForecast: (latitude: number, longitude: number) => ForecastBundle | null, nowMs: number): TodaySprayCard | null {
  let best: TodaySprayCard | null = null
  for (const field of fields) {
    if (!field.is_active || field.latitude === null || field.longitude === null) continue
    const bundle = readForecast(field.latitude, field.longitude)
    // A forecast saved before the field's UTC offset was recorded cannot place the field's clock now and is not judged; the
    // caller's Weather link stands in until the Weather page saves a current one.
    if (!bundle || typeof bundle.utc_offset_seconds !== 'number' || !isActionablyFresh(bundle, nowMs)) continue
    // Judge the window from the field's wall clock now, placed from this instant and the field's offset, not from the moment the
    // forecast was fetched or the observation's own stamp. The conditions are the fetched current observation until an hourly
    // sample newer than it has arrived (an hourly row at or before now but after the observation), and hours already passed
    // never count.
    const now = fieldWallClockNow(nowMs, bundle.utc_offset_seconds)
    const nowAt = wallClockMs(now); const observedAt = wallClockMs(bundle.current.time)
    const sample = [...bundle.hourly].filter((hourly) => wallClockMs(hourly.time) <= nowAt && wallClockMs(hourly.time) > observedAt).sort((a, b) => wallClockMs(b.time) - wallClockMs(a.time))[0] ?? bundle.current
    const day = dailyFor(bundle, now)
    const ctx = { now, hourly: bundle.hourly, sunrise: day?.sunrise ?? null, sunset: day?.sunset ?? null }
    const verdict = evaluateSprayWindow(sample, ctx)
    const window = bestWindowToday(bundle.hourly, ctx)
    // "Until" is only honest when the best window is the one the farmer is standing in: it must begin by the next hourly mark.
    // Good conditions now with an unsafe hour before a later good run are reported as good now, with the later opening named
    // separately, so the gap is never presented as sprayable.
    const windowIsNow = window !== null && wallClockMs(window.start) - nowAt <= 3_600_000
    const headline = verdict.level === 'good' ? (window && windowIsNow ? `Good spray window until ${formatHour(window.end)}` : 'Good spray conditions right now') : window ? `Spray window opens at ${formatHour(window.start)}` : verdict.level === 'caution' ? 'Use caution spraying today' : 'No good spray window today'
    const rainChance = day?.precipitation_probability_max ?? null
    const details = [`Wind ${formatMph(sample.wind_speed_mph)} ${compassLabel(sample.wind_direction_degrees)}`, rainChance === null ? 'Rain chance unknown' : rainChance < 30 ? 'No rain expected' : `${Math.round(rainChance)}% rain chance`]
    if (verdict.level === 'good' && window && !windowIsNow) details.push(`Next window opens at ${formatHour(window.start)}`)
    const card: TodaySprayCard = { level: verdict.level, headline, details, fieldName: field.name }
    if (!best || levelOrder[card.level] < levelOrder[best.level]) best = card
  }
  return best
}
