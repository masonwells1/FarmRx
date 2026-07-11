# Farm Rx Module 3 Schema — Owner Review Draft

These files are a database blueprint only. They have not been applied to a database.

## What each table does

- **Products:** The farm's own chemical, seed, fertilizer, biological, adjuvant, and other-input catalog. It includes EPA registration and restricted-use flags for pesticides, seed variety and crop, fertilizer analysis, label intervals, and one standard inventory unit. A product may carry a future Crop RX product UUID, but there is no connection to the CRX Manager database yet.
- **Receipts and receipt lines:** A purchase, opening shed balance, or future Crop RX delivery becomes a receipt with one or more product lines. Draft receipts do not count as inventory. A received receipt does. A received receipt cannot be quietly rewritten; it can only be cancelled with who/when/why audit fields.
- **Inventory adjustments:** Signed corrections for a physical count, loss, return, or transfer. Adjustments are append-only: fixing one means adding an opposite correction, not rewriting history.
- **Application records and products:** One application record is tied to one real field and one crop-assignment row. That preserves wheat followed by double-crop soybeans and keeps white/non-GMO corn distinct. Each used product is a child row with rate, total amount, lot, regulatory snapshots, and optional cost snapshot.
- **Delivery events:** An idempotent inbox for a later CRX Manager sync. Repeated external event IDs cannot create duplicates. Events never change inventory by themselves; only a reviewed, received Farm Rx receipt does.
- **Effective application view:** Keeps completed records that have not been voided or replaced by a completed correction. A draft correction does not change history or inventory.
- **On-hand view:** Calculates receipts plus signed adjustments minus effective completed applications every time it is read. Farm Rx never stores a separate on-hand total that can go stale.
- **Application cost-line view:** Gives each used product a stable UUID, cost per acre, and profitability category. Module 4 can later set `source_kind = inventory` and use that UUID as `source_record_id`; there is no hard foreign key between the drafts.
- **RUP completeness view:** Flags missing federal restricted-use pesticide record fields per applied product. It separately lists Farm Rx's stronger operational fields—time, target pest, weather, rate, REI, and PHI—so the app does not falsely label every best practice as a federal legal minimum.

## How privacy works

Inventory and spray records are ordinary farm operational data, not private financial-position data. A worker may be the person receiving a pallet, counting the shed, or creating their own application record, so hiding those records from workers would break the real workflow. Module 3 therefore runs after the Module 1 access helpers and does **not** require migration 0008.

An active farm member can read the records. Owners, managers, and workers can make changes; read-only members cannot. A Crop RX representative can read only when the farm's **Share with my Crop RX rep** toggle is ON **and** that exact representative has a current permission slip. Representatives cannot add or change inventory or application data.

Receipt prices are kept with the operational receipt because they are needed to avoid entering chemical, seed, and fertilizer costs twice. If an application later feeds a private Module 4 budget, Module 4's own security still controls the budget and its calculations. If Mason considers invoice prices too sensitive for workers, the price columns should move to a separate financial-private table before this draft is applied.

Every business row carries a non-null farm workspace stamp. Every child link repeats the farm stamp on both sides: a receipt line cannot use another farm's product, an application cannot use another farm's field or crop assignment, and a used product cannot point to another farm's catalog. The farm stamp cannot be changed after creation.

Completed application records cannot be silently edited. A user can void one only with an audited reason or create a new record that explicitly corrects it. Inventory draws only from the effective completed record. Product name, EPA registration number, RUP flag, label intervals, maximum rate, and inventory unit are copied into the application product at the time of use, so later catalog edits do not rewrite history.

All four read-only views use the signed-in person's permissions and cannot bypass row-level security.

## Unit rules in plain English

Every product chooses one inventory unit—the unit shown for on-hand stock. A transaction may be entered in another unit, but Farm Rx converts only when the math is physically unambiguous:

- US liquid: gallon, quart, pint, and fluid ounce.
- Metric liquid: liter and milliliter; metric and US liquid may convert because both measure volume.
- Weight: pound, ounce, US short ton, kilogram, and gram.
- Count/package: each, bag, case, tote, seed unit, and bulk unit do **not** automatically convert to one another or to weight/volume.

