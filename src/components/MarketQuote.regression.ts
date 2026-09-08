import { readFileSync } from 'node:fs'
import { marketQuotes, newCropQuotes } from './MarketQuote'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

const quotes2026 = newCropQuotes(2026)
assert(JSON.stringify(quotes2026.map((quote) => quote.symbol)) === JSON.stringify(['CBOT:ZCZ2026', 'CBOT:ZSX2026', 'CBOT:ZWN2027']), 'Crop year 2026 must map to Dec 2026 corn, Nov 2026 soybeans, and Jul 2027 wheat.')
assert(quotes2026.map((quote) => quote.detail).join('|') === 'Dec 2026|Nov 2026|Jul 2027', 'Contract labels must name the month and year.')
assert(newCropQuotes(2027)[2]?.symbol === 'CBOT:ZWN2028', 'Wheat must roll to the year after the crop year.')
assert(newCropQuotes(Number.NaN).length === 0 && newCropQuotes(1990).length === 0, 'An invalid crop year must produce no contract quotes rather than a bad symbol.')
assert(marketQuotes(2026).length === 6 && marketQuotes(2026)[0]?.symbol === 'CBOT:ZC1!', 'Front-month quotes stay first, followed by the crop-year contracts.')

// The quote frame is plain HTML and cannot import this module, so its symbol
// allowlist is a regex literal. Extract it and prove every derived symbol passes.
const frame = readFileSync(new URL('../../public/market-quote-frame.html', import.meta.url), 'utf8')
const match = frame.match(/const allowed=(\/.+?\/);/)
assert(match?.[1], 'The quote frame must declare its symbol allowlist as a regex literal.')
const allowed = new RegExp(match[1].slice(1, -1))
for (const year of [2025, 2026, 2027, 2035]) for (const quote of marketQuotes(year)) assert(allowed.test(quote.symbol), `Frame allowlist rejects derived symbol ${quote.symbol}.`)
for (const bad of ['CBOT:ZCZ26', 'NASDAQ:AAPL', 'CBOT:ZCZ2026;alert(1)', 'CBOT:ZCF2026', '']) assert(!allowed.test(bad), `Frame allowlist must reject ${JSON.stringify(bad)}.`)
console.log('MarketQuote regression passed.')
