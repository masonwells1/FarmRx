Model: GPT-5-based Codex
Reasoning effort: high

RELEASE CLEARED

NO BLOCKING FINDINGS

No remaining P0, P1, or P2 findings. Required corrections: none.

### Closure review

| Item | Result | Direct evidence |
|---|---|---|
| Direct `push_subscriptions` DML P1 | Closed | Authenticated DML revoked and write policies removed in [0041](C:/FarmRx/supabase/migrations/0041_unscoped_authenticated_write_fencing.sql:145). |
| Notification-link P2 | Closed | Canonical same-origin validation remains in [notificationLink.ts](C:/FarmRx/src/data/notificationLink.ts:4) and runs before storage and again before navigation in [sw.ts](C:/FarmRx/src/sw.ts:23). Independent hostile-link matrix passed. |
| 1. Endpoint ownership/pending target | Pass | Conditional upsert never transfers `user_id`; cross-user conflict raises while same-user refresh preserves the pending target ([0041](C:/FarmRx/supabase/migrations/0041_unscoped_authenticated_write_fencing.sql:92)). |
| 2. A→B queued/cache reads | Pass | Identity is reverified after asynchronous boundaries by [queuedOperationGuard.ts](C:/FarmRx/src/data/queuedOperationGuard.ts:31). No delta regression found. |
| 3. Revoke/regrant quarantine | Pass | Generation/token/server epoch remain bound in [farmRevocationFence.ts](C:/FarmRx/src/data/farmRevocationFence.ts:118), with revoked work quarantined rather than replayed. |
| 4. Captured user/farm/generation writes | Pass | Browser headers bind user and epoch in [farmOperationContext.ts](C:/FarmRx/src/data/farmOperationContext.ts:18); the database asserts them before push DML, and the former direct-table bypass is gone. |
| 5. Real-path proof | Pass | Browser save/delete use only fenced RPCs in [SupabaseNotificationsDataGateway.ts](C:/FarmRx/src/data/SupabaseNotificationsDataGateway.ts:13). No `src` direct-table references exist. Gate topology remains 39 regressions and 16 Playwright cases across two projects. |

Effective candidate ACL state: `PUBLIC`/`anon` have no table access; authenticated retains `SELECT` with its own-user policy, but no direct `INSERT/UPDATE/DELETE`; legacy RPC signatures are non-executable; only the farm-bound overloads are granted to authenticated. The `SECURITY DEFINER` functions use fixed search paths and perform the epoch check before privileged DML. This follows Supabase’s requirement to explicitly restrict default function execution privileges. [Supabase database-function guidance](https://supabase.com/docs/guides/database/functions?example-view=sql&language=sql&queryGroups=example-view&queryGroups=language)

Service-role delivery does not require the browser RPCs or direct push-table writes. It uses the separate service-only claim/finish/health RPCs in migration 0039 and [send-push](C:/FarmRx/supabase/functions/send-push/index.ts:48).

The disposable negative proof is meaningful:

- Its helper rejects either a zero exit or any error other than the exact table-permission denial ([verify-0041-disposable.ps1](C:/FarmRx/scripts/verify-0041-disposable.ps1:12)).
- Restoring `INSERT` produces an RLS error rather than the expected ACL denial; restoring policyless `UPDATE` or `DELETE` can produce a successful zero-row operation. All turn the proof red. Restoring their policies produces successful state-changing DML and also turns it red. Supabase documents the relevant RLS/UPDATE behavior. [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security)
- Catalog assertions independently reject any remaining authenticated DML privilege or write policy ([verify-0041-disposable.ps1](C:/FarmRx/scripts/verify-0041-disposable.ps1:225)).
- The controlled mutation is non-vacuous: the revoke occurs exactly once; the mutation actually removes it and inserts the grant, while the static baseline is green ([verify-foundation-mutations.mjs](C:/FarmRx/scripts/verify-foundation-mutations.mjs:43)).

### Files and commands

Inspected migrations 0023 and 0038–0041, push Edge/server paths, browser notification repositories/gateways, access-generation and quarantine logic, notification-link/service-worker chain, disposable proof, static guards, mutation drill, and full-gate orchestration.

Read-only commands included `git status`, `git rev-parse`, candidate `git diff`, standard `git diff --check` (exit 0), `rg`, `Get-Content`, `node scripts/foundation-static-guards.mjs` (PASS), an independent notification-link matrix (PASS), and read-only mutation/topology checks.

### Limitations

The Docker, build, audit, mutation, and Playwright gates were not rerun because they create containers or filesystem output. I inspected their current wiring and treated the supplied authoritative exit-0 full gate as execution evidence. No live Supabase project, deployment, physical device, or provider was accessed. Platform-managed live `service_role` defaults were therefore not queried.

Files changed: none.
Git state changed: none.
External changes: none.
The excluded untracked handoff file remains present and untouched.
