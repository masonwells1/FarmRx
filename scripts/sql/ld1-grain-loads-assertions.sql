-- Disposable-backend assertions for Initiative LD-1 (the load record).
-- Runs after every migration on a fresh database, in the same database and after the FS, FD,
-- GL-1, GL-2 and GL-3b assertion files, so every id here is distinct from theirs.
-- Every failure raises; the last line prints LD1_GRAIN_LOADS_DISPOSABLE_PASS.
--
-- What is proved: a load can be written only through save_grain_load, and only by a member who
-- can both edit the farm and read its private financials; the service role cannot drive either
-- RPC; the commodity and crop year are taken from the origin and a client that disagrees is
-- refused rather than overridden; a contract destination must match the load's crop and crop
-- year, so carry-over grain can never be charged against a current-year contract; a lost
-- response replays instead of writing a second ticket, and a reused id carrying different
-- content is refused by name; a saved ticket cannot be edited, only voided with a reason; a
-- repeated void replays and a conflicting one is refused; and grain_loads carries the
-- farm access-epoch guard like every other farm-scoped table.

\set ON_ERROR_STOP on
\set LO  '''00000000-0000-4000-8000-0000000000a0'''
\set LW  '''00000000-0000-4000-8000-0000000000a1'''
\set LX  '''00000000-0000-4000-8000-0000000000a2'''
\set LF  '''00000000-0000-4000-8000-0000000000b0'''
\set LF2 '''00000000-0000-4000-8000-0000000000b1'''
\set LE  '''00000000-0000-4000-8000-0000000000c0'''
\set LFD '''00000000-0000-4000-8000-0000000000c1'''
\set LCA '''00000000-0000-4000-8000-0000000000c2'''
\set LCB '''00000000-0000-4000-8000-0000000000c3'''
\set LBIN '''00000000-0000-4000-8000-0000000000c4'''
\set LBIN2 '''00000000-0000-4000-8000-0000000000c5'''
\set LINV '''00000000-0000-4000-8000-0000000000c6'''
\set LTRK '''00000000-0000-4000-8000-0000000000c7'''
\set LK1 '''00000000-0000-4000-8000-0000000000d0'''
\set LK2 '''00000000-0000-4000-8000-0000000000d1'''
\set LK3 '''00000000-0000-4000-8000-0000000000d2'''
\set LK4 '''00000000-0000-4000-8000-0000000000d3'''
\set LK5 '''00000000-0000-4000-8000-0000000000d4'''

-- ------------------------------------------------- fixtures
insert into auth.users(id,email)
values (:LO,'ld1-owner@example.test'),(:LW,'ld1-worker@example.test'),(:LX,'ld1-outsider@example.test');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000000a0"}',false);
insert into public.farms(id,name,created_by,time_zone) values (:LF,'Load Farm',:LO,'America/Chicago');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000000a2"}',false);
insert into public.farms(id,name,created_by,time_zone) values (:LF2,'Other Load Farm',:LX,'America/Chicago');

select set_config('request.jwt.claims','{"role":"service_role"}',false);
insert into public.entities(id,farm_id,name,entity_type) values (:LE,:LF,'Load Entity','sole_proprietorship');
insert into public.fields(id,farm_id,operating_entity_id,name,total_acres) values (:LFD,:LF,:LE,'Load Field',120);
-- Two crop assignments on one field: the same commodity in two crop years is exactly the case a
-- load must never guess between.
insert into public.crop_assignments(id,farm_id,field_id,crop_year,commodity_id,planting_sequence,planted_acres)
values (:LCA,:LF,:LFD,2026,'corn_yellow',1,120),
       (:LCB,:LF,:LFD,2025,'corn_yellow',2,120);
insert into public.grain_bins(id,farm_id,name,capacity_bu,location_type) values
  (:LBIN,:LF,'Load Bin North',50000,'on_farm'),
  (:LBIN2,:LF,'Load Bin South',50000,'on_farm');
