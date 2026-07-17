$ErrorActionPreference = 'Stop'
$name = "farmrx-0042-$PID"
$root = Split-Path -Parent $PSScriptRoot
$provenanceMigrationName = '20260717023021_repair_service_log_meter_provenance.sql'
$hardeningMigrationName = '20260717105500_harden_operational_write_boundaries.sql'
$provenanceMigrationPath = Join-Path $root "supabase/migrations/$provenanceMigrationName"
$hardeningMigrationPath = Join-Path $root "supabase/migrations/$hardeningMigrationName"
$passed = $false

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI is required for the disposable 0042 proof but is not available on PATH.'
}

try {
  docker run --rm -d --name $name -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=farmrx_disposable postgres:17 | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    if ((docker exec $name sh -c 'grep -qx postgres /proc/1/comm && pg_isready -U postgres -d farmrx_disposable' 2>$null) -match 'accepting connections') {
      $ready = $true
      break
    }
    Start-Sleep -Milliseconds 500
  }
  if (!$ready) { throw 'Disposable postgres:17 did not become ready.' }

  $bootstrap = "create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table auth.users (id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as `$`$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', nullif(current_setting('request.jwt.claim.sub', true), ''))::uuid `$`$; grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role; create schema storage; create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid); alter table storage.objects enable row level security;"
  $bootstrap | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw 'Disposable database bootstrap failed.' }

  Get-ChildItem (Join-Path $root 'supabase/migrations') -Filter '*.sql' |
    Where-Object Name -NotIn @($provenanceMigrationName, $hardeningMigrationName) |
    Sort-Object Name |
    ForEach-Object {
      (Get-Content -Raw $_.FullName) | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
      if ($LASTEXITCODE -ne 0) { throw "Pre-0042 migration failed: $($_.Name)" }
    }

  @'
  insert into auth.users(id,email) values
    ('00000000-0000-4000-8000-000000000001','probe@example.test'),
    ('00000000-0000-4000-8000-000000000002','readonly@example.test');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
  insert into public.farms(id,name,created_by) values ('00000000-0000-4000-8000-000000000010','Probe Farm','00000000-0000-4000-8000-000000000001');
  insert into public.farm_memberships(farm_id,user_id,role,status)
  values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','read_only','active');
  insert into public.entities(id,farm_id,name,entity_type)
  values ('00000000-0000-4000-8000-000000000210','00000000-0000-4000-8000-000000000010','Program Entity','individual');
  insert into public.fields(id,farm_id,operating_entity_id,name,total_acres)
  values ('00000000-0000-4000-8000-000000000211','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000210','Program Field',10);
  insert into public.crop_assignments(id,farm_id,field_id,crop_year,commodity_id,planted_acres)
  values ('00000000-0000-4000-8000-000000000212','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000211',2026,'corn_yellow',10);
  insert into public.programs(id,farm_id,name,program_kind,commodity_id,crop_year,created_by,updated_by)
  values ('00000000-0000-4000-8000-000000000213','00000000-0000-4000-8000-000000000010','Hardening Program','chemical','corn_yellow',2026,'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');
  insert into public.program_assignments(id,farm_id,program_id,crop_assignment_id,program_name_snapshot,program_kind_snapshot,template_revision,assigned_by)
  values ('00000000-0000-4000-8000-000000000214','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000213','00000000-0000-4000-8000-000000000212','Hardening Program','chemical',1,'00000000-0000-4000-8000-000000000001');
  insert into public.assigned_program_passes(id,farm_id,assignment_id,source_revision,sequence,name,pass_type,activity_type,reminder_lead_days,due_on,due_source,is_field_override,status,created_by,updated_by)
  values ('00000000-0000-4000-8000-000000000215','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000214',1,1,'Hardening Pass','pre','spray',3,current_date,'manual',true,'planned','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000001');
  insert into public.farm_tasks(id,farm_id,title,status,priority,field_id,source,program_assigned_pass_id,program_cycle_key,created_by)
  values
    ('00000000-0000-4000-8000-000000000216','00000000-0000-4000-8000-000000000010','Program task','todo','normal','00000000-0000-4000-8000-000000000211','program','00000000-0000-4000-8000-000000000215','hardening-cycle','00000000-0000-4000-8000-000000000001'),
    ('00000000-0000-4000-8000-000000000217','00000000-0000-4000-8000-000000000010','Manual task','todo','normal','00000000-0000-4000-8000-000000000211','manual',null,null,'00000000-0000-4000-8000-000000000001');
insert into public.equipment(id,farm_id,name,category,created_by) values ('00000000-0000-4000-8000-000000000100','00000000-0000-4000-8000-000000000010','History Tractor','tractor','00000000-0000-4000-8000-000000000001');
insert into public.equipment_service_intervals(id,farm_id,equipment_id,name,every_months,last_done_on,last_done_reading,created_by) values
  ('00000000-0000-4000-8000-000000000170','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100','Ambiguous interval',6,current_date - 10,50,'00000000-0000-4000-8000-000000000001'),
  ('00000000-0000-4000-8000-000000000190','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100','Stale interval',6,current_date - 20,25,'00000000-0000-4000-8000-000000000001');
