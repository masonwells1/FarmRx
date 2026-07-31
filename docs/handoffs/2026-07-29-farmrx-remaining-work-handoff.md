# Farm Rx remaining-work handoff

> **Historical handoff — completed and superseded 2026-07-31.** Maple Ridge,
> Pine Hill, North Fork, Cedar Creek, and the exact-current-HEAD release packet
> described as remaining below were subsequently completed with synthetic,
> disposable proof and fresh Sol acceptance at
> `8a9565a08a760e0ec920170bfacee1d9132cba47`. PR #14 merged that accepted
> history to `main` at `5c202f0dac0bfc3bfa0b9c92bdffba892caed15b`.
> Preserve this dated snapshot for provenance; do not use its recommended next
> action instead of the current governed documents.

**Prepared:** 2026-07-29 (`America/Chicago`)

**Owner:** Mason Wells

**Purpose:** Give a fresh Codex session enough verified context to finish the remaining high-value Farm Rx 2027 work without repeating completed repairs or widening into low-value infrastructure work.

## Owner-level summary

The Pine Hill product repair, production migration, PR merge, and deployment are complete. The application is live and healthy. Farm Rx is **not yet complete under the standing 2027 goal** because the continuous August–December season proof, several governed scenario gauntlets, the two physical-phone journeys, and custom SMTP proof remain open.

The highest-value next outcome is:

> Run Maple Ridge August through December continuously from the accepted July boundary, then produce one exact-current-HEAD January-through-December evidence packet.

Do not spend the next session on generic harness improvements, speculative integrations, broad refactors, or archive cleanup unless a required farmer-visible proof exposes a concrete defect.

## Verify this before doing anything

Do not trust this handoff, memory, or the current checkout without refreshing the real state.

```powershell
Set-Location C:\FarmRx
git fetch origin
git worktree list
git status --short
git branch --show-current
git rev-parse origin/main
gh pr list --repo masonwells1/FarmRx --state open
gh issue list --repo masonwells1/FarmRx --state open
```

Expected starting production/main SHA when this handoff was written:

```text
8ae8988fc9f8babd2abdabf67bacb989f1a67a98
```

That is the merge commit for PR `#12`, **fix: secure Pine Hill offline farm custody**.

If `origin/main` has moved, use the newer exact SHA and re-evaluate the affected source and proof. Do not force the repository back to this handoff SHA.

## Important checkout warning

`C:\FarmRx` was **not** a clean canonical `main` checkout when this handoff was prepared:

- branch: `deps/audit-bump-2026-07-27`
- local HEAD: `cbf0d427123d15b2e7c9ed221c1bae7c7e97062a`
- untracked path: `docs/archive/audits/`

Those files may belong to Mason or another session. Preserve them. Do not reset, discard, move, delete, or switch this checkout to `main`.

For implementation, create or reuse a clean isolated worktree from current `origin/main`. First inspect `git worktree list` and choose a unique path and `codex/` branch name. Example only:

```powershell
git worktree add C:\Users\mason\.codex\worktrees\farmrx-2027-remaining `
  -b codex/farmrx-2027-remaining origin/main
```

Do not run that command if the path or branch already exists.

## Read these sources first

Read the full files in this order from the clean worktree:

1. `AGENTS.md`
2. `docs/farm-rx-handoff.md`
3. `docs/GOAL.md`
4. `docs/season-readiness/WORKFLOWS-AND-SCENARIOS.md`
5. `docs/season-readiness/ORCHESTRATOR-RUNBOOK.md`
6. `docs/season-readiness/SCORECARD.md`
7. `docs/season-readiness/MAPLE-JULY-DECEMBER-MAPPING.md`
8. the tail of append-only `docs/season-readiness/LEDGER.md`

Current `origin/main` and these canonical documents override old chat summaries, archived audits, branch notes, and memory.

## Completed work — do not repeat

### Production and dependency state

- PR `#11` merged the dependency repair.
- PR `#12` merged Pine Hill as production commit:
  `8ae8988fc9f8babd2abdabf67bacb989f1a67a98`.
