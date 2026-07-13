# Fields and Land Economics Foundation Audit

**Date:** 2026-07-13  
**Scope:** Static code and documentation audit only. No network, database, or environment-file access was used.  
**Reviewed:** `FieldsModule.tsx`; Fields types, Mock/Supabase/queued repositories and gateway; profitability types/calculations/repositories; `ProfitabilityReport.tsx`; migrations `0001`, `0006`, `0009`, `0013`, `0014`, and `0022`; and the land/profitability design and research documents.

## Result

| Severity | Count |
|---|---:|
| P0 — money wrong / data loss / security | 2 |
| P1 — broken feature | 3 |
| P2 — correctness risk | 3 |
| P3 — polish | 0 |

The core single-crop cash-rent and crop-share formulas are coherent. The blockers are concentrated in: (1) applying structured flex rent separately to each crop allocation in the banker report, (2) choosing an in-year agreement without a settlement-period rule, and (3) presenting an incomplete or projected calculation as a landlord settlement.

## End-to-end trace

### Agreement data path

1. The agreement editor collects the arrangement type, rent/share, all nine landlord input-share percentages, and a structured flex formula. Blank numeric inputs are normalized to `null`; non-crop-share arrangements explicitly write zero to all input-share columns. `src/FieldsModule.tsx:66-99`, `src/FieldsModule.tsx:189-226`.
2. `FieldDraft` carries those exact agreement keys. `src/data/fields.ts:162-175`.
3. The live and queued paths both call `normalizeFieldDraft`; the queue stores that normalized draft and replays the same operation. `src/data/SupabaseFieldsRepository.ts:83-106`, `src/data/QueuedFieldsRepository.ts:54-62`.
4. `save_field_bundle` maps every editor value to the identically named `arrangements` column, compares all of them for history decisions, and inserts/updates the same columns. `supabase/migrations/0014_flex_lease_methods.sql:175-218`, `supabase/migrations/0014_flex_lease_methods.sql:351-390`, `supabase/migrations/0014_flex_lease_methods.sql:403-446`.
5. The Supabase gateway reads the full rows and the strict mapper reads every percentage by its matching column name. `src/data/SupabaseFieldsDataGateway.ts:15-32`, `src/data/SupabaseFieldsRepository.ts:56-59`.

### Expense-bucket trace

| Editor/storage field | Intended cost category/categories | Calculator/report implementation | Result |
|---|---|---|---|
| `landlord_seed_pct` | `seed` | `seed` | Correct |
| `landlord_fertilizer_pct` | `fertilizer` | `fertilizer` | Correct |
| `landlord_chemical_pct` | `chemical` | `chemical` | Correct |
| `landlord_fuel_pct` | `fuel` | `fuel` | Correct |
| `landlord_labor_custom_pct` | `labor` | `labor` | Correct in code, but its stored name and report label imply custom work too; see P2-3 |
| `landlord_crop_insurance_pct` | `crop_insurance` | `crop_insurance` | Correct |
| `landlord_equipment_pct` | `equipment_depreciation`, `repairs` | both | Correct |
| `landlord_interest_pct` | `interest` | `interest` | Correct |
| `landlord_other_input_pct` | `custom` | `custom` | Correct in code, but the label is inconsistent; see P2-3 |

The shared calculation and the landlord report use the same category mapping: `src/data/profitabilityCalculations.ts:20-31` and `src/ProfitabilityReport.tsx:106-116`. The older SQL comparison view uses the same mapping too: `supabase/migrations/0006_module4_profitability.sql:453-461`.

## Findings

### P0-1 — Banker report double-counts structured flex rent on double-cropped ground

**Evidence:** The banker report calculates each allocation independently with `equivalentCashRentForScenario`, then multiplies by that allocation's acres. `src/ProfitabilityReport.tsx:14-26`. A structured flex formula is therefore run once per crop allocation. The shared field-level function has a deliberate different rule: blend all field revenue first and apply the formula once so the fixed base and floor/cap are not counted twice. `src/data/profitabilityCalculations.ts:114-118`. The existing regression expressly documents this requirement and proves the correct field result. `src/data/MockProfitabilityRepository.regression.ts:113-122`.

**Farmer failure scenario:** A 100-acre wheat/double-crop soybean field has a Type D lease: $200/ac base plus 40% of revenue above $720/ac. Wheat revenue is $480/ac and soy revenue is $480/ac. The contract settlement is based on combined revenue of $960/ac:

