-- Disposable-backend assertions for migration 20260913174500 (Friction Sweep
-- slice 3). Runs after every migration has been applied to a fresh database
-- with the standard synthetic bootstrap (auth schema, roles, auth.uid()).
-- Every failure raises; the last line prints FS_PERSIST_DISPOSABLE_PASS.

\set ON_ERROR_STOP on
\set A '''00000000-0000-4000-8000-000000000001'''
\set B '''00000000-0000-4000-8000-000000000002'''
\set W '''00000000-0000-4000-8000-000000000003'''
\set FA '''00000000-0000-4000-8000-000000000010'''
\set EA '''00000000-0000-4000-8000-000000000011'''
\set PEA '''00000000-0000-4000-8000-000000000012'''
\set FB '''00000000-0000-4000-8000-000000000020'''
\set EB '''00000000-0000-4000-8000-000000000021'''
\set PEB '''00000000-0000-4000-8000-000000000022'''
\set SLA '''00000000-0000-4000-8000-000000000030'''
\set GA '''00000000-0000-4000-8000-000000000031'''

-- ---------------------------------------------------------------- fixtures
insert into auth.users(id,email) values
 (:A,'owner-a@example.test'),
 (:B,'owner-b@example.test'),
 (:W,'worker-a@example.test');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
insert into public.farms(id,name,created_by) values (:FA,'Persist Farm A',:A);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
insert into public.entities(id,farm_id,name,entity_type) values (:EA,:FA,'Entity A','individual');
insert into public.production_estimates(id,farm_id,crop_year,commodity_id,aph_yield,expected_bushels) values (:PEA,:FA,2026,'corn_yellow',200,100000);
insert into public.farm_memberships(farm_id,user_id,role,status) values (:FA,:W,'worker','active');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
insert into public.farms(id,name,created_by) values (:FB,'Persist Farm B',:B);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000020',1)::text)::text,false);
insert into public.entities(id,farm_id,name,entity_type) values (:EB,:FB,'Entity B','individual');
insert into public.production_estimates(id,farm_id,crop_year,commodity_id,aph_yield,expected_bushels) values (:PEB,:FB,2026,'corn_yellow',180,90000);

-- ------------------------------------------------- schema and privilege shape
do $$
declare v_count integer;
begin
  -- RLS is on and anon holds nothing on the three new tables.
  select count(*) into v_count from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('grain_sale_limits','grain_carry_settings','grain_carry_grids') and c.relrowsecurity;
  if v_count <> 3 then raise exception 'row level security is not enabled on all three tables (%)', v_count; end if;
  if has_table_privilege('anon','public.grain_sale_limits','select') or has_table_privilege('anon','public.grain_carry_settings','select') or has_table_privilege('anon','public.grain_carry_grids','select') then
    raise exception 'anon can read a private grain settings table';
  end if;
  -- Twelve policies: select/insert/update/delete on each table, all for authenticated only.
  select count(*) into v_count from pg_catalog.pg_policies
   where schemaname = 'public' and tablename in ('grain_sale_limits','grain_carry_settings','grain_carry_grids') and roles = array['authenticated']::name[];
  if v_count <> 12 then raise exception 'expected 12 authenticated policies, found %', v_count; end if;
  -- Every farm-scoped table carries the access-epoch guard (the 0040 rule the Foundation lane enforces).
  select count(*) into v_count from pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('grain_sale_limits','grain_carry_settings','grain_carry_grids') and t.tgname = 'farm_access_epoch_guard' and not t.tgisinternal;
  if v_count <> 3 then raise exception 'expected the access-epoch guard on all three tables, found %', v_count; end if;
  -- Every foreign key on the new tables has a covering index (database advisor rule).
  with foreign_keys as (
    select c.conrelid, c.conkey, c.conname
    from pg_catalog.pg_constraint c join pg_catalog.pg_class t on t.oid = c.conrelid join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f' and n.nspname = 'public' and t.relname in ('grain_sale_limits','grain_carry_settings','grain_carry_grids')
  ), valid_indexes as (
    select i.indrelid, i.indkey::smallint[] as keys from pg_catalog.pg_index i where i.indisvalid and i.indisready and i.indpred is null
  )
  select count(*) into v_count from foreign_keys fk
   where not exists (select 1 from valid_indexes i where i.indrelid = fk.conrelid and i.keys[0:cardinality(fk.conkey) - 1] = fk.conkey);
  if v_count <> 0 then raise exception '% foreign keys on the new tables lack a covering index', v_count; end if;
  -- The additive cost-line column exists, is nullable, and carries its non-negative check.
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'budget_cost_lines' and column_name = 'university_default_amount' and is_nullable = 'YES' and data_type = 'numeric') then
    raise exception 'budget_cost_lines.university_default_amount is missing or not nullable numeric';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.budget_cost_lines'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%university_default_amount%>= %') then
    raise exception 'university_default_amount has no non-negative check';
  end if;
