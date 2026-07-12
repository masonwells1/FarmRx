# TASK — BUILD Chunk 5: Programs weather spray-light + applied-record link + cost (Terra)

CRITICAL EXECUTION RULE: headless, no human. NEVER present a plan and wait — task failure.
PRE-APPROVED. Implement fully, RUN checks yourself, report with real output. Do NOT git commit.
Do NOT run a dev server. You MAY run `npx tsc -b --force`, `npm run build`, `npm run regression`.

## Spec + contracts
- `docs/programs-design.md` §1 (applied reality), §5 (weather / applied→application_records / profitability),
  §9 Chunk 5. Migration 0024 RPC `mark_program_pass_applied` supports: no-record (default),
  LINK existing (`p_application_record_id` = an existing non-voided record for the SAME farm+crop,
  `p_create_application_record=false`), and CREATE a product-less DRAFT record
  (`p_create_application_record=true` + a client-supplied stable `p_application_record_id`; the record
  is inserted status='draft', NOT posted → on-hand unchanged). Read views:
  `program_assignment_costs` (per-assignment planned/actual cost + completeness), `program_crop_cost_rollups`.
- Existing weather: `src/data/weatherService.ts` + the pure `evaluateSprayWindow` used by `WeatherModule.tsx`,
  and field lat/long via the Feature A location. REUSE them — do not re-implement weather or store it.

## Build
1. **Spray-light on a planned SPRAY pass** (activity_type='spray') in the Season tracker: join
   assignment → crop_assignment → field lat/long, call the existing weatherService + evaluateSprayWindow,
   and show the current Good/Caution/Poor light + reason + forecast timestamp + honest stale/offline/
   no-location wording BESIDE the pass. It is guidance only; it must NEVER block save/assign/reschedule/
   Apply. Fertility/other passes show NO light. Missing location / fetch fail / stale → honest note, not a
   crash, not a block.
2. **Apply → application record (enable the deferred UI from Chunk 3)**: in the Apply confirmation add
   two optional choices — (a) LINK an existing application record for this crop (a picker of the crop's
   non-voided records; the RPC validates farm+crop and rejects a mismatch — surface the error), and
   (b) CREATE a record (client generates a stable UUID; RPC inserts a DRAFT). BOTH must show the
   disclosure "Products are free-typed — not matched to inventory; on-hand was not changed." Apply with
   NO record must remain the simple default. Render a Program-created/linked record's free-type actual
   products via the `program_application_products` view; PROVE a zero-catalog-product linked record
   renders safely in the Inventory module (open the linked record — it must not crash and must clearly
   read as un-posted). If it can't render safely, fall back to LINK-only + keep CREATE behind an honest
   "opens the inventory form" note — but first try to make the draft render safely.
3. **Planned-vs-actual cost** on the tracker (per assignment) + a per-crop rollup: read
   `program_assignment_costs` / `program_crop_cost_rollups`. Show planned $/ac (sum of planned line
   costs) and actual $/ac (from Applied actual costs) with completeness: when any line lacks a cost,
   show "partial estimate" + the known-lines sum, NEVER coalesce missing cost to $0 or imply complete.
   Use tabular-nums + roundDecimalHalfUp; total = per-acre × planted/applied acres via the view.

## Rules / scope
- Do NOT build CRX order ingestion, delivery→on-hand, or catalog reconciliation (future). Do NOT
  decrement inventory. Do NOT auto-write budget cost lines.
- Brand/mobile: 18px/48px/tabular-nums/plain English/no medical metaphor/375px no overflow/status words.
- Extend regression: spray-light missing/stale/live composition (best-effort, never blocks); apply-with-
  link vs apply-with-create-draft vs apply-with-no-record; link rejects other crop/farm; cost completeness
  (partial never shows $0/complete) + half-up edges. State the new coverage counts.

## Proof (RUN yourself, paste real output)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` all pass (state new counts).
`git status`. Do NOT commit. Report files changed, exact check output, coverage counts, deviations, and
top 3 things for the reviewer. Note: Opus will browser-prove the spray-light matches Weather, Apply with
a created draft leaves on-hand unchanged and renders safely in Inventory, and partial cost never shows $0.
