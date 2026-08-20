-- A queued notification is not continuing authorization. Revalidate the
-- recipient's current farm relationship at the server-owned claim boundary so
-- a revoked member or rep never receives a previously queued private payload.

create function public.push_recipient_has_current_farm_access(
  p_farm_id uuid,
  p_user_id uuid
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_access_epoch bigint;
begin
  if not public.request_uses_service_role() then
    raise exception 'server delivery only';
  end if;

  if p_farm_id is null or p_user_id is null then
    return false;
  end if;

  -- Lock the recipient's access epoch through this claim transaction. A
  -- concurrent revoke/re-grant must serialize before or after this decision.
  select epoch.access_epoch
  into v_access_epoch
  from public.farm_access_epochs epoch
  where epoch.farm_id = p_farm_id
    and epoch.user_id = p_user_id
  for share;

  if v_access_epoch is null then
    return false;
  end if;

  return exists (
    select 1
    from public.farm_memberships membership
    where membership.farm_id = p_farm_id
      and membership.user_id = p_user_id
      and membership.status = 'active'
  ) or exists (
    select 1
    from public.farms farm
    join public.farm_rep_access access
      on access.farm_id = farm.id
    where farm.id = p_farm_id
      and farm.share_with_rep = true
      and access.rep_user_id = p_user_id
      and access.enabled = true
      and access.revoked_at is null
  );
end;
$$;

create or replace function public.claim_push_delivery_targets(
  p_notification_id uuid default null,
  p_limit integer default 100
)
returns table(
  target_id uuid,
  delivery_id uuid,
  notification_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  title text,
  body text,
  link text,
  category text,
  attempts integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_delivery_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit,100),250));
begin
  if not public.request_uses_service_role() then
    raise exception 'server delivery only';
  end if;

  -- Lock each not-yet-initialized delivery before snapshotting its current
  -- subscription set. Access is checked before any target is created.
  for v_delivery_id in
    select delivery.id
    from public.push_deliveries delivery
    where delivery.targets_initialized_at is null
      and delivery.status <> 'sent'
      and (p_notification_id is null or delivery.notification_id = p_notification_id)
    order by delivery.created_at, delivery.id
    for update skip locked
    limit v_limit
  loop
    insert into public.push_delivery_targets(delivery_id,subscription_id)
    select v_delivery_id, subscription.id
    from public.push_deliveries delivery
    join public.notifications notification
      on notification.id = delivery.notification_id
    join public.push_subscriptions subscription
      on subscription.user_id = notification.user_id
    where delivery.id = v_delivery_id
      and public.push_recipient_has_current_farm_access(notification.farm_id, notification.user_id)
    on conflict on constraint push_delivery_targets_delivery_subscription_key do nothing;

    update public.push_deliveries
    set targets_initialized_at = now(), updated_at = now()
    where id = v_delivery_id;
  end loop;

  -- A target may have been initialized while access was valid and claimed
  -- later. Make that stale target terminal before returning any payload.
  update public.push_delivery_targets target
  set status = 'gone',
      updated_at = now(),
      last_error = 'farm access removed'
  from public.push_deliveries delivery
  join public.notifications notification
    on notification.id = delivery.notification_id
  where target.delivery_id = delivery.id
    and target.status in ('pending','sending','failed')
    and (p_notification_id is null or delivery.notification_id = p_notification_id)
    and not public.push_recipient_has_current_farm_access(notification.farm_id, notification.user_id);

  update public.push_delivery_targets
  set status = 'gone', updated_at = now(), last_error = 'subscription removed'
  where subscription_id is null
    and status in ('pending','sending','failed');

  update public.push_deliveries delivery
  set status = 'sent',
      sent_at = coalesce(delivery.sent_at,now()),
      last_error = null,
      updated_at = now()
  where delivery.targets_initialized_at is not null
    and delivery.status <> 'sent'
    and (p_notification_id is null or delivery.notification_id = p_notification_id)
    and not exists (
      select 1
      from public.push_delivery_targets target
      where target.delivery_id = delivery.id
        and target.status not in ('sent','gone')
    );

  return query
  with claimed as (
    select target.id
    from public.push_delivery_targets target
    join public.push_deliveries delivery
      on delivery.id = target.delivery_id
    join public.notifications notification
      on notification.id = delivery.notification_id
    where delivery.status <> 'sent'
      and (p_notification_id is null or delivery.notification_id = p_notification_id)
      and target.subscription_id is not null
      and target.attempts < 10
      and public.push_recipient_has_current_farm_access(notification.farm_id, notification.user_id)
      and (
        (target.status = 'pending' and target.claimed_at is null)
        or (target.status in ('sending','failed') and target.claimed_at < now() - interval '5 minutes')
      )
    order by target.created_at, target.id
    for update of target skip locked
    limit v_limit
  ), updated as (
    update public.push_delivery_targets target
    set status = 'sending',
        attempts = target.attempts + 1,
        claimed_at = now(),
        updated_at = now()
    from claimed
    where target.id = claimed.id
    returning target.*
  )
  select updated.id,
    updated.delivery_id,
    delivery.notification_id,
    subscription.endpoint,
    subscription.p256dh,
    subscription.auth,
    notification.title,
    notification.body,
    notification.link,
    notification.category,
    updated.attempts
  from updated
  join public.push_deliveries delivery
    on delivery.id = updated.delivery_id
  join public.notifications notification
    on notification.id = delivery.notification_id
  join public.push_subscriptions subscription
    on subscription.id = updated.subscription_id
  order by updated.created_at, updated.id;

  update public.push_deliveries delivery
  set status = 'pending',
      claimed_at = now(),
      updated_at = now(),
      attempts = greatest(
        delivery.attempts,
        coalesce((
          select max(target.attempts)
          from public.push_delivery_targets target
          where target.delivery_id = delivery.id
        ), delivery.attempts)
      )
  where delivery.status <> 'sent'
    and (p_notification_id is null or delivery.notification_id = p_notification_id)
    and exists (
      select 1
      from public.push_delivery_targets target
      where target.delivery_id = delivery.id
        and target.status = 'sending'
    );
