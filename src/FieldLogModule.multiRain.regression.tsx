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
// entry deleted on another phone does not linger with an Edit button that would save it back. Rain still waiting on the
// device shows as not sent yet on a page opened afresh once signal is back, and in another tab; a page opened afresh without
// signal shows the saves and deletes the server confirmed.

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const win = new Window({ url: 'http://farmrx.test/field-log' })
Object.assign(globalThis, { React, window: win, document: win.document, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, MouseEvent: win.MouseEvent, FormData: win.FormData, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator })
const flush = async () => { await Promise.resolve(); await new Promise<void>((resolve) => setTimeout(resolve, 0)) }
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const user = uid(1); const farm = uid(2); const north = uid(3); const south = uid(4); let clockSeconds = 0; const nextStamp = () => new Date(Date.UTC(2027, 7, 4, 12, 0, clockSeconds++)).toISOString()
const field = (id: string, name: string) => ({ id, farm_id: farm, name, total_acres: 80, is_active: true, latitude: null, longitude: null })
const fieldsData = { farm: { id: farm }, entities: [], fields: [field(north, 'Pine North 80'), field(south, 'Pine South 80')], crop_assignments: [], arrangements: [], commodities: [] } as unknown as FieldsData

// A small server, the copy saved on this device, and the writes waiting on the device, shared by every tab. It follows the
// queued repository: a save or delete waits while anything else waits or when its send loses signal; a live read answers
// from the server with the writes waiting when it started laid over it (and their ids) and writes the saved copy unless a
// newer read or confirmed change already did; 'stale copy' answers from the saved copy with the waiting writes laid over
// it, marked offline; 'no copy' throws. A read sees the server and the queue as they were when it started, so one can be
// held open across another save. A 'refused' send is turned down by the server. While copyKeepsUp is on, a save or delete
// the server confirms also goes into the saved copy; the repository only tries that (no IndexedDB, or a changed farm
// fence, and it is skipped), so the page must not rely on it, and the scenarios start with it off. A save sent for an entry
// deleted elsewhere is refused, as the server does since migration 20261021150000.
let signal: 'online' | 'stale copy' | 'no copy' = 'online'; const sendOutcomes: Array<'sent' | 'lost signal' | 'refused'> = []
let server: FieldLogEntry[] = []; let cached: FieldLogEntry[] = []; let waiting: FieldLogEntry[] = []; let waitingDeletes: string[] = []
let queueUnreadable = false; let holdReads = 0; const heldReads: Array<() => void> = []; const heldCount = () => heldReads.length; let copyKeepsUp = false; let moments = 0; let cachedFrom = 0
let reads = 0; let nextId = 10; const saves: FieldLogEntryDraft[] = []; const deletes: string[] = []; const deletedElsewhere = new Set<string>()
const upsert = (rows: FieldLogEntry[], row: FieldLogEntry) => [...rows.filter((item) => item.id !== row.id), row]
const somethingWaits = () => waiting.length > 0 || waitingDeletes.length > 0
const layWaiting = (rows: FieldLogEntry[], saved: FieldLogEntry[], deleted: string[]) => saved.reduce((list, kept) => upsert(list, { ...kept, created_at: list.find((row) => row.id === kept.id)?.created_at ?? kept.created_at }), rows).filter((row) => !deleted.includes(row.id))
const confirmInCopy = (change: (rows: FieldLogEntry[]) => FieldLogEntry[]) => { const moment = ++moments; if (copyKeepsUp) { cached = change(cached); cachedFrom = moment } }
const sendWaiting = () => { const sent = waiting.map(({ pending: _pending, ...entry }) => ({ ...entry, created_at: server.find((row) => row.id === entry.id)?.created_at ?? entry.created_at })); const sentDeletes = waitingDeletes; server = sent.reduce(upsert, server).filter((row) => !sentDeletes.includes(row.id)); confirmInCopy((rows) => sent.reduce(upsert, rows).filter((row) => !sentDeletes.includes(row.id))); waiting = []; waitingDeletes = [] }
const fieldsRepository = { getData: async () => fieldsData, saveField: async () => { throw new Error('unexpected field mutation') } } satisfies FieldsRepository
const fieldLogRepository = {
  getData: async () => {
    reads += 1
    const viewer = { user_id: user, role: 'owner' as const }; const mode = signal; const snapshot = structuredClone(server); const liveRead = mode === 'online' ? ++moments : 0
    const waitingSaves = structuredClone(waiting); const waitingRemovals = [...waitingDeletes]; const waitingIds = [...waitingSaves.map((entry) => entry.id), ...waitingRemovals]
    if (holdReads > 0) { holdReads -= 1; await new Promise<void>((resolve) => { heldReads.push(resolve) }) }
    if (mode === 'online') { if (liveRead > cachedFrom) { cachedFrom = liveRead; cached = structuredClone(snapshot) } return queueUnreadable ? { entries: snapshot, viewer } : { entries: layWaiting(snapshot, waitingSaves, waitingRemovals), viewer, waitingIds } }
    if (mode === 'no copy') throw new Error('network down')
    return { entries: layWaiting(structuredClone(cached), waiting, waitingDeletes), viewer, offline: true as const, waitingIds: [...waiting.map((entry) => entry.id), ...waitingDeletes] }
  },
  saveEntry: async (draft: FieldLogEntryDraft) => {
    saves.push(draft)
    // The server keeps an edited row's created_at; a waiting row is stamped when it was kept, as the queued repository does.
    const stamp = nextStamp(); const createdAt = server.find((item) => item.id === draft.id)?.created_at ?? stamp
    const row = { ...draft, id: draft.id ?? uid(nextId++), farm_id: farm, created_by: user, created_at: createdAt, updated_at: stamp } as FieldLogEntry
    const outcome = sendOutcomes.shift() ?? 'sent'
    if (outcome === 'refused' && !somethingWaits()) throw new Error('field log entry fields have invalid JSON types')
    if (outcome === 'sent' && !somethingWaits() && deletedElsewhere.has(row.id)) throw Object.assign(new Error('field log entry was deleted and cannot be saved again'), { code: 'P0001' })
    if (somethingWaits() || outcome === 'lost signal') { const kept = { ...row, created_at: stamp, pending: true }; waiting = upsert(waiting, kept); return kept }
    server = upsert(server, row); confirmInCopy((rows) => upsert(rows, row)); return row
  },
  deleteEntry: async (id: string) => {
    deletes.push(id)
    if (somethingWaits()) { waitingDeletes.push(id); return { id, deleted: true as const, pending: true } }
    server = server.filter((row) => row.id !== id); confirmInCopy((rows) => rows.filter((row) => row.id !== id)); return { id, deleted: true as const }
  },
} as unknown as FieldLogRepository

