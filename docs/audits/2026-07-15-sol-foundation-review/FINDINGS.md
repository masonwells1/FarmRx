# Foundation Findings

## Severity summary

| Severity | Count |
|---|---:|
| BLOCKER | 0 |
| P0 | 0 |
| P1 | 7 |
| P2 | 2 |
| P3 | 0 |

## SOL-FND-001 — The PWA shell is offline, but the farm workflow is not

- **Severity:** P1
- **Files:** `docs/farm-rx-handoff.md:43-49`; `src/data/index.ts:20-32,35-45,53-81`; `src/sw.ts:7-11`; `src/data/QueuedInventoryRepository.ts:15-23,27-34`
- **Reachable user scenario:** A farmer opens Fields with signal, drives into a dead zone, closes/reloads the installed PWA, or tries to save a spray record after the connection is gone.
- **Expected behavior:** Previously loaded farm data remains available; the authenticated user and selected farm resolve locally; create/edit/delete is appended durably and shown as pending until reconnect.
- **Actual risky behavior:** The deployed app was loaded online, set offline, and reloaded. It rendered only “We could not reach Farm Rx. Check your signal and try again.” The service worker precaches the shell, not farm data. More importantly, every queue context calls `supabase.auth.getUser()` and queries `farms` before a queue can be opened, so an already-open offline form can fail before `append()`. Inventory caches its workspace only in memory and overlays only queued product saves, not receipts, adjustments, cancellations, or application bundles.
- **Business impact:** The stated hard requirement—do not lose a sale, spray record, or scouting note when rural coverage drops—is not met. A farmer can be unable to see the field context or retain a completed action precisely where the PWA is supposed to help.
- **Proof status:** **Proven** for offline reload in deployed production; **strongly evidenced** for offline-save failure and incomplete queue projection from the real composition path.
- **Suggested fix direction:** Persist the signed-in user ID, selected accessible farm, and canonical per-module workspaces in IndexedDB; resolve queue keys without a network round trip; clear sensitive caches on sign-out/revocation; project every queued mutation; keep the current server revalidation on reconnect.
- **Regression/manual proof:** Playwright: load each core module online, close/reopen offline, create/edit/delete, verify pending UI after another reload, reconnect, verify exactly-once canonical rows, then revoke access and prove cached data/queues fail closed.

## SOL-FND-002 — Multi-farm owners and Crop RX reps are rejected

- **Severity:** P1
- **Files:** `src/data/index.ts:26-32,47-53`; `supabase/migrations/0001_module1_fields.sql:36-69`; `supabase/migrations/0002_module1_rls.sql:61-90,162-164`
- **Reachable user scenario:** A Crop RX rep receives an explicit grant from a second customer, or one owner operates two farms. RLS correctly returns both accessible farm rows.
- **Expected behavior:** The user chooses the active farm; every repository, queue, and UI header is bound to that selection; switching farms cannot mix data or pending work.
- **Actual risky behavior:** `currentFarmId()` throws “We found more than one farm for this account” whenever the RLS-filtered query returns more than one row. Every module depends on that function. The schema deliberately supports many grants/memberships, so the application-level restriction contradicts the authorization model.
- **Business impact:** The core rep workflow stops working as soon as Crop RX supports more than one customer. Owners with legitimately separate operations are also locked out.
- **Proof status:** **Proven** by source; the fresh RLS matrix also proved that the database can expose multiple authorized farms without leaking unauthorized ones.
- **Suggested fix direction:** Add a farm picker and a persisted selected-farm ID; validate the selection against a fresh RLS-filtered list; include farm identity visibly in the shell; keep all cache/queue keys farm-scoped; require an explicit decision before switching with pending work.
- **Regression/manual proof:** Two-farm owner, one-farm worker, two-grant rep, revoked rep, and stranger browser sessions; switch repeatedly and assert no request, cache entry, notification, photo, or queue item crosses the selected farm.

## SOL-FND-003 — Four queue families are unsafe across browser tabs

