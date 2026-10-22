import type { CashBid, GrainWorkspace, PositionScope } from './grain'
import { cashBidEligibleForCropYear } from './marketingYear'

const marsNote = /^\[USDA MARS (\S+)(?: · ([^\]]+))?\]/

/** USDA MARS feed rows, from any report, are display-only history, never a manual bid (GL-1 generalizes the 2850 pilot fence).
 * A feed row is recognized by its provenance column; the note marker is kept as a second signal for rows written before the
 * column existed and for cached rows. */
export const isMarsBid = (bid: Pick<CashBid, 'notes'> & Partial<Pick<CashBid, 'feed_source'>>) => bid.feed_source === 'usda_mars' || marsNote.test(bid.notes ?? '')

/** "USDA MARS 2850 · Iowa": the report and the geography it covers, read from the row's own provenance, never assumed.
 * The report id prefers the column (the note only ever repeats it); the geography prefers the note, because the note
 * carries the human name ("Iowa") that the fan-out wrote while the column holds the state code ("IA"). */
export function marsBidLabel(bid: Pick<CashBid, 'notes'> & Partial<Pick<CashBid, 'feed_report_id' | 'feed_geography'>>): string {
  const match = marsNote.exec(bid.notes ?? '')
  const report = bid.feed_report_id ?? match?.[1] ?? null
  const geography = match?.[2] ?? bid.feed_geography ?? null
  return `USDA MARS${report ? ` ${report}` : ''}${geography ? ` · ${geography}` : ''}`
}

/** Newest first: bid date, then entry time, then id, so two bids on one day always resolve the same way. */
export function newestBidFirst(left: CashBid, right: CashBid) {
  return right.bid_date.localeCompare(left.bid_date) || right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id)
}

/** The farmer-entered bids that can speak for one crop year, newest first. A bid belongs to a crop year
 * when its delivery window sits inside that crop's marketing year, or, with no window (spot), when its
 * bid date does — the same rule the alert sweep uses. Without it, today's old-crop spot basis valued
 * next year's HTAs and fed the new-crop line on Today. MARS feed rows are never a local bid. */
export function cropYearBids(workspace: GrainWorkspace, scope: Pick<PositionScope, 'farm_id' | 'commodity_id' | 'crop_year'>): CashBid[] {
  const commodity = workspace.fields.commodities.find((item) => item.id === scope.commodity_id)
  return workspace.cash_bids
    .filter((bid) => !isMarsBid(bid) && bid.farm_id === scope.farm_id && bid.commodity_id === scope.commodity_id
      && cashBidEligibleForCropYear(commodity, scope.crop_year, bid.bid_date, bid.delivery_start, bid.delivery_end))
    .sort(newestBidFirst)
}

/** Latest basis used in position/revenue math: the newest farmer-entered bid for this crop year, or 0
 * when there is none (the position card says so). */
export function latestBasis(workspace: GrainWorkspace, scope: PositionScope) {
  return cropYearBids(workspace, scope)[0]?.basis ?? 0
}

/** GL-3: the buyers and elevators this farm has actually dealt with, for the type-ahead suggestions on
 * the manual bid and contract forms. Replaces two dropdowns that were empty on a farm with no history
 * and so could not be completed at all.
 *
 * A USDA MARS market location is never suggested. A feed row is display-only history; its location is a
 * USDA reporting point, not a place this farm sells grain, and offering it would invite a manual bid or
 * a contract saved against a counterparty that does not exist. Both forms still accept free text, so a
 * new buyer never needs a row to exist first. */
export function knownCounterparties(
  workspace: { cash_bids: Array<Pick<CashBid, 'elevator' | 'notes'> & Partial<Pick<CashBid, 'feed_source'>>>; grain_contracts: Array<{ buyer: string }> },
  extra: Array<string | null | undefined> = [],
): string[] {
  const names = [
    ...workspace.cash_bids.filter((bid) => !isMarsBid(bid)).map((bid) => bid.elevator),
    ...workspace.grain_contracts.map((contract) => contract.buyer),
    ...extra,
  ]
    .map((name) => (typeof name === 'string' ? name.trim() : ''))
    .filter((name) => name.length > 0)
  return [...new Set(names)].sort((left, right) => left.localeCompare(right))
}
