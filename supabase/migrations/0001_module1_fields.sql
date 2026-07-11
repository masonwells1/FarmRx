-- DRAFT ONLY -- Module 1 (Fields) foundation for Farm Rx.
-- PostgreSQL 17 / Supabase. Review before applying to any database.

create extension if not exists pgcrypto;

create type public.farm_member_role as enum (
  'owner',
  'manager',
  'worker',
  'read_only'
);

create type public.farm_membership_status as enum (
  'invited',
  'active',
  'suspended',
  'revoked'
);

create type public.entity_type as enum (
  'individual',
  'sole_proprietorship',
  'partnership',
  'llc',
  'corporation',
  'trust'
);

create type public.land_arrangement_type as enum (
  'owned',
  'cash_rent',
  'flex_cash_rent',
  'crop_share'
);

create table public.farms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 160),
  -- Privacy is opt-in. This toggle never grants access by itself; 0002 also
  -- requires a matching, enabled farm_rep_access row for the signed-in rep.
  share_with_rep boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.farm_memberships (
  farm_id uuid not null references public.farms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.farm_member_role not null,
  status public.farm_membership_status not null default 'invited',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (farm_id, user_id)
);

create table public.farm_rep_access (
  farm_id uuid not null references public.farms(id) on delete cascade,
  rep_user_id uuid not null references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  granted_by uuid not null references auth.users(id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (farm_id, rep_user_id),
  constraint farm_rep_access_revocation_consistent check (
    (enabled and revoked_at is null) or not enabled
  )
);

create table public.entities (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 160),
  entity_type public.entity_type not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  unique (farm_id, name)
);

create table public.fields (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  operating_entity_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 160),
  legal_description text,
  county text,
  state text check (state is null or length(btrim(state)) between 2 and 50),
  total_acres numeric(10, 2) not null check (total_acres > 0 and total_acres <= 5000),
  fsa_farm_number text,
  fsa_tract_number text,
  soil_productivity_index numeric(8, 3)
    check (soil_productivity_index is null or soil_productivity_index >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  unique (farm_id, name),
  constraint fields_entity_same_farm_fk
    foreign key (operating_entity_id, farm_id)
    references public.entities(id, farm_id)
    on delete restrict
);

