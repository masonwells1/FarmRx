# Farm Rx 2027 season-readiness orchestrator runbook

## Authority and starting point

- Owner directive and canonical statuses: [`../GOAL.md`](../GOAL.md).
- Scenario/write contract: [`WORKFLOWS-AND-SCENARIOS.md`](WORKFLOWS-AND-SCENARIOS.md).
- Append-only record: [`LEDGER.md`](LEDGER.md).
- Initial branch: `codex/farmrx-2027-season-ready`.
- Initial base: `7e19be18daa3b4d5d6228ad70ee245d2f37ee756` (`origin/main` when this loop began).
- Initial worktree: `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity`.

The main checkout at `C:\FarmRx` is not this initiative's writer checkout. Preserve it and all unrelated user work.

## Team model

**Sol orchestrates.** Sol owns scope, authority, worktree state, tranche boundaries, finding adjudication, integration, exact-SHA proof, ledger updates, and the next approval request.

- Use bounded Sol workers for architecture, permissions, data contracts, offline/recovery safety, database proof, and risk-sensitive repairs.
- Use bounded Terra workers for existing farmer workflows, responsive UI, browser operation, readability, and narrowly scoped implementation.
- Use Luna only when it is actually available. Record the model, effort, launch method, task, and output. Do not silently substitute another model and label it Luna.
- Workers do not recursively delegate. Only the root Sol orchestrator assigns work.
- Only one writer works at a time. Read-only reconnaissance and review may be parallel only when their scopes do not mutate state or depend on unfinished bytes.

## One-tranche, one-commit loop

1. **Preflight.** Verify worktree, branch, base/head SHA, clean/dirty state, current authority, source-of-truth links, and existing unrelated changes. Read the exact source and current proof before trusting older notes.
2. **Bound the tranche.** Name one existing workflow defect or one proof gap, its expected files/systems, expected writes/non-writes, proof commands, and stop conditions. No standalone module, vendor, broad redesign, speculative feature, or proof-only product column.
3. **Record the plan.** Append a ledger entry with authority and scope. For risky or multi-file work, present the plain-English plan and wait for Mason's approval before writing.
4. **Assign one writer.** Give a Sol or Terra worker the exact files, behavior, fixture IDs, negative assertions, proof, and prohibition on delegation or outward action.
5. **Verify the slice.** Run focused proof first. Then run the relevant exact-SHA repository gates, disposable backend assertions, and browser scenarios. Preserve failures; do not weaken tests to obtain green output.
6. **Commit only the tranche.** Check the diff, allowlist, untracked files, secrets, generated artifacts, and `git diff --check`. A commit is local unless Mason separately authorizes publication.
7. **Fresh Sol review.** Freeze writers. A fresh-context, read-only Sol reviews the exact commit SHA, requirements, diff, source, and proof. It receives no implementation defense and makes no fixes during the review.
8. **Adjudicate.** Record every finding with ID, severity, evidence, owner, and disposition. Any repair is a new bounded tranche and a new commit; never amend or silently rewrite the reviewed commit. The repair receives its own fresh-context, read-only Sol exact-SHA review.
9. **Report and stop.** Append the final evidence/result entry, report the canonical status by linking to `GOAL.md`, and ask for the single next approval needed.

Never combine unrelated repairs merely to reduce commit count. “One tranche/commit at a time” means each reviewable behavior change has one immutable commit identity; it does not authorize a commit that Mason has not approved when approval is required.

## Season-proof environment

- Build a disposable local backend from current repository migrations. Never point a season scenario at live Farm Rx or CRX Manager.
- Seed only the synthetic external fixture manifest. Reset between scenarios except for Maple Ridge's intentional January-through-December sequence.
- Simulate every fixed clock instant in `America/Chicago`, including the stated UTC offset.
- Block unapproved external requests. Weather and similar inputs use deterministic local doubles.
- Keep run identity in the evidence packet: exact commit, migration head, manifest hash, browser project, scenario, and simulated instant. Do not add `run_id` to product tables.
- Record UI evidence and focused local-database evidence for each expected write and expected non-write.
- Scan artifacts so tokens, cookies, keys, passwords, customer data, and environment values are never recorded.

## Verification ladder

Run only what the tranche can safely own, then complete the entire ladder before reporting the status gate in `GOAL.md`:

1. Focused unit/regression/browser/database proof for the changed workflow.
2. `npx tsc -b --force`.
3. `npm run regression`.
4. `npm run build`.
5. `npm audit --audit-level=high`.
6. Repository foundation proof (`npm run verify:foundation` or the current documented equivalent after verifying the package script).
7. Disposable local migration/fixture setup and database assertion suite.
8. Required browser matrix at representative desktop and phone sizes.
9. All scenarios in `WORKFLOWS-AND-SCENARIOS.md`, including continuous Maple Ridge proof.
10. `git diff --check`, exact changed-file/scope review, untracked-file review, and a credential-like scan that does not print values.
11. Fresh-context, read-only Sol review of the exact commit.

Do not infer the full gate from one green test. A failed or unrun required lane remains explicit in the ledger and status report.

## Exact-SHA review packet

Give the reviewer:

- exact commit SHA and parent SHA;
- the controlling `GOAL.md` and scenario contract;
- `git show --stat --oneline` plus the exact diff;
- changed-file allowlist and credential-scan result;
- focused and full command results with exit codes;
- fixture-manifest and migration hashes;
- browser evidence index and focused local-database assertions;
- expected-write/non-write matrix; and
- known limits or failed/unrun lanes.

The reviewer returns a categorical verdict and findings. The ledger records the actual model/effort and exact reviewed SHA.

## Approval gates

Local read-only inspection and already-approved local edits/tests do not expand authority. Stop and get Mason's explicit approval before any of these actions:

- push any branch or tag;
- create or mutate a pull request;
- push to `main` or another production-coupled branch;
- merge;
- deploy, promote, roll back, or otherwise change production;
- apply a live database migration or change live database structure;
- insert, update, delete, backfill, repair, or export live data;
- add, rotate, expose, or change secrets or environment variables;
- change authentication, authorization, RLS, permissions, account roles, billing, or service configuration in a live system;
- create, provision, invite, revoke, or impersonate a customer account;
- send customer/vendor communication or trigger real email, push, SMS, or webhook delivery; or
- delete data/files, force-push, rewrite shared history, or perform another destructive action.

For `main`, deployment, live migration, live data, secrets/auth/permissions, and customer actions, approval must name the specific outward action. Approval to build, test, commit, or open a pull request is not approval for later gates.

## Stop conditions

Stop the current tranche and return to Mason when:

- a requirement needs a new standalone module, vendor, broad redesign, or speculative capability;
- a missing integration is the only “failure” and no existing behavior is defective;
- the scenario cannot be proven without live services or real customer data;
- the disposable backend diverges from current migrations;
- expected non-writes mutate;
- the worktree contains overlapping unrelated changes that cannot be preserved safely;
- a secret-like value may have entered an artifact; or
- the next step crosses an approval gate.

## Ledger discipline

`LEDGER.md` is append-only. Never edit, reorder, or delete a prior entry to make history cleaner. If an entry is wrong, append a correction that cites it. Every tranche, commit, review, repair, approval, external action, and verification result receives a new entry with America/Chicago time and exact SHA/state.
