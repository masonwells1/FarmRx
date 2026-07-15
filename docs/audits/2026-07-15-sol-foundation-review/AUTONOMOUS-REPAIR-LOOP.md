# Farm Rx Foundation Autonomous Repair Loop

**Owner:** Sol
**Plan date:** 2026-07-15
**Source audit:** `docs/audits/2026-07-15-sol-foundation-review/`
**Scope:** SOL-FND-001 through SOL-FND-009
**Plan review:** completed once by Claude Fable at low effort; corrections incorporated; no further Claude/Fable calls
**Execution status:** FINALIZATION — Phases 0-6 and the final full local release gate are complete; branch and draft PR publication remain

## Outcome

Repair all nine foundation findings on one non-production branch, prove each repair through the real application path, open a draft pull request, and stop. The loop is autonomous inside that boundary: it diagnoses failures, makes scoped fixes, reruns proof, and advances only when the current gate is green.

The loop must stop before any live Supabase migration, production setting change, deployment, live-data write, merge to `main`, or production-branch push. Those actions require a new explicit approval from Mason.

## Fixed operating decisions

- Work on `codex/farmrx-foundation-repair`, based on the then-current `main`.
- Mason's approval of this reviewed plan explicitly authorizes pushing only `codex/farmrx-foundation-repair` and opening one draft pull request. It authorizes no other push.
- Keep the July 15 audit artifacts in the branch as the baseline and proof record.
- Use one branch and one draft pull request, with small phase commits so any repair can be reviewed or reverted independently.
- Include all seven P1 and both P2 findings. No feature expansion is allowed in this branch.
- Build failing real-path proof before or alongside each fix. A same-fix fake-gateway test is not sufficient proof.
- Treat local/disposable Supabase as writable. Treat linked/live Supabase as read-only until Mason gives separate approval.
- Never read out, log, copy into artifacts, or commit secrets. Never modify `.env` files.
- Preserve append-only financial, bin, delivery, receipt, and service ledgers. Do not retrofit them into ordinary editable rows.
- Preserve the database-enforced privacy model: no client-only farm, membership, rep-sharing, or financial-access decision is accepted.
- One Claude Fable plan review is the only external model review. Sol performs implementation, adversarial self-review, and verification after that.

## The closed loop

```text
PREFLIGHT
  -> REPRODUCE
  -> IMPLEMENT SMALLEST COMPLETE SLICE
  -> STATIC CHECK
  -> FOCUSED TEST
  -> REAL-PATH PROOF
  -> ADVERSARIAL DIFF REVIEW
  -> {failure: diagnose -> repair -> repeat from STATIC CHECK}
  -> PHASE COMMIT
  -> NEXT SLICE
  -> FULL RELEASE GATE
  -> DRAFT PR
  -> STOP FOR MASON
```

### Advancement rules

1. A phase cannot advance on TypeScript/build/regression alone.
2. Every finding must have a failing-before/passing-after proof or an equivalent controlled attack proof.
3. A proof must cross the production-shaped boundary relevant to the finding:
   - browser and service worker for offline/mobile;
   - two browser contexts for cross-tab and stale-editor behavior;
   - authenticated PostgREST/RPC plus RLS for farm/privacy behavior;
   - disposable PostgreSQL for migrations and database logic;
   - local Edge Function invocation for scheduler/delivery behavior;
   - built response headers and hostile-frame test for browser isolation.
4. If a check fails, the loop records the exact command and concise failure in the repair ledger, identifies the smallest responsible slice, fixes it, and repeats the entire phase gate.
5. The loop does not weaken, skip, quarantine, or delete a failing test to get green. Any intentional expectation change must be tied to a finding and explained in the ledger.
6. After three consecutive failures with the same external blocker, the loop records the blocker and continues only work that does not depend on the blocked gate. Phase 3 cannot advance past a blocked Phase 2, and Phases 2-6 cannot advance past a blocked Phase 1 proof harness. The loop stops only if no genuinely independent work remains.
7. Unexpected unrelated working-tree changes are preserved. If they overlap a repair file and cannot be separated safely, execution stops for Mason rather than overwriting them.

## Phase 0 — Isolate work and lock the baseline

**Purpose:** make the repair run reproducible without disturbing `main` or production.

Actions:

