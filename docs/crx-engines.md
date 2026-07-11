# CRX Manager Engine Extraction for Farm Rx

## 1. FIELDS ENGINE

### 1.1 Current CRX schema

CRX does not have separate `farms`, `legal_entities`, or `landlords` tables. The `customers` table represents a farm account, legal/billing entity, grower, tenant, or landlord depending on context.

| Table | Key columns and relationships | Source |
|---|---|---|
| `customers` | `id`, `farm_name`, `contact_name`, `phone`, `email`, `billing_address`, `shipping_address`, `city`, `state`, `zip`, `account_number`, `assigned_tier`, `assigned_sales_rep`, `parent_customer_id`, `total_acres`, `corn_acres`, `soybean_acres`, `other_acres`, `payment_terms`, `is_active`. `parent_customer_id → customers.id` creates farm-account hierarchies. | `supabase/migrations/20260206172436_create_full_schema_v2.sql`, `supabase/migrations/20260213000000_phase1_fields_foundation.sql`, `src/types/index.ts` (`Customer`) |
| `fields` | `id`, `customer_id → customers.id`, `field_name`, `legal_description`, `county`, `state`, `total_acres`, `measured_acres`, `override_acres`, generated `acres_source`, `fsa_farm_number`, `fsa_tract_number`, `fsa_field_number`, `crop_type`, `soil_type`, `irrigation`, `centroid`, `boundary`, `boundary_geom`, `parent_field_id → fields.id`, `notes`, `is_active`, timestamps. | `supabase/migrations/20260213000000_phase1_fields_foundation.sql`, `supabase/migrations/20260334900000_field_grouping_multi_polygon.sql`, `supabase/migrations/20260623120000_fields_two_acre_model.sql`, `src/types/index.ts` (`Field`) |
| `field_polygons` | `id`, `field_id → fields.id`, `polygon_geojson`, `label`, `acres`, `sort_order`, `created_at`. Supports multi-part fields. | `supabase/migrations/20260334900000_field_grouping_multi_polygon.sql` |
| `field_crop_history` | `id`, `field_id → fields.id`, `season`, `crop_type`, `variety`, `planting_date`, `harvest_date`, `yield_per_acre`, `yield_unit`, `notes`. Unique on `(field_id, season)`. | `supabase/migrations/20260335400000_workflow_gaps_phase5_crop_history.sql` |
| `field_billing_defaults` | `id`, `field_id → fields.id`, `customer_id → customers.id`, `split_pct`, `is_primary`, `notes`, `price_override_cents`, `pricing_note`, timestamps. Unique on `(field_id, customer_id)`. | `supabase/migrations/20260213000000_phase1_fields_foundation.sql`, `supabase/migrations/20260221200000_grower_share_pricing.sql`, `src/types/index.ts` (`FieldBillingDefault`) |
| `job_fields` | `id`, `job_id → jobs.id`, `field_id → fields.id`, `acres_to_treat`, `planted_acres`, `crop`, `strip`, `pests`, `sort_order`. Unique on `(job_id, field_id)`. | `supabase/migrations/20260215200000_job_scheduling_tables.sql`, `supabase/migrations/20260624120000_job_parity_scheduling_agronomy_shares.sql`, `src/types/index.ts` (`JobField`) |
| `job_field_shares` | `id`, `job_id → jobs.id`, `field_id → fields.id`, `customer_id → customers.id`, `split_pct`, `is_primary`, `created_at`. Unique on `(job_id, field_id, customer_id)`. | `supabase/migrations/20260624120000_job_parity_scheduling_agronomy_shares.sql`, `src/types/index.ts` (`JobFieldShare`) |
| `field_app_locations` | `id`, `invoice_id`, `job_id`, `invoice_group_id`, `field_id → fields.id`, `map_number`, `total_acres`, `planted_acres`, `applied_acres`, `crop_type`, `wind_direction`, `sort_order`. At least one parent identifier is required. | `supabase/migrations/20260406100000_field_app_workflow_v2.sql`, `supabase/migrations/20260429140635_field_app_workflow_phase1.sql`, `src/types/index.ts` (`FieldAppLocation`) |
| `field_app_location_shares` | `id`, `location_id → field_app_locations.id`, `customer_id → customers.id`, `split_pct`, `acres`, `amount_cents`, `created_at`. | `supabase/migrations/20260406100000_field_app_workflow_v2.sql`, `src/types/index.ts` (`FieldAppLocationShare`) |

