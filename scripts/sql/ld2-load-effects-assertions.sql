-- Disposable-backend assertions for Initiative LD-2 (load effects, explicit and atomic).
-- Runs after every migration on a fresh database, in the same database and after the FS, FD,
-- GL-1, GL-2, GL-3b, LD-1, epoch-fencing and bin/contract assertion files, so every id here is
-- distinct from theirs. Every failure raises; the last line prints LD2_LOAD_EFFECTS_DISPOSABLE_PASS.
--
-- What is proved:
--   * an effect happens only when the farmer confirmed it on that save, and an effect the load's
--     shape cannot reach is refused by name rather than silently ignored;
--   * the save is all-or-nothing -- a guard refusing one effect leaves no ticket behind;
--   * a lost response replays without doubling any effect, and the same id asking for different
--     effects is refused;
--   * the negative-balance guard now holds at the LOT: a bin-out stamped for one crop year cannot
--     exceed that year's bushels even when the bin's combined total for the commodity would cover
--     it -- proved by the same 800 bushels being refused stamped and accepted unstamped;
--   * movements written before LD-2 carry a null crop year, stay their own bucket, and are never
--     credited to a named year -- while the commodity guard still stops the bin going negative;
--   * a void reverses exactly what the load created and nothing else, and never touches a manual
--     harvest total;
--   * a void the bin cannot take changes NOTHING and names the later movements in the way;
--   * naming the crop year of a legacy movement is owner-only, one-way, and refuses an answer
--     that would leave that year short;
--   * the ledger is still a ledger: a movement cannot be edited;
--   * a farm with loads and load-created ledger rows can still be deleted.

\set ON_ERROR_STOP on

-- ------------------------------------------------- fixtures
insert into auth.users(id,email) values
  ('00000000-0000-4000-8000-000000000200','ld2-owner@example.test'),
  ('00000000-0000-4000-8000-000000000201','ld2-worker@example.test');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000200"}',false);
insert into public.farms(id,name,created_by,time_zone)
values ('00000000-0000-4000-8000-000000000210','LD2 Farm','00000000-0000-4000-8000-000000000200','America/Chicago');

select set_config('request.jwt.claims','{"role":"service_role"}',false);
insert into public.entities(id,farm_id,name,entity_type)
values ('00000000-0000-4000-8000-000000000211','00000000-0000-4000-8000-000000000210','LD2 Entity','sole_proprietorship');
insert into public.fields(id,farm_id,operating_entity_id,name,total_acres)
values ('00000000-0000-4000-8000-000000000212','00000000-0000-4000-8000-000000000210','00000000-0000-4000-8000-000000000211','LD2 Field',200);
insert into public.crop_assignments(id,farm_id,field_id,crop_year,commodity_id,planting_sequence,planted_acres,harvested_bushels)
values ('00000000-0000-4000-8000-000000000213','00000000-0000-4000-8000-000000000210','00000000-0000-4000-8000-000000000212',2026,'corn_yellow',1,200,null),
       ('00000000-0000-4000-8000-000000000214','00000000-0000-4000-8000-000000000210','00000000-0000-4000-8000-000000000212',2025,'corn_yellow',2,200,41000);
insert into public.grain_bins(id,farm_id,name,capacity_bu,location_type) values
  ('00000000-0000-4000-8000-000000000220','00000000-0000-4000-8000-000000000210','LD2 Origin Bin',50000,'on_farm'),
  ('00000000-0000-4000-8000-000000000221','00000000-0000-4000-8000-000000000210','LD2 Destination Bin',50000,'on_farm'),
  ('00000000-0000-4000-8000-000000000222','00000000-0000-4000-8000-000000000210','LD2 Two Lot Bin',50000,'on_farm'),
  ('00000000-0000-4000-8000-000000000223','00000000-0000-4000-8000-000000000210','LD2 Blocked Void Bin',50000,'on_farm'),
  ('00000000-0000-4000-8000-000000000224','00000000-0000-4000-8000-000000000210','LD2 Legacy Bin',50000,'on_farm');
