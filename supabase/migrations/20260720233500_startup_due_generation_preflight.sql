-- Read-only startup preflights and server-clock due generators.

create function public.program_due_item_candidates(p_farm_id uuid, p_now timestamptz)
returns table (
  local_date date, assigned_pass_id uuid, due_on date, activity_type text,
  pass_name text, program_name text, field_id uuid, field_name text,
  owner_user_id uuid, task_needed boolean, notification_needed boolean
)
language sql stable security definer set search_path = public, pg_temp as $$
  with farm_clock as (
    select (p_now at time zone f.time_zone)::date as local_date
    from public.farms f where f.id = p_farm_id
  )
  select fc.local_date, ap.id, ap.due_on, ap.activity_type, ap.name,
    pa.program_name_snapshot, ca.field_id, f.name, owner.user_id,
    not exists (
      select 1 from public.farm_tasks t where t.farm_id=p_farm_id
        and t.program_assigned_pass_id=ap.id and t.source='program'
        and t.status in ('todo','doing')
    ) and not exists (
      select 1 from public.farm_tasks t where t.farm_id=p_farm_id
        and t.program_assigned_pass_id=ap.id
        and t.program_cycle_key='due:'||ap.id::text||':'||ap.due_on::text
    ),
    owner.user_id is not null and not exists (
      select 1 from public.notifications n where n.farm_id=p_farm_id
        and n.user_id=owner.user_id
        and n.dedupe_key='program:'||ap.id::text||':due:'||ap.due_on::text
    )
  from farm_clock fc
  join public.assigned_program_passes ap on ap.farm_id=p_farm_id
  join public.program_assignments pa on pa.id=ap.assignment_id and pa.farm_id=ap.farm_id
  join public.crop_assignments ca on ca.id=pa.crop_assignment_id and ca.farm_id=pa.farm_id
  join public.fields f on f.id=ca.field_id and f.farm_id=ca.farm_id
  left join lateral (
    select fm.user_id from public.farm_memberships fm
    where fm.farm_id=p_farm_id and fm.role='owner' and fm.status='active'
    order by fm.user_id limit 1
  ) owner on true
  where pa.status='active' and ap.status='planned' and ap.due_on is not null
    and ap.due_on-ap.reminder_lead_days<=fc.local_date
$$;

create function public.service_due_item_candidates(p_farm_id uuid, p_now timestamptz)
returns table (
  local_date date, equipment_id uuid, interval_id uuid, reason text,
  cycle_key text, interval_name text, equipment_name text, owner_user_id uuid,
  task_needed boolean, notification_needed boolean
)
language sql stable security definer set search_path = public, pg_temp as $$
  with farm_clock as (
    select (p_now at time zone f.time_zone)::date as local_date
    from public.farms f where f.id=p_farm_id
  ), raw_due as (
    select e.id equipment_id,i.id interval_id,'meter'::text reason,
      'meter:'||coalesce(i.last_done_reading::text,'never')||':'||
        floor((latest.reading-coalesce(i.last_done_reading,0))/i.every_meter)::text cycle_key,
      i.name interval_name,e.name equipment_name
    from public.equipment_service_intervals i
    join public.equipment e on e.id=i.equipment_id and e.farm_id=i.farm_id
    join lateral (select r.reading from public.equipment_meter_readings r
      where r.equipment_id=e.id and r.farm_id=e.farm_id
      order by r.read_on desc,r.created_at desc,r.id desc limit 1) latest on true
    where i.farm_id=p_farm_id and i.is_active and e.status='active'
      and i.every_meter is not null
      and latest.reading-coalesce(i.last_done_reading,0)>=i.every_meter
    union all
    select e.id,i.id,'calendar'::text,
      'cal:'||to_char((coalesce(i.last_done_on,e.created_at::date)+make_interval(months=>i.every_months))::date,'YYYY-MM'),
      i.name,e.name
    from farm_clock fc
    join public.equipment_service_intervals i on i.farm_id=p_farm_id
    join public.equipment e on e.id=i.equipment_id and e.farm_id=i.farm_id
    where i.is_active and e.status='active' and i.every_months is not null
      and (coalesce(i.last_done_on,e.created_at::date)+make_interval(months=>i.every_months))::date<=fc.local_date
  ), due as (
    select distinct on (interval_id) * from raw_due
    order by interval_id,case reason when 'meter' then 0 else 1 end
  )
  select fc.local_date,d.equipment_id,d.interval_id,d.reason,d.cycle_key,
    d.interval_name,d.equipment_name,owner.user_id,
    not exists (select 1 from public.farm_tasks t where t.farm_id=p_farm_id
      and t.interval_id=d.interval_id and t.source='service_interval'
      and t.status in ('todo','doing')) and not exists (
      select 1 from public.farm_tasks t where t.farm_id=p_farm_id
        and t.interval_id=d.interval_id and t.interval_cycle_key=d.cycle_key
    ),
    owner.user_id is not null and not exists (select 1 from public.notifications n
      where n.farm_id=p_farm_id and n.user_id=owner.user_id
        and n.dedupe_key='service:'||d.interval_id::text||':'||d.cycle_key)
  from farm_clock fc cross join due d
  left join lateral (select fm.user_id from public.farm_memberships fm
    where fm.farm_id=p_farm_id and fm.role='owner' and fm.status='active'
    order by fm.user_id limit 1) owner on true
