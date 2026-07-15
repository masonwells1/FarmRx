$ErrorActionPreference = 'Stop'
$name = "farmrx-0033-$PID"
$root = Split-Path -Parent $PSScriptRoot
$bootstrap = @'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create schema storage;
create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid);
alter table storage.objects enable row level security;
'@

try {
  docker run --rm -d --name $name -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=farmrx_disposable postgres:16 | Out-Null
  $ready = $false
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    if ((docker exec $name sh -c 'grep -qx postgres /proc/1/comm && pg_isready -U postgres -d farmrx_disposable' 2>$null) -match 'accepting connections') { $ready = $true; break }
    Start-Sleep -Milliseconds 500
  }
  if (!$ready) { throw 'Disposable postgres:16 did not become ready.' }
  function Invoke-DisposablePsql([string]$sql) {
    $sql | docker exec -i $name psql -q -v ON_ERROR_STOP=1 -U postgres -d farmrx_disposable
    if ($LASTEXITCODE -ne 0) { throw 'Disposable psql failed.' }
  }
  Invoke-DisposablePsql $bootstrap
  Get-ChildItem (Join-Path $root 'supabase/migrations') -Filter '*.sql' | Sort-Object Name | ForEach-Object {
    Invoke-DisposablePsql (Get-Content -Raw $_.FullName)
  }
  $seed = @'
insert into auth.users (id, email) values ('11111111-1111-4111-8111-111111111111', 'tester@example.test');
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
insert into public.farms (id, name, created_by) values ('22222222-2222-4222-8222-222222222222', 'Disposable Farm', '11111111-1111-4111-8111-111111111111');
insert into public.farm_memberships (farm_id, user_id, role, status) values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'owner', 'active') on conflict do nothing;
insert into public.grain_bins (id, farm_id, name, capacity_bu, location_type) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '22222222-2222-4222-8222-222222222222', 'A', 1000, 'on_farm'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '22222222-2222-4222-8222-222222222222', 'B', 1000, 'on_farm'),
  ('abababab-abab-4aba-8aba-abababababab', '22222222-2222-4222-8222-222222222222', 'C', 1000, 'on_farm');
insert into public.bin_inventory (id, farm_id, grain_bin_id, crop_year, commodity_id, bushels, committed_bushels, measured_at) values
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 2026, 'corn_yellow', 600, 0, '2026-07-01T12:00:00Z'),
  ('cdcdcdcd-cdcd-4cdc-8cdc-cdcdcdcdcdcd', '22222222-2222-4222-8222-222222222222', 'abababab-abab-4aba-8aba-abababababab', 2026, 'corn_yellow', 600, 0, '2026-07-01T12:00:00Z');
