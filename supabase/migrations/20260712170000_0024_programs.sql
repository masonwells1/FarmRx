-- DRAFT ONLY -- Programs schema, read models, and receipt-idempotent RPCs.
-- Designed after migration 0023. DO NOT APPLY without separate owner approval.
-- All SECURITY DEFINER paths use fixed search paths, farm-scoped predicates,
-- advisory transaction locks, and deliberately avoid SELECT ... FOR UPDATE.

create table public.programs (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 160),
  program_kind text check (program_kind is null or program_kind in (
    'chemical', 'fertility', 'fungicide', 'other'
  )),
  commodity_id text references public.commodities(id) on delete restrict,
  crop_year integer check (crop_year is null or crop_year between 1900 and 2200),
  notes text check (notes is null or char_length(notes) <= 4000),
  revision integer not null default 1 check (revision >= 1),
  is_archived boolean not null default false,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id)
);

create table public.program_passes (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  program_id uuid not null,
  sequence smallint not null check (sequence >= 1),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  pass_type text not null check (pass_type in (
    'pre', 'post', 'fungicide', 'planter_fertility', 'custom'
  )),
  activity_type text not null check (activity_type in ('spray', 'fertility', 'other')),
  timing_label text check (timing_label is null or char_length(timing_label) <= 160),
  target_date date,
  planting_offset_days smallint check (
    planting_offset_days is null or planting_offset_days between -120 and 365
  ),
  reminder_lead_days smallint not null default 3 check (reminder_lead_days between 0 and 60),
  notes text check (notes is null or char_length(notes) <= 2000),
  is_archived boolean not null default false,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint program_passes_program_same_farm_fk
    foreign key (program_id, farm_id)
    references public.programs(id, farm_id)
    on delete restrict,
  constraint program_passes_date_mode_check check (
    target_date is null or planting_offset_days is null
  )
);

create table public.program_pass_products (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  program_pass_id uuid not null,
  sequence smallint not null check (sequence >= 1),
  product_name text not null check (char_length(btrim(product_name)) between 1 and 200),
  rate_text text not null check (char_length(btrim(rate_text)) between 1 and 80),
  unit_text text not null check (char_length(btrim(unit_text)) between 1 and 80),
  estimated_cost_per_acre numeric(14,4)
    check (estimated_cost_per_acre is null or estimated_cost_per_acre >= 0),
  catalog_product_id uuid,
  notes text check (notes is null or char_length(notes) <= 1000),
  is_archived boolean not null default false,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint program_pass_products_pass_same_farm_fk
    foreign key (program_pass_id, farm_id)
    references public.program_passes(id, farm_id)
    on delete restrict,
  constraint program_pass_products_catalog_same_farm_fk
    foreign key (catalog_product_id, farm_id)
    references public.inventory_products(id, farm_id)
    on delete restrict
);

create table public.program_assignments (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  program_id uuid not null,
  crop_assignment_id uuid not null,
  program_name_snapshot text not null
    check (char_length(btrim(program_name_snapshot)) between 1 and 160),
  program_kind_snapshot text check (
    program_kind_snapshot is null or program_kind_snapshot in (
      'chemical', 'fertility', 'fungicide', 'other'
    )
  ),
  status text not null default 'active' check (status in ('active', 'archived')),
  template_revision integer not null check (template_revision >= 1),
  assigned_by uuid not null,
  assigned_at timestamptz not null default now(),
  archived_by uuid,
  archived_at timestamptz,
  archive_reason text check (archive_reason is null or char_length(btrim(archive_reason)) between 1 and 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint program_assignments_program_same_farm_fk
    foreign key (program_id, farm_id)
    references public.programs(id, farm_id)
    on delete restrict,
  constraint program_assignments_crop_same_farm_fk
    foreign key (crop_assignment_id, farm_id)
    references public.crop_assignments(id, farm_id)
    on delete restrict,
  constraint program_assignments_archive_state_check check (
    (status = 'active' and archived_by is null and archived_at is null and archive_reason is null)
    or
    (status = 'archived' and archived_by is not null and archived_at is not null
      and archive_reason is not null)
  )
);

create table public.assigned_program_passes (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  assignment_id uuid not null,
  source_program_pass_id uuid,
  source_revision integer not null check (source_revision >= 1),
  sequence smallint not null check (sequence >= 1),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  pass_type text not null check (pass_type in (
    'pre', 'post', 'fungicide', 'planter_fertility', 'custom'
  )),
  activity_type text not null check (activity_type in ('spray', 'fertility', 'other')),
  timing_label text check (timing_label is null or char_length(timing_label) <= 160),
  target_date date,
  planting_offset_days smallint check (
    planting_offset_days is null or planting_offset_days between -120 and 365
  ),
  reminder_lead_days smallint not null check (reminder_lead_days between 0 and 60),
  notes text check (notes is null or char_length(notes) <= 2000),
  due_on date,
  due_source text not null check (due_source in (
    'template_date', 'planting_offset', 'manual', 'unscheduled'
  )),
  is_field_override boolean not null default false,
  status text not null default 'planned' check (status in (
    'planned', 'applied', 'skipped', 'cancelled'
  )),
  applied_on date,
  applied_acres numeric(12,2) check (applied_acres is null or applied_acres > 0),
  skipped_on date,
  skip_reason text check (skip_reason is null or char_length(btrim(skip_reason)) between 1 and 1000),
  cancelled_at timestamptz,
  cancel_reason text check (cancel_reason is null or char_length(btrim(cancel_reason)) between 1 and 1000),
  application_record_id uuid,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  unique (application_record_id),
  constraint assigned_program_passes_assignment_same_farm_fk
    foreign key (assignment_id, farm_id)
    references public.program_assignments(id, farm_id)
    on delete restrict,
  constraint assigned_program_passes_source_same_farm_fk
    foreign key (source_program_pass_id, farm_id)
    references public.program_passes(id, farm_id)
    on delete set null (source_program_pass_id),
  constraint assigned_program_passes_application_same_farm_fk
    foreign key (application_record_id, farm_id)
    references public.application_records(id, farm_id)
    on delete restrict,
  constraint assigned_program_passes_date_mode_check check (
    target_date is null or planting_offset_days is null
  ),
  constraint assigned_program_passes_due_state_check check (
    (due_source = 'template_date' and due_on is not null and target_date is not null)
    or (due_source = 'planting_offset' and planting_offset_days is not null)
    or (due_source = 'manual' and due_on is not null and is_field_override)
    or (due_source = 'unscheduled' and due_on is null)
  ),
  constraint assigned_program_passes_state_check check (
    (status = 'planned'
      and applied_on is null and applied_acres is null and application_record_id is null
      and skipped_on is null and skip_reason is null
      and cancelled_at is null and cancel_reason is null)
    or
    (status = 'applied'
      and applied_on is not null and applied_acres is not null
      and skipped_on is null and skip_reason is null
      and cancelled_at is null and cancel_reason is null)
    or
    (status = 'skipped'
      and applied_on is null and applied_acres is null and application_record_id is null
      and skipped_on is not null and skip_reason is not null
      and cancelled_at is null and cancel_reason is null)
    or
    (status = 'cancelled'
      and applied_on is null and applied_acres is null and application_record_id is null
      and skipped_on is null and skip_reason is null
      and cancelled_at is not null and cancel_reason is not null)
  )
);

create table public.assigned_program_pass_products (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  assigned_pass_id uuid not null,
  source_program_pass_product_id uuid,
  sequence smallint not null check (sequence >= 1),
  product_name text not null check (char_length(btrim(product_name)) between 1 and 200),
  rate_text text not null check (char_length(btrim(rate_text)) between 1 and 80),
  unit_text text not null check (char_length(btrim(unit_text)) between 1 and 80),
  estimated_cost_per_acre numeric(14,4)
    check (estimated_cost_per_acre is null or estimated_cost_per_acre >= 0),
  catalog_product_id uuid,
  notes text check (notes is null or char_length(notes) <= 1000),
  is_active boolean not null default true,
  actual_product_name text
    check (actual_product_name is null or char_length(btrim(actual_product_name)) between 1 and 200),
  actual_rate_text text
    check (actual_rate_text is null or char_length(btrim(actual_rate_text)) between 1 and 80),
  actual_unit_text text
    check (actual_unit_text is null or char_length(btrim(actual_unit_text)) between 1 and 80),
  actual_cost_per_acre numeric(14,4)
    check (actual_cost_per_acre is null or actual_cost_per_acre >= 0),
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint assigned_program_products_pass_same_farm_fk
    foreign key (assigned_pass_id, farm_id)
    references public.assigned_program_passes(id, farm_id)
    on delete restrict,
  constraint assigned_program_products_source_same_farm_fk
    foreign key (source_program_pass_product_id, farm_id)
    references public.program_pass_products(id, farm_id)
    on delete set null (source_program_pass_product_id),
  constraint assigned_program_products_catalog_same_farm_fk
    foreign key (catalog_product_id, farm_id)
    references public.inventory_products(id, farm_id)
    on delete restrict,
  constraint assigned_program_products_actual_bundle_check check (
    (actual_product_name is null and actual_rate_text is null
      and actual_unit_text is null and actual_cost_per_acre is null)
    or
    (actual_product_name is not null and actual_rate_text is not null
      and actual_unit_text is not null)
  )
);

create index programs_farm_picker_idx
  on public.programs (farm_id, is_archived, crop_year, commodity_id, program_kind, name);
create unique index program_passes_active_sequence_idx
  on public.program_passes (program_id, sequence) where not is_archived;
create unique index program_pass_products_active_sequence_idx
  on public.program_pass_products (program_pass_id, sequence) where not is_archived;
create unique index program_assignments_active_same_program_idx
  on public.program_assignments (farm_id, crop_assignment_id, program_id)
  where status = 'active';
create index program_assignments_crop_status_idx
  on public.program_assignments (farm_id, crop_assignment_id, status);
create index assigned_program_passes_assignment_status_idx
  on public.assigned_program_passes (farm_id, assignment_id, status, sequence);
create index assigned_program_passes_due_idx
  on public.assigned_program_passes (farm_id, status, due_on)
  where status = 'planned' and due_on is not null;

-- Serialize every active-count decision on the exact crop. This trigger is the
-- final database guard even when a future writer bypasses the RPC contract.
create function public.guard_program_assignment_active_cap()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_active_count integer;
begin
  if new.status <> 'active'
    or (tg_op = 'UPDATE' and old.status = 'active'
      and old.crop_assignment_id = new.crop_assignment_id
      and old.farm_id = new.farm_id)
  then
    return new;
  end if;

  perform pg_advisory_xact_lock(
    hashtext(new.farm_id::text),
    hashtext(new.crop_assignment_id::text)
  );

  select count(*)
    into v_active_count
  from public.program_assignments pa
  where pa.farm_id = new.farm_id
    and pa.crop_assignment_id = new.crop_assignment_id
    and pa.status = 'active'
    and pa.id <> new.id;

  if v_active_count >= 12 then
    raise exception 'a crop assignment cannot have more than 12 active programs';
  end if;
  return new;
end;
$$;

create trigger program_assignments_active_cap
before insert or update of farm_id, crop_assignment_id, status
on public.program_assignments
for each row execute function public.guard_program_assignment_active_cap();

-- Farm equality comes from the composite FK; this trigger adds the required
-- exact crop-assignment match for linked application reality.
create function public.validate_assigned_program_application_link()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'applied' and not exists (
    select 1
    from public.program_assignments pa
    join public.crop_assignments ca
      on ca.id = pa.crop_assignment_id and ca.farm_id = pa.farm_id
    where pa.id = new.assignment_id
      and pa.farm_id = new.farm_id
      and new.applied_acres <= ca.planted_acres
  ) then
    raise exception 'applied acres cannot exceed the assigned crop acres';
  end if;
  if new.application_record_id is null then
    return new;
  end if;
  if not exists (
    select 1
    from public.application_records ar
    join public.program_assignments pa
      on pa.id = new.assignment_id and pa.farm_id = new.farm_id
    where ar.id = new.application_record_id
      and ar.farm_id = new.farm_id
      and ar.crop_assignment_id = pa.crop_assignment_id
  ) then
    raise exception 'application record must belong to this farm and crop assignment';
  end if;
  return new;
end;
$$;

create trigger assigned_program_passes_validate_application
before insert or update of farm_id, assignment_id, status, applied_acres, application_record_id
on public.assigned_program_passes
for each row execute function public.validate_assigned_program_application_link();

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'programs', 'program_passes', 'program_pass_products',
    'program_assignments', 'assigned_program_passes',
    'assigned_program_pass_products'
  ] loop
    execute format(
      'create trigger %I_prevent_farm_move before update on public.%I for each row execute function public.prevent_farm_id_change()',
      v_table, v_table
    );
    execute format(
      'create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      v_table, v_table
    );
  end loop;
