import type { GrainLoadDraft, GrainWorkspace } from './grain'
import { loadLotFor, originBinLots, validateGrainLoad } from './grain'

/** LD-4: which lot a bin origin is hauling, and what the farmer is told when it cannot be settled.
 *
 * LD-1 read the bin's baseline row and nothing else, so a bin could only ever be hauled as its
 * baseline's crop year and a bin with no baseline could not be hauled at all. LD-3 then displayed
 * free bushels of a year the form would refuse to move. These groups pin the rule that replaced it,
 * and the fallback that keeps the form honest before the migration is applied.
 */

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

const farm = '00000000-0000-4000-8000-000000000A00'
const binA = '00000000-0000-4000-8000-000000000A01'
const binB = '00000000-0000-4000-8000-000000000A02'
const stamp = '2026-01-01T00:00:00.000Z'

let sequence = 0
const nextId = () => `00000000-0000-4000-8000-${String(1010 + sequence++).padStart(12, '0')}`

const baseline = (grain_bin_id: string, crop_year: number, commodity_id: string, bushels: number) => ({
  id: nextId(), farm_id: farm, grain_bin_id, crop_year, commodity_id, bushels,
  committed_bushels: 0, measured_at: stamp, notes: null, created_at: stamp, updated_at: stamp,
})

const movement = (grain_bin_id: string, direction: 'in' | 'out', bushels: number, commodity_id: string, crop_year: number | null, occurred_on: string) => ({
  id: nextId(), farm_id: farm, grain_bin_id, direction, bushels, commodity_id, crop_year,
  occurred_on, note: null, source_kind: null, grain_load_id: null, created_at: stamp,
})

type LotWorkspace = Pick<GrainWorkspace, 'bin_inventory' | 'bin_transactions' | 'fields' | 'grain_contracts' | 'capabilities'>

const workspaceWith = (
  bin_inventory: ReturnType<typeof baseline>[],
  bin_transactions: ReturnType<typeof movement>[],
  binLotCapability = true,
): LotWorkspace => ({
  bin_inventory,
  bin_transactions,
  grain_contracts: [],
  fields: { fields: [], crop_assignments: [], commodities: [] } as unknown as GrainWorkspace['fields'],
  capabilities: { bin_movements: true, contract_price_finalization: true, contract_deliveries: true, grain_load_bin_lot: binLotCapability },
})

const baseDraft: GrainLoadDraft = {
  load_date: '2026-11-01', truck_equipment_id: '', truck_name: '',
  origin_kind: 'bin', origin_grain_bin_id: binA, origin_crop_assignment_id: '', origin_crop_year: '',
  destination_kind: 'buyer', destination_buyer: 'Riverside Elevator',
  destination_grain_contract_id: '', destination_grain_bin_id: '',
  gross_lbs: '', tare_lbs: '', net_bushels: '500', moisture_pct: '', ticket_number: '', notes: '',
  effect_bin_out: true, effect_bin_in: true, effect_contract_delivery: true, effect_harvest: true,
}

function draftFrom(patch: Partial<GrainLoadDraft>): GrainLoadDraft {
  return { ...baseDraft, ...patch }
}

// ---------------------------------------------------------------- 1. a bin holding one lot answers for itself
// The common case, and the one that must cost a farmer in a truck cab no taps at all.
{
  const workspace = workspaceWith([baseline(binA, 2025, 'corn_yellow', 6000)], [])
  const lot = loadLotFor(workspace, draftFrom({}))
  assert(lot !== null, 'A bin holding one lot must settle its own crop year.')
  assert(lot!.crop_year === 2025 && lot!.commodity_id === 'corn_yellow', `Expected the 2025 corn lot, saw ${lot!.crop_year} ${lot!.commodity_id}.`)
  assert(validateGrainLoad(draftFrom({}), workspace).length === 0, 'A one-lot bin needs nothing else answered.')
}

// ---------------------------------------------------------------- 2. a bin holding two lots names nothing
// This is the guess LD-1 made silently, and the defect the whole initiative exists to prevent.
{
  const workspace = workspaceWith(
    [baseline(binA, 2025, 'corn_yellow', 6000)],
    [movement(binA, 'in', 4000, 'corn_yellow', 2026, '2026-10-01')],
  )
  assert(loadLotFor(workspace, draftFrom({})) === null, 'A bin holding two lots must not pick one for the farmer.')

  const problems = validateGrainLoad(draftFrom({}), workspace)
  assert(problems.some((problem) => problem.includes('more than one crop year')), `Expected the farmer to be asked which lot, saw ${JSON.stringify(problems)}.`)

  // And once they answer, either answer works -- including the carry-over year, which LD-1 made the
  // only possible answer and LD-4 makes one of two.
  const newer = loadLotFor(workspace, draftFrom({ origin_crop_year: '2026' }))
  const older = loadLotFor(workspace, draftFrom({ origin_crop_year: '2025' }))
  assert(newer!.crop_year === 2026, 'The newer lot must be haulable once chosen.')
  assert(older!.crop_year === 2025, 'The carry-over lot must still be haulable once chosen.')
  assert(validateGrainLoad(draftFrom({ origin_crop_year: '2026' }), workspace).length === 0, 'A chosen lot the bin holds must leave nothing to fix.')
}

