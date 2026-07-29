# Tranche 1 scope correction

The first Sol writer was stopped after it edited `src/data/SupabaseFieldsRepository.ts`, which was necessary for the live pure-Fields snapshot but was accidentally omitted from the declared manifest.

- No commit, push, deployment, live-service call, or database mutation occurred.
- The partial diff was preserved rather than reverted.
- The corrected manifest explicitly includes `src/data/SupabaseFieldsRepository.ts`.
- `src/data/createSupabaseEquipmentTasksServices.ts` remains allowed only if the completed snapshot wiring requires it; the writer must leave it untouched otherwise.
- The corrected tranche remains below the 20-file independent-review ceiling: 13 allowed tracked files total, with no more than 8 data-snapshot files.

The replacement writer must inspect the partial diff, acknowledge this correction, complete only the corrected manifest, and run the full named proof.

## Final adversarial-review expansion

The first Sol/Terra/Luna review exposed four safety gaps that could not be fixed or proven inside the original 13-file manifest. The orchestrator therefore expanded the completed checkpoint to **18 production/test files**, still below the 20-file independent-review ceiling:

- `src/data/workspaceCache.ts` — pure existing-cache reads and freshness fencing.
- `src/data/equipmentTasksWriteQueue.ts` — exact offline queue semantics.
- `src/data/queuedOperationContext.regression.ts` — operation-context regression coverage.
- `tests/e2e/foundation-shell.spec.ts` — signed-in access-profile request fixtures.
- `src/data/deviceClockFence.ts` — shared durable clock-rollback fence required by access and write-free snapshots.

The other 13 files remain the corrected original manifest. This expansion was technically required by the recorded reviewer findings and was not authorized for commit.

## Final review-2 repair expansion

The second independent Sol/Terra/Luna review proved that the capability-gated replay fix was incomplete anywhere a queued repository still replayed from its constructor, an `online` listener, a cross-tab subscription, or an ordinary read. It also proved that the Fields queue/parser and one legacy test fixture did not yet match the database commodity-ID contract. Leaving equivalent replay paths in sibling modules would preserve the same role-downgrade and reconnect weakness.

The frozen checkpoint is therefore split into two independently reviewed pre-commit tranches, each within the 20-file ceiling. Neither tranche is authorized for commit yet.

### Core integrity tranche — exactly 20 files

- `src/App.tsx`
- `src/auth/FarmAccessContext.tsx`
- `src/auth/farmContext.regression.ts`
- `src/auth/farmContext.ts`
- `src/data/QueuedEquipmentTasksRepository.ts`
- `src/data/QueuedFieldsRepository.ts`
- `src/data/SupabaseEquipmentTasksRepository.regression.ts`
- `src/data/SupabaseEquipmentTasksRepository.ts`
- `src/data/SupabaseFieldsRepository.regression.ts`
- `src/data/SupabaseFieldsRepository.ts`
- `src/data/createSupabaseEquipmentTasksServices.ts`
- `src/data/deviceClockFence.ts`
- `src/data/equipmentTasks.ts`
- `src/data/equipmentTasksWriteQueue.ts`
- `src/data/fields.ts`
- `src/data/flexLeaseValidation.ts`
- `src/data/queuedOperationContext.regression.ts`
- `src/data/workspaceCache.ts`
- `src/data/writeQueue.ts`
- `tests/e2e/foundation-shell.spec.ts`

### Replay containment tranche — exactly 10 files

- `src/data/QueuedFieldLogRepository.ts`
- `src/data/QueuedGrainRepository.ts`
- `src/data/QueuedHarvestRepository.ts`
- `src/data/QueuedInventoryRepository.ts`
- `src/data/QueuedNotificationsRepository.ts`
- `src/data/QueuedProfitabilityRepository.ts`
- `src/data/QueuedProgramsRepository.ts`
- `src/data/QueuedScoutingRepository.ts`
- `src/data/fieldEditPatch.regression.ts`
- `src/data/fieldLocation.ts`

## Review-8 closure repair expansion

The eighth pinned Sol/Terra/Luna review found two required closure files outside the prior split. The complete checkpoint is now **32 production/test files**:

- `src/data/index.ts` — binds Fields and field-location reads to one atomic `currentFarmContext` lookup so an account switch cannot combine one user's identity with another farm selection.
- `src/data/weatherService.regression.ts` — proves field-location RPC echoes match the exact requested coordinates and source, not merely a valid field ID.

These two files form a third closure-repair tranche and keep every independently reviewed tranche within the 20-file ceiling. The expansion is limited to wiring and regression proof directly required by Review 8.

The audit directory is evidence-only and excluded from any future code commit. The complete 32-file checkpoint must receive fresh independent review and Mason must see the exact proposed commit split before any commit runs.

## Review-9 closure repair expansion