end;
$$;

alter table public.farm_tasks
  drop constraint farm_tasks_source_check,
  add constraint farm_tasks_source_check check (
    source in ('manual', 'service_interval', 'scouting', 'program')
  ),
  add column program_assigned_pass_id uuid,
  add column program_cycle_key text check (
    program_cycle_key is null or char_length(btrim(program_cycle_key)) between 1 and 240
  ),
  add constraint farm_tasks_program_pass_same_farm_fk
    foreign key (program_assigned_pass_id, farm_id)
    references public.assigned_program_passes(id, farm_id)
    on delete set null (program_assigned_pass_id);

create unique index farm_tasks_program_cycle_idx
  on public.farm_tasks (farm_id, program_assigned_pass_id, program_cycle_key)
  where program_cycle_key is not null;

-- Caller must already hold the farm's program-due-items advisory lock. Terminal
-- cards are immutable history. If a terminal card already owns the target cycle,
-- it remains canonical and any obsolete open card is closed without changing key.
create function public.sync_open_program_task_due(
  p_farm_id uuid,
  p_assigned_pass_id uuid,
  p_due_on date,
  p_title text
)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_target_cycle_key text;
  v_canonical_open_id uuid;
  v_target_task public.farm_tasks%rowtype;
begin
  if p_farm_id is null or p_assigned_pass_id is null or p_title is null then
    raise exception 'farm ID, assigned pass ID, and task title are required';
  end if;

  if p_due_on is null then
    update public.farm_tasks t
    set status = 'done'
    where t.farm_id = p_farm_id
      and t.program_assigned_pass_id = p_assigned_pass_id
      and t.source = 'program'
      and t.status in ('todo', 'doing');
    return;
  end if;

  v_target_cycle_key := 'due:' || p_assigned_pass_id::text || ':' || p_due_on::text;

  select t.*
  into v_target_task
  from public.farm_tasks t
  where t.farm_id = p_farm_id
    and t.program_assigned_pass_id = p_assigned_pass_id
    and t.program_cycle_key = v_target_cycle_key;

  if found and (
    v_target_task.source <> 'program'
    or v_target_task.status not in ('todo', 'doing')
  ) then
    update public.farm_tasks t
    set status = 'done'
    where t.farm_id = p_farm_id
      and t.program_assigned_pass_id = p_assigned_pass_id
      and t.source = 'program'
      and t.status in ('todo', 'doing');
    return;
  end if;

  if found then
    v_canonical_open_id := v_target_task.id;
  else
    select t.id
    into v_canonical_open_id
    from public.farm_tasks t
    where t.farm_id = p_farm_id
      and t.program_assigned_pass_id = p_assigned_pass_id
      and t.source = 'program'
      and t.status in ('todo', 'doing')
    order by t.created_at, t.id
    limit 1;
  end if;

  if v_canonical_open_id is null then
    return;
  end if;

  update public.farm_tasks t
  set status = 'done'
  where t.farm_id = p_farm_id
    and t.program_assigned_pass_id = p_assigned_pass_id
    and t.source = 'program'
    and t.status in ('todo', 'doing')
    and t.id <> v_canonical_open_id;

  update public.farm_tasks t
  set due_on = p_due_on,
      title = left(p_title, 500),
      details = 'Program pass due ' || p_due_on::text,
      program_cycle_key = v_target_cycle_key
  where t.id = v_canonical_open_id
    and t.farm_id = p_farm_id
    and t.program_assigned_pass_id = p_assigned_pass_id
    and t.source = 'program'
    and t.status in ('todo', 'doing');
end;
$$;

revoke all on function public.sync_open_program_task_due(uuid, uuid, date, text)
  from public, anon, authenticated;

create view public.program_assignment_tracker
with (security_invoker = true)
as
select
  pa.id as assignment_id,
  pa.farm_id,
  pa.program_id,
  pa.program_name_snapshot,
  pa.program_kind_snapshot,
  pa.status as assignment_status,
  pa.template_revision,
  p.revision as current_template_revision,
  pa.crop_assignment_id,
  ca.field_id,
  f.name as field_name,
  ca.commodity_id,
  c.name as commodity_name,
  ca.crop_year,
  ca.planting_sequence,
  ca.planting_date,
  ca.planted_acres,
  coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', ap.id,
        'source_program_pass_id', ap.source_program_pass_id,
        'source_revision', ap.source_revision,
        'sequence', ap.sequence,
        'name', ap.name,
        'pass_type', ap.pass_type,
        'activity_type', ap.activity_type,
        'timing_label', ap.timing_label,
        'target_date', ap.target_date,
        'planting_offset_days', ap.planting_offset_days,
        'reminder_lead_days', ap.reminder_lead_days,
        'notes', ap.notes,
        'due_on', ap.due_on,
        'due_source', ap.due_source,
        'is_field_override', ap.is_field_override,
        'status', ap.status,
        'applied_on', ap.applied_on,
        'applied_acres', ap.applied_acres,
        'skipped_on', ap.skipped_on,
        'skip_reason', ap.skip_reason,
        'cancelled_at', ap.cancelled_at,
        'cancel_reason', ap.cancel_reason,
        'application_record_id', ap.application_record_id,
        'products', coalesce((
          select jsonb_agg(to_jsonb(app) order by app.sequence, app.id)
          from public.assigned_program_pass_products app
          where app.farm_id = ap.farm_id
            and app.assigned_pass_id = ap.id
            and app.is_active
        ), '[]'::jsonb),
        'tasks', coalesce((
          select jsonb_agg(to_jsonb(t) order by t.created_at, t.id)
          from public.farm_tasks t
          where t.farm_id = ap.farm_id
            and t.program_assigned_pass_id = ap.id
        ), '[]'::jsonb)
      ) order by ap.sequence, ap.id
    )
    from public.assigned_program_passes ap
    where ap.farm_id = pa.farm_id
      and ap.assignment_id = pa.id
  ), '[]'::jsonb) as passes
from public.program_assignments pa
join public.programs p
  on p.id = pa.program_id and p.farm_id = pa.farm_id
join public.crop_assignments ca
  on ca.id = pa.crop_assignment_id and ca.farm_id = pa.farm_id
join public.fields f
  on f.id = ca.field_id and f.farm_id = ca.farm_id
join public.commodities c on c.id = ca.commodity_id;

create view public.program_assignment_costs
with (security_invoker = true)
as
with line_costs as (
  select
    pa.id as assignment_id,
    pa.farm_id,
    count(app.id) filter (where ap.status <> 'cancelled') as planned_line_count,
    count(app.estimated_cost_per_acre) filter (where ap.status <> 'cancelled') as planned_cost_count,
    case
      when count(app.id) filter (where ap.status <> 'cancelled') = 0 then 0::numeric
      else sum(app.estimated_cost_per_acre) filter (where ap.status <> 'cancelled')
    end as planned_cost_sum,
    count(app.id) filter (where ap.status = 'applied') as actual_line_count,
    count(app.actual_cost_per_acre) filter (where ap.status = 'applied') as actual_cost_count,
    sum(app.actual_cost_per_acre) filter (where ap.status = 'applied') as actual_cost_sum,
    sum(app.actual_cost_per_acre * ap.applied_acres)
      filter (where ap.status = 'applied') as actual_total_sum
  from public.program_assignments pa
  left join public.assigned_program_passes ap
    on ap.assignment_id = pa.id and ap.farm_id = pa.farm_id
  left join public.assigned_program_pass_products app
    on app.assigned_pass_id = ap.id and app.farm_id = ap.farm_id and app.is_active
  group by pa.id, pa.farm_id
)
select
  pa.id as assignment_id,
  pa.farm_id,
  pa.program_id,
  pa.crop_assignment_id,
  pa.program_name_snapshot,
  pa.program_kind_snapshot,
  pa.status as assignment_status,
  ca.planted_acres,
  lc.planned_line_count = lc.planned_cost_count as planned_cost_is_complete,
  lc.planned_cost_sum::numeric as planned_cost_per_acre,
  (lc.planned_cost_sum * ca.planted_acres)::numeric as total_planned_cost,
  (lc.actual_line_count > 0 and lc.actual_line_count = lc.actual_cost_count)
    as actual_cost_is_complete,
  case
    when lc.actual_line_count > 0 and lc.actual_line_count = lc.actual_cost_count
      then lc.actual_cost_sum::numeric
    else null::numeric
  end as actual_cost_per_acre,
  case
    when lc.actual_line_count > 0 and lc.actual_line_count = lc.actual_cost_count
      then lc.actual_total_sum
    else null::numeric
  end as total_actual_cost
from public.program_assignments pa
join public.crop_assignments ca
  on ca.id = pa.crop_assignment_id and ca.farm_id = pa.farm_id
join line_costs lc
  on lc.assignment_id = pa.id and lc.farm_id = pa.farm_id;

create view public.program_crop_cost_rollups
with (security_invoker = true)
as
select
  pac.farm_id,
  pac.crop_assignment_id,
  max(pac.planted_acres)::numeric as planted_acres,
  bool_and(pac.planned_cost_is_complete) as planned_cost_is_complete,
  case when bool_and(pac.planned_cost_is_complete)
    then sum(pac.planned_cost_per_acre)::numeric else null::numeric end
    as planned_cost_per_acre,
  case when bool_and(pac.planned_cost_is_complete)
    then sum(pac.total_planned_cost)::numeric else null::numeric end
    as total_planned_cost,
  bool_and(pac.actual_cost_is_complete) as actual_cost_is_complete,
  case when bool_and(pac.actual_cost_is_complete)
    then sum(pac.actual_cost_per_acre)::numeric else null::numeric end
    as actual_cost_per_acre,
  case when bool_and(pac.actual_cost_is_complete)
    then sum(pac.total_actual_cost)::numeric else null::numeric end
    as total_actual_cost,
  jsonb_agg(
    jsonb_build_object(
      'assignment_id', pac.assignment_id,
      'program_id', pac.program_id,
      'program_name', pac.program_name_snapshot,
      'program_kind', pac.program_kind_snapshot,
      'planned_cost_per_acre', pac.planned_cost_per_acre,
      'planned_cost_is_complete', pac.planned_cost_is_complete,
      'actual_cost_per_acre', pac.actual_cost_per_acre,
      'actual_cost_is_complete', pac.actual_cost_is_complete
    ) order by pac.program_name_snapshot, pac.assignment_id
  ) as included_programs,
  (
    select jsonb_object_agg(kind, subtotal order by kind)
    from (
      select
        coalesce(pac2.program_kind_snapshot, 'other') as kind,
        jsonb_build_object(
          'planned_cost_is_complete', bool_and(pac2.planned_cost_is_complete),
          'planned_cost_per_acre', case when bool_and(pac2.planned_cost_is_complete)
            then sum(pac2.planned_cost_per_acre)::numeric else null::numeric end,
          'total_planned_cost', case when bool_and(pac2.planned_cost_is_complete)
            then sum(pac2.total_planned_cost)::numeric else null::numeric end,
          'actual_cost_is_complete', bool_and(pac2.actual_cost_is_complete),
          'actual_cost_per_acre', case when bool_and(pac2.actual_cost_is_complete)
            then sum(pac2.actual_cost_per_acre)::numeric else null::numeric end,
          'total_actual_cost', case when bool_and(pac2.actual_cost_is_complete)
            then sum(pac2.total_actual_cost)::numeric else null::numeric end
        ) as subtotal
      from public.program_assignment_costs pac2
      where pac2.farm_id = pac.farm_id
        and pac2.crop_assignment_id = pac.crop_assignment_id
        and pac2.assignment_status = 'active'
      group by coalesce(pac2.program_kind_snapshot, 'other')
    ) category_costs
  ) as category_subtotals
