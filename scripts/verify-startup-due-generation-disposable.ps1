$ErrorActionPreference = 'Stop'
$name = "farmrx-startup-due-$PID"
$root = Split-Path -Parent $PSScriptRoot

function Invoke-Sql([string]$Sql, [string]$Failure) {
  $Sql | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw $Failure }
}

try {
  docker run --rm -d --name $name -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=farmrx_disposable postgres:17 | Out-Null
  $ready=$false
  $priorPreference=$ErrorActionPreference; $ErrorActionPreference='Continue'
  try { for($i=0;$i -lt 40;$i++){ docker exec $name psql -qAt -U postgres -d farmrx_disposable -c 'select 1' 2>$null | Out-Null; if($LASTEXITCODE -eq 0){$ready=$true;break}; Start-Sleep -Milliseconds 500 } } finally { $ErrorActionPreference=$priorPreference }
  if(-not $ready){throw 'Disposable postgres did not become ready.'}
  Invoke-Sql "create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table auth.users(id uuid primary key,email text); create function auth.uid() returns uuid language sql stable as `$`$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub',nullif(current_setting('request.jwt.claim.sub',true),''))::uuid `$`$; grant usage on schema auth to anon,authenticated,service_role; grant execute on function auth.uid() to anon,authenticated,service_role; create schema storage; create table storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[]); create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null,owner uuid); alter table storage.objects enable row level security;" 'Bootstrap failed.'
  Get-ChildItem (Join-Path $root 'supabase/migrations') -Filter '*.sql' | Sort-Object Name | ForEach-Object { Invoke-Sql (Get-Content -Raw $_.FullName) "Migration failed: $($_.Name)" }

  Invoke-Sql @'
insert into auth.users(id,email) values
 ('10000000-0000-4000-8000-000000000001','owner@test'),
 ('10000000-0000-4000-8000-000000000002','worker@test'),
 ('10000000-0000-4000-8000-000000000003','readonly@test'),
 ('10000000-0000-4000-8000-000000000004','other@test');
set session_replication_role=replica;
insert into public.farms(id,name,created_by,time_zone) values
 ('20000000-0000-4000-8000-000000000001','Central','10000000-0000-4000-8000-000000000001','America/Chicago'),
 ('20000000-0000-4000-8000-000000000002','Tokyo','10000000-0000-4000-8000-000000000001','Asia/Tokyo');
insert into public.farm_memberships(farm_id,user_id,role,status) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','owner','active'),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','worker','active'),
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','read_only','active'),
 ('20000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004','manager','active');
