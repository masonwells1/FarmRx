-- A deleted Field Log entry stays deleted.
--
-- save_field_log_entry inserts an entry whose id it does not find, so an edit saved after
-- another device (or another tab) deleted the entry used to bring it back. The usual way in
-- is an edit queued without signal that replays after the delete went through.
--
-- From here on every deleted entry's id is remembered, and an insert of a remembered id is
-- refused. Both are row triggers, so they hold for every path: the save and delete functions,
-- direct table writes, and entries removed with their field. New entries carry new ids and
-- insert as before. The client needs nothing from this migration: until it is applied, saves
-- behave as they always did; once it is, the refusal is an ordinary P0001 that a queued replay
-- parks in Needs attention.

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

-- Only the two trigger functions below touch this table; no client role reads or writes it.
alter table public.field_log_deleted_entries enable row level security;

revoke all on table public.field_log_deleted_entries
  from public, anon, authenticated;

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
before insert on public.field_log_entries
for each row execute function public.refuse_deleted_field_log_entry();
