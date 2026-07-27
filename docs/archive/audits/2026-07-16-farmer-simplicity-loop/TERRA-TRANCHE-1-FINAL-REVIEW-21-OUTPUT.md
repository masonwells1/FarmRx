## HIGH — an old sign-out can erase a newer tab’s accepted session

`signOut()` awaits `clearFarmAccess(userId)` before it fences or clears shared auth storage ([AuthProvider.tsx](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/AuthProvider.tsx:451)). `clearFarmAccess()` awaits IndexedDB cache deletion ([farmContext.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:824)), leaving a real cross-tab interleaving window.

Reachable sequence: tab A signs out account A; while its cache deletion is pending, tab B completes password sign-in for B and persists an accepted nonce/session; A resumes and unconditionally removes the shared session and intent, then writes a signed-out fence ([AuthProvider.tsx](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/AuthProvider.tsx:455)). This signs out B and destroys B’s accepted bytes.

Smallest safe correction: capture A’s exact accepted lineage/intent before the await; after `clearFarmAccess`, only mutate shared auth bytes if that same lineage still owns the current shared intent/session. Add a mounted two-provider delayed-`clearFarmAccess` regression proving B remains rendered and its exact bytes/nonce survive.

The existing fixture is meaningfully two-provider/two-client with asynchronous storage delivery ([queuedOperationContext.regression.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/queuedOperationContext.regression.ts:781)), but its `clearFarmAccess` resolves immediately ([queuedOperationContext.regression.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/queuedOperationContext.regression.ts:818)); it cannot catch this production ordering.

Scope checks: 44 non-audit files, zero staged, HEAD equals base, 18/18 ordered routes unchanged, and Option 2 hash exactly matches. I did not rerun regressions/build/audit/disposable DB lanes; browser/Playwright/phone were excluded.

Model/effort: requested `gpt-5.6-terra` Medium; actual runtime label not exposed.

**NO-GO**

LOW follow-up: make the delayed external-sign-out/newer-sign-in race an explicit fixture case.

External mutation: no