insert into public.entities(id,farm_id,name,entity_type) values ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Entity','individual');
insert into public.fields(id,farm_id,operating_entity_id,name,total_acres) values ('40000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','Field',100);
insert into public.crop_assignments(id,farm_id,field_id,crop_year,commodity_id,planted_acres) values ('50000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001',2026,'corn_yellow',100);
insert into public.programs(id,farm_id,name,revision,created_by,updated_by) values ('60000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Program',1,'10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
insert into public.program_assignments(id,farm_id,program_id,crop_assignment_id,program_name_snapshot,status,template_revision,assigned_by) values ('70000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','Program','active',1,'10000000-0000-4000-8000-000000000001');
insert into public.assigned_program_passes(id,farm_id,assignment_id,source_revision,sequence,name,pass_type,activity_type,target_date,reminder_lead_days,due_on,due_source,status,created_by,updated_by) values ('80000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',1,1,'Pass','post','spray','2026-01-01',3,'2026-01-01','template_date','planned','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
insert into public.equipment(id,farm_id,name,category,created_by,created_at) values ('90000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','Tractor','tractor','10000000-0000-4000-8000-000000000001',now()-interval '2 years');
insert into public.equipment_service_intervals(id,farm_id,equipment_id,name,every_months,last_done_on,created_by) values ('91000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000001','Annual',1,'2025-01-01','10000000-0000-4000-8000-000000000001');
insert into public.farm_access_epochs(farm_id,user_id,access_epoch) select farm_id,user_id,1 from public.farm_memberships;
set session_replication_role=origin;

create temporary table due_no_write_snapshots(label text primary key,tasks jsonb,notifications jsonb,receipts jsonb);
insert into due_no_write_snapshots select 'helpers',
 (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.farm_tasks t),
 (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]'::jsonb) from public.notifications n),
 (select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from public.repository_write_receipts r);

do $$ declare p date; s date; pc bigint; sc bigint; begin
 select count(*),min(local_date) into pc,p from public.program_due_item_candidates('20000000-0000-4000-8000-000000000001','2026-03-08 05:59:00+00');
 select count(*),min(local_date) into sc,s from public.service_due_item_candidates('20000000-0000-4000-8000-000000000001','2026-03-08 05:59:00+00');
 if pc<>1 or sc<>1 or p is distinct from '2026-03-07'::date or s is distinct from '2026-03-07'::date then raise exception 'Chicago pre-midnight helper seam failed'; end if;
 select count(*),min(local_date) into pc,p from public.program_due_item_candidates('20000000-0000-4000-8000-000000000001','2026-03-08 06:01:00+00');
 select count(*),min(local_date) into sc,s from public.service_due_item_candidates('20000000-0000-4000-8000-000000000001','2026-03-08 06:01:00+00');
 if pc<>1 or sc<>1 or p is distinct from '2026-03-08'::date or s is distinct from '2026-03-08'::date then raise exception 'Chicago post-midnight helper seam failed'; end if;
 select count(*),min(local_date) into pc,p from public.program_due_item_candidates('20000000-0000-4000-8000-000000000001','2026-11-01 05:30:00+00');
 select count(*),min(local_date) into sc,s from public.service_due_item_candidates('20000000-0000-4000-8000-000000000001','2026-11-01 05:30:00+00');
 if pc<>1 or sc<>1 or p is distinct from '2026-11-01'::date or s is distinct from '2026-11-01'::date then raise exception 'Chicago fall-back helper seam failed'; end if;
 select count(*),min(local_date) into pc,p from public.program_due_item_candidates('20000000-0000-4000-8000-000000000001','2026-11-01 07:30:00+00');
 select count(*),min(local_date) into sc,s from public.service_due_item_candidates('20000000-0000-4000-8000-000000000001','2026-11-01 07:30:00+00');
 if pc<>1 or sc<>1 or p is distinct from '2026-11-01'::date or s is distinct from '2026-11-01'::date then raise exception 'Chicago repeated-hour helper seam failed'; end if;
end $$;
set session_replication_role=replica; update public.farms set time_zone='Asia/Tokyo' where id='20000000-0000-4000-8000-000000000001'; set session_replication_role=origin;
do $$ declare p date; s date; pc bigint; sc bigint; begin
 select count(*),min(local_date) into pc,p from public.program_due_item_candidates('20000000-0000-4000-8000-000000000001','2026-03-08 14:59:00+00');
 select count(*),min(local_date) into sc,s from public.service_due_item_candidates('20000000-0000-4000-8000-000000000001','2026-03-08 14:59:00+00');
 if pc<>1 or sc<>1 or p is distinct from '2026-03-08'::date or s is distinct from '2026-03-08'::date then raise exception 'Tokyo pre-midnight helper seam failed'; end if;
 select count(*),min(local_date) into pc,p from public.program_due_item_candidates('20000000-0000-4000-8000-000000000001','2026-03-08 15:01:00+00');
 select count(*),min(local_date) into sc,s from public.service_due_item_candidates('20000000-0000-4000-8000-000000000001','2026-03-08 15:01:00+00');
 if pc<>1 or sc<>1 or p is distinct from '2026-03-09'::date or s is distinct from '2026-03-09'::date then raise exception 'Tokyo post-midnight helper seam failed'; end if;
end $$;
set session_replication_role=replica; update public.farms set time_zone='America/Chicago' where id='20000000-0000-4000-8000-000000000001'; set session_replication_role=origin;
do $$ begin if exists(select 1 from due_no_write_snapshots s where s.label='helpers' and (
 s.tasks is distinct from (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.farm_tasks t) or
 s.notifications is distinct from (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]'::jsonb) from public.notifications n) or
 s.receipts is distinct from (select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from public.repository_write_receipts r))) then raise exception 'helper probes wrote data'; end if; end $$;

insert into due_no_write_snapshots select 'both',
 (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.farm_tasks t),
 (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]'::jsonb) from public.notifications n),
 (select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from public.repository_write_receipts r);

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
select set_config('request.headers','{"x-farm-rx-expected-user-id":"10000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\"20000000-0000-4000-8000-000000000001\":1}"}',false);
do $$ declare p jsonb:=public.program_due_generation_status('20000000-0000-4000-8000-000000000001'); s jsonb:=public.service_due_generation_status('20000000-0000-4000-8000-000000000001'); begin if not (p->>'has_due')::boolean or not (s->>'has_due')::boolean then raise exception 'both-missing preflight failed'; end if; end $$;
reset role;
do $$ begin if exists(select 1 from due_no_write_snapshots s where s.label='both' and (
 s.tasks is distinct from (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.farm_tasks t) or
 s.notifications is distinct from (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]'::jsonb) from public.notifications n) or
 s.receipts is distinct from (select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from public.repository_write_receipts r))) then raise exception 'both-missing preflight wrote data'; end if; end $$;
set role authenticated;
do $$ declare s jsonb; r jsonb; begin
 s:=public.program_due_generation_status('20000000-0000-4000-8000-000000000001');
 if not (s->>'has_due')::boolean or not (s->>'task_needed')::boolean or not (s->>'notification_needed')::boolean then raise exception 'program both-missing status failed'; end if;
 r:=public.generate_due_program_items_v2('20000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001');
 if r->>'task_created_count'<>'1' or r->>'notification_created_count'<>'1' or r->>'local_date'<>s->>'local_date' then raise exception 'program generation count/date failed'; end if;
 if public.generate_due_program_items_v2('20000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001')<>r then raise exception 'program replay failed'; end if;
 r:=public.generate_due_program_items_v2('20000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000011');
 if r->>'task_created_count'<>'0' or r->>'notification_created_count'<>'0' then raise exception 'program distinct-operation dedupe failed'; end if;
 begin perform public.generate_due_service_tasks_v2('20000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001'); raise exception 'cross-domain operation ID accepted'; exception when others then if sqlerrm<>'operation ID was already used for another operation kind' then raise; end if; end;
 s:=public.service_due_generation_status('20000000-0000-4000-8000-000000000001');
 r:=public.generate_due_service_tasks_v2('20000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002');
 if r->>'task_created_count'<>'1' or r->>'notification_created_count'<>'1' or r->>'local_date'<>s->>'local_date' then raise exception 'service generation count/date failed'; end if;
 if public.generate_due_service_tasks_v2('20000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002')<>r then raise exception 'service replay failed'; end if;
 begin perform public.generate_due_program_items_v2('20000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002'); raise exception 'reverse cross-domain operation ID accepted'; exception when others then if sqlerrm<>'operation ID was already used for another operation kind' then raise; end if; end;
 r:=public.generate_due_service_tasks_v2('20000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000012');
 if r->>'task_created_count'<>'0' or r->>'notification_created_count'<>'0' then raise exception 'service distinct-operation dedupe failed'; end if;
end $$;
reset role;

insert into due_no_write_snapshots select 'zero',
 (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.farm_tasks t),
 (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]'::jsonb) from public.notifications n),
 (select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from public.repository_write_receipts r);
set role authenticated;
do $$ begin
 if (public.program_due_generation_status('20000000-0000-4000-8000-000000000001')->>'has_due')::boolean then raise exception 'zero Program preflight failed'; end if;
 if (public.service_due_generation_status('20000000-0000-4000-8000-000000000001')->>'has_due')::boolean then raise exception 'zero Service preflight failed'; end if;
end $$;
reset role;
do $$ begin if exists(select 1 from due_no_write_snapshots s where s.label='zero' and (
 s.tasks is distinct from (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.farm_tasks t) or
 s.notifications is distinct from (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]'::jsonb) from public.notifications n) or
 s.receipts is distinct from (select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from public.repository_write_receipts r))) then raise exception 'zero preflight wrote data'; end if; end $$;

set session_replication_role=replica;
update public.farm_tasks set status='done',completed_by='10000000-0000-4000-8000-000000000001',completed_at=now()
where program_assigned_pass_id='80000000-0000-4000-8000-000000000001' or interval_id='91000000-0000-4000-8000-000000000001';
set session_replication_role=origin;
insert into due_no_write_snapshots select 'completed',
 (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.farm_tasks t),
 (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]'::jsonb) from public.notifications n),
 (select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from public.repository_write_receipts r);
set role authenticated;
do $$ begin
 if (public.program_due_generation_status('20000000-0000-4000-8000-000000000001')->>'has_due')::boolean then raise exception 'completed Program cycle became due again'; end if;
 if (public.service_due_generation_status('20000000-0000-4000-8000-000000000001')->>'has_due')::boolean then raise exception 'completed Service cycle became due again'; end if;
end $$;
reset role;
do $$ begin if exists(select 1 from due_no_write_snapshots s where s.label='completed' and (
 s.tasks is distinct from (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.farm_tasks t) or
 s.notifications is distinct from (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]'::jsonb) from public.notifications n) or
 s.receipts is distinct from (select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from public.repository_write_receipts r))) then raise exception 'completed preflight wrote data'; end if; end $$;

create extension if not exists dblink;
create temporary table due_concurrency_results(domain text,operation_id uuid,result jsonb,primary key(domain,operation_id));
grant select on due_concurrency_results to authenticated;
insert into public.assigned_program_passes(id,farm_id,assignment_id,source_revision,sequence,name,pass_type,activity_type,target_date,reminder_lead_days,due_on,due_source,status,created_by,updated_by)
values('80000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001',1,2,'Concurrent pass','post','spray',current_date-1,3,current_date-1,'template_date','planned','10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001');
select dblink_connect('due_c1','dbname=farmrx_disposable');
select dblink_connect('due_c2','dbname=farmrx_disposable');
select dblink_exec('due_c1',$q$set "request.jwt.claim.sub"='10000000-0000-4000-8000-000000000001'; set "request.headers"='{"x-farm-rx-expected-user-id":"10000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\"20000000-0000-4000-8000-000000000001\":1}"}'; set role authenticated$q$);
select dblink_exec('due_c2',$q$set "request.jwt.claim.sub"='10000000-0000-4000-8000-000000000001'; set "request.headers"='{"x-farm-rx-expected-user-id":"10000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\"20000000-0000-4000-8000-000000000001\":1}"}'; set role authenticated$q$);
select dblink_send_query('due_c1',$q$select public.generate_due_program_items_v2('20000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000021')$q$);
select dblink_send_query('due_c2',$q$select public.generate_due_program_items_v2('20000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000022')$q$);
insert into due_concurrency_results select 'program','a0000000-0000-4000-8000-000000000021',result from dblink_get_result('due_c1') as t(result jsonb);
insert into due_concurrency_results select 'program','a0000000-0000-4000-8000-000000000022',result from dblink_get_result('due_c2') as t(result jsonb);
select dblink_disconnect('due_c1'); select dblink_disconnect('due_c2');
do $$ begin
 if (select count(*) from public.farm_tasks where program_assigned_pass_id='80000000-0000-4000-8000-000000000002')<>1 then raise exception 'concurrent Program task dedupe failed'; end if;
 if (select count(*) from public.notifications where dedupe_key like 'program:80000000-0000-4000-8000-000000000002:%')<>1 then raise exception 'concurrent Program notification dedupe failed'; end if;
end $$;

insert into public.equipment(id,farm_id,name,category,created_by,created_at)
values('90000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','Concurrent tractor','tractor','10000000-0000-4000-8000-000000000001',now()-interval '2 years');
insert into public.equipment_service_intervals(id,farm_id,equipment_id,name,every_months,last_done_on,created_by)
values('91000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','90000000-0000-4000-8000-000000000002','Concurrent annual',1,(current_date-interval '2 months')::date,'10000000-0000-4000-8000-000000000001');
select dblink_connect('due_s1','dbname=farmrx_disposable'); select dblink_connect('due_s2','dbname=farmrx_disposable');
select dblink_exec('due_s1',$q$set "request.jwt.claim.sub"='10000000-0000-4000-8000-000000000001'; set "request.headers"='{"x-farm-rx-expected-user-id":"10000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\"20000000-0000-4000-8000-000000000001\":1}"}'; set role authenticated$q$);
select dblink_exec('due_s2',$q$set "request.jwt.claim.sub"='10000000-0000-4000-8000-000000000001'; set "request.headers"='{"x-farm-rx-expected-user-id":"10000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\"20000000-0000-4000-8000-000000000001\":1}"}'; set role authenticated$q$);
select dblink_send_query('due_s1',$q$select public.generate_due_service_tasks_v2('20000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000023')$q$);
select dblink_send_query('due_s2',$q$select public.generate_due_service_tasks_v2('20000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000024')$q$);
insert into due_concurrency_results select 'service','a0000000-0000-4000-8000-000000000023',result from dblink_get_result('due_s1') as t(result jsonb);
insert into due_concurrency_results select 'service','a0000000-0000-4000-8000-000000000024',result from dblink_get_result('due_s2') as t(result jsonb);
select dblink_disconnect('due_s1'); select dblink_disconnect('due_s2');
do $$ begin
 if (select count(*) from public.farm_tasks where interval_id='91000000-0000-4000-8000-000000000002')<>1 then raise exception 'concurrent Service task dedupe failed'; end if;
 if (select count(*) from public.notifications where dedupe_key like 'service:91000000-0000-4000-8000-000000000002:%')<>1 then raise exception 'concurrent Service notification dedupe failed'; end if;
 if (select count(*) from public.repository_write_receipts where operation_id in ('a0000000-0000-4000-8000-000000000023','a0000000-0000-4000-8000-000000000024'))<>2 then raise exception 'concurrent Service receipts missing'; end if;
 if exists (select 1 from due_concurrency_results r where r.result->>'operation_kind' is distinct from case r.domain when 'program' then 'generate_due_program_items_v2' else 'generate_due_service_tasks_v2' end) then raise exception 'concurrent operation kind drifted'; end if;
 if exists (select 1 from (select domain,count(*) total,count(*) filter(where result->>'task_created_count'='1' and result->>'notification_created_count'='1') winners,count(*) filter(where result->>'task_created_count'='0' and result->>'notification_created_count'='0') followers from due_concurrency_results group by domain) x where total<>2 or winners<>1 or followers<>1) then raise exception 'concurrent result multiset drifted'; end if;
 if (select count(*) from public.repository_write_receipts where operation_id in ('a0000000-0000-4000-8000-000000000021','a0000000-0000-4000-8000-000000000022'))<>2 then raise exception 'concurrent Program receipts missing'; end if;
end $$;
set role authenticated;
do $$ declare a jsonb; b jsonb; begin
 for a,b in select result,jsonb_build_object('domain',domain,'operation_id',operation_id) from due_concurrency_results loop
   if b->>'domain'='program' then
     if public.generate_due_program_items_v2('20000000-0000-4000-8000-000000000001',(b->>'operation_id')::uuid)<>a then raise exception 'concurrent Program replay drifted'; end if;
   else
     if public.generate_due_service_tasks_v2('20000000-0000-4000-8000-000000000001',(b->>'operation_id')::uuid)<>a then raise exception 'concurrent Service replay drifted'; end if;
   end if;
 end loop;
 a:=public.generate_due_service_tasks_v2('20000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000023');
 b:=public.generate_due_service_tasks_v2('20000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000023');
 if a<>b or a->>'operation_kind'<>'generate_due_service_tasks_v2' then raise exception 'concurrent Service receipt replay drifted'; end if;
 a:=public.generate_due_service_tasks_v2('20000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000024');
 b:=public.generate_due_service_tasks_v2('20000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000024');
 if a<>b or a->>'operation_kind'<>'generate_due_service_tasks_v2' then raise exception 'second concurrent Service receipt replay drifted'; end if;
end $$;
reset role;

delete from public.notifications where farm_id='20000000-0000-4000-8000-000000000001' and dedupe_key like 'program:80000000-0000-4000-8000-000000000001:%';
insert into due_no_write_snapshots select 'notification-only',
 (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.farm_tasks t),
 (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]'::jsonb) from public.notifications n),
 (select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from public.repository_write_receipts r);
set role authenticated;
do $$ declare s jsonb:=public.program_due_generation_status('20000000-0000-4000-8000-000000000001'); begin if (s->>'task_needed')::boolean or not (s->>'notification_needed')::boolean then raise exception 'notification-only status failed'; end if; end $$;
reset role;
do $$ begin if exists(select 1 from due_no_write_snapshots s where s.label='notification-only' and (
 s.tasks is distinct from (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.farm_tasks t) or
 s.notifications is distinct from (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]'::jsonb) from public.notifications n) or
 s.receipts is distinct from (select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from public.repository_write_receipts r))) then raise exception 'notification-only preflight wrote data'; end if; end $$;
insert into public.notifications(farm_id,user_id,category,title,link,dedupe_key,created_by)
values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','spray','Program — Pass due','/programs?pass=80000000-0000-4000-8000-000000000001','program:80000000-0000-4000-8000-000000000001:due:2026-01-01','10000000-0000-4000-8000-000000000001');
delete from public.farm_tasks where farm_id='20000000-0000-4000-8000-000000000001' and program_assigned_pass_id='80000000-0000-4000-8000-000000000001';
insert into due_no_write_snapshots select 'task-only',
 (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.farm_tasks t),
 (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]'::jsonb) from public.notifications n),
 (select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from public.repository_write_receipts r);
set role authenticated;
do $$ declare s jsonb:=public.program_due_generation_status('20000000-0000-4000-8000-000000000001'); begin if not (s->>'task_needed')::boolean or (s->>'notification_needed')::boolean then raise exception 'task-only status failed'; end if; end $$;
reset role;
do $$ begin if exists(select 1 from due_no_write_snapshots s where s.label='task-only' and (
 s.tasks is distinct from (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.farm_tasks t) or
 s.notifications is distinct from (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]'::jsonb) from public.notifications n) or
 s.receipts is distinct from (select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from public.repository_write_receipts r))) then raise exception 'task-only preflight wrote data'; end if; end $$;

insert into public.farm_rep_access(farm_id,rep_user_id,enabled,granted_by)
values('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004',true,'10000000-0000-4000-8000-000000000001');

set role authenticated;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000002',false);
select set_config('request.headers','{"x-farm-rx-expected-user-id":"10000000-0000-4000-8000-000000000002","x-farm-rx-access-epochs":"{\"20000000-0000-4000-8000-000000000001\":1}"}',false);
do $$ begin
 begin perform public.generate_due_program_items_v2('20000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001'); raise exception 'cross-user replay accepted'; exception when others then if sqlerrm<>'operation ID was already used by another user' then raise; end if; end;
end $$;
reset role;

create temporary table due_race_snapshot as
select
  (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.farm_tasks t where t.farm_id='20000000-0000-4000-8000-000000000001') tasks,
  (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]'::jsonb) from public.notifications n where n.farm_id='20000000-0000-4000-8000-000000000001') notifications,
  (select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from public.repository_write_receipts r where r.farm_id='20000000-0000-4000-8000-000000000001') receipts;
select dblink_connect('race_lock','dbname=farmrx_disposable');
select dblink_connect('race_gen','dbname=farmrx_disposable');
select dblink_exec('race_lock','begin');
select dblink_exec('race_lock',$q$do $x$ begin perform pg_advisory_xact_lock(hashtext('20000000-0000-4000-8000-000000000001'),hashtext('service-due-items')); end $x$$q$);
select dblink_exec('race_gen',$q$set "request.jwt.claim.sub"='10000000-0000-4000-8000-000000000002'; set "request.headers"='{"x-farm-rx-expected-user-id":"10000000-0000-4000-8000-000000000002","x-farm-rx-access-epochs":"{\"20000000-0000-4000-8000-000000000001\":1}"}'; set role authenticated$q$);
select dblink_send_query('race_gen',$q$select public.generate_due_service_tasks_v2('20000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000031')$q$);
select pg_sleep(0.2);
update public.farm_memberships set status='revoked' where farm_id='20000000-0000-4000-8000-000000000001' and user_id='10000000-0000-4000-8000-000000000002';
select dblink_exec('race_lock','commit');
do $$ begin
 begin perform result from dblink_get_result('race_gen') as t(result jsonb); raise exception 'revocation race generator accepted';
 exception when others then if position('you do not have permission to edit this farm' in sqlerrm)=0 then raise; end if; end;
 if exists (
   select 1 from due_race_snapshot s where
     s.tasks is distinct from (select coalesce(jsonb_agg(to_jsonb(t) order by t.id),'[]'::jsonb) from public.farm_tasks t where t.farm_id='20000000-0000-4000-8000-000000000001') or
     s.notifications is distinct from (select coalesce(jsonb_agg(to_jsonb(n) order by n.id),'[]'::jsonb) from public.notifications n where n.farm_id='20000000-0000-4000-8000-000000000001') or
     s.receipts is distinct from (select coalesce(jsonb_agg(to_jsonb(r) order by r.operation_id),'[]'::jsonb) from public.repository_write_receipts r where r.farm_id='20000000-0000-4000-8000-000000000001')
 ) then raise exception 'revocation race changed protected snapshots'; end if;
end $$;
select dblink_disconnect('race_lock'); select dblink_disconnect('race_gen');
set role authenticated;
do $$ begin
 begin perform public.service_due_generation_status('20000000-0000-4000-8000-000000000001'); raise exception 'revoked member accepted'; exception when others then if sqlerrm<>'you do not have permission to edit this farm' then raise; end if; end;
 begin perform public.generate_due_program_items_v2('20000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001'); raise exception 'revoked Program generator accepted'; exception when others then if sqlerrm<>'you do not have permission to edit this farm' then raise; end if; end;
 begin perform public.generate_due_service_tasks_v2('20000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002'); raise exception 'revoked Service generator accepted'; exception when others then if sqlerrm<>'you do not have permission to edit this farm' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000003',false);
do $$ begin
 begin perform public.program_due_generation_status('20000000-0000-4000-8000-000000000001'); raise exception 'read-only member accepted'; exception when others then if sqlerrm<>'you do not have permission to edit this farm' then raise; end if; end;
 begin perform public.generate_due_program_items_v2('20000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000003'); raise exception 'read-only Program generator accepted'; exception when others then if sqlerrm<>'you do not have permission to edit this farm' then raise; end if; end;
 begin perform public.generate_due_service_tasks_v2('20000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000004'); raise exception 'read-only Service generator accepted'; exception when others then if sqlerrm<>'you do not have permission to edit this farm' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000004',false);
do $$ begin
 begin perform public.service_due_generation_status('20000000-0000-4000-8000-000000000001'); raise exception 'rep accepted'; exception when others then if sqlerrm<>'you do not have permission to edit this farm' then raise; end if; end;
 begin perform public.generate_due_program_items_v2('20000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000005'); raise exception 'rep Program generator accepted'; exception when others then if sqlerrm<>'you do not have permission to edit this farm' then raise; end if; end;
 begin perform public.generate_due_service_tasks_v2('20000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000006'); raise exception 'rep Service generator accepted'; exception when others then if sqlerrm<>'you do not have permission to edit this farm' then raise; end if; end;
end $$;
select set_config('request.jwt.claim.sub','10000000-0000-4000-8000-000000000001',false);
do $$ begin
 begin perform public.program_due_generation_status('20000000-0000-4000-8000-000000000002'); raise exception 'cross-farm call accepted'; exception when others then if sqlerrm<>'you do not have permission to edit this farm' then raise; end if; end;
 begin perform public.generate_due_program_items_v2('20000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000007'); raise exception 'cross-farm Program generator accepted'; exception when others then if sqlerrm<>'you do not have permission to edit this farm' then raise; end if; end;
 begin perform public.generate_due_service_tasks_v2('20000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000008'); raise exception 'cross-farm Service generator accepted'; exception when others then if sqlerrm<>'you do not have permission to edit this farm' then raise; end if; end;
 begin perform public.program_due_item_candidates('20000000-0000-4000-8000-000000000001',clock_timestamp()); raise exception 'private helper accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role anon;
do $$ begin
 begin perform public.program_due_generation_status('20000000-0000-4000-8000-000000000001'); raise exception 'anonymous call accepted'; exception when insufficient_privilege then null; end;
 begin perform public.generate_due_program_items_v2('20000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000009'); raise exception 'anonymous Program generator accepted'; exception when insufficient_privilege then null; end;
 begin perform public.generate_due_service_tasks_v2('20000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000010'); raise exception 'anonymous Service generator accepted'; exception when insufficient_privilege then null; end;
end $$;
reset role;

do $$ begin
 if (select count(*) from public.repository_write_receipts)<>8 then raise exception 'preflight wrote a receipt or generator receipt count drifted'; end if;
 if to_regprocedure('public.generate_due_program_items(uuid,uuid,date)') is null or to_regprocedure('public.generate_due_service_tasks(uuid)') is null then raise exception 'legacy signature was removed'; end if;
 if to_regprocedure('public.generate_due_program_items_v2(uuid,uuid)') is null or to_regprocedure('public.generate_due_service_tasks_v2(uuid,uuid)') is null then raise exception 'v2 signature missing'; end if;
 if has_function_privilege('authenticated','public.program_due_item_candidates(uuid,timestamptz)','execute') or has_function_privilege('authenticated','public.service_due_item_candidates(uuid,timestamptz)','execute') then raise exception 'private helper executable'; end if;
 if not has_function_privilege('authenticated','public.program_due_generation_status(uuid)','execute') or not has_function_privilege('authenticated','public.service_due_generation_status(uuid)','execute') then raise exception 'preflight grant missing'; end if;
end $$;
'@ 'Focused startup due-generation proof failed.'

  Write-Output 'STARTUP_DUE_GENERATION_DISPOSABLE_PASS'
} finally {
  docker rm -f $name 2>$null | Out-Null
}
