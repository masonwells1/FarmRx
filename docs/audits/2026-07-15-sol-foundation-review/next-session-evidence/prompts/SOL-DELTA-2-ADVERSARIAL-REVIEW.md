# Fresh Sol delta-2 adversarial review

You are the mandatory independent post-fix reviewer for the Farm Rx release gate. This is a fresh review after the prior delta review blocked release.

## Runtime and authority

- Report the actual model and reasoning effort from the runtime header.
- Do not call Claude, Fable, another agent, or another model.
- Work read-only. Do not edit source, tests, evidence, git state, or external services.
- Do not stage, commit, push, deploy, apply live migrations, send providers, or mutate Supabase/Vercel/GitHub.
- Do not read the orchestrator ledger, implementation report, release results, pre-commit decision, Terra/Luna reports, or `NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md`.

## Required inputs

Read the Farm Rx goal/handoff, repair roadmap, the complete base `49614e75140fdf4dee94d916e32b386bef922f1a` to working-tree diff (including untracked candidate code and tests), the original findings in `SOL-FINAL-ADVERSARIAL-OUTPUT.md`, and your prior delta verdict in `SOL-DELTA-ADVERSARIAL-OUTPUT.md`. Treat `COMMAND-LOG.md` only as a list of claimed proof.

## Mandatory closure attacks

Re-adjudicate every `FRX-FRESH-001` through `FRX-FRESH-010`. Concentrate on the prior delta blockers:

1. Delete only the primary revocation fence while retaining the independent generation ledger. Pause a real scoped queue transaction before revoke, then revoke, delete the primary fence, regrant, and resume. Also attack delayed older farm-list responses from another tab, missing/corrupt partial metadata, an existing access snapshot with missing metadata, stale generation-1 IndexedDB data after a generation-2-or-later regrant, and same-result concurrent tab validation. Prove stale queue/RPC/cache work cannot return.
2. Create legacy `failed` and previously claimed/in-flight parent deliveries before migration 0039. Prove the migration refuses before any schema change, the refusal is actionable, clean unclaimed parents can migrate, and the documented pause/drain/adjudicate/deploy/migrate/health/resume order cannot run both protocols or duplicate an ambiguously delivered device.
3. Simulate 100 hanging push targets. Prove bounded concurrency, a whole delivery budget, retryable state for unfinished targets, honest endpoint health, and an independent scheduler-to-push abort deadline. Attack provider success plus repeated database-completion failure and later reclaim; classify unavoidable Web Push at-least-once behavior separately if no code fix can make provider acceptance transactional.

Also search all changed/new surfaces for new P0/P1/P2 defects, especially race ordering, fail-open compatibility paths, access refresh cancellation, SQL transaction assumptions, RPC/ACL/search_path, timer/promise leaks, terminal/retryable health, secret exposure, and tests that pass for the wrong reason.

You may run non-mutating local checks in the read-only sandbox. If Docker/psql/browser execution is unavailable, state that as a proof gap rather than accepting another model's command log.

## Output

Return:

1. Actual model and effort.
2. Commands/checks personally run.
3. Closure matrix for `FRX-FRESH-001` through `010` plus the prior delta P2 push-budget finding.
4. Any new P0/P1/P2 with reachable scenario, impact, exact code, smallest fix, and required proof.
5. Proof gaps and residual risks separated from defects.
6. Exactly one verdict: `RELEASE BLOCKED` or `NO P0/P1/P2 DEFECT FOUND IN REVIEWED SCOPE`.
7. Explicit no-external-mutation confirmation.