insert into public.bin_inventory(id,farm_id,grain_bin_id,crop_year,commodity_id,bushels,measured_at) values
  ('00000000-0000-4000-8000-000000000230','00000000-0000-4000-8000-000000000210','00000000-0000-4000-8000-000000000220',2025,'corn_yellow',20000,'2026-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000231','00000000-0000-4000-8000-000000000210','00000000-0000-4000-8000-000000000222',2025,'corn_yellow',600,'2026-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000232','00000000-0000-4000-8000-000000000210','00000000-0000-4000-8000-000000000224',2025,'corn_yellow',5000,'2026-01-01T00:00:00Z');
insert into public.grain_contracts(id,farm_id,crop_year,commodity_id,contract_type,buyer,bushels,cash_price) values
  ('00000000-0000-4000-8000-000000000240','00000000-0000-4000-8000-000000000210',2026,'corn_yellow','forward_cash','LD2 Buyer',10000,4.60),
  ('00000000-0000-4000-8000-000000000241','00000000-0000-4000-8000-000000000210',2025,'corn_yellow','forward_cash','LD2 Carryover Buyer',6000,4.20);

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000200"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000200','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000210',1)::text)::text,false);

-- ------------------------------------------------- 1. an effect happens only when confirmed
-- The same load shape saved twice: once with the bin-out unchecked, once with it checked. The
-- ledger is the difference. "Nothing happens silently" is exactly this assertion.
do $$
declare v_count integer; v_movement public.bin_transactions%rowtype;
begin
  perform public.save_grain_load('00000000-0000-4000-8000-000000000210', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000250','load_date','2026-10-01',
    'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000220',
    'destination_kind','buyer','destination_buyer','LD2 Elevator','net_bushels',500,
    'effect_bin_out',false));
  select count(*) into v_count from public.bin_transactions
    where grain_load_id = '00000000-0000-4000-8000-000000000250';
  if v_count <> 0 then
    raise exception 'a load saved with the bin-out unchecked still moved grain (% rows)', v_count;
  end if;

  perform public.save_grain_load('00000000-0000-4000-8000-000000000210', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000251','load_date','2026-10-02',
    'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000220',
    'destination_kind','buyer','destination_buyer','LD2 Elevator','net_bushels',500,
    'ticket_number','T-251','effect_bin_out',true));
  select count(*) into v_count from public.bin_transactions
    where grain_load_id = '00000000-0000-4000-8000-000000000251';
  if v_count <> 1 then
    raise exception 'a confirmed bin-out wrote % movements, expected 1', v_count;
  end if;

  select * into v_movement from public.bin_transactions
    where grain_load_id = '00000000-0000-4000-8000-000000000251';
  if v_movement.direction <> 'out' then raise exception 'the load movement is not an out'; end if;
  if v_movement.bushels <> 500 then raise exception 'the load movement carries % bushels', v_movement.bushels; end if;
  -- The lot stamp is the whole point of LD-2: the movement says which crop year left the bin.
  if v_movement.crop_year is distinct from 2025 then
    raise exception 'the load movement is stamped crop year %, expected the bin lot 2025', v_movement.crop_year;
  end if;
  if v_movement.source_kind is distinct from 'grain_load' then
    raise exception 'the load movement is not marked as coming from a load';
  end if;
end $$;

