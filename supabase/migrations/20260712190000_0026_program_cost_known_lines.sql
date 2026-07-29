-- 0026 — Chunk 5: Programs cost views — add "known-lines" columns and fix partial-cost shape.
--
-- WHY A NEW MIGRATION: 0024_programs.sql is already applied to the farm-rx project. Editing it
-- would leave the on-disk migration diverged from the live views. This forward migration uses
-- CREATE OR REPLACE VIEW (never DROP — the rollup depends on the base view) to:
--   1. Fix the partial-cost shape: planned_cost_per_acre / total_planned_cost must be NULL unless
--      EVERY active planned line is priced (previously they returned the raw sum even when the
--      estimate was incomplete, which the client contract rejects → whole Programs page crashed).
--      actual_cost_per_acre / total_actual_cost were already gated; kept as-is.
--   2. Add planned_known_cost_per_acre / actual_known_cost_per_acre = the sum of the lines that DO
--      carry a cost, so the UI can honestly show a "partial estimate" of known lines instead of $0.
--
-- CREATE OR REPLACE VIEW requires all existing columns to keep the same name/order/type; new
-- columns may only be appended at the end. Base view is replaced first so the rollup can then
-- reference the appended base column. security_invoker + authenticated SELECT grants preserved.

create or replace view public.program_assignment_costs
with (security_invoker = true)
as
with line_costs as (
  select
    pa.id as assignment_id,
    pa.farm_id,
    count(app.id) filter (where ap.status <> 'cancelled') as planned_line_count,
    count(app.estimated_cost_per_acre) filter (where ap.status <> 'cancelled') as planned_cost_count,
    case
      when count(app.id) filter (where ap.status <> 'cancelled') = 0 then 0::numeric
      else sum(app.estimated_cost_per_acre) filter (where ap.status <> 'cancelled')
    end as planned_cost_sum,
    count(app.id) filter (where ap.status = 'applied') as actual_line_count,
    count(app.actual_cost_per_acre) filter (where ap.status = 'applied') as actual_cost_count,
    sum(app.actual_cost_per_acre) filter (where ap.status = 'applied') as actual_cost_sum,
    sum(app.actual_cost_per_acre * ap.applied_acres)
      filter (where ap.status = 'applied') as actual_total_sum
  from public.program_assignments pa
  left join public.assigned_program_passes ap
    on ap.assignment_id = pa.id and ap.farm_id = pa.farm_id
  left join public.assigned_program_pass_products app
    on app.assigned_pass_id = ap.id and app.farm_id = ap.farm_id and app.is_active
  group by pa.id, pa.farm_id
)
select
  pa.id as assignment_id,
  pa.farm_id,
  pa.program_id,
  pa.crop_assignment_id,
  pa.program_name_snapshot,
  pa.program_kind_snapshot,
  pa.status as assignment_status,
  ca.planted_acres,
  lc.planned_line_count = lc.planned_cost_count as planned_cost_is_complete,
  case
    when lc.planned_line_count = lc.planned_cost_count then lc.planned_cost_sum::numeric
    else null::numeric
  end as planned_cost_per_acre,
  case
    when lc.planned_line_count = lc.planned_cost_count
      then (lc.planned_cost_sum * ca.planted_acres)::numeric
    else null::numeric
  end as total_planned_cost,
  (lc.actual_line_count > 0 and lc.actual_line_count = lc.actual_cost_count)
    as actual_cost_is_complete,
  case
    when lc.actual_line_count > 0 and lc.actual_line_count = lc.actual_cost_count
      then lc.actual_cost_sum::numeric
    else null::numeric
  end as actual_cost_per_acre,
  case
    when lc.actual_line_count > 0 and lc.actual_line_count = lc.actual_cost_count
      then lc.actual_total_sum
    else null::numeric
  end as total_actual_cost,
  -- appended: known-lines sums (always present, even when the estimate is incomplete)
  lc.planned_cost_sum::numeric as planned_known_cost_per_acre,
  lc.actual_cost_sum::numeric as actual_known_cost_per_acre
