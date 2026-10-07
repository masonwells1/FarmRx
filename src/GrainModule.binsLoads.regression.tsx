import { Window } from 'happy-dom'
import React, { createElement, useState } from 'react'
import { act } from 'react'
import { MemoryRouter } from 'react-router'
import { Basis, Bins, LoadsTab, movementSourceLabel } from './GrainModule'
import { ConfirmDialogHost } from './components/ConfirmDialog'
import { fieldsSeedForRegression } from './data/MockFieldsRepository'
import { loadDateInFutureProblem, netBushelsFromWeights, STANDARD_BUSHEL_LBS, validateGrainLoadShape, type BinTransaction, type CashBid, type GrainBin, type GrainContract, type GrainLoad, type GrainLoadDraft, type GrainServices, type GrainWorkspace } from './data/grain'
import { grainLoadPayload } from './data/SupabaseGrainDataGateway'
import { farmerError } from './lib/farmerErrors'
import { useSaveReceipt } from './lib/saveReceipt'

/** Grain usability (bins and loads): the bin form follows the bin that was tapped, the movement form
 * has its own button, and the load form shows every problem at once, works net bushels out from the
 * scale weights, asks before an over-delivery, and keeps an unconfirmed ticket locked to its id. */

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const stamp = '2026-10-01T00:00:00.000Z'

// ---------------------------------------------------------------- pure helpers
assert(netBushelsFromWeights('80000', '30000', STANDARD_BUSHEL_LBS.corn) === '892.86', 'Corn: 50,000 lb net is 892.86 bu at 56 lb/bu.')
assert(netBushelsFromWeights('62000', '32000', STANDARD_BUSHEL_LBS.soybeans) === '500.00', 'Soybeans: 30,000 lb net is 500 bu at 60 lb/bu.')
assert(netBushelsFromWeights('30000', '30000', 56) === null && netBushelsFromWeights('20000', '30000', 56) === null, 'No figure unless the loaded truck weighs more than the empty one.')
assert(netBushelsFromWeights('', '30000', 56) === null && netBushelsFromWeights('abc', '30000', 56) === null, 'No figure from a blank or a word.')
const baseDraft: GrainLoadDraft = { load_date: '2026-10-01', truck_equipment_id: '', truck_name: '', origin_kind: 'field', origin_grain_bin_id: '', origin_crop_assignment_id: uid(1), origin_crop_year: '', origin_commodity_id: '', destination_kind: 'buyer', destination_buyer: 'Co-op', destination_grain_contract_id: '', destination_grain_bin_id: '', gross_lbs: '', tare_lbs: '', net_bushels: '100', moisture_pct: '', ticket_number: '', notes: '', effect_bin_out: true, effect_bin_in: true, effect_contract_delivery: true, effect_harvest: true }
assert(validateGrainLoadShape({ ...baseDraft, net_bushels: 'abc' }).includes('Type net bushels as a number, like 1000.'), 'A word in net bushels is named as not a number, not as zero.')
assert(validateGrainLoadShape({ ...baseDraft, net_bushels: '' }).includes('Net bushels must be more than zero.'), 'A blank net still asks for more than zero.')
assert(validateGrainLoadShape({ ...baseDraft, gross_lbs: 'x' }).includes('Type the gross weight as a number of pounds.'), 'A word in gross weight is named, not silently dropped.')
assert(validateGrainLoadShape({ ...baseDraft, moisture_pct: '55' }).includes('Moisture must be between 0 and 40 percent.'), 'Load moisture is held to the same 0-40 as a bin reading.')
assert(loadDateInFutureProblem('2026-10-02', '2026-10-01') === 'The date hauled cannot be in the future.' && loadDateInFutureProblem('2026-10-01', '2026-10-01') === null, 'Only a date after today is refused.')
assert(movementSourceLabel('grain_load') === 'From a load ticket' && movementSourceLabel('manual entry') === 'Entered by hand' && movementSourceLabel(null) === 'Entered by hand', 'Bin history speaks in words, not stored codes.')
assert(farmerError(new Error('delivery would exceed the remaining contract bushels; confirm over-delivery to record it'), 'record this load').startsWith('This load is more than what is left on the contract.'), 'An over-delivery refusal says what to change, not "try again".')
assert(farmerError({ message: 'this movement would make the bin balance negative' }, 'add this movement').startsWith('That bin does not hold that many bushels'), 'A short bin is named.')
assert(farmerError(new Error('This movement would put more grain in the bin than it holds.'), 'record this load').startsWith('That would put more grain in the bin than it holds.'), 'A full bin is named.')
// The per-lot refusal a load out of a bin most often meets, in the server's words and the mock's.
assert(farmerError({ code: 'FR001', message: 'this bin does not hold that many bushels of the 2026 crop' }, 'record this load').startsWith('That bin does not hold that many bushels of that crop year.'), 'The per-lot refusal is named, not "try again".')
assert(farmerError(new Error('That bin does not hold enough of the 2026 crop.'), 'record this load').startsWith('That bin does not hold that many bushels of that crop year.'), 'The mock per-lot refusal is named too.')
assert(farmerError({ message: 'this bin still holds nonzero lots: corn_yellow; empty those lots before storing another crop' }, 'add this movement') === 'That bin still holds another crop. Empty it before putting a different crop in.', 'A bin holding another crop is named.')
// The over-delivery words fit the screen they appear on.
assert(farmerError(new Error('delivery would exceed the remaining contract bushels'), 'record this delivery').startsWith('This delivery is more than what is left on the contract. Reload,'), 'On a contract there is no load and no box to untick.')
assert(movementSourceLabel('harvest_import') === 'Harvest import', 'An unknown source is shown in words rather than as "Other".')
const contractDraft: GrainLoadDraft = { ...baseDraft, destination_kind: 'contract', destination_buyer: '', destination_grain_contract_id: uid(2) }
assert(grainLoadPayload(uid(3), { ...contractDraft, allow_overdelivery: true }).allow_overdelivery === true, 'A confirmed over-delivery travels with the save.')
assert(!('allow_overdelivery' in grainLoadPayload(uid(3), { ...baseDraft, allow_overdelivery: true })), 'No delivery happens on a buyer load, so the flag is not sent.')
assert(!('allow_overdelivery' in grainLoadPayload(uid(3), { ...contractDraft, effect_contract_delivery: false, allow_overdelivery: true })), 'An unticked delivery sends no flag.')
assert(!('allow_overdelivery' in grainLoadPayload(uid(3), contractDraft)), 'Nothing confirmed, nothing sent.')

