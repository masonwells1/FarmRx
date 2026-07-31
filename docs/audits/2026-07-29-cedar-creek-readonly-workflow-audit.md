# Cedar Creek read-only workflow audit

> **Historical audit — closed 2026-07-31.** The `WAITING` verdict and five
> defects below describe the verified 2026-07-29 snapshot. The bounded Cedar
> repairs, continuous desktop/390-by-844 disposable packet, full repository
> proof, and fresh Sol review were later accepted at exact source/runtime commit
> `8a9565a08a760e0ec920170bfacee1d9132cba47`; PR #14 merged that history to
> `main` at `5c202f0dac0bfc3bfa0b9c92bdffba892caed15b`. Preserve this file as
> provenance, but use the current scorecard and append-only ledger for status.

**Audit date:** 2026-07-29 (`America/Chicago`)

**Audit kind:** bounded product/source audit; static evidence only

**Execution verdict:** **WAITING**

`WAITING` means this static audit is complete, but a future Cedar writer must
not start while the active North Fork branch overlaps the Cedar contract,
season manifest, and shared stylesheet. It does **not** mean the source audit
is blocked or that the identified repair/proof plan is incomplete.

## Executive conclusion

The canonical Cedar Creek journey is coherent and most of its intended
boundaries are visible in current source: Weather uses a local cache and a
payload-free manual handoff, stale Weather is rendered non-actionably, the
Inventory RPC validates the application and product arithmetic, and the
Scouting RPC is farm-scoped and idempotent.

The workflow is not ready to be called proven. Five existing-product defects
must be addressed, and the continuous CC-1 through CC-4 desktop/phone,
browser/network, queue, and disposable-database packet has not been built:

1. **HIGH — a queued spray is labeled as server-saved.** The Inventory queue
   resolves after placing a transport-failed write in local custody, but the
   spray form always announces `Spray record saved`. A farmer can reasonably
   believe a compliance record and its Inventory deduction reached the
   database when they exist only on that device.
2. **HIGH — a completed spray can be submitted twice as two different
   records.** The form generates new application/product UUIDs on every
   submission, releases its submit lock, leaves native field values in place,
   and does not retire the completed form. A second click can create a second
   application and reduce Cedar inventory from `15.00` to `10.00 gal`.
3. **HIGH — a future-dated Weather cache can be treated as fresh.** Both the
   direct-cache and actionable-freshness comparisons have an upper age bound
   but no `age >= 0` guard. A device clock rollback or future cache timestamp
   can surface `Good / Spray now`.
4. **MEDIUM — opening/refreshing Weather is not a hard no-write path.** A
   non-good-to-good transition calls the live notification RPC. The prescribed
   Cedar sequence likely avoids the branch on its first render, but that is
   path luck and conflicts with the shared rule that opening Weather is not a
   write.

There is also a visible phone/desktop defect: the Inventory tab emits
`selected`, while CSS styles `active`; the farmer gets no visual indication
that the blank Spray record tab is selected.

## Identity and collision preflight

| Item | Verified state |
|---|---|
| Audit checkout | `C:\FarmRx` |
| Branch | `main` |
| HEAD | `81234ca204517fb6699d81d95d509c8481583592` |
| Local `refs/remotes/origin/main` | `81234ca204517fb6699d81d95d509c8481583592` |
| Remote `refs/heads/main` | `81234ca204517fb6699d81d95d509c8481583592`, verified read-only with `git ls-remote` |
| Ahead / behind | `0 / 0` |
| Tracked working tree | Clean before this audit |
| Preserved unrelated untracked content | `docs/archive/audits/2026-07-15-sol-foundation-review/NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md`; `docs/handoffs/` |
| Audit write | This file only |
| Contract manifest SHA-256 | `4f233425b5eb12657a80c7eee9ecd293eee006e823fecf6f55ca50b076095985` |
| Migration head | `20260725213142_pine_hill_removed_farm_epoch.sql`; Git blob `89f432cdfc9a2cd6c6379309e0eb1bd283500686` |