`$200 + 40% × ($960 − $720) = $296/ac`, or **$29,600**.

The banker report instead calculates wheat at `$200/ac` and soy at `$200/ac`, and charges each across 100 acres: **$40,000**. It overstates land cost and understates the farm's projected net by **$10,400**. A percent-of-revenue lease with a floor or ceiling has the same defect because the floor/ceiling is applied per planting rather than once to whole-field revenue.

**Suggested fix:** Group report allocations by field before calculating rent. For structured flex leases, construct the complete field crop set with the allocation overrides, call `equivalentCashRentForField` once, and allocate the resulting field rent back to report rows only under an explicit, tested allocation policy. Add regression cases for Type A minimum/maximum and Type D base/cap on a 100-acre double crop.

### P0-2 — A later agreement in the crop year is applied to the entire crop year's revenue and acres

**Evidence:** `latestArrangementForCropYear` returns the agreement with the latest `effective_from` that overlaps any part of the year. `src/data/profitabilityCalculations.ts:121-124`. Both the banker report and landlord report use it as the one agreement for all crop-year calculations. `src/ProfitabilityReport.tsx:22-25`, `src/ProfitabilityReport.tsx:170-185`, `src/ProfitabilityReport.tsx:212-227`. The save RPC intentionally preserves agreement history and closes the prior row one day before a changed future-effective row. `supabase/migrations/0014_flex_lease_methods.sql:395-424`.

**Farmer failure scenario:** A 160-acre field has a 2026 cash lease at $250/ac beginning January 1. On July 1, the parties sign a valid amendment at $350/ac. The code selects the July row for crop year 2026 and reports **$56,000** (160 × $350), even though the lease needs an agreed proration or a settlement rule for the acres/revenue before July. If the July change was only for next crop operations or a partial-year amendment, the displayed whole-field amount is wrong.

**Suggested fix:** Do not infer an annual settlement from arbitrary overlapping date ranges. Either (a) constrain one agreement to each crop year, or (b) store an explicit settlement basis/period and allocation rule, then split acres/revenue by that rule. Until then, return “agreement changed during crop year — settlement requires review,” rather than choosing the latest row.

### P1-1 — The two structured flex methods offered by the UI cannot be saved through the applied RPC

**Evidence:** The Fields UI offers `base_plus_bonus` and `pct_of_revenue` and writes `{ method: ... }`. `src/FieldsModule.tsx:36-39`, `src/FieldsModule.tsx:87-98`, `src/FieldsModule.tsx:199-223`. The client calculator implements them. `src/data/profitabilityCalculations.ts:47-64`. But migration `0014` is explicitly marked **DRAFT ONLY** and says it has not been applied. `supabase/migrations/0014_flex_lease_methods.sql:1-12`. The applied `0009` RPC accepts only legacy `{type, trigger, bonus_rate}` and rejects the structured shape. `supabase/migrations/0009_fields_live_support.sql:351-362`.

**Farmer failure scenario:** A farmer selects “Percent of gross revenue,” enters 30%, a $200 floor, and a $400 cap. The UI previews the rent, then the live save fails with “flex rent formula is invalid.” The farmer cannot record the signed agreement.

**Suggested fix:** Treat `0014` as a release blocker: review/apply it through the normal migration process, then execute a live-safe RPC test for both supported methods and one malformed payload. Do not claim structured flex is live until that proof exists.

### P1-2 — The landlord “settlement” does not state the net amount due

**Evidence:** For crop share, the report lists the landlord crop-value share and each expense-share amount, then prints only an expense subtotal and the crop-share percentage. `src/ProfitabilityReport.tsx:188-208`. It never calculates or labels `landlord crop proceeds − landlord-paid expenses` as a net payment/credit. The shared economics function already provides the per-acre equivalent as gross crop share minus landlord-paid inputs. `src/data/profitabilityCalculations.ts:82-89`.

**Farmer failure scenario:** On 100 acres, crop value is $100,000, landlord crop share is 33.33%, and landlord expense share is $8,000. The report shows $33,330 crop share and $8,000 expenses, but not the **$25,330 net amount due**. A farmer can send the gross crop share instead of the net, or a landlord can reasonably read the sheet as not yet settled.