-- ------------------------------------------------- 2. an unreachable effect is refused by name
do $$
declare v_failed boolean;
begin
  v_failed := false;
  begin
    perform public.save_grain_load('00000000-0000-4000-8000-000000000210', jsonb_build_object(
      'id',gen_random_uuid(),'load_date','2026-10-03',
      'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000220',
      'destination_kind','buyer','destination_buyer','LD2 Elevator','net_bushels',100,
      'effect_contract_delivery',true));
  exception when others then
    v_failed := true;
    if position('cannot record a delivery' in sqlerrm) = 0 then raise; end if;
  end;
  if not v_failed then raise exception 'a load to a buyer was allowed to record a contract delivery'; end if;

  v_failed := false;
  begin
    perform public.save_grain_load('00000000-0000-4000-8000-000000000210', jsonb_build_object(
      'id',gen_random_uuid(),'load_date','2026-10-03',
      'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000220',
      'destination_kind','buyer','destination_buyer','LD2 Elevator','net_bushels',100,
      'effect_harvest',true));
  exception when others then
    v_failed := true;
    if position('cannot count toward a harvest' in sqlerrm) = 0 then raise; end if;
  end;
  if not v_failed then raise exception 'a load out of a bin was allowed to count toward a harvest'; end if;
end $$;

-- ------------------------------------------------- 3. the save is all-or-nothing
-- The bin holds 20000 of the 2025 crop and 500 have already left it. A load asking to take
-- 30000 out must leave no ticket behind at all -- not a ticket without its effect.
do $$
declare v_failed boolean; v_count integer;
begin
  v_failed := false;
  begin
    perform public.save_grain_load('00000000-0000-4000-8000-000000000210', jsonb_build_object(
      'id','00000000-0000-4000-8000-000000000252','load_date','2026-10-04',
      'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000220',
      'destination_kind','buyer','destination_buyer','LD2 Elevator','net_bushels',30000,
      'effect_bin_out',true));
  exception when others then
    v_failed := true;
    if position('negative' in sqlerrm) = 0 and position('does not hold that many' in sqlerrm) = 0 then raise; end if;
  end;
  if not v_failed then raise exception 'a load was allowed to take more grain than the bin holds'; end if;

  select count(*) into v_count from public.grain_loads
    where id = '00000000-0000-4000-8000-000000000252';
  if v_count <> 0 then
    raise exception 'a refused effect still left a load ticket behind';
  end if;
end $$;

-- ------------------------------------------------- 4. a lost response replays, effects and all
do $$
declare v_count integer; v_first jsonb; v_again jsonb;
begin
  select to_jsonb(l) into v_first from public.grain_loads l
    where id = '00000000-0000-4000-8000-000000000251';
  v_again := public.save_grain_load('00000000-0000-4000-8000-000000000210', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000251','load_date','2026-10-02',
    'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000220',
    'destination_kind','buyer','destination_buyer','LD2 Elevator','net_bushels',500,
    'ticket_number','T-251','effect_bin_out',true));
  if v_again->>'id' is distinct from '00000000-0000-4000-8000-000000000251' then
    raise exception 'a replayed load did not return the saved ticket';
  end if;
  select count(*) into v_count from public.bin_transactions
    where grain_load_id = '00000000-0000-4000-8000-000000000251';
  if v_count <> 1 then
    raise exception 'replaying a load doubled its bin movement (% rows)', v_count;
  end if;
end $$;

-- ------------------------------------------------- 5. the same id asking for different effects
-- The effects take part in the idempotency comparison, so a retry cannot quietly change what the
-- save does under an id the server has already answered for.
do $$
declare v_failed boolean;
begin
  v_failed := false;
  begin
    perform public.save_grain_load('00000000-0000-4000-8000-000000000210', jsonb_build_object(
      'id','00000000-0000-4000-8000-000000000251','load_date','2026-10-02',
      'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000220',
      'destination_kind','buyer','destination_buyer','LD2 Elevator','net_bushels',500,
      'ticket_number','T-251','effect_bin_out',false));
  exception when others then
    v_failed := true;
    if position('FARM_RX_LOAD_ID_REUSED' in sqlerrm) = 0 then raise; end if;
  end;
  if not v_failed then raise exception 'a load id was reused with different effects and accepted'; end if;
end $$;

