# Programs — planned application programs for Farm Rx

Status: **AUTHORITATIVE DESIGN; NOT BUILT.** Written 2026-07-12 against migrations 0001–0023 and the current React/Repository/Gateway/offline-queue seams. Any future `0024_programs.sql` remains a draft until Mason separately approves applying it.

> **Revision 2 (2026-07-12): multiple programs per crop.** V1 now allows multiple different active programs on the same `crop_assignment`, so a field/crop can carry chemical and fertility programs together, or more than one deliberately distinct fertility program. The former one-active-program-per-crop unique rule is removed. V1 instead prevents the same program from being actively assigned twice to the same crop, caps active programs at 12 per crop as a runaway/accidental-clutter guard, identifies each track by program name plus an optional category, and makes every tracker action target one exact `program_assignment`. The alternative was to keep one combined whole-season recipe; that is rejected because it does not match normal lighter-soil/high-producing-ground and chemical-plus-fertility workflows.

## Plain-English owner summary

Programs lets a farmer write a season recipe once—Pre, Post, Fungicide, planter fertility, or a custom pass—then assign one or more distinct recipes to the exact crop on each field and check the passes off as the season happens. A field/crop can therefore run a chemical program beside a fertility program, while differently named fertility programs can represent lighter-soil and high-producing-ground choices. Each assignment makes its own durable copy of the recipe, so changing next year's template can never rewrite a pass that was already applied. A dated pass can create one task card and one reminder, spray passes can show the field's existing weather light, and an applied pass can link to a real application record without pretending its free-typed products came out of inventory. The design also leaves stable, farm-scoped hooks for a future Crop RX order to reconcile to a planned line and for a shipped delivery to become on-hand through the existing inventory receipt ledger.

## 1. Decisions and boundaries

### Recommended shape

Use a reusable template, but **materialize field-specific pass instances at assignment time**:

`programs → program_passes → program_pass_products`

`programs → program_assignments → assigned_program_passes → assigned_program_pass_products`

`program_assignments → crop_assignments → fields`

This is the important choice. A derived-only model looks smaller, but it cannot safely carry a field's own due date, status, actual product text, task, or application-record link. Materialized assigned passes are stable history and make offline replay deterministic. The cost is duplicated snapshot data; that duplication is intentional and small.

An assignment targets `crop_assignment_id`, never only `field_id`. Wheat followed by double-crop soybeans is two crop assignments on the same field and must produce two independent sets of passes.

### Template scope

A program may optionally carry `commodity_id` and `crop_year`:

- both null: reusable general template;
- commodity only: reusable crop recipe;
- crop year only: season-specific mixed-crop template;
- both set: a crop-and-season recipe.

Assignment enforces any non-null scope. A corn-scoped program cannot be assigned to soybeans, and a 2027 program cannot be assigned to a 2026 crop row. The alternative is treating these as search hints only; that is rejected because one accidental cross-crop assignment can create a season of wrong reminders.

### Multiple active programs per crop assignment

V1 allows multiple different active `program_assignment` rows per `crop_assignment`. There is no crop-level active uniqueness rule. Instead, partial unique `(farm_id, crop_assignment_id, program_id) where status='active'` prevents the **same** program from being actively assigned twice to the same crop while allowing different programs. An archived assignment may later be assigned again as a new active row; its old history remains archived.

Cap each crop assignment at 12 active programs. The assignment/reassign RPCs and a database guard trigger enforce the cap under the crop-assignment advisory lock, so concurrent calls cannot both pass a stale count. Twelve is intentionally above a normal chemical/fertility/fungicide set but low enough to catch an offline replay or repeated-tap explosion before the tracker becomes unusable. The alternative is no cap; that adds no useful agronomy flexibility and turns a client defect into unbounded rows, tasks, and reminders.

### Program category and soil-productivity meaning

Add optional `programs.program_kind text null` with check `program_kind in ('chemical','fertility','fungicide','other')`. The name remains the primary identity; category is an additive badge/filter and never part of uniqueness. Season progress groups tracks by program and shows the program name prominently with the category badge, with uncategorized programs under “Other / not set.” This small category is useful in V1 because chemical and fertility plans commonly run together and it also supports honest category subtotals. A free-form category is rejected because spelling variants would make grouping unreliable; name alone was the smaller alternative, but it makes a mixed set harder to scan.

Farm Rx does **not** gain sub-field zones in V1. “Lighter soil” versus “high-producing ground” means two clearly named fertility templates, for example “Corn Fertility — Lighter Soil” and “Corn Fertility — High-Producing Ground,” both optionally categorized `fertility`. The farmer assigns the appropriate one to each field's crop; if that whole field genuinely runs both, both may be assigned. There is no zone geometry, VRT map, soil polygon, within-field acreage split, or automatic soil selection. Do not add a separate soil label: program name plus optional category is enough, avoids a second ambiguous naming field, and stays honest about field-level—not sub-field—planning.

### Free-type means genuinely free-type

Program product names, rates, and units are text. V1 does not search, create, or require an inventory product. `catalog_product_id` exists as a nullable, unused reservation and has a same-farm foreign key to `inventory_products` so a future confirmed match needs no Programs-table migration. There is no fuzzy auto-match in V1.

### Applied reality without a fake inventory movement

An assigned product line stores both its planned snapshot and, when the pass is marked Applied, a confirmed actual free-text snapshot. Marking Applied may:

1. create no Inventory record at all; this is always a valid V1 path;
2. link an existing non-voided (draft or completed) same-farm `application_records` row for the same `crop_assignment`; or
3. create a draft `application_records` header using the assigned field/crop, applied date, and acres, then link it while leaving it draft.

The pass becomes Applied in the Programs domain in all three cases, and its free-type actual product facts are stored in `assigned_program_pass_products`. A Program-created application header intentionally has no `application_products` rows and remains an un-posted draft until products are deliberately reconciled to inventory catalog products through the Inventory workflow. Therefore **inventory on-hand does not change** and the UI must say “Products not matched to inventory — on-hand unchanged.” Creating fake catalog rows, decrementing inventory from text, or completing a product-less application is rejected.

