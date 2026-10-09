import { Window } from 'happy-dom'
import React, { createElement, useState } from 'react'
import { act } from 'react'
import { ActualVsPlan, Bins, ContractActions, ContractEntry, deliveryDefaultEstimate, FirstEstimate, lotGapText, NeedsEstimate, planSavedNoticeFor, PlanStatus, planWithoutMonth, PositionCard, READ_ONLY_GRAIN, TargetEditor, UntrackedStoredGrain, upcomingCropMissing } from './GrainModule'
import { SaveReceipt } from './components/SaveReceipt'
import { ConfirmDialogHost } from './components/ConfirmDialog'
import { fieldsSeedForRegression } from './data/MockFieldsRepository'
import { basisCentsPrompt, recordedBinLots, type BinTransaction, type FirmOffer, type GrainBin, type GrainContract, type GrainContractDelivery, type GrainLoad, type GrainServices, type GrainWorkspace, type ProductionEstimate } from './data/grain'
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
let createdCalls = 0; const createdEstimates: ProductionEstimate[] = []; let reconciledCalls = 0; let nextId = uid(701); let releaseCreate!: () => void; let releaseReconcile!: () => void
const createGate = new Promise<void>((resolve) => { releaseCreate = resolve }); const reconcileGate = new Promise<void>((resolve) => { releaseReconcile = resolve })
const repository = { getData: async () => workspace, saveProductionEstimate: async (value: ProductionEstimate) => { createdCalls += 1; createdEstimates.push(structuredClone(value)); setSaveReceipt(value.id, 'saving'); await createGate; setSaveReceipt(value.id, 'saved') }, reconcileHarvestActual: async (value: ProductionEstimate, actual: number) => { reconciledCalls += 1; setSaveReceipt(value.id, 'saving'); await reconcileGate; assert(actual === 1_300, 'Reconciliation must use the Harvest total.'); setSaveReceipt(value.id, 'saved') } }
const services = { grainRepository: repository, createGrainId: () => nextId, profitabilityRepository: { getBreakeven: async () => null, getWorkspace: async () => ({ budgets: [], allocations: [] }) } } as unknown as GrainServices

// Each component shows its own receipt; the harnesses add no page-level receipt, so a duplicate would be the component's own.
function FirstHarness() { return createElement(FirstEstimate, { workspace: { ...workspace, production_estimates: [] }, services, onSaved: async () => undefined }) }
function ReconcileHarness() { return createElement(PositionCard, { estimate, workspace, services, saleLimit: null, onSaleLimitChange: () => undefined, onSaved: async () => undefined }) }
const countOf = (container: HTMLElement, text: string) => (container.textContent ?? '').split(text).length - 1

