-- DRAFT ONLY — operational-integrations repair. Do not apply without the
-- deployment review. Program reminder scheduling is performed by a Supabase
-- Scheduled Function at deploy time; the guarded cron block below is optional.

-- One notification has one durable delivery record. This includes notifications
-- created by older features after this migration is applied.
create table public.push_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.notifications(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts integer not null default 0 check (attempts >= 0),
  claimed_at timestamptz,
  sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notification_id)
);
create index push_deliveries_claim_idx on public.push_deliveries(status, claimed_at, created_at);
alter table public.push_deliveries enable row level security;
revoke all on public.push_deliveries from public, anon, authenticated;

create function public.enqueue_push_delivery()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.push_deliveries(notification_id) values (new.id)
  on conflict (notification_id) do nothing;
  return new;
end $$;
create trigger notifications_enqueue_push_delivery
after insert on public.notifications for each row execute function public.enqueue_push_delivery();

-- A harmless unauthenticated representative probe. The client treats only this
-- exact sentinel (or a successful RPC) as the all-of-0035 capability signal.
create function public.operational_integrity_capability_probe(p_farm_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if auth.uid() is null then raise exception 'authentication is required'; end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  return true;
end $$;

create function public.claim_push_deliveries(p_limit integer default 25)
returns table(id uuid, notification_id uuid, attempts integer)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then raise exception 'server delivery only'; end if;
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

create function public.finish_push_delivery(p_delivery_id uuid, p_sent boolean, p_error text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.push_deliveries%rowtype;
begin
  if coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then raise exception 'server delivery only'; end if;
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

-- Server/scheduler-safe due generation. The notification dedupe key is the
-- stable pass/date identity; the queue trigger turns exactly that row into one
-- delivery row. Replays compare the persisted content before reporting success.
create function public.generate_due_program_notifications(p_farm_id uuid, p_local_date date)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid; v_count integer;
begin
  if p_farm_id is null or p_local_date is null then raise exception 'farm and local date are required'; end if;
  if auth.uid() is not null and not public.can_edit_farm(p_farm_id) and coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then raise exception 'you do not have permission to edit this farm'; end if;
  if auth.uid() is null and coalesce(current_setting('request.jwt.claim.role',true),'') <> 'service_role' then raise exception 'authentication is required'; end if;
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

-- Tracker-owned farm-task transitions must be part of a Program transaction.
-- Any pass mutation may legitimately cascade into closing/reopening its task
-- card (template refresh and reschedule close cards without touching status),
-- so the flag arms on every pass write in the transaction, not only status.
create function public.enable_program_task_status_change()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  perform set_config('farmrx.program_task_status_change','on',true);
  return coalesce(new, old);
end $$;
create trigger assigned_program_passes_enable_task_status_change
before insert or update or delete on public.assigned_program_passes for each row execute function public.enable_program_task_status_change();
create function public.reject_direct_program_task_status_change()
returns trigger language plpgsql security invoker set search_path=public,pg_temp as $$
begin
  if old.source='program' and new.status is distinct from old.status
    and coalesce(current_setting('farmrx.program_task_status_change',true),'') <> 'on' then
    raise exception 'PROGRAM_TASK_STATUS_MANAGED_BY_PROGRAM';
  end if;
  return new;
end $$;
create trigger farm_tasks_program_status_backstop
before update of status on public.farm_tasks for each row execute function public.reject_direct_program_task_status_change();

-- Provenance makes a later reversal safe: only the exact service-created meter
-- row linked to this log can be removed.
create table public.service_log_meter_readings (
  service_log_id uuid primary key references public.equipment_service_log(id) on delete cascade,
  meter_reading_id uuid not null unique references public.equipment_meter_readings(id) on delete restrict
);
alter table public.service_log_meter_readings enable row level security;
revoke all on public.service_log_meter_readings from public, anon, authenticated;
create function public.capture_service_log_meter_reading()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.meter_reading is not null then
    insert into public.service_log_meter_readings(service_log_id,meter_reading_id)
    select new.id,r.id from public.equipment_meter_readings r
    where r.farm_id=new.farm_id and r.equipment_id=new.equipment_id and r.source='service'
      and r.reading=new.meter_reading and r.read_on=new.service_date
    order by r.created_at desc,r.id desc limit 1 on conflict do nothing;
  end if;
  return new;
end $$;
create trigger equipment_service_log_capture_meter_reading
after insert on public.equipment_service_log for each row execute function public.capture_service_log_meter_reading();

create function public.delete_service_log_with_reversal(p_farm_id uuid, p_log_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_log public.equipment_service_log%rowtype; v_reading_id uuid; v_last public.equipment_service_log%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication is required'; end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  select * into v_log from public.equipment_service_log where id=p_log_id and farm_id=p_farm_id;
  if not found then return jsonb_build_object('id',p_log_id,'already_deleted',true); end if;
  perform pg_advisory_xact_lock(hashtextextended(v_log.equipment_id::text,0));
  select * into v_log from public.equipment_service_log where id=p_log_id and farm_id=p_farm_id for update;
  if not found then return jsonb_build_object('id',p_log_id,'already_deleted',true); end if;
  select meter_reading_id into v_reading_id from public.service_log_meter_readings where service_log_id=v_log.id for update;
  delete from public.equipment_service_log where id=v_log.id and farm_id=p_farm_id;
  if v_log.interval_id is not null then
    select * into v_last from public.equipment_service_log where farm_id=p_farm_id and interval_id=v_log.interval_id
      order by service_date desc,created_at desc,id desc limit 1;
    update public.equipment_service_intervals set last_done_on=case when found then v_last.service_date else null end,
      last_done_reading=case when found then v_last.meter_reading else null end
    where id=v_log.interval_id and farm_id=p_farm_id;
  end if;
  if v_reading_id is not null then delete from public.equipment_meter_readings where id=v_reading_id and farm_id=p_farm_id and source='service'; end if;
  return jsonb_build_object('id',p_log_id,'already_deleted',false);
end $$;

-- A rule fires only when its evaluated state crosses false -> true.
create table public.alert_rule_states (
  rule_id uuid primary key references public.marketing_alert_rules(id) on delete cascade,
  is_condition_true boolean not null default false,
  fired_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.alert_rule_states enable row level security;
revoke all on public.alert_rule_states from public, anon, authenticated;
create function public.record_marketing_alert_transition(p_farm_id uuid,p_rule_id uuid,p_condition_true boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_previous boolean; v_fired boolean:=false;
begin
  if auth.uid() is null then raise exception 'authentication is required'; end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  if not exists (select 1 from public.marketing_alert_rules r where r.id=p_rule_id and r.farm_id=p_farm_id) then raise exception 'alert rule not found for this farm'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_rule_id::text,0));
  select is_condition_true into v_previous from public.alert_rule_states where rule_id=p_rule_id for update;
  if not found then v_previous:=false; insert into public.alert_rule_states(rule_id,is_condition_true,fired_at) values(p_rule_id,p_condition_true,case when p_condition_true then now() else null end); v_fired:=p_condition_true;
  else v_fired:=not v_previous and p_condition_true; update public.alert_rule_states set is_condition_true=p_condition_true,fired_at=case when v_fired then now() else fired_at end,updated_at=now() where rule_id=p_rule_id; end if;
  return jsonb_build_object('fired',v_fired);
end $$;

do $$ begin
  if exists (select 1 from pg_namespace where nspname='cron') then
    -- Deployment owners may replace this placeholder command with their project URL/key.
    null;
  end if;
end $$;

revoke all on function public.operational_integrity_capability_probe(uuid),public.generate_due_program_notifications(uuid,date),public.delete_service_log_with_reversal(uuid,uuid),public.record_marketing_alert_transition(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.operational_integrity_capability_probe(uuid),public.generate_due_program_notifications(uuid,date),public.delete_service_log_with_reversal(uuid,uuid),public.record_marketing_alert_transition(uuid,uuid,boolean) to authenticated;
revoke all on function public.claim_push_deliveries(integer),public.finish_push_delivery(uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.claim_push_deliveries(integer),public.finish_push_delivery(uuid,boolean,text) to service_role;
