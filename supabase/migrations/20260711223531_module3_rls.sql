-- DRAFT ONLY -- Module 3 Row Level Security (RLS) for Farm Rx.
-- NEVER APPLIED BY THIS DESIGN SESSION.
--
-- Dependency: run after 0003_harden_bootstrap_function.sql (which means 0001
-- and 0002 already exist). This file does NOT require 0004-0010 except for its
-- own 0010 tables, and does NOT require 0008_employee_privacy.sql.
--
-- Privacy decision: inventory and application records are ordinary farm work
-- data. Workers commonly receive product and create spray records, so active
-- members follow can_access_farm()/can_edit_farm(). This is unlike strategic
-- grain positions and profitability. Named reps still need BOTH the farm share
-- toggle and their own current grant; reps receive no write policy.

alter table public.inventory_products enable row level security;
alter table public.inventory_receipts enable row level security;
alter table public.inventory_receipt_lines enable row level security;
alter table public.inventory_adjustments enable row level security;
alter table public.application_records enable row level security;
alter table public.application_products enable row level security;
alter table public.inventory_delivery_events enable row level security;

revoke all on table public.inventory_products from anon;
revoke all on table public.inventory_receipts from anon;
revoke all on table public.inventory_receipt_lines from anon;
revoke all on table public.inventory_adjustments from anon;
revoke all on table public.application_records from anon;
revoke all on table public.application_products from anon;
revoke all on table public.inventory_delivery_events from anon;
revoke all on table public.effective_application_records from anon;
revoke all on table public.inventory_on_hand from anon;
revoke all on table public.application_cost_lines from anon;
revoke all on table public.rup_application_completeness from anon;

grant select, insert, update, delete on table public.inventory_products to authenticated;
grant select, insert, update, delete on table public.inventory_receipts to authenticated;
grant select, insert, update, delete on table public.inventory_receipt_lines to authenticated;
grant select, insert on table public.inventory_adjustments to authenticated;
grant select, insert, update, delete on table public.application_records to authenticated;
grant select, insert, update, delete on table public.application_products to authenticated;
-- Delivery events are a future service integration inbox. Signed-in users may
-- inspect their farm's events but cannot forge or change external events.
grant select on table public.inventory_delivery_events to authenticated;
grant select on table public.effective_application_records to authenticated;
grant select on table public.inventory_on_hand to authenticated;
grant select on table public.application_cost_lines to authenticated;
grant select on table public.rup_application_completeness to authenticated;

create policy inventory_products_select
on public.inventory_products for select to authenticated
using (public.can_access_farm(farm_id));

create policy inventory_products_insert
on public.inventory_products for insert to authenticated
with check (public.can_edit_farm(farm_id));

create policy inventory_products_update
on public.inventory_products for update to authenticated
using (public.can_edit_farm(farm_id))
with check (public.can_edit_farm(farm_id));

create policy inventory_products_delete
on public.inventory_products for delete to authenticated
using (public.can_edit_farm(farm_id));

create policy inventory_receipts_select
on public.inventory_receipts for select to authenticated
using (public.can_access_farm(farm_id));

create policy inventory_receipts_insert
on public.inventory_receipts for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and created_by = auth.uid()
  and status = 'draft'
);

create policy inventory_receipts_update
on public.inventory_receipts for update to authenticated
using (public.can_edit_farm(farm_id))
with check (
  public.can_edit_farm(farm_id)
  and (cancelled_by is null or cancelled_by = auth.uid())
);

create policy inventory_receipts_delete
on public.inventory_receipts for delete to authenticated
using (
  public.can_edit_farm(farm_id)
  and status = 'draft'
);

create policy inventory_receipt_lines_select
on public.inventory_receipt_lines for select to authenticated
using (
  public.can_access_farm(farm_id)
  and exists (
    select 1 from public.inventory_receipts r
    where r.id = receipt_id and r.farm_id = inventory_receipt_lines.farm_id
  )
  and exists (
    select 1 from public.inventory_products p
    where p.id = product_id and p.farm_id = inventory_receipt_lines.farm_id
  )
);

create policy inventory_receipt_lines_insert
on public.inventory_receipt_lines for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.inventory_receipts r
    where r.id = receipt_id
      and r.farm_id = inventory_receipt_lines.farm_id
      and r.status = 'draft'
  )
  and exists (
    select 1 from public.inventory_products p
    where p.id = product_id and p.farm_id = inventory_receipt_lines.farm_id
  )
);

create policy inventory_receipt_lines_update
on public.inventory_receipt_lines for update to authenticated
using (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.inventory_receipts r
    where r.id = receipt_id
      and r.farm_id = inventory_receipt_lines.farm_id
      and r.status = 'draft'
  )
)
with check (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.inventory_receipts r
    where r.id = receipt_id
      and r.farm_id = inventory_receipt_lines.farm_id
      and r.status = 'draft'
  )
  and exists (
    select 1 from public.inventory_products p
    where p.id = product_id and p.farm_id = inventory_receipt_lines.farm_id
  )
);

create policy inventory_receipt_lines_delete
on public.inventory_receipt_lines for delete to authenticated
using (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.inventory_receipts r
    where r.id = receipt_id
      and r.farm_id = inventory_receipt_lines.farm_id
      and r.status = 'draft'
  )
);