from public.program_assignment_costs pac
where pac.assignment_status = 'active'
group by pac.farm_id, pac.crop_assignment_id;

create view public.program_application_products
with (security_invoker = true)
as
select
  ap.farm_id,
  ap.application_record_id,
  ap.id as assigned_pass_id,
  ap.assignment_id,
  pa.program_id,
  pa.program_name_snapshot,
  pa.program_kind_snapshot,
  pa.crop_assignment_id,
  app.id as assigned_product_id,
  app.sequence,
  app.actual_product_name,
  app.actual_rate_text,
  app.actual_unit_text,
  app.actual_cost_per_acre,
  false as inventory_matched
from public.assigned_program_passes ap
join public.program_assignments pa
  on pa.id = ap.assignment_id and pa.farm_id = ap.farm_id
join public.assigned_program_pass_products app
  on app.assigned_pass_id = ap.id and app.farm_id = ap.farm_id
where ap.application_record_id is not null
  and ap.status = 'applied'
  and app.is_active;

do $$
declare
  v_table text;
begin
  foreach v_table in array array[
    'programs', 'program_passes', 'program_pass_products',
    'program_assignments', 'assigned_program_passes',
    'assigned_program_pass_products'
  ] loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('revoke all on table public.%I from public, anon, authenticated', v_table);
    execute format('grant select on table public.%I to authenticated', v_table);

    execute format(
      'create policy %I_select on public.%I for select to authenticated using (public.can_access_farm(farm_id))',
      v_table, v_table
    );
    execute format(
      'create policy %I_update on public.%I for update to authenticated using (public.can_edit_farm(farm_id)) with check (public.can_edit_farm(farm_id))',
      v_table, v_table
    );
    execute format(
      'create policy %I_delete on public.%I for delete to authenticated using (public.can_edit_farm(farm_id))',
      v_table, v_table
    );
  end loop;
end;
$$;

create policy programs_insert on public.programs
for insert to authenticated
with check (public.can_edit_farm(farm_id) and created_by = auth.uid());
create policy program_passes_insert on public.program_passes
for insert to authenticated
with check (public.can_edit_farm(farm_id) and created_by = auth.uid());
create policy program_pass_products_insert on public.program_pass_products
for insert to authenticated
with check (public.can_edit_farm(farm_id) and created_by = auth.uid());
create policy program_assignments_insert on public.program_assignments
for insert to authenticated
with check (public.can_edit_farm(farm_id) and assigned_by = auth.uid());
create policy assigned_program_passes_insert on public.assigned_program_passes
for insert to authenticated
with check (public.can_edit_farm(farm_id) and created_by = auth.uid());
create policy assigned_program_pass_products_insert on public.assigned_program_pass_products
for insert to authenticated
with check (public.can_edit_farm(farm_id) and created_by = auth.uid());

revoke all on table
  public.program_assignment_tracker,
  public.program_assignment_costs,
  public.program_crop_cost_rollups,
  public.program_application_products
from public, anon, authenticated;
grant select on table
  public.program_assignment_tracker,
  public.program_assignment_costs,
  public.program_crop_cost_rollups,
  public.program_application_products
to authenticated;

-- Internal canonical graph helper. It is never executable by API roles.
create function public.program_assignment_graph(p_farm_id uuid, p_assignment_id uuid)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select to_jsonb(t)
  from public.program_assignment_tracker t
  where t.farm_id = p_farm_id
    and t.assignment_id = p_assignment_id
$$;

-- Internal materializer. Callers must authenticate, authorize, validate scope,
-- and hold program/crop locks before invoking it.
create function public.materialize_program_assignment(
  p_farm_id uuid,
  p_program_id uuid,
  p_crop_assignment_id uuid,
  p_caller uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_program public.programs%rowtype;
  v_crop public.crop_assignments%rowtype;
  v_assignment_id uuid := gen_random_uuid();
begin
  select p.* into v_program
  from public.programs p
  where p.id = p_program_id and p.farm_id = p_farm_id and not p.is_archived;
  if not found then raise exception 'program does not belong to this farm or is archived'; end if;

  select ca.* into v_crop
  from public.crop_assignments ca
  where ca.id = p_crop_assignment_id and ca.farm_id = p_farm_id;
  if not found then raise exception 'crop assignment does not belong to this farm'; end if;
  if v_program.commodity_id is not null and v_program.commodity_id <> v_crop.commodity_id then
    raise exception 'program commodity does not match the crop assignment';
  end if;
  if v_program.crop_year is not null and v_program.crop_year <> v_crop.crop_year then
    raise exception 'program year does not match the crop assignment';
  end if;
  if exists (
    select 1 from public.program_assignments pa
    where pa.farm_id = p_farm_id
      and pa.crop_assignment_id = p_crop_assignment_id
      and pa.program_id = p_program_id
      and pa.status = 'active'
  ) then
    raise exception 'this program is already active on the crop assignment';
  end if;

  insert into public.program_assignments (
    id, farm_id, program_id, crop_assignment_id, program_name_snapshot,
    program_kind_snapshot, status, template_revision, assigned_by
  ) values (
    v_assignment_id, p_farm_id, p_program_id, p_crop_assignment_id,
    v_program.name, v_program.program_kind, 'active', v_program.revision, p_caller
  );

  insert into public.assigned_program_passes (
    id, farm_id, assignment_id, source_program_pass_id, source_revision,
    sequence, name, pass_type, activity_type, timing_label, target_date,
    planting_offset_days, reminder_lead_days, notes, due_on, due_source,
    is_field_override, status, created_by, updated_by
  )
  select
    gen_random_uuid(), p_farm_id, v_assignment_id, pp.id, v_program.revision,
    pp.sequence, pp.name, pp.pass_type, pp.activity_type, pp.timing_label,
    pp.target_date, pp.planting_offset_days, pp.reminder_lead_days, pp.notes,
    case
      when pp.target_date is not null then pp.target_date
      when pp.planting_offset_days is not null and v_crop.planting_date is not null
        then v_crop.planting_date + pp.planting_offset_days
      else null
    end,
    case
      when pp.target_date is not null then 'template_date'
      when pp.planting_offset_days is not null and v_crop.planting_date is not null
        then 'planting_offset'
      else 'unscheduled'
    end,
    false, 'planned', p_caller, p_caller
  from public.program_passes pp
  where pp.farm_id = p_farm_id
    and pp.program_id = p_program_id
    and not pp.is_archived
  order by pp.sequence, pp.id;

  insert into public.assigned_program_pass_products (
    id, farm_id, assigned_pass_id, source_program_pass_product_id, sequence,
    product_name, rate_text, unit_text, estimated_cost_per_acre,
    catalog_product_id, notes, created_by, updated_by
  )
  select
    gen_random_uuid(), p_farm_id, ap.id, ppp.id, ppp.sequence,
    ppp.product_name, ppp.rate_text, ppp.unit_text,
    ppp.estimated_cost_per_acre, ppp.catalog_product_id, ppp.notes,
    p_caller, p_caller
  from public.assigned_program_passes ap
  join public.program_pass_products ppp
    on ppp.program_pass_id = ap.source_program_pass_id
   and ppp.farm_id = ap.farm_id
   and not ppp.is_archived
  where ap.farm_id = p_farm_id
    and ap.assignment_id = v_assignment_id
  order by ap.sequence, ppp.sequence, ppp.id;

  return v_assignment_id;
end;
$$;

revoke all on function public.guard_program_assignment_active_cap() from public, anon, authenticated;
revoke all on function public.validate_assigned_program_application_link() from public, anon, authenticated;
revoke all on function public.program_assignment_graph(uuid, uuid) from public, anon, authenticated;
revoke all on function public.materialize_program_assignment(uuid, uuid, uuid, uuid) from public, anon, authenticated;

create function public.save_program(
  p_farm_id uuid,
  p_operation_id uuid,
  p_program jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_receipt_user uuid;
  v_result jsonb;
  v_id uuid;
  v_name text;
  v_kind text;
  v_commodity text;
  v_year integer;
  v_notes text;
  v_saved public.programs%rowtype;
begin
  if p_farm_id is null or p_operation_id is null or v_caller is null then
    raise exception 'farm ID, operation ID, and authentication are required';
  end if;
  if not public.can_edit_farm(p_farm_id) then
    raise exception 'you do not have permission to edit this farm';
  end if;
  if jsonb_typeof(p_program) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_program)) <> 6
    or exists (
      select 1 from jsonb_object_keys(p_program) as k(key)
      where k.key not in ('id','name','program_kind','commodity_id','crop_year','notes')
    ) then
    raise exception 'program keys do not match the accepted contract';
  end if;
  if coalesce(jsonb_typeof(p_program->'id'),'null') not in ('string','null')
    or jsonb_typeof(p_program->'name') is distinct from 'string'
    or coalesce(jsonb_typeof(p_program->'program_kind'),'null') not in ('string','null')
    or coalesce(jsonb_typeof(p_program->'commodity_id'),'null') not in ('string','null')
    or coalesce(jsonb_typeof(p_program->'crop_year'),'null') not in ('number','null')
    or coalesce(jsonb_typeof(p_program->'notes'),'null') not in ('string','null') then
    raise exception 'program fields have invalid JSON types';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext(p_operation_id::text));
  select r.user_id, r.result into v_receipt_user, v_result
  from public.repository_write_receipts r
  where r.farm_id = p_farm_id and r.operation_id = p_operation_id;
  if found then
    if v_receipt_user <> v_caller then
      raise exception 'operation ID was already used by another user';
    end if;
    return v_result;
  end if;

  begin
    v_id := coalesce((p_program->>'id')::uuid, gen_random_uuid());
    v_year := (p_program->>'crop_year')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'program ID and crop year must be valid';
  end;
  v_name := btrim(p_program->>'name');
  v_kind := nullif(btrim(p_program->>'program_kind'), '');
  v_commodity := nullif(btrim(p_program->>'commodity_id'), '');
  v_notes := nullif(p_program->>'notes', '');

  if char_length(v_name) not between 1 and 160 then raise exception 'program name is invalid'; end if;
  if v_kind is not null and v_kind not in ('chemical','fertility','fungicide','other') then
    raise exception 'program kind is invalid';
  end if;
  if v_year is not null and v_year not between 1900 and 2200 then raise exception 'crop year is invalid'; end if;
  if v_notes is not null and char_length(v_notes) > 4000 then raise exception 'program notes are too long'; end if;
  if v_commodity is not null and not exists (
    select 1 from public.commodities c where c.id = v_commodity
  ) then raise exception 'commodity is invalid'; end if;

  perform pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext(v_id::text));
  update public.programs p
  set name = v_name,
      program_kind = v_kind,
      commodity_id = v_commodity,
      crop_year = v_year,
      notes = v_notes,
      revision = p.revision + 1,
      updated_by = v_caller
  where p.id = v_id and p.farm_id = p_farm_id
  returning p.* into v_saved;

  if not found then
    insert into public.programs (
      id, farm_id, name, program_kind, commodity_id, crop_year, notes,
      revision, is_archived, created_by, updated_by
    ) values (
      v_id, p_farm_id, v_name, v_kind, v_commodity, v_year, v_notes,
      1, false, v_caller, v_caller
    ) returning * into v_saved;
  end if;

  v_result := jsonb_build_object('program', to_jsonb(v_saved));
  insert into public.repository_write_receipts (farm_id, operation_id, user_id, result)
  values (p_farm_id, p_operation_id, v_caller, v_result);
  return v_result;
