-- Migration 0033 (bin and contract truth), ported from verify-0033-disposable.ps1 so it runs on a
-- development machine.
--
-- Why this file exists: 0033 is the second of the three PowerShell-only lanes. Its rules are the
-- ones that decide whether the bushels Farm Rx shows a farmer are the bushels they have -- a bin
-- cannot go negative, cannot hold more than it holds, cannot quietly mix two crops, a contract
-- cannot be overdelivered, and a price leg is finalized once. None of that was checkable here.
--
-- Same two adaptations as the epoch port: expected failures are plpgsql blocks rather than separate
-- psql invocations, and the fixture takes its own uuid block (user 00...017, farm 00...0f0, bins
-- 00...0f1-0f3) so it cannot collide with the files that ran before it in the shared database.
--
-- Every failure raises; the last line prints BIN_CONTRACT_TRUTH_DISPOSABLE_PASS.

-- ------------------------------------------------- 1. the fixture
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000017','bin-truth@example.test') on conflict do nothing;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000017"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000017','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-0000000000f0',1)::text)::text,false);

insert into public.farms(id,name,created_by) values ('00000000-0000-4000-8000-0000000000f0','Bin Truth Farm','00000000-0000-4000-8000-000000000017');
insert into public.farm_memberships(farm_id,user_id,role,status) values ('00000000-0000-4000-8000-0000000000f0','00000000-0000-4000-8000-000000000017','owner','active') on conflict do nothing;

insert into public.grain_bins(id,farm_id,name,capacity_bu,location_type) values
  ('00000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-0000000000f0','Truth A',1000,'on_farm'),
  ('00000000-0000-4000-8000-0000000000f2','00000000-0000-4000-8000-0000000000f0','Truth B',1000,'on_farm'),
  ('00000000-0000-4000-8000-0000000000f3','00000000-0000-4000-8000-0000000000f0','Truth C',1000,'on_farm');

-- A measured baseline is what the farmer counted; movements are what happened since.
insert into public.bin_inventory(id,farm_id,grain_bin_id,crop_year,commodity_id,bushels,committed_bushels,measured_at) values
  ('00000000-0000-4000-8000-0000000000f4','00000000-0000-4000-8000-0000000000f0','00000000-0000-4000-8000-0000000000f1',2026,'corn_yellow',600,0,'2026-07-01T12:00:00Z'),
  ('00000000-0000-4000-8000-0000000000f5','00000000-0000-4000-8000-0000000000f0','00000000-0000-4000-8000-0000000000f3',2026,'corn_yellow',600,0,'2026-07-01T12:00:00Z');

insert into public.bin_transactions(id,farm_id,grain_bin_id,direction,bushels,commodity_id,occurred_on) values
  ('00000000-0000-4000-8000-0000000000f6','00000000-0000-4000-8000-0000000000f0','00000000-0000-4000-8000-0000000000f2','in',200,'corn_yellow','2026-07-02'),
  ('00000000-0000-4000-8000-0000000000f7','00000000-0000-4000-8000-0000000000f0','00000000-0000-4000-8000-0000000000f1','in',500,'soybeans','2026-06-30');

insert into public.grain_contracts(id,farm_id,crop_year,commodity_id,operating_entity_id,enterprise_label,contract_type,buyer,bushels,futures_price,basis,cash_price,premium_cents_per_bu)
values ('00000000-0000-4000-8000-0000000000f8','00000000-0000-4000-8000-0000000000f0',2026,'corn_yellow',null,null,'hta','Truth Buyer',100,5,null,null,0);

set role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000017"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000017','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-0000000000f0',1)::text)::text,false);

-- ------------------------------------------------- 2. a bin's capacity counts every crop in it
-- Bin A holds a 600 bu corn baseline and 500 bu of soybeans. Capacity is 1000. Adding 400 more bu
-- of corn has to be refused on the bin's total, not on the corn lot alone -- and the soybeans that
-- made it full must still be there afterwards, because a capacity refusal is not a reason to
-- forget a lot.
do $$ declare v_soy_balance numeric; begin
  begin
    perform public.append_bin_movement('00000000-0000-4000-8000-0000000000f0','{"id":"00000000-0000-4000-8000-000000000100","grain_bin_id":"00000000-0000-4000-8000-0000000000f1","direction":"in","bushels":400,"commodity_id":"corn_yellow","occurred_on":"2026-07-02"}'::jsonb);
    raise exception 'same-bin pre-baseline other-commodity capacity accepted';
  exception when others then
    if position('more grain in the bin' in sqlerrm)=0 then raise; end if;
  end;
  select coalesce(sum(case when direction='in' then bushels else -bushels end),0) into v_soy_balance
  from public.bin_transactions where grain_bin_id='00000000-0000-4000-8000-0000000000f1' and commodity_id='soybeans';
  if v_soy_balance<>500 then raise exception 'same-bin soybean active lot was not retained: %', v_soy_balance; end if;
