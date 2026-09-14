import { useEffect, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router'
import { canAccessFarmModule, type LoadedFarmAccessProfile } from './auth/farmContext'
import { useFarmAccess } from './auth/FarmAccessContext'
import type { EquipmentTasksRepository, EquipmentTasksWorkspace } from './data/equipmentTasks'
import { farmCalendarDate } from './data/farmDates'
import type { Field, FieldsRepository } from './data/fields'
import type { InventoryRepository, InventoryWorkspace } from './data/inventory'
import type { Notification, NotificationsRepository } from './data/notifications'
import { todayNextUp, todayRecordTiles, todaySprayWindow, type TodayNextUpItem, type TodayRecordKind, type TodaySprayCard } from './data/today'
import { readCachedForecast } from './data/weatherService'
import { farmerError } from './lib/farmerErrors'

// Today (GOAL.md, Initiative FD-1) is the front door: a read-only projection of records the modules already own. It reads through
// the pure snapshot path only, with the access context the shell already validated, so opening it never replays queued work,
// generates due items, refreshes a forecast, or writes a cache. Every tile and row hands off to the module that owns the record.

type Section<T> = { status: 'loading' } | { status: 'ready'; data: T } | { status: 'failed'; message: string }
type TodaySnapshots = { fields: Section<Field[]>; equipment: Section<EquipmentTasksWorkspace | null>; notifications: Section<Notification[] | null>; inventory: Section<InventoryWorkspace | null> }
const loading = { status: 'loading' } as const
const ready = <T,>(data: T): Section<T> => ({ status: 'ready', data })
const failed = <T,>(error: unknown, action: string): Section<T> => ({ status: 'failed', message: farmerError(error, action) })
const dataOf = <T,>(section: Section<T>): T | null => section.status === 'ready' ? section.data : null

async function standaloneFields(fieldsRepository: FieldsRepository, context: LoadedFarmAccessProfile['operationContext']): Promise<Section<Field[]>> {
  if (!fieldsRepository.getSnapshot) return failed(new Error('Fields does not expose a side-effect-free snapshot.'), 'load your fields')
  try { return ready((await fieldsRepository.getSnapshot(context)).data.fields) } catch (error) { return failed(error, 'load your fields') }
}

function localStorageOrNull(): Pick<Storage, 'getItem'> | null { try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null } }

export async function loadTodaySnapshots(profile: LoadedFarmAccessProfile, repositories: { fieldsRepository: FieldsRepository; equipmentTasksRepository: EquipmentTasksRepository; notificationsRepository: NotificationsRepository; inventoryRepository: InventoryRepository }): Promise<TodaySnapshots> {
  const context = profile.operationContext
  const wantsEquipment = canAccessFarmModule(profile, 'equipment') || canAccessFarmModule(profile, 'tasks')
  const wantsNotifications = canAccessFarmModule(profile, 'notifications')
  const wantsInventory = canAccessFarmModule(profile, 'inventory')
  // The equipment workspace already carries a current Fields snapshot, so members who can open Equipment load fields once.
  const [equipment, fields, notifications, inventory] = await Promise.allSettled([
    wantsEquipment ? (repositories.equipmentTasksRepository.getSnapshot ? repositories.equipmentTasksRepository.getSnapshot(context).then((snapshot) => snapshot.data) : Promise.reject(new Error('Equipment and Tasks does not expose a side-effect-free snapshot.'))) : Promise.resolve(null),
    wantsEquipment ? Promise.resolve(null) : repositories.fieldsRepository.getSnapshot ? repositories.fieldsRepository.getSnapshot(context).then((snapshot) => snapshot.data.fields) : Promise.reject(new Error('Fields does not expose a side-effect-free snapshot.')),
    wantsNotifications ? (repositories.notificationsRepository.getSnapshot ? repositories.notificationsRepository.getSnapshot(context).then((snapshot) => snapshot.data.notifications) : Promise.reject(new Error('Alerts does not expose a side-effect-free snapshot.'))) : Promise.resolve(null),
    wantsInventory ? (repositories.inventoryRepository.getSnapshot ? repositories.inventoryRepository.getSnapshot(context).then((snapshot) => snapshot.data) : Promise.reject(new Error('Inventory does not expose a side-effect-free snapshot.'))) : Promise.resolve(null),
  ])
  const equipmentSection: Section<EquipmentTasksWorkspace | null> = equipment.status === 'fulfilled' ? ready(equipment.value) : failed(equipment.reason, 'check equipment and tasks')
  // Fields rides along with the Equipment workspace when that loads; when Equipment fails for its own reasons, Fields is read on
  // its own so the spray card does not disappear with it.
  const fieldsSection: Section<Field[]> = wantsEquipment
    ? equipment.status === 'fulfilled' ? ready(equipment.value?.fields.fields ?? []) : await standaloneFields(repositories.fieldsRepository, context)
    : fields.status === 'fulfilled' ? ready(fields.value ?? []) : failed(fields.reason, 'load your fields')
  const notificationsSection: Section<Notification[] | null> = notifications.status === 'fulfilled' ? ready(notifications.value) : failed(notifications.reason, 'check your alerts')
  const inventorySection: Section<InventoryWorkspace | null> = inventory.status === 'fulfilled' ? ready(inventory.value) : failed(inventory.reason, 'check your inventory')
  return { fields: fieldsSection, equipment: equipmentSection, notifications: notificationsSection, inventory: inventorySection }
}

