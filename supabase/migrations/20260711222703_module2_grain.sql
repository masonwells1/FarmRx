-- DRAFT ONLY -- Module 2 (Grain) foundation for Farm Rx.
-- PostgreSQL 17 / Supabase. Review before applying to any database.

create type public.production_math_basis as enum (
  'projected',
  'actual'
);

create type public.grain_contract_type as enum (
  'cash_spot',
  'forward_cash',
  'basis',
  'hta'
);

create type public.grain_storage_location_type as enum (
  'on_farm',
  'commercial'
);

-- One private position line per crop year, commodity, optional operating
-- entity, and optional named crop enterprise. Projected and actual production
-- are deliberately stored side by side and never overwrite one another.
create table public.production_estimates (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  crop_year integer not null check (crop_year between 1900 and 2200),
  commodity_id text not null references public.commodities(id) on delete restrict,
  operating_entity_id uuid,
  enterprise_label text
    check (enterprise_label is null or length(btrim(enterprise_label)) between 1 and 160),
  planted_acres numeric(12, 2)
    check (planted_acres is null or (planted_acres >= 0 and planted_acres <= 1000000)),
  aph_yield numeric(12, 4) not null check (aph_yield > 0),
  expected_bushels numeric(16, 2) not null check (expected_bushels >= 0),
  actual_bushels numeric(16, 2) check (actual_bushels is null or actual_bushels >= 0),
  drives_math public.production_math_basis not null default 'projected',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint production_estimates_entity_same_farm_fk
    foreign key (operating_entity_id, farm_id)
    references public.entities(id, farm_id)
    on delete restrict,
  constraint production_estimates_actual_available check (
    drives_math = 'projected' or actual_bushels is not null
  )
);

-- NULLS NOT DISTINCT makes a whole-farm/no-enterprise line unique too; plain
-- PostgreSQL UNIQUE would otherwise allow duplicate rows containing NULL.
alter table public.production_estimates
  add constraint production_estimates_scope_unique
  unique nulls not distinct (
    farm_id,
    crop_year,
    commodity_id,
    operating_entity_id,
    enterprise_label
  );