1. Re-read `CLAUDE.md`, `docs/farm-rx-handoff.md`, `docs/GOAL.md`, the six July 15 audit files, current migrations, Edge Functions, tests, scripts, and current `git status`.
2. Confirm the only starting changes are the July 15 audit artifacts. Preserve any new user changes.
3. Create `codex/farmrx-foundation-repair` from current `main`.
4. Create a repair ledger under this audit directory. It will track every slice, files changed, proof commands, failures, residual risk, and commit.
5. Capture the baseline results for:
   - `npx tsc -b --force`
   - `npm run regression`
   - `npm run build`
   - `npm audit`
   - disposable migration application and scripts 0033, 0034, and 0035
6. Inventory every mutable write path, queue family, selected-farm dependency, browser storage key, third-party script, alert evaluator, and cross-module reader/writer before choosing migration shapes.

Gate:

- Branch and baseline are recorded.
- No secret, live mutation, deployment, or unrelated change occurred.

## Phase 1 — Build the proof harness first

**Primary finding:** SOL-FND-007.
**Also creates the acceptance harness for:** all other findings.

Actions:

1. Add Playwright against the production build/preview, not only the Vite development server.
2. Add deterministic browser fixtures for authenticated disposable/local Supabase sessions, two users, two farms, multiple roles, and two simultaneous browser contexts.
3. Add a local Supabase configuration or equivalent disposable orchestration that applies migrations from zero and runs RLS/RPC/storage proof without touching live Supabase.
4. Bring the 0033-0035 disposable probes and a fresh manager/worker/read-only/rep/stranger matrix under one release command.
5. Add CI that runs forced TypeScript, fast regressions, production build, fresh migrations, database behavior, and browser tests. Read-only production smoke must be separate and must never block local development because credentials are absent.
6. Add a repair-only attack suite with failing reproductions for offline reopen, multi-farm selection, cross-tab queue contention, stale saves, hostile market widget access, app-closed alert evaluation, stale/entity-scoped alerts, and mobile navigation.

Gate:

- The old green commands remain green.
- The new attack tests fail for the expected pre-repair reasons.
- CI contains no secret values and cannot mutate production.

## Phase 2 — Establish the farm/session/offline data spine

**Closes:** SOL-FND-001 and SOL-FND-002.

These findings are repaired together because offline queue keys and cached workspaces cannot be safe until the active farm is explicit.

Actions:

1. Replace the single-row `currentFarmId()` assumption with an accessible-farm service and explicit selected-farm state.
2. Persist only the minimum session context needed to reopen offline: authenticated user ID, selected accessible farm ID, validation timestamp, and farm-scoped cache metadata.
3. Display the active farm clearly in the shell. Add a safe selector for owners and reps with multiple accessible farms.
4. Key every cache, queue, pending count, photo reference, push link, and repository context by both user ID and farm ID.
5. Block or explicitly resolve farm switching while pending work exists. Never silently move pending operations to another farm.
6. Persist canonical module snapshots in IndexedDB with schema versioning, data-age display, quota/error handling, and atomic writes.
7. Let the app reopen and render validated cached data without calling Auth or `farms` first. Revalidate membership before any replay or fresh server read.
8. Project all queued create/edit/delete/transition operations over cached canonical state, including inventory receipts, adjustments, cancellations, applications, tasks, scouting notes/photos, field logs, harvest, Programs, alerts, and Grain/Profitability mutations.
9. On sign-out, removed membership, revoked rep grant, or rejected revalidation, quarantine unsynced work for explicit recovery and remove readable farm caches from the active app. Do not replay.
10. Bound the unavoidable offline-revocation exposure: cached private financial data requires successful membership revalidation after 24 hours; cached nonfinancial operational data after 7 days. Show the cache age before expiry. After expiry, retain unsynced work in quarantine but do not display canonical farm data until revalidated.

Gate:

- Online load -> close -> offline reopen works for every core module.
- Offline create/edit/delete -> close -> reopen still shows one pending effect.
- In a single tab, reconnect produces one operation-ID-backed canonical effect. Two-tab contention and stale-replay guarantees are provisional until Phase 3 and are recertified there.
- Two-farm owner and two-grant rep can switch without cross-farm requests or storage.
- Worker/read-only controls match server permissions.
- After online revalidation detects revoked access, the cache fails closed and no operation replays. Offline visibility before revalidation is limited by the explicit 24-hour/7-day cache windows above.

## Phase 3 — Make every queued and mutable write concurrency-safe

