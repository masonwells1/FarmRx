import {
  buildBinLedgerRow,
  buildHarvestReconciliationInput,
  displayBushels,
  HARVEST_RECONCILIATION_SCOPE_SUPPRESSION_COPY,
  movementCommodityOptions,
} from '../GrainModule'
import type { BinInventory, BinTransaction, ProductionEstimate } from './grain'
import { isBinTransactionSuperseded, PRE_BASELINE_BIN_MOVEMENT_MESSAGE } from './binLedger'
import { farmerError } from '../lib/farmerErrors'
import { readFileSync } from 'node:fs'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

const estimate = { id: 'estimate', farm_id: 'farm', crop_year: 2026, commodity_id: 'corn_yellow', operating_entity_id: null, enterprise_label: null, planted_acres: null, aph_yield: 200, expected_bushels: 40_000, actual_bushels: null, drives_math: 'projected', notes: null, created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z' } as ProductionEstimate
const unsavedAphText = '999'
const unsavedActualText = '40000'
const reconciledHarvestTotal = buildHarvestReconciliationInput(estimate, 50_000)
assert(JSON.stringify(reconciledHarvestTotal) === JSON.stringify({ ...estimate, actual_bushels: 50_000, drives_math: 'actual' }), 'Harvest reconciliation must preserve the persisted production estimate exactly except Grain actual and its math basis.')
assert(reconciledHarvestTotal.aph_yield !== Number(unsavedAphText) && reconciledHarvestTotal.actual_bushels !== Number(unsavedActualText), 'Unsaved APH and actual form text must not affect harvest reconciliation.')

const cornBaseline = { id: 'baseline', farm_id: 'farm', grain_bin_id: 'bin', crop_year: 2026, commodity_id: 'corn_yellow', bushels: 600, committed_bushels: 0, measured_at: '2026-07-01T12:00:00.000Z', notes: null, created_at: '2026-07-01T12:00:00.000Z', updated_at: '2026-07-01T12:00:00.000Z' } as BinInventory
const cornBeforeBaseline = { id: 'corn-before', farm_id: 'farm', grain_bin_id: 'bin', direction: 'in', bushels: 100, commodity_id: 'corn_yellow', occurred_on: '2026-07-01', note: null, source_kind: 'manual entry', created_at: '2026-07-01T00:00:00.000Z' } as BinTransaction
const soyBeforeBaseline = { ...cornBeforeBaseline, id: 'soy-before', commodity_id: 'soybeans' }
assert(isBinTransactionSuperseded(cornBaseline, cornBeforeBaseline) && !isBinTransactionSuperseded(cornBaseline, soyBeforeBaseline), 'Only pre-baseline movements for the baseline commodity may be superseded.')
const cornLedgerRow = buildBinLedgerRow(cornBaseline, cornBeforeBaseline)
const soyLedgerRow = buildBinLedgerRow(cornBaseline, soyBeforeBaseline)
assert(cornLedgerRow.superseded && !soyLedgerRow.superseded && cornLedgerRow.label === 'In · 100 bu' && soyLedgerRow.label === 'In · 100 bu', 'The GrainModule ledger-row builder must label only the corn pre-baseline row as superseded.')

assert(displayBushels(1000.25) === '1,000.25', 'Fractional bin totals must use displayBushels without truncation.')
const commodities = [{ id: 'corn_yellow' }, { id: 'soybeans' }, { id: 'wheat' }]
assert(movementCommodityOptions(commodities, undefined, [{ ...cornBeforeBaseline, occurred_on: '2026-07-02' }]).map((item) => item.id).join('|') === 'corn_yellow', 'A bin with a nonzero lot must only offer that active commodity.')
assert(movementCommodityOptions(commodities, undefined, []).map((item) => item.id).join('|') === 'corn_yellow|soybeans|wheat', 'An empty bin must offer every commodity.')
assert(HARVEST_RECONCILIATION_SCOPE_SUPPRESSION_COPY === 'Harvest-minus-bins is not shown because bins cover the whole farm and all years.', 'The reconciliation scope-suppression copy must be the exported UI constant.')
assert(farmerError(new Error('Movement date must be after the latest bin baseline.'), 'add this movement') === PRE_BASELINE_BIN_MOVEMENT_MESSAGE && farmerError(new Error(PRE_BASELINE_BIN_MOVEMENT_MESSAGE), 'add this movement') === PRE_BASELINE_BIN_MOVEMENT_MESSAGE, 'Repository and database pre-baseline rejections must share the farmer-facing baseline message.')

const grainModule = readFileSync(new URL('../GrainModule.tsx', import.meta.url), 'utf8')
assert(grainModule.includes('const refresh = async (strict = false)') && grainModule.includes('if (strict) throw new Error(message);'), 'Post-write refresh must reject while initial page refresh remains handled.')
const deliveryAction = grainModule.slice(grainModule.indexOf('const record = async () => {'), grainModule.indexOf('return <div className="contract-actions">'))
assert(deliveryAction.includes('deliveryDraft.current ??=') && deliveryAction.includes('recordContractDelivery(deliveryDraft.current)'), 'Delivery retry must reuse the complete original delivery payload.')
assert(deliveryAction.indexOf('await onDeliverySaved();') < deliveryAction.indexOf('deliveryDraft.current = null;') && deliveryAction.indexOf('await onDeliverySaved();') < deliveryAction.indexOf('setDelivery("");'), 'Delivery draft and form values must remain until the saved row is confirmed by refresh.')
assert(grainModule.includes('disabled={deliveryUnconfirmed}') && grainModule.includes('deliveryUnconfirmed ? "Retry delivery" : "Record delivery"'), 'An uncertain delivery must keep its visible bushels locked to the retained payload during retry.')
assert(grainModule.includes('await refresh(true); whisper();') && grainModule.includes('Delivery may be recorded but could not be confirmed. Retry keeps the same delivery and will not create another.'), 'Delivery refresh failure must remain retry-safe and truthful.')
const movementSubmit = grainModule.slice(grainModule.indexOf('const submit = async (event: FormEvent) => {', grainModule.indexOf('function MovementForm')), grainModule.indexOf('return (', grainModule.indexOf('function MovementForm')))
assert(movementSubmit.indexOf('await onSave(transaction);') < movementSubmit.indexOf('movementId.current = null;'), 'Movement UUID must remain until the saved row is confirmed by refresh.')
assert(grainModule.includes('This bin movement may be recorded but could not be confirmed. Retry keeps the same movement and will not create another.'), 'Movement refresh failure must remain retry-safe and truthful.')
assert(grainModule.includes('Recording a delivery does not remove grain from a bin.') && grainModule.includes('Bin-out changes this bin only. It does not mark a contract delivered.'), 'The UI must explain that delivery and bin-out are separate farmer actions.')

console.log('Grain repair regressions passed.')
