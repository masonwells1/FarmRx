import type { GrainLoadDraft, GrainWorkspace } from './grain'
import { loadLotFor, lotsSaveResolvesAgainst, originBinLots, recordedBinLots, validateGrainLoad } from './grain'

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
  origin_kind: 'bin', origin_grain_bin_id: binA, origin_crop_assignment_id: '', origin_crop_year: '', origin_commodity_id: '',
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

// ---------------------------------------------------------------- 9. the database's answer wins
// LD-4 repair (Codex P1 on ba64007). loadWorkspace reads bin_transactions unbounded and newest
// first, so PostgREST's row cap drops the OLDEST movements -- and an older still-active crop year
// with them. Derived from a short array the bin looks like a one-lot bin, the form offers no
// choice, the save sends no crop year, and save_grain_load refuses it because IT sees two lots.
// The farmer is then stuck: a refusal naming a choice the form is not showing.
{
  // The workspace knows only the 2025 baseline. The movement that put 4,000 bu of 2026 in the bin
  // is past the cap and simply absent.
  const truncated = workspaceWith([baseline(binA, 2025, 'corn_yellow', 6000)], [])
  assert(loadLotFor(truncated, draftFrom({})) !== null, 'Without the repair a truncated workspace silently settles on one lot -- this pins the behaviour being replaced.')

  // What the database actually holds, which is what save_grain_load reads.
  const authoritative = [
    { commodity_id: 'corn_yellow', crop_year: 2026, bushels: 4000 },
    { commodity_id: 'corn_yellow', crop_year: 2025, bushels: 6000 },
  ]
  assert(loadLotFor(truncated, draftFrom({}), authoritative) === null, 'With the database answer the same bin must refuse to guess, exactly as the server will.')

  const problems = validateGrainLoad(draftFrom({}), truncated, authoritative)
  assert(problems.some((problem) => problem.includes('more than one crop year')), `The farmer must be asked, not refused after saving. Saw ${JSON.stringify(problems)}.`)

  // And the answer they give is honoured against the database's list, not the short one.
  const chosen = loadLotFor(truncated, draftFrom({ origin_crop_year: '2026' }), authoritative)
  assert(chosen !== null && chosen.crop_year === 2026, 'A lot the workspace never saw must still be haulable once the database names it.')
  assert(validateGrainLoad(draftFrom({ origin_crop_year: '2026' }), truncated, authoritative).length === 0, 'A chosen lot the database confirms must leave nothing to fix.')

  // A year in neither list is still refused, so the authoritative path did not become a rubber stamp.
  assert(loadLotFor(truncated, draftFrom({ origin_crop_year: '2019' }), authoritative) === null, 'The database list is a list, not a licence: an unheld year must still be refused.')
}

// --------------------------------------------- 10. the list a SAVE resolves against, which is not one list
// LD-4 repair (Codex P2 on ef8a29e). save_grain_load keys on whether a crop year was NAMED and on
// nothing else: a named year is looked up among every lot the bin has a RECORD of, and an unnamed
// one is defaulted from what the bin still HOLDS. MockGrainRepository.saveLoad stands in for that
// function and passed neither list, so both of its calls fell through to binLotsOnHand -- on-hand
// for both cases. A ticket-only load naming an emptied lot was refused by the mock while the real
// RPC accepts it, so the path the previous round repaired could not be reached by any mock-backed
// test at all. These assertions pin the rule itself, in the one place it is now written down.
{
  // The bin has a record of two lots. The 2025 corn was hauled away to the bushel; the 2026 corn
  // is still there. deriveBinLots keeps the emptied row at zero on purpose.
  const workspace = workspaceWith(
    [baseline(binA, 2025, 'corn_yellow', 6000)],
    [
      movement(binA, 'out', 6000, 'corn_yellow', 2025, '2026-10-01'),
      movement(binA, 'in', 4000, 'corn_yellow', 2026, '2026-10-02'),
    ],
  )

  const recorded = recordedBinLots(workspace, binA)
  assert(recorded.length === 2, `The bin has a record of two lots, saw ${JSON.stringify(recorded)}.`)
  const emptied = recorded.find((lot) => lot.crop_year === 2025)
  assert(emptied !== undefined && Math.abs(emptied.bushels) < 0.000001, 'The emptied lot must still be recorded, at zero.')
  // originBinLots is the on-hand twin, and the difference between them is the whole point.
  assert(originBinLots(workspace, binA).length === 1, 'The on-hand list must hold only the 2026 lot.')

  // A NAMED year resolves against every recorded lot, emptied ones included.
  const named = draftFrom({ origin_crop_year: '2025', origin_commodity_id: 'corn_yellow', effect_bin_out: false })
  const namedLots = lotsSaveResolvesAgainst(recorded, named)
  assert(namedLots.length === 2, 'A named year is resolved against the recorded list, not the on-hand one.')
  const namedLot = loadLotFor(workspace, named, namedLots)
  assert(namedLot !== null && namedLot.crop_year === 2025, `A ticket for grain already hauled must name the year it really was, saw ${JSON.stringify(namedLot)}.`)
  assert(validateGrainLoad(named, workspace, namedLots).length === 0, `Naming an emptied lot must leave nothing to fix, saw ${JSON.stringify(validateGrainLoad(named, workspace, namedLots))}.`)

  // This is the assertion that fails without the repair: binLotsOnHand drops the 2025 row, so the
  // same draft is refused with a message about a crop the bin demonstrably has a record of.
  const withoutRepair = validateGrainLoad(named, workspace)
  assert(withoutRepair.some((problem) => problem.includes('does not hold the 2025 crop')),
    'This pins the behaviour being replaced: resolving a named year against the on-hand list alone refuses a lot the server accepts.')

  // An UNNAMED year defaults from what the bin still holds, exactly as the server does. The emptied
  // lot is a real lot with nothing left in it, and is no answer to "which crop year is this".
  const unnamed = draftFrom({})
  const unnamedLots = lotsSaveResolvesAgainst(recorded, unnamed)
  assert(unnamedLots.length === 1 && unnamedLots[0]!.crop_year === 2026, 'An unnamed year must default from the on-hand list.')
  const defaulted = loadLotFor(workspace, unnamed, unnamedLots)
  assert(defaulted !== null && defaulted.crop_year === 2026, `A bin holding one lot still answers for itself, saw ${JSON.stringify(defaulted)}.`)

  // And the wider list is a list, not a licence: a year the bin has no record of is still refused.
  const unheld = draftFrom({ origin_crop_year: '2019', origin_commodity_id: 'corn_yellow' })
  assert(loadLotFor(workspace, unheld, lotsSaveResolvesAgainst(recorded, unheld)) === null,
    'A year the bin never held must be refused however the list was built.')
}

console.log('Load origin lot regressions passed (10 coverage groups).')
