\set ON_ERROR_STOP on
do $verify$
begin
  if (select count(*) from public.field_log_entries) <> 1 then raise exception 'unexpected field-log row count'; end if;
  if (select count(*) from public.field_log_entries
      where id='27080000-0000-4000-8000-000000000001'
        and farm_id='27010000-0000-4000-8000-000000000006'
        and field_id='27020000-0000-4000-8000-000000000006'
        and entry_type='note' and observed_on='2027-08-04'
        and rainfall_in is null and note='Synthetic north fence washed out'
        and created_by='27000000-0000-4000-8000-000000000003'
        and created_at='2027-08-04 19:10:00+00'
        and updated_at='2027-08-04 19:10:00+00') <> 1 then
    raise exception 'connected Pine note is not exact';
  end if;
  if exists(select 1 from public.field_log_entries where id='27080000-0000-4000-8000-000000000002')
     or exists(select 1 from public.field_log_entries where note='Synthetic revoked-user note') then
    raise exception 'revoked Pine note reached the database';
  end if;
  if (select count(*) from public.repository_write_receipts
      where operation_id='27090000-0000-4000-8000-000000000001'
        and farm_id='27010000-0000-4000-8000-000000000006'
        and user_id='27000000-0000-4000-8000-000000000003'
        and completed_at='2027-08-04 19:10:00+00'
        and result->>'id'='27080000-0000-4000-8000-000000000001') <> 1 then
    raise exception 'connected Pine receipt is not exact';
  end if;
  if exists(select 1 from public.repository_write_receipts where operation_id='27090000-0000-4000-8000-000000000002') then
    raise exception 'revoked Pine operation received a receipt';
  end if;
  if (select status from public.farm_memberships where farm_id='27010000-0000-4000-8000-000000000006' and user_id='27000000-0000-4000-8000-000000000003') <> 'revoked' then
    raise exception 'Pine worker membership is not revoked';
  end if;
  if (select access_epoch from public.farm_access_epochs where farm_id='27010000-0000-4000-8000-000000000006' and user_id='27000000-0000-4000-8000-000000000003') <> 2 then
    raise exception 'Pine worker epoch is not 2';
  end if;
  if (select count(*) from public.farm_memberships) <> 4
     or (select count(*) from public.farms) <> 2
     or (select count(*) from public.fields) <> 1
     or (select count(*) from public.crop_assignments) <> 1 then
    raise exception 'Pine fixture cardinality drifted';
  end if;
end
$verify$;
select 'PINE_HILL_2027_VERIFY_PASS';