const firstContainer = document.createElement('div'); document.body.append(firstContainer); const firstRoot = createRoot(firstContainer)
let firstUnmounted = false; let reconcileContainer: HTMLDivElement | null = null; let reconcileRoot: ReturnType<typeof createRoot> | null = null
try {
  await act(async () => { firstRoot.render(createElement(FirstHarness)); await flush() })
  // Grain usability: each crop has its own yield box, and Create with a blank box says why instead of doing nothing.
  const yieldInputs = [...firstContainer.querySelectorAll('input')] as HTMLInputElement[]; assert(yieldInputs.length > 1, 'Each crop and year without an estimate must get its own expected-yield box.')
  const createButtons = [...firstContainer.querySelectorAll('button')].filter((button) => button.textContent === 'Create estimate') as HTMLButtonElement[]
  await act(async () => { createButtons[1].dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() })
  assert(firstContainer.textContent?.includes('Enter an expected yield above zero.') && Number(createdCalls) === 0, 'Create with a blank yield must explain itself on that card and send nothing.')
  // Sweep #10: a decimal comma is named as not a number, not as a missing yield (a number box would have reported it blank).
  const secondYield = firstContainer.querySelectorAll('input')[1] as HTMLInputElement
  await change(secondYield, '180,5'); await act(async () => { createButtons[1].dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() })
  assert(secondYield.value === '180,5' && firstContainer.textContent?.includes('Type the expected yield as a number, like 180.5.') && !firstContainer.textContent?.includes('Enter an expected yield above zero.') && Number(createdCalls) === 0, `A comma in the yield must be named and send nothing: ${firstContainer.textContent}`)
  await change(secondYield, '')
  assert(firstContainer.textContent?.includes('ac planted'), 'Each crop card must show its planted acres.')
  const aph = firstContainer.querySelector('input') as HTMLInputElement; await act(async () => { Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, 'value')!.set!.call(aph, ' 180 '); aph.dispatchEvent(new (win.InputEvent ?? win.Event)('input', { bubbles: true }) as unknown as Event); aph.dispatchEvent(new Event('change', { bubbles: true })); await flush() })
  const create = [...firstContainer.querySelectorAll('button')].find((button) => button.textContent === 'Create estimate') as HTMLButtonElement | undefined; assert(create && aph.value === ' 180 ' && !create.disabled, 'First estimate must keep the controlled APH value and genuinely enable Create estimate before submission.')
  assert(([...firstContainer.querySelectorAll('input')] as HTMLInputElement[])[1].value === '' && firstContainer.textContent?.includes('bu expected'), 'A yield typed for one crop must not fill another crop\'s box, and the typed crop shows its expected bushels.')
  await act(async () => { create.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() })
  assert(firstContainer.textContent?.includes('Saving…') && createdCalls === 1, 'First estimate must select its exact generated ID and render Saving before the create returns.')
  // Review of #68: the box kept " 180 " as typed, and the estimate is started at the 180 bu/ac it reads as.
  assert(createdEstimates[0]?.aph_yield === 180, `" 180 " starts the estimate at 180 bu/ac: ${createdEstimates[0]?.aph_yield}`)
  // Review repair: the receipt shows once, on the card of the crop being created, not above the whole grid as well.
  assert(countOf(firstContainer, 'Saving…') === 1 && firstContainer.querySelectorAll('article')[0]?.textContent?.includes('Saving…') && !firstContainer.querySelectorAll('article')[1]?.textContent?.includes('Saving…'), 'The first-estimate receipt must show once, on the crop being created only.')
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
  assert(countOf(renderedReconcileContainer, 'Saving…') === 1 && reconcile.nextElementSibling?.textContent === 'Saving…', 'Review repair: the reconciliation receipt shows once, beside Use harvest total, not also beside Save production or the toggle.')
  releaseReconcile(); await act(async () => { await flush(); await flush() }); const savedCalls = Number(reconciledCalls); assert(savedCalls === 1 && renderedReconcileContainer.textContent?.includes('Saved'), 'Harvest reconciliation must remain one direct write and render Saved when its receipt completes.'); window.confirm = previousConfirm
  // Grain usability: with no insurance unit and no Revenue Protection on a budget there is no guarantee to show, so the card says
  // "Not entered" and where to add it, never "0 bu" (which reads as no room left to sell).
  const metricValue = (label: string) => [...renderedReconcileContainer.querySelectorAll('div')].find((item) => item.querySelector(':scope > span')?.textContent === label)?.querySelector(':scope > strong')?.textContent
  assert(metricValue('Insurance estimate guarantee') === 'Not entered' && metricValue('Insurance estimate remaining') === 'Not entered' && metricValue('Insurance floor estimate') === 'Not entered' && renderedReconcileContainer.textContent?.includes("Add Revenue Protection coverage to this crop's budget in Profitability"), 'No coverage must read Not entered with where to add it, not 0 bu.')
  // The Actual button is not greyed out with no reason: with no actual bushels saved it says what to do and saves nothing.
  const productionCallsBefore = createdCalls
  await click(button(renderedReconcileContainer, 'Actual'))
  assert(renderedReconcileContainer.textContent?.includes('Enter actual bushels below and tap Save production, then tap Actual.') && createdCalls === productionCallsBefore, 'Actual with no actual bushels must explain itself and make no save.')
  const guidance = renderedReconcileContainer.querySelector('.actual-bushels-field .position-guidance'); const actualBox = control(renderedReconcileContainer, 'Actual bushels')
  assert(guidance?.textContent?.startsWith('Enter actual bushels') && guidance.getAttribute('role') === null && guidance.nextElementSibling?.contains(actualBox) && actualBox.getAttribute('aria-describedby') === guidance.id, 'Review repair: the Actual guidance is a plain hint directly above the Actual bushels box, not an alert at the bottom of the card.')
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
    await act(async () => { emptyRoot.render(createElement(MemoryRouter, null, createElement(FirstEstimate, { workspace: { ...workspace, production_estimates: [], fields: { ...fields, crop_assignments: [] } }, services, onSaved: async () => undefined }))); await flush() })
    const fieldsLink = [...emptyContainer.querySelectorAll('a')].find((item) => item.textContent === 'Add crops in Fields')
    assert(fieldsLink?.getAttribute('href') === '/fields' && !emptyContainer.querySelector('.loading-state') && emptyContainer.textContent?.includes('No crops to track yet'), 'A farm with no crop assignments must get one sentence and a link to Fields, not a loading placeholder.')

    const loadFields = structuredClone(fields); for (const item of loadFields.crop_assignments) item.harvested_bushels = null
    const loadAssignment = loadFields.crop_assignments[0]
    const load: GrainLoad = { id: uid(730), farm_id: fields.farm.id, load_date: '2026-10-02', truck_equipment_id: null, truck_name: null, origin_kind: 'field', origin_grain_bin_id: null, origin_crop_assignment_id: loadAssignment.id, destination_kind: 'buyer', destination_buyer: 'Synthetic Elevator', destination_grain_contract_id: null, destination_grain_bin_id: null, commodity_id: loadAssignment.commodity_id, crop_year: loadAssignment.crop_year, gross_lbs: null, tare_lbs: null, net_bushels: 2_500, moisture_pct: null, ticket_number: null, photo_path: null, notes: null, effect_bin_out: false, effect_bin_in: false, effect_contract_delivery: false, effect_harvest: true, voided_at: null, void_reason: null, created_at: stamp, updated_at: stamp }
    const cardEstimate: ProductionEstimate = { ...estimate, id: uid(731) }
    const cardWorkspace: GrainWorkspace = { ...workspace, fields: loadFields, production_estimates: [cardEstimate], grain_loads: [load] }
    let productionSaves = 0; const productionGate = gate(); const savedProduction: ProductionEstimate[] = []
    const cardServices = { ...services, grainRepository: { ...repository, saveProductionEstimate: async (value: ProductionEstimate) => { productionSaves += 1; savedProduction.push(structuredClone(value)); setSaveReceipt(value.id, 'saving'); await productionGate.promise; setSaveReceipt(value.id, 'saved') } } } as unknown as GrainServices
    await act(async () => { cardRoot.render(createElement(MemoryRouter, null, createElement(PositionCard, { estimate: cardEstimate, workspace: cardWorkspace, services: cardServices, saleLimit: null, onSaleLimitChange: () => undefined, onSaved: async () => undefined }))); await flush() })
    assert(cardContainer.querySelector('.eyebrow')?.textContent === `${cardEstimate.crop_year} crop`, 'The card header must name the crop year, not repeat the crop family.')
    await click(button(cardContainer, 'Edit yield'))
    assert(cardContainer.textContent?.includes('Load tickets show 2,500 bu, more than the harvest total entered. To use them, tap Use load total on Harvest.') && [...cardContainer.querySelectorAll('a')].some((item) => item.getAttribute('href') === '/harvest'), 'Load-ticket harvest must be shown with the way to adopt it on Harvest.')
    assert(button(cardContainer, 'Use harvest total as Grain actual').disabled && cardContainer.textContent?.includes('No harvest total entered yet on Harvest.'), 'Load tickets are never adopted here: the action stays off and says why.')
    const yieldBox = control(cardContainer, 'Expected yield') as HTMLInputElement
    assert(document.activeElement === yieldBox, 'Edit yield must open More details and put the cursor in the yield box.')
    await change(yieldBox, ''); await click(button(cardContainer, 'Save production'))
    assert(cardContainer.textContent?.includes('Enter an expected yield above zero (bu/ac).') && Number(productionSaves) === 0, 'A blank yield must be explained beside the card and never sent as 0.')
    // Sweep #10/#11: a decimal comma in either box is named and nothing is sent; Actual bushels gets the decimal keypad.
    await change(yieldBox, '180,5'); await click(button(cardContainer, 'Save production'))
    assert(cardContainer.textContent?.includes('Type the expected yield as a number, like 180.5.') && !cardContainer.textContent?.includes('Enter an expected yield above zero') && Number(productionSaves) === 0, `A comma in the yield must be named, not called blank: ${cardContainer.textContent}`)
    const cardActual = control(cardContainer, 'Actual bushels') as HTMLInputElement
    assert(cardActual.getAttribute('inputmode') === 'decimal', 'An actual can be part of a bushel, so its keypad must have a decimal key.')
    await change(yieldBox, '175'); await change(cardActual, '45210,5'); await click(button(cardContainer, 'Save production'))
    assert(cardContainer.textContent?.includes('A comma in actual bushels is read only as a thousands mark') && Number(productionSaves) === 0, `A comma in the actual must be named and never sent as a cleared actual: ${cardContainer.textContent}`)
    // Review of #68: "45210,125" is a decimal comma (or a slip), not 45,210,125 bu -- refused by name, nothing sent.
    await change(cardActual, '45210,125'); await click(button(cardContainer, 'Save production'))
    assert(cardActual.value === '45210,125' && cardContainer.textContent?.includes('A comma in actual bushels is read only as a thousands mark') && Number(productionSaves) === 0, `"45210,125" must be refused, never saved as 45,210,125 bu: ${JSON.stringify(savedProduction.map((item) => item.actual_bushels))}`)
    // A thousands-grouped actual is kept as typed in the box and saved as the number it reads as; so is a yield typed with spaces.
    await change(cardActual, '45,210.5')
    await change(yieldBox, ' 175 '); await click(button(cardContainer, 'Save production'))
    assert(yieldBox.value === ' 175 ', `The yield box keeps what was typed: "${yieldBox.value}"`)
    assert((control(cardContainer, 'Actual bushels') as HTMLInputElement).value === '45,210.5' && savedProduction[0]?.actual_bushels === 45_210.5 && savedProduction[0]?.aph_yield === 175, `"45,210.5" saves as 45210.5 bu: ${JSON.stringify(savedProduction[0] && { aph: savedProduction[0].aph_yield, actual: savedProduction[0].actual_bushels })}`)
    assert(productionSaves === 1 && cardContainer.textContent?.includes('Saving…'), 'The card must show its own Saving for a production save.')
    assert(countOf(cardContainer, 'Saving…') === 1 && button(cardContainer, 'Save production').nextElementSibling?.textContent === 'Saving…', 'Review repair: a production save shows its one receipt beside Save production.')
    productionGate.release(); await act(async () => { await flush(); await flush() })
    assert(cardContainer.textContent?.includes('Saved'), 'The card must show its own Saved once the production save completes.')
    // Review repair: once the load total has been used on Harvest (the harvest total equals it), there is nothing left to adopt.
    const usedFields = structuredClone(loadFields); usedFields.crop_assignments[0].harvested_bushels = 2_500
    const usedEstimate = { ...cardEstimate, id: uid(732) }
    await act(async () => { cardRoot.render(createElement(MemoryRouter, null, createElement(PositionCard, { key: 'used', estimate: usedEstimate, workspace: { ...cardWorkspace, fields: usedFields, production_estimates: [usedEstimate] }, services: cardServices, saleLimit: null, onSaleLimitChange: () => undefined, onSaved: async () => undefined }))); await flush() })
    await click(button(cardContainer, 'More details'))
    assert(cardContainer.textContent?.includes('Harvest actuals: 2,500 bu') && !cardContainer.textContent?.includes('Load tickets show') && !button(cardContainer, 'Use harvest total as Grain actual').disabled, 'The load-ticket hint must hide once the harvest total already holds the load total.')
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
    let closes = 0
    await act(async () => { editRoot.render(createElement(TargetEditor, { month: 10, commodity: '2026 Yellow Corn — whole farm', target: october, scope, services, workspace: planWorkspace, error: 'Farm Rx could not save this target right now. Please try again.', onClose: () => { closes += 1 }, onSave: () => undefined, onRemove: () => { removes += 1 } })); await flush() })
    assert(container.querySelector('.target-modal [role="alert"]')?.textContent === 'Farm Rx could not save this target right now. Please try again.', 'A failed save must be shown inside the modal, not behind it.')
    assert((control(container, 'Target % of production') as HTMLInputElement).value === '50', 'Editing a month keeps its own percentage, and its own 50% is not counted twice against the 100% check.')
    await click(button(container, 'Remove this month')); assert(removes === 1, 'A month with a target offers Remove this month.')
    // Full review: the month editor is a real modal: named, focus starts in the % box, and Escape closes it.
    const modal = container.querySelector('.target-modal') as HTMLElement
    assert(modal.getAttribute('role') === 'dialog' && modal.getAttribute('aria-modal') === 'true' && (modal.getAttribute('aria-labelledby') ?? '').split(' ').every((id) => id && document.getElementById(id)) && document.activeElement === control(container, 'Target % of production'), 'The month editor must be a named modal with focus in its % box.')
    // Full review: removing a month sends the plan minus that month only, from whatever plan is newest, and leaves other crops alone.
    const otherCrop = { ...planTarget(742, `${scope.crop_year}-12-01`, 10), commodity_id: 'soybeans' }
    const newerMonth = planTarget(743, `${scope.crop_year}-12-01`, 5)
    assert(JSON.stringify(planWithoutMonth([...planWorkspace.marketing_plan_targets, newerMonth, otherCrop], scope, october.id).map((row) => row.id)) === JSON.stringify([uid(740), uid(743)]), 'Remove this month must keep every other month of this crop, including one added since, and nothing of another crop.')
    await act(async () => { document.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }) as unknown as Event); await flush() })
    assert(closes === 1, 'Escape must close the month editor.')
    await act(async () => { editRoot.unmount() })
  } finally { container.remove() }
}

