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
| Maple program assignment | `27052000-0000-4000-8000-000000000001` |
| Maple assigned pass | `27053000-0000-4000-8000-000000000001` |
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
| Maple bin inventory baseline | `27073500-0000-4000-8000-000000000001` |
| Harvest bin inventory baseline | `27073500-0000-4000-8000-000000000004` |
| Maple bin-out movement | `27074000-0000-4000-8000-000000000001` |
| Harvest bin-out movement | `27074000-0000-4000-8000-000000000004` |
| Pine connected field note | `27080000-0000-4000-8000-000000000001` |
| Pine revoked field note | `27080000-0000-4000-8000-000000000002` |
| Pine connected queue operation | `27090000-0000-4000-8000-000000000001` |
| Pine revoked queue operation | `27090000-0000-4000-8000-000000000002` |

Membership, access-epoch, baseline, and snapshot rows must also be deterministic. A fixture implementation tranche must extend this external table before using additional UUIDs; it must not improvise IDs at runtime or add proof-only identity columns to Farm Rx.

Commodity IDs are existing non-UUID lookup keys: use `corn_yellow` for the corn assignments and `soybeans` for the soybean assignments. Farm memberships and rep grants use their existing composite user/farm keys rather than invented row UUIDs.

## Baseline synthetic facts

- All names, contacts, products, weather, prices, yields, and regulatory-looking values are fictional.
- Maple Ridge starts with no operational records. Its narrative creates the existing records it needs.
- North Fork contains the six declared users in the role combinations required below and one pre-existing operational field. Grain sharing starts OFF.
- Prairie Spray starts with 100.00 gal on hand of `Synthetic Herbicide 41`, with fictional EPA snapshot `00000-000`, REI `12 hr`, PHI `0 hr`, and no assertion that any value is legally sufficient.
- Harvest Ridge starts with a projected Grain estimate of 32,000.00 bu, a 30,000.00 bu bin baseline, and a 5,000.00 bu contract.
- Cedar Creek receives a deterministic local forecast double for its fixed location. No external weather provider is contacted.
- Pine Hill starts with valid worker access to its selected farm and an empty field-log queue.

## Scenario MR — Maple Ridge 12-month farm year

**Primary role:** owner user · **Farm:** Maple Ridge · **Browser:** phone-sized and desktop · **Backend:** disposable local · **Network:** online-local except where stated

This is one continuous narrative. Reset once before January, then preserve the same local database through December.

