import { Window } from 'happy-dom'
import React, { createElement } from 'react'
import { act } from 'react'
import { MemoryRouter } from 'react-router'
import { createRoot } from 'react-dom/client'
import { FarmAccessProvider } from './auth/FarmAccessContext'
import { deriveFarmAccessProfile, type LoadedFarmAccessProfile } from './auth/farmContext'
import type { EquipmentTasksRepository, EquipmentTasksWorkspace } from './data/equipmentTasks'
import type { Field, FieldsData, FieldsRepository } from './data/fields'
import type { InventoryRepository } from './data/inventory'
import type { ProgramsRepository } from './data/programs'
import type { GrainRepository } from './data/grain'
import type { NotificationsRepository } from './data/notifications'
import { weatherCacheKey } from './data/weatherService'
import { loadTodaySnapshots, TodayPage } from './TodayModule'

// FD-1 (FD-010): the spray card's two-hour freshness ceiling is judged against the clock while Today stays open, not only at load.

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const userA = '00000000-0000-4000-8000-000000000001'
const farmA = '00000000-0000-4000-8000-000000000010'
const loadedAt = Date.parse('2026-07-15T12:00:00.000Z')
let clock = loadedAt
const realNow = Date.now
Date.now = () => clock
const win = new Window({ url: 'http://farmrx.test/today' })
Object.assign(globalThis, { React, window: win, document: win.document, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, MouseEvent: win.MouseEvent, localStorage: win.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator })
const intervals: Array<() => void> = []
const realSetInterval = globalThis.setInterval
// Only Today's one-minute clock is captured; every other interval (React, happy-dom) keeps running for real.
globalThis.setInterval = ((handler: () => void, delay?: number, ...rest: unknown[]) => { if (delay === 60_000) { intervals.push(handler); return -1 as unknown as ReturnType<typeof setInterval> } return (realSetInterval as unknown as (h: () => void, d?: number, ...a: unknown[]) => ReturnType<typeof setInterval>)(handler, delay, ...rest) }) as typeof setInterval
const flush = async () => { await Promise.resolve(); await new Promise<void>((resolve) => setTimeout(() => resolve(), 0)); await Promise.resolve() }

const stamp = '2026-07-15T11:30:00.000Z'
const farm = { id: farmA, name: 'Clock Farm', share_with_rep: false, created_by: userA, created_at: stamp, updated_at: stamp }
const field: Field = { id: '00000000-0000-4000-8000-000000000101', farm_id: farmA, operating_entity_id: '00000000-0000-4000-8000-000000000020', name: 'North Forty', legal_description: null, county: null, state: null, total_acres: 80, fsa_farm_number: null, fsa_tract_number: null, soil_productivity_index: null, latitude: 41.5, longitude: -93.6, location_source: 'gps', is_active: true, created_at: stamp, updated_at: stamp } as Field
const fieldsData: FieldsData = { farm, entities: [], fields: [field], crop_assignments: [], arrangements: [], commodities: [] }
const workspace: EquipmentTasksWorkspace = { fields: fieldsData, viewer: { user_id: userA, role: 'owner' }, equipment: [], meter_readings: [], intervals: [], service_log: [], service_due: [], members: [], tasks: [] }
const hour = (time: string) => ({ time, temperature_f: 72, relative_humidity: 60, precipitation_in: 0, precipitation_probability: 5, wind_speed_mph: 6, wind_direction_degrees: 225, wind_gusts_mph: 9, cloud_cover: 30 })
const hours = ['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00'].map((clockText) => hour(`2026-07-15T${clockText}`))
const fetchedAt = new Date(loadedAt - 30 * 60_000).toISOString()
win.localStorage.setItem(weatherCacheKey(41.5, -93.6), JSON.stringify({ version: 1, fetched_at: fetchedAt, bundle: { current: hour('2026-07-15T07:00'), hourly: hours, daily: [{ date: '2026-07-15', precipitation_sum_in: 0, precipitation_probability_max: 10, temperature_max_f: 84, temperature_min_f: 61, sunrise: '2026-07-15T05:58', sunset: '2026-07-15T20:47' }], fetched_at: fetchedAt, utc_offset_seconds: -18000, timezone: 'America/Chicago' } }))