// Review repairs (Overview and plan): the 100% check keeps its decimals, a month's own % is not counted twice on a real submit, a
// breakeven still loading is not called "not available", and the cash target takes quarter cents.
{
  const scope = { farm_id: fields.farm.id, crop_year: estimate.crop_year, commodity_id: estimate.commodity_id, operating_entity_id: null, enterprise_label: null }
  const planTarget = (n: number, month: string, pct: number) => ({ id: uid(n), ...scope, target_month: month, target_pct_of_production: pct, target_price: null, breakeven_relative_pct: null, deadline: null, notes: null, created_at: stamp, updated_at: stamp })
  const september = planTarget(750, `${scope.crop_year}-09-01`, 60); const october = planTarget(751, `${scope.crop_year}-10-01`, 50)
  const saves: Array<{ pct: number; price: number | null }> = []
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  const render = async (key: string, props: Partial<Parameters<typeof TargetEditor>[0]>) => { await act(async () => { root.render(createElement(TargetEditor, { key, month: 11, commodity: '2026 Yellow Corn — whole farm', scope, services, workspace: { ...workspace, marketing_plan_targets: [september] }, onClose: () => undefined, onSave: (values) => { saves.push(values) }, ...props })); await flush() }) }
  const submit = async () => { const save = button(container, 'Save target'); await act(async () => { save.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() }) }
  try {
    await render('decimals', {})
    assert(container.querySelector('.modal-heading .eyebrow')?.textContent === 'Nov plan', 'The month editor eyebrow names the month only; the heading already carries the crop year.')
    assert(control(container, 'Cash price target').getAttribute('step') === 'any', 'The cash target box must take quarter-cent prices.')
    await change(control(container, 'Target % of production'), '40.4'); await submit()
    assert(container.textContent?.includes('Your plan would add up to 100.4% of the crop.') && saves.length === 0, '60% + 40.4% must read 100.4%, not a rounded 100%.')
    await render('own-month', { month: 10, target: october, workspace: { ...workspace, marketing_plan_targets: [{ ...september, target_pct_of_production: 50 }, october] } })
    await submit()
    assert(Number(saves.length) === 1 && saves[0].pct === 50 && !container.querySelector('[role="alert"]'), 'Saving a 50% month beside another 50% month must save once: its own 50% is not counted twice.')
    const loadingServices = { ...services, profitabilityRepository: { ...services.profitabilityRepository, getBreakeven: () => new Promise<null>(() => undefined) } } as unknown as GrainServices
    await render('loading', { services: loadingServices, workspace })
    await change(control(container, 'Target % of production'), '10'); await change(control(container, 'ROI target'), '5')
    assert(container.querySelector('.computed-price')?.textContent === 'Checking breakeven…', 'While breakeven loads, the preview says so instead of "not available".')
    await submit()
    assert(container.textContent?.includes('Checking breakeven… try again in a moment.') && !container.textContent?.includes('not available') && Number(saves.length) === 1, 'A % over breakeven submitted while breakeven loads must ask to wait, not call it unavailable, and save nothing.')
    const pricedServices = { ...services, profitabilityRepository: { ...services.profitabilityRepository, getBreakeven: async () => 4 } } as unknown as GrainServices
    await render('priced', { services: pricedServices, workspace })
    await change(control(container, 'ROI target'), '3.1875')
    assert(container.querySelector('.computed-price')?.textContent?.includes('target $4.1275') && (control(container, 'Cash price target') as HTMLInputElement).value === '4.1275', 'A computed target is shown to the quarter cent, not rounded to $4.13.')
    // Full review: the ROI box takes any step, so the browser cannot silently refuse 3.1875%; and the save goes through.
    assert(control(container, 'ROI target').getAttribute('step') === 'any', 'The ROI box must not carry a step the browser enforces.')
    await change(control(container, 'Target % of production'), '10'); await submit()
    assert(Number(saves.length) === 2 && Math.abs((saves[1].price ?? 0) - 4.1275) < 1e-9, 'A quarter-step ROI target must save its computed price.')
    // Full review: a validation message goes as soon as the farmer changes the box it is about.
    await change(control(container, 'Target % of production'), '101'); await submit()
    assert(container.textContent?.includes('Your plan would add up to'), 'The 100% check must speak first.')
    await change(control(container, 'Target % of production'), '5')
    assert(!container.querySelector('.target-modal [role="alert"]'), 'Lowering the % must clear the old "add up to" message.')
  } finally { await act(async () => { root.unmount() }); container.remove() }
}

// Sweep #2: a saved month whose % over breakeven is left as it was keeps its saved price while breakeven loads or cannot be read
// (offline, no Profitability access), and a save that changes only the month's % goes through with that price. A changed % still
// needs breakeven, so the old price is never stored beside a new %.
{
  const scope = { farm_id: fields.farm.id, crop_year: estimate.crop_year, commodity_id: estimate.commodity_id, operating_entity_id: null, enterprise_label: null }
  const march = { id: uid(755), ...scope, target_month: `${scope.crop_year}-03-01`, target_pct_of_production: 20, target_price: 4.62, breakeven_relative_pct: 10, deadline: null, notes: null, created_at: stamp, updated_at: stamp }
  const saves: Array<{ pct: number; price: number | null; relativePct: number | null }> = []
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  const failingServices = { ...services, profitabilityRepository: { ...services.profitabilityRepository, getBreakeven: async () => { throw new Error('Failed to fetch') } } } as unknown as GrainServices
  const loadingServices = { ...services, profitabilityRepository: { ...services.profitabilityRepository, getBreakeven: () => new Promise<null>(() => undefined) } } as unknown as GrainServices
  const render = async (key: string, editorServices: GrainServices) => { await act(async () => { root.render(createElement(TargetEditor, { key, month: 3, commodity: '2026 Yellow Corn — whole farm', target: march, scope, services: editorServices, workspace: { ...workspace, marketing_plan_targets: [march] }, onClose: () => undefined, onSave: (values) => { saves.push(values) } })); await flush() }) }
  const submit = async () => { const save = button(container, 'Save target'); await act(async () => { save.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() }) }
  const priceBox = () => control(container, 'Cash price target') as HTMLInputElement
  try {
    await render('unavailable', failingServices)
    assert(priceBox().value === '4.62' && container.querySelector('.computed-price')?.textContent?.includes('$4.62 (saved)'), `With breakeven unreadable, the saved $4.62 must stay in view: box "${priceBox().value}", ${container.querySelector('.computed-price')?.textContent}`)
    await change(control(container, 'Target % of production'), '25'); await submit()
    assert(Number(saves.length) === 1 && saves[0].pct === 25 && saves[0].price === 4.62 && saves[0].relativePct === 10 && !container.querySelector('.target-modal [role="alert"]'), `Changing only the month's % must save with the saved price and %: ${JSON.stringify(saves)} ${container.querySelector('.target-modal [role="alert"]')?.textContent}`)
    await change(control(container, 'ROI target'), '12'); await submit()
    assert(Number(saves.length) === 1 && container.textContent?.includes("Breakeven isn't available for this crop yet") && priceBox().value === '', 'A changed % with no breakeven must still be refused, never saved beside the old price.')
    await render('loading', loadingServices)
    assert(priceBox().value === '4.62' && container.querySelector('.computed-price')?.textContent === 'Checking breakeven… Saved target $4.62', `While breakeven loads, the saved price stays in view: box "${priceBox().value}", ${container.querySelector('.computed-price')?.textContent}`)
    // Review of #68: while breakeven is still loading, even an unchanged month waits -- the breakeven about to arrive may work
    // out a different price than the one saved, so the saved price is used only once breakeven has loaded as unavailable.
    await submit()
    assert(Number(saves.length) === 1 && container.querySelector('.target-modal [role="alert"]')?.textContent === 'Checking breakeven… try again in a moment.', `A save while breakeven loads must wait, not store the saved price: ${JSON.stringify(saves)} ${container.querySelector('.target-modal [role="alert"]')?.textContent}`)
    await change(control(container, 'Target % of production'), '30'); await submit()
    assert(Number(saves.length) === 1 && container.querySelector('.target-modal [role="alert"]')?.textContent === 'Checking breakeven… try again in a moment.', `A changed month % while breakeven loads must wait too: ${JSON.stringify(saves)}`)
  } finally { await act(async () => { root.unmount() }); container.remove() }
}

// Sweep #21: the Contracts note asks for the crop about to be sold ahead, not calendar year + 1. With 2026 and 2027 set up, New
// Year's Day must not bring it back asking for 2028; from September the next crop is asked for, and the year is named.
{
  const years = (...list: number[]) => list.map((crop_year) => ({ crop_year }))
  assert(upcomingCropMissing(years(2026, 2027), '2026-12-31') === null && upcomingCropMissing(years(2026, 2027), '2027-01-01') === null, `New Year's Day must not ask for a crop two seasons out: ${upcomingCropMissing(years(2026, 2027), '2027-01-01')}`)
  assert(upcomingCropMissing(years(2026, 2027), '2027-08-31') === null && upcomingCropMissing(years(2026, 2027), '2027-09-01') === 2028, 'From September, as harvest starts, the next crop is asked for.')
  assert(upcomingCropMissing(years(2026), '2026-10-15') === 2027 && upcomingCropMissing(years(2026), '2027-01-01') === 2027 && upcomingCropMissing(years(2025), '2026-03-01') === 2026, 'A missing coming crop is named by its year.')
}

