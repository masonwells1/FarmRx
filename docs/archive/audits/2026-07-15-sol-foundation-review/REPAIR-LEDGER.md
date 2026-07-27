# Farm Rx Foundation Repair Ledger

**Branch:** `codex/farmrx-foundation-repair`
**Started:** 2026-07-15
**Authority:** local implementation, verification, one non-production branch push, and one draft PR; no live mutation/deploy/merge
**Plan:** `AUTONOMOUS-REPAIR-LOOP.md`

## Status

| Phase | State | Findings |
|---|---|---|
| 0 — isolate/baseline/inventory | COMPLETE | setup |
| 1 — proof harness | COMPLETE | SOL-FND-007 |
| 2 — farm/session/offline spine | COMPLETE; installed-device proof remains a release gate | SOL-FND-001, SOL-FND-002 |
| 3 — queue/stale-write safety | COMPLETE; migration 0036 remains a release gate | SOL-FND-003, SOL-FND-004 |
| 4 — browser isolation/headers | COMPLETE; deployed-header proof remains | SOL-FND-005 |
| 5 — canonical scheduled alerts | COMPLETE; Edge/scheduler/device activation remains | SOL-FND-006, SOL-FND-008 |
| 6 — mobile navigation | COMPLETE | SOL-FND-009 |
| 7 — reconciliation/release gate/PR | COMPLETE — final full gate green; branch pushed; draft PR #1 opened | all |

## Phase 0 evidence

### Starting state

- Created `codex/farmrx-foundation-repair` from `main`.
- Starting branch changes were limited to the reviewed loop plan and its one-time Fable review artifact.
- No live service, database, deployment, secret, or production setting was changed.

### Baseline commands

| Command | Result | Evidence summary |
|---|---|---|
| `npx tsc -b --force` | PASS | exit 0; no diagnostics |
| `npm run regression` | PASS | all 28 TypeScript regression scripts passed |
| `npm run build` | PASS | Vite/PWA build passed; 1,093.15 kB main JS; existing chunk warning |
| `npm audit --json` | PASS | 0 vulnerabilities across 420 dependencies |
| `scripts/verify-0033-disposable.ps1` attempt 1 | FAIL | `FATAL: the database system is shutting down`; script reported `Disposable psql failed.` |
| `scripts/verify-0033-disposable.ps1` attempt 2 | FAIL | same exact startup/shutdown race |
| manual disposable Postgres diagnostic | EVIDENCE | PostgreSQL's temporary init server accepted `pg_isready`, then performed its expected fast shutdown/restart; the script can race between those states |
| `scripts/verify-0034-disposable.ps1` | PASS | disposable migration suite passed |
| `scripts/verify-0035-disposable.ps1` | PASS | disposable scheduler/integrity suite passed |

The 0033 failure is retained as a real release-harness defect, not hidden. Phase 1 will make disposable readiness stable and rerun 0033 before advancing.

## Failure policy record

No test has been weakened, skipped, deleted, or reclassified. The loop will keep exact failures here and rerun the full owning gate after each repair.

## Change log

