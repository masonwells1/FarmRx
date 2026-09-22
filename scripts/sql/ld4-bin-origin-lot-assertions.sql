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

-- ------------------------------------------------- 1b. a baseline restates the BIN, not one year
-- The subtlest rule in the file, and the one this tranche got wrong first time. A baseline is a
-- measurement: the farmer walked out and checked what is in the bin. So EVERY movement of that
-- commodity dated at or before it is already inside the figure, whatever crop year it names, and
-- counting it again would invent bushels.
--
-- The first version of this assertion required the crop year to match before superseding, and said
-- so at length -- "a baseline for one crop year must not swallow another year's movements". That
-- reasoning was wrong, and wrong in the direction that matters: append_bin_movement's commodity
-- balance, the guard that actually decides whether bushels may leave a bin, has always excluded
-- every same-commodity row at or before the baseline. The narrower rule reported carry-over the
-- database would never release. A farmer would have been shown a lot they could not haul, which is
-- precisely what Initiative LD exists to prevent.
--
-- The baseline's own BUSHELS still belong to one lot, its own commodity in its own crop year. That
-- is a different question and the 2022 row below is how the two are told apart: it stays on the
-- record, at zero, because the bin has a record of that year and nothing left of it.
do $$
declare v_2023 numeric; v_2022 numeric; v_rows integer;
begin
  select bushels into v_2023 from public.bin_lots('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000423') where crop_year = 2023;
  select bushels into v_2022 from public.bin_lots('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000423') where crop_year = 2022;
  if v_2023 <> 5000 then
    raise exception 'the measured lot reads % bushels, expected 5000 -- a movement the baseline already counts was counted twice', v_2023;
  end if;
  if v_2022 <> 0 then
    raise exception 'the pre-baseline carry-over reads % bushels, expected 0 -- the baseline measured the bin and already includes it', v_2022;
  end if;

  -- It is still on the record, which is what lets a ticket-only load name it.
  select count(*) into v_rows from public.bin_lots('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000423') where crop_year = 2022;
  if v_rows <> 1 then
    raise exception 'the emptied carry-over year vanished from the record entirely';
  end if;

  -- And the figure agrees with the guard that binds: the whole bin is 5,000 bushels of corn, so
  -- 5,000 may leave and 5,001 may not. Before this repair bin_lots said 5,800.
  if (select coalesce(sum(bushels),0) from public.bin_lots('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000423')) <> 5000 then
    raise exception 'the bin lot total disagrees with the commodity balance append_bin_movement enforces';
  end if;
end $$;

-- ------------------------------------------------- 1c. and the guard agrees with the figure
-- Section 1b checks what bin_lots REPORTS. This checks that append_bin_movement REFUSES the same
-- thing, which is the half that actually protects a farmer. The two used different baseline rules
-- until LD-4 repaired it: the commodity balance excluded every same-commodity row at or before the
-- baseline while the lot balance excluded only the baseline's own year, so the same function
-- disagreed with itself and bin_lots could agree with neither.
--
-- The bin holds 5,000 bushels of corn and its 2022 lot reads zero. One bushel of 2022 must be
-- refused -- by the LOT guard, by name -- even though the bin is nowhere near empty of corn.
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.append_bin_movement('00000000-0000-4000-8000-000000000410', jsonb_build_object(
      'id',gen_random_uuid(),'grain_bin_id','00000000-0000-4000-8000-000000000423',
      'direction','out','bushels',1,'commodity_id','corn_yellow','crop_year',2022,
      'occurred_on','2026-03-01'));
  exception when sqlstate 'FR001' then
    v_failed := true;
    if position('does not hold that many bushels of the 2022 crop' in sqlerrm) = 0 then
      raise exception 'the empty carry-over lot was refused, but not by the lot guard: %', sqlerrm;
    end if;
  end;
  if not v_failed then
    raise exception 'a lot bin_lots reports as empty gave up a bushel, so the figure and the guard disagree';
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

