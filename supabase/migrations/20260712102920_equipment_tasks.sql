-- DRAFT ONLY — review before applying.
-- Modules 5 + 6: equipment, service history, and the farm task board.
-- This migration intentionally performs no data backfill or live operation.

create table public.equipment (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 200),
  category text not null check (category in (
    'tractor', 'combine', 'sprayer', 'truck', 'trailer', 'header',
    'tillage', 'planter', 'grain_cart', 'utility', 'other'
  )),
  make text check (make is null or length(btrim(make)) between 1 and 160),
  model text check (model is null or length(btrim(model)) between 1 and 160),
  model_year integer check (model_year is null or model_year between 1900 and 2100),
  serial_or_vin text
    check (serial_or_vin is null or length(btrim(serial_or_vin)) between 1 and 200),
  purchase_date date,
  purchase_price numeric(16, 2) check (purchase_price is null or purchase_price >= 0),
  meter_unit text not null default 'hours' check (meter_unit in ('hours', 'miles')),
  warranty_expires_on date,
  warranty_notes text
    check (warranty_notes is null or length(btrim(warranty_notes)) between 1 and 4000),
  status text not null default 'active' check (status in ('active', 'sold', 'retired')),
  notes text check (notes is null or length(btrim(notes)) between 1 and 10000),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id)
);

create table public.equipment_meter_readings (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  equipment_id uuid not null,
  reading numeric(18, 2) not null check (reading >= 0),
  read_on date not null,
  source text not null default 'manual' check (source in ('manual', 'service')),
  notes text check (notes is null or length(btrim(notes)) between 1 and 4000),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint equipment_meter_readings_equipment_same_farm_fk
    foreign key (equipment_id, farm_id)
    references public.equipment(id, farm_id)
    on delete cascade
);

create table public.equipment_service_intervals (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  equipment_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 200),
  every_meter numeric(18, 2) check (every_meter is null or every_meter > 0),
  every_months integer check (every_months is null or every_months > 0),
  last_done_on date,
  last_done_reading numeric(18, 2)
    check (last_done_reading is null or last_done_reading >= 0),
  is_active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint equipment_service_intervals_rule_present check (
    every_meter is not null or every_months is not null
  ),
  constraint equipment_service_intervals_equipment_same_farm_fk
    foreign key (equipment_id, farm_id)
    references public.equipment(id, farm_id)
    on delete cascade
);

create table public.equipment_service_log (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  equipment_id uuid not null,
  service_date date not null,
  work_performed text not null
    check (length(btrim(work_performed)) between 1 and 10000),
  parts text check (parts is null or length(btrim(parts)) between 1 and 10000),
  vendor text check (vendor is null or length(btrim(vendor)) between 1 and 200),
  cost numeric(16, 2) check (cost is null or cost >= 0),
  meter_reading numeric(18, 2) check (meter_reading is null or meter_reading >= 0),
  interval_id uuid,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint equipment_service_log_equipment_same_farm_fk
    foreign key (equipment_id, farm_id)
    references public.equipment(id, farm_id)
    on delete cascade,
  constraint equipment_service_log_interval_same_farm_fk
    foreign key (interval_id, farm_id)
    references public.equipment_service_intervals(id, farm_id)
    on delete set null (interval_id)
);

create table public.farm_tasks (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 500),
  details text check (details is null or length(btrim(details)) between 1 and 10000),
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  priority text not null default 'normal' check (priority in ('normal', 'high', 'urgent')),
  assigned_to uuid references auth.users(id) on delete set null,
  due_on date,
  field_id uuid,
  equipment_id uuid,
  source text not null default 'manual' check (source in ('manual', 'service_interval')),
  interval_id uuid,
  interval_cycle_key text check (
    interval_cycle_key is null
    or length(btrim(interval_cycle_key)) between 1 and 240
  ),
  completed_by uuid references auth.users(id) on delete restrict,
  completed_at timestamptz,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint farm_tasks_completion_fields check (
    (status = 'done' and completed_by is not null and completed_at is not null)
    or (status <> 'done' and completed_by is null and completed_at is null)
  ),
  constraint farm_tasks_field_same_farm_fk
    foreign key (field_id, farm_id)
    references public.fields(id, farm_id)
    on delete set null (field_id),
  constraint farm_tasks_equipment_same_farm_fk
    foreign key (equipment_id, farm_id)
    references public.equipment(id, farm_id)
    on delete set null (equipment_id),
  constraint farm_tasks_interval_same_farm_fk
    foreign key (interval_id, farm_id)
    references public.equipment_service_intervals(id, farm_id)
    on delete set null (interval_id)
);