The handoff requested a fresh clean audit worktree, but creating one would
itself write Git worktree metadata outside the one-file authorization. The
tracked-clean shared checkout was therefore used for read-only inspection and
this single artifact. No existing untracked content was moved, staged, or
changed.

### All Farm Rx worktrees

| Worktree | Branch / SHA | Relevant state |
|---|---|---|
| `C:\FarmRx` | `main` / `81234ca` | Audit checkout; tracked-clean before this file |
| `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity` | `codex/pine-hill-offline-custody` / `2558237` | Read-only evidence only |
| `C:\Users\mason\.codex\worktrees\farmrx-maple-aug-dec` | `codex/farmrx-maple-aug-dec` / `e7e79f` | Ahead 6, behind 2; read-only |
| `C:\Users\mason\.codex\worktrees\farmrx-north-fork-runtime` | `codex/farmrx-north-fork-runtime` / `895f148e` | Active; clean at final recheck; four commits ahead; not entered or touched |
| `C:\Users\mason\.codex\worktrees\farmrx-pine-hill-runtime` | `codex/farmrx-pine-hill-runtime` / `6a1d84` | Ahead 2; read-only |

At the initial preflight, North Fork was at `66c5d471` with these four
uncommitted paths:

- `scripts/verify-north-fork-disposable.ps1`
- `src/auth/farmContext.regression.ts`
- `src/auth/farmContext.ts`
- `tests/e2e/season/north-fork.spec.ts`

That initial footprint did not overlap Cedar. During the audit, North Fork
advanced to clean commit
`895f148e00d579736fc3e481133df26538567f2c` (`test: close North Fork proof
gaps`). Its four-commit branch diff from `origin/main` now includes:

- `docs/season-readiness/WORKFLOWS-AND-SCENARIOS.md`;
- `tests/season/season-2027.manifest.json`;
- `src/styles/app.css`; and
- other North/Pine proof and shared foundation/auth paths.

The first two are Cedar's canonical contract/manifest and the third is in the
future Cedar UI allowlist. This is exact changed-file overlap under the
handoff's gate, so the execution verdict is `WAITING`. No conclusion here
adopts or reviews North Fork's bytes.

## Method, authority, and limitations

The audit read the complete current `AGENTS.md`, handoff, `docs/GOAL.md`,
`docs/farm-rx-handoff.md`, `ORCHESTRATOR-RUNBOOK.md`, `SCORECARD.md`,
`WORKFLOWS-AND-SCENARIOS.md`, the append-only ledger tail, the season manifest,
the named current UI/services/queues/repositories, and the controlling
Inventory, Scouting, RLS, and scheduler migrations. Archived scenario mapping
was treated only as a historical lead; current source controls where it
conflicts.

Two bounded reviewers were used: one Terra farmer-journey/phone mapper and one
Sol adversarial data-boundary reviewer. The root reviewer independently
reopened and checked every finding used here.

No application, browser, test, build, database, container, CLI, migration,
provider, live Supabase, or production process was run. Static source can prove
that code and guards exist; it cannot prove the continuous farmer journey,
actual request counts, pixels, queue persistence, RLS behavior, or exact
database deltas at runtime.

### Source inventory inspected

The bounded source trace covered:

- `src/WeatherModule.tsx`, `src/InventoryModule.tsx`,
  `src/ScoutingModule.tsx`, and `src/styles/app.css`;
- `src/data/weatherService.ts`, `src/data/weatherSprayHandoff.ts`,
  `src/data/weatherService.regression.ts`, and
  `src/data/weatherSprayHandoff.regression.ts`;
- `src/data/createSupabaseInventoryServices.ts`,
  `src/data/QueuedInventoryRepository.ts`,
  `src/data/SupabaseInventoryRepository.ts`, `src/data/inventory.ts`,
  `src/data/inventoryWriteQueue.ts`, and the focused Inventory regressions;
