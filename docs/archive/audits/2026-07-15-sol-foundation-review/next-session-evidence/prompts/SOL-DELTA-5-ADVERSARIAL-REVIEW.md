# Fresh Sol delta-5 adversarial review

You are the mandatory independent post-fix reviewer for the Farm Rx release gate. This is a fresh, read-only review after the delta-4 review blocked release with `FRX-D4-001` through `FRX-D4-005`.

## Runtime and authority

- Report the exact model and reasoning effort shown in the `codex exec` runtime header.
- Do not call Claude, Fable, a sub-agent, another agent, or another model.
- Work read-only. Do not edit source, tests, evidence, git state, or external services.
- Do not stage, commit, push, deploy, apply live migrations, send providers, or mutate Supabase, Vercel, GitHub, email, push, or any other external system.
- Do not read the orchestrator ledger, implementation report, release results, pre-commit decision, Terra/Luna reports, command log, or `NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md`.

## Inputs

Read only the following requirements/evidence plus the source and tests themselves:

- `C:\Users\mason\.codex\attachments\db0e291b-10ec-4faa-ae25-a5e413e7bc09\pasted-text.txt`
- `C:\FarmRx\docs\audits\2026-07-15-sol-foundation-review\REPAIR-ROADMAP.md`
- the complete base `49614e75140fdf4dee94d916e32b386bef922f1a` to working-tree diff, including every untracked candidate code, migration, script, asset, and test
- `C:\FarmRx\docs\audits\2026-07-15-sol-foundation-review\next-session-evidence\prompts\SOL-FINAL-ADVERSARIAL-OUTPUT.md`
- `C:\FarmRx\docs\audits\2026-07-15-sol-foundation-review\next-session-evidence\prompts\SOL-DELTA-2-ADVERSARIAL-OUTPUT.md`
- `C:\FarmRx\docs\audits\2026-07-15-sol-foundation-review\next-session-evidence\prompts\SOL-DELTA-3-ADVERSARIAL-OUTPUT.md`
- `C:\FarmRx\docs\audits\2026-07-15-sol-foundation-review\next-session-evidence\prompts\SOL-DELTA-4-ADVERSARIAL-OUTPUT.md`

Treat these latest proof results as claims to challenge, not as correctness evidence:

- Forced TypeScript, the complete regression command, Vite/PWA production build, npm audit with zero vulnerabilities, static guards, and four controlled mutation drills passed after the delta-4 repairs.
- Fresh PostgreSQL 17 disposable migration suites 0033 through 0040 and the RLS role matrix passed after the delta-4 repairs.
- The complete built-browser suite passed 30/30 across Chromium desktop and phone after the delta-4 repairs.
- A focused queued-operation attack paused entry creation under context A, returned context B at the second lookup, and observed rejection, zero writer calls, and zero queue entries in A or B for Equipment, Grain, Inventory, and Profitability.
- A focused live-writer attack passed expected farm A while the live resolver returned farm B and observed rejection before gateway I/O for all four affected repositories.
- A deferred Profitability A workspace/raw-cost load was overlapped by a completed B load; the A call rejected with `WorkspaceMemoryChangedError` and B remained in both retained workspace and auxiliary raw-cost state.
- Migration 0040 disposable proof rejected a storage move with stale old-farm epoch/current new-farm epoch, accepted the same move with fresh epochs for both farms, and retained the earlier financial-revoke and identity-move checks.
- Focused scheduler proof independently hung initial sweep, field listing, spray recording, and push and observed deadline AbortSignals, bounded rejection, and push-after-record-cancellation ordering.
- Focused push proof observed the real provider timeout argument bounded to the remaining absolute budget and completion reserve, in addition to claim/finish/health AbortSignals.

Do not read implementation rationale or accept claims of correctness. Derive behavior from the current code and personally executed checks.

## Mandatory closure attacks

Re-adjudicate every `FRX-FRESH-001` through `FRX-FRESH-010`, the delta-2 push-budget finding, every delta-3 finding, and every delta-4 finding. Concentrate on:

1. `FRX-D4-001`: trace entry creation, second-source selection, locked queue transaction, replay, operation dispatch, live writer, farm resolution, gateway/RPC/table write, authentication transition, and post-write confirmation for every queued operation kind in Equipment, Grain, Inventory, and Profitability. Attack user A to user B, farm A to farm B, same farm across users, direct saves, queued replay, transport fallback, delayed calls, and every operation that performs an intervening workspace read. Prove stale A work cannot append to B, call a B-bound writer, write a B row, or acquire B audit identity. Check whether the optional expected-farm parameter can be omitted or ignored along any queued path.
2. `FRX-D4-002`: attack Profitability at every pause point: workspace resolution, first guard, raw-cost resolution, second guard, retained assignment, cache construction, IndexedDB transaction, and post-persistence verification. Use concurrent A/B calls and same-scope epoch/token/generation changes. Prove broad transport/best-effort catches cannot swallow `WorkspaceMemoryChangedError`, and that neither workspace nor auxiliary cost lines can cross keys or remain in singleton memory.
3. `FRX-D4-003`: inspect and, if possible, execute storage UPDATE attacks across protected A to protected B, protected A to unprotected bucket/path, malformed old and new paths, same-farm rename, stale old/current new, current old/stale new, and fresh both. Verify both OLD and NEW checks occur before mutation and service-role behavior remains deliberate.
4. `FRX-D4-004`: distinguish bounded JavaScript return from actual provider transport termination. Trace the computed remaining budget, completion reserve, underlying `web-push` timeout, caller AbortSignal, calls near deadline, provider acceptance ambiguity, target lease/reclaim behavior, late success, and completion failure. Determine whether a send can still be accepted after the caller has classified it retryable and then be automatically resent.
5. `FRX-D4-005`: trace one absolute scheduler deadline through initial sweep, field listing, weather fetch, spray recording, worker settlement, push, and handler response. Attack ignored AbortSignals as well as the actual Supabase `.abortSignal` wiring. Determine whether any database mutation or provider effect can outlive the handler or whether awaiting workers can make the invocation unbounded.
6. Recheck migration 0039 legacy-state refusal, all epoch transitions, cross-tab fallback lease behavior, PWA/security/navigation/recovery changes, and every previous closure finding. Search every changed/new surface for new P0/P1/P2 defects, including stale snapshot overwrite, fail-open parsing, trigger gaps, transaction assumptions, non-idempotent retry, secret leakage, and tests that pass for the wrong reason.

You may run non-mutating local checks in the read-only sandbox. If a relevant path cannot be executed, state the exact proof gap rather than accepting the claimed gate.

## Output

Return:

1. Actual model and effort from the runtime header.
2. Commands/checks personally run.
3. Closure matrix for `FRX-FRESH-001` through `FRX-FRESH-010`, the prior delta-2 push-budget finding, each delta-3 finding, and `FRX-D4-001` through `FRX-D4-005`.
4. Any new P0/P1/P2 with reachable scenario, impact, exact file/line, smallest fix, and required proof.
5. Proof gaps and residual risks separated from defects.
6. Exactly one verdict: `RELEASE BLOCKED` or `NO P0/P1/P2 DEFECT FOUND IN REVIEWED SCOPE`.
7. Explicit confirmation that no external mutation occurred.