### 1.2 Acreage model

CRX has three acreage values:

```text
billable acres =
  override_acres
  ?? measured_acres
  ?? total_acres
```

- `measured_acres` is calculated server-side from `boundary_geom` with PostGIS.
- `override_acres` is the human-entered billable acreage and survives a boundary redraw.
- `total_acres` remains as the legacy compatibility value.
- `acres_source` is generated as `override`, `measured`, or `legacy`.
- Existing mapped fields were backfilled with `override_acres = total_acres` to prevent a map redraw or migration from silently changing billing.

The authoritative writers are `set_field_boundary()` and `set_field_override_acres()` in `supabase/migrations/20260623130000_set_field_boundary_rpc.sql`. Direct changes to `measured_acres`, `override_acres`, and `boundary_geom` are rejected by an acreage-authority trigger.

Relevant safeguards include:

- Geometry is normalized with `ST_MakeValid`, polygon extraction, union, and `ST_Multi`.
- Measured acreage must be between `0.1` and `5,000` acres.
- Overrides must round to greater than zero and no more than `5,000` acres.
- `find_overlapping_fields()` identifies likely duplicate boundaries using intersection percentage.
- A field cannot be its own `parent_field_id`.
- `link_fields_to_parent()` rejects using an existing child as a parent.

### 1.3 Entities, owners, and crop-share relationships

CRX overloads `customers` for several concepts:

- `fields.customer_id` is the default field owner/account.
- `customers.parent_customer_id` groups related customer accounts.
- Each `field_billing_defaults.customer_id` is a bill-to owner for part of a field.
- `is_primary` identifies the preferred owner/customer.
- If a field has no billing defaults, invoice logic falls back to `fields.customer_id` at 100%.

This works for distributor billing, but it does not cleanly distinguish:

- A farm workspace
- A legal entity
- A landowner
- A tenant/operator
- A billing recipient
- A person with app access

Farm Rx should separate those concepts.

### 1.4 Billing and landlord-share calculations

#### Field setup

`save_field()` validates that supplied field defaults total 100%, within `0.01`, and then replaces the field’s current defaults atomically.

Sources:

- `supabase/migrations/20260213000000_phase1_fields_foundation.sql`
- `supabase/migrations/20260221200000_grower_share_pricing.sql`
- UI: `src/pages/FieldSetup.tsx`

Each individual `split_pct` must be greater than zero and no more than 100. The database unique constraint prevents the same customer from appearing twice on one field.

#### Acre-weighted customer shares

`derive_customer_shares_from_fields()` calculates:

```text
share_acres = applied_acres × split_pct / 100
```

It then aggregates each customer’s share across all selected fields:

```text
overall_split_pct =
  customer total share acres
  / all customers' total share acres
  × 100
```

Applied acres come from the passed field/acres map, falling back to `fields.total_acres`. A field without defaults falls back to its `fields.customer_id` at 100%.

Sources:

- `supabase/migrations/20260429140635_field_app_workflow_phase1.sql`
- Call site: `src/pages/FieldApplicationInvoice.tsx`
- Client consistency handling: `src/components/field-app/customerSplit.ts`

#### Grower-share price overrides

When `field_billing_defaults.price_override_cents` is present, the amount is calculated as:

```text
amount_cents = price_override_cents × share_acres
```

Without an override, chemical quantities and application fees are allocated using the customer’s share acres and pricing tier.

Sources:

- `supabase/migrations/20260221200000_grower_share_pricing.sql`
- `supabase/migrations/20260429140635_field_app_workflow_phase1.sql`

#### Spray-job landlord/tenant invoicing

For an explicitly configured multi-owner spray job, `transfer_job_to_invoice()`:

1. Computes each owner’s billable acres from `job_fields.acres_to_treat × split_pct`.
2. Falls back to the field’s customer at 100% for fields without defaults.
3. Converts owner acres into percentages of total billable acres.
4. Creates one payable invoice per owner, linked by `invoices.invoice_group_id`.
5. Splits each chemical’s price and cost by owner acreage.
6. Calculates each owner’s application fee using that owner’s acres and customer-specific rate.

