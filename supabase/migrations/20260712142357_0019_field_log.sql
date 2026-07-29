-- DRAFT ONLY -- Rain gauge and field log storage for Farm Rx.
-- Additive and safe to review immediately after applied migration 0018: this
-- creates one new farm-owned table, its policies/triggers/indexes, and two new
-- RPCs without changing any object created by 0001-0018.
--
-- The RPCs are SECURITY DEFINER and use advisory transaction locks rather than
-- SELECT ... FOR UPDATE. This follows the 0017 lesson: invoker-visible row locks
-- can be silently filtered by RLS when the caller may insert/delete but may not
-- update the selected row. The fixed search path, explicit auth/can_edit_farm
-- gates, and farm-scoped statements keep these definer paths narrow.
--
-- Access mirrors inventory exactly: can_access_farm permits active members plus
-- a named rep only while share_with_rep and that rep's enabled, unrevoked access
-- are both present; can_edit_farm permits active owner/manager/worker members
-- and excludes read_only members and reps.

create table public.field_log_entries (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  field_id uuid not null,
  entry_type text not null check (entry_type in ('rainfall', 'note')),
  observed_on date not null check (observed_on <= current_date + 1),
  rainfall_in numeric(6, 2)
    check (rainfall_in is null or rainfall_in between 0 and 100),
  note text check (note is null or char_length(note) <= 500),
  -- Deliberately a plain UUID provenance stamp, not a membership/auth foreign
  -- key: retaining a field-log entry must never block membership removal.
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint field_log_entries_field_farm_fk
    foreign key (field_id, farm_id)
    references public.fields(id, farm_id)
    on delete cascade,
  constraint field_log_entries_type_fields check (
    (
      entry_type = 'rainfall'
      and rainfall_in is not null
      and (note is null or char_length(btrim(note)) >= 1)
    )
    or (
      entry_type = 'note'
      and rainfall_in is null
      and note is not null
      and char_length(btrim(note)) >= 1
    )
  )
);

create index field_log_entries_farm_field_observed_idx
  on public.field_log_entries (farm_id, field_id, observed_on);
create index field_log_entries_farm_id_idx
  on public.field_log_entries (farm_id);

create trigger field_log_entries_set_updated_at
before update on public.field_log_entries
for each row execute function public.set_updated_at();

create trigger field_log_entries_prevent_farm_move
before update on public.field_log_entries
for each row execute function public.prevent_farm_id_change();

alter table public.field_log_entries enable row level security;

revoke all on table public.field_log_entries
  from public, anon, authenticated;
grant select, insert, update, delete on table public.field_log_entries
  to authenticated;

create policy field_log_entries_select
on public.field_log_entries for select to authenticated
using (public.can_access_farm(farm_id));

create policy field_log_entries_insert
on public.field_log_entries for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and created_by = auth.uid()
);

create policy field_log_entries_update
on public.field_log_entries for update to authenticated
using (public.can_edit_farm(farm_id))
with check (public.can_edit_farm(farm_id));

create policy field_log_entries_delete
on public.field_log_entries for delete to authenticated
using (public.can_edit_farm(farm_id));

