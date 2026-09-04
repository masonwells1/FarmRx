-- SRX-1 Soil Rx storage. Soil tests remain farm-scoped and private by default;
-- named Crop RX reps can read only when the existing farm share toggle and
-- explicit rep grant both make can_access_farm(farm_id) true.

create table public.soil_tests (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  field_id uuid not null,
  sample_date date not null check (sample_date between date '1900-01-01' and date '2200-12-31'),
  lab_name text not null check (length(btrim(lab_name)) between 1 and 160),
  ph numeric(5, 3) check (ph is null or ph between 0 and 14),
  organic_matter_pct numeric(6, 3) check (organic_matter_pct is null or organic_matter_pct between 0 and 100),
  cec_meq_100g numeric(8, 3) check (cec_meq_100g is null or cec_meq_100g between 0 and 500),
  phosphorus_ppm numeric(10, 3) check (phosphorus_ppm is null or phosphorus_ppm between 0 and 1000000),
  potassium_ppm numeric(10, 3) check (potassium_ppm is null or potassium_ppm between 0 and 1000000),
  calcium_ppm numeric(10, 3) check (calcium_ppm is null or calcium_ppm between 0 and 1000000),
  magnesium_ppm numeric(10, 3) check (magnesium_ppm is null or magnesium_ppm between 0 and 1000000),
  sulfur_ppm numeric(10, 3) check (sulfur_ppm is null or sulfur_ppm between 0 and 1000000),
  base_saturation_calcium_pct numeric(6, 3) check (base_saturation_calcium_pct is null or base_saturation_calcium_pct between 0 and 100),
  base_saturation_magnesium_pct numeric(6, 3) check (base_saturation_magnesium_pct is null or base_saturation_magnesium_pct between 0 and 100),
  base_saturation_potassium_pct numeric(6, 3) check (base_saturation_potassium_pct is null or base_saturation_potassium_pct between 0 and 100),
  base_saturation_sodium_pct numeric(6, 3) check (base_saturation_sodium_pct is null or base_saturation_sodium_pct between 0 and 100),
  base_saturation_hydrogen_pct numeric(6, 3) check (base_saturation_hydrogen_pct is null or base_saturation_hydrogen_pct between 0 and 100),
  -- Micronutrients use typed, bounded columns instead of free-form JSON so
  -- unsupported keys and non-numeric values cannot enter the record.
  boron_ppm numeric(10, 3) check (boron_ppm is null or boron_ppm between 0 and 1000000),
  chloride_ppm numeric(10, 3) check (chloride_ppm is null or chloride_ppm between 0 and 1000000),
  copper_ppm numeric(10, 3) check (copper_ppm is null or copper_ppm between 0 and 1000000),
  iron_ppm numeric(10, 3) check (iron_ppm is null or iron_ppm between 0 and 1000000),
  manganese_ppm numeric(10, 3) check (manganese_ppm is null or manganese_ppm between 0 and 1000000),
  molybdenum_ppm numeric(10, 3) check (molybdenum_ppm is null or molybdenum_ppm between 0 and 1000000),
  zinc_ppm numeric(10, 3) check (zinc_ppm is null or zinc_ppm between 0 and 1000000),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id, field_id),
  constraint soil_tests_field_same_farm_fk
    foreign key (field_id, farm_id)
    references public.fields(id, farm_id)
    on delete cascade
);

create table public.soil_test_attachments (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  field_id uuid not null,
  test_id uuid not null unique,
  storage_path text not null unique check (length(storage_path) between 1 and 1024),
  original_filename text not null check (length(btrim(original_filename)) between 1 and 255),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif')),
  size_bytes integer not null check (size_bytes > 0 and size_bytes <= 20971520),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint soil_test_attachments_test_same_scope_fk
    foreign key (test_id, farm_id, field_id)
    references public.soil_tests(id, farm_id, field_id)
    on delete cascade,
  constraint soil_test_attachment_path_matches_scope check (
    split_part(storage_path, '/', 1) = farm_id::text
    and split_part(storage_path, '/', 2) = field_id::text
    and split_part(storage_path, '/', 3) = test_id::text
    and split_part(storage_path, '/', 4) not in ('', '.', '..')
    and split_part(storage_path, '/', 5) = ''
  )
);

create index soil_tests_farm_field_sample_idx
  on public.soil_tests (farm_id, field_id, sample_date desc, created_at desc, id);
