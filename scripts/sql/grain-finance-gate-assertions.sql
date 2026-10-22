-- Disposable-backend assertions for migration 20261021170000 (grain pricing and delivery finance gate).
-- Runs after every migration on a fresh database, after the other assertion files; every id here is
-- distinct from theirs. Every failure raises; the last line prints GRAIN_FINANCE_GATE_DISPOSABLE_PASS.
--
-- What is proved: a worker who can edit the farm but cannot see its finances can neither finish a
-- contract's price nor record a delivery against it, and nothing changes when refused; a worker the
-- owner gave financial access to still can; a cash or purchase contract has no price leg to finish;
-- and a finished contract's stored cash price includes its premium exactly once.

\set ON_ERROR_STOP on
\set OWN '''00000000-0000-4000-8000-0000000fa001'''
\set WRK '''00000000-0000-4000-8000-0000000fa002'''
\set FIN '''00000000-0000-4000-8000-0000000fa003'''
\set FRM '''00000000-0000-4000-8000-0000000fa010'''
\set HTA '''00000000-0000-4000-8000-0000000fa020'''
\set BAS '''00000000-0000-4000-8000-0000000fa021'''
\set CSH '''00000000-0000-4000-8000-0000000fa022'''

insert into auth.users(id,email) values (:OWN,'gate-owner@example.test'),(:WRK,'gate-worker@example.test'),(:FIN,'gate-finance-worker@example.test');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000fa001"}',false);
insert into public.farms(id,name,created_by,time_zone) values (:FRM,'Finance Gate Farm',:OWN,'America/Chicago');

select set_config('request.jwt.claims','{"role":"service_role"}',false);
insert into public.farm_memberships(farm_id,user_id,role,status,can_view_financials)
values (:FRM,:WRK,'worker','active',false), (:FRM,:FIN,'worker','active',true);
-- An HTA with futures set and basis open, a basis contract with basis set and futures open (10¢ premium),
-- and a cash purchase contract.
insert into public.grain_contracts(id,farm_id,crop_year,commodity_id,contract_type,buyer,bushels,futures_price,premium_cents_per_bu)
values (:HTA,:FRM,2026,'corn_yellow','hta','Gate Elevator',10000,5.00,0);
insert into public.grain_contracts(id,farm_id,crop_year,commodity_id,contract_type,buyer,bushels,basis,premium_cents_per_bu)
values (:BAS,:FRM,2026,'corn_yellow','basis','Gate Elevator',10000,-0.30,10);
insert into public.grain_contracts(id,farm_id,crop_year,commodity_id,contract_type,buyer,bushels,cash_price)
values (:CSH,:FRM,2026,'corn_yellow','forward_cash','Gate Elevator',10000,4.75);

-- ------------------------------------------------- 1. a worker without financial access is refused
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000fa002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-0000000fa002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-0000000fa010',1)::text)::text,false);
set role authenticated;
do $$
declare v_failed boolean;
begin
  if not public.can_edit_farm('00000000-0000-4000-8000-0000000fa010')
    then raise exception 'the worker fixture cannot edit the farm at all; this assertion proves nothing'; end if;
  if public.can_read_private_financials('00000000-0000-4000-8000-0000000fa010')
    then raise exception 'the worker fixture has financial access; this assertion proves nothing'; end if;

  v_failed := false;
  begin perform public.finalize_contract_price_leg('00000000-0000-4000-8000-0000000fa010','00000000-0000-4000-8000-0000000fa020','basis',-0.25);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a worker without financial access finished a contract price'; end if;

  v_failed := false;
  begin perform public.record_grain_contract_delivery('00000000-0000-4000-8000-0000000fa010', jsonb_build_object('id','00000000-0000-4000-8000-0000000fa030','grain_contract_id','00000000-0000-4000-8000-0000000fa022','bushels',1000,'delivered_on','2026-11-02'));
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a worker without financial access recorded a delivery'; end if;
end $$;
reset role;

select set_config('request.jwt.claims','{"role":"service_role"}',false);
do $$
begin
  if (select basis from public.grain_contracts where id='00000000-0000-4000-8000-0000000fa020') is not null
    then raise exception 'a refused worker still set the basis'; end if;
  if exists (select 1 from public.grain_contract_deliveries where grain_contract_id='00000000-0000-4000-8000-0000000fa022')
    then raise exception 'a refused worker still left a delivery'; end if;
end $$;

-- ------------------------------------------------- 2. a worker with financial access still can
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-0000000fa003"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-0000000fa003','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-0000000fa010',1)::text)::text,false);
set role authenticated;
do $$
declare v_failed boolean; v_row jsonb;
begin
  v_row := public.finalize_contract_price_leg('00000000-0000-4000-8000-0000000fa010','00000000-0000-4000-8000-0000000fa020','basis',-0.25);
  if (v_row->>'cash_price')::numeric <> 4.75 then raise exception 'HTA $5.00 - $0.25 should store $4.75, got %', v_row->>'cash_price'; end if;

  -- The premium is in the stored cash price once: $5.00 - $0.30 + 10¢ = $4.80.
  v_row := public.finalize_contract_price_leg('00000000-0000-4000-8000-0000000fa010','00000000-0000-4000-8000-0000000fa021','futures_price',5.00);
  if (v_row->>'cash_price')::numeric <> 4.80 then raise exception 'basis $5.00 - $0.30 + 10¢ should store $4.80, got %', v_row->>'cash_price'; end if;

  v_row := public.record_grain_contract_delivery('00000000-0000-4000-8000-0000000fa010', jsonb_build_object('id','00000000-0000-4000-8000-0000000fa031','grain_contract_id','00000000-0000-4000-8000-0000000fa022','bushels',1000,'delivered_on','2026-11-02'));
  if (v_row->>'bushels')::numeric <> 1000 then raise exception 'a financial worker could not record a delivery'; end if;

  -- ------------------------------------------------- 3. a cash or purchase contract has no leg to finish
  v_failed := false;
  begin perform public.finalize_contract_price_leg('00000000-0000-4000-8000-0000000fa010','00000000-0000-4000-8000-0000000fa022','basis',-0.20);
  exception when others then v_failed := true; end;
  if not v_failed then raise exception 'a forward cash contract had a price leg finalized'; end if;
end $$;
reset role;

select set_config('request.headers','',false);
select set_config('request.jwt.claims','',false);
select 'GRAIN_FINANCE_GATE_DISPOSABLE_PASS' as result;