const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
const buttonIn = (scope: ParentNode, text: string) => { const found = [...scope.querySelectorAll('button')].find((item) => item.textContent === text) as HTMLButtonElement | undefined; assert(found, `Button ${text} did not render.`); return found }
const card = (name: string, tab: ParentNode = container) => { const found = [...tab.querySelectorAll('.field-log-card')].find((item) => item.querySelector('h2')?.textContent === name) as HTMLElement | undefined; assert(found, `The ${name} card did not render.`); return found }
const row = (name: string, text: string, tab: ParentNode = container) => { const found = [...card(name, tab).querySelectorAll('.field-log-row')].find((item) => item.textContent?.includes(text)) as HTMLElement | undefined; assert(found, `${name} has no timeline row with ${text}. Timeline: ${timeline(name, tab)}`); return found }
const timeline = (name: string, tab: ParentNode = container) => card(name, tab).querySelector('.field-log-timeline')?.textContent ?? ''
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
async function saveInCard(name: string, open: HTMLElement, values: { rainfall?: string; note?: string }, tab: ParentNode = container) {
  await click(open)
  const form = card(name, tab).querySelector('form.field-log-form') as HTMLFormElement
  assert(form, `The ${name} entry form did not open.`)
  if (values.rainfall !== undefined) (form.querySelector('input[name="rainfall"]') as HTMLInputElement).value = values.rainfall
  if (values.note !== undefined) (form.querySelector('textarea[name="note"]') as HTMLTextAreaElement).value = values.note
  await submit(form)
}
const addNote = (name: string, note: string) => saveInCard(name, buttonIn(card(name), 'Add note'), { note })
/** Opens the page afresh, as after leaving the Field Log and coming back: nothing the old page kept on screen carries over. */
async function reopen(key: string, into = root) { await act(async () => { into.render(createElement(MemoryRouter, { key }, createElement(FieldLogPage, { fieldLogRepository, fieldsRepository }), createElement(ConfirmDialogHost))); await flush(); await flush() }) }
const N = 'Pine North 80'; const S = 'Pine South 80'

