-- Disposable-backend assertions for Initiative LD-3 (committed vs free).
-- Runs after every migration on a fresh database, after the other assertion files, so every id here
-- is distinct from theirs. Every failure raises; the last line prints LD3_COMMITTED_FREE_DISPOSABLE_PASS.
--
-- LD-3 adds no migration: it is a read-only derivation in the browser. So what is worth asserting
-- here is not that the derivation exists, but that THE DATABASE AGREES WITH IT. Two evaluators of
-- one fact is the defect shape this initiative keeps finding, and a farmer shown "free" bushels the
-- database will refuse to move has been misled by exactly that shape.
--
-- The fixture below is the same one `src/data/committedFree.regression.ts` uses in its first group:
-- one bin holding 6,000 bushels of the 2025 corn crop and 4,000 of the 2026, and one contract for
-- 3,000 bushels of the 2026 crop. The browser derives 2026 as 4,000 stored / 3,000 committed /
-- 1,000 free, and 2025 as 6,000 stored / nothing committed / 6,000 free. This file computes the
-- same figures in SQL and then proves the free figure is real by hauling it.

\set ON_ERROR_STOP on

-- ------------------------------------------------- fixtures
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000300','ld3-owner@example.test');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000300"}',false);
insert into public.farms(id,name,created_by,time_zone)
values ('00000000-0000-4000-8000-000000000310','LD3 Farm','00000000-0000-4000-8000-000000000300','America/Chicago');

select set_config('request.jwt.claims','{"role":"service_role"}',false);
insert into public.grain_bins(id,farm_id,name,capacity_bu,location_type)
values ('00000000-0000-4000-8000-000000000320','00000000-0000-4000-8000-000000000310','LD3 Bin',50000,'on_farm');
insert into public.bin_inventory(id,farm_id,grain_bin_id,crop_year,commodity_id,bushels,committed_bushels,measured_at)
-- committed_bushels is deliberately set to a WRONG number here. LD-3 must not read it: contracts
-- are written against the farm, not against a bin, and this column is the per-bin figure LD-3
-- removed from the screen.
values ('00000000-0000-4000-8000-000000000330','00000000-0000-4000-8000-000000000310','00000000-0000-4000-8000-000000000320',2025,'corn_yellow',6000,5500,'2026-01-01T00:00:00Z');
insert into public.grain_contracts(id,farm_id,crop_year,commodity_id,contract_type,buyer,bushels,cash_price) values
  ('00000000-0000-4000-8000-000000000340','00000000-0000-4000-8000-000000000310',2026,'corn_yellow','forward_cash','LD3 Buyer',3000,4.60),
  ('00000000-0000-4000-8000-000000000341','00000000-0000-4000-8000-000000000310',2026,'soybeans','forward_cash','LD3 Bean Buyer',2000,11.00);

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000300"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000300','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000310',1)::text)::text,false);

-- 4,000 bushels of the 2026 crop go into the same bin that holds the 2025 crop. One commodity, two
-- lots -- which is the situation every figure in LD-3 exists to keep straight.
do $$
begin
  perform public.append_bin_movement('00000000-0000-4000-8000-000000000310', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000350','grain_bin_id','00000000-0000-4000-8000-000000000320',
    'direction','in','bushels',4000,'commodity_id','corn_yellow','crop_year',2026,
    'occurred_on','2026-10-01'));
end $$;

-- ------------------------------------------------- 1. the lot figures, computed in SQL
-- The same arithmetic the browser runs: the baseline counts only for its own lot, and movements
-- count only for theirs.
do $$
declare
  v_on_hand_2026 numeric;
  v_on_hand_2025 numeric;
  v_committed_2026 numeric;
  v_committed_2025 numeric;
begin
  select coalesce(sum(case when direction='in' then bushels else -bushels end),0) into v_on_hand_2026
    from public.bin_transactions
   where grain_bin_id='00000000-0000-4000-8000-000000000320' and commodity_id='corn_yellow' and crop_year=2026;
  if v_on_hand_2026 <> 4000 then
    raise exception 'the 2026 lot holds % bushels, expected 4000', v_on_hand_2026;
  end if;

  select bushels into v_on_hand_2025 from public.bin_inventory
   where grain_bin_id='00000000-0000-4000-8000-000000000320' and commodity_id='corn_yellow' and crop_year=2025;
  if v_on_hand_2025 <> 6000 then
    raise exception 'the 2025 lot holds % bushels, expected 6000', v_on_hand_2025;
  end if;

  -- Committed is what is still owed on contracts for that commodity AND crop year, floored per
  -- contract so an over-delivered one never pays down another.
  select coalesce(sum(greatest(0, c.bushels - coalesce((
            select sum(d.bushels) from public.grain_contract_deliveries d
             where d.grain_contract_id = c.id), 0))), 0)
    into v_committed_2026
    from public.grain_contracts c
   where c.farm_id='00000000-0000-4000-8000-000000000310' and c.commodity_id='corn_yellow' and c.crop_year=2026;
  if v_committed_2026 <> 3000 then
    raise exception 'the 2026 lot owes % bushels, expected 3000', v_committed_2026;
  end if;

  -- The heart of Initiative LD: a 2026 contract does not reach back into the 2025 crop.
  select coalesce(sum(greatest(0, c.bushels - coalesce((
            select sum(d.bushels) from public.grain_contract_deliveries d
             where d.grain_contract_id = c.id), 0))), 0)
    into v_committed_2025
    from public.grain_contracts c
   where c.farm_id='00000000-0000-4000-8000-000000000310' and c.commodity_id='corn_yellow' and c.crop_year=2025;
  if v_committed_2025 <> 0 then
    raise exception 'carry-over grain was charged % bushels against a current-year contract', v_committed_2025;
  end if;

  -- The numbers the browser shows, stated once so a reader can check them against the regression:
  -- 2026 -> 4000 stored, 3000 committed, 1000 free. 2025 -> 6000 stored, 0 committed, 6000 free.
  if (v_on_hand_2026 - v_committed_2026) <> 1000 then
    raise exception 'the 2026 lot has % free bushels, expected 1000', v_on_hand_2026 - v_committed_2026;
  end if;
  if (v_on_hand_2025 - v_committed_2025) <> 6000 then
    raise exception 'the 2025 lot has % free bushels, expected 6000', v_on_hand_2025 - v_committed_2025;
  end if;