// ---------------------------------------------------------------- 3. a bin with no baseline is an origin
// LD-2's own bin-in effect fills bins that were never measured. Before LD-4 the form refused them.
{
  const workspace = workspaceWith([], [movement(binA, 'in', 2000, 'corn_yellow', 2026, '2026-10-02')])
  const lot = loadLotFor(workspace, draftFrom({}))
  assert(lot !== null && lot.crop_year === 2026, 'A bin filled only by a movement must still name its lot.')
  assert(validateGrainLoad(draftFrom({}), workspace).length === 0, 'A never-measured bin holding one lot is a valid origin.')
}

// ---------------------------------------------------------------- 4. a crop year the bin never held
{
  const workspace = workspaceWith([baseline(binA, 2025, 'corn_yellow', 6000)], [])
  assert(loadLotFor(workspace, draftFrom({ origin_crop_year: '2019' })) === null, 'A crop year the bin never held must not resolve.')
  const problems = validateGrainLoad(draftFrom({ origin_crop_year: '2019' }), workspace)
  assert(problems.some((problem) => problem.includes('does not hold the 2019 crop')), `Expected the invented year to be named, saw ${JSON.stringify(problems)}.`)
}

// ---------------------------------------------------------------- 5. an empty bin, and an unstamped one
{
  const empty = workspaceWith([], [])
  const problems = validateGrainLoad(draftFrom({}), empty)
  assert(problems.some((problem) => problem.includes('no crop with a crop year')), `Expected the empty bin to say so, saw ${JSON.stringify(problems)}.`)

  // Bushels with no crop year are real, and are still not an answer to "which year".
  const unstamped = workspaceWith([], [movement(binA, 'in', 900, 'corn_yellow', null, '2026-10-03')])
  assert(loadLotFor(unstamped, draftFrom({})) === null, 'The unstamped bucket must never be defaulted to.')
  assert(originBinLots(unstamped, binA).length === 0, 'The unstamped bucket must never be offered as a crop year.')
}

// ---------------------------------------------------------------- 6. a lot the bin has emptied is not offered
{
  const workspace = workspaceWith(
    [baseline(binA, 2025, 'corn_yellow', 1000)],
    [
      movement(binA, 'in', 400, 'corn_yellow', 2024, '2026-10-01'),
      movement(binA, 'out', 400, 'corn_yellow', 2024, '2026-10-02'),
    ],
  )
  const offered = originBinLots(workspace, binA)
  assert(offered.length === 1 && offered[0]!.crop_year === 2025, 'An emptied lot must not be offered as a choice.')
  // With one lot left holding anything, the bin answers for itself again.
  assert(loadLotFor(workspace, draftFrom({}))!.crop_year === 2025, 'A bin whose other lot is empty holds a single lot.')
}

// ---------------------------------------------------------------- 7. before the migration, LD-1's rule is the true one
// The LD-006 finding 1 lesson, applied in the other direction. While the capability is false the
// installed save_grain_load still reads the baseline alone, so deriving anything else would tell a
// farmer a load is fine and let the server contradict it on save.
{
  const rows = {
    inventory: [baseline(binA, 2025, 'corn_yellow', 6000)],
    movements: [movement(binA, 'in', 4000, 'corn_yellow', 2026, '2026-10-01')],
  }
  const before = workspaceWith(rows.inventory, rows.movements, false)
  const after = workspaceWith(rows.inventory, rows.movements, true)

  // The same two-lot bin: before the migration it resolves to the baseline, as LD-1 did.
  const legacy = loadLotFor(before, draftFrom({}))
  assert(legacy !== null && legacy.crop_year === 2025, 'Before the migration a bin origin must resolve to its baseline, as the installed RPC does.')
  assert(loadLotFor(after, draftFrom({})) === null, 'After the migration the same bin must ask which lot.')

  // A chosen year is ignored rather than honoured, because the installed RPC would refuse it.
  const ignored = loadLotFor(before, draftFrom({ origin_crop_year: '2026' }))
  assert(ignored !== null && ignored.crop_year === 2025, 'Before the migration a chosen crop year must not change the lot.')

  // A bin with no baseline is still refused before the migration, with LD-1's own words, because
  // that is what the installed RPC will do.
  const noBaseline = workspaceWith([], rows.movements, false)
  const problems = validateGrainLoad(draftFrom({}), noBaseline)
  assert(problems.some((problem) => problem.includes('Set the bin inventory first')), `Expected LD-1's message before the migration, saw ${JSON.stringify(problems)}.`)
}

// ---------------------------------------------------------------- 8. one bin's lots are not another's
{
  const workspace = workspaceWith(
    [baseline(binA, 2025, 'corn_yellow', 6000), baseline(binB, 2026, 'soybeans', 900)],
    [movement(binB, 'in', 100, 'soybeans', 2026, '2026-10-04')],
  )
  assert(originBinLots(workspace, binA).every((lot) => lot.commodity_id === 'corn_yellow'), "One bin's picker must not offer another bin's crop.")
  assert(originBinLots(workspace, binB)[0]!.bushels === 1000, `The second bin should hold 1,000 bu, saw ${originBinLots(workspace, binB)[0]!.bushels}.`)
  // A crop year that exists in the other bin is still not an answer for this one.
  assert(loadLotFor(workspace, draftFrom({ origin_crop_year: '2026' })) === null, "A crop year held only by another bin must not resolve.")
}

console.log('Load origin lot regressions passed (8 coverage groups).')