Source: `supabase/migrations/20260707140000_u7_spray_job_split_group.sql`.

Money is divided with `calculate_billing_splits()`, a largest-remainder algorithm that floors each calculated share and distributes remaining pennies to the largest fractional remainders. The returned amounts therefore sum exactly to the original bigint-cent total.

Source: `supabase/migrations/20260213100000_phase2_billing_architecture.sql`.

### 1.5 Constraints and edge cases

- Field defaults must total 100%; partial or overallocated fields are rejected.
- Multi-owner job invoicing rejects fields whose split totals fall outside `99.99–100.01`.
- A multi-owner job with zero billable acres is rejected.
- Per-field price overrides are rejected by the multi-owner spray-job split path with `SPLIT_OVERRIDE_UNSUPPORTED`; the field-application editor must handle that pricing mode.
- Missing billing defaults silently fall back to the field customer at 100%. Farm Rx should show this fallback explicitly.
- CRX’s `field_crop_history` unique key `(field_id, season)` permits only one crop per field per year. It cannot represent wheat followed by double-crop soybeans.
- `fields.crop_type`, `job_fields.crop`, and `field_app_locations.crop_type` duplicate crop state at several grains and can drift.
- `customers.parent_customer_id` is only a hierarchy; it does not define legal ownership or farm membership.
- Parent/child fields support only a shallow grouping rule in the RPC. The database constraint prevents self-reference but does not independently prevent every possible longer cycle.
- Share percentages are stored at several grains—field defaults, job fields, application locations, invoice shares, and allocation rows—so provenance must be clear when a value is copied or overridden.

## 2. INVENTORY ENGINE

### 2.1 Product and inventory schema

CRX uses one shared `products` table. Chemical, fertilizer, biological, seed-treatment, and other products are distinguished primarily by free-text `category`; there is no enforced `product_kind` for chemical versus seed versus fertilizer.

| Table | Key columns | Source |
|---|---|---|
| `products` | `id`, `product_name`, `sku`, `category`, `vendor`, `manufacturer`, `container_size`, `unit_size`, `product_form`, `inventory_unit`, `container_unit`, `container_type`, `current_cost`, tier prices/margins, per-acre prices, `suggested_rate`, `rate_per_acre`, `rate_unit`, `epa_registration`, `is_rup`, `signal_word`, `rei_hours`, `phi_days`, `max_label_rate`, `max_label_rate_unit`, `notes`, `internal_notes`, `is_active`, timestamps. | `supabase/migrations/20260206172436_create_full_schema_v2.sql`, `supabase/migrations/20260206195903_add_epa_registration_to_products.sql`, `supabase/migrations/20260211000000_unit_tracking_pricing_overhaul.sql`, `supabase/migrations/20260213200000_phase7_reporting_compliance_rebates.sql`, `supabase/migrations/20260610193241_products_rei_phi_label_data.sql`, `supabase/migrations/20260629210000_product_label_drafts.sql`, `src/types/index.ts` (`Product`) |
| `inventory` | `id`, `product_id → products.id`, `location`, `quantity_available`, `quantity_prebooked`, `quantity_on_order`, `unit_size`, `reorder_point`, `min_stock_level`, `last_counted_at`, `manufactured_at_delivery`, `updated_at`. | `supabase/migrations/20260206172436_create_full_schema_v2.sql`, `src/types/index.ts` (`Inventory`) |
| `inventory_transactions` | `id`, `product_id`, `transaction_type`, `quantity`, `from_location`, `to_location`, `order_id`, `purchase_order_id`, `delivery_id`, `performed_by`, `notes`, `created_at`. | `supabase/migrations/20260206172436_create_full_schema_v2.sql` |
| `receiving_records` | `id`, `purchase_order_id`, `po_item_id`, `product_id`, `quantity_received`, `received_by`, `received_at`, `notes`, `condition`, `lot_number`, `storage_location`, `unit_size`, `is_non_returnable`, `created_at`. | `src/types/index.ts` (`ReceivingRecord`), `supabase/migrations/20260301100000_tote_tracking.sql` |
| `warehouses` | `id`, `name`, `code`, `address`, `city`, `state`, `is_active`, `is_default`, timestamps. | `src/types/index.ts` (`Warehouse`) |

The product master is useful for chemical-label data, but its distributor pricing, gross margin, commission, and warehouse attributes should not be copied wholesale into a farmer-facing app.

