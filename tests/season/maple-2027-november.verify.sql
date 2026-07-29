begin transaction read only;
do $proof$ begin
 if not exists (select 1 from public.grain_bins where id='27073000-0000-4000-8000-000000000001' and name='Maple North Bin' and capacity_bu=40000) then raise exception 'MR November bin is missing'; end if;
 if (select count(*) from public.bin_transactions where grain_bin_id='27073000-0000-4000-8000-000000000001') <> 2 then raise exception 'MR November movement count is not exact'; end if;
 if (select coalesce(sum(case direction when 'in' then bushels else -bushels end),0) from public.bin_transactions where grain_bin_id='27073000-0000-4000-8000-000000000001') <> 25800 then raise exception 'MR November bin balance is not 25800'; end if;
 if not exists (select 1 from public.grain_contracts where id='27071000-0000-4000-8000-000000000001' and contract_number='MR-2027-001' and bushels=5000) or not exists (select 1 from public.grain_contract_deliveries where id='27072000-0000-4000-8000-000000000001' and grain_contract_id='27071000-0000-4000-8000-000000000001' and bushels=5000) then raise exception 'MR November contract/delivery is not exact'; end if;
end $proof$;
select 'MAPLE_2027_NOVEMBER_VERIFY_PASS'; rollback;