// Review repairs: plan notices, the plan status with no plan, the needs-an-estimate prompt, untracked stored grain, and the lot
// gap wording.
{
  const { MemoryRouter } = await import('react-router')
  assert(planSavedNoticeFor('blocked') === 'Plan saved.' && planSavedNoticeFor('synced') === 'Plan saved.', 'A direct save while other saves are parked is saved, not "kept on this device".')
  assert(planSavedNoticeFor('pending') === 'Plan kept on this device. It will save when you have signal.' && planSavedNoticeFor('syncing') === planSavedNoticeFor('pending'), 'Only a queued save says it is kept on this device.')

  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  const show = async (element: React.ReactElement) => { await act(async () => { root.render(createElement(MemoryRouter, null, element)); await flush() }) }
  try {
    await show(createElement(PlanStatus, { estimate, workspace }))
    assert(container.textContent?.includes('Plan progress') && container.textContent.includes('No plan yet. Pick a template or tap a month.') && !container.textContent.includes('Your plan calls for') && !container.textContent.includes('isn’t in any month'), 'With no plan, the plan status says so once instead of "calls for 0%" and "100% not planned".')

    // Full review (HANDS-OP-a): carry-over of the same commodity sits in another lot, so the plan's "in bins" counts this crop year only.
    const carryBin = { id: uid(765), farm_id: fields.farm.id, name: 'Mixed bin', capacity_bu: 10_000, location_type: 'on_farm', location_name: null, notes: null, moisture_pct: null, moisture_checked_on: null, created_at: stamp, updated_at: stamp } as GrainBin
    const lotIn = (n: number, cropYear: number, amount: number) => ({ id: uid(n), farm_id: fields.farm.id, grain_bin_id: carryBin.id, direction: 'in', bushels: amount, commodity_id: estimate.commodity_id, crop_year: cropYear, occurred_on: '2025-10-01', note: null, source_kind: 'manual', grain_load_id: null, created_at: stamp }) as BinTransaction
    await show(createElement(PlanStatus, { estimate, workspace: { ...workspace, grain_bins: [carryBin], bin_transactions: [lotIn(766, estimate.crop_year - 1, 1_000), lotIn(767, estimate.crop_year, 2_000)] } }))
    assert(container.textContent?.includes(`2,000 bu of the ${estimate.crop_year} crop in bins`), `The plan status must count only this crop year's lot in bins, not the carry-over: ${container.textContent}`)

    await show(createElement(NeedsEstimate, { tabLabel: 'Firm offers', hasCrops: true }))
    assert(container.textContent === 'The Firm offers tab is kept per crop and year, so start your first crop estimate on the Overview.Go to Overview' && container.querySelector('a')?.getAttribute('href') === '/grain', 'The needs-estimate prompt is one sentence naming the open tab, with Go to Overview.')
    await show(createElement(NeedsEstimate, { tabLabel: 'Alerts', hasCrops: true }))
    assert(container.textContent?.startsWith('Most of the Alerts tab is kept per crop and year'), 'Alerts holds farm-wide email settings too, so it is "most of" the tab.')
    await show(createElement(NeedsEstimate, { tabLabel: 'Firm offers', hasCrops: true, canWrite: false }))
    assert(container.textContent?.includes(READ_ONLY_GRAIN) && !container.querySelector('a'), 'A member who may only view is not sent to start an estimate they cannot save.')
    await show(createElement(NeedsEstimate, { tabLabel: 'Plan', hasCrops: false }))
    assert(container.querySelector('a')?.getAttribute('href') === '/fields' && container.textContent?.includes('add your crops in Fields first'), 'With no crops at all, the prompt goes to Fields, where crops are added.')

    const bin: GrainBin = { id: uid(760), farm_id: fields.farm.id, name: 'Old crop bin', capacity_bu: 10_000, location_type: 'on_farm', location_name: null, notes: null, moisture_pct: null, moisture_checked_on: null, created_at: stamp, updated_at: stamp } as GrainBin
    const stored = (n: number, crop_year: number): BinTransaction => ({ id: uid(n), farm_id: fields.farm.id, grain_bin_id: bin.id, direction: 'in', bushels: 1_500.5, commodity_id: estimate.commodity_id, crop_year, occurred_on: '2025-10-01', note: null, source_kind: 'manual', grain_load_id: null, created_at: stamp }) as BinTransaction
    await show(createElement(UntrackedStoredGrain, { workspace: { ...workspace, production_estimates: [], grain_bins: [bin], bin_transactions: [stored(761, 2019)] } }))
    assert(container.textContent?.includes('1,500.50 bu in bins.') && container.textContent.includes('No 2019 estimate, so this grain has no card here. Haul it out under Loads; it still counts on Bins & basis.') && [...container.querySelectorAll('a')].some((item) => item.getAttribute('href') === '/grain/loads') && !container.textContent.includes('can’t be recorded'), 'Untracked stored grain must say it can be hauled under Loads, not that its sales cannot be recorded.')
    await show(createElement(UntrackedStoredGrain, { workspace: { ...workspace, production_estimates: [], grain_bins: [bin], bin_transactions: [stored(762, estimate.crop_year)] } }))
    assert(container.textContent?.includes(`No ${estimate.crop_year} estimate yet, so this grain has no card here. Enter its expected yield under Add another crop below.`), 'Stored grain of a crop planted that year points to Add another crop.')
  } finally { await act(async () => { root.unmount() }); container.remove() }

  const year = estimate.crop_year
  const contract = (n: number, bushelCount: number) => ({ id: uid(n), farm_id: fields.farm.id, crop_year: year, commodity_id: estimate.commodity_id, operating_entity_id: null, enterprise_label: null, contract_type: 'forward_cash', buyer: 'Elevator', bushels: bushelCount, futures_price: null, basis: null, cash_price: 4.5, delivery_start: null, delivery_end: null, contract_number: null, premium_cents_per_bu: 0, notes: null, created_at: stamp, updated_at: stamp }) as GrainContract
  const wholeFarm = { ...estimate, expected_bushels: 10_000, actual_bushels: null }
  const entityEstimate = { ...estimate, id: uid(770), operating_entity_id: uid(771), expected_bushels: 6_000 }
  const gapFor = (estimates: ProductionEstimate[], contracted: number, free: number) => lotGapText({ ...workspace, production_estimates: estimates, grain_contracts: [contract(772, contracted)] }, estimate.commodity_id, year, free)
  assert(JSON.stringify(gapFor([wholeFarm], 4_000, -4_000)) === JSON.stringify({ bushels: 4_000, text: 'bu sold but not in the bins yet', short: false }), 'New crop sold ahead within the estimate is "not in the bins yet", with the number given separately.')
  assert(gapFor([{ ...wholeFarm, actual_bushels: 9_000 }], 4_000, -4_000)?.text === 'bu sold but not in the bins', 'After harvest (actual bushels entered) the gap is not "yet" to come in.')
  assert(JSON.stringify(gapFor([wholeFarm], 12_000.5, -12_000.5)) === JSON.stringify({ bushels: 2_000.5, text: `bu more sold than your ${year} crop estimate`, short: true }), 'Past the estimate it is oversold, by the exact amount.')
  assert(gapFor([wholeFarm, entityEstimate], 12_000, -12_000)?.short === true, 'An entity estimate beside the whole-farm one is not added to it, so 12,000 sold against a 10,000 bu crop is oversold.')
  assert(gapFor([entityEstimate, { ...entityEstimate, id: uid(773), operating_entity_id: uid(774) }], 12_000, -12_000)?.short === false, 'With no whole-farm estimate, the entity estimates together are the crop.')
  assert(JSON.stringify(gapFor([], 500, -500)) === JSON.stringify({ bushels: 500, text: 'bu short', short: true }) && gapFor([wholeFarm], 0, 0) === null, 'No estimate is plainly short; no gap is nothing.')
  // Sweep #23: 12,000 sold against a 10,000 bu estimate with 11,000 already delivered and nothing stored owes 1,000. The red
  // figure is the 1,000 still owed, never the 2,000 "more sold" (which counts bushels already delivered).
  assert(JSON.stringify(gapFor([wholeFarm], 12_000, -1_000)) === JSON.stringify({ bushels: 1_000, text: 'bu short', short: true }), `Once deliveries eat into it, the gap is what is still owed: ${JSON.stringify(gapFor([wholeFarm], 12_000, -1_000))}`)
  // A decimal projection is compared as the card shows it (29,741 bu), so the gap and the production figure add up on screen.
  assert(gapFor([{ ...wholeFarm, expected_bushels: 29_740.65 }], 30_000, -30_000)?.bushels === 259, `30,000 sold against a projection shown as 29,741 is 259 more: ${gapFor([{ ...wholeFarm, expected_bushels: 29_740.65 }], 30_000, -30_000)?.bushels}`)
  // Review of #68: "more sold" is decided on the cent figures, not on the estimate rounded to a whole bushel. 29,740.10 sold
  // against a 29,740.40 bu estimate is within it; 29,740.90 against 29,740.65 is past it, by the cents, never by 0 or less.
  assert(JSON.stringify(gapFor([{ ...wholeFarm, expected_bushels: 29_740.4 }], 29_740.1, -29_740.1)) === JSON.stringify({ bushels: 29_740.1, text: 'bu sold but not in the bins yet', short: false }), `29,740.10 sold against a 29,740.40 estimate is not "more sold": ${JSON.stringify(gapFor([{ ...wholeFarm, expected_bushels: 29_740.4 }], 29_740.1, -29_740.1))}`)
  assert(JSON.stringify(gapFor([{ ...wholeFarm, expected_bushels: 29_740.65 }], 29_740.9, -29_740.9)) === JSON.stringify({ bushels: 0.25, text: `bu more sold than your ${year} crop estimate`, short: true }), `29,740.90 sold against 29,740.65 is 0.25 more: ${JSON.stringify(gapFor([{ ...wholeFarm, expected_bushels: 29_740.65 }], 29_740.9, -29_740.9))}`)
  assert(gapFor([{ ...wholeFarm, expected_bushels: 29_740.4 }], 29_740.4, -29_740.4)?.short === false, 'Sold exactly the estimate is not more sold.')
}

