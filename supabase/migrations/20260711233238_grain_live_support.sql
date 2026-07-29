-- Atomic desired-state replacement for one monthly grain marketing-plan scope.
-- The function is SECURITY DEFINER, so every authorization and tenant check is
-- explicit and every stored farm/scope value comes from the trusted arguments.

create or replace function public.replace_marketing_plan_targets(
  p_farm_id uuid,
  p_crop_year integer,
  p_commodity_id text,
  p_operating_entity_id uuid,
  p_enterprise_label text,
  p_targets jsonb
)
returns setof public.marketing_plan_targets
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_target jsonb;
  v_target_id uuid;
  v_target_month date;
  v_target_pct numeric;
  v_target_price numeric;
  v_breakeven_relative_pct numeric;
  v_deadline date;
  v_existing public.marketing_plan_targets%rowtype;
  v_target_ids uuid[] := array[]::uuid[];
  v_target_months date[] := array[]::date[];
  v_total_pct numeric := 0;
  v_written_count integer := 0;
begin
  if p_farm_id is null then
    raise exception 'farm ID is required';
  end if;

  if v_caller is null then
    raise exception 'authentication is required';
  end if;

  -- SECURITY DEFINER rule: callers must independently have both ordinary edit
  -- access and private-financial read access before this RPC reads or writes.
  if not public.can_edit_farm(p_farm_id)
    or not public.can_read_private_financials(p_farm_id) then
    raise exception 'you do not have permission to edit this farm''s grain plan';
  end if;

  if p_crop_year is null or p_crop_year not between 1900 and 2200 then
    raise exception 'crop year must be between 1900 and 2200';
  end if;

  if p_commodity_id is null or not exists (
    select 1
    from public.commodities c
    where c.id = p_commodity_id
  ) then
    raise exception 'commodity does not exist';
  end if;

  if p_operating_entity_id is not null and not exists (
    select 1
    from public.entities e
    where e.id = p_operating_entity_id
      and e.farm_id = p_farm_id
  ) then
    raise exception 'operating entity does not belong to this farm';
  end if;

  if p_enterprise_label is not null and (
    p_enterprise_label <> btrim(p_enterprise_label)
    or length(p_enterprise_label) not between 1 and 160
  ) then
    raise exception 'enterprise label must be trimmed and between 1 and 160 characters';
  end if;

  if jsonb_typeof(p_targets) is distinct from 'array' then
    raise exception 'targets must be a JSON array';
  end if;

  -- One lock key represents the exact five-part nullable scope. A hash
  -- collision can only serialize unrelated saves; it cannot mix their rows.
  perform pg_advisory_xact_lock(
    hashtextextended(
      jsonb_build_array(
        p_farm_id,
        p_crop_year,
        p_commodity_id,
        p_operating_entity_id,
        p_enterprise_label
      )::text,
      0
    )
  );

  -- Validate the complete desired state before changing a row. Complete rows
  -- include farm_id and all scope columns, but trusted arguments remain the
  -- only tenant/scope stamps. Client timestamps are rejected below.
  for v_target in
    select value from jsonb_array_elements(p_targets)
  loop
    if jsonb_typeof(v_target) is distinct from 'object' then
      raise exception 'each marketing target must be a JSON object';
    end if;

    if v_target ?| array['created_at', 'updated_at'] then
      raise exception 'client timestamps are not accepted for marketing targets';
    end if;

    if not (v_target ? 'id')
      or jsonb_typeof(v_target -> 'id') is distinct from 'string'
      or nullif(v_target ->> 'id', '') is null then
      raise exception 'each marketing target requires an ID';
    end if;
    v_target_id := (v_target ->> 'id')::uuid;

    if v_target_id = any(v_target_ids) then
      raise exception 'marketing target ID is duplicated in the plan';
    end if;

    -- Full normalized rows carry farm_id and their complete scope. Require an
    -- exact match (including farm_id), but never trust those values as stamps.
    if not (v_target ? 'farm_id')
      or jsonb_typeof(v_target -> 'farm_id') is distinct from 'string'
      or (v_target ->> 'farm_id')::uuid <> p_farm_id
      or not (v_target ? 'crop_year')
      or jsonb_typeof(v_target -> 'crop_year') is distinct from 'number'
      or (v_target ->> 'crop_year')::numeric <> p_crop_year
      or not (v_target ? 'commodity_id')
      or jsonb_typeof(v_target -> 'commodity_id') is distinct from 'string'
      or (v_target ->> 'commodity_id') <> p_commodity_id
      or not (v_target ? 'operating_entity_id')
      or jsonb_typeof(v_target -> 'operating_entity_id') not in ('null', 'string')
      or (case
        when jsonb_typeof(v_target -> 'operating_entity_id') = 'null' then null
        else (v_target ->> 'operating_entity_id')::uuid
      end) is distinct from p_operating_entity_id
      or not (v_target ? 'enterprise_label')
      or jsonb_typeof(v_target -> 'enterprise_label') not in ('null', 'string')
      or (v_target ->> 'enterprise_label') is distinct from p_enterprise_label then
      raise exception 'marketing target is outside the supplied scope';
    end if;

    if not (v_target ? 'target_month')
      or jsonb_typeof(v_target -> 'target_month') is distinct from 'string'
      or nullif(v_target ->> 'target_month', '') is null then
      raise exception 'each marketing target requires a target month';
    end if;
    v_target_month := (v_target ->> 'target_month')::date;

    if v_target ->> 'target_month' <> to_char(v_target_month, 'YYYY-MM-DD')
      or v_target_month <> date_trunc('month', v_target_month)::date then
      raise exception 'target month must be an ISO date on the first of the month';
    end if;

    if extract(year from v_target_month)::integer
      not between p_crop_year - 1 and p_crop_year + 1 then
      raise exception 'target month is outside the crop-year marketing window';
    end if;

    if v_target_month = any(v_target_months) then
      raise exception 'target month is duplicated in the plan';
    end if;

    if not (v_target ? 'target_pct_of_production')
      or jsonb_typeof(v_target -> 'target_pct_of_production') is distinct from 'number' then
      raise exception 'each marketing target requires a finite numeric percentage';
    end if;
    v_target_pct := (v_target ->> 'target_pct_of_production')::numeric;
    if v_target_pct <= 0 or v_target_pct > 100 then
      raise exception 'target percentage must be greater than 0 and no more than 100';
    end if;
    v_target_pct := round(v_target_pct, 4);

    if not (v_target ? 'target_price')
      or jsonb_typeof(v_target -> 'target_price') not in ('null', 'number') then
      raise exception 'target price must be null or a finite number';
    end if;
    v_target_price := case
      when jsonb_typeof(v_target -> 'target_price') = 'null' then null
      else (v_target ->> 'target_price')::numeric
    end;
    if v_target_price is not null and v_target_price < 0 then
      raise exception 'target price cannot be negative';
    end if;

    if not (v_target ? 'breakeven_relative_pct')
      or jsonb_typeof(v_target -> 'breakeven_relative_pct') not in ('null', 'number') then
      raise exception 'breakeven-relative percentage must be null or a finite number';
    end if;
    v_breakeven_relative_pct := case
      when jsonb_typeof(v_target -> 'breakeven_relative_pct') = 'null' then null
      else (v_target ->> 'breakeven_relative_pct')::numeric
    end;

    if not (v_target ? 'deadline')
      or jsonb_typeof(v_target -> 'deadline') not in ('null', 'string') then
      raise exception 'deadline must be null or an ISO date';
    end if;
    v_deadline := case
      when jsonb_typeof(v_target -> 'deadline') = 'null' then null
      else (v_target ->> 'deadline')::date
    end;
    if v_deadline is not null
      and v_target ->> 'deadline' <> to_char(v_deadline, 'YYYY-MM-DD') then
      raise exception 'deadline must be an ISO date';
    end if;

    if not (v_target ? 'notes')
      or jsonb_typeof(v_target -> 'notes') not in ('null', 'string') then
      raise exception 'notes must be null or text';
    end if;

    -- A client UUID may update only the row already in this exact scope. This
    -- prevents cross-farm or cross-scope ID reuse from becoming an overwrite.
    select mpt.*
      into v_existing
    from public.marketing_plan_targets mpt
    where mpt.id = v_target_id
    for update;

    if found and (
      v_existing.farm_id <> p_farm_id
      or v_existing.crop_year <> p_crop_year
      or v_existing.commodity_id <> p_commodity_id
      or v_existing.operating_entity_id is distinct from p_operating_entity_id
      or v_existing.enterprise_label is distinct from p_enterprise_label
    ) then
      raise exception 'marketing target ID already belongs to another scope';
    end if;

    v_target_ids := array_append(v_target_ids, v_target_id);
    v_target_months := array_append(v_target_months, v_target_month);
    v_total_pct := v_total_pct + v_target_pct;
  end loop;

  -- Match the repository's exact percentage-total ceiling.
  if v_total_pct > 100.000001 then
    raise exception 'marketing plan total cannot exceed 100 percent';
  end if;

  -- Upsert every submitted stable UUID. Existing created_at values are never
  -- replaced, and 0004's trigger supplies the canonical updated_at value.
  with submitted as (
    select
      (target ->> 'id')::uuid as id,
      (target ->> 'target_month')::date as target_month,
      round((target ->> 'target_pct_of_production')::numeric, 4) as target_pct,
      case when jsonb_typeof(target -> 'target_price') = 'null'
        then null else (target ->> 'target_price')::numeric end as target_price,
      case when jsonb_typeof(target -> 'breakeven_relative_pct') = 'null'
        then null else (target ->> 'breakeven_relative_pct')::numeric end
        as breakeven_relative_pct,
      case when jsonb_typeof(target -> 'deadline') = 'null'
        then null else (target ->> 'deadline')::date end as deadline,
      case when jsonb_typeof(target -> 'notes') = 'null'
        then null else target ->> 'notes' end as notes
    from jsonb_array_elements(p_targets) as payload(target)
  ),
  written as (
    insert into public.marketing_plan_targets (
      id,
      farm_id,
      crop_year,
      commodity_id,
      operating_entity_id,
      enterprise_label,
      target_month,
      target_pct_of_production,
      target_price,
      breakeven_relative_pct,
      deadline,
      notes
    )
    select
      s.id,
      p_farm_id,
      p_crop_year,
      p_commodity_id,
      p_operating_entity_id,
      p_enterprise_label,
      s.target_month,
      s.target_pct,
      s.target_price,
      s.breakeven_relative_pct,
      s.deadline,
      s.notes
    from submitted s
    on conflict (id) do update
    set
      target_month = excluded.target_month,
      target_pct_of_production = excluded.target_pct_of_production,
      target_price = excluded.target_price,
      breakeven_relative_pct = excluded.breakeven_relative_pct,
      deadline = excluded.deadline,
      notes = excluded.notes
    where marketing_plan_targets.farm_id = p_farm_id
      and marketing_plan_targets.crop_year = p_crop_year
      and marketing_plan_targets.commodity_id = p_commodity_id
      and marketing_plan_targets.operating_entity_id
        is not distinct from p_operating_entity_id
      and marketing_plan_targets.enterprise_label
        is not distinct from p_enterprise_label
    returning 1
  )
  select count(*)::integer into v_written_count from written;

  -- Close the race in which another transaction inserted a submitted UUID in
  -- a different scope after validation but before this upsert reached the PK.
  if v_written_count <> jsonb_array_length(p_targets) then
    raise exception 'one or more marketing target IDs belong to another scope';
  end if;

  delete from public.marketing_plan_targets mpt
  where mpt.farm_id = p_farm_id
    and mpt.crop_year = p_crop_year
    and mpt.commodity_id = p_commodity_id
    and mpt.operating_entity_id is not distinct from p_operating_entity_id
    and mpt.enterprise_label is not distinct from p_enterprise_label
    and not (mpt.id = any(v_target_ids));

  return query
  select mpt.*
  from public.marketing_plan_targets mpt
  where mpt.farm_id = p_farm_id
    and mpt.crop_year = p_crop_year
    and mpt.commodity_id = p_commodity_id
    and mpt.operating_entity_id is not distinct from p_operating_entity_id
    and mpt.enterprise_label is not distinct from p_enterprise_label
  order by mpt.target_month, mpt.id;