-- ------------------------------------------------- 10e. an emptied lot can still be named
-- The written limit of this tranche, checked rather than asserted in prose: a ticket that moves no
-- bushels is a record of something that already happened, so it may name a lot the bin has emptied.
-- The browser repair that stopped trusting a truncated movement list had quietly dropped emptied
-- lots on the way to the form; this pins the server half so the two halves cannot drift apart.
do $$
declare v_load public.grain_loads%rowtype; v_failed boolean := false; v_movements integer;
begin
  -- The one-lot bin was hauled to zero in section 9b. Its 2024 lot is still on the record.
  if (select bushels from public.bin_lots('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000422') where crop_year = 2024) <> 0 then
    raise exception 'the fixture no longer has an emptied 2024 lot, so this proves nothing';
  end if;

  -- Moving nothing: accepted, and filed under the year it really was.
  perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
    'id','00000000-0000-4000-8000-00000000045b','load_date','2026-11-17',
    'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000422',
    'crop_year',2024,
    'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',500,
    'effect_bin_out',false));
  select * into v_load from public.grain_loads where id = '00000000-0000-4000-8000-00000000045b';
  if v_load.crop_year <> 2024 then
    raise exception 'a ticket-only load on an emptied lot was filed under %, expected 2024', v_load.crop_year;
  end if;
  select count(*) into v_movements from public.bin_transactions where grain_load_id = '00000000-0000-4000-8000-00000000045b';
  if v_movements <> 0 then
    raise exception 'a load with the bin-out unticked moved % bushels anyway', v_movements;
  end if;

  -- And the same lot with the bin-out ticked is still refused, by the guard that owns that
  -- question. Naming an empty lot is allowed; drawing bushels out of one is not.
  begin
    perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
      'id',gen_random_uuid(),'load_date','2026-11-18',
      'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000422',
      'crop_year',2024,
      'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',1,
      'effect_bin_out',true));
  exception when sqlstate 'FR001' then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'an emptied lot gave up a bushel because the ticket named it';
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

-- ------------------------------------------------- 10f. a lot is a commodity IN a crop year
-- This initiative's first rule, applied where it was missing. A bin that held one crop and was
-- later reused for another has a record of both, and if they share a crop year then the year alone
-- names neither. The lookup used to take whichever row held more bushels, so a ticket for the
-- emptied crop would have been stamped with the crop the bin holds now -- silently, and against
-- the one rule everything else here protects.
do $$
declare v_load public.grain_loads%rowtype; v_failed boolean := false;
begin
  -- The baseline bin is emptied of corn and refilled with soybeans of the SAME crop year. Both
  -- rows survive in bin_lots, which is what makes the year ambiguous.
  perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
    'id','00000000-0000-4000-8000-00000000045c','load_date','2026-11-19',
    'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000423',
    'crop_year',2023,'commodity_id','corn_yellow',
    'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',5000,
    'effect_bin_out',true));
  perform public.append_bin_movement('00000000-0000-4000-8000-000000000410', jsonb_build_object(
    'id','00000000-0000-4000-8000-00000000045d','grain_bin_id','00000000-0000-4000-8000-000000000423',
    'direction','in','bushels',900,'commodity_id','soybeans','crop_year',2023,
    'occurred_on','2026-11-20'));

  -- The year alone is now ambiguous, and is refused rather than resolved to the fuller lot.
  begin
    perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
      'id',gen_random_uuid(),'load_date','2026-11-21',
      'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000423',
      'crop_year',2023,
      'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',100,
      'effect_bin_out',false));
  exception when others then
    v_failed := true;
    if position('more than one crop in 2023' in sqlerrm) = 0 then
      raise exception 'an ambiguous crop year was refused, but for the wrong reason: %', sqlerrm;
    end if;
  end;
  if not v_failed then
    raise exception 'a crop year held by two commodities was resolved without anyone saying which';
  end if;

  -- Named in full, the emptied corn is still nameable by a ticket that moves nothing -- and is NOT
  -- silently turned into the soybeans the bin holds now.
  perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
    'id','00000000-0000-4000-8000-00000000045e','load_date','2026-11-21',
    'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000423',
    'crop_year',2023,'commodity_id','corn_yellow',
    'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',100,
    'effect_bin_out',false));
  select * into v_load from public.grain_loads where id = '00000000-0000-4000-8000-00000000045e';
  if v_load.commodity_id <> 'corn_yellow' then
    raise exception 'a ticket for the emptied corn was stamped %, which is the crop the bin holds now', v_load.commodity_id;
  end if;
end $$;