- `src/data/createSupabaseScoutingServices.ts`,
  `src/data/QueuedScoutingRepository.ts`,
  `src/data/SupabaseScoutingRepository.ts`, `src/data/scoutingWriteQueue.ts`,
  `src/data/scoutingStorage.ts`, `src/data/saveReceipt.ts`, and
  `src/data/scoutingReceiptRefresh.regression.ts`;
- `src/data/createSupabaseNotificationsServices.ts`,
  `src/data/QueuedNotificationsRepository.ts`,
  `src/data/SupabaseNotificationsRepository.ts`, and
  `src/data/SupabaseNotificationsDataGateway.ts`;
- `tests/season/season-2027.manifest.json`,
  `supabase/migrations/20260711223443_module3_inventory.sql`,
  `20260711223531_module3_rls.sql`,
  `20260712020009_inventory_live_support.sql`,
  `20260712150557_0020_scouting.sql`,
  `20260712152422_0021_scouting_bucket_limits.sql`,
  `20260716122213_0039_scheduler_weather_push_semantics.sql`, and the current
  farm-access/RLS amendments.

## Requirement-by-requirement evidence

| Requirement | Source-real behavior | Expected writes | Required non-writes | Existing proof | Missing proof / finding | Future proof |
|---|---|---|---|---|---|---|
| **CC-1 exact fresh Weather request and display** | `weatherService.ts:26,70-77` builds the exact cache key and deterministic Open-Meteo query, normalizes provider-shaped data, and writes only the browser cache. `WeatherModule.tsx:53` renders the current values, verdict, hours, and manual-record action. | One `localStorage` cache envelope at `farm-rx-weather:v1:38.210:-89.120`; no product-database write. | No external packet; no provider/provenance row; no application, notification, location, Program, Grain, or unrelated Inventory change. | Weather normalization/freshness regressions and canonical fixture text exist. | No governed frozen-clock route observation, exact byte/count assertion, network fence, UI assertion, or SQL before/after proof. Weather can also call `raiseNotification` on a later transition (`WeatherModule.tsx:28-40`). **Product defect + proof gap.** | Intercept and fulfill the one exact request in-process, reject every unexpected external request, assert exact cache bytes/timestamps and UI, and SQL-fence every named non-write. |
| **CC-2 Weather-to-Inventory handoff is manual and blank** | `weatherSprayHandoff.ts:1-10` permits only `{kind, version}`. `WeatherModule.tsx:46` navigates with that intent. `InventoryModule.tsx:26-43` uses it only to select the Spray view. No field or Weather value is passed. | Navigation state only. | No auto-fill, auto-save, provider ID/link, or Weather provenance. | `weatherSprayHandoff.regression.ts` rejects added field/Weather keys. | No real-browser proof that each weather/application input is blank of Weather-derived payload. The date and first product have generic local defaults; those are not Weather transcription. Inventory emits `selected`, but `app.css:636` styles `active`. **Product defect + proof gap.** | Inspect the navigation state and every visible form value on desktop and phone; assert zero write requests before explicit Save and a visible selected Spray tab. |
| **CC-2 exact spray save and arithmetic** | `InventoryModule.tsx:60` maps the farmer fields to one application bundle. `SupabaseInventoryRepository.ts` maps the bundle to the RPC. `20260712020009_inventory_live_support.sql:572-1048` derives the actor, enforces farm edit access/field/crop ownership, validates the exact shape, snapshots product/label facts, checks rate × acres within 1%, and makes same-ID replay immutable. `20260711223443_module3_inventory.sql:901-944` computes on-hand as receipts + adjustments − completed effective use, so `20 − (40 × 0.125) = 15`. | Exactly one `application_records` row and one `application_products` row with the manifest identities; the on-hand view derives `15.00 gal` rather than storing another ledger mutation. | No receipt, adjustment, second application/product, Program, Grain, notification, location, Weather, or unrelated row/version change. | Inventory mapping/RPC regressions and the Prairie exact-same-ID replay proof exist. | Cedar has no database/browser packet. More seriously, queued transport failure resolves normally while the UI says server-saved, and a second completed-form click generates new IDs and can create a second record. Same-ID RPC replay does not protect that second click. **Two HIGH product defects + proof gap.** | Prove confirmed/queued/needs-attention receipts separately; make Save state honest; retire or reset the successfully completed form; double-click and post-success-click adversarial tests; lost-response/replay test; exact SQL delta and `20.00 → 15.00`, never `10.00`. |
| **CC-3 real 100-minute stale fallback** | `weatherService.ts:73-77` bypasses direct cache after 30 minutes, attempts refresh, returns cache with `stale:true` on failure within two hours. `WeatherModule.tsx:53` shows the four required warnings, hides the blank-record action, and produces no actionable window. | The proof harness replaces the exact browser cache key; product database remains unchanged. | No external packet after local abort; no database write, notification, field-location, Weather-state, push, or application change. | Focused freshness regression covers stale and over-age cases. | No browser abort/count/network proof or SQL fence. Age checks accept negative age, so a future-dated cache can be rendered actionable. **HIGH product defect + proof gap.** | Add the nonnegative-age guard/regression, then preload exact canonical bytes, abort the exact refresh locally, assert one attempt/no external packet, exact wording, no action button/window, and named SQL non-writes. |
| **CC-4 exact Scouting note and visible receipt** | `ScoutingModule.tsx` defaults `weed`, null location, empty files, and unchecked task; it refreshes before setting the action-owned Saved receipt. `SupabaseScoutingRepository.ts` maps the exact note operation. `20260712150557_0020_scouting.sql:173-538` derives `auth.uid()`, requires farm edit access and same-farm field, inserts photos only from the supplied array, creates a task only when requested, and returns same-operation retries from `repository_write_receipts`. | Exactly one `scouting_notes` row and one idempotency `repository_write_receipts` row. | No `scouting_photos`, `farm_tasks`, `notifications`, location, application, Weather, Program, Grain, or unrelated row/version change. | Repository regressions and `scoutingReceiptRefresh.regression.ts` statically protect refresh-before-receipt ordering. | No continuous stale-Weather-to-Scouting browser proof, exact SQL delta, reload behavior, or lost-response/retry proof. The JSON manifest has a Cedar note ID but no stable Cedar Scouting operation ID, even though the receipt is a real write. **Proof-contract gap.** | Add a stable operation ID to both canonical manifests; capture the action-owned receipt after refresh; separately reload and prove the durable timeline/row remains honest; retry the same operation and assert one note/one receipt. |
| **Desktop and 390×844 journey** | Responsive rules make Weather, Inventory, and Scouting forms one-column below `767px`; key controls use 48px minimum heights. Weather hour/day strips and Inventory tabs intentionally scroll inside their own containers. | Same exact CC-2 and CC-4 writes as desktop; no layout-driven duplicate. | No body/document horizontal overflow, obscured Save, accidental second save, or changed write set. | CSS source only. | No phone render, tap-path, scroll-container, focus, receipt-visibility, or mutation-count proof. The selected-tab selector mismatch is especially confusing in a horizontally scrolling tab row. **Product defect + proof gap.** | Run the entire sequence at `390×844`; assert `documentElement` and body width do not exceed 390, only named internal strips/tabs scroll, targets are at least 48px, the receipt is visible, and mutation counts match desktop. |
| **Queues, retries, reloads, and hidden coupling** | Inventory and Scouting queues carry farm/user/operation context, preserve local custody, and replay idempotently. Scouting exposes action-owned receipt states. Scheduled Weather observation writes are service-role-only and are not browser-callable. | Only the application bundle and Scouting note/receipt listed above. | Empty/settled Cedar queues after successful online proof; no scheduler, `spray_window_states`, notification, push-delivery, or cross-module side effect. | Queue/repository focused regressions and RLS/RPC source guards exist. | No Cedar queue-key inspection, storage/reload, retry, or disposable RLS proof. Notification creation bypasses the notification offline queue, and Weather itself can invoke it. **Product defect + proof gap.** | Disable/omit scheduler in the disposable stack; snapshot queues and all scheduler/push tables; simulate offline, transport failure, lost response, reload, replay, and needs-attention; prove identity/farm isolation and exact write counts. |

