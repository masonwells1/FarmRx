# Fresh Sol delta-4 adversarial review

You are the mandatory independent post-fix reviewer for the Farm Rx release gate. This is a fresh, read-only review after the delta-3 review blocked release.

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
- `C:\FarmRx\docs\audits\2026-07-15-sol-foundation-review\next-session-evidence\prompts\SOL-DELTA-3-ADVERSARIAL-OUTPUT.md`

Treat these proof results as claims to challenge, not as correctness evidence:

- Forced TypeScript, the complete 36-program regression command, Vite/PWA production build, npm audit with zero vulnerabilities, static guards, and four controlled mutation drills passed after the delta-3 repairs.
- Fresh PostgreSQL 17 disposable migration suites 0033 through 0040 and the RLS role matrix passed after the delta-3 repairs.
- The complete built-browser suite passed 30/30 across Chromium desktop and phone after the delta-3 repairs.
- A direct sequential cross-account attack on the singleton Fields repository failed closed instead of exposing User A data to User B.
- The 0040 disposable proof advanced a member epoch on `can_view_financials` true-to-false revocation.
- Claim, completion, and health database operations each observed the absolute-deadline AbortSignal in focused push regression proof.
- The corrupt far-future no-Web-Locks lease attack recovered within one second.

Do not read implementation rationale or accept claims of correctness. Derive behavior from the current code and personally executed checks.

## Mandatory closure attacks

Re-adjudicate every `FRX-FRESH-001` through `FRX-FRESH-010`, the delta-2 push-budget defect, and every delta-3 defect. Concentrate on these changed surfaces:

1. In-memory repository isolation. Attack all singleton queued repositories that retain workspaces, not just Fields: user switch, farm switch, same farm across different users, epoch/token/generation change, financial permission revoke, transport fallback, delayed A response resolving after B begins or succeeds, concurrent calls, replay/save completion after context change, and cached/raw auxiliary state. Prove no retained workspace or auxiliary cache can cross its exact `{projectRef,userId,farmId,generation,token,serverEpoch}` guard. Check that any retry after a fence change cannot recurse without bound or expose the rejected response.
2. Database epoch transitions. Prove `can_view_financials` revoke bumps the epoch. Attack updates that move membership or rep-access identity/farm keys and verify both old and new grants advance. Check old/new farm guards, bootstrap exceptions, direct REST/storage/SECURITY DEFINER paths, service-role bypass, header parsing, grants, locks, all farm-scoped tables, and ways to omit or forge epochs.
3. Cross-tab coordination fallback. Attack malformed, non-finite, negative, enormous, and just-beyond-horizon lease expiries; a valid lease continuously renewed by another tab; clock skew; lease theft/loss; acquisition timeout; timer cleanup; localStorage write/read mismatch; and absence of Web Locks. Prove acquisition is bounded and no concurrent writer enters after loss.
4. Push deadline and cancellation. Attack provider, claim, finish, and health hangs; promises that ignore AbortSignal; real Supabase RPC query cancellation wiring; retry loops; timer/promise leaks; calls beginning at or after abort; provider success followed by completion failure; many targets; scheduler abort; reclaim. Distinguish bounded caller return from actual underlying request cancellation and later mutation.
5. Recheck migration 0039 legacy-state refusal and all previous closure findings. Search every changed/new surface for new P0/P1/P2 defects, including stale snapshot overwrite, fail-open parsing, trigger gaps, transaction assumptions, idempotency, secret leakage, and tests that pass for the wrong reason.

You may run non-mutating local checks in the read-only sandbox. If a relevant path cannot be executed, state the exact proof gap rather than accepting the claimed gate.

## Output

Return:

1. Actual model and effort from the runtime header.
2. Commands/checks personally run.
3. Closure matrix for `FRX-FRESH-001` through `FRX-FRESH-010`, the prior delta-2 push-budget finding, and each delta-3 finding.
4. Any new P0/P1/P2 with reachable scenario, impact, exact file/line, smallest fix, and required proof.
5. Proof gaps and residual risks separated from defects.
6. Exactly one verdict: `RELEASE BLOCKED` or `NO P0/P1/P2 DEFECT FOUND IN REVIEWED SCOPE`.
7. Explicit confirmation that no external mutation occurred.
