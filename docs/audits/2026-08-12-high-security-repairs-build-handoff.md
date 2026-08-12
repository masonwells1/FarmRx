# Farm Rx high-security repairs — build handoff

## WHERE

- Repository: `C:\Users\mason\.codex\worktrees\farmrx-high-security-repairs`
- Branch: `codex/farmrx-high-security-repairs`
- Base: `origin/main` at `e723c509f65fc82abbeafba625071207425892e0`
- Scope owner: Mason Wells's 2026-08-12 request to repair the two High findings from the read-only review.

## GOAL

Repair two confirmed security defects without broadening product scope:

1. A queued push notification must fail closed if its recipient no longer has current access to the notification's farm when the delivery target is claimed.
2. Switching from sign-in to forgot-password must create a fresh form subtree so the password DOM value cannot be reused as the reset email value.

Done means each repair is an immutable local commit, its focused regression proves the former failure, broader owning proof passes, and a fresh-context read-only Sol review accepts the exact commit with no unresolved P1/P2 finding.

## PROVEN

- `origin/main` resolved to exact SHA `e723c509f65fc82abbeafba625071207425892e0` when this worktree was created.
- The existing push claim function snapshots targets and returns notification payload without recalculating the recipient's current farm access.
- The existing sign-in and reset branches render unkeyed forms at the same tree position with uncontrolled inputs, allowing React to reuse the password input DOM node as the email input.
- The worktree began clean and contains no live customer data or secrets.
- Push access repair commit `be2570bce5f280518a670a2f0f07951aadbf9cb7` received fresh-context exact-SHA Sol acceptance.
- Password-form isolation commit `68f736869d04bc34c900d51ae75cc90db2ade771` received fresh-context implementation acceptance; its strengthened non-skippable browser gate and exact-count proof culminated in accepted exact SHA `2a75eda15640c145e5e58a01726caaf22fc684a9`.
- At `2a75eda15640c145e5e58a01726caaf22fc684a9`, the full foundation ladder passed with the disposable member/rep revocation proof, browser desktop/phone proof, and 28/28 controlled mutations.

## WRITTEN, NOT PROVEN

- Exact SHA `37436064767d2ac4b91a6f4adf37624d2aef8a71` standardized both new SECURITY DEFINER search paths, added an authorized-rep positive claim control, passed the full foundation ladder, and received fresh-context Sol acceptance with no P0/P1/P2 finding.
- The follow-up that closes the avoidable revoke-after-batch-claim window with per-target revalidation immediately before provider I/O requires a new immutable commit, full proof, and fresh exact-SHA review before release credit.

## NOT STARTED

- Production migration apply, merge-triggered deployment, and post-deploy verification remain behind Mason's explicit production approval.

## APPROVAL BOUNDARY

Authorized now: local branch/worktree edits, synthetic tests, disposable local database work, local commits, and read-only exact-commit reviews.

Not authorized by this request: push, pull-request mutation, merge, deployment, live migration, live data, Auth/permission/secret changes, customer actions, or destructive actions.

## GATES

- Keep push authorization in PostgreSQL at the service-role claim boundary, with a fixed search path, fully qualified objects, and least-privilege grants.
- Prove the negative path: queue while access is valid, revoke access, then show the claim returns no payload and the target becomes terminally gone.
- Prove the browser path with synthetic password text and assert both a new DOM node and a blank reset email value.
- Run the owning regression/type/build/audit/static/disposable/browser proof appropriate to the touched files.
- Commit one bounded tranche at a time and review every exact commit with a fresh-context Sol agent.
- Do not infer outward authority from local repair authority.

## FIRST ACTION

Add a focused disposable-database regression that fails against the current push claim function before adding the forward migration.

Resume from this handoff, re-verify current state, and continue from the first action above.
