$ErrorActionPreference = 'Stop'
$name = "farmrx-0036-$PID"
$root = Split-Path -Parent $PSScriptRoot
$passed = $false
function Invoke-Probe([string]$sql, [string]$failure) {
  $sql | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
  if ($LASTEXITCODE -ne 0) { throw $failure }
}
try {
  docker run --rm -d --name $name -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=farmrx_disposable postgres:16 | Out-Null
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) { if ((docker exec $name sh -c 'grep -qx postgres /proc/1/comm && pg_isready -U postgres -d farmrx_disposable' 2>$null) -match 'accepting connections') { $ready = $true; break }; Start-Sleep -Milliseconds 500 }
  if (!$ready) { throw 'Disposable postgres:16 did not become ready.' }
  Invoke-Probe "create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table auth.users (id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as `$`$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid `$`$; create schema storage; create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid); alter table storage.objects enable row level security;" 'Disposable bootstrap failed.'
  Get-ChildItem (Join-Path $root 'supabase/migrations') -Filter '*.sql' | Sort-Object Name | ForEach-Object { Invoke-Probe (Get-Content -Raw $_.FullName) "Migration failed: $($_.Name)" }

  Invoke-Probe @'
insert into auth.users(id,email) values ('00000000-0000-4000-8000-000000000001','probe@example.test');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
insert into public.farms(id,name,created_by) values ('00000000-0000-4000-8000-000000000010','Probe Farm','00000000-0000-4000-8000-000000000001');
insert into public.farm_memberships(farm_id,user_id,role,status) values ('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','owner','active') on conflict(farm_id,user_id) do update set role='owner',status='active';
insert into public.entities(id,farm_id,name,entity_type) values ('00000000-0000-4000-8000-000000000020','00000000-0000-4000-8000-000000000010','Probe Entity','individual');
insert into public.fields(id,farm_id,operating_entity_id,name,total_acres) values ('00000000-0000-4000-8000-000000000030','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000020','Original Field',10);
insert into public.arrangements(id,farm_id,field_id,arrangement_type,effective_from) values ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000030','owned','2026-01-01');
insert into public.crop_assignments(id,farm_id,field_id,crop_year,commodity_id,planted_acres,expected_yield_per_acre,expected_price_per_bu) values ('00000000-0000-4000-8000-000000000040','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000030',2026,'corn_yellow',10,180,4.25);
insert into public.equipment(id,farm_id,name,category,created_by) values ('00000000-0000-4000-8000-000000000050','00000000-0000-4000-8000-000000000010','Original Tractor','tractor','00000000-0000-4000-8000-000000000001');

create table public.probe_expected(field_versions jsonb, harvest_version timestamptz, equipment_version timestamptz);
insert into public.probe_expected
select jsonb_build_object(
  'field_updated_at', f.updated_at,
  'arrangement', jsonb_build_object('id',a.id,'updated_at',a.updated_at),
  'crop_assignments', jsonb_build_array(jsonb_build_object('id',c.id,'updated_at',c.updated_at))
), c.updated_at, e.updated_at
from public.fields f
join public.arrangements a on a.field_id=f.id and a.effective_to is null
join public.crop_assignments c on c.field_id=f.id
join public.equipment e on e.farm_id=f.farm_id
where f.id='00000000-0000-4000-8000-000000000030';

create function public.probe_field_draft(p_name text) returns jsonb language sql stable as $$
select jsonb_build_object(
  'id','00000000-0000-4000-8000-000000000030','name',p_name,
  'operating_entity_id','00000000-0000-4000-8000-000000000020','total_acres',10,
  'county',null,'state',null,'legal_description',null,'fsa_farm_number',null,'fsa_tract_number',null,'soil_productivity_index',null,
  'arrangement',jsonb_build_object('id','00000000-0000-4000-8000-000000000031','arrangement_type','owned','landlord_name',null,'landlord_phone',null,'landlord_contact_notes',null,'effective_from','2026-01-01','cash_rent_per_acre',null,'flex_bonus_formula',null,'landlord_crop_pct',null,'landlord_seed_pct',0,'landlord_fertilizer_pct',0,'landlord_chemical_pct',0,'landlord_fuel_pct',0,'landlord_labor_custom_pct',0,'landlord_crop_insurance_pct',0,'landlord_equipment_pct',0,'landlord_interest_pct',0,'landlord_other_input_pct',0,'notes',null),
  'crop_assignments',jsonb_build_array(jsonb_build_object('id','00000000-0000-4000-8000-000000000040','is_new',false,'crop_year',2026,'commodity_id','corn_yellow','planted_acres',10,'planting_sequence',1,'variety',null,'planting_date',null,'harvest_date',null,'harvested_bushels',null,'expected_yield_per_acre',180,'expected_price_per_bu',4.25,'notes',null))
) $$;

do $$ begin
  if has_function_privilege('authenticated','public.save_field_bundle(uuid,uuid,jsonb)','execute') then raise exception 'legacy field RPC still bypasses version checks'; end if;
  if has_function_privilege('authenticated','public.save_crop_harvest(uuid,uuid,jsonb)','execute') then raise exception 'legacy harvest RPC still bypasses version checks'; end if;
  if not has_function_privilege('authenticated','public.save_field_bundle_versioned(uuid,uuid,jsonb,jsonb)','execute') then raise exception 'versioned field RPC unavailable'; end if;