insert into public.equipment_meter_readings(id,farm_id,equipment_id,reading,read_on,source,notes,created_by,created_at,updated_at) values
  ('00000000-0000-4000-8000-000000000111','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',100,current_date - 2,'service',null,'00000000-0000-4000-8000-000000000001','2026-07-14T10:00:00Z','2026-07-14T10:00:00Z'),
  ('00000000-0000-4000-8000-000000000121','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',200,current_date - 1,'service',null,'00000000-0000-4000-8000-000000000001','2026-07-15T10:00:00Z','2026-07-15T10:00:00Z'),
  ('00000000-0000-4000-8000-000000000122','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',200,current_date - 1,'service',null,'00000000-0000-4000-8000-000000000001','2026-07-15T10:00:00Z','2026-07-15T10:00:00Z'),
  ('00000000-0000-4000-8000-000000000141','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',250,current_date - 3,'service','Imported independently','00000000-0000-4000-8000-000000000001','2026-07-14T10:00:00Z','2026-07-14T10:00:00Z'),
  ('00000000-0000-4000-8000-000000000143','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',260,current_date - 4,'service',null,'00000000-0000-4000-8000-000000000001','2026-07-12T10:00:00Z','2026-07-12T10:00:00Z'),
  ('00000000-0000-4000-8000-000000000172','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',700,current_date - 5,'service',null,'00000000-0000-4000-8000-000000000001','2026-07-12T12:00:00Z','2026-07-12T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000173','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',700,current_date - 5,'service',null,'00000000-0000-4000-8000-000000000001','2026-07-12T12:00:00Z','2026-07-12T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000192','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',800,current_date - 1,'service',null,'00000000-0000-4000-8000-000000000001','2026-07-15T12:00:00Z','2026-07-15T12:00:00Z');
insert into public.equipment_service_log(id,farm_id,equipment_id,service_date,work_performed,meter_reading,interval_id,created_by,created_at,updated_at) values
  ('00000000-0000-4000-8000-000000000110','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',current_date - 2,'Unique history',100,null,'00000000-0000-4000-8000-000000000001','2026-07-14T10:00:00Z','2026-07-14T10:00:00Z'),
  ('00000000-0000-4000-8000-000000000120','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',current_date - 1,'Ambiguous history',200,null,'00000000-0000-4000-8000-000000000001','2026-07-15T10:00:00Z','2026-07-15T10:00:00Z'),
  ('00000000-0000-4000-8000-000000000140','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',current_date - 3,'Noted reading history',250,null,'00000000-0000-4000-8000-000000000001','2026-07-14T10:00:00Z','2026-07-14T10:00:00Z'),
  ('00000000-0000-4000-8000-000000000142','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',current_date - 4,'Older reading history',260,null,'00000000-0000-4000-8000-000000000001','2026-07-13T10:00:00Z','2026-07-13T10:00:00Z'),
  ('00000000-0000-4000-8000-000000000171','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',current_date - 5,'Ambiguous interval history',700,'00000000-0000-4000-8000-000000000170','00000000-0000-4000-8000-000000000001','2026-07-12T12:00:00Z','2026-07-12T12:00:00Z'),
  ('00000000-0000-4000-8000-000000000191','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',current_date - 1,'Canonical stale repair',800,'00000000-0000-4000-8000-000000000190','00000000-0000-4000-8000-000000000001','2026-07-15T12:00:00Z','2026-07-15T12:00:00Z');
update public.equipment_service_intervals
set last_done_on=current_date - 20, last_done_reading=25
where id='00000000-0000-4000-8000-000000000190';
'@ | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw 'Pre-0042 history seed failed.' }

  (Get-Content -Raw $provenanceMigrationPath) | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw '0042 provenance migration failed.' }
  (Get-Content -Raw $hardeningMigrationPath) | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw 'Operational write-boundary hardening migration failed.' }

  @'
-- Database-owner migration/backfill, private-provenance, and catalog checks.
-- Supported reversal behavior is exercised separately as authenticated.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);

do $$
begin
  if (select meter_reading_id from public.service_log_meter_readings where service_log_id='00000000-0000-4000-8000-000000000110') is distinct from '00000000-0000-4000-8000-000000000111'::uuid then
    raise exception 'unambiguous historical provenance was not backfilled';
  end if;
  if exists(select 1 from public.service_log_meter_readings where service_log_id='00000000-0000-4000-8000-000000000120') then
    raise exception 'ambiguous historical provenance was guessed';
  end if;
  if exists(select 1 from public.service_log_meter_readings where service_log_id in ('00000000-0000-4000-8000-000000000140','00000000-0000-4000-8000-000000000142')) then
    raise exception 'a noted or older reading was guessed as service provenance';
  end if;
  if not exists(
    select 1 from public.equipment_service_intervals
    where id='00000000-0000-4000-8000-000000000190'
      and last_done_on=current_date - 1 and last_done_reading=800
  ) then
    raise exception 'migration did not repair a stale interval from canonical history';
  end if;
