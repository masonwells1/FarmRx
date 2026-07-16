-- Forward-only scheduler and push-delivery repair after the modern-claims fix.
-- No provider secret or test control is stored in the database or exposed by an
-- HTTP handler. All server RPCs retain modern request.jwt.claims authorization.

-- Release preflight: the legacy parent protocol cannot prove which device was
-- reached after any claim or failure. Pause every scheduler/send-push entry
-- point, wait for old invocations to drain, and explicitly adjudicate these
-- rows before retrying this migration. Refusing is safer than duplicating a
-- customer alert while converting a partially delivered parent into targets.
do $$
declare
  v_ambiguous integer;
begin
  select count(*) into v_ambiguous
  from public.push_deliveries
  where status='failed'
     or (status='pending' and (attempts>0 or claimed_at is not null));
  if v_ambiguous>0 then
    raise exception '0039 rollout blocked: % ambiguous legacy push deliveries require adjudication',v_ambiguous
      using hint='Pause scheduler and send-push entry points, wait for old invocations to drain, then adjudicate every failed or previously claimed legacy parent before retrying.';
  end if;
end;
$$;

alter table public.push_deliveries
add column targets_initialized_at timestamptz;

create table public.push_delivery_targets (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.push_deliveries(id) on delete cascade,
  subscription_id uuid references public.push_subscriptions(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','sending','sent','failed','gone')),
  attempts integer not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_delivery_targets_delivery_subscription_key
    unique (delivery_id, subscription_id)
);

create index push_delivery_targets_claim_idx
on public.push_delivery_targets(status, claimed_at, created_at);
create index push_delivery_targets_delivery_idx
on public.push_delivery_targets(delivery_id);
create index push_delivery_targets_subscription_idx
on public.push_delivery_targets(subscription_id)
where subscription_id is not null;

alter table public.push_delivery_targets enable row level security;
revoke all on public.push_delivery_targets from public, anon, authenticated, service_role;

-- Per-farm exception blocks are PostgreSQL subtransactions. A failed farm's
-- writes roll back to its block boundary while the outer transaction, global
-- advisory guard, and other farms continue. Returned identities are UUIDs only;
-- database/provider messages are deliberately excluded from the result.
create or replace function public.run_scheduled_alert_sweep(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_farm public.farms%rowtype;
  v_rule public.marketing_alert_rules%rowtype;
  v_owner uuid;
  v_local_date date;
  v_condition boolean;
  v_previous boolean;
  v_price numeric;
  v_bid_date date;
  v_production numeric;
  v_contracts numeric;
  v_pct numeric;
  v_notification_id uuid;
  v_created integer := 0;
  v_program_created integer := 0;
  v_program_result jsonb;
  v_ids jsonb := '[]'::jsonb;
  v_title text;
  v_body text;
  v_processed integer := 0;
  v_failed integer := 0;
  v_failed_farm_ids jsonb := '[]'::jsonb;
  v_farm_created integer;
  v_farm_program_created integer;
  v_farm_ids jsonb;
begin
  if not public.request_uses_service_role() then raise exception 'server scheduler only'; end if;
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtext('farm-rx-scheduled-alert-sweep')) then
    return pg_catalog.jsonb_build_object('skipped','already_running');
  end if;

  for v_farm in select * from public.farms order by id loop
    begin
      v_farm_created := 0;
      v_farm_program_created := 0;
      v_farm_ids := '[]'::jsonb;
      v_local_date := (p_now at time zone v_farm.time_zone)::date;
      v_program_result := public.generate_due_program_notifications(v_farm.id, v_local_date);
      v_farm_program_created := coalesce((v_program_result->>'created_count')::integer, 0);
      select user_id into v_owner from public.farm_memberships
      where farm_id=v_farm.id and role='owner' and status='active'
      order by user_id limit 1;

      if v_owner is not null then
        for v_rule in select * from public.marketing_alert_rules where farm_id=v_farm.id and active order by id loop
          v_condition:=false; v_price:=null; v_bid_date:=null; v_pct:=null;
          v_title:='Farm Rx marketing reminder';
          v_body:=coalesce(v_rule.message,'A saved grain item needs your review.');
          if v_rule.rule_type='price_target' then
            select b.cash_price,b.bid_date into v_price,v_bid_date from public.cash_bids b
            where b.farm_id=v_farm.id and b.commodity_id=v_rule.commodity_id and b.cash_price is not null
              and b.bid_date between v_local_date-2 and v_local_date
            order by b.bid_date desc,b.updated_at desc,b.id desc limit 1;
            v_condition:=v_price is not null and ((v_rule.direction='at_or_above' and v_price>=v_rule.threshold) or (v_rule.direction='at_or_below' and v_price<=v_rule.threshold));
            v_title:='Farm Rx price target reached';
            if v_condition then v_body:=v_rule.crop_year||' '||v_rule.commodity_id||' cash price is $'||trim(to_char(v_price,'FM999999990.00'))||' from the '||v_bid_date||' bid.'; end if;
          elsif v_rule.rule_type='pct_marketed_goal' then
            select coalesce(sum(case when pe.drives_math='actual' and pe.actual_bushels is not null then pe.actual_bushels else pe.expected_bushels end),0) into v_production
            from public.production_estimates pe where pe.farm_id=v_farm.id and pe.crop_year=v_rule.crop_year and pe.commodity_id=v_rule.commodity_id
              and pe.operating_entity_id is not distinct from v_rule.operating_entity_id and pe.enterprise_label is not distinct from v_rule.enterprise_label;
            select coalesce(sum(gc.bushels),0) into v_contracts from public.grain_contracts gc
            where gc.farm_id=v_farm.id and gc.crop_year=v_rule.crop_year and gc.commodity_id=v_rule.commodity_id
              and gc.operating_entity_id is not distinct from v_rule.operating_entity_id and gc.enterprise_label is not distinct from v_rule.enterprise_label;
            v_pct:=case when v_production>0 then v_contracts/v_production*100 else null end;
            v_condition:=v_pct is not null and v_pct<v_rule.threshold;
            v_title:='Farm Rx marketed goal reminder';
            if v_condition then v_body:=v_rule.crop_year||' '||v_rule.commodity_id||' is '||trim(to_char(v_pct,'FM990.0'))||'% marketed; your goal is '||trim(to_char(v_rule.threshold,'FM990.0'))||'%.'; end if;
          elsif v_rule.rule_type='deadline' then
            v_condition:=v_rule.remind_on between v_local_date and v_local_date+7;
            v_title:='Farm Rx marketing deadline';
            if v_condition then v_body:=v_rule.crop_year||' '||v_rule.commodity_id||' reminder is due '||v_rule.remind_on||'.'; end if;
          end if;

          perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_rule.id::text,0));
          insert into public.alert_rule_states(rule_id,is_condition_true) values(v_rule.id,false) on conflict(rule_id) do nothing;
          select is_condition_true into v_previous from public.alert_rule_states where rule_id=v_rule.id for update;
          v_notification_id:=null;
          if not v_previous and v_condition then
            insert into public.notifications(farm_id,user_id,category,title,body,link,dedupe_key,created_by)
            values(v_farm.id,v_owner,'general',left(v_title,160),left(v_body,500),'/grain','marketing-rule:'||v_rule.id||':'||v_local_date,v_owner)
            on conflict(farm_id,user_id,dedupe_key) where dedupe_key is not null do nothing returning id into v_notification_id;
            if v_notification_id is not null then
              v_farm_created:=v_farm_created+1;
              v_farm_ids:=v_farm_ids||pg_catalog.to_jsonb(v_notification_id);
              update public.marketing_alert_rules set last_triggered_at=p_now where id=v_rule.id and farm_id=v_farm.id;
            end if;
          end if;
          update public.alert_rule_states set is_condition_true=v_condition,
            fired_at=case when not v_previous and v_condition then p_now else fired_at end,
            updated_at=p_now where rule_id=v_rule.id;
        end loop;
      end if;
      v_created := v_created + v_farm_created;
      v_program_created := v_program_created + v_farm_program_created;
      v_ids := v_ids || v_farm_ids;
      v_processed := v_processed + 1;
    exception when others then
      v_failed := v_failed + 1;
      v_failed_farm_ids := v_failed_farm_ids || pg_catalog.to_jsonb(v_farm.id);
    end;
  end loop;

  return pg_catalog.jsonb_build_object(
    'marketing_created',v_created,
    'program_created',v_program_created,
    'notification_ids',v_ids,
    'processed_farm_count',v_processed,
    'farm_failure_count',v_failed,
    'failed_farm_ids',v_failed_farm_ids
  );