try {
  for (const mode of ['no copy', 'stale copy'] as const) {
    signal = 'online'; server = []; cached = []; cachedFrom = moments; waiting = []; waitingDeletes = []; reads = 0; saves.length = 0
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
  // Sent, then changed on another phone before a good reload: the next live reload shows the other phone's amount, because
  // the edit no longer waits on this device.
  const northEdit = server.find((entry) => entry.rainfall_in === 0.27)!
  server = upsert(server, { ...northEdit, rainfall_in: 0.29 }); signal = 'online'
  await addNote(S, 'Synthetic change check note')
  assert(timeline(N).includes('0.29 in') && !timeline(N).includes('0.27 in') && !timeline(N).includes('Not sent yet'), `An edit changed elsewhere after it was sent must show the server's amount. North: ${timeline(N)}`)
  // Rain that waited, was sent and was deleted on another phone before any good reload goes away on the next live reload.
  sendOutcomes.push('lost signal')
  await saveInCard(S, buttonIn(card(S), 'Add rain'), { rainfall: '0.14' })
  sendWaiting(); server = server.filter((entry) => entry.rainfall_in !== 0.14); signal = 'stale copy'
  await addNote(N, 'Synthetic offline note')
  assert(row(S, '0.14 in').textContent?.includes('Not sent yet'), `Sent rain must stay while reloads have no signal. South: ${timeline(S)}`)
  signal = 'online'
  await addNote(N, 'Synthetic online note')
  assert(!timeline(S).includes('0.14 in'), `Sent rain deleted on another phone before a good reload must go away. South: ${timeline(S)}`)
  signal = 'stale copy'

  // Another tab on this device queues a delete of rain this page saved: the next answer from the saved copy leaves the row
  // out and lists it as waiting, so the confirmed local copy steps aside instead of keeping the deleted rain on screen.
  await saveInCard(N, buttonIn(card(N), 'Add rain'), { rainfall: '0.18' })
  const northDrizzle = server.find((entry) => entry.rainfall_in === 0.18)!
  assert(timeline(N).includes('0.18 in'), `Rain saved without signal must show. North: ${timeline(N)}`)
  waitingDeletes.push(northDrizzle.id)
  await saveRainForBoth('0.21')
  assert(!timeline(N).includes('0.18 in') && row(N, '0.21 in').textContent?.includes('Not sent yet'), `Another tab's waiting delete must take the confirmed local copy away. North: ${timeline(N)}`)
  sendWaiting()

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

  // A live reload that started before a write was kept waiting cannot list it, so its answer must not settle it.
  signal = 'online'; holdReads = 1
  await addNote(S, 'Synthetic held note')
  assert(heldCount() === 1, 'The reload after the held note must be held open.')
  sendOutcomes.push('lost signal')
  await saveInCard(N, buttonIn(card(N), 'Add rain'), { rainfall: '0.17' })
  await act(async () => { heldReads.shift()?.(); await flush(); await flush() })
  assert(row(N, '0.17 in').textContent?.includes('Not sent yet'), `Rain kept after a live reload started must survive its answer. North: ${timeline(N)}`)
  // When the queue cannot be read, a live answer cannot say what still waits, so the waiting copy stays.
  sendWaiting(); queueUnreadable = true
  await addNote(S, 'Synthetic unreadable queue note')
  assert(row(N, '0.17 in').textContent?.includes('Not sent yet'), `With the waiting list unknown, a waiting copy must stay. North: ${timeline(N)}`)
  queueUnreadable = false
  await addNote(S, 'Synthetic readable queue note')
  assert(timeline(N).includes('0.17 in') && !row(N, '0.17 in').textContent?.includes('Not sent yet'), `Once the list is known again, sent rain must settle. North: ${timeline(N)}`)
  signal = 'stale copy'

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

  // Rain kept on the device while sends have no signal shows, not sent yet, on a page opened afresh once signal is back:
  // the page keeps no copy of it then, so it comes from the live answer, which lays the waiting writes over the server's
  // rows. It has no Edit button until it is sent, and a live reload after sending shows the server's copy.
  signal = 'online'; sendWaiting(); sendOutcomes.push('lost signal')
  await saveInCard(S, buttonIn(card(S), 'Add rain'), { rainfall: '0.31' })
  assert(row(S, '0.31 in').textContent?.includes('Not sent yet'), `Rain whose send lost signal must show as not sent yet. South: ${timeline(S)}`)
  await reopen('reopened with signal')
  assert(waiting.length === 1 && row(S, '0.31 in').textContent?.includes('Not sent yet') && !row(S, '0.31 in').textContent?.includes('Edit'), `Waiting rain must show as not sent yet on a page opened afresh with signal. South: ${timeline(S)}`)
  sendWaiting(); await addNote(S, 'Synthetic reopened note')
  assert(timeline(S).includes('0.31 in') && !row(S, '0.31 in').textContent?.includes('Not sent yet') && row(S, '0.31 in').textContent?.includes('Edit'), `Sent rain must settle on the next live reload. South: ${timeline(S)}`)

  // While reloads have no signal, a confirmed save and a confirmed delete go into the device's saved copy: a page opened
  // afresh without signal shows the new rain and not the deleted note, with no copies kept by the page.
  copyKeepsUp = true; signal = 'stale copy'
  await saveInCard(N, buttonIn(card(N), 'Add rain'), { rainfall: '0.33' })
  await click(buttonIn(row(S, 'Synthetic reopened note'), 'Delete')); await click(dialogButton('Delete entry')); await act(async () => { await flush() })
  assert(server.some((entry) => entry.rainfall_in === 0.33) && !server.some((entry) => entry.note === 'Synthetic reopened note'), 'The save and the delete must reach the server.')
  await reopen('reopened without signal')
  assert(timeline(N).includes('0.33 in') && !timeline(N).includes('Not sent yet') && !timeline(S).includes('Synthetic reopened note'), `A page opened afresh without signal must show confirmed saves and deletes. North: ${timeline(N)} South: ${timeline(S)}`)

  // Two tabs on one device share the queue and the saved copy. Rain the first tab keeps waiting shows, not sent yet, in a
  // second tab opened with signal; once it is sent, the second tab opened afresh without signal shows it as sent, and its
  // next live reload shows the server's copy.
  signal = 'online'; sendOutcomes.push('lost signal')
  await saveInCard(N, buttonIn(card(N), 'Add rain'), { rainfall: '0.44' })
  const secondTab = document.createElement('div'); document.body.append(secondTab); const secondRoot = createRoot(secondTab)
  try {
    await reopen('second tab', secondRoot)
    assert(row(N, '0.44 in', secondTab).textContent?.includes('Not sent yet') && !row(N, '0.44 in', secondTab).textContent?.includes('Edit'), `The second tab must show the first tab's waiting rain as not sent yet. North: ${timeline(N, secondTab)}`)
    sendWaiting(); signal = 'stale copy'; await reopen('second tab without signal', secondRoot)
    assert(timeline(N, secondTab).includes('0.44 in') && !timeline(N, secondTab).includes('Not sent yet'), `Once sent, a page opened afresh without signal must show the rain as sent. North: ${timeline(N, secondTab)}`)
    signal = 'online'; await saveInCard(S, buttonIn(card(S, secondTab), 'Add note'), { note: 'Synthetic note from the second tab' }, secondTab)
    assert(timeline(N, secondTab).includes('0.44 in') && !timeline(N, secondTab).includes('Not sent yet') && timeline(S, secondTab).includes('Synthetic note from the second tab'), `The second tab's live reload must show the server's copies. North: ${timeline(N, secondTab)}`)
  } finally { await act(async () => { secondRoot.unmount() }); secondTab.remove() }
  copyKeepsUp = false

  // Rain deleted on another phone is still on this screen, and the farmer edits it: the server refuses the edit rather than
  // bring the rain back. The card says why, out loud for a screen reader; the reload that follows takes the deleted rain
  // away; and what the farmer typed reopens as new rain, so one tap adds it back under a new id.
  signal = 'online'; server = []; cached = []; cachedFrom = moments; waiting = []; waitingDeletes = []; sendOutcomes.length = 0
  await reopen('deleted elsewhere')
  await saveInCard(N, buttonIn(card(N), 'Add rain'), { rainfall: '0.61' }); await saveInCard(N, buttonIn(card(N), 'Add rain'), { rainfall: '0.62' })
  const goneRain = server.find((entry) => entry.rainfall_in === 0.61); assert(goneRain, 'The deleted-elsewhere scene needs its rain on the server.')
  server = server.filter((entry) => entry.id !== goneRain.id); deletedElsewhere.add(goneRain.id)
  assert(timeline(N).includes('0.61 in'), `Until a reload, the rain deleted elsewhere is still on this screen. North: ${timeline(N)}`)
  await saveInCard(N, buttonIn(row(N, '0.61 in'), 'Edit'), { rainfall: '0.91', note: 'Gauge re-read' })
  const cardError = card(N).querySelector('.form-error')
  assert(cardError?.textContent === 'Someone deleted this entry, so your change was not saved. It is still in the form: save it to add it again, or cancel.' && cardError.getAttribute('role') === 'alert', `The card must say, as an alert, that the entry was deleted. North: ${card(N).textContent}`)
  assert(!timeline(N).includes('0.61 in') && !timeline(N).includes('0.91 in') && timeline(N).includes('0.62 in'), `The deleted rain must leave the timeline and the other rain stay. North: ${timeline(N)}`)
  assert(!server.some((entry) => entry.id === goneRain.id), 'The edit must not bring the deleted rain back.')
  const reopened = card(N).querySelector('form.field-log-form') as HTMLFormElement | null
  assert(reopened?.querySelector('h3')?.textContent === 'Add rain' && (reopened.querySelector('input[name="rainfall"]') as HTMLInputElement).value === '0.91' && (reopened.querySelector('textarea[name="note"]') as HTMLTextAreaElement).value === 'Gauge re-read' && (reopened.querySelector('input[name="date"]') as HTMLInputElement).value === goneRain.observed_on, `What the farmer typed must reopen as new rain. Form: ${reopened?.textContent}`)
  await submit(reopened)
  const addedBack = server.find((entry) => entry.rainfall_in === 0.91)
  assert(addedBack && addedBack.id !== goneRain.id && addedBack.note === 'Gauge re-read' && timeline(N).includes('0.91 in · Gauge re-read'), `Saving the reopened form must add the rain as a new entry. North: ${timeline(N)}`)
  assert(!card(N).querySelector('.form-error') && !card(N).querySelector('form.field-log-form'), `Once added back, the form closes and the message goes. North: ${card(N).textContent}`)
  // Opening another form after such a refusal clears the message and starts that form empty.
  const goneAgain = server.find((entry) => entry.rainfall_in === 0.62); assert(goneAgain, 'The second refusal needs the other North rain.')
  server = server.filter((entry) => entry.id !== goneAgain.id); deletedElsewhere.add(goneAgain.id)
  await saveInCard(N, buttonIn(row(N, '0.62 in'), 'Edit'), { rainfall: '0.66', note: 'Second read' })
  assert(card(N).querySelector('.form-error'), 'The second refused edit must show its message.')
  await click(buttonIn(card(N), 'Add note'))
  const noteForm = card(N).querySelector('form.field-log-form') as HTMLFormElement | null
  assert(!card(N).querySelector('.form-error') && noteForm?.querySelector('h3')?.textContent === 'Add note' && (noteForm.querySelector('textarea[name="note"]') as HTMLTextAreaElement).value === '', `Add note must clear the message and start empty. North: ${card(N).textContent}`)
  await click(buttonIn(noteForm, 'Cancel'))
  // The same refusal for rain this page holds as its own confirmed copy (the reload after its save answered from a saved
  // copy that lacks it), with the reload after the refusal answering from that copy too: the card must still take the
  // rain away rather than keep showing the page's copy, with Edit, under the message.
  signal = 'stale copy'
  await saveInCard(N, buttonIn(card(N), 'Add rain'), { rainfall: '0.63' })
  const keptRain = server.find((entry) => entry.rainfall_in === 0.63); assert(keptRain, 'The kept-copy scene needs its rain on the server.')
  assert(timeline(N).includes('0.63 in'), `The page keeps its own copy of rain the saved copy lacks. North: ${timeline(N)}`)
  server = server.filter((entry) => entry.id !== keptRain.id); deletedElsewhere.add(keptRain.id)
  await saveInCard(N, buttonIn(row(N, '0.63 in'), 'Edit'), { rainfall: '0.64' })
  assert(card(N).querySelector('.form-error') && !timeline(N).includes('0.63 in') && !timeline(N).includes('0.64 in'), `Rain refused as deleted must leave the timeline even when the reload keeps the page's copy. North: ${timeline(N)}`)
  await click(buttonIn(card(N).querySelector('form.field-log-form')!, 'Cancel'))
  signal = 'online'

  // Same-date rows are ordered by created time as instants: the server writes '…T15:00:00+00:00' and the device
  // '…T15:00:00.400Z', and comparing the text would put the older row first.
  const stampedNote = (id: string, createdAt: string, note: string) => ({ id, farm_id: farm, field_id: north, entry_type: 'note', observed_on: '2027-08-04', rainfall_in: null, note, created_by: user, created_at: createdAt, updated_at: createdAt })
  const orderRepository = { ...fieldLogRepository, getData: async () => ({ entries: [stampedNote(uid(900), '2027-08-04T15:00:00+00:00', 'Server stamp row'), stampedNote(uid(901), '2027-08-04T15:00:00.400Z', 'Device stamp row')], viewer: { user_id: user, role: 'owner' as const } }) } as unknown as FieldLogRepository
  await act(async () => { root.render(createElement(MemoryRouter, { key: 'order' }, createElement(FieldLogPage, { fieldLogRepository: orderRepository, fieldsRepository }), createElement(ConfirmDialogHost))); await flush() })
  assert(timeline(N).indexOf('Device stamp row') >= 0 && timeline(N).indexOf('Device stamp row') < timeline(N).indexOf('Server stamp row'), `The later row must come first whatever its stamp format. North: ${timeline(N)}`)
} finally { await act(async () => { root.unmount() }); container.remove(); win.close() }
console.log('Field Log local copies regression passed (several-fields and one-field saves, edits, deletes, reload order, waiting rain on a reopened page and a second tab, saved copy kept current, edit of rain deleted elsewhere)')
