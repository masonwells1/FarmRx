-- This proof-only file is the sole supabase_admin psql payload. All fixture
-- setup occurs in the separately captured local postgres fixture process, and
-- all credited public DML executes in authenticated dblink workers.
\set ON_ERROR_STOP on
create extension if not exists dblink;

-- CW2-CREDENTIAL-HANDOFF concurrency boundary begin.
do $cw2_outer_boundary$
begin
  if current_user <> 'supabase_admin'
     or session_user <> 'supabase_admin'
     or current_database() <> 'postgres'
     or inet_client_addr() is not null
     or inet_server_addr() is not null then
    raise exception 'CW2 concurrency proof did not enter through the exact local supabase_admin boundary';
  end if;
end
$cw2_outer_boundary$;
\echo CONNECT_WORKFLOWS_CW2_LOCAL_SUPABASE_ADMIN_BOUNDARY_PASS

select pg_advisory_lock(25000,2);
select dblink_connect('cw2_catalog_apply','dbname=postgres user=supabase_admin options=''-csearch_path= -cstatement_timeout=15000'' application_name=cw2_catalog_apply');
select dblink_connect('cw2_catalog_writer','dbname=postgres user=supabase_admin options=''-csearch_path= -cstatement_timeout=15000 -clock_timeout=500'' application_name=cw2_catalog_writer');
create temporary table cw2_catalog_apply_backend(pid integer primary key);
insert into cw2_catalog_apply_backend
select pid from dblink('cw2_catalog_apply','select pg_backend_pid()') as apply_backend(pid integer);
select dblink_exec('cw2_catalog_apply',$remote$
set role authenticated;
set "request.jwt.claims"='{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}';
set "request.jwt.claim.sub"='27000000-0000-4000-8000-000000000001';
set "request.headers"='{"x-farm-rx-expected-user-id":"27000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\"27010000-0000-4000-8000-000000000005\":1}"}';
do $cw2_remote_auth$
begin
  if current_user <> 'authenticated'
     or session_user <> 'supabase_admin'
     or current_database() <> 'postgres'
     or inet_client_addr() is not null
     or not exists(select 1 from pg_catalog.pg_roles where rolname='authenticated' and not rolsuper and not rolbypassrls)
     or current_setting('request.jwt.claims',true)::jsonb <> '{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}'::jsonb
     or current_setting('request.jwt.claim.sub',true) <> '27000000-0000-4000-8000-000000000001'
     or current_setting('request.headers',true)::jsonb <> '{"x-farm-rx-expected-user-id":"27000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\"27010000-0000-4000-8000-000000000005\":1}"}'::jsonb then
    raise exception 'CW2 catalog apply session did not enter the exact authenticated local boundary';
  end if;
end
$cw2_remote_auth$
$remote$);
select dblink_exec('cw2_catalog_writer','begin');
select dblink_exec('cw2_catalog_writer',$remote$
set role authenticated;
set "request.jwt.claims"='{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}';
set "request.jwt.claim.sub"='27000000-0000-4000-8000-000000000001';
set "request.headers"='{"x-farm-rx-expected-user-id":"27000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\"27010000-0000-4000-8000-000000000005\":1}"}';
set local lock_timeout='500ms';
do $cw2_remote_auth$
begin
  if current_user <> 'authenticated'
     or session_user <> 'supabase_admin'
     or current_database() <> 'postgres'
     or inet_client_addr() is not null
     or not exists(select 1 from pg_catalog.pg_roles where rolname='authenticated' and not rolsuper and not rolbypassrls)
     or current_setting('lock_timeout',true) <> '500ms'
     or current_setting('request.jwt.claims',true)::jsonb <> '{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}'::jsonb
     or current_setting('request.jwt.claim.sub',true) <> '27000000-0000-4000-8000-000000000001'
     or current_setting('request.headers',true)::jsonb <> '{"x-farm-rx-expected-user-id":"27000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\"27010000-0000-4000-8000-000000000005\":1}"}'::jsonb then
    raise exception 'CW2 catalog writer session did not enter the exact authenticated local boundary';
  end if;
end
$cw2_remote_auth$;
$remote$);
\echo CONNECT_WORKFLOWS_CW2_APPLY_DISPATCH_BEGIN
select dblink_send_query('cw2_catalog_apply',$remote$
select public.mark_program_pass_applied(
  '27010000-0000-4000-8000-000000000005','c2500000-0000-4000-8000-000000000003',
  'c2500000-0000-4000-8000-000000000001','2027-07-07',40,
  '[{"id":"c2500000-0000-4000-8000-000000000002","actual_product_name":"Synthetic Cedar Herbicide 41","actual_rate_text":"0.001","actual_unit_text":"gal total","actual_cost_per_acre":0.01,"inventory_match":{"inventory_product_id":"27040000-0000-4000-8000-000000000005","quantity_in_inventory_unit":0.001,"inventory_unit":"gal"}}]'::jsonb,
  null,false
)
$remote$);
\echo CONNECT_WORKFLOWS_CW2_APPLY_DISPATCH_PASS
\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_WAIT_BEGIN
-- Bound the coordinator's live-lock observation itself. The apply connection
-- remains independently bounded; this guard prevents a blocked catalog
-- observer from consuming the native capture's broad timeout without a
-- PostgreSQL diagnostic.
begin;
set local statement_timeout='10000ms';
\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_SERVER_BOUND_BEGIN
\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_OBSERVE_STAGE_BEGIN
create temporary table cw2_catalog_apply_recovery_state(ready boolean not null default false,busy integer,terminated boolean not null default false,apply_absent boolean,connection_absent boolean,apply_pid integer not null,lock_identity text not null) on commit drop;
insert into cw2_catalog_apply_recovery_state(apply_pid,lock_identity) select pid,'advisory/live-holder-waiter' from cw2_catalog_apply_backend;
create temporary table cw2_catalog_apply_recovery_stages(stage text primary key,stage_order integer not null unique,started_at timestamptz not null,timeout_setting text not null,finished_at timestamptz,succeeded boolean,sqlstate text,message text) on commit drop;
insert into cw2_catalog_apply_recovery_stages(stage,stage_order,started_at,timeout_setting) values ('readiness-observe',1,clock_timestamp(),current_setting('statement_timeout',true));
do $wait$
declare
  v_ready boolean := false;
  v_state text;
  v_message text;
