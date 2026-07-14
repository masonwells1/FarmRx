-- DRAFT ONLY -- grain-risk repair. Do not apply without a reviewed release.
-- Existing >85% records remain readable (and are blocked by the client) so this
-- constraint is NOT VALID; every new or changed row must use individual RP 50-85.
alter table public.crop_budgets
  drop constraint if exists crop_budgets_rp_coverage_pct_range,
  add constraint crop_budgets_rp_coverage_pct_range
    check (rp_coverage_pct is null or rp_coverage_pct in (50, 55, 60, 65, 70, 75, 80, 85)) not valid;

alter table public.insurance_units
  drop constraint if exists insurance_units_individual_rp_coverage_pct_range,
  add constraint insurance_units_individual_rp_coverage_pct_range
    check (coverage_level_pct in (50, 55, 60, 65, 70, 75, 80, 85)) not valid;

-- One contract can originate from one offer only. The unique index is the
-- database idempotency guard for retries after a lost RPC response.
alter table public.grain_contracts
  add column if not exists firm_offer_id uuid;

alter table public.grain_contracts
  drop constraint if exists grain_contracts_firm_offer_fk;

create unique index if not exists firm_offers_id_farm_id_idx
  on public.firm_offers (id, farm_id);

alter table public.grain_contracts
  add constraint grain_contracts_firm_offer_fk
    foreign key (firm_offer_id, farm_id) references public.firm_offers(id, farm_id) on delete restrict;

create unique index if not exists grain_contracts_one_per_firm_offer_idx
  on public.grain_contracts (firm_offer_id)
  where firm_offer_id is not null;

-- SECURITY INVOKER keeps table RLS in force. The explicit can_edit_farm check
-- makes the intended farm-membership requirement clear before rows are locked.
create or replace function public.fill_firm_offer(
  p_offer_id uuid,
  p_contract jsonb,
  p_local_date date default null
) returns jsonb
language plpgsql
security invoker
set search_path = public, auth
as $$
declare
  v_offer public.firm_offers%rowtype;
  v_contract public.grain_contracts%rowtype;
begin
  if auth.uid() is null or p_offer_id is null or jsonb_typeof(p_contract) <> 'object' then
    raise exception 'authentication, an offer, and contract details are required';
  end if;

  select * into v_offer
  from public.firm_offers
  where id = p_offer_id
  for update;
  if not found then
    raise exception 'firm offer was not found';
  end if;
  if not public.can_edit_farm(v_offer.farm_id) then
    raise exception 'you do not have permission to edit this farm';
  end if;

  -- A replay after a timeout returns the original pair; it never creates a
  -- second contract, even if the caller supplied a different contract UUID.
  if v_offer.status = 'filled' and v_offer.filled_contract_id is not null then
    select * into v_contract from public.grain_contracts where id = v_offer.filled_contract_id;
    if not found then raise exception 'filled offer is missing its contract'; end if;
    return jsonb_build_object('contract', to_jsonb(v_contract), 'offer', to_jsonb(v_offer));
  end if;
  if v_offer.status <> 'open' then raise exception 'firm offer is no longer open'; end if;
  -- An offer is valid through expires_on in farm-local time. Accept a client
  -- local date only when it is within one day of the database calendar.
  if v_offer.expires_on is not null and v_offer.expires_on < (case when p_local_date is not null and abs(p_local_date - current_date) <= 1 then p_local_date else current_date end) then
    raise exception 'firm offer has expired';
  end if;

  insert into public.grain_contracts (
    id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label,
    contract_type, buyer, bushels, futures_price, basis, cash_price,
    delivery_start, delivery_end, contract_number, premium_cents_per_bu, notes,
    firm_offer_id
  ) values (
    coalesce(nullif(p_contract ->> 'id', '')::uuid, gen_random_uuid()),
    v_offer.farm_id, v_offer.crop_year, v_offer.commodity_id,
    v_offer.operating_entity_id, v_offer.enterprise_label,
    (p_contract ->> 'contract_type')::public.grain_contract_type,
    btrim(p_contract ->> 'buyer'), (p_contract ->> 'bushels')::numeric,
    nullif(p_contract ->> 'futures_price', '')::numeric,
    nullif(p_contract ->> 'basis', '')::numeric,
    nullif(p_contract ->> 'cash_price', '')::numeric,
    nullif(p_contract ->> 'delivery_start', '')::date,
    nullif(p_contract ->> 'delivery_end', '')::date,
    nullif(p_contract ->> 'contract_number', ''),
    coalesce(nullif(p_contract ->> 'premium_cents_per_bu', '')::numeric, 0),
    nullif(p_contract ->> 'notes', ''), p_offer_id
  ) on conflict (firm_offer_id) where firm_offer_id is not null do nothing
  returning * into v_contract;

  if not found then
    select * into v_contract from public.grain_contracts where firm_offer_id = p_offer_id;
  end if;
  if not found then raise exception 'could not create the firm-offer contract'; end if;

  update public.firm_offers
  set status = 'filled', filled_contract_id = v_contract.id, updated_at = now()
  where id = v_offer.id
  returning * into v_offer;

  return jsonb_build_object('contract', to_jsonb(v_contract), 'offer', to_jsonb(v_offer));
end;
$$;

revoke all on function public.fill_firm_offer(uuid, jsonb, date) from public, anon;
grant execute on function public.fill_firm_offer(uuid, jsonb, date) to authenticated;
