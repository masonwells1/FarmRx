## NO-GO

### HIGH

- Offline interval deletion creates an invalid task overlay. [QueuedEquipmentTasksRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedEquipmentTasksRepository.ts:40) clears `interval_id` on linked tasks but leaves `source: "service_interval"` and `interval_cycle_key`. The canonical validator requires non-service tasks to have both fields null, and rejects this result. [SupabaseEquipmentTasksRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseEquipmentTasksRepository.ts:57)
  Result: an offline `deleteInterval` can queue successfully, then make Equipment/Tasks snapshots unavailable until reconnect/replay.
  Smallest correction: when removing an interval, convert affected service-interval tasks to `source: "manual"` and clear both `interval_id` and `interval_cycle_key`; add a queued-delete regression.

- Fields save ingress is weaker than the new canonical workspace contract. [SupabaseFieldsRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseFieldsRepository.ts:139) accepts finite values but not the canonical decimal precision/ranges or full arrangement shape enforced by [the workspace validator](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseFieldsRepository.ts:97). `saveFieldOperation` then maps the RPC echo but does not validate it as a canonical bundle or compare it to the normalized draft. [SupabaseFieldsRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseFieldsRepository.ts:180)
  Examples: `total_acres: 1.001`, `planted_acres: 1.001`, or an `owned` arrangement with non-null rent pass local normalization; numeric database columns such as `total_acres numeric(10,2)` may round rather than preserve farmer input. Invalid arrangement combinations can also be queued offline and later poison the local overlay.
  Smallest correction: apply the same precision/range and arrangement-type rules before enqueue/RPC, then validate and confirm the saved echo against the normalized input. Add direct-online and offline-queue tests for over-precision and invalid arrangement combinations.

Scope reconciliation: exact declared tranche confirmed—17 tracked modified code/test files plus untracked `src/data/deviceClockFence.ts`; no tracked modifications outside those 18. Audit artifacts are excluded.

Checks run:

- `git diff --check` — clean
- `node .\node_modules\typescript\bin\tsc --noEmit -p tsconfig.app.json` — pass
- Static diff/source review against `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`

Residual unexecuted risk: focused TSX regressions could not start because the read-only sandbox denied TSX creation of its temporary IPC directory. E2E/Playwright, build, network, live services, and database actions were not run, per instruction.

External mutation: no
