Runtime model: `Codex, based on GPT-5`—the exact identity exposed to this session. Reasoning effort was not exposed or printed; all conventional runtime variables were absent. That is a verification limitation.

# RELEASE BLOCKED

One reproducible P2 remains. No P0 or P1 findings.

## Closure table

| Repair group | Status | Production code | Deterministic proof |
|---|---|---|---|
| Recent 1 — A→B replacement cannot render Farm A | Closed | User-keyed remount and render fence: [App.tsx](/C:/FarmRx/src/App.tsx:381), [App.tsx](/C:/FarmRx/src/App.tsx:460) | Browser regression: [foundation-shell.spec.ts](/C:/FarmRx/tests/e2e/foundation-shell.spec.ts:146). Listed and inspected; browser execution was sandbox-limited. |
| Recent 2 — transition state fenced before lock/mutation | Closed | Epoch assertion precedes advisory lock: [0041_unscoped_authenticated_write_fencing.sql](/C:/FarmRx/supabase/migrations/0041_unscoped_authenticated_write_fencing.sql:19), [same migration](/C:/FarmRx/supabase/migrations/0041_unscoped_authenticated_write_fencing.sql:30) | Executed source/dispatch regression: [grainAlerts.regression.ts](/C:/FarmRx/src/data/grainAlerts.regression.ts:48). Disposable stale-epoch proof: [verify-0041-disposable.ps1](/C:/FarmRx/scripts/verify-0041-disposable.ps1:158), not rerun because Docker is unavailable. |
| Recent 3 — push save/delete farm and epoch fencing; legacy signatures retired | Closed | Bound RPCs: [SupabaseNotificationsDataGateway.ts](/C:/FarmRx/src/data/SupabaseNotificationsDataGateway.ts:13). Server assertions and revokes: [0041 migration](/C:/FarmRx/supabase/migrations/0041_unscoped_authenticated_write_fencing.sql:70), [same migration](/C:/FarmRx/supabase/migrations/0041_unscoped_authenticated_write_fencing.sql:127), [same migration](/C:/FarmRx/supabase/migrations/0041_unscoped_authenticated_write_fencing.sql:141) | Executed account-switch regression: [SupabaseNotificationsRepository.regression.ts](/C:/FarmRx/src/data/SupabaseNotificationsRepository.regression.ts:69). |
| Recent 4 — endpoint ownership cannot transfer | Closed | Same-owner conditional upsert and explicit rejection: [0041 migration](/C:/FarmRx/supabase/migrations/0041_unscoped_authenticated_write_fencing.sql:92), [same migration](/C:/FarmRx/supabase/migrations/0041_unscoped_authenticated_write_fencing.sql:104) | Cross-owner pending-target and same-owner refresh drill: [verify-0041-disposable.ps1](/C:/FarmRx/scripts/verify-0041-disposable.ps1:78), [same script](/C:/FarmRx/scripts/verify-0041-disposable.ps1:109). Source inspected; Docker execution unavailable. |
| Recent 5 — queued reads capture and retain exact context | Closed | Scouting boundaries: [QueuedScoutingRepository.ts](/C:/FarmRx/src/data/QueuedScoutingRepository.ts:65). Fields same-user/farm, advanced-fence-only retry: [QueuedFieldsRepository.ts](/C:/FarmRx/src/data/QueuedFieldsRepository.ts:39) | Executed production Scouting race: [queuedOperationContext.regression.ts](/C:/FarmRx/src/data/queuedOperationContext.regression.ts:273). Browser revoke/regrant proof: [foundation-shell.spec.ts](/C:/FarmRx/tests/e2e/foundation-shell.spec.ts:278), not executed here. |
| Earlier A — Scouting Storage and cleanup ownership/versioning | Closed | Exact-session Storage client and between-call verification: [scoutingStorage.ts](/C:/FarmRx/src/data/scoutingStorage.ts:12), [scoutingStorage.ts](/C:/FarmRx/src/data/scoutingStorage.ts:31). Per-user v2 cleanup: [scoutingCleanupOutbox.ts](/C:/FarmRx/src/data/scoutingCleanupOutbox.ts:8) | Executed switch/regrant upload regressions: [SupabaseScoutingRepository.regression.ts](/C:/FarmRx/src/data/SupabaseScoutingRepository.regression.ts:104). |
| Earlier B — Grain capture and final Edge delivery fence | Closed | One captured browser context: [grainAlerts.ts](/C:/FarmRx/src/data/grainAlerts.ts:42). Expected user/epoch parsing and final provider check: [grainAlertAccessFence.ts](/C:/FarmRx/supabase/functions/_shared/grainAlertAccessFence.ts:3), [deliver-grain-alert/index.ts](/C:/FarmRx/supabase/functions/deliver-grain-alert/index.ts:62) | Executed browser and Edge regressions: [grainAlerts.regression.ts](/C:/FarmRx/src/data/grainAlerts.regression.ts:19), [grainAlertAccessFence.regression.ts](/C:/FarmRx/supabase/functions/_shared/grainAlertAccessFence.regression.ts:12). |
| Earlier C — Grain post-acceptance lanes and Profitability insurance | Closed | Delivery, price, offer, and bin final verification: [QueuedGrainRepository.ts](/C:/FarmRx/src/data/QueuedGrainRepository.ts:68). Insurance final verification: [QueuedProfitabilityRepository.ts](/C:/FarmRx/src/data/QueuedProfitabilityRepository.ts:116) | Executed fence-change regressions: [SupabaseGrainRepository.regression.ts](/C:/FarmRx/src/data/SupabaseGrainRepository.regression.ts:245), [SupabaseProfitabilityRepository.regression.ts](/C:/FarmRx/src/data/SupabaseProfitabilityRepository.regression.ts:301). |
| Earlier D — queue/cache/revocation, scheduler, push, privileged SQL, PWA/CSP | **Not closed** | Queue/cache, scheduler, push, SQL grants and CSP were traced: [workspaceCache.ts](/C:/FarmRx/src/data/workspaceCache.ts:33), [scheduledAlertOrchestrator.ts](/C:/FarmRx/supabase/functions/_shared/scheduledAlertOrchestrator.ts:61), [pushDeliveryLogic.ts](/C:/FarmRx/supabase/functions/_shared/pushDeliveryLogic.ts:80), [0038 migration](/C:/FarmRx/supabase/migrations/0038_modern_postgrest_service_role_claims.sql:6), [vercel.json](/C:/FarmRx/vercel.json:17). PWA link canonicalization remains defective. | Queue, scheduler, and push regressions executed. Existing notification regression misses the failing normalization case: [notificationLink.regression.ts](/C:/FarmRx/src/data/notificationLink.regression.ts:4). |

