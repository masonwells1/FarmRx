-- Disposable-backend assertions for Initiative FD-1 (Today). Runs after every
-- migration has been applied to a fresh database with the standard synthetic
-- bootstrap (auth schema, roles, auth.uid()), in the same database and after
-- fs-persist-disposable-assertions.sql, so every id here is distinct from that
-- file's fixtures. Every failure raises; the last line prints
-- FD_TODAY_DISPOSABLE_PASS.
--
-- What is proved: Today shows a member only rows the database already lets
-- them read. A worker without financial access receives the service-due view,
-- the farm's tasks and their own alerts, and zero rows from every private
-- grain table Today or the Grain module could read; the owner receives all of
-- them, including the contracts, marketing plan targets and cash bids the FD-2
-- grain line reads. Today adds no table, policy, or function, so this file
-- asserts the existing row-level rules Today depends on rather than new schema.

\set ON_ERROR_STOP on
\set O '''00000000-0000-4000-8000-000000000004'''
\set W '''00000000-0000-4000-8000-000000000005'''
\set FT '''00000000-0000-4000-8000-000000000040'''
\set ET '''00000000-0000-4000-8000-000000000041'''
\set PET '''00000000-0000-4000-8000-000000000042'''
\set EQ '''00000000-0000-4000-8000-000000000043'''
\set IV '''00000000-0000-4000-8000-000000000044'''
\set TK '''00000000-0000-4000-8000-000000000045'''

-- ---------------------------------------------------------------- fixtures
insert into auth.users(id,email) values
 (:O,'today-owner@example.test'),
 (:W,'today-worker@example.test');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000004"}',false);
insert into public.farms(id,name,created_by) values (:FT,'Today Farm',:O);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000004','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000040',1)::text)::text,false);
insert into public.entities(id,farm_id,name,entity_type) values (:ET,:FT,'Today Entity','individual');
insert into public.production_estimates(id,farm_id,crop_year,commodity_id,aph_yield,expected_bushels) values (:PET,:FT,2026,'corn_yellow',200,100000);
-- The FD-2 grain line's other sources: a signed contract, one plan month, one farmer-entered cash bid.
insert into public.grain_contracts(farm_id,crop_year,commodity_id,contract_type,buyer,bushels,cash_price) values (:FT,2026,'corn_yellow','forward_cash','Cargill Olney',35000,4.20);
insert into public.marketing_plan_targets(farm_id,crop_year,commodity_id,target_month,target_pct_of_production) values (:FT,2026,'corn_yellow',date_trunc('month',current_date)::date,40);
insert into public.cash_bids(farm_id,elevator,commodity_id,bid_date,basis,cash_price) values (:FT,'Cargill Olney','corn_yellow',current_date,-0.30,4.12);
insert into public.farm_memberships(farm_id,user_id,role,status,can_view_financials) values (:FT,:W,'worker','active',false);
insert into public.equipment(id,farm_id,name,category,meter_unit,created_by) values (:EQ,:FT,'John Deere 8R 340','tractor','hours',:O);
insert into public.equipment_service_intervals(id,farm_id,equipment_id,name,every_meter,last_done_reading,created_by) values (:IV,:FT,:EQ,'Engine oil',250,0,:O);
insert into public.equipment_meter_readings(farm_id,equipment_id,reading,read_on,created_by) values (:FT,:EQ,262,current_date,:O);
insert into public.farm_tasks(id,farm_id,title,due_on,created_by) values (:TK,:FT,'Fix the planter',current_date - 2,:O);
-- Alerts are written by database functions in production; here they are seeded directly so the read rules can be asserted.
insert into public.notifications(farm_id,user_id,category,title,link,created_by) values
 (:FT,:W,'task','Corn pass 2 is due','/programs?pass=00000000-0000-4000-8000-000000000046',:O),
 (:FT,:O,'general','Corn hit your $4.60 target','/grain',:O),
 (:FT,:O,'task','Owner pass due','/programs?pass=00000000-0000-4000-8000-000000000046',:O);

