# Sol Extra High final adversarial delta — Farmer Simplicity tranche 1

Fresh-context, read-only final security gate. Inspect the actual current uncommitted diff; do not trust summaries or earlier reviewer conclusions. Do not edit, commit, push, deploy, browse, call live services, change refs, or mutate a database.

- Model `gpt-5.6-sol`, effort `xhigh`, sandbox `read-only`
- Worktree `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity`
- Base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`

The prior review alleged: snapshot context resolution could write device state; future/rollback timestamps bypassed offline age; retained snapshots lacked age/provenance/cold-cache reuse; Equipment queue values were shallowly parsed; profile publication race/malformed cache and E2E mocks lacked proof. Independently verify whether the current source and tests fully correct each claim without introducing new defects.

Attack especially:

1. Prove whether any Fields or Equipment/Tasks `getSnapshot` path can call `currentFarmContext`, `loadFarmAccess`, injected `getContext`, queue replay/locks, generation, sync mutation, cache write, IndexedDB create/upgrade, notice publication, ID creation, or remote mutation.
2. Race the supplied operation context against fence/token/generation/epoch changes and cross-account/farm inputs.
3. Attack future, expired, malformed, inconsistent, and publication-race access/profile caches. Check clock high-water semantics and cleanup.
4. Attack memory and IndexedDB snapshot fallback for age, provenance, missing database/store, browser API gaps, fence changes, cross-farm data, overlays exactly once, and no writes/notices.
5. Attack every Equipment queue value schema and post-overlay invariants.
6. Inspect production composition, interfaces/callers, full regression realism, E2E mock shape, and the exact 17 tracked files.

You may run local read-only checks using `TSX_DISABLE_CACHE=1 node --import tsx` and no-emit TypeScript. Report findings first as BLOCKER/HIGH/MEDIUM/LOW with file/line, failure scenario, and smallest correction. If no blocker/high, say exactly `No BLOCKER or HIGH findings.` Report commands/results, residual risks, tracked-file count, and external mutation `no`.