end $$;
'@ '0036 seed or privilege probe failed.'

  # Session A commits from the shared original snapshot.
  Invoke-Probe @'
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
select public.save_field_bundle_versioned('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-0000000000a1',(select field_versions from public.probe_expected),public.probe_field_draft('Session A Field'));
'@ 'Session A field save failed.'

  # Session B loaded the same old snapshot and must receive the stable conflict.
  Invoke-Probe @'
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
do $$ begin
  perform public.save_field_bundle_versioned('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-0000000000b1',(select field_versions from public.probe_expected),public.probe_field_draft('Session B Field'));
  raise exception 'stale field save was accepted';
exception when sqlstate 'PT409' then if sqlerrm <> 'FARM_RX_STALE_WRITE' then raise; end if; end $$;
'@ 'Session B stale field save was not rejected.'

  # Replaying Session A after a lost response must return its receipt, not conflict.
  Invoke-Probe @'
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
select public.save_field_bundle_versioned('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-0000000000a1',(select field_versions from public.probe_expected),public.probe_field_draft('Session A Field'));
do $$ begin if (select name from public.fields where id='00000000-0000-4000-8000-000000000030') <> 'Session A Field' then raise exception 'stale field overwrote Session A'; end if; end $$;
update public.probe_expected set harvest_version=(select updated_at from public.crop_assignments where id='00000000-0000-4000-8000-000000000040');
'@ 'Lost-response field replay was not idempotent.'

  Invoke-Probe @'
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
select public.save_crop_harvest_versioned('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-0000000000a2',(select harvest_version from public.probe_expected),jsonb_build_object('crop_assignment_id','00000000-0000-4000-8000-000000000040','harvested_bushels',1000,'harvest_date','2026-10-01','actual_price_per_bu',4.5));
'@ 'Session A harvest save failed.'
  Invoke-Probe @'
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
do $$ begin
  perform public.save_crop_harvest_versioned('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-0000000000b2',(select harvest_version from public.probe_expected),jsonb_build_object('crop_assignment_id','00000000-0000-4000-8000-000000000040','harvested_bushels',900,'harvest_date','2026-10-02','actual_price_per_bu',4.4));
  raise exception 'stale harvest save was accepted';
exception when sqlstate 'PT409' then if sqlerrm <> 'FARM_RX_STALE_WRITE' then raise; end if; end $$;
'@ 'Session B stale harvest save was not rejected.'
  Invoke-Probe @'
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
select public.save_crop_harvest_versioned('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-0000000000a2',(select harvest_version from public.probe_expected),jsonb_build_object('crop_assignment_id','00000000-0000-4000-8000-000000000040','harvested_bushels',1000,'harvest_date','2026-10-01','actual_price_per_bu',4.5));
'@ 'Lost-response harvest replay was not idempotent.'

  # The same conditional UPDATE used by the direct-table gateway is proven in
  # two additional database sessions against one loaded updated_at value.
  Invoke-Probe @'
do $$ declare n integer; begin
  update public.equipment set name='Session A Tractor' where id='00000000-0000-4000-8000-000000000050' and farm_id='00000000-0000-4000-8000-000000000010' and updated_at=(select equipment_version from public.probe_expected);
  get diagnostics n = row_count; if n <> 1 then raise exception 'Session A compare-and-swap did not update exactly one row'; end if;
end $$;
'@ 'Direct-table Session A compare-and-swap failed.'
  Invoke-Probe @'
do $$ declare n integer; begin
  update public.equipment set name='Session B Tractor' where id='00000000-0000-4000-8000-000000000050' and farm_id='00000000-0000-4000-8000-000000000010' and updated_at=(select equipment_version from public.probe_expected);
  get diagnostics n = row_count; if n <> 0 then raise exception 'Session B stale compare-and-swap overwrote Session A'; end if;
  if (select name from public.equipment where id='00000000-0000-4000-8000-000000000050') <> 'Session A Tractor' then raise exception 'direct-table winner was not preserved'; end if;
end $$;
'@ 'Direct-table Session B stale save was not rejected.'

  # A stale full-field bundle must not erase a crop assignment added by a
  # different session after the editor loaded its aggregate snapshot.
  Invoke-Probe @'
update public.probe_expected set field_versions=(
  select jsonb_build_object(
    'field_updated_at',f.updated_at,
    'arrangement',jsonb_build_object('id',a.id,'updated_at',a.updated_at),
    'crop_assignments',(select jsonb_agg(jsonb_build_object('id',c.id,'updated_at',c.updated_at) order by c.id) from public.crop_assignments c where c.field_id=f.id)
  )
  from public.fields f join public.arrangements a on a.field_id=f.id and a.effective_to is null
  where f.id='00000000-0000-4000-8000-000000000030'
);
insert into public.crop_assignments(id,farm_id,field_id,crop_year,commodity_id,planted_acres,expected_yield_per_acre,expected_price_per_bu)
values ('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000030',2026,'soybeans',10,55,11.25);
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',false);
do $$ begin
  perform public.save_field_bundle_versioned('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-0000000000c1',(select field_versions from public.probe_expected),public.probe_field_draft('Stale Child Set'));
  raise exception 'stale field bundle erased a newly added crop';
exception when sqlstate 'PT409' then if sqlerrm <> 'FARM_RX_STALE_WRITE' then raise; end if; end $$;
do $$ begin if not exists(select 1 from public.crop_assignments where id='00000000-0000-4000-8000-000000000041') then raise exception 'newer crop assignment was erased'; end if; end $$;
'@ 'Stale full-field child-set save was not rejected.'
  $passed = $true
} finally { docker rm -f $name 2>$null | Out-Null }
if ($passed) { Write-Output 'PROBE 0036 optimistic concurrency: PASS' }
