-- DRAFT ONLY -- Inventory live transactional support for Farm Rx.
-- PostgreSQL 17 / Supabase. Review before applying to any database.
-- Depends on applied migrations 0010_module3_inventory.sql through
-- 0014_flex_lease_methods.sql.

-- Direct writes must obey the same physical-conversion rules as the bundle
-- RPCs. Known same-family conversions always win over a caller-supplied
-- factor. Unknown conversions are allowed only when a package/count unit is
-- involved, and never between volume and weight.
create or replace function public.normalize_receipt_line_quantity()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_product_unit public.inventory_quantity_unit;
  v_known_factor numeric;
  v_from_family text;
  v_to_family text;
begin
  select p.inventory_unit into v_product_unit
  from public.inventory_products p
  where p.id = new.product_id
    and p.farm_id = new.farm_id
  for share;

  if v_product_unit is null then
    raise exception 'receipt product does not belong to this farm';
  end if;

  v_known_factor := public.inventory_conversion_factor(
    new.entered_unit,
    v_product_unit
  );

  if v_known_factor is not null then
    new.inventory_units_per_entered_unit := v_known_factor;
  else
    v_from_family := public.inventory_unit_family(new.entered_unit);
    v_to_family := public.inventory_unit_family(v_product_unit);

    if (v_from_family = 'volume' and v_to_family = 'weight')
      or (v_from_family = 'weight' and v_to_family = 'volume')
    then
      raise exception 'volume and weight units cannot be converted without a density';
    end if;

    if new.entered_unit not in (
      'each', 'bag', 'case', 'tote', 'seed_unit', 'bulk_unit'
    ) and v_product_unit not in (
      'each', 'bag', 'case', 'tote', 'seed_unit', 'bulk_unit'
    ) then
      raise exception 'an explicit conversion is allowed only for package or count units';
    end if;

    if new.inventory_units_per_entered_unit is null
      or new.inventory_units_per_entered_unit <= 0
    then
      raise exception 'a positive explicit packaging conversion is required from % to %',
        new.entered_unit, v_product_unit;
    end if;
  end if;

  new.quantity_in_inventory_unit := round(
    new.entered_quantity * new.inventory_units_per_entered_unit,
    8
  );
  return new;
end;
$$;

-- 0010 fired normalization only when an input/factor column appeared in the
-- UPDATE target list. Recreate it for every update so a caller cannot alter
-- quantity_in_inventory_unit by itself and bypass server calculation.
drop trigger inventory_receipt_lines_normalize_quantity
  on public.inventory_receipt_lines;
create trigger inventory_receipt_lines_normalize_quantity
before insert or update on public.inventory_receipt_lines
for each row execute function public.normalize_receipt_line_quantity();

-- The inventory_receipts_status_fields check requires cancelled_by whenever a
-- receipt becomes cancelled, but no client or trigger supplied it, so every
-- cancel failed. Record the acting user server-side; the 0011 update policy
-- still verifies cancelled_by matches auth.uid() when a client sends its own.
create or replace function public.default_receipt_cancelled_by()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.status = 'cancelled'
    and old.status is distinct from 'cancelled'
    and new.cancelled_by is null
  then
    new.cancelled_by := auth.uid();
  end if;
  return new;
end;
$$;

create trigger inventory_receipts_default_cancelled_by
before update on public.inventory_receipts
for each row execute function public.default_receipt_cancelled_by();

-- Snapshot every catalog/regulatory value and the latest known received cost.
-- The application-history triggers make the snapshot immutable after commit.
create or replace function public.snapshot_application_product()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_product public.inventory_products%rowtype;
  v_parent_status public.application_record_status;
  v_known_factor numeric;
  v_from_family text;
  v_to_family text;
