-- DRAFT ONLY -- Module 4 (Profitability) foundation for Farm Rx.
-- PostgreSQL 17 / Supabase. Review before applying to any database.
-- Depends on 0001. It deliberately does not depend on the draft grain tables
-- in 0004, so Modules 2 and 4 can be reviewed and sequenced independently.

create type public.profitability_cost_category as enum (
  'seed',
  'chemical',
  'fertilizer',
  'fuel',
  'repairs',
  'labor',
  'land',
  'crop_insurance',
  'equipment_depreciation',
  'interest',
  'custom'
);

create type public.profitability_matrix_axis as enum (
  'price',
  'yield'
);

-- A budget is one named scenario, such as "Base", "High fertilizer", or
-- "Reduced pass". Optional entity and enterprise scopes match Module 2, but
-- no grain-table foreign key is needed. copied_from_budget_id records lineage;
-- the application copies child lines and steps in the same transaction.
create table public.crop_budgets (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  crop_year integer not null check (crop_year between 1900 and 2200),
  commodity_id text not null references public.commodities(id) on delete restrict,
  operating_entity_id uuid,
  enterprise_label text
    check (enterprise_label is null or length(btrim(enterprise_label)) between 1 and 160),
  name text not null check (length(btrim(name)) between 1 and 160),
  expected_yield_per_acre numeric(12, 4) not null check (expected_yield_per_acre > 0),
  expected_price_per_bushel numeric(12, 6) not null check (expected_price_per_bushel > 0),
  copied_from_budget_id uuid,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint crop_budgets_entity_same_farm_fk
    foreign key (operating_entity_id, farm_id)
    references public.entities(id, farm_id)
    on delete restrict,
  constraint crop_budgets_copy_source_same_farm_fk
    foreign key (copied_from_budget_id, farm_id)
    references public.crop_budgets(id, farm_id)
    on delete set null (copied_from_budget_id),
  constraint crop_budgets_not_copied_from_self check (
    copied_from_budget_id is null or copied_from_budget_id <> id
  )
);

-- NULLS NOT DISTINCT prevents duplicate whole-farm or no-enterprise scenarios.
alter table public.crop_budgets
  add constraint crop_budgets_scope_name_unique
  unique nulls not distinct (
    farm_id,
    crop_year,
    commodity_id,
    operating_entity_id,
    enterprise_label,
    name
  );

