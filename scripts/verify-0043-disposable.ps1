$ErrorActionPreference = 'Stop'
$name = "farmrx-0043-$PID"
$root = Split-Path -Parent $PSScriptRoot
$passed = $false

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI is required for the disposable 0043 proof but is not available on PATH.'
}

function Invoke-Probe([string]$sql, [string]$failure) {
  $sql | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw $failure }
}

function Invoke-ExpectedFailure([string]$sql, [string]$expected, [string]$failure) {
  $priorPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = $sql | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable 2>&1
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $priorPreference
  }
  if ($exitCode -eq 0 -or ($output -join "`n") -notmatch [regex]::Escape($expected)) {
    throw $failure
  }
}

try {
  docker run --rm -d --name $name -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=farmrx_disposable postgres:17 | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    if ((docker exec $name sh -c 'grep -qx postgres /proc/1/comm && pg_isready -U postgres -d farmrx_disposable' 2>$null) -match 'accepting connections') {
      $ready = $true
      break
    }
    Start-Sleep -Milliseconds 500
  }
  if (!$ready) { throw 'Disposable postgres:17 did not become ready.' }

  Invoke-Probe "create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table auth.users (id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as `$`$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', nullif(current_setting('request.jwt.claim.sub', true), ''))::uuid `$`$; grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role; create schema storage; create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid); alter table storage.objects enable row level security;" 'Disposable bootstrap failed.'

  Get-ChildItem (Join-Path $root 'supabase/migrations') -Filter '*.sql' |
    Sort-Object Name |
    ForEach-Object {
      Invoke-Probe (Get-Content -Raw $_.FullName) "Migration failed: $($_.Name)"
    }

  Invoke-Probe @'
do $$
declare
  v_missing_fk_indexes integer;
  v_optimized_policies integer;
  v_allowed_definers integer;
  v_actual_definers integer;
  v_internal_tables integer;
