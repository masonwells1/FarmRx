-- CW-2: an explicitly confirmed, exact Program product match may participate
-- in Inventory accounting. The Program pass, immutable match facts, and replay
-- receipt are committed by one transaction; the legacy no-match path remains
-- the default.

create table public.program_inventory_matches (
  farm_id uuid not null references public.farms(id) on delete cascade,
  assigned_product_id uuid not null,
  inventory_product_id uuid not null,
  quantity_in_inventory_unit numeric not null
    check (
      quantity_in_inventory_unit > 0
      and quantity_in_inventory_unit <= 10000000
      and quantity_in_inventory_unit = round(quantity_in_inventory_unit, 8)
    ),
  inventory_product_name_snapshot text not null
    check (char_length(btrim(inventory_product_name_snapshot)) between 1 and 200),
  inventory_unit_snapshot public.inventory_quantity_unit not null,
  operation_id uuid not null,
  confirmed_by uuid not null,
  confirmed_at timestamptz not null default now(),
  primary key (farm_id, assigned_product_id),
  constraint program_inventory_matches_assigned_product_same_farm_fk
    foreign key (assigned_product_id, farm_id)
    references public.assigned_program_pass_products(id, farm_id)
    on delete restrict,
  constraint program_inventory_matches_inventory_product_same_farm_fk
    foreign key (inventory_product_id, farm_id)
    references public.inventory_products(id, farm_id)
    on delete restrict
);

create index program_inventory_matches_farm_product_idx
  on public.program_inventory_matches
  (farm_id, inventory_product_id, assigned_product_id);

alter table public.program_inventory_matches enable row level security;
revoke all on table public.program_inventory_matches
  from public, anon, authenticated;
grant select on table public.program_inventory_matches to authenticated;

create policy program_inventory_matches_select
on public.program_inventory_matches
for select
to authenticated
using ((select public.can_access_farm(farm_id)));

-- This table postdates the generic 0040 trigger sweep, so it receives the
-- access-epoch fence explicitly. API roles have no INSERT/UPDATE/DELETE grant
-- or policy; the owning RPC is the sole writer and never updates or deletes.
create trigger farm_access_epoch_guard
before insert or update or delete on public.program_inventory_matches
for each row execute function public.guard_row_farm_access_epoch();

-- A confirmed Program match is Inventory ledger history too. Preserve the
-- existing unit guard and extend it so a later catalog edit cannot relabel an
-- already-confirmed Program quantity.
create or replace function public.protect_inventory_product_unit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.inventory_unit is distinct from old.inventory_unit
    and (
      exists (
        select 1 from public.inventory_receipt_lines receipt_line
        where receipt_line.product_id = old.id
          and receipt_line.farm_id = old.farm_id
      )
      or exists (
        select 1 from public.inventory_adjustments adjustment
        where adjustment.product_id = old.id
          and adjustment.farm_id = old.farm_id
      )
      or exists (
        select 1 from public.application_products application_product
        where application_product.product_id = old.id
          and application_product.farm_id = old.farm_id
      )
      or exists (
        select 1 from public.program_inventory_matches program_match
        where program_match.inventory_product_id = old.id
          and program_match.farm_id = old.farm_id
      )
    ) then
    raise exception 'inventory unit cannot change after a product has ledger history';
  end if;
  return new;
end;
$$;

