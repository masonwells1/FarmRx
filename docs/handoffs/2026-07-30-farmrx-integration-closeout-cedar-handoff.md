# Farm Rx integration closeout and Cedar Creek handoff

> **Historical handoff — completed and superseded 2026-07-31.** Its local
> integration, governed closeout, Cedar repairs, six-scenario packet, full
> repository proof, and fresh Sol acceptance were completed. The accepted
> source/runtime commit is `8a9565a08a760e0ec920170bfacee1d9132cba47`;
> PR #14 merged the reviewed documentation history to `main` at
> `5c202f0dac0bfc3bfa0b9c92bdffba892caed15b`. Do not execute the `FIRST
> ACTION` below as current guidance; consult the current goal, scorecard, and
> append-only ledger.

**Prepared:** 2026-07-30 (`America/Chicago`)

**Owner:** Mason Wells

**Audience:** Fresh Codex task with a root Sol orchestrator, bounded Terra
implementation/reconnaissance where useful, and fresh-context read-only Sol
review for every accepted exact SHA. Use Luna only if it is actually available;
do not silently substitute another model and call it Luna.

## WHERE

- Repository: `https://github.com/masonwells1/FarmRx`
- Shared checkout: `C:\FarmRx`
- Shared checkout branch: `main`
- Verified local `HEAD`, local `origin/main`, and remote `refs/heads/main`:
  `81234ca204517fb6699d81d95d509c8481583592`
- Current open Farm Rx pull requests: none.
- Current open Farm Rx issues: none.
- Farm Rx production is coupled to `main`.
- Do not use `C:\CRX_Manager`.

The shared checkout contains unrelated untracked content:

- `docs/archive/audits/2026-07-15-sol-foundation-review/NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md`
- `docs/audits/2026-07-29-cedar-creek-readonly-workflow-audit.md`
- `docs/handoffs/`

Preserve those paths. Do not clean, delete, move, stage, or commit the untracked
tree as a group. This handoff is itself intentionally stored under the existing
untracked `docs/handoffs/` directory.

### Accepted local worktrees

| Lane | Worktree | Branch | Accepted exact SHA | Verified state |
|---|---|---|---|---|
| Maple Ridge full year | `C:\Users\mason\.codex\worktrees\farmrx-maple-aug-dec` | `codex/farmrx-maple-aug-dec` | `e7e79f715e34d1ca413d5ce3ddeaf865ede20fd2` | Clean; 6 commits ahead and 2 behind current `origin/main`; no PR |
| Pine Hill runtime | `C:\Users\mason\.codex\worktrees\farmrx-pine-hill-runtime` | `codex/farmrx-pine-hill-runtime` | `6a1d84e6cbf2038f0ab0ff54fdcbf723a20b81f2` | Clean; 2 commits ahead of current `origin/main`; no PR |
| North Fork runtime | `C:\Users\mason\.codex\worktrees\farmrx-north-fork-runtime` | `codex/farmrx-north-fork-runtime` | `0b90c175ff18691b8637ec0bf66bd3b8535f74ee` | Clean; 5 commits ahead of current `origin/main`; no PR |

North Fork already contains the two Pine Hill commits as ancestors:

```text
81234ca204517fb6699d81d95d509c8481583592
  -> b0edcbbf143e4609881368ad169145902dd494b3
  -> 6a1d84e6cbf2038f0ab0ff54fdcbf723a20b81f2
  -> 66c5d471f1d267cb7951865af0b31fd4090861d2
  -> 895f148e00d579736fc3e481133df26538567f2c
  -> 0b90c175ff18691b8637ec0bf66bd3b8535f74ee
```

Maple diverged from older main `8ae8988fc9f8babd2abdabf67bacb989f1a67a98`
and contains this immutable chain:

```text
2dcd683676e5924476517ee77f0f20ea6924df7a
5c15b67f91e8e4581f64187a76380a192b620cda
7bfc4c224f361d96752f2f7e049a017538535b06
feb3ea7b0b4cc72cef61df45706916f1a83a41f6
f2f8e62be93325b568208d1bad43178440ba63af
e7e79f715e34d1ca413d5ce3ddeaf865ede20fd2
```

Do not amend, rebase, reset, or add commits to any accepted worktree. Treat
them as immutable evidence sources.

## GOAL

Safely integrate the accepted Maple Ridge, Pine Hill, and North Fork local
lanes on one exact local commit, prove and freshly review that combined state,
record truthful governed closeout in `GOAL.md`, `SCORECARD.md`, and the
append-only `LEDGER.md`, then begin the bounded Cedar Creek repair/runtime lane.

