begin transaction read only;
do $proof$ begin
 if (select count(*) from public.repository_write_receipts where farm_id='27010000-0000-4000-8000-000000000001') < 10 then raise exception 'MR December retained receipt history is incomplete'; end if;
 if (select count(*) from public.farm_tasks where id='27061000-0000-4000-8000-000000000001' and status='done') <> 1 then raise exception 'MR December task closeout is not exact'; end if;
 if not exists (select 1 from public.production_estimates where id='27070000-0000-4000-8000-000000000001' and actual_bushels=30800 and drives_math='actual') then raise exception 'MR December Grain closeout is not exact'; end if;
end $proof$;
select 'MAPLE_2027_DECEMBER_VERIFY_PASS'; rollback;