end $$;

-- ------------------------------------------------- 2. the per-bin column is not the answer
-- bin_inventory.committed_bushels says 5500 for this bin. If any figure LD-3 shows were read from
-- it, the farm would be told it owes nearly twice what its contracts actually say.
do $$
declare v_column numeric; v_contracts numeric;
begin
  select committed_bushels into v_column from public.bin_inventory
   where grain_bin_id='00000000-0000-4000-8000-000000000320';
  select coalesce(sum(bushels),0) into v_contracts from public.grain_contracts
   where farm_id='00000000-0000-4000-8000-000000000310' and commodity_id='corn_yellow';
  if v_column = v_contracts then
    raise exception 'the fixture no longer distinguishes the per-bin column from the contracts, so this proves nothing';
  end if;
end $$;

-- ------------------------------------------------- 3. free bushels are bushels that can be hauled
-- This is the assertion that matters. "Free" is a promise to the farmer, and the database is what
-- keeps or breaks it. Taking exactly the free 1,000 bushels of the 2026 crop must succeed; taking
-- one more than the lot holds must be refused -- even though the bin holds 10,000 bushels of corn
-- in total and a commodity-level figure would have called them all available.
do $$
declare v_failed boolean;
begin
  perform public.append_bin_movement('00000000-0000-4000-8000-000000000310', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000351','grain_bin_id','00000000-0000-4000-8000-000000000320',
    'direction','out','bushels',1000,'commodity_id','corn_yellow','crop_year',2026,
    'occurred_on','2026-11-01'));

  v_failed := false;
  begin
    perform public.append_bin_movement('00000000-0000-4000-8000-000000000310', jsonb_build_object(
      'id',gen_random_uuid(),'grain_bin_id','00000000-0000-4000-8000-000000000320',
      'direction','out','bushels',3001,'commodity_id','corn_yellow','crop_year',2026,
      'occurred_on','2026-11-02'));
  exception when sqlstate 'FR001' then
    v_failed := true;
    if position('does not hold that many bushels of the 2026 crop' in sqlerrm) = 0 then raise; end if;
  end;
  if not v_failed then
    raise exception 'the 2026 lot was drawn past what it holds, so a free figure could promise bushels that cannot move';
  end if;
end $$;

-- ------------------------------------------------- 4. a movement with no crop year joins no lot
do $$
declare v_2026 numeric; v_unknown numeric;
begin
  perform public.append_bin_movement('00000000-0000-4000-8000-000000000310', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000352','grain_bin_id','00000000-0000-4000-8000-000000000320',
    'direction','out','bushels',500,'commodity_id','corn_yellow',
    'occurred_on','2026-11-03'));

  select coalesce(sum(case when direction='in' then bushels else -bushels end),0) into v_2026
    from public.bin_transactions
   where grain_bin_id='00000000-0000-4000-8000-000000000320' and commodity_id='corn_yellow' and crop_year=2026;
  -- 4000 in, 1000 out, and the unstamped 500 is none of its business.
  if v_2026 <> 3000 then
    raise exception 'the 2026 lot reads % bushels; an unstamped movement was credited to it', v_2026;
  end if;

  select coalesce(sum(case when direction='in' then bushels else -bushels end),0) into v_unknown
    from public.bin_transactions
   where grain_bin_id='00000000-0000-4000-8000-000000000320' and crop_year is null;
  if v_unknown <> -500 then
    raise exception 'the unknown-crop-year bucket reads % bushels, expected -500', v_unknown;
  end if;
end $$;

-- ------------------------------------------------- 5. a lot owed but not stored is still owed
-- The soybean contract has no bushels behind it. A farm has to be told it owes them.
do $$
declare v_on_hand numeric; v_committed numeric;
begin
  select coalesce(sum(case when direction='in' then bushels else -bushels end),0) into v_on_hand
    from public.bin_transactions
   where farm_id='00000000-0000-4000-8000-000000000310' and commodity_id='soybeans' and crop_year=2026;
  select coalesce(sum(greatest(0, c.bushels - coalesce((
            select sum(d.bushels) from public.grain_contract_deliveries d
             where d.grain_contract_id = c.id), 0))), 0)
    into v_committed
    from public.grain_contracts c
   where c.farm_id='00000000-0000-4000-8000-000000000310' and c.commodity_id='soybeans' and c.crop_year=2026;
  if v_on_hand <> 0 or v_committed <> 2000 then
    raise exception 'the soybean lot reads % stored and % committed, expected 0 and 2000', v_on_hand, v_committed;
  end if;
  if (v_on_hand - v_committed) <> -2000 then
    raise exception 'a farm owing more than it holds must read as short, not as zero free';
  end if;
end $$;

select set_config('request.jwt.claims','{"role":"service_role"}',false);
select 'LD3_COMMITTED_FREE_DISPOSABLE_PASS' as result;
