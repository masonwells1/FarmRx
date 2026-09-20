-- Migration 0040 (server-owned farm access-epoch fencing), ported from verify-0040-disposable.ps1
-- so it runs on a development machine.
--
-- Why this file exists: 0040 is one of three lanes written only in PowerShell against a Docker
-- container, so nothing runnable in a sandbox checked its rules. LD-1 shipped six foreign keys with
-- no covering index and only found out in CI, because that rule lived in the same kind of lane.
-- The PowerShell twin stays authoritative for CI; this is the same proof against the disposable
-- database the bash lane already builds from every migration.
--
-- Two differences from the twin, both forced by running inside a shared database rather than a
-- fresh container. Its probes are separate psql invocations whose failure is the assertion; here an
-- uncaught error would abort the file, so every expected failure is a plpgsql block that raises if
-- the statement is *accepted* and checks the message otherwise. And the seeded rows take their own
-- uuid block (users 00...013-016, farms 00...0e0-0e1, entity 00...0e2) so they cannot collide with
-- the five assertion files that ran before it.
--
-- Every failure raises; the last line prints EPOCH_FENCING_DISPOSABLE_PASS.

-- ------------------------------------------------- 1. the catalog rules, which need no fixture
-- These are the cheapest rules in the lane and the ones most like the covering-index rule that
-- reached CI: they are true or false about the whole schema, they need no seeded row, and nothing
-- outside PowerShell asked them until now. A new farm-scoped table that forgets the epoch guard,
-- or an accidental grant on the epoch table, now fails here.
do $$
declare v_missing integer; v_unscoped text[];
begin
  if has_table_privilege('authenticated','public.farm_access_epochs','select')
    or has_table_privilege('anon','public.farm_access_epochs','select')
    or has_table_privilege('service_role','public.farm_access_epochs','select') then
    raise exception 'farm_access_epochs has direct Data API access';
  end if;

  if not has_function_privilege('authenticated','public.get_current_farm_access_epochs()','execute')
    or has_function_privilege('anon','public.get_current_farm_access_epochs()','execute')
    or has_function_privilege('service_role','public.get_current_farm_access_epochs()','execute') then
    raise exception 'epoch RPC grants are wrong';
  end if;

  if has_function_privilege('authenticated','public.current_request_expected_user_id()','execute')
    or has_function_privilege('anon','public.current_request_expected_user_id()','execute')
    or has_function_privilege('service_role','public.current_request_expected_user_id()','execute') then
    raise exception 'expected-user parser is directly executable';
  end if;

  -- Every ordinary public table carrying farm_id wears the row guard. This is the rule a new
  -- tranche is most likely to break, because adding a table is how a tranche starts.
  select count(*) into v_missing
  from information_schema.columns column_row
  where column_row.table_schema='public' and column_row.column_name='farm_id'
    and column_row.table_name<>'farm_access_epochs'
    and exists (
      select 1 from pg_catalog.pg_class base_relation
      join pg_catalog.pg_namespace base_namespace on base_namespace.oid=base_relation.relnamespace
      where base_namespace.nspname='public' and base_relation.relname=column_row.table_name
        and base_relation.relkind in ('r','p')
    )
    and not exists (
      select 1 from pg_catalog.pg_trigger trigger_row
      join pg_catalog.pg_class relation on relation.oid=trigger_row.tgrelid
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='public' and relation.relname=column_row.table_name
        and trigger_row.tgname='farm_access_epoch_guard' and not trigger_row.tgisinternal
    );
  if v_missing<>0 then raise exception '% farm-scoped tables lack the access epoch guard',v_missing; end if;

  -- Anything a signed-in client may write is farm-scoped, so the guard has a farm to check.
  select array_agg(distinct privilege.table_name order by privilege.table_name) into v_unscoped
  from information_schema.table_privileges privilege
  where privilege.table_schema='public' and privilege.grantee='authenticated'
    and privilege.privilege_type in ('INSERT','UPDATE','DELETE')
    and privilege.table_name not in ('farms','push_subscriptions')
    and not exists (
      select 1 from information_schema.columns farm_column
      where farm_column.table_schema=privilege.table_schema
        and farm_column.table_name=privilege.table_name and farm_column.column_name='farm_id'
    );
  if cardinality(v_unscoped)>0 then raise exception 'authenticated writable tables lack farm_id fencing: %',v_unscoped; end if;

  -- The storage guard is a separate trigger on a separate schema and is easy to lose when the
  -- storage bootstrap changes shape.
  if not exists (
    select 1 from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation on relation.oid=trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='storage' and relation.relname='objects'
      and trigger_row.tgname='farm_access_epoch_guard' and not trigger_row.tgisinternal
  ) then raise exception 'storage.objects lacks the access epoch guard'; end if;
