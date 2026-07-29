-- DRAFT ONLY -- Module 3 (Inventory and compliance) for Farm Rx.
-- PostgreSQL 17 / Supabase. Review before applying to any database.
-- Depends only on 0001_module1_fields.sql. It deliberately has no dependency
-- on Grain, Profitability, or the future Crop RX delivery integration.

create type public.inventory_product_kind as enum (
  'chemical',
  'seed',
  'fertilizer',
  'biological',
  'adjuvant',
  'other'
);

-- Units are intentionally explicit. Automatic conversion is allowed only
-- inside one physical family: liquid volume, dry weight, or metric weight.
-- Container/count units do not silently convert; a receipt or use row must
-- snapshot an explicit inventory-units-per-entered-unit factor instead.
create type public.inventory_quantity_unit as enum (
  'gal',
  'qt',
  'pt',
  'fl_oz',
  'l',
  'ml',
  'lb',
  'oz',
  'ton',
  'kg',
  'g',
  'each',
  'bag',
  'case',
  'tote',
  'seed_unit',
  'bulk_unit'
);

create type public.inventory_receipt_source as enum (
  'crop_rx',
  'other_vendor',
  'opening_balance'
);

create type public.inventory_receipt_status as enum (
  'draft',
  'received',
  'cancelled'
);

create type public.inventory_adjustment_reason as enum (
  'physical_count',
  'damage_or_loss',
  'return_to_vendor',
  'transfer_in',
  'transfer_out',
  'correction'
);

create type public.application_record_status as enum (
  'draft',
  'completed',
  'voided'
);

create type public.application_rate_basis as enum (
  'acre',
  '100_gal',
  '100_lb',
  'each'
);

create type public.inventory_delivery_event_type as enum (
  'expected',
  'received',
  'partially_received',
  'cancelled'
);

create table public.inventory_products (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  product_kind public.inventory_product_kind not null,
  name text not null check (length(btrim(name)) between 1 and 200),
  manufacturer text
    check (manufacturer is null or length(btrim(manufacturer)) between 1 and 200),
  inventory_unit public.inventory_quantity_unit not null,
  epa_registration_number text
    check (epa_registration_number is null or length(btrim(epa_registration_number)) between 1 and 80),
  is_restricted_use boolean not null default false,
  signal_word text
    check (signal_word is null or signal_word in ('caution', 'warning', 'danger')),
  restricted_entry_interval_hours numeric(10, 2)
    check (restricted_entry_interval_hours is null or restricted_entry_interval_hours >= 0),
  preharvest_interval_hours numeric(10, 2)
    check (preharvest_interval_hours is null or preharvest_interval_hours >= 0),
  max_label_rate numeric(16, 6)
    check (max_label_rate is null or max_label_rate > 0),
  max_label_rate_unit public.inventory_quantity_unit,
  max_label_rate_basis public.application_rate_basis,
  commodity_id text references public.commodities(id) on delete restrict,
  variety_name text
    check (variety_name is null or length(btrim(variety_name)) between 1 and 160),
  fertilizer_analysis jsonb
    check (fertilizer_analysis is null or jsonb_typeof(fertilizer_analysis) = 'object'),
  -- Future Crop RX shelf hook only. The source database is intentionally not
  -- referenced from Farm Rx; a sync can match the shared UUID later.
  crop_rx_product_id uuid,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint inventory_products_rup_kind check (
    not is_restricted_use
    or product_kind in ('chemical', 'biological')
  ),
  constraint inventory_products_pesticide_fields check (
    product_kind in ('chemical', 'biological', 'adjuvant')
    or (
      epa_registration_number is null
      and not is_restricted_use
      and signal_word is null
      and restricted_entry_interval_hours is null
      and preharvest_interval_hours is null
      and max_label_rate is null
      and max_label_rate_unit is null
      and max_label_rate_basis is null
    )
  ),
  constraint inventory_products_max_rate_complete check (
    (max_label_rate is null and max_label_rate_unit is null and max_label_rate_basis is null)
    or (max_label_rate is not null and max_label_rate_unit is not null and max_label_rate_basis is not null)
  ),
  constraint inventory_products_seed_fields check (
    (product_kind = 'seed' and variety_name is not null and commodity_id is not null)
    or (product_kind <> 'seed' and variety_name is null and commodity_id is null)
  ),
  constraint inventory_products_fertilizer_analysis_kind check (
    fertilizer_analysis is null or product_kind = 'fertilizer'
  )
);

create unique index inventory_products_crop_rx_product_idx
  on public.inventory_products (farm_id, crop_rx_product_id)
  where crop_rx_product_id is not null;

