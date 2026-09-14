/**
 * The ONE calendar-date helper for farmer-facing "today" defaults (audit P2-11).
 * It uses the DEVICE's local calendar day — never `toISOString()`, which is UTC and
 * records "tomorrow" for a US Central farmer entering work after ~6-7 PM.
 * Device-local is correct for the farmer standing on the farm, which is the defect the
 * audit demonstrated. Where the farm itself is loaded, `farmCalendarDate` below uses the
 * farm's stored IANA time zone (farms.time_zone, the same authority the database's
 * due-generation uses), so a traveling manager sees the farm's day, not the device's.
 */
export function farmLocalCalendarDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** The farm's calendar day in its stored time zone; the device's day when the zone is unknown or unusable. */
export function farmCalendarDate(now: Date, timeZone: string | null | undefined): string {
  if (!timeZone) return farmLocalCalendarDate(now)
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
    const part = (type: string) => parts.find((item) => item.type === type)?.value
    const year = part('year'); const month = part('month'); const day = part('day')
    if (!year || !month || !day) return farmLocalCalendarDate(now)
    return `${year}-${month}-${day}`
  } catch {
    return farmLocalCalendarDate(now)
  }
}
