import { Window } from 'happy-dom'
import React, { createElement } from 'react'
import { act } from 'react'
import { MemoryRouter } from 'react-router'
import { createRoot } from 'react-dom/client'
import { FieldLogPage } from './FieldLogModule'
import { ConfirmDialogHost } from './components/ConfirmDialog'
import type { FieldLogEntry, FieldLogRepository } from './data/fieldLog'
import type { FieldsData, FieldsRepository } from './data/fields'

// A second tap on Delete while the in-app question is open must not queue a
// second question behind the first answer (the browser's blocking confirm()
// never allowed that). The submit lock is held from the first tap until the
// farmer answers, and released again on Go back so the button still works.

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const win = new Window({ url: 'http://farmrx.test/field-log' })
Object.assign(globalThis, { React, window: win, document: win.document, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, MouseEvent: win.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator })
const flush = async () => { await Promise.resolve(); await new Promise<void>((resolve) => setTimeout(resolve, 0)) }
const openDialogs = () => [...document.querySelectorAll('[role="dialog"]')]
function dialogButton(text: string) { const found = [...document.querySelectorAll('[role="dialog"] button')].find((item) => item.textContent === text) as HTMLButtonElement | undefined; assert(found, `Dialog button ${text} did not render.`); return found }
async function click(element: HTMLElement) { await act(async () => { element.click(); await flush() }) }

const user = '00000000-0000-4000-8000-000000000001'; const farm = '00000000-0000-4000-8000-000000000002'; const field = '00000000-0000-4000-8000-000000000003'; const entryId = '00000000-0000-4000-8000-000000000004'; const stamp = '2027-08-04T12:00:00.000Z'
const entry: FieldLogEntry = { id: entryId, farm_id: farm, field_id: field, entry_type: 'note', observed_on: '2027-08-04', rainfall_in: null, note: 'Synthetic note', created_by: user, created_at: stamp, updated_at: stamp }
const fieldsData = { farm: { id: farm }, entities: [], fields: [{ id: field, farm_id: farm, name: 'Pine North 60', total_acres: 60, is_active: true, latitude: null, longitude: null }], crop_assignments: [], arrangements: [], commodities: [] } as unknown as FieldsData
let deleteCalls = 0; let entries = [entry]
const deletes = () => deleteCalls
const fieldsRepository = { getData: async () => fieldsData, saveField: async () => { throw new Error('unexpected field mutation') } } satisfies FieldsRepository
const fieldLogRepository = { getData: async () => ({ entries, viewer: { user_id: user, role: 'owner' as const } }), saveEntry: async () => { throw new Error('unexpected Field Log save') }, deleteEntry: async (id: string) => { deleteCalls += 1; entries = entries.filter((item) => item.id !== id); return { id, deleted: true as const } } } satisfies FieldLogRepository
const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
const deleteButton = () => { const found = [...container.querySelectorAll('button')].find((item) => item.textContent === 'Delete') as HTMLButtonElement | undefined; assert(found, 'The entry Delete button did not render.'); return found }
try {
  await act(async () => { root.render(createElement(MemoryRouter, null, createElement(FieldLogPage, { fieldLogRepository, fieldsRepository }), createElement(ConfirmDialogHost))); await flush() })
  // Two taps before the farmer answers: one question, zero writes.
  await act(async () => { const button = deleteButton(); button.click(); button.click(); await flush() })
  assert(openDialogs().length === 1 && openDialogs()[0]?.textContent?.includes('Delete this field log entry?'), 'A double tap must show exactly one delete question.')
  assert(deletes() === 0, 'No delete may run before the farmer answers.')
  await click(dialogButton('Go back'))
  await act(async () => { await flush() })
  assert(openDialogs().length === 0 && deletes() === 0, 'Go back must close the only question and delete nothing; a second queued question must not appear.')
  // The lock is released on Go back, so the next tap asks again and one confirm deletes once.
  await click(deleteButton())
  assert(openDialogs().length === 1, 'After Go back the Delete button must ask again.')
  await click(dialogButton('Delete entry'))
  await act(async () => { await flush() })
  assert(deletes() === 1 && openDialogs().length === 0, 'Confirming must delete exactly once and close the question.')
} finally { await act(async () => { root.unmount() }); container.remove(); win.close() }
console.log('Field Log delete double-tap regression passed')
