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
-- The superseded rule matches append_bin_movement and deriveBinLotOnHand exactly: a baseline
-- restates the bin, so movements of the baseline's own lot dated at or before it are already
-- counted inside the baseline figure and must not be counted twice. Movements of any OTHER lot are
-- never superseded, because the baseline says nothing about them.
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
                                                     where inv.commodity_id = lots.commodity_id
                                                       and inv.crop_year is not distinct from lots.crop_year),
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

  -- LD-4 repair (Codex P1 on da028bf): a retry after a lost response has to return the ticket the
  -- first attempt already committed. LD-1 guaranteed that and LD-4 broke it for one case -- a
  -- one-lot bin hauled to exactly zero. The first call commits the ticket and its bin-out; the
  -- retry then finds no lot with anything left in it and is refused at "that bin holds no crop
  -- with a crop year", seventy lines before the replay check below ever runs. The farmer is told
  -- their load failed when it is already recorded, and retrying again never helps.
  --
  -- Before LD-4 this could not happen: the bin's baseline row answered, and movements never remove
  -- it. So the replay's own lot is adopted here when the caller named none. Nothing is taken on
  -- trust -- the stored lot still has to be one the bin has a record of, and the field-by-field
  -- replay comparison below still decides whether this is the same ticket or a reused id.
  if v_crop_year is null and v_origin_kind = 'bin' then
    select crop_year, commodity_id into v_replay_year, v_replay_commodity
      from public.grain_loads where id = v_id and farm_id = p_farm_id;
    if found then
      v_crop_year := v_replay_year;
      if v_commodity is null then v_commodity := v_replay_commodity; end if;
    end if;
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
    -- LD-4 repair (Codex P1 on 35d7bdb): FOR UPDATE, and it is not decoration. append_bin_movement
    -- locks this same row before it touches a balance, so taking the lock here puts this function's
    -- lot decision and that movement inside one serialised window. Without it, another truck's
    -- movement can commit between the read below and the write, and the crop year this load is
    -- filed under would be decided against a bin that had already changed.
    select * into v_bin from public.grain_bins where id = v_origin_bin and farm_id = p_farm_id for update;
    if not found then raise exception 'that bin does not belong to this farm'; end if;

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
      select lots.commodity_id into v_lot_commodity
        from public.bin_lots(p_farm_id, v_origin_bin) lots
       where lots.crop_year = v_crop_year
       order by lots.bushels desc
       limit 1;
      if v_lot_commodity is null then
        raise exception 'this bin has no record of the % crop', v_crop_year;
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
