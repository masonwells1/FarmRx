import { Window } from 'happy-dom'
import React, { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { CropBudget, EquipmentCostSnapshotPreview, EquipmentCostSnapshotRequest, ProfitabilityEquipment } from './data/profitability'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const farmId = '00000000-0000-4000-8000-000000000001'
const budgetId = '00000000-0000-4000-8000-000000000002'
const equipmentId = '00000000-0000-4000-8000-000000000003'
const lineId = '00000000-0000-4000-8000-000000000004'
const stamp = '2027-12-31T12:00:00.000000+00:00'
const budget: CropBudget = { id: budgetId, farm_id: farmId, crop_year: 2027, commodity_id: 'corn', operating_entity_id: null, enterprise_label: null, name: '2027 Corn', expected_yield_per_acre: 200, expected_price_per_bushel: 4.5, rp_coverage_pct: null, rp_aph_yield: null, rp_projected_price: null, rp_premium_per_acre: null, copied_from_budget_id: null, created_at: stamp, updated_at: stamp }
const equipment: ProfitabilityEquipment[] = [{ id: equipmentId, farm_id: farmId, name: 'Sprayer 4', status: 'active' }]
const preview: EquipmentCostSnapshotPreview = {
  candidate: { line_id: lineId, budget_id: budgetId, equipment_id: equipmentId, equipment_name: 'Sprayer 4', category: 'repairs', label: 'Sprayer 4 service costs 2027-01-01 to 2027-12-31', amount_per_acre: '2.406', period_start: '2027-01-01', period_end: '2027-12-31', total_source_amount: '300.75', allocation_acres: '125', included_row_count: 2, excluded_null_cost_count: 1, captured_at: stamp },
  existing: { id: lineId, budget_id: budgetId, category: 'repairs', name: 'Old Sprayer 4 service costs', amount_per_acre: 2, source_kind: 'equipment', source_record_id: equipmentId, equipment_snapshot: { period_start: '2027-01-01', period_end: '2027-12-31', total_source_amount: 250, allocation_acres: 125, included_row_count: 1, excluded_null_cost_count: 0, captured_at: '2027-06-30T12:00:00.000000+00:00' }, created_at: stamp, updated_at: stamp },
}

const win = new Window({ url: 'http://farmrx.test/profitability/budgets' })
Object.assign(globalThis, { React, window: win, document: win.document, localStorage: win.localStorage, sessionStorage: win.sessionStorage, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, MouseEvent: win.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator })
const { EquipmentCostImporter } = await import('./ProfitabilityModule')
const flush = async () => { await Promise.resolve(); await new Promise<void>((resolve) => setTimeout(resolve, 0)) }

let previews = 0; const saves: Array<{ request: EquipmentCostSnapshotRequest; action: string }> = []
const saveCount = () => saves.length
const repository = {
  previewEquipmentCostSnapshot: async (request: EquipmentCostSnapshotRequest) => { previews += 1; assert(request.budget_id === budgetId && request.equipment_id === equipmentId && request.period_start === '2027-01-01' && request.period_end === '2027-12-31' && request.allocation_acres === 125, 'UI did not preview the selected budget, machine, default crop-year period, and acres.'); return preview },
  saveEquipmentCostSnapshot: async (request: EquipmentCostSnapshotRequest, action: 'insert' | 'replace') => { saves.push({ request: structuredClone(request), action }); return 'saved' as const },
}

const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
try {
  await act(async () => { root.render(createElement(EquipmentCostImporter, { budget, equipment, budgetAcres: 125, onSaved: async () => undefined, onError: () => undefined, repository })); await flush() })
  const button = (label: string) => [...container.querySelectorAll('button')].find((item) => item.textContent?.trim() === label)
  assert(button('Import equipment service costs'), 'Equipment snapshot importer did not render its explicit entry action.')
  await act(async () => { button('Import equipment service costs')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() })
  const acres = [...container.querySelectorAll('input')].find((input) => input.inputMode === 'decimal') as HTMLInputElement | undefined
  assert(acres?.value === '125', 'Equipment snapshot importer did not default allocation acres from the budget.')
  await act(async () => { root.render(createElement(EquipmentCostImporter, { budget, equipment, budgetAcres: 100, onSaved: async () => undefined, onError: () => undefined, repository })); await flush() })
  assert(container.textContent?.includes("more than this budget's 100 allocated acres"), 'Allocation acres above budget acres must warn without blocking review.')
  await act(async () => { button('Review server total')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() })
  assert(previews === 1 && saveCount() === 0, 'Reviewing the server total must not write a snapshot.')
  assert(container.textContent?.includes('Old snapshot vs current server total') && container.textContent.includes('1 entry has no cost and is excluded') && button('Replace old snapshot') && button('Keep old'), 'Re-import must show old versus current, the excluded-null count, and explicit Replace/Keep old actions.')
  await act(async () => { button('Keep old')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() })
  assert(saveCount() === 0 && !container.textContent?.includes('Old snapshot vs current server total'), 'Keep old must make no write.')
  await act(async () => { button('Review server total')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() })
  await act(async () => { button('Replace old snapshot')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await flush() })
  assert(saveCount() === 1 && saves[0]?.action === 'replace' && saves[0]?.request.line_id === lineId && saves[0]?.request.expected?.total_source_amount === '300.75' && saves[0]?.request.expected.included_row_count === 2 && saves[0]?.request.expected.excluded_null_cost_count === 1, 'Replace must carry the exact reviewed server totals and existing line id.')
  assert(container.textContent?.includes('Purchase price is never included') && container.textContent.includes('Later service-log changes do not change a saved snapshot'), 'Snapshot truth and purchase-price exclusion must stay visible.')
} finally {
  await act(async () => root.unmount()); container.remove(); win.close()
}
console.log('Profitability equipment-cost snapshot UI regression passed')
// ProfitabilityModule imports the real app data graph, whose Supabase runtime keeps
// a MessagePort open in Node. Every assertion and React cleanup has completed here.
process.exit(0)
