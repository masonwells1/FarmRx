-- A removed farm no longer appears in get_current_farm_access_epochs(), but
-- the browser still needs the exact new epoch to fence already-known local
-- work. This RPC accepts one farm UUID and derives the user exclusively from
-- auth.uid(); it never exposes a list or accepts a caller-supplied user.
create function public.get_removed_farm_access_epoch(target_farm_id uuid)
returns table(farm_id uuid, access_epoch bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select epoch.farm_id, epoch.access_epoch
  from public.farm_access_epochs epoch
  where auth.uid() is not null
    and target_farm_id is not null
    and epoch.farm_id = target_farm_id
    and epoch.user_id = auth.uid()
    and not public.can_access_farm(target_farm_id)
    and (
      exists (
        select 1
        from public.farm_memberships membership
        where membership.farm_id = target_farm_id
          and membership.user_id = auth.uid()
          and membership.status in ('suspended', 'revoked')
      )
      or exists (
        select 1
        from public.farm_rep_access rep_access
        where rep_access.farm_id = target_farm_id
          and rep_access.rep_user_id = auth.uid()
          and rep_access.enabled = false
          and rep_access.revoked_at is not null
      )
    )
  limit 1;
$$;

revoke all on function public.get_removed_farm_access_epoch(uuid)
from public, anon, authenticated, service_role;

grant execute on function public.get_removed_farm_access_epoch(uuid)
to authenticated;