This V1 rule preserves `protect_application_history`: an application must be inserted as draft and cannot become completed without at least one `application_products` row. A Program-created product-less draft is legal and never enters the completed application/inventory ledger. If Inventory cannot render that linked draft safely, the UI fallback is link-existing/open-prefill only; the server contract still does not weaken the inventory invariant.

## 2. Data model

All UUID primary keys default to `gen_random_uuid()`. Every farm-owned table repeats `farm_id`, has `unique (id, farm_id)`, uses `prevent_farm_id_change`, and has the established `set_updated_at` trigger where an `updated_at` column exists. Audit user IDs are plain UUID provenance stamps, matching newer modules, so removing a membership does not destroy or block history.

### `public.programs` — reusable template header

| Column | Type / rule | Purpose |
|---|---|---|
| `id` | uuid PK | Stable template identity. |
| `farm_id` | uuid, FK farms, cascade farm deletion | Tenant boundary. |
| `name` | text, trimmed length 1–160 | Farmer-written program name. |
| `program_kind` | text nullable; check `chemical`, `fertility`, `fungicide`, `other` | Optional grouping badge; name remains the distinguishing identity. |
| `commodity_id` | text nullable, FK commodities restrict | Optional crop scope. |
| `crop_year` | integer nullable, 1900–2200 | Optional season scope. |
| `notes` | text nullable, max 4,000 | Plain notes. |
| `revision` | integer not null default 1, >=1 | Increments on any template/pass/product/order change. |
| `is_archived` | boolean default false | Soft delete; archived templates cannot be newly assigned. |
| `created_by`, `updated_by` | uuid not null | Provenance. |
| `created_at`, `updated_at` | timestamptz | Audit times. |

Index `(farm_id, is_archived, crop_year, commodity_id, program_kind, name)`. Do not make names globally unique: “Corn 2-pass” may legitimately be reused for different years. A narrower optional unique rule can be added in UI, not the database.

### `public.program_passes` — ordered template steps

| Column | Type / rule | Purpose |
|---|---|---|
| `id`, `farm_id`, `program_id` | UUIDs; composite same-farm FK to programs, restrict | Stable pass identity. |
| `sequence` | smallint >=1 | Canonical order; unique per active program. |
| `name` | text 1–120 | Farmer-facing label such as “Early Post.” |
| `pass_type` | text check `pre`, `post`, `fungicide`, `planter_fertility`, `custom` | Useful default/category, not the displayed prose. |
| `activity_type` | text check `spray`, `fertility`, `other` | Determines weather-light eligibility independently of the label. |
| `timing_label` | text nullable, max 160 | “At planting,” “V4–V6,” or similar agronomy text. |
| `target_date` | date nullable | A directly schedulable date. |
| `planting_offset_days` | smallint nullable, -120..365 | Relative date from the assigned crop's planting date. |
| `reminder_lead_days` | smallint not null default 3, 0..60 | When the dated pass becomes due for cards/reminders. |
| `notes` | text nullable, max 2,000 | Pass-specific instructions. |
| `is_archived` | boolean default false | Template removal without destroying assignment ancestry. |
| audit columns | as above | Provenance. |

`target_date` and `planting_offset_days` are mutually exclusive. Both may be null: growth-stage-only and genuinely unscheduled passes are valid, but cannot auto-create a due card until the farmer sets a field-specific date. `timing_label` may accompany either date mode, so “V4–V6, target June 10” is representable.

Use partial unique `(program_id, sequence) where not is_archived`. Ordering changes run under a program advisory lock and use a two-step temporary renumber before final contiguous values 1..N; this avoids unique collisions during reorder.

Alternative considered: a single timing enum with one payload. It is cleaner on paper but cannot express a farmer's useful growth-stage prose alongside a target date. The separate descriptive and schedulable columns are clearer.

### `public.program_pass_products` — free-typed template lines

| Column | Type / rule | Purpose |
|---|---|---|
| `id`, `farm_id`, `program_pass_id` | UUIDs; same-farm FK, restrict | Stable planned line identity. |
| `sequence` | smallint >=1, unique per active pass | Farmer order. |
| `product_name` | text 1–200 | Free-typed name. |
| `rate_text` | text 1–80 | Free-typed number or expression, e.g. `24` or `1–1.5`. |
| `unit_text` | text 1–80 | Free-typed unit, e.g. `oz/ac`. |
| `estimated_cost_per_acre` | numeric(14,4) nullable, >=0 | Planned cost only. |
| `catalog_product_id` | uuid nullable, same-farm FK to inventory_products, restrict | Reserved; **unused in V1 UI/RPC input**. |
| `notes` | text nullable, max 1,000 | Product note. |
| `is_archived` | boolean default false | Stable ancestry for assigned snapshots. |
| audit columns | as above | Provenance. |

Rate is text on purpose. Turning it into numeric would reject legitimate farmer shorthand and imply unit conversions that do not exist. Cost is numeric because it feeds money math; SQL uses exact `numeric`, and the client uses `roundDecimalHalfUp(value, 4)` before comparison/canonical validation.

### `public.program_assignments` — a recipe attached to one crop row

| Column | Type / rule | Purpose |
|---|---|---|
| `id`, `farm_id`, `program_id`, `crop_assignment_id` | UUIDs; same-farm FKs, restrict | Exact template and exact crop-year row. |
| `program_name_snapshot` | text, trimmed length 1–160 | Program identity displayed for this assignment; does not drift on template rename. |
| `program_kind_snapshot` | text nullable; check `chemical`, `fertility`, `fungicide`, `other` | Category displayed/grouped for this assignment. |
| `status` | text check `active`, `archived` | Never hard-delete seasonal history. |
| `template_revision` | integer >=1 | Last explicitly synchronized program revision. |
| `assigned_by`, `assigned_at` | uuid / timestamptz | Assignment audit. |
| `archived_by`, `archived_at`, `archive_reason` | nullable; all-or-none consistency | Unassign/reassign audit. |
| `created_at`, `updated_at` | timestamptz | Audit times. |

