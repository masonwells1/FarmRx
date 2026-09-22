-- Disposable-backend assertions for Initiative LD-4 (a bin origin hauls any lot the bin holds).
-- Runs after every migration on a fresh database, after the other assertion files, so every id here
-- is distinct from theirs. Every failure raises; the last line prints LD4_BIN_ORIGIN_LOT_DISPOSABLE_PASS.
--
-- LD-4 pays off a deferral LD-1 recorded in words: "a bin can name only one lot today". The bin
-- origin read bin_inventory alone, so a bin's baseline crop year was the only year it could ever be
-- hauled as, and a bin with no baseline could not be hauled at all.
--
-- The fixture is LD-3's, deliberately: one bin holding 6,000 bushels of the 2025 corn crop and
-- 4,000 of the 2026. That is the bin whose Bins page now reads "1,000 bu free" for 2026, and the
-- headline assertion below is that a farmer can now actually record hauling those bushels. Before
-- LD-4 this same call was refused, with the message "this bin holds the 2025 crop, not the 2026
-- crop", while the screen said the 2026 bushels were free.

\set ON_ERROR_STOP on

-- ------------------------------------------------- fixtures
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000400','ld4-owner@example.test');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000400"}',false);
insert into public.farms(id,name,created_by,time_zone)
values ('00000000-0000-4000-8000-000000000410','LD4 Farm','00000000-0000-4000-8000-000000000400','America/Chicago');

select set_config('request.jwt.claims','{"role":"service_role"}',false);
insert into public.grain_bins(id,farm_id,name,capacity_bu,location_type) values
  ('00000000-0000-4000-8000-000000000420','00000000-0000-4000-8000-000000000410','LD4 Two Lot Bin',50000,'on_farm'),
  ('00000000-0000-4000-8000-000000000421','00000000-0000-4000-8000-000000000410','LD4 No Baseline Bin',50000,'on_farm'),
  ('00000000-0000-4000-8000-000000000422','00000000-0000-4000-8000-000000000410','LD4 One Lot Bin',50000,'on_farm'),
  ('00000000-0000-4000-8000-000000000423','00000000-0000-4000-8000-000000000410','LD4 Baseline Bin',50000,'on_farm');
-- Only two of the three bins are ever measured. The unmeasured one is the bin LD-2's own bin-in
-- effect creates, and the bin LD-1 could not haul out of.
insert into public.bin_inventory(id,farm_id,grain_bin_id,crop_year,commodity_id,bushels,committed_bushels,measured_at) values
  ('00000000-0000-4000-8000-000000000430','00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000420',2025,'corn_yellow',6000,0,'2026-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000431','00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000422',2024,'corn_yellow',3000,0,'2026-01-01T00:00:00Z'),
  ('00000000-0000-4000-8000-000000000432','00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000423',2023,'corn_yellow',5000,0,'2026-02-01T00:00:00Z');

-- Two movements dated BEFORE that baseline, written directly because append_bin_movement rightly
-- refuses to record one. Rows like these exist on any farm that measured a bin after recording
-- movements into it, and they are the reason the superseded rule exists at all.
insert into public.bin_transactions(id,farm_id,grain_bin_id,direction,bushels,commodity_id,crop_year,occurred_on) values
  ('00000000-0000-4000-8000-000000000442','00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000423','in',1000,'corn_yellow',2023,'2025-12-01'),
  ('00000000-0000-4000-8000-000000000443','00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000423','in',800,'corn_yellow',2022,'2025-11-01');

select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000400"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000400','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000410',1)::text)::text,false);

do $$
begin
  -- 4,000 bushels of the 2026 crop join the 2025 carry-over in the same bin.
  perform public.append_bin_movement('00000000-0000-4000-8000-000000000410', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000440','grain_bin_id','00000000-0000-4000-8000-000000000420',
    'direction','in','bushels',4000,'commodity_id','corn_yellow','crop_year',2026,
    'occurred_on','2026-10-01'));
  -- The never-measured bin is filled the way a load's bin-in effect fills one.
  perform public.append_bin_movement('00000000-0000-4000-8000-000000000410', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000441','grain_bin_id','00000000-0000-4000-8000-000000000421',
    'direction','in','bushels',2000,'commodity_id','corn_yellow','crop_year',2026,
    'occurred_on','2026-10-02'));
