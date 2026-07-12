-- DRAFT ONLY -- Adds private, farm-scoped scouting notes, photo metadata, a
-- private Storage bucket, and receipt-idempotent save/delete RPCs after 0019.
-- The migration is additive-safe: it creates new objects and only widens the
-- existing farm_tasks.source check so the required 'scouting' source can render
-- on the board without introducing a second task model.
--
-- The SECURITY DEFINER RPCs use advisory transaction locks and never use
-- SELECT ... FOR UPDATE. This follows the 0017 lesson: invoker-visible row
-- locks can be silently filtered by RLS. Fixed search paths, explicit auth and
-- can_edit_farm gates, and farm-scoped statements keep the definer paths narrow.
--
-- Storage policies are bucket-scoped and granted only to authenticated users.
-- A CASE-guarded UUID cast makes a malformed first path segment return false
-- instead of raising or ever reaching can_access_farm/can_edit_farm.

create table public.scouting_notes (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  field_id uuid not null,
  observed_on date not null check (observed_on <= current_date + 1),
  category text not null check (category in ('weed', 'disease', 'insect', 'other')),
  note text check (note is null or char_length(note) <= 2000),
  latitude numeric(9, 6)
    check (latitude is null or latitude between -90 and 90),
  longitude numeric(9, 6)
    check (longitude is null or longitude between -180 and 180),
  -- Deliberately a plain UUID provenance stamp: retaining a scouting record
  -- must never block membership removal.
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, farm_id),
  constraint scouting_notes_field_farm_fk
    foreign key (field_id, farm_id)
    references public.fields(id, farm_id)
    on delete cascade,
  constraint scouting_notes_coordinates_complete check (
    (latitude is null and longitude is null)
    or (latitude is not null and longitude is not null)
  )
);

create table public.scouting_photos (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farms(id) on delete cascade,
  note_id uuid not null,
  storage_path text not null unique,
  -- Plain UUID provenance for the same membership-removal reason as notes.
  created_by uuid not null,
  created_at timestamptz not null default now(),
  constraint scouting_photos_note_farm_fk
    foreign key (note_id, farm_id)
    references public.scouting_notes(id, farm_id)
    on delete cascade
);

create index scouting_notes_farm_field_observed_idx
  on public.scouting_notes (farm_id, field_id, observed_on desc);
create index scouting_notes_farm_id_idx
  on public.scouting_notes (farm_id);
create index scouting_photos_farm_note_idx
  on public.scouting_photos (farm_id, note_id);

create trigger scouting_notes_set_updated_at
before update on public.scouting_notes
for each row execute function public.set_updated_at();

create trigger scouting_notes_prevent_farm_move
before update on public.scouting_notes
for each row execute function public.prevent_farm_id_change();

create trigger scouting_photos_prevent_farm_move
before update on public.scouting_photos
for each row execute function public.prevent_farm_id_change();

alter table public.scouting_notes enable row level security;
alter table public.scouting_photos enable row level security;

revoke all on table public.scouting_notes
  from public, anon, authenticated;
revoke all on table public.scouting_photos
  from public, anon, authenticated;

grant select, insert, update, delete on table public.scouting_notes
  to authenticated;
grant select, insert, update, delete on table public.scouting_photos
  to authenticated;

create policy scouting_notes_select
on public.scouting_notes for select to authenticated
using (public.can_access_farm(farm_id));

create policy scouting_notes_insert
on public.scouting_notes for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and created_by = auth.uid()
);

create policy scouting_notes_update
on public.scouting_notes for update to authenticated
using (public.can_edit_farm(farm_id))
with check (public.can_edit_farm(farm_id));

create policy scouting_notes_delete
on public.scouting_notes for delete to authenticated
using (public.can_edit_farm(farm_id));

create policy scouting_photos_select
on public.scouting_photos for select to authenticated
using (public.can_access_farm(farm_id));

create policy scouting_photos_insert
on public.scouting_photos for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and created_by = auth.uid()
);

create policy scouting_photos_update
on public.scouting_photos for update to authenticated
using (public.can_edit_farm(farm_id))
with check (public.can_edit_farm(farm_id));

create policy scouting_photos_delete
on public.scouting_photos for delete to authenticated
using (public.can_edit_farm(farm_id));

insert into storage.buckets (id, name, public)
values ('scouting-photos', 'scouting-photos', false)
on conflict do nothing;

