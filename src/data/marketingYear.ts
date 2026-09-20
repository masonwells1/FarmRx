/** GL-2: which crop year a cash bid may speak for.
 *
 * Before GL-2 the alert sweep took the newest bid for a commodity whatever its delivery window, so a
 * new-crop bid could fire an old-crop target. A bid is eligible for a crop year only when its delivery
 * window sits inside that crop's marketing year; a bid with no window is spot and belongs to the crop
 * year whose marketing year contains its bid date.
 *
 * This is the browser's copy of `public.cash_bid_eligible_for_crop_year` (migration
 * 20260920160000). The database is the authority — the sweep, not the page, is the monitor — and the
 * two are pinned together by a static guard so neither can be changed alone.
 */

export type CropFamily = 'corn' | 'soybeans' | 'wheat'

/** USDA convention: the corn and soybean marketing years begin September 1, wheat's June 1. The
 * migration seeds `commodities.marketing_year_start_month` / `_day` from the same crop families. */
export const MARKETING_YEAR_START: Record<CropFamily, { month: number; day: number }> = {
  corn: { month: 9, day: 1 },
  soybeans: { month: 9, day: 1 },
  wheat: { month: 6, day: 1 },
}

const isoDate = (year: number, month: number, day: number) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

/** `[start, endExclusive)`, so a window opening exactly on the next marketing year belongs to it. */
export function marketingYearBounds(family: CropFamily, cropYear: number): { start: string; endExclusive: string } {
  const { month, day } = MARKETING_YEAR_START[family]
  return { start: isoDate(cropYear, month, day), endExclusive: isoDate(cropYear + 1, month, day) }
}

/** The one rule, mirrored from SQL. An unknown family or a missing bid date is never eligible
 * (skip, never guess). `cash_bids` permits one delivery bound to be null, so a lone bound is read as
 * a one-day window rather than as an open-ended one. */
export function cashBidEligibleForCropYear(
  family: CropFamily | null | undefined,
  cropYear: number,
  bidDate: string | null | undefined,
  deliveryStart: string | null = null,
  deliveryEnd: string | null = null,
): boolean {
  if (!family || !bidDate || !Number.isInteger(cropYear)) return false
  const { start, endExclusive } = marketingYearBounds(family, cropYear)
  const inside = (value: string) => value >= start && value < endExclusive
  if (deliveryStart === null && deliveryEnd === null) return inside(bidDate)
  const low = deliveryStart ?? (deliveryEnd as string)
  const high = deliveryEnd ?? (deliveryStart as string)
  return inside(low) && inside(high)
}
