# Test and Proof Gaps

## What the current green gates actually prove

- **Forced TypeScript:** the project and references type-check from a forced rebuild.
- **28 regression scripts:** substantial pure/business-math coverage plus repository mapping, validation, operation-ID replay, queue parsing, durability helpers, weather freshness, submit locks, and targeted prior repairs.
- **Production build:** React/Vite/PWA compiles; the service worker is generated and precaches the shell. The main JavaScript bundle is large (1,093.15 kB, 287.59 kB gzip), but the build succeeds.
- **Disposable databases:** all 35 migrations apply on fresh Postgres; 0033-0035 behavioral probes pass when run in isolation.
- **Fresh role matrix:** database helper/RLS behavior matches the documented manager/worker/read-only/rep/stranger model.
- **Authenticated browser smoke:** every major route loaded with HTTP 200 and no visible page alert.
- **Dependency audit:** `npm audit` reported zero known vulnerabilities, including dev dependencies.

## Where the current tests create false confidence

`npm run regression` sounds end-to-end but is not. It invokes TypeScript scripts directly. Supabase repository suites inject fake gateways; they do not start Supabase, authenticate, cross PostgREST, exercise RLS, invoke a deployed Edge Function, upload a photo, or render React. There is no Vitest/Jest/React Testing Library/Playwright dependency, no `.github` CI workflow, and no local Supabase config/reset command.

Concrete counterexample from this review: TypeScript, all 28 regressions, and build passed, while a real authenticated online-load/offline-reload failed and a normal 390px mobile viewport showed overlapping navigation.

## Missing proof by attack scenario

| Scenario | Current proof | Gap |
|---|---|---|
| Double click / double submit | Submit-lock regression and many handler locks | No built-browser double-tap matrix across every write control |
| Two tabs editing one record | Some queues use Web Locks/leases | No real two-tab test; four queue families lack cross-tab locking; no row-version conflicts for many records |
| Stale save after another update | Profitability matrix expected-snapshot probe | Fields, Grain mutable rows, budget/cost/allocation, equipment/tasks, and several RPC aggregates are not covered |
| Offline create/edit/delete then reconnect | Fake repository/queue scripts | Real deployed reload fails; no close/reopen/IndexedDB/context proof; no mobile-device replay proof |
| Request commits but response is missed | Operation IDs and focused durability tests; strong 0033/0034 RPCs | Not exercised through a real transport for every write/delete; edge email remains best-effort |
| Retry after partial failure | Queue parking/needs-attention tests | No two-tab replay, browser crash, storage quota, or Edge Function partial-delivery drill |
| Wrong farm/user/role | Static RLS plus fresh disposable role matrix | No current live two-account/two-farm/revocation/storage pass |
| Null/negative/zero/precision/large values | Good math/validation/check-constraint coverage; 0033 negative/capacity probes | No property/fuzz tests across every form/RPC; very large browser input/display not broadly checked |
| Deleted parent with dependents | FK review, append-only/correction patterns, service reversal probe | No full deletion matrix covering every table/view/storage object and UI recovery |
| Missing migration/schema drift | Fresh application of local 0001-0035 | Live migration registry blocked because checkout is not linked; no CI drift comparison |
| Tests green while repository path is broken | Demonstrated by this audit | Release pipeline lacks real browser, database, edge, and live-smoke gates |

## Live/current-state proof still needed

1. Link or provide a safe read-only Supabase management path, then compare live migration versions, function signatures, RLS policies, bucket configuration, security advisors, Auth settings, scheduled functions, and Edge Function versions to Git.
2. Prove signup is disabled or intentionally controlled; prove password/leaked-password settings appropriate for the plan.
3. Use two farms and at least owner, manager, worker, read-only, rep, revoked rep, and stranger accounts in a live read-only isolation matrix.
4. Install the PWA on real iOS and Android devices; open modules online, force close, go offline, reopen, create/edit/delete, reconnect, and inspect exact canonical rows.
5. Subscribe a real device, close the app, generate a due Program/marketing transition, and prove one push delivery plus monitored failure/retry behavior.
6. Send a Grain email to a production-domain recipient and verify authentication/domain readiness without exposing provider secrets.
7. Exercise scouting photo upload, cross-farm path rejection, offline note behavior, deletion, and cleanup retry against a disposable or dedicated test farm.

## Recommended release gate

Before feature work resumes, make one command/CI workflow run:

1. forced TypeScript;
2. current fast regressions;
3. production build;
4. fresh Supabase migration reset plus RLS/role tests;
5. disposable 0033, 0034, and 0035 suites;
6. Playwright desktop/mobile route smoke;
7. offline reload/write/replay and two-tab queue tests;
8. two-session stale-write conflict tests;
9. production read-only health/schema-drift smoke.

Do not make a live write, deployment, or migration part of the ordinary audit command.