from public.program_assignments pa
join public.crop_assignments ca
  on ca.id = pa.crop_assignment_id and ca.farm_id = pa.farm_id
join line_costs lc
  on lc.assignment_id = pa.id and lc.farm_id = pa.farm_id;

create or replace view public.program_crop_cost_rollups
with (security_invoker = true)
as
select
  pac.farm_id,
  pac.crop_assignment_id,
  max(pac.planted_acres)::numeric as planted_acres,
  bool_and(pac.planned_cost_is_complete) as planned_cost_is_complete,
  case when bool_and(pac.planned_cost_is_complete)
    then sum(pac.planned_cost_per_acre)::numeric else null::numeric end
    as planned_cost_per_acre,
  case when bool_and(pac.planned_cost_is_complete)
    then sum(pac.total_planned_cost)::numeric else null::numeric end
    as total_planned_cost,
  bool_and(pac.actual_cost_is_complete) as actual_cost_is_complete,
  case when bool_and(pac.actual_cost_is_complete)
    then sum(pac.actual_cost_per_acre)::numeric else null::numeric end
    as actual_cost_per_acre,
  case when bool_and(pac.actual_cost_is_complete)
    then sum(pac.total_actual_cost)::numeric else null::numeric end
    as total_actual_cost,
  jsonb_agg(
    jsonb_build_object(
      'assignment_id', pac.assignment_id,
      'program_id', pac.program_id,
      'program_name', pac.program_name_snapshot,
      'program_kind', pac.program_kind_snapshot,
      'planned_cost_per_acre', pac.planned_cost_per_acre,
      'planned_cost_is_complete', pac.planned_cost_is_complete,
      'actual_cost_per_acre', pac.actual_cost_per_acre,
      'actual_cost_is_complete', pac.actual_cost_is_complete
    ) order by pac.program_name_snapshot, pac.assignment_id
  ) as included_programs,
  (
    select jsonb_object_agg(kind, subtotal order by kind)
    from (
      select
        coalesce(pac2.program_kind_snapshot, 'other') as kind,
        jsonb_build_object(
          'planned_cost_is_complete', bool_and(pac2.planned_cost_is_complete),
          'planned_cost_per_acre', case when bool_and(pac2.planned_cost_is_complete)
            then sum(pac2.planned_cost_per_acre)::numeric else null::numeric end,
          'total_planned_cost', case when bool_and(pac2.planned_cost_is_complete)
            then sum(pac2.total_planned_cost)::numeric else null::numeric end,
          'actual_cost_is_complete', bool_and(pac2.actual_cost_is_complete),
          'actual_cost_per_acre', case when bool_and(pac2.actual_cost_is_complete)
            then sum(pac2.actual_cost_per_acre)::numeric else null::numeric end,
          'total_actual_cost', case when bool_and(pac2.actual_cost_is_complete)
            then sum(pac2.total_actual_cost)::numeric else null::numeric end
        ) as subtotal
      from public.program_assignment_costs pac2
      where pac2.farm_id = pac.farm_id
        and pac2.crop_assignment_id = pac.crop_assignment_id
        and pac2.assignment_status = 'active'
      group by coalesce(pac2.program_kind_snapshot, 'other')
    ) category_costs
  ) as category_subtotals,
  -- appended: known-lines sums across the crop's active assignments (never null-gated)
  sum(pac.planned_known_cost_per_acre)::numeric as planned_known_cost_per_acre,
  sum(pac.actual_known_cost_per_acre)::numeric as actual_known_cost_per_acre
from public.program_assignment_costs pac
where pac.assignment_status = 'active'
group by pac.farm_id, pac.crop_assignment_id;

revoke all on table
  public.program_assignment_costs,
  public.program_crop_cost_rollups
from public, anon, authenticated;
grant select on table
  public.program_assignment_costs,
  public.program_crop_cost_rollups
to authenticated;