end;
$$;

create function public.save_program_pass(
  p_farm_id uuid,
  p_operation_id uuid,
  p_program_id uuid,
  p_pass jsonb,
  p_products jsonb,
  p_place_after_pass_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_receipt_user uuid;
  v_result jsonb;
  v_pass_id uuid;
  v_program_revision integer;
  v_name text;
  v_pass_type text;
  v_activity_type text;
  v_timing_label text;
  v_target_date date;
  v_offset smallint;
  v_lead smallint;
  v_notes text;
  v_pass_count integer;
  v_pass_max_sequence integer;
  v_pass_shift integer;
  v_product_count integer;
  v_product_max_sequence integer;
  v_product_shift integer;
  v_insert_position integer;
  v_item jsonb;
  v_product_id uuid;
  v_ordinal integer;
begin
  if p_farm_id is null or p_operation_id is null or p_program_id is null or v_caller is null then
    raise exception 'farm ID, operation ID, program ID, and authentication are required';
  end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  if jsonb_typeof(p_pass) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_pass)) <> 9
    or exists (select 1 from jsonb_object_keys(p_pass) as k(key) where k.key not in (
      'id','name','pass_type','activity_type','timing_label','target_date',
      'planting_offset_days','reminder_lead_days','notes'
    )) then raise exception 'pass keys do not match the accepted contract'; end if;
  if coalesce(jsonb_typeof(p_pass->'id'),'null') not in ('string','null')
    or jsonb_typeof(p_pass->'name') is distinct from 'string'
    or jsonb_typeof(p_pass->'pass_type') is distinct from 'string'
    or jsonb_typeof(p_pass->'activity_type') is distinct from 'string'
    or coalesce(jsonb_typeof(p_pass->'timing_label'),'null') not in ('string','null')
    or coalesce(jsonb_typeof(p_pass->'target_date'),'null') not in ('string','null')
    or coalesce(jsonb_typeof(p_pass->'planting_offset_days'),'null') not in ('number','null')
    or jsonb_typeof(p_pass->'reminder_lead_days') is distinct from 'number'
    or coalesce(jsonb_typeof(p_pass->'notes'),'null') not in ('string','null') then
    raise exception 'pass fields have invalid JSON types';
  end if;
  if jsonb_typeof(p_products) is distinct from 'array' then raise exception 'products must be a JSON array'; end if;

  for v_item in select value from jsonb_array_elements(p_products) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(v_item)) <> 6
      or exists (select 1 from jsonb_object_keys(v_item) as k(key) where k.key not in (
        'id','product_name','rate_text','unit_text','estimated_cost_per_acre','notes'
      ))
      or coalesce(jsonb_typeof(v_item->'id'),'null') not in ('string','null')
      or jsonb_typeof(v_item->'product_name') is distinct from 'string'
      or jsonb_typeof(v_item->'rate_text') is distinct from 'string'
      or jsonb_typeof(v_item->'unit_text') is distinct from 'string'
      or coalesce(jsonb_typeof(v_item->'estimated_cost_per_acre'),'null') not in ('number','null')
      or coalesce(jsonb_typeof(v_item->'notes'),'null') not in ('string','null') then
      raise exception 'product keys or field types do not match the accepted contract';
    end if;
  end loop;

  perform pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext(p_operation_id::text));
  select r.user_id, r.result into v_receipt_user, v_result
  from public.repository_write_receipts r
  where r.farm_id = p_farm_id and r.operation_id = p_operation_id;
  if found then
    if v_receipt_user <> v_caller then raise exception 'operation ID was already used by another user'; end if;
    return v_result;
  end if;

  begin
    v_pass_id := coalesce((p_pass->>'id')::uuid, gen_random_uuid());
    v_target_date := (p_pass->>'target_date')::date;
    v_offset := (p_pass->>'planting_offset_days')::smallint;
    v_lead := (p_pass->>'reminder_lead_days')::smallint;
  exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then
    raise exception 'pass ID, dates, and day values must be valid';
  end;
  v_name := btrim(p_pass->>'name');
  v_pass_type := p_pass->>'pass_type';
  v_activity_type := p_pass->>'activity_type';
  v_timing_label := nullif(p_pass->>'timing_label','');
  v_notes := nullif(p_pass->>'notes','');
  if char_length(v_name) not between 1 and 120 then raise exception 'pass name is invalid'; end if;
  if v_pass_type not in ('pre','post','fungicide','planter_fertility','custom') then raise exception 'pass type is invalid'; end if;
  if v_activity_type not in ('spray','fertility','other') then raise exception 'activity type is invalid'; end if;
  if v_target_date is not null and v_offset is not null then raise exception 'target date and planting offset are mutually exclusive'; end if;
  if v_offset is not null and v_offset not between -120 and 365 then raise exception 'planting offset is invalid'; end if;
  if v_lead is null or v_lead not between 0 and 60 then raise exception 'reminder lead days are invalid'; end if;
  if v_timing_label is not null and char_length(v_timing_label) > 160 then raise exception 'timing label is too long'; end if;
  if v_notes is not null and char_length(v_notes) > 2000 then raise exception 'pass notes are too long'; end if;

  perform pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext(p_program_id::text));
  select p.revision into v_program_revision
  from public.programs p where p.id = p_program_id and p.farm_id = p_farm_id and not p.is_archived;
  if not found then raise exception 'program does not belong to this farm or is archived'; end if;
  if exists (select 1 from public.program_passes pp where pp.id = v_pass_id
    and pp.farm_id = p_farm_id and pp.program_id <> p_program_id) then
    raise exception 'pass does not belong to this program and farm';
  end if;
  if exists (select 1 from public.program_passes pp where pp.id = v_pass_id
    and pp.farm_id = p_farm_id and pp.program_id = p_program_id and pp.is_archived) then
    raise exception 'an archived pass cannot be edited';
  end if;
  if p_place_after_pass_id is not null and not exists (
    select 1 from public.program_passes pp where pp.id = p_place_after_pass_id
      and pp.farm_id = p_farm_id and pp.program_id = p_program_id
      and not pp.is_archived and pp.id <> v_pass_id
  ) then raise exception 'placement pass does not belong to this active program'; end if;

  select count(*) into v_pass_count from public.program_passes pp
  where pp.farm_id = p_farm_id and pp.program_id = p_program_id
    and not pp.is_archived and pp.id <> v_pass_id;
  select coalesce(max(pp.sequence),0) into v_pass_max_sequence
  from public.program_passes pp where pp.farm_id=p_farm_id
    and pp.program_id=p_program_id and not pp.is_archived;
  v_pass_shift:=v_pass_max_sequence+v_pass_count+1;
  if v_pass_max_sequence+v_pass_shift>32767 then
    raise exception 'program pass sequences are too large to renumber safely'; end if;
  update public.program_passes pp set sequence = pp.sequence + v_pass_shift
  where pp.farm_id = p_farm_id and pp.program_id = p_program_id
    and not pp.is_archived;

  if p_place_after_pass_id is null then v_insert_position := 1;
  else
    select row_number into v_insert_position from (
      select pp.id, row_number() over (order by pp.sequence, pp.id) + 1 as row_number
      from public.program_passes pp
      where pp.farm_id = p_farm_id and pp.program_id = p_program_id
        and not pp.is_archived and pp.id <> v_pass_id
    ) ordered where id = p_place_after_pass_id;
  end if;

  update public.program_passes pp
  set sequence = case when ordered.rn < v_insert_position then ordered.rn else ordered.rn + 1 end
  from (
    select id, row_number() over (order by sequence, id)::smallint as rn
    from public.program_passes
    where farm_id = p_farm_id and program_id = p_program_id
      and not is_archived and id <> v_pass_id
  ) ordered
  where pp.id = ordered.id and pp.farm_id = p_farm_id;

  update public.program_passes pp
  set sequence = v_insert_position, name = v_name, pass_type = v_pass_type,
      activity_type = v_activity_type, timing_label = v_timing_label,
      target_date = v_target_date, planting_offset_days = v_offset,
      reminder_lead_days = v_lead, notes = v_notes, updated_by = v_caller
  where pp.id = v_pass_id and pp.farm_id = p_farm_id and pp.program_id = p_program_id;
  if not found then
    insert into public.program_passes (
      id,farm_id,program_id,sequence,name,pass_type,activity_type,timing_label,
      target_date,planting_offset_days,reminder_lead_days,notes,created_by,updated_by
    ) values (
      v_pass_id,p_farm_id,p_program_id,v_insert_position,v_name,v_pass_type,
      v_activity_type,v_timing_label,v_target_date,v_offset,v_lead,v_notes,v_caller,v_caller
    );
  end if;

  if (select count(*) from (
    select nullif(value->>'id','') id from jsonb_array_elements(p_products) where value->>'id' is not null
    group by nullif(value->>'id','') having count(*) > 1
  ) duplicates) > 0 then raise exception 'product IDs must be distinct'; end if;

  for v_item in select value from jsonb_array_elements(p_products) loop
    begin v_product_id := (v_item->>'id')::uuid;
    exception when invalid_text_representation then raise exception 'product ID must be valid'; end;
    if v_product_id is not null and exists (
      select 1 from public.program_pass_products ppp where ppp.id = v_product_id
        and ppp.farm_id = p_farm_id and ppp.program_pass_id <> v_pass_id
    ) then raise exception 'product does not belong to this pass and farm'; end if;
  end loop;

  update public.program_pass_products ppp
  set is_archived = true, updated_by = v_caller
  where ppp.farm_id = p_farm_id and ppp.program_pass_id = v_pass_id and not ppp.is_archived
    and not exists (
      select 1 from jsonb_array_elements(p_products) e
      where nullif(e->>'id','')::uuid = ppp.id
    );
  select count(*) into v_product_count from jsonb_array_elements(p_products);
  select coalesce(max(ppp.sequence),0) into v_product_max_sequence
  from public.program_pass_products ppp where ppp.farm_id=p_farm_id
    and ppp.program_pass_id=v_pass_id and not ppp.is_archived;
  v_product_shift:=v_product_max_sequence+v_product_count;
  if v_product_max_sequence+v_product_shift>32767 then
    raise exception 'product sequences are too large to renumber safely'; end if;
  update public.program_pass_products ppp
  set sequence = ppp.sequence + v_product_shift
  where ppp.farm_id = p_farm_id and ppp.program_pass_id = v_pass_id and not ppp.is_archived;

  v_ordinal := 0;
  for v_item in select value from jsonb_array_elements(p_products) loop
    v_ordinal := v_ordinal + 1;
    begin
      v_product_id := coalesce((v_item->>'id')::uuid, gen_random_uuid());
      if (v_item->>'estimated_cost_per_acre')::numeric < 0 then raise exception 'estimated cost cannot be negative'; end if;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'product ID and cost must be valid';
    end;
    if char_length(btrim(v_item->>'product_name')) not between 1 and 200
      or char_length(btrim(v_item->>'rate_text')) not between 1 and 80
      or char_length(btrim(v_item->>'unit_text')) not between 1 and 80
      or (v_item->>'notes' is not null and char_length(v_item->>'notes') > 1000) then
      raise exception 'product text fields are invalid';
    end if;
    update public.program_pass_products ppp
    set sequence = v_ordinal, product_name = btrim(v_item->>'product_name'),
        rate_text = btrim(v_item->>'rate_text'), unit_text = btrim(v_item->>'unit_text'),
        estimated_cost_per_acre = (v_item->>'estimated_cost_per_acre')::numeric,
        notes = nullif(v_item->>'notes',''), is_archived = false, updated_by = v_caller
    where ppp.id = v_product_id and ppp.farm_id = p_farm_id
      and ppp.program_pass_id = v_pass_id;
    if not found then
      insert into public.program_pass_products (
        id,farm_id,program_pass_id,sequence,product_name,rate_text,unit_text,
        estimated_cost_per_acre,notes,created_by,updated_by
      ) values (
        v_product_id,p_farm_id,v_pass_id,v_ordinal,btrim(v_item->>'product_name'),
        btrim(v_item->>'rate_text'),btrim(v_item->>'unit_text'),
        (v_item->>'estimated_cost_per_acre')::numeric,nullif(v_item->>'notes',''),v_caller,v_caller
      );
    end if;
  end loop;

  update public.programs p set revision = p.revision + 1, updated_by = v_caller
  where p.id = p_program_id and p.farm_id = p_farm_id returning p.revision into v_program_revision;
  v_result := jsonb_build_object(
    'program_id', p_program_id, 'program_revision', v_program_revision,
    'pass', (select to_jsonb(pp) from public.program_passes pp where pp.id=v_pass_id and pp.farm_id=p_farm_id),
    'products', coalesce((select jsonb_agg(to_jsonb(ppp) order by ppp.sequence,ppp.id)
      from public.program_pass_products ppp where ppp.farm_id=p_farm_id
        and ppp.program_pass_id=v_pass_id and not ppp.is_archived),'[]'::jsonb),
    'order', coalesce((select jsonb_agg(pp.id order by pp.sequence,pp.id)
      from public.program_passes pp where pp.farm_id=p_farm_id
        and pp.program_id=p_program_id and not pp.is_archived),'[]'::jsonb)
  );
  insert into public.repository_write_receipts (farm_id,operation_id,user_id,result)
  values (p_farm_id,p_operation_id,v_caller,v_result);
  return v_result;
