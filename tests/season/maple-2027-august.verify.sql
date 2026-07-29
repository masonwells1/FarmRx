begin transaction read only;
do $proof$ begin
 if not exists (select 1 from public.farm_tasks where id='27061000-0000-4000-8000-000000000001' and status='done' and completed_by='27000000-0000-4000-8000-000000000001' and completed_at=timestamptz '2027-08-17 18:00:00+00' and updated_at=timestamptz '2027-08-17 18:00:00+00') then raise exception 'MR August task completion is not exact/server-clocked'; end if;
 if (select count(*) from public.farm_tasks) <> 1 or (select count(*) from public.notifications) <> 0 then raise exception 'MR August created an unexpected task or notification'; end if;
end $proof$;
select 'MAPLE_2027_AUGUST_VERIFY_PASS'; rollback;
