## Runtime

- Model: **Codex based on GPT-5** — this is the complete model identity exposed to me.
- Reasoning effort: **not printed or exposed by this runtime**. I did not open the prohibited runtime logs to infer it.

# RELEASE BLOCKED

Three P1 isolation defects remain. No files or Git state were changed.

## Repair closure

| # | Status | Production trace | Deterministic proof |
|---|---|---|---|
| 1. Scouting photo identity/epoch fencing | **CLOSED** | The operation-specific Storage client validates the captured user and sends expected-user/epoch headers in [scoutingStorage.ts](/C:/FarmRx/src/data/scoutingStorage.ts:10). Every upload is bracketed by context checks, and changed context prevents cleanup attribution in [scoutingStorage.ts](/C:/FarmRx/src/data/scoutingStorage.ts:33). The captured operation continues through save in [QueuedScoutingRepository.ts](/C:/FarmRx/src/data/QueuedScoutingRepository.ts:150). | Account/farm switching permits one upload and zero later Storage, DB, queue, cleanup, or outbox mutations in [SupabaseScoutingRepository.regression.ts](/C:/FarmRx/src/data/SupabaseScoutingRepository.regression.ts:104). Regrant/epoch change is covered at [line 120](/C:/FarmRx/src/data/SupabaseScoutingRepository.regression.ts:120). |
| 2. Grain-alert capture, transition, and delivery | **NOT CLOSED** | Capture correctly precedes data loading in [GrainModule.tsx](/C:/FarmRx/src/GrainModule.tsx:280). Delivery carries exact headers and checks context in [grainAlerts.ts](/C:/FarmRx/src/data/grainAlerts.ts:42). The Edge function checks owner membership/epoch at entry and immediately before provider delivery in [deliver-grain-alert/index.ts](/C:/FarmRx/supabase/functions/deliver-grain-alert/index.ts:24) and [line 62](/C:/FarmRx/supabase/functions/deliver-grain-alert/index.ts:62). However, the SQL transition RPC still lacks server-side expected-user/epoch enforcement; see **FRX-P1-002**. | Capture order, header binding, and no second transition/delivery are tested in [grainAlerts.regression.ts](/C:/FarmRx/src/data/grainAlerts.regression.ts:12). The Edge final-delivery fence is tested in [grainAlertAccessFence.regression.ts](/C:/FarmRx/supabase/functions/_shared/grainAlertAccessFence.regression.ts:7). The regression does not test a session replacement between client verification and SQL request dispatch. |
| 3. Reject success after accepted Grain/insurance mutations | **CLOSED** | Grain delivery, price finalization, offer fill, and bin movement re-check the captured context after RPC acceptance in [SupabaseGrainRepository.ts](/C:/FarmRx/src/data/SupabaseGrainRepository.ts:69), with the queued public boundaries in [QueuedGrainRepository.ts](/C:/FarmRx/src/data/QueuedGrainRepository.ts:49). Insurance re-checks before returning at [SupabaseProfitabilityRepository.ts](/C:/FarmRx/src/data/SupabaseProfitabilityRepository.ts:222) and [QueuedProfitabilityRepository.ts](/C:/FarmRx/src/data/QueuedProfitabilityRepository.ts:113). | Accepted mutations followed by rejected public success are exercised in [SupabaseGrainRepository.regression.ts](/C:/FarmRx/src/data/SupabaseGrainRepository.regression.ts:240) and [SupabaseProfitabilityRepository.regression.ts](/C:/FarmRx/src/data/SupabaseProfitabilityRepository.regression.ts:299). |
| 4. Scouting cleanup ownership/versioning | **CLOSED** | Version 2 is keyed by user and stores user/farm per entry in [scoutingCleanupOutbox.ts](/C:/FarmRx/src/data/scoutingCleanupOutbox.ts:13). Draining is limited to that user/farm at [line 67](/C:/FarmRx/src/data/scoutingCleanupOutbox.ts:67). Version 1 moves read-back-verified into an unowned vault at [line 85](/C:/FarmRx/src/data/scoutingCleanupOutbox.ts:85). | The regression proves other-farm version-2 work remains isolated and legacy work enters only the unowned vault in [revokedFarmRecovery.regression.ts](/C:/FarmRx/src/data/revokedFarmRecovery.regression.ts:24). |

## Blocking findings

### P1 — FRX-P1-001: A direct A→B session replacement can render Farm A under User B

**Location:** [App.tsx](/C:/FarmRx/src/App.tsx:372), especially [lines 417–428](/C:/FarmRx/src/App.tsx:417) and [line 448](/C:/FarmRx/src/App.tsx:448); supporting behavior in [AuthProvider.tsx](/C:/FarmRx/src/auth/AuthProvider.tsx:38) and [RequireSession.tsx](/C:/FarmRx/src/auth/RequireSession.tsx:9).

**Failure sequence:**

1. A tab has User A and Farm A in `ready` state.
2. Another tab replaces the shared Supabase session directly with signed-in User B.
3. `RequireSession` remains signed in, so `FarmAccessGate` stays mounted.
4. The gate starts asynchronous B access loading but does not immediately clear A’s `state` or `access`.
5. Rendering checks only that a user and selected farm exist; it never requires `access.userId === user.id`.
6. Farm A’s interface and already-loaded data can therefore render under User B until B validation completes or fails.

**Impact:** Cross-user farm-data exposure and stale interactions, violating the release’s primary isolation contract.

**Smallest safe fix:** Fail closed during render unless `access.userId === user.id`, and reset access/state on identity change. A keyed inner gate per `user.id` is also safe.

