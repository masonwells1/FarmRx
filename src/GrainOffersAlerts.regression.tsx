import { Window } from 'happy-dom'
import React, { createElement, useState } from 'react'
import { act } from 'react'
import { FirmOffers, MarketingAlerts, offerMonthText } from './GrainModule'
import { GrainCostOfCarry } from './GrainCostOfCarry'
import { ConfirmDialogHost } from './components/ConfirmDialog'
import { fieldsSeedForRegression } from './data/MockFieldsRepository'
import { FIRM_OFFER_FILL_PARTIAL_SUCCESS } from './data/firmOfferFill'
import { bidDate, localCalendarDay } from './data/marketingAlerts'
import { firmOfferFillPartialSuccessMessage } from './lib/farmerErrors'
import { setSaveReceipt } from './lib/saveReceipt'
import { formatFarmDate } from './lib/farmDate'
import { farmCalendarDate } from './data/farmDates'
import { scopeKey, scopeOf } from './data/grain'
import type { CashBid, FirmOffer, GrainAlertSettings, GrainContract, GrainServices, GrainWorkspace, MarketingAlertRule, ProductionEstimate } from './data/grain'

// Grain usability (alerts, firm offers, cost of carry): the rendered screens, driven the way a farmer uses them.
function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const stamp = '2026-10-01T00:00:00.000Z'
const win = new Window({ url: 'http://farmrx.test/grain' })
Object.assign(globalThis, { React, window: win, document: win.document, HTMLElement: win.HTMLElement, HTMLInputElement: win.HTMLInputElement, Node: win.Node, Event: win.Event, InputEvent: win.InputEvent, MouseEvent: win.MouseEvent, localStorage: win.localStorage, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator })
const { createRoot } = await import('react-dom/client')
const flush = async () => { await Promise.resolve(); await new Promise<void>((resolve) => setTimeout(resolve, 0)) }
const day = (offset: number) => { const date = new Date(); date.setDate(date.getDate() + offset); return localCalendarDay(date) }
const today = day(0); const yesterday = day(-1); const nextWeek = day(7)
const openDialog = () => document.querySelector('[role="dialog"]') as HTMLElement | null
function dialogButton(text: string) { const found = [...document.querySelectorAll('[role="dialog"] button')].find((item) => item.textContent === text) as HTMLButtonElement | undefined; assert(found, `Dialog button ${text} did not render.`); return found }
function control(container: ParentNode, label: string) {
  const row = [...container.querySelectorAll('label')].find((item) => item.textContent?.includes(label))
  const element = row?.querySelector('input,select,textarea') as HTMLInputElement | HTMLSelectElement | null
  assert(element, `Missing ${label} control.`)
  return element
}
function byAria(container: ParentNode, label: string) { const element = container.querySelector(`[aria-label="${label}"]`) as HTMLInputElement | null; assert(element, `Missing ${label}.`); return element }
async function change(element: HTMLInputElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = element instanceof win.HTMLSelectElement ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event('change', { bubbles: true }))
    element.dispatchEvent(new (win.InputEvent ?? win.Event)('input', { bubbles: true }) as unknown as Event)
    await flush()
  })
}
async function blur(element: HTMLElement) { await act(async () => { element.dispatchEvent(new win.FocusEvent('focusout', { bubbles: true }) as unknown as Event); await flush() }) }
function button(container: ParentNode, text: string) {
  const found = [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === text) as HTMLButtonElement | undefined
  assert(found, `Missing ${text} button.`)
  return found
}
const hasButton = (container: ParentNode, text: string) => [...container.querySelectorAll('button')].some((item) => item.textContent?.trim() === text)
async function click(element: HTMLElement) { await act(async () => { element.click(); await flush() }) }
// requestSubmit runs the browser's own validation first, the way a tap on Save does; a bare submit event would skip it.
async function submit(form: HTMLFormElement, times = 1) { await act(async () => { for (let index = 0; index < times; index += 1) form.requestSubmit(); await flush() }) }
type Gate = { promise: Promise<void>; release: () => void }
function gate(): Gate { let release!: () => void; return { promise: new Promise<void>((resolve) => { release = resolve }), release } }

const fields = fieldsSeedForRegression(); const farmId = fields.farm.id
const estimate = (id: number, commodity_id: string): ProductionEstimate => ({ id: uid(id), farm_id: farmId, crop_year: 2026, commodity_id, operating_entity_id: null, enterprise_label: null, planted_acres: 100, aph_yield: 180, expected_bushels: 18_000, actual_bushels: null, drives_math: 'projected', notes: null, created_at: stamp, updated_at: stamp })
const corn = estimate(700, 'corn_yellow'); const beans = estimate(701, 'soybeans')
const bid: CashBid = { id: uid(702), farm_id: farmId, elevator: 'County elevator', commodity_id: 'corn_yellow', bid_date: today, basis: -0.3, cash_price: 4.1275, delivery_start: null, delivery_end: null, notes: null, feed_source: null, feed_report_id: null, feed_geography: null, created_at: stamp, updated_at: stamp }
const workspace: GrainWorkspace = { fields, production_estimates: [corn, beans], grain_contracts: [], grain_contract_deliveries: [], grain_loads: [], marketing_plan_targets: [], insurance_units: [], grain_bins: [], bin_inventory: [], bin_transactions: [], cash_bids: [bid], usda_market_reports: [], usda_report_dates: [], marketing_alert_rules: [], firm_offers: [], grain_alert_settings: null, grain_sale_limits: [], grain_carry_settings: null, grain_carry_grids: [] }
let nextId = 800
// A failing break-even lookup must not surface as an unhandled rejection (A48): this process would exit on one.
const profitabilityRepository = { getBreakeven: async () => { throw new Error('no budget') }, getWorkspace: async () => ({ budgets: [], allocations: [] }) }

