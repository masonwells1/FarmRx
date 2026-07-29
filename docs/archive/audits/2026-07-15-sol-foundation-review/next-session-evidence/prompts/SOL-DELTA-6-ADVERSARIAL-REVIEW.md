# Fresh Sol delta-6 adversarial review

You are the mandatory independent post-fix reviewer for the Farm Rx release gate. This is a fresh, read-only review after delta 5 found two P1 defects: same-farm A-to-B user switching could re-author an in-flight operation, and Grain/Profitability final queue-lock callbacks could return a newer context's mutable retained workspace.

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
- `C:\FarmRx\docs\audits\2026-07-15-sol-foundation-review\next-session-evidence\SOL-DELTA-5-ADVERSARIAL-OUTPUT.md`

Treat these latest results as claims to challenge, not as correctness evidence:

- Forced TypeScript, the complete 36-program regression command, Vite/PWA production build, npm audit with zero vulnerabilities, static guards, and four controlled mutation drills passed.
- Fresh PostgreSQL 17 disposable suites 0033 through 0040 and the RLS role matrix passed.
- The complete built-browser suite passed 30/30 across Chromium desktop and phone.
- A focused same-farm A-to-B account-switch attack rejected entry creation before writer/queue mutation for Equipment, Grain, Inventory, and Profitability.
- Focused live-repository attacks rejected an A operation context before gateway I/O after authentication moved to same-farm User B.
- Every affected live gateway request is claimed to bind the captured user and exact farm epoch in request headers; migration 0040 is claimed to atomically compare expected user, `auth.uid()`, farm access, and epoch in the mutation transaction.
- A disposable PostgreSQL attack used User B authentication, User A expected-user binding, and a current same-farm epoch; it was rejected with `FARM_ACCESS_EPOCH_CHANGED`, while matching User B/current-epoch direct, RPC, and Storage writes succeeded.
- Deterministic Grain and Profitability attacks paused User A at the final queue lock, completed User B on the same farm, then released A; A rejected with `WorkspaceMemoryChangedError` and retained/returned B state remained B.
- The prior Profitability delayed raw-cost A/B race, storage old/new path fencing, scheduler cancellation, push absolute-budget logic, migration rollout refusal, PWA/security/navigation/recovery, and queue/cache revocation proofs remain green.

Do not accept implementation rationale or test labels. Derive behavior from current code and personally executed checks.

## Mandatory closure attacks

1. Re-adjudicate delta-5 P1 #1 end to end. Trace capture, local verification, queue append/replay, direct calls, optimistic update/insert, every Equipment/Grain/Inventory/Profitability table/RPC mutation, Supabase fetch header construction, PostgREST builder header binding, JWT identity, migration 0040 parsing, service-role bypass, trigger coverage, transaction ordering, confirmation, transport fallback, and retries. Attack same-farm A-to-B switching before and after every await. Determine whether any request can omit, overwrite, forge, or decouple the captured expected user/epoch, or use B authentication/audit identity for A work.
2. Re-adjudicate delta-5 P1 #2 at every Grain and Profitability final-read/overlay/queue-lock/catch/cache path. Pause A at every await while completing same-farm B. Search for all remaining mutable `this.workspace`/auxiliary-cache dereferences and broad catches. Prove A cannot return B, displace B, or turn an identity-fence error into an offline fallback.
3. Attack offline entries and replay after revoke/regrant or account switching. Determine whether recapturing a current fence for a persisted entry allows stale work to resurrect, including entries with only user/farm metadata, storage metadata loss, and quarantine/recovery flows.
4. Re-adjudicate every `FRX-FRESH-001` through `FRX-FRESH-010`, the delta-2 push-budget finding, every delta-3 finding, and `FRX-D4-001` through `FRX-D4-005`. Recheck storage OLD/NEW moves, migration 0039 refusal, epoch transitions/trigger gaps, queue fallback leases, scheduler/provider cancellation and idempotency, PWA/CSP/navigation/recovery, secrets, and stale snapshot overwrite.
5. Search every changed/new surface for a new P0/P1/P2 defect. Treat tests that can pass for the wrong reason as defects or proof gaps, as appropriate.

You may run non-mutating local checks in the read-only sandbox. If a relevant path cannot be executed, state the exact proof gap rather than accepting the claimed gate.

## Output

Return:

1. Actual model and effort from the runtime header.
2. Commands/checks personally run.
3. Closure matrix for the two delta-5 P1 defects, `FRX-FRESH-001` through `FRX-FRESH-010`, the prior delta-2 push-budget finding, every delta-3 finding, and `FRX-D4-001` through `FRX-D4-005`.
4. Any new P0/P1/P2 with reachable scenario, impact, exact file/line, smallest fix, and required proof.
5. Proof gaps and residual risks separated from defects.
6. Exactly one verdict: `RELEASE BLOCKED` or `NO P0/P1/P2 DEFECT FOUND IN REVIEWED SCOPE`.
7. Explicit confirmation that no external mutation occurred.