**Required proof:** A React/browser regression that pauses or rejects B’s farm-access request during a direct signed-in A→B event and proves Farm A content disappears on the first B render, with no controls usable until B access validates.

---

### P1 — FRX-P1-002: Grain-alert transition RPC ignores the captured user and epoch

**Location:** Client request at [grainAlerts.ts](/C:/FarmRx/src/data/grainAlerts.ts:81) and [line 101](/C:/FarmRx/src/data/grainAlerts.ts:101); SQL state table and RPC at [0035_operational_integrity.sql](/C:/FarmRx/supabase/migrations/0035_operational_integrity.sql:174) and [line 182](/C:/FarmRx/supabase/migrations/0035_operational_integrity.sql:182). Migration 0040 guards only tables containing `farm_id` at [0040_farm_access_epoch_fencing.sql](/C:/FarmRx/supabase/migrations/0040_farm_access_epoch_fencing.sql:340).

**Failure sequence:**

1. User A’s captured context passes the client verification at [grainAlerts.ts:87](/C:/FarmRx/src/data/grainAlerts.ts:87).
2. Before the RPC is dispatched, the shared Supabase session becomes User B.
3. The request can carry B’s authorization while retaining A’s expected-user/epoch headers.
4. If B can edit the same farm, `record_marketing_alert_transition` accepts B because it checks only `auth.uid()`, farm edit access, and rule membership.
5. `alert_rule_states` has no `farm_id`, so the migration-0040 row trigger cannot enforce the headers.
6. The shared alert state mutates. The client’s later context check rejects success, but the forbidden remote work already occurred.

**Impact:** A later identity can alter alert transition state, potentially suppressing a legitimate alert or causing a duplicate later alert.

**Smallest safe fix:** Call `public.assert_current_farm_access_epoch(p_farm_id)` before locking or changing alert state. Retain the existing edit-role check.

**Required proof:** A disposable SQL drill using B’s authenticated claims with A’s expected-user/epoch headers must raise `FARM_ACCESS_EPOCH_CHANGED` and leave `alert_rule_states` unchanged. Add a production-path regression for a switch between pre-verification and RPC dispatch.

---

### P1 — FRX-P1-003: Push-subscription RPCs can silently adopt the later account

**Location:** Client capture/check at [SupabaseNotificationsRepository.ts](/C:/FarmRx/src/data/SupabaseNotificationsRepository.ts:30), headers at [SupabaseNotificationsDataGateway.ts](/C:/FarmRx/src/data/SupabaseNotificationsDataGateway.ts:13), and SQL functions at [0023_reminders.sql](/C:/FarmRx/supabase/migrations/0023_reminders.sql:221) and [line 275](/C:/FarmRx/supabase/migrations/0023_reminders.sql:275). The 0040 verification expressly excludes `push_subscriptions` from its non-farm table check at [verify-0040-disposable.ps1](/C:/FarmRx/scripts/verify-0040-disposable.ps1:182).

**Failure sequence:**

1. User A captures a farm operation and starts enabling or deleting push notifications.
2. The session changes to User B after client verification but before RPC dispatch.
3. The gateway sends A’s expected-user/epoch headers, but neither RPC reads or enforces them.
4. `save_push_subscription` uses only the later `auth.uid()` and explicitly transfers endpoint ownership to that user; delete likewise acts for the later user.
5. The post-RPC check rejects public success, but the remote ownership change or deletion is already committed.

**Impact:** Push endpoint ownership can cross account boundaries, allowing later account notifications to be routed to a subscription created by a different captured operation.

**Smallest safe fix:** Add captured `p_farm_id` to both RPCs and call `public.assert_current_farm_access_epoch(p_farm_id)` before any write. Continue using the authenticated caller as the subscription owner.

**Required proof:** A disposable two-user race must show B authorization plus A expected-user/epoch headers is rejected without changing endpoint ownership. Add repository regressions proving zero remote mutation for both save and delete.

## Commands and results

- Git branch, `HEAD`, merge-base, status, changed/untracked enumeration: **PASS**. Branch and both SHAs were exactly `codex/farmrx-release-gate-proof` and `49614e75140fdf4dee94d916e32b386bef922f1a`.
- Direct `Get-Content`, `rg`, and `git diff` inspection of candidate source, migrations, tests, Edge functions, PWA/CSP, queues, and grants: completed. Prohibited audit/report content was not opened.
- `npm run regression`: blocked before the first test because the sandbox denied `tsx` temporary-directory creation.
- Same 39 programs through `TSX_DISABLE_CACHE=1 node --import tsx`: **39/39 PASS**.
- TypeScript app and Node configurations with `--incremental false`: **PASS**.
- `node scripts/foundation-static-guards.mjs`: **PASS**.
- `npm audit --offline --audit-level=high`: **PASS, 0 vulnerabilities** in the available offline advisory data.
- `git diff --check`: **PASS**; only line-ending conversion warnings.
- Playwright `test --list`: **30 tests discovered** across desktop and phone projects. Browser execution was not performed.
- `deno check --cached-only`: unavailable because Deno is not installed.
- Disposable migrations, mutation drill, and RLS matrix: not executed because Docker is unavailable and the read-only sandbox prohibits their temporary state.

Those unavailable checks are verification limitations, not additional defects.

## Secret scan

A value-safe pattern scan covered **121 allowed candidate text files** and found **0 recognized secret values**. Three binary icon files were excluded from text matching and visually inspected.

Limitations: this was pattern-based and cannot detect unknown or specially encoded secrets. It intentionally excluded the prohibited audit/reviewer tree, the unrelated `NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md`, environment variables, Git history, and external systems. No secret values were printed.