begin
  if current_setting('statement_timeout',true) <> '10s' then raise exception 'CW2 readiness stage did not retain exact ten-second timeout'; end if;
  for i in 1..100 loop
    select
      exists(
        select 1
        from pg_catalog.pg_locks waiting
        join cw2_catalog_apply_backend apply_backend on apply_backend.pid=waiting.pid
        where waiting.locktype='advisory'
          and waiting.database=(select oid from pg_catalog.pg_database where datname=current_database())
          and waiting.objsubid=2
          and waiting.mode='ExclusiveLock'
          and not waiting.granted
          and exists(
            select 1
            from pg_catalog.pg_locks held
            where held.pid=pg_backend_pid()
              and held.locktype=waiting.locktype
              and held.database=waiting.database
              and held.classid=waiting.classid
              and held.objid=waiting.objid
              and held.objsubid=waiting.objsubid
              and held.mode=waiting.mode
              and held.granted
          )
      ) into v_ready;
    exit when v_ready;
    perform pg_sleep(0.05);
  end loop;
  update cw2_catalog_apply_recovery_state set ready=v_ready;
  update cw2_catalog_apply_recovery_stages
  set finished_at=clock_timestamp(),succeeded=v_ready,
      sqlstate=case when v_ready then null else 'CW2R0' end,
      message=case when v_ready then null else 'APPLY_READINESS_NOT_OBSERVED' end
  where stage='readiness-observe';
  if not v_ready then
    raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_READINESS_TIMEOUT_BEGIN';
  else
    raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_READINESS_OBSERVED_PASS';
  end if;
exception when query_canceled or others then
  get stacked diagnostics v_state=returned_sqlstate,v_message=message_text;
  update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=false,sqlstate=v_state,message=v_message where stage='readiness-observe';
end
$wait$;
\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_OBSERVE_STAGE_END
\echo CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_STAGE_BEGIN
set local statement_timeout='5000ms';
do $cancel$
declare v_cancelled boolean:=false; v_state text; v_message text;
begin
 if not (select ready from cw2_catalog_apply_recovery_state) then
  insert into cw2_catalog_apply_recovery_stages(stage,stage_order,started_at,timeout_setting) values ('cancel-apply',2,clock_timestamp(),current_setting('statement_timeout',true));
   begin
    if current_setting('statement_timeout',true) <> '5s' then raise exception 'CW2 cancel stage did not retain exact five-second timeout'; end if;
    raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_REQUEST_BEGIN';
   select pg_cancel_backend(pid) from cw2_catalog_apply_backend into v_cancelled;
      if not v_cancelled then raise exception 'CW2 catalog apply exact backend did not accept cancellation before cleanup'; end if;
      update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=true where stage='cancel-apply';
      raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_REQUEST_PASS';
      raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_PASS';
  exception when query_canceled or others then get stacked diagnostics v_state=returned_sqlstate,v_message=message_text; update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=false,sqlstate=v_state,message=v_message where stage='cancel-apply'; end;
 end if;
