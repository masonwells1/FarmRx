-- Close stale-client writes across revoke/regrant cycles. PostgreSQL owns a
-- monotonically increasing epoch for every user/farm relationship. Browser
-- writes must present the exact current epoch in x-farm-rx-access-epochs;
-- checking only can_access_farm() is insufficient after access is re-granted.

create table public.farm_access_epochs (
  farm_id uuid not null references public.farms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_epoch bigint not null default 1 check (access_epoch >= 1),
  updated_at timestamptz not null default now(),
  primary key (farm_id, user_id)
);

create index farm_access_epochs_user_farm_idx
on public.farm_access_epochs (user_id, farm_id);

insert into public.farm_access_epochs (farm_id, user_id, access_epoch)
select membership.farm_id, membership.user_id, 1
from public.farm_memberships membership
union
select access.farm_id, access.rep_user_id, 1
from public.farm_rep_access access
on conflict (farm_id, user_id) do nothing;

alter table public.farm_access_epochs enable row level security;
revoke all on table public.farm_access_epochs
from public, anon, authenticated, service_role;

create function public.bump_farm_access_epoch(target_farm_id uuid, target_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if target_farm_id is null or target_user_id is null then
    raise exception 'farm access epoch requires a farm and user';
  end if;

  -- Cascading deletion of a farm or auth user does not need a new epoch and
  -- must not recreate a row that its foreign key is already removing.
  if not exists (select 1 from public.farms where id = target_farm_id)
    or not exists (select 1 from auth.users where id = target_user_id) then
    return;
  end if;

  insert into public.farm_access_epochs (farm_id, user_id, access_epoch, updated_at)
  values (target_farm_id, target_user_id, 1, now())
  on conflict (farm_id, user_id) do update
  set access_epoch = public.farm_access_epochs.access_epoch + 1,
      updated_at = now();
end;
$$;

create function public.current_request_farm_access_epoch(target_farm_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_headers_text text := nullif(current_setting('request.headers', true), '');
  v_epochs_text text;
  v_epochs jsonb;
  v_epoch_text text;
begin
  if target_farm_id is null or v_headers_text is null then return null; end if;

  begin
    v_epochs_text := v_headers_text::jsonb ->> 'x-farm-rx-access-epochs';
    if v_epochs_text is null then return null; end if;
    v_epochs := v_epochs_text::jsonb;
  exception
    when others then return null;
  end;

  if jsonb_typeof(v_epochs) <> 'object' then return null; end if;
  v_epoch_text := v_epochs ->> target_farm_id::text;
  if v_epoch_text is null or v_epoch_text !~ '^[1-9][0-9]{0,18}$' then return null; end if;

  begin
    return v_epoch_text::bigint;
  exception
    when numeric_value_out_of_range then return null;
  end;
end;
$$;

create function public.current_request_expected_user_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_headers_text text := nullif(current_setting('request.headers', true), '');
  v_user_text text;
begin
  if v_headers_text is null then return null; end if;
  begin
    v_user_text := v_headers_text::jsonb ->> 'x-farm-rx-expected-user-id';
    if v_user_text is null
      or v_user_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return null;
    end if;
    return v_user_text::uuid;
  exception
    when others then return null;
  end;
end;
$$;

create function public.assert_current_farm_access_epoch(target_farm_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_expected_user_id uuid;
  v_presented bigint;
  v_current bigint;
begin
  -- Server-owned schedulers and delivery workers do not use a browser access
  -- snapshot. Their service-role claim is independently checked at each RPC.
  if public.request_uses_service_role() then return; end if;

  v_expected_user_id := public.current_request_expected_user_id();

  if v_user_id is null or v_expected_user_id is distinct from v_user_id or target_farm_id is null then
    raise exception using errcode = 'P0001', message = 'FARM_ACCESS_EPOCH_CHANGED';
  end if;

  v_presented := public.current_request_farm_access_epoch(target_farm_id);

  -- The row lock linearizes an in-flight write against a concurrent revoke or
  -- re-grant. Whichever transaction obtains this row first defines the order.
  select epoch.access_epoch into v_current
  from public.farm_access_epochs epoch
  where epoch.farm_id = target_farm_id and epoch.user_id = v_user_id
  for share;

  if v_current is null
    or v_presented is distinct from v_current
    or not public.can_access_farm(target_farm_id) then
    raise exception using errcode = 'P0001', message = 'FARM_ACCESS_EPOCH_CHANGED';
  end if;
end;
$$;

create function public.get_current_farm_access_epochs()
returns table(farm_id uuid, access_epoch bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select epoch.farm_id, epoch.access_epoch
  from public.farm_access_epochs epoch
  where epoch.user_id = auth.uid()
    and public.can_access_farm(epoch.farm_id)
  order by epoch.farm_id;
$$;

create function public.guard_row_farm_access_epoch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_farm_id uuid;
  v_old_farm_id uuid;
begin
  v_farm_id := nullif(v_row ->> 'farm_id', '')::uuid;

  -- The owner membership is created by the farm bootstrap trigger before an
  -- epoch row exists. This is the sole authenticated bootstrap exception.
  if tg_table_name = 'farm_memberships' and tg_op = 'INSERT' then
    if nullif(v_row ->> 'user_id', '')::uuid = auth.uid()
      and not exists (
        select 1 from public.farm_access_epochs epoch
        where epoch.farm_id = v_farm_id
          and epoch.user_id = nullif(v_row ->> 'user_id', '')::uuid
      )
      and exists (
        select 1 from public.farms farm
        where farm.id = v_farm_id and farm.created_by = auth.uid()
      ) then
      return new;
    end if;
  end if;

  -- bootstrap_first_farm creates exactly one initial entity in the same
  -- transaction as its new owner farm. The browser cannot know that farm's
  -- epoch before the RPC returns. No later transaction or second entity can
  -- use this exception.
  if tg_table_name = 'entities' and tg_op = 'INSERT' and exists (
    select 1
    from public.farms farm
    join public.farm_access_epochs epoch
      on epoch.farm_id = farm.id and epoch.user_id = auth.uid()
    join public.farm_memberships membership
      on membership.farm_id = farm.id and membership.user_id = auth.uid()
    where farm.id = v_farm_id
      and farm.created_by = auth.uid()
      and farm.created_at = transaction_timestamp()
      and epoch.access_epoch = 1
      and membership.role = 'owner' and membership.status = 'active'
      and not exists (select 1 from public.entities entity where entity.farm_id = farm.id)
  ) then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_old_farm_id := nullif(to_jsonb(old) ->> 'farm_id', '')::uuid;
    if v_old_farm_id is distinct from v_farm_id then
      perform public.assert_current_farm_access_epoch(v_old_farm_id);
    end if;
  end if;
  perform public.assert_current_farm_access_epoch(v_farm_id);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function public.guard_farm_root_access_epoch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- Creating a farm is guarded by created_by = auth.uid() and the hardened
  -- bootstrap trigger. Existing farm roots require the captured epoch.
  if tg_op <> 'INSERT' then
    perform public.assert_current_farm_access_epoch(old.id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function public.guard_storage_object_farm_access_epoch()
returns trigger
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_bucket text := v_row ->> 'bucket_id';
  v_farm_text text := split_part(v_row ->> 'name', '/', 1);
  v_old_row jsonb;
  v_old_bucket text;
  v_old_farm_text text;
begin
  if tg_op = 'UPDATE' then
    v_old_row := to_jsonb(old);
    v_old_bucket := v_old_row ->> 'bucket_id';
    v_old_farm_text := split_part(v_old_row ->> 'name', '/', 1);
    if v_old_bucket in ('farm-rx', 'scouting-photos') then
      if v_old_farm_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception using errcode = 'P0001', message = 'FARM_ACCESS_EPOCH_CHANGED';
      end if;
      perform public.assert_current_farm_access_epoch(v_old_farm_text::uuid);
    end if;
  end if;
  if v_bucket in ('farm-rx', 'scouting-photos') then
    if v_farm_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode = 'P0001', message = 'FARM_ACCESS_EPOCH_CHANGED';
    end if;
    perform public.assert_current_farm_access_epoch(v_farm_text::uuid);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function public.bump_membership_access_epoch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
    and (old.farm_id, old.user_id) is distinct from (new.farm_id, new.user_id) then
    perform public.bump_farm_access_epoch(old.farm_id, old.user_id);
  end if;
  perform public.bump_farm_access_epoch(
    case when tg_op = 'DELETE' then old.farm_id else new.farm_id end,
    case when tg_op = 'DELETE' then old.user_id else new.user_id end
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function public.bump_rep_access_epoch()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
    and (old.farm_id, old.rep_user_id) is distinct from (new.farm_id, new.rep_user_id) then
    perform public.bump_farm_access_epoch(old.farm_id, old.rep_user_id);
  end if;
  perform public.bump_farm_access_epoch(
    case when tg_op = 'DELETE' then old.farm_id else new.farm_id end,
    case when tg_op = 'DELETE' then old.rep_user_id else new.rep_user_id end
  );
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create function public.bump_rep_epochs_for_farm_sharing()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
begin
  if old.share_with_rep is distinct from new.share_with_rep then
    for v_user_id in
      select access.rep_user_id from public.farm_rep_access access
      where access.farm_id = new.id
    loop
      perform public.bump_farm_access_epoch(new.id, v_user_id);
    end loop;
  end if;
  return new;
end;
$$;

-- Every current public base table with a farm_id receives the same transaction-
-- local guard, including writes performed from SECURITY DEFINER RPCs.
do $$
declare
  v_table record;
begin
  for v_table in
    select table_name
    from information_schema.columns
    where table_schema = 'public' and column_name = 'farm_id'
      and table_name <> 'farm_access_epochs'
      and exists (
        select 1 from pg_catalog.pg_class relation
        join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
        where namespace.nspname = 'public' and relation.relname = table_name
          and relation.relkind in ('r', 'p')
      )
    order by table_name
  loop
    execute format(
      'create trigger farm_access_epoch_guard before insert or update or delete on public.%I for each row execute function public.guard_row_farm_access_epoch()',
      v_table.table_name
    );
  end loop;
end;
$$;

create trigger farms_access_epoch_guard
before update or delete on public.farms
for each row execute function public.guard_farm_root_access_epoch();

create trigger farm_memberships_bump_access_epoch_insert_delete
after insert or delete on public.farm_memberships
for each row execute function public.bump_membership_access_epoch();

create trigger farm_memberships_bump_access_epoch_update
after update of farm_id, user_id, role, status, can_view_financials on public.farm_memberships
for each row execute function public.bump_membership_access_epoch();

create trigger farm_rep_access_bump_access_epoch_insert_delete
after insert or delete on public.farm_rep_access
for each row execute function public.bump_rep_access_epoch();

create trigger farm_rep_access_bump_access_epoch_update
after update of farm_id, rep_user_id, enabled, revoked_at on public.farm_rep_access
for each row execute function public.bump_rep_access_epoch();

create trigger farms_bump_rep_access_epochs
after update of share_with_rep on public.farms
for each row execute function public.bump_rep_epochs_for_farm_sharing();

do $$
begin
  if to_regclass('storage.objects') is not null then
    execute 'create trigger farm_access_epoch_guard before insert or update or delete on storage.objects for each row execute function public.guard_storage_object_farm_access_epoch()';
  end if;
end;
$$;

revoke all on function public.bump_farm_access_epoch(uuid, uuid),
  public.current_request_farm_access_epoch(uuid),
  public.current_request_expected_user_id(),
  public.assert_current_farm_access_epoch(uuid),
  public.get_current_farm_access_epochs(),
  public.guard_row_farm_access_epoch(),
  public.guard_farm_root_access_epoch(),
  public.guard_storage_object_farm_access_epoch(),
  public.bump_membership_access_epoch(),
  public.bump_rep_access_epoch(),
  public.bump_rep_epochs_for_farm_sharing()
from public, anon, authenticated, service_role;

grant execute on function public.get_current_farm_access_epochs()
to authenticated;