Partial unique `(farm_id, crop_assignment_id, program_id) where status='active'`. There is deliberately no unique rule on active `(farm_id, crop_assignment_id)` alone. A guard trigger rejects a thirteenth active assignment for one crop under the same crop-assignment advisory lock used by assignment RPCs. The composite crop-assignment FK is `on delete restrict`, not cascade. A field/crop row with program history must be explicitly unassigned/archived; deleting it must not erase seasonal evidence. This is consistent with existing application records already restricting field/crop deletion.

The assignment RPC verifies the program's optional commodity/year scope and materializes the program name/category plus all active template passes and products in one transaction. Tracker, task, notification, and assignment-cost labels use the assignment snapshots, not the mutable template header.

### `public.assigned_program_passes` — field-specific pass instances

| Column | Type / rule | Purpose |
|---|---|---|
| `id`, `farm_id`, `assignment_id` | UUIDs; same-farm FK to assignment, restrict | Durable occurrence. |
| `source_program_pass_id` | uuid nullable, same-farm FK to template pass, set null on template hard removal | Ancestry only; snapshots remain authoritative. |
| `source_revision` | integer >=1 | Revision that supplied this snapshot. |
| snapshot columns | `sequence`, `name`, `pass_type`, `activity_type`, `timing_label`, `target_date`, `planting_offset_days`, `reminder_lead_days`, `notes` | Field history cannot drift with template edits. |
| `due_on` | date nullable | Resolved field-specific due date. |
| `due_source` | text check `template_date`, `planting_offset`, `manual`, `unscheduled` | Explains the date. |
| `is_field_override` | boolean default false | Protects a farmer's field-specific reschedule during refresh. |
| `status` | text check `planned`, `applied`, `skipped`, `cancelled` | Per-field lifecycle. |
| `applied_on`, `applied_acres` | date / numeric(12,2) nullable | Required and positive for Applied. Acres <= crop assignment planted acres. |
| `skipped_on`, `skip_reason` | date / text nullable | Required for Skipped. |
| `cancelled_at`, `cancel_reason` | timestamptz / text nullable | Used by unassign/template removal, not to disguise an application. |
| `application_record_id` | uuid nullable, unique, same-farm FK to application_records restrict | Optional reality link. |
| `created_by`, `updated_by`, timestamps | audit | Provenance. |

State consistency constraints require only the fields for the current state and reject impossible mixtures. A database validation trigger/RPC check proves the linked application record has the same farm and `crop_assignment_id`; farm equality alone is not enough.

`due_on` is resolved at assignment:

- template `target_date` → that date;
- `planting_offset_days` plus a non-null crop `planting_date` → planting date + offset;
- planting offset but no planting date → null until planting is entered or the farmer reschedules;
- neither → null.

There is no automatic growth-stage calculator in V1. Guessing a date from “V4” would generate confidently wrong work.

### `public.assigned_program_pass_products` — planned and actual free-type snapshots

| Column | Type / rule | Purpose |
|---|---|---|
| `id`, `farm_id`, `assigned_pass_id` | UUIDs; same-farm FK, restrict | Stable field-pass product line. |
| `source_program_pass_product_id` | uuid nullable, same-farm FK, set null | Template ancestry. |
| planned snapshot | `sequence`, `product_name`, `rate_text`, `unit_text`, `estimated_cost_per_acre`, `catalog_product_id`, `notes` | Plan as assigned. Catalog ID remains unused/null in V1. |
| actual snapshot | `actual_product_name`, `actual_rate_text`, `actual_unit_text`, `actual_cost_per_acre` nullable | Confirmed free-type reality captured on Applied. |
| timestamps | audit | History. |

When Applied, the UI starts actual values from the plan and lets the farmer correct substitutions/rates before confirmation. The RPC writes actual columns only during the Planned → Applied transition. After Applied they are immutable through Programs; corrections use the existing application correction/void model plus a narrowly designed future correction flow, not silent overwrite.

### `farm_tasks` additions

Widen `farm_tasks.source` to `('manual','service_interval','scouting','program')` and add:

- `program_assigned_pass_id uuid nullable` with same-farm FK to `assigned_program_passes`, `on delete set null (program_assigned_pass_id)`;
- `program_cycle_key text nullable`, 1–240 characters;
- partial unique `(farm_id, program_assigned_pass_id, program_cycle_key) where program_cycle_key is not null`.

Do not overload `interval_id` or `interval_cycle_key`; those columns mean equipment service. A program task uses `field_id` from the assignment and the pass's `due_on`.

### Read models / views

Use security-invoker views so RLS remains effective:

- `program_assignment_tracker`: one row/graph per assignment with snapshotted program name/category + exact field/crop/year/planting sequence + ordered pass progress and task/application links; consumers group several assignment tracks under one crop.
- `program_assignment_costs`: per-assignment/program planned cost/acre, actual free-type cost/acre where entered, planted acres, and total planned/actual cost.
- `program_crop_cost_rollups`: one row/graph per crop assignment that sums its active program-assignment costs and returns category subtotals, included program IDs/names, and completeness flags. Never coalesce missing actual cost to zero.
- `program_application_products`: linked application record + actual free-type assigned lines, clearly flagged `inventory_matched=false` until catalog reconciliation exists.

### RLS and grants

For every Programs table:

- enable RLS;
- revoke all from `public` and `anon`;
- authenticated SELECT policy: `can_access_farm(farm_id)` (active members and only explicitly shared reps);
- INSERT policy: `can_edit_farm(farm_id)` and `created_by/assigned_by = auth.uid()` where present;
- UPDATE/DELETE policies: `can_edit_farm(farm_id)`;
- the application UI still performs all mutations through RPCs, never direct PostgREST DML.

Thus owner/manager/worker can write; `read_only` and representatives cannot. SECURITY DEFINER functions repeat authentication, `can_edit_farm`, fixed `search_path = public, pg_temp`, farm-scoped existence checks, and farm-scoped writes. Revoke every RPC from `public`, `anon`, and `authenticated`, then grant execute only to `authenticated`.

## 3. Template editing and history rule

**Template edits affect future assignments only unless the farmer explicitly chooses “Update assigned fields.”** Saving any header, pass, product, or order change increments `programs.revision` under a program advisory lock.

Existing assignments keep their snapshots. The tracker may show “Template has updates” when `programs.revision > program_assignments.template_revision`. The explicit refresh action:

- updates that assignment's program name/category snapshots from the current template;
- never changes Applied, Skipped, or Cancelled passes;
- never changes a Planned pass with `is_field_override=true`;
- updates untouched Planned snapshots/products from the same source pass;
- materializes newly added template passes;
- marks a removed untouched Planned pass Cancelled with reason `Removed from template revision N`;
- does not delete rows;
- updates `template_revision` only after the whole refresh succeeds.

Alternative considered: silently live-link every not-yet-applied pass. Rejected because a winter template cleanup could move dates, products, and costs on an active field without the farmer noticing. Another alternative is a full immutable template-version table. That is audit-perfect but adds joins and copy operations without improving the field history already guaranteed by materialized snapshots; the integer revision plus snapshots is sufficient for V1.

## 4. RPC surface and exact write scopes

Every mutation below is SECURITY DEFINER and receipt-idempotent. The common prologue is:

1. require non-null `p_farm_id`, `p_operation_id`, and `auth.uid()`;
2. require `can_edit_farm(p_farm_id)`;
3. validate exact JSON keys/types before casts;
4. take `pg_advisory_xact_lock(hashtext(p_farm_id::text), hashtext(p_operation_id::text))`;
5. return the prior `repository_write_receipts.result` if the same caller already completed that operation; reject an operation ID used by another caller;
6. take a second entity/program advisory lock when distinct operation IDs could race;
7. perform only farm-scoped statements; **no `SELECT ... FOR UPDATE`**;
8. write the canonical JSON result receipt and return it.

Each client command gets a new operation ID and a versioned FIFO queue entry containing exact IDs, actor, farm, enqueue time, and payload. A transport failure stays queued; a definite validation/permission conflict becomes Blocked and preserves the head. Replay must reuse the operation ID and only remove the head after validating the full canonical echo.

### Revision 2 RPC deltas

- `save_program` accepts/writes optional `program_kind`.
- `assign_program` no longer replaces or rejects a crop merely because another different program is active; it adds the named program, while enforcing same-program uniqueness and the 12-active cap.
- New `reassign_program_assignment` atomically replaces one named assignment and leaves sibling program assignments untouched.
- `refresh_program_assignment` remains assignment-scoped and now refreshes that assignment's snapshotted program name/category as well as eligible Planned pass snapshots.
- `reschedule_program_pass`, Apply, and Skip remain assigned-pass-scoped; `unassign_program` remains assignment-scoped. Implementations must remove any singular “active assignment for crop” lookup.
- `generate_due_program_items` keeps its assigned-pass dedupe keys but adds the assignment's program-name snapshot to task titles and notification bodies.

All retain receipt idempotency, SECURITY DEFINER hardening, entity advisory locks, farm-scoped writes, and the prohibition on `SELECT ... FOR UPDATE`.

### Template RPCs

#### `save_program(p_farm_id uuid, p_operation_id uuid, p_program jsonb) → jsonb`

Accepted keys: `id`, `name`, `program_kind`, `commodity_id`, `crop_year`, `notes`. Insert sets farm/audit/revision. Update writes **only** name, optional category, commodity, year, notes, `updated_by`, and increments revision. It never changes farm, creator, archive state, assignments, passes, or products.

#### `save_program_pass(p_farm_id uuid, p_operation_id uuid, p_program_id uuid, p_pass jsonb, p_products jsonb, p_place_after_pass_id uuid) → jsonb`

Atomically inserts/updates one pass and its full ordered product set. `p_place_after_pass_id=null` means first. It locks the program entity, verifies every supplied/retained row belongs to that program and farm, temporarily renumbers active passes, then writes contiguous sequence values. Update scope is only the pass's name/type/activity/timing/lead/notes/order and that pass's product rows. Missing product IDs are archived, not deleted. It increments the parent revision once and returns program revision + canonical pass/products/order.

This one-call bundle is preferred over separate product RPCs because a lost response cannot leave a pass with half a recipe.

#### `reorder_program_passes(p_farm_id uuid, p_operation_id uuid, p_program_id uuid, p_ordered_pass_ids uuid[]) → jsonb`

Requires the array to contain every active pass exactly once. Updates **only** `sequence`, parent revision/updated audit, and nothing else. Two-step renumber under the program lock avoids uniqueness collisions.

#### `delete_program_pass(p_farm_id uuid, p_operation_id uuid, p_program_id uuid, p_pass_id uuid) → jsonb`

This is a farmer-facing delete but a database archive: set only `is_archived=true`, audit fields, archive its active template product rows, and increment program revision. Assigned snapshots are untouched. If it is already archived, return the prior canonical archived state through the new receipt.

#### `delete_program(p_farm_id uuid, p_operation_id uuid, p_program_id uuid) → jsonb`

Set only `programs.is_archived=true` and audit fields. It does not archive active assignments and does not delete history. A program with active assignments remains visible in those trackers but cannot be newly assigned. If the owner wants the fields removed, the separate unassign command makes that consequence explicit.

### Assignment / tracking RPCs

#### `assign_program(p_farm_id uuid, p_operation_id uuid, p_program_id uuid, p_crop_assignment_ids uuid[]) → jsonb`

Requires 1–200 distinct IDs, all in the farm and matching program scope. Under program plus sorted crop-assignment advisory locks, it adds one active assignment per crop row and materializes passes/products even when other **different** programs are already active there. It rejects a crop where this same program is already active and rejects any addition that would exceed 12 active programs on that crop. The call is all-or-nothing. It writes no field, crop, template, task, notification, application, or budget row. Return the complete canonical assignment graph in input order. Receipt replay still returns the prior result; a new operation attempting the same program/crop pair gets the explicit already-assigned conflict from the partial unique guard.

#### `refresh_program_assignment(p_farm_id uuid, p_operation_id uuid, p_assignment_id uuid) → jsonb`

Applies the explicit refresh rule in section 3. Scope is the named assignment's program name/category snapshots, untouched Planned pass/product snapshots, and `template_revision`; no terminal pass, application record, task status, crop assignment, or template is overwritten. Any open Program task for that assignment is relabeled from the refreshed program-name snapshot without changing task identity or state. Return counts for added/updated/cancelled/preserved plus the graph.

