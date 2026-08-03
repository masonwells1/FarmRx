# Farm Rx governance, CI, and dependency maintenance build handoff

## WHERE

- Repository: `C:\FarmRx` / `masonwells1/FarmRx`
- Isolated writer: `C:\Users\mason\.codex\worktrees\farmrx-governance-ci-deps`
- Branch: `codex/farmrx-governance-ci-deps`
- Verified base: `5485374f339931c20fbb1da898e58fa471877ed3`

## GOAL

Stabilize dated governance evidence, remove the GitHub Actions Node 20 runtime warning, and apply only conservative patch/minor dependency updates. Done means three immutable reviewed tranches, complete proof, a clean pull request, merge, production verification, and local-main reconciliation.

## PROVEN

- Before editing, clean local `main`, `origin/main`, and remote `main` all equaled `5485374f339931c20fbb1da898e58fa471877ed3`; no PR was open.
- PR #19 merged exact head `bbc5936d52c3fc1293b7306a34b67f9661395d72` as that base SHA.
- GitHub deployment `5730476422` reported Production success for the base; Vercel deployment `dpl_AG89WXqbHUmqcywNhW2H2BH7Pj5Y` was `READY`; canonical and recovery routes returned HTTP `200`.
- Official GitHub action sources identify `actions/checkout@v6` and `actions/setup-node@v6` as Node 24 action-runtime generations; the application runtime remains pinned to Node 22.

## WRITTEN, NOT PROVEN

- Governance stabilization changes are being prepared as the first immutable tranche.

## NOT STARTED

- CI action-runtime update.
- Conservative patch/minor dependency refresh.
- Exact-SHA proof and fresh-context Sol review for each tranche.
- Push, ready PR, exact-head review/check babysitting, merge, deployment verification, and checkout cleanup.

## APPROVAL STATE

Mason approved the app work plus PR and merge work in the owning thread. This handoff records that fact for provenance but does not carry irreversible authority into another task; re-confirm current authority before any push, PR mutation, merge, deploy, live change, or deletion if execution moves to a different task or thread.

## GATES AND BLOCKERS

- One writer and one immutable commit at a time.
- Every accepted exact commit requires complete proof and fresh-context read-only Sol review.
- No major dependency upgrades, feature work, integrations, migrations, live data/Auth changes, or phone-gate claims.

## FIRST ACTION

Inspect the governance diff against base `5485374f339931c20fbb1da898e58fa471877ed3`, verify ledger additions-only behavior and dated snapshot semantics, then run the exact-SHA proof ladder before accepting the first tranche.

Verify current state from Git, disk, and connected services before trusting this handoff; it may be stale when read.