// ---------------------------------------------------------------- DOM
const win = new Window({ url: 'http://farmrx.test/grain' })
Object.assign(globalThis, { React, window: win, document: win.document, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement, Node: win.Node, Event: win.Event, InputEvent: win.InputEvent, MouseEvent: win.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator })
const { createRoot } = await import('react-dom/client')
const flush = async () => { await Promise.resolve(); await new Promise<void>((resolve) => setTimeout(resolve, 0)) }
const openDialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null
function dialogButton(text: string) { const found = [...document.querySelectorAll('[role="dialog"] button')].find((item) => item.textContent === text) as HTMLButtonElement | undefined; assert(found, `Dialog button ${text} did not render.`); return found }
function control(container: HTMLElement, label: string, scope = 'label') {
  const row = [...container.querySelectorAll(scope)].find((item) => item.textContent?.trim().startsWith(label))
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
function button(container: ParentNode, text: string) {
  const found = [...container.querySelectorAll('button')].find((item) => item.textContent === text) as HTMLButtonElement | undefined
  assert(found, `Missing ${text} button.`)
  return found
}
async function click(element: HTMLElement) { await act(async () => { element.click(); await flush() }) }

const fields = fieldsSeedForRegression()
const bin = (n: number, name: string, capacity: number): GrainBin => ({ id: uid(n), farm_id: fields.farm.id, name, capacity_bu: capacity, location_type: 'on_farm', location_name: null, notes: null, moisture_pct: null, moisture_checked_on: null, created_at: stamp, updated_at: stamp })
const binA = bin(10, 'Alpha bin', 10_000); const binB = { ...bin(11, 'Bravo bin', 25_000), location_name: 'North yard' }
const fill: BinTransaction = { id: uid(12), farm_id: fields.farm.id, grain_bin_id: binA.id, direction: 'in', bushels: 5_000, commodity_id: 'corn_yellow', crop_year: 2026, occurred_on: '2026-09-20', note: null, source_kind: 'grain_load', grain_load_id: null, created_at: stamp }
const contract: GrainContract = { id: uid(20), farm_id: fields.farm.id, crop_year: 2026, commodity_id: 'corn_yellow', operating_entity_id: null, enterprise_label: null, contract_type: 'forward_cash', buyer: 'Riverside Elevator', bushels: 1_000, futures_price: null, basis: null, cash_price: 4.75, delivery_start: null, delivery_end: null, contract_number: null, premium_cents_per_bu: 0, notes: null, created_at: stamp, updated_at: stamp } as GrainContract
const workspace: GrainWorkspace = {
  fields, production_estimates: [], grain_contracts: [contract], grain_contract_deliveries: [{ id: uid(21), farm_id: fields.farm.id, grain_contract_id: contract.id, bushels: 900, delivered_on: '2026-09-25', note: null, created_at: stamp }], grain_loads: [],
  marketing_plan_targets: [], insurance_units: [], grain_bins: [binA, binB], bin_inventory: [], bin_transactions: [fill], cash_bids: [], usda_market_reports: [], usda_report_dates: [], marketing_alert_rules: [], firm_offers: [], grain_alert_settings: null, grain_sale_limits: [], grain_carry_settings: null, grain_carry_grids: [],
  capabilities: { contract_deliveries: true, contract_price_finalization: true, bin_movements: true, grain_loads: true, grain_load_effects: true, grain_load_bin_lot: true },
} as GrainWorkspace
const savedBins: GrainBin[] = []; const sentLoads: Array<{ id: string; draft: GrainLoadDraft }> = []; const savedBids: CashBid[] = []
let loadMode: 'lost' | 'ok' | 'refuse-over' = 'ok'
let nextId = 100
const repository = {
  getData: async () => workspace,
  listBinLots: async (binId: string) => binId === binA.id ? [{ commodity_id: 'corn_yellow', crop_year: 2026, bushels: 5_000 }] : [],
  listLoadTrucks: async () => [],
  upsertGrainBin: async (value: GrainBin) => { savedBins.push(value) },
  appendBinTransaction: async () => undefined,
  saveCashBid: async (value: CashBid) => { savedBids.push(value) },
  saveLoad: async (id: string, draft: GrainLoadDraft) => {
    sentLoads.push({ id, draft: structuredClone(draft) })
    if (loadMode === 'lost') throw new TypeError('Failed to fetch')
    if (loadMode === 'refuse-over') throw { code: 'FR001', message: 'delivery would exceed the remaining contract bushels; confirm over-delivery to record it' }
    return { id, farm_id: fields.farm.id, commodity_id: 'corn_yellow', crop_year: 2026, net_bushels: Number(draft.net_bushels) }
  },
} as unknown as GrainServices['grainRepository']
const services = { grainRepository: repository, createGrainId: () => uid(nextId++) } as unknown as GrainServices

const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
try {
  // ---- Bins: the bin form always shows the bin that was tapped (B0, B26).
  function BinsHarness({ canManageFarm }: { canManageFarm?: boolean }) { const [id, setId] = useState<string | null>(null); return createElement(Bins, { workspace, services, receipt: useSaveReceipt(id), onSaved: async () => undefined, onMovementSaved: async () => undefined, onReceipt: setId, canManageFarm }) }
  await act(async () => { root.render(createElement(MemoryRouter, null, createElement(BinsHarness, { canManageFarm: false }), createElement(ConfirmDialogHost))); await flush() })
  const cards = () => [...container.querySelectorAll('article.bin-card')] as HTMLElement[]
  const cardFor = (name: string) => cards().find((card) => card.textContent?.includes(name))!
  await click(button(cardFor('Alpha bin'), 'Edit bin'))
  assert((control(cardFor('Alpha bin'), 'Name') as HTMLInputElement).value === 'Alpha bin', 'Editing Alpha opens Alpha, inside its own card.')
  await click(button(cardFor('Bravo bin'), 'Edit bin'))
  assert(container.querySelectorAll('form.bin-form').length === 1 && !cardFor('Alpha bin').querySelector('form.bin-form'), 'Only one bin form is open, in the bin being edited.')
  assert((control(cardFor('Bravo bin'), 'Name') as HTMLInputElement).value === 'Bravo bin' && (control(cardFor('Bravo bin'), 'Capacity bushels') as HTMLInputElement).value === '25000', 'Switching to Bravo shows Bravo, never Alpha left over.')
  await click(button(container, 'Add bin'))
  assert(container.querySelectorAll('form.bin-form').length === 1 && (control(container, 'Name') as HTMLInputElement).value === '', 'Add bin opens a blank form and closes the edit.')
  await click(button(cardFor('Bravo bin'), 'Edit bin'))
  const bravoForm = cardFor('Bravo bin').querySelector('form.bin-form') as HTMLFormElement
  assert((control(bravoForm, 'Location name') as HTMLInputElement).value === 'North yard', 'Add then Edit shows the edited bin, not the blank Add values.')
  await act(async () => { bravoForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() })
  assert(savedBins.length === 1 && savedBins[0]!.id === binB.id && savedBins[0]!.name === 'Bravo bin' && savedBins[0]!.capacity_bu === 25_000 && savedBins[0]!.location_name === 'North yard', `The save carries Bravo's id with Bravo's values: ${JSON.stringify(savedBins[0])}`)
  // ---- Bins: the movement form has its own button (B10), and the empty bin's text (B41, B25).
  const bravo = cardFor('Bravo bin')
  assert((bravo.querySelector('.bin-move') as HTMLElement).hidden, 'The movement form waits behind its own button.')
  assert(bravo.textContent?.includes('Empty') && bravo.textContent.includes('· 0%'), 'An empty bin says Empty and 0%.')
  await click(button(bravo, 'Add or take out grain'))
  assert(!(bravo.querySelector('.bin-move') as HTMLElement).hidden && button(bravo, 'Close'), 'The button opens the form without opening the history.')
  assert(bravo.textContent?.includes('Hauled it on a truck? Record the load under Loads instead.'), 'The movement form points a hauled load at Loads.')
  await change(control(bravo, 'Direction'), 'out')
  assert(bravo.textContent?.includes('ask the farm owner to name the crop year of those older movements first.'), 'Someone who cannot see "Which crop year were these?" is sent to the farm owner instead.')
  await change(control(bravo, 'Bushels'), 'abc')
  await act(async () => { (bravo.querySelector('form.movement-form') as HTMLFormElement).dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() })
  assert(bravo.textContent?.includes('Type bushels as a number, like 1000.') && !bravo.textContent.includes('greater than zero'), 'A word in Bushels is named as not a number.')
  await change(control(bravo, 'Bushels'), '1,250')
  assert((control(bravo, 'Bushels') as HTMLInputElement).value === '1250', 'Commas typed off a ticket are dropped, not turned into nothing.')
  const alpha = cardFor('Alpha bin')
  assert(alpha.textContent?.includes('5,000 bu') && alpha.textContent.includes('· 50%'), 'A bin holding grain shows its fill.')
  await act(async () => { root.render(createElement('div')); await flush() })

  // ---- Loads.
  let lastSaved = 0
  function LoadsHarness() { return createElement(LoadsTab, { workspace, services, onSaved: async () => { lastSaved += 1 } }) }
  await act(async () => { root.render(createElement(MemoryRouter, null, createElement(LoadsHarness), createElement(ConfirmDialogHost))); await flush() })
  // Every problem at once, beside the Save button (B12).
  await click(button(container, 'Save load'))
  const listed = [...container.querySelectorAll('ul.load-problems li')].map((item) => item.textContent)
  assert(listed.length >= 3 && listed.includes('Net bushels must be more than zero.') && listed.includes('Pick the bin this load came from.') && listed.includes('Name the buyer or elevator this load went to.'), `Every problem is listed at once: ${JSON.stringify(listed)}`)
  assert(sentLoads.length === 0, 'A form with problems sends nothing.')
  await change(control(container, 'Bin', 'fieldset.load-origin label'), binA.id)
  const remaining = [...container.querySelectorAll('ul.load-problems li')].map((item) => item.textContent)
  assert(!remaining.includes('Pick the bin this load came from.') && remaining.includes('Net bushels must be more than zero.') && remaining.includes('Name the buyer or elevator this load went to.'), `A fixed problem drops off and the rest stay listed: ${JSON.stringify(remaining)}`)
  assert(control(container, 'Net bushels').getAttribute('aria-invalid') === 'true' && control(container, 'Bin', 'fieldset.load-origin label').getAttribute('aria-invalid') !== 'true', 'The box still wrong stays marked; the fixed one does not.')
  assert(container.textContent?.includes('This load is Yellow Corn, 2026 crop.'), 'The bin answers for its one lot.')
  // Net bushels from the scale weights (B3, B37).
  await change(control(container, 'Gross weight'), '80,000')
  await change(control(container, 'Tare weight'), '30000')
  assert((control(container, 'Net bushels') as HTMLInputElement).value === '892.86' && container.textContent?.includes('Worked out from the scale weights at 56 lb/bu.'), 'Gross and tare fill in net bushels at 56 lb/bu for corn.')
  await change(control(container, 'Net bushels'), '850')
  await change(control(container, 'Tare weight'), '31000')
  assert((control(container, 'Net bushels') as HTMLInputElement).value === '850', 'A net the farmer typed is never overwritten by the weights.')
  // Against the contract: the option says what is left (B7), and an over-delivery asks first (B1).
  const contractRadio = [...container.querySelectorAll('fieldset.load-destination label')].find((label) => label.textContent?.includes('Against a contract'))!.querySelector('input') as HTMLInputElement
  await click(contractRadio)
  const contractSelect = control(container, 'Contract', 'fieldset.load-destination label') as HTMLSelectElement
  assert([...contractSelect.options].some((option) => option.textContent === 'Riverside Elevator · 2026 · 100 bu left of 1,000'), `The contract option shows what is left: ${[...contractSelect.options].map((option) => option.textContent).join(' | ')}`)
  await change(contractSelect, contract.id)
  assert(container.textContent?.includes('100 bu left to deliver on this contract.'), 'The chosen contract says what is left on it.')
  await click(button(container, 'Save load'))
  assert(openDialog()?.textContent?.includes('This load is 750.00 bu more than is left on the contract. Record anyway?'), 'The over-delivery is named before any write.')
  await click(dialogButton('Go back'))
  assert(sentLoads.length === 0 && openDialog() === null, 'Go back makes no write.')
  // A lost response keeps the ticket and locks the form to it (B2, B13).
  loadMode = 'lost'
  await click(button(container, 'Save load')); await click(dialogButton('Record anyway'))
  assert(Number(sentLoads.length) === 1 && sentLoads[0]!.draft.allow_overdelivery === true, 'Record anyway sends the confirmation with the save.')
  const locked = container.querySelector('fieldset.load-fields') as HTMLFieldSetElement
  assert(locked.disabled && button(container, 'Retry load') && button(container, 'Start a different ticket'), 'A lost response locks every field behind Retry load.')
  assert(container.textContent?.includes('This load may already be saved, but Farm Rx could not confirm it.'), 'The farmer is told the load may already be saved.')
  loadMode = 'ok'
  await click(button(container, 'Retry load')); await click(dialogButton('Record anyway'))
  assert(Number(sentLoads.length) === 2 && sentLoads[1]!.id === sentLoads[0]!.id && JSON.stringify(sentLoads[1]!.draft) === JSON.stringify(sentLoads[0]!.draft), 'The retry resends the same ticket under the same id.')
  assert(lastSaved === 1 && container.textContent?.includes('Load saved: 850 bu of Yellow Corn, 2026 crop. It took 850 bu out of Alpha bin and recorded 850 bu delivered against Riverside Elevator (2026).') && container.textContent.includes('Don’t add a separate bin movement or delivery for it.'), 'The saved message says what the load already did.')
  assert(!(container.querySelector('fieldset.load-fields') as HTMLFieldSetElement).disabled && button(container, 'Save load'), 'Once saved, the form is open for the next ticket.')
  await change(control(container, 'Gross weight'), '70000')
  assert(!container.textContent?.includes('Load saved:'), 'Typing the next ticket clears the last "Load saved".')
  // Start a different ticket lets go of the old id only after a confirm.
  loadMode = 'lost'
  await change(control(container, 'Net bushels'), '50')
  await click(button(container, 'Save load'))
  const lostId = sentLoads[2]!.id
  const refreshesBefore = lastSaved
  await click(button(container, 'Start a different ticket'))
  assert(openDialog()?.textContent?.includes('The last load may already be saved. Its weights and ticket number are cleared.'), 'Letting go of the ticket says what it clears.')
  await click(dialogButton('Start a different ticket'))
  assert((control(container, 'Net bushels') as HTMLInputElement).value === '' && (control(container, 'Gross weight') as HTMLInputElement).value === '' && lastSaved === refreshesBefore + 1, 'The let-go ticket is cleared, so one tap cannot save it twice, and the loads are read again.')
  loadMode = 'ok'
  await change(control(container, 'Net bushels'), '50')
  await click(button(container, 'Save load'))
  assert(Number(sentLoads.length) === 4 && sentLoads[3]!.id !== lostId, 'A different ticket gets a different id.')
  await act(async () => { root.render(createElement('div')); await flush() })

  // ---- Basis: a basis typed in cents is asked about before it is saved (C8), and the date is the farmer's.
  await act(async () => { root.render(createElement(MemoryRouter, null, createElement(Basis, { workspace, services, onSaved: async () => undefined }), createElement(ConfirmDialogHost))); await flush() })
  const basisForm = container.querySelector('form.basis-entry') as HTMLFormElement
  assert((control(basisForm, 'Crop') as HTMLSelectElement).value === 'corn_yellow', 'The crop starts on one this farm grows.')
  assert((control(basisForm, 'Basis') as HTMLInputElement).step === 'any' && !(control(basisForm, 'Basis') as HTMLInputElement).getAttribute('inputmode'), 'Basis takes a quarter cent and keeps a keyboard with a minus key.')
  await change(control(basisForm, 'Elevator'), 'Riverside Elevator')
  await change(control(basisForm, 'Basis'), '-35')
  await change(control(basisForm, 'Bid date'), '2026-09-30')
  await act(async () => { basisForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() })
  assert(openDialog()?.textContent?.includes('Basis of -$35.00 per bushel?'), 'A basis that looks like cents is asked about.')
  await click(dialogButton('Go back'))
  assert(savedBids.length === 0 && (control(basisForm, 'Basis') as HTMLInputElement).value === '-35', 'Going back saves nothing and keeps what was typed.')
  await change(control(basisForm, 'Basis'), '-0.35')
  await act(async () => { basisForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await flush() })
  assert(Number(savedBids.length) === 1 && savedBids[0]!.basis === -0.35 && savedBids[0]!.bid_date === '2026-09-30', `A dollar basis saves with the date the farmer picked: ${JSON.stringify(savedBids[0])}`)
  assert((control(basisForm, 'Bid date') as HTMLInputElement).value !== '2026-09-30', 'After a save the date goes back to today, so the next bid is not back-dated.')
  const basisInput = control(basisForm, 'Basis') as HTMLInputElement
  assert(basisInput.getAttribute('aria-describedby') === 'basis-sign-hint' && !basisInput.closest('label')?.textContent?.includes('Under futures'), 'The sign hint describes the Basis box without being part of its name.')
  await act(async () => { root.render(createElement('div')); await flush() })

  // ---- Basis list: a quarter-cent basis is shown whole, and bids from every elevator are not drawn as one trend.
  const bids = [
    { id: uid(60), farm_id: fields.farm.id, elevator: 'Riverside Elevator', commodity_id: 'corn_yellow', bid_date: '2026-09-29', basis: -0.1275, cash_price: 4.1225, delivery_start: null, delivery_end: null, notes: null, feed_source: null, feed_report_id: null, feed_geography: null, created_at: stamp, updated_at: stamp },
    { id: uid(61), farm_id: fields.farm.id, elevator: 'Hilltop Grain', commodity_id: 'corn_yellow', bid_date: '2026-09-30', basis: -0.3, cash_price: null, delivery_start: null, delivery_end: null, notes: null, feed_source: null, feed_report_id: null, feed_geography: null, created_at: stamp, updated_at: stamp },
  ] as CashBid[]
  await act(async () => { root.render(createElement(MemoryRouter, null, createElement(Basis, { workspace: { ...workspace, cash_bids: bids }, services, onSaved: async () => undefined }), createElement(ConfirmDialogHost))); await flush() })
  assert(container.textContent?.includes('-$0.1275') && container.textContent.includes('Cash $4.1225'), 'A quarter-cent basis and cash price are not rounded to the cent.')
  assert(!container.querySelector('svg.basis-chart') && container.textContent?.includes('Latest bids from every elevator. Type an elevator to see its trend.'), 'With no elevator typed, the bids are listed, not drawn as one trend.')
  await change(control(container.querySelector('form.basis-entry') as HTMLElement, 'Elevator'), 'Riverside Elevator')
  assert(container.querySelector('svg.basis-chart'), 'One elevator typed, its trend is drawn.')
  await act(async () => { root.render(createElement('div')); await flush() })

  // ---- Loads, second form: net bushels follow the crop, a repeated ticket is asked about, a voided
  // ticket copies into a new one, and an over-delivery the server refused is asked about next time.
  const cornCrop = fields.crop_assignments.find((assignment) => assignment.commodity_id === 'corn_yellow')!
  const soyCrop = fields.crop_assignments.find((assignment) => assignment.commodity_id === 'soybeans')!
  const loadRow = (n: number, patch: Partial<GrainLoad>): GrainLoad => ({ id: uid(n), farm_id: fields.farm.id, load_date: '2026-09-28', truck_equipment_id: null, truck_name: null, origin_kind: 'field', origin_grain_bin_id: null, origin_crop_assignment_id: cornCrop.id, destination_kind: 'buyer', destination_buyer: 'Co-op', destination_grain_contract_id: null, destination_grain_bin_id: null, commodity_id: 'corn_yellow', crop_year: cornCrop.crop_year, gross_lbs: null, tare_lbs: null, net_bushels: 600, moisture_pct: null, ticket_number: 'T-1', photo_path: null, notes: null, effect_bin_out: false, effect_bin_in: false, effect_contract_delivery: false, effect_harvest: true, voided_at: null, void_reason: null, created_at: stamp, updated_at: stamp, ...patch })
  const voided = loadRow(71, { net_bushels: 400, ticket_number: 'T-9', effect_harvest: false, voided_at: stamp, void_reason: 'Wrong field' })
  const loadsWorkspace = { ...workspace, grain_loads: [loadRow(70, {}), voided] } as GrainWorkspace
  let refreshes = 0
  await act(async () => { root.render(createElement(MemoryRouter, null, createElement(LoadsTab, { workspace: loadsWorkspace, services, onSaved: async () => { refreshes += 1 } }), createElement(ConfirmDialogHost))); await flush() })
  assert(container.textContent?.includes('In the loads listed below: Yellow Corn'), 'The totals say they cover the listed loads only.')
  const radio = (text: string) => [...container.querySelectorAll('fieldset label')].find((label) => label.textContent?.includes(text))!.querySelector('input') as HTMLInputElement
  await click(radio('Off a field'))
  await change(control(container, 'Gross weight'), '80000')
  await change(control(container, 'Tare weight'), '30000')
  assert((control(container, 'Net bushels') as HTMLInputElement).value === '', 'No crop yet, so no figure.')
  const fieldCrop = () => control(container, 'Field crop', 'fieldset.load-origin label')
  await change(fieldCrop(), cornCrop.id)
  assert((control(container, 'Net bushels') as HTMLInputElement).value === '892.86', 'Weights typed before the crop are worked once the crop is picked.')
  await change(fieldCrop(), soyCrop.id)
  assert((control(container, 'Net bushels') as HTMLInputElement).value === '833.33' && container.textContent?.includes('Worked out from the scale weights at 60 lb/bu.'), `Switching to soybeans works the figure again at 60 lb/bu: ${(control(container, 'Net bushels') as HTMLInputElement).value}`)
  await change(fieldCrop(), cornCrop.id)
  await change(control(container, 'Net bushels'), '890')
  await change(fieldCrop(), soyCrop.id)
  assert((control(container, 'Net bushels') as HTMLInputElement).value === '890' && !container.textContent?.includes('Worked out from the scale weights'), 'A typed net is kept, and the hint does not vouch for it.')
  await change(fieldCrop(), cornCrop.id)
  // A repeated ticket number is asked about, and going back writes nothing (B14).
  await change(control(container, 'Buyer or elevator', 'fieldset.load-destination label'), 'Co-op')
  await change(control(container, 'Ticket number', 'label'), 't-1')
  assert(container.textContent?.includes('Ticket t-1 was already saved on'), 'The repeated ticket is pointed out as it is typed.')
  const before = sentLoads.length
  await click(button(container, 'Save load'))
  assert(openDialog()?.textContent?.includes('Ticket t-1 is already entered'), 'Save asks about the repeated ticket first.')
  await click(dialogButton('Go back'))
  assert(sentLoads.length === before && openDialog() === null, 'Going back from a repeated ticket writes nothing.')
  // Copy to a new ticket asks before replacing a typed one, and copies what the voided ticket did (B19).
  await click(button(container, 'Copy to a new ticket'))
  assert(openDialog()?.textContent?.includes('Replace the ticket you are typing?'), 'A typed ticket is not replaced without asking.')
  await click(dialogButton('Replace it'))
  assert((control(container, 'Net bushels') as HTMLInputElement).value === '400' && (control(container, 'Ticket number', 'label') as HTMLInputElement).value === 'T-9', 'The voided ticket is copied into the form.')
  const harvestBox = [...container.querySelectorAll('fieldset.load-effects label')].find((label) => label.textContent?.includes('harvest'))!.querySelector('input') as HTMLInputElement
  assert(!harvestBox.checked, 'A record-only voided ticket copies as record-only.')
  await click(button(container, 'Save load'))
  const copied = sentLoads.at(-1)!
  assert(sentLoads.length === before + 1 && copied.id !== voided.id && copied.draft.net_bushels === '400' && copied.draft.ticket_number === 'T-9' && copied.draft.effect_harvest === false, `The copy saves as a new ticket with the copied values: ${JSON.stringify(copied)}`)
  // The server refuses an over-delivery this screen did not see; the next Save asks (finding 4).
  await click(radio('Out of a bin'))
  await change(control(container, 'Bin', 'fieldset.load-origin label'), binA.id)
  await click(radio('Against a contract'))
  await change(control(container, 'Contract', 'fieldset.load-destination label'), contract.id)
  await change(control(container, 'Net bushels'), '50')
  const deliveryBox = [...container.querySelectorAll('fieldset.load-effects label')].find((label) => label.textContent?.includes('delivered against'))!.querySelector('input') as HTMLInputElement
  if (!deliveryBox.checked) await click(deliveryBox)
  loadMode = 'refuse-over'
  const refreshesBeforeRefusal = refreshes
  await click(button(container, 'Save load'))
  assert(openDialog() === null && container.textContent?.includes('This load is more than what is left on the contract.') && refreshes === refreshesBeforeRefusal + 1, 'The refusal is named and the contracts are read again.')
  loadMode = 'ok'
  await click(button(container, 'Save load'))
  assert(openDialog()?.textContent?.includes('This load is more than is left on the contract. Record anyway?'), 'With a stale list, the next Save still asks about the over-delivery.')
  await click(dialogButton('Record anyway'))
  assert(sentLoads.at(-1)!.draft.allow_overdelivery === true && container.textContent?.includes('It recorded 50 bu delivered against Riverside Elevator (2026).'), `Record anyway sends the confirmation, and the saved message is in the past tense: ${container.querySelector('.load-message')?.textContent}`)
} finally {
  await act(async () => { root.unmount() }); container.remove(); win.close()
}
console.log('Grain bins and loads usability regression passed')
