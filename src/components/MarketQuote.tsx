import { useState } from 'react'

export const MARKET_QUOTES = [
  { symbol: 'CBOT:ZC1!', label: 'Corn', detail: 'Front month' },
  { symbol: 'CBOT:ZS1!', label: 'Soybeans', detail: 'Front month' },
  { symbol: 'CBOT:ZW1!', label: 'Wheat', detail: 'Front month' },
  { symbol: 'CBOT:ZCZ2026', label: 'Corn', detail: 'Dec 2026' },
  { symbol: 'CBOT:ZSX2026', label: 'Soybeans', detail: 'Nov 2026' },
  { symbol: 'CBOT:ZWN2027', label: 'Wheat', detail: 'Jul 2027' },
] as const

function MarketQuote({ symbol, label, detail }: (typeof MARKET_QUOTES)[number]) {
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

export function MarketQuoteSection() {
  return <section className="grain-section market-data-section" aria-labelledby="market-data-heading">
    <div className="section-heading">
      <div><span className="eyebrow">Market data</span><h2 id="market-data-heading">Delayed market quotes</h2><p>10-minute delayed CME data, displayed by TradingView.</p></div>
      <span className="delayed-label">Delayed market data</span>
    </div>
    <p className="market-data-note">Quotes are for display only. Your plan and revenue estimates use the manual prices and basis you enter.</p>
    <div className="market-quote-grid">{MARKET_QUOTES.map((quote) => <MarketQuote key={quote.symbol} {...quote} />)}</div>
  </section>
}