-- ------------------------------------------------- 6. THE LOT GUARD
-- The bin holds 600 bushels of the 2025 crop (its baseline) and 400 of the 2026 crop. The
-- commodity total is 1000. Taking 800 out is therefore fine by the commodity guard and wrong by
-- the lot: there are only 400 bushels of 2026 corn in there. The same 800 bushels are refused
-- when stamped 2026 and accepted when unstamped, which is the entire reason this column exists.
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000200','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000210',1)::text)::text,false);
do $$
declare v_failed boolean;
begin
  perform public.append_bin_movement('00000000-0000-4000-8000-000000000210', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000260','grain_bin_id','00000000-0000-4000-8000-000000000222',
    'direction','in','bushels',400,'commodity_id','corn_yellow','crop_year',2026,
    'occurred_on','2026-02-01'));

  v_failed := false;
  begin
    perform public.append_bin_movement('00000000-0000-4000-8000-000000000210', jsonb_build_object(
      'id',gen_random_uuid(),'grain_bin_id','00000000-0000-4000-8000-000000000222',
      'direction','out','bushels',800,'commodity_id','corn_yellow','crop_year',2026,
      'occurred_on','2026-03-01'));
  exception when sqlstate 'FR001' then
    v_failed := true;
    if position('does not hold that many bushels of the 2026 crop' in sqlerrm) = 0 then raise; end if;
  end;
  if not v_failed then
    raise exception 'a bin-out stamped 2026 took more than the 2026 lot held';
  end if;

  -- The same 800 bushels, unstamped: the commodity guard alone lets this through, which is
  -- precisely the hole the lot guard closes.
  perform public.append_bin_movement('00000000-0000-4000-8000-000000000210', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000261','grain_bin_id','00000000-0000-4000-8000-000000000222',
    'direction','out','bushels',800,'commodity_id','corn_yellow',
    'occurred_on','2026-03-02'));
end $$;

-- ------------------------------------------------- 7. the unknown bucket is never credited
-- That unstamped 800 is now an "unknown crop year" row. It is invisible to the 2026 lot, so the
-- lot still reads 400 -- but the commodity guard still knows only 200 bushels are physically
-- left, and it is what refuses. Both guards are live; neither is a substitute for the other.
do $$
declare v_failed boolean; v_unknown numeric;
begin
  select coalesce(sum(case when direction='in' then bushels else -bushels end),0) into v_unknown
    from public.bin_transactions
   where grain_bin_id = '00000000-0000-4000-8000-000000000222' and crop_year is null;
  if v_unknown <> -800 then
    raise exception 'the unknown-crop-year bucket reads % bushels, expected -800', v_unknown;
  end if;

  v_failed := false;
  begin
    perform public.append_bin_movement('00000000-0000-4000-8000-000000000210', jsonb_build_object(
      'id',gen_random_uuid(),'grain_bin_id','00000000-0000-4000-8000-000000000222',
      'direction','out','bushels',400,'commodity_id','corn_yellow','crop_year',2026,
      'occurred_on','2026-03-03'));
  exception when sqlstate 'FR001' then
    v_failed := true;
    if position('would make the bin balance negative' in sqlerrm) = 0 then raise; end if;
  end;
  if not v_failed then
    raise exception 'the 2026 lot was drawn past what the bin physically holds';
  end if;
end $$;

