-- DRAFT ONLY -- Module 1 Row Level Security (RLS) for Farm Rx.
-- RLS means PostgreSQL checks every row against the signed-in user.
-- This file maps the 12 rules from docs/crx-engines.md section 3.5.

-- Rules 2, 3, 4, and 12: access is recalculated from active membership or
-- an enabled named-rep grant every time a policy is evaluated. A broad app
-- role is never sufficient. The farm toggle alone is never sufficient.
create function public.is_active_farm_member(target_farm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.farm_memberships fm
      where fm.farm_id = target_farm_id
        and fm.user_id = auth.uid()
        and fm.status = 'active'
    );
$$;

create function public.can_edit_farm(target_farm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.farm_memberships fm
      where fm.farm_id = target_farm_id
        and fm.user_id = auth.uid()
        and fm.status = 'active'
        and fm.role in ('owner', 'manager', 'worker')
    );
$$;

create function public.can_manage_farm(target_farm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.farm_memberships fm
      where fm.farm_id = target_farm_id
        and fm.user_id = auth.uid()
        and fm.status = 'active'
        and fm.role in ('owner', 'manager')
    );
$$;

create function public.has_explicit_rep_access(target_farm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and exists (
      select 1
      from public.farms f
      join public.farm_rep_access fra
        on fra.farm_id = f.id
      where f.id = target_farm_id
        and f.share_with_rep = true
        and fra.rep_user_id = auth.uid()
        and fra.enabled = true
        and fra.revoked_at is null
    );
$$;

create function public.can_access_farm(target_farm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.is_active_farm_member(target_farm_id)
    or public.has_explicit_rep_access(target_farm_id);
$$;

-- Rule 7: bootstrap binds the owner identity to auth.uid(); callers cannot
-- choose somebody else. All SECURITY DEFINER functions have a fixed search
-- path and are unavailable to PUBLIC and anonymous users.
create function public.bootstrap_farm_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null or new.created_by <> auth.uid() then
    raise exception 'farm creator must be the signed-in user';
  end if;

  insert into public.farm_memberships (farm_id, user_id, role, status)
  values (new.id, auth.uid(), 'owner', 'active');

  return new;
end;
$$;

create trigger farms_bootstrap_owner_membership
after insert on public.farms
for each row execute function public.bootstrap_farm_owner_membership();

revoke all on function public.is_active_farm_member(uuid) from public, anon;
revoke all on function public.can_edit_farm(uuid) from public, anon;
revoke all on function public.can_manage_farm(uuid) from public, anon;
revoke all on function public.has_explicit_rep_access(uuid) from public, anon;
revoke all on function public.can_access_farm(uuid) from public, anon;
revoke all on function public.bootstrap_farm_owner_membership() from public, anon;

grant execute on function public.is_active_farm_member(uuid) to authenticated;
grant execute on function public.can_edit_farm(uuid) to authenticated;
grant execute on function public.can_manage_farm(uuid) to authenticated;
grant execute on function public.has_explicit_rep_access(uuid) to authenticated;
grant execute on function public.can_access_farm(uuid) to authenticated;
-- Trigger execution does not require a direct grant.

-- Rule 1: all tenant child tables have NOT NULL farm_id in 0001. farms is the
-- tenant root, so its own id is the farm boundary. commodities is deliberately
-- global and contains lookup labels only, never farm data.
alter table public.farms enable row level security;
alter table public.farm_memberships enable row level security;
alter table public.farm_rep_access enable row level security;
alter table public.entities enable row level security;
alter table public.fields enable row level security;
alter table public.commodities enable row level security;
alter table public.crop_assignments enable row level security;
alter table public.arrangements enable row level security;

revoke all on table public.farms from anon;
revoke all on table public.farm_memberships from anon;
revoke all on table public.farm_rep_access from anon;
revoke all on table public.entities from anon;
revoke all on table public.fields from anon;
revoke all on table public.commodities from anon;
revoke all on table public.crop_assignments from anon;
revoke all on table public.arrangements from anon;

grant select, insert, update on table public.farms to authenticated;
grant select, insert, update, delete on table public.farm_memberships to authenticated;
grant select, insert, update, delete on table public.farm_rep_access to authenticated;
grant select, insert, update, delete on table public.entities to authenticated;
grant select, insert, update, delete on table public.fields to authenticated;
grant select on table public.commodities to authenticated;
grant select, insert, update, delete on table public.crop_assignments to authenticated;
grant select, insert, update, delete on table public.arrangements to authenticated;

create policy farms_select
on public.farms for select to authenticated
using (public.can_access_farm(id));

create policy farms_insert
on public.farms for insert to authenticated
with check (auth.uid() is not null and created_by = auth.uid() and share_with_rep = false);

-- Rule 6: updates evaluate both the old row (USING) and proposed row
-- (WITH CHECK). Farm IDs on child tables are also immutable by trigger.
create policy farms_update
on public.farms for update to authenticated
using (public.can_manage_farm(id))
with check (public.can_manage_farm(id));

-- Membership rosters are visible only to active members of that farm. A rep
-- grant does not expose the member list.
create policy farm_memberships_select
on public.farm_memberships for select to authenticated
using (public.is_active_farm_member(farm_id));

create policy farm_memberships_insert
on public.farm_memberships for insert to authenticated
with check (public.can_manage_farm(farm_id));

create policy farm_memberships_update
on public.farm_memberships for update to authenticated
using (public.can_manage_farm(farm_id))
with check (public.can_manage_farm(farm_id));

create policy farm_memberships_delete
on public.farm_memberships for delete to authenticated
using (public.can_manage_farm(farm_id));

-- Farm managers can administer grants. A rep can see only their own grant
-- record, which does not by itself reveal any farm rows.
create policy farm_rep_access_select
on public.farm_rep_access for select to authenticated
using (
  public.can_manage_farm(farm_id)
  or rep_user_id = auth.uid()
);

create policy farm_rep_access_insert
on public.farm_rep_access for insert to authenticated
with check (
  public.can_manage_farm(farm_id)
  and granted_by = auth.uid()
);

create policy farm_rep_access_update
on public.farm_rep_access for update to authenticated
using (public.can_manage_farm(farm_id))
with check (public.can_manage_farm(farm_id));

create policy farm_rep_access_delete
on public.farm_rep_access for delete to authenticated
using (public.can_manage_farm(farm_id));

create policy entities_select
on public.entities for select to authenticated
using (public.can_access_farm(farm_id));

create policy entities_insert
on public.entities for insert to authenticated
with check (public.can_edit_farm(farm_id));

create policy entities_update
on public.entities for update to authenticated
using (public.can_edit_farm(farm_id))
with check (public.can_edit_farm(farm_id));

create policy entities_delete
on public.entities for delete to authenticated
using (public.can_edit_farm(farm_id));

create policy fields_select
on public.fields for select to authenticated
using (
  public.can_access_farm(farm_id)
  and exists (
    select 1
    from public.entities e
    where e.id = operating_entity_id
      and e.farm_id = fields.farm_id
  )
);

create policy fields_insert
on public.fields for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and exists (
    select 1
    from public.entities e
    where e.id = operating_entity_id
      and e.farm_id = fields.farm_id
  )
);

create policy fields_update
on public.fields for update to authenticated
using (
  public.can_edit_farm(farm_id)
  and exists (
    select 1
    from public.entities e
    where e.id = operating_entity_id
      and e.farm_id = fields.farm_id
  )
)
with check (
  public.can_edit_farm(farm_id)
  and exists (
    select 1
    from public.entities e
    where e.id = operating_entity_id
      and e.farm_id = fields.farm_id
  )
);

create policy fields_delete
on public.fields for delete to authenticated
using (
  public.can_edit_farm(farm_id)
  and exists (
    select 1
    from public.entities e
    where e.id = operating_entity_id
      and e.farm_id = fields.farm_id
  )
);

-- The commodity catalog is safe to share because it contains only crop names
-- and traits. Grain positions, prices, yields, contracts, and financial data
-- must remain in farm-scoped tables and are private by default.
create policy commodities_select
on public.commodities for select to authenticated
using (true);

-- Rule 5 and Rule 10: every child policy confirms that the supplied parent ID
-- belongs to the same farm. Composite foreign keys in 0001 enforce the same
-- boundary even outside RLS.
create policy crop_assignments_select
on public.crop_assignments for select to authenticated
using (
  public.can_access_farm(farm_id)
  and exists (
    select 1
    from public.fields f
    where f.id = field_id
      and f.farm_id = crop_assignments.farm_id
  )
);

create policy crop_assignments_insert
on public.crop_assignments for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and exists (
    select 1
    from public.fields f
    where f.id = field_id
      and f.farm_id = crop_assignments.farm_id
  )
);

