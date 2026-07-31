# Farm Rx Sol–Terra–Luna Release-Gate Loop

> **Historical record — superseded 2026-07-31.** This plan is preserved for
> audit provenance only. Its draft-PR release-gate work was subsequently
> completed through later governed evidence and is no longer an executable
> next-session instruction. Current status and next actions are controlled by
> `docs/GOAL.md`, `docs/season-readiness/SCORECARD.md`, and the append-only
> `docs/season-readiness/LEDGER.md`.

**Purpose:** paste-ready operating loop for a new Codex session
**Status:** plan only; not executed
**Orchestrator:** `gpt-5.6-sol`, Extra High
**Target:** finish the five release gates left by draft PR #1 without adding features
**Commit rule:** no commit until Sol's adversarial review, Terra/Luna cross-checks, all required proof, and Mason's explicit approval

## How Mason starts the next session

1. Open a fresh Codex task in `C:\FarmRx`.
2. Select `gpt-5.6-sol` with **Extra High** reasoning for the main task.
3. Paste the kickoff prompt below.
4. Answer the orchestrator's one consolidated authority question before it performs any non-production deployment/database change.
5. Do not approve a commit until the orchestrator presents the pre-commit evidence packet.

## Paste-ready kickoff prompt

```text
You are the primary Farm Rx release-gate orchestrator.

MODEL AND EFFORT
- Run this root task as gpt-5.6-sol at Extra High reasoning.
- Explicitly delegate bounded work to these subagent roles:
  1. Sol worker: gpt-5.6-sol at High for risk-sensitive implementation and focused proof.
  2. Terra worker: gpt-5.6-terra at Medium for browser/PWA/workflow verification and well-scoped repairs.
  3. Luna worker: gpt-5.6-luna at Low or Medium for mechanical inventory, command/result reconciliation, secret/scope scanning, and durable evidence.
- After implementation, run a mandatory Sol adversarial review at Extra High. Use a fresh Sol thread with no implementation rationale in context; give it only the requirements, current diff, and proof results. If the surface cannot reset the Sol worker context, spawn a second Sol review thread.
- If the current surface cannot pin a subagent model, do not silently substitute. Use a headless `codex exec` worker with the requested `-m` model and explicit `model_reasoning_effort`, absolute prompt/output paths, and closed stdin. If a requested model is unavailable, report that exact blocker and ask Mason before substituting.

MISSION
Take Farm Rx from the branch verdict CONDITIONALLY SOLID toward release-ready by completing the five gates in:
  C:\FarmRx\docs\audits\2026-07-15-sol-foundation-review\REPAIR-ROADMAP.md

The starting implementation is draft PR #1:
  https://github.com/masonwells1/FarmRx/pull/1
  branch: codex/farmrx-foundation-repair

Do not add product features. Fix only defects directly revealed by release-gate proof.

READ FIRST
1. C:\FarmRx\CLAUDE.md
2. C:\FarmRx\docs\farm-rx-handoff.md
3. C:\FarmRx\docs\GOAL.md
4. All files under C:\FarmRx\docs\audits\2026-07-15-sol-foundation-review\
5. Current branch, PR #1, code, migrations, Edge Functions, tests, scripts, workflows, and config
6. Current official Supabase changelog/docs for any Supabase action

STARTING AUTHORITY AND QUESTIONS
- Begin read-only.
- Inspect the actual branch, remotes, worktree status, PR head, check results, configured service access, and available non-production environments.
- Recommend a fresh branch named codex/farmrx-release-gate-proof based on the verified PR #1 head. Do not overwrite or discard any existing work.
- Ask Mason one consolidated question covering:
  a. the exact non-production Supabase project allowed for migration/function tests;
  b. whether preview/staging deployment changes are authorized;
  c. whether physical-device push/email testing is available and which test accounts/devices may receive it;
  d. whether local code changes are approved within this loop.
- Commit and push are NOT pre-approved. Stop at the pre-commit gate and ask separately after showing the evidence packet.
- Production migrations, production settings/data, production deploy, customer email/push, merge, main/production push, secret rotation, billing, and deletion are never implied. Each needs explicit current-session authority.

AGENT COORDINATION RULES
- Keep the root orchestrator focused on requirements, authority, decisions, evidence, and integration.
- Parallelize read-only reconnaissance, browser inspection, log analysis, and test review.
- Allow only one code/config/migration writer at a time. Never let Sol, Terra, and Luna edit overlapping files concurrently.
- The orchestrator owns assignments and integration. Every task must have a bounded file/system scope, expected output, proof command, and stop condition.
- Every agent must report its actual model/effort, files read, files changed, commands run, exact failures, residual risks, and whether it performed any external mutation.
- A subagent exit code of zero is not proof. Verify its output artifact, `git status`, diff, and named proof.
- For headless workers, follow CLAUDE.md: absolute `C:\FarmRx\...` prompt/output paths, closed stdin (`< /dev/null` from Git Bash), and a 15-minute no-progress watchdog. Kill and relaunch a stalled worker with a fresh prompt; never wait indefinitely.
- Do not call Claude or Fable. The one authorized Fable review already occurred.

EVIDENCE DIRECTORY
Create review artifacts only under:
  C:\FarmRx\docs\audits\2026-07-15-sol-foundation-review\next-session-evidence\

Maintain:
- ORCHESTRATOR-LEDGER.md
- SOL-IMPLEMENTATION-REPORT.md
- SOL-ADVERSARIAL-REVIEW.md
- TERRA-WORKFLOW-REVIEW.md
- LUNA-SCOPE-AND-PROOF-REVIEW.md
- RELEASE-GATE-RESULTS.md
- PRE-COMMIT-DECISION.md
- COMMAND-LOG.md

THE CLOSED LOOP

PHASE 0 — PREFLIGHT AND AUTHORITY
1. Re-read source-of-truth documents.
2. Verify PR #1 head and green checks; do not trust old summaries.
3. Verify clean/dirty state and preserve unrelated work.
4. Inventory installed/authenticated/usable states separately for GitHub, Supabase, Vercel, browser, iOS/Android devices, email, and push.
5. Ask the consolidated authority question. Record the answer verbatim in the ledger.
Gate: exact environment and mutation boundary are known; no live action occurred.

PHASE 1 — PARALLEL READ-ONLY RECONNAISSANCE
- Sol worker: trace migrations 0036-0037, RLS/RPC/Edge/scheduler/security dependencies and design the highest-risk attacks.
- Terra worker: trace preview routes, CSP/iframe behavior, PWA/device/offline/revocation flows, and the user-visible acceptance path.
- Luna worker: inventory branch/PR drift, commands, configs, workflow secrets by name only, existing proof, missing proof, and artifact consistency.
- All three are read-only. Wait for all results.
- Orchestrator deduplicates findings, challenges assumptions, and writes the executable slice plan.
Gate: every release gate has an owner, real-path proof, rollback/stop condition, and authority classification.

PHASE 2 — NON-PRODUCTION DATABASE GATE
Only if explicitly authorized:
1. Refresh the official Supabase changelog and relevant docs.
2. Compare non-production migration high-water, RPC signatures, grants, policies, buckets, and Data API exposure to Git.
3. Review migrations 0036-0037 and run database advisors before apply where supported.
4. Apply only to the named non-production project.
5. Rerun stale-session, full-child-set, lost-response receipt, legacy-RPC denial, role/RLS, fixed-clock scheduler, and duplicate-replay attacks through the deployed API path.
6. Prove wrong-farm, wrong-user, missing-role, rep-off/on, revoked user, null, zero, negative, precision, and very-large-value behavior.
Gate: deployed non-production attacks pass, drift is explained, and no production project was touched.

PHASE 3 — EDGE AND SCHEDULER GATE
Only if explicitly authorized:
1. Bundle and deploy the scheduled sweep and revised delivery function to the named non-production project.
2. Configure secrets through the approved service; never print, copy into artifacts, or commit values.
3. Invoke twice with a fixed test clock. Prove one business event, one delivery row, and no duplicate.
4. Inject weather failure, push failure, request-success/response-loss, retry, and partial failure.
5. Inspect structured logs and queue retryability.
Gate: app-closed Program, scoped marketing, and approved spray transitions occur exactly once in the test environment.

PHASE 4 — PREVIEW HEADER AND HOSTILE-FRAME GATE
Only if explicitly authorized:
1. Use the approved preview/staging deployment.
2. Inspect actual response headers on login, every SPA route, assets, and `/market-quote-frame.html`.
3. Prove authenticated pages run first-party scripts only; TradingView is permitted only inside the opaque sandbox frame.
4. Repeat hostile parent DOM, localStorage, IndexedDB, cookie/session, navigation, and frame-origin attacks.
5. Prove Supabase, Open-Meteo, fonts, PWA, and quotes still work.
Gate: deployed headers match intent without breaking required requests.

PHASE 5 — DEVICE, ROLE, PUSH, AND EMAIL GATE
Only on specifically approved test devices/accounts:
1. Install on iOS and Android; load every core module, force-close, go offline, reopen, create/edit/delete, close/reopen, reconnect, and inspect canonical rows.
2. Exercise quota/storage pressure, cache expiry, browser crash timing, and offline revocation.
3. Test owner, manager, worker, read-only, rep-off, rep-on, revoked rep, and stranger accounts.
4. Receive one app-closed test push and one controlled test email. Never contact customers.
5. Include scouting photo upload/offline/delete/cleanup retry and cross-farm path rejection.
Gate: physical and authorization behavior matches the local/disposable proof.

PHASE 6 — SERIALIZED REPAIRS
- When a gate finds a defect, freeze unrelated work.
- Orchestrator assigns the smallest complete fix to one writer: Sol for security/schema/concurrency, Terra for bounded UI/PWA/workflow repair, Luna only for mechanical docs/config/test-fixture cleanup.
- Build failing proof first or capture a controlled before-state.
- Implement, run focused proof, then rerun the owning gate.
- Record exact failures; never weaken, skip, delete, quarantine, or reclassify a failing test merely to get green.
- After two or three repeated external failures, change approach. Do not loop the same command indefinitely.

PHASE 7 — MANDATORY SOL SELF-ADVERSARIAL REVIEW
This phase happens after all planned implementation and before staging or commit.

Freeze writers. Give a fresh Sol Extra High reviewer only:
- source requirements and authority boundaries;
- the current `main...HEAD` and working-tree diff;
- migration/function/config changes;
- proof commands and results;
- no implementation rationale or claims of correctness.

Sol's job is to disprove the work, not approve it. It must:
1. Trace every changed workflow end to end.
2. Look for wrong-farm/user/role paths, RLS bypass, SECURITY DEFINER exposure, stale JWT assumptions, missing grants, schema drift, secret leakage, and cross-farm storage.
3. Attack double-submit, two tabs, stale saves, offline create/edit/delete, lost responses, retries, partial failures, conflict handling, and idempotency.
4. Attack null/zero/negative/decimal/huge values, deleted parents/dependents, clock/timezone edges, stale quotes/weather, and provider failures.
5. Check cross-module reconciliation and tests that pass while bypassing the real repository/RPC/Edge/browser path.
6. Review changed tests for mirrored-assumption false confidence.
7. Return findings with ID, severity, file/line, reachable scenario, expected, actual risk, business impact, proof status, fix direction, and verifying regression/manual proof.
8. Explicitly say `NO BLOCKING FINDINGS` only if it tried to falsify each relevant guarantee and found none.

Sol may not fix during its first adversarial pass. The orchestrator first records and adjudicates every finding.

PHASE 8 — TERRA AND LUNA INDEPENDENT CROSS-CHECK
Run read-only and, where independent, in parallel:
- Terra: operate the actual browser/device workflows as a skeptical farmer. Check readability, tap targets, two-tap navigation, stale/conflict messages, offline status, retry visibility, and no silent data loss.
- Luna: reconcile every changed file to scope, compare docs/commands/results, scan for secret-like material without printing values, inspect CI/workflow/config drift, verify line references, and find vacuous/skipped/missing proof.
- Neither reviewer may accept Sol's conclusions without independent evidence.

PHASE 9 — REVIEW/FIX REPEAT LOOP
1. Orchestrator merges Sol/Terra/Luna findings into one queue.
2. BLOCKER/P0/P1 findings must be fixed and reproven before proceeding.
3. P2 findings must be fixed or explicitly accepted by Mason with business reasoning.
4. P3 may be deferred only with a named owner/test.
5. After fixes, rerun focused gates, full gates, and a fresh Sol adversarial delta review.
6. Repeat until no unresolved BLOCKER/P0/P1 remains and every P2 has a disposition.

PHASE 10 — FULL FOUNDATION AND RELEASE GATE
Run and preserve exact results for:
- `npx tsc -b --force`
- `npm run regression`
- `npm run build`
- `npm audit --audit-level=high`
- `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-foundation.ps1`
- non-production deployed database/RLS/RPC attacks if authorized
- Edge/runtime/scheduler proof if authorized
- preview headers/hostile frame proof if authorized
- physical-device/account/push/email proof if authorized

If a command fails, preserve the exact concise failure and continue independent checks. Do not call the gate green while a required in-scope proof is failed or unrun.

PHASE 11 — HARD PRE-COMMIT BARRIER
Do not commit yet.

The orchestrator must:
1. Run `git diff --check`.
2. Run a changed/untracked-file credential scan without printing values.
3. Confirm no `.env` file, generated browser artifact, unrelated file, or secret is included.
4. Review `git status`, name-status, diff stat, migration order, workflow triggers, and staged diff.
5. Confirm all Sol/Terra/Luna findings are resolved or accepted.
6. Confirm the full gate is green and identify every manual/unverified item.
7. Write PRE-COMMIT-DECISION.md containing:
   - proposed verdict;
   - exact files/systems changed;
   - all proof results;
   - Sol adversarial result;
   - Terra/Luna cross-check results;
   - remaining risk;
   - proposed commit message;
   - whether push/PR/deploy/merge would occur.
8. Present Mason a short plain-English summary and ask one question: `Approve this commit?`

No `git commit` may run before Mason explicitly approves it in that session.

PHASE 12 — AFTER COMMIT APPROVAL
- Commit with hooks enabled. Never use `--no-verify`.
- Push only if Mason separately authorized the exact non-production branch.
- Update or open a draft PR only if authorized; never merge it automatically.
- Monitor required checks to completion and preserve exact failures.
- Stop before production migration/deploy, customer communication, merge, or main/production push unless Mason gives separate explicit approval.

DONE MEANS
- every authorized release gate has real-path proof;
- all code changes survived fresh-context Sol adversarial review and independent Terra/Luna review;
- no unresolved BLOCKER/P0/P1 exists;
- no secret or unrelated change is staged;
- Mason saw the pre-commit packet and explicitly approved the commit;
- any unperformed live/device action is named as unverified, not implied complete.

FINAL REPORT TO MASON
- verdict;
- what changed;
- what Sol tried to break and found;
- Terra/Luna independent results;
- commands and remote checks;
- what remains unverified;
- top five next actions;
- whether major feature work is now wise;
- exact commit/branch/PR state;
- explicit statement of every live action that was not performed.
```

## Why this structure is intentionally strict

- The root Sol session stays focused on authority, integration, and high-risk decisions.
- Subagents parallelize read-heavy proof but not overlapping writes.
- Sol's review is a separate falsification phase, not a quick reread while still defending its implementation choices.
- Terra checks the farmer-visible path; Luna checks mechanical scope and proof integrity.
- The commit barrier gives Mason a plain-English decision point after the code has already survived adversarial review.
- The loop can keep making reversible local progress, but it cannot convert release proof into production authority.

## Model fallback rule

The requested model assignments are part of the loop. If `gpt-5.6-sol`, `gpt-5.6-terra`, or `gpt-5.6-luna` is unavailable in the next session, the orchestrator must report which model failed to launch. It may continue unrelated read-only work, but it must not silently claim that another model performed that role.
