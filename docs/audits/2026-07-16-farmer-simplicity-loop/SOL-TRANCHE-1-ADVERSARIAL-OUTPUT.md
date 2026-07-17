Verdict: **NO-GO.** One blocker and two high-severity defects are proven.

## BLOCKER

**B-01 — Production `getSnapshot()` paths mutate device state. [PROVEN]**

Evidence:

- Fields and Equipment/Tasks begin by resolving context through injected `getContext`: [QueuedFieldsRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedFieldsRepository.ts:43), [QueuedEquipmentTasksRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedEquipmentTasksRepository.ts:22).
- Production wires those dependencies through `currentFarmContext()`: [index.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/index.ts:21), [index.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/index.ts:53).
- `currentFarmContext()` calls `loadFarmAccess()`: [farmContext.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:415).
- Once its 30-second reuse window expires, access refresh writes validation, fence, epoch, access, and active-context records and can quarantine queues/delete IndexedDB caches: [farmContext.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:322), [farmContext.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:396). Its fallback transaction can also write a localStorage lease: [queueTransaction.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/queueTransaction.ts:92).

Concrete failure: a Today snapshot after a cold start or access cache older than 30 seconds can write device state, initialize/reset fences, quarantine queued work, or delete cached workspaces before loading Fields or Tasks. A runtime probe of the real resolver produced **six localStorage writes** from one cold `currentFarmContext()` call.

Smallest safe correction: capture one read-only `FarmOperationContext` from the already-published access provider and pass it explicitly into every snapshot. Snapshot code and final verification must only compare that captured context using read-only storage/session reads; they must never call `currentFarmContext()` or `loadFarmAccess()`. Add a production-composition storage spy test with missing/expired access reuse.

## HIGH

**H-01 — Clock rollback or future timestamps bypass the seven-day offline access limit. [PROVEN]**

Evidence: cache parsing accepts any parseable timestamp, while all expiry checks only reject a positive age exceeding the maximum: [farmContext.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:80), [farmContext.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:270), [farmContext.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:398).

Concrete failure: after revocation, a device clock moved behind `validatedAt`, or malformed cache dated in the future, produces a negative age and remains reusable offline indefinitely. A runtime probe accepted an offline owner profile dated **2099** while `now` was **2026**.

Smallest safe correction: reject timestamps later than the captured current time plus a small skew allowance, detect backward clock movement using a persisted high-water value, and preferably base expiry on server-issued validation/expiry time. Add future-date, rollback, expired-access, and expired-profile regressions.

**H-02 — Snapshot offline fallback has no age or provenance and ignores an existing disk cache after restart. [PROVEN]**

Evidence:

- Normal reads discard the cache timestamp when retaining data: [QueuedFieldsRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedFieldsRepository.ts:70), [QueuedEquipmentTasksRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedEquipmentTasksRepository.ts:45).
- Snapshots return any retained workspace without checking age or identifying it as offline: [QueuedFieldsRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedFieldsRepository.ts:90), [QueuedEquipmentTasksRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedEquipmentTasksRepository.ts:60).
- Neither snapshot reads the fenced IndexedDB cache if in-memory state is absent.

Concrete failure: a tab can show Fields or due tasks loaded eight days—or much longer—earlier as an unlabelled current snapshot. Conversely, after restarting the app, a valid fenced cache exists but Today fails because only retained memory is consulted.

Smallest safe correction: retain and return `{data, source, capturedAt}`, enforce the seven-day ceiling before fallback, and add a strictly read-only cache reader that neither creates/upgrades IndexedDB nor publishes cache/sync notices.

## MEDIUM

**M-01 — Malformed Equipment/Tasks queue values enter snapshots. [PROVEN]**

Evidence: the queue parser accepts any object for `saveEquipment`, `addMeterReading`, `saveInterval`, and `saveTask`: [equipmentTasksWriteQueue.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/equipmentTasksWriteQueue.ts:17). The overlay then casts those unchecked values into canonical records: [QueuedEquipmentTasksRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedEquipmentTasksRepository.ts:33).

Concrete failure: a `saveTask` entry with `value: {}` was accepted by the real parser. `getSnapshot()` can consequently return a task with missing ID, title, status, and references, potentially crashing or corrupting Today’s due-task presentation.

Smallest safe correction: enforce exact full schemas for every queue operation and validate the complete post-overlay workspace with the same invariants used for live rows. Add one malformed-value negative test per operation kind.

## LOW

**L-01 — Purity tests use simplified dependencies that hide the production defects. [PROVEN]**

Fields injects a constant pure `getContext` and tests retained data immediately: [SupabaseFieldsRepository.regression.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseFieldsRepository.regression.ts:64), [SupabaseFieldsRepository.regression.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseFieldsRepository.regression.ts:77). Equipment does the same: [SupabaseEquipmentTasksRepository.regression.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseEquipmentTasksRepository.regression.ts:71). Its malformed-queue negative test only covers one service-log field: [SupabaseEquipmentTasksRepository.regression.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseEquipmentTasksRepository.regression.ts:125).

Smallest safe correction: add production factory/composition tests, aged and cold-start cache tests, clock rollback tests, and complete malformed-queue matrices.

## Question, not a proven defect

Named reps receive `canViewOperational`, but Equipment/Tasks still requires a membership row. Today must explicitly gate this lane using `canUseMembershipOnlyModules` or define a rep-safe viewer contract; current source does not settle that product decision.

## Commands and results

- `git diff --check` — passed.
- App and Node TypeScript checks with `--noEmit --incremental false` — passed.
- Focused auth, Fields, and Equipment/Tasks regressions — passed.
- Complete configured regression suite — passed.
- Adversarial runtime probes:
  - Production context lookup — six writes confirmed.
  - Future-dated offline owner profile — incorrectly accepted.
  - Malformed `{}` task queue value — incorrectly accepted.
- Initial `npx tsx` attempts were sandbox-blocked before execution because `tsx` tried to create a temp directory; rerun successfully with cache-disabled Node loader.
- Build, Playwright, audit/network checks, and live services were not run because they would write artifacts, launch browser state, or violate the no-network constraint.

Residual risks: no live database contract was contacted, so SQL/RLS consistency was inspected from repository migrations only. The untracked audit directory changed during review as other cross-check outputs appeared; I refreshed the current tracked diff afterward. Final HEAD remains `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`; final tracked diff hash is `71065420d2fe885e50974b89423581ff01760ba2`.

External mutation status: `no`.

No finding relies on earlier summaries or memory; memory only guided the read-only, end-state-refresh workflow. The exact launcher model/reasoning header is not exposed inside the repository process and must be validated by the parent launcher.
