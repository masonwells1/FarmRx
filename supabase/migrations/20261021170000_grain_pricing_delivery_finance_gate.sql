-- Grain trust repair: setting a price leg and recording a delivery require financial access.
--
-- Both functions are security definer and checked only can_edit_farm, which admits a worker. Grain
-- itself is behind can_read_private_financials, so a worker without financial access who still had
-- a contract's id (from earlier access or a cached page) could reach past row-level security, set a
-- contract's missing price leg or reduce what is still owed on it, and read the private contract
-- back. GL-3 closed this exact gap for edit and delete; save_grain_load and void_grain_load already
-- require both fences. These two were missed.
--
-- Each function is replaced with its current body (finalize from 0033, delivery from LD-2). The only
-- changes are the second fence and, on finalize, refusing a contract that is not a basis or HTA
-- contract: a cash or purchase contract is priced when it is written and has no leg to finish.
-- The stored cash_price still includes the premium; the client prices a finished basis or HTA
-- contract from its two legs and never adds the premium to cash_price again.

create or replace function public.finalize_contract_price_leg(p_farm_id uuid, p_contract_id uuid, p_leg text, p_value numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_contract public.grain_contracts%rowtype;
begin
  if auth.uid() is null or not public.can_edit_farm(p_farm_id) or not public.can_read_private_financials(p_farm_id) then
    raise exception 'you do not have permission to finalize this price';
  end if;
  if p_leg not in ('futures_price', 'basis') or p_value is null or p_value::text in ('NaN', 'Infinity', '-Infinity') then raise exception 'price must be finite'; end if;
  if p_leg = 'futures_price' and p_value <= 0 then raise exception 'futures price must be greater than zero'; end if;
  select * into v_contract from public.grain_contracts where id = p_contract_id and farm_id = p_farm_id for update;
  if not found then raise exception 'contract does not belong to this farm'; end if;
  if v_contract.contract_type not in ('basis', 'hta') then raise exception 'only a basis or HTA contract has a price leg to finalize'; end if;
  if (p_leg = 'futures_price' and v_contract.futures_price is not null) or (p_leg = 'basis' and v_contract.basis is not null) then raise exception 'this price leg is already finalized'; end if;
  if p_leg = 'futures_price' and v_contract.basis is null then raise exception 'basis must be set before finalizing futures price'; end if;
  if p_leg = 'basis' and v_contract.futures_price is null then raise exception 'futures price must be set before finalizing basis'; end if;
  perform set_config('farmrx.finalizing_contract_id', p_contract_id::text, true);
  update public.grain_contracts set futures_price = case when p_leg = 'futures_price' then p_value else futures_price end, basis = case when p_leg = 'basis' then p_value else basis end, cash_price = coalesce(case when p_leg = 'futures_price' then p_value else futures_price end, 0) + coalesce(case when p_leg = 'basis' then p_value else basis end, 0) + premium_cents_per_bu / 100, updated_at = now() where id = p_contract_id and farm_id = p_farm_id returning * into v_contract;
  return to_jsonb(v_contract);
end $$;
revoke all on function public.finalize_contract_price_leg(uuid, uuid, text, numeric) from public, anon;
grant execute on function public.finalize_contract_price_leg(uuid, uuid, text, numeric) to authenticated;

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
  if auth.uid() is null or not public.can_edit_farm(p_farm_id) or not public.can_read_private_financials(p_farm_id) then
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