### 2.2 Delivery schema

| Table | Key columns | Source |
|---|---|---|
| `deliveries` | `id`, `delivery_number`, `order_id`, `customer_id`, `delivery_address_id`, `assigned_driver`, `scheduled_date`, `scheduled_time`, `status`, `delivery_notes`, `completed_at`, `signature_url`, `signed_by`, `receipt_pdf_url`, `season`, `deleted_at`, `priority`, delivery-window fields, cancellation fields, issue fields, edit-audit fields, `is_quick_delivery`, `created_by`, timestamps. Statuses include `scheduled`, `in_progress`, `completed`, `cancelled`, and `voided`. | `supabase/migrations/20260206172436_create_full_schema_v2.sql`, `supabase/migrations/20260213000000_phase1_fields_foundation.sql`, `supabase/migrations/20260225200000_delivery_system_enhancements.sql`, `supabase/migrations/20260227200000_delivery_integrity_and_quick_delivery.sql`, `supabase/migrations/20260331110000_void_delivery.sql`, `src/types/index.ts` (`Delivery`) |
| `delivery_items` | `id`, `delivery_id → deliveries.id`, `order_item_id`, `product_id`, planned `quantity`, actual `quantity_delivered`, `unit_size`, `notes`, `tote_number`. | `supabase/migrations/20260206172436_create_full_schema_v2.sql`, `supabase/migrations/20260211290000_partial_delivery_support.sql`, `supabase/migrations/20260301100000_tote_tracking.sql`, `src/types/index.ts` (`DeliveryItem`) |
| `delivery_photos` | `id`, `delivery_id`, storage path/URL, caption, uploader, upload time, file size, sort order. | `supabase/migrations/20260225200000_delivery_system_enhancements.sql`, `src/types/index.ts` (`DeliveryPhoto`) |
| `delivery_remainders` | Links an incomplete delivery back to its order, order item, customer, and product with `quantity_remaining`, status, optional follow-up delivery, reminders, escalation, and notes. | `supabase/migrations/20260225200000_delivery_system_enhancements.sql`, `src/types/index.ts` (`DeliveryRemainder`) |

Farm Rx needs a much smaller delivery model: what arrived, from whom, quantity/unit, date, storage location, lot number, receipt/photo, and optional connection to an order.

### 2.3 Spray and application records

CRX has both operational job records and durable compliance records.

#### Planned job

- `jobs`: customer, status, planned date/time, applicator, vehicle, total/planned/applied/remaining acres, service, scheduling metadata, notes, and invoice linkage.
- `job_fields`: fields and acres to treat.
- `job_chemicals`: `product_id`, `quantity`, `unit`, `rate_per_acre`, `rate_unit`, cost/price cents, `diluent_rate`, `rei_hours`, `phi_days`, `warehouse`, `vendor`, `customer_supplied`, and sort order.
- `job_field_shares`: per-job field billing ownership.

Sources:

- `supabase/migrations/20260215200000_job_scheduling_tables.sql`
- `supabase/migrations/20260624120000_job_parity_scheduling_agronomy_shares.sql`
- `supabase/migrations/20260706080000_customer_supplied_chemicals.sql`
- `src/types/index.ts` (`JobChemical`, `JobField`, `JobFieldShare`)

#### As-applied operational entries

`job_applied_records` supports multiple passes per job:

- `id`, `job_id`
- `applicator_id`, `vehicle_id`
- `application_date`
- `applied_acres`
- Start and end weather time, temperature, wind direction, wind speed, humidity, and `auto`/`manual` source
- Beginning/end tach readings and generated `net_tach`
- `notes`, `created_by`, timestamps
- Idempotency key for duplicate-submit protection

Per-field applied acres live in `job_applied_record_fields`:

- `application_record_id`
- `field_id`
- `applied_acres`
- Unique `(application_record_id, field_id)`

Crew members live in `job_applied_record_crew`, including durable member and crew name snapshots so later catalog deletion does not erase historical proof.

Sources:

- `supabase/migrations/20260624170000_job_applied_records.sql`
- `supabase/migrations/20260624180000_job_applied_record_fields.sql`
- `supabase/migrations/20260624190000_job_applied_record_weather.sql`
- `supabase/migrations/20260624200000_job_applied_record_tach.sql`
- `supabase/migrations/20260624210000_job_applied_record_crew.sql`
- `supabase/migrations/20260711020000_save_job_applied_record_idempotency.sql`