// Sweep #17: a firm offer's month is free text (a browser with no month picker gives a plain box). Only a real
// year-month is reworded; anything else is shown as typed, never as "Feb Dec " or "undefined Z26".
assert(offerMonthText('2026-12') === 'Dec 2026' && offerMonthText(' 2027-03 ') === 'Mar 2027', 'A year-month reads as a month and year.')
assert(offerMonthText('Dec 2026') === 'Dec 2026' && offerMonthText('December') === 'December' && offerMonthText('Z26') === 'Z26' && offerMonthText('2026-13') === '2026-13', `Free text is shown as typed: ${offerMonthText('Dec 2026')} / ${offerMonthText('Z26')}`)

// ---------------------------------------------------------------- Marketing alerts
{
  const ruleWrites: MarketingAlertRule[] = []; let ruleGate = gate(); let ruleMode: 'ok' | 'fail' | 'offline' = 'ok'
  const emailWrites: GrainAlertSettings[] = []
  const repository = {
    getData: async () => workspace,
    // As the queued repository does offline: the change is kept on this device and the receipt says so, never Saved.
    saveGrainAlertSettings: async (value: GrainAlertSettings) => { emailWrites.push(value); setSaveReceipt(value.farm_id, 'saving'); await Promise.resolve(); setSaveReceipt(value.farm_id, 'queued offline') },
    saveMarketingAlertRule: async (value: MarketingAlertRule) => { ruleWrites.push(value); setSaveReceipt(value.id, 'saving'); await ruleGate.promise; if (ruleMode === 'offline') { workspace.marketing_alert_rules = [...workspace.marketing_alert_rules.filter((row) => row.id !== value.id), value]; setSaveReceipt(value.id, 'queued offline'); return } if (ruleMode === 'fail') { setSaveReceipt(value.id, 'needs attention'); throw new Error('server refused the rule') } workspace.marketing_alert_rules = [...workspace.marketing_alert_rules.filter((row) => row.id !== value.id), value]; setSaveReceipt(value.id, 'saved') },
  }
  const services = { grainRepository: repository, createGrainId: () => uid(nextId++), profitabilityRepository } as unknown as GrainServices
  function AlertsHarness() {
    const [snapshot, setSnapshot] = useState(workspace)
    return createElement(MarketingAlerts, { workspace: snapshot, services, selectedEstimateId: corn.id, onSelectEstimate: () => undefined, onSaved: async () => setSnapshot({ ...workspace }) })
  }
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(React.Fragment, null, createElement(AlertsHarness), createElement(ConfirmDialogHost))); await flush() })
    assert(container.textContent?.includes("Alert me while I've marketed less than my goal") && container.textContent.includes('One reminder, a week ahead'), 'A7/A8: the alert templates must say how the % goal and the deadline really behave.')
    await click(button(container, 'Cash price targetTell me when yellow corn hits my number'))
    const form = container.querySelector('form.alert-rule-form') as HTMLFormElement; assert(form, 'The price-target form did not open.')
    assert(form.textContent?.includes('Checks the newest cash bid saved for this crop from today or the 2 days before, from any elevator, including USDA bids.') && form.textContent.includes(`Bid it would use today: $4.1275 from County elevator, ${bidDate(today)}.`), `A6/A40: the form must say which bid the alert would use today, with a readable date. ${form.textContent}`)
    const target = control(form, 'Cash price target ($/bu)') as HTMLInputElement
    assert(target.getAttribute('step') === 'any', 'C0: a cash price target must take quarter cents, like the bid it is compared with.')
    // A blank target is said in plain words next to Save, with no write (the form skips the browser's own bubble).
    await submit(form)
    assert(ruleWrites.length === 0 && form.querySelector('.form-error')?.textContent?.includes('Price target must be above $0'), `A25: a blank target must be refused next to Save. ${form.textContent}`)
    // Sweep #7: a target that cannot be read as a number is named as that, not told about the $0-$1,000 range.
    await change(target, '4,25'); await submit(form)
    assert(ruleWrites.length === 0 && form.querySelector('.form-error')?.textContent === 'Type the price target as a number, like 4.25.', `A decimal comma in the target must be named, with no write: ${form.querySelector('.form-error')?.textContent}`)
    await change(target, '4.5')
    await submit(form, 2)
    assert(Number(ruleWrites.length) === 1 && button(form, 'Saving…').disabled, `A2: a double tap on Save alert must make one write and show Saving. writes=${ruleWrites.length}`)
    ruleGate.release(); await act(async () => { await flush(); await flush() })
    assert(Number(ruleWrites.length) === 1 && container.textContent?.includes('Saved') && !container.querySelector('form.alert-rule-form'), 'A27: a saved alert closes its form and shows Saved for that one write.')
    assert(container.textContent?.includes('Tell me when 2026 Yellow Corn cash price target is at or above $4.50.'), 'The saved rule must be listed.')
    await click(button(container, 'Cash price targetTell me when yellow corn hits my number'))
    await change(control(container.querySelector('form.alert-rule-form')!, 'Cash price target ($/bu)'), '4.1275')
    await submit(container.querySelector('form.alert-rule-form') as HTMLFormElement); await act(async () => { await flush() })
    assert(container.textContent?.includes('cash price target is at or above $4.1275.'), 'C0: a quarter-cent target must be saved and listed without rounding.')
    const quarterRuleWrites = ruleWrites.length

    // A failed save shows its message once, next to the form's button, and a retry reuses the same rule id.
    ruleGate = gate(); ruleMode = 'fail'
    await click(button(container, "% marketed goalAlert me while I've marketed less than my goal"))
    const goalForm = container.querySelector('form.alert-rule-form') as HTMLFormElement
    const writesBeforeCommaGoal = ruleWrites.length
    await change(control(goalForm, 'Marketed goal %'), '50,5'); await submit(goalForm)
    assert(ruleWrites.length === writesBeforeCommaGoal && goalForm.querySelector('.form-error')?.textContent === 'Type the goal as a number, like 50.5.', `Sweep #7: a decimal comma in the goal must be named, with no write: ${goalForm.querySelector('.form-error')?.textContent}`)
    await change(control(goalForm, 'Marketed goal %'), '50')
    assert(goalForm.textContent?.includes('You are below this goal now, so this alert goes off within about 15 minutes (on your phone, if notifications are on, and in Grain alerts here).') && goalForm.textContent.includes('Currently 0% marketed'), 'A7: a goal above the current % marketed must warn that it goes off right away.')
    ruleGate.release(); await submit(goalForm); await act(async () => { await flush() })
    const errors = [...container.querySelectorAll('.form-error')]
    assert(errors.length === 1 && goalForm.contains(errors[0]!), `A27: a failed alert save must show one error, inside the form. Found ${errors.length}.`)
    assert(!container.querySelector('.save-receipt-needs-attention'), 'A27: while the open form shows the failed save, the heading must not add a second Needs attention message.')
    ruleMode = 'ok'; await submit(goalForm); await act(async () => { await flush() })
    assert(Number(ruleWrites.length) === quarterRuleWrites + 2 && ruleWrites.at(-2)!.id === ruleWrites.at(-1)!.id, 'A2: retrying the same alert form must reuse its id, so a lost response cannot add a second rule.')
    assert(container.textContent?.includes('Alert me while 2026 Yellow Corn is below 50% marketed.'), 'A7: the saved % goal must read the way it behaves, in the form\'s own word.')
    // A rule that has already sent is not sent again just because it is opened: the right-away warning is for a rule that has not sent.
    const sentGoal = workspace.marketing_alert_rules.find((rule) => rule.rule_type === 'pct_marketed_goal')!
    workspace.marketing_alert_rules = workspace.marketing_alert_rules.map((rule) => rule.id === sentGoal.id ? { ...rule, last_triggered_at: stamp } : rule)
    await act(async () => { root.render(createElement(React.Fragment, null, createElement(AlertsHarness, { key: 'sent' }), createElement(ConfirmDialogHost))); await flush() })
    const sentRow = [...container.querySelectorAll('.alert-rule')].find((item) => item.textContent?.includes('below 50% marketed')) as HTMLElement
    await click(button(sentRow, 'Edit'))
    assert(!container.querySelector('form.alert-rule-form')?.textContent?.includes('You are below this goal now'), 'A7: editing a goal that already sent must not promise another alert in 15 minutes.')
    await click(button(container.querySelector('form.alert-rule-form')!, 'Close without saving'))
    const writesBeforeDeadline = ruleWrites.length

    // A deadline in the past can never go off, so it is refused before any write.
    await click(button(container, 'DeadlineOne reminder, a week ahead'))
    const deadlineForm = container.querySelector('form.alert-rule-form') as HTMLFormElement
    assert(deadlineForm.textContent?.includes('You will get one notification 7 days before this date') && (control(deadlineForm, 'Reminder date') as HTMLInputElement).getAttribute('min') === today, 'A8/A25: the deadline form must explain the one reminder and refuse earlier dates.')
    await change(control(deadlineForm, 'Reminder date'), yesterday); await submit(deadlineForm)
    assert(ruleWrites.length === writesBeforeDeadline && deadlineForm.textContent?.includes('Pick today or a later date.'), 'A25: a past reminder date must be refused with no write.')
    await click(button(deadlineForm, 'Close without saving'))

    // A saved deadline whose date has passed can still have its note edited: the date box must not block Save.
    const pastDeadline: MarketingAlertRule = { id: uid(750), farm_id: farmId, crop_year: 2026, commodity_id: 'corn_yellow', operating_entity_id: null, enterprise_label: null, rule_type: 'deadline', direction: null, threshold: null, remind_on: yesterday, message: 'Insurance', active: true, last_triggered_at: null, created_at: stamp, updated_at: stamp }
    workspace.marketing_alert_rules = [...workspace.marketing_alert_rules, pastDeadline]
    await act(async () => { root.render(createElement(React.Fragment, null, createElement(AlertsHarness, { key: 'past' }), createElement(ConfirmDialogHost))); await flush() })
    const pastRow = [...container.querySelectorAll('.alert-rule')].find((item) => item.textContent?.includes(`Remind me a week before ${formatFarmDate(yesterday)}`)) as HTMLElement
    assert(pastRow, 'The past deadline rule must be listed.')
    await click(button(pastRow, 'Edit'))
    const pastForm = container.querySelector('form.alert-rule-form') as HTMLFormElement
    assert((control(pastForm, 'Reminder date') as HTMLInputElement).getAttribute('min') === null, 'A25: an unchanged past reminder date must not carry a min that blocks Save.')
    await change(control(pastForm, 'Note'), 'Insurance sales close'); await submit(pastForm); await act(async () => { await flush() })
    assert(ruleWrites.at(-1)?.id === pastDeadline.id && ruleWrites.at(-1)?.message === 'Insurance sales close' && ruleWrites.at(-1)?.remind_on === yesterday, 'A25: editing only the note of a past deadline must save.')

    // Full review: an open alert form saves to the crop it was opened for, so moving the picker closes it rather than moving the rule.
    await click(button(container, 'Cash price targetTell me when yellow corn hits my number'))
    assert(container.querySelector('form.alert-rule-form'), 'The price-target form did not open.')
    await change(control(container.querySelector('.alerts-card')!, 'Commodity'), beans.id)
    assert(!container.querySelector('form.alert-rule-form'), 'Changing the crop picker must close an open alert form, so the rule is never saved to the other crop.')

    // Full review: a rule kept offline says Waiting for signal, never Saved.
    ruleGate = { promise: Promise.resolve(), release: () => undefined }; ruleMode = 'offline'
    await click(button(container, 'Cash price targetTell me when yellow corn hits my number'))
    await change(control(container.querySelector('form.alert-rule-form')!, 'Cash price target ($/bu)'), '4.75')
    await submit(container.querySelector('form.alert-rule-form') as HTMLFormElement); await act(async () => { await flush() })
    const alertsHeading = container.querySelector('.alerts-card .section-heading') as HTMLElement
    assert(alertsHeading.textContent?.includes('Waiting for signal. Kept on this device.') && !alertsHeading.textContent.includes('Saved'), `A queued-offline alert must say Waiting for signal, not Saved. ${alertsHeading.textContent}`)
    ruleMode = 'ok'

    // Full review: alert email addresses are checked before anything is kept, and an offline save says so.
    const emailCard = container.querySelector('.alert-email-card') as HTMLElement
    const emailForm = emailCard.querySelector('form') as HTMLFormElement
    await change(control(emailForm, 'Email addresses'), 'farmer@example.com, nonsense'); await submit(emailForm)
    assert(emailWrites.length === 0 && emailCard.querySelector('.form-error')?.textContent === 'Enter complete email addresses, with no extra spaces.', 'An invalid alert email must be refused next to Save, with nothing kept.')
    await change(control(emailForm, 'Email addresses'), 'farmer@example.com'); await submit(emailForm)
    assert(Number(emailWrites.length) === 1 && emailCard.textContent?.includes('Waiting for signal. Kept on this device.') && !emailCard.textContent.includes('Saved'), `Alert emails kept offline must say Waiting for signal, never Saved. ${emailCard.textContent}`)
  } finally { await act(async () => { root.unmount() }); container.remove() }
}