## Exact write and non-write model

| Step | Permitted write set | Zero-change fence |
|---|---|---|
| CC-1 | One exact browser `localStorage` Weather cache envelope | All product-database tables, especially applications, Inventory ledger inputs, notifications, field locations, provider/provenance, Programs, and Grain |
| CC-2 | One `application_records`; one `application_products`; derived on-hand changes `20.00 → 15.00 gal` | Receipts, receipt lines, adjustments, other applications/products, Scouting, notifications, locations, Weather state, Programs, Grain, and unrelated row counts/versions |
| CC-3 | Harness replacement of the one local cache key only | All database tables; all external network; no notification, scheduler, push, or application write |
| CC-4 | One `scouting_notes`; one `repository_write_receipts` idempotency row | `scouting_photos`, `farm_tasks`, `notifications`, locations, applications, Inventory, Weather/spray-window state, push tables, Programs, Grain, and unrelated rows/versions |

The Scouting receipt row must be counted explicitly. Calling only the note row
an expected write would make the future verifier falsely report an authorized
idempotency write as hidden coupling.

## Product defects

### CC-PD-01 — false confirmed-save wording for queued sprays — HIGH

- **Evidence:** `QueuedInventoryRepository.ts:72-82` sets an operation receipt
  to `queued offline` on offline/transport failure and resolves. The
  `InventoryRepository` contract in `inventory.ts:23` returns only
  `Promise<void>`, so `InventoryModule.tsx:60` cannot distinguish queued from
  confirmed and always calls `done('Spray record saved…')`.
