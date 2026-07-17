# NO-GO

Two MEDIUM release blockers remain.

## 1. Offline Equipment deletion leaves an incorrect meter reading

Exact evidence:

- [equipmentTasksWriteQueue.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/equipmentTasksWriteQueue.ts:10): a queued `deleteServiceLogEntry` stores only the log ID.
- [QueuedEquipmentTasksRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedEquipmentTasksRepository.ts:38): the overlay can identify the paired meter reading only when the service log was added by the same pending queue.
- [0035_operational_integrity.sql](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/supabase/migrations/0035_operational_integrity.sql:149): the server deletion uses persisted provenance and deletes both the service log and its service-created reading.

Reachable failure:

1. Load an already-synced service log and its paired meter reading.
2. Go offline.
3. Delete the service log.
4. The optimistic workspace removes the log but retains the meter reading.

The real repository probe returned:

```json
{"beforeLogs":1,"beforeReadings":1,"afterLogs":0,"afterReadings":1,"sync":{"kind":"pending","pending":1}}
```

Business impact: the farmer sees the service event removed while Equipment continues using its meter reading, potentially displaying incorrect current-meter and service-due information until reconnection.

Smallest correction: when exact provenance is unavailable, retain both existing records until replay confirms the server deletion. Keep immediate removal only for a same-queue add→delete where the exact `reading_id` is known.

Required proof: seed a canonical existing log plus paired service reading, delete offline, assert they remain or disappear atomically, then replay and confirm both disappear exactly once.

## 2. The required late-failure UI regression is not executable end-to-end

The production path is structured correctly:

- [createSupabaseEquipmentTasksServices.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/createSupabaseEquipmentTasksServices.ts:7) performs queue replay and then due-item generation.
- [App.tsx](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:332) prioritizes caught retry errors over `All changes synced` and preserves **Try again**.

But [queuedOperationContext.regression.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/queuedOperationContext.regression.ts:386) substitutes a generic Fields action that sets `synced` and throws. At line 395 it calls `getSyncNoticeState` directly. It does not execute Equipment replay→`generateDueTasks` failure, mount/click the actual `SyncNotice`, or prove the actual click path avoids `unhandledrejection`.

Business impact: the requested recovery behavior remains unproven against the shipped wiring; a wiring or React-handler regression could still falsely show success or lose recovery.

Required proof: mount the actual notice, install the real Equipment retry action with due generation failing after replay publishes `synced`, click **Try again**, and assert:

- the plain-language error remains visible;
- `All changes synced` is absent;
- **Try again** remains;
- no `unhandledrejection` fires.

## LOW follow-ups

- The lock-delay cancellation regression checks queue bytes, but its starting queue value is `null` at [queuedOperationContext.regression.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/queuedOperationContext.regression.ts:337). Seed a real entry so queue-byte preservation is non-vacuous.
- Fields validation permits a field with zero current arrangements at [SupabaseFieldsRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseFieldsRepository.ts:109), while [FieldsModule.tsx](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/FieldsModule.tsx:922) renders that existing field as not found. The normal save/queue path does not create this state, so this is recovery hardening rather than a release blocker.

## Reconciliation and proof

- Scope: exact **33/33** — 20 core, 10 replay-containment, 2 Review-8 closure files, and `src/data/syncStatus.ts`; no extra implementation/test files.
- Audit artifacts excluded as evidence-only.
- Routes: exact **18 base / 18 current**, unchanged.
- Option 2 SHA-256: exact `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`.
- TypeScript: app and Node configs PASS with fresh non-emitting checks.
- Standalone E2E TypeScript: PASS.
- Regression lanes: **39/39 PASS**.
- In-memory Vite application and service-worker production compilation: PASS.
- Dependency audit: **0 vulnerabilities**.
- Targeted static guards: **11/11 PASS**.
- Foundation static guards: PASS.
- Credential scan: **files=33, findings=0**.
- `git diff --check`: PASS apart from line-ending notices.
- `clearFarmAccess`, cancellation ordering, rejection sinks, typed cancellation propagation, context revalidation, strict queue parsing, clock/cache fences, route permissions, publication ordering, and strict mocks otherwise passed inspection and focused probes.

Skipped limits: no browser/Playwright/phone lane, live service, or database access. Exact disk-writing `npm run build`, `tsc -b --force`, and the file-creating foundation mutation drill were not run because they conflict with the no-create/no-edit instruction; read-only substitutes were used.

Actual model/reasoning: this environment identifies the agent as Codex based on GPT-5 and does not expose a verifiable `gpt-5.6-sol` or Extra High effort setting, so I cannot attest to the requested model configuration.

External mutation: no.