#### Durable application record

`application_records` contains:

- `id`, unique `record_number`
- `source_type` (`job` or `blend_ticket`) and polymorphic `source_id`
- `customer_id`
- `applicator_id`
- Snapshotted `applicator_name` and `applicator_license_number`
- Deprecated single `field_id`
- `application_date`, `application_time`
- `product_data` JSONB
- `total_acres`, `total_volume`, `total_volume_unit`
- `vehicle_id`
- `weather_conditions` JSONB
- `notes`, `season`, `invoice_id`
- `created_by`, timestamps

Each `product_data` entry currently contains:

```text
product_id
product_name
quantity
unit
rate_per_acre
rate_unit
epa_registration
is_rup
customer_supplied
```

Weather contains:

```text
wind_speed
wind_direction
temperature
humidity
```

Sources:

- `supabase/migrations/20260214220000_application_records_table.sql`
- `supabase/migrations/20260707050000_application_record_integrity.sql`
- `src/types/index.ts` (`ApplicationRecord`, `ApplicationProduct`, `WeatherConditions`)

Multi-field detail is normalized in `application_record_fields` with `application_record_id`, `field_id`, `acres`, and `sort_order`.

Source: `supabase/migrations/20260430150000_field_app_workflow_phase2.sql`.

Lot traceability is normalized in `application_record_lots`:

- `application_record_id`
- `product_id`
- `lot_number`
- `source_receiving_record_id`
- `quantity_from_lot`
- `unit`
- `notes`
- `created_by`, `created_at`

Blank lot numbers, negative quantities, and duplicate normalized `(record, product, lot)` combinations are rejected. Writes are RPC-only.

Source: `supabase/migrations/20260622170000_application_record_lots.sql`.

### 2.4 REI, PHI, EPA, and RUP compliance

- EPA registration, RUP status, signal word, REI, PHI, and maximum label rate are stored on `products`.
- REI and PHI can also be copied onto `job_chemicals`.
- EPA registration, rate, quantity, unit, and RUP status are snapshotted into `application_records.product_data`.
- REI, PHI, signal word, and maximum label rate are **not** currently snapshotted into each durable application product entry. A later product edit can therefore change what the current product catalog says without preserving all label values used at application time.
- `applicator_licenses` stores `customer_id` or `profile_id`, `license_number`, `license_type`, holder, state, issued/expiry dates, certification categories, active status, and notes.
- `_enforce_applicator_license()` blocks assignment when a known active staff license is expired, but permits assignment when no license row exists. Admins can explicitly override through `assign_job_applicator()`.
- Completing a job snapshots the applicator’s name and preferred active license number onto `application_records`.
- The actual application date is derived from the application start timestamp in `America/Chicago`, falling back to the planned job date.

Sources:

- `supabase/migrations/20260213200000_phase7_reporting_compliance_rebates.sql`
- `supabase/migrations/20260610185714_applicator_license_gates.sql`
- `supabase/migrations/20260707050000_application_record_integrity.sql`

### 2.5 RUP sales compliance structure

`rup_sales_records` is a sale register, not the spray application log. It stores:

- Invoice, order, customer, and product IDs
- Sale date, product name, EPA registration, quantity, unit, unit price, total
- Buyer name and certification number/type/expiry
- Signal word
- `compliance_status`: `compliant`, `warning`, or `non_compliant`
- Compliance notes
- Season, creator, and void metadata

`generate_rup_sales_records()` creates rows only for invoiced products where `products.is_rup = true`. It marks:

- Missing buyer license as `non_compliant`
- Expired buyer license as `warning`
- A current license as `compliant`

It also avoids duplicate active rows for the same invoice and product.

Sources:

- `supabase/migrations/20260307100000_accounts_payable_and_rup_reporting.sql`
- `supabase/migrations/20260630173050_parked_006_rup_sales_records_unpost_void.sql`
- `supabase/migrations/20260707040000_generate_rup_sales_records_role_gate.sql`

## 3. PORTING RECOMMENDATIONS FOR FARM RX

### 3.1 Port, simplify, or skip