-- ------------------------------------------ worker without financial access
set role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000005"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000005','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000040',1)::text)::text,false);
do $$
declare v_count integer; v_amount numeric;
begin
  if public.can_read_private_financials('00000000-0000-4000-8000-000000000040') then raise exception 'worker without financials reads private financials'; end if;
  if not public.can_edit_farm('00000000-0000-4000-8000-000000000040') then raise exception 'worker cannot edit the farm'; end if;
  -- Next up sources the worker may see.
  select count(*), min(overdue_amount) into v_count, v_amount from public.equipment_service_due where farm_id = '00000000-0000-4000-8000-000000000040';
  if v_count <> 1 or v_amount <> 12 then raise exception 'worker service-due rows: % (overdue %), expected 1 (12)', v_count, v_amount; end if;
  select count(*) into v_count from public.farm_tasks where farm_id = '00000000-0000-4000-8000-000000000040' and status <> 'done' and due_on <= current_date;
  if v_count <> 1 then raise exception 'worker due-task rows: %, expected 1', v_count; end if;
  select count(*) into v_count from public.notifications where farm_id = '00000000-0000-4000-8000-000000000040';
  if v_count <> 1 then raise exception 'worker alert rows: %, expected only their own 1', v_count; end if;
  if exists (select 1 from public.notifications where user_id <> auth.uid()) then raise exception 'worker can read another member''s alert'; end if;
  if exists (select 1 from public.notifications where link like '/grain%') then raise exception 'worker without financials received a grain alert row'; end if;
  -- Every private grain table Today or the Grain module reads returns nothing.
  if (select count(*) from public.production_estimates where farm_id = '00000000-0000-4000-8000-000000000040') <> 0 then raise exception 'worker without financials can read production estimates'; end if;
  if (select count(*) from public.grain_contracts) <> 0 then raise exception 'worker without financials can read grain contracts'; end if;
  if (select count(*) from public.grain_contract_deliveries) <> 0 then raise exception 'worker without financials can read grain deliveries'; end if;
  if (select count(*) from public.marketing_plan_targets) <> 0 then raise exception 'worker without financials can read marketing targets'; end if;
  if (select count(*) from public.grain_bins) <> 0 then raise exception 'worker without financials can read grain bins'; end if;
  if (select count(*) from public.grain_sale_limits) <> 0 then raise exception 'worker without financials can read sale limits'; end if;
  if (select count(*) from public.cash_bids) <> 0 then raise exception 'worker without financials can read cash bids'; end if;
end $$;

-- --------------------------------------------------------------------- owner
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000004"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000004','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000040',1)::text)::text,false);
do $$
declare v_count integer;
begin
  if not public.can_read_private_financials('00000000-0000-4000-8000-000000000040') then raise exception 'owner cannot read private financials'; end if;
  select count(*) into v_count from public.equipment_service_due where farm_id = '00000000-0000-4000-8000-000000000040';
  if v_count <> 1 then raise exception 'owner service-due rows: %, expected 1', v_count; end if;
  select count(*) into v_count from public.farm_tasks where farm_id = '00000000-0000-4000-8000-000000000040' and status <> 'done' and due_on <= current_date;
  if v_count <> 1 then raise exception 'owner due-task rows: %, expected 1', v_count; end if;
  select count(*) into v_count from public.notifications where farm_id = '00000000-0000-4000-8000-000000000040';
  if v_count <> 2 then raise exception 'owner alert rows: %, expected only their own 2', v_count; end if;
  if not exists (select 1 from public.notifications where link = '/grain') then raise exception 'owner did not receive the grain alert row'; end if;
  if (select count(*) from public.production_estimates where farm_id = '00000000-0000-4000-8000-000000000040') <> 1 then raise exception 'owner cannot read production estimates'; end if;
  -- The grain line's sources (FD-2).
  if (select count(*) from public.grain_contracts where farm_id = '00000000-0000-4000-8000-000000000040') <> 1 then raise exception 'owner cannot read grain contracts'; end if;
  if (select count(*) from public.marketing_plan_targets where farm_id = '00000000-0000-4000-8000-000000000040') <> 1 then raise exception 'owner cannot read marketing plan targets'; end if;
  if (select count(*) from public.cash_bids where farm_id = '00000000-0000-4000-8000-000000000040') <> 1 then raise exception 'owner cannot read cash bids'; end if;
end $$;
reset role;

select 'FD_TODAY_DISPOSABLE_PASS' as result;