end;
$$;

create function public.reorder_program_passes(
  p_farm_id uuid,
  p_operation_id uuid,
  p_program_id uuid,
  p_ordered_pass_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_receipt_user uuid;
  v_result jsonb;
  v_count integer;
  v_max_sequence integer;
  v_shift integer;
  v_revision integer;
begin
  if p_farm_id is null or p_operation_id is null or p_program_id is null
    or p_ordered_pass_ids is null or v_caller is null then
    raise exception 'farm ID, operation ID, program ID, pass order, and authentication are required';
  end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  if array_position(p_ordered_pass_ids, null) is not null then raise exception 'pass order cannot contain null IDs'; end if;

  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_operation_id::text));
  select r.user_id,r.result into v_receipt_user,v_result from public.repository_write_receipts r
  where r.farm_id=p_farm_id and r.operation_id=p_operation_id;
  if found then
    if v_receipt_user<>v_caller then raise exception 'operation ID was already used by another user'; end if;
    return v_result;
  end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_program_id::text));
  select p.revision into v_revision from public.programs p
  where p.id=p_program_id and p.farm_id=p_farm_id and not p.is_archived;
  if not found then raise exception 'program does not belong to this farm or is archived'; end if;
  select count(*) into v_count from public.program_passes pp
  where pp.farm_id=p_farm_id and pp.program_id=p_program_id and not pp.is_archived;
  if cardinality(p_ordered_pass_ids)<>v_count
    or (select count(distinct x) from unnest(p_ordered_pass_ids) x)<>v_count
    or exists (
      select 1 from unnest(p_ordered_pass_ids) x
      where not exists (select 1 from public.program_passes pp
        where pp.id=x and pp.farm_id=p_farm_id and pp.program_id=p_program_id and not pp.is_archived)
    ) then raise exception 'pass order must contain every active pass exactly once'; end if;
  select coalesce(max(pp.sequence),0) into v_max_sequence from public.program_passes pp
  where pp.farm_id=p_farm_id and pp.program_id=p_program_id and not pp.is_archived;
  v_shift:=v_max_sequence+v_count;
  if v_max_sequence+v_shift>32767 then
    raise exception 'program pass sequences are too large to renumber safely'; end if;
  update public.program_passes pp set sequence=pp.sequence+v_shift
  where pp.farm_id=p_farm_id and pp.program_id=p_program_id and not pp.is_archived;
  update public.program_passes pp set sequence=o.ordinality::smallint
  from unnest(p_ordered_pass_ids) with ordinality o(id,ordinality)
  where pp.id=o.id and pp.farm_id=p_farm_id and pp.program_id=p_program_id and not pp.is_archived;
  update public.programs p set revision=p.revision+1,updated_by=v_caller
  where p.id=p_program_id and p.farm_id=p_farm_id returning p.revision into v_revision;
  v_result:=jsonb_build_object('program_id',p_program_id,'program_revision',v_revision,
    'order',to_jsonb(p_ordered_pass_ids));
  insert into public.repository_write_receipts(farm_id,operation_id,user_id,result)
  values(p_farm_id,p_operation_id,v_caller,v_result);
  return v_result;
end;
$$;

create function public.delete_program_pass(
  p_farm_id uuid,
  p_operation_id uuid,
  p_program_id uuid,
  p_pass_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid:=auth.uid(); v_receipt_user uuid; v_result jsonb; v_revision integer;
  v_is_archived boolean;
begin
  if p_farm_id is null or p_operation_id is null or p_program_id is null or p_pass_id is null or v_caller is null then
    raise exception 'farm ID, operation ID, program ID, pass ID, and authentication are required'; end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_operation_id::text));
  select r.user_id,r.result into v_receipt_user,v_result from public.repository_write_receipts r
  where r.farm_id=p_farm_id and r.operation_id=p_operation_id;
  if found then if v_receipt_user<>v_caller then raise exception 'operation ID was already used by another user'; end if; return v_result; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_program_id::text));
  if not exists(select 1 from public.programs p where p.id=p_program_id and p.farm_id=p_farm_id) then
    raise exception 'program does not belong to this farm'; end if;
  select pp.is_archived into v_is_archived from public.program_passes pp
  where pp.id=p_pass_id and pp.farm_id=p_farm_id and pp.program_id=p_program_id;
  if not found then raise exception 'pass does not belong to this program and farm'; end if;
  if v_is_archived then
    select p.revision into v_revision from public.programs p
    where p.id=p_program_id and p.farm_id=p_farm_id;
    v_result:=jsonb_build_object('program_id',p_program_id,'program_revision',v_revision,
      'pass_id',p_pass_id,'is_archived',true);
    insert into public.repository_write_receipts(farm_id,operation_id,user_id,result)
    values(p_farm_id,p_operation_id,v_caller,v_result);
    return v_result;
  end if;
  update public.program_pass_products ppp set is_archived=true,updated_by=v_caller
  where ppp.farm_id=p_farm_id and ppp.program_pass_id=p_pass_id and not ppp.is_archived;
  update public.program_passes pp set is_archived=true,updated_by=v_caller
  where pp.id=p_pass_id and pp.farm_id=p_farm_id and pp.program_id=p_program_id and not pp.is_archived;
  update public.programs p set revision=p.revision+1,updated_by=v_caller
  where p.id=p_program_id and p.farm_id=p_farm_id returning p.revision into v_revision;
  v_result:=jsonb_build_object('program_id',p_program_id,'program_revision',v_revision,
    'pass_id',p_pass_id,'is_archived',true);
  insert into public.repository_write_receipts(farm_id,operation_id,user_id,result)
  values(p_farm_id,p_operation_id,v_caller,v_result); return v_result;
end;
$$;

create function public.delete_program(
  p_farm_id uuid,
  p_operation_id uuid,
  p_program_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid:=auth.uid(); v_receipt_user uuid; v_result jsonb; v_program public.programs%rowtype;
begin
  if p_farm_id is null or p_operation_id is null or p_program_id is null or v_caller is null then
    raise exception 'farm ID, operation ID, program ID, and authentication are required'; end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_operation_id::text));
  select r.user_id,r.result into v_receipt_user,v_result from public.repository_write_receipts r
  where r.farm_id=p_farm_id and r.operation_id=p_operation_id;
  if found then if v_receipt_user<>v_caller then raise exception 'operation ID was already used by another user'; end if; return v_result; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_program_id::text));
  update public.programs p set is_archived=true,updated_by=v_caller
  where p.id=p_program_id and p.farm_id=p_farm_id returning p.* into v_program;
  if not found then raise exception 'program does not belong to this farm'; end if;
  v_result:=jsonb_build_object('program',to_jsonb(v_program));
  insert into public.repository_write_receipts(farm_id,operation_id,user_id,result)
  values(p_farm_id,p_operation_id,v_caller,v_result); return v_result;
end;
$$;

create function public.assign_program(
  p_farm_id uuid,
  p_operation_id uuid,
  p_program_id uuid,
  p_crop_assignment_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid:=auth.uid();
  v_receipt_user uuid;
  v_result jsonb;
  v_crop_id uuid;
  v_assignment_id uuid;
  v_sorted_crop_ids uuid[];
  v_graphs jsonb:='[]'::jsonb;
begin
  if p_farm_id is null or p_operation_id is null or p_program_id is null
    or p_crop_assignment_ids is null or v_caller is null then
    raise exception 'farm ID, operation ID, program ID, crop assignments, and authentication are required';
  end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  if cardinality(p_crop_assignment_ids) not between 1 and 200
    or array_position(p_crop_assignment_ids,null) is not null
    or (select count(distinct x) from unnest(p_crop_assignment_ids) x)<>cardinality(p_crop_assignment_ids) then
    raise exception 'crop assignment IDs must contain 1 to 200 distinct non-null IDs';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_operation_id::text));
  select r.user_id,r.result into v_receipt_user,v_result from public.repository_write_receipts r
  where r.farm_id=p_farm_id and r.operation_id=p_operation_id;
  if found then if v_receipt_user<>v_caller then raise exception 'operation ID was already used by another user'; end if; return v_result; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_program_id::text));
  if not exists(select 1 from public.programs p where p.id=p_program_id and p.farm_id=p_farm_id and not p.is_archived) then
    raise exception 'program does not belong to this farm or is archived'; end if;
  select array_agg(x order by x) into v_sorted_crop_ids from unnest(p_crop_assignment_ids) x;
  foreach v_crop_id in array v_sorted_crop_ids loop
    perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(v_crop_id::text));
  end loop;
  if exists(select 1 from unnest(p_crop_assignment_ids) x
    where not exists(select 1 from public.crop_assignments ca where ca.id=x and ca.farm_id=p_farm_id)) then
    raise exception 'a crop assignment does not belong to this farm'; end if;
  if exists(select 1 from unnest(p_crop_assignment_ids) x
    join public.program_assignments pa on pa.crop_assignment_id=x
      and pa.farm_id=p_farm_id and pa.program_id=p_program_id and pa.status='active') then
    raise exception 'this program is already active on a selected crop assignment'; end if;
  if exists(select 1 from unnest(p_crop_assignment_ids) x where
    (select count(*) from public.program_assignments pa where pa.farm_id=p_farm_id
      and pa.crop_assignment_id=x and pa.status='active')>=12) then
    raise exception 'a selected crop assignment already has 12 active programs'; end if;

  foreach v_crop_id in array p_crop_assignment_ids loop
    v_assignment_id:=public.materialize_program_assignment(p_farm_id,p_program_id,v_crop_id,v_caller);
    v_graphs:=v_graphs||jsonb_build_array(public.program_assignment_graph(p_farm_id,v_assignment_id));
  end loop;
  v_result:=jsonb_build_object('program_id',p_program_id,'assignments',v_graphs);
  insert into public.repository_write_receipts(farm_id,operation_id,user_id,result)
  values(p_farm_id,p_operation_id,v_caller,v_result); return v_result;
end;
$$;

