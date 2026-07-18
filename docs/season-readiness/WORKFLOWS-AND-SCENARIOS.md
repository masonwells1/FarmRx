# Farm Rx 2027 workflows and season scenarios

## Purpose

This is the executable product contract for the 2027 season-readiness goal. It describes synthetic, local-only scenarios against existing Farm Rx behavior. It is not a request for new modules or integrations.

Read [`../GOAL.md`](../GOAL.md) first. Its owner directive, scope, current capability truth, and status definitions control this document.

## Proof rules shared by every scenario

- Interpret every instant in `America/Chicago`; the explicit UTC offset below is part of the fixture.
- Inject the simulated clock into the browser and data path. Never infer a scenario date from the workstation clock.
- Use only the synthetic fixtures in this file and a disposable local backend created from the repository's current migrations.
- Browser traffic may reach only the local app, disposable backend, and deterministic test doubles explicitly named by the scenario.
- Opening `Today`, `Quick Record`, a form, Weather, or a read-only report is not a write.
- `Quick Record` is a launcher into an existing owner workflow. The destination workflow owns validation, IDs, queues, submit locks, and receipts.
- Capture the pre-action database state, the visible UI action and receipt, and the post-action state. Compare both expected writes and expected non-writes.
- A UI assertion alone cannot prove a database mutation. A database assertion alone cannot prove a farmer can perform or understand the workflow.
- Do not add a `run_id` to a product table. Store the exact commit, manifest hash, scenario name, browser project, simulated instant, and evidence paths outside the product database.

## External deterministic fixture UUID manifest

This manifest is proof infrastructure, not product schema. IDs remain stable across reruns. Fixture builders must fail if an unlisted product-row UUID is generated nondeterministically.

