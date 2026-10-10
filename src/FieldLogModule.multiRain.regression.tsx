import { Window } from 'happy-dom'
import React, { createElement } from 'react'
import { act } from 'react'
import { MemoryRouter } from 'react-router'
import { createRoot } from 'react-dom/client'
import { FieldLogPage } from './FieldLogModule'
import { ConfirmDialogHost } from './components/ConfirmDialog'
import type { FieldLogEntry, FieldLogEntryDraft, FieldLogRepository } from './data/fieldLog'
import type { FieldsData, FieldsRepository } from './data/fields'

// Rain for several fields at once: an entry the server confirmed must show in that field's timeline straight away,
// even when the reload that follows the save loses signal (CodeRabbit, PR #67). The queued repository then answers
// from the copy it cached before the save, which does not have the new rain, or throws when there is no copy. Before,
// the form said "Saved for ..." while the rain it had just saved was missing from every card.

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const win = new Window({ url: 'http://farmrx.test/field-log' })
Object.assign(globalThis, { React, window: win, document: win.document, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, MouseEvent: win.MouseEvent, FormData: win.FormData, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator })
const flush = async () => { await Promise.resolve(); await new Promise<void>((resolve) => setTimeout(resolve, 0)) }
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const user = uid(1); const farm = uid(2); const north = uid(3); const south = uid(4); const stamp = '2027-08-04T12:00:00.000Z'
const field = (id: string, name: string) => ({ id, farm_id: farm, name, total_acres: 80, is_active: true, latitude: null, longitude: null })
const fieldsData = { farm: { id: farm }, entities: [], fields: [field(north, 'Pine North 80'), field(south, 'Pine South 80')], crop_assignments: [], arrangements: [], commodities: [] } as unknown as FieldsData
let reads = 0; let nextId = 10; let afterSave: 'stale copy' | 'no copy' = 'stale copy'; const saves: FieldLogEntryDraft[] = []; const deletes: string[] = []
const fieldsRepository = { getData: async () => fieldsData, saveField: async () => { throw new Error('unexpected field mutation') } } satisfies FieldsRepository
const fieldLogRepository = {
  // The page's first read works. Every read after the save loses signal: it gets the pre-save copy, or an error with no copy.
  getData: async () => { reads += 1; if (reads > 1 && afterSave === 'no copy') throw new Error('network down'); return { entries: [] as FieldLogEntry[], viewer: { user_id: user, role: 'owner' as const } } },
  saveEntry: async (draft: FieldLogEntryDraft) => { saves.push(draft); return { ...draft, id: uid(nextId++), farm_id: farm, created_by: user, created_at: stamp, updated_at: stamp } as FieldLogEntry },
  deleteEntry: async (id: string) => { deletes.push(id); return { id, deleted: true as const } },
} as unknown as FieldLogRepository
const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
const button = (text: string) => { const found = [...container.querySelectorAll('button')].find((item) => item.textContent === text) as HTMLButtonElement | undefined; assert(found, `Button ${text} did not render.`); return found }
const card = (name: string) => { const found = [...container.querySelectorAll('.field-log-card')].find((item) => item.querySelector('h2')?.textContent === name) as HTMLElement | undefined; assert(found, `The ${name} card did not render.`); return found }
async function click(element: HTMLElement) { await act(async () => { element.click(); await flush() }) }
const dialogButton = (text: string) => { const found = [...document.querySelectorAll('[role="dialog"] button')].find((item) => item.textContent === text) as HTMLButtonElement | undefined; assert(found, `Dialog button ${text} did not render.`); return found }
async function saveRainForBoth() {
  await click(button('Add rain to several fields'))
  await click(button('Pick all fields'))
  const form = container.querySelector('form.multi-rain-form') as HTMLFormElement
  assert(form, 'The several-fields rain form did not open.')
  ;(form.querySelector('input[name="rainfall"]') as HTMLInputElement).value = '0.75'
  ;(form.querySelector('textarea[name="note"]') as HTMLTextAreaElement).value = 'Synthetic storm'
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush(); await flush() })
}
const timeline = (name: string) => card(name).querySelector('.field-log-timeline')?.textContent ?? ''
try {
  for (const mode of ['stale copy', 'no copy'] as const) {
    afterSave = mode; reads = 0; saves.length = 0
    await act(async () => { root.render(createElement(MemoryRouter, { key: mode }, createElement(FieldLogPage, { fieldLogRepository, fieldsRepository }), createElement(ConfirmDialogHost))); await flush() })
    await saveRainForBoth()
    assert(saves.length === 2, `${mode}: both chosen fields must be saved once each, got ${saves.length}.`)
    assert(reads === 2, `${mode}: the page must try one reload after saving, got ${reads} reads.`)
    assert(container.textContent?.includes('Saved for Pine North 80, Pine South 80.'), `${mode}: the form must say both fields saved. ${container.textContent}`)
    for (const name of ['Pine North 80', 'Pine South 80']) assert(timeline(name).includes('0.75 in · Synthetic storm') && card(name).querySelector('.rain-total')?.textContent?.includes('0.75 in'), `${mode}, ${name}: rain the server confirmed must show in the timeline and season total. Timeline: ${timeline(name)}`)
  }
  // Deleting a saved entry that is only on screen from this form removes it; it does not come back from the local list.
  const north = card('Pine North 80'); const del = [...north.querySelectorAll('button')].find((item) => item.textContent === 'Delete') as HTMLButtonElement | undefined
  assert(del, 'A saved entry must offer Delete.')
  await click(del); await click(dialogButton('Delete entry')); await act(async () => { await flush() })
  assert(deletes.length === 1 && !timeline('Pine North 80').includes('0.75 in') && timeline('Pine South 80').includes('0.75 in'), `Deleting must remove only that field's entry. North: ${timeline('Pine North 80')}`)
} finally { await act(async () => { root.unmount() }); container.remove(); win.close() }
console.log('Field Log several-fields rain regression passed')