create table public.grain_contracts (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  crop_year integer not null check (crop_year between 1900 and 2200),
  commodity_id text not null references public.commodities(id) on delete restrict,
  operating_entity_id uuid,
  enterprise_label text
    check (enterprise_label is null or length(btrim(enterprise_label)) between 1 and 160),
  contract_type public.grain_contract_type not null,
  buyer text not null check (length(btrim(buyer)) between 1 and 200),
  bushels numeric(16, 2) not null check (bushels > 0),
  futures_price numeric(12, 6) check (futures_price is null or futures_price >= 0),
  basis numeric(12, 6),
  cash_price numeric(12, 6) check (cash_price is null or cash_price >= 0),
  delivery_start date,
  delivery_end date,
  contract_number text,
  premium_cents_per_bu numeric(12, 4) not null default 0
    check (premium_cents_per_bu >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint grain_contracts_entity_same_farm_fk
    foreign key (operating_entity_id, farm_id)
    references public.entities(id, farm_id)
    on delete restrict,
  constraint grain_contracts_delivery_order check (
    delivery_end is null or delivery_start is null or delivery_end >= delivery_start
  ),
  constraint grain_contracts_price_by_type check (
    (contract_type in ('cash_spot', 'forward_cash') and cash_price is not null)
    or (contract_type = 'basis' and basis is not null)
    or (contract_type = 'hta' and futures_price is not null)
  )
);

-- A row is one cell in the primary Jan-Dec marketing-plan grid. Absolute
-- price, percent above/below breakeven, and deadline are independent optional
-- target signals; the planned percentage exists even when all three are NULL.
create table public.marketing_plan_targets (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  crop_year integer not null check (crop_year between 1900 and 2200),
  commodity_id text not null references public.commodities(id) on delete restrict,
  operating_entity_id uuid,
  enterprise_label text
    check (enterprise_label is null or length(btrim(enterprise_label)) between 1 and 160),
  target_month date not null,
  target_pct_of_production numeric(7, 4) not null
    check (target_pct_of_production > 0 and target_pct_of_production <= 100),
  target_price numeric(12, 6) check (target_price is null or target_price >= 0),
  breakeven_relative_pct numeric(8, 4),
  deadline date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint marketing_plan_targets_entity_same_farm_fk
    foreign key (operating_entity_id, farm_id)
    references public.entities(id, farm_id)
    on delete restrict,
  constraint marketing_plan_targets_month_start check (
    target_month = date_trunc('month', target_month)::date
  ),
  -- Marketing spans more than the crop year itself: new-crop sales are made
  -- the fall BEFORE, and stored grain is sold the spring/summer AFTER. Allow
  -- the year before through the year after the crop year.
  constraint marketing_plan_targets_year_matches check (
    extract(year from target_month)::integer between crop_year - 1 and crop_year + 1
  )
);

create table public.insurance_units (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  crop_year integer not null check (crop_year between 1900 and 2200),
  commodity_id text not null references public.commodities(id) on delete restrict,
  operating_entity_id uuid,
  enterprise_label text
    check (enterprise_label is null or length(btrim(enterprise_label)) between 1 and 160),
  unit_name text not null check (length(btrim(unit_name)) between 1 and 160),
  insured_acres numeric(12, 2) not null check (insured_acres > 0),
  aph numeric(12, 4) not null check (aph > 0),
  coverage_level_pct numeric(7, 4) not null
    check (coverage_level_pct > 0 and coverage_level_pct <= 100),
  revenue_guarantee_per_acre numeric(14, 4) not null
    check (revenue_guarantee_per_acre >= 0),
  guarantee_per_bu numeric(14, 6)
    generated always as (revenue_guarantee_per_acre / aph) stored,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  unique (farm_id, crop_year, commodity_id, unit_name),
  constraint insurance_units_entity_same_farm_fk
    foreign key (operating_entity_id, farm_id)
    references public.entities(id, farm_id)
    on delete restrict
);

create table public.grain_bins (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  capacity_bu numeric(16, 2) not null check (capacity_bu > 0),
  location_type public.grain_storage_location_type not null,
  location_name text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  unique (farm_id, name)
);

-- Commodity stays on the inventory row, not as a free-text bin attribute, so
-- identity-preserved white and Non-GMO grain cannot silently become yellow.
create table public.bin_inventory (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  grain_bin_id uuid not null,
  crop_year integer not null check (crop_year between 1900 and 2200),
  commodity_id text not null references public.commodities(id) on delete restrict,
  bushels numeric(16, 2) not null check (bushels >= 0),
  committed_bushels numeric(16, 2) not null default 0
    check (committed_bushels >= 0),
  measured_at timestamptz not null default now(),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  -- One current inventory identity per physical bin prevents two commodities
  -- from appearing segregated in software while sharing the same bin.
  unique (grain_bin_id),
  constraint bin_inventory_bin_same_farm_fk
    foreign key (grain_bin_id, farm_id)
    references public.grain_bins(id, farm_id)
    on delete cascade,
  constraint bin_inventory_commitment_within_balance check (
    committed_bushels <= bushels
  )
);

-- V1 basis and cash bids are entered manually. Each dated row remains in the
-- table, so basis history builds without a separate history-copy process.
create table public.cash_bids (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  elevator text not null check (length(btrim(elevator)) between 1 and 200),
  commodity_id text not null references public.commodities(id) on delete restrict,
  bid_date date not null,
  basis numeric(12, 6) not null,
  cash_price numeric(12, 6) check (cash_price is null or cash_price >= 0),
  delivery_start date,
  delivery_end date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint cash_bids_delivery_order check (
    delivery_end is null or delivery_start is null or delivery_end >= delivery_start
  )
);

-- Global public-calendar lookup only. It contains no farm data, positions, or
-- reminder preferences; future per-farm reminders belong in a private table.
create table public.usda_report_dates (
  id uuid primary key default gen_random_uuid(),
  report_name text not null check (length(btrim(report_name)) between 1 and 200),
  report_date date not null,
  release_at timestamptz,
  source_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (report_name, report_date)
);

create index production_estimates_farm_year_commodity_idx
  on public.production_estimates (farm_id, crop_year, commodity_id);
create index production_estimates_entity_farm_idx
  on public.production_estimates (operating_entity_id, farm_id);
create index grain_contracts_farm_year_commodity_idx
  on public.grain_contracts (farm_id, crop_year, commodity_id);
create index grain_contracts_entity_farm_idx
  on public.grain_contracts (operating_entity_id, farm_id);
create index grain_contracts_delivery_idx
  on public.grain_contracts (farm_id, delivery_start, delivery_end);
create index marketing_targets_farm_year_commodity_idx
  on public.marketing_plan_targets (farm_id, crop_year, commodity_id);
create index marketing_targets_month_idx
  on public.marketing_plan_targets (farm_id, target_month);
create index marketing_targets_entity_farm_idx
  on public.marketing_plan_targets (operating_entity_id, farm_id);
create index insurance_units_farm_year_commodity_idx
  on public.insurance_units (farm_id, crop_year, commodity_id);
create index insurance_units_entity_farm_idx
  on public.insurance_units (operating_entity_id, farm_id);
create index grain_bins_farm_id_idx on public.grain_bins (farm_id);
create index bin_inventory_bin_farm_idx
  on public.bin_inventory (grain_bin_id, farm_id);
create index bin_inventory_farm_commodity_idx
  on public.bin_inventory (farm_id, commodity_id, crop_year);
create index cash_bids_history_idx
  on public.cash_bids (farm_id, elevator, commodity_id, bid_date desc);
create index usda_report_dates_date_idx
  on public.usda_report_dates (report_date);

-- This view is intentionally SECURITY INVOKER: the caller's RLS policies on
-- insurance_units remain in force. Safe-to-forward is the insured production
-- floor (insured acres x APH x coverage percentage), not total production.
create view public.insurance_unit_guarantees
with (security_invoker = true)
as
select
  iu.id,
  iu.farm_id,
  iu.crop_year,
  iu.commodity_id,
  iu.operating_entity_id,
  iu.enterprise_label,
  iu.unit_name,
  iu.insured_acres,
  iu.aph,
  iu.coverage_level_pct,
  iu.revenue_guarantee_per_acre,
  iu.guarantee_per_bu,
  (iu.insured_acres * iu.aph * iu.coverage_level_pct / 100.0)::numeric(16, 2)
    as safe_to_forward_bushels
from public.insurance_units iu;

create function public.validate_bin_inventory_capacity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  bin_capacity numeric(16, 2);
begin
  select gb.capacity_bu
    into bin_capacity
  from public.grain_bins gb
  where gb.id = new.grain_bin_id
    and gb.farm_id = new.farm_id;

  if bin_capacity is null then
    raise exception 'grain bin does not belong to this farm';
  end if;

  if new.bushels > bin_capacity then
    raise exception 'bin inventory (%) cannot exceed bin capacity (%)',
      new.bushels, bin_capacity;
  end if;

  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'production_estimates',
    'grain_contracts',
    'marketing_plan_targets',
    'insurance_units',
    'grain_bins',
    'bin_inventory',
    'cash_bids',
    'usda_report_dates'
  ]
  loop
    execute format(
      'create trigger %I_set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      table_name,
      table_name
    );
  end loop;
end;
$$;

create trigger bin_inventory_validate_capacity
before insert or update of farm_id, grain_bin_id, bushels
on public.bin_inventory
for each row execute function public.validate_bin_inventory_capacity();

-- Reuse Module 1's hard guard: a private row may never be moved between farms
-- by changing its tenant stamp after insertion.
do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'production_estimates',
    'grain_contracts',
    'marketing_plan_targets',
    'insurance_units',
    'grain_bins',
    'bin_inventory',
    'cash_bids'
  ]
  loop
    execute format(
      'create trigger %I_prevent_farm_move before update on public.%I for each row execute function public.prevent_farm_id_change()',
      table_name,
      table_name
    );
  end loop;
end;
$$;