end;
$$;

-- A batch claim may return more targets than the Edge worker can send at once.
-- Revalidate each target immediately before provider I/O so a revoke committed
-- after the batch claim still suppresses prefetched work. This cannot recall a
-- provider request already accepted, but it closes the avoidable local window.
create function public.reconcile_push_delivery(p_delivery_id uuid, p_error text default null)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_delivery public.push_deliveries%rowtype;
begin
  select *
  into v_delivery
  from public.push_deliveries
  where id = p_delivery_id
  for update;

  if not found then
    raise exception 'push delivery not found';
  end if;

  update public.push_deliveries delivery
  set status = case
        when exists (
          select 1 from public.push_delivery_targets target
          where target.delivery_id = delivery.id
            and target.status = 'failed'
            and target.attempts >= 10
        ) then 'failed'
        when exists (
          select 1 from public.push_delivery_targets target
          where target.delivery_id = delivery.id
            and target.status not in ('sent','gone')
        ) then case
          when exists (
            select 1 from public.push_delivery_targets target
            where target.delivery_id = delivery.id
              and target.status = 'failed'
          ) then 'failed' else 'pending' end
        else 'sent'
      end,
      sent_at = case
        when not exists (
          select 1 from public.push_delivery_targets target
          where target.delivery_id = delivery.id
            and target.status not in ('sent','gone')
        ) then coalesce(delivery.sent_at, now()) else null end,
      last_error = case
        when exists (
          select 1 from public.push_delivery_targets target
          where target.delivery_id = delivery.id
            and target.status = 'failed'
        ) then left(coalesce(
          p_error,
          (select target.last_error
           from public.push_delivery_targets target
           where target.delivery_id = delivery.id
             and target.status = 'failed'
           order by target.updated_at desc, target.id
           limit 1),
          'push provider failure'
        ), 1000) else null end,
      updated_at = now()
  where delivery.id = p_delivery_id;
end;
$$;

create function public.revalidate_claimed_push_delivery_target(p_target_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_target public.push_delivery_targets%rowtype;
  v_farm_id uuid;
  v_user_id uuid;
begin
  if not public.request_uses_service_role() then
    raise exception 'server delivery only';
  end if;

  select *
  into v_target
  from public.push_delivery_targets
  where id = p_target_id
  for update;

  if not found then
    raise exception 'push delivery target not found';
  end if;
  if v_target.status <> 'sending' then
    return false;
  end if;

  select notification.farm_id, notification.user_id
  into v_farm_id, v_user_id
  from public.push_deliveries delivery
  join public.notifications notification
    on notification.id = delivery.notification_id
  where delivery.id = v_target.delivery_id;

  if public.push_recipient_has_current_farm_access(v_farm_id, v_user_id) then
    return true;
  end if;

  update public.push_delivery_targets
  set status = 'gone',
      updated_at = now(),
      last_error = 'farm access removed'
  where id = p_target_id;

  perform public.reconcile_push_delivery(v_target.delivery_id, null);

  return false;
end;
$$;

create or replace function public.finish_push_delivery_target(
  p_target_id uuid,
  p_outcome text,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target public.push_delivery_targets%rowtype;
  v_delivery public.push_deliveries%rowtype;
begin
  if not public.request_uses_service_role() then raise exception 'server delivery only'; end if;
  if p_outcome is null or p_outcome not in ('sent','retry','gone') then raise exception 'invalid push target outcome'; end if;
  select * into v_target from public.push_delivery_targets where id=p_target_id for update;
  if not found then raise exception 'push delivery target not found'; end if;

  if v_target.status not in ('sent','gone') then
    update public.push_delivery_targets set
      status=case p_outcome when 'sent' then 'sent' when 'gone' then 'gone' else 'failed' end,
      sent_at=case when p_outcome='sent' then now() else null end,
      claimed_at=case when p_outcome='retry' then coalesce(claimed_at,now()) else claimed_at end,
      last_error=case when p_outcome='sent' then null else left(coalesce(p_error,'push provider failure'),1000) end,
      updated_at=now()
    where id=p_target_id returning * into v_target;

    if p_outcome='gone' and v_target.subscription_id is not null then
      delete from public.push_subscriptions where id=v_target.subscription_id;
    end if;
  end if;

  perform public.reconcile_push_delivery(v_target.delivery_id, p_error);
  select * into v_delivery from public.push_deliveries where id=v_target.delivery_id;
  return pg_catalog.jsonb_build_object('target_id',v_target.id,'target_status',v_target.status,'delivery_id',v_delivery.id,'delivery_status',v_delivery.status);
end;
$$;

-- The helper is internal to the definer-owned claim function. API roles call
-- only the narrow claim RPC, which performs its own service-role assertion.
revoke all on function public.push_recipient_has_current_farm_access(uuid,uuid)
from public, anon, authenticated, service_role;

revoke all on function public.reconcile_push_delivery(uuid,text)
from public, anon, authenticated, service_role;

revoke all on function public.claim_push_delivery_targets(uuid,integer)
from public, anon, authenticated;
grant execute on function public.claim_push_delivery_targets(uuid,integer)
to service_role;

revoke all on function public.revalidate_claimed_push_delivery_target(uuid)
from public, anon, authenticated;
grant execute on function public.revalidate_claimed_push_delivery_target(uuid)
to service_role;