end $$;

-- --------------------------------------------------------- owner A writes
set role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);

insert into public.grain_sale_limits(id,farm_id,crop_year,commodity_id,operating_entity_id,enterprise_label,sale_limit_bushels)
values (:SLA,:FA,2026,'corn_yellow',null,null,50000);
insert into public.grain_carry_settings(farm_id,mode,monthly_rate_cents_per_bu_month,flat_rate_per_bu,interest_rate_pct,trucking_per_bu)
values (:FA,'flat',4,0.2,6.5,0.1);
insert into public.grain_carry_grids(id,farm_id,production_estimate_id,harvest_month,default_basis,rows)
values (:GA,:FA,:PEA,9,-0.25,'[{"market_price":4.1,"basis":-0.25},{"market_price":4.15,"basis":-0.25},{"market_price":null,"basis":-0.25},{"market_price":4.3,"basis":-0.2},{"market_price":4.35,"basis":-0.2},{"market_price":4.4,"basis":-0.2},{"market_price":4.45,"basis":-0.15},{"market_price":4.5,"basis":-0.15},{"market_price":4.55,"basis":-0.15},{"market_price":null,"basis":null},{"market_price":4.6,"basis":-0.1},{"market_price":4.62,"basis":-0.1},{"market_price":4.65,"basis":-0.1}]'::jsonb);

