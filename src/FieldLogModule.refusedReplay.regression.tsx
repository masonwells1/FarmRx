import { Window } from 'happy-dom'
import React, { createElement } from 'react'
import { act } from 'react'
import { MemoryRouter } from 'react-router'
import { createRoot } from 'react-dom/client'
import { FieldLogPage } from './FieldLogModule'
import { ConfirmDialogHost } from './components/ConfirmDialog'
import type { FieldLogEntryDraft } from './data/fieldLog'
import type { FieldLogDataGateway } from './data/FieldLogDataGateway'
import type { FieldsData, FieldsRepository } from './data/fields'
import { QueuedFieldLogRepository } from './data/QueuedFieldLogRepository'
import { SupabaseFieldLogRepository } from './data/SupabaseFieldLogRepository'
import { fieldLogWriteQueueKey, FieldLogWriteQueue } from './data/fieldLogWriteQueue'
import { readNeedsAttention } from './data/needsAttentionStore'
import { resetFarmGrantFromLive } from './data/farmRevocationFence'

// A rain total kept on the device that the server refuses when it is finally sent (PR #69, "Not changed") must show in
// Needs attention with its field, amount and reason, must not show in the field's timeline as if it were saved or still
// on its way, and must not hold up the rain behind it. Retry sends the same change again once the server will take it.
// The page runs on the real queued repository and queue; only the server is a fake. Offline reloads answer from a saved
// copy with the waiting saves laid over it, so the refused rain is also in the page's loaded rows (Codex, PR #71).

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const win = new Window({ url: 'http://farmrx.test/field-log' })
Object.assign(globalThis, { React, window: win, document: win.document, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, MouseEvent: win.MouseEvent, FormData: win.FormData, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator })
const flush = async () => { await Promise.resolve(); await new Promise<void>((resolve) => setTimeout(resolve, 0)) }
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const user = uid(1); const farm = uid(2); const north = uid(3); const south = uid(4); const stamp = '2027-08-04T12:00:00.000Z'
const field = (id: string, name: string) => ({ id, farm_id: farm, name, total_acres: 80, is_active: true, latitude: null, longitude: null })
const fieldsData = { farm: { id: farm }, entities: [], fields: [field(north, 'Pine North 80'), field(south, 'Pine South 80')], crop_assignments: [], arrangements: [], commodities: [] } as unknown as FieldsData
const fieldsRepository = { getData: async () => fieldsData, saveField: async () => { throw new Error('unexpected field mutation') } } satisfies FieldsRepository

let refuseNorth = true; let refuseDelete = false; let offline = true; let nextId = 100
const server: Array<Record<string, unknown>> = []; const sent: string[] = []
const gateway: FieldLogDataGateway = {
  loadEntries: async () => { if (offline) throw new TypeError('Failed to fetch'); return structuredClone(server) },
  loadViewerRole: async () => { if (offline) throw new TypeError('Failed to fetch'); return { role: 'worker' } },
  saveEntry: async (input: { farmId: string; operationId: string; entry: FieldLogEntryDraft }) => {
    if (offline) throw new TypeError('Failed to fetch')
    sent.push(input.entry.field_id)
    if (refuseNorth && input.entry.field_id === north) throw Object.assign(new Error('observed date cannot be more than one day in the future'), { code: 'P0001', details: null, hint: null })
    const row = { ...input.entry, farm_id: input.farmId, created_by: user, created_at: stamp, updated_at: stamp }; const index = server.findIndex((item) => item.id === row.id); if (index >= 0) server[index] = row; else server.push(row); return structuredClone(row)
  },
  deleteEntry: async (input: { farmId: string; entryId: string }) => {
    if (offline) throw new TypeError('Failed to fetch')
    if (refuseDelete) throw Object.assign(new Error('field log entry could not be removed'), { code: 'P0001', details: null, hint: null })
    const index = server.findIndex((row) => row.id === input.entryId); if (index >= 0) server.splice(index, 1); return { id: input.entryId, deleted: true }
  },
}
const context = { projectRef: 'refused-replay-page', userId: user, farmId: farm, generation: 1, token: uid(900), serverEpoch: 1 }
const live = new SupabaseFieldLogRepository({ gateway, getFarmId: async () => farm, getUserId: async () => user, getOperationContext: async () => context, verifyOperationContext: async () => undefined, createId: () => uid(nextId++) })
const repository = new QueuedFieldLogRepository(live, { getContext: async () => ({ userId: user, farmId: farm }), projectRef: context.projectRef, storage: win.localStorage, createId: () => uid(nextId++), clock: () => stamp, isOffline: () => offline, readWorkspaceCache: async <T,>() => ({ data: { entries: structuredClone(server), viewer: { user_id: user, role: 'worker' } } as T, cachedAt: stamp }), writeWorkspaceCacheInOrder: async () => true })
const queueKey = fieldLogWriteQueueKey(context.projectRef, user, farm)
resetFarmGrantFromLive(win.localStorage, { projectRef: context.projectRef, userId: user, farmId: farm }, 1, stamp)

