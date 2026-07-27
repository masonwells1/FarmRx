# Foundation Findings

The original audit recorded seven P1 and two P2 findings. This file preserves those severities and scenarios while adding the repair disposition. “Branch-closed” means the code and local proof are complete; it does not mean the change is deployed.

| ID | Original severity | Post-repair disposition |
|---|---|---|
| SOL-FND-001 | P1 | Branch-closed; installed-device gate remains |
| SOL-FND-002 | P1 | Branch-closed |
| SOL-FND-003 | P1 | Branch-closed |
| SOL-FND-004 | P1 | Branch-closed; migrations 0036 required |
| SOL-FND-005 | P1 | Branch-closed; deployment/header gate remains |
| SOL-FND-006 | P1 | Branch-closed; scheduler/device gate remains |
| SOL-FND-007 | P1 | Branch-closed |
| SOL-FND-008 | P2 | Branch-closed; Edge redeploy required |
| SOL-FND-009 | P2 | Branch-closed |

## SOL-FND-001 — The PWA shell was offline, but the farm workflow was not

- **Severity:** P1
- **Files:** `src/auth/farmContext.ts:1-96`; `src/data/workspaceCache.ts:1-78`; queued repositories under `src/data/Queued*Repository.ts`; `tests/e2e/foundation-shell.spec.ts:100-217`
- **Reachable user scenario:** A farmer loads a farm online, loses rural coverage, closes/reopens the installed app, and creates or edits a record.
- **Expected behavior:** Verified cached farm data reopens; the write is durably queued and shown pending; reconnect replays once.
- **Actual risky behavior:** Before repair, only the shell survived and queue context required live Auth/farm calls. On this branch, cached user/farm/module workspaces reopen, pending operations are projected, financial cache expires after 24 hours, operational cache after seven days, and sign-out/revocation removes readable workspaces.
- **Business impact:** The original behavior could lose access to field context or prevent retaining work in dead zones. The branch removes the known browser-path failure.
- **Proof status:** **Proven branch-closed** in built Chromium desktop and phone for shell reopen, farm reopen, offline field create/reload, cache isolation, expiry, and sign-out clearing. Physical iOS/Android, storage pressure, and every module’s edit/delete UI remain unverified.
- **Suggested fix direction:** Deploy only after installed-device and storage-pressure proof; add quota telemetry and a recovery export if field testing exposes pressure failures.
- **Regression/manual proof:** `npx playwright test` tests at lines 100-217; real-device online load -> force-close -> offline reopen/create/edit/delete -> reconnect.

## SOL-FND-002 — Multi-farm owners and reps were rejected

- **Severity:** P1
- **Files:** `src/App.tsx:214,421-462`; `src/auth/farmContext.ts:37-85`; `src/data/index.ts:20-70`
- **Reachable user scenario:** An owner operates two farms or a Crop RX rep receives a second explicit farm grant.
- **Expected behavior:** The user chooses an active farm; all requests, caches, and queues remain bound to that farm; pending work blocks silent switching.
- **Actual risky behavior:** Before repair, more than one accessible farm threw an application error. The branch provides a picker, visible switcher, persisted selected farm, access revalidation, pending-work confirmation, and user+farm-scoped storage.
- **Business impact:** The original app contradicted its database authorization model and blocked the central multi-customer rep workflow.
- **Proof status:** **Proven branch-closed** with a two-farm browser session and the disposable rep/role matrix.
- **Suggested fix direction:** Keep the server/RLS list authoritative; complete a real multi-account/revocation pass before release.
- **Regression/manual proof:** `tests/e2e/foundation-shell.spec.ts:119-139`; `scripts/verify-rls-role-matrix.ps1`.

## SOL-FND-003 — Four queue families could lose work across tabs

- **Severity:** P1
- **Files:** `src/data/queueTransaction.ts:1-85`; `src/data/QueuedInventoryRepository.ts:10-23`; `QueuedEquipmentTasksRepository.ts:10-17`; `QueuedScoutingRepository.ts:9-16`; `QueuedNotificationsRepository.ts:8-14`
- **Reachable user scenario:** Two tabs save or replay Inventory, Equipment/Tasks, Scouting, or notification changes at the same time.
- **Expected behavior:** Append, park, remove, and replay share one critical section; no entry is erased or double-applied.
- **Actual risky behavior:** Before repair, localStorage envelopes were read/rewritten without a cross-tab transaction. Every queue now uses one Web Locks primitive with a renewable fail-closed lease fallback and BroadcastChannel/storage convergence.
- **Business impact:** The old race could silently lose field work or replay it twice.
- **Proof status:** **Proven branch-closed.** A two-page browser test retains two simultaneous notification operations; a regression retains 40 concurrent appends; the mutation drill detects removal of a queue lock.
- **Suggested fix direction:** Keep new queue families behind `queueTransaction`; add multi-tab tests when a new family is introduced.
- **Regression/manual proof:** `tests/e2e/foundation-shell.spec.ts:218-241`; `src/data/queueTransaction.regression.ts`; `scripts/verify-foundation-mutations.mjs`.