| Month and simulated instant | Farmer action and visible evidence | Expected writes | Expected non-writes |
|---|---|---|---|
| Jan 12, `2027-01-12T08:00:00-06:00` | Sign in, land on `Today`, use guided setup to add Maple East 160 and its 2027 corn assignment: 160 ac, 200 bu/ac expected yield. `Today` then reflects completed setup. | Existing Fields save path creates/updates the field, current arrangement, and crop assignment IDs in the manifest. | Merely opening `Today` performs no write. No separate setup-status row or standalone planting-actual row appears. |
| Feb 18, `2027-02-18T09:00:00-06:00` | Create and assign the synthetic corn program with one pass. Reopen it from Programs and `Today`. | Existing Program, pass, product, assignment, and assigned-pass rows only. | No Inventory product, receipt, application, task, or Grain row is created implicitly. |
| Mar 22, `2027-03-22T07:30:00-05:00` | Receive 100.00 gal of the known synthetic product through Inventory and see a confirmed receipt/on-hand total. | Inventory receipt and receipt-line rows; the existing on-hand projection becomes 100.00 gal. | No pending Crop RX delivery record or UI state, no application record, and no Program-product match is created. |
| Apr 16, `2027-04-16T06:45:00-05:00` | Record planting date `2027-04-15` on the existing crop assignment and confirm it after reload. | The existing crop-assignment row changes its planting date/version through the Fields save path. | No planting-event/planting-actual entity, machine-import row, or grain lot is created. |
| May 20, `2027-05-20T10:15:00-05:00` | Mark the Program pass applied on 160 ac, choose **Create a new draft record**, and see the linked draft in Inventory. Use free-typed actual product text. | Assigned pass/status and actual-text fields change; the manifest draft `application_records` row is created and linked to the assigned pass. | No `application_products` row is created for the free-typed Program line; Inventory on-hand remains exactly 100.00 gal. |
| Jun 18, `2027-06-18T08:20:00-05:00` | Read fresh deterministic Weather guidance, then manually type the shown wind/temperature/humidity into a completed spray record using the known Inventory product. Confirm the record and on-hand. | Existing application-record/application-product writes save the manually entered weather and label snapshots; the completed known-product use changes derived on-hand by the exact recorded quantity. | Weather does not auto-fill the spray record, create the record, or store a provider/provenance link. The earlier free-typed Program line still does not draw down Inventory. |
| Jul 09, `2027-07-09T16:10:00-05:00` | From `Quick Record`, save the manifest scouting note; explicitly choose its existing follow-up-task action and confirm both receipts. | One `scouting_notes` row and, only after the explicit task choice, one `farm_tasks` row. | Opening `Quick Record` or the scouting form writes nothing. No notification, spray record, or Program status changes unless the existing form explicitly requests it. |
| Aug 17, `2027-08-17T13:00:00-05:00` | Use `Today` to open the task, mark it done, then reload. | The existing task row changes status/version. | `Today` does not generate a duplicate task or mutate Programs, Inventory, Grain, or Fields while reading. |
| Sep 28, `2027-09-28T18:05:00-05:00` | From `Quick Record`, enter harvest: 30,800.00 bu, date `2027-09-28`, fictional actual price `$4.250000`. Confirm receipt and reload. | Only the existing Maple crop assignment's `harvested_bushels`, `harvest_date`, `actual_price_per_bu`, and version fields change. | Grain production remains projected; the Grain estimate, contracts, deliveries, and every bin row remain unchanged. |
| Oct 19, `2027-10-19T08:40:00-05:00` | Open Grain. See Harvest actuals 30,800.00 bu and Grain actual not entered. Confirm **Use harvest total as Grain actual** and see the math switch to Actual. | The manifest Grain production estimate saves `actual_bushels = 30800.00` and `drives_math = actual`. | The crop assignment is not rewritten by the Grain action. No bin, lot, contract, or delivery is created or changed. |
| Nov 10, `2027-11-10T11:25:00-06:00` | Create a 5,000.00 bu contract. Separately add a 5,000.00 bu manual Out movement to the Maple bin. Separately record a 5,000.00 bu contract delivery. Capture a database snapshot after each button. | Three independent writes: one contract, one `bin_transactions` Out row, and one `grain_contract_deliveries` row. | Contract creation does not move grain. Bin-out does not record delivery. Delivery does not add another bin movement. No grain lot auto-appears. |
| Dec 15, `2027-12-15T09:30:00-06:00` | Review `Today`, Fields, Grain, Inventory/compliance, Programs, and the existing reports. Reload and confirm the year's totals remain coherent. | No write is expected from review/export/print actions. | No year-end finalization row/action, rollover mutation, Crop RX sync, vendor sync, or hidden cross-module reconciliation occurs. |

**Maple Ridge pass condition:** every row above has UI evidence and focused before/after local-database evidence; all explicit writes occur once; all non-writes remain byte/count stable; month-to-month totals reconcile without a new module or hidden coupling.

## Scenario NF — North Fork permissions and privacy