| CRX capability | Recommendation | Farm Rx treatment |
|---|---|---|
| Measured/override/legacy acreage precedence | **Port as-is** | Preserve server-measured acres separately from farmer-entered certified/billable acres. Keep geometry writes server-controlled. |
| PostGIS geometry normalization and overlap detection | **Port as-is** | Valuable for field import, duplicate detection, maps, and acreage integrity. |
| Field billing percentages | **Simplify** | Keep field-to-entity ownership/crop-share percentages, but separate legal entities from people and farm workspaces. |
| Largest-remainder cent allocation | **Port as-is when money is allocated** | Use it for landlord/tenant expense or revenue splits so child totals always equal the parent total. |
| `customers` as farm, entity, owner, and user-access scope | **Do not port** | Replace with explicit `farms`, `legal_entities`, memberships, and field/entity shares. |
| `fields.crop_type` plus crop snapshots in jobs/locations | **Do not port as the source of truth** | Use normalized yearly crop-assignment rows. Snapshots may remain on historical application records. |
| Product label metadata | **Port and strengthen** | Keep EPA, RUP, signal word, REI, PHI, rate limits, and units. Normalize product kinds and snapshot regulatory values at application time. |
| Distributor tier pricing, margins, commissions, rebates, AP/AR | **Skip initially** | These are internal distributor concerns, not farmer PWA requirements. |
| Full warehouse/prebook/PO engine | **Simplify heavily** | Start with farm inventory balances, receipts, lots, storage locations, adjustments, and application consumption. |
| Delivery state machine | **Simplify** | Use expected, received, partially received, cancelled, plus receipt/photo and lot capture. |
| Job scheduling and multiple as-applied passes | **Port the model, simplify the UI** | A farmer still needs planned work versus actual passes, partial-field applications, multiple dates, applicators, and machines. |
| Application records, per-field acres, lots, weather, applicator snapshots | **Port and normalize further** | This is the strongest reusable engine. |
| RUP sales register | **Skip unless Farm Rx sells RUP products** | Farm Rx primarily needs purchase and application compliance, not distributor sales-register generation. |
| CRX invoice groups and statement compatibility layers | **Skip** | Use direct entity expense/revenue allocations without distributor invoice compatibility tables. |

### 3.2 Recommended Farm Rx field and entity model

```text
farms
- id
- name
- share_with_rep
- created_by
- timestamps

farm_memberships
- farm_id
- user_id
- role: owner | manager | worker | read_only
- status
- unique(farm_id, user_id)

farm_rep_access
- farm_id
- rep_user_id
- enabled
- granted_by
- granted_at
- revoked_at
- unique(farm_id, rep_user_id)

legal_entities
- id
- farm_id
- name
- entity_type: individual | sole_prop | partnership | llc | corporation | trust
- tax/display metadata
- is_active

fields
- id
- farm_id
- default_operating_entity_id
- name
- legal/FSA/location columns
- measured_acres
- override_acres
- generated acres_source
- boundary_geom
- is_active
- timestamps

field_entity_shares
- id
- farm_id
- field_id
- legal_entity_id
- relationship_type: owner | tenant | operator | crop_share
- expense_split_pct
- revenue_split_pct
- effective_from
- effective_to
- is_primary
- unique(field_id, legal_entity_id, effective_from)
```

Keep expense and revenue percentages separate. A landlord may pay 50% of chemicals but receive a different percentage of crop revenue; one generic `split_pct` cannot represent both safely.

Every business row should carry `farm_id`, even when it can technically be derived through another table. This makes RLS, indexing, offline synchronization, and audit review substantially safer.

### 3.3 Crop assignments must be first-class rows

Do not copy CRX’s unique `(field_id, season)` crop-history design. It prevents multiple crops in the same year.

Recommended model:

```text
commodities
- id
- code
- name
- crop_family
- traits
- is_active
```

Seed distinct commodity rows such as:

```text
corn_yellow
corn_white
corn_non_gmo
soybeans
soybeans_double_crop
wheat
```

Then use:

```text
field_crop_assignments
- id
- farm_id
- field_id
- crop_year
- commodity_id
- planting_sequence
- planted_acres
- variety
- planting_date
- harvest_date
- yield_quantity
- yield_unit
- production_practice
- notes
- timestamps
- unique(field_id, crop_year, commodity_id, planting_sequence)
```