Definition of done for the receiving session:

1. A new clean isolated `codex/` integration worktree begins at refreshed
   current `origin/main`.
2. The accepted Pine/North and Maple histories are combined without rewriting
   their immutable commits or dropping either side of overlapping
   contract/manifest/proof guards.
3. The combined exact SHA passes the focused Maple, Pine, and North runtime
   packets plus the complete repository gate ladder.
4. A fresh-context read-only Sol reviewer accepts that combined exact SHA.
5. A separate docs-only closeout commit truthfully updates `docs/GOAL.md`,
   `docs/season-readiness/SCORECARD.md`, and appends new entries to
   `docs/season-readiness/LEDGER.md`; that exact docs SHA receives fresh Sol
   acceptance.
6. Cedar Creek begins only from that accepted local closeout state, one bounded
   product defect/proof tranche at a time.
7. Stop before every outward-action gate. Nothing is pushed, published,
   merged, deployed, migrated live, or changed in a live service.

This session is not expected to make Farm Rx `COMPLETE`. Physical-device,
SMTP, publication, production, and live-service gates remain separate.

## PROVEN

### Maple Ridge

- Accepted exact SHA:
  `e7e79f715e34d1ca413d5ce3ddeaf865ede20fd2`.
- Continuous January-through-December synthetic disposable proof is complete.
- August task completion, September Harvest, October explicit Grain
  reconciliation, November bin/movement/contract/delivery independence, and
  December read-only closeout were exercised.
- Desktop and 390-by-844 browser coverage, exact writes/non-writes, retries,
  receipts, balances, continuous retained state, and no-overflow checks passed.
- The repository proof ladder passed.
- Fresh exact-SHA Sol review accepted the final immutable repair with no
  remaining P1/P2 finding.
- No outward or live action occurred.

### Pine Hill

- Accepted exact SHA:
  `6a1d84e6cbf2038f0ab0ff54fdcbf723a20b81f2`.
- The governed desktop/phone disposable sequence passed, including weak
  signal/offline custody, reconnect/replay, removal/revocation, browser storage
  byte assertions, recovery/export behavior, and exact SQL checks.
- PH5 compared downloaded bytes exactly with the actual prior queue bytes.
- PH2 and final SQL checked exact operation receipts without hiding
  cross-farm same-operation collisions.
- `PINE_HILL_2027_DISPOSABLE_PASS` and the required repository gates passed.
- Fresh exact-SHA Sol review returned `ACCEPT` with no P1/P2 finding.
- No outward or live action occurred.

### North Fork

- Accepted exact SHA:
  `0b90c175ff18691b8637ec0bf66bd3b8535f74ee`.
- The complete desktop and phone NF1-through-NF8 disposable sequence passed.
- The proof establishes:
  - old private farm content clears before a newly selected farm is confirmed;
  - the exact fail-closed empty access snapshot at rep revocation;
  - stale access-profile bytes and readable IndexedDB workspaces are removed;
  - farm-scoped queues, needs-attention records, recovery state, and the
    user-scoped Scouting cleanup outbox's exact North Fork partition are empty;
  - worker/read-only direct private-data reads are denied;
  - stale rep direct reads and writes are denied;
  - the canonical pass marker is emitted only after cleanup succeeds.
- A real bounded cleanup defect was repaired: removed-farm access-profile bytes
  are deleted inside the existing revoked-farm custody transaction.
- Final proof included `NORTH_FORK_2027_DISPOSABLE_PASS`, SQL verification
  twice, regression/post-regression, forced TypeScript, build, season
  mutation/isolation checks, zero-vulnerability audit, foundation disposable
  database/RLS proof, 53 built-browser tests with one intentional skip, and
  all three governed clock regressions.
- Fresh exact-SHA Sol review of `0b90c175...` returned `ACCEPT` with no P1/P2
  finding.
- No outward or live action occurred.

### Current repository and service boundary

- Local main, local `origin/main`, and remote main were verified equal at
  `81234ca204517fb6699d81d95d509c8481583592`.
- No PR exists for the three accepted local branches.
- No open Farm Rx PR or issue was reported at handoff creation.
- No push, PR mutation, merge to main, deployment, live migration, live data,
  secret/auth/permission, customer-account, or communication action is
  authorized by this handoff.

## WRITTEN, NOT PROVEN

