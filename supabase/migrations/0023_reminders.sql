-- DRAFT ONLY -- Adds recipient-private in-app notifications and per-user push
-- subscriptions after 0022. This migration is additive-safe: it creates only
-- new tables, policies, indexes, and RPCs, then replaces one existing RPC
-- without changing its task-generation contract or task idempotency.
--
-- The SECURITY DEFINER paths use fixed search paths, explicit authentication
-- and membership gates, farm-scoped statements, and no SELECT ... FOR UPDATE.
-- This follows the 0017 lesson that RLS can silently hide invoker row locks.
--
-- generate_due_service_tasks retains 0016's partial-unique-index conflict path
-- and open-task guard exactly. It gains narrow definer rights so the same call
-- can also insert one owner notification per interval cycle despite the table's
-- deliberate no-direct-INSERT grant. Owner-only delivery is the v1 choice.

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  -- Plain UUID provenance stamp: retaining a notification must never block
  -- membership removal or require an auth.users foreign-key lifecycle.
  user_id uuid not null,
  category text not null check (category in (
    'spray', 'rain', 'scouting', 'harvest', 'service', 'task', 'general'
  )),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  body text check (body is null or char_length(body) <= 500),
  link text check (link is null or char_length(link) <= 200),
  dedupe_key text,
  read_at timestamptz,
  -- Plain UUID provenance for the same retention reason as the recipient.
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create unique index notifications_farm_recipient_dedupe_idx
  on public.notifications (farm_id, user_id, dedupe_key)
  where dedupe_key is not null;

create index notifications_recipient_read_created_idx
  on public.notifications (user_id, read_at, created_at desc);

create trigger notifications_prevent_farm_move
before update on public.notifications
for each row execute function public.prevent_farm_id_change();

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;

revoke all on table public.notifications
  from public, anon, authenticated;
revoke all on table public.push_subscriptions
  from public, anon, authenticated;

grant select on table public.notifications to authenticated;
-- Column-level UPDATE is the hard guard that prevents direct edits to title,
-- recipient, category, farm, or provenance while permitting read_at changes.
grant update (read_at) on table public.notifications to authenticated;
grant select, insert, update, delete on table public.push_subscriptions
  to authenticated;

create policy notifications_select
on public.notifications for select to authenticated
using (
  user_id = auth.uid()
  and public.can_access_farm(farm_id)
);

create policy notifications_update
on public.notifications for update to authenticated
using (
  user_id = auth.uid()
  and public.can_access_farm(farm_id)
)
with check (
  user_id = auth.uid()
  and public.can_access_farm(farm_id)
);

create policy push_subscriptions_select
on public.push_subscriptions for select to authenticated
using (user_id = auth.uid());

create policy push_subscriptions_insert
on public.push_subscriptions for insert to authenticated
with check (user_id = auth.uid());

create policy push_subscriptions_update
on public.push_subscriptions for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy push_subscriptions_delete
on public.push_subscriptions for delete to authenticated
using (user_id = auth.uid());