const container = document.createElement('div'); document.body.append(container); let root = createRoot(container)
const render = async () => { await act(async () => { root.render(createElement(MemoryRouter, null, createElement(FieldLogPage, { fieldLogRepository: repository, fieldsRepository }), createElement(ConfirmDialogHost))); await flush(); await flush() }) }
const remount = async () => { await act(async () => { root.unmount() }); root = createRoot(container); await render() }
const buttonIn = (scope: ParentNode, text: string) => { const found = [...scope.querySelectorAll('button')].find((item) => item.textContent === text) as HTMLButtonElement | undefined; assert(found, `Button ${text} did not render.`); return found }
const card = (name: string) => { const found = [...container.querySelectorAll('article.field-log-card')].find((item) => item.querySelector('h2')?.textContent === name) as HTMLElement | undefined; assert(found, `Card ${name} did not render.`); return found }
const dialogButton = (text: string) => { const found = [...document.querySelectorAll('[role="dialog"] button')].find((item) => item.textContent === text) as HTMLButtonElement | undefined; assert(found, `Dialog button ${text} did not render.`); return found }
const timeline = (name: string) => card(name).querySelector('.field-log-timeline')?.textContent ?? ''
const attention = () => container.querySelector('[aria-label="Saves that need attention"]')?.textContent ?? ''
/** Waits, a tick at a time, until the page has settled into what the step expects (the queue lock can take several ticks). */
async function until(done: () => boolean, label: string) { for (let tries = 0; !done(); tries += 1) { if (tries > 200) throw new Error(`The page never reached: ${label}. Shown: ${container.textContent}`); await act(async () => { await new Promise<void>((resolve) => setTimeout(resolve, 5)) }) } }
async function click(element: HTMLElement) { await act(async () => { element.click(); await flush(); await flush() }) }

try {
  // The page first opens online with nothing saved, then the signal drops before the rain is entered.
  offline = false; await render(); offline = true
  await click(buttonIn(container, 'Add rain to several fields'))
  await click(buttonIn(container, 'Pick all fields'))
  const form = container.querySelector('form.multi-rain-form') as HTMLFormElement; assert(form, 'The several-fields rain form did not open.')
  ;(form.querySelector('input[name="rainfall"]') as HTMLInputElement).value = '1.25'
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush(); await flush() })
  await until(() => !container.textContent?.includes('Saving…'), 'the several-fields save finished')
