import { readFileSync } from 'node:fs'
import { Window } from 'happy-dom'
import React, { act, createElement } from 'react'
import { MarketQuoteSection, marketQuotes, newCropQuotes, quoteCropYear } from './MarketQuote'

function assert(value: unknown, message: string): asserts value { if (!value) throw new Error(message) }

const quotes2026 = newCropQuotes(2026)
assert(JSON.stringify(quotes2026.map((quote) => quote.symbol)) === JSON.stringify(['CBOT:ZCZ2026', 'CBOT:ZSX2026', 'CBOT:ZWN2027']), 'Crop year 2026 must map to Dec 2026 corn, Nov 2026 soybeans, and Jul 2027 wheat.')
assert(quotes2026.map((quote) => quote.detail).join('|') === 'Dec 2026|Nov 2026|Jul 2027', 'Contract labels must name the month and year.')
assert(newCropQuotes(2027)[2]?.symbol === 'CBOT:ZWN2028', 'Wheat must roll to the year after the crop year.')
assert(newCropQuotes(Number.NaN).length === 0 && newCropQuotes(1990).length === 0, 'An invalid crop year must produce no contract quotes rather than a bad symbol.')
assert(newCropQuotes(2098).length === 3 && newCropQuotes(2099).length === 0 && newCropQuotes(2100).length === 0, 'Crop years whose wheat contract falls outside the frame allowlist must produce no contract quotes.')
assert(marketQuotes(2026).length === 6 && marketQuotes(2026)[0]?.symbol === 'CBOT:ZC1!', 'Front-month quotes stay first, followed by the crop-year contracts.')
// A46: a corn-and-bean farm sees no wheat tiles; with the farm's crops unknown every tile shows.
assert(marketQuotes(2026, ['corn', 'soybeans']).length === 4 && !marketQuotes(2026, ['corn', 'soybeans']).some((quote) => quote.symbol.startsWith('CBOT:ZW')), 'A farm without wheat must not get wheat tiles.')
assert(marketQuotes(2026, []).length === 6 && marketQuotes(2026, ['wheat']).every((quote) => quote.label === 'Wheat'), 'An empty crop list shows every tile; a wheat-only farm sees wheat tiles only.')

const sept2026 = new Date(2026, 8, 8)
assert(quoteCropYear([2026, 2027], sept2026) === 2027, 'With estimates for two years the tiles must follow the newest, not the oldest estimate on file.')
assert(quoteCropYear([2025, 2026], sept2026) === 2026, 'The newest estimate year is used when it is the current year.')
assert(quoteCropYear([2025], sept2026) === 2026, 'Tiles never point earlier than the current calendar year.')
assert(quoteCropYear([], sept2026) === 2026, 'With no estimates the current calendar year is used.')
assert(quoteCropYear([2026], new Date(2027, 0, 15)) === 2027, 'In January the tiles already follow the new crop year even before an estimate exists for it.')

// The quote frame is plain HTML and cannot import this module, so its symbol
// allowlist is a regex literal. Extract it and prove every derived symbol passes.
const frame = readFileSync(new URL('../../public/market-quote-frame.html', import.meta.url), 'utf8')
const match = frame.match(/const allowed=(\/.+?\/);/)
assert(match?.[1], 'The quote frame must declare its symbol allowlist as a regex literal.')
const allowed = new RegExp(match[1].slice(1, -1))
for (const year of [2025, 2026, 2027, 2035, 2098]) for (const quote of marketQuotes(year)) assert(allowed.test(quote.symbol), `Frame allowlist rejects derived symbol ${quote.symbol}.`)
// A46: the frame tells the page when the quote inside it fails, since the iframe's own error event never fires for that.
assert(frame.includes("parent.postMessage({type:'farm-rx-quote',status},'*')") && frame.includes("const fail=()=>post('failed')") && frame.includes('loader.onerror=fail') && frame.includes('if(waited===8)fail()'), 'The quote frame must report a failed or missing widget to the page.')
// A quote that appears after the 8-second failure (a slow rural connection) must still be shown: the frame keeps looking and says ready.
assert(frame.includes("post('ready')") && frame.includes('if(waited<30)setTimeout(check,1000)'), 'The quote frame must report a late widget as ready.')
const widget = readFileSync(new URL('./MarketQuote.tsx', import.meta.url), 'utf8')
assert(widget.includes("event.source !== frame.current?.contentWindow || event.data?.type !== 'farm-rx-quote'") && !widget.includes('onLoad={() => setFailed(false)}'), 'The tile must accept a failure only from its own frame, and a later load event must not hide it.')
assert(widget.includes("else if (event.data.status === 'ready') setFailed(false)"), 'A late quote that says ready must replace the not-available note.')
for (const bad of ['CBOT:ZCZ26', 'NASDAQ:AAPL', 'CBOT:ZCZ2026;alert(1)', 'CBOT:ZCF2026', '']) assert(!allowed.test(bad), `Frame allowlist must reject ${JSON.stringify(bad)}.`)
// The message handling itself, rendered: a failure from another frame is ignored, the tile's own frame shows the fallback, and a
// late 'ready' takes it away. Known gap: the frame says ready as soon as TradingView's inner iframe exists, even if it stays blank.
{
  const win = new Window({ url: 'http://farmrx.test/grain', settings: { disableIframePageLoading: true } as never })
  Object.assign(globalThis, { React, window: win, document: win.document, HTMLElement: win.HTMLElement, Node: win.Node, Event: win.Event, IS_REACT_ACT_ENVIRONMENT: true })
  const { createRoot } = await import('react-dom/client')
  const container = win.document.createElement('div'); win.document.body.appendChild(container)
  const root = createRoot(container as never)
  await act(async () => { root.render(createElement(MarketQuoteSection, { cropYear: 2026, families: ['corn'] })) })
  const tile = container.querySelector('iframe') as unknown as HTMLIFrameElement
  assert(tile, 'The quote tile must render its frame.')
  // happy-dom loads no frame page, so the tile's frame is given a window of its own to post from.
  const own = new Window(); const foreign = new Window()
  Object.defineProperty(tile, 'contentWindow', { configurable: true, get: () => own })
  const post = async (source: Window, status: string) => { await act(async () => { win.dispatchEvent(new win.MessageEvent('message', { data: { type: 'farm-rx-quote', status }, source: source as never })) }) }
  const fallback = () => container.textContent?.includes('Futures prices are not available right now.') ?? false
  await post(foreign, 'failed')
  assert(!fallback(), 'A failure posted by another frame must not mark this tile unavailable.')
  await post(own, 'failed')
  assert(fallback(), "The tile's own frame saying failed must show the not-available note.")
  await post(own, 'ready')
  assert(!fallback(), "A late ready from the tile's own frame must take the not-available note away.")
  await act(async () => root.unmount())
  await win.happyDOM.close()
}
console.log('MarketQuote regression passed.')
