-- Forward repair for server-owned RPC authorization under modern PostgREST.
-- Modern JSON claims are authoritative when present. The legacy per-claim GUC
-- is consulted only when request.jwt.claims is absent, so a conflicting legacy
-- value cannot override an authenticated or anonymous modern request.

create function public.request_uses_service_role()
returns boolean
language plpgsql
stable
security invoker
set search_path = pg_catalog, pg_temp
as $$
declare
  v_claims_text text := nullif(current_setting('request.jwt.claims', true), '');
  v_claims jsonb;
begin
  if v_claims_text is not null then
    begin
      v_claims := v_claims_text::jsonb;
    exception
      when invalid_text_representation then return false;
    end;
    return coalesce(v_claims ->> 'role' = 'service_role', false);
  end if;

  return coalesce(
    nullif(current_setting('request.jwt.claim.role', true), '') = 'service_role',
    false
  );
end;
$$;

revoke all on function public.request_uses_service_role()
from public, anon, authenticated, service_role;

create or replace function public.claim_push_deliveries(p_limit integer default 25)
returns table(id uuid, notification_id uuid, attempts integer)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if not public.request_uses_service_role() then raise exception 'server delivery only'; end if;
  return query
  with claimed as (
    select d.id from public.push_deliveries d
    where ((d.status='pending' and (d.claimed_at is null or d.claimed_at < now()-interval '5 minutes'))
        or (d.status='failed' and d.claimed_at < now()-interval '5 minutes'))
      and d.attempts < 10
    order by d.created_at, d.id for update skip locked limit greatest(1, least(coalesce(p_limit,25),100))
  )
  update public.push_deliveries d set status='pending', attempts=d.attempts+1, claimed_at=now(), updated_at=now()
  from claimed where d.id=claimed.id returning d.id,d.notification_id,d.attempts;
end $$;