For a package conversion, the receipt or application must save the exact factor used—for example, `1 case = 30 gallons`. That factor is snapshotted on the row. Farm Rx never guesses a chemical's weight from its liquid volume because that requires product-specific density, and it never guesses how many bags are in a case.

After a product has any receipt, adjustment, or application history, its inventory unit cannot be changed. A new catalog product must be created instead. This prevents an old quantity of `10 gal` from being silently relabeled as `10 lb` or `10 qt`.

Rates and totals are separate. A rate might be `16 fl oz per acre`, while the total used is `10 gal`. On-hand uses the total after conversion to the product's inventory unit. The rate remains on the compliance record.

For per-acre rates whose units can be converted, the completeness view flags a total that differs from `rate × acres` by more than 1%. It also flags a rate above the snapshotted label maximum when the rate bases and units are comparable. Mix rates such as `per 100 gal` are not guessed because the carrier volume is not part of the product quantity. For REI or PHI, `0` means the label has no interval and `NULL` means the value is still unknown.

## Compliance boundary

The federal private-applicator baseline captured by the completeness view comes from the USDA Agricultural Marketing Service guidance for 7 CFR Part 110: product/brand, EPA registration number, total amount, date, identifiable location, crop or site, treated size, applicator name, and certification number. Records are generally required within 14 days and kept for two years. Illinois commercial applicator rules also call for chemical, EPA number, rate/concentration per treated unit, date, and use site. The schema captures rate and the broader weather/label fields too.

This is a data-quality check, not a guarantee of legal compliance. Pesticide labels and current federal/state rules still control. Before launch, counsel or a licensed Illinois/Indiana compliance specialist should confirm the final screen and export. Sources reviewed for this draft: [USDA AMS federal recordkeeping guidance](https://www.ams.usda.gov/rules-regulations/pesticide-records/understanding) and [Illinois Administrative Code Section 250.150](https://ilga.gov/commission/jcar/admincode/008/008002500001500R.html).

## Decisions I made and why

- I used the farmer's own farm-scoped product catalog instead of CRX Manager's retailer-wide shelf. The future Crop RX UUID is only a matching hook.
- I separated incoming delivery events from received inventory. A sync retry can be idempotent, and an untrusted or partial event cannot inflate on-hand stock.
- I calculate on-hand from ledger facts and application use. There is no editable `on_hand` column.
- I included immutable signed adjustments because a physical shed count will eventually disagree with the ledger. This repairs the ledger without erasing the evidence.
- I made one application belong to one field and one crop assignment. It is simpler on a phone and prevents a mixed multi-field record from hiding which crop/site was treated.
- I normalized application products instead of storing them as JSON. Compliance fields remain searchable and each product use gets a stable Module 4 cost-source UUID.
- I snapshot regulatory and cost facts on the applied-product row. A later product or receipt edit cannot change what the historical record says was used.
- I distinguish the federal RUP minimum from Farm Rx's fuller operational checklist. Weather, target pest, REI, and PHI are important, but calling every one a universal federal RUP requirement would overstate the law.
- I did not add the chemical-needed planner or nutrient-removal coefficient tables here. They need product programs and agronomic coefficient decisions that were not requested for migrations 0010/0011; this schema supplies the actual use and fertilizer-analysis hooks they will read.

## Owner questions still open

- Should receipt prices be visible to ordinary workers, or should only owners/managers and specially approved employees see them? My recommendation for v1 is to keep receiving simple and visible, then separate price privacy only if a real farm asks for it.
- Does Crop RX sell seed by `bag`, by `seed_unit` (for example 140,000 seeds), or both? The schema supports both but the product's chosen on-hand unit controls the screen.
- Should v1 allow one application record to cover several fields in one tank load, or keep the safer one-field-per-record workflow? My recommendation is one field per record, with a future batch ID if users need grouped entry.
- Which Illinois and Indiana applicator-license fields must appear on the final compliance PDF beyond number and state—license type, category, expiration date, or supervising applicator? The table can be extended before application without changing the inventory ledger.