create function public.save_field_log_entry(
  p_farm_id uuid,
  p_operation_id uuid,
  p_entry jsonb
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
  v_entry_id uuid;
  v_field_id uuid;
  v_entry_type text;
  v_observed_on date;
  v_rainfall_in numeric;
  v_note text;
  v_existing public.field_log_entries%rowtype;
  v_saved public.field_log_entries%rowtype;
begin
  if p_farm_id is null or p_operation_id is null then
    raise exception 'farm ID and operation ID are required';
  end if;

  if v_caller is null then
    raise exception 'authentication is required';
  end if;

  if not public.can_edit_farm(p_farm_id) then
    raise exception 'you do not have permission to edit this farm';
  end if;

  if jsonb_typeof(p_entry) is distinct from 'object' then
    raise exception 'field log entry must be a JSON object';
  end if;

  -- Serialize every replay before reading its durable receipt. This closes the
  -- concurrent lost-response replay race in the same way as save_field_bundle.
  perform pg_advisory_xact_lock(
    hashtext(p_farm_id::text),
    hashtext(p_operation_id::text)
  );

  select r.user_id, r.result
    into v_receipt_user, v_result
  from public.repository_write_receipts r
  where r.farm_id = p_farm_id
    and r.operation_id = p_operation_id;

  if found then
    if v_receipt_user <> v_caller then
      raise exception 'operation ID was already used by another user';
    end if;
    return v_result;
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_entry) as k(key)
    where k.key not in (
      'id', 'field_id', 'entry_type', 'observed_on', 'rainfall_in', 'note'
    )
  ) then
    raise exception 'field log entry keys do not match the accepted contract';
  end if;

  if not (p_entry ? 'field_id')
    or not (p_entry ? 'entry_type')
    or not (p_entry ? 'observed_on')
    or jsonb_typeof(p_entry -> 'field_id') is distinct from 'string'
    or jsonb_typeof(p_entry -> 'entry_type') is distinct from 'string'
    or jsonb_typeof(p_entry -> 'observed_on') is distinct from 'string'
    or coalesce(jsonb_typeof(p_entry -> 'id'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_entry -> 'rainfall_in'), 'null') not in ('number', 'null')
    or coalesce(jsonb_typeof(p_entry -> 'note'), 'null') not in ('string', 'null')
  then
    raise exception 'field log entry fields have invalid JSON types';
  end if;

  begin
    v_entry_id := nullif(p_entry ->> 'id', '')::uuid;
    v_field_id := (p_entry ->> 'field_id')::uuid;
    v_observed_on := (p_entry ->> 'observed_on')::date;
  exception
    when invalid_text_representation or datetime_field_overflow then
      raise exception 'field log entry IDs and observed date must be valid';
  end;

  v_entry_id := coalesce(v_entry_id, gen_random_uuid());
  v_entry_type := p_entry ->> 'entry_type';
  v_rainfall_in := (p_entry ->> 'rainfall_in')::numeric;
  v_note := p_entry ->> 'note';
  if v_note is not null then
    v_note := btrim(v_note);
    if v_note = '' then
      raise exception 'field log note must be non-empty when provided';
    end if;
  end if;

  if v_observed_on > current_date + 1 then
    raise exception 'observed date cannot be more than one day in the future';
  end if;

  if v_note is not null and char_length(v_note) > 500 then
    raise exception 'field log note cannot exceed 500 characters';
  end if;

  if v_entry_type = 'rainfall' then
    if v_rainfall_in is null then
      raise exception 'rainfall entries require a rainfall amount';
    end if;
    if v_rainfall_in < 0 or v_rainfall_in > 100 then
      raise exception 'rainfall amount must be between 0 and 100 inches';
    end if;
  elsif v_entry_type = 'note' then
    if v_rainfall_in is not null then
      raise exception 'note entries cannot include a rainfall amount';
    end if;
    if v_note is null then
      raise exception 'note entries require non-empty note text';
    end if;
  else
    raise exception 'entry type must be rainfall or note';
  end if;

  if not exists (
    select 1
    from public.fields f
    where f.id = v_field_id
      and f.farm_id = p_farm_id
  ) then
    raise exception 'field does not belong to this farm';
  end if;

  -- Distinct operation IDs targeting one entry serialize without an RLS-
  -- sensitive row lock. Delete uses the same entry lock.
  perform pg_advisory_xact_lock(
    hashtext('field-log-entry'),
    hashtext(p_farm_id::text || ':' || v_entry_id::text)
  );

  select e.*
    into v_existing
  from public.field_log_entries e
  where e.id = v_entry_id;

  if found then
    if v_existing.farm_id <> p_farm_id then
      raise exception 'field log entry does not belong to this farm';
    end if;
    if v_existing.field_id <> v_field_id then
      raise exception 'field log entry does not belong to the selected field';
    end if;

    update public.field_log_entries
    set
      entry_type = v_entry_type,
      observed_on = v_observed_on,
      rainfall_in = v_rainfall_in,
      note = v_note
    where id = v_entry_id
      and farm_id = p_farm_id
      and field_id = v_field_id
    returning * into strict v_saved;
  else
    insert into public.field_log_entries (
      id,
      farm_id,
      field_id,
      entry_type,
      observed_on,
      rainfall_in,
      note,
      created_by
    )
    values (
      v_entry_id,
      p_farm_id,
      v_field_id,
      v_entry_type,
      v_observed_on,
      v_rainfall_in,
      v_note,
      v_caller
    )
    returning * into v_saved;
  end if;

  v_result := to_jsonb(v_saved);

  insert into public.repository_write_receipts (
    farm_id,
    operation_id,
    user_id,
    result
  )
  values (
    p_farm_id,
    p_operation_id,
    v_caller,
    v_result
  );

  return v_result;
end;
$$;

create function public.delete_field_log_entry(
  p_farm_id uuid,
  p_entry_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
begin
  if p_farm_id is null or p_entry_id is null then
    raise exception 'farm ID and field log entry ID are required';
  end if;

  if v_caller is null then
    raise exception 'authentication is required';
  end if;

  if not public.can_edit_farm(p_farm_id) then
    raise exception 'you do not have permission to edit this farm';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('field-log-entry'),
    hashtext(p_farm_id::text || ':' || p_entry_id::text)
  );

  -- Farm-scoping prevents cross-farm deletion. An unknown ID, including one
  -- owned by another farm, intentionally has the same idempotent success shape.
  delete from public.field_log_entries
  where id = p_entry_id
    and farm_id = p_farm_id;

  return jsonb_build_object(
    'id', p_entry_id,
    'deleted', true
  );
end;
$$;

revoke all on function public.save_field_log_entry(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.delete_field_log_entry(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.save_field_log_entry(uuid, uuid, jsonb)
  to authenticated;
grant execute on function public.delete_field_log_entry(uuid, uuid)
  to authenticated;