#### `reschedule_program_pass(p_farm_id uuid, p_operation_id uuid, p_assigned_pass_id uuid, p_due_on date, p_timing_label text) → jsonb`

Allowed only while Planned on an active assignment. Updates only `due_on`, `due_source='manual'`, optional field timing label, `is_field_override=true`, and audit columns. If an open program task exists, update only its `due_on`, title/details if the displayed date changed, and its program cycle key. A terminal task is not rewritten; the new date becomes a new due cycle. Notifications are immutable, so a new date may create one new reminder key.

#### `mark_program_pass_applied(p_farm_id uuid, p_operation_id uuid, p_assigned_pass_id uuid, p_applied_on date, p_applied_acres numeric, p_actual_products jsonb, p_application_record_id uuid, p_create_application_record boolean) → jsonb`

Only Planned → Applied is allowed. No application record is required when `p_create_application_record=false`; this no-record path stores the Programs actuals and leaves the link null. Linking supplies an existing `p_application_record_id`; creating requires a client-supplied stable UUID and rejects an existing row. Validate acres against the exact crop assignment. Validate actual product IDs are the complete assigned line set, then write only their four actual snapshot columns. Update only the assigned pass's status/applied/link/audit columns.

When linking, accept any non-voided existing application (draft or completed), validate farm + crop assignment, and use its application date/acres as canonical if they differ, returning the canonical values. When creating, insert one draft `application_records` header with field/crop/date/acres, `created_by`, `completed_at=null`, and a short Programs provenance note; do not transition it to completed, insert `application_products`, touch inventory receipts/adjustments, or invent weather. Then set matching open `farm_tasks` rows (`source='program'` and the assigned pass ID) to Done; the existing completion trigger owns the task's `completed_by/completed_at`. No notification is deleted.

If the Programs build cannot make a linked, zero-product draft render safely in the existing Inventory module, the UI must temporarily offer only “Link existing record” and “Open pre-filled application” until that proof passes. The RPC-created draft is always linked to the applied pass; it is never an orphan or a completed inventory posting.

#### `skip_program_pass(p_farm_id uuid, p_operation_id uuid, p_assigned_pass_id uuid, p_skipped_on date, p_reason text) → jsonb`

Planned → Skipped only. Updates only skip/status/audit columns and closes the matching open Program task. It never creates an application record. A later “undo” needs its own explicit receipt-idempotent RPC; V1 need not provide one.

#### `unassign_program(p_farm_id uuid, p_operation_id uuid, p_assignment_id uuid, p_reason text) → jsonb`

Sets the active assignment Archived, marks only its remaining Planned passes Cancelled, and closes only their open Program task cards. Applied and Skipped passes, actual product snapshots, and application links are preserved. If there are Applied passes, the confirmation says plainly that history will remain. The RPC never deletes rows.

#### `reassign_program_assignment(p_farm_id uuid, p_operation_id uuid, p_assignment_id uuid, p_new_program_id uuid, p_reason text) → jsonb`

Replaces exactly the named active assignment, never every program on its crop. Under locks for the old/new program and exact crop assignment, it archives that one assignment using the unassign preservation rules, then creates/materializes one new assignment for `p_new_program_id` on the same crop. Other active program tracks are untouched. Reject a new program that is already active on that crop; do not silently refresh or merge it. This explicit atomic RPC is preferred over a client-side unassign-then-assign pair, whose second step could fail offline and leave the farmer with no replacement.

Multiplicity does not otherwise widen mutation scope: `refresh_program_assignment` and `unassign_program` already target one `assignment_id`; `reschedule_program_pass`, Apply, and Skip target one `assigned_pass_id`. Their implementations must join back through that exact assignment and must never select “the active assignment for this crop.”

### Due generation RPC

#### `generate_due_program_items(p_farm_id uuid, p_operation_id uuid, p_local_date date) → jsonb`

Receipt-idempotent even though task/notification unique keys provide a second safety net. Require `p_local_date` within one day of server `current_date`; this avoids UTC-midnight surprises for a phone without trusting arbitrary future dates. Select active-assignment Planned passes with non-null `due_on` where `due_on - reminder_lead_days <= p_local_date`.

For each due occurrence:

- task source: `program`;
- task cycle key: `due:<assigned_pass_id>:<due_on>`;
- unique constraint: `(farm_id, program_assigned_pass_id, program_cycle_key)`;
- open-card guard: no other Program task for that assigned pass in Todo/Doing;
- task title: assignment's program-name snapshot + pass name + field name (for example, `High-Yield Fertility — Post — North 80`), due_on copied, field_id copied;
- notification category: `spray` when `activity_type='spray'`, otherwise `task`;
- notification recipient: the first active owner ordered by user ID, matching 0023 V1 behavior;
- notification dedupe key: `program:<assigned_pass_id>:due:<due_on>`;
- notification body: name the assignment's program snapshot, pass, field, and due date so two “Post” reminders are distinguishable;
- notification link: `/programs?pass=<assigned_pass_id>`.

`on conflict do nothing` makes retries harmless. Dedupe remains per `assigned_pass_id`: two programs may intentionally each contain a “Post” pass, and those are two real pass instances, two cards, and two reminders. The existing task unique key and notification dedupe key already include the assigned-pass ID, so they do not collide across programs. A rescheduled pass gets a new logical date cycle; an existing open task is updated by the reschedule RPC rather than duplicated. Generation is invoked as a separate best-effort call at farm-ready, Programs refresh, and Notifications refresh. Failure never rolls back a template/assignment/status write. Future server scheduling may call the same RPC contract with an owner/service actor; that is not part of V1.

## 5. Connection wiring

### Tasks and reminders

Programs reuses the board, not a second task system. Due generation is separate from saving/assigning so a reminder outage cannot stop farm planning. The task and notification have independent database unique keys, while the RPC receipt protects the client replay. Every card visibly starts with the program name/category before the pass name; every reminder body names the program. Mark Applied/Skipped/Cancelled closes only the matching `assigned_pass_id` card. Manually closing a task does **not** mark the pass Applied; the Programs tracker remains the source of pass state and shows “Task closed; pass still planned” rather than guessing.