// Sweep (displayed figures): the same figure reads the same on every tab. Recorded bushels keep their cents, prices and
// break-even keep their quarter cents, planted acres are en-US on any phone, and a cents basis is asked about as typed.
{
  const { MemoryRouter } = await import('react-router')
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  const show = async (element: React.ReactElement) => { await act(async () => { root.render(createElement(MemoryRouter, null, element)); await flush() }) }
  const year = estimate.crop_year
  const scope = { farm_id: fields.farm.id, crop_year: year, commodity_id: estimate.commodity_id, operating_entity_id: null, enterprise_label: null }
  const target = (price: number | null) => ({ id: uid(793), ...scope, target_month: `${year}-10-01`, target_pct_of_production: 50, target_price: price, breakeven_relative_pct: null, deadline: null, notes: null, created_at: stamp, updated_at: stamp })
  const sale = { id: uid(794), ...scope, contract_type: 'forward_cash', buyer: 'Elevator', bushels: 1_000.5, futures_price: null, basis: null, cash_price: 4.5, delivery_start: null, delivery_end: null, contract_number: null, premium_cents_per_bu: 0, notes: null, created_at: stamp, updated_at: stamp } as GrainContract
  const bin = { id: uid(795), farm_id: fields.farm.id, name: 'Decimal bin', capacity_bu: 10_000, location_type: 'on_farm', location_name: null, notes: null, moisture_pct: null, moisture_checked_on: null, created_at: stamp, updated_at: stamp } as GrainBin
  const stored = { id: uid(796), farm_id: fields.farm.id, grain_bin_id: bin.id, direction: 'in', bushels: 1_000.5, commodity_id: estimate.commodity_id, crop_year: year, occurred_on: '2026-10-01', note: null, source_kind: 'manual', grain_load_id: null, created_at: stamp } as BinTransaction
  try {
    // #28: the Plan tab shows recorded bushels as the Overview and the Contracts total do, 1,000.50 rather than 1,001.
    await show(createElement(PlanStatus, { estimate, workspace: { ...workspace, grain_bins: [bin], bin_transactions: [stored] } }))
    assert(container.textContent?.includes(`1,000.50 bu of the ${year} crop in bins`), `The plan status shows the lot to the cent: ${container.textContent}`)
    await show(createElement(ActualVsPlan, { estimate, workspace: { ...workspace, marketing_plan_targets: [target(null)], grain_contracts: [sale] } }))
    assert(container.querySelector('tfoot')?.textContent?.startsWith('Contracted so far1,000.50 bu ('), `Contracted so far shows the contracts to the cent: ${container.querySelector('tfoot')?.textContent}`)

    // #25/#33/#29: one card. The cash target and break-even are shown to the quarter cent everywhere on it, and the harvest
    // total at the precision of the load figure beside it.
    const harvestFields = structuredClone(fields); for (const item of harvestFields.crop_assignments) item.harvested_bushels = null
    harvestFields.crop_assignments[0]!.harvested_bushels = 999.6
    const cardEstimate = { ...estimate, id: uid(797) }
    const priceServices = { ...services, profitabilityRepository: { ...services.profitabilityRepository, getBreakeven: async () => 650 / 155 } } as unknown as GrainServices
    await show(createElement(PositionCard, { estimate: cardEstimate, workspace: { ...workspace, fields: harvestFields, production_estimates: [cardEstimate], marketing_plan_targets: [target(4.1275)], grain_bins: [bin], bin_transactions: [stored] }, services: priceServices, saleLimit: null, onSaleLimitChange: () => undefined, onSaved: async () => undefined }))
    await click(button(container, 'More details'))
    const cardText = container.textContent ?? ''
    assert(cardText.includes('Breakeven $4.1935.') && cardText.includes('using your cash price target of $4.1275.') && cardText.includes('Cash price target $4.1275'), `The cash target and break-even must not be rounded to the cent on the card: ${cardText}`)
    assert(cardText.includes('Harvest actuals: 999.60 bu'), `Harvest actuals keep their cents: ${cardText}`)
    // Review of #68: the bins figure beside them keeps its cents too, as every other bushel figure in the reconciliation does.
    assert(cardText.includes('(whole farm, all years): 1,000.50 bu'), `The harvest reconciliation's bins figure keeps its cents: ${cardText.match(/All bins holding[^.]*/)?.[0]}`)

    // #34: planted acres are en-US even when the phone's own number style is German.
    const nativeToLocale = Number.prototype.toLocaleString
    Number.prototype.toLocaleString = function (this: number, ...args: Parameters<typeof nativeToLocale>) { return nativeToLocale.call(this, args[0] ?? 'de-DE', args[1]) }
    try {
      await show(createElement(FirstEstimate, { workspace: { ...workspace, production_estimates: [], fields: { ...fields, crop_assignments: [{ ...assignment, planted_acres: 1_234.5 }] } }, services, onSaved: async () => undefined }))
      assert(container.textContent?.includes(`${assignment.crop_year} crop · 1,234.5 ac planted`), `Planted acres must not follow the device locale: ${container.textContent}`)
    } finally { Number.prototype.toLocaleString = nativeToLocale }
  } finally { await act(async () => { root.unmount() }); container.remove() }

  // #16: the question shows the basis exactly as it will be saved, not rounded to the cent.
  assert(basisCentsPrompt(-35.125).title === 'Basis of -$35.125 per bushel?' && basisCentsPrompt(-3.1275).title === 'Basis of -$3.1275 per bushel?' && basisCentsPrompt(-35).title === 'Basis of -$35.00 per bushel?', `The cents-basis question must show the typed basis: ${basisCentsPrompt(-35.125).title}`)
}

