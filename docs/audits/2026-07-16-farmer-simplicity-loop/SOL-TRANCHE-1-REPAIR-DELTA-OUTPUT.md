No BLOCKER or HIGH findings.

## Findings

- MEDIUM — Retained/cold Fields validation is only a shallow farm check. [QueuedFieldsRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedFieldsRepository.ts:19) verifies arrays and `farm_id`, then accepts cached data at [line 106](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedFieldsRepository.ts:106). Malformed same-farm rows, duplicate IDs, and dangling entity references all passed the adversarial probe. Equipment’s canonical validator inherits the same weakness for nested Fields data at [SupabaseEquipmentTasksRepository.ts:32](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseEquipmentTasksRepository.ts:32). Smallest correction: introduce one reusable Fields workspace canonicalizer covering row shape, unique IDs, and entity/field/commodity/arrangement relations; run it before retaining data and after overlays in both repositories.

- MEDIUM — Equipment queue numeric validation checks only finiteness/sign, not database range or scale. [equipmentTasksWriteQueue.ts:22](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/equipmentTasksWriteQueue.ts:22) through [line 30](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/equipmentTasksWriteQueue.ts:30) accepted `1e100` for purchase price, meter readings, interval readings, and service cost. These exceed PostgreSQL `numeric(16,2)`/`numeric(18,2)` and would become failed or ambiguous offline replays. Smallest correction: add numeric helpers matching PostgreSQL precision/scale and signed-32-bit range for `every_months`, then use them in both queue and workspace validators.

- LOW — The semantic queue regression combines several defects in each malformed object at [SupabaseEquipmentTasksRepository.regression.ts:163](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseEquipmentTasksRepository.regression.ts:163). One working check can mask missing validation for the other fields. Smallest correction: one table-driven mutation per rule, including upper numeric limits, oversized text, optional fields, and unexpected keys.

- LOW — E2E fixtures return successful profile evidence based mainly on endpoint path at [foundation-shell.spec.ts:70](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/tests/e2e/foundation-shell.spec.ts:70) and [line 78](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/tests/e2e/foundation-shell.spec.ts:78). Incorrect `user_id`/`rep_user_id` filters or RPC JSON bodies could still pass. Production request shapes are currently correct at [farmContext.ts:243](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:243). Smallest correction: assert exact query parameters and `{target_farm_id}` request bodies in the mocks.

## Verdict

**NO-GO.** The previous HIGH clock/publication issue is repaired, but the two MEDIUM validator gaps should be corrected before commit approval.

Verified clean:

- General access, profile access, retained Fields, retained Equipment, and fresh-repository rollback all reject clock rollback. The fresh-repository probe recorded zero storage writes and zero IndexedDB opens.
- Profile token and epoch changes during final `setItem` reject, delete the cached profile, and return no stale profile.
- No session token is persisted or logged.
- Blank/oversized text, impossible dates, negative values, missing interval rules, meter/reading mismatch, cross-farm equipment, missing program linkage, malformed optional fields, and unexpected keys reject. Only upper numeric bounds remain open.
- Equipment’s top-level validator runs before retention and after overlays; farm/equipment/interval/field/member relations and duplicate equipment-domain IDs fail closed.
- Pure snapshots perform no replay, access resolution, ID generation, notice publication, sync-state change, or storage write.
- Capability derivation and production provider composition are internally consistent.
- Cold-cache source uses an existing database/store, `readonly` transactions, no cache notice, and no write path. Real-browser verification was prohibited.

## Commands and results

- App and Node TypeScript: `tsc --noEmit` — PASS.
- `farmContext.regression.ts` — PASS.
- `SupabaseFieldsRepository.regression.ts` — PASS.
- `SupabaseEquipmentTasksRepository.regression.ts` — PASS.
- `queuedOperationContext.regression.ts` — PASS.
- `git diff --check` — PASS; line-ending warnings only.
- Custom cold rollback probe — Fields rejected, Equipment rejected, zero writes, zero IndexedDB opens.
- Custom numeric probe — four oversized numeric Equipment payload types incorrectly accepted.
- No Playwright, browser, build, live service, or database command was run.

## 18-file reconciliation

Confirmed 17 tracked modifications plus untracked `src/data/deviceClockFence.ts`:

- Auth/composition: `src/App.tsx`, `src/auth/FarmAccessContext.tsx`, `src/auth/farmContext.ts`, `src/auth/farmContext.regression.ts`.
- Fields: `src/data/QueuedFieldsRepository.ts`, `src/data/SupabaseFieldsRepository.ts`, `src/data/SupabaseFieldsRepository.regression.ts`, `src/data/fields.ts`.
- Equipment/Tasks: `src/data/QueuedEquipmentTasksRepository.ts`, `src/data/SupabaseEquipmentTasksRepository.ts`, `src/data/SupabaseEquipmentTasksRepository.regression.ts`, `src/data/createSupabaseEquipmentTasksServices.ts`, `src/data/equipmentTasks.ts`, `src/data/equipmentTasksWriteQueue.ts`.
- Shared/tests: `src/data/deviceClockFence.ts`, `src/data/workspaceCache.ts`, `src/data/queuedOperationContext.regression.ts`, `tests/e2e/foundation-shell.spec.ts`.

Audit artifacts remain excluded. `SCOPE-CORRECTION.md` still requires Mason’s explicit approval of the complete 18-file checkpoint before any commit.

External mutation: no
