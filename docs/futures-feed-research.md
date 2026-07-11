# Free delayed futures feed — research & recommendation

**Date:** 2026-07-11
**For:** Farm Rx Grain marketing page (React + TypeScript, Vite; currently frontend-only on mock data)
**Need:** Delayed (10-min or EOD) quotes for CBOT corn (ZC), soybeans (ZS), wheat (ZW, plus KC wheat KE) — front month + new-crop contracts (Dec corn, Nov beans, Jul wheat) — displayed to a handful of farm customers inside the app with a "delayed" label.
**Budget:** $0 strongly preferred; up to ~$50/mo acceptable. Benchmark to avoid/defer: Barchart OnDemand ~$650/yr.

---

## The uncomfortable truth up front

CME/CBOT futures prices are **licensed data**. Even *delayed* CME data legally requires a distribution license when you show it to third parties (your customers). CME's own policy documents make redistribution a licensed activity — their fee-waiver policy says CME "will waive Licensee Website Fees for one (1) Licensee Website displaying Delayed Information … if Licensee is licensed to distribute such Information to Subscribers" ([CME device-fee-waiver policy PDF](https://www.cmegroup.com/market-data/distributor/files/device-fee-waiver-policy.pdf), [CME licensing hub](https://www.cmegroup.com/market-data/license-data.html)). In other words: the *fee* for delayed web display can be $0, but you still need to be (or ride on) a licensed distributor.

Practical consequence: **there is no truly-free raw-quote API that is also clean for redistribution.** Every $0 programmatic source below is ToS-risky for display-to-customers. The compliant free path is an **embedded widget from a vendor that already holds the CME license** (TradingView), and the compliant cheap API path is a licensed vendor (Barchart OnDemand ~$49/mo EOD). That shapes the recommendation.

---

## Candidate-by-candidate findings

