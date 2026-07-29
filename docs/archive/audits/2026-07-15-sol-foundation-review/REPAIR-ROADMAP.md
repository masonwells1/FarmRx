# Repair and Release Roadmap

## Branch repair status

The code-repair phases for SOL-FND-001 through SOL-FND-009 are complete on `codex/farmrx-foundation-repair`. The complete local gate passes. The remaining roadmap is deliberately a release-validation sequence; none of these steps was authorized or performed by this loop.

## 1. Database review and non-production apply

- Review migrations `0036_optimistic_concurrency.sql` and `0037_scheduled_alert_foundation.sql`.
- Confirm live schema high-water and function signatures before applying.
- Apply first to a non-production Supabase project.
- Rerun 0036 stale-session, full-field child-set, receipt-replay, 0037 fixed-clock, and role/RLS probes through PostgREST.
- Confirm the revoked legacy Field/Harvest RPC grants cannot be used by `authenticated`.

**Exit:** all attacks pass against the deployed non-production database; no drift or unexpected policy change.

## 2. Edge Functions and scheduler activation

- Bundle and deploy `scheduled-alert-sweep`.
- Redeploy the revised `deliver-grain-alert`.
- Configure scheduler URL, scheduler secret, and anon key in the GitHub environment; configure required Supabase service/weather/push secrets without copying values into Git.
- Invoke the sweep twice at a fixed test time; verify one business event, one push-delivery row, no duplicate, and visible structured logs.
- Simulate one weather provider failure and one push-provider failure; verify other fields continue and the queue stays retryable.

**Exit:** app-closed Program, scoped marketing, and approved spray events are observed once in a test environment.

## 3. Preview web deployment and browser policy proof

- Deploy the branch to a preview.
- Inspect headers on login, every SPA route, assets, and `/market-quote-frame.html`.
- Confirm the authenticated parent permits only first-party scripts; the frame alone permits the hash-pinned bootstrap and TradingView.
- Repeat the hostile widget test against preview and verify Supabase, Open-Meteo, PWA, fonts, and quotes still work.

**Exit:** actual CDN headers match `vercel.json`; no blocked required request or broadened script trust.

## 4. Physical device and live-role matrix

- iOS and Android: install, load each core module, force-close, go offline, reopen, create/edit/delete, close/reopen, reconnect, and inspect canonical rows.
- Exercise quota/storage pressure and cache expiry.
- Revoke a membership/rep grant while the device is offline; reconnect and prove no queued write replays and readable caches disappear.
- Use owner, manager, worker, read-only, rep-off, rep-on, revoked rep, and stranger accounts.
- Receive one real app-closed push and one controlled email.

**Exit:** physical and live authorization behavior matches local proof.

## 5. Merge decision and production rollout

- Make the foundation workflow a required PR check.
- Review the final branch diff and migration/rollback plan.
- Merge only after steps 1-4 pass.
- Apply production migrations and deploy functions/web in the reviewed order.
- Run read-only production health, schema drift, security advisor, headers, scheduler logs, and queue health.
- Monitor before resuming major feature work.

**Exit:** verdict may move from **CONDITIONALLY SOLID** to **SOLID**.

## Top five actions in order

1. Non-production migration apply plus session/RLS attacks.
2. Edge Function deployment and scheduler/delivery proof.
3. Preview deployment and real response-header/hostile-frame proof.
4. Physical offline/push and live role/revocation matrix.
5. Required CI, reviewed merge, staged production rollout, and post-deploy health.

## Feature guidance

Do not start another major module until this roadmap passes. Small isolated fixes may continue on separate branches, but they should not widen the repair PR or bypass its release gates.
