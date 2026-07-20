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
  ('27020000-0000-4000-8000-000000000002', '27010000-0000-4000-8000-000000000001', '27011000-0000-4000-8000-000000000001', 'Maple Identity Collision Probe', 1, 'Jackson County', 'IL'),
  ('27020000-0000-4000-8000-000000000003', '27010000-0000-4000-8000-000000000001', '27011000-0000-4000-8000-000000000001', 'Maple Replay North', 80, 'Jackson County', 'IL'),
  ('27020000-0000-4000-8000-000000000004', '27010000-0000-4000-8000-000000000001', '27011000-0000-4000-8000-000000000001', 'Maple Replay South', 80, 'Jackson County', 'IL');

insert into public.crop_assignments (id, farm_id, field_id, crop_year, commodity_id, planting_sequence, planted_acres)
values
  ('27030000-0000-4000-8000-000000000001', '27010000-0000-4000-8000-000000000001', '27020000-0000-4000-8000-000000000001', 2027, 'corn_yellow', 1, 160),
  ('27030000-0000-4000-8000-000000000002', '27010000-0000-4000-8000-000000000001', '27020000-0000-4000-8000-000000000002', 2027, 'corn_yellow', 1, 1),
  ('27030000-0000-4000-8000-000000000003', '27010000-0000-4000-8000-000000000001', '27020000-0000-4000-8000-000000000003', 2027, 'corn_yellow', 1, 80),
  ('27030000-0000-4000-8000-000000000004', '27010000-0000-4000-8000-000000000001', '27020000-0000-4000-8000-000000000004', 2027, 'corn_yellow', 1, 80);

insert into public.programs (id, farm_id, name, program_kind, crop_year, revision, created_by, updated_by)
values
  ('27050000-0000-4000-8000-000000000001', '27010000-0000-4000-8000-000000000001', 'Maple 2027 Corn Program', 'chemical', 2027, 2, '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001'),
  ('27050000-0000-4000-8000-000000000002', '27010000-0000-4000-8000-000000000001', 'Maple Reassign Compatibility Program', 'chemical', 2027, 1, '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001'),
  ('27050000-0000-4000-8000-000000000003', '27010000-0000-4000-8000-000000000001', 'Maple Canonical Replay Program', 'chemical', 2027, 1, '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001');

insert into public.program_passes (id, farm_id, program_id, sequence, name, pass_type, activity_type, target_date, reminder_lead_days, created_by, updated_by)
values
  ('27051000-0000-4000-8000-000000000001', '27010000-0000-4000-8000-000000000001', '27050000-0000-4000-8000-000000000001', 1, 'Post-emerge synthetic pass', 'post', 'spray', '2027-05-20', 3, '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001'),
  ('27051000-0000-4000-8000-000000000031', '27010000-0000-4000-8000-000000000001', '27050000-0000-4000-8000-000000000003', 1, 'Replay pre pass', 'pre', 'spray', '2027-04-20', 3, '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001'),
  ('27051000-0000-4000-8000-000000000032', '27010000-0000-4000-8000-000000000001', '27050000-0000-4000-8000-000000000003', 2, 'Replay post pass', 'post', 'spray', '2027-05-20', 3, '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001');

insert into public.program_pass_products (id, farm_id, program_pass_id, sequence, product_name, rate_text, unit_text, estimated_cost_per_acre, created_by, updated_by)
values
  ('27051100-0000-4000-8000-000000000001', '27010000-0000-4000-8000-000000000001', '27051000-0000-4000-8000-000000000001', 1, 'Free-Typed Program Herbicide', '10.00', 'gal total', 7, '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001'),
  ('27051100-0000-4000-8000-000000000031', '27010000-0000-4000-8000-000000000001', '27051000-0000-4000-8000-000000000031', 1, 'Replay Product A', '1.00', 'pt/ac', 4, '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001'),
  ('27051100-0000-4000-8000-000000000032', '27010000-0000-4000-8000-000000000001', '27051000-0000-4000-8000-000000000031', 2, 'Replay Product B', '2.00', 'pt/ac', 5, '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001'),
  ('27051100-0000-4000-8000-000000000033', '27010000-0000-4000-8000-000000000001', '27051000-0000-4000-8000-000000000032', 1, 'Replay Product C', '3.00', 'oz/ac', 6, '27000000-0000-4000-8000-000000000001', '27000000-0000-4000-8000-000000000001');

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