create function public.refresh_program_assignment(
  p_farm_id uuid,
  p_operation_id uuid,
  p_assignment_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid:=auth.uid(); v_receipt_user uuid; v_result jsonb;
  v_program public.programs%rowtype; v_crop public.crop_assignments%rowtype;
  v_program_id uuid; v_crop_id uuid; v_field_name text;
  v_added integer:=0; v_updated integer:=0; v_cancelled integer:=0; v_preserved integer:=0;
  v_ap record; v_new_pass_id uuid; v_refreshed_pass public.assigned_program_passes%rowtype;
begin
  if p_farm_id is null or p_operation_id is null or p_assignment_id is null or v_caller is null then
    raise exception 'farm ID, operation ID, assignment ID, and authentication are required'; end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_operation_id::text));
  select r.user_id,r.result into v_receipt_user,v_result from public.repository_write_receipts r
  where r.farm_id=p_farm_id and r.operation_id=p_operation_id;
  if found then if v_receipt_user<>v_caller then raise exception 'operation ID was already used by another user'; end if; return v_result; end if;

  select pa.program_id,pa.crop_assignment_id into v_program_id,v_crop_id
  from public.program_assignments pa where pa.id=p_assignment_id and pa.farm_id=p_farm_id and pa.status='active';
  if not found then raise exception 'active program assignment does not belong to this farm'; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext('program-due-items'));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(v_program_id::text));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(v_crop_id::text));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_assignment_id::text));
  select pa.program_id,pa.crop_assignment_id into v_program_id,v_crop_id
  from public.program_assignments pa where pa.id=p_assignment_id
    and pa.farm_id=p_farm_id and pa.status='active';
  if not found then raise exception 'active program assignment does not belong to this farm'; end if;
  select p.* into v_program from public.programs p where p.id=v_program_id and p.farm_id=p_farm_id;
  select ca.* into strict v_crop from public.crop_assignments ca where ca.id=v_crop_id and ca.farm_id=p_farm_id;
  select f.name into strict v_field_name from public.fields f
  where f.id=v_crop.field_id and f.farm_id=p_farm_id;

  update public.program_assignments pa
  set program_name_snapshot=v_program.name,program_kind_snapshot=v_program.program_kind
  where pa.id=p_assignment_id and pa.farm_id=p_farm_id and pa.status='active';

  for v_ap in select ap.* from public.assigned_program_passes ap
    where ap.farm_id=p_farm_id and ap.assignment_id=p_assignment_id order by ap.sequence,ap.id loop
    if v_ap.status<>'planned' or v_ap.is_field_override then
      v_preserved:=v_preserved+1;
    elsif v_ap.source_program_pass_id is null or not exists(
      select 1 from public.program_passes pp where pp.id=v_ap.source_program_pass_id
        and pp.farm_id=p_farm_id and pp.program_id=v_program_id and not pp.is_archived
    ) then
      update public.assigned_program_passes ap set status='cancelled',cancelled_at=now(),
        cancel_reason='Removed from template revision '||v_program.revision,updated_by=v_caller
      where ap.id=v_ap.id and ap.farm_id=p_farm_id and ap.status='planned';
      update public.farm_tasks t set status='done'
      where t.farm_id=p_farm_id and t.program_assigned_pass_id=v_ap.id
        and t.source='program' and t.status in ('todo','doing');
      v_cancelled:=v_cancelled+1;
    else
      update public.assigned_program_passes ap
      set source_revision=v_program.revision, sequence=pp.sequence,name=pp.name,
          pass_type=pp.pass_type,activity_type=pp.activity_type,timing_label=pp.timing_label,
          target_date=pp.target_date,planting_offset_days=pp.planting_offset_days,
          reminder_lead_days=pp.reminder_lead_days,notes=pp.notes,
          due_on=case when pp.target_date is not null then pp.target_date
            when pp.planting_offset_days is not null and v_crop.planting_date is not null
              then v_crop.planting_date+pp.planting_offset_days else null end,
          due_source=case when pp.target_date is not null then 'template_date'
            when pp.planting_offset_days is not null and v_crop.planting_date is not null
              then 'planting_offset' else 'unscheduled' end,
          updated_by=v_caller
      from public.program_passes pp
      where ap.id=v_ap.id and ap.farm_id=p_farm_id
        and pp.id=v_ap.source_program_pass_id and pp.farm_id=p_farm_id
      returning ap.* into v_refreshed_pass;

      if v_refreshed_pass.due_on is distinct from v_ap.due_on then
        perform public.sync_open_program_task_due(
          p_farm_id,
          v_ap.id,
          v_refreshed_pass.due_on,
          v_program.name||' — '||v_refreshed_pass.name||' — '||v_field_name
        );
      end if;

      update public.assigned_program_pass_products app
      set is_active=false,updated_by=v_caller
      where app.farm_id=p_farm_id and app.assigned_pass_id=v_ap.id
        and (
          app.source_program_pass_product_id is null
          or not exists(
            select 1 from public.program_pass_products ppp
            where ppp.id=app.source_program_pass_product_id
              and ppp.farm_id=p_farm_id
              and ppp.program_pass_id=v_ap.source_program_pass_id
              and not ppp.is_archived
          )
        );

      update public.assigned_program_pass_products app
      set sequence=ppp.sequence,product_name=ppp.product_name,rate_text=ppp.rate_text,
          unit_text=ppp.unit_text,estimated_cost_per_acre=ppp.estimated_cost_per_acre,
          catalog_product_id=ppp.catalog_product_id,notes=ppp.notes,is_active=true,
          updated_by=v_caller
      from public.program_pass_products ppp
      where app.farm_id=p_farm_id and app.assigned_pass_id=v_ap.id
        and ppp.id=app.source_program_pass_product_id and ppp.farm_id=p_farm_id
        and ppp.program_pass_id=v_ap.source_program_pass_id and not ppp.is_archived;
      insert into public.assigned_program_pass_products(
        farm_id,assigned_pass_id,source_program_pass_product_id,sequence,
        product_name,rate_text,unit_text,estimated_cost_per_acre,catalog_product_id,
        notes,created_by,updated_by
      ) select p_farm_id,v_ap.id,ppp.id,ppp.sequence,ppp.product_name,ppp.rate_text,
        ppp.unit_text,ppp.estimated_cost_per_acre,ppp.catalog_product_id,ppp.notes,v_caller,v_caller
      from public.program_pass_products ppp
      where ppp.farm_id=p_farm_id and ppp.program_pass_id=v_ap.source_program_pass_id
        and not ppp.is_archived and not exists(select 1 from public.assigned_program_pass_products app
          where app.farm_id=p_farm_id and app.assigned_pass_id=v_ap.id
            and app.source_program_pass_product_id=ppp.id);
      v_updated:=v_updated+1;
    end if;
  end loop;

  for v_ap in select pp.* from public.program_passes pp
    where pp.farm_id=p_farm_id and pp.program_id=v_program_id and not pp.is_archived
      and not exists(select 1 from public.assigned_program_passes ap
        where ap.farm_id=p_farm_id and ap.assignment_id=p_assignment_id
          and ap.source_program_pass_id=pp.id)
    order by pp.sequence,pp.id loop
    v_new_pass_id:=gen_random_uuid();
    insert into public.assigned_program_passes(
      id,farm_id,assignment_id,source_program_pass_id,source_revision,sequence,name,
      pass_type,activity_type,timing_label,target_date,planting_offset_days,
      reminder_lead_days,notes,due_on,due_source,created_by,updated_by
    ) values(
      v_new_pass_id,p_farm_id,p_assignment_id,v_ap.id,v_program.revision,v_ap.sequence,v_ap.name,
      v_ap.pass_type,v_ap.activity_type,v_ap.timing_label,v_ap.target_date,v_ap.planting_offset_days,
      v_ap.reminder_lead_days,v_ap.notes,
      case when v_ap.target_date is not null then v_ap.target_date
        when v_ap.planting_offset_days is not null and v_crop.planting_date is not null
          then v_crop.planting_date+v_ap.planting_offset_days else null end,
      case when v_ap.target_date is not null then 'template_date'
        when v_ap.planting_offset_days is not null and v_crop.planting_date is not null
          then 'planting_offset' else 'unscheduled' end,v_caller,v_caller
    );
    insert into public.assigned_program_pass_products(
      farm_id,assigned_pass_id,source_program_pass_product_id,sequence,product_name,
      rate_text,unit_text,estimated_cost_per_acre,catalog_product_id,notes,created_by,updated_by
    ) select p_farm_id,v_new_pass_id,ppp.id,ppp.sequence,ppp.product_name,ppp.rate_text,
      ppp.unit_text,ppp.estimated_cost_per_acre,ppp.catalog_product_id,ppp.notes,v_caller,v_caller
    from public.program_pass_products ppp where ppp.farm_id=p_farm_id
      and ppp.program_pass_id=v_ap.id and not ppp.is_archived;
    v_added:=v_added+1;
  end loop;

  update public.program_assignments pa set template_revision=v_program.revision
  where pa.id=p_assignment_id and pa.farm_id=p_farm_id and pa.status='active';
  update public.farm_tasks t set title=left(v_program.name||' — '||ap.name||' — '||f.name,500)
  from public.assigned_program_passes ap
  join public.program_assignments pa on pa.id=ap.assignment_id and pa.farm_id=ap.farm_id
  join public.crop_assignments ca on ca.id=pa.crop_assignment_id and ca.farm_id=pa.farm_id
  join public.fields f on f.id=ca.field_id and f.farm_id=ca.farm_id
  where pa.id=p_assignment_id and pa.farm_id=p_farm_id and t.farm_id=p_farm_id
    and t.program_assigned_pass_id=ap.id and t.source='program' and t.status in ('todo','doing');
  v_result:=jsonb_build_object('added',v_added,'updated',v_updated,'cancelled',v_cancelled,
    'preserved',v_preserved,'assignment',public.program_assignment_graph(p_farm_id,p_assignment_id));
  insert into public.repository_write_receipts(farm_id,operation_id,user_id,result)
  values(p_farm_id,p_operation_id,v_caller,v_result); return v_result;
end;
$$;

create function public.reschedule_program_pass(
  p_farm_id uuid,
  p_operation_id uuid,
  p_assigned_pass_id uuid,
  p_due_on date,
  p_timing_label text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid:=auth.uid(); v_receipt_user uuid; v_result jsonb;
  v_pass public.assigned_program_passes%rowtype; v_program_name text; v_field_name text;
  v_assignment_id uuid; v_program_id uuid; v_crop_id uuid;
begin
  if p_farm_id is null or p_operation_id is null or p_assigned_pass_id is null
    or p_due_on is null or v_caller is null then
    raise exception 'farm ID, operation ID, assigned pass ID, due date, and authentication are required'; end if;
  if p_timing_label is not null and char_length(p_timing_label)>160 then raise exception 'timing label is too long'; end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_operation_id::text));
  select r.user_id,r.result into v_receipt_user,v_result from public.repository_write_receipts r
  where r.farm_id=p_farm_id and r.operation_id=p_operation_id;
  if found then if v_receipt_user<>v_caller then raise exception 'operation ID was already used by another user'; end if; return v_result; end if;
  select ap.assignment_id,pa.program_id,pa.crop_assignment_id
    into v_assignment_id,v_program_id,v_crop_id
  from public.assigned_program_passes ap
  join public.program_assignments pa on pa.id=ap.assignment_id and pa.farm_id=ap.farm_id
  where ap.id=p_assigned_pass_id and ap.farm_id=p_farm_id;
  if not found then raise exception 'assigned pass does not belong to this farm'; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext('program-due-items'));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(v_program_id::text));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(v_crop_id::text));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(v_assignment_id::text));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_assigned_pass_id::text));
  select pa.program_name_snapshot,f.name into v_program_name,v_field_name
  from public.assigned_program_passes ap
  join public.program_assignments pa on pa.id=ap.assignment_id and pa.farm_id=ap.farm_id
  join public.crop_assignments ca on ca.id=pa.crop_assignment_id and ca.farm_id=pa.farm_id
  join public.fields f on f.id=ca.field_id and f.farm_id=ca.farm_id
  where ap.id=p_assigned_pass_id and ap.farm_id=p_farm_id
    and ap.status='planned' and pa.status='active';
  if not found then raise exception 'planned pass on an active assignment does not belong to this farm'; end if;
  update public.assigned_program_passes ap
  set due_on=p_due_on,due_source='manual',timing_label=nullif(p_timing_label,''),
      is_field_override=true,updated_by=v_caller
  where ap.id=p_assigned_pass_id and ap.farm_id=p_farm_id and ap.status='planned'
  returning ap.* into v_pass;
  perform public.sync_open_program_task_due(
    p_farm_id,
    p_assigned_pass_id,
    p_due_on,
    v_program_name||' — '||v_pass.name||' — '||v_field_name
  );
  v_result:=jsonb_build_object('pass',to_jsonb(v_pass));
  insert into public.repository_write_receipts(farm_id,operation_id,user_id,result)
  values(p_farm_id,p_operation_id,v_caller,v_result); return v_result;