## SOL-FND-004 — Stale editors could silently overwrite newer canonical records

- **Severity:** P1
- **Files:** `src/data/optimisticSave.ts:1-52`; direct gateways in `SupabaseGrainDataGateway.ts:48-65`, `SupabaseProfitabilityDataGateway.ts:58-62`, `SupabaseEquipmentTasksDataGateway.ts:14-18`, `SupabaseInventoryDataGateway.ts:25`; `supabase/migrations/0036_optimistic_concurrency.sql:4-146`
- **Reachable user scenario:** Session A and B load version N. A saves; B saves a stale field/budget/contract/task/harvest record, or a stale full-field form omits a crop A just added.
- **Expected behavior:** B receives a stable conflict and cannot alter A. Retrying A after a missed response returns the prior receipt.
- **Actual risky behavior:** Before repair, full-row upserts and aggregate RPCs were last-write-wins. The branch adds direct-table compare-and-swap, versioned Field/Harvest RPCs, a shared field/harvest lock, stable `FARM_RX_STALE_WRITE`, lost-response reconciliation, and sequential offline-version rebasing. The full current crop child set is compared so a stale bundle cannot erase a new assignment.
- **Business impact:** The old behavior could silently remove newer yields, bushels, budgets, tasks, or field facts and corrupt downstream money/operations.
- **Proof status:** **Proven branch-closed locally.** Disposable independent sessions prove field/harvest conflicts, receipt replay, direct conditional updates, and added-child survival. Migration 0036 is not live.
- **Suggested fix direction:** Apply 0036 in a non-production environment and repeat the session attacks through PostgREST; consider richer compare/reapply UI after the safety gate.
- **Regression/manual proof:** `scripts/verify-0036-disposable.ps1`; `src/data/optimisticSave.regression.ts`.

## SOL-FND-005 — TradingView executed with first-party trust and no CSP

- **Severity:** P1
- **Files:** `src/components/MarketQuote.tsx:1-43`; `public/market-quote-frame.html`; `vercel.json:6-34`; `tests/e2e/foundation-shell.spec.ts:243-278`
- **Reachable user scenario:** A farmer opens Grain while authenticated and the third-party widget script is compromised.
- **Expected behavior:** Vendor code has no same-origin access to Farm Rx DOM, Auth storage, IndexedDB, queues, or navigation.
- **Actual risky behavior:** Before repair, the loader ran in the authenticated document and production lacked CSP. The branch loads a dedicated frame URL with `sandbox="allow-scripts"` and no same-origin/top-navigation token. The parent CSP permits first-party scripts only; the frame has a separate hash-pinned bootstrap and narrow TradingView policy.
- **Business impact:** The former trust boundary exposed session and private farm data to a third-party supply-chain event.
- **Proof status:** **Proven branch-closed** by hostile desktop/phone script execution that cannot set a parent marker or parent localStorage. Live headers are not deployed.
- **Suggested fix direction:** Deploy to preview, inspect actual response headers for the app and frame paths, then repeat the hostile test before production.
- **Regression/manual proof:** Browser tests at lines 243-278; `scripts/foundation-static-guards.mjs` verifies the inline hash and parent/frame policy split.

## SOL-FND-006 — Alerts were not a dependable app-closed service