create unique index farm_tasks_auto_interval_cycle_idx
  on public.farm_tasks (farm_id, interval_id, interval_cycle_key)
  where interval_cycle_key is not null;

create index equipment_farm_category_idx
  on public.equipment (farm_id, category, status);
create index equipment_meter_readings_latest_idx
  on public.equipment_meter_readings (equipment_id, farm_id, read_on desc, created_at desc);
create index equipment_service_intervals_equipment_idx
  on public.equipment_service_intervals (equipment_id, farm_id, is_active);
create index equipment_service_log_equipment_date_idx
  on public.equipment_service_log (equipment_id, farm_id, service_date desc);
create index farm_tasks_farm_status_due_idx
  on public.farm_tasks (farm_id, status, due_on);
create index farm_tasks_assignee_status_idx
  on public.farm_tasks (farm_id, assigned_to, status);

-- Completion identity and time are server-owned. Client-supplied values are
-- ignored on insert, on entry into done, while remaining done, and on reopen.
create function public.stamp_farm_task_completion()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.status = 'done' then
    if tg_op = 'INSERT' then
      if auth.uid() is null then
        raise exception 'you must be signed in to complete a task';
      end if;
      new.completed_by := auth.uid();
      new.completed_at := now();
    elsif old.status <> 'done' then
      if auth.uid() is null then
        raise exception 'you must be signed in to complete a task';
      end if;
      new.completed_by := auth.uid();
      new.completed_at := now();
    else
      new.completed_by := old.completed_by;
      new.completed_at := old.completed_at;
    end if;
  else
    new.completed_by := null;
    new.completed_at := null;
  end if;

  return new;
end;
$$;

-- Interval definitions remain owner/manager-only under RLS. This trigger is
-- the narrow worker-safe exception: a successfully inserted, immutable service
-- log can stamp only its own linked interval, in the same transaction.
create function public.stamp_service_interval_from_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_every_meter numeric;
  v_interval_equipment_id uuid;
begin
  if new.interval_id is null then
    return new;
  end if;
  if auth.uid() is null or not exists (
    select 1
    from public.farm_memberships fm
    where fm.farm_id = new.farm_id
      and fm.user_id = auth.uid()
      and fm.status = 'active'
  ) then
    raise exception 'you must be an active member of this farm to complete a service interval';
  end if;

  select i.every_meter, i.equipment_id
    into v_every_meter, v_interval_equipment_id
  from public.equipment_service_intervals i
  where i.id = new.interval_id
    and i.farm_id = new.farm_id
  for update;

  if not found then
    raise exception 'service interval must belong to this farm';
  end if;
  if v_interval_equipment_id <> new.equipment_id then
    raise exception 'service interval must belong to the selected equipment';
  end if;
  if v_every_meter is not null and new.meter_reading is null then
    raise exception 'a meter reading is required to complete a meter-based interval';
  end if;

  update public.equipment_service_intervals
  set last_done_on = new.service_date,
      last_done_reading = coalesce(new.meter_reading, last_done_reading)
  where id = new.interval_id
    and farm_id = new.farm_id;

  return new;
end;
$$;

