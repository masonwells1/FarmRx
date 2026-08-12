# Farm Rx high-security repairs — build handoff

## WHERE

- Repository: `C:\Users\mason\.codex\worktrees\farmrx-high-security-repairs`
- Runtime branch: `codex/farmrx-high-security-repairs`
- Closeout branch: `codex/farmrx-high-security-closeout`
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
- Exact runtime head `e580b73468f1022f23e0dcb84961e18ba877edca` passed the complete local and GitHub foundation gates, Vercel, CodeRabbit, and fresh-context Sol review with P0/P1/P2/P3 all zero. The final gate included frozen Deno 2.9.4 resolution, 34/34 controlled mutations, real two-connection positive and lock-removal proofs, and the password-form desktop/phone proof.
- PR #24 merged the accepted head as `af795371e2321fb445d3a7f81980cd6b7b6c2254` at `2026-08-12T20:44:42Z`. Vercel production deployment `dpl_pXfwpFp9igFKVbyjjq4M4Kjbx9QN` was `READY`, and the canonical root, recovery root, and recovery `/update-password` each returned HTTP `200` with title `Farm Rx`.
- Production push delivery was drained fail-closed through temporary `send-push` v4. After the old 20-second execution budget elapsed, live state still showed zero open deliveries and zero sending/failed targets.
- Migration `20260812135210_deny_revoked_push_delivery` is present in the live Supabase migration ledger. Read-only verification found all three current-access claim checks, the parent `FOR UPDATE` reconciliation lock, both outcome paths using the reconciler, service-role-only revalidation, no API execution grant on the internal reconciler, and zero open/in-flight work.
- Final `send-push` v5 is `ACTIVE` with JWT verification enabled and deployment hash `c205a1e0d18891045d1c28c11c44bc58a5eea0a9b37e9a0dcc060d05165323fb`. Both deployed files matched the reviewed repository files exactly. A non-writing live call reached v5 and returned the expected `401 {"error":"sign in required"}`; Edge logs showed no post-resume 5xx result.
- A live Playwright check on `https://farm-rx.vercel.app/login` filled only the password node with synthetic text, marked that node, switched to password reset, and observed a distinct blank email node with no marker. The only console error was the unrelated pre-existing favicon `404`.

## WRITTEN, NOT PROVEN

- Nothing in the two-High repair remains written but unproven. The documentation-only closeout commit still requires its own exact-SHA review and green pull-request publication before this handoff is durable on `main`.

## NOT STARTED

- No runtime repair step remains. Global Farm Rx status remains `RELEASE CANDIDATE READY`, not `COMPLETE`, because the separate physical installed-PWA phone journeys remain open under `docs/GOAL.md`.

## APPROVAL BOUNDARY

Mason explicitly approved PR #24 merge, normal production deployment, safely draining/resuming push processing, applying migration `20260812135210`, deploying `send-push`, and post-deployment verification. Those authorized actions are complete.

No live customer data, Auth setting, secret, permission, account, customer communication, or destructive action was changed. Any different outward action still requires its own current authority.

## GATES

- Keep push authorization in PostgreSQL at the service-role claim boundary, with a fixed search path, fully qualified objects, and least-privilege grants.
- Prove the negative path: queue while access is valid, revoke access, then show the claim returns no payload and the target becomes terminally gone.
- Prove the browser path with synthetic password text and assert both a new DOM node and a blank reset email value.
- Run the owning regression/type/build/audit/static/disposable/browser proof appropriate to the touched files.
- Commit one bounded tranche at a time and review every exact commit with a fresh-context Sol agent.
- Do not infer outward authority from local repair authority.

## FIRST ACTION

If this closeout is not yet on `main`, finish its documentation-only exact-SHA review and green pull-request publication. Otherwise perform one fresh read-only archive audit; do not repeat the runtime rollout.

Verify current state from Git, disk, and connected services before trusting this handoff; it may be stale when read.