create or replace function public.finish_push_delivery(p_delivery_id uuid, p_sent boolean, p_error text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.push_deliveries%rowtype;
begin
  if not public.request_uses_service_role() then raise exception 'server delivery only'; end if;
  select * into v from public.push_deliveries where id=p_delivery_id for update;
  if not found then raise exception 'push delivery not found'; end if;
  if v.status='sent' then return jsonb_build_object('id',v.id,'status','sent'); end if;
  -- A failure recorded on a never-claimed row must stay retryable: the failed
  -- branch's backoff predicate compares claimed_at, so stamp it here.
  update public.push_deliveries set status=case when p_sent then 'sent' else 'failed' end,
    sent_at=case when p_sent then now() else null end, claimed_at=case when p_sent then claimed_at else coalesce(claimed_at, now()) end,
    last_error=left(coalesce(p_error,''),1000), updated_at=now()
  where id=p_delivery_id returning * into v;
  return jsonb_build_object('id',v.id,'status',v.status);
end $$;

create or replace function public.generate_due_program_notifications(p_farm_id uuid, p_local_date date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid; v_count integer;
begin
  if p_farm_id is null or p_local_date is null then raise exception 'farm and local date are required'; end if;
  if auth.uid() is not null and not public.can_edit_farm(p_farm_id) and not public.request_uses_service_role() then raise exception 'you do not have permission to edit this farm'; end if;
  if auth.uid() is null and not public.request_uses_service_role() then raise exception 'authentication is required'; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext('program-due-items'));
  select user_id into v_owner from public.farm_memberships where farm_id=p_farm_id and role='owner' and status='active' order by user_id limit 1;
  if v_owner is null then return jsonb_build_object('created_count',0); end if;
  insert into public.notifications(farm_id,user_id,category,title,body,link,dedupe_key,created_by)
  select p_farm_id,v_owner,'task',left(pa.program_name_snapshot||' due: '||ap.name,160),
    'Program pass is due '||ap.due_on::text,'/programs?pass='||ap.id::text,
    'program:'||ap.id::text||':due:'||ap.due_on::text,coalesce(auth.uid(),v_owner)
  from public.assigned_program_passes ap join public.program_assignments pa on pa.id=ap.assignment_id and pa.farm_id=ap.farm_id
  where ap.farm_id=p_farm_id and pa.status='active' and ap.status='planned' and ap.due_on is not null
    and ap.due_on-ap.reminder_lead_days<=p_local_date
  on conflict(farm_id,user_id,dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_count=row_count;
  return jsonb_build_object('created_count',v_count);
end $$;

create or replace function public.run_scheduled_alert_sweep(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
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
  v_created integer:=0;
  v_program_created integer:=0;
  v_program_result jsonb;
  v_ids jsonb:='[]'::jsonb;
  v_title text;
  v_body text;
begin
  if not public.request_uses_service_role() then raise exception 'server scheduler only'; end if;
  if not pg_try_advisory_xact_lock(hashtext('farm-rx-scheduled-alert-sweep')) then return jsonb_build_object('skipped','already_running'); end if;
  for v_farm in select * from public.farms order by id loop
    v_local_date := (p_now at time zone v_farm.time_zone)::date;
    v_program_result := public.generate_due_program_notifications(v_farm.id,v_local_date);
    v_program_created := v_program_created + coalesce((v_program_result->>'created_count')::integer,0);
    select user_id into v_owner from public.farm_memberships where farm_id=v_farm.id and role='owner' and status='active' order by user_id limit 1;
    if v_owner is null then continue; end if;
    for v_rule in select * from public.marketing_alert_rules where farm_id=v_farm.id and active order by id loop
      v_condition:=false; v_price:=null; v_bid_date:=null; v_pct:=null; v_title:='Farm Rx marketing reminder'; v_body:=coalesce(v_rule.message,'A saved grain item needs your review.');
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

      perform pg_advisory_xact_lock(hashtextextended(v_rule.id::text,0));
      insert into public.alert_rule_states(rule_id,is_condition_true) values(v_rule.id,false) on conflict(rule_id) do nothing;
      select is_condition_true into v_previous from public.alert_rule_states where rule_id=v_rule.id for update;
      v_notification_id:=null;
      if not v_previous and v_condition then
        insert into public.notifications(farm_id,user_id,category,title,body,link,dedupe_key,created_by)
        values(v_farm.id,v_owner,'general',left(v_title,160),left(v_body,500),'/grain','marketing-rule:'||v_rule.id||':'||v_local_date,v_owner)
        on conflict(farm_id,user_id,dedupe_key) where dedupe_key is not null do nothing returning id into v_notification_id;
        if v_notification_id is not null then v_created:=v_created+1; v_ids:=v_ids||to_jsonb(v_notification_id); update public.marketing_alert_rules set last_triggered_at=p_now where id=v_rule.id and farm_id=v_farm.id; end if;
      end if;
      update public.alert_rule_states set is_condition_true=v_condition,fired_at=case when not v_previous and v_condition then p_now else fired_at end,updated_at=p_now where rule_id=v_rule.id;
    end loop;
  end loop;
  return jsonb_build_object('marketing_created',v_created,'program_created',v_program_created,'notification_ids',v_ids);
end $$;

create or replace function public.record_scheduled_spray_window(
  p_farm_id uuid,p_field_id uuid,p_local_date date,p_is_good boolean,p_observed_at timestamptz,p_observation jsonb
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid; v_field_name text; v_previous boolean; v_notification uuid;
begin
  if not public.request_uses_service_role() then raise exception 'server scheduler only'; end if;
  if p_observed_at is null or p_observation is null or jsonb_typeof(p_observation)<>'object' then raise exception 'complete spray observation required'; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext('spray:'||p_field_id::text||':'||p_local_date::text));
  select name into v_field_name from public.fields where id=p_field_id and farm_id=p_farm_id and is_active;
  if not found then raise exception 'active field not found for this farm'; end if;
  select is_good into v_previous from public.spray_window_states where field_id=p_field_id and local_date=p_local_date for update;
  if not found then
    insert into public.spray_window_states(farm_id,field_id,local_date,is_good,observed_at,observation) values(p_farm_id,p_field_id,p_local_date,p_is_good,p_observed_at,p_observation);
    return jsonb_build_object('fired',false,'initialized',true);
  end if;
  update public.spray_window_states set is_good=p_is_good,observed_at=p_observed_at,observation=p_observation,updated_at=now() where field_id=p_field_id and local_date=p_local_date;
  if not v_previous and p_is_good then
    select user_id into v_owner from public.farm_memberships where farm_id=p_farm_id and role='owner' and status='active' order by user_id limit 1;
    if v_owner is not null then insert into public.notifications(farm_id,user_id,category,title,body,link,dedupe_key,created_by) values(p_farm_id,v_owner,'spray',left('Spray window is good on '||v_field_name,160),'Current field conditions have turned good for spraying today. Always follow the product label and applicator judgment.','/weather','spray:'||p_field_id||':'||p_local_date,v_owner) on conflict(farm_id,user_id,dedupe_key) where dedupe_key is not null do nothing returning id into v_notification; end if;
  end if;
  return jsonb_build_object('fired',v_notification is not null,'notification_id',v_notification);
end $$;

-- CREATE OR REPLACE preserves existing ACLs. Reassert them explicitly so this
-- forward migration remains deterministic if defaults differ by environment.
revoke all on function public.generate_due_program_notifications(uuid,date)
from public, anon, authenticated;
grant execute on function public.generate_due_program_notifications(uuid,date)
to authenticated;

revoke all on function public.claim_push_deliveries(integer),public.finish_push_delivery(uuid,boolean,text),public.run_scheduled_alert_sweep(timestamptz),public.record_scheduled_spray_window(uuid,uuid,date,boolean,timestamptz,jsonb)
from public, anon, authenticated;
grant execute on function public.claim_push_deliveries(integer),public.finish_push_delivery(uuid,boolean,text),public.run_scheduled_alert_sweep(timestamptz),public.record_scheduled_spray_window(uuid,uuid,date,boolean,timestamptz,jsonb)
to service_role;