end $$;

-- ------------------------------------------------- 1. bin_lots is the server's list of lots
do $$
declare v_rows integer; v_2025 numeric; v_2026 numeric;
begin
  select count(*) into v_rows from public.bin_lots('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000420');
  if v_rows <> 2 then
    raise exception 'the two-lot bin lists % lots, expected 2', v_rows;
  end if;

  select bushels into v_2025 from public.bin_lots('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000420') where crop_year = 2025;
  select bushels into v_2026 from public.bin_lots('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000420') where crop_year = 2026;
  -- The same two figures the browser's deriveBinLotOnHand produces for this fixture, and the same
  -- two LD-3's regression asserts. Three evaluators would be two too many; these are the two that
  -- cannot be avoided, so they are checked against each other here.
  if v_2025 <> 6000 then raise exception 'the 2025 lot reads % bushels, expected 6000', v_2025; end if;
  if v_2026 <> 4000 then raise exception 'the 2026 lot reads % bushels, expected 4000', v_2026; end if;
end $$;

-- ------------------------------------------------- 1b. a baseline restates its own lot, and only its own
-- The subtlest rule in the file, and the one a careless rewrite of bin_lots would lose silently.
-- A baseline is a measurement: it already includes everything that went into that lot before it was
-- taken, so counting those movements again would inflate the lot. But it measures ONE lot. A
-- movement of a different crop year, dated before the baseline, is not restated by it and still
-- counts -- otherwise measuring this year's crop would quietly erase last year's carry-over.
--
-- append_bin_movement and the browser's deriveBinLotOnHand both hold this rule. bin_lots is the
-- third place it has to be right, and it is checked here against figures written by hand.
do $$
declare v_2023 numeric; v_2022 numeric;
begin
  select bushels into v_2023 from public.bin_lots('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000423') where crop_year = 2023;
  select bushels into v_2022 from public.bin_lots('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000423') where crop_year = 2022;
  if v_2023 <> 5000 then
    raise exception 'the measured lot reads % bushels, expected 5000 -- a movement the baseline already counts was counted twice', v_2023;
  end if;
  if v_2022 <> 800 then
    raise exception 'the other lot reads % bushels, expected 800 -- a baseline for one crop year swallowed another', v_2022;
  end if;
end $$;

-- ------------------------------------------------- 2. the headline: the newer lot can be hauled
-- This exact call was refused before LD-4, on a bin whose screen said those bushels were free.
do $$
declare v_movement public.bin_transactions%rowtype; v_load public.grain_loads%rowtype;
begin
  perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000450','load_date','2026-11-01',
    'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000420',
    'crop_year',2026,
    'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',1000,
    'effect_bin_out',true));

  select * into v_load from public.grain_loads where id = '00000000-0000-4000-8000-000000000450';
  if v_load.crop_year <> 2026 then
    raise exception 'the load was stamped the % crop, expected 2026', v_load.crop_year;
  end if;
  if v_load.commodity_id <> 'corn_yellow' then
    raise exception 'the load was stamped %, expected corn_yellow', v_load.commodity_id;
  end if;

  select * into v_movement from public.bin_transactions where grain_load_id = '00000000-0000-4000-8000-000000000450';
  if not found then raise exception 'the confirmed bin-out wrote no movement'; end if;
  if v_movement.crop_year is distinct from 2026 then
    raise exception 'the movement left the bin stamped %, expected 2026', v_movement.crop_year;
  end if;
end $$;

-- ------------------------------------------------- 3. the carry-over lot is still reachable too
-- Both lots, out of one bin, on the farmer's say-so. Neither is the bin's "real" crop year now.
do $$
declare v_movement public.bin_transactions%rowtype;
begin
  perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000451','load_date','2026-11-02',
    'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000420',
    'crop_year',2025,
    'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',500,
    'effect_bin_out',true));
  select * into v_movement from public.bin_transactions where grain_load_id = '00000000-0000-4000-8000-000000000451';
  if v_movement.crop_year is distinct from 2025 then
    raise exception 'the carry-over haul left the bin stamped %, expected 2025', v_movement.crop_year;
  end if;
