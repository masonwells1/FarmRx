import { Window } from 'happy-dom'
import React, { createElement, useState } from 'react'
import { act } from 'react'
import { Bins, ContractActions, ContractEntry, deliveryDefaultEstimate, FirstEstimate, PositionCard, TargetEditor } from './GrainModule'
import { SaveReceipt } from './components/SaveReceipt'
import { ConfirmDialogHost } from './components/ConfirmDialog'
import { fieldsSeedForRegression } from './data/MockFieldsRepository'
import { recordedBinLots, type BinTransaction, type GrainBin, type GrainContract, type GrainContractDelivery, type GrainLoad, type GrainServices, type GrainWorkspace, type ProductionEstimate } from './data/grain'
import { setSaveReceipt, useSaveReceipt } from './lib/saveReceipt'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const stamp = '2026-10-01T00:00:00.000Z'
const win = new Window({ url: 'http://farmrx.test/grain' })
Object.assign(globalThis, { React, window: win, document: win.document, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement, Node: win.Node, Event: win.Event, InputEvent: win.InputEvent, MouseEvent: win.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator })
const { createRoot } = await import('react-dom/client')
const flush = async () => { await Promise.resolve(); await new Promise<void>((resolve) => setTimeout(resolve, 0)) }
const openDialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null
function dialogButton(text: string) { const found = [...document.querySelectorAll('[role="dialog"] button')].find((item) => item.textContent === text) as HTMLButtonElement | undefined; assert(found, `Dialog button ${text} did not render.`); return found }
const fields = fieldsSeedForRegression(); const assignment = fields.crop_assignments[0]; assignment.harvested_bushels = 1_300
const estimate: ProductionEstimate = { id: uid(700), farm_id: fields.farm.id, crop_year: assignment.crop_year, commodity_id: assignment.commodity_id, operating_entity_id: null, enterprise_label: null, planted_acres: assignment.planted_acres, aph_yield: 180, expected_bushels: assignment.planted_acres * 180, actual_bushels: null, drives_math: 'projected', notes: null, created_at: stamp, updated_at: stamp }
const workspace: GrainWorkspace = { fields, production_estimates: [estimate], grain_contracts: [], grain_contract_deliveries: [], grain_loads: [], marketing_plan_targets: [], insurance_units: [], grain_bins: [], bin_inventory: [], bin_transactions: [], cash_bids: [], usda_market_reports: [], usda_report_dates: [], marketing_alert_rules: [], firm_offers: [], grain_alert_settings: null, grain_sale_limits: [], grain_carry_settings: null, grain_carry_grids: [] }
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
  // Grain usability: each crop has its own yield box, and Create with a blank box says why instead of doing nothing.
  const yieldInputs = [...firstContainer.querySelectorAll('input')] as HTMLInputElement[]; assert(yieldInputs.length > 1, 'Each crop and year without an estimate must get its own expected-yield box.')
  const createButtons = [...firstContainer.querySelectorAll('button')].filter((button) => button.textContent === 'Create estimate') as HTMLButtonElement[]
  await act(async () => { createButtons[1].dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() })
  assert(firstContainer.textContent?.includes('Enter an expected yield above zero.') && Number(createdCalls) === 0, 'Create with a blank yield must explain itself on that card and send nothing.')
  assert(firstContainer.textContent?.includes('ac planted'), 'Each crop card must show its planted acres.')
  const aph = firstContainer.querySelector('input') as HTMLInputElement; await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(aph, '180'); aph.dispatchEvent(new (win.InputEvent ?? win.Event)('input', { bubbles: true }) as unknown as Event); aph.dispatchEvent(new Event('change', { bubbles: true })); await flush() })
  const create = [...firstContainer.querySelectorAll('button')].find((button) => button.textContent === 'Create estimate') as HTMLButtonElement | undefined; assert(create && aph.value === '180' && !create.disabled, 'First estimate must keep the controlled APH value and genuinely enable Create estimate before submission.')
  assert(([...firstContainer.querySelectorAll('input')] as HTMLInputElement[])[1].value === '' && firstContainer.textContent?.includes('bu expected'), 'A yield typed for one crop must not fill another crop\'s box, and the typed crop shows its expected bushels.')
  await act(async () => { create.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() })
  assert(firstContainer.textContent?.includes('Saving…') && createdCalls === 1, 'First estimate must select its exact generated ID and render Saving before the create returns.')
  await act(async () => { create.dispatchEvent(new MouseEvent('click', { bubbles: true })); await Promise.resolve() }); assert(createdCalls === 1, 'Rapid first-estimate submit must create one ID and one write.')
  releaseCreate(); await act(async () => { await flush(); await flush() }); assert(firstContainer.textContent?.includes('Saved') && createdCalls === 1, 'First estimate must render Saved for its one completed write.')

  await act(async () => { firstRoot.unmount() }); firstUnmounted = true; firstContainer.remove(); reconcileContainer = document.createElement('div'); document.body.append(reconcileContainer); reconcileRoot = createRoot(reconcileContainer); const renderedReconcileContainer = reconcileContainer
  const previousConfirm = window.confirm; window.confirm = () => { throw new Error('window.confirm must not be used: the in-app dialog host is mounted.') }
  await act(async () => { reconcileRoot!.render(createElement(React.Fragment, null, createElement(ReconcileHarness), createElement(ConfirmDialogHost))); await flush() })
  // GL-3: the position card now leads with one line and three tiles, and everything else — including this
  // action — sits behind More details. Open it, then assert every control is still there and still works.
  const moreDetails = [...renderedReconcileContainer.querySelectorAll('button')].find((button) => button.textContent === 'More details'); assert(moreDetails, 'GL-3: the position card must offer a More details disclosure.')
  assert(![...renderedReconcileContainer.querySelectorAll('button')].some((button) => button.textContent === 'Use harvest total as Grain actual'), 'GL-3: the card must not lead with the harvest reconciliation action; it belongs behind More details.')
  await act(async () => { moreDetails.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() })
  const reconcile = [...renderedReconcileContainer.querySelectorAll('button')].find((button) => button.textContent === 'Use harvest total as Grain actual'); assert(reconcile, 'Harvest reconciliation action did not render after opening More details.')
  await act(async () => { reconcile.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() }); const reconcileDialog = openDialog(); assert(reconciledCalls === 0 && reconcileDialog?.textContent?.includes('Use the harvest total as Grain actual?') && reconcileDialog.textContent.includes('This changes Grain actual only; it does not change bins.'), 'The in-app dialog must show the exact farmer confirmation text before any reconciliation call.'); await click(dialogButton('Go back')); assert(reconciledCalls === 0 && openDialog() === null, 'Cancel must make zero reconciliation calls and close the dialog.')
  await act(async () => { reconcile.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() }); await click(dialogButton('Use harvest total')); const savingCalls = Number(reconciledCalls); assert(savingCalls === 1 && renderedReconcileContainer.textContent?.includes('Saving…'), 'Harvest reconciliation must invoke one direct online write and render Saving after the exact confirmation text.')
  releaseReconcile(); await act(async () => { await flush(); await flush() }); const savedCalls = Number(reconciledCalls); assert(savedCalls === 1 && renderedReconcileContainer.textContent?.includes('Saved'), 'Harvest reconciliation must remain one direct write and render Saved when its receipt completes.'); window.confirm = previousConfirm
  // Grain usability: with no insurance unit and no Revenue Protection on a budget there is no guarantee to show, so the card says
  // "Not entered" and where to add it, never "0 bu" (which reads as no room left to sell).
  const metricValue = (label: string) => [...renderedReconcileContainer.querySelectorAll('div')].find((item) => item.querySelector(':scope > span')?.textContent === label)?.querySelector(':scope > strong')?.textContent
  assert(metricValue('Insurance estimate guarantee') === 'Not entered' && metricValue('Insurance estimate remaining') === 'Not entered' && metricValue('Insurance floor estimate') === 'Not entered' && renderedReconcileContainer.textContent?.includes("Add Revenue Protection coverage to this crop's budget in Profitability"), 'No coverage must read Not entered with where to add it, not 0 bu.')
  // The Actual button is not greyed out with no reason: with no actual bushels saved it says what to do and saves nothing.
  const productionCallsBefore = createdCalls
  await click(button(renderedReconcileContainer, 'Actual'))
  assert(renderedReconcileContainer.textContent?.includes('Enter actual bushels in More details and tap Save production. Then tap Actual.') && createdCalls === productionCallsBefore, 'Actual with no actual bushels must explain itself and make no save.')
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