begin
  select ar.status into v_parent_status
  from public.application_records ar
  where ar.id = new.application_id
    and ar.farm_id = new.farm_id
  for update;

  if v_parent_status is distinct from 'draft'::public.application_record_status then
    raise exception 'products can be changed only while the application is a draft';
  end if;

  select p.* into v_product
  from public.inventory_products p
  where p.id = new.product_id
    and p.farm_id = new.farm_id
  for share;

  if v_product.id is null then
    raise exception 'application product does not belong to this farm';
  end if;

  new.product_kind_snapshot := v_product.product_kind;
  new.product_name_snapshot := v_product.name;
  new.epa_registration_number_snapshot := v_product.epa_registration_number;
  new.is_restricted_use_snapshot := v_product.is_restricted_use;
  new.signal_word_snapshot := v_product.signal_word;
  new.restricted_entry_interval_hours_snapshot := v_product.restricted_entry_interval_hours;
  new.preharvest_interval_hours_snapshot := v_product.preharvest_interval_hours;
  new.max_label_rate_snapshot := v_product.max_label_rate;
  new.max_label_rate_unit_snapshot := v_product.max_label_rate_unit;
  new.max_label_rate_basis_snapshot := v_product.max_label_rate_basis;
  new.inventory_unit_snapshot := v_product.inventory_unit;

  v_known_factor := public.inventory_conversion_factor(
    new.total_unit,
    v_product.inventory_unit
  );

  if v_known_factor is not null then
    new.inventory_units_per_total_unit := v_known_factor;
  else
    v_from_family := public.inventory_unit_family(new.total_unit);
    v_to_family := public.inventory_unit_family(v_product.inventory_unit);

    if (v_from_family = 'volume' and v_to_family = 'weight')
      or (v_from_family = 'weight' and v_to_family = 'volume')
    then
      raise exception 'volume and weight units cannot be converted without a density';
    end if;

    if new.total_unit not in (
      'each', 'bag', 'case', 'tote', 'seed_unit', 'bulk_unit'
    ) and v_product.inventory_unit not in (
      'each', 'bag', 'case', 'tote', 'seed_unit', 'bulk_unit'
    ) then
      raise exception 'an explicit conversion is allowed only for package or count units';
    end if;

    if new.inventory_units_per_total_unit is null
      or new.inventory_units_per_total_unit <= 0
    then
      raise exception 'a positive explicit packaging conversion is required from % to %',
        new.total_unit, v_product.inventory_unit;
    end if;
  end if;

  new.quantity_in_inventory_unit := round(
    new.total_quantity * new.inventory_units_per_total_unit,
    8
  );

  select rl.unit_cost_per_inventory_unit
    into new.unit_cost_per_inventory_unit_snapshot
  from public.inventory_receipt_lines rl
  join public.inventory_receipts r
    on r.id = rl.receipt_id
   and r.farm_id = rl.farm_id
  where rl.farm_id = new.farm_id
    and rl.product_id = new.product_id
    and rl.unit_cost_per_inventory_unit is not null
    and r.status = 'received'
  order by r.received_at desc, rl.created_at desc, rl.id desc
  limit 1;

  return new;
end;
$$;