create index soil_tests_field_farm_idx on public.soil_tests (field_id, farm_id);
create index soil_tests_created_by_idx on public.soil_tests (created_by);
create index soil_test_attachments_farm_field_test_idx
  on public.soil_test_attachments (farm_id, field_id, test_id);
create index soil_test_attachments_test_farm_field_idx
  on public.soil_test_attachments (test_id, farm_id, field_id);
create index soil_test_attachments_field_farm_idx
  on public.soil_test_attachments (field_id, farm_id);
create index soil_test_attachments_created_by_idx on public.soil_test_attachments (created_by);

create function public.prevent_soil_test_identity_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
    or new.farm_id is distinct from old.farm_id
    or new.field_id is distinct from old.field_id
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'soil test identity cannot be changed';
  end if;
  return new;
end;
$$;

create function public.prevent_soil_test_attachment_identity_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.id is distinct from old.id
    or new.farm_id is distinct from old.farm_id
    or new.field_id is distinct from old.field_id
    or new.test_id is distinct from old.test_id
    or new.storage_path is distinct from old.storage_path
    or new.created_by is distinct from old.created_by
    or new.created_at is distinct from old.created_at then
    raise exception 'soil test attachment identity cannot be changed';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_soil_test_identity_change() from public, anon, authenticated;
revoke all on function public.prevent_soil_test_attachment_identity_change() from public, anon, authenticated;

create trigger soil_tests_set_updated_at
before update on public.soil_tests
for each row execute function public.set_updated_at();
create trigger soil_tests_prevent_identity_change
before update on public.soil_tests
for each row execute function public.prevent_soil_test_identity_change();
create trigger soil_test_attachments_prevent_identity_change
before update on public.soil_test_attachments
for each row execute function public.prevent_soil_test_attachment_identity_change();

create trigger farm_access_epoch_guard
before insert or update or delete on public.soil_tests
for each row execute function public.guard_row_farm_access_epoch();
create trigger farm_access_epoch_guard
before insert or update or delete on public.soil_test_attachments
for each row execute function public.guard_row_farm_access_epoch();

alter table public.soil_tests enable row level security;
alter table public.soil_test_attachments enable row level security;

revoke all on table public.soil_tests from public, anon, authenticated;
revoke all on table public.soil_test_attachments from public, anon, authenticated;
grant select, insert, update, delete on table public.soil_tests to authenticated;
grant select, insert, delete on table public.soil_test_attachments to authenticated;

create policy soil_tests_select
on public.soil_tests for select to authenticated
using (public.can_access_farm(farm_id));
create policy soil_tests_insert
on public.soil_tests for insert to authenticated
with check (public.can_edit_farm(farm_id) and created_by = (select auth.uid()));
create policy soil_tests_update
on public.soil_tests for update to authenticated
using (public.can_edit_farm(farm_id))
with check (public.can_edit_farm(farm_id));
create policy soil_tests_delete
on public.soil_tests for delete to authenticated
using (public.can_edit_farm(farm_id));

create policy soil_test_attachments_select
on public.soil_test_attachments for select to authenticated
using (public.can_access_farm(farm_id));
create policy soil_test_attachments_insert
on public.soil_test_attachments for insert to authenticated
with check (public.can_edit_farm(farm_id) and created_by = (select auth.uid()));
create policy soil_test_attachments_delete
on public.soil_test_attachments for delete to authenticated
using (public.can_edit_farm(farm_id));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'soil-test-reports',
  'soil-test-reports',
  false,
  20971520,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif']
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- The existing Storage epoch trigger delegates to this public function. Add
-- the private Soil Rx bucket so a stale browser cannot upload or remove a
-- report after its farm access changes.
create or replace function public.guard_storage_object_farm_access_epoch()
returns trigger
language plpgsql
security definer
set search_path = public, storage, pg_temp
as $$
declare
  v_row jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  v_bucket text := v_row ->> 'bucket_id';
  v_farm_text text := split_part(v_row ->> 'name', '/', 1);
  v_old_row jsonb;
  v_old_bucket text;
  v_old_farm_text text;