// Grain usability (s1a): the empty farm points to Fields; the card shows load-ticket harvest without adopting it, explains a blank
// yield beside the box, and shows its own Saving / Saved for a production save.
{
  const { MemoryRouter } = await import('react-router')
  const emptyContainer = document.createElement('div'); document.body.append(emptyContainer); const emptyRoot = createRoot(emptyContainer)
  const cardContainer = document.createElement('div'); document.body.append(cardContainer); const cardRoot = createRoot(cardContainer)
  try {
    await act(async () => { emptyRoot.render(createElement(MemoryRouter, null, createElement(FirstEstimate, { workspace: { ...workspace, production_estimates: [], fields: { ...fields, crop_assignments: [] } }, services, onSaved: async () => undefined, onReceipt: () => undefined, receipt: null }))); await flush() })
    const fieldsLink = [...emptyContainer.querySelectorAll('a')].find((item) => item.textContent === 'Add crops in Fields')
    assert(fieldsLink?.getAttribute('href') === '/fields' && !emptyContainer.querySelector('.loading-state') && emptyContainer.textContent?.includes('No crops to track yet'), 'A farm with no crop assignments must get one sentence and a link to Fields, not a loading placeholder.')

    const loadFields = structuredClone(fields); for (const item of loadFields.crop_assignments) item.harvested_bushels = null
    const loadAssignment = loadFields.crop_assignments[0]
    const load: GrainLoad = { id: uid(730), farm_id: fields.farm.id, load_date: '2026-10-02', truck_equipment_id: null, truck_name: null, origin_kind: 'field', origin_grain_bin_id: null, origin_crop_assignment_id: loadAssignment.id, destination_kind: 'buyer', destination_buyer: 'Synthetic Elevator', destination_grain_contract_id: null, destination_grain_bin_id: null, commodity_id: loadAssignment.commodity_id, crop_year: loadAssignment.crop_year, gross_lbs: null, tare_lbs: null, net_bushels: 2_500, moisture_pct: null, ticket_number: null, photo_path: null, notes: null, effect_bin_out: false, effect_bin_in: false, effect_contract_delivery: false, effect_harvest: true, voided_at: null, void_reason: null, created_at: stamp, updated_at: stamp }
    const cardEstimate: ProductionEstimate = { ...estimate, id: uid(731) }
    const cardWorkspace: GrainWorkspace = { ...workspace, fields: loadFields, production_estimates: [cardEstimate], grain_loads: [load] }
    let productionSaves = 0; const productionGate = gate()
    const cardServices = { ...services, grainRepository: { ...repository, saveProductionEstimate: async (value: ProductionEstimate) => { productionSaves += 1; setSaveReceipt(value.id, 'saving'); await productionGate.promise; setSaveReceipt(value.id, 'saved') } } } as unknown as GrainServices
    await act(async () => { cardRoot.render(createElement(MemoryRouter, null, createElement(PositionCard, { estimate: cardEstimate, workspace: cardWorkspace, services: cardServices, saleLimit: null, onSaleLimitChange: () => undefined, onSaved: async () => undefined, onReceipt: () => undefined }))); await flush() })
    assert(cardContainer.querySelector('.eyebrow')?.textContent === `${cardEstimate.crop_year} crop`, 'The card header must name the crop year, not repeat the crop family.')
    await click(button(cardContainer, 'Edit yield'))
    assert(cardContainer.textContent?.includes('Load tickets: at least 2,500 bu') && [...cardContainer.querySelectorAll('a')].some((item) => item.getAttribute('href') === '/harvest'), 'Load-ticket harvest must be shown with the way to adopt it on Harvest.')
    assert(button(cardContainer, 'Use harvest total as Grain actual').disabled && cardContainer.textContent?.includes('No harvest total entered yet on Harvest.'), 'Load tickets are never adopted here: the action stays off and says why.')
    const yieldBox = control(cardContainer, 'Expected yield') as HTMLInputElement
    assert(document.activeElement === yieldBox, 'Edit yield must open More details and put the cursor in the yield box.')
    await change(yieldBox, ''); await click(button(cardContainer, 'Save production'))
    assert(cardContainer.textContent?.includes('Enter an expected yield above zero (bu/ac).') && Number(productionSaves) === 0, 'A blank yield must be explained beside the card and never sent as 0.')
    await change(yieldBox, '175'); await click(button(cardContainer, 'Save production'))
    assert(productionSaves === 1 && cardContainer.textContent?.includes('Saving…'), 'The card must show its own Saving for a production save.')
    productionGate.release(); await act(async () => { await flush(); await flush() })
    assert(cardContainer.textContent?.includes('Saved'), 'The card must show its own Saved once the production save completes.')
  } finally { await act(async () => { emptyRoot.unmount(); cardRoot.unmount() }); emptyContainer.remove(); cardContainer.remove() }
}

