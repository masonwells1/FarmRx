-- Final exact database boundary for Scenario NF after NF-1 through NF-8.
do $verify$
declare
  north_farm public.farms%rowtype;
  rep_epoch public.farm_access_epochs%rowtype;
  north_task public.farm_tasks%rowtype;
  north_estimate public.production_estimates%rowtype;
  north_budget public.crop_budgets%rowtype;
  north_cost public.budget_cost_lines%rowtype;
  membership_matrix text;
begin
  select * into strict north_farm from public.farms where id='27010000-0000-4000-8000-000000000002';
  if north_farm.name is distinct from 'North Fork'
    or north_farm.share_with_rep is distinct from false
    or north_farm.created_by is distinct from '27000000-0000-4000-8000-000000000001'
    or north_farm.created_at is distinct from '2027-02-09 13:55:00+00'
    or north_farm.updated_at is distinct from '2027-02-09 16:00:00+00'
    or north_farm.time_zone is distinct from 'America/Chicago' then
    raise exception 'North final farm row is not exact';
  end if;

  select * into strict rep_epoch from public.farm_access_epochs
  where farm_id='27010000-0000-4000-8000-000000000002'
    and user_id='27000000-0000-4000-8000-000000000005';
  if rep_epoch.access_epoch is distinct from 3
    or rep_epoch.updated_at is distinct from '2027-02-09 16:00:00+00' then
    raise exception 'North final rep epoch is not exact';
  end if;

  if exists (
    select 1 from public.farm_access_epochs
    where farm_id='27010000-0000-4000-8000-000000000002'
      and user_id in (
        '27000000-0000-4000-8000-000000000001',
        '27000000-0000-4000-8000-000000000002',
        '27000000-0000-4000-8000-000000000003',
        '27000000-0000-4000-8000-000000000004'
      )
      and access_epoch<>1
  ) then
    raise exception 'A North member epoch changed unexpectedly';
  end if;

  select * into strict north_task from public.farm_tasks where id='27061000-0000-4000-8000-000000000002';
  if north_task.farm_id is distinct from '27010000-0000-4000-8000-000000000002'
    or north_task.title is distinct from 'Inspect North Home gate'
    or north_task.details is distinct from 'Check synthetic gate latch.'
    or north_task.status is distinct from 'done'
    or north_task.priority is distinct from 'normal'
    or north_task.assigned_to is distinct from '27000000-0000-4000-8000-000000000003'
    or north_task.due_on is distinct from date '2027-02-10'
    or north_task.field_id is distinct from '27020000-0000-4000-8000-000000000002'
    or north_task.equipment_id is not null
    or north_task.source is distinct from 'manual'
    or north_task.interval_id is not null
    or north_task.interval_cycle_key is not null
    or north_task.program_assigned_pass_id is not null
    or north_task.program_cycle_key is not null
    or north_task.completed_by is distinct from '27000000-0000-4000-8000-000000000002'
    or north_task.completed_at is distinct from '2027-02-09 15:40:00+00'
    or north_task.created_by is distinct from '27000000-0000-4000-8000-000000000003'
    or north_task.created_at is distinct from '2027-02-09 15:00:00+00'
    or north_task.updated_at is distinct from '2027-02-09 15:40:00+00' then
    raise exception 'North final task row is not exact';
  end if;
  if exists(select 1 from public.farm_tasks where id='27061000-0000-4000-8000-000000000003')
    or (select count(*) from public.farm_tasks where farm_id='27010000-0000-4000-8000-000000000002')<>1 then
    raise exception 'A denied or duplicate North task survived';
  end if;

  select * into strict north_estimate from public.production_estimates where id='27070000-0000-4000-8000-000000000002';
  if north_estimate.farm_id is distinct from '27010000-0000-4000-8000-000000000002'
    or north_estimate.crop_year is distinct from 2027
    or north_estimate.commodity_id is distinct from 'corn_yellow'
    or north_estimate.planted_acres is distinct from 80
    or north_estimate.aph_yield is distinct from 190
    or north_estimate.expected_bushels is distinct from 15200
    or north_estimate.actual_bushels is not null
    or north_estimate.drives_math is distinct from 'projected'
    or north_estimate.notes is distinct from 'Synthetic North private Grain sentinel'
    or north_estimate.created_at is distinct from '2027-02-09 13:55:00+00'
    or north_estimate.updated_at is distinct from '2027-02-09 13:55:00+00' then
    raise exception 'North private Grain sentinel changed';
  end if;

  select * into strict north_budget from public.crop_budgets where id='27077000-0000-4000-8000-000000000002';
  select * into strict north_cost from public.budget_cost_lines where id='27077100-0000-4000-8000-000000000002';
  if north_budget.farm_id is distinct from '27010000-0000-4000-8000-000000000002'
    or north_budget.name is distinct from 'Synthetic North 2027 Base'
    or north_budget.expected_yield_per_acre is distinct from 190
    or north_budget.expected_price_per_bushel is distinct from 4.20
    or north_budget.updated_at is distinct from '2027-02-09 13:55:00+00'
    or north_cost.farm_id is distinct from north_budget.farm_id
    or north_cost.budget_id is distinct from north_budget.id
    or north_cost.label is distinct from 'Synthetic North seed'
    or north_cost.amount_per_acre is distinct from 100
    or north_cost.updated_at is distinct from '2027-02-09 13:55:00+00' then
    raise exception 'North private profitability sentinel changed';
  end if;

  select string_agg(user_id::text||':'||role::text||':'||status::text||':'||can_view_financials::text,',' order by user_id)
  into membership_matrix from public.farm_memberships
  where farm_id='27010000-0000-4000-8000-000000000002';
  if membership_matrix is distinct from
    '27000000-0000-4000-8000-000000000001:owner:active:false,'||
    '27000000-0000-4000-8000-000000000002:manager:active:false,'||
    '27000000-0000-4000-8000-000000000003:worker:active:false,'||
    '27000000-0000-4000-8000-000000000004:read_only:active:false'
  or exists (
    select 1 from public.farm_memberships
    where farm_id='27010000-0000-4000-8000-000000000002'
      and user_id<>'27000000-0000-4000-8000-000000000001'
      and (created_at<>'2027-02-09 13:55:00+00' or updated_at<>'2027-02-09 13:55:00+00')
  ) or exists (
    select 1 from public.farm_memberships
    where farm_id='27010000-0000-4000-8000-000000000002'
      and user_id='27000000-0000-4000-8000-000000000001'
      and (created_at<>'2027-02-09 13:55:00+00' or updated_at<>'2027-02-09 13:55:00+00')
  ) or (select count(*) from public.farm_rep_access
        where farm_id='27010000-0000-4000-8000-000000000002')<>1
  or exists (
    select 1 from public.farm_rep_access
    where farm_id='27010000-0000-4000-8000-000000000002'
      and (rep_user_id<>'27000000-0000-4000-8000-000000000005'
        or enabled<>true or revoked_at is not null
        or granted_by<>'27000000-0000-4000-8000-000000000001'
        or granted_at<>'2027-02-09 13:55:00+00'
        or created_at<>'2027-02-09 13:55:00+00'
        or updated_at<>'2027-02-09 13:55:00+00')
  ) then
    raise exception 'North membership or rep-grant rows changed';
  end if;
end
$verify$;

select 'NORTH_FORK_2027_VERIFY_PASS';
