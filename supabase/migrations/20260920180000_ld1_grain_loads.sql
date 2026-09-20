-- LD-1 (2026-09-05 owner amendment): the load record.
--
-- A scale ticket is the farm's primary field record of grain leaving a bin or a field, and
-- until now Farm Rx had nowhere to put one. This migration adds that record and the only two
-- ways to write it. Both are SECURITY DEFINER RPCs: the table itself grants SELECT and nothing
-- else, so no browser can insert a load that skipped a check or rewrite one after the fact.
--
-- LD-1 stores the ticket and nothing else. LD-2 adds the farmer-confirmed effects (a bin
-- movement, a contract delivery, a harvest contribution) inside save_grain_load's transaction
-- and teaches void_grain_load to reverse them. The void result already carries the shape LD-2
-- needs -- a status and a list of later movements that block a void -- so the browser does not
-- have to learn a second answer later.

create table public.grain_loads (
  id uuid primary key,
  farm_id uuid not null references public.farms(id) on delete cascade,
  load_date date not null,

  -- A truck is either one of the farm's Equipment assets or a name typed on the spot
  -- (a hired truck, a neighbour's). Never both, and a ticket may name no truck at all.
  truck_equipment_id uuid,
  truck_name text check (truck_name is null or length(btrim(truck_name)) between 1 and 200),

  -- Where the grain came from. A field origin means the load is coming off the combine or
  -- the cart; a bin origin means it is coming out of storage.
  origin_kind text not null check (origin_kind in ('bin', 'field')),
  origin_grain_bin_id uuid,
  origin_crop_assignment_id uuid,

  -- Where it went. 'buyer' is a free-text elevator with no contract behind it yet.
  destination_kind text not null check (destination_kind in ('buyer', 'contract', 'bin')),
  destination_buyer text check (destination_buyer is null or length(btrim(destination_buyer)) between 1 and 200),
  destination_grain_contract_id uuid,
  destination_grain_bin_id uuid,

  -- The commodity and crop year of the grain on this truck. A field origin takes both from the
  -- crop assignment; a bin origin takes them from the bin's lot. Neither is ever guessed, so a
  -- load can never silently move carry-over grain against a current-year contract.
  commodity_id text not null references public.commodities(id) on delete restrict,
  crop_year integer not null check (crop_year between 1900 and 2200),

  -- Scale weights are what the ticket prints. Bushels are what the farm counts, so net bushels
  -- is the required figure and the weights are kept as the evidence behind it.
  gross_lbs numeric(16, 2) check (gross_lbs is null or gross_lbs > 0),
  tare_lbs numeric(16, 2) check (tare_lbs is null or tare_lbs > 0),
  net_bushels numeric(16, 2) not null check (net_bushels > 0),
  moisture_pct numeric(5, 2) check (moisture_pct is null or (moisture_pct >= 0 and moisture_pct <= 100)),
  ticket_number text check (ticket_number is null or length(btrim(ticket_number)) between 1 and 120),
  photo_path text check (photo_path is null or length(btrim(photo_path)) between 1 and 400),
  notes text check (notes is null or length(btrim(notes)) between 1 and 4000),

  -- Append-only with void-and-reason, matching the bin ledger. A voided load keeps its row.
  voided_at timestamptz,
  void_reason text check (void_reason is null or length(btrim(void_reason)) between 3 and 2000),
  voided_by uuid,

  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (id, farm_id),

  constraint grain_loads_truck_one_way check (truck_equipment_id is null or truck_name is null),
  constraint grain_loads_origin_shape check (
    (origin_kind = 'bin' and origin_grain_bin_id is not null and origin_crop_assignment_id is null)
    or (origin_kind = 'field' and origin_crop_assignment_id is not null and origin_grain_bin_id is null)
  ),
  constraint grain_loads_destination_shape check (
    (destination_kind = 'buyer'
      and destination_buyer is not null
      and destination_grain_contract_id is null and destination_grain_bin_id is null)
    or (destination_kind = 'contract'
      and destination_grain_contract_id is not null
      and destination_buyer is null and destination_grain_bin_id is null)
    or (destination_kind = 'bin'
      and destination_grain_bin_id is not null
      and destination_buyer is null and destination_grain_contract_id is null)
  ),
  -- Grain cannot be hauled from a bin back into the same bin.
  constraint grain_loads_not_a_round_trip check (
    origin_grain_bin_id is null
    or destination_grain_bin_id is null
    or origin_grain_bin_id <> destination_grain_bin_id
  ),
  -- Tare is the empty truck, so it is always lighter than the loaded one.
  constraint grain_loads_weights_order check (
    gross_lbs is null or tare_lbs is null or gross_lbs > tare_lbs
  ),
  -- A void carries its reason and its moment together or not at all.
  constraint grain_loads_void_shape check (
    (voided_at is null and void_reason is null)
    or (voided_at is not null and void_reason is not null)
  ),

  constraint grain_loads_truck_same_farm_fk
    foreign key (truck_equipment_id, farm_id)
    references public.equipment(id, farm_id) on delete restrict,
  constraint grain_loads_origin_bin_same_farm_fk
    foreign key (origin_grain_bin_id, farm_id)
    references public.grain_bins(id, farm_id) on delete restrict,
  constraint grain_loads_destination_bin_same_farm_fk
    foreign key (destination_grain_bin_id, farm_id)
    references public.grain_bins(id, farm_id) on delete restrict,
  constraint grain_loads_origin_crop_same_farm_fk
    foreign key (origin_crop_assignment_id, farm_id)
    references public.crop_assignments(id, farm_id) on delete restrict,
  constraint grain_loads_destination_contract_same_farm_fk
    foreign key (destination_grain_contract_id, farm_id)
    references public.grain_contracts(id, farm_id) on delete restrict
);

create index grain_loads_farm_date_idx on public.grain_loads (farm_id, load_date desc, created_at desc);
create index grain_loads_contract_idx on public.grain_loads (farm_id, destination_grain_contract_id) where destination_grain_contract_id is not null;
create index grain_loads_origin_bin_idx on public.grain_loads (farm_id, origin_grain_bin_id) where origin_grain_bin_id is not null;
create index grain_loads_crop_assignment_idx on public.grain_loads (farm_id, origin_crop_assignment_id) where origin_crop_assignment_id is not null;

alter table public.grain_loads enable row level security;
revoke all on public.grain_loads from public, anon;
grant select on public.grain_loads to authenticated;
-- A scale ticket carries the farm's bushels and the buyer it sold them to, which is private
-- financial data under the same fence as contracts and deliveries.
create policy grain_loads_select on public.grain_loads
  for select to authenticated using (public.can_read_private_financials(farm_id));
-- No insert, update or delete grant: the only writers are the definer RPCs below.

-- Access-epoch fencing (migration 0040): every farm-scoped table answers "is this request's view
-- of its own farm access still current", separately from whether the caller can edit the farm.
create trigger farm_access_epoch_guard
before insert or update or delete on public.grain_loads
for each row execute function public.guard_row_farm_access_epoch();

-- Append-only: a saved ticket is evidence, so the only change it may ever accept is the one-way
-- transition into voided, and only through void_grain_load. Like grain_contract_audit this
-- deliberately does not cover DELETE, because farm_id cascades from farms and a raising
-- BEFORE DELETE trigger would make deleting a farm impossible.
create function public.grain_loads_append_only()
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
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at then
    raise exception 'a load record cannot be edited; void it and record the correct one';
  end if;
  if new.voided_at is null then
    raise exception 'a load record cannot be edited; void it and record the correct one';
  end if;
  return new;
end $$;

create trigger grain_loads_append_only
before update on public.grain_loads
for each row execute function public.grain_loads_append_only();

-- The only way to record a load.
--
-- Idempotent on the client-supplied id: a retry after a lost response returns the saved row
-- rather than a second ticket, and an id reused for different content is refused by name. The
-- commodity and crop year are DERIVED here rather than trusted, because a load that guessed
-- between carry-over and current-year grain of the same commodity would corrupt every
-- year-specific figure downstream. When the browser sends a value that disagrees with what the
-- origin says, this raises instead of quietly preferring one -- two evaluators of one fact is
-- the defect, not the disagreement.
create function public.save_grain_load(p_farm_id uuid, p_load jsonb)
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
      -- The bin's baseline names the one lot the schema can identify today. LD-2 stamps a crop
      -- year on every bin movement, and only then can one bin hold more than one nameable lot.
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
    -- Carry-over grain is never charged against a current-year contract, and a contract for one
    -- crop never absorbs another.
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
       and v_existing.net_bushels = v_net then
      return to_jsonb(v_existing);
    end if;
    raise exception using errcode = 'P0001', message = 'FARM_RX_LOAD_ID_REUSED';
  end if;

  insert into public.grain_loads (
    id, farm_id, load_date, truck_equipment_id, truck_name,
    origin_kind, origin_grain_bin_id, origin_crop_assignment_id,
    destination_kind, destination_buyer, destination_grain_contract_id, destination_grain_bin_id,
    commodity_id, crop_year, gross_lbs, tare_lbs, net_bushels, moisture_pct,
    ticket_number, photo_path, notes, created_by
  ) values (
    v_id, p_farm_id, v_load_date, v_truck_equipment, v_truck_name,
    v_origin_kind, v_origin_bin, v_origin_crop,
    v_destination_kind, v_destination_buyer, v_destination_contract, v_destination_bin,
    v_commodity, v_crop_year, v_gross, v_tare, v_net, v_moisture,
    v_ticket, v_photo, v_notes, auth.uid()
  ) returning * into v_saved;

  return to_jsonb(v_saved);
end $$;

revoke all on function public.save_grain_load(uuid, jsonb) from public, anon;
grant execute on function public.save_grain_load(uuid, jsonb) to authenticated;

-- Voiding a load, transactional and idempotent.
--
-- LD-1 loads create no other rows, so there is nothing yet to reverse and no later movement that
-- can block a void. The result already carries both -- a status and a blocked_by list -- because
-- LD-2 gives the load its effects, and the browser should not have to learn a second answer
-- shape then. A repeat void with the same reason replays; the same load with a different reason
-- is refused by name rather than silently overwriting the first reason on the record.
create function public.void_grain_load(p_farm_id uuid, p_load_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_load public.grain_loads%rowtype;
  v_reason text := nullif(btrim(p_reason), '');
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

  if v_load.voided_at is not null then
    if v_load.void_reason is not distinct from v_reason then
      return jsonb_build_object('status', 'voided', 'load', to_jsonb(v_load), 'blocked_by', '[]'::jsonb);
    end if;
    raise exception using errcode = 'P0001', message = 'FARM_RX_LOAD_ALREADY_VOIDED';
  end if;

  update public.grain_loads
     set voided_at = now(), void_reason = v_reason, voided_by = auth.uid(), updated_at = now()
   where id = p_load_id and farm_id = p_farm_id
  returning * into v_load;

  return jsonb_build_object('status', 'voided', 'load', to_jsonb(v_load), 'blocked_by', '[]'::jsonb);
end $$;

revoke all on function public.void_grain_load(uuid, uuid, text) from public, anon;
grant execute on function public.void_grain_load(uuid, uuid, text) to authenticated;