-- The assignee check is a trigger, rather than only a UI check, so queued and
-- direct writes cannot assign work to an outsider or inactive former member.
create function public.validate_farm_task_assignee()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if new.assigned_to is not null and not exists (
    select 1
    from public.farm_memberships fm
    where fm.farm_id = new.farm_id
      and fm.user_id = new.assigned_to
      and fm.status = 'active'
  ) then
    raise exception 'task assignee must be an active member of this farm';
  end if;

  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'equipment',
    'equipment_meter_readings',
    'equipment_service_intervals',
    'equipment_service_log',
    'farm_tasks'
  ]
  loop
    execute format(
      'create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'equipment',
    'equipment_meter_readings',
    'equipment_service_intervals',
    'equipment_service_log',
    'farm_tasks'
  ]
  loop
    execute format(
      'create trigger %I_prevent_farm_move before update on public.%I for each row execute function public.prevent_farm_id_change()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

create trigger farm_tasks_stamp_completion
before insert or update on public.farm_tasks
for each row execute function public.stamp_farm_task_completion();

create trigger farm_tasks_validate_assignee
before insert or update of farm_id, assigned_to on public.farm_tasks
for each row execute function public.validate_farm_task_assignee();

create trigger equipment_service_log_stamp_interval
after insert on public.equipment_service_log
for each row execute function public.stamp_service_interval_from_log();

-- SECURITY INVOKER makes every base-table read obey the caller's RLS. The view
-- therefore cannot expose equipment, intervals, or readings from another farm.
create view public.equipment_service_due
with (security_invoker = true)
as
select
  e.farm_id,
  e.id as equipment_id,
  i.id as interval_id,
  'meter'::text as reason,
  (latest.reading - coalesce(i.last_done_reading, 0) - i.every_meter)::numeric
    as overdue_amount
from public.equipment_service_intervals i
join public.equipment e
  on e.id = i.equipment_id
 and e.farm_id = i.farm_id
join lateral (
  select r.reading
  from public.equipment_meter_readings r
  where r.equipment_id = e.id
    and r.farm_id = e.farm_id
  order by r.read_on desc, r.created_at desc, r.id desc
  limit 1
) latest on true
where i.is_active
  and e.status = 'active'
  and i.every_meter is not null
  and latest.reading - coalesce(i.last_done_reading, 0) >= i.every_meter
union all
select
  e.farm_id,
  e.id as equipment_id,
  i.id as interval_id,
  'calendar'::text as reason,
  (
    current_date
    - (
        coalesce(i.last_done_on, e.created_at::date)
        + make_interval(months => i.every_months)
      )::date
  )::numeric as overdue_amount
from public.equipment_service_intervals i
join public.equipment e
  on e.id = i.equipment_id
 and e.farm_id = i.farm_id
where i.is_active
  and e.status = 'active'
  and i.every_months is not null
  and coalesce(i.last_done_on, e.created_at::date)
      + make_interval(months => i.every_months) <= current_date;

-- This narrowly scoped SECURITY DEFINER helper is the only auth.users access.
-- It returns a name only when caller and target share an active farm, preventing
-- direct calls from becoming an email-directory probe. Only the email local-part
-- is returned; the full address is never exposed.
create function public.get_member_display_name(target_user_id uuid)
returns text
language sql
stable
security definer
set search_path = public, auth, pg_temp
as $$
  select coalesce(nullif(split_part(u.email, '@', 1), ''), 'Farm member')
  from auth.users u
  where u.id = target_user_id
    and auth.uid() is not null
    and exists (
      select 1
      from public.farm_memberships caller_membership
      join public.farm_memberships target_membership
        on target_membership.farm_id = caller_membership.farm_id
       and target_membership.user_id = target_user_id
       and target_membership.status = 'active'
      where caller_membership.user_id = auth.uid()
        and caller_membership.status = 'active'
    );
$$;

-- The view is SECURITY INVOKER and explicitly filters memberships through the
-- active-member helper. It exposes no auth schema column and cannot list another
-- farm's members even though the display-name helper has narrow definer rights.
create view public.farm_member_names
with (security_invoker = true)
as
select
  fm.farm_id,
  fm.user_id,
  public.get_member_display_name(fm.user_id) as display_name
from public.farm_memberships fm
where fm.status = 'active'
  and public.is_active_farm_member(fm.farm_id);

-- Generates at most one row for each due interval/reason cycle. Marking a task
-- done preserves the unique cycle key; deleting it may allow regeneration in
-- the same cycle, which is the accepted v1 behavior documented in the design.
create function public.generate_due_service_tasks(p_farm_id uuid)
returns jsonb
language plpgsql
security invoker
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

  return jsonb_build_object('created_count', v_created_count);
end;
$$;

-- One call writes the service log, optional service-origin meter reading, and
-- optional interval completion in the function call's single transaction.
-- p_reading_id is required when meter_reading is present so offline replay can
-- address and confirm the exact canonical reading row.
create function public.save_service_log_entry(
  p_farm_id uuid,
  p_log jsonb,
  p_reading_id uuid default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_log_id uuid;
  v_equipment_id uuid;
  v_service_date date;
  v_work_performed text;
  v_parts text;
  v_vendor text;
  v_cost numeric;
  v_meter_reading numeric;
  v_interval_id uuid;
  v_log public.equipment_service_log%rowtype;
  v_reading public.equipment_meter_readings%rowtype;
  v_interval public.equipment_service_intervals%rowtype;
  v_existing_log boolean := false;
  v_existing_reading boolean := false;
  v_log_json jsonb;
  v_reading_json jsonb := null;
  v_interval_json jsonb := null;
begin
  if v_caller is null then
    raise exception 'you must be signed in to save a service entry';
  end if;
  if p_farm_id is null then
    raise exception 'farm is required to save a service entry';
  end if;
  if not public.is_active_farm_member(p_farm_id) then
    raise exception 'you must be an active member of this farm to save a service entry';
  end if;
  if jsonb_typeof(p_log) is distinct from 'object' then
    raise exception 'service entry must be a JSON object';
  end if;
  if (select count(*) from jsonb_object_keys(p_log)) <> 9
    or exists (
      select 1
      from jsonb_object_keys(p_log) as k(key)
      where k.key not in (
        'id', 'equipment_id', 'service_date', 'work_performed', 'parts',
        'vendor', 'cost', 'meter_reading', 'interval_id'
      )
    )
  then
    raise exception 'service entry keys do not match the accepted contract';
  end if;
  if jsonb_typeof(p_log -> 'id') is distinct from 'string'
    or jsonb_typeof(p_log -> 'equipment_id') is distinct from 'string'
    or jsonb_typeof(p_log -> 'service_date') is distinct from 'string'
    or jsonb_typeof(p_log -> 'work_performed') is distinct from 'string'
    or coalesce(jsonb_typeof(p_log -> 'parts'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_log -> 'vendor'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_log -> 'cost'), 'null') not in ('number', 'null')
    or coalesce(jsonb_typeof(p_log -> 'meter_reading'), 'null') not in ('number', 'null')
    or coalesce(jsonb_typeof(p_log -> 'interval_id'), 'null') not in ('string', 'null')
  then
    raise exception 'service entry fields have invalid JSON types';
  end if;

  begin
    v_log_id := (p_log ->> 'id')::uuid;
    v_equipment_id := (p_log ->> 'equipment_id')::uuid;
    v_service_date := (p_log ->> 'service_date')::date;
    v_interval_id := nullif(p_log ->> 'interval_id', '')::uuid;
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception 'service entry IDs and date must be valid';
  end;

  v_work_performed := p_log ->> 'work_performed';
  v_parts := p_log ->> 'parts';
  v_vendor := p_log ->> 'vendor';
  v_cost := (p_log ->> 'cost')::numeric;
  v_meter_reading := (p_log ->> 'meter_reading')::numeric;

  if length(btrim(v_work_performed)) not between 1 and 10000 then
    raise exception 'work performed must be between 1 and 10000 characters';
  end if;
  if v_parts is not null and length(btrim(v_parts)) not between 1 and 10000 then
    raise exception 'parts must be between 1 and 10000 characters when provided';
  end if;
  if v_vendor is not null and length(btrim(v_vendor)) not between 1 and 200 then
    raise exception 'vendor must be between 1 and 200 characters when provided';
  end if;
  if v_cost is not null and v_cost < 0 then
    raise exception 'service cost cannot be negative';
  end if;
  if v_meter_reading is not null and v_meter_reading < 0 then
    raise exception 'service meter reading cannot be negative';
  end if;
  if v_meter_reading is not null and p_reading_id is null then
    raise exception 'meter reading ID is required when a service meter reading is provided';
  end if;
  if v_meter_reading is null and p_reading_id is not null then
    raise exception 'meter reading ID is allowed only when a service meter reading is provided';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_farm_id::text, 0));

  perform 1
  from public.equipment e
  where e.id = v_equipment_id
    and e.farm_id = p_farm_id;
  if not found then
    raise exception 'equipment must belong to this farm';
  end if;

  if v_interval_id is not null then
    select i.id, i.farm_id, i.equipment_id, i.name, i.every_meter,
      i.every_months, i.last_done_on, i.last_done_reading, i.is_active,
      i.created_by, i.created_at, i.updated_at
    into v_interval
    from public.equipment_service_intervals i
    where i.id = v_interval_id
      and i.farm_id = p_farm_id
    for update;

    if not found then
      raise exception 'service interval must belong to this farm';
    end if;
    if v_interval.equipment_id <> v_equipment_id then
      raise exception 'service interval must belong to the selected equipment';
    end if;
    if v_interval.every_meter is not null and v_meter_reading is null then
      raise exception 'a meter reading is required to complete a meter-based interval';
    end if;
  end if;

  select l.id, l.farm_id, l.equipment_id, l.service_date, l.work_performed,
    l.parts, l.vendor, l.cost, l.meter_reading, l.interval_id, l.created_by,
    l.created_at, l.updated_at
  into v_log
  from public.equipment_service_log l
  where l.id = v_log_id
  for update;
  v_existing_log := found;

  if v_existing_log then
    if v_log.farm_id is distinct from p_farm_id
      or v_log.equipment_id is distinct from v_equipment_id
      or v_log.service_date is distinct from v_service_date
      or v_log.work_performed is distinct from v_work_performed
      or v_log.parts is distinct from v_parts
      or v_log.vendor is distinct from v_vendor
      or v_log.cost is distinct from v_cost
      or v_log.meter_reading is distinct from v_meter_reading
      or v_log.interval_id is distinct from v_interval_id
      or v_log.created_by is distinct from v_caller
    then
      raise exception 'service entry replay does not match stored history';
    end if;
  else
    insert into public.equipment_service_log (
      id, farm_id, equipment_id, service_date, work_performed, parts, vendor,
      cost, meter_reading, interval_id, created_by
    ) values (
      v_log_id, p_farm_id, v_equipment_id, v_service_date, v_work_performed,
      v_parts, v_vendor, v_cost, v_meter_reading, v_interval_id, v_caller
    )
    returning id, farm_id, equipment_id, service_date, work_performed, parts,
      vendor, cost, meter_reading, interval_id, created_by, created_at, updated_at
    into v_log;
  end if;

  if v_meter_reading is not null then
    select r.id, r.farm_id, r.equipment_id, r.reading, r.read_on, r.source,
      r.notes, r.created_by, r.created_at, r.updated_at
    into v_reading
    from public.equipment_meter_readings r
    where r.id = p_reading_id
    for update;
    v_existing_reading := found;

    if v_existing_reading then
      if v_reading.farm_id is distinct from p_farm_id
        or v_reading.equipment_id is distinct from v_equipment_id
        or v_reading.reading is distinct from v_meter_reading
        or v_reading.read_on is distinct from v_service_date
        or v_reading.source is distinct from 'service'
        or v_reading.notes is not null
        or v_reading.created_by is distinct from v_caller
      then
        raise exception 'service meter reading replay does not match stored history';
      end if;
    else
      insert into public.equipment_meter_readings (
        id, farm_id, equipment_id, reading, read_on, source, notes, created_by
      ) values (
        p_reading_id, p_farm_id, v_equipment_id, v_meter_reading,
        v_service_date, 'service', null, v_caller
      )
      returning id, farm_id, equipment_id, reading, read_on, source, notes,
        created_by, created_at, updated_at
      into v_reading;
    end if;
  end if;

  if v_interval_id is not null then
    select i.id, i.farm_id, i.equipment_id, i.name, i.every_meter,
      i.every_months, i.last_done_on, i.last_done_reading, i.is_active,
      i.created_by, i.created_at, i.updated_at
    into v_interval
    from public.equipment_service_intervals i
    where i.id = v_interval_id
      and i.farm_id = p_farm_id;
  end if;

  v_log_json := jsonb_build_object(
    'id', v_log.id,
    'farm_id', v_log.farm_id,
    'equipment_id', v_log.equipment_id,
    'service_date', v_log.service_date,
    'work_performed', v_log.work_performed,
    'parts', v_log.parts,
    'vendor', v_log.vendor,
    'cost', v_log.cost,
    'meter_reading', v_log.meter_reading,
    'interval_id', v_log.interval_id,
    'created_by', v_log.created_by,
    'created_at', v_log.created_at,
    'updated_at', v_log.updated_at
  );

  if v_meter_reading is not null then
    v_reading_json := jsonb_build_object(
      'id', v_reading.id,
      'farm_id', v_reading.farm_id,
      'equipment_id', v_reading.equipment_id,
      'reading', v_reading.reading,
      'read_on', v_reading.read_on,
      'source', v_reading.source,
      'notes', v_reading.notes,
      'created_by', v_reading.created_by,
      'created_at', v_reading.created_at,
      'updated_at', v_reading.updated_at
    );
  end if;

  if v_interval_id is not null then
    v_interval_json := jsonb_build_object(
      'id', v_interval.id,
      'farm_id', v_interval.farm_id,
      'equipment_id', v_interval.equipment_id,
      'name', v_interval.name,
      'every_meter', v_interval.every_meter,
      'every_months', v_interval.every_months,
      'last_done_on', v_interval.last_done_on,
      'last_done_reading', v_interval.last_done_reading,
      'is_active', v_interval.is_active,
      'created_by', v_interval.created_by,
      'created_at', v_interval.created_at,
      'updated_at', v_interval.updated_at
    );
  end if;

  return jsonb_build_object(
    'log', v_log_json,
    'reading', v_reading_json,
    'interval', v_interval_json
  );