-- ------------------------------------------------- 8. a void reverses exactly what the load did
do $$
declare v_count integer; v_result jsonb; v_balance numeric;
begin
  perform public.save_grain_load('00000000-0000-4000-8000-000000000210', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000253','load_date','2026-10-05',
    'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000220',
    'destination_kind','bin','destination_grain_bin_id','00000000-0000-4000-8000-000000000221',
    'net_bushels',300,'ticket_number','T-253',
    'effect_bin_out',true,'effect_bin_in',true));
  select count(*) into v_count from public.bin_transactions
    where grain_load_id = '00000000-0000-4000-8000-000000000253';
  if v_count <> 2 then raise exception 'a bin-to-bin load wrote % movements, expected 2', v_count; end if;

  v_result := public.void_grain_load('00000000-0000-4000-8000-000000000210',
    '00000000-0000-4000-8000-000000000253','the ticket was written against the wrong bin');
  if v_result->>'status' is distinct from 'voided' then
    raise exception 'voiding a reversible load answered %', v_result->>'status';
  end if;

  select count(*) into v_count from public.bin_transactions
    where grain_load_id = '00000000-0000-4000-8000-000000000253' and source_kind = 'grain_load_void';
  if v_count <> 2 then raise exception 'the void wrote % compensating movements, expected 2', v_count; end if;

  -- The destination bin is back to empty for that lot, and the ledger kept every row.
  select coalesce(sum(case when direction='in' then bushels else -bushels end),0) into v_balance
    from public.bin_transactions
   where grain_bin_id = '00000000-0000-4000-8000-000000000221' and commodity_id = 'corn_yellow';
  if v_balance <> 0 then
    raise exception 'the destination bin still holds % bushels after the void', v_balance;
  end if;
end $$;

-- ------------------------------------------------- 9. the harvest contribution is derived only
-- crop_assignments.harvested_bushels is one replaceable total that the Harvest form overwrites
-- whole. A load must never touch it -- not on save, not on void. The 2025 assignment carries a
-- manual 41000 and must still carry exactly that at the end of this block.
do $$
declare v_derived numeric; v_manual numeric; v_result jsonb; v_count integer;
begin
  perform public.save_grain_load('00000000-0000-4000-8000-000000000210', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000254','load_date','2026-10-06',
    'origin_kind','field','origin_crop_assignment_id','00000000-0000-4000-8000-000000000213',
    'destination_kind','contract','destination_grain_contract_id','00000000-0000-4000-8000-000000000240',
    'net_bushels',1200,'ticket_number','T-254',
    'effect_contract_delivery',true,'effect_harvest',true));

  select count(*) into v_count from public.grain_contract_deliveries
    where grain_load_id = '00000000-0000-4000-8000-000000000254';
  if v_count <> 1 then raise exception 'a confirmed delivery wrote % rows, expected 1', v_count; end if;

  select harvested_bushels into v_manual from public.crop_assignments
    where id = '00000000-0000-4000-8000-000000000213';
  if v_manual is not null then
    raise exception 'a load wrote % into the manual harvest total', v_manual;
  end if;

  -- A field load with the harvest effect unchecked contributes nothing to the derived figure.
  perform public.save_grain_load('00000000-0000-4000-8000-000000000210', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000255','load_date','2026-10-06',
    'origin_kind','field','origin_crop_assignment_id','00000000-0000-4000-8000-000000000213',
    'destination_kind','buyer','destination_buyer','LD2 Elevator','net_bushels',900,
    'effect_harvest',false));

  select coalesce(sum(net_bushels),0) into v_derived from public.grain_loads
   where farm_id = '00000000-0000-4000-8000-000000000210'
     and origin_crop_assignment_id = '00000000-0000-4000-8000-000000000213'
     and effect_harvest and voided_at is null;
  if v_derived <> 1200 then
    raise exception 'the from-loads figure reads %, expected only the 1200 that was confirmed', v_derived;
  end if;

  v_result := public.void_grain_load('00000000-0000-4000-8000-000000000210',
    '00000000-0000-4000-8000-000000000254','wrong contract on the ticket');
  if v_result->>'status' is distinct from 'voided' then
    raise exception 'voiding a delivery load answered %', v_result->>'status';
  end if;

  select count(*) into v_count from public.grain_contract_deliveries
    where grain_load_id = '00000000-0000-4000-8000-000000000254';
  if v_count <> 0 then raise exception 'the void left % delivery rows behind', v_count; end if;

  select coalesce(sum(net_bushels),0) into v_derived from public.grain_loads
   where farm_id = '00000000-0000-4000-8000-000000000210'
     and origin_crop_assignment_id = '00000000-0000-4000-8000-000000000213'
     and effect_harvest and voided_at is null;
  if v_derived <> 0 then raise exception 'a voided load still counts % toward the harvest', v_derived; end if;

  -- The manual total on the other assignment was never in this story and must be untouched.
  select harvested_bushels into v_manual from public.crop_assignments
    where id = '00000000-0000-4000-8000-000000000214';
  if v_manual is distinct from 41000 then
    raise exception 'a load void changed a manual harvest total to %', v_manual;
  end if;
