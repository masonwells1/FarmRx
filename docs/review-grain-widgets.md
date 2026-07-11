## Findings

1. **P1 — Loaded loader script can still leave a permanent blank widget.** `src/components/MarketQuote.tsx:51` marks success and cancels the fallback as soon as the embedding script loads. If that script executes but its iframe is blocked, offline, or fails during initialization, no error or timeout remains and users see a blank 220px hole. Keep the watchdog active until the injected iframe successfully loads; observe iframe insertion, handle `load`/`error`, and clean up listeners/observer on unmount.

2. **P1 — Mobile layout introduces horizontal page scrolling.** `src/styles/app.css:230-236` allows the widget’s intrinsic width to expand the market section. At the mobile breakpoint, a 375px viewport produced a 432px document and 382px cards. Add `min-width: 0; max-width: 100%` to the section/grid/widget chain and constrain the injected iframe to `width/max-width: 100%`; verify again at 375px without clipping attribution.

3. **P2 — Farm Rx widget detail text violates the 18px rule.** `src/styles/app.css:235` explicitly sets labels such as “Front month” to 16px. Change this to at least 18px.

No widget or legacy quote values feed position math. TradingView attribution remained visible, remounting produced exactly six widgets without duplicates, the script host is correct, no unsafe HTML/postMessage path exists, and repositories/envelope files have zero diff.

VERDICT: NEEDS FIXES (2 P1)