# Equipment & Tasks design (Modules 5 + 6) — Farm Rx

Status: AUTHORITATIVE design for the 0016 schema draft and the UI build. Written 2026-07-12
after a read-only recon of CRX Manager's Team Board / jobs / vehicles system
(docs source: recon report; CRX is reference only, never modified). Honors
docs/farm-rx-handoff.md Modules 5 & 6 and the three rules (simplicity; the data is theirs;
brand the wrapper).

## What we steal from CRX Manager, and what we deliberately drop

STEAL (proven in CRX daily use):
- Board = simple grouped columns with cards, NOT drag-and-drop kanban. Complete/move with
  big buttons. (CRX groups by note_type; we group by STATUS: To Do | Doing | Done —
  handoff mandate.)
- Overdue escalation by age: amber (<3 days late), red (>=3), critical (>=7, pulsing).
  Sort overdue-first inside a column. (CRX StaleTasksAlert getEscalationLevel pattern.)
- KPI tiles above the board, each a one-tap filter: Open · Mine · Overdue · Done this week.
- Quick-add a task from another record with the link prefilled (CRX QuickTaskModal):
  Farm Rx v1 = "Add service task" button on an equipment card; field-linked quick-add can
  come later.
- Linked-record chip on the card that deep-links to the field or machine (CRX EntityBadge).
- Completed history stays visible (Done column shows who/when).

DROP for v1 (farm crew, not a software team — handoff: "dead simple"):
- Tags, threaded comments, @mentions, attachments, pinning, activity feeds, realtime
  subscriptions, workload view, batches/crews/dispatch machinery. NONE of it in v1.
- Recurring tasks as a scheduling engine — service intervals (below) cover the real
  farm recurrence; no RRULE.
- Email reminders: deferred until an email provider key exists (same blocker as grain
  alerts). In-app = the board itself + My-tasks tile.
- Photo/document attachments on equipment: deferred (no storage-bucket infrastructure in
  Farm Rx yet). Parked in GOAL.md.
- DOT fleet compliance (DVIRs, IFTA, CDL/medical cards): handoff says confirm with Mason
  first — NOT built.