insert into public.bin_inventory(id,farm_id,grain_bin_id,crop_year,commodity_id,bushels,measured_at)
values (:LINV,:LF,:LBIN,2025,'corn_yellow',20000,'2026-01-01T00:00:00Z');
insert into public.equipment(id,farm_id,name,category,created_by) values (:LTRK,:LF,'Red Semi','truck',:LO);
insert into public.grain_contracts(id,farm_id,crop_year,commodity_id,contract_type,buyer,bushels,cash_price)
values (:LK1,:LF,2026,'corn_yellow','forward_cash','Load Buyer',10000,4.60),
       (:LK2,:LF,2025,'corn_yellow','forward_cash','Carryover Buyer',6000,4.20),
       (:LK3,:LF,2026,'soybeans','forward_cash','Bean Buyer',4000,11.20);

-- ------------------------------------------------- 1. neither RPC answers to the service role
-- Exercised under the role as well as the claim, the way an edge function reaches the database.
set role service_role;
do $$
declare v_failed boolean;
begin
  v_failed := false;
  begin perform public.save_grain_load('00000000-0000-4000-8000-0000000000b0', jsonb_build_object(
    'id', gen_random_uuid(), 'load_date','2026-10-01','origin_kind','field',
    'origin_crop_assignment_id','00000000-0000-4000-8000-0000000000c2',
    'destination_kind','buyer','destination_buyer','Service Role Elevator','net_bushels',900));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'the service role recorded a load'; end if;

  v_failed := false;
  begin perform public.void_grain_load('00000000-0000-4000-8000-0000000000b0', gen_random_uuid(), 'service role attempt');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'the service role voided a load'; end if;
end $$;
reset role;

-- ------------------------------------------------- 2. the direct path is closed
-- The table grants SELECT and nothing else, so a browser holding a farm id cannot write a load
-- that skipped save_grain_load's checks.
do $$
declare v_insert boolean; v_update boolean; v_delete boolean;
begin
  v_insert := has_table_privilege('authenticated','public.grain_loads','insert');
  v_update := has_table_privilege('authenticated','public.grain_loads','update');
  v_delete := has_table_privilege('authenticated','public.grain_loads','delete');
  if v_insert or v_update or v_delete then
    raise exception 'authenticated still holds write privileges on grain_loads (insert %, update %, delete %)',
      v_insert, v_update, v_delete;
  end if;
  if not has_table_privilege('authenticated','public.grain_loads','select') then
    raise exception 'authenticated cannot read grain_loads'; end if;
end $$;

-- ------------------------------------------------- 3. the field origin decides crop and crop year
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000000a0"}',false);
-- The access-epoch fence applies to a load exactly as it does to any other browser write, so
-- every call below presents the header pair a real request carries. A new farm's owner is at
-- epoch 1.
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-0000000000a0','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-0000000000b0',1)::text)::text,false);
do $$
declare v_row jsonb; v_failed boolean;
begin
  v_row := public.save_grain_load('00000000-0000-4000-8000-0000000000b0', jsonb_build_object(
    'id','00000000-0000-4000-8000-0000000000d4'::uuid,
    'load_date','2026-10-01','origin_kind','field',
    'origin_crop_assignment_id','00000000-0000-4000-8000-0000000000c2',
    'destination_kind','buyer','destination_buyer','Riverside Elevator',
    'net_bushels', 910.5, 'gross_lbs', 80000, 'tare_lbs', 29000,
    'moisture_pct', 15.5, 'ticket_number','A-1001',
    'truck_equipment_id','00000000-0000-4000-8000-0000000000c7'));
  if v_row->>'commodity_id' <> 'corn_yellow' then
    raise exception 'the load took commodity % instead of the field crop', v_row->>'commodity_id'; end if;
  if (v_row->>'crop_year')::int <> 2026 then
    raise exception 'the load took crop year % instead of the field crop year', v_row->>'crop_year'; end if;
  if (v_row->>'net_bushels')::numeric <> 910.5 then
    raise exception 'net bushels were stored as %', v_row->>'net_bushels'; end if;

  -- A browser that computed a different crop year is a disagreement, not a preference.
  v_failed := false;
  begin perform public.save_grain_load('00000000-0000-4000-8000-0000000000b0', jsonb_build_object(
    'id', gen_random_uuid(), 'load_date','2026-10-02','origin_kind','field',
    'origin_crop_assignment_id','00000000-0000-4000-8000-0000000000c2',
    'crop_year', 2025,
    'destination_kind','buyer','destination_buyer','Riverside Elevator','net_bushels',500));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a load kept a crop year the field crop contradicts'; end if;
end $$;

