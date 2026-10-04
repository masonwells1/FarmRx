const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/

/** Show a stored calendar date (YYYY-MM-DD) as "Jul 9, 2027". The date is built from its own parts so no time zone can move it
 * a day; anything that is not a plain calendar date is shown unchanged. */
export function formatFarmDate(value: string): string {
  const match = isoDate.exec(value)
  if (!match) return value
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  if (date.getMonth() !== Number(match[2]) - 1) return value
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