end $$;

-- ------------------------------------------------- 1b. the storage guard that actually runs
-- 0040 defines guard_storage_object_farm_access_epoch, and soil_rx_storage later does a
-- `create or replace` on the same name to add the soil-test bucket. Only the second one is live.
-- This cost a debugging round: a mutation deleting the old-farm check from 0040's copy changed
-- nothing at all, because that copy is dead code. Anyone hardening the storage boundary by editing
-- 0040 would get the same silence. Pin the live body so the two cannot be confused: if the
-- installed function stops covering all three buckets, the later definition has been lost.
do $$ declare v_body text; begin
  select p.prosrc into v_body
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='guard_storage_object_farm_access_epoch';
  if v_body is null then raise exception 'the storage object epoch guard is missing'; end if;
  if position('soil-test-reports' in v_body)=0 then
    raise exception 'the installed storage epoch guard predates soil_rx_storage, so the live definition has been lost';
  end if;
  -- Both farms are still checked on a move, which is the property section 8 exercises.
  if (length(v_body) - length(replace(v_body,'assert_current_farm_access_epoch','')))/32 <> 2 then
    raise exception 'the live storage epoch guard no longer asserts both the old and the new farm';
  end if;
end $$;

-- ------------------------------------------------- 2. the fixture
insert into auth.users(id,email) values
  ('00000000-0000-4000-8000-000000000013','epoch-owner@example.test'),
  ('00000000-0000-4000-8000-000000000014','epoch-worker@example.test'),
  ('00000000-0000-4000-8000-000000000016','epoch-bootstrap@example.test')
on conflict do nothing;

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000013"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000013','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-0000000000e0',1)::text)::text,false);

insert into public.farms(id,name,created_by) values ('00000000-0000-4000-8000-0000000000e0','Epoch Farm','00000000-0000-4000-8000-000000000013');
insert into public.entities(id,farm_id,name,entity_type) values ('00000000-0000-4000-8000-0000000000e2','00000000-0000-4000-8000-0000000000e0','Epoch Entity','individual');
insert into public.farm_memberships(farm_id,user_id,role,status) values ('00000000-0000-4000-8000-0000000000e0','00000000-0000-4000-8000-000000000014','worker','active');

insert into public.farms(id,name,created_by) values ('00000000-0000-4000-8000-0000000000e1','Second Epoch Farm','00000000-0000-4000-8000-000000000013');
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000013','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-0000000000e0',1,'00000000-0000-4000-8000-0000000000e1',1)::text)::text,false);
insert into public.farm_memberships(farm_id,user_id,role,status) values ('00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-000000000014','worker','active');

-- ------------------------------------------------- 3. an epoch only ever moves forward
-- The epoch is the farm's answer to "has this person's access changed since they loaded the page".
-- It must advance on every grant and every revoke, including the financial flag, or a client that
-- lost a permission keeps writing with the access it had when it loaded.
do $$ begin
  if (select access_epoch from public.farm_access_epochs where farm_id='00000000-0000-4000-8000-0000000000e0' and user_id='00000000-0000-4000-8000-000000000013')<>1 then raise exception 'owner bootstrap epoch was not one'; end if;
  if (select access_epoch from public.farm_access_epochs where farm_id='00000000-0000-4000-8000-0000000000e0' and user_id='00000000-0000-4000-8000-000000000014')<>1 then raise exception 'member grant epoch was not one'; end if;
end $$;