| Fixture | UUID |
|---|---|
| owner user | `27000000-0000-4000-8000-000000000001` |
| manager user | `27000000-0000-4000-8000-000000000002` |
| worker user | `27000000-0000-4000-8000-000000000003` |
| read-only user | `27000000-0000-4000-8000-000000000004` |
| named Crop RX rep user | `27000000-0000-4000-8000-000000000005` |
| outsider user | `27000000-0000-4000-8000-000000000006` |
| Maple Ridge farm | `27010000-0000-4000-8000-000000000001` |
| North Fork farm | `27010000-0000-4000-8000-000000000002` |
| Prairie Spray farm | `27010000-0000-4000-8000-000000000003` |
| Harvest Ridge farm | `27010000-0000-4000-8000-000000000004` |
| Cedar Creek farm | `27010000-0000-4000-8000-000000000005` |
| Pine Hill farm | `27010000-0000-4000-8000-000000000006` |
| Maple Ridge operating entity | `27011000-0000-4000-8000-000000000001` |
| North Fork operating entity | `27011000-0000-4000-8000-000000000002` |
| Prairie Spray operating entity | `27011000-0000-4000-8000-000000000003` |
| Harvest Ridge operating entity | `27011000-0000-4000-8000-000000000004` |
| Cedar Creek operating entity | `27011000-0000-4000-8000-000000000005` |
| Pine Hill operating entity | `27011000-0000-4000-8000-000000000006` |
| Maple East 160 field | `27020000-0000-4000-8000-000000000001` |
| North Home 80 field | `27020000-0000-4000-8000-000000000002` |
| Prairie South 120 field | `27020000-0000-4000-8000-000000000003` |
| Harvest Bottom 160 field | `27020000-0000-4000-8000-000000000004` |
| Cedar West 40 field | `27020000-0000-4000-8000-000000000005` |
| Pine North 60 field | `27020000-0000-4000-8000-000000000006` |
| Maple East owned arrangement | `27021000-0000-4000-8000-000000000001` |
| North Home owned arrangement | `27021000-0000-4000-8000-000000000002` |
| Prairie South owned arrangement | `27021000-0000-4000-8000-000000000003` |
| Harvest Bottom owned arrangement | `27021000-0000-4000-8000-000000000004` |
| Cedar West owned arrangement | `27021000-0000-4000-8000-000000000005` |
| Pine North owned arrangement | `27021000-0000-4000-8000-000000000006` |
| Maple 2027 corn crop assignment | `27030000-0000-4000-8000-000000000001` |
| North 2027 corn crop assignment | `27030000-0000-4000-8000-000000000002` |
| Prairie 2027 soybean crop assignment | `27030000-0000-4000-8000-000000000003` |
| Harvest 2027 corn crop assignment | `27030000-0000-4000-8000-000000000004` |
| Cedar 2027 soybean crop assignment | `27030000-0000-4000-8000-000000000005` |
| Pine 2027 corn crop assignment | `27030000-0000-4000-8000-000000000006` |
| Maple known inventory product | `27040000-0000-4000-8000-000000000000` |
| Prairie known inventory product | `27040000-0000-4000-8000-000000000001` |
| Maple receipt | `27041000-0000-4000-8000-000000000000` |
| Prairie receipt | `27041000-0000-4000-8000-000000000001` |
| Maple receipt line | `27042000-0000-4000-8000-000000000000` |
| Prairie receipt line | `27042000-0000-4000-8000-000000000001` |
| Maple completed application record | `27043000-0000-4000-8000-000000000000` |
| Prairie application record | `27043000-0000-4000-8000-000000000001` |
| Maple completed application product | `27044000-0000-4000-8000-000000000000` |
| Prairie application product | `27044000-0000-4000-8000-000000000001` |
| Maple synthetic program | `27050000-0000-4000-8000-000000000001` |
| Maple program pass | `27051000-0000-4000-8000-000000000001` |
| Maple program-pass product | `27051100-0000-4000-8000-000000000001` |
| Maple program assignment | `27052000-0000-4000-8000-000000000001` |
| Maple assigned pass | `27053000-0000-4000-8000-000000000001` |
| Maple assigned-program-pass product | `27053100-0000-4000-8000-000000000001` |
| Maple draft application record | `27054000-0000-4000-8000-000000000001` |
| Maple scouting note | `27060000-0000-4000-8000-000000000001` |
| Maple farm task | `27061000-0000-4000-8000-000000000001` |
| North permission-test farm task | `27061000-0000-4000-8000-000000000002` |
| Cedar scouting note | `27060000-0000-4000-8000-000000000005` |
| Maple Grain production estimate | `27070000-0000-4000-8000-000000000001` |
| Harvest Grain production estimate | `27070000-0000-4000-8000-000000000004` |
| Maple grain contract | `27071000-0000-4000-8000-000000000001` |
| Harvest grain contract | `27071000-0000-4000-8000-000000000004` |
| Maple contract delivery | `27072000-0000-4000-8000-000000000001` |
| Harvest contract delivery | `27072000-0000-4000-8000-000000000004` |
| Maple grain bin | `27073000-0000-4000-8000-000000000001` |
| Harvest grain bin | `27073000-0000-4000-8000-000000000004` |
| Harvest bin inventory baseline | `27073500-0000-4000-8000-000000000004` |
| Maple bin-in movement | `27074000-0000-4000-8000-000000000000` |
| Maple bin-out movement | `27074000-0000-4000-8000-000000000001` |
| Harvest bin-out movement | `27074000-0000-4000-8000-000000000004` |
| Pine connected field note | `27080000-0000-4000-8000-000000000001` |
| Pine revoked field note | `27080000-0000-4000-8000-000000000002` |
| Pine connected queue operation | `27090000-0000-4000-8000-000000000001` |
| Pine revoked queue operation | `27090000-0000-4000-8000-000000000002` |
| Pine initial revocation-fence token | `27091000-0000-4000-8000-000000000001` |
| Pine revoked revocation-fence token | `27091000-0000-4000-8000-000000000002` |

Membership, access-epoch, baseline, and snapshot rows must also be deterministic. A fixture implementation tranche must extend this external table before using additional UUIDs; it must not improvise IDs at runtime or add proof-only identity columns to Farm Rx.

Commodity IDs are existing non-UUID lookup keys: use `corn_yellow` for the corn assignments and `soybeans` for the soybean assignments. Farm memberships and rep grants use their existing composite user/farm keys rather than invented row UUIDs.

## Baseline synthetic facts