end $$;

-- ------------------------------------------------- 4. a two-lot bin refuses to guess
-- The amendment says defaulting happens "only when the bin holds a single lot". This is the other
-- half of that sentence, and it is the guess LD-1 made silently.
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
      'id',gen_random_uuid(),'load_date','2026-11-03',
      'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000420',
      'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',100,
      'effect_bin_out',true));
  exception when others then
    v_failed := true;
    if position('more than one crop year' in sqlerrm) = 0 then
      raise exception 'a two-lot bin was refused, but for the wrong reason: %', sqlerrm;
    end if;
  end;
  if not v_failed then
    raise exception 'a load out of a two-lot bin was accepted without anyone saying which lot it was';
  end if;
end $$;

-- ------------------------------------------------- 5. a one-lot bin still needs no tap
-- The common case: a farmer hauling all afternoon out of a bin holding one crop answers nothing.
do $$
declare v_load public.grain_loads%rowtype;
begin
  perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000452','load_date','2026-11-04',
    'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000422',
    'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',300,
    'effect_bin_out',true));
  select * into v_load from public.grain_loads where id = '00000000-0000-4000-8000-000000000452';
  if v_load.crop_year <> 2024 then
    raise exception 'a one-lot bin defaulted to the % crop, expected 2024', v_load.crop_year;
  end if;
end $$;

-- ------------------------------------------------- 6. a bin that was never measured is an origin
-- LD-2's bin-in effect fills bins that have no baseline. Before LD-4 this call failed with "a load
-- needs the crop it is carrying", so LD-2 created bins its own load form would not haul out of.
do $$
declare v_load public.grain_loads%rowtype;
begin
  perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000453','load_date','2026-11-05',
    'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000421',
    'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',700,
    'effect_bin_out',true));
  select * into v_load from public.grain_loads where id = '00000000-0000-4000-8000-000000000453';
  if v_load.crop_year <> 2026 or v_load.commodity_id <> 'corn_yellow' then
    raise exception 'a never-measured bin produced the % % lot, expected 2026 corn_yellow', v_load.crop_year, v_load.commodity_id;
  end if;
end $$;

-- ------------------------------------------------- 7. a crop year the bin never held is refused
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
      'id',gen_random_uuid(),'load_date','2026-11-06',
      'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000420',
      'crop_year',2019,
      'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',100,
      'effect_bin_out',true));
  exception when others then
    v_failed := true;
    if position('no record of the 2019 crop' in sqlerrm) = 0 then
      raise exception 'an invented crop year was refused, but for the wrong reason: %', sqlerrm;
    end if;
  end;
  if not v_failed then
    raise exception 'a load claimed a crop year the bin has never held';
  end if;
end $$;

-- ------------------------------------------------- 8. the balance rule still belongs to one place
-- save_grain_load checks that the lot is real; append_bin_movement checks that the bushels are
-- there, under a row lock, stamped FR001. If save_grain_load answered the balance question too,
-- the two answers could differ. So the refusal below has to arrive in append_bin_movement's own
-- words, and the whole save has to come to nothing.
do $$
declare v_failed boolean := false; v_loads integer;
begin
  begin
    perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
      'id','00000000-0000-4000-8000-000000000454','load_date','2026-11-07',
      'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000420',
      'crop_year',2026,
      'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',3001,
      'effect_bin_out',true));
  exception when sqlstate 'FR001' then
    v_failed := true;
    if position('does not hold that many bushels of the 2026 crop' in sqlerrm) = 0 then
      raise exception 'the over-haul was refused, but not by the lot guard: %', sqlerrm;
    end if;
  end;
  if not v_failed then
    raise exception 'the 2026 lot was drawn past what it holds through a load';
  end if;

  select count(*) into v_loads from public.grain_loads where id = '00000000-0000-4000-8000-000000000454';
  if v_loads <> 0 then
    raise exception 'a refused load left its ticket behind, so the save was not all-or-nothing';
  end if;
end $$;

