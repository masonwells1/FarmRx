# Sol High writer - Farmer Simplicity tranche 1

CRITICAL EXECUTION RULE: You are a headless worker with no human in your loop. Do not ask for approval or stop at a plan. Local edits in the isolated worktree are approved. Implement the bounded tranche fully, run the named proof, and report. Do not commit, push, deploy, call live services, alter git refs, or mutate a database.

## Identity and workspace

- Required model: `gpt-5.6-sol`
- Required reasoning effort: `high`
- Worktree: `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity`
- Branch: `codex/farmrx-farmer-simplicity`
- Base HEAD: `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`

Read first:

1. `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity\CLAUDE.md`
2. `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity\docs\farm-rx-handoff.md`
3. `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity\docs\audits\2026-07-16-farmer-simplicity-loop\RECONCILED-SLICE-PLAN.md`
4. Relevant current source and regression files in the manifest below.

## Objective

Implement the first independently reviewed tranche of the Farmer Simplicity Layer:

1. A fail-closed, epoch-fenced access profile for the selected farm that distinguishes active owner, manager, worker, financial worker, read-only member, and named-rep access. It must derive capabilities only from existing `farm_memberships`, `farm_rep_access`, the farm share toggle, current access epochs, and existing server helpers. No email/metadata/route inference and no migration.
2. Integrate that active profile into the existing Farm access context so later Today/navigation UI can consume it. A stale response must never publish after account, session, selected farm, token/generation, or server epoch changes. Offline reuse must be exact-account/exact-farm, within the existing access freshness boundary, and fail closed when the epoch fence is absent or mismatched.
3. Add side-effect-free Fields and Equipment/Tasks snapshot methods. They may read live RLS-filtered data, existing correctly fenced cache, and existing queued overlays. They must not replay queues, acquire/write queue locks or leases, write caches, update sync status, create IDs, invoke `generate_due_service_tasks`, or mutate any storage/database state. Pending overlays must appear once.
4. Equipment snapshot must use the Fields pure snapshot dependency and must not fall back to a mutation-capable Fields `getData()` path.

Do not build Today UI, Quick Record, Programs, alerts, grain, navigation, help, or Equipment progressive disclosure in this tranche.

## Exact file manifest

You may edit only these tracked files:

1. `src/auth/farmContext.ts`
2. `src/auth/FarmAccessContext.tsx`
3. `src/auth/farmContext.regression.ts`
4. `src/App.tsx`
5. `src/data/fields.ts`
6. `src/data/QueuedFieldsRepository.ts`
7. `src/data/SupabaseFieldsRepository.regression.ts`
8. `src/data/equipmentTasks.ts`
9. `src/data/QueuedEquipmentTasksRepository.ts`
10. `src/data/SupabaseEquipmentTasksRepository.ts`
11. `src/data/SupabaseEquipmentTasksRepository.regression.ts`
12. `src/data/createSupabaseEquipmentTasksServices.ts`

Do not edit package.json; use the already-registered regression files. Do not create a new tracked source/test file. If a complete safe implementation requires any other tracked file, stop before editing and report the exact extra file and reason.

The existing untracked audit directory is orchestrator-owned. Do not edit or delete it.

## Required proof

Add regression proof in the existing registered regression files for at least:

- owner, manager, worker, financial worker, read-only, named rep, disabled rep, share-off rep, dual member/rep, unknown/malformed role, and cross-farm rows;
- delayed access-profile response after account replacement, farm switch, and same-farm epoch change;
- offline profile reuse with matching fence and fail-closed reuse with missing/mismatched fence;
- Fields snapshot online and offline with queued overlays exactly once;
- zero replay, queue/storage write, cache write, lease write, ID creation, or sync-status change from Fields snapshot;
- Equipment/Tasks snapshot loads existing tasks/service-due data without due-task generation and without mutation;
- Equipment/Tasks snapshot refuses a Fields repository that does not expose a pure snapshot;
- cross-farm rows and context changes fail closed.

Run, in this order:

1. `npx tsx src/auth/farmContext.regression.ts`
2. `npx tsx src/data/SupabaseFieldsRepository.regression.ts`
3. `npx tsx src/data/SupabaseEquipmentTasksRepository.regression.ts`
4. `npx tsc -b --force`
5. `git diff --check`
6. `git status --short`

If one proof fails, preserve the exact failure, fix only within the manifest, and rerun the focused proof. Do not weaken or delete an existing test.

## Final report

Report:

- actual model and effort;
- files read;
- files changed;
- commands run and exact result;
- which negative attacks passed;
- any failure or residual risk;
- whether any external mutation occurred (must be `no`);
- whether any file outside the manifest changed.

Do not claim done from exit code alone. Inspect the diff and named proof before answering.