When assigning a program, the UI may show a gentle non-blocking note if an incoming active pass has the same case-insensitive trimmed display name as a Planned pass from another active program on that crop: “This crop already has a Post pass in Chemical Program A.” This is advisory only. Matching pass names across programs are common and intentional, so the warning must never disable Confirm and should not appear again after the farmer proceeds.

### Weather spray light

For an assigned pass with `activity_type='spray'`, join assignment → crop assignment → field and read the field's latitude/longitude. The Programs screen calls the existing `weatherService` and pure `evaluateSprayWindow` logic used by `WeatherModule`; it does not store weather and does not call a database RPC.

Show the current Good/Caution/Poor light, reason, forecast timestamp, and stale/offline wording beside a Planned spray pass. Missing location, stale cache, fetch failure, or no current sample produces an honest unavailable/stale note and never blocks saving, rescheduling, assigning, or marking Applied. Fertility/other passes show no spray light. A custom pass explicitly chooses Spray to opt in.

The light is guidance only; product labels and applicator judgment govern. Because free-typed products have no label constraints, Programs uses only the generic weather rules. A later confirmed catalog match can refine the light without changing the Programs schema.

### Applied → `application_records`

The link is one-to-one from `assigned_program_passes.application_record_id`. Marking Applied may leave it null. If present, it must point to a non-voided record for the same farm and crop assignment. A Program-created record is a linked, un-posted draft with no `application_products`; its free-type actual products are joined from the assigned pass and it does not decrement inventory. An existing draft or completed application can be linked instead; any existing `application_products` remain the Inventory module's only actual inventory ledger.

Do not let marking Applied auto-fill current weather after the fact. The Inventory application form may be opened pre-filled with field, crop, date, acres, and planned product text, and the farmer may use its existing “Use current weather” action while conditions are current. Weather capture stays optional.

### Profitability

`program_assignment_costs` exposes one row per specific assignment/program:

- planned program cost/acre = sum of non-null `estimated_cost_per_acre` only when every active planned snapshot line has a cost; otherwise value plus `is_complete=false`;
- actual program cost/acre = sum actual cost only when every Applied actual line has cost, otherwise null/incomplete;
- total = per-acre value × crop assignment planted/applied acres using PostgreSQL numeric.

The UI shows these per-program figures first. It may also show an “All active programs on this crop” rollup, with category subtotals and a grand total computed across active assignments. The rollup inherits incomplete status if any included program is incomplete and labels itself as a whole-field total; V1 has no acreage allocation within a field. This makes chemical-plus-fertility totals useful without pretending that two alternative soil programs cover mapped sub-field acres.

Do not auto-write `budget_cost_lines`; that would double-count when a program changes. A later explicit “Use program estimate in budget” action may widen `budget_cost_lines.source_kind` to `program`, set `source_record_id=program_assignment.id`, and upsert one chemical/fertilizer cost line per chosen category. The stable assignment ID and cost view provide that seam. Client display/validation uses `roundDecimalHalfUp`, never binary `toFixed` as the acceptance rule.

## 6. Future Crop RX order and delivery seam — design only

The future integration should be an inbox and reconciliation workflow, not a cross-database foreign key or an automatic product-name guess.

1. Crop RX sends an idempotent expected-order/delivery event with a globally stable external event ID, customer link, order ID, order line IDs, product UUID/name, quantity, unit, and planned delivery date.
2. Farm Rx authenticates the source outside the browser, resolves the external customer to one farm, hashes/stores the event in the existing `inventory_delivery_events` inbox, and ignores exact replays by `(source_system, external_event_id)`.
3. Expected events create/update a future Crop-RX-sourced draft `inventory_receipt` plus receipt lines. Draft/expected lines are visible as “Scheduled delivery” but are excluded from `inventory_on_hand`.
4. A departure-from-Crop-RX event is translated to the agreed Farm Rx ledger meaning “available on the customer's floor”: it transitions the linked receipt to Received at the departure timestamp. Only then does the existing derived on-hand view count it. Partial departures create/receive only the shipped quantities; cancellations never add on-hand.
5. A future many-to-many reconciliation table maps `(farm_id, source_system, external_order_line_id)` to `assigned_program_pass_products.id`, with allocated quantity and match status. Many-to-many is required for split orders, substitutions, and one order line covering several fields. Stable assigned-line UUIDs mean no Programs table change is required.
6. If the CRX product has already been explicitly matched, populate the reserved same-farm `catalog_product_id`; otherwise show the order line beside candidate planned lines and require farmer confirmation. Never match solely on free text.
7. After catalog reconciliation, a separate receipt-idempotent operation may create/link real `application_products` and therefore inventory usage. The event inbox itself never decrements inventory and never marks a Program pass Applied.

The existing CRX Manager “planned programs” code is business-side quote/hold/dispatch data and even keeps reusable crop programs in settings JSON. Farm Rx deliberately does not copy that shape: farmers need crop-assignment identity, materialized per-field status, RLS, durable receipts, and offline replay. The bridge later exchanges external IDs and events, not shared tables.

## 7. Ranked failure cases and mitigations

### P1 — ship blockers

1. **The same program is assigned twice to one crop.** Two identical snapshot sets create duplicate work and cost. Mitigation: partial unique active `(farm_id, crop_assignment_id, program_id)`, receipt replay, crop advisory lock, and a clear “already assigned” conflict.
2. **Refresh, unassign, or reassign hits every program on the crop.** Removing a fertility plan also cancels the chemical plan or hides applied history. Mitigation: every action carries one exact `assignment_id`; pass actions carry one exact `assigned_pass_id`; the atomic reassign RPC archives only its named assignment and preserves terminal history.
3. **Wrong crop in a double-crop field.** Assigning by field ID puts a wheat fungicide pass on double-crop soybeans. Mitigation: every assignment FK and RPC targets exact `crop_assignment_id`; tracker always displays crop, year, and planting sequence.
4. **Template edit rewrites applied history.** Changing a rate for next year alters this year's applied record. Mitigation: materialized snapshots; terminal passes immutable; refresh explicit and Planned-only.
5. **Free text silently changes inventory.** “Roundup 24 oz” is guessed as the wrong catalog SKU/lot and decrements on-hand. Mitigation: no catalog lookup or inventory posting; visible unmatched badge; explicit future reconciliation.
6. **Offline replay applies twice or crosses operations.** A lost response plus a second tap creates duplicate assignments/application headers. Mitigation: versioned FIFO, stable client IDs, farm+operation advisory lock, caller-bound receipt, entity lock, canonical echo, same-program active uniqueness, and unique application link.
7. **Cascade deletion erases seasonal evidence.** Deleting a crop assignment removes assigned/applied passes. Mitigation: assignment FK uses restrict; unassign archives; application links restrict; field/crop UI must explain dependencies.
8. **Program-created application looks catalog-backed or violates completion invariants.** A product-less header is presented as completed even though no inventory product ledger exists. Mitigation: V1 creates and links only a product-less draft, never completes it, always allows Applied with no record, accepts only non-voided same-farm/same-crop existing links, shows “not matched to inventory — on-hand unchanged,” and falls back to link/open-prefill only if Inventory cannot render the draft safely.
9. **Cross-farm definer write.** A caller supplies another farm's program/pass/application ID. Mitigation: `can_edit_farm`, composite same-farm FKs, farm-scoped existence/write predicates, fixed search path, and tests for every foreign ID.

