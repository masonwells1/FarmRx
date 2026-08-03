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
- Governance stabilization exact commit `ca32138d2ff118a7fc71a9010f310a769e7c8061` received fresh-context read-only Sol **ACCEPT** after preserving publication facts as explicitly dated snapshots rather than self-updating current-state claims.
- CI exact commit `4bb708244a9b861038d364d8a228ddacedd680d9` changes only `actions/checkout@v4` to `@v6` and `actions/setup-node@v4` to `@v6`; fresh-context read-only Sol returned **ACCEPT** with no P1/P2 findings.
- Dependency exact commit `361f982c8d2eba2be81bc599592a4b4d1edc322e` contains only conservative same-major package/lock updates. Its complete LF-native foundation gate passed regression/post-regression, TypeScript/build, zero-vulnerability audit, static guards, 25/25 mutations, disposable migrations/RLS, and Playwright with 62 passed and 14 intentional skips. Fresh-context read-only Sol returned **ACCEPT** with no P1/P2 findings.
- The accepted dependency state pins Playwright exactly `1.61.1`, resolves `brace-expansion` `5.0.9`, and synchronizes the npm and Deno dependency metadata without changing the Deno remote import pin.

## REJECTED IMMUTABLE INTERMEDIATES

- Dependency commit `292412c645ba3fd8a85aa33c3d3cafb60756926d` allowed Playwright `1.62.1`, which repeatably failed the established phone offline-PWA journey.
- Dependency commit `b5263287136ee2270281b4c4c753bb177be57761f` restored a caret range but still resolved Playwright `1.62.1`; it was not accepted.
- Dependency commit `066df1576e0a95a8a5c1ae5b37a75f2378580f88` restored proven Playwright `1.61.1` and passed the full gate, but fresh Sol blocked its stale tracked `deno.lock` workspace metadata. Exact child `361f982c8d2eba2be81bc599592a4b4d1edc322e` repaired that discrepancy and is controlling.

## REMAINING

- Push, ready PR, exact-head review/check babysitting, merge, deployment verification, and checkout cleanup.
- The physical iPhone/Safari and Android/Chrome installed-PWA journeys remain outside this maintenance tranche and unperformed.

## APPROVAL STATE

Mason approved the app work plus PR and merge work in the owning thread. This handoff records that fact for provenance but does not carry irreversible authority into another task; re-confirm current authority before any push, PR mutation, merge, deploy, live change, or deletion if execution moves to a different task or thread.

## GATES AND BLOCKERS

- One writer and one immutable commit at a time.
- Every accepted exact commit requires complete proof and fresh-context read-only Sol review.
- No major dependency upgrades, feature work, integrations, migrations, live data/Auth changes, or phone-gate claims.

## FIRST ACTION

Verify exact local head, remote `main`, and authority. Review the documentation-only maintenance closeout, run its exact-SHA proof, and obtain fresh-context read-only Sol acceptance before publication.

Verify current state from Git, disk, and connected services before trusting this handoff; it may be stale when read.