The ninth pinned Sol Extra High review reproduced three reachable replay failures after the 32-file checkpoint: a replay could miss cancellation while waiting for its queue lock, farm selection and sign-out cleanup did not both synchronously cancel the old replay grant, and the single **Try again** action ran farm-authorized module retries concurrently while swallowing their failures.

The lock-delay and context-boundary repairs remain inside the existing 32 files. The retry repair requires one additional production file, so the complete checkpoint is now **33 production/test files**:

- `src/data/syncStatus.ts` — serializes module retry actions, stops immediately on a typed farm-context cancellation, continues ordinary module retries, and surfaces the first ordinary error after every eligible module has been attempted.

`src/data/syncStatus.ts` forms a one-file fourth closure-repair tranche. Every independent-review tranche remains below the 20-file ceiling. The focused regression uses the real queue lock and typed replay authorization to prove lock-delay cancellation, and it proves aggregate retries run sequentially and do not absorb a farm-context cancellation.

The audit directory remains evidence-only and excluded from any future code commit. The complete 33-file checkpoint must receive fresh independent review and Mason must see the exact proposed commit split before any commit runs.

## Review-10 closure repairs — no scope expansion

The tenth pinned Sol Extra High review found one MEDIUM farmer-facing recovery defect and four LOW proof/hardening gaps. All corrections stay inside the existing 33-file checkpoint:

- `src/App.tsx` and `src/data/syncStatus.ts` prioritize a caught retry failure over a stale aggregate `synced` state, retaining a plain-language alert and **Try again** action.
- The existing eleven replay-source files now route post-save background replay through the rejection sink in `src/data/writeQueue.ts`, while central/manual awaited replay still propagates typed cancellation.
- `src/auth/farmContext.regression.ts` verifies sign-out cancellation at the first cleanup storage write.
- `src/data/queuedOperationContext.regression.ts` proves the late retry failure stays visible, background cancellation creates no unhandled rejection, and lock-delay cancellation preserves queue bytes, receipt state, cache access, writer calls, and status.
- The evidence-only credential scan now excludes `docs/audits` and deterministically reports the 33 implementation/test files.

No implementation/test file was added. The final checkpoint remains exactly **33 production/test files**; audit prompts, runners, outputs, and ledgers remain excluded from any code commit.

## Review-11 blocker repair expansion

The eleventh pinned Sol review found that an offline delete could hide an already-synced service log without also hiding its paired meter reading, and that the database's original provenance trigger ran before the service writer created the new reading. Closing that data-loss risk honestly required seven additional code/configuration files. The complete checkpoint is now exactly **40 files**:

- `package.json` and `package-lock.json` — pin test-only `happy-dom@20.10.6` for the mounted SyncNotice proof.
- `src/FieldsModule.tsx` and `src/data/fieldEditPatch.ts` — distinguish a missing current agreement from a deleted field and fail closed rather than guessing owned ground.
- `scripts/verify-0035-disposable.ps1` — exercise the real service writer and exact reading ID in the existing operational-integrity probe.
- `scripts/verify-0042-disposable.ps1` — prove exact new provenance, safe one-to-one historical backfill, ambiguous-history preservation, privileges, and exact reversal on PostgreSQL 17.
- `supabase/migrations/20260717023021_repair_service_log_meter_provenance.sql` — remove heuristic provenance, wrap the existing RLS-aware writer, link the explicit reading atomically, and make ambiguous reversals fail closed.

The prior 33 files remain unchanged as the earlier four reviewed tranches. Audit artifacts remain evidence-only and excluded from the code/configuration scope.

## Review-12 closure — no scope expansion

The final local subreview caught one misleading recovery action: a missing-agreement state linked to the field-basics editor, whose fallback could synthesize owned ground. The repair stays inside the 40-file checkpoint: the form now preserves a real current agreement for existing fields or fails closed, the read-only state no longer claims it can repair the agreement, and the pure regression proves an existing missing-agreement field cannot receive the new-field owned default.

The exact release-candidate scope remains **40 files**. No commit, push, live migration, deployment, production change, browser/Playwright run, or phone ship test is authorized by this checkpoint.

## Review-13 database closure — no scope expansion

A deeper database subreview rejected the preliminary Review-12 GO after finding three reachable gaps: historical same-value readings could still be guessed, authenticated direct table deletion could bypass the atomic reversal RPC, and save/delete used different advisory locks. The corrections remain inside the existing migration and disposable probe files:

- Historical backfill, exact-link validation, reversal, and the deferred provenance backstop now require `notes IS NULL` and exact `created_at` equality in addition to the existing farm/equipment/value/date/creator checks.
- A deferred constraint trigger rejects any surviving metered service log without an exact provenance row, including direct insert or private-core bypass attempts.
- Direct authenticated `DELETE` on `equipment_service_log` is revoked; the public atomic reversal RPC remains the supported delete path.
- Save and delete take the same farm advisory lock before delete reads service state, serializing interval recomputation.
- The PostgreSQL 17 probe attacks noted/older lookalikes, ambiguity, direct unlinked inserts, grants, trigger metadata, and a real two-session save/delete race through `dblink`.

