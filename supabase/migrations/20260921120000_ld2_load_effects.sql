-- LD-2 (2026-09-05 owner amendment): load effects, explicit and atomic.
--
-- LD-1 recorded the scale ticket and deliberately changed nothing else. LD-2 gives the ticket
-- its effects: a bin-out from the origin bin, a bin-in to the destination bin, a delivery
-- against the destination contract, and a contribution toward the field crop's harvest. Every
-- one of those is a separate write the farmer saw and confirmed on that save. Nothing happens
-- silently, and the load row records which effects it was confirmed to perform, so the ticket
-- itself is the evidence of what it did.
--
-- Three structural decisions carry the weight here.
--
-- 1. THE LOT IS (COMMODITY, CROP YEAR), NOT COMMODITY. `bin_transactions` carried no crop year,
--    so a bin-out of 2026 corn could be satisfied by 2025 corn sitting in the same bin. This
--    migration stamps a crop year on every load-created movement and extends the negative-balance
--    guard to the lot. The existing commodity-level guard is KEPT and the lot guard is added on
--    top of it, never in place of it: legacy rows carry a null crop year and are their own bucket,
--    so the lot figure alone would read high on a bin whose baseline was drawn down by movements
--    that predate this column. Two guards, both must pass.
--
-- 2. THE HARVEST CONTRIBUTION IS DERIVED, NEVER WRITTEN. `crop_assignments.harvested_bushels` is
--    one replaceable total that the Harvest form overwrites whole through `save_crop_harvest`. A
--    load that incremented it would be erased by the next manual entry or double-counted by it.
--    So a load's harvest contribution is a flag on the load and nothing else; the sum is derived
--    from `grain_loads` at read time, and voiding a load changes only that derived figure.
--
-- 3. A LOAD'S EFFECTS ARE FOUND BY LINK, NOT BY GUESSWORK. `bin_transactions.grain_load_id` and
--    `grain_contract_deliveries.grain_load_id` say which rows a load created, so `void_grain_load`
--    reverses exactly those and nothing else. A bin movement is reversed by a compensating
--    movement through the same guards (the ledger is append-only and a physical record); a
--    contract delivery is removed, because a delivery is a claim rather than a physical event and
--    every existing reader of delivered bushels then stays correct with no second rule to learn.
--    The voided load keeps the full history of what it did.

-- ---------------------------------------------------------------------------
-- 1. The lot: a crop year on every bin movement
-- ---------------------------------------------------------------------------

alter table public.bin_transactions
  add column crop_year integer
    check (crop_year is null or crop_year between 1900 and 2200);

comment on column public.bin_transactions.crop_year is
  'The crop year of the grain this movement moved. Null on every row written before LD-2; those rows are an explicit "crop year unknown" bucket that no year-specific figure may count, and they are never silently assigned to the bin baseline''s year. assign_bin_movement_crop_year is the one-time, owner-confirmed way to name them.';

create index bin_transactions_lot_idx
  on public.bin_transactions (grain_bin_id, farm_id, commodity_id, crop_year, occurred_on);

-- ---------------------------------------------------------------------------
-- 2. Provenance: which rows a load created
-- ---------------------------------------------------------------------------

alter table public.bin_transactions
  add column grain_load_id uuid,
  add constraint bin_transactions_grain_load_same_farm_fk
    foreign key (grain_load_id, farm_id)
    references public.grain_loads(id, farm_id) on delete cascade;

alter table public.grain_contract_deliveries
  add column grain_load_id uuid,
  add constraint grain_contract_deliveries_grain_load_same_farm_fk
    foreign key (grain_load_id, farm_id)
    references public.grain_loads(id, farm_id) on delete cascade;

-- Every public foreign key needs an index whose leading columns are exactly that key's columns,
-- in the order the constraint declares them, and which is not partial (the 0043 advisor rule,
-- enforced by section 14 of the LD-1 assertions). Without these, deleting a farm has to
-- sequentially scan both ledgers.
create index bin_transactions_grain_load_idx
  on public.bin_transactions (grain_load_id, farm_id);
create index grain_contract_deliveries_grain_load_idx
  on public.grain_contract_deliveries (grain_load_id, farm_id);

-- `on delete cascade` rather than the `restrict` LD-1 used for its own references: a load row can
-- only ever disappear with its farm, and when a farm goes these ledger rows go with it. A
-- restricting reference between two tables that both cascade from `farms` risks making a farm
-- undeletable depending on the order the cascade happens to run in.

-- ---------------------------------------------------------------------------
-- 3. The confirmed effects, recorded on the load
-- ---------------------------------------------------------------------------