-- ------------------------------------------------- 9. an emptied lot is remembered, not offered
-- "The bin has no record of that crop year" and "the bin is out of that crop year" are different
-- answers. bin_lots keeps an emptied lot at zero so the farmer gets the second one.
--
-- This runs on the two-lot bin on purpose. Emptying a bin completely would be refused by the
-- COMMODITY balance guard, which fires first and says "this movement would make the bin balance
-- negative" -- true, but not the thing being tested. Here the 2026 lot is emptied while 5,500
-- bushels of 2025 corn remain, so the bin is far from empty and only the LOT guard can refuse the
-- next bushel. That is the whole of Initiative LD in one assertion: a bin full of corn that will
-- not let out one more bushel of a particular year.
do $$
declare v_bushels numeric; v_commodity numeric; v_failed boolean := false;
begin
  -- 4,000 in, 1,000 hauled in section 2, so 3,000 empties the 2026 lot exactly.
  perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000455','load_date','2026-11-08',
    'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000420',
    'crop_year',2026,
    'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',3000,
    'effect_bin_out',true));

  select bushels into v_bushels from public.bin_lots('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000420') where crop_year = 2026;
  if v_bushels is null then
    raise exception 'the emptied lot dropped off the list, so the farmer would be told that year never existed';
  end if;
  if v_bushels <> 0 then
    raise exception 'the emptied lot reads % bushels, expected 0', v_bushels;
  end if;

  select sum(bushels) into v_commodity from public.bin_lots('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000420');
  if v_commodity <> 5500 then
    raise exception 'the bin holds % bushels of corn, expected 5500 -- the fixture no longer proves the lot guard fired rather than the commodity one', v_commodity;
  end if;

  begin
    perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
      'id',gen_random_uuid(),'load_date','2026-11-09',
      'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000420',
      'crop_year',2026,
      'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',1,
      'effect_bin_out',true));
  exception when sqlstate 'FR001' then
    v_failed := true;
    if position('does not hold that many bushels of the 2026 crop' in sqlerrm) = 0 then
      raise exception 'hauling an emptied lot was refused, but not by the lot guard: %', sqlerrm;
    end if;
  end;
  if not v_failed then
    raise exception 'an emptied lot let another bushel out of a bin still holding 5,500 bushels of corn';
  end if;
end $$;

-- ------------------------------------------------- 9b. a bin with nothing stamped in it
-- The one-lot bin, hauled to zero. With no lot left holding anything there is nothing to default
-- to, and the farmer is told that rather than handed an emptied year.
do $$
declare v_failed boolean := false;
begin
  perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000458','load_date','2026-11-08',
    'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000422',
    'crop_year',2024,
    'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',2700,
    'effect_bin_out',true));

  begin
    perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
      'id',gen_random_uuid(),'load_date','2026-11-10',
      'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000422',
      'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',1,
      'effect_bin_out',true));
  exception when others then
    v_failed := true;
    if position('no crop with a crop year' in sqlerrm) = 0 then
      raise exception 'an empty bin was refused as an origin, but for the wrong reason: %', sqlerrm;
    end if;
  end;
  if not v_failed then
    raise exception 'an empty bin was accepted as an origin with no lot named';
  end if;
end $$;

-- ------------------------------------------------- 10. unstamped bushels are in no lot
-- LD-3 names them on screen and counts them in no year. bin_lots returns them as a null crop year
-- row, and the origin branch skips that row, so they can neither be picked nor be defaulted to.
do $$
declare v_null_rows integer; v_lots integer;
begin
  perform public.append_bin_movement('00000000-0000-4000-8000-000000000410', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000456','grain_bin_id','00000000-0000-4000-8000-000000000421',
    'direction','in','bushels',400,'commodity_id','corn_yellow',
    'occurred_on','2026-11-11'));

  select count(*) into v_null_rows from public.bin_lots('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000421') where crop_year is null;
  if v_null_rows <> 1 then
    raise exception 'the unstamped bucket shows as % rows, expected 1', v_null_rows;
  end if;

  -- The bin now holds a 2026 lot and an unstamped pile. If the unstamped pile counted as a lot the
  -- save below would be refused as ambiguous; it must still default to the one real lot.
  select count(*) into v_lots from public.bin_lots('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000421')
   where crop_year is not null and bushels > 0.000001;
  if v_lots <> 1 then
    raise exception 'the never-measured bin holds % stamped lots, expected 1', v_lots;
  end if;

  perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000457','load_date','2026-11-12',
    'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000421',
    'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',100,
    'effect_bin_out',true));
  if (select crop_year from public.grain_loads where id = '00000000-0000-4000-8000-000000000457') <> 2026 then
    raise exception 'an unstamped pile changed which lot a one-lot bin defaults to';
  end if;
