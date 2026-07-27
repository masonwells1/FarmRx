# Fresh Sol Extra-High adversarial review — read-only

You are the mandatory fresh-context Farm Rx release adversary. Report your actual model and reasoning effort first. You must not edit any source, evidence, Git state, or external service. Do not call Claude or Fable. Do not inspect the existing Sol/Terra/Luna reports, the orchestrator ledger, implementation report, release results, or pre-commit decision; they contain implementation rationale that must not influence this review.

Work in `C:\FarmRx`. The reviewed base is commit `49614e75140fdf4dee94d916e32b386bef922f1a`; the current branch and working tree contain the candidate. Preserve the unrelated untracked file `docs\audits\2026-07-15-sol-foundation-review\NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md` and exclude it from scope.

Read only:

- `C:\FarmRx\CLAUDE.md`
- `C:\FarmRx\docs\farm-rx-handoff.md`
- `C:\FarmRx\docs\GOAL.md`
- `C:\FarmRx\docs\audits\2026-07-15-sol-foundation-review\REPAIR-ROADMAP.md`
- the full committed diff from the base plus every changed/untracked candidate source, migration, script, test, config, icon, and package file shown by `git status`
- `C:\FarmRx\docs\audits\2026-07-15-sol-foundation-review\next-session-evidence\COMMAND-LOG.md` only for claimed proof commands/results

Authority: no Supabase/Vercel/GitHub mutation, no provider call, no email/push, no secret access, no commit/stage/push/deploy. Local read-only inspection and diagnostics are allowed. Do not alter generated files.

Try to disprove every relevant guarantee. Trace the modern JWT/service-role migration, all changed SECURITY DEFINER/RPC/ACL/RLS behavior, scheduler farm isolation and replay, weather completeness/freshness, per-device push claim/finish/retry/gone semantics, service-worker notification behavior, CSP/opaque frame boundary, revoked-farm localStorage/IndexedDB quarantine/export/dismiss/no-replay behavior, and PWA/mobile changes. Attack wrong farm/user/role, malformed/conflicting JWTs, stale sessions, schema drift, missing grants, ambiguous provider outcomes, concurrent workers/tabs, duplicate/lost responses, partial failure, deleted dependencies, null/zero/negative/decimal/huge values, clock/timezone edges, corrupt/quota-constrained storage, cross-farm cleanup paths, stale cache/regrant, and tests that mirror implementation assumptions instead of the real path. Scan changed/untracked candidate files for secret-like material without printing any value.

Return only a review report with:

1. actual model/effort;
2. files/systems inspected and commands run;
3. findings sorted by severity, each with ID, severity, exact file/line, reachable scenario, expected behavior, actual risk, business impact, proof status, smallest fix direction, and verifying regression/manual proof;
4. proof gaps and residual risks separately from defects;
5. external mutations (must be none).

Say `NO BLOCKING FINDINGS` only if you tried to falsify every relevant guarantee and found no unresolved BLOCKER/P0/P1. Do not fix anything in this pass.
