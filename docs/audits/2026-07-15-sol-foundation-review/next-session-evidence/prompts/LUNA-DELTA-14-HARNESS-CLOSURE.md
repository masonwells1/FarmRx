# Farm Rx independent Luna harness-P1 closure check

Report the actual model and reasoning effort first. Work read-only in `C:\FarmRx`. Do not edit files, Git state, or external services. Do not call other models. Exclude the unrelated untracked `docs/audits/2026-07-15-sol-foundation-review/NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md` from candidate scope.

Re-adjudicate only the P1 you identified in `scripts/verify-foundation.ps1`: intermediate disposable database/RLS exit codes could be ignored before the final Playwright result.

Inspect the current runner, static guard, mutation drill, and final command topology. Confirm:

- all 16 foundation commands are checked, present exactly once, and remain ordered;
- native nonzero and child-script failures cannot reach the PASS line;
- the runner resets stale `$LASTEXITCODE` safely without masking a child failure;
- the controlled exit-23 probe exercises the same runner used by real lanes;
- removing the checked 0033 wrapper changes the file and makes the static mutation fail;
- the final full-gate evidence statement is consistent with current topology: controlled failure probe PASS, 39 regressions, 11/11 mutations, disposable migrations through 0041, RLS matrix, 32/32 browser checks, final PASS.

Do not reopen the already-recorded stale evidence-document inconsistency; the orchestrator will refresh the durable packet only after this closure review. Report any remaining P0/P1/P2 in the harness with exact line and correction, proof limitations, files changed (must be none), and external changes (must be none). Use `NO BLOCKING FINDINGS` only if your harness P1 is closed and no new P0/P1/P2 is present in this delta.