end
$cancel$;
\echo CONNECT_WORKFLOWS_CW2_APPLY_CANCEL_STAGE_END
\echo CONNECT_WORKFLOWS_CW2_APPLY_ADVISORY_UNLOCK_STAGE_BEGIN
set local statement_timeout='5000ms';
do $unlock$
declare v_unlocked boolean:=false; v_state text; v_message text;
begin
 if not (select ready from cw2_catalog_apply_recovery_state) then
  insert into cw2_catalog_apply_recovery_stages(stage,stage_order,started_at,timeout_setting) values ('unlock-advisory',3,clock_timestamp(),current_setting('statement_timeout',true));
   begin
    if current_setting('statement_timeout',true) <> '5s' then raise exception 'CW2 unlock stage did not retain exact five-second timeout'; end if;
   select pg_advisory_unlock(25000,2) into v_unlocked;
      if not v_unlocked then raise exception 'CW2 catalog apply cleanup did not release the exact advisory lock'; end if;
      update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=true where stage='unlock-advisory';
      raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_ADVISORY_UNLOCK_PASS';
  exception when query_canceled or others then get stacked diagnostics v_state=returned_sqlstate,v_message=message_text; update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=false,sqlstate=v_state,message=v_message where stage='unlock-advisory'; end;
 end if;
end
$unlock$;
\echo CONNECT_WORKFLOWS_CW2_APPLY_ADVISORY_UNLOCK_STAGE_END
\echo CONNECT_WORKFLOWS_CW2_APPLY_BUSY_STAGE_BEGIN
set local statement_timeout='5000ms';
do $busy$
declare v_busy integer:=1; v_state text; v_message text;
begin
 if not (select ready from cw2_catalog_apply_recovery_state) then
  insert into cw2_catalog_apply_recovery_stages(stage,stage_order,started_at,timeout_setting) values ('busy-poll',4,clock_timestamp(),current_setting('statement_timeout',true));
   begin
    if current_setting('statement_timeout',true) <> '5s' then raise exception 'CW2 busy stage did not retain exact five-second timeout'; end if;
    raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_BUSY_POLL_BEGIN';
   for i in 1..100 loop select dblink_is_busy('cw2_catalog_apply') into v_busy; exit when v_busy=0; perform pg_sleep(0.05); end loop;
   update cw2_catalog_apply_recovery_state set busy=v_busy;
   update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=(v_busy=0),sqlstate=case when v_busy=0 then null else 'CW2B0' end,message=case when v_busy=0 then null else 'APPLY_BUSY_AFTER_CANCEL' end where stage='busy-poll';
   if v_busy=0 then raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_BUSY_CLEAR_PASS'; else raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_BUSY_TIMEOUT_BEGIN'; end if;
  exception when query_canceled or others then get stacked diagnostics v_state=returned_sqlstate,v_message=message_text; update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=false,sqlstate=v_state,message=v_message where stage='busy-poll'; end;
 end if;
end
$busy$;
\echo CONNECT_WORKFLOWS_CW2_APPLY_BUSY_STAGE_END
\echo CONNECT_WORKFLOWS_CW2_APPLY_TERMINATE_STAGE_BEGIN
set local statement_timeout='5000ms';
do $terminate$
declare v_terminated boolean:=false; v_state text; v_message text;
begin
 if not (select ready from cw2_catalog_apply_recovery_state) and coalesce((select busy from cw2_catalog_apply_recovery_state),1)<>0 then
  insert into cw2_catalog_apply_recovery_stages(stage,stage_order,started_at,timeout_setting) values ('terminate-apply',5,clock_timestamp(),current_setting('statement_timeout',true));
   begin
    if current_setting('statement_timeout',true) <> '5s' then raise exception 'CW2 terminate stage did not retain exact five-second timeout'; end if;
   select pg_terminate_backend(pid,5000) from cw2_catalog_apply_backend into v_terminated;
   if not v_terminated then raise exception 'CW2 catalog apply exact backend did not terminate after bounded busy cleanup'; end if;
   update cw2_catalog_apply_recovery_state set terminated=true;
   select not exists(select 1 from pg_catalog.pg_stat_activity where pid=(select apply_pid from cw2_catalog_apply_recovery_state)) into strict v_terminated;
   update cw2_catalog_apply_recovery_state set apply_absent=v_terminated;
   if not v_terminated then raise exception 'CW2 catalog apply exact backend remained present after bounded termination'; end if;
   update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=true where stage='terminate-apply';
   raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_EXACT_BACKEND_TERMINATED_PASS';
  exception when query_canceled or others then get stacked diagnostics v_state=returned_sqlstate,v_message=message_text; update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=false,sqlstate=v_state,message=v_message where stage='terminate-apply'; end;
 end if;
