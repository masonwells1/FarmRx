import { Window } from 'happy-dom'
import React, { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { FieldLogPage } from './FieldLogModule'
import type { FieldLogRepository } from './data/fieldLog'
import type { FieldsData, FieldsRepository } from './data/fields'
import { appendNeedsAttention } from './data/needsAttentionStore'
import { fieldLogWriteQueueKey } from './data/fieldLogWriteQueue'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const win = new Window({ url: 'http://farmrx.test/field-log' })
Object.assign(globalThis, { React, window: win, document: win.document, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, MouseEvent: win.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator })
const user = '00000000-0000-4000-8000-000000000001'; const farm = '00000000-0000-4000-8000-000000000002'; const field = '00000000-0000-4000-8000-000000000003'; const otherField = '00000000-0000-4000-8000-000000000008'; const operation = '00000000-0000-4000-8000-000000000004'; const entry = '00000000-0000-4000-8000-000000000005'; const rainOperation = '00000000-0000-4000-8000-000000000006'; const rainEntry = '00000000-0000-4000-8000-000000000007'; const stamp = '2027-08-04T19:00:00.000Z'; const queueKey = fieldLogWriteQueueKey('pine-proof', user, farm)
const legacy = { version: 1 as const, module: 'fieldLog' as const, kind: 'saveEntry' as const, operationId: operation, userId: user, farmId: farm, enqueuedAt: stamp, draft: { id: entry, field_id: field, entry_type: 'note' as const, observed_on: '2027-08-04', rainfall_in: null, note: 'Synthetic legacy note' } }
appendNeedsAttention(win.localStorage, queueKey, { id: operation, module: 'fieldLog', createdAt: stamp, message: 'This saved Field Log change predates access custody tracking and cannot be sent automatically.', entry: legacy })
const legacyZeroRain = { ...legacy, operationId: rainOperation, draft: { id: rainEntry, field_id: otherField, entry_type: 'rainfall' as const, observed_on: '2027-08-05', rainfall_in: 0, note: null } }
appendNeedsAttention(win.localStorage, queueKey, { id: rainOperation, module: 'fieldLog', createdAt: stamp, message: 'This saved Field Log change predates access custody tracking and cannot be sent automatically.', entry: legacyZeroRain })
const fieldsData = { farm: { id: farm }, entities: [], fields: [{ id: field, farm_id: farm, name: 'Pine North 60', total_acres: 60, is_active: true, latitude: null, longitude: null }, { id: otherField, farm_id: farm, name: 'Pine South 40', total_acres: 40, is_active: true, latitude: null, longitude: null }], crop_assignments: [], arrangements: [], commodities: [] } as unknown as FieldsData
let mutationCalls = 0
const fieldsRepository = { getData: async () => fieldsData, saveField: async () => { mutationCalls += 1; throw new Error('unexpected field mutation') } } satisfies FieldsRepository
const fieldLogRepository = { getData: async () => ({ entries: [], viewer: { user_id: user, role: 'worker' as const } }), getNeedsAttentionQueueKey: async () => queueKey, saveEntry: async () => { mutationCalls += 1; throw new Error('unexpected Field Log save') }, deleteEntry: async () => { mutationCalls += 1; throw new Error('unexpected Field Log delete') } } satisfies FieldLogRepository
const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
try {
  await act(async () => { root.render(createElement(FieldLogPage, { fieldLogRepository, fieldsRepository })); await new Promise((resolve) => setTimeout(resolve, 0)) })
  const text = container.textContent ?? ''
  for (const expected of ['Saved changes that need attention', 'Field log entry', '2027-08-04 · Synthetic legacy note', '2027-08-05 · 0 in', 'cannot be sent automatically', 'Re-enter this change manually if needed, then dismiss it.', 'Review only', 'Dismiss']) assert(text.includes(expected), `Missing legacy recovery detail: ${expected}`)
  const recoveryRows = [...container.querySelectorAll('[aria-label="Saves that need attention"] article')].map((row) => row.textContent ?? '')
  assert(recoveryRows.some((row) => row.includes('2027-08-04 · Synthetic legacy note') && row.includes('Pine North 60') && !row.includes('Pine South 40')), 'Legacy note recovery did not show its own field name.')
  assert(recoveryRows.some((row) => row.includes('2027-08-05 · 0 in') && row.includes('Pine South 40') && !row.includes('Pine North 60')), 'Legacy zero-rain recovery did not show its own field name.')
  assert(!text.includes('Update needed') && !text.includes('Reload the app after the update.'), 'Legacy Field Log recovery showed misleading update/reload guidance.')
  const recovery = container.querySelector('[aria-label="Saves that need attention"]')
  assert(!text.includes('Retry') && !recovery?.querySelector('button.secondary-action'), 'Legacy Field Log custody exposed an automatic retry path.')
  assert(mutationCalls === 0, 'Rendering legacy Field Log recovery invoked a mutation.')
} finally { await act(async () => { root.unmount() }); container.remove(); win.close() }
console.log('Field Log legacy recovery render regression passed')
