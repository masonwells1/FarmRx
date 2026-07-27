PRE-APPROVED TASK — do NOT ask for confirmation; EXECUTE end-to-end. READ-ONLY sandbox: do not modify files.

# Adversarial review: TradingView delayed-widget integration on the Grain page

Review the UNCOMMITTED working-tree changes in C:\FarmRx (git diff vs HEAD fb64cc3, plus new file src/components/MarketQuote.tsx). The build's spec was docs/build-notes/task-grain-widgets.md; licensing context in docs/futures-feed-research.md.

Attack specifically:
1. LICENSE/DATA-INTEGRITY: any code path where widget data (or leftover hardcoded quotes) feeds position math (percent priced, expected revenue, targets, Safe-to-Forward). The ONLY math inputs allowed are user-entered planned prices/basis. Any remaining UI text implying we have live quote NUMBERS of our own is a finding.
2. ATTRIBUTION: anything that hides/crops/removes the TradingView attribution (CSS overflow, height clipping, display:none, iframe sandboxing).
3. FAILURE MODES: script load failure, ad-blockers, offline — does the placeholder actually render (test the logic path), or can a broken iframe/blank hole/uncaught error occur? Script injected more than once on remount? Memory/observer leaks on unmount? Route away and back — duplicate widgets?
4. SECURITY: script injected with correct src only from s3.tradingview.com; no innerHTML of user data near it; no postMessage handling that trusts widget origin.
5. DESIGN: our chrome around widgets ≥18px/48px, brand tokens, mobile single-column, no horizontal scroll.
6. Envelope/repositories untouched (should be zero diff outside UI layer).

Number findings P1/P2 with file:line + concrete fix. End with exactly one line: `VERDICT: COMMIT-READY` or `VERDICT: NEEDS FIXES (n P1)`. FINAL message = ONLY the markdown review.
