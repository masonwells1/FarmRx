# Sol serialized implementation slice: scheduler, weather, and push semantics

You are the only source-code writer for this slice. Work in `C:\FarmRx` on the existing branch and dirty worktree. Preserve every pre-existing change. Do not stage, commit, push, deploy, create or mutate Supabase/Vercel/GitHub resources, call a real email/push/weather provider, or query business rows. Local/disposable PostgreSQL and deterministic local tests are allowed.

Read the current source and requirements first, especially:

- `CLAUDE.md`
- `docs/farm-rx-handoff.md`
- `docs/GOAL.md`
- `docs/audits/2026-07-15-sol-foundation-review/AUTONOMOUS-REPAIR-LOOP.md`
- `docs/audits/2026-07-15-sol-foundation-review/REPAIR-ROADMAP.md`
- `docs/audits/2026-07-15-sol-foundation-review/next-session-evidence/SOL-IMPLEMENTATION-REPORT.md`
- migrations `0035` through the local uncommitted `0038`
- `supabase/functions/scheduled-alert-sweep/index.ts`
- `supabase/functions/send-push/index.ts`
- `supabase/functions/_shared/scheduledAlertLogic.ts` and its regression
- `src/sw.ts`
- `scripts/verify-0037-disposable.ps1`
- `scripts/verify-foundation.ps1`

The P0 modern-claims repair in migration `0038` and its disposable tests already pass under PostgreSQL 17. Do not rewrite or weaken it. Implement the smallest safe forward repair after `0038` for the remaining release blockers below.

## Required outcomes

1. **Per-farm database failure containment.** One farm's Program/marketing database error must not roll back or prevent other farms from being processed. Preserve the global concurrency guard and idempotency. Return an honest failure count/identity suitable for logs without exposing secrets. Prove this in disposable PostgreSQL 17 by forcing one farm to fail while a second farm still completes. Use a new forward migration; do not edit historical migrations.

2. **Deterministic Edge orchestration seam.** Make the scheduled Edge path testable with an injected clock, fetch/provider functions, and database adapter while keeping the deployed entry point thin and secure. Prove fixed-clock replay/idempotency locally. A weather/provider failure for one field must be counted and isolated so other fields continue. A final push-sweep provider failure must fail the request honestly rather than report success. Never put a test bypass or injectable secret in the deployed HTTP surface.

3. **Weather must fail closed.** A scheduled `good to spray` transition may be recorded only when all required current and next-four-hour data is finite, aligned, and fresh. Missing/null precipitation probability is uncertainty and therefore non-good. Stale observations, materially future observations, malformed HTTP-200 bodies, missing/misaligned hourly arrays, freezing/extreme-cold conditions, current rain, imminent rain/probability, unsafe wind/gusts/heat/weather codes, timeouts, and provider non-OK responses must never produce `p_is_good=true`. Keep the product-label/applicator disclaimer behavior. Define and test explicit conservative freshness/future/cold thresholds.

4. **Partial multi-device push retry without resending successful targets.** The existing one-row-per-notification delivery is insufficient. Add durable per-subscription target state in the new forward migration and narrow server-only RPCs/ACLs as needed. If device A succeeds and device B has a transient provider failure, the retry must skip A and retry B. Handle 404/410 subscriptions without blocking completion. Protect concurrent caller/sweep races with an atomic claim, not a read-then-send race. Do not broaden authenticated/anon table or function access. Include `notification_id` in the payload and use a stable service-worker notification tag as a final user-visible dedupe guard. Do not claim mathematical exactly-once across an ambiguous network timeout; document that residual honestly.

5. **Proof integration.** Add focused pure regressions that run under `npm run regression`, add a PostgreSQL 17 disposable proof for the new migration, and wire it into `scripts/verify-foundation.ps1`. Tests must include the exact partial multi-device sequence, stale/future/malformed/missing/misaligned/imminent-rain/cold weather cases, per-field continuation, fixed clock, and one-farm-fails/other-farm-succeeds. Do not weaken existing assertions.

## Engineering constraints

- Keep authorization based on modern `request.jwt.claims` via `public.request_uses_service_role()`; modern claims remain authoritative and malformed claims fail closed.
- Security-definer functions need fixed safe `search_path`, least-privilege grants, and no public/anon/authenticated execution unless already required by the business contract.
- Do not add catalog-table updates or dynamic system-catalog function rewrites.
- Do not store raw provider secrets in tables, logs, tests, or artifacts.
- Avoid broad refactors. Keep Edge entry points readable and production-shaped.
- Use `apply_patch` for edits.
- If Docker is invisible inside your sandbox, still write the proof but label execution blocked; the root orchestrator will run it from the unrestricted workspace.

## Verification and report

Run the focused local regressions, TypeScript/build checks, `git diff --check`, and disposable proof if available. Record exact commands and honest results by appending a new serialized-slice section to:

`docs/audits/2026-07-15-sol-foundation-review/next-session-evidence/SOL-IMPLEMENTATION-REPORT.md`

List every changed file, before/after failure semantics, ACL surface, residual risks, and confirm no external mutations/stage/commit/push. Stop after this slice; do not start CSP or offline-queue work.