update public.farm_memberships set status='revoked' where farm_id='00000000-0000-4000-8000-0000000000e0' and user_id='00000000-0000-4000-8000-000000000014';
update public.farm_memberships set status='active' where farm_id='00000000-0000-4000-8000-0000000000e0' and user_id='00000000-0000-4000-8000-000000000014';
do $$ begin
  if (select access_epoch from public.farm_access_epochs where farm_id='00000000-0000-4000-8000-0000000000e0' and user_id='00000000-0000-4000-8000-000000000014')<>3 then raise exception 'revoke/regrant did not advance epoch to three'; end if;
end $$;

update public.farm_memberships set can_view_financials=true where farm_id='00000000-0000-4000-8000-0000000000e0' and user_id='00000000-0000-4000-8000-000000000014';
update public.farm_memberships set can_view_financials=false where farm_id='00000000-0000-4000-8000-0000000000e0' and user_id='00000000-0000-4000-8000-000000000014';
do $$ begin
  if (select access_epoch from public.farm_access_epochs where farm_id='00000000-0000-4000-8000-0000000000e0' and user_id='00000000-0000-4000-8000-000000000014')<>5 then raise exception 'financial grant/revoke did not advance epoch to five'; end if;
end $$;

-- ------------------------------------------------- 4. the first farm is the one narrow exception
-- A brand-new person has no farm and therefore no epoch, so the bootstrap has to be allowed to
-- create both in one transaction. The exception is narrow on purpose: it still ends with epoch one.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000016"}',false);
select set_config('request.headers','{}',false);
do $$ declare v_result jsonb; begin
  v_result:=public.bootstrap_first_farm('Epoch Bootstrap Farm','Epoch Bootstrap Entity','llc');
  if v_result->'farm'->>'id' is null or v_result->'entity'->>'id' is null then raise exception 'bootstrap did not return its farm and entity'; end if;
  if (select access_epoch from public.farm_access_epochs where user_id='00000000-0000-4000-8000-000000000016')<>1 then raise exception 'bootstrap did not create owner epoch one'; end if;
end $$;

-- ------------------------------------------------- 5. a stale epoch is refused on every write path
-- The worker's epoch is now 5. A client still holding 1 is a browser tab opened before the owner
-- changed its access. Each of the four ways to write has to refuse it, not just the direct one.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000014"}',false);

do $$ begin
  -- direct table write
  perform set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000014','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-0000000000e0',1)::text)::text,false);
  begin
    update public.entities set name='STALE DIRECT WRITE' where id='00000000-0000-4000-8000-0000000000e2';
    raise exception 'a revoked-then-regranted client wrote with its old epoch';
  exception when others then
    if position('FARM_ACCESS_EPOCH_CHANGED' in sqlerrm)=0 then raise; end if;
  end;

  -- no header at all
  perform set_config('request.headers','{}',false);
  begin
    update public.entities set name='MISSING HEADER WRITE' where id='00000000-0000-4000-8000-0000000000e2';
    raise exception 'an authenticated farm write succeeded without an epoch header';
  exception when others then
    if position('FARM_ACCESS_EPOCH_CHANGED' in sqlerrm)=0 then raise; end if;
  end;

  -- a SECURITY DEFINER RPC, which bypasses row-level security and so must be fenced itself
  perform set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000014','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-0000000000e0',1)::text)::text,false);
  begin
    perform public.create_notification('00000000-0000-4000-8000-0000000000e0','00000000-0000-4000-8000-000000000014','task','STALE RPC WRITE',null,'/notifications','epoch-stale-rpc-port');
    raise exception 'a security definer RPC bypassed the stale epoch guard';
  exception when others then
    if position('FARM_ACCESS_EPOCH_CHANGED' in sqlerrm)=0 then raise; end if;
  end;

  -- a storage object, whose farm lives in the object path rather than a column
  begin
    insert into storage.objects(bucket_id,name,owner) values ('scouting-photos','00000000-0000-4000-8000-0000000000e0/field/note/photo.jpg','00000000-0000-4000-8000-000000000014');
    raise exception 'a stale storage write bypassed the farm epoch guard';
  exception when others then
    if position('FARM_ACCESS_EPOCH_CHANGED' in sqlerrm)=0 then raise; end if;
  end;
