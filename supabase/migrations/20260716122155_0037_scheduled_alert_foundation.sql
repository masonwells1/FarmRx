-- DRAFT ONLY -- Repository-owned alert scheduler foundation. This migration
-- creates deterministic evaluators and durable state; deployment of the Edge
-- Function and scheduler workflow remains a separate reviewed release action.

alter table public.farms add column time_zone text not null default 'America/Chicago';

create function public.valid_time_zone(p_value text)
returns boolean language sql stable set search_path=pg_catalog,pg_temp as $$
  select exists(select 1 from pg_catalog.pg_timezone_names where name=p_value)
$$;
alter table public.farms add constraint farms_time_zone_valid check (public.valid_time_zone(time_zone));

create table public.spray_window_states (
  farm_id uuid not null references public.farms(id) on delete cascade,
  field_id uuid not null,
  local_date date not null,
  is_good boolean not null,
  observed_at timestamptz not null,
  observation jsonb not null check (jsonb_typeof(observation)='object'),
  updated_at timestamptz not null default now(),
  primary key(field_id,local_date),
  constraint spray_window_states_field_same_farm_fk foreign key(field_id,farm_id) references public.fields(id,farm_id) on delete cascade
);
alter table public.spray_window_states enable row level security;
revoke all on public.spray_window_states from public,anon,authenticated;

create function public.run_scheduled_alert_sweep(p_now timestamptz default now())
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
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then raise exception 'server scheduler only'; end if;
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

create function public.record_scheduled_spray_window(
  p_farm_id uuid,p_field_id uuid,p_local_date date,p_is_good boolean,p_observed_at timestamptz,p_observation jsonb
)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid; v_field_name text; v_previous boolean; v_notification uuid;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then raise exception 'server scheduler only'; end if;
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

revoke all on function public.run_scheduled_alert_sweep(timestamptz),public.record_scheduled_spray_window(uuid,uuid,date,boolean,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.run_scheduled_alert_sweep(timestamptz),public.record_scheduled_spray_window(uuid,uuid,date,boolean,timestamptz,jsonb) to service_role;