- Vercel production deployment for that exact merge SHA reached `READY`.
- `https://farm-rx.vercel.app` returned HTTP `200`.
- Public desktop and 390-by-844 phone login checks passed with no horizontal overflow; visible controls were at least 52px high.
- The only public-console noise was the existing harmless `/favicon.ico` `404`.
- A post-deployment Vercel error-log query returned no production errors in the checked 30-minute window.

### Production database state

- The repository migration filenames were aligned with the existing production ledger without rewriting production history.
- Production migration applied:
  `20260725213142_pine_hill_removed_farm_epoch.sql`.
- Post-apply linked dry run reported the remote database was up to date.
- Catalog proof confirmed one expected function and ledger row, empty function `search_path`, authenticated-only execution, `auth.uid()` identity derivation, and the intended removed-access predicates.
- No customer row, seed, backfill, inventory, Grain record, auth setting, secret, customer account, or communication was changed.

### Accepted scenario work

- Maple Ridge January through July continuous runtime: accepted through exact commit
  `021b5875dc6d96ddc1b018f672a204ce1066ec9b`.
- Prairie Spray compliance presence: **PROVEN** at exact commit
  `0753c5165116c6a8f25076dd4b036b9afb570d51`.
- Harvest Ridge Grain truth: **PROVEN** at exact commit
  `a39b4cd4cf6a7bb8b03ba7dd1ee4c8dce98a4fec`.
- Pine Hill product repair and live removed-epoch function: complete.
- Pine Hill's full governed browser/storage/SQL runtime scenario remains a proof gap; do not misstate the live repair as that missing runtime evidence.

### Final Pine verification

The final Pine/reconciliation work received fresh exact-SHA Sol acceptance with no P0, P1, or P2 findings. The full foundation gate passed locally and on GitHub, including regression/post-regression, forced TypeScript/build, dependency audit, disposable database/RLS probes, the 11-of-11 mutation drill, and 53 Playwright tests with one intentional skip.

Do not rerun or redesign Pine product logic unless the missing governed runtime scenario exposes a new defect.

## Remaining work in priority order

## 1. Maple Ridge August–December continuous runtime and full-year packet

This is the next recommended tranche and the largest remaining farmer-visible proof.

Start from the existing accepted January–July fixture/harness. Inspect before editing:

- `scripts/verify-maple-july-disposable.ps1`
- `scripts/maple-season-browser.ps1`
- `scripts/harvest-ridge-db-clock.psm1`
- `scripts/maple-season-db-clock-*.psm1`
- `tests/season/season-2027.manifest.json`
- existing January–July browser specs and SQL verifiers
- `docs/season-readiness/MAPLE-JULY-DECEMBER-MAPPING.md`

The continuous invariant is mandatory:

- one disposable reset before January;
- preserve the same database through December;
- retain every earlier identity, balance, version, and required non-write;
- use the governed `America/Chicago` 2027 database clock;
- never point the scenario at production or real customer data.

### August

Farmer marks the July manual task **Done**.

Prove:

- exactly one task version/status transition;
- server-owned completion actor/time at the simulated instant;
- no duplicate transition on double click/retry;
- honest pending/replay behavior;
- no Program, notification, scouting, Inventory, Grain, Fields, equipment, or service mutation.

### September

Farmer records Maple East harvest: 30,800 bu, `2027-09-28`, `$4.25`.

Prove:

- only the intended crop-assignment harvest fields/version change;
- visible 192.5 bu/ac, 7.5 bu/ac under plan, and $130,900 revenue;
- Grain actual remains unentered;
- no bin, contract, delivery, task, Program, Inventory, or automatic lot write;
- connected, lost-response/replay, double-submit, reload, desktop, and phone behavior.

### October

Farmer creates the Grain estimate and then explicitly chooses
**Use harvest total as Grain actual**.

Prove two ordered writes:

1. projected estimate;
2. explicit actual reconciliation to 30,800 bu.

Prove:

- Harvest is not silently coupled to Grain before confirmation;
- reconciliation does not change bins;
- no cash-bid, contract, delivery, movement, lot, notification, or alert-transition write;
- exact operation/receipt identity and lost-response replay.

### November

Run five independent farmer actions:

1. create Maple North Bin;
2. record 30,800-bu In movement;
3. create 5,000-bu cash contract;
4. record 5,000-bu Out movement;
5. record 5,000-bu contract delivery.

Prove after every button:

- one exact row per action;
- bin balance `0 -> 30,800 -> 25,800`;
- delivery does not create a bin movement;
- bin movement does not record a delivery;
- no duplicate movement/delivery on retry;
- correct contract/product/bin associations;
- no contradictory balance or misleading receipt;
- no unrelated write.

### December

Perform the read-only whole-year closeout across Fields, Grain, Contracts, Storage, Inventory Compliance, Programs, Harvest, Scouting, and Tasks.

Prove:

- the visible values listed in `MAPLE-JULY-DECEMBER-MAPPING.md`;
- zero writes on open, reload, tab change, preflight, and repeated/concurrent preflight;
- no hidden `repository_write_receipts`, notification, marketing-alert, equipment, queue, or generator write;
- desktop and phone readability/no overflow;
- final full-year retained identities and totals.

### Full-year acceptance

After the month lanes work, run one complete January–December packet on the exact final commit. Then run the full repository proof ladder and obtain a fresh exact-SHA Sol adversarial review before promoting the scorecard.

Do not promote a month based on a committed harness, chat output, or static code inspection.

## 2. Pine Hill governed runtime gauntlet

The repair is live, but the scorecard correctly remains runtime-blocked for this scenario.

Build the missing synthetic disposable scenario:

- exact desktop and 390-by-844 phone sequence;
- weak signal/offline queue;
- reconnect and replay;
- farm removal/revocation;
- v2 custody generation, fence token, and server epoch;
- removed-farm epoch retrieval;
- browser storage byte assertions before and after recovery;
- legacy work remains review/export-only and never auto-replays;
- expected SQL writes and non-writes;
- no customer data or live database.

Reuse the existing focused proof:

- `scripts/verify-pine-hill-removed-epoch-disposable.ps1`
- queue, farm-access, removed-epoch, and recovery regressions
- foundation browser revocation/regrant coverage

The result must be a complete governed evidence packet, not another product redesign.

## 3. North Fork permissions/privacy gauntlet

The mapping is accepted, but no executable browser/database gauntlet exists.

Prove the owner, manager, worker, read-only member, rep, and outsider matrix against:

- direct navigation;
- reads and writes;
- private Grain/financial access;
- rep sharing;
- farm switching;
- stale tabs;
- epoch changes/revocation;
- browser cache/queue isolation;
- expected non-writes.

Use only synthetic disposable accounts and data. Any live auth/RLS/customer action requires new explicit Mason approval.

## 4. Cedar Creek weather/scouting gauntlet

The contract and product repairs are static-accepted; runtime proof is absent.

Prove:

- deterministic local weather double;
- manual weather transcription into a spray record;
- no claimed provider provenance link;
- scouting save/recovery and honest receipt behavior;
- phone readability;
- blocked external network;
- exact database writes/non-writes.

Do not add a weather integration or weather-to-spray link.

## 5. Exact-current-HEAD release packet

After Maple and the missing gauntlets are accepted:

- run the full foundation ladder;
- run the complete season matrix on one exact commit;
- scan changed/untracked files and credential-like content without printing values;
- run `git diff --check`;
- append the ledger and update the scorecard only from executed evidence;
- obtain fresh-context, read-only Sol acceptance of the exact commit.

Only then can the local state be called **RELEASE CANDIDATE READY**.

## 6. Physical-device and onboarding gates

These are required for `COMPLETE`, but should be done near actual onboarding rather than now unless Mason changes priority:

- physical iPhone/Safari installed-PWA journey;
- physical Android/Chrome installed-PWA journey;
- privacy, weak-signal, recovery, and stale-access behavior on both;
- custom SMTP configuration;
- real end-to-end password-email delivery.

Each customer account, auth/permission, secret, SMTP, communication, live-data, and production action requires new explicit Mason approval. Do not infer authority from this handoff or earlier approvals.

## Optional low-value cleanup

PR `#10`, **docs: archive closed loop transcripts and build notes**, is the only open PR known when this handoff was written.