| Slice | Files | Proof | State |
|---|---|---|---|
| Reviewed autonomous loop | `AUTONOMOUS-REPAIR-LOOP.md`, `FABLE-PLAN-REVIEW.md` | one read-only Claude Fable review; corrections incorporated | COMPLETE |
| Phase 0 baseline | this ledger | commands above | COMPLETE |
| Mutation/storage inventory | `FOUNDATION-MUTATION-INVENTORY.md` | identity, 11 queue surfaces, mutable aggregates, browser storage, and alert paths enumerated | COMPLETE |
| Disposable readiness repair | `scripts/verify-0033-disposable.ps1`, `verify-0034-disposable.ps1`, `verify-0035-disposable.ps1` | waits for the final PID 1 PostgreSQL server; 0033 rerun passed | COMPLETE |
| Built-browser/CI gate | `playwright.config.ts`, `tests/e2e/foundation-shell.spec.ts`, `.github/workflows/foundation.yml`, `scripts/verify-foundation.ps1` | desktop+phone login, service-worker offline shell, mobile overflow; CI/release command wired | COMPLETE |
| Fresh RLS matrix | `scripts/verify-rls-role-matrix.ps1` | manager, worker, read-only, rep off/on, stranger against every migration | COMPLETE |
| Combined foundation gate | all Phase 1 files | first run exposed PowerShell/native-stderr readiness bug; fixed without weakening proof; second run PASS including 6 browser tests | COMPLETE |
| Explicit farm/session context | `src/auth/farmContext.ts`, `FarmAccessContext.tsx`, `AuthProvider.tsx`, `App.tsx`, `data/index.ts` | two-farm chooser and switcher, selected-farm persistence, pending-work confirmation, access revalidation, cache removal on revoked access/sign-out | COMPLETE |
| Durable offline workspaces | `src/data/workspaceCache.ts` and 10 queued repositories | user+farm+module IndexedDB keys; 24-hour financial and 7-day operational windows; pending projections for all cache-backed modules | COMPLETE |
| Phase 2 browser attacks | `tests/e2e/foundation-shell.spec.ts` | 14/14 desktop+phone: multi-farm choice/switch/isolation, PWA cached reopen, offline field create+reload, sign-out clearing, expired-cache fail-closed | COMPLETE |

## Phase 2 failure and repair record

| Attempt | Exact failure summary | Root cause | Repair and rerun |
|---|---|---|---|
| Authenticated browser proof 1 | three tests timed out waiting for `North Forty`; trace showed `Minified React error #185` | `getWorkspaceCacheNotices()` returned a new array on every external-store read, causing a React maximum-update loop | stable cached snapshot added; authenticated shell rendered |
| Physical offline reopen | stayed on `Loading fields...`; trace showed PostgREST `x-retry-count` attempts after `ERR_INTERNET_DISCONNECTED` | Supabase/PostgREST read retry backoff delayed the IndexedDB fallback for about seven seconds | disabled PostgREST GET retries for this offline-first client; cache fallback now renders in under one second |
| Offline Add field | UI reported `Farm Rx could not save this field right now` | the new-field form sends blank placeholder IDs and `normalizeFieldDraft` preserved `""`, so the durable queue rejected the entry as non-UUID | blank field/arrangement IDs now become UUIDs; focused regression added; offline queued field survives reload |
| Phase 2 full regression attempt | `Farmer-facing text below the 18px contract: ".farm-switcher..."` | new shell badges used 15/16px text | raised all new farmer-facing text to the repo's 18px accessibility floor; full regressions passed |

### Phase 2 final proof

- `npx tsc -b --force`: PASS.
- `npm run regression`: PASS, including the new blank-ID durability regression.
- `npm run build`: PASS; existing large-chunk warning remains.
- `npx playwright test`: PASS, 14/14 across desktop and phone.
- No test was weakened or skipped. The expired-cache assertion was corrected from an ARIA-role assumption to visible-text proof after the screenshot showed the exact fail-closed message rendered.

## Mandatory live/manual gates

Not attempted during this loop: linked/live migrations, Auth/security settings, scheduler activation, Edge Function deployment/secrets, production deployment, production header proof, real-device push, installed iOS/Android PWA proof, live customer email, merge, or `main` push.

## Phases 3-6 change and proof record