- **Severity:** P1
- **Files:** `src/data/inventoryWriteQueue.ts:31-37`; `src/data/QueuedInventoryRepository.ts:16-17,27-34`; `src/data/QueuedEquipmentTasksRepository.ts:13-14,24-31`; `src/data/QueuedScoutingRepository.ts:10-11,35-38`; `src/data/QueuedNotificationsRepository.ts:10-17`; contrast `src/data/QueuedFieldsRepository.ts:28,50`
- **Reachable user scenario:** Two tabs are open to the same farm. During a transport failure, one tab queues a spray record while the other queues a receipt, task, scouting note, or mark-read action; or one tab replays while the other appends.
- **Expected behavior:** A single cross-tab critical section serializes read-modify-write and replay; both operations remain in FIFO order and are applied once.
- **Actual risky behavior:** The queue classes read an entire localStorage envelope, construct a new array, and overwrite the key. Inventory, Equipment/Tasks, and Notifications do not acquire a cross-tab lock. Scouting uses only an in-memory `Map`, which does not coordinate separate tabs. Fields, Grain, Profitability, Programs, Harvest, Field Log, and field location already demonstrate the required Web Locks plus lease pattern.
- **Business impact:** The last localStorage writer can erase another tab’s newly queued entry; simultaneous replay can double-send, remove the wrong head, or park the queue. That can lose compliance, maintenance, task, or scouting work.
- **Proof status:** **Strongly evidenced** by the concrete read-modify-write paths; no live writes were made during this review.
- **Suggested fix direction:** Extract one audited cross-tab queue transaction primitive and use it for append, park, remove, inspect, and replay in every module. Add storage/BroadcastChannel refresh so all tabs show the same pending count.
- **Regression/manual proof:** Two real Playwright contexts share one origin/storage, synchronize at a barrier, append and replay competing operations, then assert both queue entries and exactly one canonical server row per operation.

## SOL-FND-004 — Stale editors can silently overwrite newer canonical records

- **Severity:** P1
- **Files:** `src/data/SupabaseGrainDataGateway.ts:47-60`; `src/data/SupabaseProfitabilityDataGateway.ts:57-62`; `src/data/SupabaseEquipmentTasksDataGateway.ts:13-17`; `supabase/migrations/0009_fields_live_support.sql:247-280`; `supabase/migrations/0022_harvest.sql:11-13`
- **Reachable user scenario:** A farmer and manager open the same Grain production estimate, budget, field, equipment interval, or task. One saves; the other later saves a stale form.
- **Expected behavior:** The second save includes the version it edited. If the row changed, Farm Rx rejects the overwrite and offers reload/compare/merge.
- **Actual risky behavior:** Many mutable paths upsert a full row on `id` or update without an expected `updated_at`/version. The Fields bundle serializes concurrent transactions but does not detect that the editor’s source snapshot is stale. Harvest explicitly documents Fields/Harvest shared columns as last-write-wins. Profitability matrix replacement is a good exception: it carries expected steps and detects conflicts.
- **Business impact:** Newer bushels, yield assumptions, budgets, equipment schedules, assignments, or field facts can disappear without warning, producing wrong money and operational decisions.
- **Proof status:** **Strongly evidenced** by the real gateway/RPC contracts.
- **Suggested fix direction:** Add monotonically increasing row versions or expected timestamps to every mutable aggregate RPC; update only on version match; return a stable conflict code and both snapshots. Preserve append-only ledgers and immutable finalized price legs.
- **Regression/manual proof:** Two authenticated sessions load version N; session A saves N->N+1; session B’s N save must conflict and leave A’s row unchanged. Repeat after offline replay.

## SOL-FND-005 — TradingView JavaScript runs inside the authenticated Farm Rx origin