end;
$$;

alter table public.equipment enable row level security;
alter table public.equipment_meter_readings enable row level security;
alter table public.equipment_service_intervals enable row level security;
alter table public.equipment_service_log enable row level security;
alter table public.farm_tasks enable row level security;

revoke all on table public.equipment from anon;
revoke all on table public.equipment_meter_readings from anon;
revoke all on table public.equipment_service_intervals from anon;
revoke all on table public.equipment_service_log from anon;
revoke all on table public.farm_tasks from anon;
revoke all on table public.equipment_service_due from anon;
revoke all on table public.farm_member_names from anon;

grant select, insert, update, delete on table public.equipment to authenticated;
grant select, insert, delete on table public.equipment_meter_readings to authenticated;
grant select, insert, update, delete on table public.equipment_service_intervals to authenticated;
grant select, insert, delete on table public.equipment_service_log to authenticated;
grant select, insert, update, delete on table public.farm_tasks to authenticated;
grant select on table public.equipment_service_due to authenticated;
grant select on table public.farm_member_names to authenticated;

create policy equipment_select
on public.equipment for select to authenticated
using (public.is_active_farm_member(farm_id));

create policy equipment_insert
on public.equipment for insert to authenticated
with check (public.can_manage_farm(farm_id) and created_by = auth.uid());