$$;

revoke all on function public.program_due_item_candidates(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.service_due_item_candidates(uuid,timestamptz) from public,anon,authenticated;

create function public.program_due_generation_status(p_farm_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_now timestamptz:=statement_timestamp(); v_local_date date; v_task boolean; v_notification boolean;
begin
  if auth.uid() is null then raise exception 'authentication is required'; end if;
  if p_farm_id is null then raise exception 'farm ID is required'; end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  select min(c.local_date),coalesce(bool_or(c.task_needed),false),coalesce(bool_or(c.notification_needed),false)
    into v_local_date,v_task,v_notification from public.program_due_item_candidates(p_farm_id,v_now) c;
  if v_local_date is null then select (v_now at time zone f.time_zone)::date into v_local_date from public.farms f where f.id=p_farm_id; end if;
  return jsonb_build_object('has_due',v_task or v_notification,'task_needed',v_task,'notification_needed',v_notification,'local_date',v_local_date);
end $$;

create function public.service_due_generation_status(p_farm_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_now timestamptz:=statement_timestamp(); v_local_date date; v_task boolean; v_notification boolean;
begin
  if auth.uid() is null then raise exception 'authentication is required'; end if;
  if p_farm_id is null then raise exception 'farm ID is required'; end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  select min(c.local_date),coalesce(bool_or(c.task_needed),false),coalesce(bool_or(c.notification_needed),false)
    into v_local_date,v_task,v_notification from public.service_due_item_candidates(p_farm_id,v_now) c;
  if v_local_date is null then select (v_now at time zone f.time_zone)::date into v_local_date from public.farms f where f.id=p_farm_id; end if;
  return jsonb_build_object('has_due',v_task or v_notification,'task_needed',v_task,'notification_needed',v_notification,'local_date',v_local_date);
end $$;

create function public.generate_due_program_items_v2(p_farm_id uuid,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_caller uuid:=auth.uid(); v_now timestamptz:=statement_timestamp(); v_receipt_user uuid; v_result jsonb; v_task_count int:=0; v_notification_count int:=0; v_local_date date;
begin
  if p_farm_id is null or p_operation_id is null or v_caller is null then raise exception 'farm ID, operation ID, and authentication are required'; end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_operation_id::text));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext('program-due-items'));
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  select r.user_id,r.result into v_receipt_user,v_result from public.repository_write_receipts r where r.farm_id=p_farm_id and r.operation_id=p_operation_id;
  if found then
    if v_receipt_user<>v_caller then raise exception 'operation ID was already used by another user'; end if;
    if v_result->>'operation_kind' is distinct from 'generate_due_program_items_v2' then raise exception 'operation ID was already used for another operation kind'; end if;
    return v_result;
  end if;
  select (v_now at time zone f.time_zone)::date into strict v_local_date from public.farms f where f.id=p_farm_id;
  insert into public.farm_tasks(farm_id,title,details,status,priority,due_on,field_id,source,program_assigned_pass_id,program_cycle_key,created_by)
  select p_farm_id,left(c.program_name||' — '||c.pass_name||' — '||c.field_name,500),'Program pass due '||c.due_on::text,'todo','normal',c.due_on,c.field_id,'program',c.assigned_pass_id,'due:'||c.assigned_pass_id::text||':'||c.due_on::text,v_caller
  from public.program_due_item_candidates(p_farm_id,v_now) c where c.task_needed
  on conflict(farm_id,program_assigned_pass_id,program_cycle_key) where program_cycle_key is not null do nothing;
  get diagnostics v_task_count=row_count;
  insert into public.notifications(farm_id,user_id,category,title,body,link,dedupe_key,created_by)
  select p_farm_id,c.owner_user_id,case when c.activity_type='spray' then 'spray' else 'task' end,left(c.program_name||' — '||c.pass_name||' due',160),left(c.program_name||' — '||c.pass_name||' — '||c.field_name||' is due '||c.due_on::text,500),'/programs?pass='||c.assigned_pass_id::text,'program:'||c.assigned_pass_id::text||':due:'||c.due_on::text,v_caller
  from public.program_due_item_candidates(p_farm_id,v_now) c where c.notification_needed
  on conflict(farm_id,user_id,dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_notification_count=row_count;
  v_result:=jsonb_build_object('operation_kind','generate_due_program_items_v2','task_created_count',v_task_count,'notification_created_count',v_notification_count,'local_date',v_local_date);
  insert into public.repository_write_receipts(farm_id,operation_id,user_id,result) values(p_farm_id,p_operation_id,v_caller,v_result);
  return v_result;
end $$;

create function public.generate_due_service_tasks_v2(p_farm_id uuid,p_operation_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_caller uuid:=auth.uid(); v_now timestamptz:=statement_timestamp(); v_receipt_user uuid; v_result jsonb; v_task_count int:=0; v_notification_count int:=0; v_local_date date;
begin
  if p_farm_id is null or p_operation_id is null or v_caller is null then raise exception 'farm ID, operation ID, and authentication are required'; end if;
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext(p_operation_id::text));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text),hashtext('service-due-items'));
  if not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to edit this farm'; end if;
  select r.user_id,r.result into v_receipt_user,v_result from public.repository_write_receipts r where r.farm_id=p_farm_id and r.operation_id=p_operation_id;
  if found then
    if v_receipt_user<>v_caller then raise exception 'operation ID was already used by another user'; end if;
    if v_result->>'operation_kind' is distinct from 'generate_due_service_tasks_v2' then raise exception 'operation ID was already used for another operation kind'; end if;
    return v_result;
  end if;
  select (v_now at time zone f.time_zone)::date into strict v_local_date from public.farms f where f.id=p_farm_id;
  insert into public.farm_tasks(farm_id,title,priority,equipment_id,source,interval_id,interval_cycle_key,created_by)
  select p_farm_id,c.interval_name||' — '||c.equipment_name,'high',c.equipment_id,'service_interval',c.interval_id,c.cycle_key,v_caller
  from public.service_due_item_candidates(p_farm_id,v_now) c where c.task_needed
  on conflict(farm_id,interval_id,interval_cycle_key) where interval_cycle_key is not null do nothing;
  get diagnostics v_task_count=row_count;
  insert into public.notifications(farm_id,user_id,category,title,body,link,dedupe_key,created_by)
  select p_farm_id,c.owner_user_id,'service',left('Service due: '||c.interval_name||' — '||c.equipment_name,160),null,'/equipment','service:'||c.interval_id::text||':'||c.cycle_key,v_caller
  from public.service_due_item_candidates(p_farm_id,v_now) c where c.notification_needed
  on conflict(farm_id,user_id,dedupe_key) where dedupe_key is not null do nothing;
  get diagnostics v_notification_count=row_count;
  v_result:=jsonb_build_object('operation_kind','generate_due_service_tasks_v2','task_created_count',v_task_count,'notification_created_count',v_notification_count,'local_date',v_local_date);
  insert into public.repository_write_receipts(farm_id,operation_id,user_id,result) values(p_farm_id,p_operation_id,v_caller,v_result);
  return v_result;
end $$;

revoke all on function public.program_due_generation_status(uuid) from public,anon,authenticated;
revoke all on function public.service_due_generation_status(uuid) from public,anon,authenticated;
revoke all on function public.generate_due_program_items_v2(uuid,uuid) from public,anon,authenticated;
revoke all on function public.generate_due_service_tasks_v2(uuid,uuid) from public,anon,authenticated;
grant execute on function public.program_due_generation_status(uuid) to authenticated;
grant execute on function public.service_due_generation_status(uuid) to authenticated;
grant execute on function public.generate_due_program_items_v2(uuid,uuid) to authenticated;
grant execute on function public.generate_due_service_tasks_v2(uuid,uuid) to authenticated;