-- A receipt is the auditable header for a purchase, opening balance, or future
-- Crop RX delivery. Quantities live on child lines and become on-hand only when
-- the header reaches received status.
create table public.inventory_receipts (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  source public.inventory_receipt_source not null,
  status public.inventory_receipt_status not null default 'draft',
  vendor_name text
    check (vendor_name is null or length(btrim(vendor_name)) between 1 and 200),
  purchase_date date,
  received_at timestamptz,
  invoice_number text
    check (invoice_number is null or length(btrim(invoice_number)) between 1 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete restrict,
  cancellation_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint inventory_receipts_status_fields check (
    (status = 'draft' and received_at is null and cancelled_at is null and cancelled_by is null and cancellation_reason is null)
    or (status = 'received' and received_at is not null and cancelled_at is null and cancelled_by is null and cancellation_reason is null)
    or (status = 'cancelled' and received_at is not null and cancelled_at is not null
      and cancelled_by is not null and length(btrim(cancellation_reason)) >= 1)
  ),
  constraint inventory_receipts_source_vendor check (
    source = 'opening_balance' or vendor_name is not null
  )
);

create table public.inventory_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  receipt_id uuid not null,
  product_id uuid not null,
  entered_quantity numeric(18, 6) not null check (entered_quantity > 0),
  entered_unit public.inventory_quantity_unit not null,
  -- Set by the normalization trigger. It is 1 for equal units, the exact
  -- built-in factor for compatible standard units, or an explicit packaging
  -- factor for count/container units such as 12 gal per case.
  inventory_units_per_entered_unit numeric(24, 12)
    check (inventory_units_per_entered_unit is null or inventory_units_per_entered_unit > 0),
  quantity_in_inventory_unit numeric(24, 8) not null check (quantity_in_inventory_unit > 0),
  unit_cost_per_inventory_unit numeric(16, 6)
    check (unit_cost_per_inventory_unit is null or unit_cost_per_inventory_unit >= 0),
  lot_number text
    check (lot_number is null or length(btrim(lot_number)) between 1 and 120),
  expiration_date date,
  external_delivery_line_id text
    check (external_delivery_line_id is null or length(btrim(external_delivery_line_id)) between 1 and 200),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint inventory_receipt_lines_receipt_same_farm_fk
    foreign key (receipt_id, farm_id)
    references public.inventory_receipts(id, farm_id)
    on delete cascade,
  constraint inventory_receipt_lines_product_same_farm_fk
    foreign key (product_id, farm_id)
    references public.inventory_products(id, farm_id)
    on delete restrict
);

-- Adjustments are immutable signed ledger entries. A correction is another
-- entry, never a rewrite. This supports physical counts without storing an
-- on-hand total that can drift away from receipts and applications.
create table public.inventory_adjustments (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  product_id uuid not null,
  adjustment_quantity_in_inventory_unit numeric(24, 8) not null
    check (adjustment_quantity_in_inventory_unit <> 0),
  reason public.inventory_adjustment_reason not null,
  adjusted_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete restrict,
  notes text not null check (length(btrim(notes)) between 1 and 1000),
  created_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint inventory_adjustments_product_same_farm_fk
    foreign key (product_id, farm_id)
    references public.inventory_products(id, farm_id)
    on delete restrict
);

-- One application record represents one field and one crop assignment. This
-- intentionally follows crop-assignment rows rather than adding crop to fields.
-- Completed records can be voided with audit fields or corrected by a new row;
-- their historical facts are never silently overwritten.
create table public.application_records (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  field_id uuid not null,
  crop_assignment_id uuid not null,
  status public.application_record_status not null default 'draft',
  application_date date not null,
  start_time time,
  end_time time,
  applied_acres numeric(12, 2) not null check (applied_acres > 0),
  target_pest text
    check (target_pest is null or length(btrim(target_pest)) between 1 and 240),
  applicator_user_id uuid,
  applicator_name_snapshot text
    check (applicator_name_snapshot is null or length(btrim(applicator_name_snapshot)) between 1 and 200),
  applicator_license_number_snapshot text
    check (applicator_license_number_snapshot is null or length(btrim(applicator_license_number_snapshot)) between 1 and 120),
  applicator_license_state_snapshot text
    check (applicator_license_state_snapshot is null or length(btrim(applicator_license_state_snapshot)) between 2 and 50),
  wind_speed_mph numeric(8, 2) check (wind_speed_mph is null or wind_speed_mph between 0 and 250),
  wind_direction text check (
    wind_direction is null
    or wind_direction in ('N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
      'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW', 'CALM', 'VARIABLE')
  ),
  temperature_f numeric(8, 2) check (temperature_f is null or temperature_f between -100 and 160),
  relative_humidity_pct numeric(5, 2)
    check (relative_humidity_pct is null or relative_humidity_pct between 0 and 100),
  corrects_application_id uuid,
  correction_reason text,
  created_by uuid not null references auth.users(id) on delete restrict,
  completed_at timestamptz,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete restrict,
  void_reason text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint application_records_field_same_farm_fk
    foreign key (field_id, farm_id)
    references public.fields(id, farm_id)
    on delete restrict,
  constraint application_records_assignment_same_farm_fk
    foreign key (crop_assignment_id, farm_id)
    references public.crop_assignments(id, farm_id)
    on delete restrict,
  constraint application_records_applicator_membership_fk
    foreign key (farm_id, applicator_user_id)
    references public.farm_memberships(farm_id, user_id)
    on delete restrict,
  constraint application_records_correction_same_farm_fk
    foreign key (corrects_application_id, farm_id)
    references public.application_records(id, farm_id)
    on delete restrict,
  constraint application_records_time_order check (
    end_time is null or start_time is null or end_time >= start_time
  ),
  constraint application_records_not_self_correction check (
    corrects_application_id is null or corrects_application_id <> id
  ),
  constraint application_records_correction_reason check (
    (corrects_application_id is null and correction_reason is null)
    or (corrects_application_id is not null and length(btrim(correction_reason)) >= 1)
  ),
  constraint application_records_status_fields check (
    (status = 'draft' and completed_at is null and voided_at is null and voided_by is null and void_reason is null)
    or (status = 'completed' and completed_at is not null and voided_at is null and voided_by is null and void_reason is null)
    or (status = 'voided' and completed_at is not null and voided_at is not null
      and voided_by is not null and length(btrim(void_reason)) >= 1)
  )
);