- **Farmer impact:** a farmer may leave the device believing the legally
  significant application and Inventory deduction are on the server.
- **Small repair:** return an explicit save disposition/receipt identity from
  the repository boundary and render `saved`, `queued offline`, and
  `needs attention` honestly.

### CC-PD-02 — post-success duplicate spray submission — HIGH

- **Evidence:** `InventoryModule.tsx:60` creates new UUIDs inside every submit,
  resets only the controlled product-line array, leaves the native form and
  `fieldId` active, releases the lock, and leaves Save available.
- **Farmer impact:** a second click after success can produce two legitimate,
  differently identified applications and deduct another 5 gallons.
- **Small repair:** preserve the intended operation identity for one submission,
  disable Save while its outcome is unresolved, and retire/reset a confirmed
  completed form before another record can be created. Prove both rapid
  double-click and deliberate post-success second-click behavior.

### CC-PD-03 — future Weather cache is actionable — HIGH

- **Evidence:** `weatherService.ts:11-12,75,77` checks only
  `now - fetched_at <= ceiling` or `< threshold`; negative ages pass.
- **Farmer impact:** after clock rollback or a future cache timestamp, stale or
  invalid conditions can appear as `Good / Spray now`.
- **Small repair:** require a finite age satisfying
  `0 <= age <= threshold` at every current-forecast freshness/fallback gate and
  add a future-timestamp regression.

### CC-PD-04 — Weather read can write a notification — MEDIUM

- **Evidence:** `WeatherModule.tsx:28-40` calls `raiseNotification` on a
  non-good-to-good transition. `QueuedNotificationsRepository.ts:37` delegates
  that call directly to the live repository, which reaches
  `create_notification` through `SupabaseNotificationsDataGateway.ts:12`.