const memberEvidence = { membership: { farm_id: farmA, user_id: userA, role: 'owner', status: 'active', can_view_financials: true }, repAccess: null, shareWithRep: false, helpers: { canAccessFarm: true, isActiveFarmMember: true, canEditFarm: true, canManageFarm: true, hasExplicitRepAccess: false, canReadPrivateFinancials: true } }
const profile: LoadedFarmAccessProfile = { ...deriveFarmAccessProfile(userA, farmA, 1, new Date(loadedAt).toISOString(), memberEvidence), operationContext: { projectRef: 'test', userId: userA, farmId: farmA, generation: 1, token: '00000000-0000-4000-8000-000000000900', serverEpoch: 1 } }
const snapshot = <T,>(data: T) => async () => ({ data, source: 'live' as const, capturedAt: new Date(clock).toISOString() })
const fieldsRepository = { getData: async () => fieldsData, getSnapshot: snapshot(fieldsData) } as unknown as FieldsRepository
let equipmentReads = 0
const equipmentTasksRepository = { getWorkspace: async () => workspace, getSnapshot: async () => { equipmentReads += 1; return snapshot(workspace)() } } as unknown as EquipmentTasksRepository
const notificationsRepository = { getData: async () => ({ notifications: [], unreadCount: 0 }), getSnapshot: snapshot({ notifications: [], unreadCount: 0 }) } as unknown as NotificationsRepository
const inventory = { fields: fieldsData, products: [], receipts: [], receipt_lines: [], adjustments: [], applications: [], application_products: [], program_application_products: [], rup_completeness: [], on_hand: [] }
const inventoryRepository = { getWorkspace: async () => inventory, getSnapshot: snapshot(inventory) } as unknown as InventoryRepository
const programsRepository = { getPendingPassOutcomes: async () => new Map() } as unknown as ProgramsRepository
const grainRepository = { getData: async () => null, getSnapshot: snapshot(null) } as unknown as GrainRepository

const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
try {
  const access = { farms: [farm], activeFarm: farm, profile, source: 'live' as const, chooseFarm: async () => {}, checkSignal: async () => {} }
  await act(async () => { root.render(createElement(MemoryRouter, { initialEntries: ['/today'] }, createElement(FarmAccessProvider, { value: access, children: createElement(TodayPage, { fieldsRepository, equipmentTasksRepository, notificationsRepository, inventoryRepository, programsRepository, grainRepository }) }))); await flush(); await flush() })
  const cardText = () => container.querySelector('.today-spray-card')?.textContent ?? ''
  assert(cardText().includes('Good spray window until'), `A fresh cached forecast did not render a spray verdict (saw: ${cardText()}).`)
  assert(intervals.length === 1, `Today did not start exactly one clock (saw ${intervals.length}).`)
  const tickAll = () => { for (const handler of intervals) handler() }
  // Ninety minutes later the forecast is still inside the two-hour ceiling.
  clock = loadedAt + 90 * 60_000
  await act(async () => { tickAll(); await flush() })
  assert(cardText().includes('Good spray window until'), 'A forecast still inside the ceiling was dropped.')
  // Past the ceiling, with the page never reloaded, the verdict must go and the Weather link take its place.
  clock = loadedAt + 3 * 60 * 60_000
  await act(async () => { tickAll(); await flush() })
  assert(!cardText().includes('Good spray'), `A stale forecast kept showing a spray verdict after the ceiling (saw: ${cardText()}).`)
  assert(cardText().includes('Check the spray window'), `The stale card did not fall back to the Weather link (saw: ${cardText()}).`)
  // FD-015: the snapshots are re-read when the farm's day turns over while Today stays open, and when the app comes back into view.
  const readsBeforeMidnight = equipmentReads
  clock = loadedAt + 13 * 60 * 60_000
  await act(async () => { tickAll(); await flush(); await flush() })
  assert(equipmentReads === readsBeforeMidnight + 1, `Crossing the farm's midnight must re-read the snapshots once (reads ${readsBeforeMidnight} -> ${equipmentReads}).`)
  await act(async () => { document.dispatchEvent(new Event('visibilitychange')); await flush(); await flush() })
  assert(equipmentReads === readsBeforeMidnight + 2, `Coming back into view must re-read the snapshots (reads ${equipmentReads}).`)
  // FD-013: when Equipment fails for its own reasons, Fields is read on its own so the spray card does not vanish with it.
  const failingEquipment = { getWorkspace: async () => { throw new Error('boom') }, getSnapshot: async () => { throw new Error('Equipment and Tasks found invalid data.') } } as unknown as EquipmentTasksRepository
  const sections = await loadTodaySnapshots(profile, { fieldsRepository, equipmentTasksRepository: failingEquipment, notificationsRepository, inventoryRepository, programsRepository, grainRepository })
  assert(sections.equipment.status === 'failed', 'The failing Equipment snapshot must report as failed.')
  assert(sections.fields.status === 'ready' && sections.fields.data.length === 1 && sections.fields.data[0].name === 'North Forty', 'Fields must still load on its own when Equipment fails.')
  console.log('Today spray clock regression passed')
} finally {
  await act(async () => { root.unmount() }); container.remove(); win.close(); Date.now = realNow; globalThis.setInterval = realSetInterval
}