| Step | Fixed instant, role, network | Expected UI and local database evidence |
|---|---|---|
| NF-1 | `2027-02-09T08:00:00-06:00`, owner, online-local | Sharing is visibly OFF. Named rep and outsider cannot open the farm. No denial attempt writes data. |
| NF-2 | `2027-02-09T08:15:00-06:00`, owner, online-local | Owner explicitly confirms sharing ON. Only the intended farm sharing/version/access-epoch state changes. |
| NF-3 | `2027-02-09T08:30:00-06:00`, named rep, online-local | Enabled, assigned, unrevoked rep may read allowed private views while sharing is ON, but cannot edit farm, Grain, privacy, or operational records. All attempted-write table counts and row versions remain unchanged. |
| NF-4 | `2027-02-09T09:00:00-06:00`, worker, online-local | Worker sees allowed operational navigation and can create the explicitly tested farm task; Grain/private financial navigation and reads remain unavailable. |
| NF-5 | `2027-02-09T09:20:00-06:00`, read-only user, online-local | Allowed operational reads work; create/update/delete attempts fail closed and produce zero database writes. |
| NF-6 | `2027-02-09T09:40:00-06:00`, manager, online-local | Existing manager-authorized farm operation works; privacy/ownership boundaries remain those enforced by current policy. Record the exact allowed action rather than generalizing from the role name. |
| NF-7 | `2027-02-09T10:00:00-06:00`, owner then stale rep tab, online-local | Owner explicitly turns sharing OFF. The old rep tab loses access after revalidation; stale reads/writes fail and do not preserve old private data as current. |
| NF-8 | `2027-02-09T10:20:00-06:00`, outsider, online-local | Farm selection/read/write remains denied with zero North Fork mutations. |

Farm switching must clear the old farm's visible private content before a new farm is confirmed. Navigation shape is usability, not authorization; local RLS proof is required for every denial.

## Scenario PS — Prairie Spray compliance presence

**Fixed instant:** `2027-06-15T14:10:00-05:00` · **Role:** manager · **Network:** online-local · **Farm/field/product/application:** manifest IDs

1. Open the existing Spray record form and choose Prairie South 120 plus the 2027 soybean assignment.
2. Enter 120 ac, date/time, target pest, fictional applicator name, the literal synthetic license text `PRESENCE-ONLY-2027`, and manually entered weather.
3. Choose the known Inventory product, record a valid synthetic rate/total, and save as completed.
4. Prove the application record and application product exist once, contain their expected field/crop/farm IDs, and preserve the product/label snapshots.
5. Prove the known completed application changes derived on-hand by exactly the canonical inventory-unit quantity.
6. Prove no Program row, weather-provider provenance row/link, Crop RX delivery row, or second application is created.

This scenario proves only that compliance-related fields and saved snapshots are present, retained, and surfaced. It makes **no claim** that the applicator is licensed, that the license is eligible for a product or jurisdiction, or that the license is unexpired. Farm Rx currently stores the entered text; this proof is not a legal or regulatory eligibility service.

## Scenario HR — Harvest Ridge Grain truth

| Step | Fixed instant and action | Expected write | Expected non-write |
|---|---|---|---|
| HR-1 | `2027-10-11T17:30:00-05:00`, owner, online-local: save 27,600.00 bu harvest on Harvest Bottom 160. | Crop assignment harvest actual fields only. | Grain estimate remains projected and 30,000.00 bu bin baseline remains unchanged. |
| HR-2 | `2027-10-11T17:40:00-05:00`: open Grain reconciliation. | Read only. UI shows Harvest 27,600.00 and the existing Grain actual independently. | No automatic Grain, bin, contract, delivery, or lot write. |
| HR-3 | `2027-10-11T17:45:00-05:00`: confirm **Use harvest total as Grain actual**. | Manifest production estimate changes to actual 27,600.00 and Actual drives math. | Harvest row and all bin rows remain unchanged. |
| HR-4 | `2027-11-06T09:00:00-06:00`: add a 5,000.00 bu manual Out movement. | Exactly one append-only bin transaction. | Contract delivered total remains unchanged. |
| HR-5 | `2027-11-06T09:05:00-06:00`: record 5,000.00 bu delivered on the existing contract. | Exactly one contract-delivery row. | Bin balance does not move again; no automatic lot is created. |

