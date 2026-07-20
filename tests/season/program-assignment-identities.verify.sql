\set ON_ERROR_STOP on

begin;

select set_config('request.jwt.claims', '{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select set_config('request.jwt.claim.sub', '27000000-0000-4000-8000-000000000001', true);
select set_config(
  'request.headers',
  jsonb_build_object(
    'x-farm-rx-expected-user-id', '27000000-0000-4000-8000-000000000001',
    'x-farm-rx-access-epochs', jsonb_build_object('27010000-0000-4000-8000-000000000001', 1)::text
  )::text,
  true
);

insert into public.fields (id, farm_id, operating_entity_id, name, total_acres, county, state)
values
  ('27020000-0000-4000-8000-000000000001', '27010000-0000-4000-8000-000000000001', '27011000-0000-4000-8000-000000000001', 'Maple East 160', 160, 'Jackson County', 'IL'),
  ('27020000-0000-4000-8000-000000000002', '27010000-0000-4000-8000-000000000001', '27011000-0000-4000-8000-000000000001', 'Maple Identity Collision Probe', 1, 'Jackson County', 'IL');

insert into public.crop_assignments (id, farm_id, field_id, crop_year, commodity_id, planting_sequence, planted_acres)
values
  ('27030000-0000-4000-8000-000000000001', '27010000-0000-4000-8000-000000000001', '27020000-0000-4000-8000-000000000001', 2027, 'corn_yellow', 1, 160),
  ('27030000-0000-4000-8000-000000000002', '27010000-0000-4000-8000-000000000001', '27020000-0000-4000-8000-000000000002', 2027, 'corn_yellow', 1, 1);

insert into public.programs (id, farm_id, name, program_kind, crop_year, revision, created_by, updated_by)
values
  ('27050000-0000-4000-8000-000000000001', '27010000-0000-4000-8000-000000000001', 'Maple 2027 Corn Program', 'chemical', 2027, 2, '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001'),
  ('27050000-0000-4000-8000-000000000002', '27010000-0000-4000-8000-000000000001', 'Maple Reassign Compatibility Program', 'chemical', 2027, 1, '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001');

insert into public.program_passes (id, farm_id, program_id, sequence, name, pass_type, activity_type, target_date, reminder_lead_days, created_by, updated_by)
values ('27051000-0000-4000-8000-000000000001', '27010000-0000-4000-8000-000000000001', '27050000-0000-4000-8000-000000000001', 1, 'Post-emerge synthetic pass', 'post', 'spray', '2027-05-20', 3, '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001');

insert into public.program_pass_products (id, farm_id, program_pass_id, sequence, product_name, rate_text, unit_text, estimated_cost_per_acre, created_by, updated_by)
values ('27051100-0000-4000-8000-000000000001', '27010000-0000-4000-8000-000000000001', '27051000-0000-4000-8000-000000000001', 1, 'Free-Typed Program Herbicide', '10.00', 'gal total', 7, '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001');

create function pg_temp.maple_assignment_plan(p_crop uuid, p_assignment uuid, p_assigned_pass uuid, p_assigned_product uuid, p_revision integer default 2)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'expected_program_revision', p_revision,
    'assignments', jsonb_build_array(jsonb_build_object(
      'crop_assignment_id', p_crop,
      'assignment_id', p_assignment,
      'passes', jsonb_build_array(jsonb_build_object(
        'id', p_assigned_pass,
        'source_program_pass_id', '27051000-0000-4000-8000-000000000001',
        'products', jsonb_build_array(jsonb_build_object(
          'id', p_assigned_product,
          'source_program_pass_product_id', '27051100-0000-4000-8000-000000000001'
        ))
      ))
    ))
  )
$$;

create temporary table first_receipt as
select public.assign_program(
  '27010000-0000-4000-8000-000000000001',
  '27059000-0000-4000-8000-000000000001',
  '27050000-0000-4000-8000-000000000001',
  pg_temp.maple_assignment_plan(
    '27030000-0000-4000-8000-000000000001',
    '27052000-0000-4000-8000-000000000001',
    '27053000-0000-4000-8000-000000000001',
    '27053100-0000-4000-8000-000000000001'
  )
) result;

