# Farm Rx foundation repair

## Summary

- closes the branch-level code and local-proof portion of SOL-FND-001 through SOL-FND-009
- adds explicit multi-farm/session context, user-and-farm-scoped offline workspaces, cross-tab-safe queues, and stale-write conflict protection
- isolates the TradingView widget behind an opaque sandbox with route-specific CSP
- adds a repository-owned scheduled alert evaluator and service-role-only database surface
- repairs mobile navigation and replaces false-confidence checks with production-build browser, disposable database, RLS, static, and mutation gates

## Verification

- `npx tsc -b --force` — PASS
- `npm run regression` — PASS
- `npm run build` — PASS
- `npm audit --audit-level=high` — PASS, zero vulnerabilities
- migrations 0033-0037 disposable proofs — PASS
- fresh manager/worker/read-only/rep/stranger RLS matrix — PASS
- four controlled foundation mutations — PASS, all four detected
- Playwright production-build suite — PASS, 22/22 across desktop and phone
- combined `scripts/verify-foundation.ps1` — `Farm Rx foundation gate: PASS`
- changed/untracked file scan — zero credential candidates; the only secret-like match is a deliberately fake Playwright token fixture

## Verdict and release gates

Branch verdict: **CONDITIONALLY SOLID**.

This draft does not apply migrations, change live Supabase settings/data, deploy Edge Functions or the web app, send customer email/push, merge, or push `main`. Before release, review and apply migrations 0036-0037 in a non-production environment, prove the Edge scheduler and deployed headers, run physical installed-PWA/offline/storage-pressure tests, verify real-device push delivery, and complete a final read-only production smoke.

The durable audit, finding dispositions, proof gaps, and release order are in `docs/audits/2026-07-15-sol-foundation-review/`.