## Privacy / roles (decision, flagged to Mason in GOAL.md)
Equipment and tasks are ORDINARY MEMBER data like inventory (0011 pattern): every active
farm member (owner/manager/worker) sees both pages; reps see nothing without the two-part
grain-style grant (they simply don't get these tables at all in v1 — no rep policies).
Consequence: workers can see equipment purchase price and repair costs. Kept simple on
purpose; flagged as a parked decision. Write rules:
- equipment assets + service intervals: owner/manager only (can_manage_farm).
- meter readings + service log entries + tasks (create, claim, move status, edit own):
  any active member — the worker doing the oil change logs it and moves the card.
- deletes: owner/manager only; tasks use soft delete? NO — v1 keeps hard delete
  owner/manager-only; Done column is the history.

## Schema (0016) — tables

All tables: id uuid PK default gen_random_uuid(), farm_id uuid NOT NULL references farms,
created_by uuid NOT NULL default auth.uid() references auth.users, created_at/updated_at
timestamptz default now() + the standard set_updated_at trigger + prevent_farm_id_change
trigger + RLS per above. Text length caps via CHECK (Sol picks sensible ones <= the
client mappers' 10k default).

### equipment
- name text NOT NULL (e.g. "Truck 7", "RoGator 1100C") — the farmer's name for it
- category text NOT NULL CHECK IN ('tractor','combine','sprayer','truck','trailer',
  'header','tillage','planter','grain_cart','utility','other')
- make text NULL, model text NULL, model_year int NULL CHECK 1900..2100
- serial_or_vin text NULL
- purchase_date date NULL, purchase_price numeric NULL CHECK >= 0
- meter_unit text NOT NULL DEFAULT 'hours' CHECK IN ('hours','miles') — one meter per
  machine, chosen at creation (combine = hours, semi = miles)
- warranty_expires_on date NULL, warranty_notes text NULL
- status text NOT NULL DEFAULT 'active' CHECK IN ('active','sold','retired')
- notes text NULL

### equipment_meter_readings  (append-only history; latest = current meter)
- equipment_id uuid NOT NULL references equipment ON DELETE CASCADE
- reading numeric NOT NULL CHECK >= 0
- read_on date NOT NULL
- source text NOT NULL DEFAULT 'manual' CHECK IN ('manual','service')
- notes text NULL
- Append-only: no UPDATE/DELETE policies for anyone in v1 (mistake correction = add a
  newer correct reading; matches the inventory append-only philosophy).
- Server guard trigger: reading must be >= the latest earlier reading for the same
  machine ON THE SAME OR EARLIER read_on date is NOT required (meters get replaced);
  instead just require reading >= 0 and let the UI warn. KEEP SIMPLE — Sol: do not
  build monotonic enforcement, a replaced hour meter legitimately goes backwards.

### equipment_service_intervals  (the reminder rules)
- equipment_id uuid NOT NULL references equipment ON DELETE CASCADE
- name text NOT NULL (e.g. "Oil change", "DEF filter")
- every_meter numeric NULL CHECK > 0     — every N hours/miles (machine's meter_unit)
- every_months int NULL CHECK > 0        — and/or every N months
- CHECK (every_meter IS NOT NULL OR every_months IS NOT NULL)
- last_done_on date NULL, last_done_reading numeric NULL CHECK >= 0
- is_active boolean NOT NULL DEFAULT true
- DUE rule (computed, not stored): due when (every_meter set AND latest reading −
  last_done_reading >= every_meter) OR (every_months set AND last_done_on + every_months
  months <= today). Never-serviced (last_done_* NULL) counts due only when a reading /
  months since equipment creation crosses the rule — Sol: expose this via a
  security_invoker VIEW equipment_service_due (farm_id, equipment_id, interval_id,
  reason 'meter'|'calendar', overdue_amount) so client math cannot drift from server
  math. (farm_id added post-review: the client filters and farm-checks on it, matching
  the inventory views.) The generate RPC additionally skips any interval that already
  has an OPEN ('todo'/'doing') auto-task — one open card per reminder, even as the
  meter keeps climbing within the same un-serviced cycle (review finding #7).

### equipment_service_log  (repair + service history; the money trail)
- equipment_id uuid NOT NULL references equipment ON DELETE CASCADE
- service_date date NOT NULL
- work_performed text NOT NULL
- parts text NULL, vendor text NULL
- cost numeric NULL CHECK >= 0
- meter_reading numeric NULL CHECK >= 0 (reading at service time; ALSO append a
  meter reading row when provided — client does both writes through one queued op)
- interval_id uuid NULL references equipment_service_intervals ON DELETE SET NULL
  (when the log entry completes an interval, the RPC below also stamps the interval's
  last_done_on/last_done_reading)
- Append-only like readings (edits = corrections appended; owner/manager may DELETE a
  wrong row).
- Cost-per-machine = SUM(cost) per equipment (client aggregates from rows in v1;
  Profitability integration later).

### farm_tasks  (the board)
- title text NOT NULL
- details text NULL
- status text NOT NULL DEFAULT 'todo' CHECK IN ('todo','doing','done')
- priority text NOT NULL DEFAULT 'normal' CHECK IN ('normal','high','urgent')
- assigned_to uuid NULL references auth.users  (any active member of the same farm —
  enforce with a trigger or policy check)
- due_on date NULL
- field_id uuid NULL references fields ON DELETE SET NULL
- equipment_id uuid NULL references equipment ON DELETE SET NULL
- (a task may link to a field, a machine, both NULL, or BOTH — "spray Field 12 with the
  RoGator" legitimately links both; no exclusive-arc CHECK)
- source text NOT NULL DEFAULT 'manual' CHECK IN ('manual','service_interval')
- interval_id uuid NULL references equipment_service_intervals ON DELETE SET NULL
- interval_cycle_key text NULL — idempotency for auto-generated service tasks (see RPC);
  partial UNIQUE (farm_id, interval_id, interval_cycle_key) WHERE interval_cycle_key
  IS NOT NULL
- completed_by uuid NULL, completed_at timestamptz NULL
- CHECK: done => completed_at IS NOT NULL; not-done => completed_by/completed_at NULL
  (trigger stamps completed_by := auth.uid(), completed_at := now() on transition to
  done, and clears both on transition away — server-owned like receipt cancelled_by,
  the exact bug class 0015 fixed)

## RPC (one only) — generate_due_service_tasks(p_farm_id uuid)
SECURITY INVOKER (ordinary member data). For every active interval on an active machine
of the caller's farm that the equipment_service_due view says is DUE and that has no
open auto-task for the current cycle, insert one farm_tasks row:
  title = '<interval name> — <equipment name>', priority 'high', source
  'service_interval', equipment_id, interval_id, interval_cycle_key = a deterministic
  key for the current cycle (meter rule: floor((latest_reading − COALESCE(last_done
  _reading,0)) / every_meter) combined with last_done marker; calendar rule: the due
  month, e.g. 'cal:2026-08'; prefix 'meter:'/'cal:'). Uses INSERT .. ON CONFLICT DO
  NOTHING on the partial unique index → idempotent, safe to call on every Equipment
  page load and board load. Returns the number of tasks created. Advisory lock on
  (farm_id) like the 0015 RPCs to avoid duplicate-key races. Completing/deleting the
  auto task does NOT resurrect it within the same cycle (the unique row key persists
  only while the task exists — so: ON CONFLICT relies on the live row; if the farmer
  deletes the task it MAY regenerate next load. Acceptable v1 behavior: the correct
  farmer action is marking it Done — the interval only resets when a service-log entry
  stamps last_done, which starts a NEW cycle key. Sol: document this in comments.)

## Writes classification (the queue's five kinds)
All plain PostgREST upserts/inserts with exact canonical-confirmation echoes (the grain/
profitability pattern) — no multi-row bundles needed:
1. saveEquipment (insert/update equipment; owner/manager)
2. addMeterReading (insert, append-only)
3. saveInterval (insert/update equipment_service_intervals; owner/manager)
4. addServiceLogEntry — the ONE composite: inserts the log row, optionally appends the
   meter reading, and when interval_id present stamps the interval's last_done_*.
   Three statements => needs a small SECURITY INVOKER RPC save_service_log_entry
   (single transaction, exact-echo return {log, reading|null, interval|null}).
   (So: two RPCs total in 0016.)
5. saveTask (insert/update farm_tasks incl. status moves; server stamps completion)
Delete ops (task delete, service-row delete, interval delete) are owner/manager-only
direct deletes with confirmed-gone echoes — same shape the other modules already use.

## Data layer (mirror the inventory/profitability live pattern EXACTLY)
- EquipmentTasksRepository interface + SupabaseEquipmentTasksRepository +
  SupabaseEquipmentTasksDataGateway + equipmentTasksWriteQueue (own versioned key
  farm-rx-equipment-tasks-queue:v1:<projectRef>:<userId>:<farmId>) +
  QueuedEquipmentTasksRepository + createSupabaseEquipmentTasksServices.
  ONE module/queue for both pages (they interlock: intervals → tasks) — syncStatus
  Module union gains 'equipment_tasks'; aggregate stays all-modules-synced.
- Strict fail-closed mappers, microsecond+offset stamp regex (copy the proven one),
  farm binding on every write, getWorkspace loads: equipment, readings (latest N per
  machine is fine — Sol: no, load all; farms have tens of machines not thousands),
  intervals, service log, due view rows, tasks, plus fields list (for pickers) via the
  existing fieldsRepository. Call generate_due_service_tasks at workspace load, then
  read tasks.
- backends.ts gains equipment_tasks: 'supabase' (manifest type widened; regression
  assertion updated).
- App.tsx: replayEquipmentTasksQueue() alongside the other four at farm-ready (the
  0015-review P2 class — do not forget).
- The board and equipment pages replace the current /equipment and /tasks empty-state
  stubs in App.tsx navigation.

## UI spec
Page: Equipment (nav icon exists). Header action "Add machine".
- Machine cards grouped by category: name big, make/model/year small, current meter
  (latest reading + unit), status badge, warranty chip when expiring <=60 days or
  expired, "Service due" red chip when the due view has rows, cost-to-date (sum of
  service log costs). Tap → detail panel: asset facts (edit for owner/manager), meter
  quick-add ("Update hours/miles" — one number field + date), intervals list with due
  states + add/edit (owner/manager), service log (newest first, cost column,
  "Log service" form: date, work, parts, vendor, cost, reading, optional link to an
  interval → completing it), Add service task button (quick-add prefilled linked task).
Page: Tasks (nav icon exists). Header action "Add task".
- KPI tiles: Open · Mine · Overdue · Done this week (tap = filter).
- Three columns stacked on phone (To Do, Doing, Done — Done collapsed to last 10 with
  "show more"): card = title, priority badge (only when high/urgent), assignee first
  name, due date (overdue escalation colors: amber <3d, red >=3d, critical >=7d late,
  sorted overdue-first then due-date), linked chips (field name / machine name →
  navigate), done cards show who/when. Buttons on card: "Start" (todo→doing),
  "Done" (→done), "Reopen" (done→todo), Edit, Delete (owner/manager).
- Add/edit form: title, details, priority (Normal/High/Urgent buttons), assignee
  dropdown (farm members — needs a members lookup: gateway reads farm_memberships +
  a safe profile name source; Sol: expose a security_invoker view farm_member_names
  (farm_id, user_id, display_name from auth email local-part or profiles if exists) so
  the client never touches auth schema), due date, link pickers (field, machine).
- 18px base font, 48px targets, tabular-nums, plain English everywhere ("Nothing on
  the board. Add the first job to do."), farmerError mapping.

## Regression suite (SupabaseEquipmentTasksRepository.regression.ts)
Drive EVERY write end-to-end through a stateful canonical fake gateway (the hardened
inventory suite is the template — bug classes to cover: wrong-echo rejection for each
write kind, completion stamping (done without completed_at rejected), unknown due-view
reason token fails closed, idempotent replay, farm isolation, queue round-trip all
kinds + corrupt envelope, monotonic-free meter (backwards reading accepted), interval
due math NOT recomputed client-side (view rows authoritative), member-name view rows
mapped fail-closed. Wire into npm run regression; all existing suites stay green.

## Proof requirements (before commit)
npx tsc -b --force · npm run build · npm run regression — then Claude's browser pass on
live: add a machine, add reading, add interval that is immediately due (every 10 hours,
reading jump 50) → generate creates the task idempotently (call twice, still one),
board shows it with escalation, worker account can move it to Done, service-log entry
with cost + interval link resets the cycle, cost-to-date updates, Postgres rows
verified via execute_sql, worker CAN see both pages (ordinary member data), rep CANNOT.
