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

export type MarketingYearStart = { month: number; day: number }

/** USDA convention: the corn and soybean marketing years begin September 1, wheat's June 1. These are
 * the values the migration seeds into `commodities.marketing_year_start_month` / `_day`, and they are
 * used **only** as the fallback for a commodity row that does not carry the columns yet — that is, on a
 * farm whose database has not had the GL-2 migration applied. Once the columns exist, the stored
 * configuration wins, because the sweep reads it and the two must never judge a bid differently. */
export const MARKETING_YEAR_START: Record<CropFamily, MarketingYearStart> = {
  corn: { month: 9, day: 1 },
  soybeans: { month: 9, day: 1 },
  wheat: { month: 6, day: 1 },
}

export type MarketingYearCommodity = {
  crop_family?: string | null
  marketing_year_start_month?: number | null
  marketing_year_start_day?: number | null
}

/** The stored configuration if the row carries it, the crop-family default if it does not, null when
 * neither is usable. Mirrors `public.commodity_marketing_year`, which reads the same two columns. */
export function marketingYearStartFor(commodity: MarketingYearCommodity | null | undefined): MarketingYearStart | null {
  if (!commodity) return null
  const month = commodity.marketing_year_start_month
  const day = commodity.marketing_year_start_day
  if (Number.isInteger(month) && Number.isInteger(day) && (month as number) >= 1 && (month as number) <= 12 && (day as number) >= 1 && (day as number) <= 28) {
    return { month: month as number, day: day as number }
  }
  const family = commodity.crop_family
  return family !== null && family !== undefined && Object.hasOwn(MARKETING_YEAR_START, family) ? MARKETING_YEAR_START[family as CropFamily] : null
}

const isoDate = (year: number, month: number, day: number) => `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

/** `[start, endExclusive)`, so a window opening exactly on the next marketing year belongs to it. */
export function marketingYearBounds(start: MarketingYearStart, cropYear: number): { start: string; endExclusive: string } {
  return { start: isoDate(cropYear, start.month, start.day), endExclusive: isoDate(cropYear + 1, start.month, start.day) }
}

/** The one rule, mirrored from SQL. An unknown family or a missing bid date is never eligible
 * (skip, never guess). `cash_bids` permits one delivery bound to be null, so a lone bound is read as
 * a one-day window rather than as an open-ended one. */
export function cashBidEligibleForCropYear(
  commodity: MarketingYearCommodity | null | undefined,
  cropYear: number,
  bidDate: string | null | undefined,
  deliveryStart: string | null = null,
  deliveryEnd: string | null = null,
): boolean {
  const configured = marketingYearStartFor(commodity)
  if (!configured || !bidDate || !Number.isInteger(cropYear)) return false
  const { start, endExclusive } = marketingYearBounds(configured, cropYear)
  const inside = (value: string) => value >= start && value < endExclusive
  if (deliveryStart === null && deliveryEnd === null) return inside(bidDate)
  const low = deliveryStart ?? (deliveryEnd as string)
  const high = deliveryEnd ?? (deliveryStart as string)
  return inside(low) && inside(high)
}
