-- Disposable-backend assertions for Initiative GL-1 (USDA MARS basis feed). Runs
-- after every migration on a fresh database with the standard synthetic bootstrap,
-- in the same database and after the FS and FD assertion files, so every id here
-- is distinct from theirs. Every failure raises; the last line prints
-- GL1_MARS_FEED_DISPOSABLE_PASS.
--
-- What is proved: an unverified report writes nothing; a verified report fans a
-- validated observation into every farm whose market_region matches and into no
-- other farm; a retried identical run adds no row and moves no updated_at; a
-- changed value updates in place; a signed-in owner can neither create, edit, nor
-- delete a feed row but can still record a manual bid; an owner can set a valid
-- market region and not an invalid one; a worker cannot set it; a worker without
-- financial access reads no feed row; a signed-in user cannot run the fan-out or
-- write the report mapping.

\set ON_ERROR_STOP on
\set O3 '''00000000-0000-4000-8000-000000000006'''
\set O4 '''00000000-0000-4000-8000-000000000007'''
\set O5 '''00000000-0000-4000-8000-000000000008'''
\set O6 '''00000000-0000-4000-8000-000000000009'''
\set W3 '''00000000-0000-4000-8000-00000000000a'''
\set FA '''00000000-0000-4000-8000-000000000050'''
\set FB '''00000000-0000-4000-8000-000000000051'''
\set FC '''00000000-0000-4000-8000-000000000052'''
\set FD '''00000000-0000-4000-8000-000000000053'''
\set RUN '''00000000-0000-4000-8000-000000000060'''

-- ---------------------------------------------------------------- fixtures
insert into auth.users(id,email) values
 (:O3,'gl1-owner-a@example.test'),
 (:O4,'gl1-owner-b@example.test'),
 (:O5,'gl1-owner-c@example.test'),
 (:O6,'gl1-owner-d@example.test'),
 (:W3,'gl1-worker@example.test');