-- Global lookup only: no farm prices, contracts, yields, or other private data
-- belong here. Each listed row is a distinct marketable commodity.
create table public.commodities (
  id text primary key check (id ~ '^[a-z][a-z0-9_]*$'),
  name text not null unique check (length(btrim(name)) between 1 and 100),
  crop_family text not null check (crop_family in ('corn', 'soybeans', 'wheat')),
  traits jsonb not null default '{}'::jsonb check (jsonb_typeof(traits) = 'object'),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.commodities (id, name, crop_family, traits)
values
  ('corn_yellow', 'Yellow Corn', 'corn', '{}'),
  ('corn_white', 'White Corn', 'corn', '{"identity_preserved": true, "premium_eligible": true}'),
  ('corn_non_gmo', 'Conventional Corn (Non-GMO)', 'corn', '{"identity_preserved": true, "premium_eligible": true, "non_gmo": true}'),
  ('soybeans', 'Soybeans', 'soybeans', '{}'),
  ('soybeans_double_crop', 'Double-Crop Soybeans', 'soybeans', '{"double_crop": true}'),
  ('wheat', 'Wheat', 'wheat', '{}')
on conflict (id) do update
set
  name = excluded.name,
  crop_family = excluded.crop_family,
  traits = excluded.traits,
  is_active = true,
  updated_at = now();

-- Crop is intentionally not a column on fields. A field may have wheat and
-- double-crop soybeans in the same year, or multiple plantings of one crop.
create table public.crop_assignments (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  field_id uuid not null,
  crop_year integer not null check (crop_year between 1900 and 2200),
  commodity_id text not null references public.commodities(id) on delete restrict,
  planting_sequence smallint not null default 1 check (planting_sequence > 0),
  planted_acres numeric(10, 2) not null check (planted_acres > 0 and planted_acres <= 5000),
  variety text,
  planting_date date,
  harvest_date date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  unique (field_id, crop_year, commodity_id, planting_sequence),
  constraint crop_assignments_field_same_farm_fk
    foreign key (field_id, farm_id)
    references public.fields(id, farm_id)
    on delete cascade,
  constraint crop_assignments_date_order check (
    harvest_date is null or planting_date is null or harvest_date >= planting_date
  )
);

create table public.arrangements (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  field_id uuid not null,
  arrangement_type public.land_arrangement_type not null,
  landlord_name text,
  effective_from date not null,
  effective_to date,
  cash_rent_per_acre numeric(12, 2)
    check (cash_rent_per_acre is null or cash_rent_per_acre >= 0),
  -- A flex formula is kept as structured JSON because owners may base the
  -- bonus on price, yield, revenue, or a combination. Module 4 will define
  -- and validate the supported formula keys before calculating from it.
  flex_bonus_formula jsonb
    check (flex_bonus_formula is null or jsonb_typeof(flex_bonus_formula) = 'object'),
  landlord_crop_pct numeric(5, 2)
    check (landlord_crop_pct is null or landlord_crop_pct between 0 and 100),
  landlord_seed_pct numeric(5, 2) not null default 0 check (landlord_seed_pct between 0 and 100),
  landlord_fertilizer_pct numeric(5, 2) not null default 0 check (landlord_fertilizer_pct between 0 and 100),
  landlord_chemical_pct numeric(5, 2) not null default 0 check (landlord_chemical_pct between 0 and 100),
  landlord_fuel_pct numeric(5, 2) not null default 0 check (landlord_fuel_pct between 0 and 100),
  landlord_labor_custom_pct numeric(5, 2) not null default 0 check (landlord_labor_custom_pct between 0 and 100),
  landlord_crop_insurance_pct numeric(5, 2) not null default 0 check (landlord_crop_insurance_pct between 0 and 100),
  landlord_equipment_pct numeric(5, 2) not null default 0 check (landlord_equipment_pct between 0 and 100),
  landlord_interest_pct numeric(5, 2) not null default 0 check (landlord_interest_pct between 0 and 100),
  landlord_other_input_pct numeric(5, 2) not null default 0 check (landlord_other_input_pct between 0 and 100),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  unique (field_id, effective_from),
  constraint arrangements_field_same_farm_fk
    foreign key (field_id, farm_id)
    references public.fields(id, farm_id)
    on delete cascade,
  constraint arrangements_date_order check (
    effective_to is null or effective_to >= effective_from
  ),
  constraint arrangements_type_fields check (
    (arrangement_type = 'owned'
      and cash_rent_per_acre is null
      and flex_bonus_formula is null
      and landlord_crop_pct is null)
    or
    (arrangement_type = 'cash_rent'
      and cash_rent_per_acre is not null
      and flex_bonus_formula is null
      and landlord_crop_pct is null)
    or
    (arrangement_type = 'flex_cash_rent'
      and cash_rent_per_acre is not null
      and flex_bonus_formula is not null
      and landlord_crop_pct is null)
    or
    (arrangement_type = 'crop_share'
      and cash_rent_per_acre is null
      and flex_bonus_formula is null
      and landlord_crop_pct > 0
      and landlord_crop_pct < 100)
  ),
  constraint arrangements_non_crop_share_inputs_zero check (
    arrangement_type = 'crop_share'
    or (
      landlord_seed_pct = 0
      and landlord_fertilizer_pct = 0
      and landlord_chemical_pct = 0
      and landlord_fuel_pct = 0
      and landlord_labor_custom_pct = 0
      and landlord_crop_insurance_pct = 0
      and landlord_equipment_pct = 0
      and landlord_interest_pct = 0
      and landlord_other_input_pct = 0
    )
  )
);

-- Only one open-ended/current arrangement may exist for a field. Historical
-- arrangements remain available by closing them with effective_to.
create unique index arrangements_one_current_per_field_idx
  on public.arrangements (field_id)
  where effective_to is null;

-- Foreign-key and policy lookup indexes. Composite primary/unique indexes
-- already cover farm_memberships(farm_id, user_id),
-- farm_rep_access(farm_id, rep_user_id), entities(id, farm_id),
-- fields(id, farm_id), and their leading columns.
create index farms_created_by_idx on public.farms (created_by);
create index farm_memberships_user_farm_active_idx
  on public.farm_memberships (user_id, farm_id)
  where status = 'active';
create index farm_rep_access_rep_farm_enabled_idx
  on public.farm_rep_access (rep_user_id, farm_id)
  where enabled and revoked_at is null;
create index farm_rep_access_granted_by_idx on public.farm_rep_access (granted_by);
create index entities_farm_id_idx on public.entities (farm_id);
create index fields_farm_id_idx on public.fields (farm_id);
create index fields_operating_entity_farm_idx on public.fields (operating_entity_id, farm_id);
create index crop_assignments_farm_id_idx on public.crop_assignments (farm_id);
create index crop_assignments_field_farm_idx on public.crop_assignments (field_id, farm_id);
create index crop_assignments_commodity_id_idx on public.crop_assignments (commodity_id);
create index arrangements_farm_id_idx on public.arrangements (farm_id);
create index arrangements_field_farm_idx on public.arrangements (field_id, farm_id);

create function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create function public.prevent_farm_id_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.farm_id is distinct from old.farm_id then
    raise exception 'farm_id cannot be changed';
  end if;
  return new;
end;
$$;

create function public.prevent_farm_identity_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
    or new.created_by is distinct from old.created_by then
    raise exception 'farm id and creator cannot be changed';
  end if;
  return new;
end;
$$;

create function public.prevent_membership_identity_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'membership user cannot be changed; remove and add a membership instead';
  end if;
  return new;
end;
$$;

create function public.prevent_rep_grant_identity_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.rep_user_id is distinct from old.rep_user_id
    or new.granted_by is distinct from old.granted_by
    or new.granted_at is distinct from old.granted_at then
    raise exception 'rep grant identity and audit fields cannot be changed';
  end if;
  return new;
end;
$$;

create function public.validate_crop_assignment_acres()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  field_acres numeric(10, 2);
begin
  select f.total_acres
    into field_acres
  from public.fields f
  where f.id = new.field_id
    and f.farm_id = new.farm_id;

  if field_acres is null then
    raise exception 'field does not belong to this farm';
  end if;

  if new.planted_acres > field_acres then
    raise exception 'planted acres (%) cannot exceed field acres (%)',
      new.planted_acres, field_acres;
  end if;

  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'farms',
    'farm_memberships',
    'farm_rep_access',
    'entities',
    'fields',
    'commodities',
    'crop_assignments',
    'arrangements'
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

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'farm_memberships',
    'farm_rep_access',
    'entities',
    'fields',
    'crop_assignments',
    'arrangements'
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

create trigger farms_prevent_identity_change
before update on public.farms
for each row execute function public.prevent_farm_identity_change();

create trigger farm_memberships_prevent_identity_change
before update on public.farm_memberships
for each row execute function public.prevent_membership_identity_change();

create trigger farm_rep_access_prevent_identity_change
before update on public.farm_rep_access
for each row execute function public.prevent_rep_grant_identity_change();

create trigger crop_assignments_validate_acres
before insert or update of farm_id, field_id, planted_acres
on public.crop_assignments
for each row execute function public.validate_crop_assignment_acres();
