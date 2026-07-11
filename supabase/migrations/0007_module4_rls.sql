-- DRAFT ONLY -- Module 4 Row Level Security (RLS) for Farm Rx.
-- Profitability data is as private as grain. This file reuses, and does not
-- redefine, the access helpers established by 0002_module1_rls.sql.

alter table public.crop_budgets enable row level security;
alter table public.budget_cost_lines enable row level security;
alter table public.profitability_matrix_steps enable row level security;
alter table public.budget_field_allocations enable row level security;

revoke all on table public.crop_budgets from anon;
revoke all on table public.budget_cost_lines from anon;
revoke all on table public.profitability_matrix_steps from anon;
revoke all on table public.budget_field_allocations from anon;
revoke all on table public.crop_budget_cost_totals from anon;
revoke all on table public.crop_budget_analysis from anon;
revoke all on table public.budget_cost_line_analysis from anon;
revoke all on table public.profitability_matrix_cells from anon;
revoke all on table public.arrangement_comparisons from anon;
revoke all on table public.field_profitability from anon;

grant select, insert, update, delete on table public.crop_budgets to authenticated;
grant select, insert, update, delete on table public.budget_cost_lines to authenticated;
grant select, insert, update, delete on table public.profitability_matrix_steps to authenticated;
grant select, insert, update, delete on table public.budget_field_allocations to authenticated;
grant select on table public.crop_budget_cost_totals to authenticated;
grant select on table public.crop_budget_analysis to authenticated;
grant select on table public.budget_cost_line_analysis to authenticated;
grant select on table public.profitability_matrix_cells to authenticated;
grant select on table public.arrangement_comparisons to authenticated;
grant select on table public.field_profitability to authenticated;

-- Rules 2, 3, 4, and 12: can_access_farm() checks active membership or BOTH
-- the farm share toggle and a current grant for this exact rep on every read.
-- Reps receive no write policy; all writes require can_edit_farm().
create policy crop_budgets_select
on public.crop_budgets for select to authenticated
using (
  public.can_access_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = crop_budgets.farm_id
    )
  )
);

create policy crop_budgets_insert
on public.crop_budgets for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = crop_budgets.farm_id
    )
  )
);

create policy crop_budgets_update
on public.crop_budgets for update to authenticated
using (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = crop_budgets.farm_id
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
        and e.farm_id = crop_budgets.farm_id
    )
  )
);

create policy crop_budgets_delete
on public.crop_budgets for delete to authenticated
using (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = crop_budgets.farm_id
    )
  )
);

-- Rules 5 and 10: each child policy repeats the same-farm parent check that
-- its composite foreign key enforces outside RLS.
create policy budget_cost_lines_select
on public.budget_cost_lines for select to authenticated
using (
  public.can_access_farm(farm_id)
  and exists (
    select 1 from public.crop_budgets cb
    where cb.id = budget_id and cb.farm_id = budget_cost_lines.farm_id
  )
);

create policy budget_cost_lines_insert
on public.budget_cost_lines for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.crop_budgets cb
    where cb.id = budget_id and cb.farm_id = budget_cost_lines.farm_id
  )
);

create policy budget_cost_lines_update
on public.budget_cost_lines for update to authenticated
using (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.crop_budgets cb
    where cb.id = budget_id and cb.farm_id = budget_cost_lines.farm_id
  )
)
with check (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.crop_budgets cb
    where cb.id = budget_id and cb.farm_id = budget_cost_lines.farm_id
  )
);

create policy budget_cost_lines_delete
on public.budget_cost_lines for delete to authenticated
using (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.crop_budgets cb
    where cb.id = budget_id and cb.farm_id = budget_cost_lines.farm_id
  )
);

create policy profitability_matrix_steps_select
on public.profitability_matrix_steps for select to authenticated
using (
  public.can_access_farm(farm_id)
  and exists (
    select 1 from public.crop_budgets cb
    where cb.id = budget_id and cb.farm_id = profitability_matrix_steps.farm_id
  )
);

create policy profitability_matrix_steps_insert
on public.profitability_matrix_steps for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.crop_budgets cb
    where cb.id = budget_id and cb.farm_id = profitability_matrix_steps.farm_id
  )
);

create policy profitability_matrix_steps_update
on public.profitability_matrix_steps for update to authenticated
using (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.crop_budgets cb
    where cb.id = budget_id and cb.farm_id = profitability_matrix_steps.farm_id
  )
)
with check (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.crop_budgets cb
    where cb.id = budget_id and cb.farm_id = profitability_matrix_steps.farm_id
  )
);

create policy profitability_matrix_steps_delete
on public.profitability_matrix_steps for delete to authenticated
using (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.crop_budgets cb
    where cb.id = budget_id and cb.farm_id = profitability_matrix_steps.farm_id
  )
);

create policy budget_field_allocations_select
on public.budget_field_allocations for select to authenticated
using (
  public.can_access_farm(farm_id)
  and exists (
    select 1 from public.crop_budgets cb
    where cb.id = budget_id and cb.farm_id = budget_field_allocations.farm_id
  )
  and exists (
    select 1 from public.crop_assignments ca
    where ca.id = crop_assignment_id
      and ca.farm_id = budget_field_allocations.farm_id
  )
);

create policy budget_field_allocations_insert
on public.budget_field_allocations for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.crop_budgets cb
    where cb.id = budget_id and cb.farm_id = budget_field_allocations.farm_id
  )
  and exists (
    select 1 from public.crop_assignments ca
    where ca.id = crop_assignment_id
      and ca.farm_id = budget_field_allocations.farm_id
  )
);

create policy budget_field_allocations_update
on public.budget_field_allocations for update to authenticated
using (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.crop_budgets cb
    where cb.id = budget_id and cb.farm_id = budget_field_allocations.farm_id
  )
  and exists (
    select 1 from public.crop_assignments ca
    where ca.id = crop_assignment_id
      and ca.farm_id = budget_field_allocations.farm_id
  )
)
with check (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.crop_budgets cb
    where cb.id = budget_id and cb.farm_id = budget_field_allocations.farm_id
  )
  and exists (
    select 1 from public.crop_assignments ca
    where ca.id = crop_assignment_id
      and ca.farm_id = budget_field_allocations.farm_id
  )
);

create policy budget_field_allocations_delete
on public.budget_field_allocations for delete to authenticated
using (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.crop_budgets cb
    where cb.id = budget_id and cb.farm_id = budget_field_allocations.farm_id
  )
  and exists (
    select 1 from public.crop_assignments ca
    where ca.id = crop_assignment_id
      and ca.farm_id = budget_field_allocations.farm_id
  )
);

-- Rule 6: UPDATE policies check old and proposed rows; inserts use WITH CHECK;
-- deletes use USING. prevent_farm_id_change() makes every farm stamp immutable.
-- Rule 7: this migration defines no SECURITY DEFINER functions and reuses only
-- the restricted identity helpers from 0002.
-- Rule 8: every Module 4 view is SECURITY INVOKER.
-- Rule 9: there are no profitability file objects yet. Future PDFs must use
-- the farm_id-first storage path and policies established in 0002.
-- Rule 11 applies to regulated compliance rows, not editable budget plans.
--
-- FOUNDATION PRIVACY HOOK: this intentionally mirrors the current Module 2
-- active-member read rule. Before the first employee login, replace the read
-- helper for both grain and financial tables with an owner/manager plus
-- per-member override helper. Do not broaden rep access while making that fix.