end $$;

begin;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,true);
do $$
begin
  perform public.delete_service_log_with_reversal('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000110');
  if exists(select 1 from public.equipment_service_log where id='00000000-0000-4000-8000-000000000110')
    or exists(select 1 from public.equipment_meter_readings where id='00000000-0000-4000-8000-000000000111') then
    raise exception 'exact historical pair was not reversed';
  end if;

  begin
    perform public.delete_service_log_with_reversal('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000120');
    raise exception 'ambiguous historical reversal was accepted';
  exception when others then
    if sqlerrm <> 'SERVICE_LOG_READING_PROVENANCE_REQUIRED' then raise; end if;
  end;
  if not exists(select 1 from public.equipment_service_log where id='00000000-0000-4000-8000-000000000120')
    or (select count(*) from public.equipment_meter_readings where id in ('00000000-0000-4000-8000-000000000121','00000000-0000-4000-8000-000000000122')) <> 2 then
    raise exception 'ambiguous historical reversal did not fail closed';
  end if;

  begin
    perform public.delete_service_log_with_reversal('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000140');
    raise exception 'noted historical reading reversal was accepted';
  exception when others then if sqlerrm <> 'SERVICE_LOG_READING_PROVENANCE_REQUIRED' then raise; end if; end;
  begin
    perform public.delete_service_log_with_reversal('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000142');
    raise exception 'older historical reading reversal was accepted';
  exception when others then if sqlerrm <> 'SERVICE_LOG_READING_PROVENANCE_REQUIRED' then raise; end if; end;
  if not exists(select 1 from public.equipment_service_log where id='00000000-0000-4000-8000-000000000140')
    or not exists(select 1 from public.equipment_meter_readings where id='00000000-0000-4000-8000-000000000141')
    or not exists(select 1 from public.equipment_service_log where id='00000000-0000-4000-8000-000000000142')
    or not exists(select 1 from public.equipment_meter_readings where id='00000000-0000-4000-8000-000000000143') then
    raise exception 'independent noted or older history was not preserved';
  end if;
end $$;
commit;