end
$terminate$;
\echo CONNECT_WORKFLOWS_CW2_APPLY_TERMINATE_STAGE_END
\echo CONNECT_WORKFLOWS_CW2_APPLY_DRAIN_STAGE_BEGIN
set local statement_timeout='5000ms';
do $drain$
declare v_primary integer; v_terminal integer; v_state text; v_message text;
begin
 if not (select ready from cw2_catalog_apply_recovery_state) then
  insert into cw2_catalog_apply_recovery_stages(stage,stage_order,started_at,timeout_setting) values ('drain-apply',6,clock_timestamp(),current_setting('statement_timeout',true));
   begin
    if current_setting('statement_timeout',true) <> '5s' then raise exception 'CW2 drain stage did not retain exact five-second timeout'; end if;
    raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_RESULT_DRAIN_BEGIN';
   if coalesce((select busy from cw2_catalog_apply_recovery_state),1)<>0 then raise exception 'CW2 catalog apply was still busy before result drain'; end if;
   select count(*) from dblink_get_result('cw2_catalog_apply',false) as cleanup_primary(result jsonb) into v_primary;
   select count(*) from dblink_get_result('cw2_catalog_apply',false) as cleanup_terminal(result jsonb) into v_terminal;
   if v_primary<>0 or v_terminal<>0 then raise exception 'CW2 catalog apply cancellation drain returned unexpected rows'; end if;
   update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=true where stage='drain-apply';
   raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_RESULT_DRAIN_PASS';
  exception when query_canceled or others then get stacked diagnostics v_state=returned_sqlstate,v_message=message_text; update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=false,sqlstate=v_state,message=v_message where stage='drain-apply'; end;
 end if;
end
$drain$;
\echo CONNECT_WORKFLOWS_CW2_APPLY_DRAIN_STAGE_END
\echo CONNECT_WORKFLOWS_CW2_APPLY_DISCONNECT_STAGE_BEGIN
set local statement_timeout='5000ms';
do $disconnect$
declare v_disconnect text; v_state text; v_message text;
begin
 if not (select ready from cw2_catalog_apply_recovery_state) then
  insert into cw2_catalog_apply_recovery_stages(stage,stage_order,started_at,timeout_setting) values ('disconnect-apply',7,clock_timestamp(),current_setting('statement_timeout',true));
   begin
    if current_setting('statement_timeout',true) <> '5s' then raise exception 'CW2 disconnect stage did not retain exact five-second timeout'; end if;
   select dblink_disconnect('cw2_catalog_apply') into v_disconnect;
   update cw2_catalog_apply_recovery_state set connection_absent=not coalesce('cw2_catalog_apply'=any(dblink_get_connections()),false);
   if v_disconnect<>'OK' or not (select connection_absent from cw2_catalog_apply_recovery_state) then raise exception 'CW2 catalog apply did not disconnect exactly'; end if;
   update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=true where stage='disconnect-apply';
   raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_DISCONNECT_PASS';
   raise notice 'CONNECT_WORKFLOWS_CW2_APPLY_BUSY_TIMEOUT_DISCONNECT_PASS';
  exception when query_canceled or others then get stacked diagnostics v_state=returned_sqlstate,v_message=message_text; update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=false,sqlstate=v_state,message=v_message where stage='disconnect-apply'; end;
 end if;
