-- Disposable-backend assertions for migration 20261021150000 (a deleted Field Log entry stays
-- deleted). Runs after every migration on a fresh database, in the same database and after the
-- other assertion files, so every id here (the ...0b.. range) is distinct from theirs. Every
-- failure raises; the last line prints FIELD_LOG_DELETED_ENTRIES_DISPOSABLE_PASS.
--
-- What is proved: an edit saved after the entry was deleted is refused with the one message the
-- client recognises, leaves no row behind, and is refused the same way when its replay comes
-- again; a repeat of a save (same operation, after a lost response) answers from its receipt
-- while the entry stands, and once the entry is deleted is refused too rather than answered with
-- the old row; a new entry still saves; a direct table insert of a deleted id
-- is refused too, a direct table delete is remembered, and an entry's id cannot be changed;
-- deleting a field remembers its entries; deleting a farm that still has entries works and takes
-- its remembered ids with it; and no client role holds any privilege or policy on the remembered
-- ids or can run the trigger functions. (The migration's fill-in of ids deleted before it ran
-- reads earlier receipts, so it is proved against a database with history, not here.)

\set ON_ERROR_STOP on
\set O   '''00000000-0000-4000-8000-000000000b01'''
\set F   '''00000000-0000-4000-8000-000000000b10'''
\set ENT '''00000000-0000-4000-8000-000000000b11'''
\set FN  '''00000000-0000-4000-8000-000000000b12'''
\set FS  '''00000000-0000-4000-8000-000000000b13'''

-- ------------------------------------------------- fixtures
insert into auth.users(id,email) values (:O,'fieldlog-delete-owner@example.test');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000b01"}',false);
insert into public.farms(id,name,created_by) values (:F,'Field Log Delete Farm',:O);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000b01','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000b10',1)::text)::text,false);
insert into public.entities(id,farm_id,name,entity_type) values (:ENT,:F,'Field Log Delete Entity','individual');
insert into public.fields(id,farm_id,operating_entity_id,name,total_acres) values (:FN,:F,:ENT,'North 80',80),(:FS,:F,:ENT,'South 40',40);

-- ------------------------------------------------- 1. the save and delete functions, as the farmer
set role authenticated;
do $$
declare
  v_farm uuid := '00000000-0000-4000-8000-000000000b10';
  v_north uuid := '00000000-0000-4000-8000-000000000b12';
  v_entry uuid := '00000000-0000-4000-8000-000000000b20';
  v_new uuid := '00000000-0000-4000-8000-000000000b21';
  v_saved jsonb;