- All names, contacts, products, weather, prices, yields, and regulatory-looking values are fictional.
- Maple Ridge starts with its farm, owner membership, operating entity, and manifest Inventory product `Synthetic Herbicide 41 — Maple`; that product's canonical inventory unit is `gal`. It has no field, crop assignment, season activity, inventory ledger, Program, task, application, Grain, or bin row before January.
- North Fork starts with active memberships mapping owner user → `owner`, manager user → `manager`, worker user → `worker`, and read-only user → `read_only`; the named rep has an enabled, unrevoked grant but no membership; the outsider has neither. The farm has North Home 80 and its crop assignment, sharing is `false`, and the named-rep access epoch is `1`.
- Prairie Spray starts with exactly 100.00 gal on hand of `Synthetic Herbicide 41`; its canonical inventory unit is `gal`, with fictional EPA snapshot `00000-000`, REI `12 hr`, PHI `0 hr`, and no assertion that any value is legally sufficient.
- Harvest Ridge starts with production estimate `expected_bushels = 32000.00`, `actual_bushels = null`, and `drives_math = projected`; a 30,000.00 bu manifest bin baseline in a 40,000.00 bu bin; and a 5,000.00 bu `cash` contract with buyer `Synthetic Elevator`, cash price `$4.25/bu`, delivery dates `2027-11-01` through `2027-12-15`, and contract number `HR-2027-001`.
- Cedar West 40 is fixed at latitude `38.210000`, longitude `-89.120000`, `location_source = manual`. Cedar weather uses only the exact local response below; no external provider is contacted.
- Pine Hill starts with the worker user's active membership on Pine Hill, access epoch `1`, Pine North 60 selected, and an empty field-log queue. Its browser fence is version `2`, generation `1`, manifest initial token, server epoch `1`, `revoked = false`, and `changedAt = 2027-08-04T13:55:00-05:00`; the independent generation ledger has the same generation/token/epoch/time.

## Scenario MR — Maple Ridge 12-month farm year

**Primary role:** owner user · **Farm:** Maple Ridge · **Browser:** phone-sized and desktop · **Backend:** disposable local · **Network:** online-local except where stated

This is one continuous narrative. Reset once before January, then preserve the same local database through December.

