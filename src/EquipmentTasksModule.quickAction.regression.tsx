import { Window } from 'happy-dom'
import React, { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { TasksPage } from './EquipmentTasksModule'
import type { EquipmentTasksRepository, EquipmentTasksWorkspace, FarmTask } from './data/equipmentTasks'
import { setSaveReceipt } from './lib/saveReceipt'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const owner = '00000000-0000-4000-8000-000000000001'
const taskId = '00000000-0000-4000-8000-000000000002'
const stamp = '2027-08-12T15:00:00.000000+00:00'
const win = new Window({ url: 'http://farmrx.test/tasks' })
Object.assign(globalThis, { React, window: win, document: win.document, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, MouseEvent: win.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator })

function task(overrides: Partial<FarmTask> = {}): FarmTask { return { id: taskId, farm_id: '00000000-0000-4000-8000-000000000010', title: 'Inspect Maple south gate', details: 'Check synthetic waterhemp patch.', status: 'todo', priority: 'normal', assigned_to: owner, due_on: '2027-08-13', field_id: null, equipment_id: null, source: 'manual', interval_id: null, interval_cycle_key: null, program_assigned_pass_id: null, program_cycle_key: null, completed_by: null, completed_at: null, created_by: owner, created_at: stamp, updated_at: stamp, ...overrides } }
function workspace(current: FarmTask): EquipmentTasksWorkspace { return { fields: { farm: { id: current.farm_id } as never, entities: [], fields: [], arrangements: [], crop_assignments: [], commodities: [] }, viewer: { user_id: owner, role: 'owner' }, equipment: [], meter_readings: [], intervals: [], service_log: [], service_due: [], members: [{ farm_id: current.farm_id, user_id: owner, display_name: 'Maple Owner' }], tasks: [current] } }
const flush = async () => { await Promise.resolve(); await new Promise<void>((resolve) => setTimeout(resolve, 0)) }

let current = task(); let saves = 0; let release: (() => void) | undefined; let began: (() => void) | undefined
const saveGate = new Promise<void>((resolve) => { release = resolve }); const saveBegan = new Promise<void>((resolve) => { began = resolve })
const repository: EquipmentTasksRepository = {
  getWorkspace: async () => workspace(current),
  saveTask: async (value) => { saves += 1; setSaveReceipt(value.id, 'saving'); began?.(); await saveGate; current = { ...current, ...value, completed_by: owner, completed_at: stamp, updated_at: stamp }; setSaveReceipt(value.id, 'saved'); },
  saveEquipment: async () => undefined, addMeterReading: async () => undefined, saveInterval: async () => undefined, addServiceLogEntry: async () => undefined, deleteTask: async () => undefined, deleteServiceLogEntry: async () => undefined, deleteInterval: async () => undefined,
}
const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
let initialUnmounted = false
let programContainer: HTMLDivElement | null = null; let programRoot: ReturnType<typeof createRoot> | null = null
try {
  await act(async () => { root.render(createElement(MemoryRouter, null, createElement(TasksPage, { repository }))); await flush() })
  const done = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Done')
  assert(done, 'The manual To Do card did not render its Done quick action.')
  await act(async () => { done.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
  await saveBegan
  assert(container.textContent?.includes('Saving…') && saves === 1, 'Quick completion did not publish Saving before the durable response.')
  await act(async () => { done.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
  assert(saves === 1, 'A rapid second Done click started a second task transition.')
  release?.()
  await act(async () => { await flush(); await flush() })
  assert(container.textContent?.includes('Saved') && container.textContent?.includes('Done by Maple Owner') && !container.textContent?.includes('To Do\nInspect Maple south gate'), 'Quick completion did not keep Saved visible while moving the exact card to Done.')

  await act(async () => { root.unmount() }); initialUnmounted = true; container.remove()
  current = task({ source: 'program', program_assigned_pass_id: '00000000-0000-4000-8000-000000000003', program_cycle_key: 'due:program:2027-08-12' })
  programContainer = document.createElement('div'); document.body.append(programContainer); programRoot = createRoot(programContainer)
  await act(async () => { programRoot!.render(createElement(MemoryRouter, null, createElement(TasksPage, { repository }))); await flush() })
  const programButtons = [...programContainer.querySelectorAll('button')].map((button) => button.textContent ?? '')
  assert(programContainer.textContent?.includes('Managed by its Program') && programButtons.includes('Open Program') && programButtons.some((label) => label.includes('Corn') || label.includes('Inspect Maple south gate')), 'A Program-owned card did not render its visible managed marker and Open Program route.')
  for (const forbidden of ['Start', 'Done', 'Reopen', 'Edit', 'Delete']) assert(!programButtons.includes(forbidden), `A Program-owned task exposed the generic ${forbidden} quick action.`)
  assert(saves === 1, 'A Program-owned task invoked the generic quick-action writer.')
} finally {
  await act(async () => { if (!initialUnmounted) root.unmount(); programRoot?.unmount() }); container.remove(); programContainer?.remove(); win.close()
}
console.log('EquipmentTasks quick-action receipt regression passed')
