## Findings

### BLOCKER

1. Queued Field crop edits reject valid production commodity IDs and persist invalid queue bytes before failing.

   Evidence:

   - [writeQueue.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/writeQueue.ts:42) requires `commodity_id` to be a UUID.
   - Production canonical validation expects text slugs such as `corn_yellow`: [SupabaseFieldsRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseFieldsRepository.ts:24) and [0001_module1_fields.sql](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/supabase/migrations/0001_module1_fields.sql:110).
   - Queue storage is written before queue parsing/validation at `writeQueue.ts:58-59`. The probe confirmed valid-slug input was rejected while invalid queue bytes remained persisted.
   - The overlay created at [QueuedFieldsRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedFieldsRepository.ts:150) omits `actual_price_per_bu`, which the canonical parser requires at [SupabaseFieldsRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseFieldsRepository.ts:75).
   - Existing overlay regressions use empty crop assignments and miss this path.

   Smallest safe correction: expand scope to include `src/data/writeQueue.ts`; validate before `setItem`, accept the database-legal commodity slug format, and preserve or explicitly set `actual_price_per_bu` during overlays. Add a non-empty crop-assignment queue/reload/overlay regression.

2. Access-profile publication has a same-account session-token race.

   [farmContext.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:323) reads the final token before awaiting the final server-epoch check at lines 331-332. If the token changes during that await, lines 333-339 still publish the old profile.

   An in-memory probe changed the token during the third epoch request; the owner profile was returned despite the token change. Current tests cover earlier evidence delays and synchronous storage mutations, not this interleaving.

   Smallest safe correction: complete the final epoch read, then re-read and compare the session token immediately before publication, including the local fence. Add a regression that changes the token during the final epoch call.

### HIGH

3. Read-only capability gates do not contain all replay and due-generation writes.

   - Fields and Equipment repositories register unconditional online/retry handlers: [QueuedFieldsRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedFieldsRepository.ts:37) and [QueuedEquipmentTasksRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedEquipmentTasksRepository.ts:24).
   - [syncStatus.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/syncStatus.ts:28) retries every registered repository without a current-profile capability check.
   - Read-only members can open Equipment; normal workspace loading invokes due generation at [SupabaseEquipmentTasksRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseEquipmentTasksRepository.ts:66).
   - The database due-generation function inserts tasks for active members at [0016_equipment_tasks.sql](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/supabase/migrations/0016_equipment_tasks.sql:418).
   - The E2E “no replay” case has no queued work, triggers no reconnect/retry, and never exercises Equipment.

   Smallest safe correction: centralize replay/reconnect/retry dispatch behind the currently published profile; do not register capability-blind repository listeners. Separate due generation from read-only workspace loading and invoke it only with Equipment edit capability.

4. Fields canonical validation accepts flex formulas the database rejects.

   [flexLeaseValidation.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/flexLeaseValidation.ts:14) checks finiteness and floor/cap ordering but permits negative values and does not enforce the server note-length/unknown-key constraints. The database rejects these at [0014_flex_lease_methods.sql](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/supabase/migrations/0014_flex_lease_methods.sql:284).

   The adversarial probe confirmed a negative minimum-price floor was accepted.

   Smallest safe correction: make the shared validator match database constraints exactly and fail closed on unknown keys. This requires adding `flexLeaseValidation.ts` to the corrected scope.

### MEDIUM

5. Equipment canonical validation accepts impossible due-row semantics.

   [SupabaseEquipmentTasksRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseEquipmentTasksRepository.ts:33) validates reason shape, duplicates and dangling links, but does not require:

   - `meter` reason to reference a meter interval;
   - `calendar` reason to reference a calendar interval;
   - referenced interval/equipment to be active.

   The database view enforces those relationships at [0016_equipment_tasks.sql](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/supabase/migrations/0016_equipment_tasks.sql:323). A forged meter-due row referencing a calendar-only interval was accepted.

   Smallest safe correction: enforce the view’s reason/rule/status invariants canonically and add live/cold-cache corruption tests.

6. The authored E2E lane is not currently type- or fixture-valid.

   - Standalone no-emit TypeScript fails at [foundation-shell.spec.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/tests/e2e/foundation-shell.spec.ts:225) because an inferred union is passed as `Record<string,string>`.
   - Its commodity fixture uses a UUID at line 15, while production requires a slug; a probe through the canonical validator rejected the fixture as malformed.
   - Most farms, membership, rep, Fields dependency, epoch and helper mocks use strict request matching. However, the due-program RPC at lines 110-111 does not strictly verify method/body, and the account-replacement fallback at line 239 can conceal unexpected GETs.

   Smallest safe correction: fix the query annotation, use a real commodity slug, strictly match the due-program request, and assert no unexpected replacement-account requests. The browser lane must subsequently be executed outside this prohibited session.