export function TodayPage({ fieldsRepository, equipmentTasksRepository, notificationsRepository, inventoryRepository }: { fieldsRepository: FieldsRepository; equipmentTasksRepository: EquipmentTasksRepository; notificationsRepository: NotificationsRepository; inventoryRepository: InventoryRepository }) {
  const { profile, activeFarm } = useFarmAccess()
  const navigate = useNavigate()
  const [snapshots, setSnapshots] = useState<TodaySnapshots>({ fields: loading, equipment: loading, notifications: loading, inventory: loading })
  const [nowMs, setNowMs] = useState(() => Date.now())
  // The spray card's freshness gate is judged against the clock, not the load time: a phone left open on Today past the two-hour
  // ceiling must drop a stale verdict on its own, so the clock ticks every minute and whenever the app comes back into view.
  useEffect(() => {
    const tick = () => setNowMs(Date.now())
    const timer = setInterval(tick, 60_000)
    document.addEventListener('visibilitychange', tick)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', tick) }
  }, [])
  useEffect(() => {
    let cancelled = false
    setSnapshots({ fields: loading, equipment: loading, notifications: loading, inventory: loading })
    void loadTodaySnapshots(profile, { fieldsRepository, equipmentTasksRepository, notificationsRepository, inventoryRepository }).then((next) => { if (!cancelled) { setSnapshots(next); setNowMs(Date.now()) } })
    return () => { cancelled = true }
  }, [profile, fieldsRepository, equipmentTasksRepository, notificationsRepository, inventoryRepository])

  const tiles = todayRecordTiles(profile)
  const canEdit = profile.capabilities.canEditOperational
  const showWeather = canAccessFarmModule(profile, 'weather')
  const storage = localStorageOrNull()
  const fields = dataOf(snapshots.fields)
  const sprayCard = showWeather && fields && storage ? todaySprayWindow(fields, (latitude, longitude) => readCachedForecast(storage, latitude, longitude), nowMs) : null
  // "Today" is the farm's calendar day in its stored time zone (the database's own due-generation authority), re-read on every tick.
  const nextUp = todayNextUp({ profile, today: farmCalendarDate(new Date(nowMs), activeFarm.time_zone), equipment: dataOf(snapshots.equipment), notifications: dataOf(snapshots.notifications), inventory: dataOf(snapshots.inventory) })
  const stillLoading = snapshots.equipment.status === 'loading' || snapshots.notifications.status === 'loading' || snapshots.fields.status === 'loading' || snapshots.inventory.status === 'loading'
  const sectionErrors = [snapshots.fields, snapshots.equipment, snapshots.notifications, snapshots.inventory].flatMap((section) => section.status === 'failed' ? [section.message] : [])

  return <section className="page today-page" aria-labelledby="today-title">
    <header className="page-heading today-heading"><div><p className="eyebrow">{activeFarm.name}</p><h1 id="today-title">{canEdit ? 'What are you recording?' : 'Your farm today'}</h1><p>{canEdit ? 'Tap an option to get started.' : 'You can view records here. Adding records is turned off for your access.'}</p></div></header>
    {canEdit && tiles.length > 0 && <ul className="today-record-grid" aria-label="Record">{tiles.map((tile) => <li key={tile.kind}><button type="button" className="today-record-tile" data-record={tile.kind} onClick={() => navigate(tile.to, { state: tile.state })}><span className="today-record-icon" aria-hidden="true">{tileGlyph(tile.kind)}</span><span className="today-record-label">{tile.label}</span></button></li>)}</ul>}
    {showWeather && <SprayCard card={sprayCard} fieldsLoaded={fields !== null} />}
    <section className="today-next-up" aria-labelledby="today-next-up-title">
      <h2 id="today-next-up-title">Next up</h2>
      {[...new Set(sectionErrors)].map((message) => <p className="form-error" key={message}>{message}</p>)}
      {stillLoading && nextUp.length === 0 ? <p className="loading-state today-loading">Checking today…</p> : nextUp.length ? <ul className="today-next-up-list">{nextUp.map((item) => <NextUpRow key={item.id} item={item} />)}</ul> : !sectionErrors.length && <p className="today-all-clear">Nothing is overdue or due today.</p>}
    </section>
  </section>
}

