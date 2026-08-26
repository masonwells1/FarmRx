import { Window } from 'happy-dom'
import React, { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { SprayForm } from '../InventoryModule'
import type { ApplicationSaveDisposition, InventoryRepository, InventoryWorkspace } from './inventory'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const win = new Window({ url: 'http://farmrx.test/inventory' })
Object.assign(globalThis, { React, window: win, document: win.document, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, MouseEvent: win.MouseEvent, FormData: win.FormData, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator })

const workspace = {
  fields: { farm: { id: 'farm-cedar' }, fields: [{ id: 'field-cedar', farm_id: 'farm-cedar', name: 'Cedar South' }], crop_assignments: [{ id: 'crop-cedar', farm_id: 'farm-cedar', field_id: 'field-cedar', commodity_id: 'corn', planted_acres: 40 }], commodities: [{ id: 'corn', name: 'Corn' }], entities: [], arrangements: [] },
  products: [{ id: 'product-cedar', farm_id: 'farm-cedar', product_kind: 'chemical', name: 'Atrazine', inventory_unit: 'gal', is_restricted_use: false }], receipts: [], receipt_lines: [], adjustments: [], applications: [], application_products: [], on_hand: [], rup_completeness: [], program_application_products: [],
} as unknown as InventoryWorkspace

function fill(form: HTMLFormElement) {
  const field = form.querySelector<HTMLSelectElement>('select[name="field"]')!; field.value = 'field-cedar'; field.dispatchEvent(new Event('change', { bubbles: true }))
  const crop = form.querySelector<HTMLSelectElement>('select[name="crop"]')!; crop.value = 'crop-cedar'; crop.dispatchEvent(new Event('change', { bubbles: true }))
  form.querySelector<HTMLInputElement>('input[name="acres"]')!.value = '40'
  const productInputs = form.querySelectorAll<HTMLInputElement>('.spray-product-row input[type="number"]')
  productInputs[0]!.value = '0.125'; productInputs[0]!.dispatchEvent(new Event('input', { bubbles: true }))
  productInputs[1]!.value = '5'; productInputs[1]!.dispatchEvent(new Event('input', { bubbles: true }))
}

async function renderCase(kind: ApplicationSaveDisposition['kind'] | 'reject') {
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container); const saves: unknown[] = []; const notices: string[] = []; const failures: unknown[] = []
  const repository = { async saveApplication(input: { id: string }) { saves.push(input); if (kind === 'reject') throw new Error('lost canonical response'); return kind === 'confirmed' ? { kind, applicationId: input.id } : { kind, applicationId: input.id, operationId: `operation-${saves.length}` } } } as unknown as InventoryRepository
  await act(async () => { root.render(createElement(SprayForm, { workspace, assignments: workspace.fields.crop_assignments, repository, done: (notice: string) => notices.push(notice), failed: (error: unknown) => failures.push(error) })); await Promise.resolve() })
  const form = container.querySelector('form')! as HTMLFormElement
  assert(form.querySelector<HTMLSelectElement>('.spray-product-row select')!.value === 'product-cedar', 'The existing blank manual-spray path must preserve its first-product default.')
  await act(async () => { fill(form); await Promise.resolve(); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() })
  return { container, root, saves, notices, failures }
}

try {
  const confirmed = await renderCase('confirmed')
  assert(confirmed.saves.length === 1 && confirmed.notices[0]?.startsWith('Spray record confirmed on Farm Rx.') && confirmed.container.textContent?.includes('Saved'), 'A confirmed save must show confirmed wording and the existing Saved receipt.')
  const confirmedForm = confirmed.container.querySelector('form') as HTMLFormElement
  assert(confirmedForm.querySelector<HTMLSelectElement>('select[name="field"]')!.value === '' && !confirmedForm.checkValidity(), 'A confirmed spray must retire the submitted form instead of leaving a valid duplicate ready to submit.')
  confirmedForm.querySelector<HTMLButtonElement>('button[type="submit"]')!.click()
  assert(confirmed.saves.length === 1, 'A post-success click must not create a second spray from the retired form.')
  await act(async () => { confirmed.root.unmount() }); confirmed.container.remove()

  const rapidContainer = document.createElement('div'); document.body.append(rapidContainer); const rapidRoot = createRoot(rapidContainer); const rapidSaves: unknown[] = []; let releaseRapid!: (result: ApplicationSaveDisposition) => void
  const rapidResult = new Promise<ApplicationSaveDisposition>((resolve) => { releaseRapid = resolve })
  const rapidRepository = { async saveApplication(input: { id: string }) { rapidSaves.push(input); return rapidResult } } as unknown as InventoryRepository
  await act(async () => { rapidRoot.render(createElement(SprayForm, { workspace, assignments: workspace.fields.crop_assignments, repository: rapidRepository, done: () => undefined, failed: () => undefined })); await Promise.resolve() })
  const rapidForm = rapidContainer.querySelector('form') as HTMLFormElement
  await act(async () => { fill(rapidForm); await Promise.resolve(); rapidForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); rapidForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() })
  assert(rapidSaves.length === 1, 'The submit lock must fence two rapid clicks into one spray operation.')
  const rapidId = (rapidSaves[0] as { id: string }).id; releaseRapid({ kind: 'confirmed', applicationId: rapidId })
  await act(async () => { await Promise.resolve() }); await act(async () => { rapidRoot.unmount() }); rapidContainer.remove()

  const queued = await renderCase('queued')
  assert(queued.saves.length === 1 && queued.notices[0]?.includes('not confirmed on Farm Rx yet') && queued.container.textContent?.includes('Queued offline'), 'A safely queued spray must never use confirmed-save wording and must retain the queued receipt.')
  await act(async () => { queued.root.unmount() }); queued.container.remove()

  const attention = await renderCase('needs-attention')
  const attentionForm = attention.container.querySelector('form') as HTMLFormElement
  const attentionText = attention.container.textContent ?? ''
  assert(attention.saves.length === 1 && attention.failures.length === 1 && attentionText.includes('may already be recorded') && !attentionText.includes('this save was not applied') && attentionForm.querySelector<HTMLSelectElement>('select[name="field"]')!.value === 'field-cedar' && attentionForm.querySelector<HTMLInputElement>('input[name="acres"]')!.value === '40', 'A returned needs-attention outcome must say may already be recorded, suppress the false not-applied receipt, and preserve farmer values.')
  await act(async () => { attention.root.unmount() }); attention.container.remove()

  const unknown = await renderCase('reject')
  const unknownForm = unknown.container.querySelector('form') as HTMLFormElement; const unknownText = unknown.container.textContent ?? ''
  assert(unknown.saves.length === 1 && unknown.failures.length === 1 && unknownText.includes('may already be recorded') && !unknownText.includes('this save was not applied') && unknownForm.querySelector<HTMLSelectElement>('select[name="field"]')!.value === 'field-cedar' && unknownForm.querySelector<HTMLInputElement>('input[name="acres"]')!.value === '40', 'A rejected unknown spray outcome must use the same truthful may-already-be-recorded wording and preserve farmer values.')
  await act(async () => { unknown.root.unmount() }); unknown.container.remove()
} finally { win.close() }

console.log('Inventory spray save receipt regression passed')