end $$;

-- ------------------------------------------------- 10b. a retry still returns the same ticket
-- LD-1's guarantee: a retry after a lost response is the SAME ticket, not a second one, and not a
-- failure. LD-4 broke it for exactly one case and this pins the repair. A one-lot bin hauled to
-- exactly zero has no lot left holding anything, so the retry used to be refused at "that bin
-- holds no crop with a crop year" -- seventy lines before the replay check it needed to reach.
-- The farmer would be told the load failed when it was already recorded.
do $$
declare v_first public.grain_loads%rowtype; v_again jsonb; v_movements integer;
begin
  -- The never-measured bin holds 2026 corn: 2,000 in, 700 hauled in section 6 and 100 in section
  -- 10, so 1,200 empties the lot exactly. Its unstamped 400 bushels stay where they are: they are
  -- in no lot, so they cannot keep a crop year alive.
  perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000459','load_date','2026-11-14',
    'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000421',
    'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',1200,
    'effect_bin_out',true));
  select * into v_first from public.grain_loads where id = '00000000-0000-4000-8000-000000000459';
  if v_first.crop_year <> 2026 then
    raise exception 'the first attempt stamped the % crop, expected 2026', v_first.crop_year;
  end if;
  if (select coalesce(sum(bushels),0) from public.bin_lots('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000421') where crop_year is not null and bushels > 0.000001) <> 0 then
    raise exception 'the fixture no longer empties the lot, so this proves nothing about the retry';
  end if;

  -- The response was lost. The same ticket id, the same details, and deliberately no crop year --
  -- which is what the form sends for a bin it saw as holding a single lot.
  v_again := public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
    'id','00000000-0000-4000-8000-000000000459','load_date','2026-11-14',
    'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000421',
    'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',1200,
    'effect_bin_out',true));
  if (v_again->>'id') <> '00000000-0000-4000-8000-000000000459' then
    raise exception 'the retry returned a different ticket';
  end if;
  if (v_again->>'crop_year')::integer <> 2026 then
    raise exception 'the retry returned the % crop, expected the stored 2026', (v_again->>'crop_year')::integer;
  end if;

  -- And it moved nothing a second time.
  select count(*) into v_movements from public.bin_transactions
   where grain_load_id = '00000000-0000-4000-8000-000000000459';
  if v_movements <> 1 then
    raise exception 'the retry left % movements behind, expected 1', v_movements;
  end if;
end $$;

-- ------------------------------------------------- 10c. a reused id is still refused
-- The replay adoption above must not become a way to overwrite a ticket. Same id, different load.
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
      'id','00000000-0000-4000-8000-000000000459','load_date','2026-11-15',
      'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000421',
      'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',42,
      'effect_bin_out',false));
  exception when others then
    v_failed := true;
    if position('FARM_RX_LOAD_ID_REUSED' in sqlerrm) = 0 then
      raise exception 'a reused id was refused, but for the wrong reason: %', sqlerrm;
    end if;
  end;
  if not v_failed then
    raise exception 'a different load reused a saved ticket id and was accepted';
  end if;
end $$;

-- ------------------------------------------------- 10d. a retry naming a DIFFERENT lot is refused
-- The sharp edge of the replay adoption above. It fills in the stored lot only when the caller
-- named none; a caller who names a different one is asking for a different load and must be told
-- the id is taken. Adopting the stored year unconditionally would look identical on every other
-- test -- the rest of the ticket matches -- and would quietly return the wrong load. Both lots
-- below are real lots of this bin, so the refusal can only come from the replay comparison.
do $$
declare v_failed boolean := false;
begin
  perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
    'id','00000000-0000-4000-8000-00000000045a','load_date','2026-11-16',
    'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000420',
    'crop_year',2025,
    'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',100,
    'effect_bin_out',true));

  begin
    perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
      'id','00000000-0000-4000-8000-00000000045a','load_date','2026-11-16',
      'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000420',
      'crop_year',2026,
      'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',100,
      'effect_bin_out',true));
  exception when others then
    v_failed := true;
    if position('FARM_RX_LOAD_ID_REUSED' in sqlerrm) = 0 then
      raise exception 'a retry naming another lot was refused, but for the wrong reason: %', sqlerrm;
    end if;
  end;
  if not v_failed then
    raise exception 'a retry naming a different crop year was answered with the stored ticket';
  end if;