create policy crop_assignments_update
on public.crop_assignments for update to authenticated
using (
  public.can_edit_farm(farm_id)
  and exists (
    select 1
    from public.fields f
    where f.id = field_id
      and f.farm_id = crop_assignments.farm_id
  )
)
with check (
  public.can_edit_farm(farm_id)
  and exists (
    select 1
    from public.fields f
    where f.id = field_id
      and f.farm_id = crop_assignments.farm_id
  )
);

create policy crop_assignments_delete
on public.crop_assignments for delete to authenticated
using (
  public.can_edit_farm(farm_id)
  and exists (
    select 1
    from public.fields f
    where f.id = field_id
      and f.farm_id = crop_assignments.farm_id
  )
);

create policy arrangements_select
on public.arrangements for select to authenticated
using (
  public.can_access_farm(farm_id)
  and exists (
    select 1
    from public.fields f
    where f.id = field_id
      and f.farm_id = arrangements.farm_id
  )
);

create policy arrangements_insert
on public.arrangements for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and exists (
    select 1
    from public.fields f
    where f.id = field_id
      and f.farm_id = arrangements.farm_id
  )
);

create policy arrangements_update
on public.arrangements for update to authenticated
using (
  public.can_edit_farm(farm_id)
  and exists (
    select 1
    from public.fields f
    where f.id = field_id
      and f.farm_id = arrangements.farm_id
  )
)
with check (
  public.can_edit_farm(farm_id)
  and exists (
    select 1
    from public.fields f
    where f.id = field_id
      and f.farm_id = arrangements.farm_id
  )
);

