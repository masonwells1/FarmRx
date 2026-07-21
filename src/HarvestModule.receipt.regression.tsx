import { Window } from 'happy-dom'
import React, { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { HarvestPage } from './HarvestModule'
import type { CropAssignment, FieldsData } from './data/fields'
import type { HarvestData, HarvestDraft, HarvestRecord, HarvestRepository } from './data/harvest'
import { setSaveReceipt } from './lib/saveReceipt'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const farmId = '00000000-0000-4000-8000-000000000001'
const cropId = '00000000-0000-4000-8000-000000000002'
const unrelatedCropId = '00000000-0000-4000-8000-000000000003'
const fieldId = '00000000-0000-4000-8000-000000000004'
const commodityId = '00000000-0000-4000-8000-000000000005'
const stamp = '2026-07-12T12:30:00.123456+00:00'
const win = new Window({ url: 'http://farmrx.test/harvest' })
Object.assign(globalThis, { React, window: win, document: win.document, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, MouseEvent: win.MouseEvent, FormData: win.FormData, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator })
const flush = async () => { await Promise.resolve(); await new Promise<void>((resolve) => setTimeout(resolve, 0)) }

function crop(id: string, overrides: Partial<CropAssignment> = {}): CropAssignment {
  return { id, farm_id: farmId, field_id: fieldId, crop_year: 2026, commodity_id: commodityId, planting_sequence: 1, planted_acres: 10, variety: null, planting_date: '2026-04-20', harvest_date: null, harvested_bushels: null, expected_yield_per_acre: 120, expected_price_per_bu: 4.25, actual_price_per_bu: null, notes: null, created_at: stamp, updated_at: stamp, ...overrides }
}
function data(assignments: CropAssignment[]): HarvestData {
  const fieldsData: FieldsData = { farm: { id: farmId, name: 'Receipt Farm', share_with_rep: false, created_by: farmId, created_at: stamp, updated_at: stamp }, entities: [], fields: [{ id: fieldId, farm_id: farmId, operating_entity_id: farmId, name: 'North 40', legal_description: null, county: null, state: null, total_acres: 10, fsa_farm_number: null, fsa_tract_number: null, soil_productivity_index: null, latitude: null, longitude: null, location_source: null, is_active: true, created_at: stamp, updated_at: stamp }], crop_assignments: assignments, arrangements: [], commodities: [{ id: commodityId, name: 'Corn', crop_family: 'corn', traits: {}, is_active: true, created_at: stamp, updated_at: stamp }] }
  return { fieldsData, viewer: { user_id: farmId, role: 'owner' } }
}
function record(value: HarvestDraft): HarvestRecord { return { ...value, id: value.crop_assignment_id, farm_id: farmId, updated_at: stamp } }

let current = data([crop(cropId), crop(unrelatedCropId, { planting_sequence: 2, harvested_bushels: 777, harvest_date: '2026-07-10', actual_price_per_bu: 4.5 })])
const relatedBefore = structuredClone(current.fieldsData.crop_assignments.find((item) => item.id === cropId)!)
const unrelatedBefore = structuredClone(current.fieldsData.crop_assignments.find((item) => item.id === unrelatedCropId)!)
let saves = 0; let release!: () => void; let began!: () => void
const gate = new Promise<void>((resolve) => { release = resolve }); const beganSaving = new Promise<void>((resolve) => { began = resolve })
const repository: HarvestRepository = {
  getData: async () => structuredClone(current),
  saveHarvest: async (value) => { saves += 1; setSaveReceipt(value.crop_assignment_id, 'saving'); began(); await gate; current = data(current.fieldsData.crop_assignments.map((item) => item.id === value.crop_assignment_id ? { ...item, harvested_bushels: value.harvested_bushels, harvest_date: value.harvest_date, actual_price_per_bu: value.actual_price_per_bu, updated_at: stamp } : item)); setSaveReceipt(value.crop_assignment_id, 'saved'); return record(value) },
}

const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
let initialUnmounted = false
let errorContainer: HTMLDivElement | null = null; let errorRoot: ReturnType<typeof createRoot> | null = null
try {
  await act(async () => { root.render(createElement(HarvestPage, { harvestRepository: repository })); await flush() })
  const enter = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Enter harvest')
  assert(enter, 'Harvest did not render its Enter harvest action.')
  await act(async () => { enter.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
  const form = container.querySelector('form.harvest-form') as HTMLFormElement | null
  assert(form, 'Harvest did not render its editable harvest form.')
  ;(form.elements.namedItem('bushels') as HTMLInputElement).value = '1300'
  ;(form.elements.namedItem('harvestDate') as HTMLInputElement).value = '2026-07-11'
  ;(form.elements.namedItem('actualPrice') as HTMLInputElement).value = '5'
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() })
  await beganSaving
  assert(container.textContent?.includes('Saving…') && saves === 1, 'Harvest must select its crop receipt before the delayed save resolves.')
  await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve() })
  assert(saves === 1, 'A rapid second harvest submit must not start a second save.')
  release()
  await act(async () => { await flush(); await flush() })
  assert(container.textContent?.includes('Saved') && container.textContent?.includes('130 bu/ac') && container.textContent?.includes('$6,500.00 (actual price)'), 'Harvest must retain Saved while rendering the derived yield and revenue from the returned record.')
  assert(!container.querySelector('form.harvest-form'), 'A successful harvest save must close its harvest form.')
  const related = current.fieldsData.crop_assignments.find((item) => item.id === cropId)!; const unrelated = current.fieldsData.crop_assignments.find((item) => item.id === unrelatedCropId)!
  assert(related.harvested_bushels === 1300 && related.harvest_date === '2026-07-11' && related.actual_price_per_bu === 5 && related.id === relatedBefore.id && related.farm_id === relatedBefore.farm_id && related.field_id === relatedBefore.field_id && related.crop_year === relatedBefore.crop_year && related.commodity_id === relatedBefore.commodity_id && related.planting_sequence === relatedBefore.planting_sequence && related.planted_acres === relatedBefore.planted_acres && related.variety === relatedBefore.variety && related.planting_date === relatedBefore.planting_date && related.expected_yield_per_acre === relatedBefore.expected_yield_per_acre && related.expected_price_per_bu === relatedBefore.expected_price_per_bu && related.notes === relatedBefore.notes && related.created_at === relatedBefore.created_at, 'Saving harvest may change only the three actual harvest fields and its returned version; crop identity, year, acres, commodity, and expected plan must remain unchanged.')
  assert(JSON.stringify(unrelated) === JSON.stringify(unrelatedBefore), 'Saving one harvest must leave every unrelated crop field unchanged.')

  await act(async () => { root.unmount() }); initialUnmounted = true; container.remove()
  errorContainer = document.createElement('div'); document.body.append(errorContainer); errorRoot = createRoot(errorContainer)
  const failingRepository: HarvestRepository = { getData: async () => data([crop(cropId)]), saveHarvest: async (value) => { setSaveReceipt(value.crop_assignment_id, 'needs attention'); throw new Error('terminal harvest validation failure') } }
  await act(async () => { errorRoot!.render(createElement(HarvestPage, { harvestRepository: failingRepository })); await flush() })
  const errorEnter = [...errorContainer.querySelectorAll('button')].find((button) => button.textContent === 'Enter harvest')
  assert(errorEnter, 'The error harness did not render Enter harvest.')
  await act(async () => { errorEnter.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() })
  const errorForm = errorContainer.querySelector('form.harvest-form') as HTMLFormElement | null
  assert(errorForm, 'The error harness did not render its form.')
  ;(errorForm.elements.namedItem('bushels') as HTMLInputElement).value = '1300'
  ;(errorForm.elements.namedItem('harvestDate') as HTMLInputElement).value = '2026-07-11'
  ;(errorForm.elements.namedItem('actualPrice') as HTMLInputElement).value = '5'
  await act(async () => { errorForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() })
  const retainedErrorForm = errorContainer.querySelector('form.harvest-form') as HTMLFormElement | null
  assert(retainedErrorForm === errorForm && (retainedErrorForm.elements.namedItem('bushels') as HTMLInputElement).value === '1300' && (retainedErrorForm.elements.namedItem('harvestDate') as HTMLInputElement).value === '2026-07-11' && (retainedErrorForm.elements.namedItem('actualPrice') as HTMLInputElement).value === '5' && errorContainer.querySelector('.form-error') && errorContainer.textContent?.includes('Needs attention'), 'A terminal error must retain the same harvest form, all entered values, the farmer-safe error, and Needs attention.')
} finally {
  await act(async () => { if (!initialUnmounted) root.unmount(); errorRoot?.unmount() }); container.remove(); errorContainer?.remove(); win.close()
}
console.log('Harvest receipt regression passed')
