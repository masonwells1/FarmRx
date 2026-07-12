# TASK — Migration 0019: field_log_entries (rain gauge + field log) (Sol, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; NEVER present a plan and wait — that is task
failure. PRE-APPROVED. Implement fully, then report. Do NOT apply to any DB (orchestrator
applies after review). No servers, no git commit.

## Context
Farm Rx (C:\FarmRx). Read `docs/rain-fieldlog-design.md` §1 FIRST — authoritative. 18 migrations
applied (through 0018). Match house style exactly: read 0010/0011 (inventory — the closest
analog: private per-farm member data, receipts idempotency), 0015 (inventory live support),
0016/0017 (equipment; and the 0017 header on WHY no `SELECT ... FOR UPDATE` in SECURITY INVOKER
paths), and 0009 (repository_write_receipts + save_field_bundle pattern).

## Deliverable — `supabase/migrations/0019_field_log.sql` (DRAFT, additive, safe after 0018)
1. Table `public.field_log_entries` per design §1: id, farm_id (fk cascade), field_id with
   composite `(field_id, farm_id) references fields(id, farm_id)` same-farm fk, entry_type
   text check in ('rainfall','note'), observed_on date (bound <= current_date + 1), rainfall_in
   numeric(6,2) (>=0, <=100), note text (<=500), created_by uuid provenance stamp (NOT an FK
   that blocks membership removal — comment why, like repository_write_receipts), created_at,
   updated_at. CHECK: rainfall row has non-null rainfall_in and (note null or non-empty); note
   row has null rainfall_in and non-empty note. Indexes (farm_id, field_id, observed_on) and
   (farm_id). set_updated_at + prevent_farm_id_change triggers.
2. RLS: enable + revoke, then policies MIRRORING the inventory tables' member/rep model exactly
   (read: active members of the farm + rep when farm.share_with_rep and a matching enabled
   farm_rep_access row; write: can_edit_farm = owner/manager/worker). Confirm you reused the
   SAME helper predicates (can_edit_farm / can_read_farm or whatever inventory uses) rather than
   re-deriving membership inline.
3. `save_field_log_entry(p_farm_id uuid, p_operation_id uuid, p_entry jsonb) returns jsonb` —
   SECURITY DEFINER, search_path public,pg_temp, can_edit_farm gate, same-farm field check,
   write-receipt idempotency via repository_write_receipts (advisory xact lock on
   (farm_id, operation_id) like save_field_bundle; return prior result on replay), validates
   entry_type/rainfall/note consistency, inserts or (if p_entry has an id that exists for this
   farm+field) updates, returns the canonical row jsonb. NO row FOR UPDATE in this invoker-
   visible logic beyond what a SECURITY DEFINER context makes safe (follow 0017).
4. `delete_field_log_entry(p_farm_id uuid, p_entry_id uuid) returns jsonb` — SECURITY DEFINER,
   can_edit_farm gate, same-farm; hard delete; deleting an already-absent id returns a success
   shape (idempotent), not an error. Grants: revoke from public/anon/authenticated, grant
   execute to authenticated for both RPCs.
5. Header comment: what/why-additive-safe/the 0017 no-FOR-UPDATE note/predicate choices.

## Self-review (adversarial, before finishing)
RLS holes (can a non-member or read_only write? can a rep write? can a worker on another farm
touch a row?); the type/consistency CHECK correctness; receipt idempotency race; same-farm fk
integrity; anything that could break applied 0001-0018. List findings + fixes.

## Report
You cannot apply SQL. `git status` to show files created (ONLY 0019 + this being read). Paste
the FULL 0019 text. Confirm you touched only `supabase/migrations/0019_field_log.sql`. Note
whether inventory's read policy includes reps (so I know the exact predicate reused). Deviations.