end $$;

-- ------------------------------------------------- 11. a field origin is untouched
-- LD-4 changed one branch. The field branch still takes its lot from the crop assignment and still
-- refuses a load that disagrees with it.
do $$
declare v_failed boolean := false;
begin
  insert into public.entities(id,farm_id,name,entity_type) values
    ('00000000-0000-4000-8000-000000000462','00000000-0000-4000-8000-000000000410','LD4 Entity','sole_proprietorship');
  insert into public.fields(id,farm_id,operating_entity_id,name,total_acres) values
    ('00000000-0000-4000-8000-000000000460','00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000462','LD4 Field',100);
  insert into public.crop_assignments(id,farm_id,field_id,crop_year,commodity_id,planting_sequence,planted_acres) values
    ('00000000-0000-4000-8000-000000000461','00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000460',2026,'corn_yellow',1,100);

  begin
    perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
      'id',gen_random_uuid(),'load_date','2026-11-13',
      'origin_kind','field','origin_crop_assignment_id','00000000-0000-4000-8000-000000000461',
      'crop_year',2025,
      'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',100,
      'effect_harvest',true));
  exception when others then
    v_failed := true;
    if position('but the field crop is' in sqlerrm) = 0 then
      raise exception 'a field load disagreeing with its crop was refused, but for the wrong reason: %', sqlerrm;
    end if;
  end;
  if not v_failed then
    raise exception 'a field origin accepted a crop year its crop assignment does not carry';
  end if;
end $$;

-- ------------------------------------------------- 12. the installed bodies, pinned
-- A later migration's `create or replace` silently supersedes an earlier definition -- LD-003 found
-- exactly that. These read what is actually installed rather than what any file says.
do $$
declare v_body text; v_code text; v_secdef boolean;
begin
  select prosrc, prosecdef into v_body, v_secdef from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'bin_lots';
  if v_body is null then raise exception 'bin_lots is not installed'; end if;
  -- Decision 4 in the migration header: it reads RLS-protected tables as the caller and needs no
  -- rights of its own, which is why the SECURITY DEFINER allowlist did not move.
  if v_secdef then raise exception 'bin_lots is installed SECURITY DEFINER'; end if;

  select prosrc into v_body from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_grain_load';
  if position('public.bin_lots(p_farm_id, v_origin_bin)' in v_body) = 0 then
    raise exception 'the installed save_grain_load does not read the bin lot list';
  end if;

  -- The comments are stripped first, and that is not tidiness. The comment explaining why this
  -- branch no longer reads the baseline has to name the table it no longer reads, so a guard run
  -- against the raw body would be satisfied by its own explanation. LD-3 shipped this same fix for
  -- the same reason; LD-1 shipped the bug it fixes.
  v_code := regexp_replace(v_body, '--[^' || chr(10) || ']*', '', 'g');
  if position('bin_inventory' in v_code) > 0 then
    raise exception 'the installed save_grain_load still reads the bin baseline directly';
  end if;
  -- Decision 2: the balance question is asked in one place, and this is not it.
  if position('FR001' in v_code) > 0 then
    raise exception 'the installed save_grain_load answers the balance question itself';
  end if;
  -- And the strip has to be doing something, or the two checks above prove nothing.
  if position('bin_inventory' in v_body) = 0 then
    raise exception 'the comment naming the old baseline read is gone, so the comment strip above is untested';
  end if;
end $$;

select set_config('request.jwt.claims','{"role":"service_role"}',false);
select 'LD4_BIN_ORIGIN_LOT_DISPOSABLE_PASS' as result;
