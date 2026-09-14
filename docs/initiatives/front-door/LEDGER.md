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

## FD-003 — Foundation repair: browser journeys that assumed Fields was the landing page

- **Date/time:** 2026-09-14 08:39 -05:00 (`America/Chicago`).
- **Trigger:** Foundation failed on `f9d0ecd` (pull request #46) in the built-browser lane: seven journeys FD-001's focused local run had not covered (97 passed). All seven reproduced locally and share two causes.
- **Cause 1 (five journeys):** the two-tab sign-in, multi-farm choice, long-farm-name, and lazy-route-recovery journeys asserted the Fields page (the field name "North Forty", or the Grain link on the phone bar) right after sign-in or farm choice. FD-1 lands on Today instead, and Grain now sits in More on phones for members who can open Tasks and Weather. Each journey now asserts the Today landing, then opens Fields (or More, then Grain) before its original checks. Switching farms from the shell's farm picker also reopens the app on Today for the new farm (it reopened on Fields before), so the multi-farm journey opens Fields again after the switch before checking the second farm's field. The offline farm-switcher proof and the two-farm cache proof still run on Fields exactly as before.
- **Cause 2 (two journeys):** the Grain page's Profitability gateway reads `equipment` through a narrower exact shape (`id,farm_id,name,status`, ordered by name then id). FD-001's mock served `equipment` only in the Equipment workspace shape and rejected the narrower read, which earlier fell through to the empty-unknown-read path. The mock now accepts both exact shapes; unknown shapes are still rejected.
- **Repair scope:** test and mock files only. No product code changed.
- **Lesson recorded:** a default-landing change touches every journey that starts from sign-in or farm choice; before pushing, run the entire local Playwright suite (all spec files, both projects), not a grep-selected subset.
- **Proof:** recorded on the pull request with the repair commit.

## FD-004 — Codex review repairs on FD-1 (three findings)

- **Date/time:** 2026-09-14 09:08 -05:00 (`America/Chicago`).
- **Trigger:** Codex reviewed `800b2cf` on pull request #46 after it was marked ready for review and returned three findings. All three were verified against the code and are repaired in the next commit.
- **Finding 1 (P1, farm scoping):** the alerts table's read rule returns this member's alerts for every farm they can open, and the new pure snapshot validated only the recipient. On a multi-farm account, Farm A's Today could list Farm B's program and grain alerts, whose links would then open the module under Farm A. The snapshot now keeps only rows whose `farm_id` is the selected farm, and the projection applies the same guard, so neither layer trusts the other. Proved by a regression fixture with another farm's alerts (never listed) and by the owner and named-rep browser journeys, whose fixtures now include a River Bend alert that must not appear.
- **Finding 2 (P2, duplicates):** the due-generation functions also write a `farm_tasks` row for an overdue service interval and for a due program pass. Today listed the service-due row and its generated task, and the pass alert and its generated task, as separate rows. The projection now treats a generated service task as the same work as a shown service-due row for the same interval, and a generated program task as the same work as a shown unread alert for the same pass, and lists each once. When the alert is read (or no service-due row exists) the generated task is the only representation and is listed. Proved by regression cases for both directions and by a browser fixture with the generated service task.
- **Finding 3 (P1, tile hand-offs):** Scouting note and Harvest opened module lists, and Grain delivery opened the contracts tab whose first control is the new-sale form, so the tile most tied to money could produce the wrong record. Every tile that opens a form now carries an intent: Scouting opens the new-note form on the first field; Harvest opens the harvest entry for the first crop of the first field; Grain delivery opens the contracts tab in delivery mode, with the new-sale form set aside behind a "Record a sale instead" button, a plain notice that nothing is written until Record delivery is tapped, and focus on the first contract's delivered bushels. Each form is the module's own; no new write path. Proved by the owner browser journey, which now taps all six tiles and asserts each labeled form, and asserts that the "Add contract" button is absent in delivery mode until the farmer asks for it.
- **Not changed:** the alerts page itself still lists every farm's alerts as before; FD-1 changed only Today's pure snapshot. If Mason wants the alerts page scoped the same way, that is a separate decision.
- **Proof:** recorded on the pull request with the repair commit.

## FD-005 — Foundation repair: Harvest regression rendered outside a router

- **Date/time:** 2026-09-14 09:16 -05:00 (`America/Chicago`).
- **Trigger:** Foundation failed on `1842d51` (pull request #46) in the fast regression suite: `HarvestModule.receipt.regression.tsx` renders `HarvestPage` without a router, and FD-004's harvest intent gave that page a `useLocation()` call. The same class as FD-002.
- **Repair:** both renders in that regression now sit inside a `MemoryRouter`, matching the Field Log and Equipment regressions. No product code changed.
- **Lesson recorded (and this time applied before pushing):** FD-002 already said the whole `npm run regression` chain is part of the pre-push proof; FD-004 ran only the focused regressions. Every step of the chain that can run without PowerShell was run locally before this commit, and any module page that gains a router hook must be checked against every regression that renders it.
- **Proof:** recorded on the pull request with the repair commit.

## FD-006 — Second Codex round on FD-1 (two findings)

- **Date/time:** 2026-09-14 09:25 -05:00 (`America/Chicago`).
- **Trigger:** Codex reviewed `bd26538` on pull request #46 and returned two P2 findings. Both were verified against the code and are repaired in the next commit.
- **Finding 1 (harvest year):** the FD-004 harvest hand-off picked the crop to open from the browser's calendar year on the first render, and the page only switched to the newest year with crops in a later effect, so on a farm with no crops assigned for the calendar year the Harvest tile opened no form. The page now computes the effective year synchronously from the first render (newest year with crops when the stored year has none), passes it to every field card and the year picker, and lets the effect only settle the stored value. Proved by a new Harvest regression case: crops for a prior year only, opened from the harvest intent, render the entry form without a tap.
- **Finding 2 (applied passes):** `mark_program_pass_applied` sets the pass to applied and closes its generated task but leaves the pass alert unread, so Today kept listing the pass as due. The projection now treats an unread pass alert whose generated program task is already done as finished work and does not list it; the alert itself stays unread on the alerts page exactly as before, because Today writes nothing. Proved by a regression case (applied pass with an unread alert is absent; other alerts unaffected). Closing the alert when the pass is applied would be a database-function change outside FD-1's read-only scope; recorded here for Mason if wanted.
- **Proof:** recorded on the pull request with the repair commit.

## FD-007 — Third Codex round on FD-1 (three findings), with a correction to FD-000

- **Date/time:** 2026-09-14 09:49 -05:00 (`America/Chicago`).
- **Trigger:** Codex reviewed `20ff61e` on pull request #46 and returned three P2 findings. All three were verified against the code and are repaired in the next commit.
- **Finding 1 (low inventory) and correction to FD-000:** FD-000 recorded "low inventory" as out of scope because "no module records an on-hand threshold". That was wrong. The Inventory shelf already derives and shows a low-on-hand condition (a confirmed count from zero through five inventory units: "Low on hand — check your shed count") from the `inventory_on_hand` view, so it is an existing record in the sense GOAL.md requires. Today now lists it: Inventory gains the same optional pure snapshot the other sources have (context verified around every boundary, Fields from its own pure snapshot, this device's queued inventory work overlaid, read-only cache only on a transport failure, nothing replayed or written), and the projection lists each active product the shelf would mark low as "Low inventory" with "<count> <unit> left", for every member who can open Inventory (that includes named reps, exactly as the module itself does). Negative counts are the shelf's separate "more used than received" problem and are not "low". Proved by regression (threshold edges, retired and negative products absent, role reach) and by all three browser journeys (owner, worker without financial access, named rep), whose fixtures now carry a low product.
- **Finding 2 (harvest field):** the FD-006 harvest hand-off targeted the first active field; when that field has no crop in the effective year but a later one does, nothing opened. The intent now opens the first active field that has a crop in the effective year. The Harvest regression case now puts a bare field first and asserts the entry opens on the field with the crop.
- **Finding 3 (on-time service):** the service-due view lists an interval the moment it is reached (amount 0); Today called that "Service overdue · 0 hours over". It is now "Service due · Due now" with due urgency; positive amounts remain overdue. Regression case added.
- **Not changed:** no table, policy, view or function. The disposable database lane's role assertions are unchanged: inventory is not a private financial table, and its read rules are the module's own.
- **Proof:** recorded on the pull request with the repair commit.

## FD-008 — Fourth Codex round on FD-1 (two findings)

- **Date/time:** 2026-09-14 09:57 -05:00 (`America/Chicago`).
- **Trigger:** Codex reviewed `4e38347` on pull request #46 and returned two P2 findings on the service rows. Both were verified against the code and are repaired in the next commit.
- **Finding 1 (rounding before classifying):** FD-007 rounded the overdue amount and then tested it for zero, so a service a quarter hour past its interval read "Due now". Lateness is now decided on the raw amount (any positive amount is late) and rounding is for display only; an amount under one unit reads "Less than 1 hour over" (or mile, or day). Regression case added.
- **Finding 2 (one card per interval):** an interval with both a meter rule and a calendar rule can appear twice in the service-due view, and Today listed it twice although recording the service resets the one interval. Today now shows one card per interval, represented by the overdue row, and between equals by the meter row, matching the order the due-generation SQL uses. Regression cases cover both orderings.
- **Proof:** recorded on the pull request with the repair commit.

## FD-009 — Fifth Codex round on FD-1 (two findings)

- **Date/time:** 2026-09-14 10:07 -05:00 (`America/Chicago`).
- **Trigger:** Codex reviewed `5f78bcf` on pull request #46 and returned two findings. Both were verified against the code and are repaired in the next commit.
- **Finding 1 (P1, delivery scope):** the Grain page filters contracts by the selected crop scope, and a fresh page selects the first production estimate, which the repository lists oldest year first. Delivery mode offered no way to change it, so a farm with several crop years could be offered an old contract for delivery while the current one stayed hidden. Delivery mode now defaults to the newest crop year and shows a "Crop and year" picker inside the delivery panel (the same scope labels the plan tab uses), so the farmer chooses the crop before the contract. Proved by a small regression on the default (newest year, first of equals) and by the owner browser journey asserting the picker and its default.
- **Finding 2 (P2, harvest year):** the Harvest page derived its year list from every crop assignment, so a retired field's newer crop could become the effective year and leave the intent with no active field to open. Years now come from crops on active fields only; the Harvest regression case adds a retired field with a newer crop and asserts the entry opens on the active field's crop and the retired year is not offered.
- **Proof:** recorded on the pull request with the repair commit.

## FD-010 — Sixth Codex round on FD-1 (two findings)

- **Date/time:** 2026-09-14 10:19 -05:00 (`America/Chicago`).
- **Trigger:** Codex reviewed `486f804` on pull request #46 and returned two findings. Both were verified against the code and are repaired in the next commit.
- **Finding 1 (P1, spray card clock):** Today judged the cached forecast's two-hour ceiling against the page-load time only, so a phone left open on Today could keep showing a green verdict indefinitely. The clock now ticks every minute and whenever the app comes back into view, and the card is re-judged each tick; past the ceiling the verdict is replaced by the Weather link with no reload. Proved by a new render regression (`src/TodayModule.sprayClock.regression.tsx`): a fresh verdict, still present at ninety minutes, gone at three hours with the page never reloaded.
- **Finding 2 (P2, delivery scope on load):** the Grain page's first load pins the selected estimate to the repository's first (oldest) estimate, so FD-009's newest-year default was never reached. The load now applies the delivery-mode default when no estimate is selected yet. Proved through the existing default regression and the owner browser journey's picker assertion.
- **Proof:** recorded on the pull request with the repair commit.

## FD-011 — Seventh Codex round on FD-1 (two findings)

- **Date/time:** 2026-09-14 10:41 -05:00 (`America/Chicago`).
- **Trigger:** Codex reviewed `b33bf23` on pull request #46 and returned two findings. Both were verified against the code and are repaired in the next commit.
- **Finding 1 (P1, window judged at fetch time):** the spray card judged the best window from the forecast's wall clock at fetch time, so a cache still inside the two-hour ceiling could offer hours that had already passed ("Good spray window until 11 AM" at 11:30). The card now moves the field's wall clock forward by the cache age, takes conditions from the hourly sample at or before that time (the fetched current sample only when none exists), and judges the window from there; hours already gone never count. Proved by regression: the same cache read 100 minutes later still runs to 10 AM, and a cache fetched at 9:30 read at 10:00 no longer offers the window that closed at 10, with conditions from the 10:00 sample.
- **Finding 2 (P2, offline inventory):** when only the Fields request failed and Fields answered from its cache, the pure Inventory read raised a generic validation error, so the queued layer never fell back to its complete cached Inventory workspace and Today lost its low-inventory rows. The error now states the network cause in the words the transport check recognizes, so the cached workspace is used. Proved by regression.
- **Proof:** recorded on the pull request with the repair commit.

## FD-012 — Eighth Codex round on FD-1 (one finding)

- **Date/time:** 2026-09-14 10:51 -05:00 (`America/Chicago`).
- **Trigger:** Codex reviewed `2dfe826` on pull request #46 and returned one P2 finding, verified against the code and repaired in the next commit.
- **Finding (rescheduled passes):** `reschedule_program_pass` moves a pass and its generated task to the new date but leaves the old reminder unread, so Today kept listing the pass as due from that alert. An unread pass alert whose generated task is now due on a later date is treated as a past reminder and is not listed; when that date arrives the pass is listed again. Today still writes nothing; the alert stays unread on the alerts page exactly as before. Proved by regression (rescheduled pass absent today, present on the new date).
- **Proof:** recorded on the pull request with the repair commit.

## FD-013 — Ninth Codex round on FD-1 (two findings)

- **Date/time:** 2026-09-14 11:03 -05:00 (`America/Chicago`).
- **Trigger:** Codex reviewed `e3709f9` on pull request #46 and returned two P2 findings on the per-section failure paths. Both were verified against the code and are repaired in the next commit.
- **Finding 1 (pass alerts without task state):** whether a pass is applied or rescheduled is read from its generated task; when the Equipment and Tasks snapshot failed but Alerts loaded, both checks ran against an empty task list and an already-applied or rescheduled pass came back as "Program pass due". Pass state is now treated as unknown when that snapshot is absent and no pass alert is listed; the section's own error explains the gap, and grain alerts, which do not depend on task state, still list. Regression cases updated and added.
- **Finding 2 (Fields tied to Equipment):** for members who can open Equipment, Fields was derived only from the Equipment workspace, so an Equipment-specific failure also reported Fields as failed and removed the spray card. When Equipment fails, Fields is now read on its own through its pure snapshot. Proved by a case in the Today render regression (failing Equipment, Fields still ready).
- **Proof:** recorded on the pull request with the repair commit.

## FD-014 — Tenth Codex round on FD-1 (two findings)

- **Date/time:** 2026-09-14 11:13 -05:00 (`America/Chicago`).
- **Trigger:** Codex reviewed `d37c767` on pull request #46 and returned two findings. Both were verified against the code and are repaired in the next commit.
- **Finding 1 (P1, observation vs hourly row):** FD-011 took the conditions from the latest hourly row at or before the field's clock now, which discarded a fresher current observation taken between hourly rows (a 10:45 observation of 20 mph lost to the calm 10:00 row, so Today could show green right after Weather showed poor). The current observation now stands until an hourly row newer than it arrives. Regression cases cover both sides of that boundary.
- **Finding 2 (P2, farm calendar day):** Today used the device's calendar day for "due today", so a manager travelling across time zones could see a task due a day early or late. The farm's stored IANA time zone (`farms.time_zone`, the database's own due-generation authority) is now read into the Farm record (absent, not fatal, on rows cached before the client read it) and Today derives its day from it on every clock tick, falling back to the device's day only when the zone is unknown or unusable. The device-local helper other forms use is unchanged; its note now points to the farm-zone helper. Regression cases cover Central, Tokyo, no zone and an unusable zone.
- **Proof:** recorded on the pull request with the repair commit.

## FD-015 — Eleventh Codex round on FD-1 (two findings)

- **Date/time:** 2026-09-14 11:24 -05:00 (`America/Chicago`).
- **Trigger:** Codex reviewed `bef77c2` on pull request #46 and returned two P2 findings that follow from FD-014's farm-day change. Both were verified against the code and are repaired in the next commit.
- **Finding 1 (calendar service rows and the farm's day):** the service-due view judges calendar intervals against the database's own date, so after midnight in the database but before midnight on the farm Today could call tomorrow's service due now. Today now recomputes a calendar interval's due date the way the view does (last service, or the machine's first day, plus the interval's months, clamped to a shorter month) and judges it against the farm's day; a calendar row not yet due on the farm's day is not listed, and days over are counted from the farm's day. Meter rows carry no date and are taken as reported. Regression cases cover the database-ahead-of-farm day, the farm's due day, the no-last-service case, and month clamping.
- **Finding 2 (reload on the new day):** while Today stayed open across the farm's midnight the tasks re-judged on the new day but the snapshots were never re-read, so a service interval that became due on the new day could not appear. The snapshots (still pure reads) are now re-read when the farm's day turns over and when the app comes back into view, without blanking the screen. Proved by the Today render regression (one re-read at the farm's midnight, one on becoming visible).
- **Proof:** recorded on the pull request with the repair commit.

## FD-016 — Twelfth Codex round on FD-1 (one finding)

- **Date/time:** 2026-09-14 11:33 -05:00 (`America/Chicago`).
- **Trigger:** Codex reviewed `108695b` on pull request #46 and returned one P1 finding, verified against the code and repaired in the next commit.
- **Finding (a later window read as the current one):** when conditions were good now, the next hour unsafe, and a later run good, the card said "Good spray window until <end of the later run>", presenting the unsafe gap as sprayable. "Until" is now used only when the best window begins by the next hourly mark (the farmer is standing in it); otherwise good conditions now are reported as "Good spray conditions right now" with "Next window opens at <time>" named separately. Regression cases cover the gapped case and the continuous case.
- **Proof:** recorded on the pull request with the repair commit.

## FD-017 — Thirteenth Codex round on FD-1 (one finding)

- **Date/time:** 2026-09-14 11:45 -05:00 (`America/Chicago`).
- **Trigger:** Codex reviewed `24603b4` on pull request #46 and returned one P2 finding, the inverse of FD-015's: when the farm's day runs ahead of the database's (just after midnight on an eastern farm), the service-due view has not yet returned a calendar interval that is already due on the farm's day, so re-judging the view's rows could not surface it. Verified and repaired in the next commit.
- **Repair:** calendar candidates now come from the loaded intervals and machines themselves, using the view's own rule (an active interval with a months rule on an active machine; due from the last service, or the machine's first day, plus the interval's months, clamped to a shorter month), judged against the farm's day; a calendar row the view returned is ignored in favour of that. Meter rows carry no date and are still taken as the view reports them. Regression cases cover the farm-ahead day, an inactive interval and a sold machine, alongside the earlier database-ahead cases.
- **Proof:** recorded on the pull request with the repair commit.

## FD-018 — Fourteenth Codex round on FD-1 (two findings)

- **Date/time:** 2026-09-14 11:57 -05:00 (`America/Chicago`).
- **Trigger:** Codex reviewed `5d54589` on pull request #46 and returned two P2 findings. Both were verified against the code and are repaired in the next commit.
- **Finding 1 (Equipment cache after a Fields-only outage):** the Equipment and Tasks pure read raised a generic error when its Fields snapshot came from the cache, so the queued layer never fell back to the cached Equipment workspace and Today lost every service and task row. The same class as FD-011's Inventory finding; the error now states the network cause in the words the transport check recognizes. This message lives in pre-existing code that Today newly exercises; no other caller asserted its text.
- **Finding 2 (service recorded offline):** service recorded on this device but not yet synced sits in the service log while the interval's last-done values and the due rows are unchanged until the sync lands, so Today kept calling the just-completed service overdue. A log entry for an interval dated after its last service now resets that interval on Today (its meter row is not listed and its calendar due date counts from the entry); once synced the dates agree and the ordinary rule applies. Regression cases cover meter and calendar intervals serviced offline, the synced state, and an older log entry.
- **Proof:** recorded on the pull request with the repair commit.

## FD-019 — Fifteenth Codex round on FD-1 (one finding)

- **Date/time:** 2026-09-14 12:10 -05:00 (`America/Chicago`).
- **Trigger:** Codex reviewed `6b37e4f` on pull request #46 and returned one P2 finding on FD-018's unsynced-service rule. Verified against the server function and repaired in the next commit.
- **Finding (meter reset without a reading):** FD-018 reset a meter interval on Today from any newer service-log entry, but the server advances an interval's last-done reading only from an entry that carries a meter reading (`private.recompute_service_interval_completion`), so an entry without one would leave the meter reminder due on the server and it would return after sync. The service form requires a reading, so the ordinary path always carries one; Today's rule now matches the server's regardless: a meter row is reset only by a newer entry with a reading, while a calendar rule still counts from any newer entry's date. Regression cases cover a reading-less entry on a meter interval, and an interval with both rules with and without a reading.
- **Proof:** recorded on the pull request with the repair commit.

## FD-020 — Sixteenth Codex round on FD-1 (one finding)

- **Date/time:** 2026-09-14 12:25 -05:00 (`America/Chicago`).
- **Trigger:** Codex reviewed `fffd4a7` on pull request #46 and returned one P2 finding, the meter counterpart of FD-017. Verified against the queued overlay and the service-due view and repaired in the next commit.
- **Finding (a reading recorded offline that reaches an interval):** the queued layer overlays a meter reading recorded on this device onto the cached workspace, but the view's meter rows stay as they were at the last sync, and Today only ever filtered those rows. A machine carried past an interval offline was therefore not listed until the sync landed.
- **Repair:** meter candidates now come from the loaded intervals, machines and readings using the view's own rule (an active interval with a meter rule on an active machine that has a reading; the machine's latest reading, ordered as the view orders, less the interval's last-done reading or zero, less the interval's length, due at zero or more), with amounts rounded to the columns' two decimals. The view's rows are no longer read for either rule. An unsynced service entry that carries a reading stands in for the interval's last-done reading, completing FD-018 and FD-019 on the same footing. Regression fixtures now carry readings; cases cover the offline crossing, a stale view row the readings do not support, the view's reading order, hours since the last-done reading with a float remainder, and an unsynced service entry with its queued reading. The browser fixture gained the reading its twelve-hours-over interval implies.
- **Proof:** recorded on the pull request with the repair commit.

## FD-021 — Seventeenth Codex round on FD-1 (two findings)

- **Date/time:** 2026-09-14 12:45 -05:00 (`America/Chicago`).
- **Trigger:** Codex reviewed `289a195` on pull request #46 and returned one P1 and one P2 finding. Both were verified against the code and the provider's behaviour and are repaired in the next commit.
- **Finding 1 (P1, the spray clock's anchor):** Today placed the field's wall clock by shifting the forecast's current-observation stamp forward by the cache age. The provider stamps current conditions at its last observation interval, so a forecast fetched at 10:59 carries a 10:45 observation and Today read 10:51 at 11:05; the 11:00 hourly row had not "arrived" and a calm 10:45 verdict could outlive a wind that rose at 11:00. The provider's UTC offset (`utc_offset_seconds`, returned with every forecast) is now kept on the forecast bundle and in the browser cache, and Today places the field's clock from the instant and that offset alone. A forecast saved before the offset was recorded cannot place the clock and is not judged; the card's Weather link stands in until the Weather page saves a current forecast. Regression cases cover the lagged observation (the 11:00 row decides at 11:05), a cache without the offset, the wall-clock helper across a half-hour offset and the device's midnight, and the offset's retention on live and cached bundles; every spray case now names its fetch and read by the field's clock.
- **Finding 2 (P2, a second service the same day):** FD-020's meter reset took an unsynced entry's reading only when the entry was dated strictly after the interval's last service, so a second service later the same day was ignored until sync, although the server takes the newest reading-bearing entry regardless. On or after the last service day the entry now decides. Regression cases cover the interval reached again after a same-day service, with and without the second entry.
- **Proof:** recorded on the pull request with the repair commit.
