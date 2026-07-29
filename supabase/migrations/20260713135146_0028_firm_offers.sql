-- APPLIED to the farm-rx Supabase project 2026-07-13 with Mason's explicit OK.
-- PostgreSQL 17 / Supabase.
-- Depends on 0004 (grain contracts and PositionScope), 0005 (grain RLS),
-- and 0008 (can_read_private_financials employee privacy).

create type public.firm_offer_type as enum (
  'cash',
  'basis',
  'hta'
);

create type public.firm_offer_status as enum (
  'open',
  'filled',
  'expired',
  'canceled'
);

-- A firm offer is pending grain, not a completed sale. If it fills, the
-- optional same-farm contract link records the contract created from it.
create table public.firm_offers (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  crop_year integer not null check (crop_year between 1900 and 2200),
  commodity_id text not null references public.commodities(id) on delete restrict,
  operating_entity_id uuid,
  enterprise_label text
    check (enterprise_label is null or length(btrim(enterprise_label)) between 1 and 160),
  buyer text not null check (length(btrim(buyer)) between 1 and 200),
  offer_type public.firm_offer_type not null,
  bushels numeric(16, 2) not null check (bushels > 0),
  price numeric(12, 6) check (price is null or price >= 0),
  basis numeric(12, 6),
  contract_month text
    check (contract_month is null or length(btrim(contract_month)) between 1 and 80),
  expires_on date,
  delivery_location text
    check (delivery_location is null or length(btrim(delivery_location)) between 1 and 200),
  notes text
    check (notes is null or length(btrim(notes)) between 1 and 4000),
  status public.firm_offer_status not null default 'open',
  filled_contract_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint firm_offers_entity_same_farm_fk
    foreign key (operating_entity_id, farm_id)
    references public.entities(id, farm_id)
    on delete restrict,
  constraint firm_offers_filled_contract_same_farm_fk
    foreign key (filled_contract_id, farm_id)
    references public.grain_contracts(id, farm_id)
    on delete set null (filled_contract_id),
  constraint firm_offers_price_by_type check (
    (offer_type = 'cash' and price is not null)
    or (offer_type = 'basis' and basis is not null)
    or (offer_type = 'hta' and price is not null)
  ),
  constraint firm_offers_filled_contract_status check (
    filled_contract_id is null or status = 'filled'
  )
);

create index firm_offers_farm_scope_idx
  on public.firm_offers (farm_id, crop_year, commodity_id);
create index firm_offers_entity_farm_idx
  on public.firm_offers (operating_entity_id, farm_id);
create index firm_offers_status_expiry_idx
  on public.firm_offers (farm_id, status, expires_on);
create index firm_offers_filled_contract_idx
  on public.firm_offers (filled_contract_id, farm_id)
  where filled_contract_id is not null;

create trigger firm_offers_set_updated_at
before update on public.firm_offers
for each row execute function public.set_updated_at();

create trigger firm_offers_prevent_farm_move
before update on public.firm_offers
for each row execute function public.prevent_farm_id_change();

alter table public.firm_offers enable row level security;

revoke all on table public.firm_offers from anon;

grant select, insert, update, delete on table public.firm_offers to authenticated;

create policy firm_offers_select
on public.firm_offers for select to authenticated
using (
  public.can_read_private_financials(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = firm_offers.farm_id
    )
  )
);

create policy firm_offers_insert
on public.firm_offers for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = firm_offers.farm_id
    )
  )
);

create policy firm_offers_update
on public.firm_offers for update to authenticated
using (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = firm_offers.farm_id
    )
  )
)
with check (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = firm_offers.farm_id
    )
  )
);

create policy firm_offers_delete
on public.firm_offers for delete to authenticated
using (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = firm_offers.farm_id
    )
  )
);