| Slice | Repair | Proof | Result |
|---|---|---|---|
| Shared queue transaction | One Web Locks / renewable-lease primitive and cross-tab change feed applied to all queue families | 40 concurrent appends; two-page simultaneous notification writes; queue-lock mutation | PASS |
| Direct mutable rows | Expected `updated_at` compare-and-swap with identical lost-response reconciliation | optimistic-save regression; independent database conditional-update sessions | PASS |
| Field/Harvest aggregate concurrency | Versioned RPCs, shared field lock, legacy grants revoked, full current crop-child-set comparison | 0036 Session A/B, receipt replay, new-child survival | PASS |
| Offline sequential edits | Rebase later local edits only on the preceding canonical replay result | repository regressions and queue inspection | PASS |
| Market widget boundary | Dedicated opaque sandbox frame, parent first-party-only CSP, frame hash/source CSP | hostile desktop+phone script; CSP/hash static guard | PASS |
| Marketing freshness/scope | Two farm-local days; exact nullable entity/enterprise scope in client, scheduler, delivery recheck | client regression and 0037 opposite-entity/stale-bid probe | PASS |
| App-closed alert evaluator | Service-role sweep, Program/marketing transitions, conservative spray transition, durable push row, scheduled workflow | 0037 fixed-clock first/replay/false→true proof | PASS locally; Edge activation pending |
| Mobile navigation | Four primary links and accessible More grid | 320/375/390/430 browser proof on desktop+phone projects | PASS |
| False-confidence repair | CI/full gate, static invariants, four controlled negative mutations | `verify-foundation.ps1` | PASS |

## Additional failure and repair record

| Attempt | Exact failure summary | Root cause | Repair |
|---|---|---|---|
| 0036 disposable 1 | duplicate membership | farm insert trigger already created owner membership | idempotent membership seed |
| 0036 disposable 2 | Session A harvest failed stale check | snapshot preceded the field bundle update | refresh canonical harvest timestamp |
| 0037 disposable 1 | `INSERT has more target columns than expressions` | missing operating-entity seed value | complete field seed |
| TradingView browser 1 | `Delayed market quotes` not found | no production estimate meant Grain stayed in first-estimate flow | production-shaped fixture |
| TradingView browser 2 | unexpected capability/Auth requests | fixture omitted real composition requests | explicit narrow RPC/Auth fixture responses |
| Adversarial stale-child review | stale Field draft could omit and erase a crop another editor added | 0036 originally compared only draft-present children | compare entire current child ID/version set; disposable attack added |
| Adversarial CSP review | parent `script-src` still allowed TradingView for `srcDoc` | inline frame inherited parent policy | dedicated frame response and separate hash-pinned CSP |
| Queue bookkeeping review | resolved process-lock tail remained in map | cleanup compared different Promise objects | compare/delete the stored tail Promise |

## Final proof summary

- `npx tsc -b --force`: PASS.
- `npm run regression`: PASS.
- `npm run build`: PASS; existing large-chunk warning remains.
- `npm audit --audit-level=high`: PASS, zero vulnerabilities.
- `verify-0033/0034/0035/0036/0037-disposable.ps1`: PASS.
- `verify-rls-role-matrix.ps1`: PASS.
- static guards and four controlled mutations: PASS.
- `npx playwright test`: PASS, 22/22.
- combined `scripts/verify-foundation.ps1`: PASS.
- secret-like changed-file scan: zero credential candidates; one deliberately fake Playwright refresh-token fixture marker was identified without printing its value.
- final build evidence: 206 modules; 1,112.08 kB main JS / 292.85 kB gzip; 8 PWA precache entries / 1,207.42 KiB.
- current Supabase changelog checked; migrations 0036-0037 use explicit RPC grants/revokes and revoke exposed roles from the scheduler-private table.

## Residual release risk

The branch has no known BLOCKER/P0/P1 code defect from the July 15 finding set. It remains **CONDITIONALLY SOLID** because the new migrations/functions/headers are not deployed, Edge runtime bundling was locally blocked, and physical offline/push/live-role proof requires separate authority and hardware.

## Publication record

- implementation commit: `3edab12` (`Harden Farm Rx foundation workflows`)
- branch: `codex/farmrx-foundation-repair`
- draft PR: <https://github.com/masonwells1/FarmRx/pull/1>
- stopped before migration apply, Supabase settings/data changes, deploy, customer delivery, merge, or `main`/production push
