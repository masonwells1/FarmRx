-- LD-4: a bin origin hauls any lot the bin actually holds
--
-- The 2026-09-05 owner amendment asked this of LD-1, word for word:
--
--   "a bin origin requires the farmer to pick which crop year (lot) is being moved from the list
--    of crop years present in that bin, defaulting only when the bin holds a single lot."
--
-- LD-1 could not do it and said so: bin_transactions carried no crop year, so there was no list to
-- offer. save_grain_load read bin_inventory alone, which holds one baseline row per bin, and that
-- baseline's crop year became the load's crop year with no way to say otherwise. Two things
-- followed, and both are real defects rather than missing polish:
--
--   * A bin with no baseline could not be an origin at all. LD-2's own bin-in effect fills bins
--     that have never been measured, so LD-2 created bins its own load form would not haul out of.
--   * A bin holding carry-over under a newer crop could only be hauled as the older year. LD-3
--     then put that on the screen: the Bins page now tells a farmer they have, say, 1,000 free
--     bushels of the 2026 crop, and this function would refuse to record them hauling it.
--
-- LD-2 added bin_transactions.crop_year, so the list exists now. This migration is the deferral
-- being paid off.
--
-- Four decisions worth stating, because each rules out a cheaper thing that would have been wrong:
--
-- 1. THE LOT LIST IS ONE FUNCTION, NOT AN EXPRESSION REPEATED WHEREVER IT IS NEEDED.
--    public.bin_lots is the only server answer to "what is in this bin, by crop year". The browser
--    has its own answer in deriveBinLotOnHand, which is unavoidable -- an offline truck cab cannot
--    ask the database -- so there are exactly two evaluators of this fact and the disposable suite
--    proves they agree. Adding a third, inline, is how they would quietly stop agreeing.
--
-- 2. THIS FUNCTION DOES NOT RE-ASK WHETHER THE BUSHELS CAN MOVE.
--    append_bin_movement already refuses to draw a lot below zero, under a row lock, stamped
--    FR001. save_grain_load checks only that the chosen lot is one the bin has a record of. If it
--    checked the balance too, the two checks would race and could disagree, and the farmer would
--    be told different things by the same save.
--
-- 3. A MOVEMENT WITH NO CROP YEAR IS STILL IN NO LOT.
--    bin_lots returns the unstamped bucket as a row with a null crop year, and the origin branch
--    skips it. Those bushels are real and the bin balance counts them; what they are not is a
--    crop year anyone may pick, because picking one would be the silent guess the amendment
--    forbids. LD-3 names them on screen for the same reason.
--
-- 4. bin_lots IS SECURITY INVOKER.
--    It reads two tables that already carry RLS, so the caller's own policies apply and it needs
--    no elevated rights of its own. save_grain_load is SECURITY DEFINER and scopes every call by
--    the farm id it has already checked can_edit_farm against, so calling an invoker function from
--    inside it is safe. The SECURITY DEFINER allowlist is therefore unchanged at 61.

-- ---------------------------------------------------------------------------
-- 1. bin_lots: what a bin holds, by crop year
-- ---------------------------------------------------------------------------
--
-- One row per lot the bin has any record of -- the baseline's own lot, and every lot named by a
-- movement -- carrying that lot's current balance. A lot that has been emptied still appears, with
-- zero bushels, because "the bin has no record of that crop year" and "the bin is out of that crop
-- year" are different answers and the farmer deserves the right one.
--
-- The superseded rule matches append_bin_movement and deriveBinLotOnHand exactly, and the rule is
-- a COMMODITY one: a baseline measures the bin, not one year of it, so every movement of that
-- commodity dated at or before it is already inside the figure and must not be counted twice --
-- whatever crop year the movement names. The baseline's own BUSHELS still belong to one lot, its
-- own commodity and year; those are different questions and LD-2 had conflated them.
--
-- The narrower rule looked more careful and was wrong. It reported carry-over bushels that the
-- commodity balance in append_bin_movement would never release, so a farmer could be shown a lot
-- they could not haul. Where a measurement and a movement disagree, the measurement is what the
-- farmer actually walked out and checked.
create or replace function public.bin_lots(p_farm_id uuid, p_grain_bin_id uuid)
returns table (commodity_id text, crop_year integer, bushels numeric)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with inv as (
    select i.commodity_id, i.crop_year, i.bushels, i.measured_at::date as measured_on
      from public.bin_inventory i
     where i.grain_bin_id = p_grain_bin_id and i.farm_id = p_farm_id
  ),
  lots as (
    select t.commodity_id, t.crop_year
      from public.bin_transactions t
     where t.grain_bin_id = p_grain_bin_id and t.farm_id = p_farm_id
    union
    select inv.commodity_id, inv.crop_year from inv
  )
  select lots.commodity_id,
         lots.crop_year,
         coalesce((select inv.bushels from inv
                    where inv.commodity_id = lots.commodity_id
                      and inv.crop_year is not distinct from lots.crop_year), 0)
       + coalesce((select sum(case when t.direction = 'in' then t.bushels else -t.bushels end)
                     from public.bin_transactions t
                    where t.grain_bin_id = p_grain_bin_id
                      and t.farm_id = p_farm_id
                      and t.commodity_id = lots.commodity_id
                      and t.crop_year is not distinct from lots.crop_year
                      and t.occurred_on > coalesce((select inv.measured_on from inv
                                                     where inv.commodity_id = lots.commodity_id),
                                                   '-infinity'::date)), 0) as bushels
    from lots;
$$;

revoke all on function public.bin_lots(uuid, uuid) from public, anon;
grant execute on function public.bin_lots(uuid, uuid) to authenticated;