alter table public.grain_loads
  add column effect_bin_out boolean not null default false,
  add column effect_bin_in boolean not null default false,
  add column effect_contract_delivery boolean not null default false,
  add column effect_harvest boolean not null default false;

-- An effect can only be confirmed when the load's own shape makes it reachable. This is the
-- database half of "the farmer sees exactly what saving will do": a load with a buyer
-- destination cannot carry a delivery effect at all, however the request was built.
alter table public.grain_loads
  add constraint grain_loads_bin_out_needs_bin_origin
    check (not effect_bin_out or origin_kind = 'bin'),
  add constraint grain_loads_bin_in_needs_bin_destination
    check (not effect_bin_in or destination_kind = 'bin'),
  add constraint grain_loads_delivery_needs_contract_destination
    check (not effect_contract_delivery or destination_kind = 'contract'),
  add constraint grain_loads_harvest_needs_field_origin
    check (not effect_harvest or origin_kind = 'field');

comment on column public.grain_loads.effect_harvest is
  'True when the farmer confirmed this load counts toward the field crop''s harvest. This is the ONLY record of that contribution: the derived "from loads" figure sums net_bushels over non-voided loads carrying this flag. crop_assignments.harvested_bushels is never written by a load.';

-- The append-only trigger names every column explicitly, so it has to learn the new ones or a
-- load could be edited through them. Replacing it here is deliberate and is pinned by the LD-2
-- assertions, which read the installed body rather than this file.
create or replace function public.grain_loads_append_only()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.voided_at is not null then
    raise exception 'a voided load cannot be changed';
  end if;
  if new.id is distinct from old.id
     or new.farm_id is distinct from old.farm_id
     or new.load_date is distinct from old.load_date
     or new.truck_equipment_id is distinct from old.truck_equipment_id
     or new.truck_name is distinct from old.truck_name
     or new.origin_kind is distinct from old.origin_kind
     or new.origin_grain_bin_id is distinct from old.origin_grain_bin_id
     or new.origin_crop_assignment_id is distinct from old.origin_crop_assignment_id
     or new.destination_kind is distinct from old.destination_kind
     or new.destination_buyer is distinct from old.destination_buyer
     or new.destination_grain_contract_id is distinct from old.destination_grain_contract_id
     or new.destination_grain_bin_id is distinct from old.destination_grain_bin_id
     or new.commodity_id is distinct from old.commodity_id
     or new.crop_year is distinct from old.crop_year
     or new.gross_lbs is distinct from old.gross_lbs
     or new.tare_lbs is distinct from old.tare_lbs
     or new.net_bushels is distinct from old.net_bushels
     or new.moisture_pct is distinct from old.moisture_pct
     or new.ticket_number is distinct from old.ticket_number
     or new.photo_path is distinct from old.photo_path
     or new.notes is distinct from old.notes
     or new.effect_bin_out is distinct from old.effect_bin_out
     or new.effect_bin_in is distinct from old.effect_bin_in
     or new.effect_contract_delivery is distinct from old.effect_contract_delivery
     or new.effect_harvest is distinct from old.effect_harvest
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'a load record cannot be edited; void it and record the correct one';
  end if;
  if new.voided_at is null then
    raise exception 'a load record cannot be edited; void it and record the correct one';
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 4. The ledger stays a ledger
-- ---------------------------------------------------------------------------

-- `bin_transactions` has never had an UPDATE path: `authenticated` holds SELECT only and every
-- write goes through append_bin_movement. LD-2 adds the first update path in the product
-- (naming the crop year of a legacy movement), so the table gets the guard that says what that
-- path may change. Without it, a future definer function could quietly restate history.
create function public.bin_transactions_append_only()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.id is distinct from old.id
     or new.farm_id is distinct from old.farm_id
     or new.grain_bin_id is distinct from old.grain_bin_id
     or new.direction is distinct from old.direction
     or new.bushels is distinct from old.bushels
     or new.commodity_id is distinct from old.commodity_id
     or new.occurred_on is distinct from old.occurred_on
     or new.note is distinct from old.note
     or new.source_kind is distinct from old.source_kind
     or new.grain_load_id is distinct from old.grain_load_id
     or new.created_at is distinct from old.created_at then
    raise exception 'a bin movement cannot be edited; append a correcting movement instead';
  end if;
  -- The crop year may be named once and never renamed. A wrong answer is corrected the way the
  -- ledger corrects everything else: by a movement, not by restating the past.
  if old.crop_year is not null and new.crop_year is distinct from old.crop_year then
    raise exception 'this movement already names a crop year; it cannot be changed';
  end if;
  return new;
end $$;