- **Farmer impact:** opening or refreshing a page presented as read-only can
  silently create alert/push-related state and behave differently online versus
  offline.
- **Small repair:** remove the browser Weather write path. If transition alerts
  remain a product requirement, keep them solely in the separately governed
  service-role scheduler path.

### CC-PD-05 — Spray tab selection is not visibly styled — MEDIUM

- **Evidence:** `InventoryModule.tsx:43` emits `className="selected"` while
  `app.css:636` styles `.inventory-tabs button.active`.
- **Farmer impact:** after the Weather handoff, especially in the phone's
  horizontally scrolling tabs, the farmer lacks a clear cue that the blank
  manual Spray record is the current section.
- **Small repair:** make the component and selector use the same state class and
  expose selection semantics with `aria-current` or the appropriate tab
  relationship.

## Proof gaps, not accepted runtime facts

1. No accepted continuous CC-1 through CC-4 runtime packet exists; the
   scorecard correctly remains `STATIC-ACCEPTED`.
2. Exact Weather request order/count, cache bytes/timestamps, local-only abort,
   and zero external packets have not run.
3. Exact application/product/note/receipt identities and database before/after
   deltas have not run in a disposable backend.
4. Cedar RLS has not been exercised as the owner and an unauthorized actor.
5. Save, queued, needs-attention, lost-response, replay, reload, and duplicate
   submission states have not run as one farmer journey.
6. The canonical JSON manifest lacks a stable Cedar Scouting operation ID for
   its required `repository_write_receipts` write.
7. Desktop and 390×844 layout, target sizes, body overflow, internal scrolling,
   receipt visibility, and mutation parity are source-informed but unrendered.
8. Scheduler/notification/push tables and every named unrelated module need
   explicit SQL fences; absence of a direct UI call is not runtime proof.

## Explicitly out of scope

The following are not defects or requested integrations for Cedar Creek:

- a new Weather vendor or production provider call;
- a Weather history or provider-observation table;
- automatic Weather-to-spray transcription;
- a Weather provenance row, ID, or link;
- automatic scouting photos, location capture, follow-up task, or notification;
- Programs, Grain, Crop RX delivery sync, or other module coupling;
- validating the applicator license's eligibility, expiration, jurisdiction, or
  legal status. The scenario proves literal text presence only.

## Exact future one-writer changed-file allowlist

Each tranche must be one writer, one immutable commit, and then a fresh-context
read-only Sol review of that exact SHA. A reviewer may reduce an allowlist; any
additional file requires a new scope decision before editing.

### Tranche 1 — honest, single spray save

- `src/InventoryModule.tsx`
- `src/data/inventory.ts`
- `src/data/QueuedInventoryRepository.ts`
- `src/data/SupabaseInventoryRepository.ts`
- `src/data/SupabaseInventoryRepository.regression.ts`
- `src/data/inventorySpraySaveReceipt.regression.ts` (new)

This tranche must solve both the confirmed-versus-queued wording and
post-success duplicate operation, without changing Inventory arithmetic.

### Tranche 2 — Weather no-write and time fence

- `src/WeatherModule.tsx`
- `src/data/weatherService.ts`
- `src/data/weatherService.regression.ts`
- `src/data/weatherSprayHandoff.regression.ts`
- `src/data/weatherNoWrite.regression.ts` (new)

This tranche must reject future timestamps as actionable and remove the browser
notification write without weakening stale wording or the payload-free handoff.

### Tranche 3 — visible selected Inventory tab

- `src/InventoryModule.tsx`
- `src/styles/app.css`
- `src/data/weatherSprayHandoff.regression.ts`

This small UI tranche may be folded into Tranche 1 only if its owning reviewer
agrees that one exact commit remains a coherent Spray trust repair.

### Tranche 4 — Cedar disposable proof packet