### P2 — important correctness risks

1. **A farmer cannot tell two “Post” cards apart.** The wrong pass is applied or rescheduled. Mitigation: tracker tracks are grouped by program; cards, confirmations, deep links, and reminder bodies always show program name/category plus pass and field; mutations use assigned-pass IDs.
2. **Crop cost silently double-counts or looks complete.** Several active programs are summed without showing components, or an incomplete program becomes zero. Mitigation: per-program cost is primary; optional crop/category rollups list included programs and propagate incomplete flags; never coalesce missing cost to zero.
3. **Alternative soil programs are mistaken for sub-field allocation.** Assigning both implies Farm Rx knows which acres are light soil. Mitigation: explicitly whole-field assignments only, clear names, no zone acreage math, and whole-field wording on the rollup.
4. **No date means no reminder.** “V4–V6” cannot be scheduled automatically. Mitigation: allow it honestly, show “Set a date for reminders,” and provide one-tap reschedule; never invent a date.
5. **Planting date arrives later.** An offset pass materialized with null due_on stays unscheduled. Mitigation: Programs load detects eligible null dates and offers a receipt-idempotent explicit refresh/recalculate; do not silently move field overrides.
6. **UTC midnight creates early/late cards.** Supabase `current_date` differs from the phone's farm day. Mitigation: date-only storage; bounded `p_local_date`; future farm IANA timezone before unattended server push.
7. **Concurrent reorder corrupts sequence.** Two devices save different pass order. Mitigation: program entity advisory lock, exact full-order validation, two-stage renumber, last completed operation wins, canonical echo refresh.
8. **Reschedule duplicates cards/reminders.** Date-based dedupe key changes. Mitigation: reschedule updates the one open task; open-card guard; new notification is a deliberate new date cycle.
9. **Task Done is mistaken for pass Applied.** A board user closes a card without recording application reality. Mitigation: task completion never changes Program status; tracker warns until Applied/Skipped.
10. **Applied actual products differ from plan.** Substitution is lost if mark Applied merely copies plan. Mitigation: Applied confirmation includes editable actual free-type lines and persists actual snapshots.
11. **Application correction drifts from pass.** A linked application is later voided/corrected while Program remains Applied. Mitigation: tracker derives a link-health state and shows Voided/Corrected; never silently relink. A future explicit correction RPC owns changes.

### P3 — polish and maintainability

1. Multiple program tracks clutter one crop's board: collapse completed tracks, keep program headers sticky/visible, and enforce the 12-active cap.
2. Repeated category badges do not distinguish two fertility plans: program name is always primary; category is never the sole label.
3. Archived templates clutter pickers: hide by default with an Archived filter.
4. Long farmer text breaks 375px: wrap names/rates, keep actions 48px, test long products and 400-character notes; no horizontal page overflow.
5. Color-only status is inaccessible: always show Planned/Applied/Skipped words and icons/text, not color alone.
6. Product/unit spelling variants hurt future matching: preserve original text, trim surrounding whitespace, and let future reconcile store aliases; do not normalize away meaning now.
7. Huge assign-to-many payload: cap at 200 crop assignments per operation and chunk explicitly above that, with a separate operation ID per chunk.
8. Notification recipient choice is limited: V1 follows owner-only 0023; later add assigned applicator/member preferences without changing pass identity.

## 8. Client seam and screen contract

Mirror the established modules:

- `programs.ts`: types, validators, role helper, half-up normalization, farmer errors.
- `ProgramsDataGateway.ts` / `SupabaseProgramsDataGateway.ts`: reads via PostgREST, writes via the RPCs only.
- `SupabaseProgramsRepository.ts`: strict mapping and fail-closed canonical echo validation.
- `programsWriteQueue.ts`: version 1 discriminated entries for every mutation; exact-key/deep validation.
- `QueuedProgramsRepository.ts`: per-queue serialization, FIFO replay, transport-vs-definite failure handling, pending canonical projections, blocked status.
- `SupabaseProgramsRepository.regression.ts`: drive every write through Repository → Gateway with replay receipts and malformed echoes.
- `createSupabaseProgramsServices.ts`, `App.tsx` replay at farm-ready, sync-status key `programs`.

The page is `/programs`, nav label **Programs**. It has three plain views within one page: My programs, Assign to fields, and Season progress. The template builder uses large ordered pass cards, farmer-written product lines, optional category, and explicit Move up/down buttons (more reliable than drag on a gloved phone). Assignment choices read like “North 80 — Soybeans — 2026 — planting 1,” never raw IDs, and show every program already active on that crop before Confirm.

Season progress groups first by exact field/crop/year/planting sequence and then renders one track per active or historically relevant `program_assignment`. Each track header shows program name, optional category, assignment status, and progress. Apply/Skip/Reschedule target one pass inside that track; Refresh and Unassign target that one assignment. Reassign says “Replace [program name]” and replaces only that assignment, never all programs on the crop. Confirmations repeat field, crop, program, and affected pass counts. At 375px, tracks stack/collapse by program, cards stack, numeric/cost values use tabular numbers, base text is at least 18px, targets at least 48px, and the common action remains within two taps.