do $$
begin
  begin
    insert into public.equipment_service_log(id,farm_id,equipment_id,service_date,work_performed,meter_reading,created_by)
    values ('00000000-0000-4000-8000-000000000160','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',current_date,'Direct unlinked insert',600,'00000000-0000-4000-8000-000000000001');
    set constraints equipment_service_log_requires_meter_provenance immediate;
    raise exception 'direct unlinked metered insert was accepted';
  exception when others then
    if sqlerrm <> 'SERVICE_LOG_READING_PROVENANCE_REQUIRED' then raise; end if;
  end;
  set constraints equipment_service_log_requires_meter_provenance deferred;
  if exists(select 1 from public.equipment_service_log where id='00000000-0000-4000-8000-000000000160') then
    raise exception 'failed direct metered insert left a service log behind';
  end if;

  if not has_function_privilege('authenticated','public.save_service_log_entry(uuid,jsonb,uuid)','execute')
    or has_function_privilege('anon','public.save_service_log_entry(uuid,jsonb,uuid)','execute')
    or not has_function_privilege('authenticated','public.delete_service_log_with_reversal(uuid,uuid)','execute')
    or has_function_privilege('anon','public.delete_service_log_with_reversal(uuid,uuid)','execute') then
    raise exception 'public service RPC grants are incorrect';
  end if;
  if has_table_privilege('authenticated','public.equipment_service_log','delete') then
    raise exception 'authenticated can still bypass atomic reversal with a direct service-log delete';
  end if;
  if has_schema_privilege('authenticated','private','usage')
    or has_schema_privilege('anon','private','usage')
    or has_function_privilege('authenticated','private.save_service_log_entry_core(uuid,jsonb,uuid)','execute')
    or has_function_privilege('anon','private.save_service_log_entry_core(uuid,jsonb,uuid)','execute')
    or has_function_privilege('authenticated','private.link_service_log_meter_reading(uuid,uuid,uuid)','execute')
    or has_function_privilege('anon','private.link_service_log_meter_reading(uuid,uuid,uuid)','execute')
    or has_function_privilege('authenticated','private.recompute_service_interval_completion(uuid,uuid)','execute')
    or has_function_privilege('anon','private.recompute_service_interval_completion(uuid,uuid)','execute')
    or has_function_privilege('authenticated','private.require_service_log_meter_provenance()','execute')
    or has_function_privilege('anon','private.require_service_log_meter_provenance()','execute')
    or has_function_privilege('authenticated','public.stamp_service_interval_from_log()','execute')
    or has_function_privilege('anon','public.stamp_service_interval_from_log()','execute') then
    raise exception 'private service function grants are incorrect';
  end if;
  if exists(
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where n.nspname in ('public','private')
      and p.proname in ('save_service_log_entry','save_service_log_entry_core','link_service_log_meter_reading','recompute_service_interval_completion','require_service_log_meter_provenance','stamp_service_interval_from_log','delete_service_log_with_reversal','protect_program_task_provenance')
      and a.grantee=0
      and a.privilege_type='EXECUTE'
  ) then
    raise exception 'service functions retain default PUBLIC execute';
  end if;
  if not exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='link_service_log_meter_reading'
      and p.prosecdef and 'search_path=""'=any(p.proconfig)
  ) then
    raise exception 'private provenance helper is not a hardened definer';
  end if;
  if not exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='save_service_log_entry'
      and p.prosecdef and 'search_path=""'=any(p.proconfig)
      and p.proowner=(
        select c.relowner from pg_class c join pg_namespace cn on cn.oid=c.relnamespace
        where cn.nspname='public' and c.relname='equipment_service_log'
      )
  ) then
    raise exception 'public service writer is not a hardened definer';
  end if;
  if not exists(
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='save_service_log_entry_core'
      and not p.prosecdef and 'search_path=""'=any(p.proconfig)
  ) then
    raise exception 'private service core is not a hardened invoker';
  end if;
  if to_regprocedure('public.reject_direct_program_task_status_change()') is not null
    or to_regprocedure('public.enable_program_task_status_change()') is not null
    or exists(select 1 from pg_trigger where not tgisinternal and tgname in ('farm_tasks_program_status_backstop','assigned_program_passes_enable_task_status_change')) then
    raise exception 'obsolete Program task bypass machinery remains installed';
  end if;
  if not exists(
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    join pg_proc p on p.oid=t.tgfoid
    join pg_namespace pn on pn.oid=p.pronamespace
    where n.nspname='public' and c.relname='farm_tasks'
      and t.tgname='farm_tasks_program_provenance_backstop'
      and pn.nspname='public' and p.proname='protect_program_task_provenance'
      and not p.prosecdef and 'search_path=""'=any(p.proconfig)
  ) then
    raise exception 'Program task provenance backstop is missing or unsafe';
  end if;
  if exists(
    select 1
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
    cross join (
      select c.relowner
      from pg_class c join pg_namespace cn on cn.oid=c.relnamespace
      where cn.nspname='public' and c.relname='farm_tasks'
    ) task_table
    where n.nspname='public'
      and p.proname in ('refresh_program_assignment','reschedule_program_pass','skip_program_pass','unassign_program','reassign_program_assignment','mark_program_pass_applied','generate_due_program_items')
      and p.proowner <> task_table.relowner
  ) then
    raise exception 'a Program task mutator is not owned by the farm_tasks owner';
  end if;
  if not exists(
    select 1
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    join pg_proc p on p.oid=t.tgfoid
    join pg_namespace pn on pn.oid=p.pronamespace
    where n.nspname='public' and c.relname='equipment_service_log'
      and t.tgname='equipment_service_log_requires_meter_provenance'
      and t.tgconstraint<>0 and t.tgdeferrable and t.tginitdeferred
      and t.tgtype=21
      and pn.nspname='private' and p.proname='require_service_log_meter_provenance'
      and p.prosecdef and 'search_path=""'=any(p.proconfig)
      and p.proowner=c.relowner
  ) then
    raise exception 'deferred service provenance backstop is missing';
  end if;
end $$;
'@ | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw '0042 exact-provenance behavior probe failed.' }

  @'
-- Exercise the bypass attacks as the authenticated application role, not as
-- the disposable database owner.
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,true);
do $$
begin
  begin
    delete from public.equipment_service_log where id='00000000-0000-4000-8000-000000000120';
    raise exception 'authenticated direct service-log delete was accepted';
  exception when insufficient_privilege then null;
  end;
  if not exists(select 1 from public.equipment_service_log where id='00000000-0000-4000-8000-000000000120') then
    raise exception 'rejected authenticated direct delete did not preserve the log';
  end if;
end $$;
rollback;

-- Prove the supported service save/replay/reversal path as the real
-- authenticated application role.  JWT claims alone do not exercise RLS.
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,true);
do $$
begin
  perform public.save_service_log_entry(
    '00000000-0000-4000-8000-000000000010',
    jsonb_build_object(
      'id','00000000-0000-4000-8000-000000000230',
      'equipment_id','00000000-0000-4000-8000-000000000100',
      'service_date',current_date::text,
      'work_performed','Authenticated exact service path',
      'parts',null,
      'vendor',null,
      'cost',null,
      'meter_reading',305,
      'interval_id',null
    ),
    '00000000-0000-4000-8000-000000000231'
  );
  perform public.save_service_log_entry(
    '00000000-0000-4000-8000-000000000010',
    jsonb_build_object(
      'id','00000000-0000-4000-8000-000000000230',
      'equipment_id','00000000-0000-4000-8000-000000000100',
      'service_date',current_date::text,
      'work_performed','Authenticated exact service path',
      'parts',null,
      'vendor',null,
      'cost',null,
      'meter_reading',305,
      'interval_id',null
    ),
    '00000000-0000-4000-8000-000000000231'
  );
  if (select count(*) from public.equipment_service_log where id='00000000-0000-4000-8000-000000000230') <> 1
    or (select count(*) from public.equipment_meter_readings where id='00000000-0000-4000-8000-000000000231' and source='service') <> 1 then
    raise exception 'authenticated service save/replay did not expose one exact service and reading';
  end if;