create or replace view public.inventory_on_hand
with (security_invoker = true)
as
with received as (
  select
    rl.farm_id,
    rl.product_id,
    sum(rl.quantity_in_inventory_unit) as received_quantity,
    sum(rl.quantity_in_inventory_unit * coalesce(rl.unit_cost_per_inventory_unit, 0))
      as known_receipt_cost,
    sum(rl.quantity_in_inventory_unit) filter (where rl.unit_cost_per_inventory_unit is not null)
      as costed_receipt_quantity
  from public.inventory_receipt_lines rl
  join public.inventory_receipts r
    on r.id = rl.receipt_id and r.farm_id = rl.farm_id
  where r.status = 'received'
  group by rl.farm_id, rl.product_id
), adjusted as (
  select ia.farm_id, ia.product_id,
    sum(ia.adjustment_quantity_in_inventory_unit) as adjusted_quantity
  from public.inventory_adjustments ia
  group by ia.farm_id, ia.product_id
), used_lines as (
  select ap.farm_id, ap.product_id,
    ap.quantity_in_inventory_unit
  from public.application_products ap
  join public.effective_application_records ear
    on ear.id = ap.application_id and ear.farm_id = ap.farm_id
  union all
  select match.farm_id, match.inventory_product_id as product_id,
    match.quantity_in_inventory_unit
  from public.program_inventory_matches match
  join public.assigned_program_pass_products assigned_product
    on assigned_product.id = match.assigned_product_id
    and assigned_product.farm_id = match.farm_id
  join public.assigned_program_passes assigned_pass
    on assigned_pass.id = assigned_product.assigned_pass_id
    and assigned_pass.farm_id = assigned_product.farm_id
  where assigned_pass.status = 'applied'
    and assigned_pass.application_record_id is null
), used as (
  select farm_id, product_id, sum(quantity_in_inventory_unit) as used_quantity
  from used_lines
  group by farm_id, product_id
)
select
  p.id as product_id,
  p.farm_id,
  p.product_kind,
  p.name,
  p.inventory_unit,
  coalesce(r.received_quantity, 0)::numeric(24, 8) as received_quantity,
  coalesce(a.adjusted_quantity, 0)::numeric(24, 8) as adjusted_quantity,
  coalesce(u.used_quantity, 0)::numeric(24, 8) as used_quantity,
  (coalesce(r.received_quantity, 0) + coalesce(a.adjusted_quantity, 0)
    - coalesce(u.used_quantity, 0))::numeric(24, 8) as on_hand_quantity,
  case when coalesce(r.costed_receipt_quantity, 0) > 0
    then (r.known_receipt_cost / r.costed_receipt_quantity)::numeric(16, 6)
    else null::numeric
  end as weighted_known_receipt_cost_per_inventory_unit
from public.inventory_products p
left join received r on r.product_id = p.id and r.farm_id = p.farm_id
left join adjusted a on a.product_id = p.id and a.farm_id = p.farm_id
left join used u on u.product_id = p.id and u.farm_id = p.farm_id;

create or replace view public.program_application_products
with (security_invoker = true)
as
select
  ap.farm_id,
  ap.application_record_id,
  ap.id as assigned_pass_id,
  ap.assignment_id,
  pa.program_id,
  pa.program_name_snapshot,
  pa.program_kind_snapshot,
  pa.crop_assignment_id,
  app.id as assigned_product_id,
  app.sequence,
  app.actual_product_name,
  app.actual_rate_text,
  app.actual_unit_text,
  app.actual_cost_per_acre,
  match.assigned_product_id is not null as inventory_matched,
  match.inventory_product_id,
  match.quantity_in_inventory_unit,
  match.inventory_product_name_snapshot,
  match.inventory_unit_snapshot,
  match.operation_id as inventory_operation_id,
  match.confirmed_by as inventory_confirmed_by,
  match.confirmed_at as inventory_confirmed_at
from public.assigned_program_passes ap
join public.program_assignments pa
  on pa.id = ap.assignment_id and pa.farm_id = ap.farm_id
join public.assigned_program_pass_products app
  on app.assigned_pass_id = ap.id and app.farm_id = ap.farm_id
left join public.program_inventory_matches match
  on match.assigned_product_id = app.id and match.farm_id = app.farm_id
where ap.status = 'applied'
  and ap.application_record_id is not null
  and app.is_active;

revoke all on table public.inventory_on_hand, public.program_application_products
  from public, anon, authenticated;
grant select on table public.inventory_on_hand, public.program_application_products
  to authenticated;

