-- DRAFT ONLY: do not apply in Repair Round 2b.
-- Keeps the database views aligned with the TypeScript field-year resolver.
-- It replaces no source data and intentionally exposes blocked rows as NULL
-- money rather than choosing a newest agreement or a budget land fallback.

create or replace view public.arrangement_comparisons
with (security_invoker = true)
as
with budget_costs as (
  select cb.id as budget_id, cb.farm_id,
    coalesce(sum(bcl.amount_per_acre) filter (where bcl.category <> 'land'), 0) as non_land_cost,
    coalesce(sum(bcl.amount_per_acre) filter (where bcl.category = 'seed'), 0) as seed_cost,
    coalesce(sum(bcl.amount_per_acre) filter (where bcl.category = 'fertilizer'), 0) as fertilizer_cost,
    coalesce(sum(bcl.amount_per_acre) filter (where bcl.category = 'chemical'), 0) as chemical_cost,
    coalesce(sum(bcl.amount_per_acre) filter (where bcl.category = 'fuel'), 0) as fuel_cost,
    coalesce(sum(bcl.amount_per_acre) filter (where bcl.category in ('labor', 'custom')), 0) as labor_custom_cost,
    coalesce(sum(bcl.amount_per_acre) filter (where bcl.category = 'crop_insurance'), 0) as insurance_cost,
    coalesce(sum(bcl.amount_per_acre) filter (where bcl.category in ('equipment_depreciation', 'repairs')), 0) as equipment_cost,
    coalesce(sum(bcl.amount_per_acre) filter (where bcl.category = 'interest'), 0) as interest_cost
  from public.crop_budgets cb
  left join public.budget_cost_lines bcl on bcl.budget_id = cb.id and bcl.farm_id = cb.farm_id
  group by cb.id, cb.farm_id
), allocation_inputs as (
  select bfa.id as allocation_id, bfa.farm_id, bfa.budget_id, bfa.crop_assignment_id,
    ca.field_id, cb.crop_year, cb.commodity_id, cb.operating_entity_id, cb.enterprise_label,
    cb.name as budget_name, bfa.allocated_acres,
    coalesce(bfa.expected_yield_override, cb.expected_yield_per_acre) as yield_per_acre,
    coalesce(bfa.expected_price_override, cb.expected_price_per_bushel) as price_per_bushel,
    bc.non_land_cost, bc.seed_cost, bc.fertilizer_cost, bc.chemical_cost, bc.fuel_cost,
    bc.labor_custom_cost, bc.insurance_cost, bc.equipment_cost, bc.interest_cost
  from public.budget_field_allocations bfa
  join public.crop_budgets cb on cb.id = bfa.budget_id and cb.farm_id = bfa.farm_id
  join public.crop_assignments ca on ca.id = bfa.crop_assignment_id and ca.farm_id = bfa.farm_id
  join budget_costs bc on bc.budget_id = cb.id and bc.farm_id = cb.farm_id
), field_year_keys as (
  select distinct farm_id, field_id, crop_year
  from allocation_inputs
), field_year_crops as (
  -- Land is settled for the complete field-year.  Start from every planted
  -- crop, not just the rows that happen to have a budget allocation, then use
  -- the same allocation -> budget -> assignment fallbacks as the TypeScript
  -- resolver.  A missing sibling price therefore blocks instead of becoming $0.
  select fyk.farm_id, fyk.field_id, fyk.crop_year, ca.id as crop_assignment_id,
    ca.planted_acres, f.total_acres,
    coalesce(s.expected_yield_override, s.budget_yield_per_acre, ca.expected_yield_per_acre) as yield_per_acre,
    coalesce(s.expected_price_override, s.budget_price_per_bushel, ca.expected_price_per_bu) as price_per_bushel,
    coalesce(s.budget_count, 0) as budget_count,
    s.allocated_acres,
    (s.expected_yield_override is not null or s.expected_price_override is not null) as has_allocation_override
  from field_year_keys fyk
  join public.fields f on f.id = fyk.field_id and f.farm_id = fyk.farm_id
  join public.crop_assignments ca on ca.field_id = fyk.field_id and ca.farm_id = fyk.farm_id and ca.crop_year = fyk.crop_year
  left join lateral (
    select chosen.allocated_acres, chosen.expected_yield_override, chosen.expected_price_override,
      chosen.budget_yield_per_acre, chosen.budget_price_per_bushel, counts.budget_count
    from (
      select bfa.allocated_acres, bfa.expected_yield_override, bfa.expected_price_override,
        cb.expected_yield_per_acre as budget_yield_per_acre,
        cb.expected_price_per_bushel as budget_price_per_bushel
      from public.budget_field_allocations bfa
      join public.crop_budgets cb on cb.id = bfa.budget_id and cb.farm_id = bfa.farm_id
      where bfa.crop_assignment_id = ca.id and bfa.farm_id = ca.farm_id
      order by bfa.created_at, bfa.id
      limit 1
    ) chosen
    cross join lateral (
      select count(distinct bfa.budget_id) as budget_count
      from public.budget_field_allocations bfa
      where bfa.crop_assignment_id = ca.id and bfa.farm_id = ca.farm_id
    ) counts
  ) s on true
), field_year as (
  select farm_id, field_id, crop_year, total_acres,
    sum(planted_acres * yield_per_acre * price_per_bushel) as combined_revenue,
    sum(planted_acres) as total_planted_acres,
    bool_and(
      planted_acres > 0
      and yield_per_acre is not null
      and price_per_bushel is not null
      and budget_count <= 1
      and (not has_allocation_override or allocated_acres >= planted_acres)
    ) as all_priced
  from field_year_crops
  group by farm_id, field_id, crop_year, total_acres
), agreements as (
  select fy.farm_id, fy.field_id, fy.crop_year, count(a.id) as agreement_count,
    -- PostgreSQL has no min(uuid). This value is only used when agreement_count
    -- is exactly one, but the text sort keeps that otherwise-unused choice deterministic.
    min(a.id::text) filter (where a.id is not null)::uuid as arrangement_id
  from field_year fy
  left join public.arrangements a on a.field_id = fy.field_id and a.farm_id = fy.farm_id
    and a.effective_from <= make_date(fy.crop_year, 12, 31)
    and (a.effective_to is null or a.effective_to >= make_date(fy.crop_year, 1, 1))
  group by fy.farm_id, fy.field_id, fy.crop_year
), arranged as (
  select ai.*, fy.total_acres, fy.total_planted_acres, fy.combined_revenue, fy.all_priced, ag.agreement_count,
    a.id as arrangement_id, a.arrangement_type, a.effective_from, a.effective_to,
    a.cash_rent_per_acre, a.flex_bonus_formula, a.landlord_crop_pct,
    a.landlord_seed_pct, a.landlord_fertilizer_pct, a.landlord_chemical_pct,
    a.landlord_fuel_pct, a.landlord_labor_custom_pct, a.landlord_crop_insurance_pct,
    a.landlord_equipment_pct, a.landlord_interest_pct, a.landlord_other_input_pct
  from allocation_inputs ai
  join field_year fy on fy.farm_id = ai.farm_id and fy.field_id = ai.field_id and fy.crop_year = ai.crop_year
  join agreements ag on ag.farm_id = ai.farm_id and ag.field_id = ai.field_id and ag.crop_year = ai.crop_year
  left join public.arrangements a on a.id = ag.arrangement_id and a.farm_id = ai.farm_id
), calculated as (
  select ar.*,
    (ar.seed_cost * coalesce(ar.landlord_seed_pct, 0) / 100.0
      + ar.fertilizer_cost * coalesce(ar.landlord_fertilizer_pct, 0) / 100.0
      + ar.chemical_cost * coalesce(ar.landlord_chemical_pct, 0) / 100.0
      + ar.fuel_cost * coalesce(ar.landlord_fuel_pct, 0) / 100.0
      + ar.labor_custom_cost * coalesce(ar.landlord_labor_custom_pct, 0) / 100.0
      + ar.insurance_cost * coalesce(ar.landlord_crop_insurance_pct, 0) / 100.0
      + ar.equipment_cost * coalesce(ar.landlord_equipment_pct, 0) / 100.0
      + ar.interest_cost * coalesce(ar.landlord_interest_pct, 0) / 100.0) as landlord_paid_inputs,
    case
      when ar.agreement_count <> 1 or not ar.all_priced or ar.total_acres <= 0 then true
      when ar.arrangement_type = 'flex_cash_rent' and (
        ar.flex_bonus_formula is null or ar.flex_bonus_formula->>'method' not in ('base_plus_bonus', 'pct_of_revenue')
        or public.jsonb_numeric_or_null(ar.flex_bonus_formula, 'rate_pct') is null
        or (ar.flex_bonus_formula->>'method' = 'base_plus_bonus' and (
          public.jsonb_numeric_or_null(ar.flex_bonus_formula, 'base_rent_per_acre') is null
          or public.jsonb_numeric_or_null(ar.flex_bonus_formula, 'trigger_revenue_per_acre') is null))
      ) then true
      else false
    end as is_blocked
  from arranged ar
), normalized as (
  select c.*,
    case
      when c.is_blocked then null::numeric
      when c.arrangement_type = 'owned' then 0::numeric
      when c.arrangement_type = 'cash_rent' then c.cash_rent_per_acre
      when c.arrangement_type = 'crop_share' then
        c.yield_per_acre * c.price_per_bushel * coalesce(c.landlord_crop_pct, 0) / 100.0 - c.landlord_paid_inputs
      when c.arrangement_type = 'flex_cash_rent' then
        (
          case c.flex_bonus_formula->>'method'
            when 'base_plus_bonus' then least(
              coalesce(public.jsonb_numeric_or_null(c.flex_bonus_formula, 'max_rent_per_acre'), 999999999::numeric),
              public.jsonb_numeric_or_null(c.flex_bonus_formula, 'base_rent_per_acre')
                + greatest(0, c.combined_revenue / c.total_acres - public.jsonb_numeric_or_null(c.flex_bonus_formula, 'trigger_revenue_per_acre'))
                  * public.jsonb_numeric_or_null(c.flex_bonus_formula, 'rate_pct') / 100.0
            )
            when 'pct_of_revenue' then least(
              coalesce(public.jsonb_numeric_or_null(c.flex_bonus_formula, 'max_rent_per_acre'), 999999999::numeric),
              greatest(coalesce(public.jsonb_numeric_or_null(c.flex_bonus_formula, 'min_rent_per_acre'), -999999999::numeric),
                c.combined_revenue / c.total_acres * public.jsonb_numeric_or_null(c.flex_bonus_formula, 'rate_pct') / 100.0)
            )
          end
        )
    end as field_equivalent_cash_rent_per_acre
  from calculated c
), allocated as (
  select n.*, fyc.planted_acres as assignment_planted_acres,
    (fyc.planted_acres * fyc.yield_per_acre * fyc.price_per_bushel) as assignment_revenue
  from normalized n
  join field_year_crops fyc on fyc.farm_id = n.farm_id
    and fyc.field_id = n.field_id
    and fyc.crop_year = n.crop_year
    and fyc.crop_assignment_id = n.crop_assignment_id
), output as (
  select n.*,
    case
      when n.is_blocked then null::numeric
      -- Crop share remains a crop-specific settlement, including its own paid inputs.
      when n.arrangement_type = 'crop_share' then n.field_equivalent_cash_rent_per_acre
      -- Field-year cash/flex rent is one obligation. Match resolveFieldYearLand:
      -- allocate by crop revenue, or planted acres when all crop revenue is zero.
      when n.combined_revenue = 0 then n.field_equivalent_cash_rent_per_acre * n.total_acres / n.total_planted_acres
      else n.field_equivalent_cash_rent_per_acre * n.total_acres * n.assignment_revenue / n.combined_revenue / n.assignment_planted_acres
    end as equivalent_cash_rent_per_acre
  from allocated n
)
select n.allocation_id, n.farm_id, n.budget_id, n.crop_assignment_id, n.field_id,
  n.crop_year, n.commodity_id, n.operating_entity_id, n.enterprise_label, n.budget_name,
  n.allocated_acres, n.yield_per_acre, n.price_per_bushel, n.arrangement_id,
  n.arrangement_type, n.effective_from, n.effective_to,
  (not n.is_blocked or n.arrangement_type <> 'flex_cash_rent') as flex_formula_valid,
  n.non_land_cost::numeric(14, 4) as non_land_cost_per_acre,
  n.landlord_paid_inputs::numeric(14, 4) as landlord_paid_input_cost_per_acre,
  n.equivalent_cash_rent_per_acre::numeric(14, 4),
  case when n.is_blocked then null else n.non_land_cost + n.equivalent_cash_rent_per_acre end::numeric(14, 4) as operator_cost_per_acre,
  case when n.is_blocked then null else n.price_per_bushel * n.yield_per_acre - n.non_land_cost - n.equivalent_cash_rent_per_acre end::numeric(16, 4) as operator_net_per_acre,
  (n.agreement_count = 1) as is_effective_for_crop_year,
  n.is_blocked
from output n;

-- Same column order as 0006, with `is_blocked` appended so existing readers
-- remain compatible.  No generic budget land line is ever substituted here.
create or replace view public.field_profitability
with (security_invoker = true)
as
select ac.allocation_id, ac.farm_id, ac.budget_id, ac.crop_assignment_id, ac.field_id,
  ac.crop_year, ac.commodity_id, ac.operating_entity_id, ac.enterprise_label, ac.budget_name,
  ac.allocated_acres, ac.yield_per_acre, ac.price_per_bushel, ac.arrangement_id,
  ac.arrangement_type, ac.equivalent_cash_rent_per_acre,
  ac.operator_cost_per_acre::numeric(14, 4) as cost_per_acre,
  ac.operator_net_per_acre::numeric(16, 4),
  case when ac.is_blocked then null else ac.operator_cost_per_acre * ac.allocated_acres end::numeric(18, 2) as allocated_total_cost,
  case when ac.is_blocked then null else ac.operator_net_per_acre * ac.allocated_acres end::numeric(18, 2) as allocated_total_net,
  ac.is_blocked
from public.arrangement_comparisons ac;
