NO-GO

HIGH blocker: offline retry still invokes server due generation.

- [App.tsx:457](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:457) installs Equipment retry as `replayEquipmentTasksQueue`.
- [createSupabaseEquipmentTasksServices.ts:21](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/createSupabaseEquipmentTasksServices.ts:21) always inspects the queue, then calls strict due generation.
- [App.tsx:461](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:461) does the same for Program retry.
- Neither retry path checks `latestProfile.source === "live"` or offline state.

Normal offline startup correctly skips both due generators, but the installed retry control reintroduces the server-only call. A farmer with valid cached access and pending work can therefore trigger an RPC while offline, violating the required offline contract.

The live startup path is otherwise correctly awaited, strict, cancellation-guarded, and visibly retryable before publishing `ready`. The 0042 supported service workflows execute under `SET LOCAL ROLE authenticated`; owner-only checks are limited to migration/private/catalog assertions.

LOW follow-up: make Program and Equipment retry actions inspect/replay queues offline, and run strict due generation only after a live profile is revalidated.

Scope/proof: HEAD equals base `48aad521…`; staged files: 0; 39 modified plus 4 intended untracked non-audit files; 18 routes unchanged; Option 2 hash matches `D62CF729…EA10D38`. Browser/Playwright/phone, live services, and persistent database checks were not run. Outer proof reports were treated as claims, not substitutes for this source finding.

Model/effort: current GPT-5 session; `gpt-5.6-luna` with Medium reasoning was not available as a selectable runtime here.

External mutation: no.