end
$disconnect$;
\echo CONNECT_WORKFLOWS_CW2_APPLY_DISCONNECT_STAGE_END
\echo CONNECT_WORKFLOWS_CW2_APPLY_WRITER_CLEANUP_STAGE_BEGIN
\echo CONNECT_WORKFLOWS_CW2_APPLY_WRITER_ROLLBACK_STAGE_BEGIN
set local statement_timeout='5000ms';
do $writer_rollback$
declare v_rollback text; v_state text; v_message text;
begin
 if not (select ready from cw2_catalog_apply_recovery_state) then
  insert into cw2_catalog_apply_recovery_stages(stage,stage_order,started_at,timeout_setting) values ('rollback-writer',8,clock_timestamp(),current_setting('statement_timeout',true));
   begin
    if current_setting('statement_timeout',true) <> '5s' then raise exception 'CW2 writer rollback stage did not retain exact five-second timeout'; end if;
   select dblink_exec('cw2_catalog_writer','rollback') into v_rollback;
   if v_rollback<>'ROLLBACK' then raise exception 'CW2 catalog writer rollback did not finish exactly'; end if;
   update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=true where stage='rollback-writer';
  exception when query_canceled or others then get stacked diagnostics v_state=returned_sqlstate,v_message=message_text; update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=false,sqlstate=v_state,message=v_message where stage='rollback-writer'; end;
 end if;
end
$writer_rollback$;
\echo CONNECT_WORKFLOWS_CW2_APPLY_WRITER_ROLLBACK_STAGE_END
\echo CONNECT_WORKFLOWS_CW2_APPLY_WRITER_DISCONNECT_STAGE_BEGIN
set local statement_timeout='5000ms';
do $writer_disconnect$
declare v_disconnect text; v_state text; v_message text;
begin
 if not (select ready from cw2_catalog_apply_recovery_state) then
  insert into cw2_catalog_apply_recovery_stages(stage,stage_order,started_at,timeout_setting) values ('disconnect-writer',9,clock_timestamp(),current_setting('statement_timeout',true));
   begin
    if current_setting('statement_timeout',true) <> '5s' then raise exception 'CW2 writer disconnect stage did not retain exact five-second timeout'; end if;
   select dblink_disconnect('cw2_catalog_writer') into v_disconnect;
   if v_disconnect<>'OK' then raise exception 'CW2 catalog writer disconnect did not finish exactly'; end if;
   update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=true where stage='disconnect-writer';
  exception when query_canceled or others then get stacked diagnostics v_state=returned_sqlstate,v_message=message_text; update cw2_catalog_apply_recovery_stages set finished_at=clock_timestamp(),succeeded=false,sqlstate=v_state,message=v_message where stage='disconnect-writer'; end;
 end if;
end
$writer_disconnect$;
\echo CONNECT_WORKFLOWS_CW2_APPLY_WRITER_DISCONNECT_STAGE_END
\echo CONNECT_WORKFLOWS_CW2_APPLY_WRITER_CLEANUP_STAGE_END
\echo CONNECT_WORKFLOWS_CW2_APPLY_RECOVERY_RECORDS_BEGIN
select 'CONNECT_WORKFLOWS_CW2_APPLY_RECOVERY_STAGE:' || stage || ':' || timeout_setting || ':' || coalesce(sqlstate,'OK') || ':' || coalesce(message,'OK')
from cw2_catalog_apply_recovery_stages
order by stage_order;
\echo CONNECT_WORKFLOWS_CW2_APPLY_RECOVERY_RECORDS_END
do $recovery_final$
declare v_failures text;
begin
 if not (select ready from cw2_catalog_apply_recovery_state) then
  select string_agg(stage||':'||timeout_setting||':'||coalesce(sqlstate,'UNKNOWN')||':'||coalesce(message,'UNKNOWN'),';' order by stage_order) into v_failures from cw2_catalog_apply_recovery_stages where succeeded is not true;
  raise exception 'CW2 catalog apply readiness recovery required: %',coalesce(v_failures,'UNKNOWN_RECOVERY_FAILURE');
 end if;
end
$recovery_final$;
\echo CONNECT_WORKFLOWS_CW2_APPLY_READINESS_SERVER_BOUND_PASS
commit;
\echo CONNECT_WORKFLOWS_CW2_APPLY_REACHED_PROBE_PASS
select dblink_send_query('cw2_catalog_writer',$remote$
set local lock_timeout='500ms';
do $cw2_writer_action_timeout$
begin
  if current_setting('lock_timeout',true) <> '500ms' then
    raise exception 'CW2 catalog writer action did not activate the exact transaction-local timeout';
  end if;
end
$cw2_writer_action_timeout$;
update public.inventory_products set name=name
where id='27040000-0000-4000-8000-000000000005'
  and farm_id='27010000-0000-4000-8000-000000000005'
$remote$);
do $wait_writer$
declare v_done boolean := false;
begin
  for i in 1..100 loop
    select dblink_is_busy('cw2_catalog_writer')=0 into v_done;
    exit when v_done;
    perform pg_sleep(0.05);
  end loop;
  if not v_done then
    perform dblink_cancel_query('cw2_catalog_writer');
    raise exception 'CW2 catalog writer did not finish inside the exact asynchronous wait bound';
  end if;