create trigger bin_transactions_append_only
before update on public.bin_transactions
for each row execute function public.bin_transactions_append_only();

-- ---------------------------------------------------------------------------
-- 5. append_bin_movement, now lot-aware
-- ---------------------------------------------------------------------------
--
-- Replaces migration 0033's definition. Two things are new: the movement may carry the crop year
-- of the grain it moves and the load that created it, and the negative-balance guard is computed
-- for the lot (commodity AND crop year) as well as for the commodity. The commodity guard is not
-- relaxed -- it is what still protects a bin whose history predates the crop_year column, because
-- those rows are a separate "unknown" bucket that the lot figure cannot see.
--
-- Every refusal that means "the bin physically cannot take this" is raised with SQLSTATE FR001.
-- void_grain_load reads that code to tell a blocked void from a real failure, so the two
-- functions agree through an error code rather than through matching strings.
--
-- 0033's body is written as one statement per line; this is the same logic set out readably,
-- because a new guard buried in a 400-character line is a guard nobody can review.
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
    v_baseline_is_this_lot := v_has_inventory
      and v_inventory.commodity_id = v_commodity
      and v_inventory.crop_year = v_crop_year;
    select coalesce(case when v_baseline_is_this_lot then v_inventory.bushels else 0 end, 0)
         + coalesce(sum(case when direction = 'in' then bushels else -bushels end), 0)
      into v_year_balance
      from public.bin_transactions
     where grain_bin_id = v_bin_id
       and farm_id = p_farm_id
       and commodity_id = v_commodity
       and crop_year = v_crop_year
       and (not v_baseline_is_this_lot or occurred_on > v_inventory.measured_at::date);
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
-- 6. record_grain_contract_delivery, now able to say which load delivered
-- ---------------------------------------------------------------------------
--
-- Replaces 0033's definition. The only change is that a delivery may name the load that created
-- it, so void_grain_load can find exactly the row to remove. Every guard is unchanged.
create or replace function public.record_grain_contract_delivery(p_farm_id uuid, p_delivery jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_contract public.grain_contracts%rowtype;
  v_id uuid := (p_delivery->>'id')::uuid;
  v_contract_id uuid := (p_delivery->>'grain_contract_id')::uuid;
  v_bushels numeric := (p_delivery->>'bushels')::numeric;
  v_on date := (p_delivery->>'delivered_on')::date;
  v_note text := nullif(btrim(p_delivery->>'note'), '');
  v_grain_load uuid := (p_delivery->>'grain_load_id')::uuid;
  v_allow boolean := coalesce((p_delivery->>'allow_overdelivery')::boolean, false);
  v_existing public.grain_contract_deliveries%rowtype;
  v_saved public.grain_contract_deliveries%rowtype;
  v_prior numeric;
begin
  if auth.uid() is null or not public.can_edit_farm(p_farm_id) then
    raise exception 'you do not have permission to record a delivery';
  end if;
  if v_id is null or v_contract_id is null or v_on is null or v_bushels is null or v_bushels <= 0 then
    raise exception 'delivered bushels must be greater than zero';
  end if;

  select * into v_contract from public.grain_contracts
    where id = v_contract_id and farm_id = p_farm_id for update;
  if not found then raise exception 'contract does not belong to this farm'; end if;

  select * into v_existing from public.grain_contract_deliveries where id = v_id for update;
  if found then
    if v_existing.farm_id = p_farm_id
       and v_existing.grain_contract_id = v_contract_id
       and v_existing.bushels = v_bushels
       and v_existing.delivered_on = v_on
       and v_existing.grain_load_id is not distinct from v_grain_load
       and v_existing.note is not distinct from v_note then
      return to_jsonb(v_existing);
    end if;
    raise exception 'delivery id was already used with different content';
  end if;

  select coalesce(sum(bushels), 0) into v_prior from public.grain_contract_deliveries
    where grain_contract_id = v_contract_id and farm_id = p_farm_id;
  if v_prior + v_bushels > v_contract.bushels and not v_allow then
    raise exception 'delivery would exceed the remaining contract bushels; confirm over-delivery to record it';
  end if;

  begin
    insert into public.grain_contract_deliveries
      (id, farm_id, grain_contract_id, bushels, delivered_on, note, grain_load_id)
    values
      (v_id, p_farm_id, v_contract_id, v_bushels, v_on, v_note, v_grain_load)
    returning * into v_saved;
  exception when unique_violation then
    select * into v_existing from public.grain_contract_deliveries where id = v_id;
    if found
       and v_existing.farm_id = p_farm_id
       and v_existing.grain_contract_id = v_contract_id
       and v_existing.bushels = v_bushels
       and v_existing.delivered_on = v_on
       and v_existing.grain_load_id is not distinct from v_grain_load
       and v_existing.note is not distinct from v_note then
      return to_jsonb(v_existing);
    end if;
    raise exception 'delivery id was already used with different content';
  end;

  return to_jsonb(v_saved);
end $$;

revoke all on function public.record_grain_contract_delivery(uuid, jsonb) from public, anon;
grant execute on function public.record_grain_contract_delivery(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. save_grain_load, now applying the confirmed effects
-- ---------------------------------------------------------------------------
--
-- Replaces LD-1's definition. Everything LD-1 established is unchanged: the origin decides the
-- commodity and crop year, a contradicting client value is refused rather than overridden, a
-- contract destination must match the lot, and the whole thing is idempotent on the client's
-- load id. What is new is that after the ticket is inserted, each effect the farmer confirmed is
-- applied through its existing guarded path, in this one transaction. If any guard refuses, the
-- whole save refuses -- there is no partially applied load.
--
-- The effect flags take part in the idempotency comparison, so a retry that quietly asks for
-- different effects under the same id is refused by name rather than silently honoured.
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
  v_inventory public.bin_inventory%rowtype;
  v_contract public.grain_contracts%rowtype;
  v_has_inventory boolean := false;
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
    select * into v_bin from public.grain_bins where id = v_origin_bin and farm_id = p_farm_id;
    if not found then raise exception 'that bin does not belong to this farm'; end if;
    select * into v_inventory from public.bin_inventory
      where grain_bin_id = v_origin_bin and farm_id = p_farm_id;
    v_has_inventory := found;
    if v_has_inventory then
      if v_commodity is not null and v_commodity is distinct from v_inventory.commodity_id then
        raise exception 'this bin holds % , not %', v_inventory.commodity_id, v_commodity;
      end if;
      if v_crop_year is not null and v_crop_year is distinct from v_inventory.crop_year then
        raise exception 'this bin holds the % crop, not the % crop', v_inventory.crop_year, v_crop_year;
      end if;
      v_commodity := v_inventory.commodity_id;
      v_crop_year := v_inventory.crop_year;
    end if;
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
-- 8. void_grain_load, now reversing what the load did
-- ---------------------------------------------------------------------------
--
-- Replaces LD-1's definition, which had nothing to reverse. A void now removes the delivery the
-- load recorded and appends a compensating movement for each movement it made, all in one
-- transaction. The compensating movements run through append_bin_movement's own guards, so a
-- void can be legitimately refused: if the grain this load put in has since moved out, or the bin
-- it drew from has since been refilled or restated by a newer baseline, the compensating movement
-- cannot be made. In that case NOTHING changes -- not the ledger, not the delivery, not the load
-- -- and the farmer is told which later movements stand in the way so they can deal with those
-- first. There is no cascade and no partial void.
--
-- The reversal runs inside one exception block precisely so that "changes nothing" is true of the
-- delivery removal as well as the movements: a refusal rolls the whole block back to where it
-- started before the blocked answer is returned.
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

-- ---------------------------------------------------------------------------
-- 9. Naming the crop year of a movement that predates this migration
-- ---------------------------------------------------------------------------
--
-- Every bin movement written before LD-2 carries a null crop year. Those rows are an explicit
-- "crop year unknown" bucket: no year-specific committed or free figure counts them, and nothing
-- assigns them to the bin baseline's year on the farmer's behalf. This is the one-time path that
-- lets the farm say what they actually were.
--
-- It is owner-confirmed (can_manage_farm, not merely can_edit_farm) because it restates history,
-- it may only fill a year in that is missing rather than change one that is there, and it refuses
-- an answer that would make that lot's balance negative -- naming a year wrongly would otherwise
-- create a lot the bin never held.
create function public.assign_bin_movement_crop_year(
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
  v_baseline_is_this_lot := v_has_inventory
    and v_inventory.commodity_id = v_movement.commodity_id
    and v_inventory.crop_year = p_crop_year;

  -- The balance this lot would have once this movement joins it.
  select coalesce(case when v_baseline_is_this_lot then v_inventory.bushels else 0 end, 0)
       + coalesce(sum(case when direction = 'in' then bushels else -bushels end), 0)
    into v_year_balance
    from public.bin_transactions
   where grain_bin_id = v_movement.grain_bin_id
     and farm_id = p_farm_id
     and commodity_id = v_movement.commodity_id
     and (crop_year = p_crop_year or id = p_transaction_id)
     and (not v_baseline_is_this_lot or occurred_on > v_inventory.measured_at::date);
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
