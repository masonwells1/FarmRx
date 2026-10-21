-- A deleted Field Log entry stays deleted.
--
-- save_field_log_entry inserts an entry whose id it does not find, so an edit saved after
-- another device (or another tab) deleted the entry used to bring it back. The usual way in
-- is an edit queued without signal that replays after the delete went through.
--
-- Every deleted entry's id is now remembered, and an insert of a remembered id is refused, as
-- is a repeat of an earlier save whose entry has been deleted since (save_field_log_entry
-- would otherwise answer it from its receipt, with the old row).
-- Both are row triggers on field_log_entries, so they apply to the save and delete functions,
-- direct table writes, and entries removed with their field; an entry's id can no longer
-- change, which would get around both. Ids deleted before this migration are filled in from
-- the save receipts. New entries carry new ids and insert as before.
--
-- The client needs nothing from this migration: until it is applied, saves behave as they
-- always did; once it is, the refusal is an ordinary P0001 that a queued replay parks in
-- Needs attention.
--
-- Known limits, both outside what the app does: a direct table insert is not serialized
-- against a delete of the same id that has not committed yet (the save function is, by its
-- entry lock); and remembering a delete takes a key-share lock on the farm row, so an entry
-- delete racing an admin deleting that same farm can deadlock, which Postgres resolves by
-- cancelling one of them.

create table public.field_log_deleted_entries (
  entry_id uuid primary key,
  farm_id uuid not null,
  deleted_at timestamptz not null default now(),
  constraint field_log_deleted_entries_farm_fk
    foreign key (farm_id)
    references public.farms(id)
    on delete cascade
);

create index field_log_deleted_entries_farm_idx
  on public.field_log_deleted_entries (farm_id);

-- Only the trigger functions below touch this table; no client role reads or writes it.
alter table public.field_log_deleted_entries enable row level security;

revoke all on table public.field_log_deleted_entries
  from public, anon, authenticated;

create function public.remember_deleted_field_log_entry()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- A farm being deleted takes its entries and its remembered ids with it; there is nothing
  -- left to protect, so nothing is remembered (and no row is left pointing at the farm).
  if exists (select 1 from public.farms f where f.id = old.farm_id) then
    insert into public.field_log_deleted_entries (entry_id, farm_id)
    values (old.id, old.farm_id)
    on conflict (entry_id) do nothing;
  end if;
  return old;
end;
$$;

create function public.refuse_deleted_field_log_entry()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE' then
    -- An entry keeps its id: a changed id could make a remembered id live again, or let the
    -- old id go without being remembered.
    if new.id is distinct from old.id then
      raise exception 'field log entry id cannot change';
    end if;
    return new;
  end if;
  if exists (
    select 1
    from public.field_log_deleted_entries d
    where d.entry_id = new.id
  ) then
    raise exception 'field log entry was deleted and cannot be saved again';
  end if;
  return new;
end;
$$;

revoke all on function public.remember_deleted_field_log_entry()
  from public, anon, authenticated;
revoke all on function public.refuse_deleted_field_log_entry()
  from public, anon, authenticated;

create trigger field_log_entries_remember_delete
after delete on public.field_log_entries
for each row execute function public.remember_deleted_field_log_entry();

create trigger field_log_entries_refuse_deleted
before insert or update of id on public.field_log_entries
for each row execute function public.refuse_deleted_field_log_entry();

-- Entries deleted before this migration: every save through save_field_log_entry wrote the
-- saved row into its receipt, so a Field Log receipt whose entry is gone names a deleted entry.
-- (Rows written without the function, such as seeds, have no receipt and are not covered.)
-- This runs after the two triggers above are installed: creating them locked field_log_entries
-- against writes until this migration commits, so a delete that finished earlier is found here
-- and one that comes later fires the remember trigger; none falls between the two. It runs
-- before the access-epoch guard below is attached, as the migration has no farm request context.
insert into public.field_log_deleted_entries (entry_id, farm_id)
select distinct (r.result ->> 'id')::uuid, r.farm_id
from public.repository_write_receipts r
where r.result ?& array['id', 'field_id', 'entry_type', 'observed_on', 'rainfall_in', 'note']
  and r.result ->> 'entry_type' in ('rainfall', 'note')
  and exists (select 1 from public.farms f where f.id = r.farm_id)
  and not exists (
    select 1 from public.field_log_entries e where e.id = (r.result ->> 'id')::uuid
  )
on conflict (entry_id) do nothing;

-- Access-epoch fencing (migration 0040): every farm-scoped table carries the row guard. A row is
-- only ever written here by the delete that the guard on field_log_entries already let through.
create trigger farm_access_epoch_guard
before insert or update or delete on public.field_log_deleted_entries
for each row execute function public.guard_row_farm_access_epoch();

-- save_field_log_entry as migration 0019 created it (never redefined since), with one change in
-- the receipt branch: a repeat of a save whose entry was deleted since is refused rather than
-- answered with the receipt's old row. CREATE OR REPLACE keeps the function's owner and grants.
create or replace function public.save_field_log_entry(
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
    -- An entry deleted since this save is refused like any other save of a deleted entry.
    -- Answering with the receipt's old row would put the entry back on a device that sent
    -- the save again after losing the response. The entry lock (the one delete_field_log_entry
    -- and the save below take) comes first, so a delete still in progress finishes, and its
    -- remembered id becomes visible, before the check.
    if (v_result ->> 'id') is not null then
      perform pg_advisory_xact_lock(
        hashtext('field-log-entry'),
        hashtext(p_farm_id::text || ':' || (v_result ->> 'id'))
      );
    end if;
    if exists (
      select 1
      from public.field_log_deleted_entries d
      where d.entry_id::text = v_result ->> 'id'
    ) then
      raise exception 'field log entry was deleted and cannot be saved again';
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