end;
$$;

create function public.skip_program_pass(
  p_farm_id uuid,
  p_operation_id uuid,
  p_assigned_pass_id uuid,
  p_skipped_on date,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid:=auth.uid(); v_receipt_user uuid; v_result jsonb;
  v_pass public.assigned_program_passes%rowtype;
  v_assignment_id uuid; v_program_id uuid; v_crop_id uuid;
begin
  if p_farm_id is null or p_operation_id is null or p_assigned_pass_id is null
    or p_skipped_on is null or v_caller is null then
    raise exception 'farm ID, operation ID, assigned pass ID, skipped date, and authentication are required'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 then raise exception 'skip reason is required'; end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_operation_id::text));
  select r.user_id,r.result into v_receipt_user,v_result from public.repository_write_receipts r
  where r.farm_id=p_farm_id and r.operation_id=p_operation_id;
  if found then if v_receipt_user<>v_caller then raise exception 'operation ID was already used by another user'; end if; return v_result; end if;
  select ap.assignment_id,pa.program_id,pa.crop_assignment_id
    into v_assignment_id,v_program_id,v_crop_id
  from public.assigned_program_passes ap
  join public.program_assignments pa on pa.id=ap.assignment_id and pa.farm_id=ap.farm_id
  where ap.id=p_assigned_pass_id and ap.farm_id=p_farm_id;
  if not found then raise exception 'assigned pass does not belong to this farm'; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext('program-due-items'));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(v_program_id::text));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(v_crop_id::text));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(v_assignment_id::text));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_assigned_pass_id::text));
  update public.assigned_program_passes ap set status='skipped',skipped_on=p_skipped_on,
    skip_reason=btrim(p_reason),updated_by=v_caller
  where ap.id=p_assigned_pass_id and ap.farm_id=p_farm_id and ap.status='planned'
    and exists(select 1 from public.program_assignments pa where pa.id=ap.assignment_id
      and pa.farm_id=p_farm_id and pa.status='active') returning ap.* into v_pass;
  if not found then raise exception 'planned pass on an active assignment does not belong to this farm'; end if;
  update public.farm_tasks t set status='done' where t.farm_id=p_farm_id
    and t.program_assigned_pass_id=p_assigned_pass_id and t.source='program'
    and t.status in ('todo','doing');
  v_result:=jsonb_build_object('pass',to_jsonb(v_pass));
  insert into public.repository_write_receipts(farm_id,operation_id,user_id,result)
  values(p_farm_id,p_operation_id,v_caller,v_result); return v_result;
end;
$$;

create function public.unassign_program(
  p_farm_id uuid,
  p_operation_id uuid,
  p_assignment_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid:=auth.uid(); v_receipt_user uuid; v_result jsonb;
  v_cancelled integer; v_applied integer; v_program_id uuid; v_crop_id uuid;
begin
  if p_farm_id is null or p_operation_id is null or p_assignment_id is null or v_caller is null then
    raise exception 'farm ID, operation ID, assignment ID, and authentication are required'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 then raise exception 'unassign reason is required'; end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_operation_id::text));
  select r.user_id,r.result into v_receipt_user,v_result from public.repository_write_receipts r
  where r.farm_id=p_farm_id and r.operation_id=p_operation_id;
  if found then if v_receipt_user<>v_caller then raise exception 'operation ID was already used by another user'; end if; return v_result; end if;
  select pa.program_id,pa.crop_assignment_id into v_program_id,v_crop_id
  from public.program_assignments pa where pa.id=p_assignment_id
    and pa.farm_id=p_farm_id and pa.status='active';
  if not found then raise exception 'active assignment does not belong to this farm'; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext('program-due-items'));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(v_program_id::text));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(v_crop_id::text));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_assignment_id::text));
  if not exists(select 1 from public.program_assignments pa where pa.id=p_assignment_id
    and pa.farm_id=p_farm_id and pa.status='active') then
    raise exception 'active assignment does not belong to this farm'; end if;
  select count(*) into v_applied from public.assigned_program_passes ap
  where ap.farm_id=p_farm_id and ap.assignment_id=p_assignment_id and ap.status='applied';
  update public.assigned_program_passes ap set status='cancelled',cancelled_at=now(),
    cancel_reason='Program unassigned: '||btrim(p_reason),updated_by=v_caller
  where ap.farm_id=p_farm_id and ap.assignment_id=p_assignment_id and ap.status='planned';
  get diagnostics v_cancelled=row_count;
  update public.farm_tasks t set status='done' from public.assigned_program_passes ap
  where ap.farm_id=p_farm_id and ap.assignment_id=p_assignment_id
    and ap.status='cancelled' and ap.cancel_reason='Program unassigned: '||btrim(p_reason)
    and t.farm_id=p_farm_id and t.program_assigned_pass_id=ap.id
    and t.source='program' and t.status in ('todo','doing');
  update public.program_assignments pa set status='archived',archived_by=v_caller,
    archived_at=now(),archive_reason=btrim(p_reason)
  where pa.id=p_assignment_id and pa.farm_id=p_farm_id and pa.status='active';
  v_result:=jsonb_build_object('assignment',public.program_assignment_graph(p_farm_id,p_assignment_id),
    'cancelled_pass_count',v_cancelled,'applied_history_preserved',v_applied>0,
    'applied_pass_count',v_applied);
  insert into public.repository_write_receipts(farm_id,operation_id,user_id,result)
  values(p_farm_id,p_operation_id,v_caller,v_result); return v_result;
end;
$$;

create function public.reassign_program_assignment(
  p_farm_id uuid,
  p_operation_id uuid,
  p_assignment_id uuid,
  p_new_program_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid:=auth.uid(); v_receipt_user uuid; v_result jsonb;
  v_old_program_id uuid; v_crop_id uuid; v_new_assignment_id uuid;
  v_cancelled integer; v_applied integer;
begin
  if p_farm_id is null or p_operation_id is null or p_assignment_id is null
    or p_new_program_id is null or v_caller is null then
    raise exception 'farm ID, operation ID, assignment ID, new program ID, and authentication are required'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 1 and 1000 then raise exception 'reassign reason is required'; end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_operation_id::text));
  select r.user_id,r.result into v_receipt_user,v_result from public.repository_write_receipts r
  where r.farm_id=p_farm_id and r.operation_id=p_operation_id;
  if found then if v_receipt_user<>v_caller then raise exception 'operation ID was already used by another user'; end if; return v_result; end if;
  select pa.program_id,pa.crop_assignment_id into v_old_program_id,v_crop_id
  from public.program_assignments pa where pa.id=p_assignment_id and pa.farm_id=p_farm_id and pa.status='active';
  if not found then raise exception 'active assignment does not belong to this farm'; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext('program-due-items'));
  if v_old_program_id<p_new_program_id then
    perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(v_old_program_id::text));
    perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_new_program_id::text));
  else
    perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_new_program_id::text));
    perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(v_old_program_id::text));
  end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(v_crop_id::text));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_assignment_id::text));
  if not exists(select 1 from public.program_assignments pa where pa.id=p_assignment_id
    and pa.farm_id=p_farm_id and pa.status='active'
    and pa.program_id=v_old_program_id and pa.crop_assignment_id=v_crop_id) then
    raise exception 'active assignment does not belong to this farm'; end if;
  if not exists(select 1 from public.programs p where p.id=p_new_program_id and p.farm_id=p_farm_id and not p.is_archived) then
    raise exception 'new program does not belong to this farm or is archived'; end if;
  if p_new_program_id<>v_old_program_id and exists(select 1 from public.program_assignments pa
    where pa.farm_id=p_farm_id and pa.crop_assignment_id=v_crop_id
      and pa.program_id=p_new_program_id and pa.status='active') then
    raise exception 'new program is already active on this crop assignment'; end if;
  select count(*) into v_applied from public.assigned_program_passes ap
  where ap.farm_id=p_farm_id and ap.assignment_id=p_assignment_id and ap.status='applied';
  update public.assigned_program_passes ap set status='cancelled',cancelled_at=now(),
    cancel_reason='Program reassigned: '||btrim(p_reason),updated_by=v_caller
  where ap.farm_id=p_farm_id and ap.assignment_id=p_assignment_id and ap.status='planned';
  get diagnostics v_cancelled=row_count;
  update public.farm_tasks t set status='done' from public.assigned_program_passes ap
  where ap.farm_id=p_farm_id and ap.assignment_id=p_assignment_id
    and ap.status='cancelled' and ap.cancel_reason='Program reassigned: '||btrim(p_reason)
    and t.farm_id=p_farm_id and t.program_assigned_pass_id=ap.id
    and t.source='program' and t.status in ('todo','doing');
  update public.program_assignments pa set status='archived',archived_by=v_caller,
    archived_at=now(),archive_reason=btrim(p_reason)
  where pa.id=p_assignment_id and pa.farm_id=p_farm_id and pa.status='active';
  v_new_assignment_id:=public.materialize_program_assignment(p_farm_id,p_new_program_id,v_crop_id,v_caller);
  v_result:=jsonb_build_object(
    'archived_assignment',public.program_assignment_graph(p_farm_id,p_assignment_id),
    'new_assignment',public.program_assignment_graph(p_farm_id,v_new_assignment_id),
    'cancelled_pass_count',v_cancelled,'applied_history_preserved',v_applied>0);
  insert into public.repository_write_receipts(farm_id,operation_id,user_id,result)
  values(p_farm_id,p_operation_id,v_caller,v_result); return v_result;
end;
$$;

