# Sol xhigh final adversarial gate 2 — Farmer Simplicity tranche 1

You are the final release-gate orchestrator in a fresh, read-only `gpt-5.6-sol` session. Inspect the repository directly and distrust all prior completion claims. Do not edit any file, create artifacts, change Git state, commit, push, deploy, call live services, use a browser/Playwright, mutate a database, or reveal credentials. The outer runner alone writes your final response to the named audit output.

Review the complete frozen checkpoint against base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`. The intended code/test scope is exactly the 18 files in `SCOPE-CORRECTION.md`: 17 modified tracked files plus new `src/data/deviceClockFence.ts`. The audit directory is evidence-only and excluded from the future commit.

Attack the whole checkpoint, especially every previously reported defect and its repair:

1. Prove online and queued Equipment/Tasks writes share fail-closed queue-entry validation before any writer, queue, receipt, or sync-status mutation. Probe numeric precision/range and forged manual, service, scouting, and program linkage.
2. Prove Fields canonical validation enforces structural, relationship, date, numeric precision/range, planted-acre, arrangement-type, flex-formula, and one-current-arrangement invariants through live, retained, cold-cache, nested Equipment, and post-overlay paths.
3. Prove Equipment canonical validation requires real booleans, enforces numeric and relationship invariants, handles only DB-legal deleted-parent history by explicit manual normalization, rejects duplicate/malformed due rows, and covers cold-cache corruption without writes, notices, or IndexedDB creation/upgrades.
4. Prove Fields and Equipment snapshots are genuinely side-effect-free: no queue replay, writers, due generation, cache writes/upgrades, notice publication, retained-state mutation, receipt mutation, sync-status mutation, or ability to authorize a later save. Check live, retained, cold, expired, clock-rollback, context-switch, and rejected-access paths.
5. Prove access-profile publication is simultaneously fenced by account, farm, generation, token, and server epoch; named reps cannot enter membership-only modules; private financial modules remain capability-gated; read-only members cannot reach edit routes or write replays; production navigation, routes, startup/reconnect work, and due generation consume the profile consistently.
6. Inspect the exact E2E request mocks for strict select/filter/order/body matching on farms, membership, rep, Fields dependencies, helper RPCs, and account replacement. Distinguish authored browser coverage from executed proof: the browser lane is intentionally unrun.
7. Reconcile all 18 files, TypeScript correctness, regressions, diff hygiene, secrets/debug leakage, and any behavior outside tranche 1. Do not accept tautological tests.

You may run read-only inspection, `git diff`, no-emit TypeScript, and focused regressions with `TSX_DISABLE_CACHE=1`. Do not run build, Playwright/browser, network, live-service, database, or production commands.

Return:

- Findings first, ordered BLOCKER, HIGH, MEDIUM, LOW, with exact file/line evidence and smallest safe correction.
- A categorical `GO` only if there is no actionable finding at any severity; otherwise `NO-GO`.
- Commands/probes and results.
- Exact 18-file reconciliation and residual unexecuted risk.
- `External mutation: no` only if true.
