# Soil Rx SRX-1 reconciliation handoff

## WHERE

- Repository: `masonwells1/FarmRx`
- Writer worktree: `C:\Users\mason\.codex\worktrees\farmrx-soil-reconcile-20260903`
- Writer branch: `codex/farmrx-soil-reconcile-20260903`
- Verified target base: `origin/main` at `a2e3b90939115e79f4f2aae35e6ba89e640e6d6b`
- Preserved source branch: `codex/farmrx-soil-integration` at `49e47bd3b4b1612864a1b51ebba6b9c7d187a2e4`
- Existing GitHub artifact: draft PR #30, open and `DIRTY`; do not mutate it in this tranche.

## GOAL

Reconcile the already-built Soil Rx SRX-1 storage/history and fail-closed attachment-cleanup stack onto current `main` without regressing Connect Workflows, equipment-cost snapshots, or the current Foundation gates. This tranche is done when the integration is clean, backend-free focused checks pass, the intended diff is frozen, and one immutable local commit is ready for fresh exact-SHA review.

## PROVEN

- The remote and local `origin/main` identities matched at `a2e3b90939115e79f4f2aae35e6ba89e640e6d6b` on 2026-09-03.
- The preserved Soil integration worktree was clean at exact source head `49e47bd3b4b1612864a1b51ebba6b9c7d187a2e4`.
- Draft PR #30's historical Foundation, Vercel, and status checks passed on that old head, but no formal review was recorded and the old evidence does not transfer to a reconciled commit.
- Relative to current `main`, the Soil branch is 17 commits ahead and 3 commits behind, with 52 changed files.
- A no-write trial merge identified conflicts in `package.json`, `scripts/foundation-static-guards.mjs`, and `scripts/verify-foundation-mutations.mjs`. `scripts/verify-foundation.ps1` also changed on both sides and requires deliberate inspection even if Git merges it automatically.
- The non-committing reconciliation retained Soil's storage-before-row-delete receipt custody, queue/repository coverage, native browser proof, and Soil disposable-capture guards together with current-main's equipment-cost Foundation lane and regression. The merged static guard expects 26 Foundation lanes and the merged mutation drill expects 163 controlled mutations.
- Backend-free local checks passed after `npm ci`: `npx tsc -b --force`; Soil repository and queue regressions; equipment-cost regression; Foundation static guards; 163/163 Foundation mutations; and `npm run build`. No Docker, local or live Supabase, browser server, shared backend, scenario, PR, push, deployment, or live system was used.

## WRITTEN, NOT PROVEN

- Full disposable-backend/Foundation/season proof and browser proof were intentionally not run in this local tranche. The reconciled commit SHA must be filled in after the immutable commit is created.

## NOT STARTED

- Full disposable-backend/Foundation/season proof and fresh exact-SHA adversarial review.
- SRX-2 descriptive interpretation and SRX-3 nutrient-removal work; both are intentionally outside this tranche.

## APPROVAL STATE

Mason authorized the Farm Rx orchestrator to identify and delegate remaining work. This permits bounded local edits, tests, and one immutable local commit in this isolated worktree. It does not authorize a push, PR mutation, merge, deployment, live migration or data change, Auth/secret/permission change, customer action, destructive cleanup, or modification of `C:\CRX_Manager`.

## GATES AND BLOCKERS

- One writer owns this worktree. Other agents remain read-only.
- Do not run Docker, local Supabase, or any shared disposable-backend scenario until the orchestrator assigns exclusive backend custody.
- Preserve current-main Connect Workflows and equipment-cost behavior and their proof guards.
- Resolve proof-harness conflicts by retaining both valid safeguards; never choose one side mechanically or weaken an assertion to get green.
- The live state of equipment migration `20260825174316` is being checked independently and is not proof for this local integration.

## FIRST ACTION

Perform a non-committing merge of `codex/farmrx-soil-integration` into this branch, resolve only the verified conflict set, inspect all dual-modified proof and app-registration files, then run backend-free focused checks before creating an immutable commit.

Verify current state from Git, disk, and connected services before trusting this handoff; it may be stale when read.