The database specialist re-reviewed the repaired bytes and returned GO with no HIGH or MEDIUM issue. The exact release-candidate scope remains **40 files**. Review-12 model outputs are preliminary and superseded; Review-13 is the authoritative final model review. Browser/Playwright/phone results remain excluded from release evidence.

## Review-14 full checkpoint closure — no scope expansion

The pinned Sol Extra High Review 13 overrode the narrower database subreview and found seven reachable MEDIUM release blockers. All seven corrections remain inside the exact existing 40-file checkpoint:

- Deleting a service interval now preserves ambiguous historical service logs and meter readings by allowing only the foreign-key provenance pointer to clear; provenance-defining fields remain immutable.
- Service-interval completion is recomputed deterministically from canonical service history. Backdated offline replay cannot roll back a newer completion, and a later calendar-only service retains the latest linked meter reading.
- A stale /fields/:id/edit URL now renders the existing not-found recovery state and cannot silently enter the Add Field save path.
- A failed farm switch remains visibly on the current farm, restores that farm's replay authorization, keeps queued bytes unchanged, and surfaces a plain-language alert.
- A late startup/reconnect due-generation failure stays in the retryable blocked gate; Try again is locked against double clicks and only publishes retry actions after the whole attempt succeeds.
- The 0042 PostgreSQL 17 probe now uses distinct lookalike fixtures, IS DISTINCT FROM assertions, and real authenticated-role attacks against direct delete, private-core execution, and unlinked insert paths.
- The queue-lock cancellation proof derives its receipt from the actual queued save operation and proves that exact receipt and durable queue bytes remain unchanged.

Mounted non-browser regressions exercise the real Farm switcher and startup gate with the production Equipment queue/factory. All nine disposable PostgreSQL 17 probes, 39 regression lanes, forced and standalone-E2E TypeScript checks, production build, dependency audit, targeted guards, foundation guards/mutation drills, credential scan, diff check, exact 40-file scope, unchanged 18-route manifest, and the selected Option 2 hash are green.

Review-13 outputs are retained as historical rejected evidence. Review-14 is the authoritative final model review once all three pinned reviewers return no HIGH or MEDIUM finding. Browser/Playwright and phone ship tests remain deliberately excluded. No commit, push, deployment, live migration, production change, or other external mutation is authorized by this checkpoint.

## Review-15 closure after Review-14 Sol rejection

Review 14 is historical rejected evidence: Terra and Luna returned GO, but Sol Extra High found one HIGH and three MEDIUM reachable failures. Sol's verdict governs. The corrections add exactly three implementation/proof files, expanding the release-candidate scope from 40 to **43 files**:

- `src/data/programDueItems.ts` and `src/data/programDueItems.regression.ts` — startup and reconnect now use a strict due-generation path, so a late failure keeps the farmer in the visible retryable gate instead of being silently reported as skipped.
- `supabase/migrations/20260717105500_harden_operational_write_boundaries.sql` — excludes read-only members from operational writes, reserves direct service meter rows to the manual source, protects Program task provenance behind table-owner Program RPCs, removes the obsolete client-settable bypass, revokes the private service writer/linker boundary, and makes the public service writer a locked, empty-search-path definer that refuses unproven historical attachment.

The other Review-14 corrections stay inside the existing 40 files:

- Farm selection persistence now rolls the access record and active-farm ID back as one logical operation. If rollback itself fails, both records are invalidated and the app fails closed rather than publishing a split farm context.
- The generic Tasks writer rejects every existing Program-owned task before considering an incoming manual source, blocking both same-source status changes and Program-to-manual downgrades.
- Structured flex-cash-rent queue entries reject a null formula rather than accepting corrupt offline state.
- The PostgreSQL 17 proof now impersonates a real read-only member and an authenticated owner, attacks direct Program create/update/downgrade/delete, private core/linker access, public historical replay, direct service-source readings, and proves the trusted Program RPC plus new/idempotent service flow still work. Interval deletion compares the full preserved log and reading rows, excluding only the intended interval pointer and log update stamp.

Fresh outer proof on the exact 43-file bytes is green: forced and standalone-E2E TypeScript, all 39 regression lanes, production build, dependency audit with zero vulnerabilities, targeted guards 11/11, foundation static guards, controlled mutation drills 11/11, credential scan 43/0, diff check, staged-empty check, exact scope 43/43, unchanged routes 18/18, exact Option 2 hash, and all nine disposable PostgreSQL 17 probes. Review 15 is the next authoritative pinned Sol/Terra/Luna review. Browser/Playwright and phone tests remain deliberately excluded, and no commit, push, deployment, live migration, production change, or other external mutation has been authorized.
