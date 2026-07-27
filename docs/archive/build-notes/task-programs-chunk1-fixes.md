# TASK — FIX Chunk 1 review findings (Sol). DRAFT migration only — do not apply.

CRITICAL EXECUTION RULE: headless, no human. PRE-APPROVED. Fix EVERY item below fully, then
report with per-fix proof of what you changed. Do NOT apply SQL, do NOT connect to any database,
do NOT deploy, do NOT commit, do NOT start servers. You MAY read any file. This edits the DRAFT
`C:\FarmRx\supabase\migrations\0024_programs.sql` in place (still unapplied) and the proof plan.

## Context
The adversarial review of `0024_programs.sql` found NO P1s (auth/RLS/grants/idempotency/cross-farm
all confirmed clean — keep them that way) but three real P2 correctness defects in the refresh/
reschedule paths, plus a too-shallow proof script. Spec: `C:\FarmRx\docs\programs-design.md`
(Revision 2). Fix all three P2s BEFORE the migration is applied (better than a follow-up migration),
plus expand the proof script.

## P2-1 — Removed template products survive assignment refresh (needs a schema column)
`assigned_program_pass_products` has no active/archive state, so `refresh_program_assignment`
cannot retire a product the farmer deliberately removed from the template; it keeps showing and
COSTING a removed product.
FIX:
- Add `is_active boolean not null default true` to `assigned_program_pass_products` (do NOT delete
  rows — history is preserved; this only marks a line no longer part of the current plan).
- In `refresh_program_assignment`, for ELIGIBLE untouched Planned passes only (never terminal —
  applied/skipped/cancelled — and never `is_field_override=true`), set `is_active=false` on assigned
  product lines whose source template product is archived/removed, `is_active=true` (and refresh the
  snapshot) on ones still present, and insert newly added template products.
- Exclude `is_active=false` lines from EVERY read model that represents the CURRENT plan/cost:
  `program_assignment_tracker`, `program_assignment_costs`, `program_crop_cost_rollups`,
  `program_application_products`. History-preserving is fine; current cost/plan must not count them.
- Reconcile `mark_program_pass_applied`: its "actual products must contain every assigned product
  exactly once" check and the per-line writes must operate on ACTIVE assigned product lines only
  (an inactive planned line is not part of the applied reality). Verify no other RPC assumed all
  lines are active.

## P2-2 — Refresh changes task title but not the task's due date/cycle
When refresh moves an eligible Planned pass's `due_on`, `refresh_program_assignment` updates only the
open program task's title, not its `due_on`, details, or `program_cycle_key`. Due generation then
sees an existing open task and won't create the correct new-date card; the board stays permanently
wrong.
FIX: when refresh changes an eligible pass's `due_on`, synchronize its OPEN program task's `due_on`,
details, and `program_cycle_key` under the existing `program-due-items` advisory lock, using the
SAME collision-safe behavior as reschedule (see P2-3). Never rewrite a terminal (Done) task.

## P2-3 — Reschedule to a previously-used date violates the task unique index
Reschedule rewrites the open task's `program_cycle_key` to `due:<pass>:<new_due_on>`. If a terminal
(Done) task already holds that exact cycle key (the pass was on that date before), the partial unique
`(farm_id, program_assigned_pass_id, program_cycle_key)` — which covers terminal AND open rows —
raises a unique violation and the whole reschedule fails.
FIX: before rewriting the open task's cycle key, detect an existing row with the target cycle key for
that assigned pass. Define deterministic behavior: if a TERMINAL row already owns the target key,
do NOT rewrite it — instead close/cancel the now-obsolete OPEN card (set it done/cancelled per the
board's conventions) and treat the pre-existing cycle as canonical, so the state is consistent and
no unique violation occurs. Never rewrite terminal history. Apply this same collision-safe routine
in the refresh path (P2-2). Factor it into one internal helper if that keeps both correct.

## P3 — Expand the proof script
`C:\FarmRx\docs\build-notes\programs-chunk1-proof-plan.md` currently lets all checks pass without
exercising the hard paths. ADD explicit negative + concurrent cases (as runnable SQL Opus will
execute against the TEST project) for: concurrent cap enforcement (two sessions racing a 12th
program on one crop), the P2-1 refresh product-removal, the P2-2 task/date refresh sync, the P2-3
reschedule cycle collision, reassign/unassign isolation (sibling program tracks untouched), pass/
product reorder collision, due-item dedupe on repeated calls, EVERY caller-supplied ID rejected
cross-farm, and the full RLS/grant matrix (worker can, read_only/rep cannot, anon/public cannot).
Each case must state the expected row-level outcome so a regression cannot silently pass.

## Report
Per-fix: what changed + file:line, and how the new schema column + refresh/reschedule logic keeps
the "no P1" guarantees intact (still no FOR UPDATE, still exact write scope, still farm-scoped).
Confirm `0024_programs.sql` is internally consistent (the new column is created before the views/
RPCs that reference it). List any residual risk. Do NOT apply SQL, do NOT commit.