insert into public.bin_transactions (id, farm_id, grain_bin_id, direction, bushels, commodity_id, occurred_on) values
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '22222222-2222-4222-8222-222222222222', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'in', 200, 'corn_yellow', '2026-07-02'),
  ('a1111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'in', 500, 'soybeans', '2026-06-30');
insert into public.grain_contracts (id, farm_id, crop_year, commodity_id, operating_entity_id, enterprise_label, contract_type, buyer, bushels, futures_price, basis, cash_price, premium_cents_per_bu) values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', '22222222-2222-4222-8222-222222222222', 2026, 'corn_yellow', null, null, 'hta', 'Buyer', 100, 5, null, null, 0);
'@
  Invoke-DisposablePsql $seed
  $probes = @'
set role authenticated;
set request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
do $$ declare v_soy_balance numeric; begin
  begin
    perform public.append_bin_movement('22222222-2222-4222-8222-222222222222', '{"id":"a2222222-2222-4222-8222-222222222222","grain_bin_id":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","direction":"in","bushels":400,"commodity_id":"corn_yellow","occurred_on":"2026-07-02"}'::jsonb);
    raise exception 'same-bin pre-baseline other-commodity capacity accepted';
  exception when others then
    if position('more grain in the bin' in sqlerrm) = 0 then raise; end if;
    raise notice 'PROBE same-bin pre-baseline other-commodity capacity rejected: %', sqlerrm;
  end;
  select coalesce(sum(case when direction = 'in' then bushels else -bushels end), 0) into v_soy_balance from public.bin_transactions where grain_bin_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and commodity_id = 'soybeans';
  if v_soy_balance <> 500 then raise exception 'same-bin soybean active lot was not retained: %', v_soy_balance; end if;
  raise notice 'PROBE same-bin pre-baseline soybean active nonzero: % bu', v_soy_balance;
end $$;
do $$ begin
  begin
    perform public.append_bin_movement('22222222-2222-4222-8222-222222222222', '{"id":"f1111111-1111-4111-8111-111111111111","grain_bin_id":"abababab-abab-4aba-8aba-abababababab","direction":"in","bushels":1,"commodity_id":"soybeans","occurred_on":"2026-07-02"}'::jsonb);
    raise exception 'soybean was accepted';
  exception when others then
    if position('nonzero lots: corn_yellow' in sqlerrm) = 0 then raise; end if;
    raise notice 'PROBE cross-bin soybean rejection: %', sqlerrm;
  end;
end $$;
select public.append_bin_movement('22222222-2222-4222-8222-222222222222', '{"id":"f2222222-2222-4222-8222-222222222222","grain_bin_id":"abababab-abab-4aba-8aba-abababababab","direction":"in","bushels":100,"commodity_id":"corn_yellow","occurred_on":"2026-07-02"}'::jsonb)->>'id' as movement_first;
select public.append_bin_movement('22222222-2222-4222-8222-222222222222', '{"id":"f2222222-2222-4222-8222-222222222222","grain_bin_id":"abababab-abab-4aba-8aba-abababababab","direction":"in","bushels":100,"commodity_id":"corn_yellow","occurred_on":"2026-07-02"}'::jsonb)->>'id' as movement_replay;
select count(*) as movement_rows, 600 + coalesce(sum(case when direction = 'in' then bushels else -bushels end), 0) as bin_c_corn_balance from public.bin_transactions where grain_bin_id = 'abababab-abab-4aba-8aba-abababababab' and commodity_id = 'corn_yellow';
do $$ begin
  if (select count(*) from public.bin_transactions where id = 'f2222222-2222-4222-8222-222222222222') <> 1 then raise exception 'movement sequential replay inserted more than one row'; end if;
  raise notice 'PROBE movement sequential replay: same row';
end $$;
do $$ begin
  begin
    update public.grain_contracts set basis = -0.20, cash_price = 4.80 where id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    raise exception 'direct price update was accepted';
  exception when others then
    if position('only be finalized through the price-finalization action' in sqlerrm) = 0 then raise; end if;
    raise notice 'PROBE direct pricing UPDATE rejected: %', sqlerrm;
  end;
end $$;
select (public.finalize_contract_price_leg('22222222-2222-4222-8222-222222222222', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'basis', -0.20)->>'cash_price') as rpc_cash_price;
do $$ begin
  begin insert into public.bin_transactions (id, farm_id, grain_bin_id, direction, bushels, commodity_id, occurred_on) values ('f3333333-3333-4333-8333-333333333333', '22222222-2222-4222-8222-222222222222', 'abababab-abab-4aba-8aba-abababababab', 'in', 1, 'corn_yellow', '2026-07-03'); raise exception 'direct insert was accepted'; exception when insufficient_privilege then raise notice 'PROBE direct INSERT revoked: %', sqlerrm; end;
end $$;
do $$ begin
  begin perform public.append_bin_movement('22222222-2222-4222-8222-222222222222', '{"id":"f4444444-4444-4444-8444-444444444444","grain_bin_id":"abababab-abab-4aba-8aba-abababababab","direction":"out","bushels":701,"commodity_id":"corn_yellow","occurred_on":"2026-07-03"}'::jsonb); raise exception 'negative accepted'; exception when others then if position('balance negative' in sqlerrm) = 0 then raise; end if; raise notice 'PROBE negative rejected: %', sqlerrm; end;
  begin perform public.append_bin_movement('22222222-2222-4222-8222-222222222222', '{"id":"f5555555-5555-4555-8555-555555555555","grain_bin_id":"abababab-abab-4aba-8aba-abababababab","direction":"in","bushels":401,"commodity_id":"corn_yellow","occurred_on":"2026-07-03"}'::jsonb); raise exception 'capacity accepted'; exception when others then if position('more grain in the bin' in sqlerrm) = 0 then raise; end if; raise notice 'PROBE capacity rejected: %', sqlerrm; end;
  begin perform public.finalize_contract_price_leg('22222222-2222-4222-8222-222222222222', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'basis', -0.21); raise exception 'second CAS accepted'; exception when others then if position('already finalized' in sqlerrm) = 0 then raise; end if; raise notice 'PROBE CAS already-finalized rejected: %', sqlerrm; end;
end $$;
select public.append_bin_movement('22222222-2222-4222-8222-222222222222', '{"id":"f6666666-6666-4666-8666-666666666666","grain_bin_id":"abababab-abab-4aba-8aba-abababababab","direction":"out","bushels":700,"commodity_id":"corn_yellow","occurred_on":"2026-07-03"}'::jsonb)->>'id' as rotation_empty_corn;
select public.append_bin_movement('22222222-2222-4222-8222-222222222222', '{"id":"f7777777-7777-4777-8777-777777777777","grain_bin_id":"abababab-abab-4aba-8aba-abababababab","direction":"in","bushels":50,"commodity_id":"soybeans","occurred_on":"2026-07-03"}'::jsonb)->>'id' as rotation_store_soybeans;
select public.record_grain_contract_delivery('22222222-2222-4222-8222-222222222222', '{"id":"f8888888-8888-4888-8888-888888888888","grain_contract_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","bushels":60,"delivered_on":"2026-07-03"}'::jsonb)->>'id' as delivery_first;
select public.record_grain_contract_delivery('22222222-2222-4222-8222-222222222222', '{"id":"f8888888-8888-4888-8888-888888888888","grain_contract_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","bushels":60,"delivered_on":"2026-07-03"}'::jsonb)->>'id' as delivery_replay;
do $$ begin
  if (select count(*) from public.grain_contract_deliveries where id = 'f8888888-8888-4888-8888-888888888888') <> 1 then raise exception 'delivery sequential replay inserted more than one row'; end if;
  raise notice 'PROBE delivery sequential replay: same row';
end $$;
do $$ begin
  begin perform public.record_grain_contract_delivery('22222222-2222-4222-8222-222222222222', '{"id":"f9999999-9999-4999-8999-999999999999","grain_contract_id":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","bushels":50,"delivered_on":"2026-07-03"}'::jsonb); raise exception 'overdelivery accepted'; exception when others then if position('would exceed the remaining contract bushels' in sqlerrm) = 0 then raise; end if; raise notice 'PROBE overdelivery rejected: %', sqlerrm; end;
end $$;
select count(*) as delivery_rows from public.grain_contract_deliveries where grain_contract_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
reset role;
'@
  Invoke-DisposablePsql $probes
  Write-Output 'PROBE disposable migration suite: PASS'
} finally {
  docker rm -f $name 2>$null | Out-Null
}
