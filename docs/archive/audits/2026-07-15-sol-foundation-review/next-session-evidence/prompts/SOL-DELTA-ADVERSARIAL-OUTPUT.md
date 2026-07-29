# Fresh Sol delta adversarial review

## Verdict

**RELEASE BLOCKED**

Two original P1 findings remain partial, and one new P2 defect was found.

## 1. Runtime

- **Model:** GPT-5-based Codex—the only model identity exposed to this runtime.
- **Reasoning effort:** The runtime header available to me did not expose an auditable effort label, so I cannot honestly claim `high` or `xhigh`.
- No Claude, Fable, sub-agent, or other model was called.

## 2. Checks personally run

- Read every required document, predecessor finding, and command-log claim.
- Inspected the complete tracked base `49614e7` diff and every untracked candidate source, migration, script, test, and icon. Prohibited reports and `NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md` were not opened.
- `git diff --check` — PASS.
- Full regression suite through the read-only Node loader — **35/35 suites PASS**.
- Focused queue, recovery, notification-link, weather, scheduler, and push regressions — PASS.
- App and Vite config TypeScript checks with `--noEmit --incremental false` — PASS.
- Syntax transpilation of 23 changed/new TS/TSX files — PASS.
- PowerShell parsing of four verification scripts — PASS.
- JSON validation, candidate secret scan, and PNG structure/dimension inspection — PASS.
- Direct adversarial proofs:
  - Missing fence: `staleTransactionBlocked:false`, `staleQueueWritten:true`.
  - Repeated push completion failure: two later provider sends after six failed completion writes.
  - Ten mocked 20ms push targets took 238ms, confirming serial delivery.
  - Backslash, control, absolute, and protocol-relative links fell back; encoded separators remained same-origin; valid query/hash path survived.
- Docker, `psql`, and Deno are unavailable, so SQL migrations were not personally executed.
- Direct `tsx` CLI initially failed because the sandbox denied its temp directory; `node --import tsx` ran the same suites without writing.

## 3. Closure matrix

| Finding | Status | Adjudication |
|---|---|---|
| FRX-FRESH-001 | **PARTIAL** | Ordinary cross-tab writes are fenced and stale cache generations are rejected: [queueTransaction.ts:83](/C:/FarmRx/src/data/queueTransaction.ts:83), [workspaceCache.ts:46](/C:/FarmRx/src/data/workspaceCache.ts:46), [E2E:228](/C:/FarmRx/tests/e2e/foundation-shell.spec.ts:228). Corrupt fences fail closed, empty queues are removed, and recovery writes precede clearing. But a **missing** fence is treated as generation-zero granted state: [farmRevocationFence.ts:14](/C:/FarmRx/src/data/farmRevocationFence.ts:14). Direct attack proved a paused stale transaction can write after revoke/regrant when that key disappears. |
| FRX-FRESH-002 | **PARTIAL** | Migration 0039 retires and revokes the legacy RPCs: [0039:382](/C:/FarmRx/supabase/migrations/0039_scheduler_weather_push_semantics.sql:382), with ACL tests at [verify-0039:96](/C:/FarmRx/scripts/verify-0039-disposable.ps1:96). However, pre-existing legacy `failed` parents are snapshotted across every current subscription at [0039:241](/C:/FarmRx/supabase/migrations/0039_scheduler_weather_push_semantics.sql:241), so a device already reached before the legacy parent failed can still be resent. |
| FRX-FRESH-003 | **CLOSED** | Full physical-domain validation is enforced in [scheduledAlertLogic.ts:69](/C:/FarmRx/supabase/functions/_shared/scheduledAlertLogic.ts:69). The personally run 28-case regression covers negative, fractional, out-of-range, stale, future, malformed, and misaligned weather: [regression:38](/C:/FarmRx/supabase/functions/_shared/scheduledAlertLogic.regression.ts:38). |
| FRX-FRESH-004 | **CLOSED** | Older or duplicate observations are ignored before state mutation: [0039:182](/C:/FarmRx/supabase/migrations/0039_scheduler_weather_push_semantics.sql:182). The newer-bad/older-good SQL probe is defined at [verify-0039:81](/C:/FarmRx/scripts/verify-0039-disposable.ps1:81). |
| FRX-FRESH-005 | **CLOSED** | First-good observations now fire through `(not v_exists or not v_previous)`: [0039:197](/C:/FarmRx/supabase/migrations/0039_scheduler_weather_push_semantics.sql:197), tested at [verify-0039:76](/C:/FarmRx/scripts/verify-0039-disposable.ps1:76). |
| FRX-FRESH-006 | **CLOSED** | Terminal failures remain queryable on later zero-claim sweeps: [0039:359](/C:/FarmRx/supabase/migrations/0039_scheduler_weather_push_semantics.sql:359). The Edge endpoint returns 503 when unhealthy, and the personally run regression covers an empty sweep with one terminal target: [push regression:39](/C:/FarmRx/supabase/functions/_shared/pushDeliveryLogic.regression.ts:39). |
| FRX-FRESH-007 | **CLOSED** | Weather uses bounded concurrency and a whole-run deadline, marks all unfinished fields failed, then still executes push: [orchestrator.ts:67](/C:/FarmRx/supabase/functions/_shared/scheduledAlertOrchestrator.ts:67), [orchestrator.ts:105](/C:/FarmRx/supabase/functions/_shared/scheduledAlertOrchestrator.ts:105). The personally run 50-hanging-field regression passed: [regression:37](/C:/FarmRx/supabase/functions/_shared/scheduledAlertOrchestrator.regression.ts:37). |
| FRX-FRESH-008 | **CLOSED** | Weather and farm-local failures now produce machine-visible HTTP 503 after healthy work and push complete: [scheduled-alert-sweep:81](/C:/FarmRx/supabase/functions/scheduled-alert-sweep/index.ts:81). Personally run orchestration tests cover both failure classes. |
| FRX-FRESH-009 | **CLOSED** | Links require a same-origin parsed URL and reject literal backslashes/controls: [notificationLink.ts:1](/C:/FarmRx/src/data/notificationLink.ts:1). Direct attacks confirmed absolute, protocol-relative, and backslash links fall back; encoded separators stay same-origin; `/weather?field=1#hourly` survives. |
| FRX-FRESH-010 | **CLOSED** | Empty queue and needs-attention envelopes are skipped and removed without recovery records: [revokedFarmRecovery.ts:123](/C:/FarmRx/src/data/revokedFarmRecovery.ts:123), [regression:22](/C:/FarmRx/src/data/revokedFarmRecovery.regression.ts:22). Recovery durability and corrupt/mismatched queue behavior also passed. |