end $$;

-- ------------------------------------------------- 10. a void the bin cannot take changes nothing
do $$
declare v_result jsonb; v_count integer; v_voided timestamptz;
begin
  perform public.save_grain_load('00000000-0000-4000-8000-000000000210', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000256','load_date','2026-10-07',
    'origin_kind','field','origin_crop_assignment_id','00000000-0000-4000-8000-000000000213',
    'destination_kind','bin','destination_grain_bin_id','00000000-0000-4000-8000-000000000223',
    'net_bushels',500,'ticket_number','T-256','effect_bin_in',true));

  -- The grain this load put in has since been hauled back out.
  perform public.append_bin_movement('00000000-0000-4000-8000-000000000210', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000262','grain_bin_id','00000000-0000-4000-8000-000000000223',
    'direction','out','bushels',500,'commodity_id','corn_yellow','crop_year',2026,
    'occurred_on','2026-10-08'));

  v_result := public.void_grain_load('00000000-0000-4000-8000-000000000210',
    '00000000-0000-4000-8000-000000000256','ticket entered twice');
  if v_result->>'status' is distinct from 'blocked' then
    raise exception 'a void that cannot be reversed answered %, expected blocked', v_result->>'status';
  end if;
  if jsonb_array_length(v_result->'blocked_by') < 1 then
    raise exception 'a blocked void named no later movement';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_result->'blocked_by') e
     where e->>'id' = '00000000-0000-4000-8000-000000000262'
  ) then
    raise exception 'a blocked void did not name the movement standing in the way';
  end if;

  -- Nothing changed: not the load, not the ledger.
  select voided_at into v_voided from public.grain_loads
    where id = '00000000-0000-4000-8000-000000000256';
  if v_voided is not null then raise exception 'a blocked void still marked the load voided'; end if;
  select count(*) into v_count from public.bin_transactions
    where grain_load_id = '00000000-0000-4000-8000-000000000256' and source_kind = 'grain_load_void';
  if v_count <> 0 then raise exception 'a blocked void still wrote % compensating movements', v_count; end if;
end $$;

-- ------------------------------------------------- 11. the ledger is still a ledger
do $$
declare v_failed boolean;
begin
  v_failed := false;
  begin
    update public.bin_transactions set bushels = 1
      where id = '00000000-0000-4000-8000-000000000260';
  exception when others then
    v_failed := true;
    if position('cannot be edited' in sqlerrm) = 0 then raise; end if;
  end;
  if not v_failed then raise exception 'a bin movement was edited in place'; end if;
end $$;

