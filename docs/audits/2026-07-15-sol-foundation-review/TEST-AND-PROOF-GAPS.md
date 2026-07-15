# Test and Proof Gaps

## What the branch gate proves

`npm run verify:foundation` currently proves:

1. forced TypeScript project build;
2. all configured business/repository regressions, including optimistic saves, alert freshness, scheduler weather logic, and queue contention;
3. production Vite/PWA build;
4. dependency audit at high severity;
5. static route, queue, RLS, cache, CSP, frame-hash, and scheduler invariants;
6. four controlled mutations that each make the guard fail;
7. every migration from 0001 through 0037 applied from zero in disposable PostgreSQL;
8. 0033 Grain ledger/finalization/delivery behavior;
9. 0034 Profitability durability behavior;
10. 0035 Program/task/push/service integrity;
11. 0036 two-session optimistic concurrency and lost-response replay;
12. 0037 app-closed Program/marketing/spray evaluation and delivery-row dedupe;
13. manager/worker/read-only/rep-off/rep-on/stranger RLS behavior;
14. 22 production-build Playwright tests across desktop and phone.

The browser suite crosses real React, service worker, IndexedDB, localStorage, routing, repository composition, multi-page concurrency, and hostile iframe boundaries. The database suites cross real PostgreSQL constraints, functions, locks, grants, RLS helpers, and transaction behavior.

## Attack-scenario status

| Scenario | Current proof | Residual gap |
|---|---|---|
| Double click / submit | Submit-lock regression and handler locks | No exhaustive browser double-tap test for every write button |
| Two tabs editing/queueing | Two-page notification append; 40 concurrent queue transactions | Browser stale-editor UI is represented by disposable DB sessions rather than two signed-in UI pages |
| Stale save after update | Field/Harvest independent sessions; direct conditional Equipment update; full child-set addition attack | Migration 0036 not applied/live; delete-specific expected versions are not generalized to every ordinary delete |
| Offline create/edit/delete/reconnect | Offline cached reopen and field create/reload; repository queue projections for modules | Installed iOS/Android, storage quota/eviction, and browser-crash timing; no browser delete/reconnect scenario for every module |
| Request succeeds/browser misses response | Field/Harvest operation receipts and direct-row identical-state reconciliation | Not transport-injected through every individual repository path |
| Retry after partial failure | Queue park/retry tests; scheduler and Program replay dedupe; push claim/backoff | Real Edge/email/push provider partial failure not run |
| Wrong farm/user/role | Fresh disposable role matrix and two-farm browser isolation | Real live accounts and revoked offline grant timing |
| Null/negative/zero/precision/large | Existing validation, database checks, planning/insurance/bin/inventory regressions | No property-based/fuzz suite across every form |
| Deleted parent/dependents | FKs, receipt/ledger patterns, service reversal, full-field child-set stale guard | No exhaustive UI deletion matrix for every table/storage object |
| Migration/schema drift | Fresh local 0001-0037 apply | Linked migration registry and deployed signatures are unavailable |
| Tests green while path broken | Four controlled mutations plus built-browser/database gates | Edge runtime compilation is not in the local gate because Deno/local Supabase stack is unavailable |

## Remaining live/device proof

1. Compare linked migration versions, RPC signatures, policies, bucket rules, Auth settings, security advisors, scheduled functions, Edge versions, and web deployment to Git.
2. Apply 0036-0037 in a non-production environment and rerun the session/RLS attacks through PostgREST.
3. Bundle and invoke `scheduled-alert-sweep` in the Supabase Edge runtime; verify its secret rejection, service-role path, weather failure isolation, push drain, logs, and retry.
4. Deploy preview web headers and verify both `/grain` and `/market-quote-frame.html` responses. Confirm the parent `script-src` contains no TradingView and the frame bootstrap hash matches.
5. Install on physical iOS/Android devices; force-close and reopen offline; create/edit/delete; reconnect; test storage pressure/eviction and revoked access.
6. Receive one real push with the app closed and one controlled Grain email; verify provider failure visibility without exposing secrets.
7. Exercise scouting photo upload, offline note behavior, cross-farm path rejection, delete, and cleanup retry in a disposable/test farm.

## Explicit command limitations recorded

- `deno --version`: command unavailable.
- `supabase functions serve scheduled-alert-sweep`: `supabase start is not running.`
- The attempted variant containing `--no-verify-jwt` was blocked by the workstation safety hook and was not bypassed.
- `vercel build`: `No project settings found locally. Run pull to retrieve them, or re-run with --yes to pull automatically.` The loop did not pull project settings or environment data.

These do not invalidate the passing database/browser proof, but they prevent calling the scheduler or headers production-ready.