// Review repairs (position card): a sale limit a read-only member cannot save is not offered; its error sits outside the label and
// is tied to the box; and coverage says Checking until it is checked, then Not entered when the RP estimate is ambiguous.
{
  const { MemoryRouter } = await import('react-router')
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  const metricValue = (label: string) => [...container.querySelectorAll('div')].find((item) => item.querySelector(':scope > span')?.textContent === label)?.querySelector(':scope > strong')?.textContent
  const metricNote = (label: string) => [...container.querySelectorAll('div')].find((item) => item.querySelector(':scope > span')?.textContent === label)?.querySelector(':scope > small')?.textContent
  const card = async (key: string, cardEstimate: ProductionEstimate, cardServices: GrainServices, props: Partial<Parameters<typeof PositionCard>[0]> = {}) => {
    await act(async () => { root.render(createElement(MemoryRouter, null, createElement(PositionCard, { key, estimate: cardEstimate, workspace: { ...workspace, production_estimates: [cardEstimate] }, services: cardServices, saleLimit: 9_000, onSaleLimitChange: () => undefined, onSaved: async () => undefined, ...props }))); await flush() })
    await click(button(container, 'More details'))
  }
  try {
    await card('read-only', { ...estimate, id: uid(780) }, services, { saleLimitPersisted: true, canWriteSettings: false })
    const readOnlyBox = control(container, 'Your sale limit') as HTMLInputElement
    assert(readOnlyBox.disabled && readOnlyBox.value === '9000' && container.textContent?.includes('Only someone who can edit this farm can save a sale limit.') && !container.textContent.includes('Saves for this farm when you leave this box.'), 'A read-only member sees the farm sale limit but is not promised a save.')
    await card('error', { ...estimate, id: uid(781) }, services, { saleLimitPersisted: true, saleLimitError: 'That sale limit is too large to save.' })
    const errorBox = control(container, 'Your sale limit') as HTMLInputElement; const errorLine = container.querySelector('.sale-limit-field > [role="alert"]')
    assert(!errorBox.disabled && errorLine?.textContent === 'That sale limit is too large to save.' && !errorLine.closest('label') && errorBox.getAttribute('aria-describedby') === errorLine.id && errorBox.getAttribute('aria-invalid') === 'true', 'The sale-limit error sits after the label and is tied to the box.')

    const pendingServices = { ...services, profitabilityRepository: { ...services.profitabilityRepository, getWorkspace: () => new Promise(() => undefined) } } as unknown as GrainServices
    await card('checking', { ...estimate, id: uid(782) }, pendingServices)
    assert(metricValue('Insurance estimate guarantee') === 'Checking…' && metricNote('Insurance estimate guarantee') === 'Checking coverage…' && !container.textContent?.includes('Add Revenue Protection coverage'), 'Until coverage is checked, the card says Checking, not "add coverage".')
    const budget = (n: number) => ({ id: uid(n), farm_id: fields.farm.id, crop_year: estimate.crop_year, commodity_id: estimate.commodity_id, operating_entity_id: null, enterprise_label: null, rp_coverage_pct: 75, rp_aph_yield: 180, rp_projected_price: 4.5, rp_premium_per_acre: null })
    const ambiguousServices = { ...services, profitabilityRepository: { ...services.profitabilityRepository, getWorkspace: async () => ({ budgets: [budget(783), budget(784)], allocations: [{ budget_id: uid(783), crop_assignment_id: assignment.id, allocated_acres: 10 }, { budget_id: uid(784), crop_assignment_id: assignment.id, allocated_acres: 10 }] }) } } as unknown as GrainServices
    await card('ambiguous', { ...estimate, id: uid(785) }, ambiguousServices)
    assert(metricValue('Insurance estimate guarantee') === 'Not entered' && metricValue('Insurance estimate remaining') === 'Not entered' && metricNote('Insurance estimate guarantee')?.includes('allocated to more than one budget in Profitability'), 'An RP estimate that cannot be used (a field in two budgets) with no insurance unit reads Not entered with why, never 0 bu.')
    // A contract saved for the same crop reads coverage again; what is shown stays until that read settles, with no flash of Checking.
    const sameScopeEstimate = { ...estimate, id: uid(785) }
    await act(async () => { root.render(createElement(MemoryRouter, null, createElement(PositionCard, { key: 'ambiguous', estimate: sameScopeEstimate, workspace: { ...workspace, production_estimates: [sameScopeEstimate], grain_contracts: [{ id: uid(786), farm_id: fields.farm.id, crop_year: estimate.crop_year, commodity_id: estimate.commodity_id, operating_entity_id: null, enterprise_label: null, contract_type: 'forward_cash', buyer: 'Elevator', bushels: 1_000, futures_price: null, basis: null, cash_price: 4.5, delivery_start: null, delivery_end: null, contract_number: null, premium_cents_per_bu: 0, notes: null, created_at: stamp, updated_at: stamp } as GrainContract] }, services: pendingServices, saleLimit: 9_000, onSaleLimitChange: () => undefined, onSaved: async () => undefined }))); await flush() })
    assert(metricValue('Already contracted') === '1,000 bu' && metricValue('Insurance estimate guarantee') === 'Not entered', 'A refetch for the same crop scope must not flash back to Checking.')
    // Full review: a coverage read that fails says so; it never tells the farmer to add coverage that may already be saved.
    const failingServices = { ...services, profitabilityRepository: { ...services.profitabilityRepository, getWorkspace: async () => { throw new Error('no signal') } } } as unknown as GrainServices
    await card('read-failed', { ...estimate, id: uid(787) }, failingServices)
    assert(metricValue('Insurance estimate guarantee') === 'Not available' && metricNote('Insurance estimate guarantee') === 'Coverage could not be checked right now.' && metricValue('Insurance floor estimate') === 'Not available' && !container.textContent?.includes('Add Revenue Protection coverage'), 'A failed coverage read must read Not available, not Not entered with "add coverage".')
    // Full review: Projected / Actual changes only which figure drives the math; a yield typed but never saved is not sent with it.
    const toggled: ProductionEstimate[] = []
    const toggleServices = { ...services, grainRepository: { ...services.grainRepository, saveProductionEstimate: async (value: ProductionEstimate) => { toggled.push(value) } } } as unknown as GrainServices
    await card('toggle', { ...estimate, id: uid(788), aph_yield: 180, actual_bushels: 1_200, drives_math: 'projected' }, toggleServices)
    assert(button(container, 'Projected').getAttribute('aria-pressed') === 'true' && button(container, 'Actual').getAttribute('aria-pressed') === 'false', 'The toggle must say which choice is active to a screen reader.')
    await change(control(container, 'Expected yield'), '999'); await change(control(container, 'Actual bushels'), '')
    await click(button(container, 'Actual'))
    assert(toggled.length === 1 && toggled[0].drives_math === 'actual' && toggled[0].aph_yield === 180 && toggled[0].actual_bushels === 1_200, `The toggle must send the saved yield and actual, never an unsaved draft: ${JSON.stringify(toggled[0])}`)
    // Full review: a member who may only view gets no production writes, and is told why once.
    await card('read-only-production', { ...estimate, id: uid(789) }, services, { canWriteSettings: false })
    assert(button(container, 'Save production').disabled && button(container, 'Projected').disabled && button(container, 'Actual').disabled && container.textContent?.includes(READ_ONLY_GRAIN), 'A view-only member must not be offered production saves the server refuses.')
    // Full review: units with no insured acres have no floor to show, rather than $NaN.
    await card('zero-acres', { ...estimate, id: uid(790) }, services, { workspace: { ...workspace, production_estimates: [{ ...estimate, id: uid(790) }], insurance_units: [{ id: uid(791), farm_id: fields.farm.id, crop_year: estimate.crop_year, commodity_id: estimate.commodity_id, operating_entity_id: null, enterprise_label: null, insured_acres: 0, aph: 180, coverage_level_pct: 75, revenue_guarantee_per_acre: 600, guarantee_per_bu: 3.5 }] } as unknown as GrainWorkspace })
    assert(!container.textContent?.includes('NaN'), 'An insurance floor over zero insured acres must not print $NaN.')
  } finally { await act(async () => { root.unmount() }); container.remove() }
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

const { MemoryRouter: ContractRouter } = await import('react-router')
const contractContainer = document.createElement('div'); document.body.append(contractContainer); const contractRoot = createRoot(contractContainer)
await act(async () => { contractRoot.render(createElement(ContractRouter, null, createElement(ContractHarness), createElement(ConfirmDialogHost))); await flush() })
// Grain usability (s1b): the form names the crop it saves to, takes quarter cents, and gives the basis box a keyboard with a minus key.
assert(contractContainer.querySelector('.contract-entry-scope')?.textContent === `New sale for ${estimate.crop_year} Yellow Corn — whole farm`, `C6: Add contract must name the crop and year it saves to. ${contractContainer.querySelector('.contract-entry-scope')?.textContent}`)
assert(control(contractContainer, 'Cash $/bu').getAttribute('step') === 'any', 'C0: the contract price box must take quarter cents.')
// C19: a cash price typed, then the type switched to HTA, must not become the futures price.
await change(control(contractContainer, 'Cash $/bu'), '4.50'); await change(control(contractContainer, 'Type'), 'hta')
assert((control(contractContainer, 'Futures $/bu') as HTMLInputElement).value === '', 'C19: switching to HTA must clear a typed cash price.')
await change(control(contractContainer, 'Type'), 'basis')
const contractBasis = control(contractContainer, 'Basis $/bu') as HTMLInputElement
assert(contractBasis.getAttribute('step') === 'any' && contractBasis.getAttribute('inputmode') === null && contractBasis.getAttribute('placeholder') === '-0.35', 'C1: the contract basis box must take quarter cents with a minus key.')
await change(control(contractContainer, 'Buyer'), 'County elevator'); await change(control(contractContainer, 'Bushels'), '12000'); await change(contractBasis, '-35')
const submitContractForm = async () => { const form = button(contractContainer, 'Add contract').form!; await act(async () => { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() }) }
await submitContractForm()
assert(openDialog()?.textContent?.includes('Basis of -$35.00 per bushel?') && Number(contractWrites) === 0 && Number(idIndex) === 0, 'C8: a contract basis that looks like cents must ask before saving, spending no id.')
await click(dialogButton('Go back')); assert(Number(contractWrites) === 0 && Number(idIndex) === 0 && contractBasis.value === '-35', 'C8: Go back keeps the typed basis and saves nothing.')
await change(control(contractContainer, 'Type'), 'forward_cash'); await change(control(contractContainer, 'Cash $/bu'), '5')
// C4: delivery dates the wrong way round are explained beside the button, and the hidden date boxes are opened to show them.
await change(control(contractContainer, 'Start'), `${estimate.crop_year}-11-30`); await change(control(contractContainer, 'End'), `${estimate.crop_year}-09-01`)
const contractDetails = contractContainer.querySelector('.contract-entry details') as HTMLDetailsElement
await act(async () => { contractDetails.open = false; contractDetails.dispatchEvent(new Event('toggle')); await flush() })
await submitContractForm()
assert(contractContainer.querySelector('.contract-entry [role="alert"]')?.textContent === 'Delivery end must be on or after delivery start.' && contractDetails.open && Number(contractWrites) === 0 && Number(idIndex) === 0, 'C4: a delivery end before its start must be named and the dates shown, with no save and no id spent.')
await change(control(contractContainer, 'Start'), ''); await change(control(contractContainer, 'End'), '')
// C9: the premium box is in cents, so a dollars-looking 0.1 asks first.
assert([...contractContainer.querySelectorAll('label')].some((item) => item.textContent?.startsWith('Premium, cents per bu')), 'C9: the premium label must say it is in cents.')
await change(control(contractContainer, 'Premium, cents per bu'), '0.1'); await submitContractForm()
assert(openDialog()?.textContent?.includes('Premium of 0.1¢ per bushel?') && openDialog()?.textContent?.includes('For 10¢, type 10.') && Number(contractWrites) === 0, 'C9: a premium under one cent must ask before saving.')
await click(dialogButton('Go back')); await change(control(contractContainer, 'Premium, cents per bu'), '')
// Sweep #9: the bushels column keeps two decimals, so a third is refused with no save and no id spent, never rounded unseen.
await change(control(contractContainer, 'Bushels'), '12000.125'); await submitContractForm()
assert(contractContainer.querySelector('.contract-entry [role="alert"]')?.textContent === 'Bushels can have at most 2 decimals.' && Number(contractWrites) === 0 && Number(idIndex) === 0, `A third decimal on Add contract must be refused before any save: ${contractContainer.querySelector('.contract-entry [role="alert"]')?.textContent}`)
await change(control(contractContainer, 'Bushels'), '12000')
assert((control(contractContainer, 'Bushels') as HTMLInputElement).value === '12000' && (control(contractContainer, 'Cash $/bu') as HTMLInputElement).value === '5', `Contract controlled values were not retained: ${[...contractContainer.querySelectorAll('input')].map((item) => item.value).join('|')}`)
const addContract = button(contractContainer, 'Add contract')
assert(addContract.form, 'Contract submit button must belong to the real form.')
await act(async () => { addContract.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); addContract.form!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() })
assert(contractWrites === 1 && seenContracts[0]?.id === novemberIds.contract && contractContainer.textContent?.includes('Saving…'), `Contract create must show Saving for its exact generated ID and lock a real double submit to one write. writes=${contractWrites} id=${seenContracts[0]?.id} text=${contractContainer.textContent}`)
contractGate.release(); await act(async () => { await flush(); await flush() })
assert(contractWrites === 1 && contractContainer.textContent?.includes('Saved'), 'Contracts owning area must show Saved for the exact completed contract ID.')
assert(seenContracts[0]?.delivery_start === null && seenContracts[0]?.delivery_end === null, 'C3: a contract the farmer never dated must be saved undated, not with a hidden Sep-Nov window.')
// B37: a ticket number typed with commas is kept as the plain number. C7: the delivery carries the date and note typed.
const deliveryInput = control(contractContainer, 'Delivered bushels') as HTMLInputElement; await change(deliveryInput, '13,000')
assert(deliveryInput.value === '13,000', `B37: delivered bushels must accept 1,200-style commas, kept as typed. ${deliveryInput.value}`)
await change(control(contractContainer, 'Delivered on'), `${estimate.crop_year}-09-28`); await change(control(contractContainer, 'Ticket # or note'), 'Ticket 4411')
let genericContractWritesBeforeDelivery = contractWrites
const priorNovemberConfirm = window.confirm; window.confirm = () => { throw new Error('window.confirm must not be used: the in-app dialog host is mounted.') }; let deliveryConfirmations = 0
async function answerOverDelivery(answer: 'Record anyway' | 'Go back') { assert(openDialog()?.textContent?.includes('more than the contract. Record anyway?'), 'Each delivery attempt must cross the real over-delivery confirmation boundary.'); deliveryConfirmations += 1; await click(dialogButton(answer)) }
await click(button(contractContainer, 'Record delivery'))
assert(deliveryWrites === 0 && openDialog()?.textContent?.includes('This is 1,000 bu more than the contract. Record anyway?'), 'The over-delivery dialog must state the exact excess before any write.'); await answerOverDelivery('Go back'); assert(deliveryWrites === 0 && openDialog() === null, 'Cancelling the real over-delivery confirmation must perform zero writes.')
const recordDelivery = button(contractContainer, 'Record delivery'); await act(async () => { recordDelivery.click(); recordDelivery.click(); await flush() }); await answerOverDelivery('Record anyway')
assert(deliveryWrites === 0 && attemptedDeliveries.length === 1 && attemptedDeliveries[0]?.id === novemberIds.deliveryOffline && contractContainer.textContent?.includes('Needs attention') && contractContainer.textContent?.includes('Connect to the internet before recording a delivery.') && !contractContainer.textContent?.includes('may be recorded') && !(control(contractContainer, 'Delivered bushels') as HTMLInputElement).disabled && button(contractContainer, 'Record delivery'), 'Offline delivery must make zero server calls, remain editable, avoid ambiguous copy, and discard its failed draft ID.')
deliveryMode = 'ambiguous'
const correctedDelivery = button(contractContainer, 'Record delivery'); await act(async () => { correctedDelivery.click(); correctedDelivery.click(); await flush() }); await answerOverDelivery('Record anyway')
assert(Number(deliveryWrites) === 1 && seenDeliveries[0]?.id === novemberIds.delivery && contractContainer.textContent?.includes('Saving…'), 'Delivery must show Saving for one exact stable draft ID.')
assert(seenDeliveries[0]?.delivered_on === `${estimate.crop_year}-09-28` && seenDeliveries[0]?.note === 'Ticket 4411' && seenDeliveries[0]?.bushels === 13_000, 'C7: a delivery must be sent with the date and ticket note the farmer typed.')
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
assert([...contractContainer.querySelectorAll('.contract-actions a')].some((item) => item.getAttribute('href') === '/grain/loads') && contractContainer.textContent?.includes('a load that names this contract counts here automatically.'), 'B4/C16: the delivery box must steer a truck out of a bin to Loads.')
assert(!contractContainer.textContent?.includes('Correct or delete') && contractContainer.querySelector('.contract-locked-note')?.textContent?.includes('can no longer be corrected or deleted'), 'C2a: a delivered contract must say why it can no longer be corrected, not just drop the control.')
// C26: Go / Enter in the delivery box submits its own small form.
const deliveryForm = control(contractContainer, 'Delivered bushels').closest('form') as HTMLFormElement | null; assert(deliveryForm && deliveryForm.querySelector('button[type="submit"]')?.textContent === 'Record delivery', 'C26: Delivered bushels and Record delivery must share a form so Enter records.')
await act(async () => { deliveryForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() })
assert(contractContainer.querySelector('.contract-action-message')?.textContent === 'Enter delivered bushels.' && Number(deliveryWrites) === 4, 'C26: submitting the delivery form (Enter / Go) must run Record delivery, and say plainly what is missing.')
await act(async () => { contractRoot.unmount() }); contractContainer.remove()

