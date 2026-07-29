begin transaction read only;
do $proof$ begin
 if not exists (select 1 from public.production_estimates where id='27070000-0000-4000-8000-000000000001' and planted_acres=160 and aph_yield=200 and expected_bushels=32000 and actual_bushels=30800 and drives_math='actual') then raise exception 'MR October estimate/reconciliation is not exact'; end if;
 if exists (select 1 from public.grain_bins) or exists (select 1 from public.grain_contracts) or exists (select 1 from public.bin_transactions) then raise exception 'MR October introduced hidden storage or sale coupling'; end if;
 if exists (select 1 from public.alert_rule_states) or exists (select 1 from public.notifications) then raise exception 'MR October changed alerts or notifications'; end if;
end $proof$;
select 'MAPLE_2027_OCTOBER_VERIFY_PASS'; rollback;