end $$;

-- ------------------------------------------------- 6. the current epoch is accepted on all of them
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000014','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-0000000000e0',5)::text)::text,false);
update public.entities set name='Current Epoch Entity' where id='00000000-0000-4000-8000-0000000000e2';
select public.create_notification('00000000-0000-4000-8000-0000000000e0','00000000-0000-4000-8000-000000000014','task','Current RPC write',null,'/notifications','epoch-current-rpc-port');
insert into storage.objects(bucket_id,name,owner) values ('scouting-photos','00000000-0000-4000-8000-0000000000e0/field/note/photo.jpg','00000000-0000-4000-8000-000000000014');
do $$ begin
  if (select name from public.entities where id='00000000-0000-4000-8000-0000000000e2')<>'Current Epoch Entity' then raise exception 'current direct write did not persist'; end if;
  if (select count(*) from public.notifications where dedupe_key='epoch-current-rpc-port')<>1 then raise exception 'current RPC write did not persist'; end if;
  if (select count(*) from storage.objects where name like '00000000-0000-4000-8000-0000000000e0/%')<>1 then raise exception 'current storage write did not persist'; end if;
  if (select count(*) from public.get_current_farm_access_epochs() where farm_id='00000000-0000-4000-8000-0000000000e0' and access_epoch=5)<>1 then raise exception 'epoch RPC did not return the current accessible farm'; end if;
end $$;

-- ------------------------------------------------- 7. the header names a user, not just an epoch
-- Two people can share a farm and its epoch. If the guard checked only the epoch, one signed-in
-- user could replay an operation the other captured. The expected-user half is what stops that.
do $$ begin
  perform set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000013','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-0000000000e0',5)::text)::text,false);
  begin
    update public.entities set name='CROSS USER WRITE' where id='00000000-0000-4000-8000-0000000000e2';
    raise exception 'a same-farm user switch re-authored an operation captured by another user';
  exception when others then
    if position('FARM_ACCESS_EPOCH_CHANGED' in sqlerrm)=0 then raise; end if;
  end;
end $$;

-- ------------------------------------------------- 8. a storage move is judged by both farms
-- Moving an object from one farm to another touches two farms, and checking only the destination
-- would let a client with stale access to the *source* farm move a photo out of it.
do $$ begin
  perform set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000014','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-0000000000e0',1,'00000000-0000-4000-8000-0000000000e1',1)::text)::text,false);
  begin
    update storage.objects
    set name='00000000-0000-4000-8000-0000000000e1/field/note/photo.jpg'
    where name='00000000-0000-4000-8000-0000000000e0/field/note/photo.jpg';
    raise exception 'a storage move validated only the new farm and ignored the stale old-farm epoch';
  exception when others then
    if position('FARM_ACCESS_EPOCH_CHANGED' in sqlerrm)=0 then raise; end if;
  end;
end $$;

select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000014','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-0000000000e0',5,'00000000-0000-4000-8000-0000000000e1',1)::text)::text,false);
update storage.objects
set name='00000000-0000-4000-8000-0000000000e1/field/note/photo.jpg'
where name='00000000-0000-4000-8000-0000000000e0/field/note/photo.jpg';
do $$ begin
  if (select count(*) from storage.objects where name='00000000-0000-4000-8000-0000000000e1/field/note/photo.jpg')<>1 then raise exception 'fresh old/new epoch storage move did not persist'; end if;
end $$;