create policy inventory_adjustments_select
on public.inventory_adjustments for select to authenticated
using (
  public.can_access_farm(farm_id)
  and exists (
    select 1 from public.inventory_products p
    where p.id = product_id and p.farm_id = inventory_adjustments.farm_id
  )
);

create policy inventory_adjustments_insert
on public.inventory_adjustments for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and created_by = auth.uid()
  and exists (
    select 1 from public.inventory_products p
    where p.id = product_id and p.farm_id = inventory_adjustments.farm_id
  )
);

create policy application_records_select
on public.application_records for select to authenticated
using (
  public.can_access_farm(farm_id)
  and exists (
    select 1 from public.fields f
    where f.id = field_id and f.farm_id = application_records.farm_id
  )
  and exists (
    select 1 from public.crop_assignments ca
    where ca.id = crop_assignment_id
      and ca.field_id = application_records.field_id
      and ca.farm_id = application_records.farm_id
  )
);

create policy application_records_insert
on public.application_records for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and created_by = auth.uid()
  and status = 'draft'
  and (voided_by is null or voided_by = auth.uid())
  and exists (
    select 1 from public.fields f
    where f.id = field_id and f.farm_id = application_records.farm_id
  )
  and exists (
    select 1 from public.crop_assignments ca
    where ca.id = crop_assignment_id
      and ca.field_id = application_records.field_id
      and ca.farm_id = application_records.farm_id
  )
  and (
    applicator_user_id is null
    or exists (
      select 1 from public.farm_memberships fm
      where fm.farm_id = application_records.farm_id
        and fm.user_id = applicator_user_id
        and fm.status = 'active'
    )
  )
);

create policy application_records_update
on public.application_records for update to authenticated
using (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.fields f
    where f.id = field_id and f.farm_id = application_records.farm_id
  )
  and exists (
    select 1 from public.crop_assignments ca
    where ca.id = crop_assignment_id
      and ca.field_id = application_records.field_id
      and ca.farm_id = application_records.farm_id
  )
)
with check (
  public.can_edit_farm(farm_id)
  and (voided_by is null or voided_by = auth.uid())
  and exists (
    select 1 from public.fields f
    where f.id = field_id and f.farm_id = application_records.farm_id
  )
  and exists (
    select 1 from public.crop_assignments ca
    where ca.id = crop_assignment_id
      and ca.field_id = application_records.field_id
      and ca.farm_id = application_records.farm_id
  )
  and (
    applicator_user_id is null
    or exists (
      select 1 from public.farm_memberships fm
      where fm.farm_id = application_records.farm_id
        and fm.user_id = applicator_user_id
        and fm.status = 'active'
    )
  )
);

create policy application_records_delete
on public.application_records for delete to authenticated
using (
  public.can_edit_farm(farm_id)
  and status = 'draft'
);

create policy application_products_select
on public.application_products for select to authenticated
using (
  public.can_access_farm(farm_id)
  and exists (
    select 1 from public.application_records ar
    where ar.id = application_id and ar.farm_id = application_products.farm_id
  )
  and exists (
    select 1 from public.inventory_products p
    where p.id = product_id and p.farm_id = application_products.farm_id
  )
);

create policy application_products_insert
on public.application_products for insert to authenticated
with check (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.application_records ar
    where ar.id = application_id
      and ar.farm_id = application_products.farm_id
      and ar.status = 'draft'
  )
  and exists (
    select 1 from public.inventory_products p
    where p.id = product_id and p.farm_id = application_products.farm_id
  )
);

create policy application_products_update
on public.application_products for update to authenticated
using (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.application_records ar
    where ar.id = application_id
      and ar.farm_id = application_products.farm_id
      and ar.status = 'draft'
  )
)
with check (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.application_records ar
    where ar.id = application_id
      and ar.farm_id = application_products.farm_id
      and ar.status = 'draft'
  )
  and exists (
    select 1 from public.inventory_products p
    where p.id = product_id and p.farm_id = application_products.farm_id
  )
);

create policy application_products_delete
on public.application_products for delete to authenticated
using (
  public.can_edit_farm(farm_id)
  and exists (
    select 1 from public.application_records ar
    where ar.id = application_id
      and ar.farm_id = application_products.farm_id
      and ar.status = 'draft'
  )
);

create policy inventory_delivery_events_select
on public.inventory_delivery_events for select to authenticated
using (
  public.can_access_farm(farm_id)
  and (
    receipt_id is null
    or exists (
      select 1 from public.inventory_receipts r
      where r.id = receipt_id and r.farm_id = inventory_delivery_events.farm_id
    )
  )
);

-- No INSERT/UPDATE/DELETE policy exists for delivery events. A future audited
-- server-side sync must add its own narrow ingestion function or service path.
-- No UPDATE/DELETE grant or policy exists for inventory_adjustments: corrections
-- are compensating signed entries. Completed receipt/application history is
-- additionally protected by 0010 triggers even for ordinary authenticated edits.
-- Every Module 3 view is SECURITY INVOKER and therefore inherits these policies.
-- 0008 changes no Module 3 policy; it still protects any Module 4 budget rows
-- that later reference application_cost_lines.source_record_id.