| Month and simulated instant | Farmer action and visible evidence | Expected writes | Expected non-writes |
|---|---|---|---|
| Jan 12, `2027-01-12T08:00:00-06:00` | Sign in, land on `Today`, and use guided setup to create Maple East 160 under the manifest entity: 160.00 total ac, Jackson County, `IL`, owned arrangement effective `2027-01-01`; create crop `corn_yellow`, year `2027`, sequence `1`, 160.00 planted ac, 200.0000 bu/ac expected yield, with planting/harvest/actual-price fields `null`. `Today` then reflects completed setup. | The Fields save creates exactly the manifest field, owned arrangement, and crop-assignment rows with those values. | Merely opening `Today` performs no write. No separate setup-status row or standalone planting-actual row appears. |
| Feb 18, `2027-02-18T09:00:00-06:00` | Create `Maple 2027 Corn Program` (`program_kind = chemical`, `commodity_id = corn_yellow`, `crop_year = 2027`). Add pass `Post-emerge synthetic pass` (`pass_type = post`, `activity_type = spray`, target `2027-05-20`, reminder lead `3` days) and product `Free-Typed Program Herbicide` (`rate_text = 10.00`, `unit_text = gal total`, estimated cost `$7.00/ac`). Assign it to the manifest Maple crop assignment and reopen it from Programs and `Today`. | Exactly one row each is created with the six manifest IDs in `programs`, `program_passes`, `program_pass_products`, `program_assignments`, `assigned_program_passes`, and `assigned_program_pass_products`. The assigned rows preserve the named snapshot values. | Inventory products/ledger, receipts, applications, tasks, notifications, Grain, and the crop assignment remain unchanged. No runtime-generated Program product UUID is accepted. |
| Mar 22, `2027-03-22T07:30:00-05:00` | Receive exactly 100.00 gal of `Synthetic Herbicide 41 — Maple` from `Synthetic Ag Supply`, received `2027-03-22`, reference `MR-REC-001`, using the manifest receipt and receipt-line IDs; see the confirmed receipt and 100.00 gal on hand. | Exactly one receipt and one receipt-line row are created; quantity is 100.00 and unit/canonical inventory unit are both `gal`; on-hand changes from 0.00 to 100.00 gal. | No pending Crop RX delivery record or UI state, application, Program-product match, task, notification, or Grain row is created. |
| Apr 16, `2027-04-16T06:45:00-05:00` | Record planting date `2027-04-15` on the existing crop assignment and confirm it after reload. | The existing crop-assignment row changes its planting date/version through the Fields save path. | No planting-event/planting-actual entity, machine-import row, or grain lot is created. |
| May 20, `2027-05-20T10:15:00-05:00` | Mark the manifest assigned pass applied on 160.00 ac and `2027-05-20`, choose **Create a new draft record**, and enter actual product `Free-Typed Program Herbicide`, actual rate `10.00`, actual unit `gal total`, and actual cost `$7.00/ac`. See the manifest draft application linked in Inventory. | The assigned pass becomes `applied` with the exact date/acres, its manifest assigned-product row stores the four actual values, and exactly one manifest `application_records` draft row is created and linked. | No `application_products` row is created for the free-typed Program line; Inventory receipts and derived on-hand remain exactly 100.00 gal; no task, notification, or Grain row changes. |
| Jun 18, `2027-06-18T08:20:00-05:00` | Read Weather, then manually type into the manifest completed application: date `2027-06-18`, time `08:20`, field/crop manifest IDs, 160.00 ac, pest `Synthetic broadleaf`, applicator `Scenario Operator`, license `PRESENCE-ONLY-2027`, wind `8.0` mph, direction `SW`, temperature `74.0°F`, RH `52%`. Select `Synthetic Herbicide 41 — Maple` with rate `0.0625 gal/acre`, total `10.00 gal`, `rate_basis = acre`, and no package factor. | Exactly one completed application row and one application-product row are created with the manifest IDs and exact values. The product/label snapshots use the known Inventory product, and derived on-hand changes from 100.00 gal to exactly 90.00 gal because `160.00 × 0.0625 = 10.00`. | Weather performs no write and does not auto-fill/create the record or store a provider observation/provenance link. The May Program draft and free-typed assigned product remain unchanged and cause no Inventory movement. |
| Jul 09, `2027-07-09T16:10:00-05:00` | From `Quick Record`, save the manifest scouting note with date `2027-07-09`, category `weed`, note `Synthetic waterhemp at south gate`, `latitude = null`, `longitude = null`, no photos, and **Add a follow-up task** unchecked. Then separately use Quick Record → Task to create the manifest task: title `Inspect Maple south gate`, details `Check synthetic waterhemp patch.`, `todo`, normal priority, assigned to owner user, due `2027-07-10`, linked to Maple East 160, source `manual`. Confirm both receipts. | Exactly one `scouting_notes` row and one separately created `farm_tasks` row contain those values. | Opening either launcher/form writes nothing. `scouting_photos` and `notifications` remain empty, no scouting-created task is generated, and no spray record or Program status changes. |
| Aug 17, `2027-08-17T13:00:00-05:00` | Use `Today` to open `Inspect Maple south gate`, mark it done, then reload. | Only the manifest task row changes: `status = done`, server-owned completion identity/time reflects the owner and simulated instant, and its version/`updated_at` advances once. | `Today` does not create a task or mutate Programs, Inventory, Grain, Fields, scouting, or notifications while reading. |
| Sep 28, `2027-09-28T18:05:00-05:00` | From `Quick Record`, enter harvest: 30,800.00 bu, date `2027-09-28`, fictional actual price `$4.250000`. Confirm receipt and reload. | Only the existing Maple crop assignment's `harvested_bushels`, `harvest_date`, `actual_price_per_bu`, and version fields change. | Grain production remains projected; the Grain estimate, contracts, deliveries, and every bin row remain unchanged. |
| Oct 19, `2027-10-19T08:40:00-05:00` | Open Grain. See Harvest actuals 30,800.00 bu and Grain actual not entered. Confirm **Use harvest total as Grain actual** and see the math switch to Actual. | The manifest Grain production estimate saves `actual_bushels = 30800.00` and `drives_math = actual`. | The crop assignment is not rewritten by the Grain action. No bin, lot, contract, or delivery is created or changed. |
| Nov 10, `2027-11-10T11:25:00-06:00` | Create manifest bin `Maple North Bin`, capacity 40,000.00 bu, on-farm, location `Maple Ridge`; add the manifest manual In movement for 30,800.00 bu `corn_yellow`, occurred `2027-09-28`, note `2027 harvest load-in`. Create the manifest `cash` contract for 5,000.00 bu with buyer `Synthetic Elevator`, `$4.25/bu`, delivery `2027-11-10` through `2027-12-15`, contract `MR-2027-001`, premium `0`, notes `null`. Separately add the manifest 5,000.00 bu manual Out movement dated `2027-11-10`, note `Delivery to Synthetic Elevator`. Separately record the manifest 5,000.00 bu contract delivery dated `2027-11-10`, note `null`. Capture local DB state after each button. | Five independent writes occur in order: one bin, one In transaction, one contract, one Out transaction, one contract-delivery row. Bin on-hand is 30,800.00 after In and 25,800.00 after Out; delivered total is 0.00 until the delivery action, then 5,000.00. | Bin creation/In does not create a contract or delivery. Contract creation does not move grain. Bin-out does not record delivery. Delivery does not add another bin movement. No `bin_inventory` baseline or grain lot auto-appears. |
| Dec 15, `2027-12-15T09:30:00-06:00` | Review `Today`, Fields, Grain, Inventory/compliance, Programs, and the existing reports. Reload and confirm the year's totals remain coherent. | No write is expected from review/export/print actions. | No year-end finalization row/action, rollover mutation, Crop RX sync, vendor sync, or hidden cross-module reconciliation occurs. |