create function pg_temp.reverse_assignment_plan_arrays(p_plan jsonb)
returns jsonb language sql immutable as $$
  select jsonb_set(
    p_plan,
    '{assignments}',
    coalesce((
      select jsonb_agg(
        jsonb_set(
          assignment_item.value,
          '{passes}',
          coalesce((
            select jsonb_agg(
              jsonb_set(
                pass_item.value,
                '{products}',
                coalesce((
                  select jsonb_agg(product_item.value order by product_item.ordinality desc)
                  from jsonb_array_elements(pass_item.value -> 'products')
                    with ordinality product_item(value, ordinality)
                ), '[]'::jsonb)
              ) order by pass_item.ordinality desc
            )
            from jsonb_array_elements(assignment_item.value -> 'passes')
              with ordinality pass_item(value, ordinality)
          ), '[]'::jsonb)
        ) order by assignment_item.ordinality desc
      )
      from jsonb_array_elements(p_plan -> 'assignments')
        with ordinality assignment_item(value, ordinality)
    ), '[]'::jsonb)
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
declare
  v_replayed jsonb;
  v_bad jsonb;
  v_ordered jsonb;
  v_reordered jsonb;
  v_ordered_receipt jsonb;
  v_reordered_receipt jsonb;
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

  -- Two assignments, two passes per assignment, and two products in one pass
  -- ensure this retry changes assignment, pass, and product array order.
  v_ordered := jsonb_build_object(
    'expected_program_revision', 1,
    'assignments', jsonb_build_array(
      jsonb_build_object(
        'crop_assignment_id', '27030000-0000-4000-8000-000000000003',
        'assignment_id', '27052000-0000-4000-8000-000000000041',
        'passes', jsonb_build_array(
          jsonb_build_object(
            'id', '27053000-0000-4000-8000-000000000411',
            'source_program_pass_id', '27051000-0000-4000-8000-000000000031',
            'products', jsonb_build_array(
              jsonb_build_object('id', '27053100-0000-4000-8000-000000004111', 'source_program_pass_product_id', '27051100-0000-4000-8000-000000000031'),
              jsonb_build_object('id', '27053100-0000-4000-8000-000000004112', 'source_program_pass_product_id', '27051100-0000-4000-8000-000000000032')
            )
          ),
          jsonb_build_object(
            'id', '27053000-0000-4000-8000-000000000412',
            'source_program_pass_id', '27051000-0000-4000-8000-000000000032',
            'products', jsonb_build_array(
              jsonb_build_object('id', '27053100-0000-4000-8000-000000004121', 'source_program_pass_product_id', '27051100-0000-4000-8000-000000000033')
            )
          )
        )
      ),
      jsonb_build_object(
        'crop_assignment_id', '27030000-0000-4000-8000-000000000004',
        'assignment_id', '27052000-0000-4000-8000-000000000042',
        'passes', jsonb_build_array(
          jsonb_build_object(
            'id', '27053000-0000-4000-8000-000000000421',
            'source_program_pass_id', '27051000-0000-4000-8000-000000000031',
            'products', jsonb_build_array(
              jsonb_build_object('id', '27053100-0000-4000-8000-000000004211', 'source_program_pass_product_id', '27051100-0000-4000-8000-000000000031'),
              jsonb_build_object('id', '27053100-0000-4000-8000-000000004212', 'source_program_pass_product_id', '27051100-0000-4000-8000-000000000032')
            )
          ),
          jsonb_build_object(
            'id', '27053000-0000-4000-8000-000000000422',
            'source_program_pass_id', '27051000-0000-4000-8000-000000000032',
            'products', jsonb_build_array(
              jsonb_build_object('id', '27053100-0000-4000-8000-000000004221', 'source_program_pass_product_id', '27051100-0000-4000-8000-000000000033')
            )
          )
        )
      )
    )
  );
  v_reordered := pg_temp.reverse_assignment_plan_arrays(v_ordered);
  if v_ordered -> 'assignments' -> 0 ->> 'crop_assignment_id'
      = v_reordered -> 'assignments' -> 0 ->> 'crop_assignment_id'
    or v_ordered -> 'assignments' -> 0 -> 'passes' -> 0 ->> 'source_program_pass_id'
      = v_reordered -> 'assignments' -> 1 -> 'passes' -> 0 ->> 'source_program_pass_id'
    or v_ordered -> 'assignments' -> 0 -> 'passes' -> 0 -> 'products' -> 0 ->> 'source_program_pass_product_id'
      = v_reordered -> 'assignments' -> 1 -> 'passes' -> 1 -> 'products' -> 0 ->> 'source_program_pass_product_id'
  then
    raise exception 'reordered replay fixture did not reverse every array level';
  end if;
  v_ordered_receipt := public.assign_program(
    '27010000-0000-4000-8000-000000000001',
    '27059000-0000-4000-8000-000000000040',
    '27050000-0000-4000-8000-000000000003',
    v_ordered
  );
  v_reordered_receipt := public.assign_program(
    '27010000-0000-4000-8000-000000000001',
    '27059000-0000-4000-8000-000000000040',
    '27050000-0000-4000-8000-000000000003',
    v_reordered
  );
  if v_reordered_receipt is distinct from v_ordered_receipt then
    raise exception 'reordered multi-item replay did not return the canonical immutable receipt';
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

  v_bad := pg_temp.maple_assignment_plan(
    '27030000-0000-4000-8000-000000000002',
    '27052000-0000-4000-8000-000000000010',
    '27053000-0000-4000-8000-000000000010',
    '27053100-0000-4000-8000-000000000010'
  );
  v_bad := jsonb_set(v_bad, '{assignments,0,passes}', '[]'::jsonb);
  begin
    perform public.assign_program('27010000-0000-4000-8000-000000000001', '27059000-0000-4000-8000-000000000010', '27050000-0000-4000-8000-000000000001', v_bad);
    raise exception 'a missing pass source was accepted';
  exception when others then
    if sqlerrm not like '%pass sources must exactly match%' then raise; end if;
  end;

  v_bad := pg_temp.maple_assignment_plan(
    '27030000-0000-4000-8000-000000000002',
    '27052000-0000-4000-8000-000000000011',
    '27053000-0000-4000-8000-000000000011',
    '27053100-0000-4000-8000-000000000011'
  );
  v_bad := jsonb_set(v_bad, '{assignments,0,passes}', (v_bad #> '{assignments,0,passes}') || jsonb_build_array(jsonb_build_object(
    'id', '27053000-0000-4000-8000-000000000111',
    'source_program_pass_id', '27051000-0000-4000-8000-000000000099',
    'products', jsonb_build_array()
  )));
  begin
    perform public.assign_program('27010000-0000-4000-8000-000000000001', '27059000-0000-4000-8000-000000000011', '27050000-0000-4000-8000-000000000001', v_bad);
    raise exception 'an extra pass source was accepted';
  exception when others then
    if sqlerrm not like '%pass sources must exactly match%' then raise; end if;
  end;

  v_bad := pg_temp.maple_assignment_plan(
    '27030000-0000-4000-8000-000000000002',
    '27052000-0000-4000-8000-000000000012',
    '27053000-0000-4000-8000-000000000012',
    '27053100-0000-4000-8000-000000000012'
  );
  v_bad := jsonb_set(v_bad, '{assignments,0,passes}', (v_bad #> '{assignments,0,passes}') || jsonb_build_array(jsonb_build_object(
    'id', '27053000-0000-4000-8000-000000000112',
    'source_program_pass_id', '27051000-0000-4000-8000-000000000001',
    'products', jsonb_build_array(jsonb_build_object(
      'id', '27053100-0000-4000-8000-000000000112',
      'source_program_pass_product_id', '27051100-0000-4000-8000-000000000001'
    ))
  )));
  begin
    perform public.assign_program('27010000-0000-4000-8000-000000000001', '27059000-0000-4000-8000-000000000012', '27050000-0000-4000-8000-000000000001', v_bad);
    raise exception 'a duplicate pass source was accepted';
  exception when others then
    if sqlerrm not like '%pass sources must exactly match%' then raise; end if;
  end;

  v_bad := pg_temp.maple_assignment_plan(
    '27030000-0000-4000-8000-000000000002',
    '27052000-0000-4000-8000-000000000013',
    '27053000-0000-4000-8000-000000000013',
    '27053100-0000-4000-8000-000000000013'
  );
  v_bad := jsonb_set(v_bad, '{assignments,0,passes,0,products}', '[]'::jsonb);
  begin
    perform public.assign_program('27010000-0000-4000-8000-000000000001', '27059000-0000-4000-8000-000000000013', '27050000-0000-4000-8000-000000000001', v_bad);
    raise exception 'a missing product source was accepted';
  exception when others then
    if sqlerrm not like '%product sources must exactly match%' then raise; end if;
  end;

  v_bad := pg_temp.maple_assignment_plan(
    '27030000-0000-4000-8000-000000000002',
    '27052000-0000-4000-8000-000000000014',
    '27053000-0000-4000-8000-000000000014',
    '27053100-0000-4000-8000-000000000014'
  );
  v_bad := jsonb_set(v_bad, '{assignments,0,passes,0,products}', (v_bad #> '{assignments,0,passes,0,products}') || jsonb_build_array(jsonb_build_object(
    'id', '27053100-0000-4000-8000-000000000114',
    'source_program_pass_product_id', '27051100-0000-4000-8000-000000000099'
  )));
  begin
    perform public.assign_program('27010000-0000-4000-8000-000000000001', '27059000-0000-4000-8000-000000000014', '27050000-0000-4000-8000-000000000001', v_bad);
    raise exception 'an extra product source was accepted';
  exception when others then
    if sqlerrm not like '%product sources must exactly match%' then raise; end if;
  end;

  v_bad := pg_temp.maple_assignment_plan(
    '27030000-0000-4000-8000-000000000002',
    '27052000-0000-4000-8000-000000000015',
    '27053000-0000-4000-8000-000000000015',
    '27053100-0000-4000-8000-000000000015'
  );
  v_bad := jsonb_set(v_bad, '{assignments,0,passes,0,products}', (v_bad #> '{assignments,0,passes,0,products}') || jsonb_build_array(jsonb_build_object(
    'id', '27053100-0000-4000-8000-000000000115',
    'source_program_pass_product_id', '27051100-0000-4000-8000-000000000001'
  )));
  begin
    perform public.assign_program('27010000-0000-4000-8000-000000000001', '27059000-0000-4000-8000-000000000015', '27050000-0000-4000-8000-000000000001', v_bad);
    raise exception 'a duplicate product source was accepted';
  exception when others then
    if sqlerrm not like '%product sources must exactly match%' then raise; end if;
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
  if (select count(*) from public.repository_write_receipts where farm_id = '27010000-0000-4000-8000-000000000001') <> 2 then
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