create policy equipment_update
on public.equipment for update to authenticated
using (public.can_manage_farm(farm_id))
with check (public.can_manage_farm(farm_id));

create policy equipment_delete
on public.equipment for delete to authenticated
using (public.can_manage_farm(farm_id));

create policy equipment_meter_readings_select
on public.equipment_meter_readings for select to authenticated
using (public.is_active_farm_member(farm_id));

create policy equipment_meter_readings_insert
on public.equipment_meter_readings for insert to authenticated
with check (public.is_active_farm_member(farm_id) and created_by = auth.uid());

create policy equipment_meter_readings_delete
on public.equipment_meter_readings for delete to authenticated
using (public.can_manage_farm(farm_id));

create policy equipment_service_intervals_select
on public.equipment_service_intervals for select to authenticated
using (public.is_active_farm_member(farm_id));

create policy equipment_service_intervals_insert
on public.equipment_service_intervals for insert to authenticated
with check (public.can_manage_farm(farm_id) and created_by = auth.uid());

create policy equipment_service_intervals_update
on public.equipment_service_intervals for update to authenticated
using (public.can_manage_farm(farm_id))
with check (public.can_manage_farm(farm_id));

create policy equipment_service_intervals_delete
on public.equipment_service_intervals for delete to authenticated
using (public.can_manage_farm(farm_id));