// Grain usability (s1b): a contract that load tickets already deliver against asks before a hand-typed delivery; Cancel correction
// throws the abandoned edit away; and a basis set on an HTA keeps its quarter cents and warns when it looks like cents.
{
  const { MemoryRouter } = await import('react-router')
  const scope = { farm_id: fields.farm.id, crop_year: estimate.crop_year, commodity_id: estimate.commodity_id, operating_entity_id: null, enterprise_label: null }
  const hta: GrainContract = { id: uid(1401), ...scope, contract_type: 'hta', buyer: 'River terminal', bushels: 5_000, cash_price: null, futures_price: 4.74, basis: null, delivery_start: null, delivery_end: null, contract_number: null, premium_cents_per_bu: 0, notes: null, created_at: stamp, updated_at: stamp }
  const loaded: GrainContract = { ...hta, id: uid(1402), contract_type: 'forward_cash', cash_price: 4.5, futures_price: null, buyer: 'Feed mill' }
  const ticketDelivery: GrainContractDelivery = { id: uid(1403), farm_id: fields.farm.id, grain_contract_id: loaded.id, bushels: 1_000, delivered_on: '2026-10-01', note: null, created_at: stamp, grain_load_id: uid(1404) }
  const actionsWorkspace: GrainWorkspace = { ...workspace, grain_contracts: [hta, loaded], grain_contract_deliveries: [ticketDelivery], capabilities: { contract_deliveries: true, contract_price_finalization: true, bin_movements: true } }
  let deliveryCalls = 0; let finalizeCalls = 0; let ids = 0
  const actionServices = { ...services, createGrainId: () => uid(1500 + ids++), grainRepository: { recordContractDelivery: async () => { deliveryCalls += 1 }, finalizeContractPriceLeg: async () => { finalizeCalls += 1 } } } as unknown as GrainServices
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  const render = async (contract: GrainContract) => { await act(async () => { root.render(createElement(MemoryRouter, null, createElement(ContractActions, { key: contract.id, contract, workspace: actionsWorkspace, services: actionServices, onSaved: async () => undefined, onDeliverySaved: async () => undefined, onReceipt: () => undefined }), createElement(ConfirmDialogHost))); await flush() }) }
  try {
    await render(loaded)
    assert(container.textContent?.includes('1,000 bu came from load tickets.') && container.querySelector('.contract-locked-note')?.textContent?.includes('void its load ticket under Loads'), 'C16/C2a: a contract delivered by load ticket must say so and name the undo.')
    await change(control(container, 'Delivered bushels'), '500'); await click(button(container, 'Record delivery'))
    assert(openDialog()?.textContent?.includes('Record this delivery by hand?') && deliveryCalls === 0, 'C16: a hand-typed delivery on a ticketed contract must ask first.')
    await click(dialogButton('Go back')); assert(deliveryCalls === 0 && ids === 0, 'C16: Go back must record nothing and spend no id.')
    await change(control(container, 'Delivered on'), '2999-01-01'); await click(button(container, 'Record delivery'))
    assert(container.textContent?.includes('The delivery date cannot be in the future.') && deliveryCalls === 0 && !openDialog(), 'C7: a future delivery date must be refused beside the box.')

    await render(hta)
    await click(button(container, 'Correct or delete')); await change(control(container, 'Buyer'), 'Typed by mistake')
    await click(button(container, 'Cancel correction')); await click(button(container, 'Correct or delete'))
    assert((control(container, 'Buyer') as HTMLInputElement).value === 'River terminal', 'C21: Cancel correction must throw away the abandoned edit.')
    const basisBox = control(container, 'Set basis $/bu') as HTMLInputElement
    assert(basisBox.getAttribute('step') === 'any' && basisBox.getAttribute('inputmode') === null && basisBox.closest('form'), 'C0/C1/C26: Set basis takes quarter cents, a minus key and Enter.')
    await change(basisBox, '-0.1275'); await click(button(container, 'Set basis'))
    assert(openDialog()?.textContent?.includes('Set basis to -$0.1275/bu?') && !openDialog()?.textContent?.includes('Basis is entered in dollars'), `C0: the confirm must show the quarter-cent basis exactly. ${openDialog()?.textContent}`)
    await click(dialogButton('Go back')); await change(basisBox, '-35'); await click(button(container, 'Set basis'))
    assert(openDialog()?.textContent?.includes('Basis is entered in dollars per bushel. For 35 cents under, go back and type -0.35.') && finalizeCalls === 0, 'C8: a basis that looks like cents must say so in the same confirm.')
    await click(dialogButton('Go back')); assert(finalizeCalls === 0, 'C8: Go back sets nothing.')
    assert(basisCentsPrompt(-35.25).body === 'Basis is entered in dollars per bushel. For 35.25 cents under, go back and type -0.3525.', `A quarter-cent basis typed as cents must be advised to the quarter cent: ${basisCentsPrompt(-35.25).body}`)
    // Full review: a price-box problem shows under the price box, not under the delivery boxes.
    await change(basisBox, ''); await click(button(container, 'Set basis'))
    assert(basisBox.closest('form')?.querySelector('.contract-action-message')?.textContent === 'Enter a valid basis.' && !control(container, 'Delivered bushels').closest('form')?.querySelector('.contract-action-message'), 'Set basis errors must sit in the Set basis form.')
    // Full review: delivered bushels are plain numbers with at most two decimals (the column keeps two, and a retry must match).
    await change(control(container, 'Delivered bushels'), '1200.555'); await click(button(container, 'Record delivery'))
    assert(container.textContent?.includes('Bushels can have at most 2 decimals.') && deliveryCalls === 0 && ids === 0, 'Three decimals must be refused before any id is taken.')
    await change(control(container, 'Delivered bushels'), '1e3'); await click(button(container, 'Record delivery'))
    assert(container.textContent?.includes('Type delivered bushels as a number, like 1200 or 1200.5.') && deliveryCalls === 0, 'An exponent is not a number of bushels.')
    // Sweep #12/#14: a typed zero or minus is told "more than zero" (something was entered), a decimal comma is named, and
    // "1200." reads as 1200 -- it goes on to the next question instead of being called not a number.
    for (const typed of ['0', '0.00', '-5']) {
      await change(control(container, 'Delivered bushels'), typed); await click(button(container, 'Record delivery'))
      const deliveryMessage = control(container, 'Delivered bushels').closest('form')?.querySelector('.contract-action-message')?.textContent
      assert(deliveryMessage === 'Delivered bushels must be more than zero.' && deliveryCalls === 0 && ids === 0, `"${typed}" must be told more than zero: ${deliveryMessage}`)
    }
    await change(control(container, 'Delivered bushels'), '1200,5'); await click(button(container, 'Record delivery'))
    assert(container.textContent?.includes('A comma in bushels is read only as a thousands mark, like 1,200.') && deliveryCalls === 0 && ids === 0, 'A decimal comma in Delivered bushels must be named.')
    await change(control(container, 'Delivered bushels'), '1200.'); await change(control(container, 'Delivered on'), `${hta.crop_year - 10}-10-02`); await click(button(container, 'Record delivery'))
    assert(openDialog()?.textContent?.includes(`That is before the ${hta.crop_year} crop.`) && deliveryCalls === 0, `"1200." must be read as 1200: ${container.querySelector('.contract-action-message')?.textContent}`)
    await click(dialogButton('Go back'))
    // Full review: a delivery dated before the contract's crop year (a year typo) is asked about; a manual delivery cannot be undone.
    await change(control(container, 'Delivered bushels'), '100'); await change(control(container, 'Delivered on'), `${hta.crop_year - 10}-10-02`); await click(button(container, 'Record delivery'))
    assert(openDialog()?.textContent?.includes(`That is before the ${hta.crop_year} crop.`) && deliveryCalls === 0, 'A delivery date before the crop year must be confirmed first.')
    await click(dialogButton('Go back')); assert(deliveryCalls === 0 && ids === 0, 'Go back records nothing.')
    assert(control(container, 'Delivered bushels').closest('form')?.hasAttribute('novalidate') && basisBox.closest('form')?.hasAttribute('novalidate'), 'The delivery and price forms check their own boxes, so the browser bubble never pre-empts the plain message.')
    // Review of #68: the box keeps what was typed. A comma that is not a thousands mark is refused by name, never read 1,000
    // times too big; a thousands-grouped amount is read as the number it is, and the over-delivery question names it.
    for (const typed of ['1200,500', '45210,125', ',500', '1,2345']) {
      await change(control(container, 'Delivered bushels'), typed); await click(button(container, 'Record delivery'))
      assert((control(container, 'Delivered bushels') as HTMLInputElement).value === typed && container.textContent?.includes('A comma in bushels is read only as a thousands mark, like 1,200.') && !openDialog() && deliveryCalls === 0 && ids === 0, `"${typed}" in Delivered bushels must be refused by name: ${container.querySelector('.contract-action-message')?.textContent} ${openDialog()?.textContent ?? ''}`)
    }
    await act(async () => { root.render(createElement(MemoryRouter, null, createElement(ContractActions, { key: 'thousands', contract: hta, workspace: actionsWorkspace, services: actionServices, onSaved: async () => undefined, onDeliverySaved: async () => undefined, onReceipt: () => undefined }), createElement(ConfirmDialogHost))); await flush() })
    await change(control(container, 'Delivered bushels'), '1,000,000'); await click(button(container, 'Record delivery'))
    assert((control(container, 'Delivered bushels') as HTMLInputElement).value === '1,000,000' && openDialog()?.textContent?.includes('This is 995,000 bu more than the contract. Record anyway?') && deliveryCalls === 0, `"1,000,000" must be read as a million against the 5,000 bu contract: ${openDialog()?.textContent}`)
    await click(dialogButton('Go back')); assert(deliveryCalls === 0 && ids === 0, 'Go back records nothing.')

    // Review of #68: the over-delivery excess is worked to the cent. 0.01 already delivered on a 2,267.70 bu contract plus
    // 2,267.69 now is exactly the contract (in floating point a hair over), so nothing is asked and the delivery is recorded.
    // A third decimal of zero ("2,267.690") is no third decimal.
    const exact: GrainContract = { ...loaded, id: uid(1407), buyer: 'Exact fill', bushels: 2_267.7 }
    const exactWorkspace = { ...actionsWorkspace, grain_contracts: [...actionsWorkspace.grain_contracts, exact], grain_contract_deliveries: [...actionsWorkspace.grain_contract_deliveries, { id: uid(1408), farm_id: fields.farm.id, grain_contract_id: exact.id, bushels: 0.01, delivered_on: '2026-10-01', note: null, created_at: stamp, grain_load_id: null }] } as GrainWorkspace
    const exactDeliveries: GrainContractDelivery[] = []
    const exactServices = { ...actionServices, grainRepository: { ...actionServices.grainRepository, recordContractDelivery: async (value: GrainContractDelivery) => { exactDeliveries.push(structuredClone(value)) } } } as unknown as GrainServices
    await act(async () => { root.render(createElement(MemoryRouter, null, createElement(ContractActions, { key: 'exact', contract: exact, workspace: exactWorkspace, services: exactServices, onSaved: async () => undefined, onDeliverySaved: async () => undefined, onReceipt: () => undefined }), createElement(ConfirmDialogHost))); await flush() })
    await change(control(container, 'Delivered bushels'), '2,267.690'); await click(button(container, 'Record delivery'))
    assert(!openDialog() && exactDeliveries.length === 1 && exactDeliveries[0]!.bushels === 2_267.69 && exactDeliveries[0]!.allow_overdelivery === false, `Filling a contract exactly must not ask about "0 bu more than the contract": ${openDialog()?.textContent ?? ''} ${JSON.stringify(exactDeliveries)} ${container.querySelector('.contract-action-message')?.textContent}`)
    if (openDialog()) await click(dialogButton('Go back'))

    // Full review: a contract with both load-ticket and hand-typed deliveries names both undo paths.
    const mixedWorkspace = { ...actionsWorkspace, grain_contract_deliveries: [ticketDelivery, { ...ticketDelivery, id: uid(1406), grain_load_id: null }] } as GrainWorkspace
    await act(async () => { root.render(createElement(MemoryRouter, null, createElement(ContractActions, { key: 'mixed', contract: loaded, workspace: mixedWorkspace, services: actionServices, onSaved: async () => undefined, onDeliverySaved: async () => undefined, onReceipt: () => undefined }), createElement(ConfirmDialogHost))); await flush() })
    const mixedNote = container.querySelector('.contract-locked-note')?.textContent ?? ''
    assert(mixedNote.includes('Deliveries from load tickets can be undone by voiding the ticket under Loads.') && mixedNote.includes('A delivery typed in by hand cannot be undone in Farm Rx yet.'), `Mixed deliveries must name both undo paths: ${mixedNote}`)

    // A10: an HTA offer's month is a futures month, so the delivery dates it fills in are shown and flagged for checking.
    const htaOffer: FirmOffer = { id: uid(1405), ...scope, buyer: 'River terminal', offer_type: 'hta', bushels: 5_000, price: 4.5, basis: null, contract_month: `${estimate.crop_year}-12`, expires_on: null, delivery_location: null, notes: null, status: 'open', filled_contract_id: null, created_at: stamp, updated_at: stamp }
    await act(async () => { root.render(createElement(MemoryRouter, null, createElement(ContractEntry, { workspace: actionsWorkspace, scope, services: actionServices, saleLimit: null, initialOffer: htaOffer, onFilled: async () => undefined, onSaved: async () => undefined, onReceipt: () => undefined }))); await flush() })
    assert((container.querySelector('.contract-entry details') as HTMLDetailsElement).open && container.querySelector('.contract-entry-hint')?.textContent?.includes("came from the offer's futures month") && (control(container, 'Start') as HTMLInputElement).value === `${estimate.crop_year}-12-01`, 'A10: dates taken from an HTA offer month must be shown with a check-them hint.')
  } finally { await act(async () => { root.unmount() }); container.remove() }
}

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