- Current `main` does not contain the accepted Maple, Pine, or North runtime
  branches.
- The three branches are individually accepted, but their combined content has
  not been integrated, executed, or reviewed on one exact SHA.
- Maple and North overlap in season-contract/proof infrastructure. In
  particular, the integration must reconcile and retain both sides of:
  - `scripts/verify-season-contract.mjs`;
  - the governed scenario contract and manifest;
  - clock/proof adapters and shared proof guards;
  - any changed request-classifier or browser-timeout behavior.
- Maple already contains local `GOAL.md`, `SCORECARD.md`, and `LEDGER.md`
  updates for its accepted full-year proof. Those bytes are not current
  governed truth until they are reconciled into the combined state and the
  combined exact SHA is proven and accepted.
- The Cedar read-only audit is complete at:
  `C:\FarmRx\docs\audits\2026-07-29-cedar-creek-readonly-workflow-audit.md`.
  It is static evidence only, not implementation or runtime proof.

## NOT STARTED

### Integration and governed closeout

- No combined integration branch/worktree exists.
- No combined Maple/Pine/North exact-SHA proof has run.
- No exact combined integration SHA has received fresh Sol acceptance.
- The accepted SHAs are absent from:
  - `docs/GOAL.md`;
  - `docs/season-readiness/SCORECARD.md`;
  - `docs/season-readiness/LEDGER.md`.
- Current scorecard language is stale:
  - Maple still stops at July;
  - Pine remains `RUNTIME-BLOCKED`;
  - North remains `STATIC-ACCEPTED`.

### Cedar Creek

Cedar implementation and runtime proof have not started. The static audit
identified five bounded existing-product defects:

1. **HIGH:** a transport-failed queued spray is announced as server-saved.
2. **HIGH:** the completed spray form can be submitted again with new IDs,
   creating a second legitimate record and another Inventory deduction.
3. **HIGH:** a future-dated Weather cache can pass freshness checks and become
   actionable.
4. **MEDIUM:** opening or refreshing Weather can trigger a notification write,
   violating the required no-write read path.
5. **Visible UI defect:** Inventory emits the selected tab state under one
   class name while CSS styles another, so the selected Spray tab is not
   visibly selected.

The continuous CC1-through-CC4 desktop/phone, browser/network, queue, retry,
reload, disposable database, exact write/non-write, and fresh Sol packet is
also not built.

### Later gates

- One exact-current-HEAD complete season matrix.
- `RELEASE CANDIDATE READY`.
- Physical iPhone/Safari and Android/Chrome installed-PWA journeys.
- Custom SMTP and real password-email delivery.
- Any push, PR, merge, production deployment, or live change.

## APPROVAL STATE

Mason has authorized the next session to handle this local continuation:
read-only verification, isolated worktrees/branches, bounded local edits,
synthetic/disposable proof, local immutable commits, and fresh exact-SHA Sol
review.

This handoff does **not** authorize:

- pushing any branch or tag;
- creating or mutating a pull request;
- pushing or merging to `main` or another production-coupled branch;
- deploying, promoting, or rolling back production;
- applying a live migration or changing/exporting live data;
- changing secrets, auth, RLS, permissions, billing, or service configuration;
- creating, inviting, revoking, or impersonating a customer account;
- contacting the external Weather provider for proof;
- sending email, push, SMS, webhook, or other communication;
- deleting data/files, force-pushing, rewriting history, or destructive cleanup.

Obtain fresh explicit Mason approval for the exact outward action when any of
those gates is reached. Approval is never inherited from this file.

## GATES AND BLOCKERS

### Integration construction

Do not blindly cherry-pick eleven commits and silently resolve conflicts.
Preserve the accepted histories and create one explicit integration point:

1. Refresh and verify current `origin/main`.
2. Inspect all worktrees and changed-file overlap.
3. Create a new unique clean isolated worktree/branch from current
   `origin/main`; suggested names:
   - path:
     `C:\Users\mason\.codex\worktrees\farmrx-2027-integration-closeout`
   - branch: `codex/farmrx-2027-integration-closeout`
4. Fast-forward the new local integration branch to the immutable North Fork
   head `0b90c175ff18691b8637ec0bf66bd3b8535f74ee`. This brings current main,
   Pine, and North without changing their commit identities.
5. Merge the immutable Maple head
   `e7e79f715e34d1ca413d5ce3ddeaf865ede20fd2` locally with a non-fast-forward
   integration merge.