create policy equipment_service_log_select
on public.equipment_service_log for select to authenticated
using (public.is_active_farm_member(farm_id));

create policy equipment_service_log_insert
on public.equipment_service_log for insert to authenticated
with check (public.is_active_farm_member(farm_id) and created_by = auth.uid());

create policy equipment_service_log_delete
on public.equipment_service_log for delete to authenticated
using (public.can_manage_farm(farm_id));

create policy farm_tasks_select
on public.farm_tasks for select to authenticated
using (public.is_active_farm_member(farm_id));

create policy farm_tasks_insert
on public.farm_tasks for insert to authenticated
with check (public.is_active_farm_member(farm_id) and created_by = auth.uid());

create policy farm_tasks_update
on public.farm_tasks for update to authenticated
using (public.is_active_farm_member(farm_id))
with check (public.is_active_farm_member(farm_id));

create policy farm_tasks_delete
on public.farm_tasks for delete to authenticated
using (public.can_manage_farm(farm_id));

revoke all on function public.stamp_farm_task_completion() from public, anon, authenticated;
revoke all on function public.validate_farm_task_assignee() from public, anon, authenticated;
revoke all on function public.stamp_service_interval_from_log() from public, anon, authenticated;
revoke all on function public.get_member_display_name(uuid) from public, anon, authenticated;
revoke all on function public.generate_due_service_tasks(uuid) from public, anon, authenticated;
revoke all on function public.save_service_log_entry(uuid, jsonb, uuid)
  from public, anon, authenticated;

