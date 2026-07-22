import { Window } from 'happy-dom'
import React, { createElement } from 'react'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { ComplianceView } from './InventoryModule'
import type { ApplicationProduct, ApplicationRecord, InventoryWorkspace } from './data/inventory'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }
const win = new Window({ url: 'http://farmrx.test/inventory' })
Object.assign(globalThis, { React, window: win, document: win.document, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, MouseEvent: win.MouseEvent, IS_REACT_ACT_ENVIRONMENT: true })
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: win.navigator })
const stamp='2027-06-15T19:10:00.000000+00:00';const farm='farm-prairie';const field='field-prairie';const crop='crop-prairie';const completed='application-prairie';const complete='application-complete';const draft='application-draft'
const application=(id:string,status:ApplicationRecord['status'],overrides:Partial<ApplicationRecord>={}):ApplicationRecord=>({id,farm_id:farm,field_id:field,crop_assignment_id:crop,status,application_date:'2027-06-15',start_time:'14:10',applied_acres:120,target_pest:'Synthetic broadleaf',applicator_name_snapshot:'Scenario Operator',applicator_license_number_snapshot:'PRESENCE-ONLY-2027',wind_speed_mph:0,wind_direction:'CALM',temperature_f:0,relative_humidity_pct:0,completed_at:status==='completed'?stamp:null,void_reason:null,corrects_application_id:null,created_at:stamp,...overrides})
const product=(id:string,name:string,overrides:Partial<ApplicationProduct>={}):ApplicationProduct=>({id,application_id:completed,product_id:`product-${id}`,product_kind_snapshot:'chemical',product_name_snapshot:name,epa_registration_number_snapshot:'00000-000',is_restricted_use_snapshot:true,signal_word_snapshot:'caution',restricted_entry_interval_hours_snapshot:12,preharvest_interval_hours_snapshot:0,max_label_rate_snapshot:0.125,max_label_rate_unit_snapshot:'gal',max_label_rate_basis_snapshot:'acre',inventory_unit_snapshot:'gal',rate:0.0625,rate_unit:'gal',rate_basis:'acre',total_quantity:7.5,total_unit:'gal',inventory_units_per_total_unit:1,quantity_in_inventory_unit:7.5,unit_cost_per_inventory_unit_snapshot:null,...overrides})
const workspace={fields:{farm:{id:farm} as never,entities:[],fields:[{id:field,name:'Prairie South 120'} as never],crop_assignments:[{id:crop,field_id:field} as never],arrangements:[],commodities:[]},products:[],receipts:[],receipt_lines:[],adjustments:[],applications:[application(completed,'completed'),application(complete,'completed',{start_time:'09:00',target_pest:'Complete pest',wind_speed_mph:2,wind_direction:'N',temperature_f:70,relative_humidity_pct:40}),application(draft,'draft',{target_pest:'DRAFT MUST NOT RENDER'})],application_products:[product('herbicide','Synthetic Herbicide 41'),product('adjuvant','Distinctive Drift Control',{epa_registration_number_snapshot:null,signal_word_snapshot:null,restricted_entry_interval_hours_snapshot:null,preharvest_interval_hours_snapshot:null,max_label_rate_snapshot:null,max_label_rate_unit_snapshot:null,max_label_rate_basis_snapshot:null,rate:1,rate_unit:'pt',rate_basis:'100_gal',total_quantity:2,total_unit:'pt',quantity_in_inventory_unit:.25,inventory_units_per_total_unit:.125}),product('complete','Complete Product',{application_id:complete,is_restricted_use_snapshot:false,rate:.1,total_quantity:12,quantity_in_inventory_unit:12,preharvest_interval_hours_snapshot:1})],on_hand:[],rup_completeness:[],program_application_products:[]} satisfies InventoryWorkspace
let mutationCalls=0;const setShowIncomplete=()=>{mutationCalls++};const container=document.createElement('div');document.body.append(container);const root=createRoot(container)
try{
  await act(async()=>{root.render(createElement(ComplianceView,{workspace,showIncomplete:false,setShowIncomplete}));await Promise.resolve()})
  const text=container.textContent??''
  for(const expected of ['Prairie South 120','14:10','Synthetic broadleaf','Scenario Operator','PRESENCE-ONLY-2027','0 mph · CALM','0 °F','0%','Synthetic Herbicide 41','0.0625 gal per acre','7.5 gal','00000-000','caution','12 hr','0 hr','0.125 gal per acre','Distinctive Drift Control','1 pt per 100 gal','2 pt','Not recorded','Complete pest'])assert(text.includes(expected),`Missing saved compliance fact: ${expected}`)
  const herbicide=container.querySelector('[aria-label="Saved product: Synthetic Herbicide 41"]')?.textContent??'';const adjuvant=container.querySelector('[aria-label="Saved product: Distinctive Drift Control"]')?.textContent??''
  assert(herbicide.includes('00000-000')&&herbicide.includes('7.5 gal')&&!herbicide.includes('Not recorded'),'First product snapshots were associated incorrectly.')
  assert(adjuvant.includes('1 pt per 100 gal')&&adjuvant.includes('2 pt')&&adjuvant.includes('Not recorded')&&!adjuvant.includes('00000-000'),'Second product snapshots were associated incorrectly.')
  assert(!text.includes('DRAFT MUST NOT RENDER'),'A non-completed application appeared in Compliance.')
  for(const forbidden of ['valid','verified','eligible','eligibility','licensed','unexpired','expired'])assert(!new RegExp(`\\b${forbidden}\\b`,'i').test(text),`Compliance made a legal claim: ${forbidden}`)
  assert(mutationCalls===0&&!container.querySelector('form'),'Reading Compliance invoked a mutation path.')
  await act(async()=>{root.render(createElement(ComplianceView,{workspace,showIncomplete:true,setShowIncomplete}));await Promise.resolve()})
  const incomplete=container.textContent??'';assert(incomplete.includes('Synthetic Herbicide 41')&&!incomplete.includes('Complete pest')&&!incomplete.includes('DRAFT MUST NOT RENDER'),'Incomplete filtering did not retain only incomplete completed records.')
  assert(mutationCalls===0,'Filtering render invoked a mutation callback.')
}finally{await act(async()=>{root.unmount()});container.remove();win.close()}
console.log('Inventory compliance saved-detail regression passed')
