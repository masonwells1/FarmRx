\set ON_ERROR_STOP on

begin;

select set_config(
  'request.jwt.claim.sub',
  '27000000-0000-4000-8000-000000000001',
  true
);
select set_config(
  'request.headers',
  jsonb_build_object(
    'x-farm-rx-expected-user-id', '27000000-0000-4000-8000-000000000001',
    'x-farm-rx-access-epochs',
      jsonb_build_object('27010000-0000-4000-8000-000000000001', 1)::text
  )::text,
  true
);

create function pg_temp.maple_agreement_draft(
  p_arrangement_id uuid,
  p_effective_from date,
  p_type public.land_arrangement_type,
  p_cash_rent numeric default null
)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', '27020000-0000-4000-8000-0000000000f0',
    'name', 'Agreement History Probe',
    'operating_entity_id', '27011000-0000-4000-8000-000000000001',
    'total_acres', 40,
    'county', 'Jackson County',
    'state', 'IL',
    'legal_description', null,
    'fsa_farm_number', null,
    'fsa_tract_number', null,
    'soil_productivity_index', null,
    'arrangement', jsonb_build_object(
      'id', p_arrangement_id,
      'arrangement_type', p_type,
      'landlord_name', null,
      'landlord_phone', null,
      'landlord_contact_notes', null,
      'effective_from', p_effective_from,
      'cash_rent_per_acre', p_cash_rent,
      'flex_bonus_formula', null,
      'landlord_crop_pct', null,
      'landlord_seed_pct', 0,
      'landlord_fertilizer_pct', 0,
      'landlord_chemical_pct', 0,
      'landlord_fuel_pct', 0,
      'landlord_labor_custom_pct', 0,
      'landlord_crop_insurance_pct', 0,
      'landlord_equipment_pct', 0,
      'landlord_interest_pct', 0,
      'landlord_other_input_pct', 0,
      'notes', null
    ),
    'crop_assignments', jsonb_build_array()
  )
$$;

create function pg_temp.maple_expected_versions()
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'field_updated_at', f.updated_at,
    'arrangement', jsonb_build_object('id', a.id, 'updated_at', a.updated_at),
    'crop_assignments', jsonb_build_array()
  )
  from public.fields f
  join public.arrangements a
    on a.field_id = f.id
   and a.farm_id = f.farm_id
   and a.effective_to is null
  where f.id = '27020000-0000-4000-8000-0000000000f0'
$$;

\o /dev/null

select public.save_field_bundle_versioned(
  '27010000-0000-4000-8000-000000000001',
  '27090000-0000-4000-8000-0000000000f1',
  null,
  pg_temp.maple_agreement_draft(
    '27021000-0000-4000-8000-0000000000f1',
    '2027-01-12',
    'owned'
  )
);

select public.save_field_bundle_versioned(
  '27010000-0000-4000-8000-000000000001',
  '27090000-0000-4000-8000-0000000000f2',
  pg_temp.maple_expected_versions(),
  pg_temp.maple_agreement_draft(
    '27021000-0000-4000-8000-0000000000f1',
    '2027-01-01',
    'owned'
  )
);

do $$
begin
  if not exists (
    select 1 from public.arrangements
    where id = '27021000-0000-4000-8000-0000000000f1'
      and effective_from = '2027-01-01'
      and effective_to is null
  ) then raise exception 'date-only correction did not update the sole current agreement'; end if;
  if (select result -> 'arrangement' ->> 'effective_from'
      from public.repository_write_receipts
      where farm_id = '27010000-0000-4000-8000-000000000001'
        and operation_id = '27090000-0000-4000-8000-0000000000f2') <> '2027-01-01'
  then raise exception 'date-only correction receipt did not contain the canonical date'; end if;
end
$$;

select public.save_field_bundle_versioned(
  '27010000-0000-4000-8000-000000000001',
  '27090000-0000-4000-8000-0000000000f3',
  pg_temp.maple_expected_versions(),
  pg_temp.maple_agreement_draft(
    '27021000-0000-4000-8000-0000000000f2',
    '2028-01-01',
    'cash_rent',
    275
  )
);

