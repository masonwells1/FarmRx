import { useState } from 'react'

export interface MarketQuoteSpec { symbol: string; label: string; detail: string }

const FRONT_MONTH: readonly MarketQuoteSpec[] = [
  { symbol: 'CBOT:ZC1!', label: 'Corn', detail: 'Front month' },
  { symbol: 'CBOT:ZS1!', label: 'Soybeans', detail: 'Front month' },
  { symbol: 'CBOT:ZW1!', label: 'Wheat', detail: 'Front month' },
]

/**
 * The new-crop futures contract for a crop year: December corn and November
 * soybeans of that year, and July wheat of the following year (wheat planted in
 * the crop year's fall is harvested the next summer). Derived, never hardcoded,
 * so the widget follows the farmer's selected crop year.
 */
export function newCropQuotes(cropYear: number): MarketQuoteSpec[] {
  if (!Number.isInteger(cropYear) || cropYear < 2000 || cropYear > 2100) return []
  return [
    { symbol: `CBOT:ZCZ${cropYear}`, label: 'Corn', detail: `Dec ${cropYear}` },
    { symbol: `CBOT:ZSX${cropYear}`, label: 'Soybeans', detail: `Nov ${cropYear}` },
    { symbol: `CBOT:ZWN${cropYear + 1}`, label: 'Wheat', detail: `Jul ${cropYear + 1}` },
  ]
}

export function marketQuotes(cropYear: number): MarketQuoteSpec[] { return [...FRONT_MONTH, ...newCropQuotes(cropYear)] }

/**
 * The crop year the new-crop tiles follow: the newest crop year the farm has an
 * estimate for, but never earlier than the current calendar year. The front-month
 * tiles already cover old-crop grain, so the contract tiles always point at the
 * crop being planned or grown rather than the oldest estimate on file.
 */
export function quoteCropYear(estimateCropYears: readonly number[], today = new Date()): number {
  const current = today.getFullYear()
  const newest = estimateCropYears.filter((year) => Number.isInteger(year)).reduce((max, year) => Math.max(max, year), current)
  return newest
}

function MarketQuote({ symbol, label, detail }: MarketQuoteSpec) {
  const [failed, setFailed] = useState(false)
  return <article className={`market-quote${failed ? ' market-quote--unavailable' : ''}`}>
    <div className="market-quote__heading"><strong>{label}</strong><span>{detail}</span></div>
    <iframe
      className="market-quote__widget"
      title={`${label} ${detail} delayed market quote`}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      loading="lazy"
      src={`/market-quote-frame.html?symbol=${encodeURIComponent(symbol)}`}
      onLoad={() => setFailed(false)}
      onError={() => setFailed(true)}
    />
    {failed && <p className="market-quote__fallback" role="status">Market quotes unavailable — your plan and contracts are unaffected.</p>}
  </article>
}

export function MarketQuoteSection({ cropYear }: { cropYear: number }) {
  return <section className="grain-section market-data-section" aria-labelledby="market-data-heading">
    <div className="section-heading">
      <div><span className="eyebrow">Market data</span><h2 id="market-data-heading">Delayed market quotes</h2><p>10-minute delayed CME data, displayed by TradingView.</p></div>
      <span className="delayed-label">Delayed market data</span>
    </div>
    <p className="market-data-note">Quotes are for display only. Your plan and revenue estimates use the manual prices and basis you enter.</p>
    <div className="market-quote-grid">{marketQuotes(cropYear).map((quote) => <MarketQuote key={quote.symbol} {...quote} />)}</div>
  </section>
}
