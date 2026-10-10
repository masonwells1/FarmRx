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
let reads = 0; let nextId = 10; let server: FieldLogEntry[] | null = null; let noSignal = false; let cachedReads = false; let holdNext: (() => { entries: FieldLogEntry[]; cached?: true }) | null = null; let releaseHeld = () => {}; const unsent: FieldLogEntry[] = []; const returned: FieldLogEntry[] = []; let afterSave: 'stale copy' | 'no copy' = 'stale copy'; const saves: FieldLogEntryDraft[] = []; const deletes: string[] = []
const fieldsRepository = { getData: async () => fieldsData, saveField: async () => { throw new Error('unexpected field mutation') } } satisfies FieldsRepository
const fieldLogRepository = {
  // With `server` set, reads return it, plus the unsent rows when `noSignal` (the offline copy lists them). `holdNext`
  // holds the next read until `releaseHeld()`, then answers with its reply. Otherwise the page's first read works. Every read after the save loses signal: it gets the pre-save copy, or an error with no copy.
  getData: async () => { reads += 1; if (holdNext) { const reply = holdNext; holdNext = null; await new Promise<void>((resolve) => { releaseHeld = resolve }); return { ...reply(), viewer: { user_id: user, role: 'owner' as const } } } if (server) return { entries: noSignal ? [...server, ...unsent] : server, viewer: { user_id: user, role: 'owner' as const }, ...(noSignal || cachedReads ? { cached: true as const } : {}) }; if (reads > 1 && afterSave === 'no copy') throw new Error('network down'); return { entries: [] as FieldLogEntry[], viewer: { user_id: user, role: 'owner' as const }, ...(reads > 1 ? { cached: true as const } : {}) } },
  saveEntry: async (draft: FieldLogEntryDraft) => { saves.push(draft); const entry = { ...draft, id: draft.id ?? uid(nextId++), farm_id: farm, created_by: user, created_at: stamp, updated_at: stamp, ...(noSignal ? { pending: true } : {}) } as FieldLogEntry; if (noSignal) unsent.push(entry); returned.push(entry); return entry },
  deleteEntry: async (id: string) => { deletes.push(id); return { id, deleted: true as const } },
} as unknown as FieldLogRepository
const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
const button = (text: string) => { const found = [...container.querySelectorAll('button')].find((item) => item.textContent === text) as HTMLButtonElement | undefined; assert(found, `Button ${text} did not render.`); return found }
const card = (name: string) => { const found = [...container.querySelectorAll('.field-log-card')].find((item) => item.querySelector('h2')?.textContent === name) as HTMLElement | undefined; assert(found, `The ${name} card did not render.`); return found }
async function click(element: HTMLElement) { await act(async () => { element.click(); await flush() }) }
const dialogButton = (text: string) => { const found = [...document.querySelectorAll('[role="dialog"] button')].find((item) => item.textContent === text) as HTMLButtonElement | undefined; assert(found, `Dialog button ${text} did not render.`); return found }
async function saveRainForBoth(amount = '0.75') {
  await click(button('Add rain to several fields'))
  await click(button('Pick all fields'))
  const form = container.querySelector('form.multi-rain-form') as HTMLFormElement
  assert(form, 'The several-fields rain form did not open.')
  ;(form.querySelector('input[name="rainfall"]') as HTMLInputElement).value = amount
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
  // Editing that entry while the reload still loses signal shows the edit, not the values the form first saved (Codex, PR #69).
  const south = card('Pine South 80'); const edit = [...south.querySelectorAll('button')].find((item) => item.textContent === 'Edit') as HTMLButtonElement | undefined
  assert(edit, 'A saved entry must offer Edit.')
  await click(edit)
  const editForm = south.querySelector('form.field-log-form') as HTMLFormElement
  assert(editForm, 'The edit form did not open.')
  ;(editForm.querySelector('input[name="rainfall"]') as HTMLInputElement).value = '1.25'
  ;(editForm.querySelector('textarea[name="note"]') as HTMLTextAreaElement).value = 'Corrected gauge'
  await act(async () => { editForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush(); await flush() })
  assert(saves.length === 3 && !!saves[2].id && saves[2].rainfall_in === 1.25, `The edit must be saved once with its new amount, got ${JSON.stringify(saves.at(-1))}.`)
  assert(timeline('Pine South 80').includes('1.25 in · Corrected gauge') && !timeline('Pine South 80').includes('0.75 in') && card('Pine South 80').querySelector('.rain-total')?.textContent?.includes('1.25 in'), `A confirmed edit must replace the entry shown from this form. South: ${timeline('Pine South 80')}`)
  // Once a reload with signal has that entry, the loaded copy owns it: when it is later deleted on another device, the
  // next reload drops it here too instead of the local list bringing it back (where an edit would recreate it).
  const addNote = async (text: string) => {
    await click([...card('Pine North 80').querySelectorAll('button')].find((item) => item.textContent === 'Add note') as HTMLButtonElement)
    const noteForm = card('Pine North 80').querySelector('form.field-log-form') as HTMLFormElement
    assert(noteForm, 'The note form did not open.')
    ;(noteForm.querySelector('textarea[name="note"]') as HTMLTextAreaElement).value = text
    await act(async () => { noteForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush(); await flush() })
  }
  server = [{ ...saves[2], id: saves[2].id!, farm_id: farm, created_by: user, created_at: stamp, updated_at: stamp } as FieldLogEntry]
  await addNote('Checked gauge')
  assert(timeline('Pine South 80').includes('1.25 in · Corrected gauge'), `A reload with signal must show the server copy. South: ${timeline('Pine South 80')}`)
  server = []
  await addNote('Checked again')
  assert(!timeline('Pine South 80').includes('1.25 in') && card('Pine South 80').querySelector('.rain-total')?.textContent?.includes('0.00 in'), `An entry deleted elsewhere must not come back from the local list. South: ${timeline('Pine South 80')}`)
  // Deleted on another device before this one ever had a reload with signal: the first such reload, which does not
  // have the entry, retires it here too (Codex, PR #69). Reloads from the copy on this device keep it until then.
  server = null; afterSave = 'stale copy'
  await saveRainForBoth('0.30')
  assert(timeline('Pine North 80').includes('0.30 in') && timeline('Pine South 80').includes('0.30 in'), `Rain saved before the copy on this device must show. South: ${timeline('Pine South 80')}`)
  await addNote('Still no signal')
  assert(timeline('Pine South 80').includes('0.30 in'), `A reload from the copy on this device must keep the saved rain. South: ${timeline('Pine South 80')}`)
  server = []
  await addNote('Signal, deleted elsewhere')
  for (const name of ['Pine North 80', 'Pine South 80']) assert(!timeline(name).includes('0.30 in'), `${name}: rain deleted elsewhere must go once a reload with signal does not have it. Timeline: ${timeline(name)}`)
  // A slow reload with signal that went out before the save does not have the new rain, so it must not release it.
  holdNext = () => ({ entries: server ?? [] })
  await addNote('Slow signal')
  cachedReads = true
  await saveRainForBoth('0.55')
  assert(timeline('Pine South 80').includes('0.55 in'), `Saved rain must show after a reload from this device. South: ${timeline('Pine South 80')}`)
  await act(async () => { releaseHeld(); await flush(); await flush() })
  for (const name of ['Pine North 80', 'Pine South 80']) assert(timeline(name).includes('0.55 in'), `${name}: a reload that went out before the save must not drop the saved rain. Timeline: ${timeline(name)}`)
  cachedReads = false
  await addNote('Signal back again')
  assert(!timeline('Pine South 80').includes('0.55 in'), `A reload with signal after the save owns the entry again. South: ${timeline('Pine South 80')}`)
  // Two reloads after the save finish out of order: the one with signal has the rain, then one that lost signal answers
  // later from an older copy without it. The rain must still show (Codex, PR #69).
  cachedReads = true
  await saveRainForBoth('0.65')
  const savedRain = returned.slice(-2)
  holdNext = () => ({ entries: [], cached: true })
  await addNote('Weak signal')
  cachedReads = false; server = savedRain
  await addNote('Strong signal')
  assert(timeline('Pine South 80').includes('0.65 in'), `The reload with signal must show the saved rain. South: ${timeline('Pine South 80')}`)
  await act(async () => { releaseHeld(); await flush(); await flush() })
  for (const name of ['Pine North 80', 'Pine South 80']) assert(timeline(name).includes('0.65 in'), `${name}: an older copy answering last must not hide rain the server has. Timeline: ${timeline(name)}`)
  server = []
  await addNote('Deleted elsewhere again')
  assert(!timeline('Pine South 80').includes('0.65 in'), `A reload with signal without the entry releases it. South: ${timeline('Pine South 80')}`)
  // Rain saved with no signal stays as not sent until the server has it, even though the offline copy right after the
  // save listed it: a later reload with signal, before the queue sends it, must not drop it from the card.
  noSignal = true
  await saveRainForBoth()
  assert(container.textContent?.includes('Kept on this device'), `The no-signal save must be kept on this device. ${container.textContent}`)
  noSignal = false
  await addNote('Signal back')
  for (const name of ['Pine North 80', 'Pine South 80']) assert(timeline(name).includes('0.75 in · Synthetic storm') && timeline(name).includes('Not sent yet'), `${name}: unsent rain must stay on the card until the server has it. Timeline: ${timeline(name)}`)
  // Once the server's answer has it, the sent rain loses "Not sent yet", and an older copy answering later still shows it.
  server = unsent.map((entry) => ({ ...entry, pending: undefined }))
  await addNote('Sent')
  holdNext = () => ({ entries: [], cached: true })
  await addNote('Old copy')
  await act(async () => { releaseHeld(); await flush(); await flush() })
  for (const name of ['Pine North 80', 'Pine South 80']) assert(timeline(name).includes('0.75 in · Synthetic storm') && !timeline(name).includes('Not sent yet'), `${name}: sent rain must show as saved, even after an older copy. Timeline: ${timeline(name)}`)
} finally { await act(async () => { root.unmount() }); container.remove(); win.close() }
console.log('Field Log several-fields rain regression passed')
