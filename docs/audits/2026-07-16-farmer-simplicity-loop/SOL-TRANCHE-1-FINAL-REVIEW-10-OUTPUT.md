# NO-GO

No HIGH findings. One MEDIUM release blocker remains.

## MEDIUM — retry failures can be hidden behind “All changes synced”

Evidence:

- The retry handler correctly catches the rejection and records `retryError` in [src/App.tsx](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:339).
- However, when aggregate status is `synced`, the component returns “All changes synced” before reaching the only rendering of `retryError`, which is inside the `blocked` branch at [src/App.tsx](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:350) and [src/App.tsx](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:375).
- This is reachable because Equipment replay first drains its queue and then calls `generateDueTasks()`, which can throw after status became synced, in [createSupabaseEquipmentTasksServices.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/createSupabaseEquipmentTasksServices.ts:7).

Reachable sequence:

1. Equipment is the only blocked module.
2. Farmer presses **Try again**.
3. Queue replay succeeds and publishes `synced`.
4. Due-task generation throws a normal module error.
5. `retrySavedChanges()` surfaces the error and `SyncNotice` catches it.
6. The component renders “All changes synced” and hides the recorded failure.

A fresh non-browser probe reproduced the decisive state:

```json
{"caught":true,"status":{"kind":"synced","pending":0}}
```

Business impact: maintenance or program due-item generation can fail while the farmer is explicitly told everything synced, removing the visible recovery path.

Smallest correction: render `retryError` as an alert before the status-specific early returns, with a retry button even when status is now `synced`.

Non-vacuous proof: install a retry that changes its module to `synced` and then throws; invoke the actual notice retry handler and assert the error alert remains visible, “All changes synced” is not shown, and no `unhandledrejection` event fires.

## Review-9 repair results

- Replay lock ordering: PASS across all 11 entrypoints. Each revalidates after acquiring the lock and before queue reads or status publication. The executable lock-delay test passed, and the all-entrypoint ordering guard at [queuedOperationContext.regression.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/queuedOperationContext.regression.ts:408) would fail if the new post-lock revalidation were removed.
- Synchronous cancellation: production ordering is correct. `selectFarm` and `clearFarmAccess` cancel first at [farmContext.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:553) and [farmContext.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:570).
- Sequential retries: PASS. Ordinary errors continue to later modules and are surfaced afterward; typed context cancellation stops immediately in [syncStatus.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/syncStatus.ts:34). The UI visibility defect above remains.

## LOW follow-ups

- The sign-out regression at [farmContext.regression.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.regression.ts:320) checks cancellation only after calling `clearFarmAccess`. Because all storage cleanup runs synchronously before its first `await`, the test would still pass if cancellation moved after those storage mutations. Add a storage mutation hook that verifies cancellation at the first write.
- The lock-delay regression directly checks writer and status invariance, but not queue bytes, receipts, or cache bytes. Snapshot and compare those explicitly.
- Fire-and-forget replay launches such as [QueuedFieldsRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/QueuedFieldsRepository.ts:111) have no rejection sink. A typed cancellation during these background launches can produce an otherwise harmless browser `unhandledrejection`.
- Credential-scan file count is not stable because it includes evidence-only audit files. The fresh broader scan was **168 files / 0 findings**, not 159; nine review-runner/evidence artifacts were added. Pin the scan to the checkpoint manifest or exclude `docs/audits`.

## Scope and proof

- Scope: **33/33 exact** — 20 core, 10 replay-containment, two Review-8 closure files, and `src/data/syncStatus.ts`; 32 tracked modifications plus untracked `deviceClockFence.ts`. Audit files excluded.
- Routes: **18 base / 18 current**, exact list unchanged.
- Option 2 SHA-256: **D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38**, match.
- Fresh non-writing TypeScript checks: PASS for app, Vite config, and standalone E2E specification.
- All **39/39** regression lanes: PASS.
- Targeted static guards: **11/11 PASS**.
- Foundation static guards: PASS.
- Credential scan: **168 files / 0 findings**.
- `git diff --check`: PASS; line-ending notices only.
- Production build skipped because it writes `dist`, build metadata, and service-worker output, contrary to the read-only instruction.
- Dependency audit skipped because it requires a package-registry live-service call.
- Browser/Playwright/phone, live services, deployment, and database lanes were not run as instructed.

Session configuration: `gpt-5.6-sol`, Extra High reasoning.

External mutation: no