// Codex review: the deadline form's "today" is the farm's calendar day, as the alert sweep reads it, not this device's.
{
  const services = { grainRepository: { getData: async () => workspace, saveMarketingAlertRule: async () => undefined, saveGrainAlertSettings: async () => undefined }, createGrainId: () => uid(nextId++), profitabilityRepository } as unknown as GrainServices
  // The farthest-ahead zone and one 25 hours behind it: whatever this device's zone and hour, one of them is on another day.
  const zones = ['Pacific/Kiritimati', 'Pacific/Pago_Pago']
  assert(zones.some((zone) => farmCalendarDate(new Date(), zone) !== localCalendarDay(new Date())), 'Test setup: one farm must sit on another calendar day from this device.')
  for (const zone of zones) {
    const zoned: GrainWorkspace = { ...workspace, marketing_alert_rules: [], fields: { ...fields, farm: { ...fields.farm, time_zone: zone } } }
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(MarketingAlerts, { workspace: zoned, services, selectedEstimateId: corn.id, onSelectEstimate: () => undefined, onSaved: async () => undefined })); await flush() })
      await click(button(container, 'DeadlineOne reminder, a week ahead'))
      const min = (control(container.querySelector('form.alert-rule-form')!, 'Reminder date') as HTMLInputElement).getAttribute('min')
      assert(min === farmCalendarDate(new Date(), zone), `A farm in ${zone} must date its deadline reminders by its own calendar day, got ${min}.`)
    } finally { await act(async () => { root.unmount() }); container.remove() }
  }
}