-- ------------------------------------------------- 4. the bin origin takes the bin's lot
do $$
declare v_row jsonb; v_failed boolean;
begin
  v_row := public.save_grain_load('00000000-0000-4000-8000-0000000000b0', jsonb_build_object(
    'id', gen_random_uuid(), 'load_date','2026-10-03','origin_kind','bin',
    'origin_grain_bin_id','00000000-0000-4000-8000-0000000000c4',
    'destination_kind','buyer','destination_buyer','Riverside Elevator','net_bushels',800));
  -- The bin holds the 2025 crop; nothing in the call said so.
  if (v_row->>'crop_year')::int <> 2025 then
    raise exception 'a load out of the bin took crop year % instead of the bin lot', v_row->>'crop_year'; end if;

  v_failed := false;
  begin perform public.save_grain_load('00000000-0000-4000-8000-0000000000b0', jsonb_build_object(
    'id', gen_random_uuid(), 'load_date','2026-10-03','origin_kind','bin',
    'origin_grain_bin_id','00000000-0000-4000-8000-0000000000c4',
    'crop_year', 2026,
    'destination_kind','buyer','destination_buyer','Riverside Elevator','net_bushels',800));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a load claimed a crop year the bin does not hold'; end if;
end $$;

-- ------------------------------------------------- 5. a contract destination must match the grain
-- This is the whole point of carrying a crop year on the ticket: 2025 grain must not be able to
-- pay down a 2026 contract, and corn must not pay down a bean contract.
do $$
declare v_failed boolean;
begin
  v_failed := false;
  begin perform public.save_grain_load('00000000-0000-4000-8000-0000000000b0', jsonb_build_object(
    'id', gen_random_uuid(), 'load_date','2026-10-04','origin_kind','bin',
    'origin_grain_bin_id','00000000-0000-4000-8000-0000000000c4',
    'destination_kind','contract',
    'destination_grain_contract_id','00000000-0000-4000-8000-0000000000d0',
    'net_bushels',700));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'carry-over grain was charged against a current-year contract'; end if;

  v_failed := false;
  begin perform public.save_grain_load('00000000-0000-4000-8000-0000000000b0', jsonb_build_object(
    'id', gen_random_uuid(), 'load_date','2026-10-04','origin_kind','field',
    'origin_crop_assignment_id','00000000-0000-4000-8000-0000000000c2',
    'destination_kind','contract',
    'destination_grain_contract_id','00000000-0000-4000-8000-0000000000d2',
    'net_bushels',700));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a corn load was charged against a soybean contract'; end if;

  -- The matching case saves.
  perform public.save_grain_load('00000000-0000-4000-8000-0000000000b0', jsonb_build_object(
    'id','00000000-0000-4000-8000-0000000000d3'::uuid,
    'load_date','2026-10-05','origin_kind','bin',
    'origin_grain_bin_id','00000000-0000-4000-8000-0000000000c4',
    'destination_kind','contract',
    'destination_grain_contract_id','00000000-0000-4000-8000-0000000000d1',
    'net_bushels',650));
end $$;

-- ------------------------------------------------- 6. a load cannot reach another farm's bin
-- Run as the OTHER farm's owner, so the call clears the permission fence and the only thing left
-- to stop it is the farm check on the bin itself.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000000a2"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-0000000000a2','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-0000000000b1',1)::text)::text,false);
do $$
declare v_failed boolean; v_message text;
begin
  v_failed := false;
  begin perform public.save_grain_load('00000000-0000-4000-8000-0000000000b1', jsonb_build_object(
    'id', gen_random_uuid(), 'load_date','2026-10-06','origin_kind','bin',
    'origin_grain_bin_id','00000000-0000-4000-8000-0000000000c4',
    'destination_kind','buyer','destination_buyer','Cross Farm Elevator','net_bushels',100));
  exception when others then v_failed := true; v_message := sqlerrm; end;
  if not v_failed then raise exception 'a load reached a bin belonging to another farm'; end if;
  if v_message not like '%does not belong to this farm%' then
    raise exception 'the cross-farm bin was stopped by %, not the farm check', v_message; end if;
end $$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000000a0"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-0000000000a0','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-0000000000b0',1)::text)::text,false);

