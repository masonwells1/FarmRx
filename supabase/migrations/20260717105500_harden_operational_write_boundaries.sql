-- Close operational write paths that were still available to read-only farm
-- members, and keep Program task ownership plus service-meter provenance behind
-- their canonical RPCs.

drop policy if exists equipment_meter_readings_insert
  on public.equipment_meter_readings;
create policy equipment_meter_readings_insert
on public.equipment_meter_readings for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and source = 'manual'
  and created_by = auth.uid()
);

drop policy if exists equipment_service_log_insert
  on public.equipment_service_log;
create policy equipment_service_log_insert
on public.equipment_service_log for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and created_by = auth.uid()
);

drop policy if exists farm_tasks_insert on public.farm_tasks;
create policy farm_tasks_insert
on public.farm_tasks for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and created_by = auth.uid()
);

drop policy if exists farm_tasks_update on public.farm_tasks;
create policy farm_tasks_update
on public.farm_tasks for update to authenticated
using (public.can_edit_farm(farm_id))
with check (public.can_edit_farm(farm_id));

-- The earlier status-only backstop could be bypassed by first downgrading a
-- Program task to manual. Program tasks are projections of Season progress, so
-- direct application-role writes must not create, edit, downgrade, or delete
-- them. Program RPCs are SECURITY DEFINER and execute as the table owner.
drop trigger if exists farm_tasks_program_status_backstop
  on public.farm_tasks;
drop function if exists public.reject_direct_program_task_status_change();
drop trigger if exists assigned_program_passes_enable_task_status_change
  on public.assigned_program_passes;
drop function if exists public.enable_program_task_status_change();

create function public.protect_program_task_provenance()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_table_owner name;
  v_program_write boolean := false;
begin
  select pg_catalog.pg_get_userbyid(c.relowner)::name
  into v_table_owner
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = 'farm_tasks'
    and c.relkind in ('r', 'p');

  if v_table_owner is null then
    raise exception 'PROGRAM_TASK_GUARD_OWNER_NOT_FOUND';
  end if;

  if tg_op = 'INSERT' then
    v_program_write := new.source = 'program';
  elsif tg_op = 'UPDATE' then
    v_program_write := old.source = 'program' or new.source = 'program';
  elsif tg_op = 'DELETE' then
    v_program_write := old.source = 'program';
  end if;

  if v_program_write and current_user::name is distinct from v_table_owner then
    raise exception 'PROGRAM_TASK_MANAGED_BY_PROGRAM';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_program_task_provenance()
  from public, anon, authenticated;

create trigger farm_tasks_program_provenance_backstop
before insert or update or delete on public.farm_tasks
for each row execute function public.protect_program_task_provenance();

-- Only the public service RPC may call the core writer and exact linker. The
-- wrapper is now a hardened definer because the private schema is intentionally
-- unavailable to the Data API role; it therefore repeats authentication and
-- edit-permission checks before touching any row.
alter function private.save_service_log_entry_core(uuid, jsonb, uuid)
  set search_path = '';
revoke all on function private.save_service_log_entry_core(uuid, jsonb, uuid)
  from public, anon, authenticated;
revoke all on function private.link_service_log_meter_reading(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on schema private from public, anon, authenticated;

create or replace function public.save_service_log_entry(
  p_farm_id uuid,
  p_log jsonb,
  p_reading_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_log_id uuid;
  v_log_existed boolean := false;
  v_reading_existed boolean := false;
  v_exact_link_existed boolean := false;
  v_interval_id uuid;
  v_interval_completion jsonb;
  v_interval_reading jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication is required';
  end if;
  if p_farm_id is null or not public.can_edit_farm(p_farm_id) then
    raise exception 'you do not have permission to edit this farm';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_farm_id::text, 0)
  );
  if jsonb_typeof(p_log) is distinct from 'object' then
    raise exception 'service entry must be a JSON object';
  end if;

  begin
    v_log_id := (p_log ->> 'id')::uuid;
  exception when invalid_text_representation then
    raise exception 'service entry IDs and date must be valid';
  end;

  if v_log_id is null then
    raise exception 'service entry IDs and date must be valid';
  end if;

  select exists (
    select 1
    from public.equipment_service_log l
    where l.id = v_log_id
  ) into v_log_existed;

  if p_reading_id is not null then
    select exists (
      select 1
      from public.equipment_meter_readings r
      where r.id = p_reading_id
    ) into v_reading_existed;

    select exists (
      select 1
      from public.service_log_meter_readings p
      where p.service_log_id = v_log_id
        and p.meter_reading_id = p_reading_id
    ) into v_exact_link_existed;

    if (v_log_existed or v_reading_existed) and not v_exact_link_existed then
      raise exception 'SERVICE_LOG_HISTORICAL_PROVENANCE_UNPROVEN';
    end if;
  end if;

  v_result := private.save_service_log_entry_core(
    p_farm_id,
    p_log,
    p_reading_id
  );

  if p_reading_id is not null then
    perform private.link_service_log_meter_reading(
      p_farm_id,
      (v_result -> 'log' ->> 'id')::uuid,
      p_reading_id
    );
  end if;

  v_interval_id := (v_result -> 'log' ->> 'interval_id')::uuid;
  if v_interval_id is not null then
    select jsonb_build_object(
      'service_log_id', l.id,
      'service_date', l.service_date
    )
    into v_interval_completion
    from public.equipment_service_log l
    where l.farm_id = p_farm_id
      and l.interval_id = v_interval_id
    order by l.service_date desc, l.created_at desc, l.id desc
    limit 1;

    select jsonb_build_object(
      'service_log_id', l.id,
      'meter_reading', l.meter_reading
    )
    into v_interval_reading
    from public.equipment_service_log l
    where l.farm_id = p_farm_id
      and l.interval_id = v_interval_id
      and l.meter_reading is not null
    order by l.service_date desc, l.created_at desc, l.id desc
    limit 1;
  end if;

  return v_result || jsonb_build_object(
    'interval_completion', v_interval_completion,
    'interval_reading', v_interval_reading
  );
end;
$$;

revoke all on function public.save_service_log_entry(uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.save_service_log_entry(uuid, jsonb, uuid)
  to authenticated;
