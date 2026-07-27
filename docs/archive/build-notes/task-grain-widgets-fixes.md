PRE-APPROVED TASK — do NOT ask for confirmation; EXECUTE end-to-end and report what you did.

# Task: Fix all findings in docs/review-grain-widgets.md (3 findings, uncommitted working tree)

Read docs/review-grain-widgets.md and fix all three exactly as its concrete fixes describe:
1 (P1) MarketQuote.tsx watchdog must stay armed until the injected IFRAME actually loads (observe iframe insertion, handle load/error, timeout to the calm placeholder, clean up observers/listeners on unmount).
2 (P1) Mobile: Claude verified on a 375px viewport the document is 432px wide — the market grid must collapse to one column / min-width:0 / max-width:100% down the whole chain including the injected iframe. The grain page grid track was measured at 416px caused by the market section's intrinsic width. Fix so document scrollWidth == 375 at mobile. Do not clip TradingView attribution.
3 (P2) app.css:235 16px labels -> >=18px.

Constraints: no new deps, display-only rule stands, envelope/repositories untouched. Finish with npm run build AND npm run regression passing; paste tails.
