-- DRAFT ONLY -- Module 4 (Profitability) LIVE support for Farm Rx.
-- PostgreSQL 17 / Supabase. Review before applying to any database.
-- Depends on 0006 (profitability tables/constraints/triggers), 0007 (RLS), and
-- the identity helpers from 0002 (can_edit_farm, can_read_private_financials).
-- Applies cleanly immediately after 0012_grain_live_support.sql.
--
-- Two SECURITY DEFINER functions, written to the exact standard of
-- 0012_grain_live_support.sql: explicit auth.uid() check; explicit
-- can_edit_farm AND can_read_private_financials checks; set search_path;
-- trusted arguments are the only farm/scope stamps; client timestamps rejected;
-- revoke from public/anon/authenticated then grant execute to authenticated;
-- and a commented, not-run companion reviewer script at the bottom.
--
-- Both cross several rows across the profitability tables and must be
-- all-or-nothing so a half-finished save can never corrupt a budget.

-- ============================================================================
-- 6a. replace_profitability_matrix_steps
-- Desired-state replacement of one budget's price/yield matrix steps in a
-- single transaction. The budget's matrix is defined by exactly the submitted
-- set: every submitted id is written, every unsubmitted step is removed.
--
-- The two unique constraints on the table -- (budget_id, axis, step_order) and
-- (budget_id, axis, value) -- make a naive per-row upsert unsafe: a common edit
-- (shifting every price/yield value up or down one notch while re-using the
-- same ids) would transiently collide on `value` mid-statement, because these
-- constraints are non-deferrable and are checked immediately per row. To handle
-- both constraints safely we take a per-budget advisory lock, validate the
-- entire desired state first, then delete this budget's steps and insert the
-- submitted set fresh (preserving each existing row's created_at). Because the
-- submitted set is validated distinct on step_order and value per axis, the
-- fresh insert cannot collide with itself, and deleting first removes every old
-- row that could otherwise collide. A submitted id that already lives under
-- another budget is rejected up front and, in the residual race, fails closed on
-- the primary-key insert. The whole function runs inside the caller's
-- transaction, so any raise rolls the budget back to its prior matrix.
-- ============================================================================
create or replace function public.replace_profitability_matrix_steps(
  p_farm_id uuid,
  p_budget_id uuid,
  p_steps jsonb
)
returns setof public.profitability_matrix_steps
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_step jsonb;
  v_step_id uuid;
  v_value numeric;
  v_sort_num numeric;
  v_step_ids uuid[] := array[]::uuid[];
  v_existing public.profitability_matrix_steps%rowtype;
  v_created_map jsonb;
  v_written_count integer := 0;
  v_axis_rec record;
begin
  if p_farm_id is null then
    raise exception 'farm ID is required';
  end if;

  if p_budget_id is null then
    raise exception 'budget ID is required';
  end if;

  if v_caller is null then
    raise exception 'authentication is required';
  end if;

  -- SECURITY DEFINER rule: callers must independently have both ordinary edit
  -- access and private-financial read access before this RPC reads or writes.
  if not public.can_edit_farm(p_farm_id)
    or not public.can_read_private_financials(p_farm_id) then
    raise exception 'you do not have permission to edit this farm''s profitability';
  end if;

  if not exists (
    select 1
    from public.crop_budgets cb
    where cb.id = p_budget_id
      and cb.farm_id = p_farm_id
  ) then
    raise exception 'budget does not belong to this farm';
  end if;

  if jsonb_typeof(p_steps) is distinct from 'array' then
    raise exception 'matrix steps must be a JSON array';
  end if;

  -- Serialize concurrent matrix saves for the same budget. A hash collision can
  -- only serialize unrelated saves; it can never mix their rows.
  perform pg_advisory_xact_lock(hashtextextended(p_budget_id::text, 0));

  -- Validate the complete desired state before changing a row. Complete rows
  -- carry farm-facing budget_id, axis, value, sort_order, but trusted arguments
  -- remain the only tenant/scope stamps. Client timestamps are rejected.
  for v_step in
    select value from jsonb_array_elements(p_steps)
  loop
    if jsonb_typeof(v_step) is distinct from 'object' then
      raise exception 'each matrix step must be a JSON object';
    end if;

    if v_step ?| array['created_at', 'updated_at'] then
      raise exception 'client timestamps are not accepted for matrix steps';
    end if;

    if not (v_step ? 'id')
      or jsonb_typeof(v_step -> 'id') is distinct from 'string'
      or nullif(v_step ->> 'id', '') is null then
      raise exception 'each matrix step requires an ID';
    end if;
    v_step_id := (v_step ->> 'id')::uuid;

    if v_step_id = any(v_step_ids) then
      raise exception 'matrix step ID is duplicated in the submission';
    end if;

    if not (v_step ? 'budget_id')
      or jsonb_typeof(v_step -> 'budget_id') is distinct from 'string'
      or (v_step ->> 'budget_id')::uuid <> p_budget_id then
      raise exception 'matrix step is outside the supplied budget';
    end if;

    if not (v_step ? 'axis')
      or jsonb_typeof(v_step -> 'axis') is distinct from 'string'
      or (v_step ->> 'axis') not in ('price', 'yield') then
      raise exception 'matrix step axis must be price or yield';
    end if;

    if not (v_step ? 'value')
      or jsonb_typeof(v_step -> 'value') is distinct from 'number' then
      raise exception 'matrix step value must be a finite number';
    end if;
    v_value := (v_step ->> 'value')::numeric;
    if v_value <= 0 then
      raise exception 'matrix step value must be greater than zero';
    end if;

    if not (v_step ? 'sort_order')
      or jsonb_typeof(v_step -> 'sort_order') is distinct from 'number' then
      raise exception 'matrix step order must be a whole number';
    end if;
    v_sort_num := (v_step ->> 'sort_order')::numeric;
    if v_sort_num <> trunc(v_sort_num) or v_sort_num < 0 then
      raise exception 'matrix step order must be a non-negative whole number';
    end if;

    -- A client UUID may replace only a row already in this farm+budget. This
    -- blocks cross-farm or cross-budget ID reuse from becoming an overwrite.
    select pms.*
      into v_existing
    from public.profitability_matrix_steps pms
    where pms.id = v_step_id
    for update;

    if found and (
      v_existing.farm_id <> p_farm_id
      or v_existing.budget_id <> p_budget_id
    ) then
      raise exception 'matrix step ID already belongs to another budget';
    end if;

    v_step_ids := array_append(v_step_ids, v_step_id);
  end loop;

  -- A budget's matrix is only meaningful with both axes present, so an empty or
  -- single-axis submission is rejected before any row changes.
  if (
    select count(distinct s.axis)
    from (
      select elem ->> 'axis' as axis
      from jsonb_array_elements(p_steps) as elem
    ) s
  ) <> 2 then
    raise exception 'the matrix needs both a price axis and a yield axis';
  end if;

  -- Per axis: at least two steps, unique+sequential step order from zero, and
  -- unique values. This matches the table's two unique constraints and gives a
  -- friendly error before a constraint would fire.
  for v_axis_rec in
    select
      s.axis,
      count(*) as step_count,
      count(distinct s.step_order) as distinct_orders,
      count(distinct s.value) as distinct_values,
      min(s.step_order) as min_order,
      max(s.step_order) as max_order
    from (
      select
        elem ->> 'axis' as axis,
        (elem ->> 'sort_order')::numeric as step_order,
        (elem ->> 'value')::numeric as value
      from jsonb_array_elements(p_steps) as elem
    ) s
    group by s.axis
  loop
    if v_axis_rec.step_count < 2 then
      raise exception 'each price or yield axis needs at least two steps';
    end if;
    if v_axis_rec.distinct_orders <> v_axis_rec.step_count then
      raise exception 'matrix step order is duplicated within an axis';
    end if;
    if v_axis_rec.distinct_values <> v_axis_rec.step_count then
      raise exception 'matrix step value is duplicated within an axis';
    end if;
    if v_axis_rec.min_order <> 0
      or v_axis_rec.max_order <> v_axis_rec.step_count - 1 then
      raise exception 'matrix step order must run in sequence from zero';
    end if;
  end loop;

  -- Preserve each existing row's created_at across the delete+insert. The
  -- interface never reads created_at, but keeping it stable avoids churn and
  -- keeps replays deterministic.
  select coalesce(jsonb_object_agg(pms.id::text, pms.created_at), '{}'::jsonb)
    into v_created_map
  from public.profitability_matrix_steps pms
  where pms.farm_id = p_farm_id
    and pms.budget_id = p_budget_id;

  delete from public.profitability_matrix_steps
  where farm_id = p_farm_id
    and budget_id = p_budget_id;

  insert into public.profitability_matrix_steps (
    id,
    farm_id,
    budget_id,
    axis,
    step_order,
    value,
    created_at
  )
  select
    (elem ->> 'id')::uuid,
    p_farm_id,
    p_budget_id,
    (elem ->> 'axis')::public.profitability_matrix_axis,
    ((elem ->> 'sort_order')::numeric)::smallint,
    (elem ->> 'value')::numeric,
    coalesce((v_created_map ->> (elem ->> 'id'))::timestamptz, now())
  from jsonb_array_elements(p_steps) as elem;

  get diagnostics v_written_count = row_count;

  -- Closes the race in which another transaction inserted a submitted UUID in a
  -- different budget after validation but before this insert reached the PK.
  if v_written_count <> jsonb_array_length(p_steps) then
    raise exception 'one or more matrix step IDs belong to another budget';
  end if;

  return query
  select pms.*
  from public.profitability_matrix_steps pms
  where pms.farm_id = p_farm_id
    and pms.budget_id = p_budget_id
  order by pms.axis, pms.step_order;
end;
$$;

revoke all on function public.replace_profitability_matrix_steps(
  uuid, uuid, jsonb
) from public, anon, authenticated;

grant execute on function public.replace_profitability_matrix_steps(
  uuid, uuid, jsonb
) to authenticated;

-- ============================================================================
-- 6b. copy_crop_budget
-- All-or-nothing copy of a budget plus its cost lines and matrix steps into a
-- new, client-minted budget id in one transaction. The client deep-clones the
-- source, mints new ids for the budget and every child, re-parents each child
-- to the new budget id, and stamps copied_from_budget_id = source. This RPC
-- validates ownership and structure, then inserts the budget, the cost lines,
-- and (via the sibling matrix RPC) the matrix steps in one transaction.
--
-- Idempotent on replay: every id is minted once on the client, so a replayed
-- queue entry re-inserts the identical rows. Budget and cost-line inserts use
-- ON CONFLICT (id) DO NOTHING, the matrix is replaced to its identical desired
-- state, and a completeness count guarantees a child id that collided with
-- another budget can never leave a partial (corrupt) copy -- it rolls back.
-- ============================================================================
create or replace function public.copy_crop_budget(
  p_farm_id uuid,
  p_source_id uuid,
  p_budget jsonb,
  p_cost_lines jsonb,
  p_matrix_steps jsonb
)
returns public.crop_budgets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_new_budget_id uuid;
  v_crop_year_num numeric;
  v_crop_year integer;
  v_commodity_id text;
  v_operating_entity_id uuid;
  v_enterprise_label text;
  v_name text;
  v_expected_yield numeric;
  v_expected_price numeric;
  v_notes text;
  v_line jsonb;
  v_line_id uuid;
  v_label text;
  v_amount numeric;
  v_sort_num numeric;
  v_line_ids uuid[] := array[]::uuid[];
  v_line_sort_orders numeric[] := array[]::numeric[];
  v_line_count integer := 0;
  v_new_budget public.crop_budgets%rowtype;
begin
  if p_farm_id is null then
    raise exception 'farm ID is required';
  end if;

  if p_source_id is null then
    raise exception 'source budget ID is required';
  end if;

  if v_caller is null then
    raise exception 'authentication is required';
  end if;

  if not public.can_edit_farm(p_farm_id)
    or not public.can_read_private_financials(p_farm_id) then
    raise exception 'you do not have permission to edit this farm''s profitability';
  end if;

  if not exists (
    select 1
    from public.crop_budgets cb
    where cb.id = p_source_id
      and cb.farm_id = p_farm_id
  ) then
    raise exception 'choose a budget from this farm to copy';
  end if;

  -- ---- Validate the new budget row ----
  if jsonb_typeof(p_budget) is distinct from 'object' then
    raise exception 'the new budget must be a JSON object';
  end if;

  if p_budget ?| array['created_at', 'updated_at'] then
    raise exception 'client timestamps are not accepted for the new budget';
  end if;

  if not (p_budget ? 'id')
    or jsonb_typeof(p_budget -> 'id') is distinct from 'string'
    or nullif(p_budget ->> 'id', '') is null then
    raise exception 'the new budget requires an ID';
  end if;
  v_new_budget_id := (p_budget ->> 'id')::uuid;
  if v_new_budget_id = p_source_id then
    raise exception 'the new budget must have a different ID from the source';
  end if;

  if not (p_budget ? 'farm_id')
    or jsonb_typeof(p_budget -> 'farm_id') is distinct from 'string'
    or (p_budget ->> 'farm_id')::uuid <> p_farm_id then
    raise exception 'the new budget is outside the supplied farm';
  end if;

  if not (p_budget ? 'crop_year')
    or jsonb_typeof(p_budget -> 'crop_year') is distinct from 'number' then
    raise exception 'the new budget requires a crop year';
  end if;
  v_crop_year_num := (p_budget ->> 'crop_year')::numeric;
  if v_crop_year_num <> trunc(v_crop_year_num)
    or v_crop_year_num < 1900
    or v_crop_year_num > 2200 then
    raise exception 'crop year must be a whole number between 1900 and 2200';
  end if;
  v_crop_year := v_crop_year_num::integer;

  if not (p_budget ? 'commodity_id')
    or jsonb_typeof(p_budget -> 'commodity_id') is distinct from 'string'
    or nullif(p_budget ->> 'commodity_id', '') is null then
    raise exception 'the new budget requires a commodity';
  end if;
  v_commodity_id := p_budget ->> 'commodity_id';
  if not exists (
    select 1 from public.commodities c where c.id = v_commodity_id
  ) then
    raise exception 'commodity does not exist';
  end if;

  if not (p_budget ? 'operating_entity_id')
    or jsonb_typeof(p_budget -> 'operating_entity_id') not in ('null', 'string') then
    raise exception 'operating entity must be null or an ID';
  end if;
  if jsonb_typeof(p_budget -> 'operating_entity_id') = 'string' then
    v_operating_entity_id := (p_budget ->> 'operating_entity_id')::uuid;
    if not exists (
      select 1 from public.entities e
      where e.id = v_operating_entity_id
        and e.farm_id = p_farm_id
    ) then
      raise exception 'operating entity does not belong to this farm';
    end if;
  else
    v_operating_entity_id := null;
  end if;

  if not (p_budget ? 'enterprise_label')
    or jsonb_typeof(p_budget -> 'enterprise_label') not in ('null', 'string') then
    raise exception 'enterprise label must be null or text';
  end if;
  if jsonb_typeof(p_budget -> 'enterprise_label') = 'string' then
    v_enterprise_label := p_budget ->> 'enterprise_label';
    if v_enterprise_label <> btrim(v_enterprise_label)
      or length(v_enterprise_label) not between 1 and 160 then
      raise exception 'enterprise label must be trimmed and between 1 and 160 characters';
    end if;
  else
    v_enterprise_label := null;
  end if;

  if not (p_budget ? 'name')
    or jsonb_typeof(p_budget -> 'name') is distinct from 'string' then
    raise exception 'the new budget requires a name';
  end if;
  v_name := p_budget ->> 'name';
  if v_name <> btrim(v_name) or length(v_name) not between 1 and 160 then
    raise exception 'budget name must be trimmed and between 1 and 160 characters';
  end if;

  if not (p_budget ? 'expected_yield_per_acre')
    or jsonb_typeof(p_budget -> 'expected_yield_per_acre') is distinct from 'number' then
    raise exception 'expected yield per acre must be a finite number';
  end if;
  v_expected_yield := (p_budget ->> 'expected_yield_per_acre')::numeric;
  if v_expected_yield <= 0 then
    raise exception 'expected yield per acre must be greater than zero';
  end if;

  if not (p_budget ? 'expected_price_per_bushel')
    or jsonb_typeof(p_budget -> 'expected_price_per_bushel') is distinct from 'number' then
    raise exception 'expected price per bushel must be a finite number';
  end if;
  v_expected_price := (p_budget ->> 'expected_price_per_bushel')::numeric;
  if v_expected_price <= 0 then
    raise exception 'expected price per bushel must be greater than zero';
  end if;

  if not (p_budget ? 'copied_from_budget_id')
    or jsonb_typeof(p_budget -> 'copied_from_budget_id') is distinct from 'string'
    or (p_budget ->> 'copied_from_budget_id')::uuid <> p_source_id then
    raise exception 'the new budget must record the source it was copied from';
  end if;

  if p_budget ? 'notes'
    and jsonb_typeof(p_budget -> 'notes') not in ('null', 'string') then
    raise exception 'budget notes must be null or text';
  end if;
  if jsonb_typeof(p_budget -> 'notes') = 'string' then
    v_notes := p_budget ->> 'notes';
  else
    v_notes := null;
  end if;

  -- ---- Validate the cost lines ----
  if jsonb_typeof(p_cost_lines) is distinct from 'array' then
    raise exception 'cost lines must be a JSON array';
  end if;

  for v_line in
    select value from jsonb_array_elements(p_cost_lines)
  loop
    if jsonb_typeof(v_line) is distinct from 'object' then
      raise exception 'each cost line must be a JSON object';
    end if;

    if v_line ?| array['created_at', 'updated_at'] then
      raise exception 'client timestamps are not accepted for cost lines';
    end if;

    if not (v_line ? 'id')
      or jsonb_typeof(v_line -> 'id') is distinct from 'string'
      or nullif(v_line ->> 'id', '') is null then
      raise exception 'each cost line requires an ID';
    end if;
    v_line_id := (v_line ->> 'id')::uuid;
    if v_line_id = any(v_line_ids) then
      raise exception 'cost line ID is duplicated in the copy';
    end if;

    if not (v_line ? 'budget_id')
      or jsonb_typeof(v_line -> 'budget_id') is distinct from 'string'
      or (v_line ->> 'budget_id')::uuid <> v_new_budget_id then
      raise exception 'cost line is outside the new budget';
    end if;

    if not (v_line ? 'category')
      or jsonb_typeof(v_line -> 'category') is distinct from 'string'
      or (v_line ->> 'category') not in (
        'seed', 'chemical', 'fertilizer', 'fuel', 'repairs', 'labor', 'land',
        'crop_insurance', 'equipment_depreciation', 'interest', 'custom'
      ) then
      raise exception 'cost line category is not a recognized category';
    end if;

    if not (v_line ? 'label')
      or jsonb_typeof(v_line -> 'label') is distinct from 'string' then
      raise exception 'each cost line requires a label';
    end if;
    v_label := v_line ->> 'label';
    if v_label <> btrim(v_label) or length(v_label) not between 1 and 160 then
      raise exception 'cost line label must be trimmed and between 1 and 160 characters';
    end if;

    if not (v_line ? 'amount_per_acre')
      or jsonb_typeof(v_line -> 'amount_per_acre') is distinct from 'number' then
      raise exception 'cost line amount per acre must be a finite number';
    end if;
    v_amount := (v_line ->> 'amount_per_acre')::numeric;
    if v_amount < 0 then
      raise exception 'cost line amount per acre cannot be negative';
    end if;

    -- The interface writes manual cost lines only; the DB CHECK enforces the
    -- (manual, null) pairing, and we reject anything else up front.
    if not (v_line ? 'source_kind')
      or (v_line ->> 'source_kind') is distinct from 'manual' then
      raise exception 'copied cost lines must be manual';
    end if;
    if v_line ? 'source_record_id'
      and jsonb_typeof(v_line -> 'source_record_id') is distinct from 'null' then
      raise exception 'manual cost lines cannot reference a source record';
    end if;

    if not (v_line ? 'sort_order')
      or jsonb_typeof(v_line -> 'sort_order') is distinct from 'number' then
      raise exception 'cost line order must be a whole number';
    end if;
    v_sort_num := (v_line ->> 'sort_order')::numeric;
    if v_sort_num <> trunc(v_sort_num) or v_sort_num < 0 then
      raise exception 'cost line order must be a non-negative whole number';
    end if;
    if v_sort_num = any(v_line_sort_orders) then
      raise exception 'cost line order is duplicated in the copy';
    end if;

    v_line_ids := array_append(v_line_ids, v_line_id);
    v_line_sort_orders := array_append(v_line_sort_orders, v_sort_num);
  end loop;

  -- Serialize concurrent replays of the same client-minted copy.
  perform pg_advisory_xact_lock(hashtextextended(v_new_budget_id::text, 0));

  -- Reject re-using the new id for a budget that already lives on another farm,
  -- so a replay never silently returns a foreign row (or nothing).
  if exists (
    select 1
    from public.crop_budgets cb
    where cb.id = v_new_budget_id
      and cb.farm_id <> p_farm_id
  ) then
    raise exception 'budget ID already belongs to another farm';
  end if;

  -- ---- Write the budget, then cost lines, then matrix, in one transaction ----
  begin
    insert into public.crop_budgets (
      id,
      farm_id,
      crop_year,
      commodity_id,
      operating_entity_id,
      enterprise_label,
      name,
      expected_yield_per_acre,
      expected_price_per_bushel,
      copied_from_budget_id,
      notes
    )
    values (
      v_new_budget_id,
      p_farm_id,
      v_crop_year,
      v_commodity_id,
      v_operating_entity_id,
      v_enterprise_label,
      v_name,
      v_expected_yield,
      v_expected_price,
      p_source_id,
      v_notes
    )
    on conflict (id) do nothing;
  exception
    when unique_violation then
      -- Only the scope+name NULLS-NOT-DISTINCT constraint can reach here: a
      -- same-id replay is skipped by ON CONFLICT before this fires.
      raise exception 'a budget with that name already exists for this crop and year';
  end;

  insert into public.budget_cost_lines (
    id,
    farm_id,
    budget_id,
    category,
    label,
    amount_per_acre,
    source_kind,
    source_record_id,
    sort_order
  )
  select
    (elem ->> 'id')::uuid,
    p_farm_id,
    v_new_budget_id,
    (elem ->> 'category')::public.profitability_cost_category,
    elem ->> 'label',
    (elem ->> 'amount_per_acre')::numeric,
    'manual',
    null,
    ((elem ->> 'sort_order')::numeric)::smallint
  from jsonb_array_elements(p_cost_lines) as elem
  on conflict (id) do nothing;

  -- Completeness guard: any cost-line id that collided with another budget was
  -- skipped by ON CONFLICT, which would leave a partial copy. Require the new
  -- budget to hold exactly the submitted cost lines, else roll the copy back.
  select count(*) into v_line_count
  from public.budget_cost_lines bcl
  where bcl.budget_id = v_new_budget_id
    and bcl.farm_id = p_farm_id;
  if v_line_count <> jsonb_array_length(p_cost_lines) then
    raise exception 'the budget copy could not store every cost line';
  end if;

  -- Reuse the audited matrix RPC for the same-transaction, idempotent,
  -- fully-validated matrix write against the new budget.
  perform public.replace_profitability_matrix_steps(
    p_farm_id,
    v_new_budget_id,
    p_matrix_steps
  );

  select cb.*
    into v_new_budget
  from public.crop_budgets cb
  where cb.id = v_new_budget_id
    and cb.farm_id = p_farm_id;

  return v_new_budget;
end;
$$;

revoke all on function public.copy_crop_budget(
  uuid, uuid, jsonb, jsonb, jsonb
) from public, anon, authenticated;

grant execute on function public.copy_crop_budget(
  uuid, uuid, jsonb, jsonb, jsonb
) to authenticated;

-- ============================================================================
-- COMPANION REVIEWER TEST (intentionally NOT run by the migration)
-- A migration-time self-test cannot truthfully exercise auth.uid(), the
-- membership/financial helpers, and RLS-bound reads without real auth users and
-- farm memberships. Run the psql script below against a disposable migrated
-- database. Supply: a farm with an existing crop assignment/commodity; an
-- owner/manager user with can_read_private_financials = true; and an active
-- worker on the same farm with can_view_financials = false. All writes roll back.
--
-- \set farm_id '00000000-0000-0000-0000-000000000000'
-- \set owner_user_id '00000000-0000-0000-0000-000000000000'
-- \set denied_worker_user_id '00000000-0000-0000-0000-000000000000'
-- \set commodity_id 'corn_yellow'
-- begin;
-- select set_config('test.farm_id', :'farm_id', false);
-- select set_config('test.owner_user_id', :'owner_user_id', false);
-- select set_config('test.denied_worker_user_id', :'denied_worker_user_id', false);
-- select set_config('test.commodity_id', :'commodity_id', false);
-- set local role authenticated;
-- do $review_test$
-- declare
--   v_farm_id uuid := current_setting('test.farm_id')::uuid;
--   v_owner_id uuid := current_setting('test.owner_user_id')::uuid;
--   v_worker_id uuid := current_setting('test.denied_worker_user_id')::uuid;
--   v_commodity_id text := current_setting('test.commodity_id');
--   v_src uuid := gen_random_uuid();
--   v_copy uuid := gen_random_uuid();
--   v_copy2 uuid := gen_random_uuid();
--   v_price0 uuid := gen_random_uuid();
--   v_price1 uuid := gen_random_uuid();
--   v_yield0 uuid := gen_random_uuid();
--   v_yield1 uuid := gen_random_uuid();
--   v_cp0 uuid := gen_random_uuid();
--   v_cp1 uuid := gen_random_uuid();
--   v_cy0 uuid := gen_random_uuid();
--   v_cy1 uuid := gen_random_uuid();
--   v_line uuid := gen_random_uuid();
--   v_matrix jsonb;
--   v_copy_matrix jsonb;
--   v_lines jsonb;
--   v_budget jsonb;
--   v_count integer;
-- begin
--   -- 1) A financial-denied worker cannot call either RPC.
--   perform set_config('request.jwt.claim.sub', v_worker_id::text, true);
--   if not public.can_edit_farm(v_farm_id)
--     or public.can_read_private_financials(v_farm_id) then
--     raise exception 'fixture must be an editable worker denied financial reads';
--   end if;
--   begin
--     perform public.replace_profitability_matrix_steps(
--       v_farm_id, v_src, '[]'::jsonb
--     );
--     raise exception 'denied worker unexpectedly called the matrix RPC';
--   exception when others then
--     if sqlerrm <> 'you do not have permission to edit this farm''s profitability' then raise; end if;
--   end;
--
--   -- 2) Owner sets up a source budget with a matrix and two cost lines.
--   perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
--   if not public.can_edit_farm(v_farm_id)
--     or not public.can_read_private_financials(v_farm_id) then
--     raise exception 'fixture owner must have both required permissions';
--   end if;
--   insert into public.crop_budgets (
--     id, farm_id, crop_year, commodity_id, name,
--     expected_yield_per_acre, expected_price_per_bushel
--   ) values (
--     v_src, v_farm_id, 2199, v_commodity_id, 'Review source', 200, 4.50
--   );
--   insert into public.budget_cost_lines (
--     id, farm_id, budget_id, category, label, amount_per_acre, sort_order
--   ) values
--     (v_line, v_farm_id, v_src, 'seed', 'Seed', 110, 0),
--     (gen_random_uuid(), v_farm_id, v_src, 'land', 'Cash rent', 250, 1);
--   v_matrix := jsonb_build_array(
--     jsonb_build_object('id', v_price0, 'budget_id', v_src, 'axis', 'price', 'value', 4.00, 'sort_order', 0),
--     jsonb_build_object('id', v_price1, 'budget_id', v_src, 'axis', 'price', 'value', 4.50, 'sort_order', 1),
--     jsonb_build_object('id', v_yield0, 'budget_id', v_src, 'axis', 'yield', 'value', 190, 'sort_order', 0),
--     jsonb_build_object('id', v_yield1, 'budget_id', v_src, 'axis', 'yield', 'value', 210, 'sort_order', 1)
--   );
--   select count(*) into v_count
--   from public.replace_profitability_matrix_steps(v_farm_id, v_src, v_matrix);
--   if v_count <> 4 then raise exception 'source matrix write failed'; end if;
--
--   -- 3) Matrix rejects a duplicate value and a single-step axis before the DB.
--   begin
--     perform public.replace_profitability_matrix_steps(v_farm_id, v_src,
--       jsonb_set(v_matrix, '{1,value}', '4.00'::jsonb));
--     raise exception 'duplicate matrix value unexpectedly accepted';
--   exception when others then
--     if sqlerrm <> 'matrix step value is duplicated within an axis' then raise; end if;
--   end;
--
--   -- 4) Identical matrix replay yields the same four rows (idempotent).
--   select count(*) into v_count
--   from public.replace_profitability_matrix_steps(v_farm_id, v_src, v_matrix);
--   if v_count <> 4 then raise exception 'matrix replay was not idempotent'; end if;
--
--   -- 5) Copy the budget with new ids for every row.
--   v_budget := jsonb_build_object(
--     'id', v_copy, 'farm_id', v_farm_id, 'crop_year', 2199,
--     'commodity_id', v_commodity_id, 'operating_entity_id', null,
--     'enterprise_label', null, 'name', 'Review copy',
--     'expected_yield_per_acre', 200, 'expected_price_per_bushel', 4.50,
--     'copied_from_budget_id', v_src, 'notes', null
--   );
--   v_lines := jsonb_build_array(
--     jsonb_build_object('id', v_cp0, 'budget_id', v_copy, 'category', 'seed',
--       'label', 'Seed', 'amount_per_acre', 110, 'source_kind', 'manual',
--       'source_record_id', null, 'sort_order', 0),
--     jsonb_build_object('id', v_cp1, 'budget_id', v_copy, 'category', 'land',
--       'label', 'Cash rent', 'amount_per_acre', 250, 'source_kind', 'manual',
--       'source_record_id', null, 'sort_order', 1)
--   );
--   v_copy_matrix := jsonb_build_array(
--     jsonb_build_object('id', v_cy0, 'budget_id', v_copy, 'axis', 'price', 'value', 4.00, 'sort_order', 0),
--     jsonb_build_object('id', v_cy1, 'budget_id', v_copy, 'axis', 'price', 'value', 4.50, 'sort_order', 1),
--     jsonb_build_object('id', gen_random_uuid(), 'budget_id', v_copy, 'axis', 'yield', 'value', 190, 'sort_order', 0),
--     jsonb_build_object('id', gen_random_uuid(), 'budget_id', v_copy, 'axis', 'yield', 'value', 210, 'sort_order', 1)
--   );
--   perform public.copy_crop_budget(v_farm_id, v_src, v_budget, v_lines, v_copy_matrix);
--   select count(*) into v_count from public.budget_cost_lines where budget_id = v_copy;
--   if v_count <> 2 then raise exception 'copy did not store every cost line'; end if;
--   select count(*) into v_count from public.profitability_matrix_steps where budget_id = v_copy;
--   if v_count <> 4 then raise exception 'copy did not store every matrix step'; end if;
--   perform 1 from public.crop_budgets
--   where id = v_copy and copied_from_budget_id = v_src and farm_id = v_farm_id;
--   if not found then raise exception 'copy did not record its source'; end if;
--
--   -- 6) Identical copy replay is a no-op (same rows, no duplicate/error).
--   perform public.copy_crop_budget(v_farm_id, v_src, v_budget, v_lines, v_copy_matrix);
--   select count(*) into v_count from public.budget_cost_lines where budget_id = v_copy;
--   if v_count <> 2 then raise exception 'copy replay duplicated cost lines'; end if;
--
--   -- 7) A bad matrix element rolls the whole copy back (atomic all-or-nothing).
--   begin
--     perform public.copy_crop_budget(
--       v_farm_id, v_src,
--       jsonb_set(v_budget, '{id}', to_jsonb(v_copy2::text)),
--       jsonb_build_array(
--         jsonb_build_object('id', gen_random_uuid(), 'budget_id', v_copy2,
--           'category', 'seed', 'label', 'Seed', 'amount_per_acre', 110,
--           'source_kind', 'manual', 'source_record_id', null, 'sort_order', 0)),
--       jsonb_build_array(  -- single-axis matrix is invalid
--         jsonb_build_object('id', gen_random_uuid(), 'budget_id', v_copy2,
--           'axis', 'price', 'value', 4.00, 'sort_order', 0),
--         jsonb_build_object('id', gen_random_uuid(), 'budget_id', v_copy2,
--           'axis', 'price', 'value', 4.50, 'sort_order', 1))
--     );
--     raise exception 'invalid copy matrix unexpectedly accepted';
--   exception when others then
--     if sqlerrm <> 'the matrix needs both a price axis and a yield axis' then raise; end if;
--   end;
--   perform 1 from public.crop_budgets where id = v_copy2;
--   if found then raise exception 'failed copy left a partial budget behind'; end if;
--
--   -- 8) Cross-budget matrix-id reuse is rejected.
--   begin
--     perform public.replace_profitability_matrix_steps(v_farm_id, v_src,
--       jsonb_set(v_matrix, '{0,id}', to_jsonb(v_cy0::text)));
--     raise exception 'cross-budget matrix id reuse unexpectedly accepted';
--   exception when others then
--     if sqlerrm <> 'matrix step ID already belongs to another budget' then raise; end if;
--   end;
-- end
-- $review_test$;
-- reset role;
-- rollback;