end
$wait_writer$;
create temporary table cw2_catalog_writer_setup_result(status text check(status='SET'));
insert into cw2_catalog_writer_setup_result
select status from dblink_get_result('cw2_catalog_writer') as setup(status text);
create temporary table cw2_catalog_writer_attestation_result(status text check(status='DO'));
insert into cw2_catalog_writer_attestation_result
select status from dblink_get_result('cw2_catalog_writer') as attestation(status text);
create temporary table cw2_catalog_writer_result(result_count integer check(result_count=0),message text);
insert into cw2_catalog_writer_result(result_count)
select count(status) from dblink_get_result('cw2_catalog_writer',false) as failed_action(status text);
update cw2_catalog_writer_result set message=dblink_error_message('cw2_catalog_writer');
do $writer$
begin
  if (select status from cw2_catalog_writer_setup_result) <> 'SET'
     or (select status from cw2_catalog_writer_attestation_result) <> 'DO'
     or (select result_count from cw2_catalog_writer_result) <> 0
     or (select message from cw2_catalog_writer_result) is null
     or (select message from cw2_catalog_writer_result) !~ '^ERROR:  canceling statement due to lock timeout' then
    raise exception 'CW2 catalog writer did not fail for the exact server lock-timeout cause';
  end if;
end
$writer$;
create temporary table cw2_catalog_writer_terminal_drain(
  writer_terminal_results integer check(writer_terminal_results=0)
);
insert into cw2_catalog_writer_terminal_drain
select count(*) from dblink_get_result('cw2_catalog_writer') as terminal(status text);
\echo CONNECT_WORKFLOWS_CW2_WRITER_ASYNC_RESULT_DRAIN_PASS
\echo CONNECT_WORKFLOWS_CW2_WRITER_LOCK_TIMEOUT_PASS
select dblink_exec('cw2_catalog_writer','rollback');
select pg_advisory_unlock(25000,2);
\echo CONNECT_WORKFLOWS_CW2_CATALOG_LOCK_RELEASE_PASS
\echo CONNECT_WORKFLOWS_CW2_ASYNC_RESULT_COLLECTION_BEGIN
create temporary table cw2_catalog_apply_result(result jsonb);
insert into cw2_catalog_apply_result select result from dblink_get_result('cw2_catalog_apply') as completed(result jsonb);
create temporary table cw2_catalog_apply_terminal_drain(
  terminal_results integer check(terminal_results=0)
);
insert into cw2_catalog_apply_terminal_drain
select count(*) from dblink_get_result('cw2_catalog_apply') as terminal(result jsonb);
\echo CONNECT_WORKFLOWS_CW2_ASYNC_RESULT_DRAIN_PASS
select dblink_exec('cw2_catalog_writer','begin');
create temporary table cw2_catalog_writer_released(status text);
insert into cw2_catalog_writer_released
select dblink_exec('cw2_catalog_writer',$remote$
set role authenticated;
set "request.jwt.claims"='{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}';
set "request.jwt.claim.sub"='27000000-0000-4000-8000-000000000001';
set "request.headers"='{"x-farm-rx-expected-user-id":"27000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\"27010000-0000-4000-8000-000000000005\":1}"}';
set local lock_timeout='500ms';
do $cw2_remote_auth$
begin
  if current_user <> 'authenticated'
     or session_user <> 'supabase_admin'
     or current_database() <> 'postgres'
     or inet_client_addr() is not null
     or not exists(select 1 from pg_catalog.pg_roles where rolname='authenticated' and not rolsuper and not rolbypassrls)
     or current_setting('lock_timeout',true) <> '500ms'
     or current_setting('request.jwt.claims',true)::jsonb <> '{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}'::jsonb
     or current_setting('request.jwt.claim.sub',true) <> '27000000-0000-4000-8000-000000000001'
     or current_setting('request.headers',true)::jsonb <> '{"x-farm-rx-expected-user-id":"27000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\"27010000-0000-4000-8000-000000000005\":1}"}'::jsonb then
    raise exception 'CW2 catalog writer session did not enter the exact authenticated local boundary';
  end if;
end
$cw2_remote_auth$;
update public.inventory_products set name=name
where id='27040000-0000-4000-8000-000000000005'
  and farm_id='27010000-0000-4000-8000-000000000005'
$remote$);
select dblink_exec('cw2_catalog_writer','rollback');
select dblink_disconnect('cw2_catalog_apply');
select dblink_disconnect('cw2_catalog_writer');
drop trigger cw2_catalog_probe_pause on public.assigned_program_pass_products;
drop function public.cw2_catalog_probe_pause();