**Maple Ridge pass condition:** every row above has UI evidence and focused before/after local-database evidence; all explicit writes occur once; all non-writes remain byte/count stable; month-to-month totals reconcile without a new module or hidden coupling.

## Scenario NF — North Fork permissions and privacy

| Step | Fixed instant, role, network | Expected UI and local database evidence |
|---|---|---|
| NF-1 | `2027-02-09T08:00:00-06:00`, owner, online-local | Sharing is visibly OFF (`share_with_rep = false`). Named rep and outsider cannot open the farm. Named-rep epoch is `1`; all denial attempts leave every North Fork row/version unchanged. |
| NF-2 | `2027-02-09T08:15:00-06:00`, owner, online-local | Owner explicitly confirms sharing ON. Only North Fork `share_with_rep`/farm version changes and the named-rep epoch advances from `1` to `2`; membership, ownership, operational, Grain, and financial rows remain unchanged. |
| NF-3 | `2027-02-09T08:30:00-06:00`, named rep, online-local | Enabled, assigned, unrevoked rep may read allowed private views while sharing is ON, but cannot edit farm, Grain, privacy, or operational records. All attempted-write table counts and row versions remain unchanged. |
| NF-4 | `2027-02-09T09:00:00-06:00`, worker, online-local | Worker sees allowed operational navigation and creates the manifest task with title `Inspect North Home gate`, details `Check synthetic gate latch.`, `status = todo`, normal priority, assigned to worker user, due `2027-02-10`, linked to North Home 80, source `manual`. Exactly that one `farm_tasks` row is inserted; Grain/private financial navigation and reads remain unavailable, and privacy/ownership/Grain rows remain unchanged. |
| NF-5 | `2027-02-09T09:20:00-06:00`, read-only user, online-local | Allowed operational reads work; create/update/delete attempts fail closed and produce zero database writes. |
| NF-6 | `2027-02-09T09:40:00-06:00`, manager, online-local | Manager opens `Inspect North Home gate` and marks it complete. Only that manifest `farm_tasks` row changes: `status = done`, server-owned completion identity/time reflects the manager and simulated instant, and its version/`updated_at` advances once. Privacy, ownership, membership, access-epoch, Grain, and financial rows remain unchanged. |
| NF-7 | `2027-02-09T10:00:00-06:00`, owner then stale rep tab, online-local | Owner explicitly turns sharing OFF. Only `share_with_rep`/farm version changes and the named-rep epoch advances from `2` to `3`. The old rep tab loses access after revalidation; stale reads/writes fail, write zero product rows, and do not preserve old private data as current. |
| NF-8 | `2027-02-09T10:20:00-06:00`, outsider, online-local | Farm selection/read/write remains denied with zero North Fork mutations. |