-- One row is one per-acre cost. Standard categories stay reportable; custom
-- rows require their own plain-English label. source_kind/source_record_id are
-- a deliberate future hook for Inventory and Equipment without referencing a
-- table that does not exist yet.
create table public.budget_cost_lines (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  budget_id uuid not null,
  category public.profitability_cost_category not null,
  label text not null check (length(btrim(label)) between 1 and 160),
  amount_per_acre numeric(14, 4) not null check (amount_per_acre >= 0),
  source_kind text not null default 'manual'
    check (source_kind in ('manual', 'inventory', 'equipment')),
  source_record_id uuid,
  sort_order smallint not null default 0 check (sort_order >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  unique (budget_id, sort_order),
  constraint budget_cost_lines_budget_same_farm_fk
    foreign key (budget_id, farm_id)
    references public.crop_budgets(id, farm_id)
    on delete cascade,
  constraint budget_cost_lines_source_consistent check (
    (source_kind = 'manual' and source_record_id is null)
    or (source_kind in ('inventory', 'equipment') and source_record_id is not null)
  )
);

-- Price and yield axes are stored as ordered steps. The matrix itself is a
-- derived cross-product view, avoiding stale stored profit/loss cells.
create table public.profitability_matrix_steps (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  budget_id uuid not null,
  axis public.profitability_matrix_axis not null,
  step_order smallint not null check (step_order >= 0),
  value numeric(14, 6) not null check (value > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  unique (budget_id, axis, step_order),
  unique (budget_id, axis, value),
  constraint profitability_matrix_steps_budget_same_farm_fk
    foreign key (budget_id, farm_id)
    references public.crop_budgets(id, farm_id)
    on delete cascade
);

-- Allocations apply a crop budget to actual planted acres. field_id is not
-- duplicated: crop_assignments is the authoritative link to the field. Yield
-- and price overrides support per-field planning without changing the budget.
create table public.budget_field_allocations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  budget_id uuid not null,
  crop_assignment_id uuid not null,
  allocated_acres numeric(12, 2) not null check (allocated_acres > 0),
  expected_yield_override numeric(12, 4)
    check (expected_yield_override is null or expected_yield_override > 0),
  expected_price_override numeric(12, 6)
    check (expected_price_override is null or expected_price_override > 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  unique (budget_id, crop_assignment_id),
  constraint budget_field_allocations_budget_same_farm_fk
    foreign key (budget_id, farm_id)
    references public.crop_budgets(id, farm_id)
    on delete cascade,
  constraint budget_field_allocations_assignment_same_farm_fk
    foreign key (crop_assignment_id, farm_id)
    references public.crop_assignments(id, farm_id)
    on delete cascade
);

create index crop_budgets_farm_year_commodity_idx
  on public.crop_budgets (farm_id, crop_year, commodity_id);
create index crop_budgets_entity_farm_idx
  on public.crop_budgets (operating_entity_id, farm_id);
create index crop_budgets_copy_source_farm_idx
  on public.crop_budgets (copied_from_budget_id, farm_id);
create index budget_cost_lines_budget_farm_idx
  on public.budget_cost_lines (budget_id, farm_id);
create index budget_cost_lines_farm_category_idx
  on public.budget_cost_lines (farm_id, category);
create index profitability_matrix_steps_budget_farm_idx
  on public.profitability_matrix_steps (budget_id, farm_id);
create index budget_field_allocations_budget_farm_idx
  on public.budget_field_allocations (budget_id, farm_id);
create index budget_field_allocations_assignment_farm_idx
  on public.budget_field_allocations (crop_assignment_id, farm_id);

-- Cross-check all facts that cannot be expressed by separate foreign keys:
-- crop year and commodity must match, entity-scoped budgets may allocate only
-- that entity's fields, and allocated acres may not exceed planted acres.
create function public.validate_budget_field_allocation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  budget_row public.crop_budgets%rowtype;
  assignment_row public.crop_assignments%rowtype;
  assignment_entity_id uuid;
begin
  select * into budget_row
  from public.crop_budgets cb
  where cb.id = new.budget_id
    and cb.farm_id = new.farm_id;

  select ca.* into assignment_row
  from public.crop_assignments ca
  where ca.id = new.crop_assignment_id
    and ca.farm_id = new.farm_id;

  if budget_row.id is null or assignment_row.id is null then
    raise exception 'budget and crop assignment must belong to this farm';
  end if;

  if budget_row.crop_year <> assignment_row.crop_year
    or budget_row.commodity_id <> assignment_row.commodity_id then
    raise exception 'budget crop year and commodity must match the crop assignment';
  end if;

  select f.operating_entity_id into assignment_entity_id
  from public.fields f
  where f.id = assignment_row.field_id
    and f.farm_id = new.farm_id;

  if assignment_entity_id is null then
    raise exception 'crop assignment field does not belong to this farm';
  end if;

  if budget_row.operating_entity_id is not null
    and budget_row.operating_entity_id <> assignment_entity_id then
    raise exception 'entity-scoped budget can only be allocated to that entity''s fields';
  end if;

  if new.allocated_acres > assignment_row.planted_acres then
    raise exception 'allocated acres (%) cannot exceed planted acres (%)',
      new.allocated_acres, assignment_row.planted_acres;
  end if;

  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'crop_budgets',
    'budget_cost_lines',
    'profitability_matrix_steps',
    'budget_field_allocations'
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
    'crop_budgets',
    'budget_cost_lines',
    'profitability_matrix_steps',
    'budget_field_allocations'
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

create trigger budget_field_allocations_validate
before insert or update of farm_id, budget_id, crop_assignment_id, allocated_acres
on public.budget_field_allocations
for each row execute function public.validate_budget_field_allocation();

create function public.prevent_allocated_budget_scope_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (new.crop_year is distinct from old.crop_year
      or new.commodity_id is distinct from old.commodity_id
      or new.operating_entity_id is distinct from old.operating_entity_id)
    and exists (
      select 1
      from public.budget_field_allocations bfa
      where bfa.budget_id = old.id
        and bfa.farm_id = old.farm_id
    ) then
    raise exception 'remove field allocations before changing a budget crop, year, or entity';
  end if;
  return new;
end;
$$;

create trigger crop_budgets_prevent_allocated_scope_change
before update of crop_year, commodity_id, operating_entity_id
on public.crop_budgets
for each row execute function public.prevent_allocated_budget_scope_change();

-- Safe JSON-number extraction keeps a malformed flex formula from causing a
-- cast error inside a report. This is a pure calculation helper, not a
-- SECURITY DEFINER access helper.
create function public.jsonb_numeric_or_null(document jsonb, key_name text)
returns numeric
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when jsonb_typeof(document -> key_name) = 'number'
      then (document ->> key_name)::numeric
    else null::numeric
  end;
$$;

-- All calculation views are SECURITY INVOKER. Selecting them evaluates the
-- caller's RLS on the underlying private tables.
create view public.crop_budget_cost_totals
with (security_invoker = true)
as
select
  cb.id as budget_id,
  cb.farm_id,
  cb.crop_year,
  cb.commodity_id,
  cb.operating_entity_id,
  cb.enterprise_label,
  cb.name,
  cb.expected_yield_per_acre,
  cb.expected_price_per_bushel,
  coalesce(sum(bcl.amount_per_acre), 0)::numeric(14, 4) as total_cost_per_acre,
  coalesce(sum(bcl.amount_per_acre) filter (where bcl.category <> 'land'), 0)::numeric(14, 4)
    as non_land_cost_per_acre,
  coalesce(sum(bcl.amount_per_acre) filter (where bcl.category = 'land'), 0)::numeric(14, 4)
    as planned_land_cost_per_acre
from public.crop_budgets cb
left join public.budget_cost_lines bcl
  on bcl.budget_id = cb.id
 and bcl.farm_id = cb.farm_id
group by cb.id;

create view public.crop_budget_analysis
with (security_invoker = true)
as
select
  cbt.*,
  (cbt.expected_yield_per_acre * cbt.expected_price_per_bushel)::numeric(16, 4)
    as expected_revenue_per_acre,
  (cbt.expected_yield_per_acre * cbt.expected_price_per_bushel
    - cbt.total_cost_per_acre)::numeric(16, 4) as expected_profit_per_acre,
  (cbt.total_cost_per_acre / cbt.expected_yield_per_acre)::numeric(14, 6)
    as breakeven_price_per_bushel,
  (cbt.total_cost_per_acre / cbt.expected_price_per_bushel)::numeric(14, 4)
    as breakeven_yield_per_acre,
  (cbt.total_cost_per_acre / cbt.expected_price_per_bushel)::numeric(14, 4)
    as bushels_to_cover_total_cost
from public.crop_budget_cost_totals cbt;

create view public.budget_cost_line_analysis
with (security_invoker = true)
as
select
  bcl.id,
  bcl.farm_id,
  bcl.budget_id,
  bcl.category,
  bcl.label,
  bcl.amount_per_acre,
  bcl.source_kind,
  bcl.source_record_id,
  bcl.sort_order,
  cb.expected_price_per_bushel,
  (bcl.amount_per_acre / cb.expected_price_per_bushel)::numeric(14, 4)
    as bushels_to_cover
from public.budget_cost_lines bcl
join public.crop_budgets cb
  on cb.id = bcl.budget_id
 and cb.farm_id = bcl.farm_id;

create view public.profitability_matrix_cells
with (security_invoker = true)
as
select
  cb.id as budget_id,
  cb.farm_id,
  cb.crop_year,
  cb.commodity_id,
  cb.operating_entity_id,
  cb.enterprise_label,
  cb.name as budget_name,
  ps.step_order as price_step_order,
  ps.value as price_per_bushel,
  ys.step_order as yield_step_order,
  ys.value as yield_per_acre,
  cbt.total_cost_per_acre,
  (ps.value * ys.value)::numeric(16, 4) as revenue_per_acre,
  (ps.value * ys.value - cbt.total_cost_per_acre)::numeric(16, 4)
    as profit_per_acre,
  (ps.value * ys.value >= cbt.total_cost_per_acre) as is_profitable
from public.crop_budgets cb
join public.crop_budget_cost_totals cbt
  on cbt.budget_id = cb.id
 and cbt.farm_id = cb.farm_id
join public.profitability_matrix_steps ps
  on ps.budget_id = cb.id
 and ps.farm_id = cb.farm_id
 and ps.axis = 'price'
join public.profitability_matrix_steps ys
  on ys.budget_id = cb.id
 and ys.farm_id = cb.farm_id
 and ys.axis = 'yield';

-- Every saved arrangement for an allocated field becomes a comparison row.
-- Land is not a duplicate table here: the arrangement remains the source of
-- lease terms. Generic budget land cost is excluded and replaced by the
-- normalized equivalent-cash-rent amount.
create view public.arrangement_comparisons
with (security_invoker = true)
as
with categorized_costs as (
  select
    cb.id as budget_id,
    cb.farm_id,
    coalesce(sum(bcl.amount_per_acre) filter (where bcl.category <> 'land'), 0) as non_land_cost,
    coalesce(sum(bcl.amount_per_acre) filter (where bcl.category = 'seed'), 0) as seed_cost,
    coalesce(sum(bcl.amount_per_acre) filter (where bcl.category = 'fertilizer'), 0) as fertilizer_cost,
    coalesce(sum(bcl.amount_per_acre) filter (where bcl.category = 'chemical'), 0) as chemical_cost,
    coalesce(sum(bcl.amount_per_acre) filter (where bcl.category = 'fuel'), 0) as fuel_cost,
    coalesce(sum(bcl.amount_per_acre) filter (where bcl.category = 'labor'), 0) as labor_cost,
    coalesce(sum(bcl.amount_per_acre) filter (where bcl.category = 'crop_insurance'), 0) as insurance_cost,
    coalesce(sum(bcl.amount_per_acre) filter (where bcl.category in ('equipment_depreciation', 'repairs')), 0)
      as equipment_cost,
    coalesce(sum(bcl.amount_per_acre) filter (where bcl.category = 'interest'), 0) as interest_cost,
    coalesce(sum(bcl.amount_per_acre) filter (where bcl.category = 'custom'), 0) as other_cost
  from public.crop_budgets cb
  left join public.budget_cost_lines bcl
    on bcl.budget_id = cb.id and bcl.farm_id = cb.farm_id
  group by cb.id
), comparison_inputs as (
  select
    bfa.id as allocation_id,
    bfa.farm_id,
    bfa.budget_id,
    bfa.crop_assignment_id,
    ca.field_id,
    cb.crop_year,
    cb.commodity_id,
    cb.operating_entity_id,
    cb.enterprise_label,
    cb.name as budget_name,
    bfa.allocated_acres,
    coalesce(bfa.expected_yield_override, cb.expected_yield_per_acre) as yield_per_acre,
    coalesce(bfa.expected_price_override, cb.expected_price_per_bushel) as price_per_bushel,
    a.id as arrangement_id,
    a.arrangement_type,
    a.effective_from,
    a.effective_to,
    a.cash_rent_per_acre,
    a.flex_bonus_formula,
    a.landlord_crop_pct,
    cc.non_land_cost,
    (cc.seed_cost * a.landlord_seed_pct / 100.0
      + cc.fertilizer_cost * a.landlord_fertilizer_pct / 100.0
      + cc.chemical_cost * a.landlord_chemical_pct / 100.0
      + cc.fuel_cost * a.landlord_fuel_pct / 100.0
      + cc.labor_cost * a.landlord_labor_custom_pct / 100.0
      + cc.insurance_cost * a.landlord_crop_insurance_pct / 100.0
      + cc.equipment_cost * a.landlord_equipment_pct / 100.0
      + cc.interest_cost * a.landlord_interest_pct / 100.0
      + cc.other_cost * a.landlord_other_input_pct / 100.0) as landlord_paid_inputs,
    case
      when a.arrangement_type <> 'flex_cash_rent' then true
      when a.flex_bonus_formula ?& array['basis', 'trigger', 'rate_pct']
        and a.flex_bonus_formula->>'basis' in ('price', 'yield', 'revenue')
        and public.jsonb_numeric_or_null(a.flex_bonus_formula, 'trigger') is not null
        and public.jsonb_numeric_or_null(a.flex_bonus_formula, 'rate_pct') is not null
        and (not (a.flex_bonus_formula ? 'cap_per_acre')
          or public.jsonb_numeric_or_null(a.flex_bonus_formula, 'cap_per_acre') is not null)
        and public.jsonb_numeric_or_null(a.flex_bonus_formula, 'trigger') >= 0
        and public.jsonb_numeric_or_null(a.flex_bonus_formula, 'rate_pct') between 0 and 100
        and (not (a.flex_bonus_formula ? 'cap_per_acre')
          or public.jsonb_numeric_or_null(a.flex_bonus_formula, 'cap_per_acre') >= 0)
        then true
      else false
    end as flex_formula_valid
  from public.budget_field_allocations bfa
  join public.crop_budgets cb
    on cb.id = bfa.budget_id and cb.farm_id = bfa.farm_id
  join categorized_costs cc
    on cc.budget_id = cb.id and cc.farm_id = cb.farm_id
  join public.crop_assignments ca
    on ca.id = bfa.crop_assignment_id and ca.farm_id = bfa.farm_id
  join public.arrangements a
    on a.field_id = ca.field_id and a.farm_id = bfa.farm_id
), flex_math as (
  select
    ci.*,
    case
      when ci.arrangement_type <> 'flex_cash_rent' then 0::numeric
      when not ci.flex_formula_valid then null::numeric
      else greatest(
        case ci.flex_bonus_formula->>'basis'
          when 'price' then
            (ci.price_per_bushel
              - public.jsonb_numeric_or_null(ci.flex_bonus_formula, 'trigger'))
              * ci.yield_per_acre
          when 'yield' then
            (ci.yield_per_acre
              - public.jsonb_numeric_or_null(ci.flex_bonus_formula, 'trigger'))
              * ci.price_per_bushel
          when 'revenue' then
            (ci.price_per_bushel * ci.yield_per_acre
              - public.jsonb_numeric_or_null(ci.flex_bonus_formula, 'trigger'))
        end,
        0
      ) * public.jsonb_numeric_or_null(ci.flex_bonus_formula, 'rate_pct') / 100.0
    end as uncapped_flex_bonus
  from comparison_inputs ci
), normalized as (
  select
    fm.*,
    case fm.arrangement_type
      when 'owned' then 0::numeric
      when 'cash_rent' then fm.cash_rent_per_acre
      when 'flex_cash_rent' then
        fm.cash_rent_per_acre
        + case
            when fm.uncapped_flex_bonus is null then null
            when fm.flex_bonus_formula ? 'cap_per_acre' then least(
              fm.uncapped_flex_bonus,
              public.jsonb_numeric_or_null(fm.flex_bonus_formula, 'cap_per_acre')
            )
            else fm.uncapped_flex_bonus
          end
      when 'crop_share' then
        (fm.price_per_bushel * fm.yield_per_acre * fm.landlord_crop_pct / 100.0)
          - fm.landlord_paid_inputs
    end as equivalent_cash_rent_per_acre
  from flex_math fm
)
select
  n.allocation_id,
  n.farm_id,
  n.budget_id,
  n.crop_assignment_id,
  n.field_id,
  n.crop_year,
  n.commodity_id,
  n.operating_entity_id,
  n.enterprise_label,
  n.budget_name,
  n.allocated_acres,
  n.yield_per_acre,
  n.price_per_bushel,
  n.arrangement_id,
  n.arrangement_type,
  n.effective_from,
  n.effective_to,
  n.flex_formula_valid,
  n.non_land_cost::numeric(14, 4) as non_land_cost_per_acre,
  n.landlord_paid_inputs::numeric(14, 4) as landlord_paid_input_cost_per_acre,
  n.equivalent_cash_rent_per_acre::numeric(14, 4),
  (n.non_land_cost + n.equivalent_cash_rent_per_acre)::numeric(14, 4)
    as operator_cost_per_acre,
  (n.price_per_bushel * n.yield_per_acre
    - n.non_land_cost - n.equivalent_cash_rent_per_acre)::numeric(16, 4)
    as operator_net_per_acre,
  (n.effective_from <= make_date(n.crop_year, 12, 31)
    and (n.effective_to is null or n.effective_to >= make_date(n.crop_year, 1, 1)))
    as is_effective_for_crop_year
from normalized n;

-- Cost/acre by field uses the latest arrangement effective in the crop year.
-- If setup is incomplete and no arrangement exists yet, it falls back to the
-- budget's planned land line instead of dropping the field from the report.
create view public.field_profitability
with (security_invoker = true)
as
with ranked as (
  select
    ac.*,
    row_number() over (
      partition by ac.allocation_id
      order by ac.effective_from desc, ac.arrangement_id
    ) as arrangement_rank
  from public.arrangement_comparisons ac
  where ac.is_effective_for_crop_year
), allocation_inputs as (
  select
    bfa.id as allocation_id,
    bfa.farm_id,
    bfa.budget_id,
    bfa.crop_assignment_id,
    ca.field_id,
    cb.crop_year,
    cb.commodity_id,
    cb.operating_entity_id,
    cb.enterprise_label,
    cb.name as budget_name,
    bfa.allocated_acres,
    coalesce(bfa.expected_yield_override, cb.expected_yield_per_acre) as yield_per_acre,
    coalesce(bfa.expected_price_override, cb.expected_price_per_bushel) as price_per_bushel,
    cbt.total_cost_per_acre
  from public.budget_field_allocations bfa
  join public.crop_budgets cb
    on cb.id = bfa.budget_id and cb.farm_id = bfa.farm_id
  join public.crop_assignments ca
    on ca.id = bfa.crop_assignment_id and ca.farm_id = bfa.farm_id
  join public.crop_budget_cost_totals cbt
    on cbt.budget_id = cb.id and cbt.farm_id = cb.farm_id
), resolved as (
  select
    ai.*,
    r.arrangement_id,
    r.arrangement_type,
    r.equivalent_cash_rent_per_acre,
    case
      when r.arrangement_id is null then ai.total_cost_per_acre
      else r.operator_cost_per_acre
    end as resolved_cost_per_acre,
    case
      when r.arrangement_id is null then
        ai.price_per_bushel * ai.yield_per_acre - ai.total_cost_per_acre
      else r.operator_net_per_acre
    end as resolved_net_per_acre
  from allocation_inputs ai
  left join ranked r
    on r.allocation_id = ai.allocation_id
   and r.arrangement_rank = 1
)
select
  r.allocation_id,
  r.farm_id,
  r.budget_id,
  r.crop_assignment_id,
  r.field_id,
  r.crop_year,
  r.commodity_id,
  r.operating_entity_id,
  r.enterprise_label,
  r.budget_name,
  r.allocated_acres,
  r.yield_per_acre,
  r.price_per_bushel,
  r.arrangement_id,
  r.arrangement_type,
  r.equivalent_cash_rent_per_acre,
  r.resolved_cost_per_acre::numeric(14, 4) as cost_per_acre,
  r.resolved_net_per_acre::numeric(16, 4) as operator_net_per_acre,
  (r.resolved_cost_per_acre * r.allocated_acres)::numeric(18, 2) as allocated_total_cost,
  (r.resolved_net_per_acre * r.allocated_acres)::numeric(18, 2) as allocated_total_net
from resolved r;