function SprayCard({ card, fieldsLoaded }: { card: TodaySprayCard | null; fieldsLoaded: boolean }) {
  if (!card) return <Link className="today-spray-card is-unknown" to="/weather"><span className="today-spray-icon" aria-hidden="true">{glyph('M6 16a4 4 0 0 1 .5-8 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 17.5 16z')}</span><span className="today-spray-body"><strong>{fieldsLoaded ? 'Check the spray window' : 'Weather & Spray'}</strong><span>{fieldsLoaded ? 'Open Weather for a current forecast on your fields.' : 'Open Weather to see field conditions.'}</span></span><span className="today-chevron" aria-hidden="true">›</span></Link>
  return <Link className={`today-spray-card is-${card.level}`} to="/weather"><span className="today-spray-icon" aria-hidden="true">{glyph('M6 16a4 4 0 0 1 .5-8 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 17.5 16z')}</span><span className="today-spray-body"><strong>{card.headline}</strong><span>{card.details.join(' · ')} · {card.fieldName}</span></span><span className="today-chevron" aria-hidden="true">›</span></Link>
}

function NextUpRow({ item }: { item: TodayNextUpItem }) {
  return <li><Link className={`today-next-up-row is-${item.urgency}${item.badge ? ' has-badge' : ''}`} to={item.to}><span className="today-next-up-icon" aria-hidden="true">{nextUpGlyph(item)}</span><span className="today-next-up-body"><strong>{item.title}</strong><span>{item.detail}</span></span>{item.badge && <span className="today-badge">{item.badge}</span>}<span className="today-chevron" aria-hidden="true">›</span></Link></li>
}

function glyph(d: string): ReactNode { return <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg> }
const tileGlyphs: Record<TodayRecordKind, string> = {
  rain: 'M7 16a4 4 0 0 1 .5-8 6 6 0 0 1 11.5 1.5A3.5 3.5 0 0 1 18.5 16zM8 19l-1 2M12 19l-1 2M16 19l-1 2',
  scouting: 'M4 20c4-9 12-9 16 0M9 11a3 3 0 1 0 6 0 3 3 0 1 0-6 0M12 3v5',
  spray: 'M9 3h6v4H9zM7 7h10l1 14H6zM12 11v6',
  task: 'M5 5h14v14H5zM8 12l3 3 5-6',
  harvest: 'M3 20h18M5 20V10l7-6 7 6v10M9 20v-6h6v6',
  grain_delivery: 'M3 16V7h11v9M14 10h4l3 4v2M6 19a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M16 19a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0',
}
function tileGlyph(kind: TodayRecordKind): ReactNode { return glyph(tileGlyphs[kind]) }
function nextUpGlyph(item: TodayNextUpItem): ReactNode {
  if (item.kind === 'service') return glyph('M14 7a4 4 0 0 0 5 5l-8 8-2-2 8-8a4 4 0 0 0-5-5zM5 19l2 2')
  if (item.kind === 'task') return glyph('M5 5h14v14H5zM8 12l3 3 5-6')
  if (item.kind === 'program') return glyph('M4 4h16v16H4zM4 10h16M9 4v6')
  if (item.kind === 'low_inventory') return glyph('M9 3h6v4H9zM7 7h10l1 14H6zM8 15h8')
  return glyph('M3 20h18M6 20V8l6-4 6 4v12')
}