-- ------------------------------------------------- 7. shape rules the farmer can actually hit
do $$
declare v_failed boolean;
begin
  v_failed := false;
  begin perform public.save_grain_load('00000000-0000-4000-8000-0000000000b0', jsonb_build_object(
    'id', gen_random_uuid(), 'load_date','2026-10-07','origin_kind','bin',
    'origin_grain_bin_id','00000000-0000-4000-8000-0000000000c4',
    'destination_kind','bin','destination_grain_bin_id','00000000-0000-4000-8000-0000000000c4',
    'net_bushels',100));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a load was hauled from a bin into the same bin'; end if;

  v_failed := false;
  begin perform public.save_grain_load('00000000-0000-4000-8000-0000000000b0', jsonb_build_object(
    'id', gen_random_uuid(), 'load_date','2026-10-07','origin_kind','field',
    'origin_crop_assignment_id','00000000-0000-4000-8000-0000000000c2',
    'destination_kind','buyer','destination_buyer','Riverside Elevator','net_bushels',0));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a load with no bushels saved'; end if;

  v_failed := false;
  begin perform public.save_grain_load('00000000-0000-4000-8000-0000000000b0', jsonb_build_object(
    'id', gen_random_uuid(), 'load_date','2026-10-07','origin_kind','field',
    'origin_crop_assignment_id','00000000-0000-4000-8000-0000000000c2',
    'destination_kind','buyer','destination_buyer','Riverside Elevator','net_bushels',100,
    'gross_lbs', 20000, 'tare_lbs', 30000));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a load weighed less loaded than empty'; end if;

  v_failed := false;
  begin perform public.save_grain_load('00000000-0000-4000-8000-0000000000b0', jsonb_build_object(
    'id', gen_random_uuid(), 'load_date','2026-10-07','origin_kind','field',
    'origin_crop_assignment_id','00000000-0000-4000-8000-0000000000c2',
    'destination_kind','buyer','destination_buyer','Riverside Elevator','net_bushels',100,
    'truck_equipment_id','00000000-0000-4000-8000-0000000000c7','truck_name','Hired Truck'));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a load named a truck two ways at once'; end if;
end $$;

-- ------------------------------------------------- 8. a lost response does not write a second ticket
-- The browser keeps one id for one ticket. A retry with the same content replays the saved row;
-- the same id carrying different content is refused by name rather than overwriting the first.
do $$
declare v_first jsonb; v_again jsonb; v_count integer; v_failed boolean; v_message text;
begin
  v_first := public.save_grain_load('00000000-0000-4000-8000-0000000000b0', jsonb_build_object(
    'id','00000000-0000-4000-8000-0000000000d0'::uuid,
    'load_date','2026-10-08','origin_kind','field',
    'origin_crop_assignment_id','00000000-0000-4000-8000-0000000000c2',
    'destination_kind','buyer','destination_buyer','Retry Elevator','net_bushels',1000));
  v_again := public.save_grain_load('00000000-0000-4000-8000-0000000000b0', jsonb_build_object(
    'id','00000000-0000-4000-8000-0000000000d0'::uuid,
    'load_date','2026-10-08','origin_kind','field',
    'origin_crop_assignment_id','00000000-0000-4000-8000-0000000000c2',
    'destination_kind','buyer','destination_buyer','Retry Elevator','net_bushels',1000));
  if v_first->>'id' is distinct from v_again->>'id'
     or v_first->>'created_at' is distinct from v_again->>'created_at' then
    raise exception 'a retry returned a different ticket'; end if;
  select count(*) into v_count from public.grain_loads where id = '00000000-0000-4000-8000-0000000000d0';
  if v_count <> 1 then raise exception 'a retry left % rows for one ticket', v_count; end if;

  v_failed := false;
  begin perform public.save_grain_load('00000000-0000-4000-8000-0000000000b0', jsonb_build_object(
    'id','00000000-0000-4000-8000-0000000000d0'::uuid,
    'load_date','2026-10-08','origin_kind','field',
    'origin_crop_assignment_id','00000000-0000-4000-8000-0000000000c2',
    'destination_kind','buyer','destination_buyer','Retry Elevator','net_bushels',1200));
  exception when others then v_failed := true; v_message := sqlerrm; end;
  if not v_failed then raise exception 'one ticket id was spent on two different loads'; end if;
  if v_message is distinct from 'FARM_RX_LOAD_ID_REUSED' then
    raise exception 'a reused ticket id reported %, which the browser cannot translate', v_message; end if;
