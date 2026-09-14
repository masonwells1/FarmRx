# Initiative FD — Front Door ledger

This ledger is append-only. Never edit, reorder, or delete an earlier entry. If an entry is wrong, append a correction that cites it. Times use `America/Chicago`.

## FD-000 — Initiative context and FD-1 plan

- **Date/time:** 2026-09-14 08:00 -05:00 (`America/Chicago`).
- **Authority:** the `Initiative FD — Front Door` section of the 2026-09-05 owner amendment in `docs/GOAL.md` (FD-1 Today screen). Mason approved building FD-1 as planned in the working session on 2026-09-14 ("Build FD-1 as planned"), after the Friction Sweep closed (pull requests #44 and #45 merged; `origin/main` at `a198417`). Merge, deploy, and live migration remain Mason's decisions.
- **Visual target:** `docs/archive/audits/2026-07-16-farmer-simplicity-loop/SELECTED-VISUAL-OPTION-2.png` (SHA-256 `d62cf7297313c1d4aa622ceb19c543b9acfa92e1d493127fa49fde109ea10d38`, verified in the session): "What are you recording?" tile grid, the spray-window card, a "Next up" list with red and amber badges, and a phone bar of Today · Fields · Tasks · Weather · More.
- **Tier:** full tier for the capability-gated data loading and the financial suppression (role matrix proved for owner, worker without financial access, read-only member, and named rep; a disposable database assertion that a member without `can_read_private_financials` receives no grain row); screen tier for layout and navigation.
- **Plan (one tranche, one commit):**
  1. `src/data/today.ts`: a pure projection. Record tiles filtered by `canAccessFarmModule` and `canEditFarmModule`; "Next up" built only from rows existing modules already produce (the `equipment_service_due` view, `farm_tasks` due or overdue, unread alerts written by the program-pass and grain-alert functions); the spray card from forecasts the Weather page already cached, freshness-gated by `isActionablyFresh`.
  2. Reads only through the pure snapshot path (`getSnapshot(context)` on Fields, Equipment and Tasks, and a new one on Alerts) using the access context the shell already validated, so opening Today never replays a queue, generates due items, refreshes a forecast, or writes a cache.
  3. `/today` route, `Today` first in navigation, default landing everywhere `/fields` was the default (sign-in redirect, farm choice, unknown routes, denied capability routes).
  4. Tiles hand off to the owning forms with router state: Rain opens the Field Log rainfall form on the first field, Task opens the new-task form, Spray record reuses the existing Weather → Inventory intent; Scouting note, Harvest and Grain delivery open their module pages. No new write path.
  5. Phone bar: four destinations plus More, in the order Today · Fields · Tasks · Weather · Grain, so an owner sees the selected visual option's bar and a named rep sees Today · Fields · Grain. Grain moves to More for members who can open Tasks and Weather.
- **Deliberately out of scope:** "low inventory" in Next up. No module records an on-hand quantity threshold today (Inventory keeps purchases and applications, not a reorder point), so there is no existing record to project; GOAL.md forbids inventing one here. It is listed for reconsideration when Initiative IP records on-hand quantities. FD-2 (grain line, Record button, Today · Grain · Fields · Record · More bar) is not started.
- **Rollback path:** revert the FD-1 commit. It adds no table, policy, function, or migration and touches no stored data.

## FD-001 — FD-1 Today screen: build and proof

- **Date/time:** 2026-09-14 08:11 -05:00 (`America/Chicago`).
- **WHERE:** branch `claude/app-improvement-strategy-kzqk6s` on `origin/main` `a198417`. This entry is committed together with the FD-1 code.
- **What changed:**
  - New `src/TodayModule.tsx`, `src/data/today.ts`, `src/data/todayIntents.ts`, `src/data/today.regression.ts`.
  - `src/data/notifications.ts`, `SupabaseNotificationsRepository.ts`, `QueuedNotificationsRepository.ts`, `createSupabaseNotificationsServices.ts`: an optional `getSnapshot(context)` pure read (live read verified against the access fence before and after; queued mark-read entries overlaid; the retained workspace cache returned only on a transport failure; no writes).
  - `src/data/weatherService.ts`: `readCachedForecast(storage, lat, lon)` reads a cached forecast without fetching or writing.
  - `src/App.tsx`: lazy `TodayPage`, `/today` route under the Fields capability, `Today` first in navigation, ordered phone-bar rule, `/today` as the default landing.
  - `src/FieldLogModule.tsx` and `src/EquipmentTasksModule.tsx`: read the Today record intent from router state and open the rainfall or new-task form immediately, only when that member can edit.
  - `src/styles/app.css`: Today styles (tiles at least 104px tall, 18px minimum text, red badge for overdue, amber for due, grid rows that keep the badge under the title on phones).
  - `scripts/foundation-static-guards.mjs`: the exact ordered route manifest gains `/today` first; the phone-bar guard pins the new ordered rule.
  - `scripts/sql/fd-today-role-assertions.sql`, run by `scripts/verify-fs-persist-disposable.sh` and `.ps1` after the Friction Sweep assertions (lane count unchanged at 27).
  - `tests/e2e/foundation-shell.spec.ts`: the exact-query mock now serves the Equipment and Tasks workspace, the Field Log entries, and the viewer-role membership read; default-landing expectations moved from `/fields` to `/today`; three Today journeys added; the phone-bar journey updated.
- **Role matrix proved (`src/data/today.regression.ts`, built-shell e2e on desktop and phone, and the disposable database):** owner sees six tiles and every Next up source; worker without financial access sees five tiles (no Grain delivery), service, tasks and program passes, never a grain line, and the browser issues no grain-table read; read-only member sees no tiles; named rep sees no tiles, only grain alerts, and the browser issues no equipment or task read. On the disposable database the worker without financial access receives the service-due row, the due task and only their own alert, and zero rows from `production_estimates`, `grain_contracts`, `grain_contract_deliveries`, `marketing_plan_targets`, `grain_bins` and `grain_sale_limits`; the owner receives all of them.
- **Proof observed:** `npx tsc -b --force` exit 0; `npx tsx src/data/today.regression.ts` passed; `npx tsx src/data/roundSevenSweep.regression.ts` passed (18px contract); `npm run build` exit 0; `node scripts/foundation-static-guards.mjs` PASS; `node scripts/verify-foundation-mutations.mjs` PASS (184/184); `bash scripts/verify-fs-persist-disposable.sh` printed `FS_PERSIST_DISPOSABLE_PASS` and `FD_TODAY_DISPOSABLE_PASS`; local Playwright on the built shell, desktop and phone: the three Today journeys, the named-rep, read-only, phone-bar, login and recovery journeys passed (the email-delivery-gated journeys skipped as configured); `git diff --check` clean.
- **Browser proof:** the owner Today journey captures a full-page screenshot (`today-owner.png` in the Playwright output) on desktop and phone; both were inspected. Desktop matches the selected visual option's structure. The phone layout was corrected once (badge and chevron wrapped onto their own lines) before this commit.
- **Remaining risk:** the spray card with a usable forecast is proved by the regression only; the e2e fixtures have no field coordinates, so the browser shows the "Check the spray window" link. A fresh-context review of the exact commit is still required; Codex reviews the pull request automatically.
- **Next:** push the branch, open a draft pull request, and stop at `READY FOR APPROVAL`. Merge is Mason's decision.

## FD-002 — Foundation repair: second route manifest and Router-less Field Log regressions

- **Date/time:** 2026-09-14 08:22 -05:00 (`America/Chicago`).
- **Trigger:** Foundation failed on `b9ab496` (pull request #46) in the fast regression suite: `src/data/queuedOperationContext.regression.ts` pins the ordered route manifest a second time (the first copy is in `scripts/foundation-static-guards.mjs`, updated in FD-001) and did not yet list `/today`. Running the whole chain locally then surfaced a second break the focused runs had missed: two Field Log regressions render `FieldLogPage` outside a router, and FD-1's `useLocation()` call in that page requires one.
- **Repair:** `/today` added first in the regression's manifest; `FieldLogModule.legacyRecovery.regression.tsx` and `FieldLogModule.deleteDoubleTap.regression.tsx` now render inside a `MemoryRouter`, the same wrapper the Equipment quick-action regression already uses. No product code changed.
- **Lesson recorded:** the route manifest is pinned in two places; a route change must update both, and the full `npm run regression` chain (not only focused runs) is part of the pre-push proof. This container has no PowerShell, so the four `pwsh` steps and the CW-2 diagnostic self-test cannot run here; every other step in the chain was run locally, and Foundation covers the rest.
- **Proof:** recorded on the pull request with the repair commit.