end $$;

-- ------------------------------------------------- 3. a bin holding one crop will not take another
-- Bin C has a nonzero corn lot. Putting soybeans in it would make the bin's contents ambiguous,
-- and every downstream bushel figure with it, so it is refused by naming the lot in the way.
do $$ begin
  begin
    perform public.append_bin_movement('00000000-0000-4000-8000-0000000000f0','{"id":"00000000-0000-4000-8000-000000000101","grain_bin_id":"00000000-0000-4000-8000-0000000000f3","direction":"in","bushels":1,"commodity_id":"soybeans","occurred_on":"2026-07-02"}'::jsonb);
    raise exception 'soybean was accepted into a bin holding corn';
  exception when others then
    if position('nonzero lots: corn_yellow' in sqlerrm)=0 then raise; end if;
  end;
end $$;

-- ------------------------------------------------- 4. a lost response is not a second movement
-- The id belongs to the movement, not the attempt. A retry after a dropped response must replay
-- the row that exists rather than add bushels the farm never moved.
select public.append_bin_movement('00000000-0000-4000-8000-0000000000f0','{"id":"00000000-0000-4000-8000-000000000102","grain_bin_id":"00000000-0000-4000-8000-0000000000f3","direction":"in","bushels":100,"commodity_id":"corn_yellow","occurred_on":"2026-07-02"}'::jsonb)->>'id' as movement_first;
select public.append_bin_movement('00000000-0000-4000-8000-0000000000f0','{"id":"00000000-0000-4000-8000-000000000102","grain_bin_id":"00000000-0000-4000-8000-0000000000f3","direction":"in","bushels":100,"commodity_id":"corn_yellow","occurred_on":"2026-07-02"}'::jsonb)->>'id' as movement_replay;
do $$ begin
  if (select count(*) from public.bin_transactions where id='00000000-0000-4000-8000-000000000102')<>1 then raise exception 'movement sequential replay inserted more than one row'; end if;
end $$;

-- ------------------------------------------------- 5. the ledger has one write path
-- The RPC is where the guards live, so a browser holding a direct INSERT would walk past all of
-- them. The privilege is the outer fence.
do $$ begin
  begin
    insert into public.bin_transactions(id,farm_id,grain_bin_id,direction,bushels,commodity_id,occurred_on)
    values ('00000000-0000-4000-8000-000000000103','00000000-0000-4000-8000-0000000000f0','00000000-0000-4000-8000-0000000000f3','in',1,'corn_yellow','2026-07-03');
    raise exception 'a direct bin ledger insert was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ------------------------------------------------- 6. a bin cannot go negative or overflow
-- Bin C now holds 700 bu of corn (600 baseline + 100 moved in) against a 1000 bu capacity.
do $$ begin
  begin
    perform public.append_bin_movement('00000000-0000-4000-8000-0000000000f0','{"id":"00000000-0000-4000-8000-000000000104","grain_bin_id":"00000000-0000-4000-8000-0000000000f3","direction":"out","bushels":701,"commodity_id":"corn_yellow","occurred_on":"2026-07-03"}'::jsonb);
    raise exception 'a movement taking the bin negative was accepted';
  exception when others then
    if position('balance negative' in sqlerrm)=0 then raise; end if;
  end;
  begin
    perform public.append_bin_movement('00000000-0000-4000-8000-0000000000f0','{"id":"00000000-0000-4000-8000-000000000105","grain_bin_id":"00000000-0000-4000-8000-0000000000f3","direction":"in","bushels":401,"commodity_id":"corn_yellow","occurred_on":"2026-07-03"}'::jsonb);
    raise exception 'a movement past the bin capacity was accepted';
  exception when others then
    if position('more grain in the bin' in sqlerrm)=0 then raise; end if;
  end;
end $$;