-- ------------------------------------------------- 12. naming a legacy movement's crop year
-- Movements written before LD-2 carry no crop year. This is the one-time path that names them,
-- and it may only fill in what is missing, never restate what is already there, and never name a
-- year that would leave that lot short.
do $$
declare v_failed boolean; v_row jsonb; v_movement public.bin_transactions%rowtype;
begin
  perform public.append_bin_movement('00000000-0000-4000-8000-000000000210', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000263','grain_bin_id','00000000-0000-4000-8000-000000000224',
    'direction','out','bushels',1000,'commodity_id','corn_yellow','occurred_on','2026-02-01'));
  perform public.append_bin_movement('00000000-0000-4000-8000-000000000210', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000264','grain_bin_id','00000000-0000-4000-8000-000000000224',
    'direction','out','bushels',3000,'commodity_id','corn_yellow','occurred_on','2026-02-02'));

  select * into v_movement from public.bin_transactions
    where id = '00000000-0000-4000-8000-000000000263';
  if v_movement.crop_year is not null then
    raise exception 'a movement written without a crop year was given one anyway (%)', v_movement.crop_year;
  end if;

  v_row := public.assign_bin_movement_crop_year('00000000-0000-4000-8000-000000000210',
    '00000000-0000-4000-8000-000000000263', 2025);
  if (v_row->>'crop_year')::integer <> 2025 then
    raise exception 'naming the crop year did not take';
  end if;

  -- Naming it the same year again replays rather than failing.
  v_row := public.assign_bin_movement_crop_year('00000000-0000-4000-8000-000000000210',
    '00000000-0000-4000-8000-000000000263', 2025);
  if (v_row->>'crop_year')::integer <> 2025 then raise exception 'a repeated assignment did not replay'; end if;

  -- Renaming it is refused: the ledger corrects itself with movements, not by restating the past.
  v_failed := false;
  begin
    perform public.assign_bin_movement_crop_year('00000000-0000-4000-8000-000000000210',
      '00000000-0000-4000-8000-000000000263', 2024);
  exception when others then
    v_failed := true;
    if position('already names' in sqlerrm) = 0 then raise; end if;
  end;
  if not v_failed then raise exception 'a named crop year was changed'; end if;

  -- A year that the bin never held that grain in is refused rather than creating a lot from
  -- nothing: calling a 3000 bushel out the 2024 crop would leave 2024 at minus 3000.
  v_failed := false;
  begin
    perform public.assign_bin_movement_crop_year('00000000-0000-4000-8000-000000000210',
      '00000000-0000-4000-8000-000000000264', 2024);
  exception when others then
    v_failed := true;
    if position('would leave that year short' in sqlerrm) = 0 then raise; end if;
  end;
  if not v_failed then raise exception 'a legacy movement was assigned to a year the bin never held'; end if;

  -- The year the bin actually held is accepted.
  v_row := public.assign_bin_movement_crop_year('00000000-0000-4000-8000-000000000210',
    '00000000-0000-4000-8000-000000000264', 2025);
  if (v_row->>'crop_year')::integer <> 2025 then raise exception 'a valid assignment was refused'; end if;
end $$;

-- ------------------------------------------------- 13. the live definitions, pinned
-- LD-003 found that a `create or replace` in a later migration can silently supersede an earlier
-- definition and leave the earlier one as dead code that looks authoritative. These read the
-- INSTALLED bodies rather than any file, so a future migration that replaces one of these and
-- drops a rule fails here instead of going quiet.
do $$
declare v_body text;
begin
  select p.prosrc into v_body from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_grain_load';
  if v_body is null then raise exception 'save_grain_load is missing'; end if;
  if position('append_bin_movement' in v_body) = 0
     or position('record_grain_contract_delivery' in v_body) = 0 then
    raise exception 'the installed save_grain_load no longer applies its effects through the guarded paths';
  end if;

  select p.prosrc into v_body from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'append_bin_movement';
  if position('does not hold that many bushels of the' in v_body) = 0 then
    raise exception 'the installed append_bin_movement has lost its lot-level negative-balance guard';
  end if;
  if position('would make the bin balance negative' in v_body) = 0 then
    raise exception 'the installed append_bin_movement has lost its commodity-level negative-balance guard';
  end if;

  select p.prosrc into v_body from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'void_grain_load';
  if position('grain_load_void' in v_body) = 0 then
    raise exception 'the installed void_grain_load no longer writes compensating movements';
  end if;
end $$;

