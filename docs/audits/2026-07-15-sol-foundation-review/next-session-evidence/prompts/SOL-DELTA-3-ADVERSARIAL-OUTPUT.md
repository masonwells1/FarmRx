## 1. Runtime identity

- Model: Codex, based on GPT-5—the only model identifier exposed in the runtime header.
- Reasoning effort: not exposed in the runtime header, so no exact tier can be reported.
- No subagents, Claude, Fable, or other models were used.

## 2. Personally run checks

- Inspected the complete `49614e75140fdf4dee94d916e32b386bef922f1a` working-tree delta, including tracked changes and all untracked candidate code, migrations, scripts, tests, and assets.
- Ran all 36 package regression entrypoints with `node --import tsx`; 36/36 passed.
- Ran both TypeScript checks with `tsc --noEmit --incremental false`; both passed.
- Parsed nine PowerShell verification scripts; all passed syntax parsing.
- Ran `git diff --check`; no whitespace errors, only CRLF conversion warnings.
- Ran a candidate credential-pattern scan; passed.
- Visually inspected the three new icon assets.
- Ran three custom adversarial reproductions:
  - Cross-account repository reuse: `CROSS_ACCOUNT_IN_MEMORY_LEAK=true`.
  - Corrupt no-Web-Locks lease: remained blocked beyond the test window.
  - Push deadline: the function returned at approximately 101 ms while its database completion promise remained active and settled afterward.
- Docker, `psql`, and Deno were unavailable. No live or disposable database execution occurred.
- I did not credit the claimed foundation pass, 30 Playwright tests, or repeated phone test as independent evidence.

## 3. Closure matrix

| Item | Re-adjudication |
|---|---|
| FRX-FRESH-001 | **OPEN — P1.** Durable cache/queue fencing and cross-user refresh-key isolation improved, but module-level repository memory remains unscoped across users and farms. Financial permission revocation also misses the epoch fence. |
| FRX-FRESH-002 | **No contrary code defect found; DB closure unproven.** Migration 0039 performs its scheduler-state preflight before schema mutation and retires legacy RPCs, but the disposable migration was not executed. |
| FRX-FRESH-003 | **CLOSED in reviewed scope.** Current regression entrypoints passed. |
| FRX-FRESH-004 | **No contrary code defect found; DB closure unproven.** Per-farm sweep containment exists statically; PostgreSQL execution proof is missing. |
| FRX-FRESH-005 | **No contrary code defect found; DB closure unproven.** First-good and monotonic spray-window logic is present; PostgreSQL execution proof is missing. |
| FRX-FRESH-006 | **No contrary target-state defect found; DB closure unproven.** Per-target retry/gone/terminal handling is present. The whole-invocation deadline remains independently open below. |
| FRX-FRESH-007 | **CLOSED in reviewed code.** Weather work is bounded and push delivery runs last; relevant regression tests passed. |
| FRX-FRESH-008 | **CLOSED in reviewed code; Edge-runtime proof missing.** Partial delivery produces an unhealthy response in helper tests, but the deployed Deno handler was not executed. |
| FRX-FRESH-009 | **CLOSED in reviewed scope.** Notification-link normalization tests passed and unsafe external/backslash forms are rejected. |
| FRX-FRESH-010 | **CLOSED in reviewed scope.** Recovery skips empty queue families and its regressions passed. |
| Prior delta-2 push deadline | **OPEN — P2.** The response deadline is bounded, but underlying database requests are not cancelled. |

## 4. P0/P1/P2 findings

No new P0 finding.

### P1 — Cross-account in-memory workspace disclosure

Scenario: User A loads field data, signs out, and User B signs in without a page reload. If B’s initial field request has a transport failure, the singleton repository returns A’s retained `workspace` under B’s context. I reproduced this directly.

Impact: One signed-in account can receive another account or farm’s operational data. Queued B operations can also be overlaid onto A’s stale workspace.

Evidence:

- The workspace has no associated user, farm, or fence identity, and the transport fallback returns any existing workspace: [QueuedFieldsRepository.ts:25,35-39](/C:/FarmRx/src/data/QueuedFieldsRepository.ts:25).
- The repository is a module singleton: [index.ts:24-35](/C:/FarmRx/src/data/index.ts:24).
- Sign-out clears farm-access state but does not clear repository memory: [AuthProvider.tsx:56-69](/C:/FarmRx/src/auth/AuthProvider.tsx:56).
- Sign-in navigates within the SPA without reloading the JavaScript modules: [App.tsx:612-620](/C:/FarmRx/src/App.tsx:612).
- The delayed-read browser test verifies IndexedDB fencing but still permits the stale tab to render its completed old response: [foundation-shell.spec.ts:340-347](/C:/FarmRx/tests/e2e/foundation-shell.spec.ts:340).

Smallest safe fix: associate every in-memory workspace with `{userId, farmId, generation, fenceToken, serverEpoch}` and reject or clear it on any mismatch. Also provide one central repository-memory reset invoked during sign-out and access-context transitions.

Required proof: load distinct data as A, sign out, sign in as B without a reload, force transport failures in every queued repository, and prove no A record appears or becomes editable.

### P1 — Financial-access revocation does not advance the farm epoch

