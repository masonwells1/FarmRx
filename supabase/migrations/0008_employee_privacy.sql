-- DRAFT ONLY -- Employee privacy foundation for Farm Rx.
-- NEVER APPLIED BY THIS DESIGN SESSION.
-- Apply only after 0004_module2_grain.sql through
-- 0007_module4_rls.sql have been reviewed and applied in order.

-- A permission belongs to the membership whose lifecycle it follows. Keeping
-- it here avoids orphan permission rows and makes revocation automatic when a
-- membership is suspended or revoked. Owners and managers do not need the
-- flag; they can read private financial data by role. Every other active member
-- starts private and must be granted access deliberately.
alter table public.farm_memberships
  add column can_view_financials boolean not null default false;

-- This helper deliberately does NOT call can_access_farm(): ordinary active
-- membership is too broad for grain and profitability. Named Crop RX rep access
-- remains exactly the two-part rule from 0002: the farm share toggle must be on
-- AND this signed-in rep must have a current explicit grant.
create function public.can_read_private_financials(target_farm_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null
    and (
      exists (
        select 1
        from public.farm_memberships fm
        where fm.farm_id = target_farm_id
          and fm.user_id = auth.uid()
          and fm.status = 'active'
          and (
            fm.role in ('owner', 'manager')
            or fm.can_view_financials = true
          )
      )
      or public.has_explicit_rep_access(target_farm_id)
    );
$$;

revoke all on function public.can_read_private_financials(uuid)
  from public, anon;
grant execute on function public.can_read_private_financials(uuid)
  to authenticated;

-- Grain: replace only the read predicate. Existing write policies, same-farm
-- parent checks, immutable farm stamps, and named-rep no-write behavior remain
-- unchanged.
alter policy production_estimates_select
on public.production_estimates
using (
  public.can_read_private_financials(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1
      from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = production_estimates.farm_id
    )
  )
);

alter policy grain_contracts_select
on public.grain_contracts
using (
  public.can_read_private_financials(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1
      from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = grain_contracts.farm_id
    )
  )
);

alter policy marketing_plan_targets_select
on public.marketing_plan_targets
using (
  public.can_read_private_financials(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1
      from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = marketing_plan_targets.farm_id
    )
  )
);

alter policy insurance_units_select
on public.insurance_units
using (
  public.can_read_private_financials(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1
      from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = insurance_units.farm_id
    )
  )
);

alter policy grain_bins_select
on public.grain_bins
using (public.can_read_private_financials(farm_id));

alter policy bin_inventory_select
on public.bin_inventory
using (
  public.can_read_private_financials(farm_id)
  and exists (
    select 1
    from public.grain_bins gb
    where gb.id = grain_bin_id
      and gb.farm_id = bin_inventory.farm_id
  )
);

alter policy cash_bids_select
on public.cash_bids
using (public.can_read_private_financials(farm_id));

-- usda_report_dates intentionally stays a global signed-in lookup. It contains
-- public calendar facts, not a farm's grain position.

-- Profitability: the SECURITY INVOKER views in 0006 continue to use these base
-- table policies, so the same employee restriction automatically reaches every
-- financial calculation view.
alter policy crop_budgets_select
on public.crop_budgets
using (
  public.can_read_private_financials(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1
      from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = crop_budgets.farm_id
    )
  )
);

alter policy budget_cost_lines_select
on public.budget_cost_lines
using (
  public.can_read_private_financials(farm_id)
  and exists (
    select 1
    from public.crop_budgets cb
    where cb.id = budget_id
      and cb.farm_id = budget_cost_lines.farm_id
  )
);

alter policy profitability_matrix_steps_select
on public.profitability_matrix_steps
using (
  public.can_read_private_financials(farm_id)
  and exists (
    select 1
    from public.crop_budgets cb
    where cb.id = budget_id
      and cb.farm_id = profitability_matrix_steps.farm_id
  )
);

alter policy budget_field_allocations_select
on public.budget_field_allocations
using (
  public.can_read_private_financials(farm_id)
  and exists (
    select 1
    from public.crop_budgets cb
    where cb.id = budget_id
      and cb.farm_id = budget_field_allocations.farm_id
  )
  and exists (
    select 1
    from public.crop_assignments ca
    where ca.id = crop_assignment_id
      and ca.farm_id = budget_field_allocations.farm_id
  )
);

-- Permission administration deliberately reuses the existing
-- farm_memberships INSERT/UPDATE policies from 0002. Only an active owner or
-- manager can change a membership, and both roles already have full financial
-- access. Workers and read-only members cannot grant this flag to themselves.