end $$;
reset role;
do $$
begin
  if (select count(*) from public.service_log_meter_readings where service_log_id='00000000-0000-4000-8000-000000000230' and meter_reading_id='00000000-0000-4000-8000-000000000231') <> 1 then
    raise exception 'authenticated service save/replay did not preserve one exact provenance pair';
  end if;
end $$;
set local role authenticated;
do $$
begin
  perform public.delete_service_log_with_reversal(
    '00000000-0000-4000-8000-000000000010',
    '00000000-0000-4000-8000-000000000230'
  );
  if exists(select 1 from public.equipment_service_log where id='00000000-0000-4000-8000-000000000230')
    or exists(select 1 from public.equipment_meter_readings where id='00000000-0000-4000-8000-000000000231') then
    raise exception 'authenticated exact service reversal left public state behind';
  end if;
end $$;
reset role;
do $$
begin
  if exists(select 1 from public.service_log_meter_readings where service_log_id='00000000-0000-4000-8000-000000000230') then
    raise exception 'authenticated exact service reversal left provenance state behind';
  end if;
end $$;
rollback;

-- A read-only member may view operational records but may not create readings,
-- service logs, or tasks, and may not update an existing task.
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',true);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,true);
do $$
begin
  begin
    insert into public.equipment_meter_readings(id,farm_id,equipment_id,reading,read_on,source,created_by)
    values ('00000000-0000-4000-8000-000000000221','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',900,current_date,'manual','00000000-0000-4000-8000-000000000002');
    raise exception 'read-only meter-reading insert was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.equipment_service_log(id,farm_id,equipment_id,service_date,work_performed,meter_reading,created_by)
    values ('00000000-0000-4000-8000-000000000222','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',current_date,'Read-only attack',null,'00000000-0000-4000-8000-000000000002');
    raise exception 'read-only service-log insert was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.farm_tasks(id,farm_id,title,status,priority,source,created_by)
    values ('00000000-0000-4000-8000-000000000223','00000000-0000-4000-8000-000000000010','Read-only attack','todo','normal','manual','00000000-0000-4000-8000-000000000002');
    raise exception 'read-only task insert was accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_service_log_entry(
      '00000000-0000-4000-8000-000000000010',
      jsonb_build_object('id','00000000-0000-4000-8000-000000000224','equipment_id','00000000-0000-4000-8000-000000000100','service_date',current_date::text,'work_performed','Read-only RPC attack','parts',null,'vendor',null,'cost',null,'meter_reading',null,'interval_id',null),
      null
    );
    raise exception 'read-only service RPC call was accepted';
  exception when others then
    if sqlerrm <> 'you do not have permission to edit this farm' then raise; end if;
  end;
  update public.farm_tasks
  set status='doing'
  where id='00000000-0000-4000-8000-000000000217';
  if found then raise exception 'read-only task update affected a row'; end if;
  if exists(select 1 from public.equipment_meter_readings where id='00000000-0000-4000-8000-000000000221')
    or exists(select 1 from public.equipment_service_log where id='00000000-0000-4000-8000-000000000222')
    or exists(select 1 from public.equipment_service_log where id='00000000-0000-4000-8000-000000000224')
    or exists(select 1 from public.farm_tasks where id='00000000-0000-4000-8000-000000000223')
    or exists(select 1 from public.farm_tasks where id='00000000-0000-4000-8000-000000000217' and status <> 'todo') then
    raise exception 'a rejected read-only write changed operational state';
  end if;
end $$;
rollback;