end;
$$;

-- Observations are monotonic per field/local day. The first complete good
-- observation is eligible to fire; an older or duplicate observation is never
-- allowed to overwrite newer state.
create or replace function public.record_scheduled_spray_window(
  p_farm_id uuid,p_field_id uuid,p_local_date date,p_is_good boolean,p_observed_at timestamptz,p_observation jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_owner uuid;
  v_field_name text;
  v_previous boolean := false;
  v_previous_observed_at timestamptz;
  v_exists boolean := false;
  v_notification uuid;
begin
  if not public.request_uses_service_role() then raise exception 'server scheduler only'; end if;
  if p_observed_at is null or p_observation is null or pg_catalog.jsonb_typeof(p_observation)<>'object' then raise exception 'complete spray observation required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(p_farm_id::text),pg_catalog.hashtext('spray:'||p_field_id::text||':'||p_local_date::text));
  select name into v_field_name from public.fields where id=p_field_id and farm_id=p_farm_id and is_active;
  if not found then raise exception 'active field not found for this farm'; end if;

  select is_good,observed_at into v_previous,v_previous_observed_at
  from public.spray_window_states where field_id=p_field_id and local_date=p_local_date for update;
  v_exists := found;
  if v_exists and p_observed_at<=v_previous_observed_at then
    return pg_catalog.jsonb_build_object('fired',false,'ignored','stale_observation','observed_at',v_previous_observed_at);
  end if;

  if v_exists then
    update public.spray_window_states set is_good=p_is_good,observed_at=p_observed_at,observation=p_observation,updated_at=now()
    where field_id=p_field_id and local_date=p_local_date;
  else
    insert into public.spray_window_states(farm_id,field_id,local_date,is_good,observed_at,observation)
    values(p_farm_id,p_field_id,p_local_date,p_is_good,p_observed_at,p_observation);
  end if;

  if (not v_exists or not v_previous) and p_is_good then
    select user_id into v_owner from public.farm_memberships
    where farm_id=p_farm_id and role='owner' and status='active' order by user_id limit 1;
    if v_owner is not null then
      insert into public.notifications(farm_id,user_id,category,title,body,link,dedupe_key,created_by)
      values(p_farm_id,v_owner,'spray',left('Spray window is good on '||v_field_name,160),'Current field conditions are good for spraying today. Always follow the product label and applicator judgment.','/weather','spray:'||p_field_id||':'||p_local_date,v_owner)
      on conflict(farm_id,user_id,dedupe_key) where dedupe_key is not null do nothing returning id into v_notification;
    end if;
  end if;
  return pg_catalog.jsonb_build_object('fired',v_notification is not null,'notification_id',v_notification,'initialized',not v_exists);
end;
$$;

create function public.claim_push_delivery_targets(
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
set search_path = pg_catalog
as $$
declare
  v_delivery_id uuid;
  v_limit integer := greatest(1, least(coalesce(p_limit,100),250));
begin
  if not public.request_uses_service_role() then raise exception 'server delivery only'; end if;

  -- Lock each not-yet-initialized delivery before snapshotting its current
  -- subscription set. Concurrent caller and scheduled sweeps skip the lock.
  for v_delivery_id in
    select d.id from public.push_deliveries d
    where d.targets_initialized_at is null
      and d.status <> 'sent'
      and (p_notification_id is null or d.notification_id=p_notification_id)
    order by d.created_at,d.id
    for update skip locked
    limit v_limit
  loop
    insert into public.push_delivery_targets(delivery_id,subscription_id)
    select v_delivery_id,s.id
    from public.push_deliveries d
    join public.notifications n on n.id=d.notification_id
    join public.push_subscriptions s on s.user_id=n.user_id
    where d.id=v_delivery_id
    on conflict on constraint push_delivery_targets_delivery_subscription_key do nothing;
    update public.push_deliveries set targets_initialized_at=now(),updated_at=now() where id=v_delivery_id;
  end loop;

  update public.push_delivery_targets
  set status='gone',updated_at=now(),last_error='subscription removed'
  where subscription_id is null and status in ('pending','sending','failed');

  update public.push_deliveries d
  set status='sent',sent_at=coalesce(d.sent_at,now()),last_error=null,updated_at=now()
  where d.targets_initialized_at is not null and d.status<>'sent'
    and (p_notification_id is null or d.notification_id=p_notification_id)
    and not exists (
      select 1 from public.push_delivery_targets t
      where t.delivery_id=d.id and t.status not in ('sent','gone')
    );

  return query
  with claimed as (
    select t.id
    from public.push_delivery_targets t
    join public.push_deliveries d on d.id=t.delivery_id
    where d.status<>'sent'
      and (p_notification_id is null or d.notification_id=p_notification_id)
      and t.subscription_id is not null
      and t.attempts<10
      and (
        (t.status='pending' and t.claimed_at is null)
        or (t.status in ('sending','failed') and t.claimed_at<now()-interval '5 minutes')
      )
    order by t.created_at,t.id
    for update of t skip locked
    limit v_limit
  ), updated as (
    update public.push_delivery_targets t
    set status='sending',attempts=t.attempts+1,claimed_at=now(),updated_at=now()
    from claimed where t.id=claimed.id
    returning t.*
  )
  select u.id,u.delivery_id,d.notification_id,s.endpoint,s.p256dh,s.auth,
    n.title,n.body,n.link,n.category,u.attempts
  from updated u
  join public.push_deliveries d on d.id=u.delivery_id
  join public.notifications n on n.id=d.notification_id
  join public.push_subscriptions s on s.id=u.subscription_id
  order by u.created_at,u.id;

  update public.push_deliveries d
  set status='pending',claimed_at=now(),updated_at=now(),
    attempts=greatest(d.attempts,coalesce((select max(t.attempts) from public.push_delivery_targets t where t.delivery_id=d.id),d.attempts))
  where d.status<>'sent'
    and (p_notification_id is null or d.notification_id=p_notification_id)
    and exists(select 1 from public.push_delivery_targets t where t.delivery_id=d.id and t.status='sending');
end;
$$;

create function public.finish_push_delivery_target(
  p_target_id uuid,
  p_outcome text,
  p_error text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
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

  update public.push_deliveries d set
    status=case
      when exists(select 1 from public.push_delivery_targets t where t.delivery_id=d.id and t.status='failed' and t.attempts>=10) then 'failed'
      when exists(select 1 from public.push_delivery_targets t where t.delivery_id=d.id and t.status not in ('sent','gone'))
        then case when exists(select 1 from public.push_delivery_targets t where t.delivery_id=d.id and t.status='failed') then 'failed' else 'pending' end
      else 'sent'
    end,
    sent_at=case when not exists(select 1 from public.push_delivery_targets t where t.delivery_id=d.id and t.status not in ('sent','gone')) then coalesce(d.sent_at,now()) else null end,
    last_error=case when exists(select 1 from public.push_delivery_targets t where t.delivery_id=d.id and t.status='failed') then left(coalesce(p_error,'push provider failure'),1000) else null end,
    updated_at=now()
  where d.id=v_target.delivery_id returning * into v_delivery;

  return pg_catalog.jsonb_build_object('target_id',v_target.id,'target_status',v_target.status,'delivery_id',v_delivery.id,'delivery_status',v_delivery.status);
end;
$$;

create function public.get_push_delivery_health(p_notification_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
declare
  v_terminal integer;
  v_retryable integer;
begin
  if not public.request_uses_service_role() then raise exception 'server delivery only'; end if;
  select
    count(*) filter(where t.status in ('sending','failed') and t.attempts>=10),
    count(*) filter(where t.status in ('pending','sending','failed') and t.attempts<10)
  into v_terminal,v_retryable
  from public.push_delivery_targets t
  join public.push_deliveries d on d.id=t.delivery_id
  where p_notification_id is null or d.notification_id=p_notification_id;
  return pg_catalog.jsonb_build_object('terminal_failed_targets',v_terminal,'retryable_targets',v_retryable);
end;
$$;

-- The target protocol is authoritative after this migration. Safe release order:
-- pause scheduler/send-push entry points; wait for old invocations to drain;
-- run the preflight above and adjudicate any rejected legacy parents; deploy the
-- new Edge Function (its missing RPC fails before provider I/O); apply this
-- migration atomically; then resume the scheduler only after health proof.
create or replace function public.claim_push_deliveries(p_limit integer default 25)
returns table(id uuid,notification_id uuid,attempts integer)
language plpgsql security definer set search_path=pg_catalog as $$
begin
  if not public.request_uses_service_role() then raise exception 'server delivery only'; end if;
  raise exception 'legacy push protocol retired';
end;
$$;

create or replace function public.finish_push_delivery(p_delivery_id uuid,p_sent boolean,p_error text default null)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $$
begin
  if not public.request_uses_service_role() then raise exception 'server delivery only'; end if;
  raise exception 'legacy push protocol retired';
end;
$$;

revoke all on function public.claim_push_delivery_targets(uuid,integer),public.finish_push_delivery_target(uuid,text,text),public.get_push_delivery_health(uuid)
from public,anon,authenticated;
grant execute on function public.claim_push_delivery_targets(uuid,integer),public.finish_push_delivery_target(uuid,text,text),public.get_push_delivery_health(uuid)
to service_role;

revoke all on function public.claim_push_deliveries(integer),public.finish_push_delivery(uuid,boolean,text)
from public,anon,authenticated,service_role;

-- CREATE OR REPLACE keeps the existing scheduler ACL, but reassert it so a
-- permissive default cannot widen the forward migration in a fresh project.
revoke all on function public.run_scheduled_alert_sweep(timestamptz)
from public,anon,authenticated;
grant execute on function public.run_scheduled_alert_sweep(timestamptz)
to service_role;

revoke all on function public.record_scheduled_spray_window(uuid,uuid,date,boolean,timestamptz,jsonb)
from public,anon,authenticated;
grant execute on function public.record_scheduled_spray_window(uuid,uuid,date,boolean,timestamptz,jsonb)
to service_role;
