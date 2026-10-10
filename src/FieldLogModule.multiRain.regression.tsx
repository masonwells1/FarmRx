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
const user = uid(1); const farm = uid(2); const north = uid(3); const south = uid(4); let clockSeconds = 0; const nextStamp = () => new Date(Date.UTC(2027, 7, 4, 12, 0, clockSeconds++)).toISOString()
const field = (id: string, name: string) => ({ id, farm_id: farm, name, total_acres: 80, is_active: true, latitude: null, longitude: null })
const fieldsData = { farm: { id: farm }, entities: [], fields: [field(north, 'Pine North 80'), field(south, 'Pine South 80')], crop_assignments: [], arrangements: [], commodities: [] } as unknown as FieldsData

// A small server, the copy live reads leave on this device, and the writes waiting on the device. It follows the queued
// repository: a save or delete waits while anything else waits or when its send loses signal; a live read answers from
// the server alone and writes the saved copy unless a newer live read already did; 'stale copy' answers from the saved
// copy with the waiting writes laid over it, marked offline; 'no copy' throws. A read sees the server as it was when it
// started, so one can be held open across another save. A 'refused' send is turned down by the server.
let signal: 'online' | 'stale copy' | 'no copy' = 'online'; const sendOutcomes: Array<'sent' | 'lost signal' | 'refused'> = []
let server: FieldLogEntry[] = []; let cached: FieldLogEntry[] = []; let waiting: FieldLogEntry[] = []; let waitingDeletes: string[] = []
let holdReads = 0; const heldReads: Array<() => void> = []; const heldCount = () => heldReads.length; let liveReadsStarted = 0; let cachedFrom = 0
let reads = 0; let nextId = 10; const saves: FieldLogEntryDraft[] = []; const deletes: string[] = []
const upsert = (rows: FieldLogEntry[], row: FieldLogEntry) => [...rows.filter((item) => item.id !== row.id), row]
const somethingWaits = () => waiting.length > 0 || waitingDeletes.length > 0
const sendWaiting = () => { server = waiting.map(({ pending: _pending, ...entry }) => ({ ...entry, created_at: server.find((row) => row.id === entry.id)?.created_at ?? entry.created_at })).reduce(upsert, server).filter((row) => !waitingDeletes.includes(row.id)); waiting = []; waitingDeletes = [] }
const fieldsRepository = { getData: async () => fieldsData, saveField: async () => { throw new Error('unexpected field mutation') } } satisfies FieldsRepository
const fieldLogRepository = {
  getData: async () => {
    reads += 1
    const viewer = { user_id: user, role: 'owner' as const }; const mode = signal; const snapshot = structuredClone(server); const liveRead = mode === 'online' ? ++liveReadsStarted : 0
    if (holdReads > 0) { holdReads -= 1; await new Promise<void>((resolve) => { heldReads.push(resolve) }) }
    if (mode === 'online') { if (liveRead > cachedFrom) { cachedFrom = liveRead; cached = structuredClone(snapshot) } return { entries: snapshot, viewer } }
    if (mode === 'no copy') throw new Error('network down')
    return { entries: waiting.reduce(upsert, structuredClone(cached)).filter((row) => !waitingDeletes.includes(row.id)), viewer, offline: true as const }
  },
  saveEntry: async (draft: FieldLogEntryDraft) => {
    saves.push(draft)
    // The server keeps an edited row's created_at; a waiting row is stamped when it was kept, as the queued repository does.
    const stamp = nextStamp(); const createdAt = server.find((item) => item.id === draft.id)?.created_at ?? stamp
    const row = { ...draft, id: draft.id ?? uid(nextId++), farm_id: farm, created_by: user, created_at: createdAt, updated_at: stamp } as FieldLogEntry
    const outcome = sendOutcomes.shift() ?? 'sent'
    if (outcome === 'refused' && !somethingWaits()) throw new Error('field log entry fields have invalid JSON types')
    if (somethingWaits() || outcome === 'lost signal') { const kept = { ...row, created_at: stamp, pending: true }; waiting = upsert(waiting, kept); return kept }
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
    signal = 'online'; server = []; cached = []; cachedFrom = liveReadsStarted; waiting = []; waitingDeletes = []; reads = 0; saves.length = 0
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
  // Rows on the same date keep the server's order (newest first): the edited storm stays below the newer note.
  assert(timeline(S).indexOf('Synthetic scouting note') >= 0 && timeline(S).indexOf('Synthetic scouting note') < timeline(S).indexOf('0.60 in'), `An edited row must keep its place among same-date rows. Timeline: ${timeline(S)}`)

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
  const readsBeforeThirdNote = reads
  await addNote(N, 'Synthetic third note')
  assert(reads === readsBeforeThirdNote + 1, 'The third note must reload the page once.')
  assert(!timeline(S).includes('0.05 in') && !timeline(S).includes('Not sent yet') && seasonTotal(S) === '0.72 in', `Rain deleted on another phone must not come back. South: ${timeline(S)}`)
  assert(timeline(N).includes('0.05 in') && !timeline(N).includes('Not sent yet') && seasonTotal(N) === '0.42 in', `A good reload must show the server's copies. North: ${timeline(N)}`)
  // Rain that waited on the device, was sent and reached a good reload is settled too: deleted on another phone, it stays gone.
  server = server.filter((entry) => !(entry.field_id === south && entry.rainfall_in === 0.1))
  const readsBeforeFourthNote = reads
  await addNote(S, 'Synthetic fourth note')
  assert(reads === readsBeforeFourthNote + 1, 'The fourth note must reload the page once.')
  assert(!timeline(S).includes('0.10 in') && seasonTotal(S) === '0.62 in', `Sent rain deleted on another phone must not come back. South: ${timeline(S)}`)

  // A live reload that started before a save does not know about it, so it must not drop the new rain.
  holdReads = 1
  await addNote(S, 'Synthetic fifth note')
  assert(heldCount() === 1, 'The reload after the note must be held open.')
  signal = 'no copy'
  await saveRainForBoth('0.03')
  await act(async () => { heldReads.shift()?.(); await flush(); await flush() })
  for (const name of [N, S]) assert(timeline(name).includes('0.03 in'), `A reload that started before the save must not drop it. ${name}: ${timeline(name)}`)

  // The newest reload wins: a live reload that started before a save and answers after the reload that followed it is
  // ignored, so it cannot put back rows from before the save.
  signal = 'online'; holdReads = 1
  await addNote(N, 'Synthetic sixth note')
  assert(heldCount() === 1, 'The reload after the sixth note must be held open.')
  await saveRainForBoth('0.04')
  await act(async () => { heldReads.shift()?.(); await flush(); await flush() })
  for (const name of [N, S]) assert(timeline(name).includes('0.04 in'), `An older reload answering last must not hide newer rain. ${name}: ${timeline(name)}`)
  // The older read did not overwrite the saved copy either (the fake follows the repository's write rule, which the
  // repository regression pins in group 15): a reload without signal right after still shows the rain.
  signal = 'stale copy'
  await addNote(S, 'Synthetic stale check note')
  for (const name of [N, S]) assert(timeline(name).includes('0.04 in'), `The saved copy must keep rain a newer live read saw. ${name}: ${timeline(name)}`)

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

  // An edit that waits on the device and is then sent: a reload without signal answers from the saved copy, which still
  // has the old amount and no waiting write. Only a live answer may settle the waiting edit, so the new amount stays.
  sendOutcomes.push('lost signal')
  await saveInCard(N, buttonIn(row(N, '0.25 in'), 'Edit'), { rainfall: '0.27' })
  assert(row(N, '0.27 in').textContent?.includes('Not sent yet'), `A waiting edit must show its new amount as not sent yet. North: ${timeline(N)}`)
  assert(timeline(N).indexOf('Synthetic third note') >= 0 && timeline(N).indexOf('0.27 in') > timeline(N).indexOf('Synthetic third note'), `A waiting edit must keep its place among same-date rows. North: ${timeline(N)}`)
  // A live reload while the edit still waits has the server's old row; it must not settle the edit.
  signal = 'online'
  await saveRainForBoth('0.12')
  assert(row(N, '0.27 in').textContent?.includes('Not sent yet') && !timeline(N).includes('0.25 in'), `A live reload must not replace a waiting edit with the old row. North: ${timeline(N)}`)
  sendWaiting(); signal = 'stale copy'
  await addNote(S, 'Synthetic ninth note')
  assert(timeline(N).includes('0.27 in') && !timeline(N).includes('0.25 in'), `A sent edit must not fall back to the saved copy's old amount. North: ${timeline(N)}`)

  // Another tab on this device queues an edit of rain this page saved: the next answer from the saved copy shows that
  // waiting edit, so the confirmed local copy steps aside instead of offering Edit on the older amount.
  await saveInCard(N, buttonIn(card(N), 'Add rain'), { rainfall: '0.09' })
  const northSprinkle = server.find((entry) => entry.rainfall_in === 0.09)!
  assert(timeline(N).includes('0.09 in'), `Rain saved without signal must show. North: ${timeline(N)}`)
  waiting = upsert(waiting, { ...northSprinkle, rainfall_in: 0.11, created_at: nextStamp(), pending: true })
  await saveRainForBoth('0.01')
  assert(!timeline(N).includes('0.09 in') && row(N, '0.11 in').textContent?.includes('Not sent yet'), `Another tab's waiting edit must replace the confirmed local copy. North: ${timeline(N)}`)
  // A delete made while writes wait also waits: the row goes at once and the farmer is told it finishes later.
  await click(buttonIn(row(S, '0.60 in'), 'Delete')); await click(dialogButton('Delete entry')); await act(async () => { await flush() })
  assert(waitingDeletes.length === 1 && !timeline(S).includes('0.60 in') && card(S).textContent?.includes('Deleted on this device. It will finish syncing when you reconnect.'), `A waiting delete must hide the row and say so. South: ${timeline(S)}`)
  sendWaiting(); signal = 'online'
  await addNote(N, 'Synthetic tenth note')
  assert(!server.some((entry) => entry.rainfall_in === 0.6) && !timeline(S).includes('0.60 in') && timeline(N).includes('0.11 in') && !timeline(N).includes('Not sent yet'), `After sending, the delete must have reached the server and the edit must show from it. North: ${timeline(N)} South: ${timeline(S)}`)

  // One field's save is refused by the server: the form names it, keeps it chosen, and the other field's rain shows.
  sendOutcomes.push('sent', 'refused'); signal = 'stale copy'
  await saveRainForBoth('0.06')
  assert(container.textContent?.includes(`Saved for ${N}. Not saved for ${S}. Try those again.`) && timeline(N).includes('0.06 in') && !timeline(S).includes('0.06 in'), `A refused field must be named and the saved one shown. ${container.textContent}`)
  const openForm = container.querySelector('form.multi-rain-form') as HTMLFormElement
  assert(openForm && [...openForm.querySelectorAll('input[type="checkbox"]')].map((box) => (box as HTMLInputElement).checked).join() === 'false,true', 'After a refusal the form must stay open with only the refused field chosen.')
  await click(buttonIn(openForm, 'Cancel'))

  // A reload that started before a newer one and fails after the newer one was applied must not show its error.
  signal = 'no copy'; holdReads = 1
  await addNote(S, 'Synthetic eleventh note')
  assert(heldCount() === 1, 'The failing reload must be held open.')
  signal = 'online'
  await addNote(N, 'Synthetic twelfth note')
  await act(async () => { heldReads.shift()?.(); await flush(); await flush() })
  assert(!container.querySelector('.field-log-page > .form-error'), `An older reload failing late must not show an error. ${container.querySelector('.field-log-page > .form-error')?.textContent}`)

  // Switching Edit from one row to another starts a fresh form: what was typed for the first row must not be saved onto
  // the second.
  await click(buttonIn(row(N, '0.07 in'), 'Edit'))
  const firstForm = card(N).querySelector('form.field-log-form') as HTMLFormElement
  const typed = firstForm.querySelector('input[name="rainfall"]') as HTMLInputElement
  await act(async () => { typed.value = '0.70'; typed.dispatchEvent(new Event('input', { bubbles: true })); await flush() })
  await click(buttonIn(row(N, '0.04 in'), 'Edit'))
  const secondForm = card(N).querySelector('form.field-log-form') as HTMLFormElement
  assert((secondForm.querySelector('input[name="rainfall"]') as HTMLInputElement).value === '0.04', `The second row's form must show its own amount, got ${(secondForm.querySelector('input[name="rainfall"]') as HTMLInputElement).value}.`)
  await click(buttonIn(secondForm, 'Cancel'))

  // A live reload that started before an edit answers with the old amount while the edit's own reload is still out:
  // it must not settle the edit, and neither must the edit's reload when it answers from the saved copy.
  signal = 'online'; holdReads = 1
  await addNote(N, 'Synthetic thirteenth note')
  signal = 'stale copy'; holdReads = 1
  await saveInCard(N, buttonIn(row(N, '0.06 in'), 'Edit'), { rainfall: '0.16' })
  assert(heldCount() === 2, 'Both reloads must be held open.')
  await act(async () => { heldReads.shift()?.(); await flush(); await flush() })
  assert(timeline(N).includes('0.16 in') && !timeline(N).includes('0.06 in'), `A live reload that started before an edit must not settle it. North: ${timeline(N)}`)
  await act(async () => { heldReads.shift()?.(); await flush(); await flush() })
  assert(timeline(N).includes('0.16 in') && !timeline(N).includes('0.06 in'), `The edit must still show after its own reload answers from the saved copy. North: ${timeline(N)}`)

  // Same-date rows are ordered by created time as instants: the server writes '…T15:00:00+00:00' and the device
  // '…T15:00:00.400Z', and comparing the text would put the older row first.
  const stampedNote = (id: string, createdAt: string, note: string) => ({ id, farm_id: farm, field_id: north, entry_type: 'note', observed_on: '2027-08-04', rainfall_in: null, note, created_by: user, created_at: createdAt, updated_at: createdAt })
  const orderRepository = { ...fieldLogRepository, getData: async () => ({ entries: [stampedNote(uid(900), '2027-08-04T15:00:00+00:00', 'Server stamp row'), stampedNote(uid(901), '2027-08-04T15:00:00.400Z', 'Device stamp row')], viewer: { user_id: user, role: 'owner' as const } }) } as unknown as FieldLogRepository
  await act(async () => { root.render(createElement(MemoryRouter, { key: 'order' }, createElement(FieldLogPage, { fieldLogRepository: orderRepository, fieldsRepository }), createElement(ConfirmDialogHost))); await flush() })
  assert(timeline(N).indexOf('Device stamp row') >= 0 && timeline(N).indexOf('Device stamp row') < timeline(N).indexOf('Server stamp row'), `The later row must come first whatever its stamp format. North: ${timeline(N)}`)
} finally { await act(async () => { root.unmount() }); container.remove(); win.close() }
console.log('Field Log local copies regression passed (several-fields and one-field saves, edits, deletes, reload order)')