grant execute on function public.stamp_farm_task_completion() to authenticated;
grant execute on function public.validate_farm_task_assignee() to authenticated;
grant execute on function public.stamp_service_interval_from_log() to authenticated;
grant execute on function public.get_member_display_name(uuid) to authenticated;
grant execute on function public.generate_due_service_tasks(uuid) to authenticated;
grant execute on function public.save_service_log_entry(uuid, jsonb, uuid) to authenticated;

-- Reviewer test section -- DO NOT RUN; fixtures are intentionally unconfigured.
-- Run only in a disposable review transaction after replacing every placeholder.
-- Manual checks: owner/manager equipment and interval writes; worker rejection
-- for those writes; active-member reading/log/task writes; no reading/log UPDATE;
-- owner/manager-only deletes; cross-farm equipment/field/interval/assignee rejection;
-- inactive assignee rejection; done stamps ignore client values and reopen clears
-- both stamps; due-view meter/calendar math including never-serviced intervals;
-- both views hide other farms; display-name helper cannot probe unrelated UUIDs;
-- generate called twice creates zero rows on the second call; completed auto-task
-- does not regenerate; deleted auto-task may regenerate; concurrent generation;
-- service RPC rollback after a bad interval; exact replay; divergent replay;
-- optional reading and interval null echoes; meter-based interval requires reading;
-- backwards readings remain accepted; full anonymous denial.
--
-- begin;
-- set local role authenticated;
-- do $review_test$
-- begin
--   raise exception '0016 reviewer fixtures are intentionally not configured';
-- end
-- $review_test$;
-- rollback;
