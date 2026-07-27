# Fresh Sol delta-3 adversarial review

You are the mandatory independent post-fix reviewer for the Farm Rx release gate. This is a fresh, read-only review after the delta-2 review blocked release.

## Runtime and authority

- Report the exact model and reasoning effort shown in the `codex exec` runtime header.
- Do not call Claude, Fable, another agent, or another model.
- Work read-only. Do not edit source, tests, evidence, git state, or external services.
- Do not stage, commit, push, deploy, apply live migrations, send providers, or mutate Supabase, Vercel, or GitHub.
- Do not read the orchestrator ledger, implementation report, release results, pre-commit decision, Terra/Luna reports, or `NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md`.

## Inputs

Read only the following requirements/evidence plus the source and tests themselves:

- `C:\Users\mason\.codex\attachments\db0e291b-10ec-4faa-ae25-a5e413e7bc09\pasted-text.txt`
- `C:\FarmRx\docs\audits\2026-07-15-sol-foundation-review\REPAIR-ROADMAP.md`
- the complete base `49614e75140fdf4dee94d916e32b386bef922f1a` to working-tree diff, including every untracked candidate code, migration, script, asset, and test
- `C:\FarmRx\docs\audits\2026-07-15-sol-foundation-review\next-session-evidence\prompts\SOL-FINAL-ADVERSARIAL-OUTPUT.md`
- `C:\FarmRx\docs\audits\2026-07-15-sol-foundation-review\next-session-evidence\prompts\SOL-DELTA-2-ADVERSARIAL-OUTPUT.md`

Treat these proof results as claims to challenge, not as correctness evidence:

- `npm run verify:foundation`: exit 0 on 2026-07-15 after the final repair.
- The gate included the full regression command, `tsc -b`, Vite/PWA production build, npm audit with zero vulnerabilities, static guards, four controlled mutation drills, disposable PostgreSQL migration suites 0033 through 0040, the RLS role matrix, and 30/30 Playwright tests across desktop and phone.
- The formerly intermittent phone test `a stale tab cannot recreate revoked queue or readable cache work after regrant` also passed 10/10 in a separate repeated run.

Do not read implementation rationale or claims of correctness. Derive behavior from the current code and personally executed checks.

## Mandatory closure attacks

Re-adjudicate every `FRX-FRESH-001` through `FRX-FRESH-010` and the delta-2 push-budget defect. Concentrate on these delta-2 release blockers and their changed surfaces:

1. Farm-access revocation and cache/RPC fencing. Attack primary-fence deletion, missing/corrupt independent metadata, a missing access snapshot, delayed older farm reads, queued writes paused across revoke/regrant, account switches, same-user concurrent tabs, stale IndexedDB data, lower server epochs, and localStorage/Web Locks coordination (including the no-Web-Locks lease fallback). Prove that an old tab cannot cancel a current validation, revive stale work, write a cache under a new grant, or mutate a revoked farm through Data API, storage, or SECURITY DEFINER RPC paths.
2. Database epoch enforcement. Inspect migration ordering, all farm-scoped base tables, storage bucket coverage, farm/member/rep grant transitions, bootstrap exception reachability, service-role bypass, request-header parsing, locks, grants, trigger behavior, SECURITY DEFINER/search_path, and ways to forge or omit epochs. Attack wrong user/farm/role, disabled rep, revoked membership, old JWT, direct REST/storage, and RPC writes.
3. Legacy delivery migration 0039. Prove it refuses legacy failed/claimed/in-flight parents before schema mutation, accepts clean state, retires the old protocol, and cannot duplicate ambiguously delivered devices.
4. Push absolute deadline. Simulate provider hangs, claim hangs, provider success followed by completion failure, completion/health hanging after the deadline, reclaim/retry, many targets, and scheduler abort. Prove no claim/provider/completion/health call begins after abort, in-flight work is bounded, unfinished work remains retryable, and health is honest.
5. Search all changed/new surfaces for new P0/P1/P2 defects, especially lock starvation/deadlock, lease loss, timer or promise leaks, stale snapshot overwrite, fail-open parsing, incomplete SQL trigger coverage, transaction assumptions, idempotency, secret leakage, and tests that pass for the wrong reason.

You may run non-mutating local checks in the read-only sandbox. If a relevant path cannot be executed, state the exact proof gap rather than accepting the claimed gate.

## Output

Return:

1. Actual model and effort from the runtime header.
2. Commands/checks personally run.
3. Closure matrix for `FRX-FRESH-001` through `FRX-FRESH-010` plus the prior delta-2 push-budget finding.
4. Any new P0/P1/P2 with reachable scenario, impact, exact file/line, smallest fix, and required proof.
5. Proof gaps and residual risks separated from defects.
6. Exactly one verdict: `RELEASE BLOCKED` or `NO P0/P1/P2 DEFECT FOUND IN REVIEWED SCOPE`.
7. Explicit confirmation that no external mutation occurred.
