import { Window } from 'happy-dom'
import React, { createElement } from 'react'
import { act } from 'react'
import { MemoryRouter } from 'react-router'
import { createRoot } from 'react-dom/client'
import { FieldLogPage } from './FieldLogModule'
import { ConfirmDialogHost } from './components/ConfirmDialog'
import type { FieldLogEntry, FieldLogEntryDraft, FieldLogRepository } from './data/fieldLog'
import type { FieldsData, FieldsRepository } from './data/fields'

// An entry the server confirmed must show in that field's timeline straight away, even when the reload that follows the
// save loses signal (CodeRabbit, PR #67). The queued repository then answers from the copy saved on this device before the
// save, which does not have the new entry, or throws when there is no copy. Before, the several-fields form said "Saved
// for ..." while the rain it had just saved was missing from every card. An edit of such an entry must show the new
// amount, not the old one (Codex, PR #69). A good reload settles the local copies: the server's copy replaces them, and
// one deleted on another phone does not linger with an Edit button that would save it back.

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const win = new Window({ url: 'http://farmrx.test/field-log' })
Object.assign(globalThis, { React, window: win, document: win.document, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, MouseEvent: win.MouseEvent, FormData: win.FormData, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator })
const flush = async () => { await Promise.resolve(); await new Promise<void>((resolve) => setTimeout(resolve, 0)) }
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const user = uid(1); const farm = uid(2); const north = uid(3); const south = uid(4); const stamp = '2027-08-04T12:00:00.000Z'
const field = (id: string, name: string) => ({ id, farm_id: farm, name, total_acres: 80, is_active: true, latitude: null, longitude: null })
const fieldsData = { farm: { id: farm }, entities: [], fields: [field(north, 'Pine North 80'), field(south, 'Pine South 80')], crop_assignments: [], arrangements: [], commodities: [] } as unknown as FieldsData

// A small server plus the copy the last good read left on this device. Like the queued repository, 'stale copy' answers
// from that copy with the device's waiting writes laid over it and marks the answer offline; 'no copy' throws. A read
// sees the server as it was when the read started, so one can be held open while another save goes through.
let signal: 'online' | 'stale copy' | 'no copy' = 'online'; let saveOutcome: 'confirmed' | 'kept on device' = 'confirmed'
let server: FieldLogEntry[] = []; let cached: FieldLogEntry[] = []; let waiting: FieldLogEntry[] = []
let holdNextRead = false; let releaseRead: (() => void) | null = null
let reads = 0; let nextId = 10; const saves: FieldLogEntryDraft[] = []; const deletes: string[] = []
const upsert = (rows: FieldLogEntry[], row: FieldLogEntry) => [...rows.filter((item) => item.id !== row.id), row]
const fieldsRepository = { getData: async () => fieldsData, saveField: async () => { throw new Error('unexpected field mutation') } } satisfies FieldsRepository
const fieldLogRepository = {
  getData: async () => {
    reads += 1
    const viewer = { user_id: user, role: 'owner' as const }; const mode = signal; const snapshot = structuredClone(server)
    if (holdNextRead) { holdNextRead = false; await new Promise<void>((resolve) => { releaseRead = resolve }) }
    if (mode === 'online') { cached = structuredClone(snapshot); return { entries: snapshot, viewer } }
    if (mode === 'no copy') throw new Error('network down')
    return { entries: waiting.reduce(upsert, structuredClone(cached)), viewer, offline: true as const }
  },
  saveEntry: async (draft: FieldLogEntryDraft) => {
    saves.push(draft)
    const row = { ...draft, id: draft.id ?? uid(nextId++), farm_id: farm, created_by: user, created_at: stamp, updated_at: stamp } as FieldLogEntry
    if (saveOutcome === 'kept on device') { const kept = { ...row, pending: true }; waiting = upsert(waiting, kept); return kept }
    server = upsert(server, row); return row
  },
  deleteEntry: async (id: string) => { deletes.push(id); server = server.filter((row) => row.id !== id); return { id, deleted: true as const } },
} as unknown as FieldLogRepository