## Finding

**FRX-SOL11-P2-01 — notification-click sanitizer can return an off-origin scheme-relative URL**

- Location: [notificationLink.ts](/C:/FarmRx/src/data/notificationLink.ts:9), used at the click boundary in [sw.ts](/C:/FarmRx/src/sw.ts:30).
- Failure sequence:

  1. Persisted notification data supplies `/..//off-origin.invalid`.
  2. The initial single-slash checks accept it.
  3. `new URL()` normalizes its pathname to `//off-origin.invalid` while its URL object still reports the Farm Rx origin.
  4. Line 9 returns that double-slash pathname.
  5. When navigation reparses it, it resolves as `https://off-origin.invalid/`.

- Direct production-function result:

  ```text
  RETURNED_PATH=//off-origin.invalid
  REOPENED_ORIGIN=https://off-origin.invalid
  SAME_ORIGIN=false
  ```

- Impact: malformed or persisted notification data can hand the service worker an off-origin navigation target, violating the intended PWA same-origin boundary. The normal push-display path currently sanitizes twice, which mitigates that particular path, but the `notificationclick` boundary accepts untrusted persisted data and must be safe independently.
- Smallest safe fix: after canonicalization, reject a pathname beginning with `//` before returning it. Alternatively, return the already-validated absolute same-origin URL.
- Required proof: add `/..//off-origin.invalid`, `/.//off-origin.invalid`, and encoded dot-segment variants to `notificationLink.regression.ts`; assert both the fallback and that reparsing every returned value retains the Farm Rx origin. Add a service-worker click regression using raw persisted notification data.

## Commands and results

- Branch/base verification: branch, `HEAD`, and merge-base all matched the requested branch and `49614e75140fdf4dee94d916e32b386bef922f1a`.
- `git diff --check` — passed.
- TypeScript `--noEmit` for app and Node configurations — passed.
- All 39 regression programs — passed using `TSX_DISABLE_CACHE=1` to avoid the sandbox’s unwritable temp directory.
- `node scripts/foundation-static-guards.mjs` — passed.
- Offline `npm audit --audit-level=high` — zero vulnerabilities.
- Playwright `--list` — 32 tests found across desktop and phone.
- In-memory Vite build — transformed 212 application modules and 71 service-worker modules; PWA completion was blocked only when it attempted to write `dist/sw.mjs`.
- Mutation drill — unavailable because its required temporary directory could not be created.
- Deno check — unavailable because Deno is not installed.
- Disposable migrations/probes and RLS matrix — unavailable because Docker is not installed.
- No remote services, providers, data, or another model were contacted.

## Secret scan

All 128 permitted candidate files were covered: 125 text files plus three PNG assets. No private-key blocks, JWT-shaped values, provider-secret prefixes, credential literals, PNG text metadata, or secret-pattern matches were found.

Limitations: this was pattern-based rather than a dedicated entropy scanner; prohibited audit/reviewer material was deliberately excluded. The specified unrelated markdown file remains present and untouched.