**Closes:** SOL-FND-003 and SOL-FND-004.

Actions:

1. Extract one audited queue transaction primitive using Web Locks plus the existing renewable localStorage lease fallback.
2. Use it for append, inspect, park, remove, retry, and replay in every queue family; eliminate module-specific unlocked read-modify-write code.
3. Use `storage`/BroadcastChannel notifications so tabs converge on pending state without creating a second writer.
4. Add additive row-version support to mutable canonical aggregates after the Phase 0 mutation inventory. Use atomic `expected_version` comparisons in PostgREST updates and RPCs.
5. Return one stable application conflict code and the current canonical snapshot. Do not parse human SQL error strings in UI code.
6. Add reload/compare/reapply UI for Fields, Grain mutable records, Profitability budgets/costs/allocations, Equipment/Tasks, Harvest/shared field facts, and every other mutable aggregate found in the inventory.
7. Apply the same version expectation to offline edit/delete replay. A stale queued action moves to “Needs attention”; it never overwrites or loops forever.
8. Keep immutable finalization and append-only ledger paths receipt-idempotent rather than adding editable-row semantics.

Gate:

- Barrier-synchronized two-tab tests preserve every queued operation in FIFO order.
- Two tabs may race replay, but the server records one effect per operation ID.
- Session A saves version N -> N+1; session B's stale version N save conflicts and cannot alter A's data.
- The same conflict is surfaced after offline replay, including delete-versus-edit.

## Phase 4 — Isolate third-party market code and harden browser policy

**Closes:** SOL-FND-005.

Actions:

1. Remove TradingView loader execution from the authenticated Farm Rx document.
2. Render market content through a sandboxed isolated frame/document with the smallest required sandbox and origin permissions. If the vendor path cannot meet that boundary, replace it with first-party rendering from the existing quote data path.
3. Add production security headers: restrictive Content-Security-Policy, `frame-ancestors`, explicit `frame-src`/`connect-src`/`img-src`, Referrer-Policy, Permissions-Policy, and `X-Content-Type-Options: nosniff`.
4. Inventory and document all intentional third-party origins. No wildcard script source is accepted.

Gate:

- A controlled hostile widget cannot read parent DOM, localStorage, IndexedDB, or Supabase session material.
- Required Supabase, weather, fonts, PWA, and market-data paths still work in the production build.
- Serve the production build in tests through a local adapter that reads the header rules directly from `vercel.json`; assert that its route patterns cover every SPA route and that frame embedding is intentionally blocked. Vite preview headers are not accepted as proof.
- Live production response headers remain a named post-deploy gate. SOL-FND-005 is only conditionally closed in this branch until that proof passes.

## Phase 5 — Make alerts canonical, scoped, fresh, and schedulable

**Closes:** SOL-FND-006 and SOL-FND-008.

Actions:

1. Move price/date/Program/weather transition evaluation to one server-owned evaluator shared by in-app, email, and push delivery.
2. Enforce identical farm, crop year, commodity, operating-entity, and enterprise scope everywhere.
3. Define quote freshness and delivery-window semantics explicitly. Store the evaluated observation and freshness in the receipt.
4. Add a repository-owned scheduled entry point for Program due items, marketing transitions, approved weather transitions, and delivery-queue drain. Keep check-on-open only as an idempotent backstop.
5. Add durable evaluation and delivery receipts, deterministic operation IDs, retry/backoff, failure visibility, and a fake clock for proof.
6. Prepare—but do not activate—live scheduler configuration, secrets, or production Edge Function deployment.

Gate:

- With all clients closed, advancing a disposable clock and invoking the scheduler twice creates one correctly scoped notification and one delivery receipt.
- Two entities with opposite marketed percentages cannot affect one another.
- Stale bids do not trigger; fresh eligible bids do.
- Retry after a missed response or partial delivery produces no duplicate business event.

## Phase 6 — Repair mobile navigation

**Closes:** SOL-FND-009.

Actions:

1. Keep four or five highest-frequency destinations in the bottom bar and move remaining destinations into an accessible “More” surface.
2. Preserve 18px readable text, 48px minimum targets, safe-area padding, visible focus, active-route state, and the two-tap rule.
3. Ensure role-hidden destinations and direct deep links behave consistently.

Gate:

- Screenshot and tap-through proof at 320, 375, 390, 430, and tablet widths.
- No collision, clipping, inaccessible focused item, or wrong destination.
- Every destination remains reachable within two taps.