begin
  with foreign_keys as (
    select c.conrelid, c.conkey, c.conname
    from pg_catalog.pg_constraint c
    join pg_catalog.pg_class t on t.oid = c.conrelid
    join pg_catalog.pg_namespace n on n.oid = t.relnamespace
    where c.contype = 'f' and n.nspname = 'public'
  ), valid_indexes as (
    select
      i.indrelid,
      i.indkey::smallint[] as keys,
      pg_catalog.pg_get_expr(i.indpred, i.indrelid) as predicate
    from pg_catalog.pg_index i
    where i.indisvalid and i.indisready
  )
  select count(*) into v_missing_fk_indexes
  from foreign_keys fk
  where not exists (
    select 1 from valid_indexes i
    where i.indrelid = fk.conrelid
      and i.keys[0:cardinality(fk.conkey) - 1] = fk.conkey
      and (
        i.predicate is null
        or (
          fk.conname = 'firm_offers_filled_contract_same_farm_fk'
          and i.predicate = '(filled_contract_id IS NOT NULL)'
        )
        or (
          fk.conname = 'push_delivery_targets_subscription_id_fkey'
          and i.predicate = '(subscription_id IS NOT NULL)'
        )
      )
  );

  if v_missing_fk_indexes <> 0 then
    raise exception '% public foreign keys remain without a covering index', v_missing_fk_indexes;
  end if;

  -- Fingerprints cover the complete canonical PG17 USING + WITH CHECK output,
  -- not the mere presence of auth.uid text. Command, role, and permissive mode
  -- are checked separately so any authorization-semantic drift fails closed.
  with expected(tablename, policyname, command, fingerprint) as (
    values
      ('application_records','application_records_insert','INSERT','c100eceacf6dbcd84b3c804dc5e59ab2'),
      ('application_records','application_records_update','UPDATE','a3d8226acf897c58d0b046710ce28b49'),
      ('assigned_program_pass_products','assigned_program_pass_products_insert','INSERT','b015db5451df5f98d5022f839660b89f'),
      ('assigned_program_passes','assigned_program_passes_insert','INSERT','b015db5451df5f98d5022f839660b89f'),
      ('equipment','equipment_insert','INSERT','e32ecfb7df282e3c45c4674c262f732d'),
      ('equipment_meter_readings','equipment_meter_readings_insert','INSERT','6a3d38d8ebf9b35d459e3ba46ad11b04'),
      ('equipment_service_intervals','equipment_service_intervals_insert','INSERT','e32ecfb7df282e3c45c4674c262f732d'),
      ('equipment_service_log','equipment_service_log_insert','INSERT','b015db5451df5f98d5022f839660b89f'),
      ('farm_rep_access','farm_rep_access_insert','INSERT','d8e83c170e6d1a5780b5010f3e572c83'),
      ('farm_rep_access','farm_rep_access_select','SELECT','c0ea4717844e2777dbaef1e64be48368'),
      ('farm_tasks','farm_tasks_insert','INSERT','b015db5451df5f98d5022f839660b89f'),
      ('farms','farms_insert','INSERT','f5a50ced43907e58aa50dadd34b9b017'),
      ('field_log_entries','field_log_entries_insert','INSERT','b015db5451df5f98d5022f839660b89f'),
      ('inventory_adjustments','inventory_adjustments_insert','INSERT','27cad561b062b42dcc6f5237278c714f'),
      ('inventory_receipts','inventory_receipts_insert','INSERT','fd1ae2678d59d288470863f10a0e8296'),
      ('inventory_receipts','inventory_receipts_update','UPDATE','ccc929e50bd6f98b7d54d62b6813c651'),
      ('notifications','notifications_select','SELECT','537951dc5d1dba174f2bdaad4bf06204'),
      ('notifications','notifications_update','UPDATE','59b6321fd7ad2af9c3fe909e36357b9e'),
      ('program_assignments','program_assignments_insert','INSERT','d05c5d382a9297afb666773bba66226f'),
      ('program_pass_products','program_pass_products_insert','INSERT','b015db5451df5f98d5022f839660b89f'),
      ('program_passes','program_passes_insert','INSERT','b015db5451df5f98d5022f839660b89f'),
      ('programs','programs_insert','INSERT','b015db5451df5f98d5022f839660b89f'),
      ('push_subscriptions','push_subscriptions_select','SELECT','c57409d1aa8a28b37caa2a5a47c20554'),
      ('scouting_notes','scouting_notes_insert','INSERT','b015db5451df5f98d5022f839660b89f'),
      ('scouting_photos','scouting_photos_insert','INSERT','b015db5451df5f98d5022f839660b89f')
  )
  select count(*) into v_optimized_policies
  from expected e
  join pg_catalog.pg_policies p
    on p.schemaname = 'public'
   and p.tablename = e.tablename
   and p.policyname = e.policyname
  where p.cmd = e.command
    and p.permissive = 'PERMISSIVE'
    and p.roles = array['authenticated']::name[]
    and md5(coalesce(p.qual, '') || E'\n' || coalesce(p.with_check, '')) = e.fingerprint;

  if v_optimized_policies <> 25 then
    raise exception 'expected 25 exact optimized policy definitions, found %', v_optimized_policies;
  end if;

  if has_function_privilege('anon', 'public.enqueue_push_delivery()', 'execute')
    or has_function_privilege('authenticated', 'public.enqueue_push_delivery()', 'execute') then
    raise exception 'client roles can still execute the internal push trigger function';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and has_function_privilege('anon', p.oid, 'execute')
  ) then
    raise exception 'an anonymous-executable SECURITY DEFINER function remains';
  end if;

  -- Exact live-baseline allowlist. Source-text heuristics are intentionally not
  -- used: merely mentioning auth.uid() does not prove that a function enforces
  -- it. Behavior probes below exercise representative anonymous and signed-in
  -- denial paths.
  with expected(proname, identity_args) as (
    values
      ('append_bin_movement','p_farm_id uuid, p_transaction jsonb'),
      ('assign_program','p_farm_id uuid, p_operation_id uuid, p_program_id uuid, p_assignment_plan jsonb'),
      ('bootstrap_first_farm','p_farm_name text, p_entity_name text, p_entity_type text'),
      ('can_access_farm','target_farm_id uuid'),
      ('can_edit_farm','target_farm_id uuid'),
      ('can_manage_farm','target_farm_id uuid'),
      ('can_read_private_financials','target_farm_id uuid'),
      ('copy_crop_budget','p_farm_id uuid, p_source_id uuid, p_budget jsonb, p_cost_lines jsonb, p_matrix_steps jsonb'),
      ('copy_crop_budget_durable','p_farm_id uuid, p_source_id uuid, p_budget jsonb, p_cost_lines jsonb, p_matrix_steps jsonb'),
      ('create_crop_budget_with_matrix','p_farm_id uuid, p_budget jsonb, p_matrix_steps jsonb'),
      ('create_notification','p_farm_id uuid, p_recipient uuid, p_category text, p_title text, p_body text, p_link text, p_dedupe_key text'),
      ('delete_field_log_entry','p_farm_id uuid, p_entry_id uuid'),
      ('delete_program','p_farm_id uuid, p_operation_id uuid, p_program_id uuid'),
      ('delete_program_pass','p_farm_id uuid, p_operation_id uuid, p_program_id uuid, p_pass_id uuid'),
      ('delete_push_subscription','p_farm_id uuid, p_endpoint text'),
      ('delete_scouting_note','p_farm_id uuid, p_note_id uuid'),
      ('delete_service_log_with_reversal','p_farm_id uuid, p_log_id uuid'),
      ('finalize_contract_price_leg','p_farm_id uuid, p_contract_id uuid, p_leg text, p_value numeric'),
      ('generate_due_program_items','p_farm_id uuid, p_operation_id uuid, p_local_date date'),
      ('generate_due_program_items_v2','p_farm_id uuid, p_operation_id uuid'),
      ('generate_due_program_notifications','p_farm_id uuid, p_local_date date'),
      ('generate_due_service_tasks','p_farm_id uuid'),
      ('generate_due_service_tasks_v2','p_farm_id uuid, p_operation_id uuid'),
      ('get_current_farm_access_epochs',''),
      ('get_member_display_name','target_user_id uuid'),
      ('has_explicit_rep_access','target_farm_id uuid'),
      ('is_active_farm_member','target_farm_id uuid'),
      ('mark_notifications_read','p_ids uuid[]'),
      ('mark_program_pass_applied','p_farm_id uuid, p_operation_id uuid, p_assigned_pass_id uuid, p_applied_on date, p_applied_acres numeric, p_actual_products jsonb, p_application_record_id uuid, p_create_application_record boolean'),
      ('operational_integrity_capability_probe','p_farm_id uuid'),
      ('program_due_generation_status','p_farm_id uuid'),
      ('reassign_program_assignment','p_farm_id uuid, p_operation_id uuid, p_assignment_id uuid, p_new_program_id uuid, p_reason text'),
      ('record_grain_contract_delivery','p_farm_id uuid, p_delivery jsonb'),
      ('record_marketing_alert_transition','p_farm_id uuid, p_rule_id uuid, p_condition_true boolean'),
      ('refresh_program_assignment','p_farm_id uuid, p_operation_id uuid, p_assignment_id uuid'),
      ('reorder_program_passes','p_farm_id uuid, p_operation_id uuid, p_program_id uuid, p_ordered_pass_ids uuid[]'),
      ('replace_marketing_plan_targets','p_farm_id uuid, p_crop_year integer, p_commodity_id text, p_operating_entity_id uuid, p_enterprise_label text, p_targets jsonb'),
      ('replace_profitability_matrix_steps','p_farm_id uuid, p_budget_id uuid, p_steps jsonb'),
      ('replace_profitability_matrix_steps','p_farm_id uuid, p_budget_id uuid, p_steps jsonb, p_expected_steps jsonb'),
      ('reschedule_program_pass','p_farm_id uuid, p_operation_id uuid, p_assigned_pass_id uuid, p_due_on date, p_timing_label text'),
      ('save_crop_harvest_versioned','p_farm_id uuid, p_operation_id uuid, p_expected_updated_at timestamp with time zone, p_entry jsonb'),
      ('save_field_bundle_versioned','p_farm_id uuid, p_operation_id uuid, p_expected_versions jsonb, p_draft jsonb'),
      ('save_field_log_entry','p_farm_id uuid, p_operation_id uuid, p_entry jsonb'),
      ('save_program','p_farm_id uuid, p_operation_id uuid, p_program jsonb'),
      ('save_program_pass','p_farm_id uuid, p_operation_id uuid, p_program_id uuid, p_pass jsonb, p_products jsonb, p_place_after_pass_id uuid'),
      ('save_push_subscription','p_farm_id uuid, p_endpoint text, p_p256dh text, p_auth text, p_user_agent text'),
      ('save_scouting_note','p_farm_id uuid, p_operation_id uuid, p_note jsonb'),
      ('save_service_log_entry','p_farm_id uuid, p_log jsonb, p_reading_id uuid'),
      ('service_due_generation_status','p_farm_id uuid'),
      ('set_field_location','p_farm_id uuid, p_field_id uuid, p_latitude numeric, p_longitude numeric, p_source text'),
      ('skip_program_pass','p_farm_id uuid, p_operation_id uuid, p_assigned_pass_id uuid, p_skipped_on date, p_reason text'),
      ('unassign_program','p_farm_id uuid, p_operation_id uuid, p_assignment_id uuid, p_reason text')
  )
  select count(*) into v_allowed_definers
  from expected e
  join pg_catalog.pg_proc p
    on p.proname = e.proname
   and pg_catalog.pg_get_function_identity_arguments(p.oid) = e.identity_args
  join pg_catalog.pg_namespace n
    on n.oid = p.pronamespace and n.nspname = 'public'
  where p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'execute')
    and not has_function_privilege('anon', p.oid, 'execute');

  select count(*) into v_actual_definers
  from pg_catalog.pg_proc p
  join pg_catalog.pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and has_function_privilege('authenticated', p.oid, 'execute');

  if v_allowed_definers <> 52 or v_actual_definers <> 52 then
    raise exception 'authenticated SECURITY DEFINER ACL allowlist drift: expected 52, matched %, actual %',
      v_allowed_definers, v_actual_definers;
  end if;

  if to_regclass('public.firm_offers_id_farm_id_idx') is not null
    or to_regclass('public.firm_offers_id_farm_id_key') is null then
    raise exception 'duplicate firm-offer index cleanup did not preserve the constraint-backed index';
  end if;

  select count(*) into v_internal_tables
  from (values
    ('alert_rule_states'),
    ('farm_access_epochs'),
    ('push_deliveries'),
    ('push_delivery_targets'),
    ('repository_write_receipts'),
    ('service_log_meter_readings'),
    ('spray_window_states')
  ) expected(table_name)
  join pg_catalog.pg_class c on c.relname = expected.table_name
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  where c.relrowsecurity
    and not has_table_privilege('anon', c.oid, 'select')
    and not has_table_privilege('anon', c.oid, 'insert')
    and not has_table_privilege('anon', c.oid, 'update')
    and not has_table_privilege('anon', c.oid, 'delete')
    and not has_table_privilege('authenticated', c.oid, 'select')
    and not has_table_privilege('authenticated', c.oid, 'insert')
    and not has_table_privilege('authenticated', c.oid, 'update')
    and not has_table_privilege('authenticated', c.oid, 'delete')
    and not exists (
      select 1 from pg_catalog.pg_policy p where p.polrelid = c.oid
    );

  if v_internal_tables <> 7 then
    raise exception 'internal deny-by-default table posture changed';
  end if;
