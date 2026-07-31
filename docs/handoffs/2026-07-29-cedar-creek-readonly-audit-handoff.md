# Cedar Creek read-only workflow audit handoff

> **Historical handoff — completed and superseded 2026-07-31.** This handoff
> produced the Cedar audit named below. Its later repair/runtime work was
> accepted at `8a9565a08a760e0ec920170bfacee1d9132cba47` and merged through PR
> #14 at `5c202f0dac0bfc3bfa0b9c92bdffba892caed15b`. Do not execute its
> `FIRST ACTION` as current guidance; consult `docs/GOAL.md`, the scorecard, and
> the append-only ledger.

**Prepared:** 2026-07-29 (`America/Chicago`)

**Audience:** Fresh Codex task using `gpt-5.6-sol`

## WHERE

- Repository: `https://github.com/masonwells1/FarmRx`
- Shared checkout: `C:\FarmRx`
- Shared-checkout branch at verification: `main`
- Shared-checkout and `origin/main` SHA at verification:
  `81234ca204517fb6699d81d95d509c8481583592`
- The shared checkout has unrelated untracked content under
  `docs/archive/audits/2026-07-15-sol-foundation-review/` and
  `docs/handoffs/`. Preserve it. Do not clean, discard, move, stage, or commit
  those paths as a group.
- Active North Fork writer worktree:
  `C:\Users\mason\.codex\worktrees\farmrx-north-fork-runtime`
- North Fork branch and verified starting SHA:
  `codex/farmrx-north-fork-runtime` at
  `66c5d471f1d267cb7951865af0b31fd4090861d2`
- At handoff creation, North Fork had uncommitted work in:
  - `scripts/verify-north-fork-disposable.ps1`
  - `src/auth/farmContext.ts`
  - `src/auth/farmContext.regression.ts`
  - `tests/e2e/season/north-fork.spec.ts`
- Do not touch or run commands inside the North Fork worktree.
- Other Farm Rx proof worktrees exist for Maple Ridge and Pine Hill. Treat
  their state as read-only evidence and do not reuse them as the Cedar writer
  checkout.
- GitHub reported no open Farm Rx pull requests and no open issues when this
  handoff was prepared.
- No maintained Graphify configuration or graph script was found in Farm Rx.
  Direct source tracing is the correct navigation method for this bounded
  audit.

Open a fresh clean Codex worktree from the current Farm Rx default branch. The
only allowed write is the audit Markdown artifact named below. Do not change
product code, tests, fixtures, scripts, migrations, package files, trackers, or
the append-only ledger.

## GOAL

Audit the existing Cedar Creek 2027 farmer workflow from Weather through manual
spray transcription and Scouting, identify concrete farmer-visible defects and
proof gaps, and prepare an exact bounded implementation/proof plan without
changing application behavior or using a live service.

Definition of done:

1. Create:
   `docs/audits/2026-07-29-cedar-creek-readonly-workflow-audit.md`.
2. Record the exact checkout path, branch, HEAD, `origin/main`, working-tree
   state, and active-worktree collision check.
3. Trace CC-1 through CC-4 from the canonical scenario contract through the
   actual UI, data, cache, queue, repository, migration/RLS, and notification
   paths.
4. Produce a requirement-by-requirement matrix with:
   - source-real behavior;
   - expected writes;
   - expected non-writes;
   - existing proof;
   - missing proof;
   - evidence-backed defect or risk;
   - proposed future proof.
5. Separate:
   - actual existing-product defects;
   - proof-harness gaps;
   - missing integrations that are explicitly out of scope.
6. Include desktop and 390-by-844 phone risks, honest save/retry/reload states,
   stale-cache behavior, manual weather transcription, Inventory arithmetic,
   Scouting receipt durability, and zero hidden coupling.
7. Give an exact future changed-file allowlist and proof ladder, but make no
   edits to those files in this audit.
8. End with one categorical execution verdict:
   `SAFE TO START`, `WAITING`, or `BLOCKED`.

## PROVEN

- The canonical Cedar contract exists in
  `docs/season-readiness/WORKFLOWS-AND-SCENARIOS.md`, Scenario CC.
- The current canonical scorecard labels Cedar Creek `STATIC-ACCEPTED` and says
  no accepted Cedar runtime packet exists.
- Scenario CC fixes the page clock at
  `2027-07-07T13:20:00-05:00`, uses the synthetic Cedar Creek owner/farm/field
  identities, and requires browser traffic only to the local app/backend.
- CC-1 requires one exact Open-Meteo-shaped request to be intercepted and
  fulfilled inside Playwright, with no external packet and no product-database
  write.
- CC-2 requires the farmer to manually type weather into a completed spray
  record. Weather must not auto-fill or auto-save the record.
- CC-2 expects exactly one application row and one application-product row,
  with Inventory on-hand changing from `20.00 gal` to `15.00 gal`.
- CC-3 requires a real stale-cache fallback after an intercepted local abort,
  cautious farmer wording, no actionable spray window, and no database write.
- CC-4 requires one exact Scouting note, a durable visible receipt, no task,
  photo, notification, or location capture, and no weather-to-spray provenance
  claim.
