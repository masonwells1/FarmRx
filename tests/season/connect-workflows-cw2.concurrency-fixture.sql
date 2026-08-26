-- Proof-only local postgres fixture setup for the isolated concurrency probe.
-- Credited Program and Inventory actions remain in authenticated dblink workers.
\set ON_ERROR_STOP on
begin;
select set_config('request.jwt.claims','{"sub":"27000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select set_config('request.jwt.claim.sub','27000000-0000-4000-8000-000000000001',true);
select set_config('request.headers','{"x-farm-rx-expected-user-id":"27000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\"27010000-0000-4000-8000-000000000005\":1}"}',true);
do $cw2_fixture_boundary$
begin
  if current_user <> 'postgres'
     or session_user <> 'postgres'
     or current_database() <> 'postgres'
     or inet_client_addr() is not null
     or auth.uid() <> '27000000-0000-4000-8000-000000000001'
     or current_setting('request.headers',true)::jsonb <> '{"x-farm-rx-expected-user-id":"27000000-0000-4000-8000-000000000001","x-farm-rx-access-epochs":"{\"27010000-0000-4000-8000-000000000005\":1}"}'::jsonb then
    raise exception 'CW2 concurrency fixture did not enter the exact local Cedar postgres boundary';
  end if;
end
$cw2_fixture_boundary$;
\echo CONNECT_WORKFLOWS_CW2_CONCURRENCY_FIXTURE_BOUNDARY_PASS

insert into public.assigned_program_passes (
  id,farm_id,assignment_id,source_program_pass_id,source_revision,sequence,name,
  pass_type,activity_type,target_date,reminder_lead_days,due_on,due_source,
  is_field_override,status,created_by,updated_by
) values (
  'c2500000-0000-4000-8000-000000000001','27010000-0000-4000-8000-000000000005',
  'c2000000-0000-4000-8000-000000000004','c2000000-0000-4000-8000-000000000002',
  1,150,'CW2 catalog serialization pass','post','spray','2027-07-07',0,
  '2027-07-07','template_date',false,'planned',
  '27000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001'
);
insert into public.assigned_program_pass_products (
  id,farm_id,assigned_pass_id,source_program_pass_product_id,sequence,
  product_name,rate_text,unit_text,estimated_cost_per_acre,catalog_product_id,
  is_active,created_by,updated_by
) values (
  'c2500000-0000-4000-8000-000000000002','27010000-0000-4000-8000-000000000005',
  'c2500000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000003',
  1,'Synthetic Cedar Herbicide 41','0.001','gal total',0.01,
  '27040000-0000-4000-8000-000000000005',true,
  '27000000-0000-4000-8000-000000000001','27000000-0000-4000-8000-000000000001'
);
commit;

begin;
create function public.cw2_catalog_probe_pause() returns trigger language plpgsql set search_path='' as $$
begin
  if new.id='c2500000-0000-4000-8000-000000000002' then perform pg_catalog.pg_advisory_xact_lock(25000,2); end if;
  return new;
end
$$;
create trigger cw2_catalog_probe_pause before update on public.assigned_program_pass_products
for each row execute function public.cw2_catalog_probe_pause();
commit;

\echo CONNECT_WORKFLOWS_CW2_CONCURRENCY_FIXTURE_PASS