create policy scouting_photo_objects_select
on storage.objects for select to authenticated
using (
  bucket_id = 'scouting-photos'
  and case
    when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.can_access_farm(split_part(name, '/', 1)::uuid)
    else false
  end
);

create policy scouting_photo_objects_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'scouting-photos'
  and case
    when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.can_edit_farm(split_part(name, '/', 1)::uuid)
    else false
  end
);

create policy scouting_photo_objects_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'scouting-photos'
  and case
    when split_part(name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then public.can_edit_farm(split_part(name, '/', 1)::uuid)
    else false
  end
);

-- 0016 permits only manual and service_interval task sources. Widening the
-- existing check is required for the design's board-compatible scouting task.
alter table public.farm_tasks
  drop constraint farm_tasks_source_check,
  add constraint farm_tasks_source_check
    check (source in ('manual', 'service_interval', 'scouting'));

create function public.save_scouting_note(
  p_farm_id uuid,
  p_operation_id uuid,
  p_note jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_receipt_user uuid;
  v_result jsonb;
  v_note_id uuid;
  v_field_id uuid;
  v_observed_on date;
  v_category text;
  v_note_text text;
  v_latitude numeric;
  v_longitude numeric;
  v_photos jsonb;
  v_create_task boolean := false;
  v_existing public.scouting_notes%rowtype;
  v_saved public.scouting_notes%rowtype;
  v_photo jsonb;
  v_photo_id uuid;
  v_storage_path text;
  v_path_prefix text;
  v_photo_ids uuid[] := array[]::uuid[];
  v_photo_paths text[] := array[]::text[];
  v_photos_result jsonb;
  v_task_id uuid;
  v_task_title text;
begin
  if p_farm_id is null or p_operation_id is null then
    raise exception 'farm ID and operation ID are required';
  end if;

  if v_caller is null then
    raise exception 'authentication is required';
  end if;

  if not public.can_edit_farm(p_farm_id) then
    raise exception 'you do not have permission to edit this farm';
  end if;

  if jsonb_typeof(p_note) is distinct from 'object' then
    raise exception 'scouting note must be a JSON object';
  end if;

  -- Serialize every replay before reading its durable receipt, matching 0019.
  perform pg_advisory_xact_lock(
    hashtext(p_farm_id::text),
    hashtext(p_operation_id::text)
  );

  select r.user_id, r.result
    into v_receipt_user, v_result
  from public.repository_write_receipts r
  where r.farm_id = p_farm_id
    and r.operation_id = p_operation_id;

  if found then
    if v_receipt_user <> v_caller then
      raise exception 'operation ID was already used by another user';
    end if;
    return v_result;
  end if;

  if exists (
    select 1
    from jsonb_object_keys(p_note) as k(key)
    where k.key not in (
      'id', 'field_id', 'observed_on', 'category', 'note', 'latitude',
      'longitude', 'photos', 'create_task'
    )
  ) then
    raise exception 'scouting note keys do not match the accepted contract';
  end if;

  if not (p_note ? 'field_id')
    or not (p_note ? 'observed_on')
    or not (p_note ? 'category')
    or not (p_note ? 'photos')
    or jsonb_typeof(p_note -> 'field_id') is distinct from 'string'
    or jsonb_typeof(p_note -> 'observed_on') is distinct from 'string'
    or jsonb_typeof(p_note -> 'category') is distinct from 'string'
    or jsonb_typeof(p_note -> 'photos') is distinct from 'array'
    or coalesce(jsonb_typeof(p_note -> 'id'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_note -> 'note'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_note -> 'latitude'), 'null') not in ('number', 'null')
    or coalesce(jsonb_typeof(p_note -> 'longitude'), 'null') not in ('number', 'null')
    or coalesce(jsonb_typeof(p_note -> 'create_task'), 'null') not in ('boolean', 'null')
  then
    raise exception 'scouting note fields have invalid JSON types';
  end if;

  begin
    v_note_id := nullif(p_note ->> 'id', '')::uuid;
    v_field_id := (p_note ->> 'field_id')::uuid;
    v_observed_on := (p_note ->> 'observed_on')::date;
    v_latitude := (p_note ->> 'latitude')::numeric;
    v_longitude := (p_note ->> 'longitude')::numeric;
  exception
    when invalid_text_representation
      or datetime_field_overflow
      or numeric_value_out_of_range
    then raise exception 'scouting note IDs, date, and coordinates must be valid';
  end;

  v_note_id := coalesce(v_note_id, gen_random_uuid());
  v_category := p_note ->> 'category';
  v_note_text := p_note ->> 'note';
  v_photos := p_note -> 'photos';
  v_create_task := coalesce((p_note ->> 'create_task')::boolean, false);

  if v_note_text is not null then
    v_note_text := btrim(v_note_text);
    if v_note_text = '' then
      v_note_text := null;
    end if;
  end if;

  if v_observed_on > current_date + 1 then
    raise exception 'observed date cannot be more than one day in the future';
  end if;

  if v_category not in ('weed', 'disease', 'insect', 'other') then
    raise exception 'category must be weed, disease, insect, or other';
  end if;

  if v_note_text is not null and char_length(v_note_text) > 2000 then
    raise exception 'scouting note cannot exceed 2000 characters';
  end if;

  if (v_latitude is null) <> (v_longitude is null) then
    raise exception 'latitude and longitude must both be provided or both be null';
  end if;
  if v_latitude is not null and v_latitude not between -90 and 90 then
    raise exception 'latitude must be between -90 and 90';
  end if;
  if v_longitude is not null and v_longitude not between -180 and 180 then
    raise exception 'longitude must be between -180 and 180';
  end if;

  if not exists (
    select 1
    from public.fields f
    where f.id = v_field_id
      and f.farm_id = p_farm_id
  ) then
    raise exception 'field does not belong to this farm';
  end if;

  if v_note_text is null and jsonb_array_length(v_photos) = 0 then
    raise exception 'a scouting note requires note text or at least one photo';
  end if;

  v_path_prefix := p_farm_id::text || '/' || v_field_id::text || '/'
    || v_note_id::text || '/';

  -- Distinct operation IDs targeting one note serialize without an
  -- RLS-sensitive row lock. Delete takes this same note lock.
  perform pg_advisory_xact_lock(
    hashtext('scouting-note'),
    hashtext(p_farm_id::text || ':' || v_note_id::text)
  );

  for v_photo in
    select value from jsonb_array_elements(v_photos)
  loop
    if jsonb_typeof(v_photo) is distinct from 'object' then
      raise exception 'each scouting photo must be a JSON object';
    end if;
    if exists (
      select 1
      from jsonb_object_keys(v_photo) as k(key)
      where k.key not in ('id', 'storage_path')
    )
      or not (v_photo ? 'storage_path')
      or jsonb_typeof(v_photo -> 'storage_path') is distinct from 'string'
      or coalesce(jsonb_typeof(v_photo -> 'id'), 'null') not in ('string', 'null')
    then
      raise exception 'scouting photo keys or JSON types are invalid';
    end if;

    begin
      v_photo_id := nullif(v_photo ->> 'id', '')::uuid;
    exception when invalid_text_representation then
      raise exception 'scouting photo ID must be valid';
    end;
    v_photo_id := coalesce(v_photo_id, gen_random_uuid());
    v_storage_path := v_photo ->> 'storage_path';

    if left(v_storage_path, char_length(v_path_prefix)) <> v_path_prefix
      or char_length(v_storage_path) <= char_length(v_path_prefix)
    then
      raise exception 'scouting photo path must begin with the farm, field, and note IDs';
    end if;

    if v_photo_id = any(v_photo_ids) then
      raise exception 'scouting photo IDs must be unique within a note';
    end if;
    if v_storage_path = any(v_photo_paths) then
      raise exception 'scouting photo paths must be unique within a note';
    end if;

    if exists (
      select 1
      from public.scouting_photos p
      where p.id = v_photo_id
        and (p.farm_id <> p_farm_id or p.note_id <> v_note_id)
    ) then
      raise exception 'scouting photo does not belong to this note and farm';
    end if;

    if exists (
      select 1
      from public.scouting_photos p
      where p.storage_path = v_storage_path
        and p.id <> v_photo_id
    ) then
      raise exception 'scouting photo path is already recorded';
    end if;

    v_photo_ids := array_append(v_photo_ids, v_photo_id);
    v_photo_paths := array_append(v_photo_paths, v_storage_path);
  end loop;

  select n.*
    into v_existing
  from public.scouting_notes n
  where n.id = v_note_id;

  if found then
    if v_existing.farm_id <> p_farm_id then
      raise exception 'scouting note does not belong to this farm';
    end if;

    update public.scouting_notes
    set
      field_id = v_field_id,
      observed_on = v_observed_on,
      category = v_category,
      note = v_note_text,
      latitude = v_latitude,
      longitude = v_longitude
    where id = v_note_id
      and farm_id = p_farm_id
    returning * into strict v_saved;
  else
    insert into public.scouting_notes (
      id,
      farm_id,
      field_id,
      observed_on,
      category,
      note,
      latitude,
      longitude,
      created_by
    )
    values (
      v_note_id,
      p_farm_id,
      v_field_id,
      v_observed_on,
      v_category,
      v_note_text,
      v_latitude,
      v_longitude,
      v_caller
    )
    returning * into v_saved;
  end if;

  delete from public.scouting_photos p
  where p.farm_id = p_farm_id
    and p.note_id = v_note_id
    and not (p.id = any(v_photo_ids));

  for v_photo_id, v_storage_path in
    select ids.id, paths.path
    from unnest(v_photo_ids) with ordinality as ids(id, ord)
    join unnest(v_photo_paths) with ordinality as paths(path, ord)
      using (ord)
  loop
    insert into public.scouting_photos (
      id,
      farm_id,
      note_id,
      storage_path,
      created_by
    )
    values (
      v_photo_id,
      p_farm_id,
      v_note_id,
      v_storage_path,
      v_caller
    )
    on conflict (id) do update
    set storage_path = excluded.storage_path
    where public.scouting_photos.farm_id = excluded.farm_id
      and public.scouting_photos.note_id = excluded.note_id;

    if not found then
      raise exception 'scouting photo ID was concurrently used by another note';
    end if;
  end loop;

  if v_create_task then
    v_task_title := initcap(v_category) || ': '
      || left(coalesce(v_note_text, 'photo follow-up'), 480);

    insert into public.farm_tasks (
      farm_id,
      title,
      priority,
      field_id,
      source,
      created_by
    )
    values (
      p_farm_id,
      v_task_title,
      'normal',
      v_field_id,
      'scouting',
      v_caller
    )
    returning id into v_task_id;
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(p) order by p.created_at, p.id),
    '[]'::jsonb
  )
    into v_photos_result
  from public.scouting_photos p
  where p.farm_id = p_farm_id
    and p.note_id = v_note_id;

  v_result := to_jsonb(v_saved)
    || jsonb_build_object('photos', v_photos_result);
  if v_task_id is not null then
    v_result := v_result || jsonb_build_object('created_task_id', v_task_id);
  end if;

  insert into public.repository_write_receipts (
    farm_id,
    operation_id,
    user_id,
    result
  )
  values (
    p_farm_id,
    p_operation_id,
    v_caller,
    v_result
  );

  return v_result;