Farm switching must clear the old farm's visible private content before a new farm is confirmed. Navigation shape is usability, not authorization; local RLS proof is required for every denial.

## Scenario PS — Prairie Spray compliance presence

**Fixed instant:** `2027-06-15T14:10:00-05:00` · **Role:** manager · **Network:** online-local · **Farm/field/product/application:** manifest IDs

1. Open the existing Spray record form and choose manifest farm Prairie Spray, field Prairie South 120, and the manifest 2027 soybean assignment.
2. Enter `applied_acres = 120.00`, application date `2027-06-15`, time `14:10`, target pest `Synthetic broadleaf`, applicator `Scenario Operator`, and license text `PRESENCE-ONLY-2027`.
3. Manually enter wind `8.0` mph, direction `SW`, temperature `74.0°F`, and relative humidity `52%`.
4. Choose manifest product `Synthetic Herbicide 41`, whose canonical inventory unit is `gal`; enter rate `0.0625`, rate unit `gal`, rate basis `acre`, total `7.50`, total unit `gal`, and no package factor. Save as completed using the manifest application/application-product IDs.
5. Prove exactly one application record and one application product exist with those exact field/crop/farm/date/time/acres/pest/applicator/license/weather/rate/total values and the seeded product/label snapshots.
6. Prove derived on-hand changes from exactly 100.00 gal to 92.50 gal because `120.00 × 0.0625 = 7.50` in the same canonical unit.
7. Prove Program, weather-provider/provenance, Crop RX delivery, task, notification, Grain, and scouting rows/counts/versions remain unchanged and no second application is created.

This scenario proves only that compliance-related fields and saved snapshots are present, retained, and surfaced. It makes **no claim** that the applicator is licensed, that the license is eligible for a product or jurisdiction, or that the license is unexpired. Farm Rx currently stores the entered text; this proof is not a legal or regulatory eligibility service.

## Scenario HR — Harvest Ridge Grain truth

| Step | Fixed instant and action | Expected write | Expected non-write |
|---|---|---|---|
| HR-1 | `2027-10-11T17:30:00-05:00`, owner, online-local: save 27,600.00 bu harvest on Harvest Bottom 160. | Crop assignment harvest actual fields only. | Grain estimate remains projected and 30,000.00 bu bin baseline remains unchanged. |
| HR-2 | `2027-10-11T17:40:00-05:00`: open Grain reconciliation. | Read only. UI shows Harvest actuals 27,600.00 bu and Grain actual production `not entered`; the estimate remains `actual_bushels = null`, `drives_math = projected`. | No automatic Grain, bin, contract, delivery, or lot write. |
| HR-3 | `2027-10-11T17:45:00-05:00`: confirm **Use harvest total as Grain actual**. | Manifest production estimate changes to actual 27,600.00 and Actual drives math. | Harvest row and all bin rows remain unchanged. |
| HR-4 | `2027-11-06T09:00:00-06:00`: add the manifest 5,000.00 bu manual Out movement for `corn_yellow`, date `2027-11-06`, source `manual entry`, note `Delivery to Synthetic Elevator`. | Exactly one append-only bin transaction is inserted and on-hand changes from 30,000.00 to 25,000.00 bu. | Contract delivered total remains 0.00; contract/version and production estimate remain unchanged. |
| HR-5 | `2027-11-06T09:05:00-06:00`: record the manifest 5,000.00 bu delivery dated `2027-11-06`, note `null`, against contract `HR-2027-001`. | Exactly one contract-delivery row is inserted and delivered total changes from 0.00 to 5,000.00 bu. | Bin on-hand remains 25,000.00 bu, no second bin transaction appears, and no automatic lot is created. |

The two November actions must also pass in the opposite order after a clean scenario reset. Order may change the display sequence, but it must never introduce hidden coupled mutation.

## Scenario CC — Cedar Creek weather and scouting

