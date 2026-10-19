# Farm Rx protected delivery guide

Read this before any push, pull-request mutation, review request, merge, deploy, live data action, or customer-facing action. Agents may push a feature branch and manage its pull request without asking (Mason, 2026-09-05). The later hard gates still require Mason's explicit approval in the current conversation; branch or pull-request authority never rolls forward into merge or production authority.

Farm Rx `main` is connected to the production Vercel project. A merge to `main` is a production deployment.

## Prepare locally

1. Confirm the worktree, branch, status, diff, and current `origin/main`. Preserve unrelated work.
2. Run the focused proof required by `docs/agent-development-guide.md` and every broader check justified by risk.
3. Review the complete in-scope diff. Resolve real findings and rerun affected proof.
4. Create a clear local commit.
5. State the exact commit, proof observed, remaining risk, rollback path, and requested outward action in plain English.

After local proof is green, the agent may push the feature branch, create and maintain its pull request, and complete review without asking. Stop at `READY FOR APPROVAL` before merge or another hard-gated action and provide the exact short reply needed.

## Protected pull-request path

1. Push a feature branch; never push directly to `main` and never force-push.
2. Open or update the pull request with auto-merge off.
3. Bring the branch current with `main` and require all reported checks, including Foundation and Vercel, to be green.
4. Freeze the candidate and record its exact head SHA. A new commit or base update invalidates the candidate; rerun checks and freeze the new head.

No CodeRabbit review and no separate adversarial review is required before merge (Mason, 2026-10-19). CodeRabbit stays installed but silent: automatic, incremental, label, and description-triggered reviews stay disabled in `.coderabbit.yaml` so it never spends the review budget FarmRx shares with CRX Manager. Do not request a CodeRabbit review unless Mason asks for one.

## Merge gate

A green status row alone is not approval. Immediately before asking Mason to approve a merge or performing an already approved merge, verify live that:

- the pull request is open, non-draft, mergeable, current with `main`, and auto-merge is off;
- every reported required check is green;
- no unresolved real review finding or change request remains;
- the frozen SHA and final pull-request head are identical; and
- the current branch protection still enforces the expected pull-request and approval gates.

Merge only with the exact frozen SHA (`--match-head-commit <sha>`). Never use an admin override, bypass a hook or check, or ask Mason to waive a red, pending, stale, ambiguous, or unreviewed gate.

## After an approved merge

- Confirm the merge commit and Vercel production deployment rather than assuming GitHub success equals production health.
- Run a safe production spot-check proportional to the change. Do not create, edit, or delete customer data without separate approval.
- Report the business outcome, observed proof, rollback option, and any remaining owner action.

## Other hard gates

Fresh exact approval is required before merge; a live database migration or data mutation; edge-function or manual production deployment; secrets, authentication, permissions, billing, domain, or account-ownership change; customer account action or communication; destructive data action; purchase; or binding commitment.

Before a destructive action, resolve the exact target, recheck current state, preserve unrelated work, and prefer a backup or recoverable operation. Never expose secrets or real environment-file contents.