- Existing relevant source includes:
  - `src/WeatherModule.tsx`
  - `src/ScoutingModule.tsx`
  - `src/InventoryModule.tsx`
  - `src/data/weatherService.ts`
  - `src/data/weatherSprayHandoff.ts`
  - `src/data/createSupabaseScoutingServices.ts`
  - `src/data/QueuedScoutingRepository.ts`
  - `src/data/SupabaseScoutingRepository.ts`
  - `src/data/scoutingWriteQueue.ts`
  - `src/data/scoutingStorage.ts`
  - `src/data/createSupabaseInventoryServices.ts`
  - `src/data/SupabaseInventoryRepository.ts`
  - `src/data/inventoryWriteQueue.ts`
  - `src/data/createSupabaseNotificationsServices.ts`
  - `supabase/migrations/20260711223443_module3_inventory.sql`
  - `supabase/migrations/20260712150557_0020_scouting.sql`
  - `supabase/migrations/20260712152422_0021_scouting_bucket_limits.sql`
  - `supabase/migrations/20260716122213_0039_scheduler_weather_push_semantics.sql`
- Relevant focused regressions exist for weather normalization, weather-to-spray
  handoff, Inventory behavior, Scouting repositories, and Scouting receipt
  refresh. Their existence is not Cedar runtime proof.
- No live Supabase, Vercel, customer account, external weather provider, or
  production data was accessed while preparing this handoff.

## WRITTEN, NOT PROVEN

- The Cedar fixture identities and scenario facts are written in the canonical
  contract and season manifest, but the current scorecard does not claim an
  executable browser/database gauntlet.
- Weather, manual spray-record entry, Inventory arithmetic, Scouting queues,
  receipts, and RLS-backed repositories exist in source. The audit must verify
  how they connect instead of assuming the written design is current.
- Static source and focused regressions may support individual claims. They do
  not prove the continuous CC-1 through CC-4 farmer journey, phone layout,
  exact database writes/non-writes, network blocking, or retry behavior.
- North Fork is actively changing shared farm-context behavior. The audit may
  inspect its committed and uncommitted diff read-only to identify future
  integration risk, but it must not adopt or edit those bytes.

## NOT STARTED

- The requested Cedar read-only source audit artifact.
- A Cedar-specific Playwright configuration, disposable runner, SQL seed, SQL
  verifier, evidence packet, or exact-SHA review.
- Any Cedar product repair.
- Any scorecard, goal, ledger, migration, live service, or production change.

## APPROVAL STATE

Mason authorized this read-only Cedar Creek workflow audit and the one local
Markdown audit artifact.

This does not authorize:

- product/source/test/fixture/script/migration/package edits;
- running the Cedar or another disposable season gauntlet while North Fork is
  active;
- starting or changing Docker, Supabase, Vite, Playwright, or proof-owned
  listeners;
- querying or mutating the live Supabase project;
- contacting the external weather provider;
- committing, pushing, creating or mutating a pull request, merging, deploying,
  applying a migration, changing live data, secrets, auth, permissions, or
  customer accounts;
- sending customer/vendor communication; or
- deleting, cleaning, resetting, force-pushing, or rewriting history.

If a product defect is found, document it with file-and-line evidence and a
small proposed repair. Do not implement it in this audit.

## GATES AND BLOCKERS

- Read `AGENTS.md`, `docs/farm-rx-handoff.md`, `docs/GOAL.md`,
  `docs/season-readiness/WORKFLOWS-AND-SCENARIOS.md`,
  `docs/season-readiness/ORCHESTRATOR-RUNBOOK.md`,
  `docs/season-readiness/SCORECARD.md`, and the ledger tail before drawing a
  conclusion.
- Recheck all worktrees and the North Fork task state. If its changed-file
  footprint expands into Weather, Inventory, Scouting, season manifest, Cedar
  contract, or shared repository/queue code, record `WAITING` and the exact
  overlap.
- Use read-only commands such as `rg`, `git status`, `git log`, `git show`,
  `git diff`, and file reads.
- Do not run commands that can write caches, build outputs, browser artifacts,
  database state, local storage, containers, listeners, or generated files.
- Do not run `npm`, `npx`, TypeScript builds, Playwright, Vite, Docker, the
  Supabase CLI, migrations, or season proof in this audit.
- Do not use Graphify or build a new code graph. The audit surface is bounded
  and Farm Rx has no maintained Graphify graph.
- Treat archived design/build notes as historical leads only. Current source,
  migrations, canonical scenario text, and exact Git state control.
- Findings must include severity, farmer impact, exact evidence, and whether
  they are a product defect, proof gap, or out-of-scope integration.
- The final audit should name the future one-writer implementation tranche and
  recommend a separate fresh-context Sol exact-SHA review only after a future
  immutable implementation/proof commit exists.

## ORCHESTRATION

Use the root `gpt-5.6-sol` task as orchestrator. Create a Goal for this finite
audit. Do not create a recurring automation, polling loop, watcher, or Graphify
graph.

The root may use at most two bounded read-only subagents:

1. A Terra source/UX mapper for the farmer-visible Weather, manual spray form,
   stale-cache wording, Scouting receipt, and phone-layout path.
2. A Sol adversarial data-boundary reviewer for cache/network isolation,
   repository/RLS/write identities, Inventory arithmetic, queues/retries, and
   named non-writes.

Workers must not edit files, run application/test/database processes, access
live services, or delegate again. The root Sol must independently verify their
evidence against current source and write the final audit artifact.

## FIRST ACTION

Create the Goal, verify current Git/worktree/task state, and return one concise
preflight containing:

- clean audit worktree path, branch, HEAD, and `origin/main`;
- active North Fork worktree and changed-file overlap;
- the exact source files to inspect;
- confirmation that the only write will be the audit Markdown artifact;
- confirmation that no local backend, browser, provider, or live service will
  be touched.

Then continue automatically through the bounded read-only audit. Stop only for
a hard blocker or if the requested evidence would require a prohibited write or
live action.

Verify current state from Git, disk, and connected services before trusting this handoff; it may be stale when read.