do $final$
begin
  if (select count(*) from cw2_catalog_apply_result) <> 1
     or (select status from cw2_catalog_writer_released) <> 'UPDATE 1'
     or not exists(select 1 from public.program_inventory_matches where assigned_product_id='c2500000-0000-4000-8000-000000000002' and quantity_in_inventory_unit=0.001)
     or not exists(select 1 from public.assigned_program_passes where id='c2500000-0000-4000-8000-000000000001' and status='applied' and application_record_id is null)
     or exists(select 1 from public.application_records where notes like 'Created from Programs pass c2500000%')
     or exists(select 1 from public.application_products)
     or (select on_hand_quantity from public.inventory_on_hand where farm_id='27010000-0000-4000-8000-000000000005' and product_id='27040000-0000-4000-8000-000000000005') <> 19.998 then
    raise exception 'CW2 concurrent catalog proof did not preserve one exact no-record draw';
  end if;
end
$final$;
-- CW2-CREDENTIAL-HANDOFF concurrency boundary end.

-- Direct authenticated catalog writers must share the confirmation's exact
-- farm-scoped advisory key for every DML operation, not UPDATE alone.
\echo CONNECT_WORKFLOWS_CW2_CATALOG_INSERT_LOCK_TEST_BEGIN
select dblink_connect('cw2_catalog_insert_writer','dbname=postgres user=supabase_admin options=''-csearch_path= -cstatement_timeout=15000 -clock_timeout=500'' application_name=cw2_catalog_insert_writer');
select pg_catalog.pg_advisory_lock(
  pg_catalog.hashtext('27010000-0000-4000-8000-000000000005'),
  pg_catalog.hashtext('inventory-products-catalog')
);
select dblink_exec('cw2_catalog_insert_writer',$remote$
begin;
set role authenticated;
set "request.jwt.claims"='{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}';
set "request.jwt.claim.sub"='27000000-0000-4000-8000-000000000001';
set "request.headers"='{"x-farm-rx-expected-user-id":"27000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\"27010000-0000-4000-8000-000000000005\":1}"}';
set local lock_timeout='500ms';
$remote$);
select dblink_send_query('cw2_catalog_insert_writer',$remote$
insert into public.inventory_products (id,farm_id,product_kind,name,inventory_unit,is_active)
values ('c2500000-0000-4000-8000-000000000010','27010000-0000-4000-8000-000000000005','chemical','CW2 catalog DML lock probe','gal',true)
$remote$);
do $insert_wait$
declare v_done boolean:=false;
begin
  for i in 1..100 loop
    select dblink_is_busy('cw2_catalog_insert_writer')=0 into v_done;
    exit when v_done;
    perform pg_sleep(0.05);
  end loop;
  if not v_done then raise exception 'CW2 catalog INSERT did not finish inside the exact asynchronous wait bound'; end if;
end
$insert_wait$;
create temporary table cw2_catalog_insert_timeout(result_count integer check(result_count=0),message text);
insert into cw2_catalog_insert_timeout(result_count)
select count(status) from dblink_get_result('cw2_catalog_insert_writer',false) as failed_action(status text);
update cw2_catalog_insert_timeout set message=dblink_error_message('cw2_catalog_insert_writer');
create temporary table cw2_catalog_insert_terminal_drain(result_count integer check(result_count=0));
insert into cw2_catalog_insert_terminal_drain(result_count)
select count(*) from dblink_get_result('cw2_catalog_insert_writer') as terminal(status text);
do $insert_timeout$
begin
  if (select result_count from cw2_catalog_insert_timeout) <> 0
     or (select message from cw2_catalog_insert_timeout) !~ '^ERROR:  canceling statement due to lock timeout' then
    raise exception 'CW2 catalog INSERT did not block on the exact farm lock';
  end if;