comment on function public.bin_lots(uuid, uuid) is
  'LD-4: the lots a bin has a record of, by crop year, with each lot''s current balance. The null '
  'crop year row is the unstamped bucket and is in no lot. Balances are not a permission to move '
  'bushels -- append_bin_movement decides that under a row lock.';

-- ---------------------------------------------------------------------------
-- 1b. lock_farm_bins: one lock order for the whole module
-- ---------------------------------------------------------------------------
--
-- LD-4 repair (Codex P2 on bba6b10). Three rounds of this tranche's review found deadlocks, each
-- a different pair of locks taken in a different order, and each was patched where it was found.
-- The third one made the shape obvious: the module had no stated lock order at all, so every new
-- function invented one.
--
-- It has one now, and this is it. A transaction that will touch more than one bin locks ALL of
-- them here first, in ascending id order, before it decides anything. Two transfers running in
-- opposite directions -- A to B and B to A -- then queue instead of deadlocking, because both ask
-- for the lower id first. After the bins, the order is grain_loads, then bin_transactions, then
-- grain_contracts, then grain_contract_deliveries; every function below follows it.
--
-- No grant. Only the SECURITY DEFINER functions that already checked their caller's permission
-- reach this, and they run as the owner.
create or replace function public.lock_farm_bins(p_farm_id uuid, p_bin_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_bin_id uuid;
begin
  for v_bin_id in
    select distinct id from public.grain_bins
     where farm_id = p_farm_id and id = any(p_bin_ids)
     order by id
  loop
    perform 1 from public.grain_bins where id = v_bin_id for update;
  end loop;
end $$;

revoke all on function public.lock_farm_bins(uuid, uuid[]) from public, anon, authenticated;

comment on function public.lock_farm_bins(uuid, uuid[]) is
  'LD-4: locks every named bin of one farm in ascending id order. Any transaction touching more '
  'than one bin calls this before it decides anything, so two transfers in opposite directions '
  'queue rather than deadlock.';

-- ---------------------------------------------------------------------------
-- 2. save_grain_load, now letting the farmer name the lot
-- ---------------------------------------------------------------------------
--
-- Replaces LD-2's definition. Everything outside the bin-origin branch is unchanged, including
-- every effect, the replay check and the field-origin branch, which still takes its lot from the
-- crop assignment and still refuses a load that disagrees with it.
create or replace function public.save_grain_load(p_farm_id uuid, p_load jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_existing public.grain_loads%rowtype;
  v_saved public.grain_loads%rowtype;
  v_crop public.crop_assignments%rowtype;
  v_bin public.grain_bins%rowtype;
  v_contract public.grain_contracts%rowtype;
  v_origin_kind text;
  v_destination_kind text;
  v_origin_bin uuid;
  v_origin_crop uuid;
  v_destination_bin uuid;
  v_destination_contract uuid;
  v_destination_buyer text;
  v_truck_equipment uuid;
  v_truck_name text;
  v_commodity text;
  v_crop_year integer;
  v_lot_commodity text;
  v_on_hand_lots integer;
  v_replay_year integer;
  v_crop_year_default integer;
  v_lot_matches integer;
  v_replay_commodity text;
  v_load_date date;
  v_gross numeric;
  v_tare numeric;
  v_net numeric;
  v_moisture numeric;
  v_ticket text;
  v_photo text;
  v_notes text;
  v_effect_bin_out boolean;
  v_effect_bin_in boolean;
  v_effect_delivery boolean;
  v_effect_harvest boolean;
  v_allow_over boolean;
  v_movement_note text;
begin
  if auth.uid() is null
     or public.request_uses_service_role()
     or not public.can_edit_farm(p_farm_id)
     or not public.can_read_private_financials(p_farm_id) then
    raise exception 'you do not have permission to record a load for this farm';
  end if;

  v_id := (p_load->>'id')::uuid;
  v_load_date := (p_load->>'load_date')::date;
  v_origin_kind := nullif(btrim(p_load->>'origin_kind'), '');
  v_destination_kind := nullif(btrim(p_load->>'destination_kind'), '');
  v_origin_bin := (p_load->>'origin_grain_bin_id')::uuid;
  v_origin_crop := (p_load->>'origin_crop_assignment_id')::uuid;
  v_destination_bin := (p_load->>'destination_grain_bin_id')::uuid;
  v_destination_contract := (p_load->>'destination_grain_contract_id')::uuid;
  v_destination_buyer := nullif(btrim(p_load->>'destination_buyer'), '');
  v_truck_equipment := (p_load->>'truck_equipment_id')::uuid;
  v_truck_name := nullif(btrim(p_load->>'truck_name'), '');
  v_commodity := nullif(btrim(p_load->>'commodity_id'), '');
  v_crop_year := (p_load->>'crop_year')::integer;
  v_gross := (p_load->>'gross_lbs')::numeric;
  v_tare := (p_load->>'tare_lbs')::numeric;
  v_net := (p_load->>'net_bushels')::numeric;
  v_moisture := (p_load->>'moisture_pct')::numeric;
  v_ticket := nullif(btrim(p_load->>'ticket_number'), '');
  v_photo := nullif(btrim(p_load->>'photo_path'), '');
  v_notes := nullif(btrim(p_load->>'notes'), '');
  v_effect_bin_out := coalesce((p_load->>'effect_bin_out')::boolean, false);
  v_effect_bin_in := coalesce((p_load->>'effect_bin_in')::boolean, false);
  v_effect_delivery := coalesce((p_load->>'effect_contract_delivery')::boolean, false);
  v_effect_harvest := coalesce((p_load->>'effect_harvest')::boolean, false);
  v_allow_over := coalesce((p_load->>'allow_overdelivery')::boolean, false);

  if v_id is null then raise exception 'a load must carry its own id'; end if;
  if v_load_date is null then raise exception 'a load needs the date it was hauled'; end if;
  if v_net is null or v_net <= 0 then raise exception 'net bushels must be greater than zero'; end if;
  if v_origin_kind is null or v_origin_kind not in ('bin', 'field') then
    raise exception 'a load must say whether the grain came from a bin or a field';
  end if;
  if v_destination_kind is null or v_destination_kind not in ('buyer', 'contract', 'bin') then
    raise exception 'a load must say where the grain went';
  end if;
  if v_truck_equipment is not null and v_truck_name is not null then
    raise exception 'name the truck or pick one from equipment, not both';
  end if;

  -- The origin decides the commodity and the crop year. Nothing else may.
  if v_origin_kind = 'field' then
    if v_origin_crop is null then raise exception 'pick the field crop this load came from'; end if;
    select * into v_crop from public.crop_assignments
      where id = v_origin_crop and farm_id = p_farm_id;
    if not found then raise exception 'that field crop does not belong to this farm'; end if;
    if v_commodity is not null and v_commodity is distinct from v_crop.commodity_id then
      raise exception 'this load says % but the field crop is %', v_commodity, v_crop.commodity_id;
    end if;
    if v_crop_year is not null and v_crop_year is distinct from v_crop.crop_year then
      raise exception 'this load says crop year % but the field crop is %', v_crop_year, v_crop.crop_year;
    end if;
    v_commodity := v_crop.commodity_id;
    v_crop_year := v_crop.crop_year;
    v_origin_bin := null;
  else
    if v_origin_bin is null then raise exception 'pick the bin this load came from'; end if;
    -- Both bins, in id order, before anything is decided. A bin-to-bin transfer locks its origin
    -- here and its destination when the bin-in movement is appended; without this, A-to-B and
    -- B-to-A would each hold the other's next lock. See lock_farm_bins for the module's order.
    perform public.lock_farm_bins(p_farm_id, array_remove(array[v_origin_bin, v_destination_bin], null));
    -- LD-4 repair (Codex P1 on 35d7bdb): FOR UPDATE, and it is not decoration. append_bin_movement
    -- locks this same row before it touches a balance, so taking the lock here puts this function's
    -- lot decision and that movement inside one serialised window. Without it, another truck's
    -- movement can commit between the read below and the write, and the crop year this load is
    -- filed under would be decided against a bin that had already changed.
    select * into v_bin from public.grain_bins where id = v_origin_bin and farm_id = p_farm_id for update;
    if not found then raise exception 'that bin does not belong to this farm'; end if;

    -- LD-4 repair (Codex P1 on da028bf, corrected on 2e7e6d4): a retry after a lost response has to
    -- return the ticket the first attempt already committed. LD-1 guaranteed that and LD-4 broke it
    -- for one case -- a one-lot bin hauled to exactly zero -- because the retry finds no lot with
    -- anything left in it and is refused seventy lines before the replay check it needed to reach.
    --
    -- This lookup sits AFTER the lock above, and that placement is the whole point. Before the
    -- lock, a retry overlapping a slow first attempt could read "no such ticket", wait on the lock
    -- while the first call committed and emptied the lot, and then fail the zero-lot check anyway.
    -- Reading it inside the serialised window means the ticket the first call wrote is visible.
    --
    -- Nothing is taken on trust: the stored lot must still be one the bin has a record of, and the
    -- field-by-field replay comparison below still decides same ticket or reused id.
    if v_crop_year is null then
      select crop_year, commodity_id into v_replay_year, v_replay_commodity
        from public.grain_loads where id = v_id and farm_id = p_farm_id;
      if found then
        v_crop_year := v_replay_year;
        if v_commodity is null then v_commodity := v_replay_commodity; end if;
      end if;
    end if;

    -- LD-4: the bin's lots, not its baseline. Until now this branch read bin_inventory alone, so a
    -- bin filled only by a load's own bin-in effect had no baseline and could not be an origin at
    -- all, and a bin holding carry-over under a newer crop could only ever be hauled as the older
    -- year. LD-3 made that visible to the farmer -- it shows free bushels of a year this function
    -- would then refuse to move -- and LD-2 added the crop_year column that makes the lots
    -- enumerable. Movements with no crop year join no lot, exactly as LD-3's figures treat them,
    -- so they are excluded here rather than silently assigned to whichever year is being hauled.
    --
    -- ONE read, not two. Counting the lots and then selecting the single one was two statements,
    -- and under read committed the second sees a newer snapshot than the first: the count could
    -- say one while the select returned two. A plain SELECT INTO over two rows takes whichever
    -- arrives first, so the load would be filed under a crop year nobody chose -- the exact silent
    -- guess this whole initiative exists to prevent. The aggregate below cannot disagree with
    -- itself, and max() is the single lot's own value precisely when the count is one.
    select count(*), max(lots.commodity_id), max(lots.crop_year)
      into v_on_hand_lots, v_lot_commodity, v_crop_year_default
      from public.bin_lots(p_farm_id, v_origin_bin) lots
     where lots.crop_year is not null and lots.bushels > 0.000001;

    if v_crop_year is null then
      -- Nothing chosen, so default only when the bin holds a single lot. That is the amendment's
      -- rule word for word, and it is why a farmer hauling out of a one-crop bin still taps
      -- nothing: the common case is unchanged.
      if v_on_hand_lots = 0 then
        raise exception 'that bin holds no crop with a crop year, so Farm Rx cannot tell which crop year this load is';
      end if;
      if v_on_hand_lots > 1 then
        raise exception 'this bin holds more than one crop year, so pick which one this load came from';
      end if;
      v_crop_year := v_crop_year_default;
    else
      -- A chosen lot has to be one the bin has a record of. Whether the bin still holds enough of
      -- it is append_bin_movement's question, asked under a row lock at the moment the movement is
      -- written. Answering it a second time here would be a second evaluator of one fact, and the
      -- two could disagree -- so this checks only that the lot is real.
      -- LD-4 repair (Codex P1 on c0e40a3): a lot is a commodity IN a crop year, which is this
      -- initiative's first rule, and this lookup was keyed on the year alone. A bin that held 2025
      -- soybeans and was later reused for 2025 corn has a record of both, and "order by bushels
      -- desc" quietly picked whichever had more -- so a ticket for the emptied soybeans would have
      -- been stamped corn. The commodity travels with the choice now, and an unnamed commodity is
      -- refused rather than guessed when the year alone does not settle it.
      select count(distinct lots.commodity_id), max(lots.commodity_id)
        into v_lot_matches, v_lot_commodity
        from public.bin_lots(p_farm_id, v_origin_bin) lots
       where lots.crop_year = v_crop_year
         and (v_commodity is null or lots.commodity_id = v_commodity);
      if v_lot_matches = 0 then
        raise exception 'this bin has no record of the % crop', v_crop_year;
      end if;
      if v_lot_matches > 1 then
        raise exception 'this bin has held more than one crop in %, so this load has to say which one', v_crop_year;
      end if;
    end if;

    if v_commodity is not null and v_commodity is distinct from v_lot_commodity then
      raise exception 'this bin holds % , not %', v_lot_commodity, v_commodity;
    end if;
    v_commodity := v_lot_commodity;
    v_origin_crop := null;
  end if;

  if v_commodity is null then raise exception 'a load needs the crop it is carrying'; end if;
  if v_crop_year is null then raise exception 'a load needs the crop year it is carrying'; end if;

  if v_destination_kind = 'contract' then
    if v_destination_contract is null then raise exception 'pick the contract this load went against'; end if;
    select * into v_contract from public.grain_contracts
      where id = v_destination_contract and farm_id = p_farm_id;
    if not found then raise exception 'that contract does not belong to this farm'; end if;
    if v_contract.commodity_id is distinct from v_commodity then
      raise exception 'that contract is for %, and this load is %', v_contract.commodity_id, v_commodity;
    end if;
    if v_contract.crop_year is distinct from v_crop_year then
      raise exception 'that contract is for the % crop, and this load is the % crop', v_contract.crop_year, v_crop_year;
    end if;
    v_destination_bin := null;
    v_destination_buyer := null;
  elsif v_destination_kind = 'bin' then
    if v_destination_bin is null then raise exception 'pick the bin this load went into'; end if;
    v_destination_contract := null;
    v_destination_buyer := null;
  else
    if v_destination_buyer is null then raise exception 'name the buyer or elevator this load went to'; end if;
    v_destination_bin := null;
    v_destination_contract := null;
  end if;

  -- An effect the load's shape cannot reach is a bug in the caller, not a silent no-op. The
  -- table carries the same rules as check constraints; these say it in farmer language first.
  if v_effect_bin_out and v_origin_kind <> 'bin' then
    raise exception 'this load did not come out of a bin, so it cannot take bushels out of one';
  end if;
  if v_effect_bin_in and v_destination_kind <> 'bin' then
    raise exception 'this load did not go into a bin, so it cannot put bushels into one';
  end if;
  if v_effect_delivery and v_destination_kind <> 'contract' then
    raise exception 'this load did not go against a contract, so it cannot record a delivery';
  end if;
  if v_effect_harvest and v_origin_kind <> 'field' then
    raise exception 'this load did not come off a field, so it cannot count toward a harvest';
  end if;

  select * into v_existing from public.grain_loads where id = v_id for update;
  if found then
    if v_existing.farm_id = p_farm_id
       and v_existing.load_date = v_load_date
       and v_existing.origin_kind = v_origin_kind
       and v_existing.origin_grain_bin_id is not distinct from v_origin_bin
       and v_existing.origin_crop_assignment_id is not distinct from v_origin_crop
       and v_existing.destination_kind = v_destination_kind
       and v_existing.destination_buyer is not distinct from v_destination_buyer
       and v_existing.destination_grain_contract_id is not distinct from v_destination_contract
       and v_existing.destination_grain_bin_id is not distinct from v_destination_bin
       and v_existing.commodity_id = v_commodity
       and v_existing.crop_year = v_crop_year
       and v_existing.net_bushels = v_net
       and v_existing.effect_bin_out = v_effect_bin_out
       and v_existing.effect_bin_in = v_effect_bin_in
       and v_existing.effect_contract_delivery = v_effect_delivery
       and v_existing.effect_harvest = v_effect_harvest then
      return to_jsonb(v_existing);
    end if;
    raise exception using errcode = 'P0001', message = 'FARM_RX_LOAD_ID_REUSED';
  end if;

  insert into public.grain_loads (
    id, farm_id, load_date, truck_equipment_id, truck_name,
    origin_kind, origin_grain_bin_id, origin_crop_assignment_id,
    destination_kind, destination_buyer, destination_grain_contract_id, destination_grain_bin_id,
    commodity_id, crop_year, gross_lbs, tare_lbs, net_bushels, moisture_pct,
    ticket_number, photo_path, notes,
    effect_bin_out, effect_bin_in, effect_contract_delivery, effect_harvest,
    created_by
  ) values (
    v_id, p_farm_id, v_load_date, v_truck_equipment, v_truck_name,
    v_origin_kind, v_origin_bin, v_origin_crop,
    v_destination_kind, v_destination_buyer, v_destination_contract, v_destination_bin,
    v_commodity, v_crop_year, v_gross, v_tare, v_net, v_moisture,
    v_ticket, v_photo, v_notes,
    v_effect_bin_out, v_effect_bin_in, v_effect_delivery, v_effect_harvest,
    auth.uid()
  ) returning * into v_saved;

  v_movement_note := case
    when v_ticket is not null then format('Scale ticket %s', v_ticket)
    else 'Recorded from a load'
  end;

  -- The effects, each through the path that already guards it. A refusal from any of these
  -- aborts the whole save, so the ticket and its effects are one all-or-nothing write.
  if v_effect_bin_out then
    perform public.append_bin_movement(p_farm_id, jsonb_build_object(
      'id', gen_random_uuid(),
      'grain_bin_id', v_origin_bin,
      'direction', 'out',
      'bushels', v_net,
      'commodity_id', v_commodity,
      'crop_year', v_crop_year,
      'occurred_on', v_load_date,
      'note', v_movement_note,
      'source_kind', 'grain_load',
      'grain_load_id', v_id
    ));
  end if;

  if v_effect_bin_in then
    perform public.append_bin_movement(p_farm_id, jsonb_build_object(
      'id', gen_random_uuid(),
      'grain_bin_id', v_destination_bin,
      'direction', 'in',
      'bushels', v_net,
      'commodity_id', v_commodity,
      'crop_year', v_crop_year,
      'occurred_on', v_load_date,
      'note', v_movement_note,
      'source_kind', 'grain_load',
      'grain_load_id', v_id
    ));
  end if;

  if v_effect_delivery then
    perform public.record_grain_contract_delivery(p_farm_id, jsonb_build_object(
      'id', gen_random_uuid(),
      'grain_contract_id', v_destination_contract,
      'bushels', v_net,
      'delivered_on', v_load_date,
      'note', v_movement_note,
      'grain_load_id', v_id,
      'allow_overdelivery', v_allow_over
    ));
  end if;

  -- The harvest effect writes nothing. It is the flag on the row above, and the figure Harvest
  -- and Fields show is derived from it at read time. See the header of this migration.

  return to_jsonb(v_saved);
end $$;

revoke all on function public.save_grain_load(uuid, jsonb) from public, anon;
grant execute on function public.save_grain_load(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. append_bin_movement, with one baseline rule instead of two
-- ---------------------------------------------------------------------------
--
-- Replaces LD-2's definition. The ONLY change is the one described inside: the lot balance now
-- supersedes pre-baseline movements by commodity, as the commodity balance beside it always has.
-- Every other guard, message and code is LD-2's, unchanged.

create or replace function public.append_bin_movement(p_farm_id uuid, p_transaction jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_bin public.grain_bins%rowtype;
  v_inventory public.bin_inventory%rowtype;
  v_has_inventory boolean := false;
  v_id uuid;
  v_bin_id uuid;
  v_direction public.bin_transaction_direction;
  v_bushels numeric;
  v_commodity text;
  v_crop_year integer;
  v_grain_load uuid;
  v_on date;
  v_note text;
  v_source text;
  v_lot_balance numeric;
  v_year_balance numeric;
  v_total_balance numeric;
  v_active_lots text[];
  v_baseline_is_this_lot boolean;
  v_baseline_covers_commodity boolean;
  v_existing public.bin_transactions%rowtype;
  v_saved public.bin_transactions%rowtype;
begin
  if auth.uid() is null or not public.can_edit_farm(p_farm_id) then
    raise exception 'you do not have permission to add a bin movement';
  end if;

  v_id := (p_transaction->>'id')::uuid;
  v_bin_id := (p_transaction->>'grain_bin_id')::uuid;
  v_direction := (p_transaction->>'direction')::public.bin_transaction_direction;
  v_bushels := (p_transaction->>'bushels')::numeric;
  v_commodity := nullif(btrim(p_transaction->>'commodity_id'), '');
  v_crop_year := (p_transaction->>'crop_year')::integer;
  v_grain_load := (p_transaction->>'grain_load_id')::uuid;
  v_on := (p_transaction->>'occurred_on')::date;
  v_note := nullif(btrim(p_transaction->>'note'), '');
  v_source := nullif(btrim(p_transaction->>'source_kind'), '');

  if v_id is null or v_commodity is null or v_on is null or v_bushels is null or v_bushels <= 0 then
    raise exception 'movement details are required';
  end if;
  if v_crop_year is not null and (v_crop_year < 1900 or v_crop_year > 2200) then
    raise exception 'that is not a crop year';
  end if;

  select * into v_bin from public.grain_bins where id = v_bin_id and farm_id = p_farm_id for update;
  if not found then raise exception 'bin does not belong to this farm'; end if;

  select * into v_existing from public.bin_transactions where id = v_id for update;
  if found then
    if v_existing.farm_id = p_farm_id
       and v_existing.grain_bin_id = v_bin_id
       and v_existing.direction = v_direction
       and v_existing.bushels = v_bushels
       and v_existing.commodity_id = v_commodity
       and v_existing.crop_year is not distinct from v_crop_year
       and v_existing.grain_load_id is not distinct from v_grain_load
       and v_existing.occurred_on = v_on
       and v_existing.note is not distinct from v_note
       and v_existing.source_kind is not distinct from v_source then
      return to_jsonb(v_existing);
    end if;
    raise exception 'movement id was already used with different content';
  end if;

  select * into v_inventory from public.bin_inventory
    where grain_bin_id = v_bin_id and farm_id = p_farm_id;
  v_has_inventory := found;

  -- A baseline restates the bin, so nothing may be recorded at or before it. A void whose
  -- compensating movement now falls behind a newer baseline is a blocked void, not a crash.
  if v_has_inventory and v_on <= v_inventory.measured_at::date then
    raise exception using errcode = 'FR001',
      message = 'movement date must be after the latest bin baseline';
  end if;

  -- One crop per bin: a bin still holding a nonzero lot of something else will not take this.
  select array_agg(commodity_id order by commodity_id) into v_active_lots from (
    select lots.commodity_id,
           coalesce(max(case when v_has_inventory and v_inventory.commodity_id = lots.commodity_id
                             then v_inventory.bushels else 0 end), 0)
         + coalesce(sum(case when t.direction = 'in' then t.bushels else -t.bushels end), 0) as balance
    from (
      select commodity_id from public.bin_transactions
        where grain_bin_id = v_bin_id and farm_id = p_farm_id
      union
      select v_inventory.commodity_id where v_has_inventory
    ) lots
    left join public.bin_transactions t
      on t.commodity_id = lots.commodity_id
     and t.grain_bin_id = v_bin_id
     and t.farm_id = p_farm_id
     and (not v_has_inventory
          or t.commodity_id <> v_inventory.commodity_id
          or t.occurred_on > v_inventory.measured_at::date)
    group by lots.commodity_id
  ) active where abs(balance) > 0.000001;
  if coalesce(array_length(v_active_lots, 1), 0) > 0 and not v_commodity = any(v_active_lots) then
    raise exception using errcode = 'FR001',
      message = format('this bin still holds nonzero lots: %s; empty those lots before storing another crop',
                       array_to_string(v_active_lots, ', '));
  end if;

  -- The commodity balance. Kept exactly as 0033 computed it, and still authoritative: rows
  -- written before the crop_year column carry null and are invisible to the lot figure below,
  -- so this is what still stops a bin being drawn past what is physically in it.
  select coalesce(case when v_has_inventory and v_inventory.commodity_id = v_commodity
                       then v_inventory.bushels else 0 end, 0)
       + coalesce(sum(case when direction = 'in' then bushels else -bushels end), 0)
    into v_lot_balance
    from public.bin_transactions
   where grain_bin_id = v_bin_id
     and farm_id = p_farm_id
     and commodity_id = v_commodity
     and (not v_has_inventory
          or commodity_id <> v_inventory.commodity_id
          or occurred_on > v_inventory.measured_at::date);
  v_lot_balance := v_lot_balance + case when v_direction = 'in' then v_bushels else -v_bushels end;
  if v_lot_balance < 0 then
    raise exception using errcode = 'FR001',
      message = 'this movement would make the bin balance negative';
  end if;

  -- The lot balance: the same arithmetic narrowed to one crop year. The bin_inventory baseline
  -- already carries a crop year, so it is its own lot and counts only for that year. Rows whose
  -- crop year is null are a separate bucket and are deliberately not counted here -- assigning
  -- them to this year would be the silent guess the amendment forbids.
  if v_crop_year is not null then
    -- LD-4 repair (Codex P1 on c0e40a3): TWO questions, and LD-2 asked only one of them.
    --
    -- Whether the baseline's bushels belong to THIS lot is a commodity-and-year question: the
    -- baseline is 5,000 bushels of the 2023 crop, and none of it is 2022.
    --
    -- Whether a movement is already counted inside that baseline is a COMMODITY question, and LD-2
    -- had it as a commodity-and-year one. A baseline measures the bin, not one year of it, so a
    -- same-commodity movement dated before it is inside the figure whatever year it names. Asking
    -- the narrower question here made this guard disagree with the commodity balance above -- that
    -- one already excludes every same-commodity row at or before the baseline -- so the two halves
    -- of one function reported different bushels, and public.bin_lots could agree with neither.
    v_baseline_is_this_lot := v_has_inventory
      and v_inventory.commodity_id = v_commodity
      and v_inventory.crop_year = v_crop_year;
    v_baseline_covers_commodity := v_has_inventory and v_inventory.commodity_id = v_commodity;
    select coalesce(case when v_baseline_is_this_lot then v_inventory.bushels else 0 end, 0)
         + coalesce(sum(case when direction = 'in' then bushels else -bushels end), 0)
      into v_year_balance
      from public.bin_transactions
     where grain_bin_id = v_bin_id
       and farm_id = p_farm_id
       and commodity_id = v_commodity
       and crop_year = v_crop_year
       and (not v_baseline_covers_commodity or occurred_on > v_inventory.measured_at::date);
    v_year_balance := v_year_balance + case when v_direction = 'in' then v_bushels else -v_bushels end;
    if v_year_balance < 0 then
      raise exception using errcode = 'FR001',
        message = format('this bin does not hold that many bushels of the %s crop', v_crop_year);
    end if;
  end if;

  -- Capacity counts every crop in the bin, not just this one.
  select coalesce(sum(balance), 0) into v_total_balance from (
    select lots.commodity_id,
           coalesce(max(case when v_has_inventory and v_inventory.commodity_id = lots.commodity_id
                             then v_inventory.bushels else 0 end), 0)
         + coalesce(sum(case when t.direction = 'in' then t.bushels else -t.bushels end), 0) as balance
    from (
      select commodity_id from public.bin_transactions
        where grain_bin_id = v_bin_id and farm_id = p_farm_id
      union
      select v_inventory.commodity_id where v_has_inventory
      union
      select v_commodity
    ) lots
    left join public.bin_transactions t
      on t.commodity_id = lots.commodity_id
     and t.grain_bin_id = v_bin_id
     and t.farm_id = p_farm_id
     and (not v_has_inventory
          or t.commodity_id <> v_inventory.commodity_id
          or t.occurred_on > v_inventory.measured_at::date)
    group by lots.commodity_id
  ) balances;
  v_total_balance := v_total_balance + case when v_direction = 'in' then v_bushels else -v_bushels end;
  if v_total_balance > v_bin.capacity_bu then
    raise exception using errcode = 'FR001',
      message = 'this movement would put more grain in the bin than it holds';
  end if;

  begin
    insert into public.bin_transactions
      (id, farm_id, grain_bin_id, direction, bushels, commodity_id, crop_year, occurred_on, note, source_kind, grain_load_id)
    values
      (v_id, p_farm_id, v_bin_id, v_direction, v_bushels, v_commodity, v_crop_year, v_on, v_note, v_source, v_grain_load)
    returning * into v_saved;
  exception when unique_violation then
    select * into v_existing from public.bin_transactions where id = v_id;
    if found
       and v_existing.farm_id = p_farm_id
       and v_existing.grain_bin_id = v_bin_id
       and v_existing.direction = v_direction
       and v_existing.bushels = v_bushels
       and v_existing.commodity_id = v_commodity
       and v_existing.crop_year is not distinct from v_crop_year
       and v_existing.grain_load_id is not distinct from v_grain_load
       and v_existing.occurred_on = v_on
       and v_existing.note is not distinct from v_note
       and v_existing.source_kind is not distinct from v_source then
      return to_jsonb(v_existing);
    end if;
    raise exception 'movement id was already used with different content';
  end;

  return to_jsonb(v_saved);
end $$;

revoke all on function public.append_bin_movement(uuid, jsonb) from public, anon;
grant execute on function public.append_bin_movement(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. assign_bin_movement_crop_year, queued behind the same bin lock
-- ---------------------------------------------------------------------------
--
-- Replaces LD-2's definition. Two changes, both described inside: it takes the bin row lock before
-- it decides anything, and its baseline rule matches the one every other reader now uses. Naming a
-- crop year CREATES a lot, so it belongs in the same queue as the functions that count them.

create or replace function public.assign_bin_movement_crop_year(
  p_farm_id uuid,
  p_transaction_id uuid,
  p_crop_year integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_movement public.bin_transactions%rowtype;
  v_inventory public.bin_inventory%rowtype;
  v_has_inventory boolean := false;
  v_baseline_is_this_lot boolean;
  v_baseline_covers_commodity boolean;
  v_bin_id uuid;
  v_year_balance numeric;
begin
  if auth.uid() is null
     or public.request_uses_service_role()
     or not public.can_manage_farm(p_farm_id) then
    raise exception 'only an owner or manager can name the crop year of a past movement';
  end if;
  if p_crop_year is null or p_crop_year < 1900 or p_crop_year > 2200 then
    raise exception 'that is not a crop year';
  end if;

  -- LD-4 repair (Codex P2 on 2e7e6d4): lock the BIN, not just the movement. Naming a crop year
  -- creates a lot, and save_grain_load defaults a load's lot by counting the lots a bin holds. With
  -- only the movement row locked, a manager could name a year in the window between that count and
  -- the movement the load appends -- so the load would file itself under the single lot it saw
  -- while the bin had just gained a second. The farmer would never have been asked. Taking the
  -- same row append_bin_movement and save_grain_load take puts all three in one queue.
  --
  -- LD-4 repair (Codex P2 on 178208c): and BIN FIRST, which the first version of this fix got
  -- backwards. append_bin_movement locks the bin and then the movement row. Locking them the other
  -- way round here made a cycle: a movement retry holding the bin and waiting for the movement,
  -- against this function holding the movement and waiting for the bin. PostgreSQL breaks that by
  -- aborting one of them, so a farmer's save would fail with a deadlock for no reason they could
  -- see or act on. Two functions taking the same two locks must take them in the same order; the
  -- unlocked read below exists only to learn which bin to lock.
  select grain_bin_id into v_bin_id from public.bin_transactions
    where id = p_transaction_id and farm_id = p_farm_id;
  if not found then raise exception 'that movement does not belong to this farm'; end if;

  perform 1 from public.grain_bins
    where id = v_bin_id and farm_id = p_farm_id for update;

  select * into v_movement from public.bin_transactions
    where id = p_transaction_id and farm_id = p_farm_id for update;
  if not found then raise exception 'that movement does not belong to this farm'; end if;

  if v_movement.crop_year is not null then
    if v_movement.crop_year = p_crop_year then
      return to_jsonb(v_movement);
    end if;
    raise exception 'this movement already names the % crop and cannot be changed', v_movement.crop_year;
  end if;

  select * into v_inventory from public.bin_inventory
    where grain_bin_id = v_movement.grain_bin_id and farm_id = p_farm_id;
  v_has_inventory := found;
  -- Whose BUSHELS the baseline is: its own commodity in its own crop year.
  v_baseline_is_this_lot := v_has_inventory
    and v_inventory.commodity_id = v_movement.commodity_id
    and v_inventory.crop_year = p_crop_year;
  -- Whether a movement is already inside that baseline: a COMMODITY question, corrected here for
  -- the same reason it was corrected in append_bin_movement and bin_lots. A baseline measures the
  -- bin, not one year of it.
  v_baseline_covers_commodity := v_has_inventory
    and v_inventory.commodity_id = v_movement.commodity_id;

  -- The balance this lot would have once this movement joins it.
  select coalesce(case when v_baseline_is_this_lot then v_inventory.bushels else 0 end, 0)
       + coalesce(sum(case when direction = 'in' then bushels else -bushels end), 0)
    into v_year_balance
    from public.bin_transactions
   where grain_bin_id = v_movement.grain_bin_id
     and farm_id = p_farm_id
     and commodity_id = v_movement.commodity_id
     and (crop_year = p_crop_year or id = p_transaction_id)
     and (not v_baseline_covers_commodity or occurred_on > v_inventory.measured_at::date);
  if v_year_balance < 0 then
    raise exception 'calling this the % crop would leave that year short by % bushels',
      p_crop_year, abs(v_year_balance);
  end if;

  update public.bin_transactions
     set crop_year = p_crop_year
   where id = p_transaction_id and farm_id = p_farm_id
  returning * into v_movement;

  return to_jsonb(v_movement);
end $$;

revoke all on function public.assign_bin_movement_crop_year(uuid, uuid, integer) from public, anon;
grant execute on function public.assign_bin_movement_crop_year(uuid, uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. void_grain_load, taking its bins in the module's order
-- ---------------------------------------------------------------------------
--
-- Replaces LD-2's definition. The only change is the ordered bin lock described inside: a void
-- writes compensating movements into every bin the load touched, so it is a multi-bin transaction
-- and follows the same rule as save_grain_load. Every guard, message and blocked-void answer is
-- LD-2's, unchanged.

create or replace function public.void_grain_load(p_farm_id uuid, p_load_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_load public.grain_loads%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
  v_movement public.bin_transactions%rowtype;
  v_opposite public.bin_transaction_direction;
  v_blocked jsonb;
  v_refusal text;
begin
  if auth.uid() is null
     or public.request_uses_service_role()
     or not public.can_edit_farm(p_farm_id)
     or not public.can_read_private_financials(p_farm_id) then
    raise exception 'you do not have permission to void a load for this farm';
  end if;
  if v_reason is null or length(v_reason) < 3 or length(v_reason) > 2000 then
    raise exception 'say why this ticket is being voided';
  end if;

  -- LD-4 repair (Codex P2 on bba6b10, corrected on c231a00): every bin this void will write a
  -- compensating movement into, locked in id order BEFORE the load row. A void reverses movements
  -- in as many as two bins, so it is a multi-bin transaction; and the module's order is bins first,
  -- then grain_loads. The first version of this took the load row first, which is the order
  -- save_grain_load does NOT use -- so an idempotent retry of a save could hold the bins and wait
  -- for the load row while a void held the load row and waited for the bins.
  --
  -- The read that finds the bins takes no lock; it only answers which rows to ask for.
  perform public.lock_farm_bins(p_farm_id, array(
    select distinct grain_bin_id from public.bin_transactions
     where grain_load_id = p_load_id and farm_id = p_farm_id));

  select * into v_load from public.grain_loads
    where id = p_load_id and farm_id = p_farm_id for update;
  if not found then raise exception 'that load does not belong to this farm'; end if;

  -- A void is one transaction, so a load that carries voided_at has already had every effect
  -- reversed. A replay with the same reason answers; a different reason is refused rather than
  -- overwriting the reason on the record.
  if v_load.voided_at is not null then
    if v_load.void_reason is not distinct from v_reason then
      return jsonb_build_object('status', 'voided', 'load', to_jsonb(v_load), 'blocked_by', '[]'::jsonb);
    end if;
    raise exception using errcode = 'P0001', message = 'FARM_RX_LOAD_ALREADY_VOIDED';
  end if;

  begin
    -- A delivery is a claim about a contract rather than a physical event, so it is removed
    -- outright. Every existing reader of delivered bushels is then correct with no second rule
    -- about voided deliveries to learn; the voided load keeps the history of what it did.
    delete from public.grain_contract_deliveries
     where grain_load_id = p_load_id and farm_id = p_farm_id;

    -- The bin ledger is a physical record and is append-only, so each movement is answered by
    -- its opposite rather than erased.
    for v_movement in
      select * from public.bin_transactions
       where grain_load_id = p_load_id
         and farm_id = p_farm_id
         and source_kind = 'grain_load'
       order by created_at, id
    loop
      v_opposite := case when v_movement.direction = 'in' then 'out' else 'in' end;
      perform public.append_bin_movement(p_farm_id, jsonb_build_object(
        'id', gen_random_uuid(),
        'grain_bin_id', v_movement.grain_bin_id,
        'direction', v_opposite,
        'bushels', v_movement.bushels,
        'commodity_id', v_movement.commodity_id,
        'crop_year', v_movement.crop_year,
        'occurred_on', current_date,
        'note', format('Reversing a voided load: %s', v_reason),
        'source_kind', 'grain_load_void',
        'grain_load_id', p_load_id
      ));
    end loop;
  exception when sqlstate 'FR001' then
    -- The bin cannot take the reversal. Nothing above survived this rollback.
    v_refusal := sqlerrm;
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', t.id,
             'grain_bin_id', t.grain_bin_id,
             'direction', t.direction::text,
             'bushels', t.bushels,
             'commodity_id', t.commodity_id,
             'crop_year', t.crop_year,
             'occurred_on', t.occurred_on,
             'source_kind', t.source_kind
           ) order by t.occurred_on, t.created_at), '[]'::jsonb)
      into v_blocked
      from public.bin_transactions t
     where t.farm_id = p_farm_id
       and t.grain_load_id is distinct from p_load_id
       and exists (
         select 1 from public.bin_transactions mine
          where mine.grain_load_id = p_load_id
            and mine.farm_id = p_farm_id
            and mine.source_kind = 'grain_load'
            and mine.grain_bin_id = t.grain_bin_id
            and mine.commodity_id = t.commodity_id
            and mine.crop_year is not distinct from t.crop_year
            and (t.occurred_on, t.created_at) > (mine.occurred_on, mine.created_at)
       );
    return jsonb_build_object(
      'status', 'blocked',
      'load', to_jsonb(v_load),
      'blocked_by', v_blocked,
      'reason', v_refusal
    );
  end;

  update public.grain_loads
     set voided_at = now(), void_reason = v_reason, voided_by = auth.uid(), updated_at = now()
   where id = p_load_id and farm_id = p_farm_id
  returning * into v_load;

  return jsonb_build_object('status', 'voided', 'load', to_jsonb(v_load), 'blocked_by', '[]'::jsonb);
end $$;

revoke all on function public.void_grain_load(uuid, uuid, text) from public, anon;
grant execute on function public.void_grain_load(uuid, uuid, text) to authenticated;
