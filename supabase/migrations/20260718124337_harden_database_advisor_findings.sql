-- Resolve actionable Supabase database-advisor findings without widening the
-- Data API surface or changing Farm Rx authorization semantics.

-- Cache auth.uid() once per statement in the exact policies reported by the
-- auth_rls_initplan advisor. The surrounding farm/role predicates are
-- intentionally unchanged.
alter policy programs_insert on public.programs
with check (public.can_edit_farm(farm_id) and created_by = (select auth.uid()));

alter policy program_passes_insert on public.program_passes
with check (public.can_edit_farm(farm_id) and created_by = (select auth.uid()));

alter policy program_pass_products_insert on public.program_pass_products
with check (public.can_edit_farm(farm_id) and created_by = (select auth.uid()));

alter policy program_assignments_insert on public.program_assignments
with check (public.can_edit_farm(farm_id) and assigned_by = (select auth.uid()));

alter policy assigned_program_passes_insert on public.assigned_program_passes
with check (public.can_edit_farm(farm_id) and created_by = (select auth.uid()));

alter policy assigned_program_pass_products_insert on public.assigned_program_pass_products
with check (public.can_edit_farm(farm_id) and created_by = (select auth.uid()));

alter policy farms_insert on public.farms
with check (
  (select auth.uid()) is not null
  and created_by = (select auth.uid())
  and share_with_rep = false
);

alter policy farm_rep_access_insert on public.farm_rep_access
with check (public.can_manage_farm(farm_id) and granted_by = (select auth.uid()));

alter policy farm_rep_access_select on public.farm_rep_access
using (public.can_manage_farm(farm_id) or rep_user_id = (select auth.uid()));

alter policy inventory_receipts_insert on public.inventory_receipts
with check (
  public.can_edit_farm(farm_id)
  and created_by = (select auth.uid())
  and status = 'draft'::public.inventory_receipt_status
);

alter policy inventory_receipts_update on public.inventory_receipts
with check (
  public.can_edit_farm(farm_id)
  and (cancelled_by is null or cancelled_by = (select auth.uid()))
);

alter policy inventory_adjustments_insert on public.inventory_adjustments
with check (
  public.can_edit_farm(farm_id)
  and created_by = (select auth.uid())
  and exists (
    select 1
    from public.inventory_products p
    where p.id = inventory_adjustments.product_id
      and p.farm_id = inventory_adjustments.farm_id
  )
);

alter policy application_records_insert on public.application_records
with check (
  public.can_edit_farm(farm_id)
  and created_by = (select auth.uid())
  and status = 'draft'::public.application_record_status
  and (voided_by is null or voided_by = (select auth.uid()))
  and exists (
    select 1 from public.fields f
    where f.id = application_records.field_id
      and f.farm_id = application_records.farm_id
  )
  and exists (
    select 1 from public.crop_assignments ca
    where ca.id = application_records.crop_assignment_id
      and ca.field_id = application_records.field_id
      and ca.farm_id = application_records.farm_id
  )
  and (
    applicator_user_id is null
    or exists (
      select 1 from public.farm_memberships fm
      where fm.farm_id = application_records.farm_id
        and fm.user_id = application_records.applicator_user_id
        and fm.status = 'active'::public.farm_membership_status
    )
  )
);

alter policy application_records_update on public.application_records
with check (
  public.can_edit_farm(farm_id)
  and (voided_by is null or voided_by = (select auth.uid()))
  and exists (
    select 1 from public.fields f
    where f.id = application_records.field_id
      and f.farm_id = application_records.farm_id
  )
  and exists (
    select 1 from public.crop_assignments ca
    where ca.id = application_records.crop_assignment_id
      and ca.field_id = application_records.field_id
      and ca.farm_id = application_records.farm_id
  )
  and (
    applicator_user_id is null
    or exists (
      select 1 from public.farm_memberships fm
      where fm.farm_id = application_records.farm_id
        and fm.user_id = application_records.applicator_user_id
        and fm.status = 'active'::public.farm_membership_status
    )
  )
);

alter policy equipment_insert on public.equipment
with check (public.can_manage_farm(farm_id) and created_by = (select auth.uid()));

alter policy equipment_meter_readings_insert on public.equipment_meter_readings
with check (
  public.can_edit_farm(farm_id)
  and source = 'manual'
  and created_by = (select auth.uid())
);

