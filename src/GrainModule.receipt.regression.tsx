import { Window } from 'happy-dom'
import React, { createElement, useState } from 'react'
import { act } from 'react'
import { Bins, ContractActions, ContractEntry, FirstEstimate, PositionCard } from './GrainModule'
import { SaveReceipt } from './components/SaveReceipt'
import { fieldsSeedForRegression } from './data/MockFieldsRepository'
import type { BinTransaction, GrainBin, GrainContract, GrainContractDelivery, GrainServices, GrainWorkspace, ProductionEstimate } from './data/grain'
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
} finally { await act(async () => { if (!firstUnmounted) firstRoot.unmount(); reconcileRoot?.unmount() }); firstContainer.remove(); reconcileContainer?.remove() }

type Gate = { promise: Promise<void>; release: () => void }
function gate(): Gate { let release!: () => void; return { promise: new Promise<void>((resolve) => { release = resolve }), release } }
function control(container: HTMLElement, label: string) {
  const row = [...container.querySelectorAll('label')].find((item) => item.textContent?.includes(label))
  const element = row?.querySelector('input,select') as HTMLInputElement | HTMLSelectElement | null
  assert(element, `Missing ${label} control.`)
  return element
}
async function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = element instanceof win.HTMLSelectElement ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('change', { bubbles: true }))
    element.dispatchEvent(new (win.InputEvent ?? win.Event)('input', { bubbles: true }) as unknown as Event)
    await flush()
  })
}
function button(container: HTMLElement, text: string) {
  const found = [...container.querySelectorAll('button')].find((item) => item.textContent === text) as HTMLButtonElement | undefined
  assert(found, `Missing ${text} button.`)
  return found
}
async function click(element: HTMLElement) { await act(async () => { element.click(); await flush() }) }

const novemberIds = {
  contract: uid(801), deliveryOffline: uid(802), delivery: uid(803), deliveryRejected: uid(804), deliveryCorrected: uid(805), bin: uid(807), movementOffline: uid(808), inbound: uid(809), outboundRejected: uid(810), outbound: uid(811),
}
const idOrder = Object.values(novemberIds); let idIndex = 0
const novemberWorkspace: GrainWorkspace = {
  ...workspace,
  production_estimates: [estimate],
  grain_contracts: [], grain_contract_deliveries: [], grain_bins: [], bin_inventory: [], bin_transactions: [],
  cash_bids: [{ id: uid(806), farm_id: fields.farm.id, elevator: 'County elevator', commodity_id: assignment.commodity_id, bid_date: '2026-10-01', basis: 0, cash_price: 4.75, delivery_start: null, delivery_end: null, notes: null, created_at: stamp, updated_at: stamp }],
  capabilities: { contract_deliveries: true, contract_price_finalization: true, bin_movements: true },
}
let contractGate = gate(); let deliveryGate = gate(); let binGate = gate(); let movementGate = gate()
let contractWrites = 0; let deliveryWrites = 0; let binWrites = 0; let movementWrites = 0
let deliveryMode: 'offline' | 'ambiguous' | 'canonical' | 'success' = 'offline'; let movementMode: 'offline' | 'ambiguous' | 'canonical' | 'success' = 'offline'
const seenContracts: GrainContract[] = []; const seenDeliveries: GrainContractDelivery[] = []; const seenBins: GrainBin[] = []; const seenMovements: BinTransaction[] = []
const attemptedDeliveries: GrainContractDelivery[] = []; const attemptedMovements: BinTransaction[] = []
const novemberRepository = {
  getData: async () => novemberWorkspace,
  saveContract: async (value: GrainContract) => { contractWrites += 1; seenContracts.push(value); setSaveReceipt(value.id, 'saving'); await contractGate.promise; novemberWorkspace.grain_contracts = [value]; setSaveReceipt(value.id, 'saved') },
  recordContractDelivery: async (value: GrainContractDelivery) => { attemptedDeliveries.push(structuredClone(value)); setSaveReceipt(value.id, 'saving'); if (deliveryMode === 'offline') { setSaveReceipt(value.id, 'needs attention'); throw new Error('Connect to the internet before recording a delivery.') } deliveryWrites += 1; seenDeliveries.push(structuredClone(value)); await deliveryGate.promise; if (deliveryMode === 'canonical') { setSaveReceipt(value.id, 'needs attention'); throw new Error('delivery validation failed') } if (!novemberWorkspace.grain_contract_deliveries.some((item) => item.id === value.id)) novemberWorkspace.grain_contract_deliveries = [...novemberWorkspace.grain_contract_deliveries, structuredClone(value)]; if (deliveryMode === 'ambiguous') { deliveryMode = 'success'; setSaveReceipt(value.id, 'confirmation needed'); throw new TypeError('lost delivery response') } setSaveReceipt(value.id, 'saved') },
  upsertGrainBin: async (value: GrainBin) => { binWrites += 1; seenBins.push(value); setSaveReceipt(value.id, 'saving'); await binGate.promise; novemberWorkspace.grain_bins = [value]; setSaveReceipt(value.id, 'saved') },
  appendBinTransaction: async (value: BinTransaction) => { attemptedMovements.push(structuredClone(value)); setSaveReceipt(value.id, 'saving'); if (movementMode === 'offline') { setSaveReceipt(value.id, 'needs attention'); throw new Error('Bin movements need a connection.') } movementWrites += 1; seenMovements.push(structuredClone(value)); await movementGate.promise; if (movementMode === 'canonical') { setSaveReceipt(value.id, 'needs attention'); throw new Error('movement validation failed') } if (!novemberWorkspace.bin_transactions.some((item) => item.id === value.id)) novemberWorkspace.bin_transactions = [...novemberWorkspace.bin_transactions, structuredClone(value)]; if (movementMode === 'ambiguous') { movementMode = 'success'; setSaveReceipt(value.id, 'confirmation needed'); throw new TypeError('lost movement response') } setSaveReceipt(value.id, 'saved') },
} as unknown as GrainServices['grainRepository']
const novemberServices = { grainRepository: novemberRepository, createGrainId: () => { const id = idOrder[idIndex++]; assert(id, 'Unexpected extra generated Grain ID.'); return id }, profitabilityRepository: services.profitabilityRepository } as unknown as GrainServices