-- Product label and cost facts are snapshotted here at application time so a
-- later catalog edit cannot rewrite the historical compliance record. The UUID
-- of this row is the compatible source_record_id for Module 4 budget cost lines.
create table public.application_products (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  application_id uuid not null,
  product_id uuid not null,
  product_kind_snapshot public.inventory_product_kind not null,
  product_name_snapshot text not null,
  epa_registration_number_snapshot text,
  is_restricted_use_snapshot boolean not null,
  signal_word_snapshot text,
  restricted_entry_interval_hours_snapshot numeric(10, 2),
  preharvest_interval_hours_snapshot numeric(10, 2),
  max_label_rate_snapshot numeric(16, 6),
  max_label_rate_unit_snapshot public.inventory_quantity_unit,
  max_label_rate_basis_snapshot public.application_rate_basis,
  inventory_unit_snapshot public.inventory_quantity_unit not null,
  rate numeric(18, 6) not null check (rate > 0),
  rate_unit public.inventory_quantity_unit not null,
  rate_basis public.application_rate_basis not null default 'acre',
  total_quantity numeric(18, 6) not null check (total_quantity > 0),
  total_unit public.inventory_quantity_unit not null,
  inventory_units_per_total_unit numeric(24, 12)
    check (inventory_units_per_total_unit is null or inventory_units_per_total_unit > 0),
  quantity_in_inventory_unit numeric(24, 8) not null check (quantity_in_inventory_unit > 0),
  unit_cost_per_inventory_unit_snapshot numeric(16, 6)
    check (unit_cost_per_inventory_unit_snapshot is null or unit_cost_per_inventory_unit_snapshot >= 0),
  lot_number_snapshot text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  unique (application_id, product_id, lot_number_snapshot),
  constraint application_products_application_same_farm_fk
    foreign key (application_id, farm_id)
    references public.application_records(id, farm_id)
    on delete cascade,
  constraint application_products_product_same_farm_fk
    foreign key (product_id, farm_id)
    references public.inventory_products(id, farm_id)
    on delete restrict
);

-- Future integration inbox. This is an idempotent event hook, not a sync.
-- No external payload is trusted as inventory until it is linked to a received
-- Farm Rx receipt; the derived on-hand view reads receipts, never this table.
create table public.inventory_delivery_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  source_system text not null check (length(btrim(source_system)) between 1 and 80),
  external_event_id text not null check (length(btrim(external_event_id)) between 1 and 200),
  event_type public.inventory_delivery_event_type not null,
  occurred_at timestamptz not null,
  receipt_id uuid,
  payload_hash text
    check (payload_hash is null or payload_hash ~ '^[0-9a-fA-F]{64}$'),
  received_at timestamptz not null default now(),
  unique (id, farm_id),
  unique (source_system, external_event_id),
  constraint inventory_delivery_events_receipt_same_farm_fk
    foreign key (receipt_id, farm_id)
    references public.inventory_receipts(id, farm_id)
    on delete restrict
);

create index inventory_products_farm_kind_idx
  on public.inventory_products (farm_id, product_kind, is_active);
create index inventory_receipts_farm_received_idx
  on public.inventory_receipts (farm_id, received_at)
  where status = 'received';
create index inventory_receipt_lines_receipt_farm_idx
  on public.inventory_receipt_lines (receipt_id, farm_id);
