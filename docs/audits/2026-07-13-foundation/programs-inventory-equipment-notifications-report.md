# Foundation Audit — Programs, Inventory, Equipment Tasks, Notifications

Static code-and-docs audit completed July 13, 2026. No live database or network calls were made; no source, migration, public, package, config, commit, or push changes were made.

## Result

- P0: 0
- P1: 5
- P2: 2
- P3: 0

## Findings

### P1 — Phone push is fully implemented at the edges but never wired to notification creation

The app stores subscriptions and creates in-app notifications, but no client, SQL trigger, or scheduler invokes `send-push`. The edge function can send a supplied notification, but it is unreachable from the actual notification paths. `docs/reminders-design.md:52-57` explicitly specifies that `create_notification` should call it; the implementation only calls the notification RPC in `src/data/SupabaseNotificationsDataGateway.ts:11`, while `supabase/functions/send-push/index.ts:27-95` only listens for a direct HTTP request.

Farmer failure scenario: A farmer turns on “Phone alerts,” then a program or service reminder is created. It appears in the in-app bell only; no phone notification is sent, even though the UI says phone alerts are on.

Suggested fix: Add one authoritative delivery path. Prefer a server-side trigger/queue with a protected Edge Function call; alternatively, invoke `send-push` immediately after every successful notification creation and record a delivery-attempt state. Add an end-to-end test proving notification creation reaches the function once, not repeatedly.

### P1 — Program reminders are not scheduled; they depend on someone opening the app

Program due-item generation is best-effort and only starts from interactive Programs or Notifications refreshes: `src/ProgramsModule.tsx:20`, `src/NotificationsModule.tsx:21-27`, and `src/data/programDueItems.ts:13-15`. The database function creates due tasks/notifications only when called, not on its own: `supabase/migrations/0024_programs.sql:2035-2058`. The design itself notes that app-closed scheduled delivery requires a server scheduler: `docs/reminders-design.md:78-81`.

Farmer failure scenario: A fungicide pass becomes due Sunday morning. Nobody opens Farm Rx until Monday, so the task and notification are generated late; with the separate push-wiring defect, no phone alert arrives at all.

Suggested fix: Schedule `generate_due_program_items` server-side at least daily in the farm’s calendar context, retain the current client refresh as a safe backstop, and make the scheduled path enqueue push delivery.

### P1 — The Tasks board can mark a Program-linked task done or reopen it without changing the Program pass

Program task cards are identified as tracker-owned but still expose Start, Done, and Reopen actions. Those actions directly upsert `farm_tasks`: `src/EquipmentTasksModule.tsx:38-39`, `src/data/SupabaseEquipmentTasksDataGateway.ts:14`. No corresponding Program RPC is called. A Program pass is still `planned`, while task generation refuses to create a replacement when the same cycle key already exists: `supabase/migrations/0024_programs.sql:394-396`, `supabase/migrations/0024_programs.sql:2075-2079`.

Farmer failure scenario: A worker presses Done on “Post spray — North 80” from Tasks but never applies or skips the pass in Programs. The task disappears, the pass remains planned, and later due-generation cannot recreate the card because the completed cycle row owns that key. Conversely, reopening a task for an already-applied pass creates a false open job.

Suggested fix: Remove all status-changing actions from Program-owned task cards and route users to the exact Program pass. Enforce this server-side too: reject direct updates to Program-sourced task status, and allow Program RPCs to be the sole authority that synchronizes pass status and task status.

### P1 — Deleting a service log leaves its reminder completion and optional meter reading behind

Logging service with an interval stamps `last_done_on` and `last_done_reading` on the interval: `supabase/migrations/0016_equipment_tasks.sql:196-240`. The service RPC may also insert a service-derived meter reading: `supabase/migrations/0017_service_log_rls_fix.sql:171-211`. Yet the UI exposes Delete service entry (`src/EquipmentTasksModule.tsx:29`) and the gateway performs a direct row deletion only (`src/data/SupabaseEquipmentTasksDataGateway.ts:16`); manager deletion is permitted by `supabase/migrations/0016_equipment_tasks.sql:869-871`.

Farmer failure scenario: A manager deletes an incorrect oil-change entry. The oil-change interval remains stamped as completed and its meter reading remains, so the machine can look current and no replacement service reminder is generated.

Suggested fix: Replace direct deletion with an atomic service-log reversal RPC. Either prohibit deletion and use a correcting/reversal record, or recalculate the interval’s last-completed values, service reading, and associated auto-task state from the remaining immutable history in one transaction.

### P1 — Offline inventory writes are not projected locally, and two queued write types cannot safely recover after an acknowledgement loss

