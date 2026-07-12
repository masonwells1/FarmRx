# TASK — ADVERSARIAL REVIEW (read-only): Programs Chunk 1 migration (Sol, skeptical)

CRITICAL EXECUTION RULE: headless, no human. Review fully, then report. Do NOT fix, do NOT
build, do NOT apply SQL, do NOT connect to any database, do NOT commit, do NOT start servers.
You MAY read any file. Assume the author was competent and LOOK HARD for the bug anyway.

## What you are reviewing
`C:\FarmRx\supabase\migrations\0024_programs.sql` (DRAFT, ~2000 lines) — the Programs schema +
receipt-idempotent RPCs — against its spec `C:\FarmRx\docs\programs-design.md` (Revision 2:
multiple programs per crop) and the proof plan
`C:\FarmRx\docs\build-notes\programs-chunk1-proof-plan.md`. This migration is NOT applied yet;
your review is the gate before Opus applies it to the farm-rx TEST project.

## Hunt hard — rank every finding P1/P2/P3 with file:line + concrete failure + fix
1. **Security-definer safety.** Every write RPC: does it require auth.uid(), enforce
   `can_edit_farm(p_farm_id)`, set `search_path=public,pg_temp`, validate exact JSON keys/types
   before casts, and do farm-scoped existence checks AND farm-scoped writes? Any RPC that trusts a
   caller-supplied id (program_id, pass_id, assignment_id, crop_assignment_id, application_record_id)
   without proving it belongs to p_farm_id is a P1 cross-farm write. Check EVERY id argument.
2. **No RLS-path row locks.** Confirm there is no real `SELECT ... FOR UPDATE` in any SECURITY
   INVOKER path (0017 lesson). Advisory locks only. Confirm the advisory-lock keys actually
   serialize the operations that race (per-farm + per-operation for idempotency; per-entity where
   distinct operations mutate the same program/assignment/crop).
3. **Receipt-idempotency correctness.** Same (farm, operation_id) replay by the SAME caller must
   return the identical prior receipt and create NO duplicate rows; a different caller reusing an
   operation_id must be rejected; the canonical result must be written. Look for a window where a
   crash between the write and the receipt insert could double-apply on replay.
4. **Exact write scope (0022 lesson).** Every UPDATE must touch ONLY the columns that RPC owns.
   `mark_program_pass_applied` must not alter expected/planting/acres of the crop; `save_program`
   must not touch passes/assignments; reschedule/skip/unassign must not rewrite terminal rows.
   Flag any UPDATE that sets a column it shouldn't.
5. **Multiple-programs-per-crop (Revision 2).** Same-program-twice guard = partial unique
   `(farm_id, crop_assignment_id, program_id) where status='active'`; DIFFERENT programs allowed;
   12-active cap enforced under the crop-assignment advisory lock so two concurrent assigns can't
   both pass a stale count. Look for a TOCTOU race in the cap check. Confirm reassign/unassign/
   refresh operate on ONE assignment and never touch sibling program tracks.
6. **Double-crop independence.** Two crop_assignments on one field must produce fully independent
   pass sets/statuses/dates. Any join keyed on field_id instead of crop_assignment_id is a P1.
7. **On-delete behavior.** `program_assignments`→`crop_assignments` FK must be `on delete restrict`
   (deleting a crop with program history must fail, not silently erase seasonal evidence). Verify
   cascade/restrict/set-null on every FK matches the design intent.
8. **generate_due_program_items.** `p_local_date` bounded within 1 day of current_date; task cycle
   key `due:<assigned_pass_id>:<due_on>`; notification dedupe `program:<assigned_pass_id>:due:<due_on>`;
   program NAME in task title + notification body; `on conflict do nothing`; failure never rolls back
   a status/assignment write. Confirm no duplicate card/notification on repeated calls.
9. **RLS + grants.** RLS enabled on all 6 tables; revoked from public/anon; SELECT via
   can_access_farm; INSERT/UPDATE/DELETE via can_edit_farm; every RPC revoked from public/anon/
   authenticated then granted to authenticated only. Views are `security_invoker=on`. Any table
   with RLS off or a function left executable by anon/public is a P1.
10. **State-consistency + money.** `assigned_program_passes` state checks reject impossible mixes
    (applied w/o applied_on/acres; skipped w/o reason). Cost views return completeness flags and
    NEVER coalesce a missing actual cost to 0. Numeric is exact; no float/`::real`.
11. **Ordering.** Pass/product reorder uses a two-step renumber under the program lock and cannot
    collide with the partial-unique sequence constraint mid-update.

## Output
State whether you found a working local Postgres (you likely won't). List findings ranked
P1/P2/P3 with file:line, the concrete failure scenario, and the fix. End with a one-line verdict:
APPLY-AFTER-FIXES (list the P1s) or CLEAN-TO-APPLY. Do NOT modify anything.