do $$
declare v_replayed jsonb;
begin
  if not exists (
    select 1
    from public.program_assignments pa
    join public.assigned_program_passes ap on ap.assignment_id = pa.id and ap.farm_id = pa.farm_id
    join public.assigned_program_pass_products app on app.assigned_pass_id = ap.id and app.farm_id = ap.farm_id
    where pa.id = '27052000-0000-4000-8000-000000000001'
      and pa.crop_assignment_id = '27030000-0000-4000-8000-000000000001'
      and pa.template_revision = 2
      and ap.id = '27053000-0000-4000-8000-000000000001'
      and ap.source_program_pass_id = '27051000-0000-4000-8000-000000000001'
      and ap.source_revision = 2
      and ap.due_on = '2027-05-20'
      and ap.due_source = 'template_date'
      and app.id = '27053100-0000-4000-8000-000000000001'
      and app.source_program_pass_product_id = '27051100-0000-4000-8000-000000000001'
      and app.product_name = 'Free-Typed Program Herbicide'
  ) then raise exception 'client-owned assignment graph was not materialized exactly'; end if;

  v_replayed := public.assign_program(
    '27010000-0000-4000-8000-000000000001',
    '27059000-0000-4000-8000-000000000001',
    '27050000-0000-4000-8000-000000000001',
    pg_temp.maple_assignment_plan('27030000-0000-4000-8000-000000000001', '27052000-0000-4000-8000-000000000001', '27053000-0000-4000-8000-000000000001', '27053100-0000-4000-8000-000000000001')
  );
  if v_replayed is distinct from (select result from first_receipt) then
    raise exception 'identical operation replay did not return the immutable receipt';
  end if;

  begin
    perform public.assign_program(
      '27010000-0000-4000-8000-000000000001',
      '27059000-0000-4000-8000-000000000001',
      '27050000-0000-4000-8000-000000000001',
      pg_temp.maple_assignment_plan('27030000-0000-4000-8000-000000000001', '27052000-0000-4000-8000-000000000099', '27053000-0000-4000-8000-000000000099', '27053100-0000-4000-8000-000000000099')
    );
    raise exception 'changed payload reused an operation receipt';
  exception when others then
    if sqlerrm not like '%different request%' then raise; end if;
  end;

  begin
    perform public.assign_program(
      '27010000-0000-4000-8000-000000000001',
      '27059000-0000-4000-8000-000000000004',
      '27050000-0000-4000-8000-000000000001',
      pg_temp.maple_assignment_plan('27030000-0000-4000-8000-000000000002', '27051000-0000-4000-8000-000000000001', '27053000-0000-4000-8000-000000000004', '27053100-0000-4000-8000-000000000004')
    );
    raise exception 'a target identity reused a template source identity';
  exception when others then
    if sqlerrm not like '%must not reuse template source IDs%' then raise; end if;
  end;

  begin
    perform public.assign_program(
      '27010000-0000-4000-8000-000000000001',
      '27059000-0000-4000-8000-000000000005',
      '27050000-0000-4000-8000-000000000001',
      pg_temp.maple_assignment_plan('27030000-0000-4000-8000-000000000002', '27052000-0000-4000-8000-000000000005', '27052000-0000-4000-8000-000000000001', '27053100-0000-4000-8000-000000000005')
    );
    raise exception 'an assigned-pass identity reused an existing assignment identity';
  exception when others then
    if sqlerrm not like '%already in use%' then raise; end if;
  end;

  begin
    perform public.assign_program(
      '27010000-0000-4000-8000-000000000001',
      '27059000-0000-4000-8000-000000000006',
      '27050000-0000-4000-8000-000000000001',
      pg_temp.maple_assignment_plan('27030000-0000-4000-8000-000000000002', '27052000-0000-4000-8000-000000000006', '27053000-0000-4000-8000-000000000006', '27053000-0000-4000-8000-000000000001')
    );
    raise exception 'an assigned-product identity reused an existing assigned-pass identity';
  exception when others then
    if sqlerrm not like '%already in use%' then raise; end if;
  end;

  begin
    perform public.assign_program(
      '27010000-0000-4000-8000-000000000001',
      '27059000-0000-4000-8000-000000000002',
      '27050000-0000-4000-8000-000000000001',
      pg_temp.maple_assignment_plan('27030000-0000-4000-8000-000000000002', '27052000-0000-4000-8000-000000000002', '27053000-0000-4000-8000-000000000002', '27053100-0000-4000-8000-000000000002', 1)
    );
    raise exception 'stale program revision was accepted';
  exception when sqlstate 'PT409' then null;
  end;

  begin
    perform public.assign_program(
      '27010000-0000-4000-8000-000000000001',
      '27059000-0000-4000-8000-000000000003',
      '27050000-0000-4000-8000-000000000001',
      pg_temp.maple_assignment_plan('27030000-0000-4000-8000-000000000002', '27052000-0000-4000-8000-000000000001', '27053000-0000-4000-8000-000000000003', '27053100-0000-4000-8000-000000000003')
    );
    raise exception 'a globally colliding assignment identity was accepted';
  exception when others then
    if sqlerrm not like '%already in use%' then raise; end if;
  end;

  if exists (select 1 from public.program_assignments where crop_assignment_id = '27030000-0000-4000-8000-000000000002') then
    raise exception 'a rejected identity plan left partial rows';
  end if;
  if (select count(*) from public.repository_write_receipts where farm_id = '27010000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'replay or rejected plans changed receipt cardinality';
  end if;
  if to_regprocedure('public.assign_program(uuid,uuid,uuid,uuid[])') is not null
    or to_regprocedure('public.assign_program(uuid,uuid,uuid,jsonb)') is null then
    raise exception 'assign_program signatures are not sealed';
  end if;
  if has_function_privilege('anon', 'public.assign_program(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    or not has_function_privilege('authenticated', 'public.assign_program(uuid,uuid,uuid,jsonb)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.materialize_program_assignment_snapshot(uuid,uuid,uuid,uuid,uuid,jsonb)', 'EXECUTE') then
    raise exception 'assignment RPC privileges are not sealed';
  end if;

  perform public.reassign_program_assignment(
    '27010000-0000-4000-8000-000000000001',
    '27059000-0000-4000-8000-000000000007',
    '27052000-0000-4000-8000-000000000001',
    '27050000-0000-4000-8000-000000000002',
    'Compatibility proof'
  );
  if not exists (select 1 from public.program_assignments where id = '27052000-0000-4000-8000-000000000001' and status = 'archived')
    or not exists (select 1 from public.program_assignments where crop_assignment_id = '27030000-0000-4000-8000-000000000001' and program_id = '27050000-0000-4000-8000-000000000002' and status = 'active') then
    raise exception 'legacy reassign path did not preserve a working server-owned replacement';
  end if;
end;
$$;

select 'PROGRAM_ASSIGNMENT_IDENTITIES_PASS' as proof;

rollback;