alter policy equipment_service_intervals_insert on public.equipment_service_intervals
with check (public.can_manage_farm(farm_id) and created_by = (select auth.uid()));

alter policy field_log_entries_insert on public.field_log_entries
with check (public.can_edit_farm(farm_id) and created_by = (select auth.uid()));

alter policy equipment_service_log_insert on public.equipment_service_log
with check (public.can_edit_farm(farm_id) and created_by = (select auth.uid()));

alter policy scouting_notes_insert on public.scouting_notes
with check (public.can_edit_farm(farm_id) and created_by = (select auth.uid()));

alter policy scouting_photos_insert on public.scouting_photos
with check (public.can_edit_farm(farm_id) and created_by = (select auth.uid()));

alter policy push_subscriptions_select on public.push_subscriptions
using (user_id = (select auth.uid()));

alter policy farm_tasks_insert on public.farm_tasks
with check (public.can_edit_farm(farm_id) and created_by = (select auth.uid()));

alter policy notifications_select on public.notifications
using (user_id = (select auth.uid()) and public.can_access_farm(farm_id));

alter policy notifications_update on public.notifications
using (user_id = (select auth.uid()) and public.can_access_farm(farm_id))
with check (user_id = (select auth.uid()) and public.can_access_farm(farm_id));

-- enqueue_push_delivery is a trigger implementation, not a client RPC. It
-- executes as the notifications table owner when the trigger fires.
revoke all on function public.enqueue_push_delivery()
from public, anon, authenticated;

-- Keep the UNIQUE constraint-backed index and remove only the redundant
-- manually-created copy.
set lock_timeout = '5s';
set statement_timeout = '5min';

drop index if exists public.firm_offers_id_farm_id_idx;

-- Each index below is the minimum full B-tree left-prefix required to protect
-- a distinct foreign key during parent updates/deletes. Four existing partial
-- indexes begin with an FK column but exclude rows that still participate in
-- referential checks, so full indexes are added for those columns. No two
-- missing constraints share a reusable left prefix. Existing wider and partial
-- indexes are retained for their app query order.
create index if not exists farm_memberships_user_id_idx on public.farm_memberships (user_id);
create index if not exists farm_rep_access_rep_user_id_idx on public.farm_rep_access (rep_user_id);
create index if not exists inventory_receipts_farm_id_idx on public.inventory_receipts (farm_id);
create index if not exists notifications_farm_id_idx on public.notifications (farm_id);