begin
  if tg_op = 'UPDATE' then
    v_old_row := to_jsonb(old);
    v_old_bucket := v_old_row ->> 'bucket_id';
    v_old_farm_text := split_part(v_old_row ->> 'name', '/', 1);
    if v_old_bucket in ('farm-rx', 'scouting-photos', 'soil-test-reports') then
      if v_old_farm_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
        raise exception using errcode = 'P0001', message = 'FARM_ACCESS_EPOCH_CHANGED';
      end if;
      perform public.assert_current_farm_access_epoch(v_old_farm_text::uuid);
    end if;
  end if;
  if v_bucket in ('farm-rx', 'scouting-photos', 'soil-test-reports') then
    if v_farm_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      raise exception using errcode = 'P0001', message = 'FARM_ACCESS_EPOCH_CHANGED';
    end if;
    perform public.assert_current_farm_access_epoch(v_farm_text::uuid);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- Object paths are farm_id/field_id/test_id/random-filename.ext. Each policy
-- checks all three UUIDs against an existing soil row, so a valid farm prefix
-- alone cannot cross a field or test boundary.
create policy soil_test_report_objects_select
on storage.objects for select to authenticated
using (
  bucket_id = 'soil-test-reports'
  and split_part(name, '/', 4) not in ('', '.', '..')
  and split_part(name, '/', 5) = ''
  and exists (
    select 1
    from public.soil_tests t
    where t.farm_id::text = split_part(name, '/', 1)
      and t.field_id::text = split_part(name, '/', 2)
      and t.id::text = split_part(name, '/', 3)
      and public.can_access_farm(t.farm_id)
  )
);

create policy soil_test_report_objects_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'soil-test-reports'
  and split_part(name, '/', 4) not in ('', '.', '..')
  and split_part(name, '/', 5) = ''
  and exists (
    select 1
    from public.soil_tests t
    where t.farm_id::text = split_part(name, '/', 1)
      and t.field_id::text = split_part(name, '/', 2)
      and t.id::text = split_part(name, '/', 3)
      and public.can_edit_farm(t.farm_id)
  )
);

create policy soil_test_report_objects_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'soil-test-reports'
  and split_part(name, '/', 4) not in ('', '.', '..')
  and split_part(name, '/', 5) = ''
  and exists (
    select 1
    from public.soil_tests t
    where t.farm_id::text = split_part(name, '/', 1)
      and t.field_id::text = split_part(name, '/', 2)
      and t.id::text = split_part(name, '/', 3)
      and public.can_edit_farm(t.farm_id)
  )
);

-- A retry after a committed delete can receive no delete receipt if the first
-- response was lost. These narrow postcondition checks distinguish that case
-- from an RLS-hidden row/object without broadening delete authority.
create function public.verify_soil_test_absent(p_farm_id uuid, p_test_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_current_farm_access_epoch(p_farm_id);
  if auth.uid() is null or not public.can_edit_farm(p_farm_id) then
    raise exception using errcode = '42501', message = 'soil test absence verification requires current farm edit access';
  end if;
  return not exists (
    select 1 from public.soil_tests test
    where test.farm_id = p_farm_id and test.id = p_test_id
  );
end;
$$;

create function public.verify_soil_report_objects_absent(p_farm_id uuid, p_paths text[])
returns table(name text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.assert_current_farm_access_epoch(p_farm_id);
  if auth.uid() is null or not public.can_edit_farm(p_farm_id) then
    raise exception using errcode = '42501', message = 'soil report absence verification requires current farm edit access';
  end if;
  if p_paths is null or cardinality(p_paths) < 1 or cardinality(p_paths) > 100
    or (select count(distinct requested.path) from unnest(p_paths) requested(path)) <> cardinality(p_paths)
    or exists (
      select 1 from unnest(p_paths) requested(path)
      where requested.path is null
        or split_part(requested.path, '/', 1) <> p_farm_id::text
        or split_part(requested.path, '/', 4) in ('', '.', '..')
        or split_part(requested.path, '/', 5) <> ''
    )
  then
    raise exception using errcode = '22023', message = 'invalid Soil report absence verification request';
  end if;
  -- This function never deletes an object.  A matching Soil test is required
  -- by Storage RLS for deletion, but a failed first save has no test yet.  In
  -- that narrow case an editor may still prove that the structurally farm-bound
  -- path is absent and release its durable local cleanup record.
  return query
  select requested.path
  from unnest(p_paths) requested(path)
  where not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'soil-test-reports' and object.name = requested.path
  )
  order by requested.path;
end;
$$;

revoke all on function public.verify_soil_test_absent(uuid, uuid),
  public.verify_soil_report_objects_absent(uuid, text[])
from public, anon, authenticated, service_role;
grant execute on function public.verify_soil_test_absent(uuid, uuid),
  public.verify_soil_report_objects_absent(uuid, text[])
to authenticated;