## 4. Blocking defects

### P1 — Missing revocation fence reopens stale work

- **Scenario:** A stale transaction starts before revocation. Another tab revokes and quarantines the farm. If the fence key disappears before or during regrant, missing state becomes generation `0`, unrevoked. The stale transaction’s verification succeeds and writes its old queue.
- **Impact:** Pre-revocation field, financial, inventory, or compliance work can replay after access is restored. Generation-zero IndexedDB cache data can likewise become readable.
- **Exact code:** [farmRevocationFence.ts:14](/C:/FarmRx/src/data/farmRevocationFence.ts:14), [farmRevocationFence.ts:55](/C:/FarmRx/src/data/farmRevocationFence.ts:55), [queueTransaction.ts:83](/C:/FarmRx/src/data/queueTransaction.ts:83).
- **Smallest fix:** Persist a fence for every grant; treat a missing fence for previously known work as unknown/blocked; carry the generation in queue envelopes as well as caches.
- **Verification:** Pause a real queue save, revoke, delete the fence, regrant, resume, and prove no queue/RPC/cache access. Repeat with a missing access snapshot.

### P1 — Legacy partial deliveries remain ambiguous across migration 0039

- **Scenario:** Legacy delivery sends successfully to device A, fails on B, and leaves the parent `failed`. Migration 0039 snapshots A and B because the parent is unsent; the new sender resends A. An old invocation already between provider success and legacy finish during migration has the same outcome.
- **Impact:** Duplicate customer phone alerts during rollout.
- **Exact code:** [0039:241](/C:/FarmRx/supabase/migrations/0039_scheduler_weather_push_semantics.sql:241), [0039:248](/C:/FarmRx/supabase/migrations/0039_scheduler_weather_push_semantics.sql:248), [0039:382](/C:/FarmRx/supabase/migrations/0039_scheduler_weather_push_semantics.sql:382).
- **Smallest fix:** Add a release preflight that pauses entry points, waits for old invocations to drain, and refuses migration while ambiguous legacy failed/in-flight parents exist. Explicitly adjudicate those rows before enabling target delivery.
- **Verification:** Create a pre-0039 A-success/B-failure row, execute the documented rollout, and prove A is not resent—or prove migration safely refuses to proceed.

### P2 — Push-provider stalls accumulate serially

- **Scenario:** Up to 100 targets are claimed, then sent one-by-one with an eight-second per-target timeout. The scheduler’s call to `send-push` has no whole-request timeout.
- **Impact:** A provider stall can consume hundreds of seconds, strand later targets as `sending`, and prevent the scheduler from returning honest health.
- **Exact code:** [pushDeliveryLogic.ts:58](/C:/FarmRx/supabase/functions/_shared/pushDeliveryLogic.ts:58), [send-push:66](/C:/FarmRx/supabase/functions/send-push/index.ts:66), [scheduled-alert-sweep:72](/C:/FarmRx/supabase/functions/scheduled-alert-sweep/index.ts:72).
- **Smallest fix:** Add bounded target concurrency plus a whole push budget; abort the scheduler-to-push request within its own deadline.
- **Verification:** Simulate 100 hanging targets and require completion within the global budget, with unfinished targets retryable and the endpoint unhealthy.

## 5. Proof gaps and residual risks

Proof gaps:

- PostgreSQL migration syntax, ACLs, RLS, transactional concurrency, and 0038/0039 behavior were not personally executed because Docker/`psql` are unavailable. The command log’s claimed PostgreSQL passes were not treated as my proof.
- No build, Playwright browser run, preview deployment, physical device, live provider, or external service check was performed.
- The safe rollout order exists only as a migration comment; no rollout/drain drill was personally run.

Residual risk, not classified as a separate defect:

- Web Push remains at-least-once when provider acceptance succeeds but all three database completion attempts fail. The target becomes reclaimable after five minutes and can be sent again. Direct proof produced two provider sends after repeated completion failure. The service-worker tag reduces simultaneous duplicates but cannot prevent a dismissed alert from reappearing.
- Revocation cannot be learned while a device is genuinely offline.
- Spray-window guidance remains product-agnostic and cannot replace label restrictions or applicator judgment.

## 6. Mutation confirmation

No external mutation occurred. No Supabase, Vercel, GitHub, provider, email, push, migration, deployment, commit, stage, branch, or data action was performed. Final `HEAD` remained `49614e75140fdf4dee94d916e32b386bef922f1a`, and final git status matched the initial candidate state.
