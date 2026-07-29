# TASK — Migration 0020: scouting notes + photos + storage bucket (Sol, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; NEVER present a plan and wait — task failure.
PRE-APPROVED. Implement fully, then report. Do NOT apply to any DB (orchestrator applies after
review). No servers, no git commit.

## Context
Farm Rx (C:\FarmRx). Read `docs/scouting-design.md` (authoritative) §1 and §2 FIRST. 19
migrations applied (through 0019). Match house style: read 0010/0011 (inventory), 0019
(field_log — the closest analog: table + receipt-idempotent save + idempotent delete + RLS
mirroring inventory), and 0018 (lat/long columns + both-set constraint). Reuse the SAME predicate
helpers (`can_access_farm`, `can_edit_farm`) — do NOT re-derive membership inline. Follow the
0017 no-`SELECT ... FOR UPDATE`-in-invoker-paths lesson.

## Deliverable — `supabase/migrations/0020_scouting.sql` (DRAFT, additive, safe after 0019)
1. Table `public.scouting_notes` per design §1: id, farm_id (fk cascade), field_id with composite
   `(field_id, farm_id) -> fields(id, farm_id)` same-farm fk, observed_on date (<= current_date+1),
   category text check in ('weed','disease','insect','other'), note text (<= 2000), latitude
   numeric(9,6)/longitude numeric(9,6) nullable with a both-null-or-both-set check (copy 0018's
   pattern), created_by uuid provenance stamp, created_at, updated_at, unique (id, farm_id),
   set_updated_at + prevent_farm_id_change triggers. (The "note non-empty OR >=1 photo" rule is
   enforced in the RPC, not a table CHECK, since photos live in a child table.)
2. Child table `public.scouting_photos`: id, farm_id, note_id with composite
   `(note_id, farm_id) -> scouting_notes(id, farm_id)` cascade fk, storage_path text not null
   unique, created_by, created_at. Index (farm_id, note_id). RLS + triggers as needed.
3. RLS on BOTH tables: enable + revoke + grants; read = can_access_farm(farm_id); insert/update/
   delete = can_edit_farm(farm_id) (+ created_by = auth.uid() on insert). Mirror 0019 exactly.
4. Storage: create PRIVATE bucket `scouting-photos`
   (`insert into storage.buckets (id, name, public) values ('scouting-photos','scouting-photos',
   false) on conflict do nothing;`). Then RLS policies on `storage.objects` scoped to this bucket,
   farm-keyed by the FIRST path segment `split_part(name,'/',1)::uuid`:
   - SELECT: `bucket_id='scouting-photos' and public.can_access_farm(split_part(name,'/',1)::uuid)`
   - INSERT: `bucket_id='scouting-photos' and public.can_edit_farm(split_part(name,'/',1)::uuid)`
   - DELETE: same as INSERT. (No UPDATE policy.)
   Ensure anon/public get NOTHING. Confirm the exact `to authenticated` clause + that
   split_part on a non-uuid path fails closed (a malformed first segment must not grant access —
   consider `nullif`/a safe cast; if `::uuid` on bad text raises, that denies access which is
   acceptable, but verify it does not error the whole query in a way that leaks). Read Supabase
   storage-RLS docs to get this exactly right — this is the customer-photo security boundary.
5. `save_scouting_note(p_farm_id uuid, p_operation_id uuid, p_note jsonb) returns jsonb` — SECURITY
   DEFINER, receipt-idempotent (advisory lock + repository_write_receipts like 0019). p_note keys
   {id?, field_id, observed_on, category, note, latitude, longitude, photos (array of
   {id?, storage_path}), create_task?}. Validate: field belongs to farm; each photo storage_path
   starts with `p_farm_id || '/' || field_id || '/' || note_id || '/'`; require note non-empty OR
   >=1 photo. Upsert the note and its photo rows (delete removed child rows, insert new). If
   create_task is true, insert a farm_task (source 'scouting', linked field_id, title from
   category + note) — REUSE the exact insert path/enum values the equipment/tasks migration
   (0016) uses so the board renders it; read 0016 to match farm_tasks columns/enums. Return the
   canonical note + photos (+ created task id if any).
6. `delete_scouting_note(p_farm_id uuid, p_note_id uuid) returns jsonb` — SECURITY DEFINER,
   can_edit_farm gate, same-farm; capture the child photo storage_paths BEFORE delete; delete the
   note (cascade removes photo rows); RETURN `{id, deleted:true, storage_paths: [...]}` so the
   client can remove the files from Storage. Idempotent (absent id → {id, deleted:true,
   storage_paths: []}).
7. Grants (revoke public/anon/authenticated, grant execute to authenticated) for both RPCs.
   Header comment: what/additive-safe/0017 note/storage-RLS rationale.

## Self-review (adversarial)
Storage-RLS holes (can a member of farm A read farm B's photos? can anon? does a malformed path
deny? can a worker upload only under their own farm's prefix?); the note-or-photo rule; photo-path
prefix validation (could a caller record a path under another farm/field/note?); receipt
idempotency; farm isolation; the create_task path matching 0016's real columns/enums; anything
that could break applied 0001-0019. List findings + fixes.

## Report
`git status` (only 0020 created). Paste the FULL 0020 text. Confirm you touched only
`supabase/migrations/0020_scouting.sql`. State the exact storage.objects policy predicates you
used and how a malformed path fails closed. Confirm the farm_tasks insert matches 0016's columns/
enums (quote them). Deviations.