The offline inventory overlay applies only queued product saves, not receipts, adjustments, or applications: `src/data/QueuedInventoryRepository.ts:19-20`. The UI nevertheless clears the form and reports a received receipt as added: `src/InventoryModule.tsx:41-42`. Separately, adjustments use a direct `insert`, not an idempotent RPC: `src/data/SupabaseInventoryDataGateway.ts:32`; meter readings have the same direct-insert pattern: `src/data/SupabaseEquipmentTasksDataGateway.ts:11`. On replay, a definite error marks the entire queue blocked: `src/data/QueuedInventoryRepository.ts:28`, `src/data/QueuedEquipmentTasksRepository.ts:24`.

Farmer failure scenario: Offline, a farmer receives two totes and enters a negative count correction. The app says the write is saved but the shelf and history do not reflect either entry until sync. If the server committed the adjustment or meter reading just before the connection dropped, replay hits a duplicate-ID error and blocks all later queued work even though the original row exists.

Suggested fix: Add complete optimistic projections for receipt, adjustment, application, and on-hand ledger state. Route adjustments and manual meter readings through idempotent RPCs with operation receipts, or on duplicate fetch-and-compare the canonical row before treating replay as confirmed. Add lost-response regression cases for each queued operation.

### P2 — Date defaults use UTC, which can prefill the wrong farm date around local midnight

Inventory and Equipment use `new Date().toISOString().slice(0, 10)` for default business dates: `src/InventoryModule.tsx:11`, `src/EquipmentTasksModule.tsx:5`. Programs uses the same UTC default for Applied and Skipped dates: `src/ProgramsModule.tsx:50`. This conflicts with the separate due-item service, which correctly constructs a local calendar date from browser fields: `src/data/programDueItems.ts:7-9`.

Farmer failure scenario: At 8:30 PM in Iowa, a farmer logs a spray, service, or skipped pass. The form defaults to tomorrow’s UTC date, and the farmer may save the wrong legal/compliance or program-history date.

Suggested fix: Use one shared local-calendar-date helper for all `<input type="date">` defaults and add Central Time tests on both sides of midnight.

### P2 — Program due generation accepts a caller-supplied date rather than a farm time zone

The client sends browser-local `p_local_date`: `src/data/programDueItems.ts:28-31`. The server only checks that it is within one day of server `current_date`: `supabase/migrations/0024_programs.sql:2049-2052`. That safely tolerates UTC boundaries but does not establish a farm-owned time zone, so different users in different zones can generate the farm’s daily reminder cycle on different calendar days.

Farmer failure scenario: A farm has a manager traveling west. Late at night, the traveling manager opens the app and generates a due cycle using their local date rather than the farm’s intended operating date, advancing reminders early or delaying them relative to local farm operations.

Suggested fix: Store an IANA time zone on the farm and have the database derive the farm-local date. Keep the client date only as a display hint, not as scheduling authority.

## Checked and Good

- Due dates are stored as `date`, not timestamp, and client validation rejects invalid calendar dates. This avoids time-of-day conversion for the underlying pass due date. `src/data/programs.ts:26-32`, `supabase/migrations/0024_programs.sql:175-185`
- Program due-item generation serializes farm work and has durable task-cycle and notification deduplication. `supabase/migrations/0024_programs.sql:394-396`, `supabase/migrations/0024_programs.sql:2054-2109`
- Applying, skipping, unassigning, or reassigning a Program pass closes its open linked Program task from the Program domain. `supabase/migrations/0024_programs.sql:1744-1755`, `supabase/migrations/0024_programs.sql:1793-1806`, `supabase/migrations/0024_programs.sql:2021-2029`
- Program cost rollups correctly distinguish complete estimates from known-line partial estimates, preventing incomplete totals from being presented as complete money. `supabase/migrations/0026_program_cost_known_lines.sql:16-63`, `src/data/programsChunk5.regression.ts:17-18`
- Programs intentionally do not decrement inventory from free-text Program product lines; this protects inventory quantities from guessed product matches. `docs/programs-design.md:54-64`, `supabase/migrations/0024_programs.sql:2028-2029`
- Inventory guards unit conversions: it permits known same-family conversions, requires explicit package factors, and rejects volume-to-weight guessing. `src/data/inventory.ts:58-66`, `supabase/migrations/0015_inventory_live_support.sql:848-879`
- Negative inventory is not silently hidden; the shelf visibly marks it as a record mismatch needing correction. `src/InventoryModule.tsx:37`
- Receipt, completed-application, and Program write paths have stable-ID replay protections; the direct adjustment and meter-reading paths are the exceptions identified above. `supabase/migrations/0015_inventory_live_support.sql:924-972`, `supabase/migrations/0017_service_log_rls_fix.sql:191-201`
- Notification rows are recipient-private under RLS, and non-null dedupe keys are unique per farm and recipient. `supabase/migrations/0023_reminders.sql:34-39`, `supabase/migrations/0023_reminders.sql:71-87`
- The full regression suite passed, including Programs, program due-items, Inventory, Equipment Tasks, and Notifications; the production build also passed. These checks do not cover the static integration gaps above.