-- Fence authenticated writes whose target tables cannot carry farm_id.
-- Browser callers must present the exact user/farm/access epoch captured when
-- the operation began; a later session must never adopt the remote write.

create or replace function public.record_marketing_alert_transition(
  p_farm_id uuid,
  p_rule_id uuid,
  p_condition_true boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous boolean;
  v_fired boolean := false;
begin
  perform public.assert_current_farm_access_epoch(p_farm_id);
  if not public.can_edit_farm(p_farm_id) then
    raise exception 'you do not have permission to edit this farm';
  end if;
  if not exists (
    select 1 from public.marketing_alert_rules rule
    where rule.id = p_rule_id and rule.farm_id = p_farm_id
  ) then
    raise exception 'alert rule not found for this farm';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_rule_id::text, 0));
  select state.is_condition_true into v_previous
  from public.alert_rule_states state
  where state.rule_id = p_rule_id
  for update;

  if not found then
    v_previous := false;
    insert into public.alert_rule_states (rule_id, is_condition_true, fired_at)
    values (p_rule_id, p_condition_true, case when p_condition_true then now() else null end);
    v_fired := p_condition_true;
  else
    v_fired := not v_previous and p_condition_true;
    update public.alert_rule_states
    set is_condition_true = p_condition_true,
        fired_at = case when v_fired then now() else fired_at end,
        updated_at = now()
    where rule_id = p_rule_id;
  end if;

  return jsonb_build_object('fired', v_fired);
end;
$$;

create function public.save_push_subscription(
  p_farm_id uuid,
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_subscription public.push_subscriptions%rowtype;
begin
  perform public.assert_current_farm_access_epoch(p_farm_id);
  if p_endpoint is null or btrim(p_endpoint) = ''
    or p_p256dh is null or btrim(p_p256dh) = ''
    or p_auth is null or btrim(p_auth) = ''
  then
    raise exception 'endpoint and push keys are required';
  end if;

  insert into public.push_subscriptions (
    user_id,
    endpoint,
    p256dh,
    auth,
    user_agent
  )
  values (
    v_caller,
    p_endpoint,
    p_p256dh,
    p_auth,
    p_user_agent
  )
  on conflict (endpoint) do update
  set p256dh = excluded.p256dh,
      auth = excluded.auth,
      user_agent = excluded.user_agent,
      last_seen_at = now()
  where push_subscriptions.user_id = v_caller
  returning * into v_subscription;

  -- A browser endpoint can still be referenced by pending delivery targets.
  -- Never let a later account adopt that endpoint (and those pending sends).
  -- The conditional upsert is atomic under the endpoint unique constraint, so
  -- it also closes the two-call race when different users register it at once.
  if not found then
    raise exception using
      errcode = 'P0001',
      message = 'PUSH_SUBSCRIPTION_OWNED_BY_ANOTHER_USER';
  end if;

  return to_jsonb(v_subscription);
end;
$$;

create function public.delete_push_subscription(
  p_farm_id uuid,
  p_endpoint text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_deleted_count integer := 0;
begin
  perform public.assert_current_farm_access_epoch(p_farm_id);
  if p_endpoint is null or btrim(p_endpoint) = '' then
    raise exception 'endpoint is required';
  end if;

  delete from public.push_subscriptions subscription
  where subscription.endpoint = p_endpoint
    and subscription.user_id = v_caller;

  get diagnostics v_deleted_count = row_count;
  return jsonb_build_object('deleted_count', v_deleted_count);
end;
$$;

-- Browser writes must use the farm- and access-epoch-bound RPCs above. The
-- original reminders migration exposed direct table DML with user-only RLS;
-- because this device table has no farm_id, that path cannot enforce the
-- captured farm generation and would bypass the 0041 fence.
revoke insert, update, delete on table public.push_subscriptions from public, anon, authenticated;
drop policy if exists push_subscriptions_insert on public.push_subscriptions;
drop policy if exists push_subscriptions_update on public.push_subscriptions;
drop policy if exists push_subscriptions_delete on public.push_subscriptions;

-- Retire the unfenced browser signatures while preserving the migration
-- history that may already exist in deployed databases.
revoke all on function public.save_push_subscription(text, text, text, text)
from public, anon, authenticated, service_role;
revoke all on function public.delete_push_subscription(text)
from public, anon, authenticated, service_role;

revoke all on function public.record_marketing_alert_transition(uuid, uuid, boolean),
  public.save_push_subscription(uuid, text, text, text, text),
  public.delete_push_subscription(uuid, text)
from public, anon, authenticated, service_role;

grant execute on function public.record_marketing_alert_transition(uuid, uuid, boolean),
  public.save_push_subscription(uuid, text, text, text, text),
  public.delete_push_subscription(uuid, text)
to authenticated;