const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
const buttonIn = (scope: ParentNode, text: string) => { const found = [...scope.querySelectorAll('button')].find((item) => item.textContent === text) as HTMLButtonElement | undefined; assert(found, `Button ${text} did not render.`); return found }
const card = (name: string) => { const found = [...container.querySelectorAll('.field-log-card')].find((item) => item.querySelector('h2')?.textContent === name) as HTMLElement | undefined; assert(found, `The ${name} card did not render.`); return found }
const row = (name: string, text: string) => { const found = [...card(name).querySelectorAll('.field-log-row')].find((item) => item.textContent?.includes(text)) as HTMLElement | undefined; assert(found, `${name} has no timeline row with ${text}. Timeline: ${timeline(name)}`); return found }
const timeline = (name: string) => card(name).querySelector('.field-log-timeline')?.textContent ?? ''
const seasonTotal = (name: string) => card(name).querySelector('.rain-total strong')?.textContent ?? ''
async function click(element: HTMLElement) { await act(async () => { element.click(); await flush() }) }
async function submit(form: HTMLFormElement) { await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush(); await flush() }) }
const dialogButton = (text: string) => { const found = [...document.querySelectorAll('[role="dialog"] button')].find((item) => item.textContent === text) as HTMLButtonElement | undefined; assert(found, `Dialog button ${text} did not render.`); return found }
async function saveRainForBoth(inches: string) {
  await click(buttonIn(container, 'Add rain to several fields'))
  await click(buttonIn(container, 'Pick all fields'))
  const form = container.querySelector('form.multi-rain-form') as HTMLFormElement
  assert(form, 'The several-fields rain form did not open.')
  ;(form.querySelector('input[name="rainfall"]') as HTMLInputElement).value = inches
  ;(form.querySelector('textarea[name="note"]') as HTMLTextAreaElement).value = 'Synthetic storm'
  await submit(form)
}
/** Saves through one field's own form (Add rain, Add note or a row's Edit), which reloads the page afterwards. */
async function saveInCard(name: string, open: HTMLElement, values: { rainfall?: string; note?: string }) {
  await click(open)
  const form = card(name).querySelector('form.field-log-form') as HTMLFormElement
  assert(form, `The ${name} entry form did not open.`)
  if (values.rainfall !== undefined) (form.querySelector('input[name="rainfall"]') as HTMLInputElement).value = values.rainfall
  if (values.note !== undefined) (form.querySelector('textarea[name="note"]') as HTMLTextAreaElement).value = values.note
  await submit(form)
}
const addNote = (name: string, note: string) => saveInCard(name, buttonIn(card(name), 'Add note'), { note })