-- Each owner bootstraps their own farm (the bootstrap trigger creates the owner
-- membership and the access epoch). Regions are set on insert: two Iowa farms,
-- one Illinois farm, one farm with no region.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000006"}',false);
insert into public.farms(id,name,created_by,market_region) values (:FA,'Feed Farm A',:O3,'IA');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000007"}',false);
insert into public.farms(id,name,created_by,market_region) values (:FB,'Feed Farm B',:O4,'IA');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000008"}',false);
insert into public.farms(id,name,created_by,market_region) values (:FC,'Feed Farm C',:O5,'IL');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000009"}',false);
insert into public.farms(id,name,created_by,market_region) values (:FD,'Feed Farm D',:O6,null);
-- A worker without financial access on farm A (seeded by the owner's own request context).
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000006"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000006','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000050',1)::text)::text,false);
insert into public.farm_memberships(farm_id,user_id,role,status,can_view_financials) values (:FA,:W3,'worker','active',false);

-- The seeded report is present and unverified: the migration's own promise.
do $$
begin
  if (select count(*) from public.usda_market_reports where report_id='2850' and geography='IA' and verified_at is null) <> 1 then raise exception 'report 2850 must be seeded unverified for Iowa'; end if;
end $$;

-- ------------------------------------------------- the service-role fan-out
reset role;
select set_config('request.jwt.claims','{"role":"service_role"}',false);
select set_config('request.headers','',false);
insert into public.usda_market_report_runs(id,report_id,market_date,status) values (:RUN,'2850',current_date,'started');

-- 1. Unverified report: refused, nothing written.
do $$
declare v jsonb;
begin
  v := public.ingest_usda_mars_observations('2850','00000000-0000-4000-8000-000000000060',
    '[{"observation_key":"2850|k1","elevator":"Cedar Rapids","commodity_id":"corn_yellow","bid_date":"2026-07-15","basis":-0.35,"cash_price":4.12,"delivery_start":null,"delivery_end":null,"source_note":null}]'::jsonb);
  if v->>'status' <> 'skipped' or v->>'reason' <> 'report_unverified' then raise exception 'unverified report must be refused: %', v; end if;
  if (select count(*) from public.cash_bids where feed_source is not null) <> 0 then raise exception 'unverified report wrote a row'; end if;
  v := public.ingest_usda_mars_observations('9999','00000000-0000-4000-8000-000000000060','[]'::jsonb);
  if v->>'reason' <> 'report_unknown' then raise exception 'unknown report must be refused: %', v; end if;
end $$;

-- Mason's live action, replayed here: the report is confirmed and stamped.
update public.usda_market_reports set verified_at = now(), verification_note = 'disposable proof' where report_id = '2850';

-- 2. Verified report: two observations fan into the two Iowa farms and nowhere else; an unknown commodity is skipped, never guessed.
do $$
declare v jsonb; v_count integer;
begin
  v := public.ingest_usda_mars_observations('2850','00000000-0000-4000-8000-000000000060',
    '[{"observation_key":"2850|k1","elevator":"Cedar Rapids","commodity_id":"corn_yellow","bid_date":"2026-07-15","basis":-0.35,"cash_price":4.12,"delivery_start":null,"delivery_end":null,"source_note":null},
      {"observation_key":"2850|k2","elevator":"Ames","commodity_id":"soybeans","bid_date":"2026-07-15","basis":-0.60,"cash_price":null,"delivery_start":"2026-10-01","delivery_end":"2026-10-31","source_note":"basis range -0.65 to -0.55"},
      {"observation_key":"2850|k3","elevator":"Ames","commodity_id":"oats","bid_date":"2026-07-15","basis":-0.10,"cash_price":null,"delivery_start":null,"delivery_end":null,"source_note":null},
      {"observation_key":"2850|k4","elevator":"Ames","commodity_id":"corn_yellow","bid_date":"not a date","basis":-0.10,"cash_price":null,"delivery_start":null,"delivery_end":null,"source_note":null}]'::jsonb);
  if v->>'status' <> 'ok' then raise exception 'verified report must ingest: %', v; end if;
  if (v->>'farms_eligible')::int <> 2 or (v->>'valid_observations')::int <> 2 or (v->>'written_rows')::int <> 4 or (v->>'unchanged_rows')::int <> 0 or (v->>'skipped_observations')::int <> 2 then raise exception 'fan-out counts are wrong: %', v; end if;
  if not (v->'skips' @> '[{"reason":"unknown_commodity"}]'::jsonb) or not (v->'skips' @> '[{"reason":"malformed"}]'::jsonb) then raise exception 'skip reasons missing: %', v; end if;
  select count(*) into v_count from public.cash_bids where farm_id='00000000-0000-4000-8000-000000000050' and feed_source='usda_mars'; if v_count <> 2 then raise exception 'farm A expected 2 feed rows, saw %', v_count; end if;
  select count(*) into v_count from public.cash_bids where farm_id='00000000-0000-4000-8000-000000000051' and feed_source='usda_mars'; if v_count <> 2 then raise exception 'farm B expected 2 feed rows, saw %', v_count; end if;
  select count(*) into v_count from public.cash_bids where farm_id in ('00000000-0000-4000-8000-000000000052','00000000-0000-4000-8000-000000000053'); if v_count <> 0 then raise exception 'an Illinois farm or a farm without a region received feed rows'; end if;
  if (select count(*) from public.cash_bids where feed_source='usda_mars' and (feed_report_id <> '2850' or feed_geography <> 'IA' or notes not like '[USDA MARS 2850 · Iowa]%')) <> 0 then raise exception 'feed rows must carry their true report id and geography'; end if;
  if (select notes from public.cash_bids where farm_id='00000000-0000-4000-8000-000000000050' and feed_observation_key='2850|k2') <> '[USDA MARS 2850 · Iowa] basis range -0.65 to -0.55' then raise exception 'the source note must follow the provenance marker'; end if;
end $$;

-- 3. A retried identical run adds nothing and moves no updated_at; a changed value updates in place under the same id.
do $$
declare v jsonb; v_before timestamptz; v_after timestamptz; v_id uuid; v_id_after uuid; v_count integer;
begin
  select max(updated_at) into v_before from public.cash_bids where feed_source='usda_mars';
  select id into v_id from public.cash_bids where farm_id='00000000-0000-4000-8000-000000000050' and feed_observation_key='2850|k1';
  perform pg_sleep(0.01);
  v := public.ingest_usda_mars_observations('2850','00000000-0000-4000-8000-000000000060',
    '[{"observation_key":"2850|k1","elevator":"Cedar Rapids","commodity_id":"corn_yellow","bid_date":"2026-07-15","basis":-0.35,"cash_price":4.12,"delivery_start":null,"delivery_end":null,"source_note":null},
      {"observation_key":"2850|k2","elevator":"Ames","commodity_id":"soybeans","bid_date":"2026-07-15","basis":-0.60,"cash_price":null,"delivery_start":"2026-10-01","delivery_end":"2026-10-31","source_note":"basis range -0.65 to -0.55"}]'::jsonb);
  if (v->>'written_rows')::int <> 0 or (v->>'unchanged_rows')::int <> 4 then raise exception 'a retried run must change nothing: %', v; end if;
  select count(*) into v_count from public.cash_bids where feed_source='usda_mars'; if v_count <> 4 then raise exception 'a retried run duplicated history: %', v_count; end if;
  select max(updated_at) into v_after from public.cash_bids where feed_source='usda_mars'; if v_after <> v_before then raise exception 'a retried run moved updated_at'; end if;
  v := public.ingest_usda_mars_observations('2850','00000000-0000-4000-8000-000000000060',
    '[{"observation_key":"2850|k1","elevator":"Cedar Rapids","commodity_id":"corn_yellow","bid_date":"2026-07-15","basis":-0.33,"cash_price":4.14,"delivery_start":null,"delivery_end":null,"source_note":null}]'::jsonb);
  if (v->>'written_rows')::int <> 2 or (v->>'unchanged_rows')::int <> 0 then raise exception 'a changed observation must update both farms: %', v; end if;
  select id into v_id_after from public.cash_bids where farm_id='00000000-0000-4000-8000-000000000050' and feed_observation_key='2850|k1';
  if v_id_after <> v_id then raise exception 'a changed observation must update in place, not replace the row'; end if;
  if (select basis from public.cash_bids where id=v_id) <> -0.33 then raise exception 'the changed basis did not land'; end if;
  select count(*) into v_count from public.cash_bids where feed_source='usda_mars'; if v_count <> 4 then raise exception 'a changed observation duplicated history'; end if;
end $$;

-- ------------------------------------------------------------- the owner
set role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000006"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000006','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000050',1)::text)::text,false);
do $$
declare v_count integer; v_basis numeric; v_updated timestamptz;
begin
  if not public.can_read_private_financials('00000000-0000-4000-8000-000000000050') then raise exception 'owner reads private financials'; end if;
  -- The owner sees the farm's feed rows as history.
  select count(*) into v_count from public.cash_bids where farm_id='00000000-0000-4000-8000-000000000050' and feed_source='usda_mars'; if v_count <> 2 then raise exception 'owner must read the farm''s 2 feed rows, saw %', v_count; end if;
  -- The owner can still record a manual bid.
  insert into public.cash_bids(farm_id,elevator,commodity_id,bid_date,basis,cash_price) values ('00000000-0000-4000-8000-000000000050','Cargill Olney','corn_yellow',current_date,-0.30,4.12);
  -- The owner cannot create a feed row.
  begin
    insert into public.cash_bids(farm_id,elevator,commodity_id,bid_date,basis,cash_price,notes,feed_source,feed_report_id,feed_geography,feed_observation_key)
    values ('00000000-0000-4000-8000-000000000050','Forged','corn_yellow',current_date,-0.01,9.99,'[USDA MARS 2850 · Iowa]','usda_mars','2850','IA','forged');
    raise exception 'owner created a feed row';
  exception when insufficient_privilege then null; end;
  -- The owner cannot edit or delete a feed row (the policies see no such row for update/delete).
  select basis, updated_at into v_basis, v_updated from public.cash_bids where farm_id='00000000-0000-4000-8000-000000000050' and feed_observation_key='2850|k1';
  update public.cash_bids set basis = 0 where farm_id='00000000-0000-4000-8000-000000000050' and feed_observation_key='2850|k1';
  if (select basis from public.cash_bids where farm_id='00000000-0000-4000-8000-000000000050' and feed_observation_key='2850|k1') <> v_basis then raise exception 'owner edited a feed row'; end if;
  delete from public.cash_bids where farm_id='00000000-0000-4000-8000-000000000050' and feed_source='usda_mars';
  select count(*) into v_count from public.cash_bids where farm_id='00000000-0000-4000-8000-000000000050' and feed_source='usda_mars'; if v_count <> 2 then raise exception 'owner deleted a feed row'; end if;
  -- The owner cannot run the fan-out or write the mapping.
  begin
    perform public.ingest_usda_mars_observations('2850','00000000-0000-4000-8000-000000000060','[]'::jsonb);
    raise exception 'owner ran the fan-out';
  exception when insufficient_privilege then null; end;
  if (select count(*) from public.usda_market_reports) <> 1 then raise exception 'signed-in user must read the report mapping'; end if;
  begin
    insert into public.usda_market_reports(report_id,name,geography,geography_label) values ('3101','Forged','IL','Illinois');
    raise exception 'owner wrote the report mapping';
  exception when insufficient_privilege then null; end;
  begin
    update public.usda_market_reports set verified_at = now() where report_id='2850' and verified_at is null;
    if (select count(*) from public.usda_market_reports where verification_note='owner') <> 0 then raise exception 'owner stamped a report'; end if;
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from public.usda_market_report_runs limit 1;
    raise exception 'owner read the run log';
  exception when insufficient_privilege then null; end;
  -- The owner sets a valid region and not an invalid one.
  update public.farms set market_region = 'IN' where id='00000000-0000-4000-8000-000000000050';
  if (select market_region from public.farms where id='00000000-0000-4000-8000-000000000050') <> 'IN' then raise exception 'owner could not set the market region'; end if;
  begin
    update public.farms set market_region = 'Iowa' where id='00000000-0000-4000-8000-000000000050';
    raise exception 'an invalid market region was accepted';
  exception when check_violation then null; end;
  update public.farms set market_region = 'IA' where id='00000000-0000-4000-8000-000000000050';
end $$;

-- ------------------------------------------ worker without financial access
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-00000000000a"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-00000000000a','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000050',1)::text)::text,false);
do $$
declare v_count integer;
begin
  if public.can_read_private_financials('00000000-0000-4000-8000-000000000050') then raise exception 'worker without financials reads private financials'; end if;
  select count(*) into v_count from public.cash_bids where farm_id='00000000-0000-4000-8000-000000000050'; if v_count <> 0 then raise exception 'worker without financials read % cash bid rows', v_count; end if;
  update public.farms set market_region = 'IL' where id='00000000-0000-4000-8000-000000000050';
  if (select market_region from public.farms where id='00000000-0000-4000-8000-000000000050') <> 'IA' then raise exception 'a worker changed the market region'; end if;
end $$;

reset role;
select set_config('request.jwt.claims','',false);
select set_config('request.headers','',false);
select 'GL1_MARS_FEED_DISPOSABLE_PASS' as result;