do $$
declare v_ok boolean; v_count integer;
begin
  if (select count(*) from public.grain_sale_limits) <> 1 then raise exception 'owner cannot read own sale limit'; end if;
  if (select sale_limit_bushels from public.grain_sale_limits where id = '00000000-0000-4000-8000-000000000030') <> 50000 then raise exception 'sale limit value changed'; end if;
  if (select mode from public.grain_carry_settings where farm_id = '00000000-0000-4000-8000-000000000010') <> 'flat' then raise exception 'carry settings value changed'; end if;
  if (select jsonb_array_length(rows) from public.grain_carry_grids where id = '00000000-0000-4000-8000-000000000031') <> 13 then raise exception 'carry grid did not keep 13 rows'; end if;

  -- Clearing the limit is allowed (null = no limit set), then setting it again.
  update public.grain_sale_limits set sale_limit_bushels = null where id = '00000000-0000-4000-8000-000000000030';
  if (select sale_limit_bushels from public.grain_sale_limits where id = '00000000-0000-4000-8000-000000000030') is not null then raise exception 'null sale limit not stored'; end if;
  update public.grain_sale_limits set sale_limit_bushels = 60000 where id = '00000000-0000-4000-8000-000000000030';

  -- A second row for the same five-part scope is refused.
  v_ok := false;
  begin
    insert into public.grain_sale_limits(farm_id,crop_year,commodity_id,operating_entity_id,enterprise_label,sale_limit_bushels) values ('00000000-0000-4000-8000-000000000010',2026,'corn_yellow',null,null,1);
    v_ok := true;
  exception when unique_violation then null; end;
  if v_ok then raise exception 'duplicate sale limit scope accepted'; end if;

  -- Negative numbers are refused everywhere.
  v_ok := false;
  begin update public.grain_sale_limits set sale_limit_bushels = -1 where id = '00000000-0000-4000-8000-000000000030'; v_ok := true; exception when check_violation then null; end;
  if v_ok then raise exception 'negative sale limit accepted'; end if;
  v_ok := false;
  begin update public.grain_carry_settings set trucking_per_bu = -0.01 where farm_id = '00000000-0000-4000-8000-000000000010'; v_ok := true; exception when check_violation then null; end;
  if v_ok then raise exception 'negative trucking accepted'; end if;
  v_ok := false;
  begin update public.grain_carry_settings set mode = 'weekly' where farm_id = '00000000-0000-4000-8000-000000000010'; v_ok := true; exception when check_violation then null; end;
  if v_ok then raise exception 'unknown carry mode accepted'; end if;

  -- The grid must be exactly thirteen {market_price, basis} objects of numbers or nulls.
  v_ok := false;
  begin update public.grain_carry_grids set rows = '[]'::jsonb where id = '00000000-0000-4000-8000-000000000031'; v_ok := true; exception when check_violation then null; end;
  if v_ok then raise exception 'empty carry grid accepted'; end if;
  v_ok := false;
  begin update public.grain_carry_grids set rows = (select jsonb_agg(jsonb_build_object('market_price','4.10','basis',0)) from generate_series(1,13)) where id = '00000000-0000-4000-8000-000000000031'; v_ok := true; exception when check_violation then null; end;
  if v_ok then raise exception 'string price accepted in carry grid'; end if;
  v_ok := false;
  begin update public.grain_carry_grids set rows = (select jsonb_agg(jsonb_build_object('market_price',4.1,'basis',0,'extra',1)) from generate_series(1,13)) where id = '00000000-0000-4000-8000-000000000031'; v_ok := true; exception when check_violation then null; end;
  if v_ok then raise exception 'extra key accepted in carry grid'; end if;
  v_ok := false;
  begin update public.grain_carry_grids set harvest_month = 12 where id = '00000000-0000-4000-8000-000000000031'; v_ok := true; exception when check_violation then null; end;
  if v_ok then raise exception 'harvest month 12 accepted'; end if;
  v_ok := false;
  begin update public.grain_carry_grids set rows = '5'::jsonb where id = '00000000-0000-4000-8000-000000000031'; v_ok := true; exception when check_violation then null; end;
  if v_ok then raise exception 'scalar carry grid accepted'; end if;
  v_ok := false;
  begin update public.grain_carry_grids set rows = (select jsonb_agg(g) from generate_series(1,13) g) where id = '00000000-0000-4000-8000-000000000031'; v_ok := true; exception when check_violation then null; end;
  if v_ok then raise exception 'array of scalars accepted as carry grid'; end if;

  -- A row can never move to another farm.
  v_ok := false;
  begin update public.grain_sale_limits set farm_id = '00000000-0000-4000-8000-000000000020' where id = '00000000-0000-4000-8000-000000000030'; v_ok := true; exception when others then null; end;
  if v_ok then raise exception 'sale limit farm move accepted'; end if;

  -- An entity from another farm cannot scope this farm's limit.
  v_ok := false;
  begin
    insert into public.grain_sale_limits(farm_id,crop_year,commodity_id,operating_entity_id,enterprise_label,sale_limit_bushels) values ('00000000-0000-4000-8000-000000000010',2027,'soybeans','00000000-0000-4000-8000-000000000021',null,1);
    v_ok := true;
  exception when foreign_key_violation then null; end;
  if v_ok then raise exception 'cross-farm entity accepted on sale limit'; end if;

  -- A grid cannot point at another farm's production estimate.
  v_ok := false;
  begin
    insert into public.grain_carry_grids(farm_id,production_estimate_id,harvest_month,default_basis,rows) values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000022',9,0,(select jsonb_agg(jsonb_build_object('market_price',null,'basis',0)) from generate_series(1,13)));
    v_ok := true;
  exception when foreign_key_violation then null; end;
  if v_ok then raise exception 'cross-farm estimate accepted on carry grid'; end if;
