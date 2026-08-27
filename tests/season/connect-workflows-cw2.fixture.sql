-- CW-2 synthetic delta fixture. Load only after cedar-creek-2027-start.sql.
\set ON_ERROR_STOP on

begin;

create schema cw2_proof;
create table cw2_proof.browser_baseline (
  table_name text primary key,
  row_count bigint not null,
  row_hash text not null,
  rows jsonb not null
);
create function cw2_proof.public_snapshot()
returns table(table_name text, row_count bigint, row_hash text, rows jsonb)
language plpgsql
set search_path = ''
as $$
declare v_table record;
begin
  for v_table in
    select class.relname
    from pg_catalog.pg_class class
    join pg_catalog.pg_namespace namespace on namespace.oid=class.relnamespace
    where namespace.nspname='public' and class.relkind in ('r','p')
    order by class.relname
  loop
    table_name := v_table.relname;
    execute pg_catalog.format(
      'select count(*)::bigint, md5(coalesce(string_agg(to_jsonb(source)::text, '''' order by to_jsonb(source)::text), '''')), coalesce(jsonb_agg(to_jsonb(source) order by to_jsonb(source)::text), ''[]''::jsonb) from public.%I source',
      v_table.relname
    ) into row_count,row_hash,rows;
    return next;
  end loop;
end
$$;

select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','27000000-0000-4000-8000-000000000001',true);
select set_config(
  'request.headers',
  jsonb_build_object(
    'x-farm-rx-expected-user-id','27000000-0000-4000-8000-000000000001',
    'x-farm-rx-access-epochs',jsonb_build_object('27010000-0000-4000-8000-000000000005',1)::text
  )::text,
  true
);

insert into public.programs (
  id, farm_id, name, program_kind, commodity_id, crop_year, revision,
  created_by, updated_by, created_at, updated_at
) values (
  'c2000000-0000-4000-8000-000000000001',
  '27010000-0000-4000-8000-000000000005',
  'Cedar CW-2 exact Inventory program', 'chemical', 'soybeans', 2027, 1,
  '27000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000001',
  '2027-07-07 18:20:00+00', '2027-07-07 18:20:00+00'
);

insert into public.program_passes (
  id, farm_id, program_id, sequence, name, pass_type, activity_type,
  target_date, reminder_lead_days, created_by, updated_by, created_at, updated_at
) values (
  'c2000000-0000-4000-8000-000000000002',
  '27010000-0000-4000-8000-000000000005',
  'c2000000-0000-4000-8000-000000000001',
  1, 'CW-2 confirmed draw-down pass', 'post', 'spray', '2027-07-08', 0,
  '27000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000001',
  '2027-07-07 18:20:00+00', '2027-07-07 18:20:00+00'
);

insert into public.program_pass_products (
  id, farm_id, program_pass_id, sequence, product_name, rate_text, unit_text,
  estimated_cost_per_acre, catalog_product_id, created_by, updated_by,
  created_at, updated_at
) values (
  'c2000000-0000-4000-8000-000000000003',
  '27010000-0000-4000-8000-000000000005',
  'c2000000-0000-4000-8000-000000000002',
  1, 'Synthetic Cedar Herbicide 41', '0.001', 'gal total', 0.01,
  '27040000-0000-4000-8000-000000000005',
  '27000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000001',
  '2027-07-07 18:20:00+00', '2027-07-07 18:20:00+00'
);

insert into public.program_assignments (
  id, farm_id, program_id, crop_assignment_id, program_name_snapshot,
  program_kind_snapshot, status, template_revision, assigned_by,
  assigned_at, created_at, updated_at
) values (
  'c2000000-0000-4000-8000-000000000004',
  '27010000-0000-4000-8000-000000000005',
  'c2000000-0000-4000-8000-000000000001',
  '27030000-0000-4000-8000-000000000005',
  'Cedar CW-2 exact Inventory program', 'chemical', 'active', 1,
  '27000000-0000-4000-8000-000000000001',
  '2027-07-07 18:20:00+00', '2027-07-07 18:20:00+00', '2027-07-07 18:20:00+00'
);

insert into public.assigned_program_passes (
  id, farm_id, assignment_id, source_program_pass_id, source_revision,
  sequence, name, pass_type, activity_type, target_date, reminder_lead_days,
  due_on, due_source, is_field_override, status, created_by, updated_by,
  created_at, updated_at
) values (
  'c2000000-0000-4000-8000-000000000005',
  '27010000-0000-4000-8000-000000000005',
  'c2000000-0000-4000-8000-000000000004',
  'c2000000-0000-4000-8000-000000000002', 1,
  1, 'CW-2 confirmed draw-down pass', 'post', 'spray', '2027-07-08', 0,
  '2027-07-08', 'template_date', false, 'planned',
  '27000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000001',
  '2027-07-07 18:20:00+00', '2027-07-07 18:20:00+00'
);

insert into public.assigned_program_pass_products (
  id, farm_id, assigned_pass_id, source_program_pass_product_id, sequence,
  product_name, rate_text, unit_text, estimated_cost_per_acre,
  catalog_product_id, is_active, created_by, updated_by, created_at, updated_at
) values (
  'c2000000-0000-4000-8000-000000000006',
  '27010000-0000-4000-8000-000000000005',
  'c2000000-0000-4000-8000-000000000005',
  'c2000000-0000-4000-8000-000000000003',
  1, 'Synthetic Cedar Herbicide 41', '0.001', 'gal total', 0.01,
  '27040000-0000-4000-8000-000000000005', true,
  '27000000-0000-4000-8000-000000000001',
  '27000000-0000-4000-8000-000000000001',
  '2027-07-07 18:20:00+00', '2027-07-07 18:20:00+00'
);

do $fixture$
begin
  if (select count(*) from public.program_assignment_tracker
      where farm_id='27010000-0000-4000-8000-000000000005'
        and assignment_id='c2000000-0000-4000-8000-000000000004'
        and passes @> '[{"id":"c2000000-0000-4000-8000-000000000005","status":"planned"}]'::jsonb) <> 1 then
    raise exception 'CW2 fixture did not expose one planned Program pass';
  end if;
  if (select on_hand_quantity from public.inventory_on_hand
      where farm_id='27010000-0000-4000-8000-000000000005'
        and product_id='27040000-0000-4000-8000-000000000005') <> 20 then
    raise exception 'CW2 fixture did not begin at 20 gal';
  end if;
  if exists(select 1 from public.program_inventory_matches)
     or exists(select 1 from public.application_records)
     or exists(select 1 from public.application_products)
     or exists(select 1 from public.repository_write_receipts) then
    raise exception 'CW2 fixture started with writes';
  end if;
end
$fixture$;

-- This is the complete public-table baseline immediately after fixture setup
-- and before the browser receives authority to save the Program pass.
insert into cw2_proof.browser_baseline(table_name,row_count,row_hash,rows)
select table_name,row_count,row_hash,rows from cw2_proof.public_snapshot();

commit;