create index inventory_receipt_lines_product_farm_idx
  on public.inventory_receipt_lines (product_id, farm_id);
create index inventory_adjustments_product_farm_idx
  on public.inventory_adjustments (product_id, farm_id, adjusted_at);
create index application_records_farm_date_idx
  on public.application_records (farm_id, application_date desc);
create index application_records_field_assignment_idx
  on public.application_records (field_id, crop_assignment_id, farm_id);
create index application_records_effective_idx
  on public.application_records (farm_id, status, corrects_application_id);
create unique index application_records_one_live_correction_idx
  on public.application_records (corrects_application_id)
  where corrects_application_id is not null and status in ('draft', 'completed');
create index application_products_application_farm_idx
  on public.application_products (application_id, farm_id);
create index application_products_product_farm_idx
  on public.application_products (product_id, farm_id);
create index inventory_delivery_events_farm_time_idx
  on public.inventory_delivery_events (farm_id, occurred_at desc);
create index inventory_delivery_events_receipt_farm_idx
  on public.inventory_delivery_events (receipt_id, farm_id);

-- Returns the number of base units represented by one unit. NULL means that
-- no universal physical conversion exists. US liquid measures use exact US
-- customary factors; weights use exact avoirdupois/metric definitions.
create function public.inventory_unit_base_factor(unit_name public.inventory_quantity_unit)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case unit_name
    when 'gal' then 3785.411784
    when 'qt' then 946.352946
    when 'pt' then 473.176473
    when 'fl_oz' then 29.5735295625
    when 'l' then 1000
    when 'ml' then 1
    when 'lb' then 453.59237
    when 'oz' then 28.349523125
    when 'ton' then 907184.74
    when 'kg' then 1000
    when 'g' then 1
    else null::numeric
  end;
$$;

create function public.inventory_unit_family(unit_name public.inventory_quantity_unit)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when unit_name in ('gal', 'qt', 'pt', 'fl_oz', 'l', 'ml') then 'volume'
    when unit_name in ('lb', 'oz', 'ton', 'kg', 'g') then 'weight'
    else unit_name::text
  end;
$$;

create function public.inventory_conversion_factor(
  from_unit public.inventory_quantity_unit,
  to_unit public.inventory_quantity_unit
)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when from_unit = to_unit then 1::numeric
    when public.inventory_unit_family(from_unit) = public.inventory_unit_family(to_unit)
      and public.inventory_unit_base_factor(from_unit) is not null
      and public.inventory_unit_base_factor(to_unit) is not null
      then public.inventory_unit_base_factor(from_unit)
        / public.inventory_unit_base_factor(to_unit)
    else null::numeric
  end;
$$;

create function public.normalize_receipt_line_quantity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  product_unit public.inventory_quantity_unit;
  known_factor numeric;
begin
  select p.inventory_unit into product_unit
  from public.inventory_products p
  where p.id = new.product_id and p.farm_id = new.farm_id
  for share;

  if product_unit is null then
    raise exception 'receipt product does not belong to this farm';
  end if;

  known_factor := public.inventory_conversion_factor(new.entered_unit, product_unit);
  if known_factor is not null then
    new.inventory_units_per_entered_unit := known_factor;
  elsif new.inventory_units_per_entered_unit is null then
    raise exception 'an explicit packaging conversion is required from % to %',
      new.entered_unit, product_unit;
  end if;

  new.quantity_in_inventory_unit := round(
    new.entered_quantity * new.inventory_units_per_entered_unit,
    8
  );
  return new;
end;
$$;

create function public.validate_application_record()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  assignment_field_id uuid;
  assignment_acres numeric;
  corrected_status public.application_record_status;
  applicator_is_active boolean;
begin
  select ca.field_id, ca.planted_acres
    into assignment_field_id, assignment_acres
  from public.crop_assignments ca
  where ca.id = new.crop_assignment_id and ca.farm_id = new.farm_id;

  if assignment_field_id is null or assignment_field_id <> new.field_id then
    raise exception 'crop assignment must belong to the selected field and farm';
  end if;
  if new.applied_acres > assignment_acres then
    raise exception 'applied acres (%) cannot exceed assigned planted acres (%)',
      new.applied_acres, assignment_acres;
  end if;

  if new.applicator_user_id is not null then
    select exists (
      select 1 from public.farm_memberships fm
      where fm.farm_id = new.farm_id
        and fm.user_id = new.applicator_user_id
        and fm.status = 'active'
    ) into applicator_is_active;
    if not applicator_is_active then
      raise exception 'applicator must be an active member of this farm';
    end if;
  end if;

  if new.corrects_application_id is not null then
    select ar.status into corrected_status
    from public.application_records ar
    where ar.id = new.corrects_application_id and ar.farm_id = new.farm_id;
    if corrected_status is distinct from 'completed'::public.application_record_status then
      raise exception 'a correction must reference a completed record in this farm';
    end if;
  end if;

  return new;
