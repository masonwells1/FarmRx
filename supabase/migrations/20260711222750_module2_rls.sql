-- DRAFT ONLY -- Module 2 Row Level Security (RLS) for Farm Rx.
-- Grain positions are the app's most private data. This extends the same 12
-- rules and helper functions established by 0002_module1_rls.sql.

-- Rule 1: every private Module 2 table has NOT NULL farm_id in 0004.
-- usda_report_dates is deliberately global and contains calendar facts only.
alter table public.production_estimates enable row level security;
alter table public.grain_contracts enable row level security;
alter table public.marketing_plan_targets enable row level security;
alter table public.insurance_units enable row level security;
alter table public.grain_bins enable row level security;
alter table public.bin_inventory enable row level security;
alter table public.cash_bids enable row level security;
alter table public.usda_report_dates enable row level security;

revoke all on table public.production_estimates from anon;
revoke all on table public.grain_contracts from anon;
revoke all on table public.marketing_plan_targets from anon;
revoke all on table public.insurance_units from anon;
revoke all on table public.grain_bins from anon;
revoke all on table public.bin_inventory from anon;
revoke all on table public.cash_bids from anon;
revoke all on table public.usda_report_dates from anon;
revoke all on table public.insurance_unit_guarantees from anon;

grant select, insert, update, delete on table public.production_estimates to authenticated;
grant select, insert, update, delete on table public.grain_contracts to authenticated;
grant select, insert, update, delete on table public.marketing_plan_targets to authenticated;
grant select, insert, update, delete on table public.insurance_units to authenticated;
grant select, insert, update, delete on table public.grain_bins to authenticated;
grant select, insert, update, delete on table public.bin_inventory to authenticated;
grant select, insert, update, delete on table public.cash_bids to authenticated;
grant select on table public.usda_report_dates to authenticated;
grant select on table public.insurance_unit_guarantees to authenticated;

-- Rules 2, 3, 4, and 12: can_access_farm() recalculates active membership or
-- an enabled named-rep grant on every read. Reps receive no write policy.
create policy production_estimates_select
on public.production_estimates for select to authenticated
using (
  public.can_access_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1
      from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = production_estimates.farm_id
    )
  )
);

create policy production_estimates_insert
on public.production_estimates for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1
      from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = production_estimates.farm_id
    )
  )
);

create policy production_estimates_update
on public.production_estimates for update to authenticated
using (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1
      from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = production_estimates.farm_id
    )
  )
)
with check (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1
      from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = production_estimates.farm_id
    )
  )
);

create policy production_estimates_delete
on public.production_estimates for delete to authenticated
using (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1
      from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = production_estimates.farm_id
    )
  )
);

create policy grain_contracts_select
on public.grain_contracts for select to authenticated
using (
  public.can_access_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = grain_contracts.farm_id
    )
  )
);

create policy grain_contracts_insert
on public.grain_contracts for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = grain_contracts.farm_id
    )
  )
);

create policy grain_contracts_update
on public.grain_contracts for update to authenticated
using (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = grain_contracts.farm_id
    )
  )
)
with check (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = grain_contracts.farm_id
    )
  )
);

create policy grain_contracts_delete
on public.grain_contracts for delete to authenticated
using (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = grain_contracts.farm_id
    )
  )
);

create policy marketing_plan_targets_select
on public.marketing_plan_targets for select to authenticated
using (
  public.can_access_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = marketing_plan_targets.farm_id
    )
  )
);

create policy marketing_plan_targets_insert
on public.marketing_plan_targets for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = marketing_plan_targets.farm_id
    )
  )
);

create policy marketing_plan_targets_update
on public.marketing_plan_targets for update to authenticated
using (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = marketing_plan_targets.farm_id
    )
  )
)
with check (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = marketing_plan_targets.farm_id
    )
  )
);

create policy marketing_plan_targets_delete
on public.marketing_plan_targets for delete to authenticated
using (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = marketing_plan_targets.farm_id
    )
  )
);

create policy insurance_units_select
on public.insurance_units for select to authenticated
using (
  public.can_access_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = insurance_units.farm_id
    )
  )
);

create policy insurance_units_insert
on public.insurance_units for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = insurance_units.farm_id
    )
  )
);