end;
$$;

revoke all on function public.replace_marketing_plan_targets(
  uuid, integer, text, uuid, text, jsonb
) from public, anon, authenticated;

grant execute on function public.replace_marketing_plan_targets(
  uuid, integer, text, uuid, text, jsonb
) to authenticated;

-- COMPANION REVIEWER TEST (intentionally not run by the migration)
-- A migration-time self-test cannot truthfully exercise auth.uid(), membership
-- helpers, and RLS-bound reads without real auth users and farm memberships.
-- Run the exact psql script below against a disposable migrated database. Supply
-- an owner/manager and an active worker on the same farm; the worker must have
-- can_view_financials = false. All test writes are rolled back.
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
--   v_id_a uuid := gen_random_uuid();
--   v_id_b uuid := gen_random_uuid();
--   v_id_c uuid := gen_random_uuid();
--   v_id_d uuid := gen_random_uuid();
--   v_payload jsonb;
--   v_count integer;
-- begin
--   perform set_config('request.jwt.claim.sub', v_worker_id::text, true);
--   if not public.can_edit_farm(v_farm_id)
--     or public.can_read_private_financials(v_farm_id) then
--     raise exception 'fixture must be an editable worker denied financial reads';
--   end if;
--   begin
--     perform 1 from public.replace_marketing_plan_targets(
--       v_farm_id, 2199, v_commodity_id, null, null, '[]'::jsonb
--     );
--     raise exception 'denied worker unexpectedly called the RPC';
--   exception
--     when others then
--       if sqlerrm <> 'you do not have permission to edit this farm''s grain plan' then
--         raise;
--       end if;
--   end;
--
--   perform set_config('request.jwt.claim.sub', v_owner_id::text, true);
--   if not public.can_edit_farm(v_farm_id)
--     or not public.can_read_private_financials(v_farm_id) then
--     raise exception 'fixture owner must have both required permissions';
--   end if;
--
--   -- A different nullable scope must survive all NULL-scope replacements.
--   v_payload := jsonb_build_array(jsonb_build_object(
--     'id', v_id_c, 'farm_id', v_farm_id, 'crop_year', 2199,
--     'commodity_id', v_commodity_id, 'operating_entity_id', null,
--     'enterprise_label', '0012-review-other', 'target_month', '2199-03-01',
--     'target_pct_of_production', 25, 'target_price', null,
--     'breakeven_relative_pct', null, 'deadline', null, 'notes', null
--   ));
--   perform 1 from public.replace_marketing_plan_targets(
--     v_farm_id, 2199, v_commodity_id, null, '0012-review-other', v_payload
--   );
--
--   v_payload := jsonb_build_array(
--     jsonb_build_object(
--       'id', v_id_a, 'farm_id', v_farm_id, 'crop_year', 2199,
--       'commodity_id', v_commodity_id, 'operating_entity_id', null,
--       'enterprise_label', null, 'target_month', '2199-01-01',
--       'target_pct_of_production', 50, 'target_price', 5.25,
--       'breakeven_relative_pct', null, 'deadline', null, 'notes', 'A'
--     ),
--     jsonb_build_object(
--       'id', v_id_b, 'farm_id', v_farm_id, 'crop_year', 2199,
--       'commodity_id', v_commodity_id, 'operating_entity_id', null,
--       'enterprise_label', null, 'target_month', '2199-02-01',
--       'target_pct_of_production', 50, 'target_price', null,
--       'breakeven_relative_pct', 2, 'deadline', '2199-01-15', 'notes', null
--     )
--   );
--   select count(*) into v_count
--   from public.replace_marketing_plan_targets(
--     v_farm_id, 2199, v_commodity_id, null, null, v_payload
--   );
--   if v_count <> 2 then raise exception 'nullable-scope replace failed'; end if;
--
--   -- Identical replay must return the same two rows without duplication.
--   select count(*) into v_count
--   from public.replace_marketing_plan_targets(
--     v_farm_id, 2199, v_commodity_id, null, null, v_payload
--   );
--   if v_count <> 2 then raise exception 'identical replay failed'; end if;
--
--   -- Client timestamps are rejected rather than trusted or persisted.
--   begin
--     perform 1 from public.replace_marketing_plan_targets(
--       v_farm_id, 2199, v_commodity_id, null, null,
--       jsonb_build_array((v_payload -> 0) || jsonb_build_object('updated_at', now()))
--     );
--     raise exception 'client timestamp unexpectedly accepted';
--   exception
--     when others then
--       if sqlerrm <> 'client timestamps are not accepted for marketing targets' then
--         raise;
--       end if;
--   end;
--
--   -- Omitting B deletes B and preserves A.
--   perform 1 from public.replace_marketing_plan_targets(
--     v_farm_id, 2199, v_commodity_id, null, null,
--     jsonb_build_array(v_payload -> 0)
--   );
--   select count(*) into v_count
--   from public.marketing_plan_targets
--   where farm_id = v_farm_id and crop_year = 2199
--     and commodity_id = v_commodity_id and operating_entity_id is null
--     and enterprise_label is null and id = v_id_a;
--   if v_count <> 1 then raise exception 'omitted-row deletion failed'; end if;
--
--   -- A bad second row must roll back the complete attempted replacement.
--   begin
--     perform 1 from public.replace_marketing_plan_targets(
--       v_farm_id, 2199, v_commodity_id, null, null,
--       jsonb_build_array(
--         (v_payload -> 0) || jsonb_build_object('id', v_id_d),
--         (v_payload -> 1) || jsonb_build_object('farm_id', gen_random_uuid())
--       )
--     );
--     raise exception 'farm mismatch unexpectedly accepted';
--   exception
--     when others then
--       if sqlerrm <> 'marketing target is outside the supplied scope' then raise; end if;
--   end;
--   select count(*) into v_count
--   from public.marketing_plan_targets
--   where farm_id = v_farm_id and crop_year = 2199
--     and commodity_id = v_commodity_id and operating_entity_id is null
--     and enterprise_label is null and id = v_id_a;
--   if v_count <> 1 then raise exception 'failed replacement changed stored rows'; end if;
--
--   -- The exact total ceiling accepts 100.000001 and rejects 100.000002.
--   if 100.000001::numeric > 100.000001::numeric
--     or not (100.000002::numeric > 100.000001::numeric) then
--     raise exception 'percentage-total boundary is wrong';
--   end if;
--
--   -- Empty replacement deletes only the NULL scope; the labeled row remains.
--   perform 1 from public.replace_marketing_plan_targets(
--     v_farm_id, 2199, v_commodity_id, null, null, '[]'::jsonb
--   );
--   select count(*) into v_count
--   from public.marketing_plan_targets
--   where farm_id = v_farm_id and crop_year = 2199
--     and commodity_id = v_commodity_id and operating_entity_id is null
--     and enterprise_label is null;
--   if v_count <> 0 then raise exception 'empty replacement failed'; end if;
--   select count(*) into v_count
--   from public.marketing_plan_targets
--   where farm_id = v_farm_id and crop_year = 2199
--     and commodity_id = v_commodity_id and operating_entity_id is null
--     and enterprise_label = '0012-review-other' and id = v_id_c;
--   if v_count <> 1 then raise exception 'nullable-scope isolation failed'; end if;
-- end
-- $review_test$;
-- reset role;
-- rollback;