create function public.mark_program_pass_applied(
  p_farm_id uuid,
  p_operation_id uuid,
  p_assigned_pass_id uuid,
  p_applied_on date,
  p_applied_acres numeric,
  p_actual_products jsonb,
  p_application_record_id uuid,
  p_create_application_record boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid:=auth.uid(); v_receipt_user uuid; v_result jsonb;
  v_pass public.assigned_program_passes%rowtype;
  v_assignment_id uuid; v_program_id uuid; v_crop_id uuid; v_field_id uuid; v_planted_acres numeric;
  v_canonical_date date; v_canonical_acres numeric; v_item jsonb; v_product_id uuid;
  v_application_exists boolean;
begin
  if p_farm_id is null or p_operation_id is null or p_assigned_pass_id is null
    or p_applied_on is null or p_applied_acres is null
    or p_create_application_record is null or v_caller is null then
    raise exception 'farm ID, operation ID, assigned pass ID, applied values, create choice, and authentication are required';
  end if;
  if p_applied_acres<=0 then raise exception 'applied acres must be positive'; end if;
  if p_create_application_record and p_application_record_id is null then
    raise exception 'a stable application record ID is required when creating a record'; end if;
  if jsonb_typeof(p_actual_products) is distinct from 'array' then raise exception 'actual products must be a JSON array'; end if;
  for v_item in select value from jsonb_array_elements(p_actual_products) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(v_item))<>5
      or exists(select 1 from jsonb_object_keys(v_item) as k(key) where k.key not in (
        'id','actual_product_name','actual_rate_text','actual_unit_text','actual_cost_per_acre'
      ))
      or jsonb_typeof(v_item->'id') is distinct from 'string'
      or jsonb_typeof(v_item->'actual_product_name') is distinct from 'string'
      or jsonb_typeof(v_item->'actual_rate_text') is distinct from 'string'
      or jsonb_typeof(v_item->'actual_unit_text') is distinct from 'string'
      or coalesce(jsonb_typeof(v_item->'actual_cost_per_acre'),'null') not in ('number','null') then
      raise exception 'actual product keys or field types do not match the accepted contract';
    end if;
  end loop;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_operation_id::text));
  select r.user_id,r.result into v_receipt_user,v_result from public.repository_write_receipts r
  where r.farm_id=p_farm_id and r.operation_id=p_operation_id;
  if found then if v_receipt_user<>v_caller then raise exception 'operation ID was already used by another user'; end if; return v_result; end if;
  select ap.assignment_id,pa.program_id,pa.crop_assignment_id
    into v_assignment_id,v_program_id,v_crop_id
  from public.assigned_program_passes ap
  join public.program_assignments pa on pa.id=ap.assignment_id and pa.farm_id=ap.farm_id
  where ap.id=p_assigned_pass_id and ap.farm_id=p_farm_id;
  if not found then raise exception 'assigned pass does not belong to this farm'; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext('program-due-items'));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(v_program_id::text));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(v_crop_id::text));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(v_assignment_id::text));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_assigned_pass_id::text));
  select pa.crop_assignment_id,ca.field_id,ca.planted_acres
    into v_crop_id,v_field_id,v_planted_acres
  from public.assigned_program_passes ap
  join public.program_assignments pa on pa.id=ap.assignment_id and pa.farm_id=ap.farm_id
  join public.crop_assignments ca on ca.id=pa.crop_assignment_id and ca.farm_id=pa.farm_id
  where ap.id=p_assigned_pass_id and ap.farm_id=p_farm_id
    and ap.status='planned' and pa.status='active';
  if not found then raise exception 'planned pass on an active assignment does not belong to this farm'; end if;
  if (select count(*) from jsonb_array_elements(p_actual_products)) <>
      (select count(*) from public.assigned_program_pass_products app
       where app.farm_id=p_farm_id and app.assigned_pass_id=p_assigned_pass_id
         and app.is_active)
    or (select count(distinct value->>'id') from jsonb_array_elements(p_actual_products)) <>
      (select count(*) from jsonb_array_elements(p_actual_products)) then
    raise exception 'actual products must contain every assigned product exactly once';
  end if;
  for v_item in select value from jsonb_array_elements(p_actual_products) loop
    begin
      v_product_id:=(v_item->>'id')::uuid;
      if (v_item->>'actual_cost_per_acre')::numeric<0 then raise exception 'actual cost cannot be negative'; end if;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'actual product ID and cost must be valid';
    end;
    if not exists(select 1 from public.assigned_program_pass_products app
      where app.id=v_product_id and app.farm_id=p_farm_id
        and app.assigned_pass_id=p_assigned_pass_id and app.is_active) then
      raise exception 'actual product does not belong to this assigned pass and farm'; end if;
    if char_length(btrim(v_item->>'actual_product_name')) not between 1 and 200
      or char_length(btrim(v_item->>'actual_rate_text')) not between 1 and 80
      or char_length(btrim(v_item->>'actual_unit_text')) not between 1 and 80 then
      raise exception 'actual product text fields are invalid'; end if;
  end loop;

  v_canonical_date:=p_applied_on; v_canonical_acres:=p_applied_acres;
  if p_application_record_id is not null then
    perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_application_record_id::text));
    select exists(select 1 from public.application_records ar
      where ar.id=p_application_record_id and ar.farm_id=p_farm_id)
      into v_application_exists;
    if p_create_application_record then
      if v_application_exists then raise exception 'application record ID already exists'; end if;
      if p_applied_acres>v_planted_acres then raise exception 'applied acres cannot exceed planted acres'; end if;
      insert into public.application_records(
        id,farm_id,field_id,crop_assignment_id,status,application_date,applied_acres,
        created_by,notes
      ) values(
        p_application_record_id,p_farm_id,v_field_id,v_crop_id,'draft',p_applied_on,
        p_applied_acres,v_caller,'Created from Programs pass '||p_assigned_pass_id::text
      );
    else
      select ar.application_date,ar.applied_acres into v_canonical_date,v_canonical_acres
      from public.application_records ar where ar.id=p_application_record_id
        and ar.farm_id=p_farm_id and ar.crop_assignment_id=v_crop_id
        and ar.status<>'voided';
      if not found then raise exception 'application record must be non-voided and belong to this farm and crop assignment'; end if;
    end if;
  elsif p_applied_acres>v_planted_acres then
    raise exception 'applied acres cannot exceed planted acres';
  end if;
  if v_canonical_acres>v_planted_acres then raise exception 'application acres cannot exceed planted acres'; end if;

  for v_item in select value from jsonb_array_elements(p_actual_products) loop
    v_product_id:=(v_item->>'id')::uuid;
    update public.assigned_program_pass_products app
    set actual_product_name=btrim(v_item->>'actual_product_name'),
        actual_rate_text=btrim(v_item->>'actual_rate_text'),
        actual_unit_text=btrim(v_item->>'actual_unit_text'),
        actual_cost_per_acre=(v_item->>'actual_cost_per_acre')::numeric,
        updated_by=v_caller
    where app.id=v_product_id and app.farm_id=p_farm_id
      and app.assigned_pass_id=p_assigned_pass_id and app.is_active;
  end loop;
  update public.assigned_program_passes ap set status='applied',applied_on=v_canonical_date,
    applied_acres=v_canonical_acres,application_record_id=p_application_record_id,updated_by=v_caller
  where ap.id=p_assigned_pass_id and ap.farm_id=p_farm_id and ap.status='planned'
  returning ap.* into v_pass;
  update public.farm_tasks t set status='done' where t.farm_id=p_farm_id
    and t.program_assigned_pass_id=p_assigned_pass_id and t.source='program'
    and t.status in ('todo','doing');
  v_result:=jsonb_build_object('pass',to_jsonb(v_pass),'inventory_matched',false,
    'inventory_on_hand_changed',false);
  insert into public.repository_write_receipts(farm_id,operation_id,user_id,result)
  values(p_farm_id,p_operation_id,v_caller,v_result); return v_result;
end;
$$;

create function public.generate_due_program_items(
  p_farm_id uuid,
  p_operation_id uuid,
  p_local_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid:=auth.uid(); v_receipt_user uuid; v_result jsonb;
  v_task_count integer:=0; v_notification_count integer:=0;
begin
  if p_farm_id is null or p_operation_id is null or p_local_date is null or v_caller is null then
    raise exception 'farm ID, operation ID, local date, and authentication are required'; end if;
  if p_local_date<current_date-1 or p_local_date>current_date+1 then
    raise exception 'local date must be within one day of the server date'; end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_operation_id::text));
  select r.user_id,r.result into v_receipt_user,v_result from public.repository_write_receipts r
  where r.farm_id=p_farm_id and r.operation_id=p_operation_id;
  if found then if v_receipt_user<>v_caller then raise exception 'operation ID was already used by another user'; end if; return v_result; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext('program-due-items'));

  insert into public.farm_tasks(
    farm_id,title,details,status,priority,due_on,field_id,source,
    program_assigned_pass_id,program_cycle_key,created_by
  )
  select
    p_farm_id,
    left(pa.program_name_snapshot||' — '||ap.name||' — '||f.name,500),
    'Program pass due '||ap.due_on::text,
    'todo','normal',ap.due_on,ca.field_id,'program',ap.id,
    'due:'||ap.id::text||':'||ap.due_on::text,v_caller
  from public.assigned_program_passes ap
  join public.program_assignments pa on pa.id=ap.assignment_id and pa.farm_id=ap.farm_id
  join public.crop_assignments ca on ca.id=pa.crop_assignment_id and ca.farm_id=pa.farm_id
  join public.fields f on f.id=ca.field_id and f.farm_id=ca.farm_id
  where ap.farm_id=p_farm_id and pa.status='active' and ap.status='planned'
    and ap.due_on is not null and ap.due_on-ap.reminder_lead_days<=p_local_date
    and not exists(select 1 from public.farm_tasks t where t.farm_id=p_farm_id
      and t.program_assigned_pass_id=ap.id and t.source='program' and t.status in ('todo','doing'))
  on conflict(farm_id,program_assigned_pass_id,program_cycle_key)
    where program_cycle_key is not null do nothing;
  get diagnostics v_task_count=row_count;

  insert into public.notifications(
    farm_id,user_id,category,title,body,link,dedupe_key,created_by
  )
  select
    p_farm_id,owner.user_id,
    case when ap.activity_type='spray' then 'spray' else 'task' end,
    left(pa.program_name_snapshot||' — '||ap.name||' due',160),
    left(pa.program_name_snapshot||' — '||ap.name||' — '||f.name||' is due '||ap.due_on::text,500),
    '/programs?pass='||ap.id::text,
    'program:'||ap.id::text||':due:'||ap.due_on::text,
    v_caller
  from public.assigned_program_passes ap
  join public.program_assignments pa on pa.id=ap.assignment_id and pa.farm_id=ap.farm_id
  join public.crop_assignments ca on ca.id=pa.crop_assignment_id and ca.farm_id=pa.farm_id
  join public.fields f on f.id=ca.field_id and f.farm_id=ca.farm_id
  join lateral(
    select fm.user_id from public.farm_memberships fm
    where fm.farm_id=p_farm_id and fm.role='owner' and fm.status='active'
    order by fm.user_id limit 1
  ) owner on true
  where ap.farm_id=p_farm_id and pa.status='active' and ap.status='planned'
    and ap.due_on is not null and ap.due_on-ap.reminder_lead_days<=p_local_date
  on conflict(farm_id,user_id,dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_notification_count=row_count;
  v_result:=jsonb_build_object('task_created_count',v_task_count,
    'notification_created_count',v_notification_count,'local_date',p_local_date);
  insert into public.repository_write_receipts(farm_id,operation_id,user_id,result)
  values(p_farm_id,p_operation_id,v_caller,v_result); return v_result;
end;
$$;

revoke all on function public.save_program(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.save_program_pass(uuid,uuid,uuid,jsonb,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.reorder_program_passes(uuid,uuid,uuid,uuid[]) from public,anon,authenticated;
revoke all on function public.delete_program_pass(uuid,uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.delete_program(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.assign_program(uuid,uuid,uuid,uuid[]) from public,anon,authenticated;
revoke all on function public.reassign_program_assignment(uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.refresh_program_assignment(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.reschedule_program_pass(uuid,uuid,uuid,date,text) from public,anon,authenticated;
revoke all on function public.mark_program_pass_applied(uuid,uuid,uuid,date,numeric,jsonb,uuid,boolean) from public,anon,authenticated;
revoke all on function public.skip_program_pass(uuid,uuid,uuid,date,text) from public,anon,authenticated;
revoke all on function public.unassign_program(uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.generate_due_program_items(uuid,uuid,date) from public,anon,authenticated;

grant execute on function public.save_program(uuid,uuid,jsonb) to authenticated;
grant execute on function public.save_program_pass(uuid,uuid,uuid,jsonb,jsonb,uuid) to authenticated;
grant execute on function public.reorder_program_passes(uuid,uuid,uuid,uuid[]) to authenticated;
grant execute on function public.delete_program_pass(uuid,uuid,uuid,uuid) to authenticated;
grant execute on function public.delete_program(uuid,uuid,uuid) to authenticated;
grant execute on function public.assign_program(uuid,uuid,uuid,uuid[]) to authenticated;
grant execute on function public.reassign_program_assignment(uuid,uuid,uuid,uuid,text) to authenticated;
grant execute on function public.refresh_program_assignment(uuid,uuid,uuid) to authenticated;
grant execute on function public.reschedule_program_pass(uuid,uuid,uuid,date,text) to authenticated;
grant execute on function public.mark_program_pass_applied(uuid,uuid,uuid,date,numeric,jsonb,uuid,boolean) to authenticated;
grant execute on function public.skip_program_pass(uuid,uuid,uuid,date,text) to authenticated;
grant execute on function public.unassign_program(uuid,uuid,uuid,text) to authenticated;
grant execute on function public.generate_due_program_items(uuid,uuid,date) to authenticated;