- **Severity:** P1
- **Files:** `src/components/MarketQuote.tsx:3,18-29,60-77`; `src/lib/supabaseClient.ts:9-18`; `vercel.json:1-9`
- **Reachable user scenario:** A signed-in owner opens Grain. The app downloads and executes TradingView’s CDN script before that script creates its iframe.
- **Expected behavior:** Untrusted/third-party market display code runs in an isolated cross-origin or sandboxed frame and cannot read Farm Rx DOM, session storage, localStorage queues, or Supabase tokens. Production headers constrain scripts, frames, navigation, referrers, and powerful features.
- **Actual risky behavior:** The script is appended as `<script src="https://s3.tradingview.com/...">`, so it executes with Farm Rx’s first-party JavaScript privileges. Supabase persists the session in localStorage. The live `/grain` response had HSTS but no Content-Security-Policy, X-Frame-Options/frame-ancestors equivalent, Referrer-Policy, Permissions-Policy, or X-Content-Type-Options.
- **Business impact:** A compromised widget/CDN or hostile upstream change could steal an owner session and private farm/financial data. This is a supply-chain blast radius, not evidence that TradingView is currently malicious.
- **Proof status:** **Strongly evidenced** by browser execution semantics, source, and live headers.
- **Suggested fix direction:** Put the widget in a sandboxed isolated document/origin with the minimum permissions; do not let its loader execute in the parent. Add a strict nonce/hash-based CSP, explicit `frame-src`, `frame-ancestors`, Referrer-Policy, Permissions-Policy, and `nosniff`.
- **Regression/manual proof:** Replace the widget URL in a controlled test with a script that attempts `parent.localStorage`; the attempt must fail. Verify production headers and that valid quotes still render.

## SOL-FND-006 — Alerts are not a dependable app-closed workflow

- **Severity:** P1
- **Files:** `docs/farm-rx-handoff.md:157-161`; `src/data/marketingAlerts.ts:31-49`; `src/data/grainAlerts.ts:13-18,27-36`; `src/data/programDueItems.ts:12-34`; `src/WeatherModule.tsx:25-39`; `supabase/migrations/0035_operational_integrity.sql:1-3,77-80,196-200`; `supabase/functions/send-push/index.ts:27-33`; `vercel.json:1-9`
- **Reachable user scenario:** A price reaches a target, a Program pass becomes due, or a spray window turns good while the farmer’s PWA is closed.
- **Expected behavior:** A monitored server evaluator uses canonical farm-local time and data, creates one notification, queues one delivery, and sends it without requiring an interactive browser.
- **Actual risky behavior:** Marketing and legacy Grain evaluators explicitly say check-on-open; the UI repeats that limitation. Spray transition detection exists only in the mounted Weather component. Program due generation has both client and scheduler-safe SQL functions, but the migration’s cron block is a no-op placeholder and the repository has no active scheduler configuration. `send-push` drains the durable queue only when invoked. An external Supabase Scheduled Function may exist, but this checkout could not verify it.
- **Business impact:** Time-sensitive reminders can arrive late or never arrive—the exact failure that makes an alert feature untrustworthy.
- **Proof status:** **Proven** for checked-in/client behavior; **needs proof** for any externally configured production scheduler and real push secrets/device.
- **Suggested fix direction:** Add a repository-owned or durably documented scheduled Edge Function that evaluates all farms in local-date context, records state transitions, generates due notifications, claims delivery rows, and emits monitored failures. Keep check-on-open as a backstop.
- **Regression/manual proof:** Close all Farm Rx clients, advance a disposable clock across a due/threshold transition, run the scheduler twice, assert one notification/delivery, and receive one push on a subscribed real device.

## SOL-FND-007 — The green regression gate does not exercise the deployed foundation