begin
  -- Added, then edited, then deleted: the ordinary life of an entry.
  v_saved := public.save_field_log_entry(v_farm, '00000000-0000-4000-8000-000000000b30', jsonb_build_object('id', v_entry, 'field_id', v_north, 'entry_type', 'rainfall', 'observed_on', '2026-10-01', 'rainfall_in', 0.5));
  if (v_saved ->> 'rainfall_in')::numeric <> 0.5 then raise exception 'the first save returned %', v_saved; end if;
  v_saved := public.save_field_log_entry(v_farm, '00000000-0000-4000-8000-000000000b31', jsonb_build_object('id', v_entry, 'field_id', v_north, 'entry_type', 'rainfall', 'observed_on', '2026-10-01', 'rainfall_in', 0.6));
  if (v_saved ->> 'rainfall_in')::numeric <> 0.6 then raise exception 'an edit of a live entry did not update it: %', v_saved; end if;
  -- A repeat of that edit (the response was lost) answers from its receipt while the entry stands.
  v_saved := public.save_field_log_entry(v_farm, '00000000-0000-4000-8000-000000000b31', jsonb_build_object('id', v_entry, 'field_id', v_north, 'entry_type', 'rainfall', 'observed_on', '2026-10-01', 'rainfall_in', 0.6));
  if (v_saved ->> 'rainfall_in')::numeric <> 0.6 or (select count(*) from public.field_log_entries where id = v_entry) <> 1 then raise exception 'a repeated save of a live entry did not answer from its receipt: %', v_saved; end if;
  perform public.delete_field_log_entry(v_farm, v_entry);
  if exists (select 1 from public.field_log_entries where id = v_entry) then raise exception 'the delete left the entry'; end if;

  -- An edit queued on another device before the delete reaches the server after it.
  begin
    perform public.save_field_log_entry(v_farm, '00000000-0000-4000-8000-000000000b32', jsonb_build_object('id', v_entry, 'field_id', v_north, 'entry_type', 'rainfall', 'observed_on', '2026-10-01', 'rainfall_in', 0.9));
    raise exception 'an edit saved after the delete brought the entry back';
  exception when raise_exception then
    if sqlerrm <> 'field log entry was deleted and cannot be saved again' then raise; end if;
  end;
  if exists (select 1 from public.field_log_entries where id = v_entry) then raise exception 'the refused edit left a row'; end if;
  -- The same queued edit, sent again (a Retry, or a replay after a lost response), is refused the
  -- same way: a refusal leaves no receipt that could make it read as saved.
  begin
    perform public.save_field_log_entry(v_farm, '00000000-0000-4000-8000-000000000b32', jsonb_build_object('id', v_entry, 'field_id', v_north, 'entry_type', 'rainfall', 'observed_on', '2026-10-01', 'rainfall_in', 0.9));
    raise exception 'the refused edit, sent again, was answered as saved';
  exception when raise_exception then
    if sqlerrm <> 'field log entry was deleted and cannot be saved again' then raise; end if;
  end;

  -- The same refusal for a note, which takes the same insert.
  begin
    perform public.save_field_log_entry(v_farm, '00000000-0000-4000-8000-000000000b33', jsonb_build_object('id', v_entry, 'field_id', v_north, 'entry_type', 'note', 'observed_on', '2026-10-01', 'note', 'Standing water'));
    raise exception 'a note saved after the delete brought the entry back';
  exception when raise_exception then
    if sqlerrm <> 'field log entry was deleted and cannot be saved again' then raise; end if;
  end;

  -- The same repeat after the delete: answering from the receipt would hand the device the old
  -- row as saved, and it would put the entry back on screen. It is refused like any other save.
  begin
    perform public.save_field_log_entry(v_farm, '00000000-0000-4000-8000-000000000b31', jsonb_build_object('id', v_entry, 'field_id', v_north, 'entry_type', 'rainfall', 'observed_on', '2026-10-01', 'rainfall_in', 0.6));
    raise exception 'a repeated save of a deleted entry was answered from its receipt';
  exception when raise_exception then
    if sqlerrm <> 'field log entry was deleted and cannot be saved again' then raise; end if;
  end;
  if exists (select 1 from public.field_log_entries where id = v_entry) then raise exception 'the repeated save brought the entry back'; end if;
  -- The first save of the entry, repeated, is refused the same way.
  begin
    perform public.save_field_log_entry(v_farm, '00000000-0000-4000-8000-000000000b30', jsonb_build_object('id', v_entry, 'field_id', v_north, 'entry_type', 'rainfall', 'observed_on', '2026-10-01', 'rainfall_in', 0.5));
    raise exception 'a repeated first save of a deleted entry was answered from its receipt';
  exception when raise_exception then
    if sqlerrm <> 'field log entry was deleted and cannot be saved again' then raise; end if;
  end;

  -- A new entry, with its own new id, still saves.
  v_saved := public.save_field_log_entry(v_farm, '00000000-0000-4000-8000-000000000b34', jsonb_build_object('id', v_new, 'field_id', v_north, 'entry_type', 'rainfall', 'observed_on', '2026-10-02', 'rainfall_in', 0.25));
  if not exists (select 1 from public.field_log_entries where id = v_new) then raise exception 'a new entry did not save'; end if;
  -- And one the server names itself (no id sent).
  v_saved := public.save_field_log_entry(v_farm, '00000000-0000-4000-8000-000000000b35', jsonb_build_object('field_id', v_north, 'entry_type', 'note', 'observed_on', '2026-10-02', 'note', 'Tile running'));
  if not exists (select 1 from public.field_log_entries where id = (v_saved ->> 'id')::uuid) then raise exception 'a new entry without an id did not save'; end if;

  -- The remembered ids are not the client's to read.
  begin
    perform 1 from public.field_log_deleted_entries;
    raise exception 'the farmer can read the remembered deleted ids';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ------------------------------------------------- 2. direct table writes, as the farmer