**Fixed instant:** `2027-07-07T13:20:00-05:00` · **Role:** owner · **Network:** browser online to local services; weather provider replaced by deterministic local double

- Cedar West 40 uses manifest coordinates `38.210000`, `-89.120000`. The local double returns this exact finite bundle; field-wall-clock weather times are intentionally offset-free, while `fetched_at` is an absolute America/Chicago instant:

```json
{
  "fetched_at": "2027-07-07T13:15:00-05:00",
  "stale": false,
  "current": {
    "time": "2027-07-07T13:20",
    "temperature_f": 74.0,
    "relative_humidity": 52,
    "precipitation_in": 0.0,
    "precipitation_probability": 10,
    "wind_speed_mph": 8.0,
    "wind_direction_degrees": 225,
    "wind_gusts_mph": 10.0,
    "cloud_cover": 30
  },
  "hourly": [
    { "time": "2027-07-07T13:20", "temperature_f": 74.0, "relative_humidity": 52, "precipitation_in": 0.0, "precipitation_probability": 10, "wind_speed_mph": 8.0, "wind_direction_degrees": 225, "wind_gusts_mph": 10.0, "cloud_cover": 30 },
    { "time": "2027-07-07T14:20", "temperature_f": 75.0, "relative_humidity": 50, "precipitation_in": 0.0, "precipitation_probability": 10, "wind_speed_mph": 8.0, "wind_direction_degrees": 225, "wind_gusts_mph": 10.0, "cloud_cover": 28 },
    { "time": "2027-07-07T15:20", "temperature_f": 77.0, "relative_humidity": 48, "precipitation_in": 0.0, "precipitation_probability": 10, "wind_speed_mph": 9.0, "wind_direction_degrees": 230, "wind_gusts_mph": 11.0, "cloud_cover": 25 },
    { "time": "2027-07-07T16:20", "temperature_f": 78.0, "relative_humidity": 47, "precipitation_in": 0.0, "precipitation_probability": 10, "wind_speed_mph": 9.5, "wind_direction_degrees": 230, "wind_gusts_mph": 12.0, "cloud_cover": 25 },
    { "time": "2027-07-07T17:20", "temperature_f": 77.0, "relative_humidity": 49, "precipitation_in": 0.0, "precipitation_probability": 10, "wind_speed_mph": 8.5, "wind_direction_degrees": 225, "wind_gusts_mph": 11.0, "cloud_cover": 28 }
  ],
  "daily": [
    { "date": "2027-07-07", "precipitation_sum_in": 0.0, "precipitation_probability_max": 10, "temperature_max_f": 82.0, "temperature_min_f": 62.0, "sunrise": "2027-07-07T05:38", "sunset": "2027-07-07T20:27" },
    { "date": "2027-07-08", "precipitation_sum_in": 0.0, "precipitation_probability_max": 15, "temperature_max_f": 83.0, "temperature_min_f": 63.0, "sunrise": "2027-07-08T05:39", "sunset": "2027-07-08T20:27" }
  ]
}
```

- **CC-1 fresh proof:** Weather displays `74°F`, `8 mph SW`, gusts `10 mph`, humidity `52%`, rain `0.00 in`, a fresh **Good / Spray now** verdict, and the five-hour good window ending at `18:20`. Browser network evidence shows zero request to an external weather host. Opening Weather changes no product row.
- **CC-2 stale proof:** Reuse the exact current/hourly/daily body with `fetched_at = 2027-07-07T10:00:00-05:00` and `stale = true`. At the fixed scenario clock it is displayed as three hours old, the verdict is **Caution / Refresh before spraying**, and no actionable good window is shown. Opening/retrying Weather changes no product row.
- **CC-3 scouting proof:** While CC-2 remains visible, use `Quick Record` to save the manifest Cedar scouting note: field Cedar West 40, date `2027-07-07`, category `weed`, note `Synthetic waterhemp along west edge`, `latitude = null`, `longitude = null`, `photos = []`, and `create_task = false`. Exactly one `scouting_notes` row is created and the receipt remains visible even though Weather is stale.
- **Required Cedar non-writes:** `scouting_photos`, `farm_tasks`, `notifications`, `application_records`, `application_products`, Inventory, Program, Grain, and field-location rows/counts/versions remain unchanged. No spray save, photo, follow-up task, notification, or location capture is part of the required Cedar pass. Manual weather transcription and the absence of provider provenance are proved by the required Maple and Prairie spray scenarios with exact `8.0 mph SW`, `74.0°F`, and `52%` values.