This supports:

- Wheat followed by double-crop soybeans
- Two separately tracked plantings of the same commodity
- White corn as distinct from yellow corn
- Non-GMO corn as distinct from ordinary corn
- Crop-specific acreage that does not have to equal the whole field
- Historical crop assignments without mutating the field’s current identity

`fields` should not contain an authoritative `crop_type`. The current crop should be queried from `field_crop_assignments`.

### 3.4 Recommended Farm Rx inventory and application model

Use explicit product classes:

```text
products.product_kind:
chemical | seed | fertilizer | biological | adjuvant | fuel | other
```

Avoid relying on free-text category for core behavior.

Normalize applications rather than placing all products in JSONB:

```text
applications
- id
- farm_id
- application_date
- start_time
- end_time
- applicator_id
- applicator_name_snapshot
- applicator_license_snapshot
- equipment_id
- weather snapshots
- notes
- status
- created_by
- timestamps

application_fields
- application_id
- field_id
- crop_assignment_id
- applied_acres
- unique(application_id, field_id, crop_assignment_id)

application_products
- id
- application_id
- product_id
- product_name_snapshot
- epa_registration_snapshot
- is_rup_snapshot
- signal_word_snapshot
- rei_hours_snapshot
- phi_days_snapshot
- max_label_rate_snapshot
- max_label_rate_unit_snapshot
- rate
- rate_unit
- total_quantity
- quantity_unit
- customer_supplied
- notes

application_product_lots
- application_product_id
- inventory_lot_id
- lot_number_snapshot
- quantity
- unit
```

This retains CRX’s historical-snapshot principle while making compliance fields queryable, indexable, and resistant to later product edits.

For offline PWA submissions, require an idempotency key on application creation and other mutating workflows. A retry must return the original result; reuse of the same key with a different payload should raise a conflict.

### 3.5 RLS weaknesses in CRX that Farm Rx must avoid

CRX was designed for employees inside one distributor, not for mutually isolated customer farms. Several policies are therefore unsuitable for Farm Rx:

- `fields_select` allows broad role-based visibility rather than ownership by farm.
- Early `field_billing_defaults` policies use `USING (true)` for authenticated reads.
- `field_crop_history` grants authenticated users unrestricted read, insert, update, and delete.
- `field_app_locations` and `field_app_location_shares` use `USING (true)` and `WITH CHECK (true)`.
- `application_record_fields` allows any authenticated user to select every row.
- `products_select` uses `USING (true)`. A global product catalog may be public to authenticated users, but farm prices, inventory, notes, and usage must be separate farm-scoped tables.
- `derive_customer_shares_from_fields()` is `SECURITY DEFINER`, accepts arbitrary field IDs, and does not enforce a farm boundary in its body. In a multi-tenant app, that pattern can bypass table RLS.
- Several CRX policies authorize by broad roles such as `sales_rep` or `applicator`. A Farm Rx representative must never gain access to all farms merely by having a representative role.

Farm Rx should enforce:

1. Every tenant-owned row has a non-null `farm_id`.
2. Access requires an active `farm_memberships` row, not merely an application-wide role.
3. A representative can access only a specifically granted farm.
4. The farm-level `share_with_rep` toggle must be combined with an explicit `farm_rep_access.rep_user_id`; it must not mean “share with every rep.”
5. Child-table policies verify access through the parent’s `farm_id`.
6. Inserts and updates use both `USING` and `WITH CHECK` so rows cannot be moved into another farm.
7. `SECURITY DEFINER` functions authenticate with `auth.uid()`, verify farm membership or explicit rep access, bind actor IDs to `auth.uid()`, use `SET search_path = public, pg_temp`, and revoke execution from `PUBLIC` and `anon`.
8. Tenant-facing views use `security_invoker = true` unless a carefully audited function performs equivalent farm checks.
9. Storage paths include `farm_id`, with matching object-storage policies.
10. Cross-farm identifiers supplied by clients are rejected even if their individual foreign keys exist.
11. Compliance records use restricted update paths or append-only corrections rather than unrestricted direct edits.
12. Farm access revocation takes effect immediately by checking active membership/grant rows on every policy evaluation.

The correct Farm Rx security boundary is the farm workspace, with explicit temporary or revocable representative access. CRX’s employee-role boundary should not be reused.