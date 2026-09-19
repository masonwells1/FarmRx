import { MARS_COMMODITY_MAP, fnv1a64Hex, marketDateFor, marsDate, parseMarsReport } from './marsFeedLogic'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const reportId = '2850'
const row = (overrides: Record<string, unknown> = {}) => ({
  report_date: '07/15/2026',
  published_date: '07/15/2026 16:05:00',
  market_location_name: 'Cedar Rapids',
  commodity: 'Corn',
  class: 'Yellow',
  grade: 'US 2',
  basis: '-0.35',
  price: '4.12',
  delivery_start: '2026-07-15',
  delivery_end: '2026-07-31',
  ...overrides,
})

// 1. The results wrapper and a bare array both parse; anything else is an unrecognized shape with no rows.
const wrapped = parseMarsReport({ results: [row()] }, { reportId })
assert(wrapped.shape === 'results' && wrapped.rowCount === 1 && wrapped.observations.length === 1 && wrapped.skipped.length === 0, 'The results wrapper must parse one row.')
const bare = parseMarsReport([row()], { reportId })
assert(bare.shape === 'array' && bare.observations.length === 1, 'A bare array must parse one row.')
const odd = parseMarsReport({ report: 'nothing here' }, { reportId })
assert(odd.shape === 'unrecognized' && odd.rowCount === 0 && odd.observations.length === 0, 'An unrecognized body yields no rows and says so.')

// 2. The observation the fan-out receives: dates normalized, numbers finite, the whitelist applied, the note carrying nothing extra.
const one = wrapped.observations[0]!
assert(one.bid_date === '2026-07-15' && one.elevator === 'Cedar Rapids' && one.commodity_id === 'corn_yellow' && one.basis === -0.35 && one.cash_price === 4.12 && one.delivery_start === '2026-07-15' && one.delivery_end === '2026-07-31' && one.source_note === null, `The parsed observation is wrong: ${JSON.stringify(one)}`)
assert(wrapped.reportDate === '2026-07-15', 'The report date is the newest bid date seen.')
assert(one.observation_key === '2850|~~~Yellow~US 2~~~~~~~~~|2026-07-15|Cedar Rapids|corn_yellow|2026-07-15|2026-07-31|', `The key is the documented identity: ${one.observation_key}`)
assert(wrapped.columns.join(',') === 'basis,class,commodity,delivery_end,delivery_start,grade,market_location_name,price,published_date,report_date', `Columns seen are reported sorted: ${wrapped.columns.join(',')}`)

// 3. Skip reasons, one per rule. Nothing is guessed.
const reasons = (overrides: Record<string, unknown>) => parseMarsReport([row(overrides)], { reportId }).skipped.map((skip) => skip.reason)
assert(reasons({ report_date: undefined, published_date: undefined }).join() === 'missing_date', 'No date means skip.')
assert(reasons({ report_date: 'July 15', published_date: undefined }).join() === 'missing_date', 'An unrecognized date form means skip, not a parse guess.')
assert(reasons({ market_location_name: '  ' }).join() === 'missing_location', 'A blank location means skip.')
assert(reasons({ commodity: 'Oats' }).join() === 'commodity_not_whitelisted', 'A commodity off the whitelist means skip.')
assert(reasons({ commodity: undefined }).join() === 'missing_commodity', 'No commodity means skip.')
assert(reasons({ basis: undefined }).join() === 'missing_basis', 'No basis means skip.')
assert(reasons({ basis: 'n/a' }).join() === 'basis_malformed', 'A non-numeric basis means skip.')
assert(reasons({ basis: '-35' }).join() === 'basis_implausible', 'A basis outside plausible dollars is skipped rather than reinterpreted as cents.')
assert(reasons({ price: 'bid' }).join() === 'price_malformed', 'A non-numeric price means skip.')
assert(reasons({ price: '412' }).join() === 'price_implausible', 'A price outside plausible dollars means skip.')
assert(reasons({ delivery_end: 'soon' }).join() === 'delivery_malformed', 'A malformed delivery date means skip.')
assert(reasons({ delivery_start: '2026-08-01', delivery_end: '2026-07-31' }).join() === 'delivery_order', 'A delivery window ending before it starts means skip.')
assert(parseMarsReport([row(), row()], { reportId }).skipped.map((skip) => skip.reason).join() === 'duplicate_key', 'Two rows with one identity keep the first and skip the second.')
assert(parseMarsReport([row(), 'not a row', null], { reportId }).rowCount === 1, 'Non-object rows are not rows.')

// 4. Optional fields: a missing price is a basis-only observation; a stated range is kept as its midpoint with the range in the note.
const basisOnly = parseMarsReport([row({ price: undefined })], { reportId }).observations[0]!
assert(basisOnly.cash_price === null && basisOnly.source_note === null, 'A missing price is null, not zero.')
const ranged = parseMarsReport([row({ basis: undefined, basis_min: '-0.40', basis_max: '-0.30', price: undefined, price_min: 4.05, price_max: 4.15, delivery_period: 'Harvest' })], { reportId }).observations[0]!
assert(ranged.basis === -0.35 && ranged.cash_price === 4.1 && ranged.source_note === 'basis range -0.4 to -0.3; price range 4.05 to 4.15; delivery Harvest', `A range is kept as its midpoint with the range recorded: ${JSON.stringify(ranged)}`)
const equalRange = parseMarsReport([row({ basis: undefined, basis_min: '-0.30', basis_max: '-0.30' })], { reportId }).observations[0]!
assert(equalRange.basis === -0.3 && equalRange.source_note === null, 'An equal range is the value itself.')
const soybeans = parseMarsReport([row({ commodity: 'SOYBEANS' })], { reportId }).observations[0]!
assert(soybeans.commodity_id === 'soybeans' && MARS_COMMODITY_MAP['soft red winter wheat'] === 'wheat', 'The whitelist is case-insensitive and names the three Farm Rx commodities.')

// 5. The key is deterministic, order-independent, and bounded.
const first = parseMarsReport([row(), row({ market_location_name: 'Ames' })], { reportId }).observations.map((item) => item.observation_key)
const second = parseMarsReport([row({ market_location_name: 'Ames' }), row()], { reportId }).observations.map((item) => item.observation_key)
assert(first.sort().join() === second.sort().join(), 'The same rows in another order produce the same keys.')
const longLocation = 'x'.repeat(190)
const long = parseMarsReport([row({ market_location_name: longLocation })], { reportId }).observations[0]!
assert(long.observation_key.startsWith('2850|fnv1a64:') && long.observation_key.length <= 200, 'A long identity is hashed under the report id and stays within 200 characters.')
assert(long.observation_key === parseMarsReport([row({ market_location_name: longLocation })], { reportId }).observations[0]!.observation_key, 'The hashed key is deterministic.')
assert(fnv1a64Hex('') === 'cbf29ce484222325' && fnv1a64Hex('a') === 'af63dc4c8601ec8c', 'FNV-1a 64 matches its published test vectors.')

// 6. Dates and the market day.
assert(marsDate('2026-02-29') === null && marsDate('02/28/2026') === '2026-02-28' && marsDate('2026-07-15T16:05:00Z') === '2026-07-15' && marsDate(20260715) === null, 'Date parsing rejects impossible dates and non-strings.')
assert(marketDateFor(new Date('2026-09-01T00:30:00Z')) === '2026-08-31' && marketDateFor(new Date('2026-09-01T00:30:00Z'), 'Asia/Tokyo') === '2026-09-01', 'The market day is the farm zone\'s day.')

console.log('MARS feed logic regressions passed (shapes, whitelist, skips, ranges, keys, dates).')