function ContractHarness() {
  const [snapshot, setSnapshot] = useState({ ...novemberWorkspace })
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const onReceipt = (id: string) => setReceiptId(id)
  const refresh = async () => setSnapshot({ ...novemberWorkspace, grain_contracts: [...novemberWorkspace.grain_contracts], grain_contract_deliveries: [...novemberWorkspace.grain_contract_deliveries] })
  const contract = snapshot.grain_contracts[0]
  return createElement(React.Fragment, null,
    createElement('section', { 'aria-label': 'Contracts owning area' }, createElement(SaveReceipt, { state: useSaveReceipt(receiptId) }), createElement(ContractEntry, { workspace: snapshot, scope: { farm_id: fields.farm.id, crop_year: estimate.crop_year, commodity_id: estimate.commodity_id, operating_entity_id: null, enterprise_label: null }, services: novemberServices, saleLimit: null, onSaved: refresh, onReceipt })),
    contract && createElement(ContractActions, { contract, workspace: snapshot, services: novemberServices, onSaved: refresh, onDeliverySaved: refresh, onReceipt }),
  )
}

const contractContainer = document.createElement('div'); document.body.append(contractContainer); const contractRoot = createRoot(contractContainer)
await act(async () => { contractRoot.render(createElement(ContractHarness)); await flush() })
await change(control(contractContainer, 'Bushels'), '12000'); await change(control(contractContainer, 'Cash $/bu'), '5')
assert((control(contractContainer, 'Bushels') as HTMLInputElement).value === '12000' && (control(contractContainer, 'Cash $/bu') as HTMLInputElement).value === '5', `Contract controlled values were not retained: ${[...contractContainer.querySelectorAll('input')].map((item) => item.value).join('|')}`)
const addContract = button(contractContainer, 'Add contract')
assert(addContract.form, 'Contract submit button must belong to the real form.')
await act(async () => { addContract.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); addContract.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() })
assert(contractWrites === 1 && seenContracts[0]?.id === novemberIds.contract && contractContainer.textContent?.includes('Saving…'), `Contract create must show Saving for its exact generated ID and lock a real double submit to one write. writes=${contractWrites} id=${seenContracts[0]?.id} text=${contractContainer.textContent}`)
contractGate.release(); await act(async () => { await flush(); await flush() })
assert(contractWrites === 1 && contractContainer.textContent?.includes('Saved'), 'Contracts owning area must show Saved for the exact completed contract ID.')
const deliveryInput = control(contractContainer, 'Delivered bushels'); await change(deliveryInput, '13000')
let genericContractWritesBeforeDelivery = contractWrites
const priorNovemberConfirm = window.confirm; const deliveryConfirmations: string[] = []; window.confirm = (message = '') => { deliveryConfirmations.push(message); return false }
await click(button(contractContainer, 'Record delivery'))
assert(deliveryWrites === 0 && deliveryConfirmations[0] === 'This is 1,000.00 bu more than the contract. Record anyway?', 'Cancelling the real over-delivery confirmation must perform zero writes with the exact farmer-facing warning.')
window.confirm = (message = '') => { deliveryConfirmations.push(message); return true }
const recordDelivery = button(contractContainer, 'Record delivery'); await act(async () => { recordDelivery.click(); recordDelivery.click(); await flush() })
assert(deliveryWrites === 0 && attemptedDeliveries.length === 1 && attemptedDeliveries[0]?.id === novemberIds.deliveryOffline && contractContainer.textContent?.includes('Needs attention') && contractContainer.textContent?.includes('Connect to the internet before recording a delivery.') && !contractContainer.textContent?.includes('may be recorded') && !(control(contractContainer, 'Delivered bushels') as HTMLInputElement).disabled && button(contractContainer, 'Record delivery'), 'Offline delivery must make zero server calls, remain editable, avoid ambiguous copy, and discard its failed draft ID.')
deliveryMode = 'ambiguous'
const correctedDelivery = button(contractContainer, 'Record delivery'); await act(async () => { correctedDelivery.click(); correctedDelivery.click(); await flush() })
assert(Number(deliveryWrites) === 1 && seenDeliveries[0]?.id === novemberIds.delivery && contractContainer.textContent?.includes('Saving…'), 'Delivery must show Saving for one exact stable draft ID.')
deliveryGate.release(); await act(async () => { await flush(); await flush() })
assert(contractContainer.textContent?.includes('Confirmation needed') && contractContainer.textContent?.includes('may already be recorded') && !contractContainer.textContent?.includes('Needs attention') && contractContainer.textContent?.includes('Retry keeps the same delivery') && contractContainer.textContent?.includes('Retry delivery'), 'A lost delivery response must truthfully retain Confirmation needed and explicit same-entry retry custody.')
deliveryGate = gate(); const retryDelivery = button(contractContainer, 'Retry delivery'); await act(async () => { retryDelivery.click(); retryDelivery.click(); await flush() })
assert(Number(deliveryWrites) === 2 && seenDeliveries[1]?.id === novemberIds.delivery && contractContainer.textContent?.includes('Saving…'), 'Delivery retry must reuse the exact original draft ID and return to Saving.')
deliveryGate.release(); await act(async () => { await flush(); await flush() })
assert(contractContainer.textContent?.includes('Saved') && contractWrites === genericContractWritesBeforeDelivery && novemberWorkspace.grain_contract_deliveries.length === 1, 'Delivery retry must show Saved, create one canonical delivery, and never couple to a generic contract write.')
assert(JSON.stringify(seenDeliveries[1]) === JSON.stringify(seenDeliveries[0]), 'Delivery retry must resend the byte-identical full draft, not merely reuse its ID.')
await change(control(contractContainer, 'Delivered bushels'), '100'); deliveryMode = 'canonical'; deliveryGate = gate(); const rejectedDelivery = button(contractContainer, 'Record delivery'); await act(async () => { rejectedDelivery.click(); rejectedDelivery.click(); await flush() }); assert(Number(deliveryWrites) === 3 && seenDeliveries[2]?.id === novemberIds.deliveryRejected, 'Definite delivery rejection must lock rapid clicks to one server attempt with its own ID.'); deliveryGate.release(); await act(async () => { await flush(); await flush() })
assert(contractContainer.textContent?.includes('Needs attention') && !contractContainer.textContent?.includes('may be recorded') && !(control(contractContainer, 'Delivered bushels') as HTMLInputElement).disabled && button(contractContainer, 'Record delivery'), 'Definite delivery rejection must remain editable without ambiguous retry copy.')
deliveryMode = 'success'; deliveryGate = gate(); const correctedRejectedDelivery = button(contractContainer, 'Record delivery'); await act(async () => { correctedRejectedDelivery.click(); correctedRejectedDelivery.click(); await flush() }); assert(Number(deliveryWrites) === 4 && seenDeliveries[3]?.id === novemberIds.deliveryCorrected, 'Corrected delivery retry must mint a new ID and lock rapid clicks to one server attempt.'); deliveryGate.release(); await act(async () => { await flush(); await flush() }); assert(Number(novemberWorkspace.grain_contract_deliveries.length) === 2 && contractContainer.textContent?.includes('Saved'), 'Corrected delivery must save one new canonical row.')
assert(deliveryConfirmations.length === 6 && deliveryConfirmations.every((message) => message.includes('more than the contract. Record anyway?')), 'Each delivery attempt must cross the real over-delivery confirmation boundary.'); window.confirm = priorNovemberConfirm
assert(contractContainer.textContent?.includes('Recording a delivery does not remove grain from a bin.'), 'Contract UI must state that delivery does not change bin inventory.')
await act(async () => { contractRoot.unmount() }); contractContainer.remove()