end $$;

-- The trigger must continue to enqueue a row even though client RPC execution
-- is revoked.
insert into auth.users(id,email)
values
  ('00000000-0000-4000-8000-000000000001','advisor-owner@example.test'),
  ('00000000-0000-4000-8000-000000000002','advisor-read-only@example.test'),
  ('00000000-0000-4000-8000-000000000003','advisor-outsider@example.test');
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000001"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001')::text,false);
insert into public.farms(id,name,created_by)
values ('00000000-0000-4000-8000-000000000010','Advisor Farm','00000000-0000-4000-8000-000000000001');
select set_config(
  'request.headers',
  jsonb_build_object(
    'x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000001',
    'x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text
  )::text,
  false
);
insert into public.farm_memberships(farm_id,user_id,role,status)
values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002','read_only','active');
insert into public.notifications(id,farm_id,user_id,category,title,body,dedupe_key,created_by)
values ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','general','Advisor proof','Trigger remains active','advisor-proof','00000000-0000-4000-8000-000000000001');
do $$
begin
  if not exists (
    select 1 from public.push_deliveries
    where notification_id = '00000000-0000-4000-8000-000000000020'
  ) then
    raise exception 'push-delivery trigger stopped enqueueing after ACL hardening';
  end if;
end $$;
'@ '0043 advisor-hardening catalog or trigger proof failed.'

  Invoke-ExpectedFailure @'
