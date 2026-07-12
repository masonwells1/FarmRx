# TASK — Migration 0023: notifications + push subscriptions (Sol, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; NEVER present a plan and wait — task failure.
PRE-APPROVED. Implement fully, then report. Do NOT apply to any DB (orchestrator applies after
review). No servers, no git commit.

## Context
Farm Rx (C:\FarmRx). Read `docs/reminders-design.md` §1 FIRST. 22 migrations applied (through
0022). Match house style: read 0016 (equipment — has `generate_due_service_tasks` with the
partial-unique-index + ON CONFLICT DO NOTHING + open-task-guard idempotency you must extend),
0019/0020 (RLS mirroring, SECURITY DEFINER RPCs), and the 0017 no-`SELECT ... FOR UPDATE` lesson.
Reuse can_access_farm / can_edit_farm.

## Deliverable — `supabase/migrations/0023_reminders.sql` (DRAFT, additive, safe after 0022)
1. Table `public.notifications` per design §1: id, farm_id (fk cascade), user_id (recipient; plain
   uuid provenance stamp — comment why, NOT an fk), category text check in
   ('spray','rain','scouting','harvest','service','task','general'), title text (1..160), body
   text (null or <=500), link text (null or <=200), dedupe_key text (nullable), read_at timestamptz
   null, created_by uuid, created_at. Partial unique index (farm_id, user_id, dedupe_key) WHERE
   dedupe_key is not null. Index (user_id, read_at, created_at desc). set_updated_at not needed
   (append-only + read_at); prevent_farm_id_change trigger. RLS: SELECT/UPDATE only where
   user_id = auth.uid() AND can_access_farm(farm_id); NO direct INSERT (revoke; inserts via RPC).
   UPDATE with check must forbid changing anything but read_at (enforce in the RPC; keep the
   policy simple: using/with check user_id=auth.uid() and can_access_farm).
2. Table `public.push_subscriptions`: id, user_id, endpoint text unique, p256dh text, auth text,
   user_agent text null, created_at, last_seen_at. RLS: all ops only where user_id = auth.uid().
3. RPCs (SECURITY DEFINER, search_path public,pg_temp, no FOR UPDATE):
   - `create_notification(p_farm_id uuid, p_recipient uuid, p_category text, p_title text,
     p_body text, p_link text, p_dedupe_key text) returns jsonb` — gate: caller is an active
     member with can_edit_farm(p_farm_id) OR caller = p_recipient; the RECIPIENT must be an active
     member of the farm (validate via a membership check). Validate category + title length. Insert
     with created_by=auth.uid(); ON CONFLICT (farm_id,user_id,dedupe_key) WHERE dedupe_key is not
     null DO NOTHING; return the inserted OR the pre-existing row. Idempotent.
   - `mark_notifications_read(p_ids uuid[]) returns jsonb` — set read_at=now() for rows where
     id = any(p_ids) AND user_id = auth.uid() (only your own); return count updated.
   - `save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
     returns jsonb` — upsert on endpoint for auth.uid() (endpoint unique; if it exists for another
     user, reassign to caller + update keys + last_seen_at); `delete_push_subscription(p_endpoint
     text)` — delete caller's own. Grants: revoke public/anon/authenticated on tables (grant only
     the needed select/update to authenticated for notifications, select/insert/update/delete for
     push_subscriptions as RLS-scoped); execute grants on the 4 RPCs to authenticated.
4. Extend `generate_due_service_tasks` (0016) to ALSO create a 'service' notification for the
   interval's due cycle — CREATE OR REPLACE it, keeping its existing task idempotency EXACTLY, and
   inserting a notification with dedupe_key = 'service:'||interval_id||':'||interval_cycle_key for
   the farm owner (or each manager — pick owner for v1 and note it), ON CONFLICT DO NOTHING. Do NOT
   change its task behavior otherwise. Quote the parts you touched.
5. Header comment: what/additive-safe/0017 note/the generate_due_service_tasks extension rationale.

## Self-review (adversarial)
Cross-user leakage (can user A read/mark B's notifications? the RLS + RPC own-only checks); can a
non-member create a notification for someone, or for a non-member recipient? dedupe idempotency;
push_subscription endpoint hijack (endpoint reassignment is intentional for shared-device re-subs
— confirm it only lets the CURRENT caller claim it, never read another user's keys); the
generate_due_service_tasks change must not break 0016's proven task idempotency. Anything that
could break applied 0001-0022. Findings + fixes.

## Report
`git status` (only 0023 created). Paste FULL 0023. Confirm you touched only
`supabase/migrations/0023_reminders.sql`. Quote the generate_due_service_tasks diff. Deviations.
