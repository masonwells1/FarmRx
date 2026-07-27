## Findings

1. **MEDIUM — a delayed cross-tab deletion can erase a newer accepted login.**

   [AuthProvider.tsx:310](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/AuthProvider.tsx:310) trusts the historical `StorageEvent.newValue === null` and immediately calls `applySignedOutFence()` without confirming the shared auth key is still absent. That fence clears current auth bytes and writes a signed-out intent at [AuthProvider.tsx:230](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/AuthProvider.tsx:230).

   Reachable sequence:

   1. Tab A signs out; its auth-key deletion is queued asynchronously.
   2. Before Tab B processes that event, Tab B completes a valid password sign-in and persists newer exact session bytes plus an accepted intent.
   3. Tab B then receives Tab A’s old deletion event.
   4. The handler does not re-read the current auth key, so it clears the newer session and publishes a durable signed-out fence.

   The fixture correctly makes storage propagation asynchronous at [queuedOperationContext.regression.ts:73](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/queuedOperationContext.regression.ts:73), but it settles propagation before beginning replacement sign-ins at lines 856–881 and 1002–1011. It therefore cannot catch this window.

   The related rollback helper also mixes a shared `priorPersistedIntent` with provider-local `priorTrustedSnapshot` state at [AuthProvider.tsx:398](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/AuthProvider.tsx:398). During asynchronous propagation those can describe different sessions, allowing a failed attempt to restore stale bytes beneath a newer accepted intent.

2. **MEDIUM — the repaired race matrix still does not prove exact accepted bytes and intent for every required race.**

   The older returned-error assertion at [queuedOperationContext.regression.ts:932](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/queuedOperationContext.regression.ts:932) verifies only user and refresh token. The auth-js-style success assertion at [queuedOperationContext.regression.ts:994](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/queuedOperationContext.regression.ts:994) does the same. The throw case proves raw session bytes but not the accepted intent. Only the commit-error and delayed-cleanup cases approach the required exactness.

   A mutation that changes the access token/session lineage or accepted intent while preserving user and refresh fields can therefore remain green. That is a release-blocking proof-quality gap under this gate.

## Closure and wider review

The original Review-22 fallback defect is repaired in source: an accepted intent is compared against the persisted session’s exact user/JWT `sub` and `session_id` before offline restoration at [AuthProvider.tsx:342](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/AuthProvider.tsx:342). The mismatch, durable-remount, delayed-cleanup, and competing-race fixtures are present. `verify-0042-disposable.ps1` is wired into the durable orchestrator, which contains exactly 18 checked lanes, and the static guard requires all nine numbered database probes including 0042.

No additional HIGH or MEDIUM finding emerged from the sampled queue, seven-day/clock rollback, pure-snapshot, Fields/flex, farm rollback, Equipment/service provenance, Program provenance, strict mock, or final operational-RLS paths. The Supabase review specifically checked RLS `USING`/`WITH CHECK`, grants, private helpers, hardened search paths, caller checks, and advisory-lock ordering.

## Scope and proof reconciliation

- HEAD: exact base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`
- Scope: 42 tracked changes + 4 non-audit untracked = exactly 46
- Staged: 0
- Routes: ordered 18/18 identical to base
- Option 2 SHA-256: exact `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`
- Regression manifest: exactly 39 lanes
- Independently rerun: foundation static guard PASS; scope, routes, hash, lane wiring, and credential hygiene reconciled
- Credential scan: 46 files, 0 real credential findings; fixed disposable-container password assignments were test fixtures
- Fresh outer TypeScript, regression, build, audit, mutation, and nine PostgreSQL PASS reports are consistent with the inspected wiring, but they do not exercise the race above

The focused regression could not be independently executed inside this read-only sandbox because `tsx` attempted to create `C:\Users\mason\AppData\Local\Temp\tsx-CodexSandboxOffline` and received `EPERM`. Browser, Playwright, phone, live-service, Docker/PostgreSQL, build-output, and network-audit lanes were not rerun here.

LOW follow-up: make the ordered full 18-route comparison durable; the current foundation guard checks inclusion of only 12 module routes.

Actual model/effort: not visible inside this runtime, so I cannot independently substantiate `gpt-5.6-sol` or Extra High.

**NO-GO**

External mutation: no
