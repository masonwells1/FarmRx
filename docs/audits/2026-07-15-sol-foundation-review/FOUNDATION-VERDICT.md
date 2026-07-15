# Farm Rx Foundation Verdict

**Review date:** 2026-07-15  
**Reviewer:** Sol  
**Verdict:** **NOT SOLID**

Farm Rx has a materially stronger database foundation than its current verdict suggests: all required build gates pass, all 35 migrations apply to fresh Postgres, the hardened Grain/Profitability/operational probes pass, and a fresh role matrix proves the intended manager/worker/read-only/rep/stranger boundaries. The deployed authenticated app also opens every major module successfully.

The foundation is not ready for broad feature expansion because the offline promise fails in the deployed app, multi-farm/rep accounts are rejected by design, several local queues are unsafe across tabs, important mutable records still accept stale last-write-wins saves, and a third-party market widget executes JavaScript inside the authenticated Farm Rx origin without a Content Security Policy. Green regressions do not exercise any of those paths.

## Decision in plain English

Do **not** keep stacking major features on this base yet. Pause feature expansion long enough to repair and prove the P1 items. Existing features can be demonstrated with a connection, but the app should not be represented as field-ready offline or ready for multi-customer Crop RX rep use.

## Top risks

1. **Offline operation is not dependable.** After loading Fields online, cutting the network and reloading the deployed PWA produced only: “We could not reach Farm Rx. Check your signal and try again.” Queue setup also calls live Auth and `farms` endpoints before it can append an offline write.
2. **A user with access to two farms cannot use any module.** `currentFarmId()` explicitly throws when RLS returns more than one farm. That breaks the natural Crop RX rep workflow as soon as a rep receives a second customer grant.
3. **Some queues can lose or replay work during two-tab contention.** Inventory, Equipment/Tasks, Scouting, and Notifications lack the cross-tab lock used by Fields, Grain, Profitability, Programs, Harvest, and Field Log.
4. **Stale saves can silently overwrite newer farm and financial data.** Many canonical writes are ID-based upserts with no row version or expected timestamp.
5. **The authenticated browser trusts third-party JavaScript too broadly.** TradingView’s script runs as first-party code while Supabase session tokens persist in `localStorage`; production has no CSP header.
6. **Alerts are not a dependable app-closed service.** Marketing and legacy Grain alerts are explicitly check-on-open. Spray alerts are component-lifecycle transitions. The repository contains no active scheduler configuration, and an external Supabase schedule could not be verified from this checkout.
7. **The green test command is narrower than its name implies.** It is 28 TypeScript scripts using pure math and fake gateways; there is no component runner, browser E2E suite, CI workflow, migration reset gate, or live RLS matrix in `npm run regression`.

## What is already solid

- `npx tsc -b --force`, `npm run regression`, and `npm run build` all pass.
- All 35 migrations apply successfully to a disposable PostgreSQL 16 database.
- Disposable 0033, 0034, and 0035 behavior suites pass: bin capacity/nonnegative/commodity rules, replay idempotency, price-leg finalization, contract delivery limits, profitability matrix compare-and-swap, durable budget creation/copy, push claim/backoff, Program-task authority, cross-farm alert rejection, and service-log reversal.
- A fresh role matrix passed:
  - manager: read/edit/manage/private-financial access;
  - worker: read/edit, but no manage/private-financial access by default;
  - read-only: read only, no financial access by default;
  - named rep: no access until both farm sharing and the explicit grant are active; after that, read/private-financial access but no edits;
  - stranger: no access.
- Tenant IDs are generally server-derived or rechecked, RLS is pervasive, Security Definer functions use fixed search paths, scouting storage is private/path-scoped, and sensitive financial reads use the stricter privacy helper.
- The most dangerous Grain actions use strong server paths: append-only bin movement, immutable price-leg finalization, atomic firm-offer fill, and delivery recording.
- Profitability matrix replacement has an expected-snapshot conflict guard. Inventory receipts/applications are bundled in RPCs. Program operations use receipt-style operation IDs and server-owned task transitions.
- The live authenticated browser opened Fields, Grain, Inventory, Profitability, Equipment, Tasks, Weather, Field Log, Scouting, Harvest, Programs, and Alerts with HTTP 200 and no visible page alert.
- The manifest and service worker are registered, the page is service-worker controlled, and the app shell itself is available offline.

## What remains unverified

- Current live migration registry and schema drift. `supabase migration list --linked` was blocked because this checkout is not linked.
- Live Supabase security-advisor state, public-signup setting, leaked-password protection, scheduled functions/cron, and edge-function secret readiness.
- A real two-user/two-farm live isolation pass, including revoked membership and rep access.
- Real device PWA install, iOS/Android offline write/reopen/replay, storage pressure, and conflict behavior.
- Real phone push with a subscribed device while the app is closed; Resend delivery to production customer domains.
- Live write proofs were deliberately not performed in this review.

## Top five repair actions

1. **Build real offline state:** persist the selected farm/user context and canonical workspaces in IndexedDB, let queues resolve context without network, project every queued operation into the UI, and prove close/reopen/offline/reconnect.
2. **Make all writes concurrency-safe:** use one cross-tab queue lock everywhere and add server-side row versions/expected timestamps for mutable records; show a conflict instead of overwriting.
3. **Close the browser privacy hole:** isolate TradingView in a sandboxed origin and add CSP, Referrer-Policy, Permissions-Policy, and related production headers.
4. **Add an explicit farm selector:** persist a selected accessible farm, revalidate it through RLS, and prove owner/employee/rep behavior across at least two farms.
5. **Make alerts and proof operational:** add a monitored server scheduler and shared canonical alert evaluator, then put browser E2E, role/RLS, disposable migrations, mobile screenshots, and offline/two-tab tests into CI.

The detailed evidence is in [FINDINGS.md](./FINDINGS.md), [WORKFLOW-COVERAGE-MATRIX.md](./WORKFLOW-COVERAGE-MATRIX.md), and [COMMAND-LOG.md](./COMMAND-LOG.md).
