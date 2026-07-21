import { Window } from 'happy-dom'
import React, { createElement, useState } from 'react'
import { act } from 'react'
import { FirstEstimate, PositionCard } from './GrainModule'
import { SaveReceipt } from './components/SaveReceipt'
import { fieldsSeedForRegression } from './data/MockFieldsRepository'
import type { GrainServices, GrainWorkspace, ProductionEstimate } from './data/grain'
import { setSaveReceipt, useSaveReceipt } from './lib/saveReceipt'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const stamp = '2026-10-01T00:00:00.000Z'
const win = new Window({ url: 'http://farmrx.test/grain' })
Object.assign(globalThis, { React, window: win, document: win.document, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement, Node: win.Node, Event: win.Event, InputEvent: win.InputEvent, MouseEvent: win.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator })
const { createRoot } = await import('react-dom/client')
const flush = async () => { await Promise.resolve(); await new Promise<void>((resolve) => setTimeout(resolve, 0)) }
const fields = fieldsSeedForRegression(); const assignment = fields.crop_assignments[0]; assignment.harvested_bushels = 1_300
const estimate: ProductionEstimate = { id: uid(700), farm_id: fields.farm.id, crop_year: assignment.crop_year, commodity_id: assignment.commodity_id, operating_entity_id: null, enterprise_label: null, planted_acres: assignment.planted_acres, aph_yield: 180, expected_bushels: assignment.planted_acres * 180, actual_bushels: null, drives_math: 'projected', notes: null, created_at: stamp, updated_at: stamp }
const workspace: GrainWorkspace = { fields, production_estimates: [estimate], grain_contracts: [], grain_contract_deliveries: [], marketing_plan_targets: [], insurance_units: [], grain_bins: [], bin_inventory: [], bin_transactions: [], cash_bids: [], usda_report_dates: [], marketing_alert_rules: [], firm_offers: [], grain_alert_settings: null }
let createdCalls = 0; let reconciledCalls = 0; let nextId = uid(701); let releaseCreate!: () => void; let releaseReconcile!: () => void
const createGate = new Promise<void>((resolve) => { releaseCreate = resolve }); const reconcileGate = new Promise<void>((resolve) => { releaseReconcile = resolve })
const repository = { getData: async () => workspace, saveProductionEstimate: async (value: ProductionEstimate) => { createdCalls += 1; setSaveReceipt(value.id, 'saving'); await createGate; setSaveReceipt(value.id, 'saved') }, reconcileHarvestActual: async (value: ProductionEstimate, actual: number) => { reconciledCalls += 1; setSaveReceipt(value.id, 'saving'); await reconcileGate; assert(actual === 1_300, 'Reconciliation must use the Harvest total.'); setSaveReceipt(value.id, 'saved') } }
const services = { grainRepository: repository, createGrainId: () => nextId, profitabilityRepository: { getBreakeven: async () => null, getWorkspace: async () => ({ budgets: [], allocations: [] }) } } as unknown as GrainServices

function FirstHarness() { const [id, setId] = useState<string | null>(null); return createElement(FirstEstimate, { workspace: { ...workspace, production_estimates: [] }, services, onSaved: async () => undefined, onReceipt: setId, receipt: useSaveReceipt(id) }) }
function ReconcileHarness() { const [id, setId] = useState<string | null>(null); const receipt = useSaveReceipt(id); return createElement(React.Fragment, null, createElement(PositionCard, { estimate, workspace, services, saleLimit: null, onSaleLimitChange: () => undefined, onSaved: async () => undefined, onReceipt: setId }), createElement(SaveReceipt, { state: receipt })) }

const firstContainer = document.createElement('div'); document.body.append(firstContainer); const firstRoot = createRoot(firstContainer)
let firstUnmounted = false; let reconcileContainer: HTMLDivElement | null = null; let reconcileRoot: ReturnType<typeof createRoot> | null = null
try {
  await act(async () => { firstRoot.render(createElement(FirstHarness)); await flush() })
  const aph = firstContainer.querySelector('input') as HTMLInputElement; await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(aph, '180'); aph.dispatchEvent(new (win.InputEvent ?? win.Event)('input', { bubbles: true }) as unknown as Event); aph.dispatchEvent(new Event('change', { bubbles: true })); await flush() })
  const create = [...firstContainer.querySelectorAll('button')].find((button) => button.textContent === 'Create estimate') as HTMLButtonElement | undefined; assert(create && aph.value === '180' && !create.disabled, 'First estimate must keep the controlled APH value and genuinely enable Create estimate before submission.')
  await act(async () => { create.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() })
  assert(firstContainer.textContent?.includes('Saving…') && createdCalls === 1, 'First estimate must select its exact generated ID and render Saving before the create returns.')
  await act(async () => { create.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() }); assert(createdCalls === 1, 'Rapid first-estimate submit must create one ID and one write.')
  releaseCreate(); await act(async () => { await flush(); await flush() }); assert(firstContainer.textContent?.includes('Saved') && createdCalls === 1, 'First estimate must render Saved for its one completed write.')

  await act(async () => { firstRoot.unmount() }); firstUnmounted = true; firstContainer.remove(); reconcileContainer = document.createElement('div'); document.body.append(reconcileContainer); reconcileRoot = createRoot(reconcileContainer); const renderedReconcileContainer = reconcileContainer
  const previousConfirm = window.confirm; const confirmations: string[] = []; window.confirm = (message = '') => { confirmations.push(message); return false }
  await act(async () => { reconcileRoot!.render(createElement(ReconcileHarness)); await flush() })
  const reconcile = [...renderedReconcileContainer.querySelectorAll('button')].find((button) => button.textContent === 'Use harvest total as Grain actual'); assert(reconcile, 'Harvest reconciliation action did not render.')
  await act(async () => { reconcile.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() }); assert(reconciledCalls === 0 && confirmations[0] === 'Use the harvest total as Grain actual? This changes Grain actual only; it does not change bins.', 'Cancel must make zero reconciliation calls after the exact farmer confirmation text.')
  window.confirm = (message = '') => { confirmations.push(message); return true }; await act(async () => { reconcile.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() }); const savingCalls = Number(reconciledCalls); assert(savingCalls === 1 && renderedReconcileContainer.textContent?.includes('Saving…'), 'Harvest reconciliation must invoke one direct online write and render Saving after the exact confirmation text.')
  releaseReconcile(); await act(async () => { await flush(); await flush() }); const savedCalls = Number(reconciledCalls); assert(savedCalls === 1 && renderedReconcileContainer.textContent?.includes('Saved'), 'Harvest reconciliation must remain one direct write and render Saved when its receipt completes.'); window.confirm = previousConfirm
} finally { await act(async () => { if (!firstUnmounted) firstRoot.unmount(); reconcileRoot?.unmount() }); firstContainer.remove(); reconcileContainer?.remove(); win.close() }
console.log('Grain receipt UI regression passed')