try {
  for (const mode of ['no copy', 'stale copy'] as const) {
    signal = 'online'; saveOutcome = 'confirmed'; server = []; cached = []; waiting = []; reads = 0; saves.length = 0
    await act(async () => { root.render(createElement(MemoryRouter, { key: mode }, createElement(FieldLogPage, { fieldLogRepository, fieldsRepository }), createElement(ConfirmDialogHost))); await flush() })
    signal = mode
    await saveRainForBoth('0.75')
    assert(saves.length === 2, `${mode}: both chosen fields must be saved once each, got ${saves.length}.`)
    assert(reads === 2, `${mode}: the page must try one reload after saving, got ${reads} reads.`)
    assert(container.textContent?.includes('Saved for Pine North 80, Pine South 80.'), `${mode}: the form must say both fields saved. ${container.textContent}`)
    for (const name of ['Pine North 80', 'Pine South 80']) assert(timeline(name).includes('0.75 in · Synthetic storm') && seasonTotal(name) === '0.75 in', `${mode}, ${name}: rain the server confirmed must show in the timeline and season total. Timeline: ${timeline(name)}`)
  }

  // Still on the stale copy. Editing a saved entry shows the new amount; the copy kept here must not snap back to the old one.
  const northStorm = server.find((entry) => entry.field_id === north)!
  await saveInCard('Pine North 80', buttonIn(row('Pine North 80', '0.75 in'), 'Edit'), { rainfall: '0.50' })
  assert(saves.at(-1)?.id === northStorm.id && server.find((entry) => entry.id === northStorm.id)?.rainfall_in === 0.5, 'The edit must save the same entry with the new amount.')
  assert(timeline('Pine North 80').includes('0.50 in · Synthetic storm') && !timeline('Pine North 80').includes('0.75 in') && seasonTotal('Pine North 80') === '0.50 in', `An edited entry must show its new amount after a stale reload. Timeline: ${timeline('Pine North 80')}`)

  // The one-field form has the same need: rain it saved shows even though the reload after it got the stale copy.
  await saveInCard('Pine North 80', buttonIn(card('Pine North 80'), 'Add rain'), { rainfall: '0.25' })
  assert(timeline('Pine North 80').includes('0.25 in') && seasonTotal('Pine North 80') === '0.75 in', `Rain saved from one field's form must show after a stale reload. Timeline: ${timeline('Pine North 80')}`)

  // Rain kept on the device shows as not sent yet, and stays through a good reload that happens before it is sent.
  saveOutcome = 'kept on device'
  await saveRainForBoth('0.10')
  assert(container.textContent?.includes('Kept on this device for Pine North 80, Pine South 80'), `The form must say the rain was kept on this device. ${container.textContent}`)
  assert(timeline('Pine South 80').includes('0.10 in') && timeline('Pine South 80').includes('Not sent yet') && seasonTotal('Pine South 80') === '0.85 in', `Rain kept on the device must show as not sent yet. Timeline: ${timeline('Pine South 80')}`)
  signal = 'online'; saveOutcome = 'confirmed'
  await addNote('Pine South 80', 'Synthetic scouting note')
  assert(timeline('Pine South 80').includes('0.10 in') && timeline('Pine South 80').includes('Not sent yet') && seasonTotal('Pine South 80') === '0.85 in', `A good reload must not drop rain still waiting on the device. Timeline: ${timeline('Pine South 80')}`)
  // It is sent, but the next reload loses signal and its saved copy is from before: the rain must stay on screen.
  server = waiting.map(({ pending: _pending, ...entry }) => entry).reduce(upsert, server); waiting = []; signal = 'stale copy'
  await addNote('Pine South 80', 'Synthetic second note')
  assert(timeline('Pine South 80').includes('0.10 in') && seasonTotal('Pine South 80') === '0.85 in', `Sent rain must stay on screen until a good reload has it. Timeline: ${timeline('Pine South 80')}`)

  // Deleting an entry removes it, even though the saved copy on this device still has it.
  await click(buttonIn(row('Pine North 80', '0.50 in'), 'Delete')); await click(dialogButton('Delete entry')); await act(async () => { await flush() })
  assert(deletes.length === 1 && !timeline('Pine North 80').includes('0.50 in') && timeline('Pine South 80').includes('0.75 in'), `Deleting must remove only that entry. North: ${timeline('Pine North 80')}`)

  // Rain saved while the reloads have no signal, then deleted on another phone before any good reload: once signal is
  // back, the next reload must not bring it back from the local copies.
  await saveRainForBoth('0.05')
  const southShower = server.find((entry) => entry.field_id === south && entry.rainfall_in === 0.05)!
  assert(timeline('Pine South 80').includes('0.05 in'), `Rain saved without signal must show. South: ${timeline('Pine South 80')}`)
  server = server.filter((entry) => entry.id !== southShower.id); signal = 'online'
  await addNote('Pine North 80', 'Synthetic third note')
  assert(!timeline('Pine South 80').includes('0.05 in') && !timeline('Pine South 80').includes('Not sent yet') && seasonTotal('Pine South 80') === '0.85 in', `Rain deleted on another phone must not come back. South: ${timeline('Pine South 80')}`)
  assert(timeline('Pine North 80').includes('0.05 in') && !timeline('Pine North 80').includes('Not sent yet') && seasonTotal('Pine North 80') === '0.40 in', `A good reload must show the server's copies. North: ${timeline('Pine North 80')}`)
  // Rain that waited on the device, was sent and reached a good reload is settled too: deleted on another phone, it stays gone.
  server = server.filter((entry) => !(entry.field_id === south && entry.rainfall_in === 0.1))
  await addNote('Pine South 80', 'Synthetic fourth note')
  assert(!timeline('Pine South 80').includes('0.10 in') && seasonTotal('Pine South 80') === '0.75 in', `Sent rain deleted on another phone must not come back as not sent yet. South: ${timeline('Pine South 80')}`)

  // A good reload that started before a save does not know about it, so it must not drop the new rain.
  holdNextRead = true
  await addNote('Pine South 80', 'Synthetic fifth note')
  assert(releaseRead, 'The reload after the note must be held open.')
  signal = 'no copy'
  await saveRainForBoth('0.03')
  await act(async () => { releaseRead?.(); await flush(); await flush() })
  for (const name of ['Pine North 80', 'Pine South 80']) assert(timeline(name).includes('0.03 in'), `A reload that started before the save must not drop it. ${name}: ${timeline(name)}`)
} finally { await act(async () => { root.unmount() }); container.remove(); win.close() }
console.log('Field Log several-fields rain regression passed')