create policy arrangements_delete
on public.arrangements for delete to authenticated
using (
  public.can_edit_farm(farm_id)
  and exists (
    select 1
    from public.fields f
    where f.id = field_id
      and f.farm_id = arrangements.farm_id
  )
);

-- Rule 8: Module 1 creates no tenant-facing views. Any future tenant view must
-- be declared WITH (security_invoker = true), so its underlying RLS still runs.

-- Rule 9: storage objects must use farm_id as the first path segment, for
-- example: <farm_id>/field-documents/lease.pdf. These policies are added only
-- when running inside Supabase, where storage.objects exists. No bucket is
-- created here; that remains an explicit deployment decision.
do $storage_policies$
begin
  if to_regclass('storage.objects') is not null then
    execute $policy$
      create policy farm_files_select
      on storage.objects for select to authenticated
      using (
        bucket_id = 'farm-rx'
        and exists (
          select 1
          from public.farms f
          where f.id::text = split_part(name, '/', 1)
            and public.can_access_farm(f.id)
        )
      )
    $policy$;

    execute $policy$
      create policy farm_files_insert
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'farm-rx'
        and exists (
          select 1
          from public.farms f
          where f.id::text = split_part(name, '/', 1)
            and public.can_edit_farm(f.id)
        )
      )
    $policy$;

    execute $policy$
      create policy farm_files_update
      on storage.objects for update to authenticated
      using (
        bucket_id = 'farm-rx'
        and exists (
          select 1
          from public.farms f
          where f.id::text = split_part(name, '/', 1)
            and public.can_edit_farm(f.id)
        )
      )
      with check (
        bucket_id = 'farm-rx'
        and exists (
          select 1
          from public.farms f
          where f.id::text = split_part(name, '/', 1)
            and public.can_edit_farm(f.id)
        )
      )
    $policy$;

    execute $policy$
      create policy farm_files_delete
      on storage.objects for delete to authenticated
      using (
        bucket_id = 'farm-rx'
        and exists (
          select 1
          from public.farms f
          where f.id::text = split_part(name, '/', 1)
            and public.can_edit_farm(f.id)
        )
      )
    $policy$;
  end if;
end;
$storage_policies$;

-- Rule 11: Module 1 contains no spray/compliance tables. When Module 3 adds
-- them, its migration must use append-only corrections or a restricted audited
-- update function; no unrestricted direct UPDATE policy is permitted.