do $$
begin
  if (select count(*) from public.arrangements
      where field_id = '27020000-0000-4000-8000-0000000000f0') <> 2
  then raise exception 'future changed terms did not create exactly one history row'; end if;
  if not exists (
    select 1 from public.arrangements
    where id = '27021000-0000-4000-8000-0000000000f1'
      and effective_from = '2027-01-01'
      and effective_to = '2027-12-31'
  ) then raise exception 'future changed terms did not close the prior agreement'; end if;
  if not exists (
    select 1 from public.arrangements
    where id = '27021000-0000-4000-8000-0000000000f2'
      and arrangement_type = 'cash_rent'
      and cash_rent_per_acre = 275
      and effective_from = '2028-01-01'
      and effective_to is null
  ) then raise exception 'future changed terms did not preserve the new current agreement'; end if;
end
$$;

-- A lost-response retry must return its immutable receipt after history has
-- advanced; it must not reinterpret the old date-only operation.
select public.save_field_bundle_versioned(
  '27010000-0000-4000-8000-000000000001',
  '27090000-0000-4000-8000-0000000000f2',
  null,
  pg_temp.maple_agreement_draft(
    '27021000-0000-4000-8000-0000000000f1',
    '2027-01-01',
    'owned'
  )
);

do $$
begin
  if (select count(*) from public.arrangements
      where field_id = '27020000-0000-4000-8000-0000000000f0') <> 2
     or not exists (
       select 1 from public.arrangements
       where id = '27021000-0000-4000-8000-0000000000f2'
         and effective_from = '2028-01-01'
         and effective_to is null
     )
  then raise exception 'receipt replay mutated newer agreement history'; end if;
end
$$;

select public.save_field_bundle_versioned(
  '27010000-0000-4000-8000-000000000001',
  '27090000-0000-4000-8000-0000000000f4',
  pg_temp.maple_expected_versions(),
  pg_temp.maple_agreement_draft(
    '27021000-0000-4000-8000-0000000000f2',
    '2028-02-01',
    'cash_rent',
    275
  )
);

do $$
begin
  if not exists (
    select 1 from public.arrangements
    where id = '27021000-0000-4000-8000-0000000000f1'
      and effective_to = '2028-01-31'
  ) or not exists (
    select 1 from public.arrangements
    where id = '27021000-0000-4000-8000-0000000000f2'
      and effective_from = '2028-02-01'
      and effective_to is null
  ) then raise exception 'date correction did not keep adjacent history continuous'; end if;
end
$$;

select public.save_field_bundle_versioned(
  '27010000-0000-4000-8000-000000000001',
  '27090000-0000-4000-8000-0000000000f5',
  pg_temp.maple_expected_versions(),
  pg_temp.maple_agreement_draft(
    '27021000-0000-4000-8000-0000000000f2',
    '2028-02-01',
    'cash_rent',
    300
  )
);

do $$
begin
  if (select count(*) from public.arrangements
      where field_id = '27020000-0000-4000-8000-0000000000f0') <> 2
     or not exists (
       select 1 from public.arrangements
       where id = '27021000-0000-4000-8000-0000000000f2'
         and cash_rent_per_acre = 300
         and effective_from = '2028-02-01'
         and effective_to is null
     )
  then raise exception 'same-day changed terms did not update the current agreement in place'; end if;
end
$$;

do $$
begin
  begin
    perform public.save_field_bundle_versioned(
      '27010000-0000-4000-8000-000000000001',
      '27090000-0000-4000-8000-0000000000f6',
      pg_temp.maple_expected_versions(),
      pg_temp.maple_agreement_draft(
        '27021000-0000-4000-8000-0000000000f2',
        '2026-12-31',
        'cash_rent',
        300
      )
    );
    raise exception 'invalid date correction crossed the previous agreement start';
  exception
    when others then
      if sqlerrm <> 'the current agreement must start after the previous agreement' then raise; end if;
  end;
  if exists (
    select 1 from public.repository_write_receipts
    where farm_id = '27010000-0000-4000-8000-000000000001'
      and operation_id = '27090000-0000-4000-8000-0000000000f6'
  ) then raise exception 'rejected date correction left a durable receipt'; end if;
end
$$;

\o
select 'CURRENT_ARRANGEMENT_HISTORY_PASS' as proof;

rollback;