assert(timeline('Pine North 80').includes('Not sent yet') && timeline('Pine South 80').includes('Not sent yet'), 'Both rain totals must first show as kept on this device.')
  assert(new FieldLogWriteQueue(win.localStorage, queueKey).read().entries.length === 2, 'Both rain totals must wait in the queue.')

  // Signal returns. The server refuses North's rain; South's, behind it, still goes through.
  offline = false; await act(async () => { await repository.inspectAndReplay(); await flush() })
  assert(sent.join() === [north, south].join() && server.length === 1 && server[0]?.field_id === south, `South's rain must be sent after North's is refused. Sent: ${sent.join()}`)
  assert(new FieldLogWriteQueue(win.localStorage, queueKey).read().entries.length === 0 && readNeedsAttention(win.localStorage, queueKey).length === 1, 'The refused rain must leave the queue for Needs attention.')
  const shown = attention()
  for (const expected of ['Changes that need attention', 'Field log entry', 'Pine North 80', '· 1.25 in', 'Not saved: the observed date cannot be more than one day in the future.', 'Retry sends the same saved change again.', 'Retry', 'Dismiss']) assert(shown.includes(expected), `Needs attention is missing "${expected}". Shown: ${shown}`)
  assert(!shown.includes('Pine South 80'), 'Only the refused rain belongs in Needs attention.')
  assert(!timeline('Pine North 80').includes('1.25') && !timeline('Pine North 80').includes('Not sent yet'), `North's timeline must not show the refused rain as saved or on its way. Shown: ${timeline('Pine North 80')}`)

  // Coming back to the page later: South shows the server's copy, North still only in Needs attention.
  await remount(); await until(() => timeline('Pine South 80').includes('1.25 in'), 'South shows its saved rain')
  assert(timeline('Pine South 80').includes('1.25 in') && !timeline('Pine South 80').includes('Not sent yet'), `South must show its saved rain. Shown: ${timeline('Pine South 80')}`)
  assert(!timeline('Pine North 80').includes('1.25') && attention().includes('Pine North 80'), 'After a reload North\'s refused rain must still be only in Needs attention.')

  // Retry while the server still refuses: it lands back in Needs attention and nothing shows as saved.
  await click(buttonIn(container.querySelector('[aria-label="Saves that need attention"]')!, 'Retry'))
  await until(() => sent.length === 3 && !attention().includes('Retrying…'), 'the refused retry finished')
  assert(readNeedsAttention(win.localStorage, queueKey).length === 1 && attention().includes('Pine North 80') && !timeline('Pine North 80').includes('1.25'), 'A retry refused again must stay in Needs attention.')

  // Once the server takes it, Retry saves it and Needs attention clears.
  refuseNorth = false
  await click(buttonIn(container.querySelector('[aria-label="Saves that need attention"]')!, 'Retry'))
  // While the retried rain is back on the queue and on its way, a reload may show it as not sent yet (PR #72); wait for it to settle.
  await until(() => timeline('Pine North 80').includes('1.25 in') && !timeline('Pine North 80').includes('Not sent yet'), 'North shows its retried rain as saved')
  assert(readNeedsAttention(win.localStorage, queueKey).length === 0 && !container.querySelector('[aria-label="Saves that need attention"]'), 'An accepted retry must clear Needs attention.')
  assert(timeline('Pine North 80').includes('1.25 in') && !timeline('Pine North 80').includes('Not sent yet') && server.some((row) => row.field_id === north), `North must show its saved rain after the retry. Shown: ${timeline('Pine North 80')}`)

  // A delete kept on the device that the server refuses puts the rain back on the timeline, and it stays there once the
  // farmer dismisses the refused delete: the server still has it (Codex, PR #71).
  offline = true; refuseDelete = true
  const northRow = [...card('Pine North 80').querySelectorAll('.field-log-row')].find((item) => item.textContent?.includes('1.25 in')) as HTMLElement | undefined; assert(northRow, 'North\'s saved rain row did not render.')
  await click(buttonIn(northRow, 'Delete')); await click(dialogButton('Delete entry'))
  await until(() => !timeline('Pine North 80').includes('1.25'), 'the kept delete hides the row')
  offline = false; await act(async () => { await repository.inspectAndReplay(); await flush() })
  await until(() => attention().includes('Field log entry removal'), 'the refused delete is in Needs attention')
  await until(() => timeline('Pine North 80').includes('1.25 in'), 'the refused delete shows the rain again')
  assert(!card('Pine North 80').textContent?.includes('Deleted on this device'), 'Once the delete is refused the card must not still promise it will finish syncing.')
  await click(buttonIn(container.querySelector('[aria-label="Saves that need attention"]')!, 'Dismiss')); await click(buttonIn(container.querySelector('[aria-label="Saves that need attention"]')!, 'Yes, dismiss'))
  await until(() => !container.querySelector('[aria-label="Saves that need attention"]'), 'the dismissed delete leaves Needs attention')
  assert(timeline('Pine North 80').includes('1.25 in') && server.some((row) => row.field_id === north), `After dismissing the refused delete the rain must still show, as the server has it. Shown: ${timeline('Pine North 80')}`)

  // Another tab sends the queue and parks a refused save: this page hears it through the storage event and moves the rain
  // from the timeline to Needs attention without a reload (Codex, PR #71).
  offline = true
  await click(buttonIn(card('Pine South 80'), 'Add rain'))
  const southForm = card('Pine South 80').querySelector('form.field-log-form') as HTMLFormElement; assert(southForm, 'South\'s rain form did not open.')
  ;(southForm.querySelector('input[name="rainfall"]') as HTMLInputElement).value = '2.5'
  await act(async () => { southForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush(); await flush() })
  await until(() => timeline('Pine South 80').includes('2.50 in') && timeline('Pine South 80').includes('Not sent yet'), 'South\'s second rain is kept on this device')
  const waitingSouth = new FieldLogWriteQueue(win.localStorage, queueKey).read().entries[0]; assert(waitingSouth, 'South\'s second rain must wait in the queue.')
  win.localStorage.setItem(`${queueKey}:needs-attention`, JSON.stringify({ version: 1, records: [{ id: waitingSouth.operationId, module: 'fieldLog', createdAt: waitingSouth.enqueuedAt, message: 'This save needs attention before it can be retried.', entry: waitingSouth }] }))
  win.localStorage.setItem(queueKey, JSON.stringify({ version: 1, entries: [] }))
  await act(async () => { win.dispatchEvent(new win.StorageEvent('storage', { key: `${queueKey}:needs-attention` })); await flush() })
  await until(() => attention().includes('Pine South 80'), 'the other tab\'s refused rain shows in Needs attention')
  assert(!timeline('Pine South 80').includes('2.50') && !timeline('Pine South 80').includes('Not sent yet'), `South's timeline must drop the rain another tab parked. Shown: ${timeline('Pine South 80')}`)

  // An offline edit of saved rain, shown after an offline reload in place of the server's copy, that another tab parks:
  // the page shows the server's copy again rather than losing the entry (Codex, PR #71).
  const savedNorth = [...card('Pine North 80').querySelectorAll('.field-log-row')].find((item) => item.textContent?.includes('1.25 in')) as HTMLElement | undefined; assert(savedNorth, 'North\'s saved rain row did not render before the edit.')
  await click(buttonIn(savedNorth, 'Edit'))
  const editForm = card('Pine North 80').querySelector('form.field-log-form') as HTMLFormElement; assert(editForm, 'North\'s edit form did not open.')
  ;(editForm.querySelector('input[name="rainfall"]') as HTMLInputElement).value = '3'
  await act(async () => { editForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush(); await flush() })
  await until(() => timeline('Pine North 80').includes('3.00 in') && timeline('Pine North 80').includes('Not sent yet'), 'the offline edit is kept on this device')
  await remount(); await until(() => timeline('Pine North 80').includes('3.00 in') && timeline('Pine North 80').includes('Not sent yet'), 'the offline reload shows the waiting edit in place of the server copy')
  const waitingEdit = new FieldLogWriteQueue(win.localStorage, queueKey).read().entries[0]; assert(waitingEdit?.kind === 'saveEntry' && waitingEdit.draft.rainfall_in === 3, 'North\'s edit must wait in the queue.')
  const parkedBefore = JSON.parse(win.localStorage.getItem(`${queueKey}:needs-attention`) ?? '{"version":1,"records":[]}') as { version: 1; records: unknown[] }
  win.localStorage.setItem(`${queueKey}:needs-attention`, JSON.stringify({ version: 1, records: [...parkedBefore.records, { id: waitingEdit.operationId, module: 'fieldLog', createdAt: waitingEdit.enqueuedAt, message: 'This save needs attention before it can be retried.', entry: waitingEdit }] }))
  win.localStorage.setItem(queueKey, JSON.stringify({ version: 1, entries: [] }))
  await act(async () => { win.dispatchEvent(new win.StorageEvent('storage', { key: `${queueKey}:needs-attention` })); await flush() })
  await until(() => timeline('Pine North 80').includes('1.25 in'), 'North shows the server\'s copy again after its edit is parked')
  assert(!timeline('Pine North 80').includes('3.00') && !timeline('Pine North 80').includes('Not sent yet') && attention().includes('3 in'), `The parked edit must show only in Needs attention. Timeline: ${timeline('Pine North 80')}`)

  // Where a parked change meets a live answer that lays waiting writes over the server's rows (PR #72): the farmer edits the
  // same entry again without signal, so a later write for it waits while the refused edit sits in Needs attention. Opened
  // afresh once reads work again, the live answer shows that waiting edit in place of the server's row; it must show as not
  // sent yet rather than the entry vanishing. Once it is sent, the server's copy shows and the parked edit stays parked.
  const parkedNorth = [...card('Pine North 80').querySelectorAll('.field-log-row')].find((item) => item.textContent?.includes('1.25 in')) as HTMLElement | undefined; assert(parkedNorth, 'North\'s saved rain row did not render before the second edit.')
  await click(buttonIn(parkedNorth, 'Edit'))
  const secondEdit = card('Pine North 80').querySelector('form.field-log-form') as HTMLFormElement; assert(secondEdit, 'North\'s second edit form did not open.')
  ;(secondEdit.querySelector('input[name="rainfall"]') as HTMLInputElement).value = '4'
  await act(async () => { secondEdit.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush(); await flush() })
  await until(() => timeline('Pine North 80').includes('4.00 in') && timeline('Pine North 80').includes('Not sent yet'), 'the second edit is kept on this device')
  assert(new FieldLogWriteQueue(win.localStorage, queueKey).read().entries.length === 1 && attention().includes('3 in'), 'The second edit must wait while the first stays in Needs attention.')
  offline = false; await remount()
  await until(() => timeline('Pine North 80').includes('4.00 in'), 'the live answer shows the waiting second edit')
  assert(timeline('Pine North 80').includes('Not sent yet') && !timeline('Pine North 80').includes('1.25') && attention().includes('3 in'), `A waiting edit of an entry with a parked edit must show as not sent yet. Timeline: ${timeline('Pine North 80')}`)
  await act(async () => { await repository.inspectAndReplay(); await flush() })
  await remount(); await until(() => timeline('Pine North 80').includes('4.00 in') && !timeline('Pine North 80').includes('Not sent yet'), 'the sent second edit shows the server\'s copy')
  assert(server.some((row) => row.field_id === north && row.rainfall_in === 4) && attention().includes('3 in'), 'The second edit must reach the server while the refused one stays in Needs attention.')
} finally { await act(async () => { root.unmount() }); container.remove(); win.close() }
console.log('Field Log refused replay page regression passed (parked, later save sent, honest timeline, retry, dismissed delete, other tab, parked edit, waiting edit beside a parked one)')