-- ------------------------------------------------- 10. the farm boundary holds where the generic block does not
-- The row guard has a branch for a row whose farm_id changes: it asserts the *old* farm's epoch as
-- well as the new one. A mutation deleting that branch left every proof green, here and in CI, so
-- it is worth knowing what actually protects the boundary.
--
-- Most farm-scoped tables carry a prevent_farm_move trigger. Exactly one table a signed-in client
-- may UPDATE does not: soil_tests. It is not open, though -- it blocks the move with its own
-- identity trigger under a different name. So the boundary holds for every client-updatable table,
-- and the guard's old-farm branch is defence in depth rather than the thing standing in the way.
-- That is worth pinning both ways: the behaviour here, and the "only one" in section 11.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000013"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000013','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-0000000000e0',1,'00000000-0000-4000-8000-0000000000e1',1)::text)::text,false);
insert into public.entities(id,farm_id,name,entity_type) values ('00000000-0000-4000-8000-0000000000e3','00000000-0000-4000-8000-0000000000e1','Second Epoch Entity','individual');
insert into public.fields(id,farm_id,operating_entity_id,name,total_acres) values
  ('00000000-0000-4000-8000-0000000000e4','00000000-0000-4000-8000-0000000000e0','00000000-0000-4000-8000-0000000000e2','Epoch Field A',10),
  ('00000000-0000-4000-8000-0000000000e5','00000000-0000-4000-8000-0000000000e1','00000000-0000-4000-8000-0000000000e3','Epoch Field B',10);
insert into public.soil_tests(id,farm_id,field_id,sample_date,lab_name) values
  ('00000000-0000-4000-8000-0000000000e6','00000000-0000-4000-8000-0000000000e0','00000000-0000-4000-8000-0000000000e4','2026-07-01','Epoch Lab');

do $$ begin
  -- Fresh epochs on both farms, so nothing here is the epoch guard talking: this is the boundary.
  begin
    update public.soil_tests
    set farm_id='00000000-0000-4000-8000-0000000000e1', field_id='00000000-0000-4000-8000-0000000000e5'
    where id='00000000-0000-4000-8000-0000000000e6';
    raise exception 'soil_tests accepted a farm move, so nothing blocks the one gap in prevent_farm_move';
  exception when others then
    if position('identity cannot be changed' in sqlerrm)=0 then raise; end if;
  end;
  if (select farm_id from public.soil_tests where id='00000000-0000-4000-8000-0000000000e6')<>'00000000-0000-4000-8000-0000000000e0' then
    raise exception 'the refused farm move changed the row anyway'; end if;
end $$;

-- ------------------------------------------------- 11. and it stays the only gap
-- A new table that a signed-in client can UPDATE, wearing the epoch guard but no prevent_farm_move
-- trigger, is a farm boundary resting entirely on the old-farm branch above. That may be fine, but
-- it should be a decision someone made, not one that arrives with a migration. If this list grows,
-- either add prevent_farm_move to the new table or extend section 10 to prove its own blocker.
do $$ declare v_movable text[]; begin
  select array_agg(c.relname order by c.relname) into v_movable
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public' and c.relkind in ('r','p')
    and has_table_privilege('authenticated', c.oid, 'update')
    and exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid=c.oid and t.tgname='farm_access_epoch_guard' and not t.tgisinternal)
    and not exists (select 1 from pg_catalog.pg_trigger t where t.tgrelid=c.oid and t.tgname like '%prevent_farm_move' and not t.tgisinternal);
  if v_movable is distinct from array['soil_tests']::text[] then
    raise exception 'client-updatable epoch-guarded tables without prevent_farm_move are now %, not just soil_tests', coalesce(array_to_string(v_movable,','),'(none)');
  end if;
end $$;

-- ------------------------------------------------- 9. the server is not a browser
-- The epoch protocol exists to fence a browser tab holding stale access. A server job has no tab,
-- so service_role writes without headers -- and that exemption is itself worth pinning, because
-- silently widening it would hand every RPC a way around the guard.
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select set_config('request.headers','{}',false);
insert into public.notifications(farm_id,user_id,category,title,created_by)
values ('00000000-0000-4000-8000-0000000000e0','00000000-0000-4000-8000-000000000013','task','Service worker write port','00000000-0000-4000-8000-000000000013');
do $$ begin
  if (select count(*) from public.notifications where title='Service worker write port')<>1 then raise exception 'service-role server write did not bypass browser epoch protocol'; end if;
end $$;

select set_config('request.jwt.claims','',false);
select set_config('request.headers','{}',false);

select 'EPOCH_FENCING_DISPOSABLE_PASS' as result;
