import { useEffect, useRef, useState } from 'react'

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
 * so the widget follows the farmer's selected crop year. The quote frame's
 * allowlist accepts contract years 2000–2099, and wheat is the crop year plus
 * one, so 2098 is the last crop year every derived symbol is valid for.
 */
export function newCropQuotes(cropYear: number): MarketQuoteSpec[] {
  if (!Number.isInteger(cropYear) || cropYear < 2000 || cropYear > 2098) return []
  return [
    { symbol: `CBOT:ZCZ${cropYear}`, label: 'Corn', detail: `Dec ${cropYear}` },
    { symbol: `CBOT:ZSX${cropYear}`, label: 'Soybeans', detail: `Nov ${cropYear}` },
    { symbol: `CBOT:ZWN${cropYear + 1}`, label: 'Wheat', detail: `Jul ${cropYear + 1}` },
  ]
}

const quoteFamily: Record<string, string> = { Corn: 'corn', Soybeans: 'soybeans', Wheat: 'wheat' }

/** The tiles for the crops this farm grows (by crop family); every tile when the farm's crops are not known yet. */
export function marketQuotes(cropYear: number, families?: readonly string[]): MarketQuoteSpec[] {
  const all = [...FRONT_MONTH, ...newCropQuotes(cropYear)]
  return families && families.length ? all.filter((quote) => families.includes(quoteFamily[quote.label])) : all
}

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
  const frame = useRef<HTMLIFrameElement>(null)
  // The frame page can load while the quote inside it does not; the frame says so, since onError never fires for that.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => { if (event.source === frame.current?.contentWindow && event.data?.type === 'farm-rx-quote' && event.data.status === 'failed') setFailed(true) }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  return <article className={`market-quote${failed ? ' market-quote--unavailable' : ''}`}>
    <div className="market-quote__heading"><strong>{label}</strong><span>{detail}</span></div>
    <iframe
      ref={frame}
      className="market-quote__widget"
      title={`${label} ${detail} delayed market quote`}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      loading="lazy"
      src={`/market-quote-frame.html?symbol=${encodeURIComponent(symbol)}`}
      onError={() => setFailed(true)}
    />
    {failed && <p className="market-quote__fallback" role="status">Futures prices are not available right now.</p>}
  </article>
}

export function MarketQuoteSection({ cropYear, families }: { cropYear: number; families?: readonly string[] }) {
  return <section className="grain-section market-data-section" aria-labelledby="market-data-heading">
    <div className="section-heading">
      <div><h2 id="market-data-heading">Futures prices</h2><p>CME quotes from TradingView, 10 minutes delayed. For display only: your numbers use the prices you enter.</p></div>
    </div>
    <div className="market-quote-grid">{marketQuotes(cropYear, families).map((quote) => <MarketQuote key={quote.symbol} {...quote} />)}</div>
  </section>
}