create or replace function public.save_inventory_receipt_bundle(
  p_farm_id uuid,
  p_receipt jsonb,
  p_lines jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_receipt_id uuid;
  v_requested_status public.inventory_receipt_status;
  v_candidate public.inventory_receipts%rowtype;
  v_existing public.inventory_receipts%rowtype;
  v_final public.inventory_receipts%rowtype;
  v_existing_found boolean;
  v_line_json jsonb;
  v_line public.inventory_receipt_lines%rowtype;
  v_normalized_lines jsonb := '[]'::jsonb;
  v_line_ids uuid[] := array[]::uuid[];
  v_product_unit public.inventory_quantity_unit;
  v_known_factor numeric;
  v_from_family text;
  v_to_family text;
  v_final_lines jsonb;
begin
  if v_caller is null then
    raise exception 'authentication is required';
  end if;
  if p_farm_id is null or not public.can_edit_farm(p_farm_id) then
    raise exception 'you do not have permission to edit this farm''s inventory';
  end if;
  if jsonb_typeof(p_receipt) is distinct from 'object' then
    raise exception 'receipt must be a JSON object';
  end if;
  if (select count(*) from jsonb_object_keys(p_receipt)) <> 8
    or exists (
      select 1 from jsonb_object_keys(p_receipt) as k(key)
      where k.key not in (
        'id', 'source', 'status', 'vendor_name', 'purchase_date',
        'received_at', 'invoice_number', 'notes'
      )
    )
  then
    raise exception 'receipt keys do not match the accepted contract';
  end if;

  if jsonb_typeof(p_receipt -> 'id') is distinct from 'string'
    or jsonb_typeof(p_receipt -> 'source') is distinct from 'string'
    or jsonb_typeof(p_receipt -> 'status') is distinct from 'string'
  then
    raise exception 'receipt ID, source, and status are required strings';
  end if;

  v_receipt_id := (p_receipt ->> 'id')::uuid;
  v_requested_status := (p_receipt ->> 'status')::public.inventory_receipt_status;
  if v_requested_status not in ('draft', 'received') then
    raise exception 'receipt status must be draft or received';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_farm_id::text || ':receipt:' || v_receipt_id::text, 0)
  );

  if jsonb_typeof(p_lines) is distinct from 'array'
    or jsonb_array_length(p_lines) = 0
  then
    raise exception 'receipt lines must be a non-empty JSON array';
  end if;

  if coalesce(jsonb_typeof(p_receipt -> 'vendor_name'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_receipt -> 'purchase_date'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_receipt -> 'received_at'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_receipt -> 'invoice_number'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_receipt -> 'notes'), 'null') not in ('string', 'null')
  then
    raise exception 'receipt nullable fields have invalid JSON types';
  end if;

  v_candidate := jsonb_populate_record(
    null::public.inventory_receipts,
    p_receipt
  );
  v_candidate.farm_id := p_farm_id;
  v_candidate.created_by := v_caller;

  if v_candidate.vendor_name is not null
    and char_length(btrim(v_candidate.vendor_name)) not between 1 and 200
  then
    raise exception 'receipt vendor name is invalid';
  end if;
  if v_candidate.invoice_number is not null
    and char_length(btrim(v_candidate.invoice_number)) not between 1 and 120
  then
    raise exception 'receipt invoice number is invalid';
  end if;
  if v_candidate.source <> 'opening_balance'
    and v_candidate.vendor_name is null
  then
    raise exception 'non-opening receipts require a vendor name';
  end if;
  if v_requested_status = 'draft' and v_candidate.received_at is not null then
    raise exception 'a draft receipt cannot have a received timestamp';
  end if;
  if v_requested_status = 'received' and v_candidate.received_at is null then
    raise exception 'a received receipt requires a received timestamp';
  end if;

  for v_line_json in
    select value from jsonb_array_elements(p_lines)
  loop
    if jsonb_typeof(v_line_json) is distinct from 'object' then
      raise exception 'each receipt line must be a JSON object';
    end if;
    if (select count(*) from jsonb_object_keys(v_line_json)) <> 10
      or exists (
        select 1 from jsonb_object_keys(v_line_json) as k(key)
        where k.key not in (
          'id', 'product_id', 'entered_quantity', 'entered_unit',
          'inventory_units_per_entered_unit', 'unit_cost_per_inventory_unit',
          'lot_number', 'expiration_date', 'external_delivery_line_id',
          'notes'
        )
      )
    then
      raise exception 'receipt line keys do not match the accepted contract';
    end if;

    if jsonb_typeof(v_line_json -> 'id') is distinct from 'string'
      or jsonb_typeof(v_line_json -> 'product_id') is distinct from 'string'
      or jsonb_typeof(v_line_json -> 'entered_quantity') is distinct from 'number'
      or jsonb_typeof(v_line_json -> 'entered_unit') is distinct from 'string'
      or coalesce(jsonb_typeof(v_line_json -> 'inventory_units_per_entered_unit'), 'null') not in ('number', 'null')
      or coalesce(jsonb_typeof(v_line_json -> 'unit_cost_per_inventory_unit'), 'null') not in ('number', 'null')
      or coalesce(jsonb_typeof(v_line_json -> 'lot_number'), 'null') not in ('string', 'null')
      or coalesce(jsonb_typeof(v_line_json -> 'expiration_date'), 'null') not in ('string', 'null')
      or coalesce(jsonb_typeof(v_line_json -> 'external_delivery_line_id'), 'null') not in ('string', 'null')
      or coalesce(jsonb_typeof(v_line_json -> 'notes'), 'null') not in ('string', 'null')
    then
      raise exception 'receipt line fields have invalid JSON types';
    end if;

    v_line := jsonb_populate_record(
      null::public.inventory_receipt_lines,
      v_line_json
    );
    v_line.farm_id := p_farm_id;
    v_line.receipt_id := v_receipt_id;

    if v_line.id = any(v_line_ids) then
      raise exception 'receipt line ID is duplicated';
    end if;
    v_line_ids := array_append(v_line_ids, v_line.id);

    if v_line.entered_quantity is null or v_line.entered_quantity <= 0 then
      raise exception 'receipt line quantity must be positive';
    end if;
    if v_line.unit_cost_per_inventory_unit is not null
      and v_line.unit_cost_per_inventory_unit < 0
    then
      raise exception 'receipt line cost cannot be negative';
    end if;
    if v_line.lot_number is not null
      and char_length(btrim(v_line.lot_number)) not between 1 and 120
    then
      raise exception 'receipt line lot number is invalid';
    end if;
    if v_line.external_delivery_line_id is not null
      and char_length(btrim(v_line.external_delivery_line_id)) not between 1 and 200
    then
      raise exception 'receipt line external delivery ID is invalid';
    end if;

    select p.inventory_unit into v_product_unit
    from public.inventory_products p
    where p.id = v_line.product_id
      and p.farm_id = p_farm_id
    for share;
    if v_product_unit is null then
      raise exception 'receipt product does not belong to this farm';
    end if;

    v_known_factor := public.inventory_conversion_factor(
      v_line.entered_unit,
      v_product_unit
    );
    if v_known_factor is not null then
      v_line.inventory_units_per_entered_unit := v_known_factor;
    else
      v_from_family := public.inventory_unit_family(v_line.entered_unit);
      v_to_family := public.inventory_unit_family(v_product_unit);
      if (v_from_family = 'volume' and v_to_family = 'weight')
        or (v_from_family = 'weight' and v_to_family = 'volume')
      then
        raise exception 'volume and weight units cannot be converted without a density';
      end if;
      if v_line.entered_unit not in (
        'each', 'bag', 'case', 'tote', 'seed_unit', 'bulk_unit'
      ) and v_product_unit not in (
        'each', 'bag', 'case', 'tote', 'seed_unit', 'bulk_unit'
      ) then
        raise exception 'an explicit conversion is allowed only for package or count units';
      end if;
      if v_line.inventory_units_per_entered_unit is null
        or v_line.inventory_units_per_entered_unit <= 0
      then
        raise exception 'a positive explicit packaging conversion is required';
      end if;
    end if;

    v_line.quantity_in_inventory_unit := round(
      v_line.entered_quantity * v_line.inventory_units_per_entered_unit,
      8
    );
    v_normalized_lines := v_normalized_lines || jsonb_build_array(to_jsonb(v_line));
  end loop;

  if exists (
    select 1
    from public.inventory_receipt_lines rl
    where rl.id = any(v_line_ids)
      and (rl.farm_id <> p_farm_id or rl.receipt_id <> v_receipt_id)
  ) then
    raise exception 'receipt line ID already belongs to another receipt or farm';
  end if;

  select r.* into v_existing
  from public.inventory_receipts r
  where r.id = v_receipt_id
  for update;
  v_existing_found := found;

  if v_existing_found and v_existing.farm_id <> p_farm_id then
    raise exception 'receipt ID already belongs to another farm';
  end if;
  if v_existing_found and v_existing.status = 'cancelled' then
    raise exception 'cancelled receipts are immutable';
  end if;

  if v_existing_found and v_existing.status = 'received' then
    if v_requested_status <> 'received' then
      raise exception 'a received receipt cannot return to draft';
    end if;
    if v_existing.source is distinct from v_candidate.source
      or v_existing.vendor_name is distinct from v_candidate.vendor_name
      or v_existing.purchase_date is distinct from v_candidate.purchase_date
      or v_existing.received_at is distinct from v_candidate.received_at
      or v_existing.invoice_number is distinct from v_candidate.invoice_number
      or v_existing.notes is distinct from v_candidate.notes
      or (select count(*) from public.inventory_receipt_lines rl
          where rl.farm_id = p_farm_id and rl.receipt_id = v_receipt_id)
         <> jsonb_array_length(v_normalized_lines)
      or exists (
        select 1
        from jsonb_populate_recordset(
          null::public.inventory_receipt_lines,
          v_normalized_lines
        ) wanted
        left join public.inventory_receipt_lines stored
          on stored.id = wanted.id
         and stored.farm_id = p_farm_id
         and stored.receipt_id = v_receipt_id
        where stored.id is null
          or stored.product_id is distinct from wanted.product_id
          or stored.entered_quantity is distinct from wanted.entered_quantity
          or stored.entered_unit is distinct from wanted.entered_unit
          or stored.inventory_units_per_entered_unit is distinct from wanted.inventory_units_per_entered_unit
          or stored.quantity_in_inventory_unit is distinct from wanted.quantity_in_inventory_unit
          or stored.unit_cost_per_inventory_unit is distinct from wanted.unit_cost_per_inventory_unit
          or stored.lot_number is distinct from wanted.lot_number
          or stored.expiration_date is distinct from wanted.expiration_date
          or stored.external_delivery_line_id is distinct from wanted.external_delivery_line_id
          or stored.notes is distinct from wanted.notes
      )
    then
      raise exception 'received receipt replay does not match immutable history';
    end if;
    v_final := v_existing;
  else
    if v_existing_found then
      update public.inventory_receipts
      set source = v_candidate.source,
          vendor_name = v_candidate.vendor_name,
          purchase_date = v_candidate.purchase_date,
          invoice_number = v_candidate.invoice_number,
          notes = v_candidate.notes
      where id = v_receipt_id
        and farm_id = p_farm_id
        and status = 'draft';
    else
      insert into public.inventory_receipts (
        id, farm_id, source, status, vendor_name, purchase_date,
        received_at, invoice_number, created_by, notes
      ) values (
        v_receipt_id, p_farm_id, v_candidate.source, 'draft',
        v_candidate.vendor_name, v_candidate.purchase_date, null,
        v_candidate.invoice_number, v_caller, v_candidate.notes
      );
    end if;

    insert into public.inventory_receipt_lines (
      id, farm_id, receipt_id, product_id, entered_quantity, entered_unit,
      inventory_units_per_entered_unit, quantity_in_inventory_unit,
      unit_cost_per_inventory_unit, lot_number, expiration_date,
      external_delivery_line_id, notes
    )
    select l.id, p_farm_id, v_receipt_id, l.product_id,
      l.entered_quantity, l.entered_unit,
      l.inventory_units_per_entered_unit, l.quantity_in_inventory_unit,
      l.unit_cost_per_inventory_unit, l.lot_number, l.expiration_date,
      l.external_delivery_line_id, l.notes
    from jsonb_populate_recordset(
      null::public.inventory_receipt_lines,
      v_normalized_lines
    ) l
    on conflict (id) do update
    set product_id = excluded.product_id,
        entered_quantity = excluded.entered_quantity,
        entered_unit = excluded.entered_unit,
        inventory_units_per_entered_unit = excluded.inventory_units_per_entered_unit,
        unit_cost_per_inventory_unit = excluded.unit_cost_per_inventory_unit,
        lot_number = excluded.lot_number,
        expiration_date = excluded.expiration_date,
        external_delivery_line_id = excluded.external_delivery_line_id,
        notes = excluded.notes;

    delete from public.inventory_receipt_lines rl
    where rl.farm_id = p_farm_id
      and rl.receipt_id = v_receipt_id
      and not (rl.id = any(v_line_ids));

    if v_requested_status = 'received' then
      update public.inventory_receipts
      set status = 'received',
          received_at = v_candidate.received_at
      where id = v_receipt_id
        and farm_id = p_farm_id
        and status = 'draft';
    end if;

    select r.* into v_final
    from public.inventory_receipts r
    where r.id = v_receipt_id
      and r.farm_id = p_farm_id;
  end if;

  select coalesce(jsonb_agg(to_jsonb(rl) order by rl.id), '[]'::jsonb)
    into v_final_lines
  from public.inventory_receipt_lines rl
  where rl.farm_id = p_farm_id
    and rl.receipt_id = v_receipt_id;

  return jsonb_build_object(
    'receipt', to_jsonb(v_final),
    'lines', v_final_lines
  );