**Suggested fix:** Add a conspicuous, signed-direction total: “Crop proceeds due to landlord,” “less landlord-paid expenses,” and “net payment due to landlord” (or “credit due from landlord”). Include whole-field and per-acre totals, with rounding performed only at the final displayed/cash-settlement level.

### P1-3 — Crop-share “settlement” excludes common shared revenue streams and cannot disclose that omission

**Evidence:** The data model has crop production, yield, price, and cost-line data, but no columns for government program payments, crop-insurance indemnities, patronage, quality premiums/discounts, or marketing adjustments. `src/data/fields.ts:43-63`, `src/data/profitability.ts:21-29`. The report's only revenue calculation is crop bushels × price. `src/ProfitabilityReport.tsx:127-138`, `src/ProfitabilityReport.tsx:208`. The project's own research describes crop share as commonly splitting revenue, government payments, insurance, and direct costs. `docs/profitability-research-2026-07.md:102-105`.

**Farmer failure scenario:** A one-third landlord receives a $30,000 crop-insurance indemnity or program payment that the signed lease says is shared. The report produces a final-looking settlement that omits the landlord's $10,000 share.

**Judgment:** Practice-dependent. US crop-share contracts vary by state and lease language, but a tool called a settlement report must either support these items or state clearly that it settles crop proceeds and selected budgeted inputs only.

**Suggested fix:** Add explicit, auditable settlement adjustments with a category, amount, allocation basis, and lease-rule note; or rename the output “crop proceeds and budgeted-input summary” and block final settlement status until the user confirms no additional shared items apply.

### P2-1 — A zero planned/actual price is treated as a valid settlement price and can reduce crop value to zero

**Evidence:** The editor accepts an expected price of zero (`< 0` is rejected, not `<= 0`). `src/FieldsModule.tsx:247-248`. Repository normalization also accepts zero. `src/data/SupabaseFieldsRepository.ts:97-102`. The landlord report chooses actual price, expected price, or budget price without treating zero as missing, then calculates crop value directly. `src/ProfitabilityReport.tsx:127-138`. Flex and crop-share calculations likewise accept zero revenue. `src/data/profitabilityCalculations.ts:47-64`, `src/data/profitabilityCalculations.ts:82-89`.

**Farmer failure scenario:** A user enters `0` as a placeholder before pricing grain. The report treats it as a real $0/bu price, shows $0 crop proceeds and, for a percent-of-revenue flex lease, only the minimum/floor rent. This can be mistaken for a valid settlement rather than incomplete information.

**Suggested fix:** For planning and settlement inputs, require price `> 0` when a value is present, or model zero explicitly as a valid special case with a warning. Make a final settlement unavailable until actual yield and the agreed lease price basis are recorded.

### P2-2 — The report can use projections but is titled and formatted as a settlement

**Evidence:** If harvest is absent, the report falls back to expected yield; if actual price is absent, it falls back to expected price or budget price. `src/ProfitabilityReport.tsx:127-138`. It displays “Projected yield” when appropriate, but it does not identify a projected price, does not flag the crop-value amount as provisional, and retains the title “Landlord settlement report.” `src/ProfitabilityReport.tsx:204-208`, `src/ProfitabilityReport.tsx:231-237`. The flex research says the published structures settle on actual farm yield and an agreed average cash-price window. `docs/flex-lease-research.md:102-125`.

**Farmer failure scenario:** Before harvest, a landlord receives a PDF titled “settlement report” using a 190 bu/ac budget yield and a $4.20 planned price. Actual yield/lease price later differ, yet the document looks final enough to create a payment dispute.

**Judgment:** Practice-dependent for interim estimates; it is a correctness risk because the presentation does not distinguish estimate from final settlement.

**Suggested fix:** Add an unmistakable status: “Projected — not a final settlement” whenever either input is not actual/agreed. For flex leases, record and display the contract's agreed price window/source and the actual farm-yield source before enabling final status.

### P2-3 — Labor/custom terminology can lead users to share the wrong expense bucket

**Evidence:** Storage uses `landlord_labor_custom_pct`, but the editor labels it simply “Labor.” `src/FieldsModule.tsx:12-24`. The report labels that same percent “Labor & custom” while applying it to `labor` only; `custom` instead uses `landlord_other_input_pct` and is presented as “Other inputs.” `src/ProfitabilityReport.tsx:106-116`. The shared calculator follows that latter mapping. `src/data/profitabilityCalculations.ts:20-31`.

