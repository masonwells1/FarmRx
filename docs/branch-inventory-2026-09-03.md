# Farm Rx branch inventory — 2026-09-03

This is a dated, read-only classification of `masonwells1/FarmRx`, last refreshed at 2026-09-03 08:33:40 -05:00 (`America/Chicago`). It does not authorize branch or worktree deletion.

## Snapshot

- GitHub default branch: protected `main` at `9b3321c325840b5108931a1412c091cb7c0863a3`.
- Remote feature branches: 23.
- Open pull requests: PR #30 and PR #35.
- Method: live GitHub branch and pull-request APIs, `git ls-remote`, GitHub compare results, registered worktrees, and local commit ancestry. No ref, pull request, branch, worktree, or live service was changed during the audit.

## Keep

| Branch | Evidence | Verdict |
|---|---|---|
| `codex/farmrx-soil-integration` | Exact remote tip `49e47bd3`; draft PR #30; 17 commits ahead and 4 behind current `main`. A separate reconciliation worktree contains newer local Soil work. | **IN USE / WAITING ON PR.** Useful product work; preserve and reconcile deliberately. |
| `codex/coderabbit-ready-label-20260830` | Exact remote/worktree tip `78c0db92`; open PR #35; GitHub reports the PR blocked while its new Foundation check is in progress. The registered worktree is clean with no unpushed commit at this refresh. | **IN USE / WAITING ON PR.** Useful review-gate repair; preserve it. |
| `claude/gauntlet-testing-sweep-013d65` | No PR; exact tip `bce14f24`; 29 commits ahead and 14 behind `main`; changes 15 proof/workflow files. The tip records Sol's rejection and known false proof claims. | **STALE, NEEDS REVIEW.** Preserve as recovery/research material, but do not merge it as-is. |

## Merged or superseded remote branches

Every branch below still points to the exact head of a pull request that GitHub records as merged. Its active value is already represented by `main`; the branch itself is not a separate backlog item.

| Branch | Merged PR |
|---|---:|
| `claude/coderabbit-budget-optimize` | #26 |
| `claude/farm-rx-roadmap-improvements-c3c3ad` | #23 |
| `codex/farmrx-2027-integration-closeout` | #14 |
| `codex/farmrx-2027-release-closeout` | #9 |
| `codex/farmrx-2027-season-ready` | #8 |
| `codex/farmrx-cw-custody-reconciled` | #28 |
| `codex/farmrx-cw-postmerge-hardening` | #29 |
| `codex/farmrx-dependency-hygiene-20260903` | #34 |
| `codex/farmrx-farmer-simplicity` | #3 |
| `codex/farmrx-foundation-repair` | #1 |
| `codex/farmrx-high-security-closeout` | #25 |
| `codex/farmrx-high-security-repairs` | #24 |
| `codex/farmrx-push-concurrency-guard-repair` | #27 |
| `codex/farmrx-release-gate-proof` | #2 |
| `codex/farmrx-smtp-closeout` | #17 |
| `codex/farmrx-sr040-final-closeout` | #16 |
| `codex/farmrx-v2-equipment-cost-release` | #31 |
| `codex/pine-hill-offline-custody` | #12 |
| `deps/audit-bump-2026-07-27` | #11 |

These 19 branches are **MERGED/SUPERSEDED** retirement candidates. Before any deletion, recheck the exact remote tip, open PRs, registered and physical worktrees, active tasks/processes, local-only commits, tags/recovery refs, and untracked files. In particular, the dependency-hygiene and high-security-closeout tips still have registered local worktrees in this snapshot.

## Remote branch with no remaining unique work

| Branch | Evidence | Verdict |
|---|---|---|
| `codex/maple-july-runtime-proof` | No PR; zero commits ahead and 128 behind `main`; GitHub compare reports no changed files. | **MERGED/SUPERSEDED.** Strongest remote retirement candidate after a fresh deletion preflight. |

## Local work not represented by the GitHub branch list

GitHub branch cleanup must not be treated as complete workspace cleanup. The registered local worktrees include:

- `codex/farmrx-soil-reconcile-20260903` at `4e049dff`: 20 commits unique versus current `main`; active Soil release candidate.
- detached Soil proof at `99a794ca`: 19 unique commits; preserve with the Soil reconciliation line.
- `codex/farmrx-v2-reconciled-e7a2` at `023610bc`: 56 unique commits; substantial local history requiring its own content/merge review.
- `codex/farmrx-soil-rx` at `c31879b6`: 4 unique commits; older Soil lineage, not safe to discard until reconciliation proves containment.
- `codex/farmrx-connect-workflows` at `8cef4c75`: 6 unique commits on an older base; likely superseded by merged CW PRs, but content equivalence has not been proven.
- primary checkout `codex/farmrxv2` at `9abaf18b`: 5 unique commits and 14 behind `main`; stale and not a safe source for new work.
- PR #35 worktree at `78c0db92`: clean and equal to its remote branch, with a new Foundation check in progress.

## Recommended cleanup order

1. Finish or deliberately park PR #35 and the active Soil reconciliation work.
2. Review the 29-commit rejected gauntlet branch and the 56-commit local V2 lineage for any still-needed repair or evidence.
3. Re-run the read-only inventory when writers are quiet.
4. Ask Mason for an exact deletion list, beginning with `codex/maple-july-runtime-proof` and then the merged exact-head remote branches that have no remaining worktree or recovery use.
