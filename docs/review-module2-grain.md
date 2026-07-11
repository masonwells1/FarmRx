# Module 2 Grain UI — adversarial review

1. **P1 (must fix) — `src/data/MockGrainRepository.ts:40,67-70`**  
   Grain saves spread the entire `GrainWorkspace`, including `fields`, into the grain payload. On later loads, `{ fields, ...envelope.grain }` lets that stale nested copy override current Fields data. The next grain save can then roll back migrated v1 fields or newer field edits.  
   **Concrete fix:** Strip `fields` before persisting grain (`const { fields, ...grain } = workspace`), always spread grain before authoritative fields when loading, validate the envelope, and add a regression test: migrate v1 → save grain → edit field → save grain again → confirm the field edit survives.

2. **P1 (must fix) — `src/GrainModule.tsx:21-25,89-91`**  
   Every contract’s bushels count as fully priced, even when `priceForContract()` returns `null`. The seeded white-corn basis contract therefore counts as priced while contributing `$0` to revenue; HTAs are treated as final cash prices even though basis remains open. This corrupts percent priced, average sold price, open bushels, and blended revenue.  
   **Concrete fix:** Count “priced” bushels only when a final cash-equivalent price exists. Track basis-fixed and futures-fixed bushels separately, and value partially priced contracts using the live missing leg without including that estimate in average sold price.

3. **P1 (must fix) — `src/GrainModule.tsx:32-35,90-91,110`**  
   Manual basis entries never affect expected revenue. `Basis` saves rows with `cash_price: null`, but `priceWithBasis()` filters those rows out. Unpriced white/non-GMO production also receives no expected IP premium, materially understating its blended value.  
   **Concrete fix:** Use the latest basis row regardless of `cash_price`, calculate expected cash as live futures + basis + applicable expected premium, and keep contract premiums in cents converted exactly once.

4. **P1 (must fix) — `src/GrainModule.tsx:90`**  
   Safe-to-Forward uses `.find()`, so only one insurance unit contributes. The migration permits multiple units per commodity, and the required formula must be summed across all matching units.  
   **Concrete fix:** Filter by the complete position scope and sum `insured_acres × APH × coverage_level_pct / 100` for every matching insurance unit.

5. **P1 (must fix) — `src/data/MockGrainRepository.ts:15,24; src/GrainModule.tsx:69,87-91`**  
   Expected production is merely hardcoded seed data. Field acreage changes do not recalculate it, APH is not editable, and there is no manual actual-bushel entry. Crops with `actual_bushels: null` have a permanently disabled Actual switch. This does not implement 2.1 or the manual-entry path in 2.2.  
   **Concrete fix:** Aggregate planted acres from Fields by crop/entity/enterprise, provide editable APH and actual bushels, recalculate `expected_bushels = planted_acres × APH`, and continue storing expected and actual independently.

6. **P1 (must fix) — `src/GrainModule.tsx:60-61,75,88-90,97`**  
   Position, contracts, targets, and insurance are joined only by `commodity_id`. The schema scopes all of them by crop year plus optional entity and enterprise. Adding another year or two enterprises for the same commodity will double-count contracts and display/edit the wrong plan cells.  
   **Concrete fix:** Introduce one scope-key helper covering farm, crop year, commodity, entity, and enterprise, and use it consistently for every lookup, calculation, and save.

7. **P1 (must fix) — `src/GrainModule.tsx:13-18,57-64`**  
   Templates neither form a coherent complete plan nor replace the current plan. Their schedules total only 55–70%, while months omitted by a template remain saved. Applying templates sequentially can produce totals above 100%—for example, Balanced followed by Harvest produces 110% with the seed plan.  
   **Concrete fix:** Define each strategy’s intentional total, show any deliberate unplanned remainder, and atomically replace/reset all cells in the selected scope. Reject aggregate totals above 100%.

8. **P1 (must fix) — `src/GrainModule.tsx:96-98`**  
   A crop with no marketing plan is labeled “On Track” because `0 >= 0`; existing contracts can also produce “On Track” against a nonexistent plan. This is visibly wrong for white and non-GMO seed positions.  
   **Concrete fix:** Add a distinct “Not Started” state when no plan exists, then compare scope-correct cumulative actual sales with cumulative planned percentages for Behind/On Track.

9. **P1 (must fix) — `src/GrainModule.tsx:66-83; src/data/grain.ts:135-143`**  
   Required Module 2 surfaces are absent: alerts, ROI-relative targets, Actual-vs-Plan table, cumulative progress chart, USDA report calendar, and the required basis-history chart—the UI explicitly says the chart “comes later.” Minimum revenue guarantee per acre is also missing from the position view. `GrainData` does not mirror the migration’s `usda_report_dates` table at all.  
   **Concrete fix:** Implement the required 2.6, 2.9, and 2.10 views and adopted plan views; display both insurance guarantee measures; add `UsdaReportDate` and `usda_report_dates` to the TypeScript data contract and repository.

10. **P2 (should fix) — `src/GrainModule.tsx:101-105; src/data/MockGrainRepository.ts:65-70`**  
    Contract validity is enforced inconsistently by HTML attributes, with no repository-level validation or visible error. Reversed delivery dates, non-finite/negative premiums, invalid commodity IDs, and malformed stored rows can pass the mock repository even though migration `0004` rejects them.  
    **Concrete fix:** Add a shared validator mirroring every `grain_contracts` constraint, validate before persistence, enforce delivery ordering, and show an inline error without clearing the form.

11. **P2 (should fix) — `src/styles/app.css:173-253`**  
    The Grain UI repeatedly violates the non-negotiable 18px/48px design rules. Labels, metrics, buttons, badges, and table details use 12–17px text; `.math-toggle` is only 40px high and its spans do not restore a 48px target; the expandable summary is 32px high.  
    **Concrete fix:** Raise user-facing Grain text to at least 18px and make every interactive toggle, summary, input, select, and button at least 48×48px at desktop and mobile sizes.

12. **P2 (should fix) — `src/GrainModule.tsx:2,44,55,62,69,103,110`**  
    The UI imports and calls `MockGrainRepository` directly, leaking mock storage concerns into the component and making the planned Supabase swap unnecessarily invasive.  
    **Concrete fix:** Export repository/service interfaces through a neutral data module and inject them through context or page props; keep the mock implementation selected only at the application composition boundary.

13. **P2 (should fix) — `src/GrainModule.tsx:8,27-29; src/data/MockGrainRepository.ts:56-60`**  
    Breakevens, futures contract selection, quote labels, and quote timestamps are hardcoded to 2026. `currentYear` is dynamic, so the page silently becomes stale at year rollover, and breakevens never respond to Fields/Profitability inputs.  
    **Concrete fix:** Source breakevens from the profitability repository, choose new-crop contracts from quote metadata and crop year, and generate delayed timestamps from the market service response.

VERDICT: NEEDS FIXES (9 P1)