### LOW

7. Direct Equipment queue append does not validate before every queue mutation.

   Normal repository saves validate before receipts, writers and queueing. However, [equipmentTasksWriteQueue.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/equipmentTasksWriteQueue.ts:45) checks for an existing operation ID before validating the supplied entry. A malformed duplicate was accepted and caused a storage rewrite.

   Smallest safe correction: call `validateEquipmentTasksQueueEntry(value)` at the start of `append`, then add a malformed duplicate-operation regression.

8. Snapshot calls mutate repository-retained clock state.

   [QueuedFieldsRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedFieldsRepository.ts:46) and [QueuedEquipmentTasksRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedEquipmentTasksRepository.ts:30) update `clockScopeKey`/`clockHighWaterMs` during snapshots. A probe showed both fields changing from empty to populated.

   No queue, receipt, notice or IndexedDB mutation was observed, but this contradicts the required “no retained-state mutation” snapshot contract and could influence later rollback decisions.

   Smallest safe correction: place monotonic-clock state in immutable operation context or another explicitly authorized fence, and directly test repository state before/after snapshots.

## Verdict

**NO-GO.**

The Fields queue corruption and final-token publication race independently block release. Correcting the first also requires revising the frozen scope beyond the current 18 files.

## Commands and results

- `git rev-parse HEAD`: exactly `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`.
- `git status --short` and base diff reconciliation: exactly 17 modified tracked scope files plus the new device-clock file; audit evidence remained separate.
- `git diff --check`: passed.
- Added-line debug/secret scans: no debug statements, private-key markers, service-role tokens, hard-coded passwords or payment-secret patterns found.
- `tsc -p tsconfig.app.json --noEmit --incremental false`: passed.
- `tsc -p tsconfig.node.json --noEmit --incremental false`: passed.
- Standalone strict no-emit check of `foundation-shell.spec.ts`: failed at line 225.
- Focused regressions run with `TSX_DISABLE_CACHE=1` through the cache-free Node TSX loader:
  - Farm-access regressions: passed.
  - Queued-operation context regressions: passed.
  - Fields repository regressions: passed.
  - Equipment/Tasks repository regressions: passed.
- Additional in-memory adversarial probes reproduced:
  - valid commodity-slug queue rejection plus persisted bad bytes;
  - missing overlay price rejection;
  - negative flex-floor acceptance;
  - forged meter/calendar due acceptance;
  - malformed duplicate Equipment append/storage rewrite;
  - token change during final epoch still publishing;
  - snapshot clock-state mutation;
  - E2E commodity fixture canonical rejection.

## Exact 18-file reconciliation

```text
01 M  src/App.tsx
02 M  src/auth/FarmAccessContext.tsx
03 M  src/auth/farmContext.regression.ts
04 M  src/auth/farmContext.ts
05 M  src/data/QueuedEquipmentTasksRepository.ts
06 M  src/data/QueuedFieldsRepository.ts
07 M  src/data/SupabaseEquipmentTasksRepository.regression.ts
08 M  src/data/SupabaseEquipmentTasksRepository.ts
09 M  src/data/SupabaseFieldsRepository.regression.ts
10 M  src/data/SupabaseFieldsRepository.ts
11 M  src/data/createSupabaseEquipmentTasksServices.ts
12 M  src/data/equipmentTasks.ts
13 M  src/data/equipmentTasksWriteQueue.ts
14 M  src/data/fields.ts
15 M  src/data/queuedOperationContext.regression.ts
16 M  src/data/workspaceCache.ts
17 M  tests/e2e/foundation-shell.spec.ts
18 NEW/untracked  src/data/deviceClockFence.ts
```

The audit directory is untracked evidence and not part of these 18 files. No additional tracked implementation/test file appeared in the checkpoint.

## Residual unexecuted risk

Per instruction, I did not run the build, Playwright/browser lane, network requests, live Supabase/database checks, production checks or deployments. Consequently, browser behavior, actual RLS execution, request compatibility and live schema behavior remain unexecuted—not proven. The browser lane also requires the TypeScript and fixture repairs above before it can provide credible evidence.

**External mutation: no**