-- Program task cards are projections. Direct application-role writes must fail,
-- while the trusted Season-progress RPC must still complete the exact task.
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,true);
do $$
begin
  begin
    update public.farm_tasks set status='done'
    where id='00000000-0000-4000-8000-000000000216';
    raise exception 'direct Program status change was accepted';
  exception when others then if sqlerrm <> 'PROGRAM_TASK_MANAGED_BY_PROGRAM' then raise; end if;
  end;
  begin
    update public.farm_tasks
    set source='manual', program_assigned_pass_id=null, program_cycle_key=null
    where id='00000000-0000-4000-8000-000000000216';
    raise exception 'direct Program downgrade was accepted';
  exception when others then if sqlerrm <> 'PROGRAM_TASK_MANAGED_BY_PROGRAM' then raise; end if;
  end;
  begin
    delete from public.farm_tasks
    where id='00000000-0000-4000-8000-000000000216';
    raise exception 'direct Program deletion was accepted';
  exception when others then if sqlerrm <> 'PROGRAM_TASK_MANAGED_BY_PROGRAM' then raise; end if;
  end;
  begin
    insert into public.farm_tasks(id,farm_id,title,status,priority,field_id,source,program_assigned_pass_id,program_cycle_key,created_by)
    values ('00000000-0000-4000-8000-000000000218','00000000-0000-4000-8000-000000000010','Forged Program task','todo','normal','00000000-0000-4000-8000-000000000211','program','00000000-0000-4000-8000-000000000215','forged-cycle','00000000-0000-4000-8000-000000000001');
    raise exception 'direct Program creation was accepted';
  exception when others then if sqlerrm <> 'PROGRAM_TASK_MANAGED_BY_PROGRAM' then raise; end if;
  end;
  insert into public.equipment_meter_readings(id,farm_id,equipment_id,reading,read_on,source,created_by)
  values ('00000000-0000-4000-8000-000000000225','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',901,current_date,'manual','00000000-0000-4000-8000-000000000001');
  begin
    insert into public.equipment_meter_readings(id,farm_id,equipment_id,reading,read_on,source,created_by)
    values ('00000000-0000-4000-8000-000000000226','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',902,current_date,'service','00000000-0000-4000-8000-000000000001');
    raise exception 'direct service-source meter reading was accepted';
  exception when insufficient_privilege then null;
  end;
  update public.farm_tasks set status='doing'
  where id='00000000-0000-4000-8000-000000000217';
  if not found
    or not exists(select 1 from public.equipment_meter_readings where id='00000000-0000-4000-8000-000000000225' and source='manual')
    or exists(select 1 from public.equipment_meter_readings where id='00000000-0000-4000-8000-000000000226')
    or not exists(select 1 from public.farm_tasks where id='00000000-0000-4000-8000-000000000217' and status='doing') then
    raise exception 'stricter operational policies broke an owner manual write or admitted a service-source bypass';
  end if;
  perform public.skip_program_pass(
    '00000000-0000-4000-8000-000000000010',
    '00000000-0000-4000-8000-000000000219',
    '00000000-0000-4000-8000-000000000215',
    current_date,
    'Disposable trusted transition'
  );
  if not exists(
    select 1 from public.farm_tasks
    where id='00000000-0000-4000-8000-000000000216'
      and status='done'
      and source='program'
      and program_assigned_pass_id='00000000-0000-4000-8000-000000000215'
      and program_cycle_key='hardening-cycle'
  ) or not exists(
    select 1 from public.assigned_program_passes
    where id='00000000-0000-4000-8000-000000000215'
      and status='skipped'
  ) then
    raise exception 'trusted Program transition did not preserve task provenance';
  end if;
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,true);
do $$
begin
  begin
    perform private.save_service_log_entry_core(
      '00000000-0000-4000-8000-000000000010',
      jsonb_build_object('id','00000000-0000-4000-8000-000000000161','equipment_id','00000000-0000-4000-8000-000000000100','service_date',current_date::text,'work_performed','Direct core attack','parts',null,'vendor',null,'cost',null,'meter_reading',610,'interval_id',null),
      '00000000-0000-4000-8000-000000000162'
    );
    raise exception 'authenticated direct core call was accepted';
  exception when insufficient_privilege then
    null;
  end;
  if exists(select 1 from public.equipment_service_log where id='00000000-0000-4000-8000-000000000161')
    or exists(select 1 from public.equipment_meter_readings where id='00000000-0000-4000-8000-000000000162') then
    raise exception 'rejected authenticated core attack left partial history';
  end if;
end $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,true);
do $$
begin
  begin
    perform private.link_service_log_meter_reading(
      '00000000-0000-4000-8000-000000000010',
      '00000000-0000-4000-8000-000000000120',
      '00000000-0000-4000-8000-000000000121'
    );
    raise exception 'authenticated direct provenance linker call was accepted';
  exception when insufficient_privilege then
    null;
  end;
end $$;
reset role;
do $$ begin
  if exists(select 1 from public.service_log_meter_readings where service_log_id='00000000-0000-4000-8000-000000000120') then
    raise exception 'rejected direct linker attack created provenance';
  end if;
end $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,true);
do $$
begin
  begin
    perform public.save_service_log_entry(
      '00000000-0000-4000-8000-000000000010',
      jsonb_build_object(
        'id','00000000-0000-4000-8000-000000000120',
        'equipment_id','00000000-0000-4000-8000-000000000100',
        'service_date',(current_date - 1)::text,
        'work_performed','Ambiguous history',
        'parts',null,
        'vendor',null,
        'cost',null,
        'meter_reading',200,
        'interval_id',null
      ),
      '00000000-0000-4000-8000-000000000121'
    );
    raise exception 'public service RPC attached ambiguous historical provenance';
  exception when others then
    if sqlerrm <> 'SERVICE_LOG_HISTORICAL_PROVENANCE_UNPROVEN' then raise; end if;
  end;
end $$;
reset role;
do $$ begin
  if exists(select 1 from public.service_log_meter_readings where service_log_id='00000000-0000-4000-8000-000000000120')
    or not exists(select 1 from public.equipment_service_log where id='00000000-0000-4000-8000-000000000120')
    or (select count(*) from public.equipment_meter_readings where id in ('00000000-0000-4000-8000-000000000121','00000000-0000-4000-8000-000000000122')) <> 2 then
    raise exception 'historical provenance replay did not fail closed';
  end if;