- It is archive-only and moves roughly 490 historical files.
- Its foundation failure was caused by 11 dependency advisories on its old base; PR `#11` later fixed those advisories on `main`.
- It provides no farmer-visible behavior.
- Recommendation: park or close it unless the historical-document volume is actively slowing work. Do not let it delay the season proof.

There were no open GitHub issues when this handoff was prepared.

## Working method

Follow the project runbook exactly:

1. Refresh `origin/main` and inspect active worktrees/overlap.
2. Name one farmer-visible proof outcome and its allowed files.
3. Record the bounded plan in the append-only ledger when required.
4. Use one bounded writer. Do not recursively delegate.
5. Run focused proof first.
6. Preserve failures; never weaken a test to obtain green.
7. Commit one reviewable tranche.
8. Freeze writers.
9. Give a fresh-context, read-only Sol reviewer the exact SHA, parent, requirements, diff, and proof.
10. Any repair is a new commit and a new exact-SHA review.

Mason has explicitly asked to avoid redundant low-value gains. Before any infrastructure or harness work, state which farmer-visible scenario it directly unlocks. Timebox debugging and reuse the accepted clock/browser/disposable-backend seams.

## Minimum proof ladder

Before calling a tranche accepted:

```powershell
npx tsc -b --force
npm run regression
npm run build
npm audit --audit-level=high
npm run verify:foundation
npm run verify:season
git diff --check
```

Also run:

- the tranche's focused browser/database proof;
- the required desktop and phone matrix;
- exact expected-write and expected-non-write SQL assertions;
- migration/fixture hashes;
- changed-file, untracked-file, and credential-like scans;
- fresh exact-SHA Sol review.

Do not infer the full ladder from one green command.

## Hard stop and approval boundaries

Local read-only inspection, local edits, tests, and an explicitly requested local commit do not authorize outward actions.

Stop for Mason's explicit approval before:

- push or PR mutation;
- merge or production deployment;
- live migration or live-data change;
- secrets, SMTP, auth, permissions, or customer-account change;
- customer email, push, SMS, webhook, or other communication;
- destructive cleanup, force-push, or shared-history rewrite.

Use synthetic fixtures and the disposable local backend for all remaining season proof.

## Recommended first fresh-session action

Do not begin by editing.

Return a short preflight containing:

- refreshed `origin/main` SHA;
- clean isolated worktree/branch;
- current open PRs/issues;
- whether another active worktree overlaps Maple/season files;
- the exact August–December files likely to change;
- proof commands;
- confirmation that no live/outward action will occur.

Then begin the bounded Maple August–December continuous-proof tranche automatically if the worktree is isolated and no material overlap exists.

## Paste-ready prompt for the fresh session

```text
Continue Farm Rx remaining 2027 work from the durable handoff:
C:\FarmRx\docs\handoffs\2026-07-29-farmrx-remaining-work-handoff.md

Read that file completely, then read the current clean worktree's AGENTS.md,
docs/farm-rx-handoff.md, docs/GOAL.md, the season scenario contract, runbook,
scorecard, Maple July-December mapping, and ledger tail.

First refresh origin/main and inspect all worktrees. Do not modify or clean
C:\FarmRx: it is on an older dependency branch and has untracked archive files.
Create or reuse a clean isolated codex/ worktree from current origin/main.

Start with the highest-value remaining outcome: one continuous Maple Ridge
August-through-December runtime tranche from the accepted July boundary,
followed by the exact-current-HEAD January-through-December packet. Reuse the
accepted disposable database clock/browser seams. Do not widen into generic
infrastructure, integrations, broad refactors, or archive cleanup.

Use synthetic fixtures and the disposable local backend only. Preserve the
explicit non-coupling of Harvest, Grain actuals, bins, movements, contracts,
and deliveries. Prove exact writes, non-writes, retries, receipts, balances,
desktop/phone readability, and no horizontal overflow.

Use one bounded writer and a separate fresh-context read-only Sol exact-SHA
review for every accepted commit. Do not push, mutate a PR, merge, deploy,
apply a live migration, change live data/auth/secrets/SMTP/customer accounts,
or send communication without new explicit Mason approval.

Begin with a concise preflight and plan, then continue automatically through
safe local work. Stop only at a real approval gate or hard blocker.
```