end;
$$;

create function public.snapshot_application_product()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  product_row public.inventory_products%rowtype;
  parent_status public.application_record_status;
  known_factor numeric;
begin
  select ar.status into parent_status
  from public.application_records ar
  where ar.id = new.application_id and ar.farm_id = new.farm_id
  for update;
  if parent_status is distinct from 'draft'::public.application_record_status then
    raise exception 'products can be changed only while the application is a draft';
  end if;

  select * into product_row
  from public.inventory_products p
  where p.id = new.product_id and p.farm_id = new.farm_id
  for share;
  if product_row.id is null then
    raise exception 'application product does not belong to this farm';
  end if;

  new.product_kind_snapshot := product_row.product_kind;
  new.product_name_snapshot := product_row.name;
  new.epa_registration_number_snapshot := product_row.epa_registration_number;
  new.is_restricted_use_snapshot := product_row.is_restricted_use;
  new.signal_word_snapshot := product_row.signal_word;
  new.restricted_entry_interval_hours_snapshot := product_row.restricted_entry_interval_hours;
  new.preharvest_interval_hours_snapshot := product_row.preharvest_interval_hours;
  new.max_label_rate_snapshot := product_row.max_label_rate;
  new.max_label_rate_unit_snapshot := product_row.max_label_rate_unit;
  new.max_label_rate_basis_snapshot := product_row.max_label_rate_basis;
  new.inventory_unit_snapshot := product_row.inventory_unit;

  known_factor := public.inventory_conversion_factor(new.total_unit, product_row.inventory_unit);
  if known_factor is not null then
    new.inventory_units_per_total_unit := known_factor;
  elsif new.inventory_units_per_total_unit is null then
    raise exception 'an explicit packaging conversion is required from % to %',
      new.total_unit, product_row.inventory_unit;
  end if;

  new.quantity_in_inventory_unit := round(
    new.total_quantity * new.inventory_units_per_total_unit,
    8
  );
  return new;
end;
$$;

create function public.lock_adjustment_product_unit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  product_exists boolean;
begin
  select true into product_exists
  from public.inventory_products p
  where p.id = new.product_id and p.farm_id = new.farm_id
  for share;
  if product_exists is distinct from true then
    raise exception 'adjustment product does not belong to this farm';
  end if;
  return new;
end;
$$;

-- Once a product has ledger history, changing its canonical unit would relabel
-- old numeric quantities without converting them. Create a new product instead.
create function public.protect_inventory_product_unit()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.inventory_unit is distinct from old.inventory_unit
    and (
      exists (
        select 1 from public.inventory_receipt_lines rl
        where rl.product_id = old.id and rl.farm_id = old.farm_id
      )
      or exists (
        select 1 from public.inventory_adjustments ia
        where ia.product_id = old.id and ia.farm_id = old.farm_id
      )
      or exists (
        select 1 from public.application_products ap
        where ap.product_id = old.id and ap.farm_id = old.farm_id
      )
    ) then
    raise exception 'inventory unit cannot change after a product has ledger history';
  end if;
  return new;
end;
$$;

create function public.protect_receipt_history()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  target_receipt_id uuid;
  target_farm_id uuid;
  target_receipt_status public.inventory_receipt_status;
begin
  if tg_table_name = 'inventory_receipts' then
    if tg_op = 'INSERT' then
      if new.status <> 'draft' then
        raise exception 'a receipt must be created as a draft';
      end if;
      return new;
    elsif tg_op = 'DELETE' and old.status <> 'draft' then
      raise exception 'only draft receipts can be deleted';
    elsif tg_op = 'UPDATE' then
      if new.created_by is distinct from old.created_by then
        raise exception 'receipt creator cannot be changed';
      end if;
      if old.status = 'cancelled' then
        raise exception 'cancelled receipts are immutable';
      elsif old.status = 'draft' and new.status not in ('draft', 'received') then
        raise exception 'a draft receipt may only remain draft or become received';
      elsif old.status = 'received' and (
        new.status <> 'cancelled'
        or new.id is distinct from old.id
        or new.farm_id is distinct from old.farm_id
        or new.source is distinct from old.source
        or new.vendor_name is distinct from old.vendor_name
        or new.purchase_date is distinct from old.purchase_date
        or new.received_at is distinct from old.received_at
        or new.invoice_number is distinct from old.invoice_number
        or new.created_by is distinct from old.created_by
      ) then
        raise exception 'a received receipt may only be cancelled with audit fields';
      end if;
      if old.status = 'draft' and new.status = 'received' and not exists (
        select 1 from public.inventory_receipt_lines rl
        where rl.receipt_id = old.id and rl.farm_id = old.farm_id
      ) then
        raise exception 'a receipt needs at least one line before it can be received';
      end if;
    end if;
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then
    target_receipt_id := old.receipt_id;
    target_farm_id := old.farm_id;
  else
    target_receipt_id := new.receipt_id;
    target_farm_id := new.farm_id;
  end if;
  select r.status into target_receipt_status
  from public.inventory_receipts r
  where r.id = target_receipt_id and r.farm_id = target_farm_id
  for update;
  if target_receipt_status is distinct from 'draft'::public.inventory_receipt_status then
    raise exception 'receipt lines can be changed only while the receipt is a draft';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

