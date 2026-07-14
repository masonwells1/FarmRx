import {
  buildBinLedgerRow,
  buildProductionSaveInput,
  displayBushels,
  HARVEST_RECONCILIATION_SCOPE_SUPPRESSION_COPY,
  movementCommodityOptions,
} from '../GrainModule'
import type { BinInventory, BinTransaction, ProductionEstimate } from './grain'
import { isBinTransactionSuperseded, PRE_BASELINE_BIN_MOVEMENT_MESSAGE } from './binLedger'
import { farmerError } from '../lib/farmerErrors'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

const estimate = { id: 'estimate', farm_id: 'farm', crop_year: 2026, commodity_id: 'corn_yellow', operating_entity_id: null, enterprise_label: null, planted_acres: null, aph_yield: 200, expected_bushels: 40_000, actual_bushels: null, drives_math: 'projected', notes: null, created_at: '2026-07-01T00:00:00.000Z', updated_at: '2026-07-01T00:00:00.000Z' } as ProductionEstimate
const savedHarvestTotal = buildProductionSaveInput(estimate, '200', '40000', 'actual', 50000)
assert(savedHarvestTotal.actual_bushels === 50000 && savedHarvestTotal.drives_math === 'actual', 'Harvest reconciliation must save its 50,000-bu override, not stale 40,000-bu form state.')

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

console.log('Grain repair regressions passed.')