create function public.create_notification(
  p_farm_id uuid,
  p_recipient uuid,
  p_category text,
  p_title text,
  p_body text,
  p_link text,
  p_dedupe_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_notification public.notifications%rowtype;
begin
  if v_caller is null then
    raise exception 'authentication is required';
  end if;
  if p_farm_id is null or p_recipient is null then
    raise exception 'farm and recipient are required';
  end if;

  if not exists (
    select 1
    from public.farm_memberships fm
    where fm.farm_id = p_farm_id
      and fm.user_id = p_recipient
      and fm.status = 'active'
  ) then
    raise exception 'notification recipient must be an active member of this farm';
  end if;

  if not public.can_edit_farm(p_farm_id) and v_caller <> p_recipient then
    raise exception 'you do not have permission to create this notification';
  end if;

  if p_category is null or p_category not in (
    'spray', 'rain', 'scouting', 'harvest', 'service', 'task', 'general'
  ) then
    raise exception 'notification category is invalid';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 1 and 160 then
    raise exception 'notification title must be between 1 and 160 characters';
  end if;

  insert into public.notifications (
    farm_id,
    user_id,
    category,
    title,
    body,
    link,
    dedupe_key,
    created_by
  )
  values (
    p_farm_id,
    p_recipient,
    p_category,
    p_title,
    p_body,
    p_link,
    p_dedupe_key,
    v_caller
  )
  on conflict (farm_id, user_id, dedupe_key)
    where dedupe_key is not null
    do nothing
  returning * into v_notification;

  if not found then
    select n.*
      into strict v_notification
    from public.notifications n
    where n.farm_id = p_farm_id
      and n.user_id = p_recipient
      and n.dedupe_key = p_dedupe_key;
  end if;

  return to_jsonb(v_notification);
end;
$$;

create function public.mark_notifications_read(p_ids uuid[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_updated_count integer := 0;
begin
  if v_caller is null then
    raise exception 'authentication is required';
  end if;
  if p_ids is null then
    raise exception 'notification IDs are required';
  end if;

  update public.notifications n
  set read_at = now()
  where n.id = any(p_ids)
    and n.user_id = v_caller
    and n.read_at is null;

  get diagnostics v_updated_count = row_count;

  return jsonb_build_object('updated_count', v_updated_count);
end;
$$;

create function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_subscription public.push_subscriptions%rowtype;
begin
  if v_caller is null then
    raise exception 'authentication is required';
  end if;
  if p_endpoint is null or btrim(p_endpoint) = ''
    or p_p256dh is null or btrim(p_p256dh) = ''
    or p_auth is null or btrim(p_auth) = ''
  then
    raise exception 'endpoint and push keys are required';
  end if;

  -- An endpoint may move between accounts on a shared device. The caller can
  -- claim it by replacing ownership and keys, but receives only the new row;
  -- this path never reads or returns the prior user's stored key material.
  insert into public.push_subscriptions (
    user_id,
    endpoint,
    p256dh,
    auth,
    user_agent
  )
  values (
    v_caller,
    p_endpoint,
    p_p256dh,
    p_auth,
    p_user_agent
  )
  on conflict (endpoint) do update
  set user_id = excluded.user_id,
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      last_seen_at = now()
  returning * into v_subscription;

  return to_jsonb(v_subscription);
end;
$$;

create function public.delete_push_subscription(p_endpoint text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_deleted_count integer := 0;
begin
  if v_caller is null then
    raise exception 'authentication is required';
  end if;
  if p_endpoint is null or btrim(p_endpoint) = '' then
    raise exception 'endpoint is required';
  end if;

  delete from public.push_subscriptions s
  where s.endpoint = p_endpoint
    and s.user_id = v_caller;

  get diagnostics v_deleted_count = row_count;

  return jsonb_build_object('deleted_count', v_deleted_count);
end;
$$;

revoke all on function public.create_notification(
  uuid, uuid, text, text, text, text, text
) from public, anon, authenticated;
revoke all on function public.mark_notifications_read(uuid[])
  from public, anon, authenticated;
revoke all on function public.save_push_subscription(text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.delete_push_subscription(text)
  from public, anon, authenticated;

grant execute on function public.create_notification(
  uuid, uuid, text, text, text, text, text
) to authenticated;
grant execute on function public.mark_notifications_read(uuid[])
  to authenticated;
grant execute on function public.save_push_subscription(text, text, text, text)
  to authenticated;
grant execute on function public.delete_push_subscription(text)
  to authenticated;

-- 0016 task logic below is intentionally unchanged through row_count/return.
-- The only task-generator edits are SECURITY DEFINER plus the notification
-- insert between task row_count capture and the original JSON return.
create or replace function public.generate_due_service_tasks(p_farm_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_created_count integer := 0;
begin
  if v_caller is null then
    raise exception 'you must be signed in to generate service tasks';
  end if;
  if p_farm_id is null then
    raise exception 'farm is required to generate service tasks';
  end if;
  if not public.is_active_farm_member(p_farm_id) then
    raise exception 'you must be an active member of this farm to generate service tasks';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text, 0));

  insert into public.farm_tasks (
    farm_id,
    title,
    priority,
    equipment_id,
    source,
    interval_id,
    interval_cycle_key,
    created_by
  )
  select
    p_farm_id,
    i.name || ' — ' || e.name,
    'high',
    e.id,
    'service_interval',
    i.id,
    case d.reason
      when 'meter' then
        'meter:' || coalesce(i.last_done_reading::text, 'never') || ':'
        || floor(
             (latest.reading - coalesce(i.last_done_reading, 0)) / i.every_meter
           )::text
      when 'calendar' then
        'cal:' || to_char(
          (
            coalesce(i.last_done_on, e.created_at::date)
            + make_interval(months => i.every_months)
          )::date,
          'YYYY-MM'
        )
    end,
    v_caller
  from (
    select distinct on (due.interval_id)
      due.equipment_id,
      due.interval_id,
      due.reason,
      due.overdue_amount
    from public.equipment_service_due due
    order by
      due.interval_id,
      case due.reason when 'meter' then 0 else 1 end
  ) d
  join public.equipment_service_intervals i
    on i.id = d.interval_id
   and i.farm_id = p_farm_id
  join public.equipment e
    on e.id = d.equipment_id
   and e.farm_id = p_farm_id
  left join lateral (
    select r.reading
    from public.equipment_meter_readings r
    where r.equipment_id = e.id
      and r.farm_id = p_farm_id
    order by r.read_on desc, r.created_at desc, r.id desc
    limit 1
  ) latest on true
  -- One OPEN auto-task per interval, ever: without this guard the meter cycle
  -- key's floor() term grows as the un-serviced meter climbs, minting a second
  -- identical card while the first is still on the board.
  where not exists (
    select 1
    from public.farm_tasks t
    where t.farm_id = p_farm_id
      and t.interval_id = i.id
      and t.source = 'service_interval'
      and t.status in ('todo', 'doing')
  )
  on conflict (farm_id, interval_id, interval_cycle_key)
    where interval_cycle_key is not null
    do nothing;

  get diagnostics v_created_count = row_count;

  -- v1 notifies one active owner. The same due-row selection and exact cycle
  -- expression as 0016 make the notification key track the task cycle, while
  -- its own partial unique index makes retries harmless even after task edits.
  insert into public.notifications (
    farm_id,
    user_id,
    category,
    title,
    body,
    link,
    dedupe_key,
    created_by
  )
  select
    p_farm_id,
    owner.user_id,
    'service',
    left('Service due: ' || i.name || ' — ' || e.name, 160),
    null,
    '/equipment',
    'service:' || i.id::text || ':' ||
      case d.reason
        when 'meter' then
          'meter:' || coalesce(i.last_done_reading::text, 'never') || ':'
          || floor(
               (latest.reading - coalesce(i.last_done_reading, 0)) / i.every_meter
             )::text
        when 'calendar' then
          'cal:' || to_char(
            (
              coalesce(i.last_done_on, e.created_at::date)
              + make_interval(months => i.every_months)
            )::date,
            'YYYY-MM'
          )
      end,
    v_caller
  from (
    select distinct on (due.interval_id)
      due.equipment_id,
      due.interval_id,
      due.reason,
      due.overdue_amount
    from public.equipment_service_due due
    order by
      due.interval_id,
      case due.reason when 'meter' then 0 else 1 end
  ) d
  join public.equipment_service_intervals i
    on i.id = d.interval_id
   and i.farm_id = p_farm_id
  join public.equipment e
    on e.id = d.equipment_id
   and e.farm_id = p_farm_id
  join lateral (
    select fm.user_id
    from public.farm_memberships fm
    where fm.farm_id = p_farm_id
      and fm.role = 'owner'
      and fm.status = 'active'
    order by fm.user_id
    limit 1
  ) owner on true
  left join lateral (
    select r.reading
    from public.equipment_meter_readings r
    where r.equipment_id = e.id
      and r.farm_id = p_farm_id
    order by r.read_on desc, r.created_at desc, r.id desc
    limit 1
  ) latest on true
  on conflict (farm_id, user_id, dedupe_key)
    where dedupe_key is not null
    do nothing;

  return jsonb_build_object('created_count', v_created_count);
end;
$$;

revoke all on function public.generate_due_service_tasks(uuid)
  from public, anon, authenticated;
grant execute on function public.generate_due_service_tasks(uuid)
  to authenticated;