- **Severity:** P1
- **Files:** `package.json:6-10,19-27`; representative fake-gateway suites `src/data/SupabaseInventoryRepository.regression.ts`, `src/data/SupabaseEquipmentTasksRepository.regression.ts`, and `src/data/SupabaseGrainRepository.regression.ts`
- **Reachable user scenario:** A change breaks offline reload, cross-tab storage, responsive navigation, an RLS grant, a migration signature, or an Edge Function invocation. `npm run regression` still passes.
- **Expected behavior:** The required release gate includes unit/math tests, component behavior, built-browser E2E, two-tab/offline scenarios, a fresh migration/RLS database, and targeted live read-only smoke checks.
- **Actual risky behavior:** Regression is a chain of 28 `tsx` scripts. The Supabase-named suites drive in-memory fake gateways rather than PostgREST/Auth/Storage. There is no browser/component test dependency, `.github` CI workflow, `supabase/config.toml`, migration reset in the regression command, or automated production smoke. This review found the offline and mobile-navigation defects while TypeScript, all regressions, and build were green.
- **Business impact:** More features can make the product less reliable while every normal gate remains green, creating false confidence for a nontechnical owner.
- **Proof status:** **Proven** by package/test inspection and this audit’s passing commands versus failing real browser scenario.
- **Suggested fix direction:** Keep the fast scripts, but add Vitest/React tests where useful, Playwright built-app E2E, fresh local Supabase migration/RLS suites, the disposable 0033-0035 probes, mobile visual checks, and read-only deployment smoke in CI.
- **Regression/manual proof:** Deliberately break a route, queue lock, RLS expectation, and service-worker data cache in separate temporary branches; the appropriate gate must fail before merge.

## SOL-FND-008 — Marketing alert evaluation can use stale prices and disagrees on entity scope

- **Severity:** P2
- **Files:** `src/data/marketingAlerts.ts:22-23,29,37-42`; `src/data/grain.ts:23-32,146-156`; `supabase/functions/deliver-grain-alert/index.ts:28`
- **Reachable user scenario:** Two operating entities grow the same commodity. Entity A is below its marketed-percent goal but the combined farm is not, or the latest manual cash bid is weeks old and still above a saved price threshold.
- **Expected behavior:** Client display, transition recording, and server delivery use the same exact farm/year/commodity/entity/enterprise scope and an explicit acceptable bid-freshness/delivery rule.
- **Actual risky behavior:** The client’s marketed-percent calculation uses the complete scope. The Edge Function rechecks production and contracts only by farm/year/commodity, ignoring `operating_entity_id` and `enterprise_label`. The marketing-rule client and server both take the latest manual bid without a freshness cutoff, so an old quote can continue satisfying a current alert.
- **Business impact:** A farmer can receive a false old-price notice or miss/reject a valid entity-specific notice. The app is not giving advice, but the reminder itself can still mislead timing decisions.
- **Proof status:** **Proven** by client/server predicate comparison.
- **Suggested fix direction:** Centralize canonical alert evaluation in a scoped server RPC/view; require the same scope keys everywhere; define freshness and delivery-window semantics; return the evaluated observation in the delivery receipt.
- **Regression/manual proof:** Two entities with opposite marketed percentages plus a whole-farm row; stale versus fresh bids; client and server must produce identical results and delivery must occur only for the intended rule.

## SOL-FND-009 — The mobile bottom navigation overlaps at a normal phone width

- **Severity:** P2
- **Files:** `src/App.tsx:306-307`; `src/styles/app.css:525-568`
- **Reachable user scenario:** A farmer uses the deployed app at 390x844 and tries to switch between Fields, Grain, Inventory, Profitability, Equipment, Tasks, Weather, Field Log, Scouting, Harvest, Programs, and Alerts.
- **Expected behavior:** Labels and icons remain legible, each destination has a reliable touch target, and overflow is clearly scrollable or grouped behind “More.”
- **Actual risky behavior:** A live 390x844 screenshot showed the twelve labels and icons compressed/overlapping across the bottom bar. The CSS gives every link `flex: 1 1 0`, 18px text, and only a 48px minimum while placing all twelve destinations in one strip.
- **Business impact:** Farmers can tap the wrong module or struggle to navigate in the app’s primary mobile use case.
- **Proof status:** **Proven** by deployed browser screenshot and DOM snapshot.
- **Suggested fix direction:** Keep four or five primary destinations and a “More” menu, or use nonshrinking wider items with explicit scrolling and visual affordance. Preserve 48px targets and readable labels.
- **Regression/manual proof:** Screenshot and tap-through at 320, 375, 390, 430, and tablet widths; assert no label collision, no hidden focused item, and correct destination for every tap.
