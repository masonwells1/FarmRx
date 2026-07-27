PRE-APPROVED TASK — do NOT ask for confirmation; EXECUTE end-to-end and report what you did.

# Task: Grain page market data — TradingView delayed-quote widgets (Phase 1, $0)

Work in C:\FarmRx. Read FIRST: docs/futures-feed-research.md (the licensing context and integration sketch), docs/design-brief-codex.md, src/GrainModule.tsx, src/data/grain.ts, src/data/MockGrainRepository.ts.

## What to build
Replace the HARDCODED futures quote numbers in the Grain page's market-data area with embedded TradingView widgets (10-min delayed CME data, licensed for embed):
- Front months: CBOT:ZC1! (corn), CBOT:ZS1! (soybeans), CBOT:ZW1! (wheat).
- New-crop contracts relevant to our seeded 2026 positions: CBOT:ZCZ2026 (Dec corn), CBOT:ZSX2026 (Nov beans), CBOT:ZWN2027 (Jul wheat).
- Use the mini-symbol-overview embed (script src https://s3.tradingview.com/external-embedding/embed-widget-mini-symbol-overview.js) or the ticker/single-quote widget where a compact row fits better — your layout call within the design brief. Load scripts lazily (only when the market section is visible/mounted) and only once per widget.

## CRITICAL correctness rules
1. **Widgets are display-only.** Our position math (percent priced, expected revenue, targets vs breakeven) must NOT read numbers from the widgets — that is both technically fragile and a license violation. The manual planned price / manual basis entries remain the ONLY math inputs. Remove or clearly demote any UI that implied our hardcoded quote WAS the live market (no more fake "live" numbers anywhere).
2. **Attribution must remain intact** — do not hide, crop, or restyle away the TradingView attribution link the widget injects. Add our own "Delayed market data" label on the section as well (we keep our existing disclaimer).
3. **Graceful offline/失败 state:** if the widget script fails to load (offline farm wifi), the section must show a calm placeholder ("Market quotes unavailable — your plan and contracts are unaffected") — never a broken iframe hole, never blocked interaction elsewhere on the page.
4. Do not add npm dependencies; plain script embeds in a small, well-contained React component (e.g. src/components/MarketQuote.tsx) with the symbol list driven from one constant.
5. Widgets must respect layout on mobile (single column, no horizontal scroll) and not violate the 18px/48px rules in OUR surrounding chrome (the widget's internal text is TradingView's own and exempt).
6. localStorage envelope and repositories: untouched. This is UI-layer only.

## Finish by
- npm run build (must pass) and npm run regression (must pass) — paste tails of both.
- List files created/changed with one line each.