set role anon;
select public.can_access_farm('00000000-0000-4000-8000-000000000010');
'@ 'permission denied for function can_access_farm' 'Anonymous execution reached a SECURITY DEFINER farm helper.'

  Invoke-ExpectedFailure @'
set role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
select public.append_bin_movement('00000000-0000-4000-8000-000000000010','{}'::jsonb);
'@ 'you do not have permission to add a bin movement' 'Read-only member reached a guarded SECURITY DEFINER writer.'

  Invoke-ExpectedFailure @'
set role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000002"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000002','x-farm-rx-access-epochs',jsonb_build_object('00000000-0000-4000-8000-000000000010',1)::text)::text,false);
insert into public.farm_tasks(id,farm_id,title,status,priority,source,created_by)
values ('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000010','Unauthorized task','todo','normal','manual','00000000-0000-4000-8000-000000000002');
'@ 'violates row-level security policy' 'Read-only member passed a representative optimized INSERT policy.'

  Invoke-Probe @'
set role authenticated;
select set_config('request.jwt.claims','{"role":"authenticated","sub":"00000000-0000-4000-8000-000000000003"}',false);
select set_config('request.headers',jsonb_build_object('x-farm-rx-expected-user-id','00000000-0000-4000-8000-000000000003')::text,false);
do $$
declare
  v_changed integer;
begin
  update public.notifications
  set read_at = now()
  where id = '00000000-0000-4000-8000-000000000020';
  get diagnostics v_changed = row_count;
  if v_changed <> 0 then
    raise exception 'outside user changed another farm notification';
  end if;
end $$;
'@ 'Representative optimized UPDATE policy allowed cross-user mutation.'

  $passed = $true
} finally {
  docker rm -f $name 2>$null | Out-Null
}

if ($passed) { Write-Output 'PROBE 0043 database advisor hardening: PASS' }