-- ------------------------------------------------- 10g. a bin whose only record is an emptied lot
-- Codex P2 on 2e7e6d4. The picker shows one line rather than a selector when the bin has a single
-- recorded lot, which is right -- there is nothing to choose between. But defaulting used to look
-- at what the bin still HOLDS, and an emptied lot holds nothing, so a ticket that moves no bushels
-- was refused with no control on screen to answer with. The server half is checked here: a lone
-- emptied lot named explicitly is accepted, which is what the form now relies on.
do $$
declare v_lots integer; v_load public.grain_loads%rowtype;
begin
  -- The one-lot bin: hauled to zero in 9b, then a ticket-only load in 10e. Its 2024 lot is its
  -- ONLY record, and it is empty.
  select count(*) into v_lots from public.bin_lots('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000422') where crop_year is not null;
  if v_lots <> 1 then
    raise exception 'the fixture no longer has a single recorded lot, so this proves nothing (% lots)', v_lots;
  end if;
  if (select bushels from public.bin_lots('00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000422') where crop_year = 2024) <> 0 then
    raise exception 'that lone lot is no longer empty, so this proves nothing';
  end if;

  perform public.save_grain_load('00000000-0000-4000-8000-000000000410', jsonb_build_object(
    'id','00000000-0000-4000-8000-00000000045f','load_date','2026-11-22',
    'origin_kind','bin','origin_grain_bin_id','00000000-0000-4000-8000-000000000422',
    'crop_year',2024,'commodity_id','corn_yellow',
    'destination_kind','buyer','destination_buyer','LD4 Elevator','net_bushels',250,
    'effect_bin_out',false));
  select * into v_load from public.grain_loads where id = '00000000-0000-4000-8000-00000000045f';
  if v_load.crop_year <> 2024 then
    raise exception 'a lone emptied lot could not be named: the ticket reads %', v_load.crop_year;
  end if;
end $$;

-- ------------------------------------------------- 10h. naming a crop year queues behind the bin
-- Codex P2 on 2e7e6d4. assign_bin_movement_crop_year CREATES a lot, and save_grain_load defaults a
-- load by counting them -- so with only the movement row locked, a manager could name a year in
-- the window between that count and the movement the load appends, and the load would file itself
-- under the single lot it saw while the bin had just gained a second. The farmer was never asked.
--
-- A single-session suite cannot stage that interleaving. What it can check is that the function
-- takes the same row the other two take, which is what puts all three in one queue.
do $$
declare v_body text;
begin
  select prosrc into v_body from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'assign_bin_movement_crop_year';
  if v_body is null then raise exception 'assign_bin_movement_crop_year is not installed'; end if;
  if position('from public.grain_bins' in v_body) = 0 or position('for update' in v_body) = 0 then
    raise exception 'naming a crop year does not lock the bin it changes';
  end if;
  -- And it takes them BIN FIRST, the order append_bin_movement uses. Two functions taking the same
  -- two locks in opposite orders is a deadlock cycle: PostgreSQL breaks it by aborting one, and a
  -- farmer's save fails for a reason they can neither see nor act on. The first version of this
  -- repair had them backwards, so the order is pinned rather than left to the next editor.
  if position('from public.grain_bins' in v_body) > position('public.bin_transactions' in substring(v_body from position('for update' in v_body))) + position('for update' in v_body) then
    raise exception 'naming a crop year locks the movement before the bin, which deadlocks against append_bin_movement';
  end if;
  if position('perform 1 from public.grain_bins' in v_body) > position('where id = p_transaction_id and farm_id = p_farm_id for update' in v_body) then
    raise exception 'naming a crop year locks the movement before the bin, which deadlocks against append_bin_movement';
  end if;
  -- And it uses the corrected baseline rule, like every other reader of a bin's lots. Pinned as the
  -- PREDICATE, not the variable: declaring v_baseline_covers_commodity and then not using it in the
  -- one place that decides supersession would otherwise read as compliance.
  if position('not v_baseline_covers_commodity or occurred_on' in v_body) = 0 then
    raise exception 'naming a crop year still supersedes by crop year rather than by commodity';
  end if;
end $$;