end $$;

-- ------------------------------------------------- 9. a saved ticket is evidence, not a draft
-- Proved from the table owner's connection, not just from `authenticated`, so the rule holds even
-- where the grants do not reach.
do $$
declare v_failed boolean;
begin
  v_failed := false;
  begin update public.grain_loads set net_bushels = 5 where id = '00000000-0000-4000-8000-0000000000d0';
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a saved load was edited in place'; end if;

  v_failed := false;
  begin update public.grain_loads set destination_buyer = 'Somebody Else' where id = '00000000-0000-4000-8000-0000000000d0';
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a saved load changed buyers without a void'; end if;
end $$;

-- ------------------------------------------------- 10. void records the reason, and replays
do $$
declare v_result jsonb; v_repeat jsonb; v_failed boolean; v_message text; v_row public.grain_loads%rowtype;
begin
  v_result := public.void_grain_load(
    '00000000-0000-4000-8000-0000000000b0','00000000-0000-4000-8000-0000000000d0','Weighed on a broken scale');
  if v_result->>'status' <> 'voided' then
    raise exception 'void reported status %', v_result->>'status'; end if;
  if jsonb_array_length(v_result->'blocked_by') <> 0 then
    raise exception 'an LD-1 load reported something blocking its void'; end if;

  select * into v_row from public.grain_loads where id = '00000000-0000-4000-8000-0000000000d0';
  if v_row.voided_at is null then raise exception 'the load was not marked voided'; end if;
  if v_row.void_reason <> 'Weighed on a broken scale' then
    raise exception 'the void reason was stored as %', v_row.void_reason; end if;
  -- The ticket itself survives the void; that is the whole point of append-only.
  if v_row.net_bushels <> 1000 then raise exception 'voiding changed the ticket'; end if;

  -- A repeat after a lost response is the same void, not a second one.
  v_repeat := public.void_grain_load(
    '00000000-0000-4000-8000-0000000000b0','00000000-0000-4000-8000-0000000000d0','Weighed on a broken scale');
  if v_repeat->>'status' <> 'voided' then raise exception 'a repeated void did not replay'; end if;

  -- A different reason on an already-voided ticket would quietly rewrite the record.
  v_failed := false;
  begin perform public.void_grain_load(
    '00000000-0000-4000-8000-0000000000b0','00000000-0000-4000-8000-0000000000d0','Actually a different reason');
  exception when others then v_failed := true; v_message := sqlerrm; end;
  if not v_failed then raise exception 'a second reason overwrote the first void reason'; end if;
  if v_message is distinct from 'FARM_RX_LOAD_ALREADY_VOIDED' then
    raise exception 'a conflicting void reported %, which the browser cannot translate', v_message; end if;

  -- A reason is not optional.
  v_failed := false;
  begin perform public.void_grain_load(
    '00000000-0000-4000-8000-0000000000b0','00000000-0000-4000-8000-0000000000d3','  ');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a load was voided with no reason'; end if;
end $$;

-- ------------------------------------------------- 11. a worker without financial access is refused
-- can_edit_farm admits a worker, but a scale ticket carries bushels and the buyer that bought
-- them. These are security definer functions, so one fence alone would let a worker reach past
-- row-level security into private money.
insert into public.farm_memberships(farm_id,user_id,role,status,can_view_financials)
values ('00000000-0000-4000-8000-0000000000b0','00000000-0000-4000-8000-0000000000a1','worker','active',false);

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000000a1"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-0000000000a1','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-0000000000b0',1)::text)::text,false);
do $$
declare v_failed boolean;
begin
  if not public.can_edit_farm('00000000-0000-4000-8000-0000000000b0') then
    raise exception 'the fixture worker cannot edit the farm, so this case proves nothing'; end if;
  if public.can_read_private_financials('00000000-0000-4000-8000-0000000000b0') then
    raise exception 'the fixture worker can read financials, so this case proves nothing'; end if;

  v_failed := false;
  begin perform public.save_grain_load('00000000-0000-4000-8000-0000000000b0', jsonb_build_object(
    'id', gen_random_uuid(), 'load_date','2026-10-09','origin_kind','field',
    'origin_crop_assignment_id','00000000-0000-4000-8000-0000000000c2',
    'destination_kind','buyer','destination_buyer','Worker Elevator','net_bushels',400));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a worker without financial access recorded a load'; end if;

  v_failed := false;
  begin perform public.void_grain_load(
    '00000000-0000-4000-8000-0000000000b0','00000000-0000-4000-8000-0000000000d3','worker attempt');
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a worker without financial access voided a load'; end if;
end $$;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000000a0"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-0000000000a0','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-0000000000b0',1)::text)::text,false);