end
$insert_timeout$;
select dblink_exec('cw2_catalog_insert_writer','rollback');
select pg_catalog.pg_advisory_unlock(
  pg_catalog.hashtext('27010000-0000-4000-8000-000000000005'),
  pg_catalog.hashtext('inventory-products-catalog')
);
select dblink_exec('cw2_catalog_insert_writer',$remote$
begin;
set role authenticated;
set "request.jwt.claims"='{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}';
set "request.jwt.claim.sub"='27000000-0000-4000-8000-000000000001';
set "request.headers"='{"x-farm-rx-expected-user-id":"27000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\"27010000-0000-4000-8000-000000000005\":1}"}';
set local lock_timeout='500ms';
insert into public.inventory_products (id,farm_id,product_kind,name,inventory_unit,is_active)
values ('c2500000-0000-4000-8000-000000000010','27010000-0000-4000-8000-000000000005','chemical','CW2 catalog DML lock probe','gal',true)
$remote$);
select dblink_exec('cw2_catalog_insert_writer','commit');
\echo CONNECT_WORKFLOWS_CW2_CATALOG_INSERT_LOCK_TIMEOUT_PASS
\echo CONNECT_WORKFLOWS_CW2_CATALOG_INSERT_RELEASE_PASS

\echo CONNECT_WORKFLOWS_CW2_CATALOG_DELETE_LOCK_TEST_BEGIN
select pg_catalog.pg_advisory_lock(
  pg_catalog.hashtext('27010000-0000-4000-8000-000000000005'),
  pg_catalog.hashtext('inventory-products-catalog')
);
select dblink_exec('cw2_catalog_insert_writer',$remote$
begin;
set role authenticated;
set "request.jwt.claims"='{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}';
set "request.jwt.claim.sub"='27000000-0000-4000-8000-000000000001';
set "request.headers"='{"x-farm-rx-expected-user-id":"27000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\"27010000-0000-4000-8000-000000000005\":1}"}';
set local lock_timeout='500ms';
$remote$);
select dblink_send_query('cw2_catalog_insert_writer',$remote$
delete from public.inventory_products
where id='c2500000-0000-4000-8000-000000000010'
  and farm_id='27010000-0000-4000-8000-000000000005'
$remote$);
do $delete_wait$
declare v_done boolean:=false;
begin
  for i in 1..100 loop
    select dblink_is_busy('cw2_catalog_insert_writer')=0 into v_done;
    exit when v_done;
    perform pg_sleep(0.05);
  end loop;
  if not v_done then raise exception 'CW2 catalog DELETE did not finish inside the exact asynchronous wait bound'; end if;
end
$delete_wait$;
create temporary table cw2_catalog_delete_timeout(result_count integer check(result_count=0),message text);
insert into cw2_catalog_delete_timeout(result_count)
select count(status) from dblink_get_result('cw2_catalog_insert_writer',false) as failed_action(status text);
update cw2_catalog_delete_timeout set message=dblink_error_message('cw2_catalog_insert_writer');
create temporary table cw2_catalog_delete_terminal_drain(result_count integer check(result_count=0));
insert into cw2_catalog_delete_terminal_drain(result_count)
select count(*) from dblink_get_result('cw2_catalog_insert_writer') as terminal(status text);
do $delete_timeout$
begin
  if (select result_count from cw2_catalog_delete_timeout) <> 0
     or (select message from cw2_catalog_delete_timeout) !~ '^ERROR:  canceling statement due to lock timeout' then
    raise exception 'CW2 catalog DELETE did not block on the exact farm lock';
  end if;
end
$delete_timeout$;
select dblink_exec('cw2_catalog_insert_writer','rollback');
select pg_catalog.pg_advisory_unlock(
  pg_catalog.hashtext('27010000-0000-4000-8000-000000000005'),
  pg_catalog.hashtext('inventory-products-catalog')
);
select dblink_exec('cw2_catalog_insert_writer',$remote$
begin;
set role authenticated;
set "request.jwt.claims"='{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}';
set "request.jwt.claim.sub"='27000000-0000-4000-8000-000000000001';
set "request.headers"='{"x-farm-rx-expected-user-id":"27000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\"27010000-0000-4000-8000-000000000005\":1}"}';
set local lock_timeout='500ms';
delete from public.inventory_products
where id='c2500000-0000-4000-8000-000000000010'
  and farm_id='27010000-0000-4000-8000-000000000005'
$remote$);
select dblink_exec('cw2_catalog_insert_writer','commit');
select dblink_disconnect('cw2_catalog_insert_writer');
do $catalog_dml_final$
begin
  if exists(select 1 from public.inventory_products where id='c2500000-0000-4000-8000-000000000010') then
    raise exception 'CW2 catalog DELETE release did not remove the disposable probe row';
  end if;
end
$catalog_dml_final$;
\echo CONNECT_WORKFLOWS_CW2_CATALOG_DELETE_LOCK_TIMEOUT_PASS
\echo CONNECT_WORKFLOWS_CW2_CATALOG_DELETE_RELEASE_PASS

\echo CONNECT_WORKFLOWS_CW2_SQL_PASS