end $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,true);
do $$
begin
  begin
    insert into public.equipment_service_log(id,farm_id,equipment_id,service_date,work_performed,meter_reading,created_by)
    values ('00000000-0000-4000-8000-000000000163','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100',current_date,'Authenticated unlinked insert',620,'00000000-0000-4000-8000-000000000001');
    set constraints equipment_service_log_requires_meter_provenance immediate;
    raise exception 'authenticated direct unlinked insert was accepted';
  exception when others then
    if sqlerrm <> 'SERVICE_LOG_READING_PROVENANCE_REQUIRED' then raise; end if;
  end;
  set constraints equipment_service_log_requires_meter_provenance deferred;
  if exists(select 1 from public.equipment_service_log where id='00000000-0000-4000-8000-000000000163') then
    raise exception 'rejected authenticated unlinked insert left partial history';
  end if;
end $$;
rollback;

-- Deleting an interval must preserve ambiguous immutable history while the
-- provenance backstop still rejects changes to that history's meter identity.
create temporary table interval_log_before as
select l.id, to_jsonb(l) - 'interval_id' - 'updated_at' as snapshot
from public.equipment_service_log l
where l.id='00000000-0000-4000-8000-000000000171';
create temporary table interval_readings_before as
select r.id, to_jsonb(r) as snapshot
from public.equipment_meter_readings r
where r.id in ('00000000-0000-4000-8000-000000000172','00000000-0000-4000-8000-000000000173');
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,true);
delete from public.equipment_service_intervals where id='00000000-0000-4000-8000-000000000170';
set constraints equipment_service_log_requires_meter_provenance immediate;
commit;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
do $$
begin
  if exists(select 1 from public.equipment_service_intervals where id='00000000-0000-4000-8000-000000000170')
    or not exists(select 1 from public.equipment_service_log where id='00000000-0000-4000-8000-000000000171' and interval_id is null)
    or (select count(*) from public.equipment_meter_readings where id in ('00000000-0000-4000-8000-000000000172','00000000-0000-4000-8000-000000000173')) <> 2
    or (select count(*) from interval_log_before) <> 1
    or (select count(*) from interval_readings_before) <> 2
    or exists(
      select 1
      from interval_log_before before
      left join public.equipment_service_log current on current.id=before.id
      where current.id is null
        or (to_jsonb(current) - 'interval_id' - 'updated_at') is distinct from before.snapshot
    )
    or exists(
      select 1
      from interval_readings_before before
      left join public.equipment_meter_readings current on current.id=before.id
      where current.id is null or to_jsonb(current) is distinct from before.snapshot
    )
    or exists(select 1 from public.service_log_meter_readings where service_log_id='00000000-0000-4000-8000-000000000171') then
    raise exception 'interval deletion did not preserve ambiguous history exactly';
  end if;
  begin
    update public.equipment_service_log set service_date=service_date - 1 where id='00000000-0000-4000-8000-000000000171';
    set constraints equipment_service_log_requires_meter_provenance immediate;
    raise exception 'ambiguous history provenance mutation was accepted';
  exception when others then
    if sqlerrm <> 'SERVICE_LOG_READING_PROVENANCE_REQUIRED' then raise; end if;
  end;
  set constraints equipment_service_log_requires_meter_provenance deferred;
end $$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);

-- Newer service followed by a backdated offline replay must retain both exact
-- pairs and keep the interval on canonical history. Reversal then falls back
-- deterministically, including a calendar-only newest entry.
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',true);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,true);
insert into public.equipment_service_intervals(id,farm_id,equipment_id,name,every_months,created_by)
values ('00000000-0000-4000-8000-000000000180','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100','Backdated replay',6,'00000000-0000-4000-8000-000000000001');
select public.save_service_log_entry('00000000-0000-4000-8000-000000000010',jsonb_build_object('id','00000000-0000-4000-8000-000000000181','equipment_id','00000000-0000-4000-8000-000000000100','service_date','2026-07-16','work_performed','Newer first','parts',null,'vendor',null,'cost',null,'meter_reading',1000,'interval_id','00000000-0000-4000-8000-000000000180'),'00000000-0000-4000-8000-000000000182');
select public.save_service_log_entry('00000000-0000-4000-8000-000000000010',jsonb_build_object('id','00000000-0000-4000-8000-000000000183','equipment_id','00000000-0000-4000-8000-000000000100','service_date','2026-07-15','work_performed','Older replay','parts',null,'vendor',null,'cost',null,'meter_reading',900,'interval_id','00000000-0000-4000-8000-000000000180'),'00000000-0000-4000-8000-000000000184');
reset role;
do $$
begin
  if not exists(select 1 from public.equipment_service_intervals where id='00000000-0000-4000-8000-000000000180' and last_done_on='2026-07-16' and last_done_reading=1000)
    or (select count(*) from public.equipment_service_log where id in ('00000000-0000-4000-8000-000000000181','00000000-0000-4000-8000-000000000183')) <> 2
    or (select count(*) from public.service_log_meter_readings where service_log_id in ('00000000-0000-4000-8000-000000000181','00000000-0000-4000-8000-000000000183')) <> 2 then
    raise exception 'backdated replay regressed completion or lost exact pairs';
  end if;
