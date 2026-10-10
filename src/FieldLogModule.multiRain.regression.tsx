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
// for ..." while the rain it had just saved was missing from every card. An edit must show the new amount, not the old one
// (Codex, PR #69). A live reload that started after a save settles it: the server's copy replaces the local one, and an
// entry deleted on another phone does not linger with an Edit button that would save it back.

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const win = new Window({ url: 'http://farmrx.test/field-log' })
Object.assign(globalThis, { React, window: win, document: win.document, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, MouseEvent: win.MouseEvent, FormData: win.FormData, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator })
const flush = async () => { await Promise.resolve(); await new Promise<void>((resolve) => setTimeout(resolve, 0)) }
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const user = uid(1); const farm = uid(2); const north = uid(3); const south = uid(4); const stamp = '2027-08-04T12:00:00.000Z'
const field = (id: string, name: string) => ({ id, farm_id: farm, name, total_acres: 80, is_active: true, latitude: null, longitude: null })
const fieldsData = { farm: { id: farm }, entities: [], fields: [field(north, 'Pine North 80'), field(south, 'Pine South 80')], crop_assignments: [], arrangements: [], commodities: [] } as unknown as FieldsData

// A small server, the copy the last live read left on this device, and the writes waiting on the device. It follows the
// queued repository: a save or delete waits while anything else waits or when its send loses signal; a live read answers
// from the server alone; 'stale copy' answers from the saved copy with the waiting writes laid over it, marked offline;
// 'no copy' throws. A read sees the server as it was when it started, so one can be held open across another save.
let signal: 'online' | 'stale copy' | 'no copy' = 'online'; const sendOutcomes: Array<'sent' | 'lost signal'> = []
let server: FieldLogEntry[] = []; let cached: FieldLogEntry[] = []; let waiting: FieldLogEntry[] = []; let waitingDeletes: string[] = []
let holdNextRead = false; let releaseRead: (() => void) | null = null
let reads = 0; let nextId = 10; const saves: FieldLogEntryDraft[] = []; const deletes: string[] = []
const upsert = (rows: FieldLogEntry[], row: FieldLogEntry) => [...rows.filter((item) => item.id !== row.id), row]
const somethingWaits = () => waiting.length > 0 || waitingDeletes.length > 0
const sendWaiting = () => { server = waiting.map(({ pending: _pending, ...entry }) => entry).reduce(upsert, server).filter((row) => !waitingDeletes.includes(row.id)); waiting = []; waitingDeletes = [] }
const fieldsRepository = { getData: async () => fieldsData, saveField: async () => { throw new Error('unexpected field mutation') } } satisfies FieldsRepository
const fieldLogRepository = {
  getData: async () => {
    reads += 1
    const viewer = { user_id: user, role: 'owner' as const }; const mode = signal; const snapshot = structuredClone(server)
    if (holdNextRead) { holdNextRead = false; await new Promise<void>((resolve) => { releaseRead = resolve }) }
    if (mode === 'online') { cached = structuredClone(snapshot); return { entries: snapshot, viewer } }
    if (mode === 'no copy') throw new Error('network down')
    return { entries: waiting.reduce(upsert, structuredClone(cached)).filter((row) => !waitingDeletes.includes(row.id)), viewer, offline: true as const }
  },
  saveEntry: async (draft: FieldLogEntryDraft) => {
    saves.push(draft)
    const row = { ...draft, id: draft.id ?? uid(nextId++), farm_id: farm, created_by: user, created_at: stamp, updated_at: stamp } as FieldLogEntry
    const outcome = sendOutcomes.shift() ?? 'sent'
    if (somethingWaits() || outcome === 'lost signal') { const kept = { ...row, pending: true }; waiting = upsert(waiting, kept); return kept }
    server = upsert(server, row); return row
  },
  deleteEntry: async (id: string) => {
    deletes.push(id)
    if (somethingWaits()) { waitingDeletes.push(id); return { id, deleted: true as const, pending: true } }
    server = server.filter((row) => row.id !== id); return { id, deleted: true as const }
  },
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
/** Saves through one field's own form (Add rain, Add note or a row's Edit), which reloads the page after a confirmed save. */
async function saveInCard(name: string, open: HTMLElement, values: { rainfall?: string; note?: string }) {
  await click(open)
  const form = card(name).querySelector('form.field-log-form') as HTMLFormElement
  assert(form, `The ${name} entry form did not open.`)
  if (values.rainfall !== undefined) (form.querySelector('input[name="rainfall"]') as HTMLInputElement).value = values.rainfall
  if (values.note !== undefined) (form.querySelector('textarea[name="note"]') as HTMLTextAreaElement).value = values.note
  await submit(form)
}
const addNote = (name: string, note: string) => saveInCard(name, buttonIn(card(name), 'Add note'), { note })
const N = 'Pine North 80'; const S = 'Pine South 80'

try {
  for (const mode of ['no copy', 'stale copy'] as const) {
    signal = 'online'; server = []; cached = []; waiting = []; waitingDeletes = []; reads = 0; saves.length = 0
    await act(async () => { root.render(createElement(MemoryRouter, { key: mode }, createElement(FieldLogPage, { fieldLogRepository, fieldsRepository }), createElement(ConfirmDialogHost))); await flush() })
    signal = mode
    await saveRainForBoth('0.75')
    assert(saves.length === 2, `${mode}: both chosen fields must be saved once each, got ${saves.length}.`)
    assert(reads === 2, `${mode}: the page must try one reload after saving, got ${reads} reads.`)
    assert(container.textContent?.includes(`Saved for ${N}, ${S}.`), `${mode}: the form must say both fields saved. ${container.textContent}`)
    for (const name of [N, S]) assert(timeline(name).includes('0.75 in · Synthetic storm') && seasonTotal(name) === '0.75 in', `${mode}, ${name}: rain the server confirmed must show in the timeline and season total. Timeline: ${timeline(name)}`)
  }

  // Still on the stale copy. Editing a saved entry shows the new amount; the local copy must not snap back to the old one.
  const northStorm = server.find((entry) => entry.field_id === north)!
  await saveInCard(N, buttonIn(row(N, '0.75 in'), 'Edit'), { rainfall: '0.50' })
  assert(saves.at(-1)?.id === northStorm.id && server.find((entry) => entry.id === northStorm.id)?.rainfall_in === 0.5, 'The edit must save the same entry with the new amount.')
  assert(timeline(N).includes('0.50 in · Synthetic storm') && !timeline(N).includes('0.75 in') && seasonTotal(N) === '0.50 in', `An edited entry must show its new amount after a stale reload. Timeline: ${timeline(N)}`)
  // The one-field form has the same need: rain it saved shows even though the reload after it got the stale copy.
  await saveInCard(N, buttonIn(card(N), 'Add rain'), { rainfall: '0.25' })
  assert(timeline(N).includes('0.25 in') && seasonTotal(N) === '0.75 in', `Rain saved from one field's form must show after a stale reload. Timeline: ${timeline(N)}`)

  // A good reload puts South's storm in the device's saved copy. Edited while the next reload answers from that copy, the
  // local edit must win over the saved copy's older row.
  signal = 'online'
  await addNote(S, 'Synthetic scouting note')
  signal = 'stale copy'
  await saveInCard(S, buttonIn(row(S, '0.75 in'), 'Edit'), { rainfall: '0.60' })
  assert(server.find((entry) => entry.field_id === south && entry.entry_type === 'rainfall')?.rainfall_in === 0.6, 'The South edit must reach the server.')
  assert(timeline(S).includes('0.60 in') && !timeline(S).includes('0.75 in') && seasonTotal(S) === '0.60 in', `An edit must beat the older row in the device's saved copy. Timeline: ${timeline(S)}`)

  // Rain whose send loses signal waits on the device, and so does every save after it. It shows as not sent yet, also
  // through a live reload that comes before it is sent (a later several-fields save, which waits too, reloads the page).
  sendOutcomes.push('lost signal')
  await saveRainForBoth('0.10')
  assert(container.textContent?.includes(`Kept on this device for ${N}, ${S}`), `The form must say the rain was kept on this device. ${container.textContent}`)
  assert(timeline(S).includes('0.10 in') && timeline(S).includes('Not sent yet') && seasonTotal(S) === '0.70 in', `Rain kept on the device must show as not sent yet. Timeline: ${timeline(S)}`)
  signal = 'online'
  await saveRainForBoth('0.02')
  assert(waiting.length === 4 && timeline(S).includes('0.10 in') && timeline(S).includes('0.02 in') && timeline(S).includes('Not sent yet') && seasonTotal(S) === '0.72 in', `A good reload must not drop rain still waiting on the device. Timeline: ${timeline(S)}`)
  // It is sent, but the next reload loses signal and the saved copy is from before: the rain stays on screen. Its label
  // still says not sent yet until a good reload has it.
  sendWaiting(); signal = 'stale copy'
  await addNote(S, 'Synthetic second note')
  assert(timeline(S).includes('0.10 in') && seasonTotal(S) === '0.72 in', `Sent rain must stay on screen until a good reload has it. Timeline: ${timeline(S)}`)

  // Deleting an entry removes it, even though the saved copy on this device still has it.
  await click(buttonIn(row(N, '0.50 in'), 'Delete')); await click(dialogButton('Delete entry')); await act(async () => { await flush() })
  assert(deletes.length === 1 && !timeline(N).includes('0.50 in') && seasonTotal(N) === '0.37 in' && timeline(S).includes('0.60 in'), `Deleting must remove only that entry. North: ${timeline(N)}`)

  // Rain saved while the reloads have no signal, then deleted on another phone before any good reload: once signal is
  // back, the next reload must not bring it back from the local copies.
  await saveRainForBoth('0.05')
  const southShower = server.find((entry) => entry.field_id === south && entry.rainfall_in === 0.05)!
  assert(timeline(S).includes('0.05 in'), `Rain saved without signal must show. South: ${timeline(S)}`)
  server = server.filter((entry) => entry.id !== southShower.id); signal = 'online'
  await addNote(N, 'Synthetic third note')
  assert(!timeline(S).includes('0.05 in') && !timeline(S).includes('Not sent yet') && seasonTotal(S) === '0.72 in', `Rain deleted on another phone must not come back. South: ${timeline(S)}`)
  assert(timeline(N).includes('0.05 in') && !timeline(N).includes('Not sent yet') && seasonTotal(N) === '0.42 in', `A good reload must show the server's copies. North: ${timeline(N)}`)
  // Rain that waited on the device, was sent and reached a good reload is settled too: deleted on another phone, it stays gone.
  server = server.filter((entry) => !(entry.field_id === south && entry.rainfall_in === 0.1))
  await addNote(S, 'Synthetic fourth note')
  assert(!timeline(S).includes('0.10 in') && seasonTotal(S) === '0.62 in', `Sent rain deleted on another phone must not come back. South: ${timeline(S)}`)

  // A live reload that started before a save does not know about it, so it must not drop the new rain.
  holdNextRead = true
  await addNote(S, 'Synthetic fifth note')
  assert(releaseRead, 'The reload after the note must be held open.')
  signal = 'no copy'
  await saveRainForBoth('0.03')
  await act(async () => { releaseRead?.(); await flush(); await flush() })
  for (const name of [N, S]) assert(timeline(name).includes('0.03 in'), `A reload that started before the save must not drop it. ${name}: ${timeline(name)}`)

  // The newest reload wins: a live reload that started before a save and answers after the reload that followed it is
  // ignored, so it cannot put back rows from before the save.
  signal = 'online'; holdNextRead = true; releaseRead = null
  await addNote(N, 'Synthetic sixth note')
  assert(releaseRead, 'The reload after the sixth note must be held open.')
  await saveRainForBoth('0.04')
  await act(async () => { releaseRead?.(); await flush(); await flush() })
  for (const name of [N, S]) assert(timeline(name).includes('0.04 in'), `An older reload answering last must not hide newer rain. ${name}: ${timeline(name)}`)

  // One field's send goes through and the next loses signal: one saved entry, one waiting.
  sendOutcomes.push('sent', 'lost signal'); signal = 'stale copy'
  await saveRainForBoth('0.07')
  assert(container.textContent?.includes(`Saved for ${N}. Kept on this device for ${S}`), `The form must name the saved and the kept field. ${container.textContent}`)
  const northRow = row(N, '0.07 in'); const southRow = row(S, '0.07 in')
  assert(!northRow.textContent?.includes('Not sent yet') && northRow.textContent?.includes('Edit') && southRow.textContent?.includes('Not sent yet') && !southRow.textContent?.includes('Edit'), `The saved entry must be editable and the waiting one marked not sent yet. North: ${northRow.textContent} South: ${southRow.textContent}`)

  // Rain from one field's own form that has to wait (South's rain is still waiting) shows at once as not sent yet. Once
  // sent and settled by a good reload, a delete on another phone keeps it gone.
  await saveInCard(N, buttonIn(card(N), 'Add rain'), { rainfall: '0.08' })
  assert(waiting.some((entry) => entry.rainfall_in === 0.08) && row(N, '0.08 in').textContent?.includes('Not sent yet'), `A one-field save that waits must show as not sent yet. North: ${timeline(N)}`)
  sendWaiting(); signal = 'online'
  await addNote(S, 'Synthetic seventh note')
  assert(timeline(N).includes('0.08 in') && !timeline(N).includes('Not sent yet') && !timeline(S).includes('Not sent yet'), `A good reload after sending must show the server's copies. North: ${timeline(N)}`)
  server = server.filter((entry) => entry.rainfall_in !== 0.08)
  await addNote(S, 'Synthetic eighth note')
  assert(!timeline(N).includes('0.08 in'), `Sent one-field rain deleted on another phone must not come back. North: ${timeline(N)}`)
} finally { await act(async () => { root.unmount() }); container.remove(); win.close() }
console.log('Field Log several-fields rain regression passed')