-- ------------------------------------------------- 12. the epoch guard reaches grain_loads
-- Migration 0040 requires every farm-scoped table to carry the guard. A new table that misses it
-- is invisible until someone's access is revoked, which is the worst possible time to find out.
do $$
declare v_count integer;
begin
  select count(*) into v_count
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_class c on c.oid = t.tgrelid
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_proc p on p.oid = t.tgfoid
  where n.nspname = 'public' and c.relname = 'grain_loads'
    and p.proname = 'guard_row_farm_access_epoch' and not t.tgisinternal;
  if v_count <> 1 then raise exception 'grain_loads carries % access-epoch guard triggers, expected 1', v_count; end if;
end $$;

-- ------------------------------------------------- 13. the 0043 definer allowlist carries both RPCs
-- The allowlist lane is PowerShell and cannot run on a development machine, so the two things most
-- likely to be wrong are checked here: the exact identity-argument text the allowlist must carry,
-- and the total the count must be raised to. This already caught the count once in this tranche.
do $$
declare v_args text; v_total integer;
begin
  select pg_catalog.pg_get_function_identity_arguments(p.oid) into v_args
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'save_grain_load';
  if v_args is distinct from 'p_farm_id uuid, p_load jsonb' then
    raise exception 'save_grain_load identity arguments are %, which is not what the 0043 allowlist carries', v_args; end if;

  select pg_catalog.pg_get_function_identity_arguments(p.oid) into v_args
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'void_grain_load';
  if v_args is distinct from 'p_farm_id uuid, p_load_id uuid, p_reason text' then
    raise exception 'void_grain_load identity arguments are %, which is not what the 0043 allowlist carries', v_args; end if;

  select count(*) into v_total
  from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'execute');
  if v_total <> 60 then
    raise exception 'authenticated can execute % security definer functions; the 0043 lane expects 60', v_total; end if;
end $$;

-- ------------------------------------------------- 14. every public foreign key has a covering index
-- The third thing the PowerShell-only 0043 lane checks that nothing runnable here did, and the one
-- that broke this tranche: grain_loads shipped seven foreign keys and four indexes written farm-first,
-- so six keys had no covering index and 0043 failed after the branch was already pushed. The rule
-- below is 0043's own, copied whole -- global scope, same two allowlisted partial indexes -- so any
-- new table that forgets an index now fails on a development machine instead of in CI. Keep the two
-- copies identical; if 0043 ever grows a third exception, this list grows with it.
do $$
declare v_missing integer;
begin
  with foreign_keys as (
    select c.conrelid, c.conkey, c.conname
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f' and n.nspname = 'public'
  ), valid_indexes as (
    select
      i.indrelid,
      i.indkey::smallint[] as keys,
      pg_catalog.pg_get_expr(i.indpred, i.indrelid) as predicate
    from pg_catalog.pg_index i
    where i.indisvalid and i.indisready
  )
  select count(*) into v_missing
  from foreign_keys fk
  where not exists (
    select 1 from valid_indexes i
    where i.indrelid = fk.conrelid
      and i.keys[0:cardinality(fk.conkey) - 1] = fk.conkey
      and (
        i.predicate is null
        or (
          fk.conname = 'firm_offers_filled_contract_same_farm_fk'
          and i.predicate = '(filled_contract_id IS NOT NULL)'
        )
        or (
          fk.conname = 'push_delivery_targets_subscription_id_fkey'
          and i.predicate = '(subscription_id IS NOT NULL)'
        )
      )
  );
  if v_missing <> 0 then
    raise exception '% public foreign keys remain without a covering index (the 0043 advisor rule)', v_missing; end if;
end $$;

select 'LD1_GRAIN_LOADS_DISPOSABLE_PASS' as result;
