import type { CashBid, GrainWorkspace, PositionScope } from './grain'

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

/** Latest basis used in position/revenue math must come from a farmer-entered bid, never the MARS feed. */
export function latestBasis(workspace: GrainWorkspace, scope: PositionScope) {
  return workspace.cash_bids
    .filter((bid) => !isMarsBid(bid) && bid.farm_id === scope.farm_id && bid.commodity_id === scope.commodity_id)
    .sort((left, right) => right.bid_date.localeCompare(left.bid_date))[0]?.basis ?? 0
}
