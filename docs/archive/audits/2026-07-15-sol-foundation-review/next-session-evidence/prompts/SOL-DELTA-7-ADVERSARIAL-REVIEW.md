# Farm Rx Sol delta 7 adversarial review

You are the mandatory independent post-fix reviewer for the Farm Rx release gate. This is a brand-new, read-only review after delta 6 blocked release. Work only in `C:\FarmRx` on branch `codex/farmrx-release-gate-proof` at the current uncommitted candidate state based on `49614e75140fdf4dee94d916e32b386bef922f1a`.

## Identity and hard boundaries

- Report the exact model and reasoning effort shown in the `codex exec` runtime header.
- Do not edit any file, Git state, evidence artifact, or external service.
- Do not stage, commit, push, deploy, apply migrations, mutate live data, or call another model.
- Do not read existing Sol/Terra/Luna reports, the orchestrator ledger, command log, release results, pre-commit decision, or implementation report. Review the actual code, tests, migration, and diff independently.
- Read-only commands and disposable local tests are allowed. Do not print secret values.

## Delta 6 blockers that are claimed fixed

1. `FRX-D6-001`: Equipment, Grain, Inventory, and Profitability operations formerly captured an entry under access epoch 1, then recaptured context inside `save()` and could write or enqueue under epoch 2 after revoke/regrant. The candidate now carries the first full `FarmOperationContext` into `save()`, verifies it against the exact current memory/revocation fence before queue-lock work, before append, and after awaited writes, and rejects a changed account/farm/epoch.
2. `FRX-D6-002`: a delayed Grain or Profitability offline enqueue formerly could resume after same-farm user B loaded the singleton workspace and mutate B's retained state. The candidate now revalidates active identity, the original operation context, and the memory guard inside the queue lock immediately before append/overlay.
3. `FRX-D6-003`: replay formerly called delete reconciliation before classifying an error, so an identity/RLS failure followed by an empty wrong-user workspace could be treated as proof that A's delete succeeded and silently remove A's queue entry. The candidate now permits reconciliation only after a genuine transport ambiguity, removes absence-based delete reconciliation, keeps only exact positive reconciliation for immutable inserts/appends, and requires bound delete responses to return the deleted ID instead of accepting an unbound absence read.
4. `FRX-FRESH-006`: a push target stranded as `sending` with `attempts=10` after a lost completion write was excluded from both retry and terminal health. `get_push_delivery_health` now treats both `sending` and `failed` targets at 10 attempts as terminal; the disposable PostgreSQL proof explicitly simulates the lost finish.

Deterministic regression proof was added for all four same-account regrant races, Grain/Profitability save-lock workspace contamination, Equipment/Grain RLS-hidden delete replay, and the stranded tenth push attempt. The root has rerun `scripts/verify-foundation.ps1`: forced TypeScript, all 36 regression programs, production build, `npm audit` with zero vulnerabilities, static guards, 4/4 mutation drill, migrations 0033-0040 plus RLS role matrix on disposable PostgreSQL 17, and 30/30 Chromium desktop/phone tests all passed.

## Required adversarial work

First, directly reproduce or negate each delta 6 blocker against the repaired code. Inspect ordering at every async boundary: public operation construction, the second repository context lookup, queue-lock acquisition, offline/transport fallback, retained-workspace overlay, writer completion, replay reconciliation, queue removal, and access revoke/regrant ABA transitions. Verify that non-transport auth/RLS failures never enter confirmation and never dequeue the active entry. Inspect Equipment, Grain, Inventory, and Profitability, not just one representative.

Then search the entire changed and untracked candidate diff for any new or remaining P0/P1/P2 release defect. Prioritize account/farm/epoch binding, ordinary PostgREST and Storage headers, stale session races, delete/optimistic-save ambiguity, queue and needs-attention durability, cache isolation, revoke/regrant behavior, SQL RLS/RPC/ACL/search_path, scheduler cancellation and per-farm containment, per-device push claim/finish/retry/terminal health, browser/PWA/CSP boundaries, and tests that can pass for the wrong reason. Scan candidate files for secret-like material without revealing values.

Use exact file/line evidence and executable repros where useful. Treat cosmetic, pre-existing, or unsupported hypotheticals as non-blocking. Do not claim a runtime proof you did not execute.

## Required final format

1. Exact model and reasoning effort.
2. Verdict: `RELEASE CLEARED` only if there is no open P0/P1/P2; otherwise `RELEASE BLOCKED`.
3. Delta 6 closure table for all four blocker IDs with code and proof evidence.
4. New findings ordered by severity, each with ID, exact path/line, concrete failure sequence, impact, smallest safe fix, and required regression proof.
5. Commands/tests actually run and their results.
6. Secret-scan result and any verification limitations.

If no blocking finding remains, say that plainly and identify any low-risk follow-up separately.
