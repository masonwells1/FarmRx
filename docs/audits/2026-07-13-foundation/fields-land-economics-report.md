# Fields & Land Economics Audit — 2026-07-13

## Result

**P0: 5 · P1: 1 · P2: 1 · P3: 0**

This was a code-and-docs-only audit. No network or database calls were made, and no project files were modified. Existing offline regressions passed:

- `MockProfitabilityRepository.regression.ts`
- `SupabaseFieldsRepository.regression.ts`

## P0 — Money-wrong

### 1. Structured flex rent is calculated per crop allocation instead of once per field/year

**Evidence:** `src/data/profitabilityCalculations.ts:114-118` correctly treats a structured flex formula as one field-level calculation after combining field revenue. But the allocation screen and Banker report instead call the single-scenario calculator for each crop allocation: `src/ProfitabilityModule.tsx:206-215`, `src/ProfitabilityModule.tsx:242`, and `src/ProfitabilityReport.tsx:14-25`.

**Farmer failure scenario:** A 100-acre double-crop field has a Type D flex lease: $200/ac base plus 40% of revenue above $720/ac. Wheat produces $480/ac and double-crop beans produce $480/ac.

- Correct field calculation: combined revenue = $960/ac; rent = $200 + 40% × ($960 − $720) = **$296/ac**, or **$29,600**.
- Current allocation/report calculation: each crop is calculated separately at $480/ac, producing the $200 base twice. With both 100-acre crop assignments allocated, it reports **$40,000** of rent.

That is a $10,400 overstatement. The same defect can misapply structured floor/cap logic.

**Suggested fix:** Group allocations by field and lease year. Calculate structured flex rent once with `equivalentCashRentForField`, then distribute that known whole-field rent across the report rows using a documented allocation rule. Do not call `equivalentCashRentForScenario` for a structured field lease with multiple crop assignments.

### 2. The stored “labor and custom” share is applied only to labor; custom work is taken from the unrelated “other inputs” share

**Evidence:** The original schema names `landlord_labor_custom_pct` separately from `landlord_other_input_pct`: `supabase/migrations/0001_module1_fields.sql:184-188`. The current calculation maps `landlord_labor_custom_pct` to `labor` only and maps `custom` to `landlord_other_input_pct`: `src/data/profitabilityCalculations.ts:25-30`. The landlord report repeats the same split: `src/ProfitabilityReport.tsx:111-115`. The Fields editor has relabeled those columns as “Labor” and “Custom work,” respectively: `src/FieldsModule.tsx:19-23`.

**Farmer failure scenario:** An existing 100-acre crop-share lease says the landlord pays 50% of “labor and custom,” stored in `landlord_labor_custom_pct = 50`; `landlord_other_input_pct = 0`. The budget contains $40/ac labor and $60/ac custom work.

- Contract/schema meaning: landlord contribution = 50% × ($40 + $60) × 100 = **$5,000**.
- Current calculation: 50% × $40 × 100 = **$2,000**.

The report understates the landlord’s expense share by **$3,000**.

**Suggested fix:** Choose and enforce one meaning:

- If the database column means “labor and custom,” apply it to both `labor` and `custom`, and reserve `landlord_other_input_pct` for a real `other` cost category.
- If the product now intentionally supports separate labor and custom shares, add a dedicated `landlord_custom_pct` migration and explicitly migrate existing `landlord_labor_custom_pct` values before changing their meaning.

Do not silently reinterpret saved agreements.

### 3. A mid-year agreement change is applied to the entire crop year

**Evidence:** The save RPC supports closing an old agreement and inserting a later agreement: `supabase/migrations/0014_flex_lease_methods.sql:395-424`. But report selection chooses the newest agreement that overlaps any day of the crop year: `src/data/profitabilityCalculations.ts:121-123`. That selection is used by both the Banker report and Landlord report: `src/ProfitabilityReport.tsx:22-25`, `src/ProfitabilityReport.tsx:170-175`.

**Farmer failure scenario:** A field is cash rented at $250/ac from January 1 through June 30. An August 1 amendment changes it to 50/50 crop share for a later crop or a future period. The report selects the August agreement as the “latest” agreement for the year and applies crop share to the whole year’s crop value and expenses, replacing the $250/ac cash rent.

**Suggested fix:** Make the settlement period explicit. At minimum:

- require one agreement for the crop/lease year before a settlement can be generated, or
- select the agreement effective on the planting date or defined lease-year start date, and
- block or clearly split reports when multiple agreements apply to one settlement period.

### 4. The crop-share “settlement” excludes common contract proceeds and costs without warning

**Practice-dependent judgment:** The lease controls. However, the repository’s own land-economics research describes common Illinois crop-share practice as splitting revenue, government payments, insurance, and direct costs: `docs/profitability-research-2026-07.md:102-106`.

**Evidence:** The report calculates only harvested/projected crop bushels × price: `src/ProfitabilityReport.tsx:127-138`, then shows only budget-line expense shares: `src/ProfitabilityReport.tsx:188-208`. The available input-share buckets cover crop-insurance premium but not crop-insurance indemnities, government payments, storage/drying, hauling, taxes, or other lease-specific proceeds/costs: `src/data/fields.ts:128-137`, `src/data/profitability.ts:4-5`.

**Farmer failure scenario:** A 50/50 lease requires the landlord to receive 50% of a $20,000 crop-insurance indemnity and $8,000 government payment. The printed “Landlord settlement report” omits **$14,000** entirely, with no “excluded items” warning.

**Suggested fix:** Before calling this a settlement, add a contract-specific proceeds and adjustments section with explicit treatment for government payments, indemnities, storage/drying/hauling, taxes, and other negotiated items. Until then, label the report as a **crop-and-budget-cost estimate, excluding lease-specific adjustments**.