### 1. TradingView free widgets — $0, compliant, but widgets not raw JSON
- **Cost:** Free (attribution required). ([Widget catalog](https://www.tradingview.com/widget/), [docs](https://www.tradingview.com/widget-docs/))
- **Delay:** All CME Group data is free on TradingView in **10-minute-delayed** mode ([TradingView CME page](https://www.tradingview.com/cme/)).
- **Symbols:** Full CBOT curve — front-month continuous (`CBOT:ZC1!`, `ZS1!`, `ZW1!`, `CBOT_MINI` too, KC wheat `CBOT:KE1!`) **and specific contracts** (`CBOT:ZCZ2026` Dec-26 corn, `CBOT:ZSX2026` Nov-26 beans, `CBOT:ZWN2027` Jul-27 wheat). Ticker-tape, single-quote, mini-chart, and watchlist widgets all work.
- **Auth / CORS:** None — it's a `<script>` embed (or their React component). No server needed at all. Works in a frontend-only app today.
- **Redistribution terms:** This is the key win — TradingView holds the exchange licenses and the widgets are made for embedding on third-party commercial sites. Their rules require attribution stay intact: use "outside the TradingView website without proper attribution is not allowed," and removing branding/links can get you banned ([TradingView copyright & fair-use rules](https://www.tradingview.com/support/solutions/43000591349-copyright-and-fair-use-rules/)). Their terms also forbid sublicensing/reselling the data itself ([policies](https://www.tradingview.com/policies/)) — displaying the widget to logged-in customers is fine; extracting the numbers out of the widget into your own UI is not.
- **Historical settles:** Mini-chart widget shows history visually, but you can't pull the numbers out programmatically.
- **Limitation:** You style the container, not the numbers. You cannot compute with the prices (no "your 5,000 bu × Dec price" math off widget data).

### 2. Barchart OnDemand — the licensed API benchmark; entry EOD tier ≈ $49/mo
- **Cost:** The known benchmark ~$650/yr (~$54/mo) for delayed getQuote. Barchart's own blog advertises "a special rate starting at **$49 per month** for end-of-day data through the getQuote and/or getHistory APIs" ([Barchart blog: Top Market Data APIs](https://www.barchart.com/solutions/blog/top-market-data-apis-from-barchart)). So EOD ≈ $588/yr — essentially the same money as the benchmark. The old **free** Barchart API (getQuote, 400 req/day) was **discontinued Dec 31, 2020** over data-licensing costs ([legacy free-API page](https://www.barchart.com/ondemand/free-market-data-api), [old client repo](https://github.com/yagop/barchart-market-data-api)). There is no free tier today; pricing/terms are quote-based via sales ([OnDemand API hub](https://www.barchart.com/ondemand/api)).
- **Delay:** Real-time, delayed (10-min), or end-of-day depending on plan ([getQuote docs](https://www.barchart.com/ondemand/api/getQuote)).
- **Symbols:** Everything — `ZCZ26`, `ZSX26`, `ZWN27`, `KEN26`, plus handy notations like `ZC*0` (active contract) and `ZC^F` (all contracts for a root) ([getQuote docs](https://www.barchart.com/ondemand/api/getQuote)).
- **Historical settles:** Yes — `getHistory` daily bars, ideal for basis-history charts ([getQuoteEod](https://www.barchart.com/ondemand/api/getQuoteEod)).
- **Auth / CORS:** API key. Intended to be called server-side; key must not ship in the browser → proxy needed.
- **Redistribution:** This is Barchart's whole business — OnDemand is sold specifically for powering customer-facing websites/apps ("market data APIs that can be easily integrated into your website" — [OnDemand](https://www.barchart.com/ondemand/api)); Barchart is a licensed CME distributor and hundreds of grain-elevator/co-op websites run on it. Exact display rights are set in the signed agreement — confirm "display to end users" scope with sales.

### 3. Yahoo Finance unofficial endpoints — $0, works, **clearly ToS-risky**
- **What it is:** The endpoints behind finance.yahoo.com (`query1.finance.yahoo.com/v8/finance/chart/ZC=F`, `ZCZ26.CBT`, etc.), used by libraries like yfinance. Yahoo killed the official API in 2017; yfinance's own docs note it uses unofficial endpoints that "may violate Yahoo's terms of service" ([yfinance docs](https://ranaroussi.github.io/yfinance/), [Scrapfly guide](https://scrapfly.io/blog/posts/guide-to-yahoo-finance-api)).
- **Delay:** CME data on Yahoo is 10-min delayed. Front month and individual contracts (`ZCZ26.CBT`) are available, with daily history.
- **The ToS problem, explicitly:** Yahoo's API terms prohibit you to "sell, lease, share, transfer, or sublicense the Yahoo APIs … or **derive income from the use or provision** of the Yahoo APIs" without written permission ([Yahoo Developer API ToS](https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apiforydn/index.html)) — and the finance endpoints aren't even part of that offered API. Showing Yahoo-scraped CME quotes to paying farm customers is (a) a Yahoo ToS violation and (b) unlicensed CME redistribution. Yahoo has historically cut off exactly this usage ("this service is being used in violation of the Yahoo Terms of Service" — 2017 shutdown notice, [HN thread](https://news.ycombinator.com/item?id=15616880)). Endpoints also break/rate-limit without notice.
- **Verdict:** Fine for personal tinkering; **not acceptable for a customer-facing product** from a real company.

### 4. CME Group directly — delayed quotes exist, but no free public API
- CME publishes 10-min-delayed quotes on cmegroup.com ([delayed quotes](https://www.cmegroup.com/market-data/browse-data/delayed-quotes.html), [corn quotes](https://www.cmegroup.com/markets/agriculture/grains/corn/quotes)). The JSON endpoints feeding those pages are **not a public API**; scraping them violates the site ToS and is bot-protected.
- The official route is signing CME's Information License Agreement and becoming a delayed-data distributor ([ILA guide](https://www.cmegroup.com/market-data/files/information-license-agreement-ila-guide.pdf)); the website display fee for delayed data can be waived for one site (see intro), but the paperwork/reporting burden is designed for vendors, not a two-person app. **Defer** — this is the path a vendor like Barchart or TradingView has already walked for you.

### 5. Databento — great cheap *historical* settles, wrong license for display
- **Cost:** Usage-based historical (grain daily OHLCV costs pennies; **$125 free credit** for new accounts); live CME from ~$33–$179/mo ([pricing](https://databento.com/pricing), [CME plans blog](https://databento.com/blog/introducing-new-cme-pricing-plans), [announcement](https://roadmap.databento.com/announcements/live-cme-data-is-now-open-to-all-users-starting-at-3265month)).
- **Redistribution:** Databento is explicit that their standard self-serve terms cover you only as a non-redistributing subscriber; "if … you're redistributing data, Databento will introduce you to the exchange … so you can obtain the formal license or ILA" ([Databento: subscriber status](https://databento.com/blog/subscriber-status), [licensing intro](https://databento.com/blog/introduction-market-data-licensing)). External-distribution rights start at their **Plus plan (~$1,399/mo)**.
- **Verdict:** Best-in-class if we ever need serious historical settle data for internal analytics; **not usable** to show quotes to customers at our budget.

### 6. Polygon.io (rebranded **Massive.com**) — has CME futures, but individual plans forbid our use case
- **Cost/tiers (futures product):** Basic $0 (EOD), Starter $29/mo (15-min delayed), Developer $79, Advanced $199 (real-time), Business ~$2,000/mo with commercial license ([futures product](https://massive.com/futures), [pricing](https://polygon.io/pricing), [edgeful comparison](https://www.edgeful.com/blog/posts/futures-data-api-polygon-databento-edgeful-comparison)).
- **Redistribution:** The affordable tiers are governed by the *Individuals* ToS — "your **personal, individual, and non-business use**" ([Massive for Individuals ToS](https://polygon.io/individuals-terms-of-service)); their market-data terms make data "strictly for display use" by the subscriber and put commercial/redistribution use under Business terms ([market data terms PDF](https://massive.com/terms/market_data_terms.pdf)). Displaying to Farm Rx customers = business use + redistribution → the $2k/mo Business tier.
- **Verdict:** Discard for this (tempting $29 tier is not licensed for what we'd do with it).

### 7. USDA AMS **My Market News (MARS) API** — $0, public domain, the compliant *basis/cash* layer
- **Cost:** Free; USDA Market News is provided "free-of-charge to everyone" ([USDA Market News](https://www.ams.usda.gov/market-news)). US-government work = public domain → **no redistribution restriction at all**. API key via free registration ([MyMarketNews API](https://mymarketnews.ams.usda.gov/mymarketnews-api), endpoint `https://marsapi.ams.usda.gov/services/v1.2/reports`).
- **What it has:** Daily state/terminal **grain bid reports** (e.g., [Iowa Daily Cash Grain Bids #2850](https://mymarketnews.ams.usda.gov/viewReport/2850), Kentucky #2892, S. Dakota #3186, etc.) with cash bids and **basis "calculated from the current day or prior day close of a publicly traded futures price"** (CBOT/KCBT/MGEX) — i.e., futures month references + basis + cash, daily. Historical queries supported (registered users pull up to 100k rows) ([API FAQs](https://mymarketnews.ams.usda.gov/mymarketnews-api/faqs)).
- **What it lacks:** It is **not an intraday futures quote feed** — EOD cadence, and the headline number is the cash bid/basis, not a clean board quote.
- **Historical settles/basis:** Yes — this is the best free source for **basis history charts**, which is exactly the Grain page's long-term differentiator.
- **CORS/auth:** API key via HTTP basic auth; assume no permissive CORS → call it from a server/edge function, never the browser.

### 8. Alpha Vantage — **no futures; discard**
Its `CORN`/`WHEAT` endpoints are monthly/quarterly **global commodity price indices** (FRED/World Bank series), not CBOT contract quotes ([docs](https://www.alphavantage.co/documentation/)). Useless for a Dec-26 corn quote.

### 9. Tradier — brokerage API, personal-use data; discard
Futures trading/data exists for **account holders** ([Tradier futures](https://tradier.com/individuals/futures), [developer](https://developer.tradier.com/)); market data is licensed for the account holder's personal use, not for re-display to your app's customers. Discard.

### 10. marketdata.app — futures "**coming soon**"; discard for now
Their coverage page lists futures as planned, not live ([data coverage](https://www.marketdata.app/data/)). Re-check in a year.

### 11. Financial Modeling Prep — has commodities quotes, but display requires a separate license
FMP exposes commodities symbols (e.g., `ZCUSD`) with quote + historical endpoints ([commodities quote API](https://site.financialmodelingprep.com/developer/docs/stable/commodities-quote)). But its ToS forbids you to "distribute, publicly perform or display … transmit, transfer, publish" the data, and personal licenses may not "integrate the Data or Services into any third-party accessible tools or applications"; public display requires a negotiated Data Display & Licensing Agreement ([FMP ToS](https://site.financialmodelingprep.com/terms-of-service), [acceptable-use policy](https://site.financialmodelingprep.com/acceptable-data-use-policy)). Also unclear that their CME sourcing would cover *your* redistribution. Discard.

### 12. InsightSentry — cheap futures via RapidAPI, but licensing provenance unclear; risky
Markets itself as real-time multi-asset incl. futures ([site](https://insightsentry.com/), [RapidAPI listing](https://rapidapi.com/insightsentry-insightsentry-default/api/insightsentry)). It is not a CME-listed licensed distributor the way Databento/Barchart are; "real-time CME for a few dollars" is a red flag that exchange licensing isn't being passed through, which would leave Farm Rx holding the compliance risk. Discard for customer display.

### 13. Stockdio — free widget tier with redistribution right, but weak grain coverage
Terms grant a right to "integrate and redistribute stock market widgets" ([Stockdio ToS](https://www.stockdio.com/terms-of-service.html)); free app-key plan exists ([docs](https://services.stockdio.com/howtouse)). Commodities coverage is index/spot-oriented; specific CBOT contract quotes (Dec-26 corn) are not clearly offered. Keep as a distant fallback; TradingView widgets are strictly better here.

---

## Comparison at a glance

| Source | Cost | Delay | ZC/ZS/ZW + specific contracts | Raw API? | OK to display to customers? | Daily settles history? |
|---|---|---|---|---|---|---|
| **TradingView widgets** | $0 | 10-min | Yes, full curve incl. `ZCZ2026` | No (embed) | **Yes** (attribution intact) | Visual only |
| **USDA AMS MARS API** | $0 | EOD | Basis vs CBOT month (not board quote) | Yes (JSON) | **Yes** (public domain) | **Yes (basis/cash)** |
| Barchart OnDemand | ~$49/mo EOD; ~$650/yr delayed | 10-min or EOD | Yes, full curve + `ZC*0` notation | Yes | **Yes (licensed for it)** | Yes (`getHistory`) |
| Yahoo unofficial | $0 | 10-min | Yes (`ZCZ26.CBT`) | Yes (unofficial) | **No — ToS violation** | Yes (unofficial) |
| CME direct (ILA) | $0 fees but license paperwork | 10-min | Yes | Feed, not simple API | Only after signing ILA | Yes |
| Databento | pennies (hist) / $179 live | real-time | Yes | Yes | No (needs Plus $1,399/mo or ILA) | Yes, very cheap — internal only |
| Polygon/Massive | $0–$29 usable tiers | EOD/15-min | Yes | Yes | **No — individual/non-business only** | Yes — internal only |
| Alpha Vantage | $0 | monthly index | **No futures** | — | — | — |
| Tradier / marketdata.app / FMP / InsightSentry / Stockdio | — | — | weak or unlicensed | — | No / risky | — |

---

## RECOMMENDATION

**Every truly-free programmatic quote source is ToS-risky for redistribution. The plan below stays at $0 while remaining compliant, and defers paid data until customers ask for something the free layer can't do.**

### Build on now (Phase 1, $0): TradingView widgets + USDA AMS API
1. **Quotes on the Grain page → TradingView free widgets** (10-min delayed CME data, licensed by TradingView, attribution kept). Use the *Market Overview* or *Ticker/Single-Quote* widgets with symbols:
   - Front months: `CBOT:ZC1!`, `CBOT:ZS1!`, `CBOT:ZW1!`, `CBOT:KE1!`
   - New crop: `CBOT:ZCZ2026` (Dec-26 corn), `CBOT:ZSX2026` (Nov-26 beans), `CBOT:ZWN2027` (Jul-27 wheat)
   - This works in the current **frontend-only** app — no server, no keys, nothing to secure. The widget itself displays the "delayed" state; keep our own "Delayed data" label too.
2. **Basis / local cash layer → USDA AMS My Market News API** (free key, public domain — the one source we can store, chart, and compute against with zero restrictions). This also answers the historical-settles need for **basis history charts**. Because it needs an API key and (assume) no CORS, wire it through a **Supabase edge function** when we leave mock data — this is the design choice the frontend-only status forces: *values we compute with must come through our own tiny proxy; values we merely display can stay widget-side.* A daily cron (edge function on a schedule) fetching the relevant grain-bid reports into a Supabase table is plenty — data is EOD anyway.

### Fallback / upgrade (Phase 2, ~$49–55/mo): Barchart OnDemand
When farmers want **our own UI doing math on live-ish board prices** (e.g., "your unsold 20,000 bu at today's Dec price"), widgets stop being enough. At that point the cheapest *compliant* raw API is Barchart OnDemand — the EOD special (~$49/mo, `getQuote` + `getHistory`) or the ~$650/yr delayed tier we already benchmarked. That money buys the CME redistribution license we cannot practically get ourselves. Get written confirmation from Barchart sales that the plan covers "display to end users of our web app." Call it from a Supabase edge function with a ~10-min cache so a handful of users costs almost nothing in request volume.

### Integration sketch

**Phase 1 widget (Dec 2026 corn, drop-in React):**
```html
<!-- container -->
<div class="tradingview-widget-container">
  <div class="tradingview-widget-container__widget"></div>
  <script type="text/javascript"
    src="https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js" async>
  {
    "symbol": "CBOT:ZCZ2026",
    "width": "100%", "height": 220,
    "locale": "en", "dateRange": "3M",
    "colorTheme": "light", "isTransparent": true
  }
  </script>
  <!-- TradingView attribution link is injected by the widget — do not remove -->
</div>
```

**Phase 1 basis data (USDA MARS via future edge function):**
```
GET https://marsapi.ams.usda.gov/services/v1.2/reports/2850   (Iowa Daily Cash Grain Bids)
Authorization: Basic <API_KEY:>       ← key stays in the edge function, never the browser
→ JSON rows: { report_date, commodity: "Corn", bid, basis, futures month (CBOT reference), location... }
```

**Phase 2 (Barchart, Dec 2026 corn):**
```
GET https://ondemand.websol.barchart.com/getQuote.json?apikey=<KEY>&symbols=ZCZ26
→ { "results": [ { "symbol": "ZCZ26", "name": "Corn Dec 2026", "lastPrice": 4.5625,
     "netChange": 0.0325, "tradeTimestamp": "...", "open": ..., "high": ..., "low": ... } ] }
```
Daily settles for charts: `getHistory.json?apikey=<KEY>&symbol=ZCZ26&type=dailyNearest`.

### What NOT to do
- Do **not** ship Yahoo-scraped or cmegroup.com-scraped quotes to customers — both violate terms, and the CME side is unlicensed redistribution of exchange data by a real company with real customers.
- Do **not** buy Polygon/Massive Starter ($29) or an InsightSentry RapidAPI plan thinking it solves this — the cheap tiers explicitly (Polygon) or effectively (InsightSentry) don't license display to your end users.

---

## Sources
- TradingView: https://www.tradingview.com/widget/ · https://www.tradingview.com/cme/ · https://www.tradingview.com/support/solutions/43000591349-copyright-and-fair-use-rules/ · https://www.tradingview.com/policies/
- USDA AMS: https://mymarketnews.ams.usda.gov/mymarketnews-api · https://mymarketnews.ams.usda.gov/mymarketnews-api/faqs · https://www.ams.usda.gov/market-news · https://mymarketnews.ams.usda.gov/viewReport/2850
- Barchart: https://www.barchart.com/ondemand/api · https://www.barchart.com/ondemand/api/getQuote · https://www.barchart.com/solutions/blog/top-market-data-apis-from-barchart · https://www.barchart.com/ondemand/free-market-data-api
- CME: https://www.cmegroup.com/market-data/license-data.html · https://www.cmegroup.com/market-data/distributor/files/device-fee-waiver-policy.pdf · https://www.cmegroup.com/market-data/files/information-license-agreement-ila-guide.pdf · https://www.cmegroup.com/market-data/browse-data/delayed-quotes.html
- Yahoo: https://legal.yahoo.com/us/en/yahoo/terms/product-atos/apiforydn/index.html · https://ranaroussi.github.io/yfinance/ · https://scrapfly.io/blog/posts/guide-to-yahoo-finance-api
- Databento: https://databento.com/pricing · https://databento.com/blog/subscriber-status · https://databento.com/blog/introduction-market-data-licensing · https://databento.com/blog/introducing-new-cme-pricing-plans
- Polygon/Massive: https://massive.com/futures · https://polygon.io/individuals-terms-of-service · https://massive.com/terms/market_data_terms.pdf · https://www.edgeful.com/blog/posts/futures-data-api-polygon-databento-edgeful-comparison
- FMP: https://site.financialmodelingprep.com/terms-of-service · https://site.financialmodelingprep.com/developer/docs/stable/commodities-quote
- Others: https://www.alphavantage.co/documentation/ · https://tradier.com/individuals/futures · https://www.marketdata.app/data/ · https://insightsentry.com/ · https://www.stockdio.com/terms-of-service.html
