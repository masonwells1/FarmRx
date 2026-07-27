# Farm Rx Sol delta 9 adversarial review

You are the mandatory independent post-fix reviewer for the Farm Rx release gate. This is a brand-new, read-only review after delta 8 blocked release. Work only in `C:\FarmRx` on branch `codex/farmrx-release-gate-proof` at the current uncommitted candidate state based on `49614e75140fdf4dee94d916e32b386bef922f1a`.

## Identity and hard boundaries

- Report the exact model and reasoning effort shown in the `codex exec` runtime header.
- Do not edit any file, Git state, evidence artifact, or external service.
- Do not stage, commit, push, deploy, apply migrations, mutate live data, or call another model.
- Do not read existing Sol/Terra/Luna reports, the orchestrator ledger, command log, release results, pre-commit decision, implementation report, prior adversarial prompts, or prior adversarial output. Review the actual requirements, code, tests, migrations, and current diff independently.
- Read-only commands and disposable local tests are allowed. Do not print secret values.

## Requirements and delta 8 findings claimed fixed

The release must fail closed when the account, selected farm, device revocation fence, or server access epoch changes during any queued, Storage, automatic-alert, or online-only write. An operation may never recapture and bind a later identity. No later remote mutation, local queue/outbox/cache/receipt mutation, or success publication may occur after a mismatch.

Delta 8 reported four open findings. Directly reproduce or negate each:

1. `FRX-D8-001` P1: Scouting upload/delete work was not bound to one operation context across Storage calls. The candidate now captures once before upload, uses an operation-specific Storage client carrying the expected-user and access-epoch headers, verifies before and after every file/upload/cleanup boundary, stops subsequent Storage/DB/queue/outbox work on mismatch, and has deterministic A-to-B and same-scope revoke/regrant races requiring exactly one initial Storage call and zero later mutations.
2. `FRX-D8-002` P1: Grain alert work captured late, client Edge invocation was unbound, and owner revocation could race email delivery. The candidate now captures before Grain data loading, carries the same context through transition and delivery work, sends exact expected-user/epoch headers, verifies after each awaited boundary, and the Edge function checks authenticated user, current active owner membership, and the exact server epoch at entry and immediately before the email-provider request.
3. `FRX-D8-003` P2: four online-only Grain RPCs and Profitability insurance could publish success after the fence changed. Contract delivery, price-leg finalization, firm-offer fill, bin movement, and insurance now verify the original context after the server mutation and again in their queued wrappers. Regressions force the server mutation to succeed, change the fence, and require the public operation to reject.
4. `FRX-D8-004` P2: legacy project-only Scouting cleanup could be claimed by the next revoked user. New cleanup entries are version 2 and keyed/validated by project plus initiating user and farm. Version-1 entries are moved intact to a separate unowned device vault and are never exposed as any user's recovery work. User A revocation can only move User A's partition.

The root reran `scripts/verify-foundation.ps1` after these changes. Its forced TypeScript build, all regression programs including the new Scouting/Grain/Profitability/alert/Edge races, production build, dependency audit, static guards, 4/4 mutation drill, disposable PostgreSQL migrations/probes through 0040, full RLS role matrix, and all 30 Chromium desktop/phone tests passed. The actual `deliver-grain-alert` entrypoint also passed `deno check`.

## Required adversarial work

Trace each delta 8 finding end to end through the real call order, not just named tests. Attack account switch, farm switch, same-user/same-farm revoke/regrant ABA, access-epoch change, auth/RLS denial, lost response, partial upload, cleanup failure, cleanup ownership, transition-loop interruption, provider revocation, and success publication after server acceptance. Verify ordinary PostgREST, RPC, Edge, and Storage requests carry the intended immutable headers and cannot silently rebind.

Then review the entire changed and untracked candidate diff for any remaining P0/P1/P2 release defect. Prioritize wrong-farm/user/role paths, SECURITY DEFINER exposure, RLS/ACL/search_path, queues and needs-attention durability, cache isolation, stale tabs, scheduler cancellation/per-farm containment, per-device push retry/terminal health, PWA/CSP/browser boundaries, and tests that can pass for the wrong reason. Scan candidate files for secret-like material without revealing values. Preserve the unrelated untracked `NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md` and do not treat it as candidate scope.

Use exact file/line evidence and executable read-only repros where useful. Treat cosmetic, pre-existing, or unsupported hypotheticals as non-blocking. Do not claim runtime proof you did not execute.

## Required final format

1. Exact model and reasoning effort.
2. Verdict: `RELEASE CLEARED` only if there is no open P0/P1/P2; otherwise `RELEASE BLOCKED`.
3. Closure table for `FRX-D8-001` through `FRX-D8-004` with code and proof evidence.
4. New findings ordered by severity, each with ID, exact path/line, concrete failure sequence, impact, smallest safe fix, and required regression/manual proof.
5. Commands/tests actually run and their results.
6. Secret-scan result and verification limitations.

If no blocking finding remains, say `NO BLOCKING FINDINGS` plainly and identify any low-risk follow-up separately.