create policy insurance_units_update
on public.insurance_units for update to authenticated
using (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = insurance_units.farm_id
    )
  )
)
with check (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = insurance_units.farm_id
    )
  )
);

create policy insurance_units_delete
on public.insurance_units for delete to authenticated
using (
  public.can_edit_farm(farm_id)
  and (
    operating_entity_id is null
    or exists (
      select 1 from public.entities e
      where e.id = operating_entity_id
        and e.farm_id = insurance_units.farm_id
    )
  )
);

create policy grain_bins_select
on public.grain_bins for select to authenticated
using (public.can_access_farm(farm_id));

create policy grain_bins_insert
on public.grain_bins for insert to authenticated
with check (public.can_edit_farm(farm_id));

create policy grain_bins_update
on public.grain_bins for update to authenticated
using (public.can_edit_farm(farm_id))
with check (public.can_edit_farm(farm_id));

create policy grain_bins_delete
on public.grain_bins for delete to authenticated
using (public.can_edit_farm(farm_id));

-- Rules 5 and 10: the composite FK in 0004 proves the selected bin belongs to
-- the same farm. Policies repeat that parent check as defense in depth.
create policy bin_inventory_select
on public.bin_inventory for select to authenticated
using (
  public.can_access_farm(farm_id)
  and exists (
    select 1
    from public.grain_bins gb
    where gb.id = grain_bin_id
      and gb.farm_id = bin_inventory.farm_id
  )
);

create policy bin_inventory_insert
on public.bin_inventory for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and exists (
    select 1
    from public.grain_bins gb
    where gb.id = grain_bin_id
      and gb.farm_id = bin_inventory.farm_id
  )
);

create policy bin_inventory_update
on public.bin_inventory for update to authenticated
using (
  public.can_edit_farm(farm_id)
  and exists (
    select 1
    from public.grain_bins gb
    where gb.id = grain_bin_id
      and gb.farm_id = bin_inventory.farm_id
  )
)
with check (
  public.can_edit_farm(farm_id)
  and exists (
    select 1
    from public.grain_bins gb
    where gb.id = grain_bin_id
      and gb.farm_id = bin_inventory.farm_id
  )
);

create policy bin_inventory_delete
on public.bin_inventory for delete to authenticated
using (
  public.can_edit_farm(farm_id)
  and exists (
    select 1
    from public.grain_bins gb
    where gb.id = grain_bin_id
      and gb.farm_id = bin_inventory.farm_id
  )
);

create policy cash_bids_select
on public.cash_bids for select to authenticated
using (public.can_access_farm(farm_id));

create policy cash_bids_insert
on public.cash_bids for insert to authenticated
with check (public.can_edit_farm(farm_id));

create policy cash_bids_update
on public.cash_bids for update to authenticated
using (public.can_edit_farm(farm_id))
with check (public.can_edit_farm(farm_id));

create policy cash_bids_delete
on public.cash_bids for delete to authenticated
using (public.can_edit_farm(farm_id));

-- Like commodities, USDA dates are safe for every signed-in user to read.
-- There is no authenticated write grant or write policy; trusted maintenance
-- runs through an administrative/service path outside the customer role.
create policy usda_report_dates_select
on public.usda_report_dates for select to authenticated
using (true);

-- Rule 6: every UPDATE policy above checks both the old row (USING) and the
-- proposed row (WITH CHECK). prevent_farm_id_change() also makes farm stamps
-- immutable. INSERT policies use WITH CHECK; DELETE policies use USING, which
-- are the only clauses PostgreSQL permits for those command types.

-- Rule 7: Module 2 creates no SECURITY DEFINER functions and cannot bypass the
-- caller's identity. It reuses only the restricted helpers from 0002.

-- Rule 8: insurance_unit_guarantees is SECURITY INVOKER, so selecting from it
-- still evaluates insurance_units RLS as the signed-in caller.

-- Rule 9: Module 2 creates no storage bucket or object policy. Any future grain
-- attachments must use the farm_id-first path and policies established in 0002.

-- Rule 11: grain records are editable business data, not regulated spray logs;
-- Module 2 therefore follows the standard audited updated_at pattern.
