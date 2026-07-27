## Finding

- **MEDIUM — cached offline startup still fails when connectivity is broken but `navigator.onLine` remains `true`.**
  `loadFarmAccess()` correctly falls back after a transport failure and returns `source: "offline"` ([farmContext.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:565)). However, `loadFarmAccessProfile()` ignores `access.source` and uses only `d.isOffline()` ([farmContext.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:398)). It then deletes the valid cached profile before attempting server validation ([farmContext.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:405)). The network failure reaches the mounted gate catch and publishes `blocked` instead of ready ([App.tsx](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:596)).

  Reachable sequence:

  1. Farmer previously opened the farm successfully; valid fenced access and profile caches exist.
  2. Supabase times out, but the browser still says it is online—a normal weak-signal condition.
  3. Access loading returns the cached record with `source: "offline"`.
  4. Profile loading treats the attempt as online, deletes the cached profile, calls the unavailable server, and blocks startup.
  5. The farmer cannot reopen the cached farm, and the profile remains deleted until successful online revalidation.

  Fresh non-writing reproduction:

  `OFFLINE_SOURCE_HANDOFF cached_before=true rejected=true cached_after=false`

  Required repair: make `access.source === "offline"` select the existing fenced cached-profile path regardless of `navigator.onLine`, then add a regression where server dependencies throw while `isOffline()` remains false. Assert no server calls, no profile deletion/write, all replay inspections, retry registration, and mounted ready publication.

## Verified clean

- The Review 18 due-generation repair itself is correct: all 11 queue lanes remain awaited, while Program and Equipment server generation run only for a live profile ([App.tsx](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:497)).
- The mounted offline regression uses the production replay orchestrator, reaches ready, records retry installation, executes every queue lane, and excludes both due-server actions ([queuedOperationContext.regression.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/queuedOperationContext.regression.ts:492)).
- Live strict Equipment failure remains blocking, visible, retryable, serialized, and does not repeat the completed save ([queuedOperationContext.regression.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/queuedOperationContext.regression.ts:448)).
- Manual Equipment retry still combines queue inspection and strict due generation ([createSupabaseEquipmentTasksServices.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/createSupabaseEquipmentTasksServices.ts:15), [App.tsx](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:451)).
- 0042 uses real `authenticated` SQL role for historical reversal ([verify-0042-disposable.ps1](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/scripts/verify-0042-disposable.ps1:120)), canonical save/replay/reversal ([verify-0042-disposable.ps1](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/scripts/verify-0042-disposable.ps1:310)), backdated/calendar flows ([verify-0042-disposable.ps1](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/scripts/verify-0042-disposable.ps1:665)), and both dblink race participants ([verify-0042-disposable.ps1](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/scripts/verify-0042-disposable.ps1:701)). Owner-only sections are limited to migration, catalog, private-state, and deferred-constraint coordination.

## Release closeout

- **Scope:** 39 tracked + 4 untracked non-audit files = exactly 43; staged 0.
- **Git:** HEAD and base both `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`.
- **Routes:** ordered 18/18 identical.
- **Option 2:** exact SHA-256 `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`.
- **Fresh probes:** 39/39 regressions; mounted queued-context regression; non-writing app/Vite and standalone E2E TypeScript; targeted guards 11/11; foundation static guards; credential scan 43/0; `git diff --check`.
- **Skipped by instruction:** build, dependency-network audit, filesystem-writing mutation drills, Docker/PostgreSQL probes, browser/Playwright/phone, live services, deployment, and persistent database lanes. Outer PASS reports for those were not treated as independent execution.
- **LOW follow-up:** strengthen the mounted offline test to exercise real retry registration and the complete `loadAccess → loadProfile → replay → ready` production chain instead of an injected install counter.
- **Model/effort:** exact runtime model and reasoning-effort telemetry are not exposed, so I cannot attest that this invocation is `gpt-5.6-sol` Extra High.
- **External mutation: no**

**NO-GO**