end;
$$;

create function public.delete_scouting_note(
  p_farm_id uuid,
  p_note_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_storage_paths jsonb := '[]'::jsonb;
begin
  if p_farm_id is null or p_note_id is null then
    raise exception 'farm ID and scouting note ID are required';
  end if;

  if v_caller is null then
    raise exception 'authentication is required';
  end if;

  if not public.can_edit_farm(p_farm_id) then
    raise exception 'you do not have permission to edit this farm';
  end if;

  perform pg_advisory_xact_lock(
    hashtext('scouting-note'),
    hashtext(p_farm_id::text || ':' || p_note_id::text)
  );

  select coalesce(jsonb_agg(p.storage_path order by p.storage_path), '[]'::jsonb)
    into v_storage_paths
  from public.scouting_photos p
  where p.farm_id = p_farm_id
    and p.note_id = p_note_id;

  -- Farm scoping makes an absent ID and another farm's ID indistinguishable.
  delete from public.scouting_notes
  where id = p_note_id
    and farm_id = p_farm_id;

  return jsonb_build_object(
    'id', p_note_id,
    'deleted', true,
    'storage_paths', v_storage_paths
  );
end;
$$;

revoke all on function public.save_scouting_note(uuid, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.delete_scouting_note(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.save_scouting_note(uuid, uuid, jsonb)
  to authenticated;
grant execute on function public.delete_scouting_note(uuid, uuid)
  to authenticated;
