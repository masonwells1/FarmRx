# Farm Rx independent Terra final workflow review

Report the actual model and reasoning effort first. Work read-only in `C:\FarmRx`. Do not edit files, Git state, or external services. Do not call other models. Exclude the unrelated untracked `docs/audits/2026-07-15-sol-foundation-review/NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md` from candidate scope.

Act as a skeptical farmer reviewing the current candidate from base/HEAD `49614e75140fdf4dee94d916e32b386bef922f1a`. Read `docs/GOAL.md`, `docs/farm-rx-handoff.md`, `docs/audits/2026-07-15-sol-foundation-review/REPAIR-ROADMAP.md`, and the current diff. Inspect production UI/PWA code and local browser proof directly; do not accept Sol or the orchestrator's conclusions without checking.

Review desktop and 320–430px phone behavior for:

- signed-in User A changing to User B;
- revoked-farm recovery visibility, plain language, export, explicit dismissal, corrupt-vault handling, and no automatic replay into a regranted farm;
- offline reopen, expired-cache messaging, two-tab queue behavior, stale read/save outcomes, and visible retry/pending/error status;
- safe-area spacing, navigation overlap, tap targets, overflow, focus and accessible names;
- installed PWA raster/Apple icons and local offline shell behavior;
- notification links remaining inside Farm Rx after URL normalization;
- TradingView running only in the opaque sandbox frame and not reaching parent storage;
- CSP/header intent in `vercel.json` without implying deployed-header proof.

The final authoritative local gate completed with exit code 0 after the last repair: all 39 regressions, production/PWA build, dependency audit, 10/10 mutation checks, disposable migrations through 0041, RLS role matrix, and 32/32 Playwright desktop/phone checks; final line `Farm Rx foundation gate: PASS`.

Return a concise report with model/effort, files and commands, workflow results, any P0/P1/P2 with exact path/line and smallest correction, proof gaps, remaining manual live/device lanes, files changed (must be none), and external changes (must be none). Use `NO BLOCKING FINDINGS` only if no unresolved P0/P1/P2 remains. Unauthorized preview/device/live checks are limitations, not automatically code defects.