## Phase 7 — Cross-module reconciliation and full release gate

**Closes the loop; it is not a production release.**

Reconcile real writer -> dependent reader paths:

- Fields/crops/yields -> Grain expected and actual production.
- Grain contracts/deliveries/bins -> position, offers, marketing alerts, and revenue.
- Inventory receipts/applications/costs -> spray compliance, planner drawdown, and Profitability allocations.
- Arrangements/entities/acres -> land economics, budgets, breakeven, and reports.
- Equipment/tasks/Programs -> assignment, maintenance, application records, and notifications.
- Field logs/Harvest/Scouting/photos -> field history, crop actuals, nutrient removal, and storage cleanup.
- Alert evaluation -> in-app notification, email queue, push queue, read state, and retry receipts.

Required full gate:

1. `npx tsc -b --force`
2. `npm run regression`
3. `npm run build`
4. `npm audit`
5. Fresh application of every migration from zero
6. Disposable 0033, 0034, and 0035 proof
7. Fresh authenticated RLS matrix
8. Built-browser desktop/mobile route smoke
9. Offline close/reopen/create/edit/delete/replay suite
10. Two-tab queue and two-session stale-write suite
11. Hostile-frame and response-header suite
12. App-closed scheduler, alert-scope, freshness, and retry suite
13. Cross-module reconciliation suite
14. Gate-mutation drill in isolated disposable worktrees: deliberately break one route, one queue lock, one RLS expectation, and one service-worker data-cache behavior; prove the appropriate gate turns red for each mutation; discard only the deliberate mutation; rerun green
15. Read-only live schema/security/deployment smoke if safe credentials are available

Then:

1. Run an adversarial diff review against the July 15 findings and the handoff's three product rules.
2. Confirm only intended files changed and no secret-like material is present.
3. Update the repair ledger, coverage matrix, proof gaps, roadmap, command log, and verdict with exact evidence. Never erase the original finding history; mark each finding closed, reduced, or still open.
4. Commit the final proof artifacts.
5. Push only the non-production repair branch and open one draft pull request.
6. Stop and give Mason the verdict, remaining manual/live gates, and exact release decision.

## Completion definition

The branch repair loop is complete only when:

- SOL-FND-002, SOL-FND-003, SOL-FND-004, SOL-FND-007, SOL-FND-008, and SOL-FND-009 have passing branch-level closure proof.
- SOL-FND-001 has passing built-browser offline proof but remains conditional until installed iOS/Android offline/reopen/replay and storage-pressure proof.
- SOL-FND-005 has passing isolation and config-derived header proof but remains conditional until headers are verified on deployed routes.
- SOL-FND-006 has passing disposable app-closed evaluator/idempotency proof but remains conditional until the live scheduler/Edge Function is activated and a real device receives one app-closed push.
- forced TypeScript, all regressions, build, audit, fresh migrations, database probes, browser attacks, and cross-module reconciliation pass;
- the draft PR contains no unrelated changes or secrets;
- the branch audit verdict can honestly move to no higher than `CONDITIONALLY SOLID`; `SOLID` requires the named live/device gates;
- all remaining unverified items are limited to production activation or real-device/manual gates that require Mason's authority or hardware.

The loop is **not** allowed to call itself complete merely because a draft PR exists.

## Mandatory stop points

Stop and ask Mason before:

- applying any migration to linked/live Supabase;
- changing Supabase Auth, RLS settings, Storage settings, schedules, secrets, or live data;
- deploying Edge Functions or the web app;
- sending real customer email/push;
- merging the draft PR or pushing `main`/a production branch;
- deleting or irreversibly rewriting data;
- accepting a product decision that materially expands scope beyond the nine findings.

Real iOS/Android installed-PWA and physical push receipt proof will be listed as a manual release gate if it cannot be automated with available hardware. It will not be falsely reported as complete.

## One-time Claude Fable review instructions

The reviewer is asked once, read-only, at `--model fable --effort low`. It must evaluate:

- whether the phase order has hidden dependencies;
- whether any loop step could leak data, weaken RLS, mutate production, or create false confidence;
- whether every July 15 finding has a real-path closure proof;
- whether the stop conditions preserve Mason's approval boundaries;
- the smallest actionable corrections needed before implementation.

The review output is saved beside this plan, actionable corrections are incorporated once, and the final plan is shown to Mason before implementation begins.
