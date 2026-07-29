-- DRAFT ONLY. Never applied by this repair; it is revalidated in disposable Postgres.
-- Bin and delivery writes are RPC-only so the database, not a stale browser read,
-- decides capacity, commodity, and contract-delivery limits.

create table public.grain_contract_deliveries (
  id uuid primary key,
  farm_id uuid not null references public.farms(id) on delete cascade,
  grain_contract_id uuid not null,
  bushels numeric(16,2) not null check (bushels > 0),
  delivered_on date not null,
  note text check (note is null or length(btrim(note)) between 1 and 4000),
  created_at timestamptz not null default now(),
  unique (id, farm_id),
  foreign key (grain_contract_id, farm_id) references public.grain_contracts(id, farm_id) on delete restrict
);
create index grain_contract_deliveries_contract_idx on public.grain_contract_deliveries (grain_contract_id, farm_id, delivered_on);
alter table public.grain_contract_deliveries enable row level security;
revoke all on public.grain_contract_deliveries from anon;
grant select on public.grain_contract_deliveries to authenticated;
create policy grain_contract_deliveries_select on public.grain_contract_deliveries for select to authenticated using (public.can_read_private_financials(farm_id));

-- Direct authenticated inserts bypass the row locks below, so remove the old
-- append path entirely. SELECT stays available for the ledger display.
revoke insert on public.bin_transactions from authenticated;
drop policy if exists bin_transactions_insert on public.bin_transactions;

create function public.prevent_finalized_contract_price_change()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  -- New contracts are still inserted normally.  Once a basis/HTA row exists,
  -- only the definer CAS RPC below may alter one of its pricing columns.
  if (old.contract_type in ('basis', 'hta') or new.contract_type in ('basis', 'hta'))
     and (new.contract_type is distinct from old.contract_type
       or new.futures_price is distinct from old.futures_price
       or new.basis is distinct from old.basis
       or new.cash_price is distinct from old.cash_price
       or new.premium_cents_per_bu is distinct from old.premium_cents_per_bu)
     and current_setting('farmrx.finalizing_contract_id', true) is distinct from old.id::text then
    raise exception 'basis and HTA pricing can only be finalized through the price-finalization action';
  end if;
  return new;
end $$;
create trigger grain_contracts_prevent_finalized_price_change before update on public.grain_contracts for each row execute function public.prevent_finalized_contract_price_change();

