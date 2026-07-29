# TASK — Equipment & Tasks review fixes + regression hardening (Terra, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; never present a plan and wait — that is task
failure. Everything is PRE-APPROVED. Implement fully, then report with proof.

PRE-APPROVED scope: modify ONLY these files:
C:\FarmRx\src\data\equipmentTasks.ts, EquipmentTasksDataGateway.ts,
SupabaseEquipmentTasksDataGateway.ts, SupabaseEquipmentTasksRepository.ts,
QueuedEquipmentTasksRepository.ts, equipmentTasksWriteQueue.ts,
createSupabaseEquipmentTasksServices.ts, SupabaseEquipmentTasksRepository.regression.ts,
and C:\FarmRx\src\EquipmentTasksModule.tsx.
Do NOT touch supabase/migrations/**, App.tsx, index.ts, backends.ts, syncStatus.ts.
No DB ops, no git, no servers.

An adversarial review found these defects. Fix ALL of them.

## Fix 1 (P1) — save_service_log_entry needs a stable p_reading_id
The RPC signature is save_service_log_entry(p_farm_id uuid, p_log jsonb, p_reading_id
uuid default null) and it RAISES when p_log.meter_reading is non-null but p_reading_id
is null. The client never sends it.
- Add reading_id: string | null to ServiceLogWrite.
- Mint it ONCE where the write is FIRST built (before enqueue) with createId() when
  meter_reading != null, else null — it must live inside the queue entry so offline
  replay reuses the SAME id (a fresh id per replay would insert duplicate reading rows).
- Gateway passes p_reading_id: value.reading_id.
- Echo validation: when reading_id present, the echo's reading row id must equal it.

## Fix 2 (P1) — mapper length caps looser to match the DB
DB allows: farm_tasks.title 500, equipment.make 160, equipment.model 160. The mappers
cap title at 300 and make/model at 120 → DB-legal rows (incl. auto-generated titles
"<interval name> — <equipment name>" up to ~403 chars) brick the fail-closed workspace
load. Raise the mapper caps to exactly the DB caps (500/160/160). Grep for any other
cap stricter than its DB column in 0016 (read the migration's CHECK lengths) and align.

## Fix 3 (P1) — Done column hidden by default (operator precedence)
EquipmentTasksModule.tsx: `x => !filter || filter === 'open' ? … : …` — `||` binds
before `?:`, so the no-filter default excludes done tasks and the Done column is always
empty. Required behavior: default (no KPI filter) shows ALL tasks — To Do and Doing
columns fully, Done column collapsed to the 10 most recent with a "Show more" button;
'open' KPI shows only todo+doing; 'mine' filters by CURRENT USER (fix 4); 'overdue'
overdue only; 'done' the Done column. Parenthesize/restructure properly.

## Fix 4 (P2) — "Mine" uses the farm creator, not the signed-in user
workspace.fields.farm.created_by is the OWNER's id. Thread the real current user id:
createSupabaseEquipmentTasksServices already receives getContext (userId) — surface a
viewer object on the workspace: { user_id: string }. The repository fetches it via a
new dependency getUserId (wire from getContext in the services factory). "Mine" KPI +
filter use workspace.viewer.user_id.

## Fix 5 (P2) — UI role gating (workers must not see forbidden buttons)
RLS already blocks workers from: equipment save/edit, interval save/edit/delete, task
delete, service-log delete. The UI shows those controls to everyone. Add the viewer's
role to the workspace: gateway reads the caller's own farm_memberships row
(select role ... eq user_id = viewer, eq farm_id) — RLS permits reading your own
membership. workspace.viewer becomes { user_id, role: 'owner'|'manager'|'worker'|
'read_only' } (fail-closed mapper). can_manage = role owner|manager. Hide: Edit
machine, Add machine, interval add/edit/delete forms, task Delete button, service-log
delete for !can_manage. Workers still see: meter reading quick-add, Log service, task
create/edit/status buttons, Add service task.

## Fix 6 (P3) — calendar-interval echo false rejection
After save_service_log_entry, the client asserts interval.last_done_reading ===
value.meter_reading. The DB stamps last_done_reading = coalesce(new reading, previous
value), so completing a CALENDAR interval with no reading echoes the OLD reading and
the client throws though the save committed. Correct assertion: last_done_on ===
value.service_date always; last_done_reading === value.meter_reading ONLY when
value.meter_reading != null.

## Fix 7 (P1) — REBUILD the regression suite for real
The current suite drives nothing (fake Writer pushing labels; getWorkspace throws
'not used'). Rebuild it to the inventory suite's bar
(C:\FarmRx\src\data\SupabaseInventoryRepository.regression.ts is the template):
stateful canonical fake gateway with exact echo shapes and microsecond+offset stamps,
driving EVERY operation end-to-end:
- each write kind + wrong-echo rejection for each
- save_service_log_entry: with reading (stable reading_id echoed; SAME id on second
  replay — a fake that receives a DIFFERENT reading id on replay must fail the test),
  without reading on a calendar interval whose last_done_reading is non-null (Fix 6
  regression — must succeed), interval stamp echo
- completion stamping: fake echoes done WITHOUT completed_by/at → mapper rejects;
  reopen echo with stamps cleared → accepted
- due-view rows: reason 'meter'/'calendar' accepted, unknown reason fails closed;
  farm_id present (the view now exposes it)
- length caps: a 500-char title loads; a 501-char title fails closed
- Done-column/default-filter logic if exported as a pure helper (export the task
  filtering as a testable pure function from the module or a lib file — allowed since
  EquipmentTasksModule.tsx is in scope)
- idempotent replay both kinds, corrupt envelope, farm isolation, backwards meter
  reading accepted, member-name + viewer-role rows fail-closed
Update the suite's pass line to state the coverage-group count like inventory's.

## Proof required (run from C:\FarmRx, paste real output)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` all 9 suites
pass. If the npx shim is broken use the repo-local binaries like last time and say so.
FINAL message: per-fix confirmation list, proof output, deviations.
