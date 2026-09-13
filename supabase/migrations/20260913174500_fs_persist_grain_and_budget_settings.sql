-- Friction Sweep slice 3: persist three values that lived in one browser.
--
-- 1. grain_sale_limits      the farmer's own sale limit per crop-year position
-- 2. grain_carry_settings   how the farm pays for storage (one row per farm)
-- 3. grain_carry_grids      the 13-month price grid per production estimate
-- 4. budget_cost_lines.university_default_amount
--                           the U of I default a cost line was seeded with, so
--                           the "U of I default" badge follows the line instead
--                           of one browser's localStorage
--
-- All rows are private financial data: readable with can_read_private_financials,
-- writable with can_edit_farm, exactly like grain_alert_settings. Nothing here
-- feeds contract, bin, delivery, or on-hand math; the sale limit is the farmer's
-- planning number and the carry grid is a calculator input.

-- ---------------------------------------------------------------------------
-- 1. Sale limit per five-part position scope
-- ---------------------------------------------------------------------------
create table public.grain_sale_limits (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  crop_year integer not null check (crop_year between 1900 and 2200),
  commodity_id text not null references public.commodities(id) on delete restrict,
  operating_entity_id uuid,
  enterprise_label text
    check (enterprise_label is null or length(btrim(enterprise_label)) between 1 and 160),
  -- null means "no limit set"; the screen then says "Set your own sale limit".
  sale_limit_bushels numeric(16, 2)
    check (sale_limit_bushels is null or sale_limit_bushels >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint grain_sale_limits_entity_same_farm_fk
    foreign key (operating_entity_id, farm_id)
    references public.entities(id, farm_id)
    on delete restrict
);

-- NULLS NOT DISTINCT keeps a whole-farm/no-enterprise scope unique too.
alter table public.grain_sale_limits
  add constraint grain_sale_limits_scope_unique
  unique nulls not distinct (farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label);

create index grain_sale_limits_commodity_id_idx
  on public.grain_sale_limits (commodity_id);
create index grain_sale_limits_entity_farm_idx
  on public.grain_sale_limits (operating_entity_id, farm_id);

-- ---------------------------------------------------------------------------
-- 2. Carry settings: one row per farm
-- ---------------------------------------------------------------------------
create table public.grain_carry_settings (
  farm_id uuid primary key references public.farms(id) on delete cascade,
  mode text not null default 'monthly' check (mode in ('monthly', 'flat')),
  monthly_rate_cents_per_bu_month numeric(10, 4) not null default 4
    check (monthly_rate_cents_per_bu_month >= 0),
  flat_rate_per_bu numeric(10, 4) not null default 0.18
    check (flat_rate_per_bu >= 0),
  interest_rate_pct numeric(8, 4) not null default 7
    check (interest_rate_pct >= 0 and interest_rate_pct <= 100),
  trucking_per_bu numeric(10, 4) not null default 0.12
    check (trucking_per_bu >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 3. Carry grid: thirteen delivery-month rows per production estimate
-- ---------------------------------------------------------------------------
-- Exactly 13 objects (harvest month plus twelve stored months), each holding a
-- market price and a basis that are a number or null (blank on the screen).
create function public.grain_carry_rows_valid(p_rows jsonb)
returns boolean
language sql
immutable
set search_path = public, pg_temp
as $$
  -- Guard each step explicitly so a scalar or an array of scalars is simply
  -- invalid (false) rather than a raw type error from the JSON functions.
  select case
    when p_rows is null or jsonb_typeof(p_rows) <> 'array' then false
    when jsonb_array_length(p_rows) <> 13 then false
    else not exists (
      select 1
      from jsonb_array_elements(p_rows) as e
      where case
        when jsonb_typeof(e) <> 'object' then true
        when (select count(*) from jsonb_object_keys(e)) <> 2 then true
        when not (e ? 'market_price') or not (e ? 'basis') then true
        when jsonb_typeof(e -> 'market_price') not in ('number', 'null') then true
        when jsonb_typeof(e -> 'basis') not in ('number', 'null') then true
        else false
      end
    )
  end;
$$;
revoke all on function public.grain_carry_rows_valid(jsonb) from public, anon;
grant execute on function public.grain_carry_rows_valid(jsonb) to authenticated, service_role;

create table public.grain_carry_grids (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  production_estimate_id uuid not null,
  harvest_month smallint not null check (harvest_month between 0 and 11),
  default_basis numeric(10, 4) not null default 0,
  rows jsonb not null check (public.grain_carry_rows_valid(rows)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (production_estimate_id, farm_id),
  constraint grain_carry_grids_estimate_same_farm_fk
    foreign key (production_estimate_id, farm_id)
    references public.production_estimates(id, farm_id)
    on delete cascade
);

create index grain_carry_grids_farm_id_idx
  on public.grain_carry_grids (farm_id);

-- ---------------------------------------------------------------------------
-- 4. Cost line: remember the university default it was seeded with
-- ---------------------------------------------------------------------------
alter table public.budget_cost_lines
  add column university_default_amount numeric(14, 4)
    check (university_default_amount is null or university_default_amount >= 0);

comment on column public.budget_cost_lines.university_default_amount is
  'The U of I budget amount this line was seeded with. The screen shows a "U of I default" badge while amount_per_acre still equals it. Null for hand-entered, copied, inventory, and equipment lines.';

-- ---------------------------------------------------------------------------
-- Triggers: updated_at and farm custody
-- ---------------------------------------------------------------------------
create trigger grain_sale_limits_set_updated_at
before update on public.grain_sale_limits
for each row execute function public.set_updated_at();
create trigger grain_carry_settings_set_updated_at
before update on public.grain_carry_settings
for each row execute function public.set_updated_at();
create trigger grain_carry_grids_set_updated_at
before update on public.grain_carry_grids
for each row execute function public.set_updated_at();

create trigger grain_sale_limits_prevent_farm_move
before update on public.grain_sale_limits
for each row execute function public.prevent_farm_id_change();
create trigger grain_carry_settings_prevent_farm_move
before update on public.grain_carry_settings
for each row execute function public.prevent_farm_id_change();
create trigger grain_carry_grids_prevent_farm_move
before update on public.grain_carry_grids
for each row execute function public.prevent_farm_id_change();

-- Access-epoch fencing (migration 0040): a request whose farm access epoch is
-- stale can never write a farm-scoped row, exactly like every other farm table.
create trigger farm_access_epoch_guard
before insert or update or delete on public.grain_sale_limits
for each row execute function public.guard_row_farm_access_epoch();
create trigger farm_access_epoch_guard
before insert or update or delete on public.grain_carry_settings
for each row execute function public.guard_row_farm_access_epoch();
create trigger farm_access_epoch_guard
before insert or update or delete on public.grain_carry_grids
for each row execute function public.guard_row_farm_access_epoch();

-- ---------------------------------------------------------------------------
-- Row Level Security: private financial read; writes need farm edit AND private
-- financial access, so a worker without financial access can neither read nor
-- seed these rows through the Data API.
-- ---------------------------------------------------------------------------
alter table public.grain_sale_limits enable row level security;
alter table public.grain_carry_settings enable row level security;
alter table public.grain_carry_grids enable row level security;

revoke all on table public.grain_sale_limits from public, anon;
revoke all on table public.grain_carry_settings from public, anon;
revoke all on table public.grain_carry_grids from public, anon;

grant select, insert, update, delete on table public.grain_sale_limits to authenticated;
grant select, insert, update, delete on table public.grain_carry_settings to authenticated;
grant select, insert, update, delete on table public.grain_carry_grids to authenticated;

create policy grain_sale_limits_select
on public.grain_sale_limits for select to authenticated
using (public.can_read_private_financials(farm_id));
create policy grain_sale_limits_insert
on public.grain_sale_limits for insert to authenticated
with check (public.can_edit_farm(farm_id) and public.can_read_private_financials(farm_id));
create policy grain_sale_limits_update
on public.grain_sale_limits for update to authenticated
using (public.can_edit_farm(farm_id) and public.can_read_private_financials(farm_id))
with check (public.can_edit_farm(farm_id) and public.can_read_private_financials(farm_id));
create policy grain_sale_limits_delete
on public.grain_sale_limits for delete to authenticated
using (public.can_edit_farm(farm_id) and public.can_read_private_financials(farm_id));

create policy grain_carry_settings_select
on public.grain_carry_settings for select to authenticated
using (public.can_read_private_financials(farm_id));
create policy grain_carry_settings_insert
on public.grain_carry_settings for insert to authenticated
with check (public.can_edit_farm(farm_id) and public.can_read_private_financials(farm_id));
create policy grain_carry_settings_update
on public.grain_carry_settings for update to authenticated
using (public.can_edit_farm(farm_id) and public.can_read_private_financials(farm_id))
with check (public.can_edit_farm(farm_id) and public.can_read_private_financials(farm_id));
create policy grain_carry_settings_delete
on public.grain_carry_settings for delete to authenticated
using (public.can_edit_farm(farm_id) and public.can_read_private_financials(farm_id));

create policy grain_carry_grids_select
on public.grain_carry_grids for select to authenticated
using (public.can_read_private_financials(farm_id));
create policy grain_carry_grids_insert
on public.grain_carry_grids for insert to authenticated
with check (public.can_edit_farm(farm_id) and public.can_read_private_financials(farm_id));
create policy grain_carry_grids_update
on public.grain_carry_grids for update to authenticated
using (public.can_edit_farm(farm_id) and public.can_read_private_financials(farm_id))
with check (public.can_edit_farm(farm_id) and public.can_read_private_financials(farm_id));
create policy grain_carry_grids_delete
on public.grain_carry_grids for delete to authenticated
using (public.can_edit_farm(farm_id) and public.can_read_private_financials(farm_id));