create function public.finalize_contract_price_leg(p_farm_id uuid, p_contract_id uuid, p_leg text, p_value numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_contract public.grain_contracts%rowtype;
begin
  if auth.uid() is null or not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to finalize this price'; end if;
  if p_leg not in ('futures_price', 'basis') or p_value is null or p_value::text in ('NaN', 'Infinity', '-Infinity') then raise exception 'price must be finite'; end if;
  if p_leg = 'futures_price' and p_value <= 0 then raise exception 'futures price must be greater than zero'; end if;
  select * into v_contract from public.grain_contracts where id = p_contract_id and farm_id = p_farm_id for update;
  if not found then raise exception 'contract does not belong to this farm'; end if;
  if (p_leg = 'futures_price' and v_contract.futures_price is not null) or (p_leg = 'basis' and v_contract.basis is not null) then raise exception 'this price leg is already finalized'; end if;
  if p_leg = 'futures_price' and v_contract.basis is null then raise exception 'basis must be set before finalizing futures price'; end if;
  if p_leg = 'basis' and v_contract.futures_price is null then raise exception 'futures price must be set before finalizing basis'; end if;
  perform set_config('farmrx.finalizing_contract_id', p_contract_id::text, true);
  update public.grain_contracts set futures_price = case when p_leg = 'futures_price' then p_value else futures_price end, basis = case when p_leg = 'basis' then p_value else basis end, cash_price = coalesce(case when p_leg = 'futures_price' then p_value else futures_price end, 0) + coalesce(case when p_leg = 'basis' then p_value else basis end, 0) + premium_cents_per_bu / 100, updated_at = now() where id = p_contract_id and farm_id = p_farm_id returning * into v_contract;
  return to_jsonb(v_contract);
end $$;
revoke all on function public.finalize_contract_price_leg(uuid, uuid, text, numeric) from public, anon;
grant execute on function public.finalize_contract_price_leg(uuid, uuid, text, numeric) to authenticated;

create function public.append_bin_movement(p_farm_id uuid, p_transaction jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_bin public.grain_bins%rowtype; v_inventory public.bin_inventory%rowtype; v_has_inventory boolean := false; v_id uuid; v_bin_id uuid; v_direction public.bin_transaction_direction; v_bushels numeric; v_commodity text; v_on date; v_note text; v_source text; v_lot_balance numeric; v_total_balance numeric; v_active_lots text[]; v_existing public.bin_transactions%rowtype; v_saved public.bin_transactions%rowtype;
begin
  if auth.uid() is null or not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to add a bin movement'; end if;
  v_id := (p_transaction->>'id')::uuid; v_bin_id := (p_transaction->>'grain_bin_id')::uuid; v_direction := (p_transaction->>'direction')::public.bin_transaction_direction; v_bushels := (p_transaction->>'bushels')::numeric; v_commodity := nullif(btrim(p_transaction->>'commodity_id'), ''); v_on := (p_transaction->>'occurred_on')::date; v_note := nullif(btrim(p_transaction->>'note'), ''); v_source := nullif(btrim(p_transaction->>'source_kind'), '');
  if v_id is null or v_commodity is null or v_on is null or v_bushels is null or v_bushels <= 0 then raise exception 'movement details are required'; end if;
  select * into v_bin from public.grain_bins where id = v_bin_id and farm_id = p_farm_id for update;
  if not found then raise exception 'bin does not belong to this farm'; end if;
  select * into v_existing from public.bin_transactions where id = v_id for update;
  if found then
    if v_existing.farm_id = p_farm_id and v_existing.grain_bin_id = v_bin_id and v_existing.direction = v_direction and v_existing.bushels = v_bushels and v_existing.commodity_id = v_commodity and v_existing.occurred_on = v_on and v_existing.note is not distinct from v_note and v_existing.source_kind is not distinct from v_source then return to_jsonb(v_existing); end if;
    raise exception 'movement id was already used with different content';
  end if;
  select * into v_inventory from public.bin_inventory where grain_bin_id = v_bin_id and farm_id = p_farm_id;
  v_has_inventory := found;
  if v_has_inventory and v_on <= v_inventory.measured_at::date then raise exception 'movement date must be after the latest bin baseline'; end if;
  select array_agg(commodity_id order by commodity_id) into v_active_lots from (
    select lots.commodity_id, coalesce(max(case when v_has_inventory and v_inventory.commodity_id = lots.commodity_id then v_inventory.bushels else 0 end), 0) + coalesce(sum(case when t.direction = 'in' then t.bushels else -t.bushels end), 0) as balance
    from (select commodity_id from public.bin_transactions where grain_bin_id = v_bin_id and farm_id = p_farm_id union select v_inventory.commodity_id where v_has_inventory) lots
    left join public.bin_transactions t on t.commodity_id = lots.commodity_id and t.grain_bin_id = v_bin_id and t.farm_id = p_farm_id and (not v_has_inventory or t.commodity_id <> v_inventory.commodity_id or t.occurred_on > v_inventory.measured_at::date)
    group by lots.commodity_id
  ) active where abs(balance) > 0.000001;
  if coalesce(array_length(v_active_lots, 1), 0) > 0 and not v_commodity = any(v_active_lots) then raise exception 'this bin still holds nonzero lots: %; empty those lots before storing another crop', array_to_string(v_active_lots, ', '); end if;
  select coalesce(case when v_has_inventory and v_inventory.commodity_id = v_commodity then v_inventory.bushels else 0 end, 0) + coalesce(sum(case when direction = 'in' then bushels else -bushels end), 0) into v_lot_balance from public.bin_transactions where grain_bin_id = v_bin_id and farm_id = p_farm_id and commodity_id = v_commodity and (not v_has_inventory or commodity_id <> v_inventory.commodity_id or occurred_on > v_inventory.measured_at::date);
  v_lot_balance := v_lot_balance + case when v_direction = 'in' then v_bushels else -v_bushels end;
  if v_lot_balance < 0 then raise exception 'this movement would make the bin balance negative'; end if;
  select coalesce(sum(balance), 0) into v_total_balance from (
    select lots.commodity_id, coalesce(max(case when v_has_inventory and v_inventory.commodity_id = lots.commodity_id then v_inventory.bushels else 0 end), 0) + coalesce(sum(case when t.direction = 'in' then t.bushels else -t.bushels end), 0) as balance
    from (select commodity_id from public.bin_transactions where grain_bin_id = v_bin_id and farm_id = p_farm_id union select v_inventory.commodity_id where v_has_inventory union select v_commodity) lots
    left join public.bin_transactions t on t.commodity_id = lots.commodity_id and t.grain_bin_id = v_bin_id and t.farm_id = p_farm_id and (not v_has_inventory or t.commodity_id <> v_inventory.commodity_id or t.occurred_on > v_inventory.measured_at::date)
    group by lots.commodity_id
  ) balances;
  v_total_balance := v_total_balance + case when v_direction = 'in' then v_bushels else -v_bushels end;
  if v_total_balance > v_bin.capacity_bu then raise exception 'this movement would put more grain in the bin than it holds'; end if;
  begin
    insert into public.bin_transactions (id, farm_id, grain_bin_id, direction, bushels, commodity_id, occurred_on, note, source_kind) values (v_id, p_farm_id, v_bin_id, v_direction, v_bushels, v_commodity, v_on, v_note, v_source) returning * into v_saved;
  exception when unique_violation then
    select * into v_existing from public.bin_transactions where id = v_id;
    if found and v_existing.farm_id = p_farm_id and v_existing.grain_bin_id = v_bin_id and v_existing.direction = v_direction and v_existing.bushels = v_bushels and v_existing.commodity_id = v_commodity and v_existing.occurred_on = v_on and v_existing.note is not distinct from v_note and v_existing.source_kind is not distinct from v_source then return to_jsonb(v_existing); end if;
    raise exception 'movement id was already used with different content';
  end;
  return to_jsonb(v_saved);
end $$;
revoke all on function public.append_bin_movement(uuid, jsonb) from public, anon;
grant execute on function public.append_bin_movement(uuid, jsonb) to authenticated;

create function public.record_grain_contract_delivery(p_farm_id uuid, p_delivery jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_contract public.grain_contracts%rowtype; v_id uuid := (p_delivery->>'id')::uuid; v_contract_id uuid := (p_delivery->>'grain_contract_id')::uuid; v_bushels numeric := (p_delivery->>'bushels')::numeric; v_on date := (p_delivery->>'delivered_on')::date; v_note text := nullif(btrim(p_delivery->>'note'), ''); v_allow boolean := coalesce((p_delivery->>'allow_overdelivery')::boolean, false); v_existing public.grain_contract_deliveries%rowtype; v_saved public.grain_contract_deliveries%rowtype; v_prior numeric;
begin
  if auth.uid() is null or not public.can_edit_farm(p_farm_id) then raise exception 'you do not have permission to record a delivery'; end if;
  if v_id is null or v_contract_id is null or v_on is null or v_bushels is null or v_bushels <= 0 then raise exception 'delivered bushels must be greater than zero'; end if;
  select * into v_contract from public.grain_contracts where id = v_contract_id and farm_id = p_farm_id for update;
  if not found then raise exception 'contract does not belong to this farm'; end if;
  select * into v_existing from public.grain_contract_deliveries where id = v_id for update;
  if found then if v_existing.farm_id = p_farm_id and v_existing.grain_contract_id = v_contract_id and v_existing.bushels = v_bushels and v_existing.delivered_on = v_on and v_existing.note is not distinct from v_note then return to_jsonb(v_existing); end if; raise exception 'delivery id was already used with different content'; end if;
  select coalesce(sum(bushels), 0) into v_prior from public.grain_contract_deliveries where grain_contract_id = v_contract_id and farm_id = p_farm_id;
  if v_prior + v_bushels > v_contract.bushels and not v_allow then raise exception 'delivery would exceed the remaining contract bushels; confirm over-delivery to record it'; end if;
  begin
    insert into public.grain_contract_deliveries (id, farm_id, grain_contract_id, bushels, delivered_on, note) values (v_id, p_farm_id, v_contract_id, v_bushels, v_on, v_note) returning * into v_saved;
  exception when unique_violation then
    select * into v_existing from public.grain_contract_deliveries where id = v_id;
    if found and v_existing.farm_id = p_farm_id and v_existing.grain_contract_id = v_contract_id and v_existing.bushels = v_bushels and v_existing.delivered_on = v_on and v_existing.note is not distinct from v_note then return to_jsonb(v_existing); end if;
    raise exception 'delivery id was already used with different content';
  end;
  return to_jsonb(v_saved);
end $$;
revoke all on function public.record_grain_contract_delivery(uuid, jsonb) from public, anon;
grant execute on function public.record_grain_contract_delivery(uuid, jsonb) to authenticated;