6. Resolve conflicts by preserving both accepted contracts and proof guards.
   Never choose one side wholesale for:
   - `GOAL.md`, `SCORECARD.md`, or `LEDGER.md`;
   - `verify-season-contract` source/regression;
   - the season manifest/contract;
   - clock adapters, request classification, or cleanup guards.
7. If a conflict cannot be resolved from current source and executed proof,
   stop and report it. Do not weaken an assertion or drop a lane.

Do not modify the accepted source branches during this process.

### Combined proof gate

At the resulting exact integration SHA, run:

- Maple full continuous January-through-December disposable proof;
- Pine Hill complete disposable runtime;
- North Fork complete disposable runtime;
- focused regressions for any resolved overlap;
- `npx tsc -b --force`;
- `npm run regression`;
- `npm run build`;
- `npm audit --audit-level=high`;
- `npm run verify:foundation`;
- `npm run verify:season`;
- all clock/swap/timeout/request-classifier regressions owned by the merged
  proof;
- `git diff --check`;
- exact changed/untracked file and credential-like scans without printing
  values;
- no owned listener/container/image/recovery-journal residue.

Freeze the writer and obtain a fresh-context read-only Sol adversarial review
of the exact integration SHA and parent/merge topology. Any repair is a new
immutable commit and receives another fresh review.

### Governed documentation gate

Only after the combined exact SHA is accepted:

1. Reconcile `docs/GOAL.md` current state/next step.
2. Promote Maple full year, Pine, and North in
   `docs/season-readiness/SCORECARD.md` with exact accepted SHA and limits.
3. Append new entries to `docs/season-readiness/LEDGER.md`. Never edit,
   reorder, or delete prior entries.
4. State plainly that Cedar remains unproven and that combined local proof
   does not equal publication, production, physical-device proof,
   `RELEASE CANDIDATE READY`, or `COMPLETE`.
5. Commit only the docs closeout, run the relevant doc/contract/diff gates, and
   obtain fresh-context read-only Sol review of that exact docs SHA.

### Cedar gate

Begin Cedar only after integration and governed closeout are accepted. Use the
static audit as a lead, then verify current source again. Work one bounded
defect/proof tranche per immutable commit:

1. truthful queued/confirmed/needs-attention spray disposition;
2. post-success duplicate submission prevention;
3. nonnegative Weather-cache age;
4. hard no-write Weather read/refresh behavior;
5. selected Spray-tab styling;
6. continuous CC1-through-CC4 synthetic disposable desktop/phone proof.

Do not add a Weather integration, provenance link, vendor, standalone module,
or broad redesign. Weather-to-spray remains manual transcription. Keep
Inventory arithmetic and Scouting write identities exact. Block external
network and use only deterministic local doubles.

### Existing local-environment note

Prior Maple/Pine/North proof used a reversible local Docker tag workaround so
the current Supabase CLI tag resolved to the repository-accepted exact
Postgres image digest. Verify actual Docker state and the repository clock
adapters before reusing it. Do not update global tooling or assume a tag is
correct from its name. No proof-owned parked clock container, temporary image,
listener, or journal may remain after a run.

## FIRST ACTION

Do not edit first.

Read this file completely, then read in order:

1. `C:\FarmRx\AGENTS.md`
2. `C:\FarmRx\docs\farm-rx-handoff.md`
3. `C:\FarmRx\docs\GOAL.md`
4. `C:\FarmRx\docs\season-readiness\WORKFLOWS-AND-SCENARIOS.md`
5. `C:\FarmRx\docs\season-readiness\ORCHESTRATOR-RUNBOOK.md`
6. `C:\FarmRx\docs\season-readiness\SCORECARD.md`
7. the tail of `C:\FarmRx\docs\season-readiness\LEDGER.md`
8. `C:\FarmRx\docs\audits\2026-07-29-cedar-creek-readonly-workflow-audit.md`

Then return a concise preflight containing:

- refreshed local/remote `origin/main` exact SHA;
- every relevant worktree/branch/SHA and clean/dirty state;
- confirmation that the three accepted SHAs and ancestry are unchanged;
- proposed new integration worktree/branch;
- exact overlapping files and intended conflict-resolution proof;
- combined proof commands;
- confirmation that no outward/live action will occur.

If the state is still safe, begin the local integration automatically. Stop
only for an actual ambiguous conflict, failed acceptance gate that cannot be
safely repaired, or an outward-action approval gate.

Verify current state from Git, disk, and connected services before trusting this handoff; it may be stale when read.
