# Command Log

**Date:** 2026-07-15
**Working directory:** `C:\FarmRx`
**Branch:** `codex/farmrx-foundation-repair`
**Authority used:** local edits/checks, disposable Docker databases, browser tests, one non-production branch push and draft PR. No live migration, setting/data change, deployment, merge, main/production push, customer email, or customer push.

## Original audit baseline

| Command | Result |
|---|---|
| `npx tsc -b --force` | PASS, exit 0 |
| `npm run regression` | PASS, 28 configured TypeScript scripts |
| `npm run build` | PASS; PWA worker generated; large-chunk warning preserved |
| `npm audit` | PASS, zero known vulnerabilities |
| `scripts/verify-0033-disposable.ps1` attempts 1-2 | FAIL: `FATAL: the database system is shutting down`; `Disposable psql failed.` |
| `scripts/verify-0034-disposable.ps1` | PASS |
| `scripts/verify-0035-disposable.ps1` | PASS |

The disposable readiness scripts were repaired to wait for the final PostgreSQL PID 1 server. 0033 then passed.

## Repair-loop failures retained

| Phase / command | Exact failure summary | Resolution |
|---|---|---|
| First authenticated browser group | three tests timed out; trace showed `Minified React error #185` | stable external-store snapshot |
| Physical offline reopen | remained on `Loading fields...`; PostgREST retry backoff after `ERR_INTERNET_DISCONNECTED` | disabled hidden read retry so verified IndexedDB fallback is prompt |
| Offline Add field | `Farm Rx could not save this field right now` | blank placeholder IDs normalized to UUIDs; regression added |
| Phase 2 regression | `Farmer-facing text below the 18px contract: ".farm-switcher..."` | all new farmer-facing text raised to 18px |
| 0036 disposable attempt 1 | duplicate farm membership from bootstrap trigger | seed changed to `ON CONFLICT` |
| 0036 disposable attempt 2 | Session A harvest used the pre-field-save crop timestamp | harvest snapshot refreshed after the field proof |
| 0037 disposable attempt 1 | `INSERT has more target columns than expressions` for Fields seed | operating entity value added |
| First TradingView focused browser test | Delayed quotes absent because fixture had no production estimate | production estimate added to the production-shaped fixture |
| Second TradingView focused browser test | unexpected `operational_integrity_capability_probe` and `/auth/v1/user` requests | explicit fixture responses added; no wildcard hidden |
| Focused queue command | `tsx: The term 'tsx' is not recognized` | rerun correctly as `npx tsx ...`; PASS |
| Edge local serve | `supabase start is not running.` | retained as release proof gap; no local stack/config fabricated |
| Edge serve variant | workstation hook blocked `--no-verify-jwt` | not bypassed |
| `vercel build` | `No project settings found locally. Run pull to retrieve them, or re-run with --yes to pull automatically.` | retained; no settings/env pull performed |

No failing product test was weakened, skipped, deleted, or reclassified to obtain green.

## Focused repair proof

- `scripts/verify-0036-disposable.ps1` -> `PROBE 0036 optimistic concurrency: PASS`.
  - legacy Field/Harvest RPC grants revoked;
  - Session A save wins;
  - Session B stale save receives `PT409/FARM_RX_STALE_WRITE`;
  - missed-response retry returns the prior receipt;
  - direct conditional update preserves Session A;
  - stale full-field bundle cannot erase a later crop assignment.
- `scripts/verify-0037-disposable.ps1` -> `PROBE 0037 scheduled alert foundation: PASS`.
  - two intended marketing events, one Program event;
  - stale bid suppressed;
  - entity-scoped 10% result not contaminated by opposite entity;
  - second sweep creates zero duplicates;
  - spray false/false/true/true creates exactly one event;
  - each notification creates one push-delivery row;
  - scheduler functions are service-role-only.
- `node scripts/foundation-static-guards.mjs` -> PASS.
- `node scripts/verify-foundation-mutations.mjs` -> PASS; route, queue lock, Field RLS scope, and private-cache user scope mutations all detected.
- Focused TradingView/security Playwright -> 4/4 PASS on desktop and phone after the dedicated frame/CSP split.
- Focused mobile Playwright -> 6/6 PASS across projects and security checks.

## Final complete foundation gate

Command:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-foundation.ps1
```

Result: **PASS**

| Gate | Final result |
|---|---|
| `npx tsc -b --force` | PASS |
| `npm run regression` | PASS, including optimistic-save, scheduler logic, and queue transaction scripts |
| `npm run build` | PASS; 206 modules; main JS 1,112.08 kB / 292.85 kB gzip; warning preserved |
| PWA worker | PASS; 8 precache entries / 1,207.42 KiB |
| `npm audit --audit-level=high` | PASS, zero vulnerabilities |
| Static foundation guards | PASS |
| Controlled mutation drill | PASS, 4/4 detected |
| Disposable 0033 | PASS |
| Disposable 0034 | PASS |
| Disposable 0035 | PASS |
| Disposable 0036 | PASS |
| Disposable 0037 | PASS |
| Fresh RLS role matrix | PASS |
| `npm run test:e2e` | PASS, 22/22 |
| Combined command | `Farm Rx foundation gate: PASS` |

The adversarial diff review strengthened 0036 child-set comparison and split the market frame CSP from the authenticated parent. Focused TypeScript, queue, 0036, static/mutation, and 4/4 browser security proofs passed. The complete foundation gate was then rerun before commit and finished with `Farm Rx foundation gate: PASS`.

## Scope and secret checks

- `git diff --check`: PASS; only line-ending warnings were emitted.
- Secret-like scan across every changed/untracked file: zero credential candidates. One deliberately fake refresh-token marker in the Playwright fixture was classified as test data by filename, key, length, and test marker without printing its value.
- `npm audit --audit-level=high`: zero vulnerabilities.
- Supabase changelog refresh: HTTP 200. The April 2026 Data API exposure change was checked against the new RPCs/tables; migrations 0036-0037 explicitly revoke/grant callable surfaces, and the private scheduler table has all Data API roles revoked.
- No `.env` file was read into artifacts, changed, staged, or committed.
- Official configuration references consulted: TradingView widget documentation and Vercel `vercel.json` source/negative-lookahead documentation.

## Deliberate stop boundary

Not performed: linked migration apply, live data write, Supabase setting change, Edge/web deployment, secret configuration, real email/push, merge, `main` push, or production-branch push.

## Publication

- committed implementation and proof as `3edab12` (`Harden Farm Rx foundation workflows`)
- pushed only `codex/farmrx-foundation-repair`
- opened exactly one draft PR: <https://github.com/masonwells1/FarmRx/pull/1>
