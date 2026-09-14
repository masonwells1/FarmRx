import { canAccessFarmModule, canEditFarmModule, type FarmAccessProfile, type FarmAppModule } from '../auth/farmContext'
import type { EquipmentTasksWorkspace } from './equipmentTasks'
import type { Field } from './fields'
import type { Notification } from './notifications'
import type { ForecastBundle, SprayLevel } from './weather'
import { bestWindowToday, compassLabel, evaluateSprayWindow, formatHour, formatMph, isActionablyFresh } from './weatherService'
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

export type TodayNextUpKind = 'service' | 'task' | 'program' | 'grain_alert'
export type TodayNextUpUrgency = 'overdue' | 'due' | 'info'
export type TodayNextUpItem = { id: string; kind: TodayNextUpKind; title: string; detail: string; badge: string | null; urgency: TodayNextUpUrgency; to: string }

const urgencyOrder: Record<TodayNextUpUrgency, number> = { overdue: 0, due: 1, info: 2 }
const wholeNumber = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
function daysBetween(earlier: string, later: string): number { return Math.max(0, Math.round((Date.parse(`${later}T00:00:00Z`) - Date.parse(`${earlier}T00:00:00Z`)) / 86_400_000)) }
const plural = (count: number, unit: string) => `${wholeNumber.format(count)} ${unit}${count === 1 ? '' : 's'}`

const programPassLink = /^\/programs\?pass=([0-9a-f-]{36})$/i
const passIdOf = (link: string) => programPassLink.exec(link)?.[1]?.toLowerCase() ?? null

/** Next up, from existing records only: overdue service (the equipment service-due view), tasks due or overdue, program passes due
 * and fired grain alerts (both already written to the alerts table by the modules that own them). Each source is included only
 * when this member may open the module it points to, and grain alerts only with financial access, so a member without it never
 * sees a grain line. Alerts belong to the selected farm only. The due-generation functions also write a task for an overdue
 * service interval and for a due program pass; when the service-due row or the pass alert is already shown, that generated task
 * is the same work and is not listed twice. Applying a pass closes its generated task but leaves the alert unread, so an unread
 * pass alert whose generated task is already done is finished work and is not listed. A source the screen could not load is
 * simply absent. */
export function todayNextUp(input: { profile: FarmAccessProfile; today: string; equipment: EquipmentTasksWorkspace | null; notifications: readonly Notification[] | null }): TodayNextUpItem[] {
  const { profile, today, equipment, notifications } = input
  const items: TodayNextUpItem[] = []
  const farmNotifications = (notifications ?? []).filter((notification) => notification.farm_id === profile.farmId)
  const unread = farmNotifications.filter((notification) => notification.read_at === null && notification.link !== null).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))
  const appliedPassIds = new Set((equipment?.tasks ?? []).filter((task) => task.source === 'program' && task.status === 'done' && task.program_assigned_pass_id !== null).map((task) => task.program_assigned_pass_id!.toLowerCase()))
  const passAlertIsOpen = (link: string) => { const passId = passIdOf(link); return passId === null || !appliedPassIds.has(passId) }
  const shownPassIds = new Set(canAccessFarmModule(profile, 'programs') ? unread.filter((notification) => passAlertIsOpen(notification.link!)).map((notification) => passIdOf(notification.link!)).filter((id): id is string => id !== null) : [])
  const shownServiceIntervalIds = new Set<string>()
  if (equipment && canAccessFarmModule(profile, 'equipment')) {
    const machines = new Map(equipment.equipment.map((machine) => [machine.id, machine]))
    const intervals = new Map(equipment.intervals.map((interval) => [interval.id, interval]))
    for (const due of equipment.service_due) {
      const machine = machines.get(due.equipment_id); const interval = intervals.get(due.interval_id)
      if (!machine || !interval) continue
      const amount = Math.max(0, Math.round(due.overdue_amount))
      const badge = due.reason === 'meter' ? `${plural(amount, machine.meter_unit === 'miles' ? 'mile' : 'hour')} over` : `${plural(amount, 'day')} over`
      items.push({ id: `service:${due.interval_id}:${due.reason}`, kind: 'service', title: 'Service overdue', detail: `${machine.name} · ${interval.name}`, badge, urgency: 'overdue', to: '/equipment' })
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
    for (const notification of unread) {
      const link = notification.link!
      if (link.startsWith('/programs') && canAccessFarmModule(profile, 'programs') && passAlertIsOpen(link)) items.push({ id: `program:${notification.id}`, kind: 'program', title: 'Program pass due', detail: notification.title, badge: null, urgency: 'due', to: link })
      else if (link.startsWith('/grain') && canAccessFarmModule(profile, 'grain')) items.push({ id: `grain_alert:${notification.id}`, kind: 'grain_alert', title: 'Grain alert', detail: notification.title, badge: null, urgency: 'info', to: link })
    }
  }
  return items.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency])
}

export type TodaySprayCard = { level: SprayLevel; headline: string; details: string[]; fieldName: string }

const dailyFor = (bundle: ForecastBundle, time: string) => bundle.daily.find((day) => day.date === time.slice(0, 10)) ?? bundle.daily[0]
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
    const day = dailyFor(bundle, bundle.current.time)
    const ctx = { now: bundle.current.time, hourly: bundle.hourly, sunrise: day?.sunrise ?? null, sunset: day?.sunset ?? null }
    const verdict = evaluateSprayWindow(bundle.current, ctx)
    const window = bestWindowToday(bundle.hourly, ctx)
    const headline = verdict.level === 'good' ? (window ? `Good spray window until ${formatHour(window.end)}` : 'Good spray conditions right now') : window ? `Spray window opens at ${formatHour(window.start)}` : verdict.level === 'caution' ? 'Use caution spraying today' : 'No good spray window today'
    const rainChance = day?.precipitation_probability_max ?? null
    const details = [`Wind ${formatMph(bundle.current.wind_speed_mph)} ${compassLabel(bundle.current.wind_direction_degrees)}`, rainChance === null ? 'Rain chance unknown' : rainChance < 30 ? 'No rain expected' : `${Math.round(rainChance)}% rain chance`]
    const card: TodaySprayCard = { level: verdict.level, headline, details, fieldName: field.name }
    if (!best || levelOrder[card.level] < levelOrder[best.level]) best = card
  }
  return best
}