// Grain usability (s1a): the month editor stops a plan past 100% and a % over breakeven with no breakeven, inside the modal and
// before any save; it offers Remove only for a month that has a target; and a failed save is shown inside the modal.
{
  const scope = { farm_id: fields.farm.id, crop_year: estimate.crop_year, commodity_id: estimate.commodity_id, operating_entity_id: null, enterprise_label: null }
  const planTarget = (n: number, month: string, pct: number, price: number | null = null) => ({ id: uid(n), ...scope, target_month: month, target_pct_of_production: pct, target_price: price, breakeven_relative_pct: null, deadline: null, notes: null, created_at: stamp, updated_at: stamp })
  const october = planTarget(741, `${scope.crop_year}-10-01`, 50, 4.5)
  const planWorkspace: GrainWorkspace = { ...workspace, marketing_plan_targets: [planTarget(740, `${scope.crop_year}-09-01`, 40), october] }
  const saves: Array<{ pct: number; price: number | null }> = []; let removes = 0
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  const render = async (props: Partial<Parameters<typeof TargetEditor>[0]>) => { await act(async () => { root.render(createElement(TargetEditor, { month: 11, commodity: '2026 Yellow Corn — whole farm', scope, services, workspace: planWorkspace, onClose: () => undefined, onSave: (values) => { saves.push(values) }, ...props })); await flush() }) }
  const submit = async () => { const save = button(container, 'Save target'); await act(async () => { save.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() }) }
  try {
    await render({})
    assert(![...container.querySelectorAll('button')].some((item) => item.textContent === 'Remove this month'), 'A month with no target has nothing to remove.')
    await change(control(container, 'Target % of production'), '20'); await submit()
    assert(container.textContent?.includes('Your plan would add up to 110% of the crop.') && Number(saves.length) === 0, 'A month that takes the plan past 100% must be stopped in the modal before a save.')
    await change(control(container, 'Target % of production'), '10'); await change(control(container, 'ROI target'), '5'); await submit()
    assert(container.textContent?.includes("Breakeven isn't available for this crop yet") && Number(saves.length) === 0, 'A % over breakeven with no breakeven must not save the old cash price beside it.')
    await change(control(container, 'ROI target'), ''); await change(control(container, 'Cash price target'), '4.75'); await submit()
    assert(saves.length === 1 && saves[0].pct === 10 && saves[0].price === 4.75, 'With the % cleared, the cash price saves as typed.')
    await act(async () => { root.unmount() }); const editRoot = createRoot(container)
    await act(async () => { editRoot.render(createElement(TargetEditor, { month: 10, commodity: '2026 Yellow Corn — whole farm', target: october, scope, services, workspace: planWorkspace, error: 'Farm Rx could not save this target right now. Please try again.', onClose: () => undefined, onSave: () => undefined, onRemove: () => { removes += 1 } })); await flush() })
    assert(container.querySelector('.target-modal [role="alert"]')?.textContent === 'Farm Rx could not save this target right now. Please try again.', 'A failed save must be shown inside the modal, not behind it.')
    assert((control(container, 'Target % of production') as HTMLInputElement).value === '50', 'Editing a month keeps its own percentage, and its own 50% is not counted twice against the 100% check.')
    await click(button(container, 'Remove this month')); assert(removes === 1, 'A month with a target offers Remove this month.')
    await act(async () => { editRoot.unmount() })
  } finally { container.remove() }
}

