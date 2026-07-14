/**
 * The ONE calendar-date helper for farmer-facing "today" defaults (audit P2-11).
 * It uses the DEVICE's local calendar day — never `toISOString()`, which is UTC and
 * records "tomorrow" for a US Central farmer entering work after ~6-7 PM.
 * A stored per-farm IANA time zone (server authority for traveling managers) needs a
 * schema change and is deliberately deferred; device-local is correct for the farmer
 * standing on the farm, which is the defect the audit demonstrated.
 */
export function farmLocalCalendarDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}