end;
$$;

revoke all on function public.save_inventory_receipt_bundle(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_inventory_receipt_bundle(uuid, jsonb, jsonb)
  to authenticated;

create or replace function public.save_inventory_application_bundle(
  p_farm_id uuid,
  p_application jsonb,
  p_products jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_caller uuid := auth.uid();
  v_application_id uuid;
  v_requested_status public.application_record_status;
  v_candidate public.application_records%rowtype;
  v_existing public.application_records%rowtype;
  v_final public.application_records%rowtype;
  v_existing_found boolean;
  v_assignment_field_id uuid;
  v_assignment_acres numeric;
  v_applicator_active boolean;
  v_product_json jsonb;
  v_product public.application_products%rowtype;
  v_catalog public.inventory_products%rowtype;
  v_normalized_products jsonb := '[]'::jsonb;
  v_product_ids uuid[] := array[]::uuid[];
  v_identity_keys text[] := array[]::text[];
  v_identity_key text;
  v_known_factor numeric;
  v_rate_factor numeric;
  v_expected_total numeric;
  v_from_family text;
  v_to_family text;
  v_final_products jsonb;
begin
  if v_caller is null then
    raise exception 'authentication is required';
  end if;
  if p_farm_id is null or not public.can_edit_farm(p_farm_id) then
    raise exception 'you do not have permission to edit this farm''s inventory';
  end if;
  if jsonb_typeof(p_application) is distinct from 'object' then
    raise exception 'application must be a JSON object';
  end if;
  if (select count(*) from jsonb_object_keys(p_application)) <> 21
    or exists (
      select 1 from jsonb_object_keys(p_application) as k(key)
      where k.key not in (
        'id', 'field_id', 'crop_assignment_id', 'status', 'application_date',
        'start_time', 'end_time', 'applied_acres', 'target_pest',
        'applicator_user_id', 'applicator_name_snapshot',
        'applicator_license_number_snapshot',
        'applicator_license_state_snapshot', 'wind_speed_mph',
        'wind_direction', 'temperature_f', 'relative_humidity_pct',
        'corrects_application_id', 'correction_reason', 'completed_at', 'notes'
      )
    )
  then
    raise exception 'application keys do not match the accepted contract';
  end if;

  if jsonb_typeof(p_application -> 'id') is distinct from 'string'
    or jsonb_typeof(p_application -> 'field_id') is distinct from 'string'
    or jsonb_typeof(p_application -> 'crop_assignment_id') is distinct from 'string'
    or jsonb_typeof(p_application -> 'status') is distinct from 'string'
    or jsonb_typeof(p_application -> 'application_date') is distinct from 'string'
    or jsonb_typeof(p_application -> 'applied_acres') is distinct from 'number'
  then
    raise exception 'application required fields have invalid JSON types';
  end if;

  v_application_id := (p_application ->> 'id')::uuid;
  v_requested_status := (p_application ->> 'status')::public.application_record_status;
  if v_requested_status not in ('draft', 'completed') then
    raise exception 'application status must be draft or completed';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_farm_id::text || ':application:' || v_application_id::text, 0)
  );

  if jsonb_typeof(p_products) is distinct from 'array'
    or jsonb_array_length(p_products) = 0
  then
    raise exception 'application products must be a non-empty JSON array';
  end if;

  if coalesce(jsonb_typeof(p_application -> 'start_time'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_application -> 'end_time'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_application -> 'target_pest'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_application -> 'applicator_user_id'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_application -> 'applicator_name_snapshot'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_application -> 'applicator_license_number_snapshot'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_application -> 'applicator_license_state_snapshot'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_application -> 'wind_speed_mph'), 'null') not in ('number', 'null')
    or coalesce(jsonb_typeof(p_application -> 'wind_direction'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_application -> 'temperature_f'), 'null') not in ('number', 'null')
    or coalesce(jsonb_typeof(p_application -> 'relative_humidity_pct'), 'null') not in ('number', 'null')
    or coalesce(jsonb_typeof(p_application -> 'corrects_application_id'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_application -> 'correction_reason'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_application -> 'completed_at'), 'null') not in ('string', 'null')
    or coalesce(jsonb_typeof(p_application -> 'notes'), 'null') not in ('string', 'null')
  then
    raise exception 'application nullable fields have invalid JSON types';
  end if;

  v_candidate := jsonb_populate_record(
    null::public.application_records,
    p_application
  );
  v_candidate.farm_id := p_farm_id;
  v_candidate.created_by := v_caller;

  if v_candidate.applied_acres is null or v_candidate.applied_acres <= 0 then
    raise exception 'application acres must be positive';
  end if;
  if v_candidate.end_time is not null
    and v_candidate.start_time is not null
    and v_candidate.end_time < v_candidate.start_time
  then
    raise exception 'application end time cannot precede start time';
  end if;
  if v_candidate.target_pest is not null
    and char_length(btrim(v_candidate.target_pest)) not between 1 and 240
  then
    raise exception 'application target pest is invalid';
  end if;
  if v_candidate.applicator_name_snapshot is not null
    and char_length(btrim(v_candidate.applicator_name_snapshot)) not between 1 and 200
  then
    raise exception 'applicator name snapshot is invalid';
  end if;
  if v_candidate.applicator_license_number_snapshot is not null
    and char_length(btrim(v_candidate.applicator_license_number_snapshot)) not between 1 and 120
  then
    raise exception 'applicator license number snapshot is invalid';
  end if;
  if v_candidate.applicator_license_state_snapshot is not null
    and char_length(btrim(v_candidate.applicator_license_state_snapshot)) not between 2 and 50
  then
    raise exception 'applicator license state snapshot is invalid';
  end if;
  if v_candidate.wind_speed_mph is not null
    and v_candidate.wind_speed_mph not between 0 and 250
  then
    raise exception 'application wind speed is invalid';
  end if;
  if v_candidate.wind_direction is not null and v_candidate.wind_direction not in (
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW',
    'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW', 'CALM', 'VARIABLE'
  ) then
    raise exception 'application wind direction is invalid';
  end if;
  if v_candidate.temperature_f is not null
    and v_candidate.temperature_f not between -100 and 160
  then
    raise exception 'application temperature is invalid';
  end if;
  if v_candidate.relative_humidity_pct is not null
    and v_candidate.relative_humidity_pct not between 0 and 100
  then
    raise exception 'application relative humidity is invalid';
  end if;
  if v_candidate.corrects_application_id is not null
    or v_candidate.correction_reason is not null
  then
    raise exception 'this application interface does not accept corrections';
  end if;
  if v_requested_status = 'draft' and v_candidate.completed_at is not null then
    raise exception 'a draft application cannot have a completion timestamp';
  end if;
  if v_requested_status = 'completed' and v_candidate.completed_at is null then
    raise exception 'a completed application requires a completion timestamp';
  end if;

  select ca.field_id, ca.planted_acres
    into v_assignment_field_id, v_assignment_acres
  from public.crop_assignments ca
  join public.fields f
    on f.id = ca.field_id
   and f.farm_id = ca.farm_id
  where ca.id = v_candidate.crop_assignment_id
    and ca.farm_id = p_farm_id
    and f.id = v_candidate.field_id;

  if v_assignment_field_id is null
    or v_assignment_field_id <> v_candidate.field_id
  then
    raise exception 'crop assignment must belong to the selected field and farm';
  end if;
  if v_candidate.applied_acres > v_assignment_acres then
    raise exception 'applied acres cannot exceed assigned planted acres';
  end if;

  if v_candidate.applicator_user_id is not null then
    select exists (
      select 1
      from public.farm_memberships fm
      where fm.farm_id = p_farm_id
        and fm.user_id = v_candidate.applicator_user_id
        and fm.status = 'active'
    ) into v_applicator_active;
    if not v_applicator_active then
      raise exception 'applicator must be an active member of this farm';
    end if;
  end if;

  for v_product_json in
    select value from jsonb_array_elements(p_products)
  loop
    if jsonb_typeof(v_product_json) is distinct from 'object' then
      raise exception 'each application product must be a JSON object';
    end if;
    if (select count(*) from jsonb_object_keys(v_product_json)) <> 10
      or exists (
        select 1 from jsonb_object_keys(v_product_json) as k(key)
        where k.key not in (
          'id', 'product_id', 'rate', 'rate_unit', 'rate_basis',
          'total_quantity', 'total_unit', 'inventory_units_per_total_unit',
          'lot_number_snapshot', 'notes'
        )
      )
    then
      raise exception 'application product keys do not match the accepted contract';
    end if;

    if jsonb_typeof(v_product_json -> 'id') is distinct from 'string'
      or jsonb_typeof(v_product_json -> 'product_id') is distinct from 'string'
      or jsonb_typeof(v_product_json -> 'rate') is distinct from 'number'
      or jsonb_typeof(v_product_json -> 'rate_unit') is distinct from 'string'
      or jsonb_typeof(v_product_json -> 'rate_basis') is distinct from 'string'
      or jsonb_typeof(v_product_json -> 'total_quantity') is distinct from 'number'
      or jsonb_typeof(v_product_json -> 'total_unit') is distinct from 'string'
      or coalesce(jsonb_typeof(v_product_json -> 'inventory_units_per_total_unit'), 'null') not in ('number', 'null')
      or coalesce(jsonb_typeof(v_product_json -> 'lot_number_snapshot'), 'null') not in ('string', 'null')
      or coalesce(jsonb_typeof(v_product_json -> 'notes'), 'null') not in ('string', 'null')
    then
      raise exception 'application product fields have invalid JSON types';
    end if;

    v_product := jsonb_populate_record(
      null::public.application_products,
      v_product_json
    );
    v_product.farm_id := p_farm_id;
    v_product.application_id := v_application_id;

    if v_product.id = any(v_product_ids) then
      raise exception 'application product row ID is duplicated';
    end if;
    v_product_ids := array_append(v_product_ids, v_product.id);

    v_identity_key := jsonb_build_array(
      v_product.product_id,
      v_product.lot_number_snapshot
    )::text;
    if v_identity_key = any(v_identity_keys) then
      raise exception 'application product and lot identity is duplicated';
    end if;
    v_identity_keys := array_append(v_identity_keys, v_identity_key);

    if v_product.rate is null or v_product.rate <= 0
      or v_product.total_quantity is null or v_product.total_quantity <= 0
    then
      raise exception 'application product rate and total quantity must be positive';
    end if;

    select p.* into v_catalog
    from public.inventory_products p
    where p.id = v_product.product_id
      and p.farm_id = p_farm_id
    for share;
    if v_catalog.id is null then
      raise exception 'application product does not belong to this farm';
    end if;

    v_known_factor := public.inventory_conversion_factor(
      v_product.total_unit,
      v_catalog.inventory_unit
    );
    if v_known_factor is not null then
      v_product.inventory_units_per_total_unit := v_known_factor;
    else
      v_from_family := public.inventory_unit_family(v_product.total_unit);
      v_to_family := public.inventory_unit_family(v_catalog.inventory_unit);
      if (v_from_family = 'volume' and v_to_family = 'weight')
        or (v_from_family = 'weight' and v_to_family = 'volume')
      then
        raise exception 'volume and weight units cannot be converted without a density';
      end if;
      if v_product.total_unit not in (
        'each', 'bag', 'case', 'tote', 'seed_unit', 'bulk_unit'
      ) and v_catalog.inventory_unit not in (
        'each', 'bag', 'case', 'tote', 'seed_unit', 'bulk_unit'
      ) then
        raise exception 'an explicit conversion is allowed only for package or count units';
      end if;
      if v_product.inventory_units_per_total_unit is null
        or v_product.inventory_units_per_total_unit <= 0
      then
        raise exception 'a positive explicit packaging conversion is required';
      end if;
    end if;

    v_product.quantity_in_inventory_unit := round(
      v_product.total_quantity * v_product.inventory_units_per_total_unit,
      8
    );

    if v_product.rate_basis = 'acre' then
      v_rate_factor := public.inventory_conversion_factor(
        v_product.rate_unit,
        v_product.total_unit
      );
      if v_rate_factor is not null then
        v_expected_total := v_product.rate
          * v_candidate.applied_acres
          * v_rate_factor;
        if abs(v_product.total_quantity - v_expected_total)
          > greatest(0.0001, v_expected_total * 0.01)
        then
          raise exception 'application total quantity is outside the 1%% rate-times-acres tolerance';
        end if;
      end if;
    end if;

    v_normalized_products := v_normalized_products
      || jsonb_build_array(to_jsonb(v_product));
  end loop;

  if exists (
    select 1
    from public.application_products ap
    where ap.id = any(v_product_ids)
      and (ap.farm_id <> p_farm_id or ap.application_id <> v_application_id)
  ) then
    raise exception 'application product row ID already belongs to another application or farm';
  end if;

  select ar.* into v_existing
  from public.application_records ar
  where ar.id = v_application_id
  for update;
  v_existing_found := found;

  if v_existing_found and v_existing.farm_id <> p_farm_id then
    raise exception 'application ID already belongs to another farm';
  end if;
  if v_existing_found and v_existing.status = 'voided' then
    raise exception 'voided application records are immutable';
  end if;

  if v_existing_found then
    if v_existing.status is distinct from v_requested_status
      or v_existing.field_id is distinct from v_candidate.field_id
      or v_existing.crop_assignment_id is distinct from v_candidate.crop_assignment_id
      or v_existing.application_date is distinct from v_candidate.application_date
      or v_existing.start_time is distinct from v_candidate.start_time
      or v_existing.end_time is distinct from v_candidate.end_time
      or v_existing.applied_acres is distinct from v_candidate.applied_acres
      or v_existing.target_pest is distinct from v_candidate.target_pest
      or v_existing.applicator_user_id is distinct from v_candidate.applicator_user_id
      or v_existing.applicator_name_snapshot is distinct from v_candidate.applicator_name_snapshot
      or v_existing.applicator_license_number_snapshot is distinct from v_candidate.applicator_license_number_snapshot
      or v_existing.applicator_license_state_snapshot is distinct from v_candidate.applicator_license_state_snapshot
      or v_existing.wind_speed_mph is distinct from v_candidate.wind_speed_mph
      or v_existing.wind_direction is distinct from v_candidate.wind_direction
      or v_existing.temperature_f is distinct from v_candidate.temperature_f
      or v_existing.relative_humidity_pct is distinct from v_candidate.relative_humidity_pct
      or v_existing.corrects_application_id is distinct from v_candidate.corrects_application_id
      or v_existing.correction_reason is distinct from v_candidate.correction_reason
      or v_existing.completed_at is distinct from v_candidate.completed_at
      or v_existing.notes is distinct from v_candidate.notes
      or (select count(*) from public.application_products ap
          where ap.farm_id = p_farm_id and ap.application_id = v_application_id)
         <> jsonb_array_length(v_normalized_products)
      or exists (
        select 1
        from jsonb_populate_recordset(
          null::public.application_products,
          v_normalized_products
        ) wanted
        left join public.application_products stored
          on stored.id = wanted.id
         and stored.farm_id = p_farm_id
         and stored.application_id = v_application_id
        where stored.id is null
          or stored.product_id is distinct from wanted.product_id
          or stored.rate is distinct from wanted.rate
          or stored.rate_unit is distinct from wanted.rate_unit
          or stored.rate_basis is distinct from wanted.rate_basis
          or stored.total_quantity is distinct from wanted.total_quantity
          or stored.total_unit is distinct from wanted.total_unit
          or stored.inventory_units_per_total_unit is distinct from wanted.inventory_units_per_total_unit
          or stored.quantity_in_inventory_unit is distinct from wanted.quantity_in_inventory_unit
          or stored.lot_number_snapshot is distinct from wanted.lot_number_snapshot
          or stored.notes is distinct from wanted.notes
      )
    then
      raise exception 'application replay does not match immutable history';
    end if;
    v_final := v_existing;
  else
    insert into public.application_records (
      id, farm_id, field_id, crop_assignment_id, status, application_date,
      start_time, end_time, applied_acres, target_pest, applicator_user_id,
      applicator_name_snapshot, applicator_license_number_snapshot,
      applicator_license_state_snapshot, wind_speed_mph, wind_direction,
      temperature_f, relative_humidity_pct, corrects_application_id,
      correction_reason, created_by, completed_at, notes
    ) values (
      v_application_id, p_farm_id, v_candidate.field_id,
      v_candidate.crop_assignment_id, 'draft', v_candidate.application_date,
      v_candidate.start_time, v_candidate.end_time, v_candidate.applied_acres,
      v_candidate.target_pest, v_candidate.applicator_user_id,
      v_candidate.applicator_name_snapshot,
      v_candidate.applicator_license_number_snapshot,
      v_candidate.applicator_license_state_snapshot, v_candidate.wind_speed_mph,
      v_candidate.wind_direction, v_candidate.temperature_f,
      v_candidate.relative_humidity_pct, null, null, v_caller, null,
      v_candidate.notes
    );

    insert into public.application_products (
      id, farm_id, application_id, product_id,
      product_kind_snapshot, product_name_snapshot,
      epa_registration_number_snapshot, is_restricted_use_snapshot,
      signal_word_snapshot, restricted_entry_interval_hours_snapshot,
      preharvest_interval_hours_snapshot, max_label_rate_snapshot,
      max_label_rate_unit_snapshot, max_label_rate_basis_snapshot,
      inventory_unit_snapshot, rate, rate_unit, rate_basis, total_quantity,
      total_unit, inventory_units_per_total_unit, quantity_in_inventory_unit,
      unit_cost_per_inventory_unit_snapshot, lot_number_snapshot, notes
    )
    select p.id, p_farm_id, v_application_id, p.product_id,
      catalog.product_kind, catalog.name,
      catalog.epa_registration_number, catalog.is_restricted_use,
      catalog.signal_word, catalog.restricted_entry_interval_hours,
      catalog.preharvest_interval_hours, catalog.max_label_rate,
      catalog.max_label_rate_unit, catalog.max_label_rate_basis,
      catalog.inventory_unit, p.rate, p.rate_unit, p.rate_basis,
      p.total_quantity, p.total_unit, p.inventory_units_per_total_unit,
      p.quantity_in_inventory_unit, null, p.lot_number_snapshot, p.notes
    from jsonb_populate_recordset(
      null::public.application_products,
      v_normalized_products
    ) p
    join public.inventory_products catalog
      on catalog.id = p.product_id
     and catalog.farm_id = p_farm_id;

    if v_requested_status = 'completed' then
      update public.application_records
      set status = 'completed',
          completed_at = v_candidate.completed_at
      where id = v_application_id
        and farm_id = p_farm_id
        and status = 'draft';
    end if;

    select ar.* into v_final
    from public.application_records ar
    where ar.id = v_application_id
      and ar.farm_id = p_farm_id;
  end if;

  select coalesce(jsonb_agg(to_jsonb(ap) order by ap.id), '[]'::jsonb)
    into v_final_products
  from public.application_products ap
  where ap.farm_id = p_farm_id
    and ap.application_id = v_application_id;

  return jsonb_build_object(
    'application', to_jsonb(v_final),
    'products', v_final_products
  );
end;
$$;

revoke all on function public.save_inventory_application_bundle(uuid, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_inventory_application_bundle(uuid, jsonb, jsonb)
  to authenticated;

-- Reviewer test section -- NOT RUN.
-- Run only in a disposable review transaction with fixture UUIDs replaced.
-- The intended matrix covers: unauthenticated/unauthorized callers; editable
-- workers without financial access; cross-farm parent, product, field,
-- assignment, child-ID, and applicator references; unknown and missing keys;
-- client created_at/updated_at keys; duplicate child IDs and product/lot pairs;
-- empty bundles; draft editing; received/completed exact replay; divergent
-- replay; cancelled/voided rejection; draft-first history transitions;
-- rollback after a bad later child; same-family factor override; package factor
-- requirements; volume/weight rejection; latest-cost ordering; direct-write
-- trigger bypass attempts; and deterministic child-ID result ordering.
--
-- begin;
-- set local role authenticated;
-- do $review_test$
-- begin
--   raise exception '0015 reviewer fixtures are intentionally not configured';
-- end
-- $review_test$;
-- rollback;