end $$;

-- ------------------------------------------------- owner B sees nothing of A
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000020',1)::text)::text,false);
do $$
declare v_ok boolean; v_count integer;
begin
  if (select count(*) from public.grain_sale_limits) <> 0 then raise exception 'another farm can read sale limits'; end if;
  if (select count(*) from public.grain_carry_settings) <> 0 then raise exception 'another farm can read carry settings'; end if;
  if (select count(*) from public.grain_carry_grids) <> 0 then raise exception 'another farm can read carry grids'; end if;
  -- The access-epoch guard (0040) fires before row-level security; either refusal is correct, anything else is not.
  v_ok := false;
  begin insert into public.grain_sale_limits(farm_id,crop_year,commodity_id,sale_limit_bushels) values ('00000000-0000-4000-8000-000000000010',2027,'soybeans',1); v_ok := true; exception when others then if sqlerrm <> 'FARM_ACCESS_EPOCH_CHANGED' and sqlerrm not like '%row-level security%' then raise; end if; end;
  if v_ok then raise exception 'another farm could insert a sale limit'; end if;
  v_ok := false;
  begin insert into public.grain_carry_settings(farm_id) values ('00000000-0000-4000-8000-000000000010'); v_ok := true; exception when others then if sqlerrm <> 'FARM_ACCESS_EPOCH_CHANGED' and sqlerrm not like '%row-level security%' then raise; end if; end;
  if v_ok then raise exception 'another farm could insert carry settings'; end if;
  update public.grain_sale_limits set sale_limit_bushels = 1 where farm_id = '00000000-0000-4000-8000-000000000010';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'another farm could update a sale limit'; end if;
  delete from public.grain_carry_grids where farm_id = '00000000-0000-4000-8000-000000000010';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'another farm could delete a carry grid'; end if;
end $$;

-- ---------------------------------- worker without financials sees nothing
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000003"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000003','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
do $$
declare v_ok boolean; v_count integer;
begin
  if (select count(*) from public.grain_sale_limits) <> 0 then raise exception 'worker without financials can read sale limits'; end if;
  if (select count(*) from public.grain_carry_settings) <> 0 then raise exception 'worker without financials can read carry settings'; end if;
  if (select count(*) from public.grain_carry_grids) <> 0 then raise exception 'worker without financials can read carry grids'; end if;
  -- A worker who can edit the farm but cannot read financials must not seed these rows either.
  v_ok := false;
  begin insert into public.grain_sale_limits(farm_id,crop_year,commodity_id,sale_limit_bushels) values ('00000000-0000-4000-8000-000000000010',2028,'wheat',1); v_ok := true; exception when insufficient_privilege then null; end;
  if v_ok then raise exception 'worker without financials could insert a sale limit'; end if;
  v_ok := false;
  begin insert into public.grain_carry_grids(farm_id,production_estimate_id,harvest_month,default_basis,rows) values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000012',9,0,(select jsonb_agg(jsonb_build_object('market_price',null,'basis',0)) from generate_series(1,13))); v_ok := true; exception when insufficient_privilege then null; end;
  if v_ok then raise exception 'worker without financials could insert a carry grid'; end if;
  update public.grain_carry_settings set trucking_per_bu = 9 where farm_id = '00000000-0000-4000-8000-000000000010';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'worker without financials could update carry settings'; end if;
end $$;
reset role;

-- --------------------------------------------- deleting the estimate cascades
delete from public.production_estimates where id = :PEA;
do $$
begin
  if exists (select 1 from public.grain_carry_grids where id = '00000000-0000-4000-8000-000000000031') then raise exception 'carry grid survived its production estimate'; end if;
  if not exists (select 1 from public.grain_sale_limits where id = '00000000-0000-4000-8000-000000000030') then raise exception 'sale limit was wrongly removed'; end if;
end $$;

select 'FS_PERSIST_DISPOSABLE_PASS' as result;
