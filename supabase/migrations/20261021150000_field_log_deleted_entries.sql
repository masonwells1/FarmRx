-- A deleted Field Log entry stays deleted.
--
-- save_field_log_entry inserts an entry whose id it does not find, so an edit saved after
-- another device (or another tab) deleted the entry used to bring it back. The usual way in
-- is an edit queued without signal that replays after the delete went through.
--
-- Every deleted entry's id is now remembered, and an insert of a remembered id is refused.
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

-- Entries deleted before this migration: every save through save_field_log_entry wrote the
-- saved row into its receipt, so a Field Log receipt whose entry is gone names a deleted entry.
-- (Rows written without the function, such as seeds, have no receipt and are not covered.)
-- This runs before the access-epoch guard below is attached, as the migration has no farm
-- request context.
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