Scenario: An employee has `can_view_financials=true` and cached grain/profitability data. An administrator revokes only that flag. The employee later reconnects to general farm data, but the epoch remains unchanged. The device can subsequently go offline and continue accepting the still-valid financial cache.

Impact: Sensitive grain, cost, and profitability information can remain available after an explicit permission revocation.

Evidence:

- `can_view_financials` is an authorization grant used by `can_read_private_financials`: [0008_employee_privacy.sql:11-35](/C:/FarmRx/supabase/migrations/0008_employee_privacy.sql:11).
- The epoch trigger watches only `role` and `status`, not `can_view_financials`: [0040_farm_access_epoch_fencing.sql:314-320](/C:/FarmRx/supabase/migrations/0040_farm_access_epoch_fencing.sql:314).
- Financial caches remain valid for 24 hours while the epoch/fence matches: [workspaceCache.ts:3,62-75](/C:/FarmRx/src/data/workspaceCache.ts:3).
- That cache lifetime is used by grain and profitability: [QueuedGrainRepository.ts:25](/C:/FarmRx/src/data/QueuedGrainRepository.ts:25), [QueuedProfitabilityRepository.ts:60](/C:/FarmRx/src/data/QueuedProfitabilityRepository.ts:60).

Smallest safe fix: include `can_view_financials` in the membership epoch-bump update trigger.

Required proof: toggle the flag from true to false in disposable PostgreSQL, prove the farm epoch increments, refresh the client context, and prove both financial caches are purged and cannot be read offline.

### P2 — Corrupt fallback lease can block queue operations indefinitely

Scenario: In a browser without Web Locks, localStorage contains a lease with an extremely future `expiresAt`, caused by corruption or a backward system-clock change. Every caller loops indefinitely. My injected far-future lease remained blocked.

Impact: Queue replay, saves, and access-fence work using that key can hang indefinitely.

Evidence: `expiry()` accepts any JavaScript number, and the acquisition loop has no deadline: [queueTransaction.ts:12-14,28-40](/C:/FarmRx/src/data/queueTransaction.ts:12).

Smallest safe fix: accept only finite safe timestamps within a small permitted horizon of the current time; treat anything else as expired. Add a bounded acquisition timeout that returns a fail-closed, user-visible error.

Required proof: exercise huge, non-finite, malformed, expired, missing, and clock-skewed leases plus genuine simultaneous-tab contention.

### P2 — Push deadline races database promises without cancelling them

Scenario: A target finishes provider delivery, but `finishTarget` hangs past the absolute budget. The wrapper returns an unhealthy result while the underlying completion request remains active. I proved that the database promise settled after the delivery function returned.

Impact: Claims, completion writes, and health reads can mutate or consume resources after the scheduler considers the invocation finished, producing late state changes and unreliable retry/health ordering.

Evidence:

- Database operations accept no abort signal: [pushDeliveryLogic.ts:15-18](/C:/FarmRx/supabase/functions/_shared/pushDeliveryLogic.ts:15).
- `beforeAbort` rejects only its wrapper; it does not stop the original promise: [pushDeliveryLogic.ts:43-68](/C:/FarmRx/supabase/functions/_shared/pushDeliveryLogic.ts:43).
- Claim, finish, and health operations are merely raced against the timer: [pushDeliveryLogic.ts:80-83](/C:/FarmRx/supabase/functions/_shared/pushDeliveryLogic.ts:80).
- The actual Supabase RPC calls receive no cancellation signal: [send-push/index.ts:47-62](/C:/FarmRx/supabase/functions/send-push/index.ts:47).

Smallest safe fix: propagate the deadline’s `AbortSignal` into each real PostgREST/RPC request. Where true client cancellation is unavailable, enforce a database statement timeout and durable idempotent lease semantics, then track bounded cleanup explicitly.

Required proof: independently hang claim, completion, and health RPCs; prove each underlying request is cancelled or server-terminated at the deadline and cannot mutate afterward.

## 5. Proof gaps

- Migrations 0039 and 0040 were statically reviewed but not run against disposable PostgreSQL.
- RLS, trigger coverage, ACLs, migration rollback, locking, and PostgREST header behavior therefore remain unexecuted.
- The Deno Edge handlers were not executed.
- The claimed Playwright suite and repeated phone run were not independently rerun because this review prohibited workspace/browser-artifact mutation.
- No live providers, Supabase project, Vercel deployment, or physical device was accessed.
- A production build was not emitted because that would write build artifacts.

## 6. Residual risks distinct from defects

- A device that never reconnects cannot learn a server-side revocation; the product must explicitly accept or further restrict that inherent offline-data exposure.
- Web Push remains at-least-once delivery: provider success followed by uncertain database completion can still produce duplicate-delivery ambiguity.
- Future tables containing `farm_id` must be included in the epoch-trigger guard when introduced.
- Recovery queue payloads remain locally readable to anyone with access to the browser profile.

## 7. Verdict

**RELEASE BLOCKED**

## 8. No-mutation confirmation

This was read-only. I did not edit source, tests, migrations, evidence, or reports; stage, commit, push, deploy, or apply migrations; mutate GitHub, Supabase, Vercel, providers, or other external services; or open the forbidden evidence files. Final `HEAD` remained `49614e75140fdf4dee94d916e32b386bef922f1a`, and the final working-tree status remained the original candidate state.
