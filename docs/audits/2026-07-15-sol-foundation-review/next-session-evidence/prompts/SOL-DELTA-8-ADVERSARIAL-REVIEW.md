# Farm Rx Sol delta 8 adversarial review

You are the mandatory independent post-fix reviewer for the Farm Rx release gate. This is a brand-new, read-only review after delta 7 blocked release. Work only in `C:\FarmRx` on branch `codex/farmrx-release-gate-proof` at the current uncommitted candidate state based on `49614e75140fdf4dee94d916e32b386bef922f1a`.

## Identity and hard boundaries

- Report the exact model and reasoning effort shown in the `codex exec` runtime header.
- Do not edit any file, Git state, evidence artifact, or external service.
- Do not stage, commit, push, deploy, apply migrations, mutate live data, or call another model.
- Do not read existing Sol/Terra/Luna reports, the orchestrator ledger, command log, release results, pre-commit decision, implementation report, or any prior adversarial output. Review the actual code, tests, migrations, and current diff independently.
- Read-only commands and disposable local tests are allowed. Do not print secret values.

## Delta 7 blocker claimed fixed

`FRX-D7-001`: queued Harvest work could start under User A, wait behind a queue lock, resume after the active session changed to User B on the same farm, and execute the live write as User B without leaving a recovery entry. The candidate now carries one exact `FarmOperationContext` from operation start through the queued repository, writer, and bound Supabase request. It verifies the original user, farm, revocation generation/token, and server access epoch before and after awaited boundaries and immediately before queue, workspace, write, receipt, and removal mutations.

The same operation-binding repair was applied to Fields, Field Log, Scouting, Programs, Notifications, Field Location, equipment due generation, program due generation, and grain-alert state transitions. Equipment, Grain, Inventory, and Profitability retain the corresponding delta 6 binding. Deterministic regressions exercise both account-switch and same-account/same-farm revoke/regrant ABA races and require zero writer calls and zero queue/workspace mutation.

The root reran `scripts/verify-foundation.ps1` after these changes. Its forced TypeScript build, all 36 regression programs, production build, dependency audit, static guards, 4/4 mutation drill, disposable PostgreSQL migrations/probes through 0040 and RLS role matrix, and all 30 Chromium desktop/phone tests passed.

## Required adversarial work

First, directly reproduce or negate `FRX-D7-001` in Harvest. Then inspect every repaired write surface named above and every remaining queued or automatic writer in the candidate. Follow actual execution ordering through operation capture, mutable context lookup, lock acquisition, offline/transport fallback, retained-workspace overlay, bound request construction, writer completion, replay reconciliation, queue removal, and revoke/regrant ABA transitions. Prove that a changed user, farm, revocation fence, or server epoch fails closed before remote mutation or local publication.

Pay special attention to writers that perform a canonical read after a mutation, delete reconciliation, photo/storage cleanup, multi-call Program operations, scheduler-triggered work, capability probes, and any path that can recapture context after the operation has begun. Verify that ordinary PostgREST, RPC, and Storage calls use the intended bound identity/fence semantics and that non-transport auth/RLS failures never enter confirmation or dequeue active work.

Then search the entire changed and untracked candidate diff for any P0/P1/P2 release defect. Prioritize account/farm/epoch binding, stale session races, queue and needs-attention durability, cache isolation, revoke/regrant behavior, SQL RLS/RPC/ACL/search_path, scheduler cancellation and per-farm containment, per-device push claim/finish/retry/terminal health, browser/PWA/CSP boundaries, and tests that can pass for the wrong reason. Scan candidate files for secret-like material without revealing values.

Use exact file/line evidence and executable read-only repros where useful. Treat cosmetic, pre-existing, or unsupported hypotheticals as non-blocking. Do not claim a runtime proof you did not execute.

## Required final format

1. Exact model and reasoning effort.
2. Verdict: `RELEASE CLEARED` only if there is no open P0/P1/P2; otherwise `RELEASE BLOCKED`.
3. `FRX-D7-001` closure with code and proof evidence.
4. Operation-binding coverage table for Harvest, Fields, Field Log, Scouting, Programs, Notifications, Field Location, Equipment, Grain, Inventory, Profitability, equipment due generation, program due generation, and grain-alert transitions.
5. New findings ordered by severity, each with ID, exact path/line, concrete failure sequence, impact, smallest safe fix, and required regression proof.
6. Commands/tests actually run and their results.
7. Secret-scan result and any verification limitations.

If no blocking finding remains, say `NO BLOCKING FINDINGS` plainly and identify any low-risk follow-up separately.
