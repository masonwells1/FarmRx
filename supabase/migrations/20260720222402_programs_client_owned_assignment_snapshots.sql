-- Client-owned assignment snapshot identities.  The template remains the
-- source of every snapshot value; the client supplies only stable identities
-- and an exhaustive source-to-target map so an uncertain response can replay
-- without generating a second graph.

revoke all on function public.assign_program(uuid, uuid, uuid, uuid[])
  from public, anon, authenticated;
drop function public.assign_program(uuid, uuid, uuid, uuid[]);

create function public.materialize_program_assignment_snapshot(
  p_farm_id uuid,
  p_program_id uuid,
  p_crop_assignment_id uuid,
  p_caller uuid,
  p_assignment_id uuid,
  p_passes jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_program public.programs%rowtype;
  v_crop public.crop_assignments%rowtype;
  v_source_pass public.program_passes%rowtype;
  v_source_product public.program_pass_products%rowtype;
  v_pass_plan jsonb;
  v_product_plan jsonb;
  v_assigned_pass_id uuid;
  v_assigned_product_id uuid;
begin
  select p.* into v_program
  from public.programs p
  where p.id = p_program_id
    and p.farm_id = p_farm_id
    and not p.is_archived;
  if not found then
    raise exception 'program does not belong to this farm or is archived';
  end if;

  select ca.* into v_crop
  from public.crop_assignments ca
  where ca.id = p_crop_assignment_id
    and ca.farm_id = p_farm_id;
  if not found then
    raise exception 'crop assignment does not belong to this farm';
  end if;
  if v_program.commodity_id is not null
    and v_program.commodity_id <> v_crop.commodity_id then
    raise exception 'program commodity does not match the crop assignment';
  end if;
  if v_program.crop_year is not null and v_program.crop_year <> v_crop.crop_year then
    raise exception 'program year does not match the crop assignment';
  end if;

  insert into public.program_assignments (
    id, farm_id, program_id, crop_assignment_id, program_name_snapshot,
    program_kind_snapshot, status, template_revision, assigned_by
  ) values (
    p_assignment_id, p_farm_id, p_program_id, p_crop_assignment_id,
    v_program.name, v_program.program_kind, 'active', v_program.revision, p_caller
  );

  for v_source_pass in
    select pp.*
    from public.program_passes pp
    where pp.farm_id = p_farm_id
      and pp.program_id = p_program_id
      and not pp.is_archived
    order by pp.sequence, pp.id
  loop
    select value into v_pass_plan
    from jsonb_array_elements(p_passes)
    where value ->> 'source_program_pass_id' = v_source_pass.id::text;
    v_assigned_pass_id := (v_pass_plan ->> 'id')::uuid;

    insert into public.assigned_program_passes (
      id, farm_id, assignment_id, source_program_pass_id, source_revision,
      sequence, name, pass_type, activity_type, timing_label, target_date,
      planting_offset_days, reminder_lead_days, notes, due_on, due_source,
      is_field_override, status, created_by, updated_by
    ) values (
      v_assigned_pass_id, p_farm_id, p_assignment_id, v_source_pass.id,
      v_program.revision, v_source_pass.sequence, v_source_pass.name,
      v_source_pass.pass_type, v_source_pass.activity_type,
      v_source_pass.timing_label, v_source_pass.target_date,
      v_source_pass.planting_offset_days, v_source_pass.reminder_lead_days,
      v_source_pass.notes,
      case
        when v_source_pass.target_date is not null then v_source_pass.target_date
        when v_source_pass.planting_offset_days is not null
          and v_crop.planting_date is not null
          then v_crop.planting_date + v_source_pass.planting_offset_days
        else null
      end,
      case
        when v_source_pass.target_date is not null then 'template_date'
        when v_source_pass.planting_offset_days is not null
          and v_crop.planting_date is not null then 'planting_offset'
        else 'unscheduled'
      end,
      false, 'planned', p_caller, p_caller
    );

    for v_source_product in
      select ppp.*
      from public.program_pass_products ppp
      where ppp.farm_id = p_farm_id
        and ppp.program_pass_id = v_source_pass.id
        and not ppp.is_archived
      order by ppp.sequence, ppp.id
    loop
      select value into v_product_plan
      from jsonb_array_elements(v_pass_plan -> 'products')
      where value ->> 'source_program_pass_product_id' = v_source_product.id::text;
      v_assigned_product_id := (v_product_plan ->> 'id')::uuid;

      insert into public.assigned_program_pass_products (
        id, farm_id, assigned_pass_id, source_program_pass_product_id, sequence,
        product_name, rate_text, unit_text, estimated_cost_per_acre,
        catalog_product_id, notes, created_by, updated_by
      ) values (
        v_assigned_product_id, p_farm_id, v_assigned_pass_id,
        v_source_product.id, v_source_product.sequence,
        v_source_product.product_name, v_source_product.rate_text,
        v_source_product.unit_text, v_source_product.estimated_cost_per_acre,
        v_source_product.catalog_product_id, v_source_product.notes,
        p_caller, p_caller
      );
    end loop;
  end loop;

  return p_assignment_id;
end;
$$;

revoke all on function public.materialize_program_assignment_snapshot(
  uuid, uuid, uuid, uuid, uuid, jsonb
) from public, anon, authenticated;

create function public.assign_program(
  p_farm_id uuid,
  p_operation_id uuid,
  p_program_id uuid,
  p_assignment_plan jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_receipt_user uuid;
  v_receipt jsonb;
  v_result jsonb;
  v_fingerprint text;
  v_expected_revision integer;
  v_program_revision integer;
  v_assignments jsonb;
  v_plan jsonb;
  v_pass jsonb;
  v_product jsonb;
  v_crop_id uuid;
  v_assignment_id uuid;
  v_target_id uuid;
  v_crop_ids uuid[] := '{}';
  v_assignment_ids uuid[] := '{}';
  v_all_target_ids uuid[] := '{}';
  v_program_commodity text;
  v_program_year integer;
  v_graphs jsonb := '[]'::jsonb;
  v_canonical_assignments jsonb;
begin
  if p_farm_id is null or p_operation_id is null or p_program_id is null
    or v_caller is null then
    raise exception 'farm ID, operation ID, program ID, assignment plan, and authentication are required';
  end if;
  if not public.can_edit_farm(p_farm_id) then
    raise exception 'you do not have permission to edit this farm';
  end if;

  -- Strictly parse the client identity plan before receipt replay.  The plan
  -- carries no farmer-editable snapshot values: only source references and IDs.
  if jsonb_typeof(p_assignment_plan) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(p_assignment_plan)) <> 2
    or exists (
      select 1 from jsonb_object_keys(p_assignment_plan) k(key)
      where k.key not in ('expected_program_revision', 'assignments')
    )
    or jsonb_typeof(p_assignment_plan -> 'expected_program_revision') is distinct from 'number'
    or jsonb_typeof(p_assignment_plan -> 'assignments') is distinct from 'array'
  then
    raise exception 'assignment plan keys do not match the accepted contract';
  end if;

  begin
    v_expected_revision := (p_assignment_plan ->> 'expected_program_revision')::integer;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'expected program revision must be a whole number';
  end;
  if v_expected_revision < 1 then
    raise exception 'expected program revision must be a whole number';
  end if;
  v_assignments := p_assignment_plan -> 'assignments';
  if jsonb_array_length(v_assignments) not between 1 and 200 then
    raise exception 'assignment plans must contain 1 to 200 entries';
  end if;

  for v_plan in select value from jsonb_array_elements(v_assignments) loop
    if jsonb_typeof(v_plan) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(v_plan)) <> 3
      or exists (
        select 1 from jsonb_object_keys(v_plan) k(key)
        where k.key not in ('crop_assignment_id', 'assignment_id', 'passes')
      )
      or jsonb_typeof(v_plan -> 'crop_assignment_id') is distinct from 'string'
      or jsonb_typeof(v_plan -> 'assignment_id') is distinct from 'string'
      or jsonb_typeof(v_plan -> 'passes') is distinct from 'array'
    then
      raise exception 'assignment snapshot keys do not match the accepted contract';
    end if;
    begin
      v_crop_id := (v_plan ->> 'crop_assignment_id')::uuid;
      v_assignment_id := (v_plan ->> 'assignment_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'assignment snapshot IDs must be valid UUIDs';
    end;
    v_crop_ids := array_append(v_crop_ids, v_crop_id);
    v_assignment_ids := array_append(v_assignment_ids, v_assignment_id);
    v_all_target_ids := array_append(v_all_target_ids, v_assignment_id);

    for v_pass in select value from jsonb_array_elements(v_plan -> 'passes') loop
      if jsonb_typeof(v_pass) is distinct from 'object'
        or (select count(*) from jsonb_object_keys(v_pass)) <> 3
        or exists (
          select 1 from jsonb_object_keys(v_pass) k(key)
          where k.key not in ('id', 'source_program_pass_id', 'products')
        )
        or jsonb_typeof(v_pass -> 'id') is distinct from 'string'
        or jsonb_typeof(v_pass -> 'source_program_pass_id') is distinct from 'string'
        or jsonb_typeof(v_pass -> 'products') is distinct from 'array'
      then
        raise exception 'assigned-pass snapshot keys do not match the accepted contract';
      end if;
      begin
        v_all_target_ids := array_append(v_all_target_ids, (v_pass ->> 'id')::uuid);
        perform (v_pass ->> 'source_program_pass_id')::uuid;
      exception when invalid_text_representation then
        raise exception 'assigned-pass snapshot IDs must be valid UUIDs';
      end;

      for v_product in select value from jsonb_array_elements(v_pass -> 'products') loop
        if jsonb_typeof(v_product) is distinct from 'object'
          or (select count(*) from jsonb_object_keys(v_product)) <> 2
          or exists (
            select 1 from jsonb_object_keys(v_product) k(key)
            where k.key not in ('id', 'source_program_pass_product_id')
          )
          or jsonb_typeof(v_product -> 'id') is distinct from 'string'
          or jsonb_typeof(v_product -> 'source_program_pass_product_id') is distinct from 'string'
        then
          raise exception 'assigned-product snapshot keys do not match the accepted contract';
        end if;
        begin
          v_all_target_ids := array_append(v_all_target_ids, (v_product ->> 'id')::uuid);
          perform (v_product ->> 'source_program_pass_product_id')::uuid;
        exception when invalid_text_representation then
          raise exception 'assigned-product snapshot IDs must be valid UUIDs';
        end;
      end loop;
    end loop;
  end loop;

  if cardinality(v_crop_ids) <> cardinality(array(select distinct x from unnest(v_crop_ids) x))
    or cardinality(v_assignment_ids) <> cardinality(array(select distinct x from unnest(v_assignment_ids) x))
    or cardinality(v_all_target_ids) <> cardinality(array(select distinct x from unnest(v_all_target_ids) x))
  then
    raise exception 'assignment snapshot IDs must be globally distinct';
  end if;

  -- Canonicalize unordered plan maps so semantically identical retries have the
  -- same receipt fingerprint even if JSON object key order differs.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'crop_assignment_id', plan.value ->> 'crop_assignment_id',
      'assignment_id', plan.value ->> 'assignment_id',
      'passes', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', pass.value ->> 'id',
            'source_program_pass_id', pass.value ->> 'source_program_pass_id',
            'products', coalesce((
              select jsonb_agg(
                jsonb_build_object(
                  'id', product.value ->> 'id',
                  'source_program_pass_product_id', product.value ->> 'source_program_pass_product_id'
                ) order by product.value ->> 'source_program_pass_product_id'
              ) from jsonb_array_elements(pass.value -> 'products') product(value)
            ), '[]'::jsonb)
          ) order by pass.value ->> 'source_program_pass_id'
        ) from jsonb_array_elements(plan.value -> 'passes') pass(value)
      ), '[]'::jsonb)
    ) order by plan.value ->> 'crop_assignment_id'
  ), '[]'::jsonb)
  into v_canonical_assignments
  from jsonb_array_elements(v_assignments) plan(value);
  v_fingerprint := md5(jsonb_build_object(
    'program_id', p_program_id,
    'expected_program_revision', v_expected_revision,
    'assignments', v_canonical_assignments
  )::text);

  perform pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext(p_operation_id::text));
  select r.user_id, r.result into v_receipt_user, v_receipt
  from public.repository_write_receipts r
  where r.farm_id = p_farm_id and r.operation_id = p_operation_id;
  if found then
    if v_receipt_user <> v_caller then
      raise exception 'operation ID was already used by another user';
    end if;
    if v_receipt ->> 'request_fingerprint' is distinct from v_fingerprint then
      raise exception 'operation ID was already used with a different request';
    end if;
    return v_receipt;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext(p_program_id::text));
  select p.revision, p.commodity_id, p.crop_year
    into v_program_revision, v_program_commodity, v_program_year
  from public.programs p
  where p.id = p_program_id and p.farm_id = p_farm_id and not p.is_archived;
  if not found then
    raise exception 'program does not belong to this farm or is archived';
  end if;
  if v_program_revision <> v_expected_revision then
    raise exception using errcode = 'PT409', message = 'FARM_RX_STALE_WRITE';
  end if;

  for v_plan in
    select value from jsonb_array_elements(v_assignments)
    order by value ->> 'crop_assignment_id'
  loop
    v_crop_id := (v_plan ->> 'crop_assignment_id')::uuid;
    perform pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext(v_crop_id::text));
  end loop;
  for v_target_id in
    select x from unnest(v_all_target_ids) x order by x
  loop
    perform pg_advisory_xact_lock(hashtext('program-snapshot'), hashtext(v_target_id::text));
  end loop;

  if exists (
    select 1 from jsonb_array_elements(v_assignments) plan(value)
    where not exists (
      select 1 from public.crop_assignments ca
      where ca.id = (plan.value ->> 'crop_assignment_id')::uuid
        and ca.farm_id = p_farm_id
    )
  ) then
    raise exception 'a crop assignment does not belong to this farm';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_assignments) plan(value)
    join public.crop_assignments ca
      on ca.id = (plan.value ->> 'crop_assignment_id')::uuid
     and ca.farm_id = p_farm_id
    where (v_program_commodity is not null and ca.commodity_id <> v_program_commodity)
       or (v_program_year is not null and ca.crop_year <> v_program_year)
  ) then
    raise exception 'program commodity or year does not match a selected crop assignment';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_assignments) plan(value)
    join public.program_assignments pa
      on pa.crop_assignment_id = (plan.value ->> 'crop_assignment_id')::uuid
     and pa.farm_id = p_farm_id and pa.program_id = p_program_id
     and pa.status = 'active'
  ) then
    raise exception 'this program is already active on a selected crop assignment';
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_assignments) plan(value)
    where (select count(*) from public.program_assignments pa
      where pa.farm_id = p_farm_id
        and pa.crop_assignment_id = (plan.value ->> 'crop_assignment_id')::uuid
        and pa.status = 'active') >= 12
  ) then
    raise exception 'a selected crop assignment already has 12 active programs';
  end if;

  -- All target UUID collisions and all source-map defects fail before the first
  -- assignment row is inserted.
  if exists (
    select 1 from public.program_assignments where id = any(v_all_target_ids)
    union all
    select 1 from public.assigned_program_passes where id = any(v_all_target_ids)
    union all
    select 1 from public.assigned_program_pass_products where id = any(v_all_target_ids)
  ) then
    raise exception 'assignment snapshot ID is already in use';
  end if;

  for v_plan in select value from jsonb_array_elements(v_assignments) loop
    v_crop_id := (v_plan ->> 'crop_assignment_id')::uuid;
    if jsonb_array_length(v_plan -> 'passes') <> (
      select count(*) from public.program_passes pp
      where pp.farm_id = p_farm_id and pp.program_id = p_program_id
        and not pp.is_archived
    ) or exists (
      select 1 from jsonb_array_elements(v_plan -> 'passes') pass(value)
      where not exists (
        select 1 from public.program_passes pp
        where pp.id = (pass.value ->> 'source_program_pass_id')::uuid
          and pp.farm_id = p_farm_id and pp.program_id = p_program_id
          and not pp.is_archived
      )
    ) or (select count(distinct pass.value ->> 'source_program_pass_id')
      from jsonb_array_elements(v_plan -> 'passes') pass(value))
      <> jsonb_array_length(v_plan -> 'passes') then
      raise exception 'assignment pass sources must exactly match the active program';
    end if;

    for v_pass in select value from jsonb_array_elements(v_plan -> 'passes') loop
      if jsonb_array_length(v_pass -> 'products') <> (
        select count(*) from public.program_pass_products ppp
        where ppp.farm_id = p_farm_id
          and ppp.program_pass_id = (v_pass ->> 'source_program_pass_id')::uuid
          and not ppp.is_archived
      ) or exists (
        select 1 from jsonb_array_elements(v_pass -> 'products') product(value)
        where not exists (
          select 1 from public.program_pass_products ppp
          where ppp.id = (product.value ->> 'source_program_pass_product_id')::uuid
            and ppp.farm_id = p_farm_id
            and ppp.program_pass_id = (v_pass ->> 'source_program_pass_id')::uuid
            and not ppp.is_archived
        )
      ) or (select count(distinct product.value ->> 'source_program_pass_product_id')
        from jsonb_array_elements(v_pass -> 'products') product(value))
        <> jsonb_array_length(v_pass -> 'products') then
        raise exception 'assignment product sources must exactly match the active pass';
      end if;
    end loop;
  end loop;

  for v_plan in
    select value from jsonb_array_elements(v_assignments)
    order by value ->> 'crop_assignment_id'
  loop
    v_crop_id := (v_plan ->> 'crop_assignment_id')::uuid;
    v_assignment_id := (v_plan ->> 'assignment_id')::uuid;
    perform public.materialize_program_assignment_snapshot(
      p_farm_id, p_program_id, v_crop_id, v_caller, v_assignment_id,
      v_plan -> 'passes'
    );
    v_graphs := v_graphs || jsonb_build_array(
      public.program_assignment_graph(p_farm_id, v_assignment_id)
    );
  end loop;

  v_result := jsonb_build_object(
    'program_id', p_program_id,
    'assignments', v_graphs,
    'request_fingerprint', v_fingerprint
  );
  insert into public.repository_write_receipts (farm_id, operation_id, user_id, result)
  values (p_farm_id, p_operation_id, v_caller, v_result);
  return v_result;
end;
$$;

revoke all on function public.assign_program(uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.assign_program(uuid, uuid, uuid, jsonb)
  to authenticated;