end $$;
set local role authenticated;
select public.save_service_log_entry('00000000-0000-4000-8000-000000000010',jsonb_build_object('id','00000000-0000-4000-8000-000000000185','equipment_id','00000000-0000-4000-8000-000000000100','service_date','2026-07-17','work_performed','Calendar newest','parts',null,'vendor',null,'cost',null,'meter_reading',null,'interval_id','00000000-0000-4000-8000-000000000180'),null);
do $$ begin if not exists(select 1 from public.equipment_service_intervals where id='00000000-0000-4000-8000-000000000180' and last_done_on='2026-07-17' and last_done_reading=1000) then raise exception 'calendar service erased canonical meter completion'; end if; end $$;
select public.delete_service_log_with_reversal('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000185');
do $$ begin if not exists(select 1 from public.equipment_service_intervals where id='00000000-0000-4000-8000-000000000180' and last_done_on='2026-07-16' and last_done_reading=1000) then raise exception 'calendar reversal did not fall back to newest metered completion'; end if; end $$;
select public.delete_service_log_with_reversal('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000181');
do $$ begin if not exists(select 1 from public.equipment_service_intervals where id='00000000-0000-4000-8000-000000000180' and last_done_on='2026-07-15' and last_done_reading=900) then raise exception 'newest reversal did not fall back to older completion'; end if; end $$;
select public.delete_service_log_with_reversal('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000183');
do $$ begin if not exists(select 1 from public.equipment_service_intervals where id='00000000-0000-4000-8000-000000000180' and last_done_on is null and last_done_reading is null) then raise exception 'last reversal did not clear interval completion'; end if; end $$;
commit;
'@ | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw '0042 authenticated attack, interval deletion, or backdated replay probe failed.' }

  @'
create extension if not exists dblink;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
insert into public.equipment_service_intervals(id,farm_id,equipment_id,name,every_months,created_by)
values ('00000000-0000-4000-8000-000000000150','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000100','Concurrent service',6,'00000000-0000-4000-8000-000000000001');
select dblink_connect('save_probe','dbname=farmrx_disposable application_name=farmrx-0042-save');
select dblink_exec('save_probe','set role authenticated');
set role authenticated;
select public.save_service_log_entry(
  '00000000-0000-4000-8000-000000000010',
  jsonb_build_object('id','00000000-0000-4000-8000-000000000151','equipment_id','00000000-0000-4000-8000-000000000100','service_date',(current_date - 1)::text,'work_performed','Older concurrent service','parts',null,'vendor',null,'cost',null,'meter_reading',400,'interval_id','00000000-0000-4000-8000-000000000150'),
  '00000000-0000-4000-8000-000000000152'
);
reset role;
select dblink_send_query('save_probe',$remote$
do $save$
begin
  perform set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',true);
  perform set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,true);
  perform public.save_service_log_entry(
    '00000000-0000-4000-8000-000000000010',
    jsonb_build_object('id','00000000-0000-4000-8000-000000000153','equipment_id','00000000-0000-4000-8000-000000000100','service_date',current_date::text,'work_performed','Newer concurrent service','parts',null,'vendor',null,'cost',null,'meter_reading',410,'interval_id','00000000-0000-4000-8000-000000000150'),
    '00000000-0000-4000-8000-000000000154'
  );
  perform pg_sleep(2);
end
$save$;
$remote$);
do $$
declare
  observed boolean := false;
begin
  for attempt in 1..100 loop
    select exists(
      select 1 from pg_stat_activity
      where application_name='farmrx-0042-save' and wait_event='PgSleep'
    ) into observed;
    exit when observed;
    perform pg_sleep(0.02);
  end loop;
  if not observed then raise exception 'concurrent save did not reach its lock-holding pause'; end if;
end $$;
set role authenticated;
select public.delete_service_log_with_reversal('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000151');
reset role;
select * from dblink_get_result('save_probe') as completed(status text);
select dblink_disconnect('save_probe');
do $$
begin
  if not exists(
    select 1 from public.equipment_service_intervals
    where id='00000000-0000-4000-8000-000000000150'
      and last_done_on=current_date and last_done_reading=410
  ) then
    raise exception 'save/delete lock mismatch left stale interval completion';
  end if;
  if exists(select 1 from public.equipment_service_log where id='00000000-0000-4000-8000-000000000151')
    or exists(select 1 from public.equipment_meter_readings where id='00000000-0000-4000-8000-000000000152')
    or not exists(select 1 from public.equipment_service_log where id='00000000-0000-4000-8000-000000000153')
    or not exists(select 1 from public.equipment_meter_readings where id='00000000-0000-4000-8000-000000000154') then
    raise exception 'concurrent save/delete did not preserve the newer exact service pair';
  end if;
end $$;
'@ | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw '0042 concurrent save/delete serialization probe failed.' }

  $passed = $true
} finally {
  docker rm -f $name 2>$null | Out-Null
}

if ($passed) { Write-Output 'PROBE 0042 exact service provenance: PASS' }
