// GL-1: pure parsing of a USDA AMS My Market News (MARS) cash-grain-bid report into
// the observations the database fan-out accepts. No fetch, no clock, no secrets.
//
// The rule is "skip, never guess": a row is kept only when every field it needs is
// present in a form this module recognizes; anything else is counted with a reason
// and the field names seen are reported so the first live run shows the true shape.

export interface MarsObservation {
  observation_key: string
  elevator: string
  commodity_id: string
  bid_date: string
  basis: number
  cash_price: number | null
  delivery_start: string | null
  delivery_end: string | null
  source_note: string | null
}

export interface MarsSkip {
  index: number
  reason: string
}

export interface MarsParseResult {
  shape: 'results' | 'array' | 'unrecognized'
  rowCount: number
  reportDate: string | null
  observations: MarsObservation[]
  skipped: MarsSkip[]
  columns: string[]
}

/** The explicit commodity whitelist: a MARS commodity label (lower-cased, trimmed) to a Farm Rx commodity id. */
export const MARS_COMMODITY_MAP: Readonly<Record<string, string>> = Object.freeze({
  corn: 'corn_yellow',
  'yellow corn': 'corn_yellow',
  'corn, yellow': 'corn_yellow',
  soybeans: 'soybeans',
  soybean: 'soybeans',
  wheat: 'wheat',
  'soft red winter wheat': 'wheat',
  'srw wheat': 'wheat',
  'wheat, soft red winter': 'wheat',
})

/** Plausibility bounds, in dollars per bushel. A value outside them is skipped rather than reinterpreted. */
export const MARS_LIMITS = Object.freeze({
  maximumAbsoluteBasis: 3,
  maximumCashPrice: 50,
  maximumKeyLength: 200,
  maximumTextLength: 200,
})

const numberPattern = /^-?\d+(?:\.\d+)?$/

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!numberPattern.test(trimmed)) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function textValue(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length === 0 ? null : trimmed
}

/** Accepts YYYY-MM-DD, MM/DD/YYYY, and either followed by a time; returns YYYY-MM-DD or null. */
export function marsDate(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(trimmed)
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[T ].*)?$/.exec(trimmed)
  let year: number, month: number, day: number
  if (iso) { year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]) }
  else if (us) { year = Number(us[3]); month = Number(us[1]); day = Number(us[2]) }
  else return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/** FNV-1a 64-bit, hex. Deterministic, dependency-free; used only to bound a long observation key. */
export function fnv1a64Hex(input: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  for (const byte of new TextEncoder().encode(input)) {
    hash ^= BigInt(byte)
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

const identityFields = ['slug_id', 'slug_name', 'report_slug', 'class', 'grade', 'sale_type', 'market_type', 'office_city', 'office_state', 'market_location_city', 'market_location_state', 'freight', 'pkg', 'price_unit'] as const

type Row = Record<string, unknown>

function rowsOf(body: unknown): { shape: MarsParseResult['shape']; rows: Row[] } {
  if (Array.isArray(body)) return { shape: 'array', rows: body.filter((row): row is Row => !!row && typeof row === 'object' && !Array.isArray(row)) }
  if (body && typeof body === 'object' && Array.isArray((body as { results?: unknown }).results)) {
    return { shape: 'results', rows: ((body as { results: unknown[] }).results).filter((row): row is Row => !!row && typeof row === 'object' && !Array.isArray(row)) }
  }
  return { shape: 'unrecognized', rows: [] }
}

/** A stated range is kept as its midpoint with the range written into the note; a single value is kept as is. */
function rangeOrValue(row: Row, single: readonly string[], low: string, high: string, label: string): { value: number | null; note: string | null; present: boolean; malformed: boolean } {
  for (const key of single) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
      const value = finiteNumber(row[key])
      return { value, note: null, present: true, malformed: value === null }
    }
  }
  const lowPresent = row[low] !== undefined && row[low] !== null && row[low] !== ''
  const highPresent = row[high] !== undefined && row[high] !== null && row[high] !== ''
  if (!lowPresent && !highPresent) return { value: null, note: null, present: false, malformed: false }
  const lowValue = lowPresent ? finiteNumber(row[low]) : null
  const highValue = highPresent ? finiteNumber(row[high]) : null
  if ((lowPresent && lowValue === null) || (highPresent && highValue === null)) return { value: null, note: null, present: true, malformed: true }
  if (lowValue !== null && highValue !== null) {
    if (lowValue === highValue) return { value: lowValue, note: null, present: true, malformed: false }
    const lo = Math.min(lowValue, highValue); const hi = Math.max(lowValue, highValue)
    return { value: Math.round(((lo + hi) / 2) * 10000) / 10000, note: `${label} range ${lo.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')} to ${hi.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`, present: true, malformed: false }
  }
  return { value: lowValue ?? highValue, note: null, present: true, malformed: false }
}