create index if not exists application_products_farm_id_idx on public.application_products (farm_id);
create index if not exists application_records_applicator_membership_idx on public.application_records (farm_id, applicator_user_id);
create index if not exists application_records_assignment_same_farm_idx on public.application_records (crop_assignment_id, farm_id);
create index if not exists application_records_correction_same_farm_idx on public.application_records (corrects_application_id, farm_id);
create index if not exists application_records_created_by_idx on public.application_records (created_by);
create index if not exists application_records_field_same_farm_idx on public.application_records (field_id, farm_id);
create index if not exists application_records_voided_by_idx on public.application_records (voided_by);
create index if not exists assigned_program_pass_products_farm_id_idx on public.assigned_program_pass_products (farm_id);
create index if not exists assigned_program_products_catalog_same_farm_idx on public.assigned_program_pass_products (catalog_product_id, farm_id);
create index if not exists assigned_program_products_pass_same_farm_idx on public.assigned_program_pass_products (assigned_pass_id, farm_id);
create index if not exists assigned_program_products_source_same_farm_idx on public.assigned_program_pass_products (source_program_pass_product_id, farm_id);
create index if not exists assigned_program_passes_application_same_farm_idx on public.assigned_program_passes (application_record_id, farm_id);
create index if not exists assigned_program_passes_assignment_same_farm_idx on public.assigned_program_passes (assignment_id, farm_id);
create index if not exists assigned_program_passes_source_same_farm_idx on public.assigned_program_passes (source_program_pass_id, farm_id);
create index if not exists bin_inventory_commodity_id_idx on public.bin_inventory (commodity_id);
create index if not exists bin_transactions_commodity_id_idx on public.bin_transactions (commodity_id);
create index if not exists budget_field_allocations_farm_id_idx on public.budget_field_allocations (farm_id);
create index if not exists cash_bids_commodity_id_idx on public.cash_bids (commodity_id);
create index if not exists crop_budgets_commodity_id_idx on public.crop_budgets (commodity_id);
create index if not exists equipment_created_by_idx on public.equipment (created_by);
create index if not exists equipment_meter_readings_created_by_idx on public.equipment_meter_readings (created_by);
create index if not exists equipment_meter_readings_farm_id_idx on public.equipment_meter_readings (farm_id);
create index if not exists equipment_service_intervals_created_by_idx on public.equipment_service_intervals (created_by);
create index if not exists equipment_service_intervals_farm_id_idx on public.equipment_service_intervals (farm_id);
create index if not exists equipment_service_log_created_by_idx on public.equipment_service_log (created_by);
create index if not exists equipment_service_log_farm_id_idx on public.equipment_service_log (farm_id);
create index if not exists equipment_service_log_interval_same_farm_idx on public.equipment_service_log (interval_id, farm_id);
create index if not exists farm_tasks_assigned_to_idx on public.farm_tasks (assigned_to);
create index if not exists farm_tasks_completed_by_idx on public.farm_tasks (completed_by);
create index if not exists farm_tasks_created_by_idx on public.farm_tasks (created_by);
create index if not exists farm_tasks_equipment_same_farm_idx on public.farm_tasks (equipment_id, farm_id);
create index if not exists farm_tasks_field_same_farm_idx on public.farm_tasks (field_id, farm_id);
create index if not exists farm_tasks_interval_same_farm_idx on public.farm_tasks (interval_id, farm_id);
create index if not exists farm_tasks_program_pass_same_farm_idx on public.farm_tasks (program_assigned_pass_id, farm_id);
create index if not exists field_log_entries_field_farm_idx on public.field_log_entries (field_id, farm_id);
create index if not exists firm_offers_commodity_id_idx on public.firm_offers (commodity_id);
create index if not exists grain_contract_deliveries_farm_id_idx on public.grain_contract_deliveries (farm_id);
create index if not exists grain_contracts_commodity_id_idx on public.grain_contracts (commodity_id);
create index if not exists grain_contracts_firm_offer_idx on public.grain_contracts (firm_offer_id, farm_id);
create index if not exists insurance_units_commodity_id_idx on public.insurance_units (commodity_id);
create index if not exists inventory_adjustments_created_by_idx on public.inventory_adjustments (created_by);
create index if not exists inventory_adjustments_farm_id_idx on public.inventory_adjustments (farm_id);
create index if not exists inventory_products_commodity_id_idx on public.inventory_products (commodity_id);
create index if not exists inventory_receipt_lines_farm_id_idx on public.inventory_receipt_lines (farm_id);
create index if not exists inventory_receipts_cancelled_by_idx on public.inventory_receipts (cancelled_by);
create index if not exists inventory_receipts_created_by_idx on public.inventory_receipts (created_by);
create index if not exists marketing_alert_rules_commodity_id_idx on public.marketing_alert_rules (commodity_id);
create index if not exists marketing_plan_targets_commodity_id_idx on public.marketing_plan_targets (commodity_id);
create index if not exists production_estimates_commodity_id_idx on public.production_estimates (commodity_id);
create index if not exists profitability_matrix_steps_farm_id_idx on public.profitability_matrix_steps (farm_id);
create index if not exists program_assignments_crop_same_farm_idx on public.program_assignments (crop_assignment_id, farm_id);
create index if not exists program_assignments_program_same_farm_idx on public.program_assignments (program_id, farm_id);
create index if not exists program_pass_products_catalog_same_farm_idx on public.program_pass_products (catalog_product_id, farm_id);
create index if not exists program_pass_products_farm_id_idx on public.program_pass_products (farm_id);
create index if not exists program_pass_products_pass_same_farm_idx on public.program_pass_products (program_pass_id, farm_id);
create index if not exists program_passes_farm_id_idx on public.program_passes (farm_id);
create index if not exists program_passes_program_same_farm_idx on public.program_passes (program_id, farm_id);
create index if not exists programs_commodity_id_idx on public.programs (commodity_id);
create index if not exists scouting_notes_field_farm_idx on public.scouting_notes (field_id, farm_id);
create index if not exists scouting_photos_note_farm_idx on public.scouting_photos (note_id, farm_id);
create index if not exists spray_window_states_farm_id_idx on public.spray_window_states (farm_id);
create index if not exists spray_window_states_field_same_farm_idx on public.spray_window_states (field_id, farm_id);

reset lock_timeout;
reset statement_timeout;