- `docs/season-readiness/WORKFLOWS-AND-SCENARIOS.md`
- `tests/season/season-2027.manifest.json`
- `tests/season/cedar-creek-2027-start.sql` (new)
- `tests/season/cedar-creek-2027.verify.sql` (new)
- `tests/e2e/season/cedar-creek.spec.ts` (new)
- `playwright.cedar-creek.config.ts` (new)
- `scripts/verify-cedar-creek-disposable.ps1` (new)

The two canonical manifest files may change only to add one stable Cedar
Scouting operation/receipt identity and keep both representations identical.
The scenario facts, IDs already assigned, limits, and non-write contract must
not drift.

`SCORECARD.md`, `LEDGER.md`, `GOAL.md`, packages, migrations, product fixtures,
and production configuration are excluded from these implementation/proof
tranches. If the immutable packet is later accepted, scorecard/ledger closeout
is a separate governed documentation action.

## Future proof ladder

1. Re-fetch `origin/main`; verify exact base SHA, all worktrees, active-agent
   task state, and zero changed-file overlap before assigning a writer.
2. Complete Tranche 1 only; run its focused repository/UI receipt,
   rapid-double-click, post-success-click, offline, transport-failure, and
   lost-response regressions. Confirm one operation identity survives replay.
3. Freeze Tranche 1 as an immutable commit and obtain fresh-context read-only
   Sol exact-SHA acceptance. Any repair becomes a new commit and new review.
4. Complete and separately review Tranche 2. Prove negative-age rejection,
   exact 30-minute/two-hour boundaries, all stale wording, zero actionable
   stale/future state, and no browser notification write.
5. Complete and separately review the selected-tab tranche if it was not
   accepted in Tranche 1.
6. Build the Cedar proof packet against a disposable local backend reset from
   the current migration head. Pin both database and browser clocks to
   `2027-07-07T13:20:00-05:00`; verify the exact migration-head identity and
   manifest SHA/identity table before proof.
7. Fail closed on every unexpected network request. Observe and fulfill the one
   exact fresh Open-Meteo route in-process; for stale proof observe and locally
   abort that same route. Assert zero external packets and exact request count.
8. Run CC-1 through CC-4 continuously on desktop. Assert exact text/values,
   manual blank handoff, exact cache envelope, one application/product,
   `20.00 → 15.00 gal`, one scouting note/receipt, and the complete named
   non-write SQL fence.
9. Exercise rapid double-click, deliberate second click after confirmation,
   offline queue, transport failure, lost response, retry, replay, reload, and
   needs-attention. Prove honest farmer wording and exactly-once durable rows.
10. Repeat the journey at `390×844`. Assert no body/document overflow, only
    intended internal strip/tab scrolling, minimum 48px actions, visible
    selected tab and receipt, and identical write counts.
11. Exercise RLS with the Cedar owner and a denied wrong-farm/unauthorized
    actor. Keep the scheduler disabled or absent and SQL-fence
    `spray_window_states`, `notifications`, `push_deliveries`, and
    `push_delivery_targets`.
12. Run the repository's required static/type/build/audit/foundation gates only
    in that future authorized proof task. Perform secret, artifact, and
    changed-file allowlist checks.
13. Freeze the proof as an immutable commit and obtain a new fresh-context Sol
    exact-SHA adversarial review. Do not self-accept, merge, deploy, migrate
    live data, or update the scorecard/ledger from an unreviewed packet.

## Verdict

**WAITING**

Current `main` and remote `origin/main` still match, the source audit is
complete, and the defects have bounded repair slices. However, active North
Fork commit `895f148e` overlaps the Cedar contract, season manifest, and shared
stylesheet. The handoff makes that overlap a categorical wait gate.

The single recommended next step is to let the North Fork owner finish its
governed review/closeout, then re-fetch `origin/main` and repeat the
worktree/changed-file collision check. Only if that check is clean should one
isolated Cedar writer begin **Tranche 1 — honest, single spray save**.