const novemberIds = {
  contract: uid(801), deliveryOffline: uid(802), delivery: uid(803), deliveryRejected: uid(804), deliveryCorrected: uid(805), bin: uid(807), movementOffline: uid(808), inbound: uid(809), outboundRejected: uid(810), outbound: uid(811),
}
const idOrder = Object.values(novemberIds); let idIndex = 0
const novemberWorkspace: GrainWorkspace = {
  ...workspace,
  production_estimates: [estimate],
  grain_contracts: [], grain_contract_deliveries: [], grain_loads: [], grain_bins: [], bin_inventory: [], bin_transactions: [],
  cash_bids: [{ id: uid(806), farm_id: fields.farm.id, elevator: 'County elevator', commodity_id: assignment.commodity_id, bid_date: '2026-10-01', basis: 0, cash_price: 4.75, delivery_start: null, delivery_end: null, notes: null, feed_source: null, feed_report_id: null, feed_geography: null, created_at: stamp, updated_at: stamp }],
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
  // LD-5: the movement form reads what the bin holds, by crop year, as public.bin_lots would answer.
  listBinLots: async (binId: string) => recordedBinLots(novemberWorkspace, binId),
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
await act(async () => { contractRoot.render(createElement(React.Fragment, null, createElement(ContractHarness), createElement(ConfirmDialogHost))); await flush() })
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
const priorNovemberConfirm = window.confirm; window.confirm = () => { throw new Error('window.confirm must not be used: the in-app dialog host is mounted.') }; let deliveryConfirmations = 0
async function answerOverDelivery(answer: 'Record anyway' | 'Go back') { assert(openDialog()?.textContent?.includes('more than the contract. Record anyway?'), 'Each delivery attempt must cross the real over-delivery confirmation boundary.'); deliveryConfirmations += 1; await click(dialogButton(answer)) }
await click(button(contractContainer, 'Record delivery'))
assert(deliveryWrites === 0 && openDialog()?.textContent?.includes('This is 1,000.00 bu more than the contract. Record anyway?'), 'The over-delivery dialog must state the exact excess before any write.'); await answerOverDelivery('Go back'); assert(deliveryWrites === 0 && openDialog() === null, 'Cancelling the real over-delivery confirmation must perform zero writes.')
const recordDelivery = button(contractContainer, 'Record delivery'); await act(async () => { recordDelivery.click(); recordDelivery.click(); await flush() }); await answerOverDelivery('Record anyway')
assert(deliveryWrites === 0 && attemptedDeliveries.length === 1 && attemptedDeliveries[0]?.id === novemberIds.deliveryOffline && contractContainer.textContent?.includes('Needs attention') && contractContainer.textContent?.includes('Connect to the internet before recording a delivery.') && !contractContainer.textContent?.includes('may be recorded') && !(control(contractContainer, 'Delivered bushels') as HTMLInputElement).disabled && button(contractContainer, 'Record delivery'), 'Offline delivery must make zero server calls, remain editable, avoid ambiguous copy, and discard its failed draft ID.')
deliveryMode = 'ambiguous'
const correctedDelivery = button(contractContainer, 'Record delivery'); await act(async () => { correctedDelivery.click(); correctedDelivery.click(); await flush() }); await answerOverDelivery('Record anyway')
assert(Number(deliveryWrites) === 1 && seenDeliveries[0]?.id === novemberIds.delivery && contractContainer.textContent?.includes('Saving…'), 'Delivery must show Saving for one exact stable draft ID.')
deliveryGate.release(); await act(async () => { await flush(); await flush() })
assert(contractContainer.textContent?.includes('Confirmation needed') && contractContainer.textContent?.includes('may already be recorded') && !contractContainer.textContent?.includes('Needs attention') && contractContainer.textContent?.includes('Retry keeps the same delivery') && contractContainer.textContent?.includes('Retry delivery'), 'A lost delivery response must truthfully retain Confirmation needed and explicit same-entry retry custody.')
deliveryGate = gate(); const retryDelivery = button(contractContainer, 'Retry delivery'); await act(async () => { retryDelivery.click(); retryDelivery.click(); await flush() }); await answerOverDelivery('Record anyway')
assert(Number(deliveryWrites) === 2 && seenDeliveries[1]?.id === novemberIds.delivery && contractContainer.textContent?.includes('Saving…'), 'Delivery retry must reuse the exact original draft ID and return to Saving.')
deliveryGate.release(); await act(async () => { await flush(); await flush() })
assert(contractContainer.textContent?.includes('Saved') && contractWrites === genericContractWritesBeforeDelivery && novemberWorkspace.grain_contract_deliveries.length === 1, 'Delivery retry must show Saved, create one canonical delivery, and never couple to a generic contract write.')
assert(JSON.stringify(seenDeliveries[1]) === JSON.stringify(seenDeliveries[0]), 'Delivery retry must resend the byte-identical full draft, not merely reuse its ID.')
await change(control(contractContainer, 'Delivered bushels'), '100'); deliveryMode = 'canonical'; deliveryGate = gate(); const rejectedDelivery = button(contractContainer, 'Record delivery'); await act(async () => { rejectedDelivery.click(); rejectedDelivery.click(); await flush() }); await answerOverDelivery('Record anyway'); assert(Number(deliveryWrites) === 3 && seenDeliveries[2]?.id === novemberIds.deliveryRejected, 'Definite delivery rejection must lock rapid clicks to one server attempt with its own ID.'); deliveryGate.release(); await act(async () => { await flush(); await flush() })
assert(contractContainer.textContent?.includes('Needs attention') && !contractContainer.textContent?.includes('may be recorded') && !(control(contractContainer, 'Delivered bushels') as HTMLInputElement).disabled && button(contractContainer, 'Record delivery'), 'Definite delivery rejection must remain editable without ambiguous retry copy.')
deliveryMode = 'success'; deliveryGate = gate(); const correctedRejectedDelivery = button(contractContainer, 'Record delivery'); await act(async () => { correctedRejectedDelivery.click(); correctedRejectedDelivery.click(); await flush() }); await answerOverDelivery('Record anyway'); assert(Number(deliveryWrites) === 4 && seenDeliveries[3]?.id === novemberIds.deliveryCorrected, 'Corrected delivery retry must mint a new ID and lock rapid clicks to one server attempt.'); deliveryGate.release(); await act(async () => { await flush(); await flush() }); assert(Number(novemberWorkspace.grain_contract_deliveries.length) === 2 && contractContainer.textContent?.includes('Saved'), 'Corrected delivery must save one new canonical row.')
assert(deliveryConfirmations === 6, 'Each of the six delivery attempts must cross the real over-delivery confirmation boundary.'); window.confirm = priorNovemberConfirm
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
await change(control(binsContainer, 'Bushels'), '30800')
// LD-5: an empty bin gives no crop year to default to, so the form asks and saves nothing until answered.
const idsBeforeYear = idIndex; const unansweredYear = button(binsContainer, 'Add movement'); assert(unansweredYear.form, 'Movement submit button must belong to the real form.'); await act(async () => { unansweredYear.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() })
assert(Number(attemptedMovements.length) === 0 && binsContainer.textContent?.includes('Pick the crop year of this grain.') && idIndex === idsBeforeYear, 'A new movement into an empty bin must name its crop year before any save is attempted or any id is spent.')
const yearChoices = [...(control(binsContainer, 'Crop year') as HTMLSelectElement).options].map((option) => option.value)
assert(yearChoices[0] === '' && yearChoices.includes(String(assignment.crop_year)), 'Grain arriving must be offered the years this crop is planted in, with no year chosen for it.')
await change(control(binsContainer, 'Crop year'), String(assignment.crop_year)); const addMovement = button(binsContainer, 'Add movement'); assert(addMovement.form, 'Movement submit button must belong to the real form.'); await act(async () => { addMovement.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); addMovement.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() })
assert(movementWrites === 0 && attemptedMovements.length === 1 && attemptedMovements[0]?.id === novemberIds.movementOffline && binsContainer.textContent?.includes('Needs attention') && !binsContainer.textContent?.includes('may already be recorded') && [...binsContainer.querySelectorAll('.movement-form input, .movement-form select')].every((item) => !(item as HTMLInputElement).disabled) && button(binsContainer, 'Add movement'), 'Offline movement must make zero server calls, remain fully editable, avoid ambiguous copy, and discard its failed draft ID.')
movementMode = 'ambiguous'; const correctedInbound = button(binsContainer, 'Add movement'); assert(correctedInbound.form, 'Corrected inbound must belong to the real form.'); await act(async () => { correctedInbound.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); correctedInbound.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() })
assert(Number(movementWrites) === 1 && seenMovements[0]?.id === novemberIds.inbound && binsContainer.textContent?.includes('Saving…'), 'Bin-in must show Saving for its exact stable movement ID.')
movementGate.release(); await act(async () => { await flush(); await flush() })
const lockedMovementControls = [...binsContainer.querySelectorAll('.movement-form input, .movement-form select')] as Array<HTMLInputElement | HTMLSelectElement>
assert(binsContainer.textContent?.includes('Confirmation needed') && binsContainer.textContent?.includes('may already be recorded') && !binsContainer.textContent?.includes('Needs attention') && button(binsContainer, 'Retry movement') && lockedMovementControls.length === 6 && lockedMovementControls.every((item) => item.disabled), 'A lost movement response must show Confirmation needed and lock every payload control behind Retry movement.')
movementGate = gate(); const retryMovement = button(binsContainer, 'Retry movement'); assert(retryMovement.form, 'Retry movement must belong to the real form.'); await act(async () => { retryMovement.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); retryMovement.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() })
assert(Number(movementWrites) === 2 && JSON.stringify(seenMovements[1]) === JSON.stringify(seenMovements[0]) && seenMovements[1]?.id === novemberIds.inbound && binsContainer.textContent?.includes('Saving…'), 'Movement retry must issue one delayed repository call with the byte-identical full draft and exact ID.')
movementGate.release(); await act(async () => { await flush(); await flush() })
assert(seenMovements.every((item) => item.crop_year === assignment.crop_year), 'Every movement sent must carry the crop year the farmer picked.')
assert(binsContainer.textContent?.includes('Saved') && binsContainer.textContent?.includes('30,800') && novemberWorkspace.bin_transactions.filter((item) => item.id === novemberIds.inbound).length === 1, 'Canonical bin UI must show Saved and one logical 30,800-bushel inbound movement after retry.')
movementMode = 'canonical'; movementGate = gate(); await change(control(binsContainer, 'Direction'), 'out'); await change(control(binsContainer, 'Bushels'), '5000')
// LD-5: out offers only the lots the bin holds. With one lot, that year is filled in.
const outYears = [...(control(binsContainer, 'Crop year') as HTMLSelectElement).options].map((option) => option.value).filter(Boolean)
assert(outYears.length === 1 && outYears[0] === String(assignment.crop_year) && (control(binsContainer, 'Crop year') as HTMLSelectElement).value === String(assignment.crop_year), 'Bin-out must offer only the lot this bin holds, and fill it in when it is the only one.')
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
assert(seenMovements.length === 5 && seenMovements.every((item) => item.crop_year === assignment.crop_year) && novemberWorkspace.bin_transactions.every((item) => item.crop_year === assignment.crop_year), 'No movement may reach the ledger without the crop year it was saved with.')
assert(idIndex === idOrder.length && Number(contractWrites) === 1 && Number(deliveryWrites) === 4 && Number(binWrites) === 1 && Number(movementWrites) === 5 && novemberWorkspace.bin_transactions.length === 2, 'November flows must use the ten intended draft IDs, one invocation per rapid-submit action, and only canonical rows.')
await act(async () => { binsRoot.unmount() }); binsContainer.remove(); win.close()
console.log('Grain receipt UI regression passed')

// FD-1 (FD-009): a Today grain-delivery intent lands on the newest crop year's contracts, not the oldest estimate the repository lists first.
{
  const estimates = [{ id: 'a', crop_year: 2024 }, { id: 'b', crop_year: 2026 }, { id: 'c', crop_year: 2026 }, { id: 'd', crop_year: 2025 }]
  assert(deliveryDefaultEstimate(estimates)?.id === 'b', 'Delivery mode must default to the newest crop year, keeping the first estimate of that year.')
  assert(deliveryDefaultEstimate([]) === undefined, 'No estimates, no default.')
  console.log('Grain delivery default-estimate regression passed')
}