## 9. Build plan — loop-sized and independently provable

No chunk applies SQL or deploys without Mason's separate approval. Each chunk gets the normal Sol adversarial review after its builder pass.

### Chunk 1 — schema and RPC contract (Terra)

Draft `0024_programs.sql`: tables including optional checked `program_kind`, constraints including same-program active uniqueness and the 12-active-per-crop guard (with no one-active-per-crop index), RLS, triggers, task-source widening/columns, per-assignment and per-crop cost views, and receipt-idempotent template/assignment RPCs. Add SQL/static contract tests for grants, farm scoping, advisory locks, no invoker row locks, state constraints, multiple active programs, same-program rejection, cap/concurrency, double-crop, single-assignment archive/reassign, ordering, and replay.

**Independent proof:** migration validates in a disposable/local database only; worker can write, read_only/rep cannot; cross-farm IDs fail; same operation returns identical receipt; chemical plus fertility and two different fertility programs coexist on one crop; assigning the same program twice and a thirteenth active program fail; two crop assignments on one field remain separate. Browser checkpoint after app read seam: seeded multi-program graph can be read without cross-farm leakage.

### Chunk 2 — template builder and offline writes (Terra)

Build types, Gateway, Repository, versioned FIFO, regression suite, services, `/programs` template list/builder, pass ordering, free-type products, and archive actions. Do not build assignment yet.

**Independent browser proof:** on 375px create “Corn 3-pass,” add/reorder Pre/Post/Fungicide, type realistic products/rates/units/costs, refresh, edit, archive, and verify persistence; simulate offline save then reconnect/replay once; no overflow and no catalog picker.

### Chunk 3 — assign and season tracker (Terra)

Build crop-assignment picker that shows existing programs, materialization, optional overlap advisory, assignment refresh/revision banner, atomic single-assignment reassign, reschedule, Applied/Skipped/Unassign flows, actual free-type confirmation, and progress read model grouped into named/category program tracks. Every action carries one assignment/pass identity. Keep application creation disabled until Chunk 5 proof.

**Independent browser proof:** assign chemical plus fertility and two differently named fertility programs to the same crop; two intentional “Post” passes remain separate and clearly named; refresh/unassign/reassign one track without changing its neighbors; assign one template to two fields plus wheat and double-crop soybeans on the same physical field; statuses/dates remain independent; edit template and prove assigned snapshots do not change until explicit refresh; Applied history survives unassign/reassign and offline replay.

### Chunk 4 — tasks and reminders (Terra)

Build due generation, task columns/rendering, owner notification insert, exact dedupe/open-card behavior, startup/refresh best-effort calls, and Applied/Skipped/Cancelled closure.

**Independent browser proof:** a due pass creates exactly one board card and one notification across repeated calls/new operation IDs; reschedule updates rather than duplicates the open card; Apply closes it; task generation failure does not block a Program save.

### Chunk 5 — weather, application reality, and cost seam (Terra)

Add spray-light composition using the existing weather service, existing-record linking, guarded Program-created application headers/free-type joined rendering, and planned-vs-actual costs per program with optional per-crop/category rollups. Add the “on-hand unchanged” disclosure. Do not implement CRX order/delivery integration, catalog reconciliation, or sub-field soil/zone allocation.

**Independent browser proof:** a located spray field shows the same verdict/reason/staleness as Weather; missing/offline weather does not block Apply; linking rejects another crop/farm; Program-created record renders safely with free-type actual products and leaves on-hand unchanged; each program's cost is visible separately; the crop rollup lists included programs/category subtotals and remains incomplete when any included program is incomplete rather than displaying complete/$0.

### Chunk 6 — farmer polish and full regression (Luna, then Terra verification)

Luna handles plain-English copy, empty/error states, archived filters, long-text wrapping, status labels, 18px/48px/tabular-number checks, and documentation. Terra owns any behavioral fix discovered and runs the complete Programs regression plus existing module regressions.

**Independent browser proof:** 375px and desktop, sunlight-friendly contrast, keyboard/focus checks, no color-only meaning, long names/rates/notes, read-only view, offline Blocked state, and the complete two-tap happy path from template to Applied.

## 10. Required regression coverage before ship

At minimum, drive these as named coverage groups through the real Repository/Gateway boundary:

1. role/RLS matrix and cross-farm fail-closed behavior;
2. template save, product bundle, contiguous reorder, archive, revision;
3. operation replay, caller mismatch, concurrent distinct-operation entity locking;
4. exact crop-assignment scope including double-crop;
5. materialized snapshot and explicit refresh terminal/override preservation;
6. multiple active programs per crop, same-program active uniqueness, 12-program cap/concurrency, and single-assignment reassign/unassign with Applied history;
7. no-date/planting-offset/manual due-date resolution;
8. task open guard, task cycle unique key, notification dedupe, reschedule, and same-named passes across programs producing distinct program-labeled cards/reminders;
9. Applied/Skipped transitions, actual products, card closure;
10. existing/new application link validation and zero inventory movement;
11. per-program and per-crop/category cost completeness, multiplicity rollups, and `roundDecimalHalfUp` edge values such as 1.005;
12. queue corruption, FIFO, pending projection, transport retry, definite Blocked state, malformed canonical replies;
13. weather missing/stale/live best-effort composition;
14. delete/restrict/archive behavior and long-text/mobile contracts.

Final proof after the last code change: `npx tsc -b --force`, `npm run build`, `npm run regression`, migration/SQL behavior in a disposable database, then Claude's hands-on browser pass. Production migration and deployment remain separate owner-gated actions.

## 11. Explicit non-goals for V1

- No inventory catalog picker, product auto-match, label-rate validation, quantity conversion, or inventory deduction from free text.
- No CRX order ingestion, customer-account linking, scheduled-delivery UI, or delivery event processing.
- No auto-apply from task completion, weather verdict, order delivery, or application record.
- No growth-stage prediction, crop-development model, or automatic date inferred from prose.
- No sub-field management zones, soil polygons, VRT maps, mapped light/high-productivity acres, or automatic program choice by soil.
- No production migration, deploy, data backfill, or CRX Manager modification as part of this design.