**Farmer failure scenario:** A lease says the landlord pays one-third of labor and custom hauling. The farmer enters 33.33% in “Labor,” because the stored field and report label imply that is labor/custom. Custom work remains at 0% unless the farmer also realizes to enter the separate, ambiguously named “Custom work/Other inputs” field.

**Suggested fix:** Rename the stored/UI/report concepts coherently. The least disruptive option is `landlord_labor_pct` for labor and `landlord_custom_pct` for custom, with a migration/backfill and clear lease review. If the existing column must cover both, map it to both categories and remove the duplicate custom setting.

## What is good

- All nine input-share editor values are present in the draft type, normalized path, queue payload, RPC candidate, RPC equality/history logic, database insert/update, and strict live mapper. No missing editor-to-column mapping was found. `src/FieldsModule.tsx:12-24`, `src/data/fields.ts:116-140`, `src/data/SupabaseFieldsRepository.ts:83-106`, `supabase/migrations/0014_flex_lease_methods.sql:200-217`, `supabase/migrations/0014_flex_lease_methods.sql:351-446`.
- Cash rent is consistently a dollars-per-acre value and whole-field amounts are computed as rent per acre × field acres in the landlord report. `src/data/profitabilityCalculations.ts:82-89`, `src/ProfitabilityReport.tsx:222-227`.
- The crop-share equivalent-rent formula is economically coherent for the operator budget: landlord crop share less landlord-paid inputs is added to the farmer's non-land costs, avoiding a double count of the budget land line. `src/data/profitabilityCalculations.ts:82-89`, `src/data/profitabilityCalculations.ts:147-147`, `src/ProfitabilityReport.tsx:14-25`.
- All intended cost buckets are consistently applied in both the shared calculator and displayed expense rows; equipment correctly includes both depreciation and repairs. `src/data/profitabilityCalculations.ts:20-31`, `src/ProfitabilityReport.tsx:106-116`.
- Blank yield/price becomes `null`, and field-level rent fails closed to `null` when a required planned input is absent; it does not silently invent a rent. `src/FieldsModule.tsx:86-98`, `src/FieldsModule.tsx:245-248`, `src/data/profitabilityCalculations.ts:92-118`.
- Structured Type A (% of gross revenue with floor/cap) and Type D (base plus revenue-trigger bonus/cap) are mathematically correct for a single complete field scenario. The implementation clamps the right components, and the regression includes published numerical examples. `src/data/profitabilityCalculations.ts:54-64`, `src/data/MockProfitabilityRepository.regression.ts:84-122`, `docs/flex-lease-research.md:30-45`, `docs/flex-lease-research.md:73-84`.
- Legacy flex formulas remain readable and have an explicit compatibility calculation rather than silently being rewritten. `src/data/profitabilityCalculations.ts:67-80`, `src/FieldsModule.tsx:60-64`, `src/FieldsModule.tsx:199-207`.
- Reserved flex methods `base_flex_price` and `base_flex_price_yield` fail closed; the UI does not present them as working. `src/data/fields.ts:78-85`, `src/data/profitabilityCalculations.ts:41-64`, `supabase/migrations/0014_flex_lease_methods.sql:257-263`.
- Agreement history is preserved when a changed agreement has a later effective date; the prior row is closed and a new one inserted atomically. `supabase/migrations/0014_flex_lease_methods.sql:395-424`.
- The live field-save RPC is farm-scoped, authenticated, serialized for replay, and preserves a canonical receipt. No security issue in the audited land-save boundary was found. `supabase/migrations/0014_flex_lease_methods.sql:55-90`, `supabase/migrations/0014_flex_lease_methods.sql:97-123`, `supabase/migrations/0014_flex_lease_methods.sql:626-646`.

## Recommended repair order

1. Fix P0-1 and P0-2 before using banker/landlord outputs for payment or financing decisions; add numerical tests that reproduce the examples above.
2. Apply and verify `0014` before exposing structured flex as a live capability.
3. Add a true net settlement total and a projected/final status gate.
4. Decide the lease-policy scope for government payments, insurance proceeds, and price-window/marketing adjustments; make that scope explicit in the model and report.
5. Clarify labor/custom buckets and reject accidental zero prices.

## Verification note

This was a static trace, not a live-service verification. I did not execute a database RPC, inspect any environment file, or make network calls. The migration status conclusion comes from the repository's explicit `DRAFT ONLY` migration header and the incompatible applied `0009` function, not from querying a live database.
