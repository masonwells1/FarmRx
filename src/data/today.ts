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
    // The view judges calendar rows against the database's own date. Today judges them against the farm's day, the same day the
    // tasks use, by recomputing the interval's due date (last service, or the machine's first day, plus the interval's months, as
    // the view does) and counting days from there; a calendar row not yet due on the farm's day is not listed. Meter rows carry
    // no date and are taken as the view reports them.
    type Due = EquipmentTasksWorkspace['service_due'][number]
    const judged = equipment.service_due.flatMap((due): Array<{ due: Due; amount: number }> => {
      if (due.reason !== 'calendar') return [{ due, amount: due.overdue_amount }]
      const machine = machines.get(due.equipment_id); const interval = intervals.get(due.interval_id)
      if (!machine || !interval || interval.every_months === null) return [{ due, amount: due.overdue_amount }]
      const dueOn = addMonthsClamped(interval.last_done_on ?? machine.created_at.slice(0, 10), interval.every_months)
      return dueOn > today ? [] : [{ due, amount: daysBetween(dueOn, today) }]
    })
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
/** A forecast's times are the field's wall clock at fetch time. Moving that clock forward by the cache age gives the field's wall
 * clock now, in the same notation, so hours already gone are never offered as a window. */
export function shiftWallClock(time: string, byMs: number): string {
  if (!naiveWallClock.test(time)) return new Date(Date.parse(time) + byMs).toISOString()
  const date = new Date(fieldWallClockDate(time).getTime() + byMs)
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
    if (!bundle || !isActionablyFresh(bundle, nowMs)) continue
    // Judge the window from the field's wall clock now, not from the moment the forecast was fetched. The conditions are the
    // fetched current observation until an hourly sample newer than it has arrived (an hourly row at or before now but after the
    // observation), and hours already passed never count.
    const now = shiftWallClock(bundle.current.time, Math.max(0, nowMs - Date.parse(bundle.fetched_at)))
    const nowAt = wallClockMs(now); const observedAt = wallClockMs(bundle.current.time)
    const sample = [...bundle.hourly].filter((hourly) => wallClockMs(hourly.time) <= nowAt && wallClockMs(hourly.time) > observedAt).sort((a, b) => wallClockMs(b.time) - wallClockMs(a.time))[0] ?? bundle.current
    const day = dailyFor(bundle, now)
    const ctx = { now, hourly: bundle.hourly, sunrise: day?.sunrise ?? null, sunset: day?.sunset ?? null }
    const verdict = evaluateSprayWindow(sample, ctx)
    const window = bestWindowToday(bundle.hourly, ctx)
    const headline = verdict.level === 'good' ? (window ? `Good spray window until ${formatHour(window.end)}` : 'Good spray conditions right now') : window ? `Spray window opens at ${formatHour(window.start)}` : verdict.level === 'caution' ? 'Use caution spraying today' : 'No good spray window today'
    const rainChance = day?.precipitation_probability_max ?? null
    const details = [`Wind ${formatMph(sample.wind_speed_mph)} ${compassLabel(sample.wind_direction_degrees)}`, rainChance === null ? 'Rain chance unknown' : rainChance < 30 ? 'No rain expected' : `${Math.round(rainChance)}% rain chance`]
    const card: TodaySprayCard = { level: verdict.level, headline, details, fieldName: field.name }
    if (!best || levelOrder[card.level] < levelOrder[best.level]) best = card
  }
  return best
}