// Sweep #33: the price-alert form shows break-even to the quarter cent, as the target editor does ($650/ac over 155 bu/ac).
{
  const services = { grainRepository: { getData: async () => workspace, saveMarketingAlertRule: async () => undefined, saveGrainAlertSettings: async () => undefined }, createGrainId: () => uid(nextId++), profitabilityRepository: { ...profitabilityRepository, getBreakeven: async () => 650 / 155 } } as unknown as GrainServices
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(MarketingAlerts, { workspace: { ...workspace, marketing_alert_rules: [] }, services, selectedEstimateId: corn.id, onSelectEstimate: () => undefined, onSaved: async () => undefined })); await flush() })
    await click(button(container, 'Cash price targetTell me when yellow corn hits my number'))
    const form = container.querySelector('form.alert-rule-form') as HTMLFormElement
    assert(form?.textContent?.includes('Your break-even: $4.1935/bu'), `The alert form's break-even must not be rounded to $4.19: ${form?.textContent}`)
  } finally { await act(async () => { root.unmount() }); container.remove() }
}

// ---------------------------------------------------------------- Firm offers
{
  const offerWrites: FirmOffer[] = []; const fills: GrainContract[] = []; let fillMode: 'error' | 'partial' | 'ok' = 'error'
  const expiredOpen: FirmOffer = { id: uid(900), farm_id: farmId, crop_year: 2026, commodity_id: 'corn_yellow', operating_entity_id: null, enterprise_label: null, buyer: 'River terminal', offer_type: 'cash', bushels: 5_000, price: 4.4, basis: null, contract_month: null, expires_on: yesterday, delivery_location: null, notes: null, status: 'open', filled_contract_id: null, created_at: stamp, updated_at: stamp }
  const repository = {
    getData: async () => workspace,
    saveFirmOffer: async (value: FirmOffer) => { offerWrites.push(value); setSaveReceipt(value.id, 'saving'); await Promise.resolve(); workspace.firm_offers = [...workspace.firm_offers.filter((row) => row.id !== value.id), value]; setSaveReceipt(value.id, 'saved') },
    fillFirmOffer: async (offer: FirmOffer, contract: GrainContract) => {
      fills.push(contract)
      if (fillMode === 'error') throw new Error('The buyer record changed on the server.')
      if (fillMode === 'partial') throw new Error(FIRM_OFFER_FILL_PARTIAL_SUCCESS)
      workspace.grain_contracts = [...workspace.grain_contracts, contract]
      workspace.firm_offers = workspace.firm_offers.map((row) => row.id === offer.id ? { ...row, status: 'filled', filled_contract_id: contract.id } : row)
    },
  }
  const services = { grainRepository: repository, createGrainId: () => uid(nextId++), profitabilityRepository } as unknown as GrainServices
  let saleLimits: Record<string, number> = {}
  function OffersHarness() {
    const [snapshot, setSnapshot] = useState(workspace)
    const [selected, setSelected] = useState(corn.id)
    return createElement(FirmOffers, { workspace: snapshot, services, selectedEstimateId: selected, onSelectEstimate: setSelected, saleLimits, onSaved: async () => setSnapshot({ ...workspace }) })
  }
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  const section = () => container.querySelector('.firm-offers-card') as HTMLElement
  const offerForm = () => container.querySelector('form.firm-offer-form') as HTMLFormElement
  try {
    await act(async () => { root.render(createElement(React.Fragment, null, createElement(OffersHarness), createElement(ConfirmDialogHost))); await flush() })
    assert(section().textContent?.includes('No firm offers for this crop and year yet.'), 'A32: an empty offer list must say so and point at Add firm offer.')
    await click(button(container, 'Add firm offer'))
    assert(offerForm().textContent?.includes('2026 Yellow Corn — whole farm'), 'A9: the new-offer form must name the crop it saves to.')
    await change(control(section(), 'Commodity'), beans.id)
    assert(offerForm().textContent?.includes('2026 Yellow Corn — whole farm'), 'A9: moving the picker must not move a typed new-offer draft to another crop.')
    await change(control(offerForm(), 'Buyer'), 'County elevator'); await change(control(offerForm(), 'Bushels'), '10000'); await change(control(offerForm(), 'Cash $/bu'), '0')
    await submit(offerForm())
    assert(offerWrites.length === 0 && offerForm().textContent?.includes('Enter a price above $0.00.'), 'A25: a $0 cash price must be refused with no write.')
    // Sweep #6/#8: the form checks its own boxes (noValidate), so each problem is said once, in words about that box.
    const offerError = () => offerForm()?.querySelector('.form-error')?.textContent
    await change(control(offerForm(), 'Cash $/bu'), '-1'); await submit(offerForm())
    assert(offerWrites.length === 0 && offerError() === 'Enter a price above $0.00.', `A negative price gets one message, not "above $0.00" and "zero or more" together: ${offerError()}`)
    await change(control(offerForm(), 'Cash $/bu'), '4,1275'); await submit(offerForm())
    assert(offerWrites.length === 0 && offerError() === 'Type the cash price as a number, like 4.1275.', `A price that cannot be read is named, not called missing: ${offerError()}`)
    await change(control(offerForm(), 'Bushels'), '5,000')
    assert((control(offerForm(), 'Bushels') as HTMLInputElement).value === '5,000', 'Review of #68: a thousands comma in offer Bushels is kept as typed, not reported as blank.')
    // Review of #68: a comma that is not a thousands mark is refused by name, never read as an amount 1,000 times too big.
    for (const typed of ['1200,500', '45210,125', '1,2345']) {
      await change(control(offerForm(), 'Bushels'), typed); await submit(offerForm())
      assert(offerWrites.length === 0 && (control(offerForm(), 'Bushels') as HTMLInputElement).value === typed && offerError()?.startsWith('A comma in bushels is read only as a thousands mark'), `"${typed}" in offer Bushels must be refused by name: ${offerError()}`)
    }
    await change(control(offerForm(), 'Bushels'), '100.255'); await change(control(offerForm(), 'Cash $/bu'), '4.1275'); await submit(offerForm())
    assert(offerWrites.length === 0 && offerError() === 'Bushels can have at most 2 decimals.', `A third decimal in offer Bushels is refused, not rounded by the server: ${offerError()}`)
    // Review of #68: read by the one rule -- "10,000.000" is 10000, and zero third decimals are no third decimal.
    await change(control(offerForm(), 'Bushels'), '10,000.000')
    const priceInput = control(offerForm(), 'Cash $/bu') as HTMLInputElement
    assert(priceInput.getAttribute('step') === 'any' && priceInput.getAttribute('inputmode') === 'decimal', 'C0: the offer price box must take quarter cents.')
    await change(priceInput, '4.1275'); await change(control(offerForm(), 'Expires on'), yesterday); await submit(offerForm())
    assert(offerWrites.length === 0 && offerForm().textContent?.includes('The expiry date is in the past.'), 'A25: a past expiry on a new offer must be refused with no write.')
    await change(control(offerForm(), 'Expires on'), nextWeek); await submit(offerForm(), 2)
    assert(Number(offerWrites.length) === 1 && offerWrites[0]!.commodity_id === 'corn_yellow' && offerWrites[0]!.price === 4.1275, 'A9/A2: one write, to the crop the form named, at the quarter-cent price.')
    assert(offerWrites[0]!.bushels === 10_000, `"10,000.000" is saved as 10000 bu: ${offerWrites[0]!.bushels}`)
    assert(section().textContent?.includes('Saved') && !offerForm(), 'A27: a saved offer closes its form and shows Saved.')

    // The picker now shows soybeans: a basis offer typed in cents asks before saving.
    await click(button(container, 'Add firm offer'))
    assert(offerForm().textContent?.includes('2026 Soybeans — whole farm'), 'A9: a new offer takes the crop showing when Add is tapped.')
    await change(control(offerForm(), 'Offer type'), 'basis')
    const basisInput = control(offerForm(), 'Basis $/bu') as HTMLInputElement
    assert(basisInput.getAttribute('inputmode') === null && basisInput.getAttribute('placeholder') === '-0.35', 'C1: the basis box must use a keyboard with a minus key.')
    assert(offerForm().textContent?.includes('Futures month'), 'A10: on a basis offer the month is the futures month.')
    await change(control(offerForm(), 'Buyer'), 'Bean plant'); await change(control(offerForm(), 'Bushels'), '3000')
    await change(basisInput, '-0,35'); await submit(offerForm())
    assert(Number(offerWrites.length) === 1 && offerForm().querySelector('.form-error')?.textContent === 'Type the basis as a number, like -0.35.' && !openDialog(), `Sweep #6: a basis that cannot be read is named: ${offerForm().querySelector('.form-error')?.textContent}`)
    await change(basisInput, '-35')
    await submit(offerForm())
    assert(openDialog()?.textContent?.includes('Basis of -$35.00 per bushel?'), 'C8: a basis that looks like cents must ask before saving.')
    await click(dialogButton('Go back'))
    assert(Number(offerWrites.length) === 1 && offerForm(), 'C8: going back must keep the form open with no write.')
    await click(button(offerForm(), 'Close without saving'))
    assert(!offerForm(), 'A15: the form closes with Close without saving.')

    // Back on corn: Mark canceled asks first.
    await change(control(section(), 'Commodity'), corn.id)
    await click(button(section(), 'Mark canceled'))
    assert(openDialog()?.textContent?.includes('Mark this offer canceled?'), 'A15: Mark canceled must ask before changing the offer.')
    await click(dialogButton('Go back'))
    assert(Number(offerWrites.length) === 1 && workspace.firm_offers[0]!.status === 'open', 'A15: Go back must leave the offer open.')

    // Mark filled: a failure stays on the fill form, next to its button.
    await click(button(section(), 'Mark filled'))
    const fillEntry = () => container.querySelector('.offer-fill-entry') as HTMLElement | null
    assert(fillEntry() && hasButton(fillEntry()!, 'Close without saving') && !hasButton(section(), 'Add firm offer'), 'A4: the fill form must offer a way out.')
    const fillForm = () => fillEntry()!.querySelector('form') as HTMLFormElement
    await change(control(fillForm(), 'Bushels'), '6000')
    assert(fillEntry()?.querySelector('.contract-entry-note')?.textContent?.includes('the other 4,000 bu stop counting as pending') && !fillEntry()?.querySelector('.form-error'), 'A18: filling part of an offer must say, before saving, that the rest stops counting as pending.')
    // Sweep #32: the "more than the offer" note is decided on the rounded figure it shows, so it never says "0 bu more".
    await change(control(fillForm(), 'Bushels'), '10000.004')
    assert(!fillEntry()?.textContent?.includes('more than the offer'), `A fraction of a cent over the offer must not read "0 bu more than the offer": ${fillEntry()?.textContent}`)
    await change(control(fillForm(), 'Bushels'), '10000.5')
    assert(fillEntry()?.textContent?.includes('This is 0.50 bu more than the offer.'), 'Half a bushel over the offer is still named.')
    await change(control(fillForm(), 'Bushels'), '6000')
    await submit(fillForm())
    const sectionErrors = () => [...section().children].filter((item) => item.classList.contains('form-error'))
    assert(fills.length === 1 && fillEntry()?.querySelector('.form-error')?.textContent && sectionErrors().length === 0, `A13: a failed fill must keep the fill form open and show its error inside it. ${fillEntry()?.textContent}`)
    fillMode = 'partial'; await submit(fillForm())
    assert(fillEntry()?.textContent?.includes(firmOfferFillPartialSuccessMessage), 'A13: the partial-success warning must show on the fill form.')
    fillMode = 'ok'; await submit(fillForm()); await act(async () => { await flush() })
    assert(!fillEntry() && section().textContent?.includes('Save the form below if the buyer is still holding the other 4,000 bu.'), `A13/A18: a partial fill must say what was recorded and offer the leftover bushels. ${section().textContent}`)
    // Sweep #18: the buyer holds the rest of the same offer to the same date, so the leftover keeps the offer's expiry. A blank
    // date would keep those bushels pending forever. (Copy as new offer, below, still starts with no date.)
    assert((control(offerForm(), 'Bushels') as HTMLInputElement).value === '4000' && (control(offerForm(), 'Buyer') as HTMLInputElement).value === 'County elevator' && (control(offerForm(), 'Expires on') as HTMLInputElement).value === nextWeek, `A18: the leftover-bushels form must be prefilled from the offer, with the offer's own expiry: ${(control(offerForm(), 'Expires on') as HTMLInputElement).value}`)
    assert(Number(offerWrites.length) === 1, 'A18: the leftover bushels count as pending only after the farmer saves them.')
    await click(button(offerForm(), 'Close without saving'))
    assert(!section().textContent?.includes('Save the form below'), 'A18: closing the leftover-bushels form must also clear the notice that points at it.')

    // An open offer past its date can be renewed; expired and canceled offers can be copied.
    // Another open offer of 8,000 bu and a 15,000 bu limit: 6,000 contracted + 8,000 + the 5,000 being renewed is over it.
    const otherOpen: FirmOffer = { ...expiredOpen, id: uid(901), buyer: 'Feed mill', bushels: 8_000, expires_on: nextWeek, contract_month: 'Dec 2026' }
    workspace.firm_offers = [...workspace.firm_offers, expiredOpen, otherOpen]
    saleLimits = { [scopeKey(scopeOf(corn))]: 15_000 }
    await act(async () => { root.render(createElement(React.Fragment, null, createElement(OffersHarness, { key: 'reload' }), createElement(ConfirmDialogHost))); await flush() })
    const expiredDetails = [...section().querySelectorAll('details')].find((item) => item.textContent?.startsWith('Expired offers')) as HTMLElement
    assert(expiredDetails && hasButton(expiredDetails, 'Edit or renew') && hasButton(expiredDetails, 'Copy as new offer'), 'A5: an open offer past its date must offer Edit or renew and Copy as new offer.')
    await click(button(expiredDetails, 'Copy as new offer'))
    assert(offerForm().textContent?.includes('New firm offer') && (control(offerForm(), 'Buyer') as HTMLInputElement).value === 'River terminal' && (control(offerForm(), 'Expires on') as HTMLInputElement).value === '', 'A5: Copy as new offer must open a new, prefilled offer with a blank expiry.')
    await change(control(offerForm(), 'Buyer'), 'Typed, then copied again')
    await click(button(expiredDetails, 'Copy as new offer'))
    assert((control(offerForm(), 'Buyer') as HTMLInputElement).value === 'River terminal', 'A5: tapping Copy as new offer again must start a fresh copy, not keep the typed draft.')
    await click(button(expiredDetails, 'Edit or renew'))
    assert(offerForm().textContent?.includes('Edit firm offer') && (control(offerForm(), 'Expires on') as HTMLInputElement).value === yesterday, 'A5/A33: Edit or renew opens the one edit form with the old date.')
    assert(offerForm().textContent?.includes('above your 15,000 bu sale limit'), `A5: renewing an expired offer must count the other open offers in full for the sale-limit warning. ${offerForm().textContent}`)
    await change(control(offerForm(), 'Expires on'), nextWeek); await submit(offerForm())
    assert(offerWrites.at(-1)?.id === expiredOpen.id && offerWrites.at(-1)?.expires_on === nextWeek && offerWrites.at(-1)?.status === 'open', 'A5: renewing saves the same offer with the new date.')

    // Full review: Mark filled on one offer, then on another, starts the second offer's own sale (the fill form is keyed by offer).
    const openDetails = () => [...section().querySelectorAll('details')].find((item) => item.textContent?.startsWith('Open offers')) as HTMLElement
    const rowFor = (buyer: string) => { const row = [...openDetails().querySelectorAll('article.offer-row')].find((item) => item.querySelector('strong')?.textContent === buyer) as HTMLElement | undefined; assert(row, `Missing open offer from ${buyer}.`); return row }
    assert(rowFor('Feed mill').textContent?.includes(' · delivery Dec 2026') && !rowFor('Feed mill').textContent?.includes('Feb'), `Sweep #17: a month typed as text is listed as typed: ${rowFor('Feed mill').textContent}`)
    await click(button(rowFor('River terminal'), 'Mark filled'))
    await change(control(fillForm(), 'Bushels'), '1234')
    await click(button(rowFor('Feed mill'), 'Mark filled'))
    assert((control(fillForm(), 'Buyer') as HTMLInputElement).value === 'Feed mill' && (control(fillForm(), 'Bushels') as HTMLInputElement).value === '8000', 'A second Mark filled must show that offer\u2019s buyer and bushels, never the first offer\u2019s sale.')
    const fillBushels = control(fillForm(), 'Bushels') as HTMLInputElement
    assert(fillBushels.getAttribute('step') === 'any' && fillBushels.getAttribute('min') === '0.01' && fillBushels.getAttribute('inputmode') === 'decimal', 'An offer with fractional bushels (a leftover is rounded to the cent) must be fillable.')
    await click(button(fillEntry()!, 'Close without saving'))

    // Full review: an Edit form left open must not bring back an offer just marked canceled.
    await click(button(rowFor('Feed mill'), 'Edit'))
    assert(offerForm(), 'The edit form did not open.')
    await click(button(rowFor('Feed mill'), 'Mark canceled')); await click(dialogButton('Mark canceled')); await act(async () => { await flush() })
    assert(!offerForm() && offerWrites.at(-1)?.id === otherOpen.id && offerWrites.at(-1)?.status === 'canceled', 'Marking an offer canceled must close its open Edit form, so Save cannot write it back as open.')
  } finally { await act(async () => { root.unmount() }); container.remove() }
}