create function public.protect_application_history()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  target_application_id uuid;
  target_farm_id uuid;
  target_application_status public.application_record_status;
begin
  if tg_table_name = 'application_records' then
    if tg_op = 'INSERT' then
      if new.status <> 'draft' then
        raise exception 'an application record must be created as a draft';
      end if;
      return new;
    elsif tg_op = 'DELETE' and old.status <> 'draft' then
      raise exception 'only draft application records can be deleted';
    elsif tg_op = 'UPDATE' then
      if new.created_by is distinct from old.created_by then
        raise exception 'application creator cannot be changed';
      end if;
      if old.status = 'voided' then
        raise exception 'voided application records are immutable';
      elsif old.status = 'draft' and new.status not in ('draft', 'completed') then
        raise exception 'a draft application may only remain draft or become completed';
      elsif old.status = 'completed' and (
        new.status <> 'voided'
        or new.id is distinct from old.id
        or new.farm_id is distinct from old.farm_id
        or new.field_id is distinct from old.field_id
        or new.crop_assignment_id is distinct from old.crop_assignment_id
        or new.application_date is distinct from old.application_date
        or new.start_time is distinct from old.start_time
        or new.end_time is distinct from old.end_time
        or new.applied_acres is distinct from old.applied_acres
        or new.target_pest is distinct from old.target_pest
        or new.applicator_user_id is distinct from old.applicator_user_id
        or new.applicator_name_snapshot is distinct from old.applicator_name_snapshot
        or new.applicator_license_number_snapshot is distinct from old.applicator_license_number_snapshot
        or new.applicator_license_state_snapshot is distinct from old.applicator_license_state_snapshot
        or new.wind_speed_mph is distinct from old.wind_speed_mph
        or new.wind_direction is distinct from old.wind_direction
        or new.temperature_f is distinct from old.temperature_f
        or new.relative_humidity_pct is distinct from old.relative_humidity_pct
        or new.corrects_application_id is distinct from old.corrects_application_id
        or new.correction_reason is distinct from old.correction_reason
        or new.created_by is distinct from old.created_by
        or new.completed_at is distinct from old.completed_at
      ) then
        raise exception 'a completed application may only be voided with audit fields';
      end if;

      if old.status = 'draft' and new.status = 'completed' and not exists (
        select 1 from public.application_products ap
        where ap.application_id = old.id and ap.farm_id = old.farm_id
      ) then
        raise exception 'an application needs at least one product before completion';
      end if;
    end if;
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  if tg_op = 'DELETE' then
    target_application_id := old.application_id;
    target_farm_id := old.farm_id;
  else
    target_application_id := new.application_id;
    target_farm_id := new.farm_id;
  end if;
  select ar.status into target_application_status
  from public.application_records ar
  where ar.id = target_application_id and ar.farm_id = target_farm_id
  for update;
  if target_application_status is distinct from 'draft'::public.application_record_status then
    raise exception 'application products can be changed only while the application is a draft';
  end if;
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'inventory_products',
    'inventory_receipts',
    'inventory_receipt_lines',
    'application_records',
    'application_products'
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
    'inventory_products',
    'inventory_receipts',
    'inventory_receipt_lines',
    'inventory_adjustments',
    'application_records',
    'application_products',
    'inventory_delivery_events'
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

create trigger inventory_receipt_lines_normalize_quantity
before insert or update of farm_id, product_id, entered_quantity, entered_unit,
  inventory_units_per_entered_unit
on public.inventory_receipt_lines
for each row execute function public.normalize_receipt_line_quantity();

create trigger inventory_products_protect_unit
before update of inventory_unit on public.inventory_products
for each row execute function public.protect_inventory_product_unit();

create trigger inventory_adjustments_lock_product_unit
before insert on public.inventory_adjustments
for each row execute function public.lock_adjustment_product_unit();

create trigger application_records_validate
before insert or update of farm_id, field_id, crop_assignment_id, applied_acres,
  applicator_user_id, corrects_application_id
on public.application_records
for each row execute function public.validate_application_record();

create trigger application_products_snapshot
before insert or update
on public.application_products
for each row execute function public.snapshot_application_product();

