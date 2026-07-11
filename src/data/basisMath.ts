import type { CashBid, GrainWorkspace, PositionScope } from './grain'

/** USDA MARS 2850 (Iowa pilot) feed rows are display-only history, never a manual bid. */
export const isMarsBid = (bid: Pick<CashBid, 'notes'>) => bid.notes?.startsWith('[USDA MARS 2850]') === true

/** Latest basis used in position/revenue math must come from a farmer-entered bid, never the MARS feed. */
export function latestBasis(workspace: GrainWorkspace, scope: PositionScope) {
  return workspace.cash_bids
    .filter((bid) => !isMarsBid(bid) && bid.farm_id === scope.farm_id && bid.commodity_id === scope.commodity_id)
    .sort((left, right) => right.bid_date.localeCompare(left.bid_date))[0]?.basis ?? 0
}
