## Findings

1. **MEDIUM — stale same-user session lineage can reopen offline access.**
   The successful restore path rejects an accepted-intent/session mismatch at [AuthProvider.tsx](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/AuthProvider.tsx:358), but the transport-failure path at line 342 checks only pending/signed-out states before calling offline restoration. [farmContext.ts](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/farmContext.ts:431) validates only `user.id` and JWT `sub`, not the accepted `session_id`.

   Reachable sequence:

   1. Durable accepted intent records user A / session-new.
   2. Persisted auth bytes are overwritten by user A / session-old.
   3. `getSession()` times out or returns a retryable 5xx.
   4. Offline restoration accepts the matching user and `sub`.
   5. `applyOfflineUser()` publishes `signed_in`, allowing fresh cached farm access despite the wrong session lineage.

   This directly violates the required same-user/different-session rejection and transport-fallback isolation.

2. **MEDIUM — the mounted auth proof does not close the specified race matrix.**
   In [queuedOperationContext.regression.ts](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/queuedOperationContext.regression.ts:781), Storage events are queued asynchronously, but auth broadcasts are delivered synchronously at line 802. The fixture therefore does not provide asynchronous ordered delivery for both channels.

   It also lacks:

   - accepted same-user/different-`session_id` transport-fallback coverage—the vulnerable branch above;
   - a competing older commit-error case;
   - a competing older throw case equivalent to the required nonce-ownership race;
   - an exact durable-fence/remount assertion for the signed-out offline fixture.

   Therefore, the green mounted regression is meaningful but insufficient for this release closure.

Required correction: validate any accepted intent against the persisted session lineage before offline restoration; mismatch must clear auth and publish a durable signed-out fence. Then add the exact mounted race cases above.

## Proof reconciliation

| Gate | Independent result |
|---|---|
| Scope | 40 tracked changes + 4 untracked non-audit files = **44** |
| Git | `HEAD` equals base `48aad521…2685`; staged files **0** |
| Routes | Ordered **18/18**, byte-order equivalent route manifest |
| Option 2 | SHA-256 exactly `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38` |
| Regressions | Focused auth/farm PASS; all **39/39** lanes PASS |
| TypeScript | App, Node/Vite, and standalone E2E no-emit checks PASS |
| Guards | Targeted **11/11** and foundation static guards PASS |
| Hygiene | `git diff --check` PASS apart from line-ending notices; credential scan **44/0** |
| Wider review | No additional HIGH/MEDIUM blocker found in queue ordering, retry truth, farm rollback, Fields/flex, Equipment/Program provenance, static RLS, or strict mocks |

Outer claims for the production build, dependency audit, mutation drills, and nine PostgreSQL probes were not used to override the source findings. I did not independently rerun them because build/mutation lanes write files, dependency audit requires network, and Docker is unavailable. Browser/Playwright/phone, live services, persistent migrations, and persistent data were deliberately excluded.

LOW follow-up: wire [verify-0042-disposable.ps1](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/scripts/verify-0042-disposable.ps1:1) into [verify-foundation.ps1](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/scripts/verify-foundation.ps1:43); the durable foundation orchestrator currently omits it.

Model/effort: the runtime model identifier and reasoning-effort setting are not visible, so I cannot truthfully confirm `gpt-5.6-sol` or Extra High.

External mutation: no.

**NO-GO**