-- ------------------------------------------------- 10i. and it still does its job
do $$
declare v_result jsonb; v_failed boolean := false;
begin
  -- The never-measured bin still carries the unstamped 400 bushels from section 10.
  v_result := public.assign_bin_movement_crop_year(
    '00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000456',2026);
  if (v_result->>'crop_year')::integer <> 2026 then
    raise exception 'naming a crop year returned %, expected 2026', v_result->>'crop_year';
  end if;
  -- Naming it again with a different year is still refused, as LD-2 required.
  begin
    perform public.assign_bin_movement_crop_year(
      '00000000-0000-4000-8000-000000000410','00000000-0000-4000-8000-000000000456',2025);
  exception when others then
    v_failed := true;
    if position('already names the 2026 crop' in sqlerrm) = 0 then
      raise exception 'renaming a stamped movement was refused, but for the wrong reason: %', sqlerrm;
    end if;
  end;
  if not v_failed then
    raise exception 'a movement that already names a crop year was renamed';
  end if;
end $$;

-- ------------------------------------------------- 10j. a void still refuses a load that is not ours
-- This exists because a repair BROKE it and nothing noticed. Inserting an ordered bin lock between
-- `select ... into v_load` and its `if not found` left that check reading the FOUND of the perform
-- rather than of the select -- so every load id, including one belonging to another farm, looked
-- like it had been found. No suite covered it, which is the actual finding here: the farm fence on
-- this path had never been asserted at all.
do $$
declare v_failed boolean := false;
begin
  begin
    perform public.void_grain_load(
      '00000000-0000-4000-8000-000000000410', gen_random_uuid(), 'a load that does not exist');
  exception when others then
    v_failed := true;
    if position('does not belong to this farm' in sqlerrm) = 0 then
      raise exception 'voiding an unknown load was refused, but for the wrong reason: %', sqlerrm;
    end if;
  end;
  if not v_failed then
    raise exception 'a void accepted a load id this farm does not own';
  end if;
end $$;

-- ------------------------------------------------- 10k. one lock order, checked where it is taken
-- The module's order is bins, then grain_loads, then bin_transactions. Three review rounds found
-- three deadlocks, every one a pair of locks taken in two different orders by two functions. A
-- single-session suite cannot stage a deadlock, so what is checked is the order in the installed
-- bodies -- which is the thing that was actually wrong each time.
do $$
declare v_save text; v_void text;
begin
  select prosrc into v_save from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_grain_load';
  select prosrc into v_void from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'void_grain_load';

  if position('lock_farm_bins' in v_save) = 0 or position('lock_farm_bins' in v_void) = 0 then
    raise exception 'a multi-bin writer does not lock its bins through the one function that orders them';
  end if;
  -- Bins before the load row, in both.
  if position('lock_farm_bins' in v_save) > position('from public.grain_loads where id = v_id for update' in v_save) then
    raise exception 'save_grain_load locks the load row before its bins';
  end if;
  if position('lock_farm_bins' in v_void) > position('from public.grain_loads' in v_void) then
    raise exception 'void_grain_load locks the load row before its bins, which deadlocks against a save retry';
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

  -- LD-4 repair (Codex P1 on 35d7bdb): the bin row is locked before its lots are read, so this
  -- function's lot decision and append_bin_movement's balance check sit inside one serialised
  -- window. A single-session suite cannot stage the race this prevents -- that needs two
  -- connections -- so what is checked here is that the lock is installed at all.
  if position('from public.grain_bins where id = v_origin_bin and farm_id = p_farm_id for update' in v_body) = 0 then
    raise exception 'the installed save_grain_load reads a bin origin without locking the bin';
  end if;
  -- And the lot list is read ONCE on the defaulting path. Counting and then selecting was two
  -- statements and two snapshots: the count could say one lot while the select returned two, and a
  -- plain SELECT INTO over two rows takes whichever came first.
  if (length(v_body) - length(replace(v_body, 'from public.bin_lots(p_farm_id, v_origin_bin)', ''))) / length('from public.bin_lots(p_farm_id, v_origin_bin)') <> 2 then
    raise exception 'the installed save_grain_load no longer reads the bin lot list exactly twice (once to default, once to check a chosen lot)';
  end if;
  if position('select count(*), max(lots.commodity_id), max(lots.crop_year)' in v_body) = 0 then
    raise exception 'the installed save_grain_load counts and selects its default lot separately';
  end if;
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