let failMovementRefresh = false
function BinsHarness() {
  const [snapshot, setSnapshot] = useState({ ...novemberWorkspace })
  const [receiptId, setReceiptId] = useState<string | null>(null)
  const refresh = async () => { if (failMovementRefresh) { failMovementRefresh = false; throw new Error('lost movement refresh') } setSnapshot({ ...novemberWorkspace, grain_bins: [...novemberWorkspace.grain_bins], bin_transactions: [...novemberWorkspace.bin_transactions] }) }
  return createElement(Bins, { workspace: snapshot, services: novemberServices, receipt: useSaveReceipt(receiptId), onSaved: refresh, onMovementSaved: refresh, onReceipt: setReceiptId })
}
const binsContainer = document.createElement('div'); document.body.append(binsContainer); let binsRoot = createRoot(binsContainer)
await act(async () => { binsRoot.render(createElement(BinsHarness)); await flush() }); await click(button(binsContainer, 'Add bin'))
await change(control(binsContainer, 'Name'), 'North Bin'); await change(control(binsContainer, 'Capacity bushels'), '40000')
const saveBin = button(binsContainer, 'Save bin')
assert(saveBin.form, 'Bin submit button must belong to the real form.')
await act(async () => { saveBin.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); saveBin.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() })
assert(binWrites === 1 && seenBins[0]?.id === novemberIds.bin && binsContainer.textContent?.includes('Saving…'), 'Bin create must show Saving for its exact generated ID and lock a real double submit to one write.')
binGate.release(); await act(async () => { await flush(); await flush() })
assert(binWrites === 1 && binsContainer.textContent?.includes('Saved') && binsContainer.textContent?.includes('North Bin'), 'Bins owning area must show Saved and canonical bin state after the write.')
await change(control(binsContainer, 'Bushels'), '30800'); const addMovement = button(binsContainer, 'Add movement'); assert(addMovement.form, 'Movement submit button must belong to the real form.'); await act(async () => { addMovement.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); addMovement.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() })
assert(movementWrites === 0 && attemptedMovements.length === 1 && attemptedMovements[0]?.id === novemberIds.movementOffline && binsContainer.textContent?.includes('Needs attention') && !binsContainer.textContent?.includes('may already be recorded') && [...binsContainer.querySelectorAll('.movement-form input, .movement-form select')].every((item) => !(item as HTMLInputElement).disabled) && button(binsContainer, 'Add movement'), 'Offline movement must make zero server calls, remain fully editable, avoid ambiguous copy, and discard its failed draft ID.')
movementMode = 'ambiguous'; const correctedInbound = button(binsContainer, 'Add movement'); assert(correctedInbound.form, 'Corrected inbound must belong to the real form.'); await act(async () => { correctedInbound.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); correctedInbound.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() })
assert(Number(movementWrites) === 1 && seenMovements[0]?.id === novemberIds.inbound && binsContainer.textContent?.includes('Saving…'), 'Bin-in must show Saving for its exact stable movement ID.')
movementGate.release(); await act(async () => { await flush(); await flush() })
const lockedMovementControls = [...binsContainer.querySelectorAll('.movement-form input, .movement-form select')] as Array<HTMLInputElement | HTMLSelectElement>
assert(binsContainer.textContent?.includes('Confirmation needed') && binsContainer.textContent?.includes('may already be recorded') && !binsContainer.textContent?.includes('Needs attention') && button(binsContainer, 'Retry movement') && lockedMovementControls.length === 5 && lockedMovementControls.every((item) => item.disabled), 'A lost movement response must show Confirmation needed and lock every payload control behind Retry movement.')
movementGate = gate(); const retryMovement = button(binsContainer, 'Retry movement'); assert(retryMovement.form, 'Retry movement must belong to the real form.'); await act(async () => { retryMovement.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); retryMovement.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() })
assert(Number(movementWrites) === 2 && JSON.stringify(seenMovements[1]) === JSON.stringify(seenMovements[0]) && seenMovements[1]?.id === novemberIds.inbound && binsContainer.textContent?.includes('Saving…'), 'Movement retry must issue one delayed repository call with the byte-identical full draft and exact ID.')
movementGate.release(); await act(async () => { await flush(); await flush() })
assert(binsContainer.textContent?.includes('Saved') && binsContainer.textContent?.includes('30,800') && novemberWorkspace.bin_transactions.filter((item) => item.id === novemberIds.inbound).length === 1, 'Canonical bin UI must show Saved and one logical 30,800-bushel inbound movement after retry.')
movementMode = 'canonical'; movementGate = gate(); await change(control(binsContainer, 'Direction'), 'out'); await change(control(binsContainer, 'Bushels'), '5000')
assert(binsContainer.textContent?.includes('Bin-out changes this bin only. It does not mark a contract delivered.'), 'Bin UI must state that an outbound movement does not record a contract delivery.')
const addOutbound = button(binsContainer, 'Add movement'); assert(addOutbound.form, 'Outbound submit button must belong to the real form.'); await act(async () => { addOutbound.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); addOutbound.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() })
assert(Number(movementWrites) === 3 && seenMovements[2]?.id === novemberIds.outboundRejected && binsContainer.textContent?.includes('Saving…'), 'Rejected bin-out must show Saving and lock two rapid submits to one repository invocation for its exact ID.')
movementGate.release(); await act(async () => { await flush(); await flush() })
assert(seenMovements[2]?.id === novemberIds.outboundRejected && binsContainer.textContent?.includes('Needs attention') && !binsContainer.textContent?.includes('may already be recorded') && [...binsContainer.querySelectorAll('.movement-form input, .movement-form select')].every((item) => !(item as HTMLInputElement).disabled) && button(binsContainer, 'Add movement'), 'Definite outbound rejection must remain fully editable, avoid ambiguous copy, and discard its failed draft ID.')
movementMode = 'success'; movementGate = gate(); failMovementRefresh = true; const correctedOutbound = button(binsContainer, 'Add movement'); assert(correctedOutbound.form, 'Corrected outbound must belong to the real form.'); await act(async () => { correctedOutbound.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); correctedOutbound.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() }); assert(Number(movementWrites) === 4 && seenMovements[3]?.id === novemberIds.outbound, 'Corrected outbound retry must mint a new ID and lock rapid submits to one server attempt.'); movementGate.release(); await act(async () => { await flush(); await flush() })
const refreshFailureControls = [...binsContainer.querySelectorAll('.movement-form input, .movement-form select')] as Array<HTMLInputElement | HTMLSelectElement>; assert(binsContainer.textContent?.includes('Confirmation needed') && binsContainer.textContent?.includes('may already be recorded') && button(binsContainer, 'Retry movement') && refreshFailureControls.every((item) => item.disabled) && novemberWorkspace.bin_transactions.filter((item) => item.id === novemberIds.outbound).length === 1, 'A successful movement write with failed owning refresh must publish Confirmation needed, freeze the exact draft, and retain one canonical row.')
movementGate = gate(); const retryRefreshMovement = button(binsContainer, 'Retry movement'); assert(retryRefreshMovement.form, 'Refresh-failure retry must belong to the real form.'); await act(async () => { retryRefreshMovement.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); retryRefreshMovement.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() }); assert(Number(movementWrites) === 5 && JSON.stringify(seenMovements[4]) === JSON.stringify(seenMovements[3]), 'Refresh-failure retry must resend one byte-identical full draft and exact ID.'); movementGate.release(); await act(async () => { await flush(); await flush() })
assert(binsContainer.textContent?.includes('Saved') && binsContainer.textContent?.includes('25,800') && novemberWorkspace.bin_transactions.filter((item) => item.id === novemberIds.outbound).length === 1, 'Successful retry refresh must clear the lock and retain one canonical 25,800-bushel row.')
await act(async () => { binsRoot.unmount() }); binsContainer.textContent = ''; binsRoot = createRoot(binsContainer); await act(async () => { binsRoot.render(createElement(BinsHarness)); await flush() })
assert(binsContainer.textContent?.includes('25,800') && !binsContainer.textContent?.includes('30,800 bu /'), 'A route-equivalent remount must reload the canonical 25,800-bushel bin state rather than stale local state.')
assert(idIndex === idOrder.length && Number(contractWrites) === 1 && Number(deliveryWrites) === 4 && Number(binWrites) === 1 && Number(movementWrites) === 5 && novemberWorkspace.bin_transactions.length === 2, 'November flows must use the ten intended draft IDs, one invocation per rapid-submit action, and only canonical rows.')
await act(async () => { binsRoot.unmount() }); binsContainer.remove(); win.close()
console.log('Grain receipt UI regression passed')