-- ------------------------------------------------- 14. a farm carrying loads can still be deleted
-- bin_transactions and grain_contract_deliveries now reference grain_loads. Both tables also
-- cascade from farms, so the reference is `on delete cascade` rather than `restrict`: a
-- restricting reference between two tables that both cascade from the same parent can make the
-- parent undeletable depending on the order the cascade runs in. This proves it does not.
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000200"}',false);
insert into public.farms(id,name,created_by,time_zone)
values ('00000000-0000-4000-8000-000000000290','LD2 Disposable Farm','00000000-0000-4000-8000-000000000200','America/Chicago');
select set_config('request.jwt.claims','{"role":"service_role"}',false);
insert into public.grain_bins(id,farm_id,name,capacity_bu,location_type)
values ('00000000-0000-4000-8000-000000000292','00000000-0000-4000-8000-000000000290','Disposable Bin',20000,'on_farm');
insert into public.bin_inventory(id,farm_id,grain_bin_id,crop_year,commodity_id,bushels,measured_at)
values ('00000000-0000-4000-8000-000000000293','00000000-0000-4000-8000-000000000290','00000000-0000-4000-8000-000000000292',2025,'corn_yellow',1000,'2026-01-01T00:00:00Z');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000200"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000200','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000290',1)::text)::text,false);
do $$
declare v_count integer;
begin
  perform public.save_grain_load('00000000-0000-4000-8000-000000000290', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000294','load_date','2026-10-09',
    'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000292',
    'destination_kind','buyer','destination_buyer','Disposable Elevator','net_bushels',200,
    'effect_bin_out',true));
  select count(*) into v_count from public.bin_transactions
    where grain_load_id = '00000000-0000-4000-8000-000000000294';
  if v_count <> 1 then raise exception 'the disposable farm load wrote % movements', v_count; end if;
end $$;

select set_config('request.jwt.claims','{"role":"service_role"}',false);
delete from public.farms where id = '00000000-0000-4000-8000-000000000290';
do $$
declare v_count integer;
begin
  select count(*) into v_count from public.grain_loads
    where id = '00000000-0000-4000-8000-000000000294';
  if v_count <> 0 then raise exception 'deleting the farm left its loads behind'; end if;
  select count(*) into v_count from public.bin_transactions
    where grain_load_id = '00000000-0000-4000-8000-000000000294';
  if v_count <> 0 then raise exception 'deleting the farm left load-created ledger rows behind'; end if;
end $$;

-- ------------------------------------------------- 15. naming a crop year is owner-only
-- can_edit_farm admits a worker, and a worker may record loads and movements. Restating what a
-- past movement was is a different kind of act, so it takes can_manage_farm. This runs last
-- because adding a membership moves the farm's access epochs.
insert into public.farm_memberships(farm_id,user_id,role,status,can_view_financials)
values ('00000000-0000-4000-8000-000000000210','00000000-0000-4000-8000-000000000201','worker','active',true);

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000201"}',false);
do $$
declare v_failed boolean;
begin
  if not public.can_edit_farm('00000000-0000-4000-8000-000000000210') then
    raise exception 'the LD2 worker fixture cannot edit the farm, so this proves nothing';
  end if;
  if public.can_manage_farm('00000000-0000-4000-8000-000000000210') then
    raise exception 'the LD2 worker fixture can manage the farm, so this proves nothing';
  end if;

  v_failed := false;
  begin
    perform public.assign_bin_movement_crop_year('00000000-0000-4000-8000-000000000210',
      '00000000-0000-4000-8000-000000000264', 2025);
  exception when others then
    v_failed := true;
    if position('only an owner or manager' in sqlerrm) = 0 then raise; end if;
  end;
  if not v_failed then raise exception 'a worker restated the crop year of a past movement'; end if;
end $$;

select set_config('request.jwt.claims','{"role":"service_role"}',false);
select 'LD2_LOAD_EFFECTS_DISPOSABLE_PASS' as result;