do $$
declare
  v_farm uuid := '00000000-0000-4000-8000-000000000b10';
  v_north uuid := '00000000-0000-4000-8000-000000000b12';
  v_owner uuid := '00000000-0000-4000-8000-000000000b01';
begin
  -- The insert policy lets an editor insert rows directly; a deleted id is refused there too.
  begin
    insert into public.field_log_entries(id, farm_id, field_id, entry_type, observed_on, rainfall_in, created_by)
    values ('00000000-0000-4000-8000-000000000b20', v_farm, v_north, 'rainfall', '2026-10-01', 0.9, v_owner);
    raise exception 'a direct insert brought a deleted entry back';
  exception when raise_exception then
    if sqlerrm <> 'field log entry was deleted and cannot be saved again' then raise; end if;
  end;
  -- An entry's id cannot change: not to a deleted id, which would bring it back, nor to a new one,
  -- which would let the old id go without being remembered. Other columns still update.
  insert into public.field_log_entries(id, farm_id, field_id, entry_type, observed_on, rainfall_in, created_by)
  values ('00000000-0000-4000-8000-000000000b24', v_farm, v_north, 'rainfall', '2026-10-04', 0.4, v_owner);
  begin
    update public.field_log_entries set id = '00000000-0000-4000-8000-000000000b20' where id = '00000000-0000-4000-8000-000000000b24';
    raise exception 'an entry took a deleted entry''s id';
  exception when raise_exception then
    if sqlerrm <> 'field log entry id cannot change' then raise; end if;
  end;
  begin
    update public.field_log_entries set id = '00000000-0000-4000-8000-000000000b26' where id = '00000000-0000-4000-8000-000000000b24';
    raise exception 'an entry''s id changed';
  exception when raise_exception then
    if sqlerrm <> 'field log entry id cannot change' then raise; end if;
  end;
  update public.field_log_entries set rainfall_in = 0.45 where id = '00000000-0000-4000-8000-000000000b24';
  if (select rainfall_in from public.field_log_entries where id = '00000000-0000-4000-8000-000000000b24') <> 0.45 then raise exception 'an ordinary update of an entry was refused'; end if;
  -- A direct delete (the delete policy allows it) is remembered like the function's.
  delete from public.field_log_entries where id = '00000000-0000-4000-8000-000000000b21';
  begin
    insert into public.field_log_entries(id, farm_id, field_id, entry_type, observed_on, rainfall_in, created_by)
    values ('00000000-0000-4000-8000-000000000b21', v_farm, v_north, 'rainfall', '2026-10-02', 0.25, v_owner);
    raise exception 'an entry deleted straight from the table came back';
  exception when raise_exception then
    if sqlerrm <> 'field log entry was deleted and cannot be saved again' then raise; end if;
  end;
end $$;
reset role;

-- ------------------------------------------------- 3. what was written, read as the owner of the schema
do $$
begin
  if (select count(*) from public.field_log_deleted_entries where farm_id = '00000000-0000-4000-8000-000000000b10') <> 2 then
    raise exception 'remembered ids for the farm: %, expected the two deleted entries', (select count(*) from public.field_log_deleted_entries where farm_id = '00000000-0000-4000-8000-000000000b10');
  end if;
end $$;

-- ------------------------------------------------- 4. a field's entries, and the farm itself
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select set_config('request.headers','',false);
insert into public.field_log_entries(id, farm_id, field_id, entry_type, observed_on, rainfall_in, created_by)
values ('00000000-0000-4000-8000-000000000b22', :F, :FS, 'rainfall', '2026-10-03', 1.1, :O);
delete from public.fields where id = :FS;
do $$
begin
  if not exists (select 1 from public.field_log_deleted_entries where entry_id = '00000000-0000-4000-8000-000000000b22') then
    raise exception 'an entry removed with its field was not remembered';
  end if;