create trigger inventory_receipts_protect_history
before insert or update or delete on public.inventory_receipts
for each row execute function public.protect_receipt_history();

create trigger inventory_receipt_lines_protect_history
before update or delete on public.inventory_receipt_lines
for each row execute function public.protect_receipt_history();

create trigger application_records_protect_history
before insert or update or delete on public.application_records
for each row execute function public.protect_application_history();

create trigger application_products_protect_history
before update or delete on public.application_products
for each row execute function public.protect_application_history();

-- A completed correction supersedes the record it corrects. Draft corrections
-- do not affect inventory, and voided corrections do not hide the prior record.
create view public.effective_application_records
with (security_invoker = true)
as
select ar.*
from public.application_records ar
where ar.status = 'completed'
  and not exists (
    select 1
    from public.application_records correction
    where correction.corrects_application_id = ar.id
      and correction.farm_id = ar.farm_id
      and correction.status = 'completed'
  );

-- On-hand is always receipts + signed adjustments - effective completed use.
-- No total is stored on inventory_products, so catalog, receipt, adjustment,
-- correction, and void changes are reflected without a stale cache.
create view public.inventory_on_hand
with (security_invoker = true)
as
with received as (
  select
    rl.farm_id,
    rl.product_id,
    sum(rl.quantity_in_inventory_unit) as received_quantity,
    sum(rl.quantity_in_inventory_unit * coalesce(rl.unit_cost_per_inventory_unit, 0))
      as known_receipt_cost,
    sum(rl.quantity_in_inventory_unit) filter (where rl.unit_cost_per_inventory_unit is not null)
      as costed_receipt_quantity
  from public.inventory_receipt_lines rl
  join public.inventory_receipts r
    on r.id = rl.receipt_id and r.farm_id = rl.farm_id
  where r.status = 'received'
  group by rl.farm_id, rl.product_id
), adjusted as (
  select ia.farm_id, ia.product_id,
    sum(ia.adjustment_quantity_in_inventory_unit) as adjusted_quantity
  from public.inventory_adjustments ia
  group by ia.farm_id, ia.product_id
), used as (
  select ap.farm_id, ap.product_id,
    sum(ap.quantity_in_inventory_unit) as used_quantity
  from public.application_products ap
  join public.effective_application_records ear
    on ear.id = ap.application_id and ear.farm_id = ap.farm_id
  group by ap.farm_id, ap.product_id
)
select
  p.id as product_id,
  p.farm_id,
  p.product_kind,
  p.name,
  p.inventory_unit,
  coalesce(r.received_quantity, 0)::numeric(24, 8) as received_quantity,
  coalesce(a.adjusted_quantity, 0)::numeric(24, 8) as adjusted_quantity,
  coalesce(u.used_quantity, 0)::numeric(24, 8) as used_quantity,
  (coalesce(r.received_quantity, 0) + coalesce(a.adjusted_quantity, 0)
    - coalesce(u.used_quantity, 0))::numeric(24, 8) as on_hand_quantity,
  case when coalesce(r.costed_receipt_quantity, 0) > 0
    then (r.known_receipt_cost / r.costed_receipt_quantity)::numeric(16, 6)
    else null::numeric
  end as weighted_known_receipt_cost_per_inventory_unit
from public.inventory_products p
left join received r on r.product_id = p.id and r.farm_id = p.farm_id
left join adjusted a on a.product_id = p.id and a.farm_id = p.farm_id
left join used u on u.product_id = p.id and u.farm_id = p.farm_id;

-- Stable UUID hook for Module 4: budget_cost_lines.source_kind = 'inventory'
-- and source_record_id = application_product_id. The view itself does not
-- reference Module 4 and remains usable if 0006 has not been applied.
create view public.application_cost_lines
with (security_invoker = true)
as
select
  ap.id as source_record_id,
  ap.id as application_product_id,
  ar.id as application_id,
  ap.farm_id,
  ar.crop_assignment_id,
  ar.field_id,
  ar.application_date,
  case ap.product_kind_snapshot
    when 'seed' then 'seed'
    when 'fertilizer' then 'fertilizer'
    else 'chemical'
  end as profitability_category,
  ap.product_name_snapshot as label,
  ar.applied_acres,
  ap.quantity_in_inventory_unit,
  ap.inventory_unit_snapshot,
  ap.unit_cost_per_inventory_unit_snapshot,
  (ap.quantity_in_inventory_unit * ap.unit_cost_per_inventory_unit_snapshot)::numeric(18, 2)
    as total_cost,
  (ap.quantity_in_inventory_unit * ap.unit_cost_per_inventory_unit_snapshot
    / ar.applied_acres)::numeric(16, 4) as amount_per_acre
from public.application_products ap
join public.effective_application_records ar
  on ar.id = ap.application_id and ar.farm_id = ap.farm_id
