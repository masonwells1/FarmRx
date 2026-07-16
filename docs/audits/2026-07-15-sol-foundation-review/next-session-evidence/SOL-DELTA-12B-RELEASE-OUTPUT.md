Model: GPT-5-based Codex
Reasoning effort: high

# RELEASE BLOCKED

## P1 finding

Authenticated users retain direct `INSERT/UPDATE/DELETE` access to `push_subscriptions` from [0023_reminders.sql](C:/FarmRx/supabase/migrations/0023_reminders.sql:68), with user-only RLS policies at line 93. Migration [0041_unscoped_authenticated_write_fencing.sql](C:/FarmRx/supabase/migrations/0041_unscoped_authenticated_write_fencing.sql:141) revokes only the old RPC signatures—not direct table writes.

Because `push_subscriptions` has no `farm_id`, it is excluded from the epoch-trigger loop in [0040_farm_access_epoch_fencing.sql](C:/FarmRx/supabase/migrations/0040_farm_access_epoch_fencing.sql:346). An authenticated PostgREST request can therefore modify its subscription without the captured farm or access generation. RLS still prevents taking another account’s endpoint, but closure 4 is incomplete.

Required correction:

- Revoke direct `INSERT`, `UPDATE`, and `DELETE` on `public.push_subscriptions` from `authenticated` (and preferably remove the now-inert write policies).
- Require all browser changes through the fenced 0041 RPCs.
- Extend [verify-0041-disposable.ps1](C:/FarmRx/scripts/verify-0041-disposable.ps1:189), static guards, and mutation checks to prove direct table DML is denied while fenced RPC save/delete still work.

## Notification-link matrix

| Case | Input | Exact return |
|---|---|---|
| Application routes | All 12 routes, including `/fields`, `/grain`, `/weather`, `/notifications` | Unchanged |
| Query/fragment | `/weather?field=North%20Quarter#hourly` | Unchanged |
| Legitimate dot segments | `/weather/../grain?crop=corn#contracts` | `/grain?crop=corn#contracts` |
| Hostile dot segments | `/..//off-origin.invalid`, `/%2e%2e//off-origin.invalid` | `/notifications` |
| Encoded characters | `/%2F%2Foff-origin.invalid`, `/%5Coff-origin.invalid`, `/grain%0Abad` | Unchanged and same-origin when reopened |
| Extra slashes | `/grain//contracts` / `///off-origin.invalid` | Unchanged / `/notifications` |
| Raw backslash/control | `/\off-origin.invalid`, raw tab/newline | `/notifications` |
| Explicit ports | Relative `/fields` under origin `:8443` / absolute or protocol-relative port input | `/fields` / `/notifications` |
| Malformed | `/grain%`, `/%E0%A4%A` / empty or non-string | Unchanged and same-origin / `/notifications` |

Direct production-helper execution passed 25 assertions.

The push chain is correctly wired: database `notifications.link` → claimed delivery target → serialized push payload → helper before `showNotification` storage → helper again on click → `clients.navigate` or `clients.openWindow`. See [pushDeliveryLogic.ts](C:/FarmRx/supabase/functions/_shared/pushDeliveryLogic.ts:94) and [sw.ts](C:/FarmRx/src/sw.ts:23).

## Closure review

| Closure | Result | Evidence |
|---|---|---|
| 1. Endpoint ownership/pending target | PASS | Conditional upsert updates only the current owner; conflict raises without changing the pending target. |
| 2. A→B queued cached reads | PASS | Identity is rechecked after live/cache/queue boundaries and before retention or return. |
| 3. Same-user revoke/regrant | PASS | Old work is quarantined, epochs advance, fresh access recovers, and cross-account replay remains rejected. |
| 4. Captured user/farm/generation writes | **FAIL — P1** | Fenced production writers are sound, but direct `push_subscriptions` DML bypasses the epoch RPC. |
| 5. Real-path tests | PARTIAL | Real repositories, migrations, built service worker, and browser app are exercised; the database suite misses the direct-DML bypass. |

## Files and commands

Reviewed the three requirements documents, notification helper/service worker, queued repositories and caches, access-generation logic, migrations 0039–0041, Edge Function delivery logic, regression programs, disposable SQL suites, static/mutation guards, and Playwright tests.

Key read-only commands:

- `git status`, `git rev-parse`, and candidate diffs from `49614e7…`
- `rg`/`Get-Content` production and test paths
- Direct Node import of `notificationLink.ts` with 25 assertions
- `node scripts/foundation-static-guards.mjs` — PASS
- `git diff --check 49614e7…` — exit 0
- Gate topology confirmed: 39 regressions and 16 Playwright tests × 2 projects = 32

## Limitations

The full gate was not rerun because build, Playwright, mutation, Docker, and audit commands write files, create containers, or use external access—prohibited by the read-only instruction. I inspected their production-path wiring and the current built service worker instead. No live database, preview deployment, physical device, or external service was touched.

Files changed: none.
External changes: none.
