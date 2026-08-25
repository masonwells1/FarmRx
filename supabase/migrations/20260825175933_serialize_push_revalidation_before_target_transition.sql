-- Serialize a revoked target's state transition with its delivery before that
-- target is changed.  Locking only inside reconciliation leaves two target
-- transitions free to establish competing read snapshots before either worker
-- owns the parent row.
create or replace function public.revalidate_claimed_push_delivery_target(p_target_id uuid)
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

  -- This lock must precede both the target transition and the re-read in
  -- reconcile_push_delivery.  It serializes workers for one delivery while
  -- retaining independent concurrency across deliveries.
  perform 1
  from public.push_deliveries
  where id = v_target.delivery_id
  for update;

  if not found then
    raise exception 'push delivery not found';
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