The two November actions must also pass in the opposite order after a clean scenario reset. Order may change the display sequence, but it must never introduce hidden coupled mutation.

## Scenario CC — Cedar Creek weather and scouting

**Fixed instant:** `2027-07-07T13:20:00-05:00` · **Role:** owner · **Network:** browser online to local services; weather provider replaced by deterministic local double

- The local weather double returns a fixed fetched time, temperature, wind, gust, humidity, precipitation, sunrise/sunset, hourly series, and daily series for Cedar West 40.
- Weather shows its freshness and guidance with no external request and no product database write.
- Opening a spray record from the guidance does not auto-save or auto-copy weather. If the proof continues into a saved spray record, the operator must manually type the displayed values, and the application row has no provider observation ID or provenance link.
- `Quick Record` opens Scouting without writing. Saving the manifest Cedar scouting note creates one farm/field-bound `scouting_notes` row and shows the correct receipt.
- Optional photo, task, or notification paths are tested only if explicitly selected. Absence of those rows is the expected non-write otherwise.
- A stale forecast must be labeled stale and must not be presented as fresh spray guidance. Scouting remains usable if the weather lane fails.

No assertion here requests a new weather vendor, weather-history table, automatic weather transcription, or weather-to-spray provenance feature.

## Scenario PH — Pine Hill offline and recovery

| Step | Fixed instant, role, network | Expected UI, browser storage, and local database evidence |
|---|---|---|
| PH-1 | `2027-08-04T14:00:00-05:00`, worker, forced offline | `Quick Record` opens Field note. Saving the manifest connected note yields `Saved on this device — waiting for signal`. One exact user/farm/fence/epoch-bound queue entry exists; local `field_log_entries` remains unchanged. |
| PH-2 | `2027-08-04T14:10:00-05:00`, same user/farm, reconnect | Revalidation succeeds, exactly one field-log row is written, and only the matching queue entry clears. Double reconnect/retry does not duplicate it. |
| PH-3 | `2027-08-04T14:30:00-05:00`, worker, forced offline | Save the manifest revoked note. It remains local and visibly pending; local database remains unchanged. |
| PH-4 | `2027-08-04T14:35:00-05:00`, separate owner session online-local | Owner revokes the worker through the existing local proof setup. Record the access-epoch change; do not mutate the worker's browser storage directly. |
| PH-5 | `2027-08-04T14:45:00-05:00`, revoked worker reconnect | Upload fails closed. The saved work remains visible in the existing recovery surface and can be exported. No Pine or other-farm field-log row is created, and the queue is never reassigned to another user, farm, or account. |
| PH-6 | `2027-08-04T15:00:00-05:00`, revoked worker switches/reloads | Old-farm content is not shown as current. Recovery remains honest; signing into a different account/farm cannot replay the revoked operation. |

The proof packet must record the exact serialized queue identity fields without recording tokens or secrets. Offline success means durable local custody and truthful wording, not a claim that the server has saved the row.

## Required evidence record per scenario

| Field | Required content |
|---|---|
| Identity | branch, exact commit SHA, clean/dirty state, fixture-manifest SHA-256, migration head |
| Clock | scenario step, full ISO instant with offset, `America/Chicago` display date/time |
| Actor | synthetic user UUID, role/capabilities, selected farm UUID, access epoch/fence where relevant |
| Network | online-local, provider-double, forced offline, reconnect, or revoked reconnect |
| UI | route, viewport/browser project, action, visible confirmation/error, screenshot/trace path |
| Local DB | focused before/after query or transaction assertion for each expected write |
| Non-write | focused row count/hash/version proof for each named table or object that must not change |
| Queue/recovery | exact operation UUID and safe structural fields; never tokens, passwords, keys, or customer data |
| Result | pass/fail, finding ID if failed, owning tranche/repair commit, reviewer exact SHA |

If an expected non-write changes, the scenario has found a product defect in existing behavior. That defect may justify a bounded repair. The absence of a feature or integration named as out of scope does not.
