# Farm Rx Foundation Verdict

**Review date:** 2026-07-15
**Reviewer:** Sol
**Original verdict:** **NOT SOLID**
**Post-repair branch verdict:** **CONDITIONALLY SOLID**

The July 15 review found seven P1 and two P2 foundation defects. The repair loop closed the branch-level code and local-proof portion of all nine findings on `codex/farmrx-foundation-repair`. The complete foundation gate now passes forced TypeScript, the regression suite, production build, dependency audit, all migrations through 0037, disposable behavior probes, a fresh role/RLS matrix, four deliberate gate mutations, and 22 production-build browser tests across desktop and phone.

This is not a production release verdict. Migrations 0036-0037, the scheduled Edge Function, GitHub scheduler secrets, revised Grain delivery function, and web security headers exist only on the repair branch. No live migration, function deployment, setting change, data write, web deployment, or merge occurred.

## Decision in plain English

Farm Rx is now a usable foundation for controlled work, but it is not wise to resume major feature expansion until the branch is reviewed and the five release actions below are completed. The remaining risk is concentrated in deployment/live configuration and physical-device proof, not in a known unguarded P1 code path on this branch.

## What the branch now proves

- A previously loaded farm reopens offline from a user+farm+module IndexedDB cache; offline field creation survives reload; expired caches fail closed; sign-out clears readable private workspaces.
- Multi-farm accounts receive an explicit picker and safe farm switcher. Browser proof keeps two farm caches and requests isolated.
- Every queue family uses one Web Locks/renewable-lease transaction primitive and publishes cross-tab changes. A two-page test and a 40-concurrent-append regression preserve all operations.
- Mutable Fields, Harvest, Grain, Profitability, Inventory products, Equipment, intervals, and tasks use expected versions. Disposable sessions prove stale saves cannot overwrite, lost-response retries are idempotent, and a stale full-field bundle cannot erase a crop added by another session.
- TradingView runs only in a sandboxed opaque frame. The authenticated parent CSP allows first-party scripts only; the isolated frame has its own hash-pinned bootstrap and TradingView allowlist. Hostile script tests cannot reach parent DOM/session storage.
- A server-owned scheduled evaluator handles farm-local Program reminders, fresh/scoped marketing transitions, spray false→true transitions, and durable push-queue creation. Replays create no duplicate business event.
- Client and email-delivery alert rechecks now use the same two-day bid freshness rule and exact entity/enterprise scope.
- Mobile navigation uses four primary destinations plus an accessible More surface. All destinations remain reachable with 48px targets and no overlap at 320, 375, 390, and 430 pixels.
- CI and `npm run verify:foundation` exercise the real database/browser paths. Controlled route, queue-lock, RLS, and private-cache mutations all turn the gate red.

## Remaining conditions

1. Migrations 0036 and 0037 have not been applied to linked Supabase.
2. `scheduled-alert-sweep` has not been deployed, its scheduler secrets are not configured, and the GitHub schedule has not run against a test environment.
3. The revised `deliver-grain-alert`, web build, CSP, and response headers are not deployed or live-verified.
4. Real iOS/Android installed-PWA behavior, storage pressure, access revocation while offline, and physical app-closed push receipt remain unverified.
5. Live Auth settings, security advisors, schema drift, bucket settings, and a real owner/worker/read-only/rep/revoked-rep/stranger matrix remain unverified because this checkout is not linked.
6. The local Edge runtime could not be bundled/invoked: Deno is unavailable, `supabase functions serve` reported that the local Supabase stack is not running, and `vercel build` reported missing local project settings. Database and browser boundaries are proven; deployment-runtime proof remains a release gate.

## Top five release actions

1. Review and apply migrations 0036-0037 in a non-production Supabase environment; rerun the disposable/session/RLS attacks against that environment.
2. Deploy `scheduled-alert-sweep`, configure the three scheduler secrets, run it twice with a fixed test clock, and verify one Program/marketing/spray event plus one durable delivery.
3. Redeploy `deliver-grain-alert` and the web app; verify CSP/security headers and the isolated market frame on every SPA route.
4. Run a physical-device matrix: iOS and Android install, online load, force-close, offline reopen/create/edit/delete, reconnect, storage pressure, and a real app-closed push.
5. Run read-only live drift/security checks and the real multi-account isolation matrix, then review and merge only if all results remain green.

## Recommendation to Mason

Do not add another major module yet. Small isolated fixes are reasonable on separate branches, but finish the release actions above before feature expansion. If they pass, the foundation can move from **CONDITIONALLY SOLID** to **SOLID**.

Detailed evidence is in [FINDINGS.md](./FINDINGS.md), [WORKFLOW-COVERAGE-MATRIX.md](./WORKFLOW-COVERAGE-MATRIX.md), [TEST-AND-PROOF-GAPS.md](./TEST-AND-PROOF-GAPS.md), and [COMMAND-LOG.md](./COMMAND-LOG.md).
