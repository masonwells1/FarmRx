begin transaction read only;
do $proof$ begin
 if not exists (select 1 from public.crop_assignments where id='27030000-0000-4000-8000-000000000001' and harvested_bushels=30800 and harvest_date=date '2027-09-28' and actual_price_per_bu=4.25 and updated_at=timestamptz '2027-09-28 23:05:00+00') then raise exception 'MR September crop actual is not exact/server-clocked'; end if;
 if (select count(*) from public.repository_write_receipts where farm_id='27010000-0000-4000-8000-000000000001' and operation_id='27030000-0000-4000-8000-000000000001' and user_id='27000000-0000-4000-8000-000000000001' and completed_at=timestamptz '2027-09-28 23:05:00+00' and result->>'id'='27030000-0000-4000-8000-000000000001' and (result->>'harvested_bushels')::numeric=30800 and result->>'harvest_date'='2027-09-28' and (result->>'actual_price_per_bu')::numeric=4.25) <> 1 then raise exception 'MR September durable replay receipt is not exact'; end if;
 if exists (select 1 from public.production_estimates) or exists (select 1 from public.grain_bins) or exists (select 1 from public.grain_contracts) then raise exception 'MR September changed Grain before explicit reconciliation'; end if;
end $proof$;
select 'MAPLE_2027_SEPTEMBER_VERIFY_PASS'; rollback;