- **Severity:** P1
- **Files:** `supabase/migrations/0037_scheduled_alert_foundation.sql:5-125`; `supabase/functions/scheduled-alert-sweep/index.ts:1-38`; `.github/workflows/scheduled-alert-sweep.yml:1-29`
- **Reachable user scenario:** A Program pass becomes due, a marketing rule crosses, or spray weather turns good while every Farm Rx client is closed.
- **Expected behavior:** A server schedule evaluates canonical data, creates one notification/delivery, retries safely, and records failures.
- **Actual risky behavior:** Before repair, evaluation depended on opening the app and the checked-in cron block was inactive. The branch adds a service-role-only fixed-clock database sweep, conservative weather transition recorder, durable notification/push rows, a secret-protected Edge entry point, structured failure logs, and a 15-minute workflow.
- **Business impact:** The old “alert” could appear only after the decision window or never reach the phone.
- **Proof status:** **Strongly evidenced branch-closed; deployment conditional.** Disposable fixed-clock runs create two scoped marketing events and one Program event once, suppress stale bids, create push rows, and fire spray only false→true. Edge runtime/deployment and a physical push are unverified.
- **Suggested fix direction:** Deploy/configure in a test project, invoke twice, monitor logs/queue, then prove one real app-closed push before production activation.
- **Regression/manual proof:** `scripts/verify-0037-disposable.ps1`; `supabase/functions/_shared/scheduledAlertLogic.regression.ts`.

## SOL-FND-007 — The old regression command created false confidence

- **Severity:** P1
- **Files:** `package.json:9-12`; `playwright.config.ts`; `scripts/verify-foundation.ps1:1-27`; `.github/workflows/foundation.yml`; `scripts/foundation-static-guards.mjs`; `scripts/verify-foundation-mutations.mjs`
- **Reachable user scenario:** Pure/fake-gateway tests pass while a real route, repository boundary, RLS rule, offline cache, or migration is broken.
- **Expected behavior:** One release gate crosses production build, browser, fresh database, roles/RLS, migration behavior, and deliberate negative controls.
- **Actual risky behavior:** Before repair, `npm run regression` was TypeScript scripts only and no CI/browser/reset gate existed. The branch’s foundation command runs forced TypeScript, regressions, build, audit, static guards, four mutation drills, 0033-0037 disposable probes, role matrix, and browser tests; CI invokes the same command.
- **Business impact:** The old green state could authorize a release with a broken field workflow.
- **Proof status:** **Proven branch-closed.** The complete gate passes and route/queue/RLS/cache mutations each fail the guard.
- **Suggested fix direction:** Make the workflow required on PRs; add read-only deployed smoke separately.
- **Regression/manual proof:** `npm run verify:foundation` -> PASS; mutation output 4/4 detected.

## SOL-FND-008 — Alert delivery used stale bids and mismatched entity scope

- **Severity:** P2
- **Files:** `src/data/marketingAlerts.ts:23-42`; `supabase/functions/deliver-grain-alert/index.ts:27-50`; `supabase/migrations/0037_scheduled_alert_foundation.sql:58-76`
- **Reachable user scenario:** Entity A is below goal while the combined farm is above it, or a weeks-old high bid remains the latest row.
- **Expected behavior:** Client, scheduler, and delivery recheck use the same farm/year/commodity/entity/enterprise scope and freshness.
- **Actual risky behavior:** Before repair, delivery omitted entity/enterprise filters and old bids could satisfy rules. All three paths now enforce exact nullable scope and a bid date from farm-local today minus two days through today.
- **Business impact:** The old behavior could send a false or wrong-entity marketing reminder.
- **Proof status:** **Proven branch-closed locally** with opposite-entity math and stale/future/fresh bid tests. Revised Edge source is not deployed.
- **Suggested fix direction:** Redeploy the delivery function and run authenticated test-farm alerts for both entities.
- **Regression/manual proof:** `src/data/marketingAlerts.regression.ts`; `scripts/verify-0037-disposable.ps1`.

## SOL-FND-009 — Mobile bottom navigation overlapped

- **Severity:** P2
- **Files:** `src/App.tsx:163-165,311,555-583`; `src/styles/app.css:572-590`; `tests/e2e/foundation-shell.spec.ts:279-305`
- **Reachable user scenario:** A farmer uses a 320-430px phone and changes modules.
- **Expected behavior:** Readable 18px labels, 48px targets, no collision, all destinations within two taps.
- **Actual risky behavior:** Before repair, twelve labels shared one shrinking strip. The branch keeps Fields, Grain, Tasks, and Weather plus More; the remaining eight destinations are in an accessible two-column surface.
- **Business impact:** The former layout caused wrong taps and made primary mobile navigation unreliable.
- **Proof status:** **Proven branch-closed** on desktop and phone Playwright projects at 320, 375, 390, and 430 pixels.
- **Suggested fix direction:** Retain these width/tap assertions and add real-device safe-area screenshots during release.
- **Regression/manual proof:** Browser test at lines 279-305; full suite 22/22.