end $$;
-- The farm still has entries when it goes, so the delete runs through the remember trigger.
insert into public.field_log_entries(id, farm_id, field_id, entry_type, observed_on, rainfall_in, created_by)
values ('00000000-0000-4000-8000-000000000b25', :F, :FN, 'rainfall', '2026-10-05', 0.2, :O);
do $$
begin
  if (select count(*) from public.field_log_entries where farm_id = '00000000-0000-4000-8000-000000000b10') < 2 then
    raise exception 'the farm-deletion check needs entries on the farm';
  end if;
end $$;
delete from public.farms where id = :F;
do $$
begin
  if exists (select 1 from public.field_log_entries where farm_id = '00000000-0000-4000-8000-000000000b10') then raise exception 'deleting the farm left its entries'; end if;
  if exists (select 1 from public.farms where id = '00000000-0000-4000-8000-000000000b10') then raise exception 'the farm was not deleted'; end if;
  if exists (select 1 from public.field_log_deleted_entries where farm_id = '00000000-0000-4000-8000-000000000b10') then
    raise exception 'deleting the farm left its remembered ids';
  end if;
end $$;

-- ------------------------------------------------- 5. the catalog
do $$
declare v_function text;
begin
  if not (select relrowsecurity from pg_catalog.pg_class where oid = 'public.field_log_deleted_entries'::regclass) then
    raise exception 'field_log_deleted_entries does not have row level security';
  end if;
  -- The table's own access list, read directly: it must be explicit (the migration's revoke makes
  -- it so, and on Supabase it is what removes the default grants) and name no client role.
  if (select relacl from pg_catalog.pg_class where oid = 'public.field_log_deleted_entries'::regclass) is null then
    raise exception 'field_log_deleted_entries still has the default access list: the revoke did not run';
  end if;
  if exists (
    select 1 from pg_catalog.pg_class c, aclexplode(c.relacl) a
    where c.oid = 'public.field_log_deleted_entries'::regclass
      and (a.grantee = 0 or a.grantee in (select oid from pg_catalog.pg_roles where rolname in ('anon', 'authenticated')))
  ) then
    raise exception 'a client role holds a privilege on field_log_deleted_entries';
  end if;
  if exists (select 1 from pg_catalog.pg_policy where polrelid = 'public.field_log_deleted_entries'::regclass) then
    raise exception 'field_log_deleted_entries has a policy, so a client role could reach it';
  end if;
  foreach v_function in array array['public.remember_deleted_field_log_entry()', 'public.refuse_deleted_field_log_entry()'] loop
    -- coalesce: a function without a SET clause has a null proconfig, which would read as unknown, not false.
    if not coalesce((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_catalog.pg_proc where oid = v_function::regprocedure), false) then
      raise exception '% is not security definer with a fixed search_path', v_function;
    end if;
    if has_function_privilege('anon', v_function, 'execute') or has_function_privilege('authenticated', v_function, 'execute') then
      raise exception '% is executable by a client role', v_function;
    end if;
  end loop;
  -- The replaced save function keeps its security posture and its grants.
  if not coalesce((select prosecdef and proconfig @> array['search_path=public, pg_temp'] from pg_catalog.pg_proc where oid = 'public.save_field_log_entry(uuid,uuid,jsonb)'::regprocedure), false) then
    raise exception 'save_field_log_entry lost security definer or its fixed search_path';
  end if;
  if has_function_privilege('anon', 'public.save_field_log_entry(uuid,uuid,jsonb)', 'execute') or not has_function_privilege('authenticated', 'public.save_field_log_entry(uuid,uuid,jsonb)', 'execute') then
    raise exception 'save_field_log_entry grants changed';
  end if;
  if (select count(*) from pg_catalog.pg_trigger where tgrelid = 'public.field_log_entries'::regclass and tgname in ('field_log_entries_remember_delete', 'field_log_entries_refuse_deleted') and tgenabled = 'O' and not tgisinternal) <> 2 then
    raise exception 'the two field log delete triggers are not both installed and enabled';
  end if;
end $$;

select set_config('request.headers','',false);
select set_config('request.jwt.claims','',false);
select 'FIELD_LOG_DELETED_ENTRIES_DISPOSABLE_PASS' as result;
