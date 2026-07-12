# TASK — BUILD Chunk 1: Programs schema + RPCs (Sol). DRAFT MIGRATION ONLY — do not apply.

CRITICAL EXECUTION RULE: headless, no human is watching. NEVER present a plan and wait for
approval — that is task failure. Everything here is PRE-APPROVED. Implement fully, write the
files, then report with proof. Do NOT ask questions mid-run.

## Authoritative spec
`C:\FarmRx\docs\programs-design.md` (you wrote it; it is the source of truth, including
Revision 2 = multiple programs per crop). Build Chunk 1 EXACTLY to that design. Read it again
before writing SQL so every column/constraint/RPC matches.

## Scope of THIS chunk (schema + RPC contract only — no client code)
WRITE a DRAFT migration `C:\FarmRx\supabase\migrations\0024_programs.sql` containing:
1. All Programs tables from the design: `programs` (incl. optional `program_kind`), `program_passes`,
   `program_pass_products`, `program_assignments` (incl. `program_name_snapshot` /
   `program_kind_snapshot`), `assigned_program_passes`, `assigned_program_pass_products`.
   Every farm-owned table: `farm_id`, `unique (id, farm_id)`, `prevent_farm_id_change` trigger,
   `set_updated_at` trigger where `updated_at` exists, plain-UUID audit provenance stamps.
2. All constraints/indexes from the design, including: partial unique
   `(farm_id, crop_assignment_id, program_id) where status='active'` (same-program guard), the
   12-active-programs-per-crop cap (guard trigger under the crop-assignment advisory lock),
   partial unique pass/product `sequence` rules, mutually-exclusive `target_date` vs
   `planting_offset_days`, state-consistency checks on `assigned_program_passes`, and the
   `program_assignments` composite FK to `crop_assignments` `on delete restrict`.
3. `farm_tasks` additions: widen `source` to include `'program'`; add `program_assigned_pass_id`
   (same-farm FK, on delete set null), `program_cycle_key`, and the partial unique
   `(farm_id, program_assigned_pass_id, program_cycle_key) where program_cycle_key is not null`.
   Do NOT touch/overload `interval_id`/`interval_cycle_key`.
4. RLS on every new table: enable RLS; revoke from public/anon; authenticated SELECT via
   `can_access_farm(farm_id)`; INSERT via `can_edit_farm(farm_id)` + creator = auth.uid() where
   present; UPDATE/DELETE via `can_edit_farm(farm_id)`. All mutations go through RPCs only.
5. Security-invoker read views: `program_assignment_tracker`, `program_assignment_costs`,
   `program_crop_cost_rollups` (per-crop rollup of active program costs + category subtotals +
   completeness flags; never coalesce missing actual cost to 0), `program_application_products`
   (flagged `inventory_matched=false`).
6. All receipt-idempotent SECURITY DEFINER RPCs in the design's RPC surface (Revision-2 versions):
   `save_program`, `save_program_pass`, `reorder_program_passes`, `delete_program_pass`,
   `delete_program`, `assign_program` (adds a program; enforces same-program uniqueness + 12-cap;
   never rejects merely because another different program is active), `reassign_program_assignment`
   (replaces ONE named assignment, leaves siblings untouched), `refresh_program_assignment`,
   `reschedule_program_pass`, `mark_program_pass_applied`, `skip_program_pass`, `unassign_program`,
   `generate_due_program_items`.

## NON-NEGOTIABLE lessons (violating any is a failure)
- **NO `SELECT ... FOR UPDATE` in any SECURITY INVOKER / RLS path** (0017: RLS silently filters the
  locked row → a worker's write fails). Use SECURITY DEFINER + `pg_advisory_xact_lock` only.
- Receipt-idempotency via `repository_write_receipts`: advisory xact lock on
  hashtext(farm_id)+hashtext(operation_id); return the prior canonical `result` on same-caller
  replay; reject an operation_id used by a different caller; write the canonical JSON receipt.
- Every RPC: require non-null farm/operation/auth.uid(); `can_edit_farm(p_farm_id)`; validate exact
  JSON keys/types before casts; `set search_path = public, pg_temp`; farm-scoped existence checks
  AND farm-scoped writes; **exact write scope** — never overwrite columns the RPC doesn't own (the
  0022 harvest lesson). Revoke each RPC from public/anon/authenticated, then grant execute to
  authenticated only.
- `generate_due_program_items`: bound `p_local_date` to within 1 day of `current_date`; task cycle
  key `due:<assigned_pass_id>:<due_on>`; notification dedupe `program:<assigned_pass_id>:due:<due_on>`;
  task title + notification body NAME THE PROGRAM (Revision 2) so two due "Post" passes are
  distinguishable; `on conflict do nothing`; best-effort, never rolls back a status/assignment write.
- Money columns exact `numeric`; no float. Cost views return completeness flags, never coalesce
  missing cost to 0.

## Constraints on this run
- This is a DRAFT. Do NOT apply the migration, do NOT connect to the live/TEST Supabase project,
  do NOT deploy, do NOT git commit. Applying 0024 is a separate owner-gated step Opus will do after
  review.
- You MAY run `npx tsc -b --force` if you touch any TS (you should not need to this chunk).
- If a local Postgres is available you MAY validate the SQL parses in a DISPOSABLE local database
  only; otherwise do a careful self-check. State clearly which you did.

## Also write: `C:\FarmRx\docs\build-notes\programs-chunk1-proof-plan.md`
A behavioral test script Opus will run against the TEST project AFTER review: exact SQL snippets
that impersonate (a) an owner, (b) a worker, (c) a read_only member to prove — worker can create a
program/pass/assign; read_only cannot; same operation_id replay returns the identical receipt (no
dup rows); two DIFFERENT programs assign to one crop but the SAME program twice is rejected; the
12-cap trips; a double-crop field (two crop_assignments) keeps passes independent; mark-applied
updates only its own columns and leaves expected/planting untouched; cross-farm IDs fail closed.

## Report
Summarize what you wrote (files + row of each table/RPC), confirm each NON-NEGOTIABLE lesson is
honored (point to where), list any deviations from the design and why, and give the top 3 risks you
want the adversarial reviewer to focus on. Do NOT apply SQL. Do NOT commit.