-- ------------------------------------------------- 7. an emptied bin can hold the next crop
-- The one-crop rule in section 3 is about a nonzero lot, not about the bin's history. Once the
-- corn is out, soybeans are allowed in -- otherwise a bin could only ever hold one crop, forever.
select public.append_bin_movement('00000000-0000-4000-8000-0000000000f0','{"id":"00000000-0000-4000-8000-000000000106","grain_bin_id":"00000000-0000-4000-8000-0000000000f3","direction":"out","bushels":700,"commodity_id":"corn_yellow","occurred_on":"2026-07-03"}'::jsonb)->>'id' as rotation_empty_corn;
select public.append_bin_movement('00000000-0000-4000-8000-0000000000f0','{"id":"00000000-0000-4000-8000-000000000107","grain_bin_id":"00000000-0000-4000-8000-0000000000f3","direction":"in","bushels":50,"commodity_id":"soybeans","occurred_on":"2026-07-03"}'::jsonb)->>'id' as rotation_store_soybeans;
do $$ begin
  if (select count(*) from public.bin_transactions where id='00000000-0000-4000-8000-000000000107')<>1 then raise exception 'the rotated-in soybean movement did not persist'; end if;
end $$;

-- ------------------------------------------------- 8. a price leg is finalized once, through the RPC
-- GL-3b revoked UPDATE on grain_contracts from authenticated, so a signed-in client no longer
-- reaches the trigger at all: the privilege is the outer fence, as it is for the bin ledger above.
-- Both facts stay pinned -- the grant is gone here, and the trigger still guards any caller that
-- does hold the privilege, checked as the owner below.
do $$ begin
  begin
    update public.grain_contracts set basis=-0.20, cash_price=4.80 where id='00000000-0000-4000-8000-0000000000f8';
    raise exception 'a direct price update was accepted';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
do $$ begin
  begin
    update public.grain_contracts set basis=-0.20, cash_price=4.80 where id='00000000-0000-4000-8000-0000000000f8';
    raise exception 'a direct price update was accepted by a privileged caller';
  exception when others then
    if position('only be finalized through the price-finalization action' in sqlerrm)=0 then raise; end if;
  end;
end $$;

set role authenticated;
select (public.finalize_contract_price_leg('00000000-0000-4000-8000-0000000000f0','00000000-0000-4000-8000-0000000000f8','basis',-0.20)->>'cash_price') as rpc_cash_price;
do $$ begin
  -- Finalizing is a compare-and-set: a second attempt is a stale client, not a correction.
  begin
    perform public.finalize_contract_price_leg('00000000-0000-4000-8000-0000000000f0','00000000-0000-4000-8000-0000000000f8','basis',-0.21);
    raise exception 'a second price finalization was accepted';
  exception when others then
    if position('already finalized' in sqlerrm)=0 then raise; end if;
  end;
  if (select cash_price from public.grain_contracts where id='00000000-0000-4000-8000-0000000000f8') is distinct from 4.80 then
    raise exception 'the finalized cash price is not futures plus basis';
  end if;
end $$;

-- ------------------------------------------------- 9. a contract cannot be overdelivered
-- The contract is 100 bu. A 60 bu delivery replays on retry, and the next 50 would take the total
-- past what was sold -- which is the moment a farmer would otherwise owe bushels they do not have.
select public.record_grain_contract_delivery('00000000-0000-4000-8000-0000000000f0','{"id":"00000000-0000-4000-8000-000000000108","grain_contract_id":"00000000-0000-4000-8000-0000000000f8","bushels":60,"delivered_on":"2026-07-03"}'::jsonb)->>'id' as delivery_first;
select public.record_grain_contract_delivery('00000000-0000-4000-8000-0000000000f0','{"id":"00000000-0000-4000-8000-000000000108","grain_contract_id":"00000000-0000-4000-8000-0000000000f8","bushels":60,"delivered_on":"2026-07-03"}'::jsonb)->>'id' as delivery_replay;
do $$ begin
  if (select count(*) from public.grain_contract_deliveries where id='00000000-0000-4000-8000-000000000108')<>1 then raise exception 'delivery sequential replay inserted more than one row'; end if;
  begin
    perform public.record_grain_contract_delivery('00000000-0000-4000-8000-0000000000f0','{"id":"00000000-0000-4000-8000-000000000109","grain_contract_id":"00000000-0000-4000-8000-0000000000f8","bushels":50,"delivered_on":"2026-07-03"}'::jsonb);
    raise exception 'an overdelivery was accepted';
  exception when others then
    if position('would exceed the remaining contract bushels' in sqlerrm)=0 then raise; end if;
  end;
  if (select count(*) from public.grain_contract_deliveries where grain_contract_id='00000000-0000-4000-8000-0000000000f8')<>1 then
    raise exception 'the refused overdelivery left a row behind';
  end if;
end $$;

reset role;
select set_config('request.jwt.claims','',false);
select set_config('request.headers','{}',false);

select 'BIN_CONTRACT_TRUTH_DISPOSABLE_PASS' as result;