### 5. Landlord-report budget choice can silently use the wrong plan or entity’s costs

**Evidence:** For each planting, the report uses the selected report budget only if it has the same crop and year. Otherwise it silently picks the most recently updated budget for that crop/year across the farm: `src/ProfitabilityReport.tsx:170-182`. There is no field/entity/plan binding in that fallback.

**Farmer failure scenario:** The farm has a high-input corn plan for irrigated ground and a lower-input corn plan for dryland. A landlord report selected from one plan applies that plan’s costs to every corn field, including fields operated under another entity or plan. Saving an unrelated budget can also change which plan becomes “latest,” changing a landlord expense report without changing the field agreement.

**Suggested fix:** Require an explicit budget/plan selection for every field-crop shown in the report, preferably stored with the allocation. If multiple matching plans exist and no explicit selection exists, block the settlement amount and show “Choose the budget for this field.”

## P1 — Broken settlement output

### 6. The crop-share report does not calculate or print the net settlement amount due

**Evidence:** Shared land economics already defines equivalent crop-share rent as landlord crop value minus landlord-paid inputs: `src/data/profitabilityCalculations.ts:82-85`. The Landlord report instead prints crop value and expense rows separately, followed by an expense subtotal, with no net payable/receivable amount: `src/ProfitabilityReport.tsx:188-208`.

**Farmer failure scenario:** For a 100-acre field, landlord crop share is $50,000 and landlord input contribution is $19,000. The farmer receives two numbers but no stated settlement of **$31,000**, and could pay the crop share without offsetting the landlord’s agreed input contribution.

**Suggested fix:** Print:

- landlord crop proceeds;
- each shared expense;
- total landlord-paid expenses;
- **net cash settlement**; and
- when crop is delivered in kind, landlord bushels plus the dollar valuation separately.

## P2 — Correctness and auditability risk

### 7. Flex settlement does not preserve or disclose the contract’s actual price methodology

**Practice-dependent judgment:** U of I flex structures depend on actual farm yield and an agreed average price, not simply any available price. The local research states that requirement: `docs/flex-lease-research.md:35-36`, `docs/flex-lease-research.md:78-80`, `docs/flex-lease-research.md:102-107`.

**Evidence:** A formula can store only an optional free-text price note: `src/data/fields.ts:104-109`, `src/FieldsModule.tsx:122`. Settlement silently chooses actual price, then expected assignment price, then budget price: `src/ProfitabilityReport.tsx:127-138`. The landlord report does not print the selected price, whether it was actual or projected, or the source/method used: `src/ProfitabilityReport.tsx:202-208`, `src/ProfitabilityReport.tsx:222-227`.

**Farmer failure scenario:** A lease specifies a harvest-period average cash price, but no actual price is entered. The report falls back to a budget projection and prints a rent amount that looks settled, without disclosing that it is not based on the agreement’s pricing method.

**Suggested fix:** Store settlement price method, observation period, delivery point/basis treatment, and final approved price separately from a planning-price note. Print the chosen source and mark projected results as estimates, not settlements.

## What Checked Out Well

- The nine landlord input-share values have a complete type contract and storage path: `src/data/fields.ts:116-174`; the Fields draft carries them forward: `src/FieldsModule.tsx:128-134`; and migration `0014` reads, compares, updates, and inserts every column: `supabase/migrations/0014_flex_lease_methods.sql:198-217`, `supabase/migrations/0014_flex_lease_methods.sql:351-422`.

- The ordinary expense buckets are consistently mapped in the shared calculator and report: seed, fertilizer, chemical, fuel, crop insurance, equipment/repairs, and interest match between `src/data/profitabilityCalculations.ts:20-30` and `src/ProfitabilityReport.tsx:106-116`.

- Cash rent and owned ground have the intended behavior: owned is $0, cash rent returns the stored $/acre rate, and a resolved field agreement replaces rather than doubles the budget land line: `src/data/profitabilityCalculations.ts:82-96`, `src/data/profitabilityCalculations.ts:147`.

- Crop-share per-acre and whole-field conversion is correct where the shared helper is used: crop revenue is yield × price × landlord percentage; landlord inputs are deducted per acre; then planted-acre weights are converted over total field acres: `src/data/profitabilityCalculations.ts:82-96`.

- The landlord report handles null versus zero correctly for harvest math. `null` means unknown and falls back to projections; harvested `0` remains a real zero rather than being treated as blank: `src/ProfitabilityReport.tsx:127-138`.

- The Fields editor prevents blank cash-rent and crop-share percentages from quietly becoming zero, and requires every crop-share input percentage to be explicitly entered: `src/FieldsModule.tsx:189-226`.

- Structured flex formulas fail closed for unsupported methods or incomplete required inputs: `src/data/flexLeaseValidation.ts:9-26`. Migration `0014` enforces the same two supported V1 methods and validates floor/cap relationships at the database boundary: `supabase/migrations/0014_flex_lease_methods.sql:230-327`.

- The two implemented structured methods calculate correctly:
  - Type A percent-of-revenue uses percentage × revenue with optional min/max: `src/data/profitabilityCalculations.ts:60-63`.
  - Type D base-plus-bonus uses base + percentage of revenue above the trigger, with an optional cap: `src/data/profitabilityCalculations.ts:55-58`.
  - The legacy price/yield/revenue formulas remain readable and compute under their historic rules: `src/data/profitabilityCalculations.ts:68-80`.

- U of I Types B and C are intentionally not exposed as usable methods. They are reserved in the type but rejected by the validation/migration path until implemented, which is safer than inventing a result: `src/data/fields.ts:78-85`, `supabase/migrations/0014_flex_lease_methods.sql:257-263`.

- No P3-only issues were found.