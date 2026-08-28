# Farm Rx agent router

## Read first

- Enduring product/source-of-truth: `docs/farm-rx-handoff.md`.
- Current owner goal and status definitions: `docs/GOAL.md`.
- 2027 scenario contract: `docs/season-readiness/WORKFLOWS-AND-SCENARIOS.md`.
- Execution/approval loop: `docs/season-readiness/ORCHESTRATOR-RUNBOOK.md`.
- Append-only history: `docs/season-readiness/LEDGER.md`.

The 2026-07-18 owner directive says no real farmer use until 2027. It supersedes earlier rollout timing, not the factual history of prior commits, merges, deployment, migrations, or live verification.

## Product boundary

Build on the completed Farmer Simplicity layer and existing modules. Do not add standalone modules, vendors, broad redesigns, speculative features, or a proof-only `run_id` column. Treat missing integrations as negative assertions/out of scope unless a required scenario exposes a defect in existing behavior.

## Work safely

- Sol orchestrates one bounded tranche and one immutable commit at a time.
- Workers are bounded, do not recursively delegate, and do not infer approval from silence.
- Every exact commit receives fresh-context, read-only Sol review; repairs are new commits and new reviews.
- Use synthetic fixtures, a simulated `America/Chicago` 2027 clock, and a disposable local backend for season proof. Never use live customer data.
- Preserve unrelated work and never modify `C:\CRX_Manager` from this repo.

## Production boundary

Farm Rx `main` is linked to the production Vercel project. A merge or push to `main` is production-coupled.

CodeRabbit does not review PRs automatically. Finish implementation and the separate exact-commit
Sol review first. Bring the branch current and green with auto-merge OFF, freeze the release
candidate, record its head SHA, then post exactly `@coderabbitai review` on the PR and read the
result. GitHub requires that formal approval and dismisses it when the candidate changes. Merge
immediately with `--match-head-commit <reviewed-head-sha>` and never use `--auto`.
Fix real findings; if a finding or base update creates a new commit, restart checks and request one
follow-up incremental review. Never use `@coderabbitai resume`, because it re-enables automatic
reviews, and use `@coderabbitai full review` only when a complete reread is deliberately justified.

Get Mason's explicit approval before push, pull-request mutation, main/production push, merge, deploy, live migration, live data change, secrets/auth/permissions change, customer account action, customer communication, or destructive action. Approval for local edits, tests, or a commit does not authorize any later gate.