create or replace function public.lock_inventory_products_catalog()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_farm_id uuid;
begin
  v_farm_id := case when tg_op = 'DELETE' then old.farm_id else new.farm_id end;
  perform pg_advisory_xact_lock(
    pg_catalog.hashtext(v_farm_id::text),
    pg_catalog.hashtext('inventory-products-catalog')
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger inventory_products_catalog_lock
before insert or update or delete on public.inventory_products
for each row execute function public.lock_inventory_products_catalog();

create or replace function public.mark_program_pass_applied(
  p_farm_id uuid,
  p_operation_id uuid,
  p_assigned_pass_id uuid,
  p_applied_on date,
  p_applied_acres numeric,
  p_actual_products jsonb,
  p_application_record_id uuid,
  p_create_application_record boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_receipt_user uuid;
  v_result jsonb;
  v_receipt_fingerprint text;
  v_request_fingerprint text;
  v_access_epoch bigint;
  v_canonical_actuals jsonb;
  v_requested_match_count integer := 0;
  v_pass public.assigned_program_passes%rowtype;
  v_assignment_id uuid;
  v_program_id uuid;
  v_crop_id uuid;
  v_field_id uuid;
  v_planted_acres numeric;
  v_canonical_date date;
  v_canonical_acres numeric;
  v_item jsonb;
  v_product_id uuid;
  v_inventory_product_id uuid;
  v_inventory_unit public.inventory_quantity_unit;
  v_quantity numeric;
  v_inventory_name text;
  v_exact_inventory_count integer;
  v_application_exists boolean;
  v_inventory_matches jsonb;
begin
  if p_farm_id is null or p_operation_id is null or p_assigned_pass_id is null
    or p_applied_on is null or p_applied_acres is null
    or p_create_application_record is null or v_caller is null then
    raise exception 'farm ID, operation ID, assigned pass ID, applied values, create choice, and authentication are required';
  end if;
  if p_applied_acres <= 0 then raise exception 'applied acres must be positive'; end if;
  if p_create_application_record and p_application_record_id is null then
    raise exception 'a stable application record ID is required when creating a record';
  end if;
  if jsonb_typeof(p_actual_products) is distinct from 'array' then
    raise exception 'actual products must be a JSON array';
  end if;

  for v_item in select value from jsonb_array_elements(p_actual_products) loop
    if jsonb_typeof(v_item) is distinct from 'object'
      or (select count(*) from jsonb_object_keys(v_item)) not in (5, 6)
      or not (v_item ?& array['id','actual_product_name','actual_rate_text','actual_unit_text','actual_cost_per_acre'])
      or exists (
        select 1 from jsonb_object_keys(v_item) as key_name(key)
        where key_name.key not in (
          'id', 'actual_product_name', 'actual_rate_text', 'actual_unit_text',
          'actual_cost_per_acre', 'inventory_match'
        )
      )
      or (select count(*) from jsonb_object_keys(v_item)) = 6
        and not (v_item ? 'inventory_match')
      or jsonb_typeof(v_item -> 'id') is distinct from 'string'
      or jsonb_typeof(v_item -> 'actual_product_name') is distinct from 'string'
      or jsonb_typeof(v_item -> 'actual_rate_text') is distinct from 'string'
      or jsonb_typeof(v_item -> 'actual_unit_text') is distinct from 'string'
      or coalesce(jsonb_typeof(v_item -> 'actual_cost_per_acre'), 'null') not in ('number', 'null')
      or (v_item ? 'inventory_match')
        and coalesce(jsonb_typeof(v_item -> 'inventory_match'), 'null') not in ('object', 'null') then
      raise exception 'actual product keys or field types do not match the accepted contract';
    end if;
    if jsonb_typeof(v_item -> 'inventory_match') = 'object' then
      v_requested_match_count := v_requested_match_count + 1;
      if (select count(*) from jsonb_object_keys(v_item -> 'inventory_match')) <> 3
        or exists (
          select 1 from jsonb_object_keys(v_item -> 'inventory_match') as key_name(key)
          where key_name.key not in (
            'inventory_product_id', 'quantity_in_inventory_unit', 'inventory_unit'
          )
        )
        or jsonb_typeof(v_item #> '{inventory_match,inventory_product_id}') is distinct from 'string'
        or jsonb_typeof(v_item #> '{inventory_match,quantity_in_inventory_unit}') is distinct from 'number'
        or jsonb_typeof(v_item #> '{inventory_match,inventory_unit}') is distinct from 'string' then
        raise exception 'inventory match keys or field types do not match the accepted contract';
      end if;
    end if;
  end loop;

  if v_requested_match_count > 0
    and (p_application_record_id is not null or p_create_application_record) then
    raise exception 'an inventory match requires no application record';
  end if;

  if not public.can_edit_farm(p_farm_id) then
    raise exception 'you do not have permission to edit this farm';
  end if;
  perform public.assert_current_farm_access_epoch(p_farm_id);
  v_access_epoch := public.current_request_farm_access_epoch(p_farm_id);
  if v_access_epoch is null then
    raise exception 'FARM_ACCESS_EPOCH_CHANGED';
  end if;

  select coalesce(jsonb_agg(actual.value order by actual.value ->> 'id'), '[]'::jsonb)
    into v_canonical_actuals
  from jsonb_array_elements(p_actual_products) actual(value);
  v_request_fingerprint := md5(jsonb_build_object(
    'farm_id', p_farm_id,
    'operation_id', p_operation_id,
    'user_id', v_caller,
    'access_epoch', v_access_epoch,
    'assigned_pass_id', p_assigned_pass_id,
    'applied_on', p_applied_on,
    'applied_acres', p_applied_acres,
    'actual_products', v_canonical_actuals,
    'application_record_id', p_application_record_id,
    'create_application_record', p_create_application_record
  )::text);

  perform pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext(p_operation_id::text));
  select receipt.user_id, receipt.result
    into v_receipt_user, v_result
  from public.repository_write_receipts receipt
  where receipt.farm_id = p_farm_id and receipt.operation_id = p_operation_id;
  if found then
    if v_receipt_user <> v_caller then
      raise exception 'operation ID was already used by another user';
    end if;
    v_receipt_fingerprint := v_result ->> 'request_fingerprint';
    if v_receipt_fingerprint is null then
      if v_requested_match_count > 0 then
        raise exception 'legacy operation receipt cannot confirm an inventory match';
      end if;
      return v_result;
    end if;
    if v_receipt_fingerprint is distinct from v_request_fingerprint then
      raise exception 'operation ID was already used for a different request';
    end if;
    return v_result;
  end if;

  select assigned_pass.assignment_id, assignment.program_id, assignment.crop_assignment_id
    into v_assignment_id, v_program_id, v_crop_id
  from public.assigned_program_passes assigned_pass
  join public.program_assignments assignment
    on assignment.id = assigned_pass.assignment_id
    and assignment.farm_id = assigned_pass.farm_id
  where assigned_pass.id = p_assigned_pass_id
    and assigned_pass.farm_id = p_farm_id;
  if not found then raise exception 'assigned pass does not belong to this farm'; end if;

  perform pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext('program-due-items'));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext(v_program_id::text));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext(v_crop_id::text));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext(v_assignment_id::text));
  perform pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext(p_assigned_pass_id::text));

  select assigned_pass.* into v_pass
  from public.assigned_program_passes assigned_pass
  join public.program_assignments assignment
    on assignment.id = assigned_pass.assignment_id
    and assignment.farm_id = assigned_pass.farm_id
  where assigned_pass.id = p_assigned_pass_id
    and assigned_pass.farm_id = p_farm_id
    and assigned_pass.status = 'planned'
    and assignment.status = 'active'
  for update of assigned_pass;
  if not found then
    raise exception 'planned pass on an active assignment does not belong to this farm';
  end if;

  select crop.field_id, crop.planted_acres
    into v_field_id, v_planted_acres
  from public.crop_assignments crop
  where crop.id = v_crop_id and crop.farm_id = p_farm_id;
  if not found then raise exception 'crop assignment does not belong to this farm'; end if;

  if (select count(*) from jsonb_array_elements(p_actual_products)) <>
      (select count(*) from public.assigned_program_pass_products assigned_product
       where assigned_product.farm_id = p_farm_id
         and assigned_product.assigned_pass_id = p_assigned_pass_id
         and assigned_product.is_active)
    or (select count(distinct value ->> 'id') from jsonb_array_elements(p_actual_products)) <>
      (select count(*) from jsonb_array_elements(p_actual_products)) then
    raise exception 'actual products must contain every assigned product exactly once';
  end if;

  -- Ordinary catalog reads may continue, but direct catalog writes share this
  -- farm-scoped lock through inventory_products_catalog_lock.
  if v_requested_match_count > 0 then
    perform pg_advisory_xact_lock(
      pg_catalog.hashtext(p_farm_id::text),
      pg_catalog.hashtext('inventory-products-catalog')
    );
  end if;

  -- Lock every referenced or exact-name candidate in stable ID order before
  -- validating the farmer-confirmed match facts.
  perform inventory_product.id
  from public.inventory_products inventory_product
  where inventory_product.farm_id = p_farm_id
    and (
      inventory_product.id in (
        select (actual.value #>> '{inventory_match,inventory_product_id}')::uuid
        from jsonb_array_elements(p_actual_products) actual(value)
        where jsonb_typeof(actual.value -> 'inventory_match') = 'object'
      )
      or btrim(inventory_product.name) collate "C" in (
        select btrim(actual.value ->> 'actual_product_name') collate "C"
        from jsonb_array_elements(p_actual_products) actual(value)
        where jsonb_typeof(actual.value -> 'inventory_match') = 'object'
      )
    )
  order by inventory_product.id
  for update;

  for v_item in
    select value from jsonb_array_elements(p_actual_products)
    order by value ->> 'id'
  loop
    begin
      v_product_id := (v_item ->> 'id')::uuid;
      if jsonb_typeof(v_item -> 'actual_cost_per_acre') = 'number'
        and (v_item ->> 'actual_cost_per_acre')::numeric < 0 then
        raise exception 'actual cost cannot be negative';
      end if;
    exception
      when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'actual product ID and cost must be valid';
    end;
    if not exists (
      select 1 from public.assigned_program_pass_products assigned_product
      where assigned_product.id = v_product_id
        and assigned_product.farm_id = p_farm_id
        and assigned_product.assigned_pass_id = p_assigned_pass_id
        and assigned_product.is_active
    ) then
      raise exception 'actual product does not belong to this assigned pass and farm';
    end if;
    if char_length(btrim(v_item ->> 'actual_product_name')) not between 1 and 200
      or char_length(btrim(v_item ->> 'actual_rate_text')) not between 1 and 80
      or char_length(btrim(v_item ->> 'actual_unit_text')) not between 1 and 80 then
      raise exception 'actual product text fields are invalid';
    end if;

    if jsonb_typeof(v_item -> 'inventory_match') = 'object' then
      begin
        v_inventory_product_id := (v_item #>> '{inventory_match,inventory_product_id}')::uuid;
        v_quantity := (v_item #>> '{inventory_match,quantity_in_inventory_unit}')::numeric;
        v_inventory_unit := (v_item #>> '{inventory_match,inventory_unit}')::public.inventory_quantity_unit;
      exception
        when invalid_text_representation or numeric_value_out_of_range then
          raise exception 'inventory product, quantity, and unit must be valid';
      end;
      if v_quantity <= 0 or v_quantity > 10000000
        or v_quantity <> round(v_quantity, 8) then
        raise exception 'inventory quantity must be at most 10000000 and use one through eight decimal places';
      end if;
      select count(*) into v_exact_inventory_count
      from public.inventory_products inventory_product
      where inventory_product.farm_id = p_farm_id
        and inventory_product.is_active
        and btrim(inventory_product.name) collate "C" =
          btrim(v_item ->> 'actual_product_name') collate "C";
      if v_exact_inventory_count <> 1 then
        raise exception 'confirmed inventory product name is not exact and unambiguous';
      end if;
      select inventory_product.name, inventory_product.inventory_unit
        into v_inventory_name, v_inventory_unit
      from public.inventory_products inventory_product
      where inventory_product.id = v_inventory_product_id
        and inventory_product.farm_id = p_farm_id
        and inventory_product.is_active
        and btrim(inventory_product.name) collate "C" =
          btrim(v_item ->> 'actual_product_name') collate "C";
      if not found then
        raise exception 'confirmed inventory product is inactive, foreign, stale, or not the exact name match';
      end if;
      if v_inventory_unit::text is distinct from
        (v_item #>> '{inventory_match,inventory_unit}') then
        raise exception 'confirmed inventory unit is stale';
      end if;
    end if;
  end loop;

  v_canonical_date := p_applied_on;
  v_canonical_acres := p_applied_acres;
  if p_application_record_id is not null then
    perform pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext(p_application_record_id::text));
    select exists (
      select 1 from public.application_records application
      where application.id = p_application_record_id
        and application.farm_id = p_farm_id
    ) into v_application_exists;
    if p_create_application_record then
      if v_application_exists then raise exception 'application record ID already exists'; end if;
      if p_applied_acres > v_planted_acres then
        raise exception 'applied acres cannot exceed planted acres';
      end if;
      insert into public.application_records (
        id, farm_id, field_id, crop_assignment_id, status, application_date,
        applied_acres, created_by, notes
      ) values (
        p_application_record_id, p_farm_id, v_field_id, v_crop_id, 'draft',
        p_applied_on, p_applied_acres, v_caller,
        'Created from Programs pass ' || p_assigned_pass_id::text
      );
    else
      select application.application_date, application.applied_acres
        into v_canonical_date, v_canonical_acres
      from public.application_records application
      where application.id = p_application_record_id
        and application.farm_id = p_farm_id
        and application.crop_assignment_id = v_crop_id
        and application.status <> 'voided';
      if not found then
        raise exception 'application record must be non-voided and belong to this farm and crop assignment';
      end if;
    end if;
  elsif p_applied_acres > v_planted_acres then
    raise exception 'applied acres cannot exceed planted acres';
  end if;
  if v_canonical_acres > v_planted_acres then
    raise exception 'application acres cannot exceed planted acres';
  end if;

  for v_item in
    select value from jsonb_array_elements(p_actual_products)
    order by value ->> 'id'
  loop
    v_product_id := (v_item ->> 'id')::uuid;
    update public.assigned_program_pass_products assigned_product
    set actual_product_name = btrim(v_item ->> 'actual_product_name'),
        actual_rate_text = btrim(v_item ->> 'actual_rate_text'),
        actual_unit_text = btrim(v_item ->> 'actual_unit_text'),
        actual_cost_per_acre = (v_item ->> 'actual_cost_per_acre')::numeric,
        updated_by = v_caller
    where assigned_product.id = v_product_id
      and assigned_product.farm_id = p_farm_id
      and assigned_product.assigned_pass_id = p_assigned_pass_id
      and assigned_product.is_active;

    if jsonb_typeof(v_item -> 'inventory_match') = 'object' then
      v_inventory_product_id := (v_item #>> '{inventory_match,inventory_product_id}')::uuid;
      v_quantity := (v_item #>> '{inventory_match,quantity_in_inventory_unit}')::numeric;
      select inventory_product.name, inventory_product.inventory_unit
        into v_inventory_name, v_inventory_unit
      from public.inventory_products inventory_product
      where inventory_product.id = v_inventory_product_id
        and inventory_product.farm_id = p_farm_id
        and inventory_product.is_active;
      insert into public.program_inventory_matches (
        farm_id, assigned_product_id, inventory_product_id,
        quantity_in_inventory_unit, inventory_product_name_snapshot,
        inventory_unit_snapshot, operation_id, confirmed_by
      ) values (
        p_farm_id, v_product_id, v_inventory_product_id,
        v_quantity, btrim(v_inventory_name), v_inventory_unit,
        p_operation_id, v_caller
      );
    end if;
  end loop;

  update public.assigned_program_passes assigned_pass
  set status = 'applied',
      applied_on = v_canonical_date,
      applied_acres = v_canonical_acres,
      application_record_id = p_application_record_id,
      updated_by = v_caller
  where assigned_pass.id = p_assigned_pass_id
    and assigned_pass.farm_id = p_farm_id
    and assigned_pass.status = 'planned'
  returning assigned_pass.* into v_pass;

  update public.farm_tasks task
  set status = 'done'
  where task.farm_id = p_farm_id
    and task.program_assigned_pass_id = p_assigned_pass_id
    and task.source = 'program'
    and task.status in ('todo', 'doing');

  select coalesce(
    jsonb_agg(to_jsonb(match) order by match.assigned_product_id, match.inventory_product_id),
    '[]'::jsonb
  ) into v_inventory_matches
  from public.program_inventory_matches match
  where match.farm_id = p_farm_id
    and match.operation_id = p_operation_id
    and match.assigned_product_id in (
      select assigned_product.id
      from public.assigned_program_pass_products assigned_product
      where assigned_product.farm_id = p_farm_id
        and assigned_product.assigned_pass_id = p_assigned_pass_id
    );

  v_result := jsonb_build_object(
    'pass', to_jsonb(v_pass),
    'request_fingerprint', v_request_fingerprint,
    'inventory_matched', v_requested_match_count > 0,
    'inventory_on_hand_changed', v_requested_match_count > 0,
    'inventory_match_count', v_requested_match_count,
    'inventory_matches', v_inventory_matches
  );
  insert into public.repository_write_receipts (
    farm_id, operation_id, user_id, result
  ) values (
    p_farm_id, p_operation_id, v_caller, v_result
  );
  return v_result;
end;
$$;

revoke all on function public.mark_program_pass_applied(
  uuid, uuid, uuid, date, numeric, jsonb, uuid, boolean
) from public, anon, authenticated;
grant execute on function public.mark_program_pass_applied(
  uuid, uuid, uuid, date, numeric, jsonb, uuid, boolean
) to authenticated;