// ---------------------------------------------------------------- Cost of carry (device-only mode)
{
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
  try {
    await act(async () => { root.render(createElement(React.Fragment, null, createElement(GrainCostOfCarry, { workspace, selectedEstimate: corn, selectedEstimateId: corn.id, onSelectEstimate: () => undefined }), createElement(ConfirmDialogHost))); await flush() })
    assert([...container.querySelectorAll('option')].some((item) => item.textContent === '2026 Yellow Corn — whole farm') && container.textContent?.includes('Futures price $/bu'), 'A20: the carry picker names the crop year, and the grid asks for the futures price.')
    assert(container.textContent?.includes('Basis is $0.00, so cash price equals the futures price.'), 'A23: a zero basis must be pointed out.')
    const defaultBasis = control(container, 'Default basis $/bu') as HTMLInputElement
    assert(defaultBasis.getAttribute('inputmode') === null && defaultBasis.getAttribute('placeholder') === '-0.35' && byAria(container, 'Oct 2026 basis per bushel').getAttribute('inputmode') === null, 'C1: the carry basis boxes must use a keyboard with a minus key, as the hint asks for a negative basis.')
    await change(byAria(container, 'Oct 2026 futures price per bushel'), '4.10'); await change(byAria(container, 'Nov 2026 futures price per bushel'), '4.15'); await change(byAria(container, 'Dec 2026 futures price per bushel'), '4.25')
    await change(control(container, 'Harvest month'), '8')
    assert(!openDialog() && byAria(container, 'Dec 2026 futures price per bushel').value === '4.25' && byAria(container, 'Oct 2026 futures price per bushel').value === '4.10' && byAria(container, 'Sep 2026 futures price per bushel').value === '', 'A1: an earlier harvest month keeps each typed price on its own month, with no question asked.')
    await change(control(container, 'Harvest month'), '11')
    assert(openDialog()?.textContent?.includes('2 prices you typed fall outside the new 13 months'), 'A1: a harvest month that drops typed prices must say how many first.')
    await click(dialogButton('Keep current month'))
    assert((control(container, 'Harvest month') as HTMLSelectElement).value === '8' && byAria(container, 'Oct 2026 futures price per bushel').value === '4.10', 'A1: keeping the current month must leave the grid untouched.')
    await change(control(container, 'Harvest month'), '11'); await click(dialogButton('Change month'))
    assert(byAria(container, 'Dec 2026 futures price per bushel').value === '4.25' && !container.querySelector('[aria-label="Oct 2026 futures price per bushel"]'), 'A1: after confirming, the Dec price stays on Dec.')
    // A22: type Dec and Mar only, then fill the months between.
    await change(byAria(container, 'Mar 2027 futures price per bushel'), '4.40')
    await click(button(container, 'Fill blank months from the next futures month'))
    assert(byAria(container, 'Jan 2027 futures price per bushel').value === '4.40' && byAria(container, 'Feb 2027 futures price per bushel').value === '4.40' && byAria(container, 'Apr 2027 futures price per bushel').value === '' && button(container, 'Fill blank months from the next futures month').disabled, 'A22: blank months take the next typed futures price; months after the last one stay blank.')
    // A42: every stored month loses to harvest here, so no month is named as the best one.
    assert(container.textContent?.includes('None beat harvest') && container.textContent.includes('Smallest loss vs harvest') && container.textContent.includes('Deliver at harvest'), 'A42: a losing month must not be called the best stored month.')
    // A19: clearing a rate is not a zero rate.
    const interest = control(container, 'Interest rate %') as HTMLInputElement
    await change(interest, '')
    assert(interest.value === '' && container.textContent?.includes('Type a number. Use 0 if there is no charge.'), 'A19: a cleared rate must stay blank with a note and not be saved as 0.')
    await blur(interest)
    assert(String(interest.value) === "7" && container.textContent?.includes('The field went back to 7.'), `A19: leaving a cleared rate must put the saved rate back. value=${interest.value}`)
  } finally { await act(async () => { root.unmount() }); container.remove() }
}

console.log('Grain offers, alerts and carry usability regression passed.')
