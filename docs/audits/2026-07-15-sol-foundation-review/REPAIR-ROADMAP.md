# Repair Roadmap

## Recommendation

Freeze major feature expansion. Small isolated bug fixes are reasonable, but the following foundation sequence should be completed and proved before adding another large module.

## Phase 1 — Make offline real (highest priority)

**Closes:** SOL-FND-001 and part of SOL-FND-003.

- Persist authenticated user identity, the explicit selected farm, and per-module canonical snapshots in IndexedDB.
- Let a queue open from validated cached context while offline; revalidate membership before replay.
- Project queued create/edit/delete for every operation, not only inventory products.
- Clear or quarantine farm caches and queued work on sign-out, revocation, or farm switch.
- Add an honest data-age indicator and a recoverable “needs attention” path.

**Exit proof:** close/reopen with no network; every core module shows cached data; queued writes survive another close/reopen; reconnect produces exactly one canonical effect; revoked access never replays.

## Phase 2 — Standardize concurrency and conflict control

**Closes:** SOL-FND-003 and SOL-FND-004.

- Extract the proven Web Locks + renewable localStorage lease into one shared queue transaction primitive.
- Apply it to Inventory, Equipment/Tasks, Scouting, and Notifications for append, park, remove, and replay.
- Add row versions or expected timestamps to Fields, Grain mutable records, Profitability budgets/costs/allocations, Equipment/Tasks, Harvest, and other mutable aggregates.
- Return stable conflict codes and build a reload/compare/merge UI.
- Keep append-only ledgers, operation receipts, and immutable finalization paths unchanged.

**Exit proof:** two-tab barrier tests retain every queued operation once; two authenticated stale editors cannot overwrite one another; offline stale replay becomes an actionable conflict.

## Phase 3 — Close browser privacy and delivery hardening

**Closes:** SOL-FND-005.

- Move TradingView execution into a sandboxed isolated origin/document.
- Add a production CSP using nonces/hashes and explicit `connect-src`, `frame-src`, `img-src`, and `frame-ancestors`.
- Add Referrer-Policy, Permissions-Policy, `nosniff`, and an intentional framing policy.
- Inventory every third-party network request and document the data boundary.

**Exit proof:** a controlled hostile widget script cannot read the parent DOM/localStorage; headers are present on live routes; all required Supabase, weather, font, and widget paths still work.

## Phase 4 — Support the authorization model in the app

**Closes:** SOL-FND-002.

- Add an explicit accessible-farm list and selected-farm state.
- Show the active farm prominently and require a safe switch decision if work is pending.
- Revalidate RLS access at startup, switch, reconnect, and replay.
- Keep caches, push links, storage paths, and queue keys isolated by user+farm.

**Exit proof:** two-farm owner and two-grant rep can switch safely; worker/read-only controls match permissions; revocation removes access; stranger sees nothing.

## Phase 5 — Make alerts canonical and operational

**Closes:** SOL-FND-006 and SOL-FND-008.

- Create one server-side evaluator shared by in-app, email, and push paths.
- Enforce farm/year/commodity/entity/enterprise scope and explicit quote freshness/delivery semantics.
- Add a monitored scheduled Edge Function for due Programs, marketing transitions, delivery queue drain, and any approved weather evaluator.
- Store evaluation/delivery receipts so retries are idempotent and explainable.

**Exit proof:** with every client closed, a scheduled transition produces exactly one correctly scoped notification and one delivery; stale bids and other-entity data never trigger it.

## Phase 6 — Replace green-by-assumption with a release gate

**Closes:** SOL-FND-007 and SOL-FND-009.

- Put the fast regressions, fresh migrations, role matrix, 0033-0035 probes, Playwright flows, offline/two-tab/conflict tests, and mobile screenshots in CI.
- Redesign the mobile bottom navigation before taking baseline screenshots.
- Add a read-only production drift/health job; never let it mutate live state.

**Exit proof:** one documented command/CI workflow proves the full story and fails on deliberate offline, RLS, stale-write, or responsive regressions.

## Top five actions in execution order

1. Persist offline context/data and prove close/reopen/replay.
2. Add shared cross-tab queue locking and server conflict versions.
3. Isolate TradingView and ship restrictive security headers.
4. Add and prove the multi-farm selector/rep workflow.
5. Build canonical scheduled alerts and make the complete browser/database proof gate mandatory.