No assertion here requests a new weather vendor, weather-history table, automatic weather transcription, or weather-to-spray provenance feature.

## Scenario PH — Pine Hill offline and recovery

| Step | Fixed instant, role, network | Expected UI, browser storage, and local database evidence |
|---|---|---|
| PH-1 | `2027-08-04T14:00:00-05:00`, worker, forced offline | `Quick Record` opens Field note. Save manifest connected note with field Pine North 60, `entry_type = note`, `observed_on = 2027-08-04`, `rainfall_in = null`, note `Synthetic north fence washed out`. UI yields `Saved on this device — waiting for signal`. Exactly one queue entry uses manifest operation ID, worker user, Pine Hill farm, fence generation `1`, manifest initial token, and server epoch `1`; local `field_log_entries` remains unchanged. |
| PH-2 | `2027-08-04T14:10:00-05:00`, worker user/Pine Hill, reconnect | Revalidation at epoch `1` succeeds, exactly the manifest connected field-log row is written once, and only the matching queue entry clears. Two additional reconnect/retry events leave row count/version unchanged. |
| PH-3 | `2027-08-04T14:30:00-05:00`, worker, forced offline | Save manifest revoked note with field Pine North 60, `entry_type = note`, `observed_on = 2027-08-04`, `rainfall_in = null`, note `Synthetic revoked-user note`. Exactly one pending queue entry uses the manifest revoked operation ID, fence generation `1`, manifest initial token, and server epoch `1`; local database remains unchanged. |
| PH-4 | `2027-08-04T14:35:00-05:00`, disposable-backend fixture controller | Execute exactly one local-only setup mutation on composite key Pine Hill farm + worker user: change `farm_memberships.status` from `active` to `revoked`. Assert one affected membership row and the existing trigger advances that user's Pine Hill access epoch from `1` to `2`. Do not touch the worker browser's storage, any product row, or any other membership. |
| PH-5 | `2027-08-04T14:45:00-05:00`, revoked worker reconnect | Live revalidation reads server epoch `2`, writes the exact revoked fence/ledger state `generation = 3`, manifest revoked token, `serverEpoch = 2`, `revoked = true`, `changedAt = 2027-08-04T14:45:00-05:00`, and fails upload closed. The saved work remains visible in the existing recovery surface and can be exported. No Pine or other-farm field-log row is created, and the queue is never reassigned to another user, farm, or account. |
| PH-6 | `2027-08-04T15:00:00-05:00`, revoked worker switches/reloads | Old-farm content is not shown as current. Recovery remains honest; signing into a different account/farm cannot replay the revoked operation. |

The proof packet copies the PH-1/PH-3 operation, user, farm, generation, manifest-token identifier, and server-epoch values without exposing authentication tokens or secrets. Offline success means durable local custody and truthful wording, not a claim that the server has saved the row.

## Required evidence record per scenario

| Field | Required content |
|---|---|
| Identity | branch, exact commit SHA, clean/dirty state, fixture-manifest SHA-256, migration head |
| Clock | scenario step, full ISO instant with offset, `America/Chicago` display date/time |
| Actor | synthetic user UUID, role/capabilities, selected farm UUID; exact access epoch/fence for North Fork and Pine Hill, literal `not applicable` for the other scenarios |
| Network | online-local, provider-double, forced offline, reconnect, or revoked reconnect |
| UI | route, viewport/browser project, action, visible confirmation/error, screenshot/trace path |
| Local DB | focused before/after query or transaction assertion for each expected write |
| Non-write | focused row count/hash/version proof for each named table or object that must not change |
| Queue/recovery | exact operation UUID and safe structural fields; never tokens, passwords, keys, or customer data |
| Result | pass/fail, finding ID if failed, owning tranche/repair commit, reviewer exact SHA |

If an expected non-write changes, the scenario has found a product defect in existing behavior. That defect may justify a bounded repair. The absence of a feature or integration named as out of scope does not.