export function parseMarsReport(body: unknown, options: { reportId: string; commodityMap?: Readonly<Record<string, string>> }): MarsParseResult {
  const { shape, rows } = rowsOf(body)
  const commodityMap = options.commodityMap ?? MARS_COMMODITY_MAP
  const columns = new Set<string>()
  const observations: MarsObservation[] = []
  const skipped: MarsSkip[] = []
  const seenKeys = new Set<string>()
  let reportDate: string | null = null

  rows.forEach((row, index) => {
    for (const key of Object.keys(row)) columns.add(key)
    const skip = (reason: string) => { skipped.push({ index, reason }) }

    const bidDate = marsDate(row.report_date) ?? marsDate(row.report_end_date) ?? marsDate(row.published_date)
    if (!bidDate) return skip('missing_date')
    if (reportDate === null || bidDate > reportDate) reportDate = bidDate

    const location = textValue(row.market_location_name) ?? textValue(row.location) ?? textValue(row.office_name)
    if (!location) return skip('missing_location')
    if (location.length > MARS_LIMITS.maximumTextLength) return skip('location_too_long')

    const commodityLabel = textValue(row.commodity)
    if (!commodityLabel) return skip('missing_commodity')
    const commodityId = commodityMap[commodityLabel.toLowerCase()]
    if (!commodityId) return skip('commodity_not_whitelisted')

    const basis = rangeOrValue(row, ['basis', 'basis_avg', 'avg_basis'], 'basis_min', 'basis_max', 'basis')
    if (!basis.present) return skip('missing_basis')
    if (basis.malformed || basis.value === null) return skip('basis_malformed')
    if (Math.abs(basis.value) > MARS_LIMITS.maximumAbsoluteBasis) return skip('basis_implausible')

    const price = rangeOrValue(row, ['price', 'cash_price', 'price_avg', 'avg_price'], 'price_min', 'price_max', 'price')
    if (price.present && (price.malformed || price.value === null)) return skip('price_malformed')
    if (price.value !== null && (price.value < 0 || price.value > MARS_LIMITS.maximumCashPrice)) return skip('price_implausible')

    const deliveryStartRaw = row.delivery_start ?? row.delivery_period_start ?? row.delivery_begin
    const deliveryEndRaw = row.delivery_end ?? row.delivery_period_end
    const deliveryStart = deliveryStartRaw === undefined || deliveryStartRaw === null || deliveryStartRaw === '' ? null : marsDate(deliveryStartRaw)
    const deliveryEnd = deliveryEndRaw === undefined || deliveryEndRaw === null || deliveryEndRaw === '' ? null : marsDate(deliveryEndRaw)
    if ((deliveryStartRaw !== undefined && deliveryStartRaw !== null && deliveryStartRaw !== '' && deliveryStart === null) || (deliveryEndRaw !== undefined && deliveryEndRaw !== null && deliveryEndRaw !== '' && deliveryEnd === null)) return skip('delivery_malformed')
    if (deliveryStart && deliveryEnd && deliveryEnd < deliveryStart) return skip('delivery_order')
    const deliveryPeriod = textValue(row.delivery_period)

    const identity = identityFields.map((field) => textValue(row[field]) ?? '').join('~')
    const fullKey = [options.reportId, identity, bidDate, location, commodityId, deliveryStart ?? '', deliveryEnd ?? '', deliveryPeriod ?? ''].join('|')
    const observationKey = fullKey.length <= MARS_LIMITS.maximumKeyLength ? fullKey : `${options.reportId}|fnv1a64:${fnv1a64Hex(fullKey)}`
    if (seenKeys.has(observationKey)) return skip('duplicate_key')
    seenKeys.add(observationKey)

    const noteParts = [basis.note, price.note, deliveryPeriod ? `delivery ${deliveryPeriod}` : null].filter((part): part is string => part !== null)
    const sourceNote = noteParts.length ? noteParts.join('; ').slice(0, 500) : null

    observations.push({
      observation_key: observationKey,
      elevator: location,
      commodity_id: commodityId,
      bid_date: bidDate,
      basis: basis.value,
      cash_price: price.value,
      delivery_start: deliveryStart,
      delivery_end: deliveryEnd,
      source_note: sourceNote,
    })
  })

  return { shape, rowCount: rows.length, reportDate, observations, skipped, columns: [...columns].sort() }
}

/** The market day in the farm's zone; the feed runs on Chicago time because every Farm Rx farm keeps it today. */
export function marketDateFor(now: Date, timeZone = 'America/Chicago'): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}