;

-- Federal private-applicator RUP baseline from 7 CFR Part 110 / USDA AMS:
-- product name, EPA number, total quantity, date, identifiable location,
-- crop/site, treated size, applicator name, and certification number. Illinois
-- commercial-use rate information is also captured. Weather, target pest,
-- REI, and PHI are useful operational/label facts but are reported separately
-- so this view does not falsely call every best-practice field a federal rule.
create view public.rup_application_completeness
with (security_invoker = true)
as
select
  ar.id as application_id,
  ap.id as application_product_id,
  ar.farm_id,
  ar.application_date,
  ar.field_id,
  ar.crop_assignment_id,
  ap.product_name_snapshot,
  ap.epa_registration_number_snapshot,
  true as is_restricted_use,
  array_remove(array[
    case when length(btrim(ap.product_name_snapshot)) = 0 then 'product_name' end,
    case when ap.epa_registration_number_snapshot is null
      or length(btrim(ap.epa_registration_number_snapshot)) = 0 then 'epa_registration_number' end,
    case when ap.total_quantity is null or ap.total_quantity <= 0 then 'total_quantity' end,
    case when ar.application_date is null then 'application_date' end,
    case when ar.field_id is null then 'application_location' end,
    case when ar.crop_assignment_id is null then 'crop_or_site' end,
    case when ar.applied_acres is null or ar.applied_acres <= 0 then 'area_treated' end,
    case when ar.applicator_name_snapshot is null
      or length(btrim(ar.applicator_name_snapshot)) = 0 then 'applicator_name' end,
    case when ar.applicator_license_number_snapshot is null
      or length(btrim(ar.applicator_license_number_snapshot)) = 0 then 'applicator_certification_number' end
  ], null) as missing_federal_rup_fields,
  cardinality(array_remove(array[
    case when length(btrim(ap.product_name_snapshot)) = 0 then 'product_name' end,
    case when ap.epa_registration_number_snapshot is null
      or length(btrim(ap.epa_registration_number_snapshot)) = 0 then 'epa_registration_number' end,
    case when ap.total_quantity is null or ap.total_quantity <= 0 then 'total_quantity' end,
    case when ar.application_date is null then 'application_date' end,
    case when ar.field_id is null then 'application_location' end,
    case when ar.crop_assignment_id is null then 'crop_or_site' end,
    case when ar.applied_acres is null or ar.applied_acres <= 0 then 'area_treated' end,
    case when ar.applicator_name_snapshot is null
      or length(btrim(ar.applicator_name_snapshot)) = 0 then 'applicator_name' end,
    case when ar.applicator_license_number_snapshot is null
      or length(btrim(ar.applicator_license_number_snapshot)) = 0 then 'applicator_certification_number' end
  ], null)) = 0 as federal_rup_record_complete,
  array_remove(array[
    case when ar.start_time is null then 'application_time' end,
    case when ar.target_pest is null or length(btrim(ar.target_pest)) = 0 then 'target_pest' end,
    case when ar.wind_speed_mph is null then 'wind_speed' end,
    case when ar.wind_direction is null then 'wind_direction' end,
    case when ar.temperature_f is null then 'temperature' end,
    case when ar.relative_humidity_pct is null then 'relative_humidity' end,
    case when ap.rate is null or ap.rate <= 0 then 'application_rate' end,
    case when ap.rate_basis = 'acre'
      and public.inventory_conversion_factor(ap.rate_unit, ap.total_unit) is not null
      and abs(
        ap.total_quantity
        - ap.rate * ar.applied_acres
          * public.inventory_conversion_factor(ap.rate_unit, ap.total_unit)
      ) > greatest(
        0.0001,
        ap.rate * ar.applied_acres
          * public.inventory_conversion_factor(ap.rate_unit, ap.total_unit) * 0.01
      ) then 'rate_total_mismatch' end,
    case when ap.max_label_rate_snapshot is not null
      and ap.max_label_rate_basis_snapshot = ap.rate_basis
      and public.inventory_conversion_factor(
        ap.rate_unit,
        ap.max_label_rate_unit_snapshot
      ) is not null
      and ap.rate * public.inventory_conversion_factor(
        ap.rate_unit,
        ap.max_label_rate_unit_snapshot
      ) > ap.max_label_rate_snapshot
      then 'rate_exceeds_snapshotted_label_maximum' end,
    case when ap.restricted_entry_interval_hours_snapshot is null then 'rei_hours' end,
    case when ap.preharvest_interval_hours_snapshot is null then 'phi_hours' end
  ], null) as missing_farm_rx_operational_fields
from public.effective_application_records ar
join public.application_products ap
  on ap.application_id = ar.id and ap.farm_id = ar.farm_id
where ap.is_restricted_use_snapshot = true;
