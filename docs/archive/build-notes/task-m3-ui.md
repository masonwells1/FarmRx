# TASK — Module 3 Inventory & Compliance UI on MOCK data (Terra, workspace-write)

PRE-APPROVED: modify src/** and package.json. Do NOT touch supabase/migrations/**, no
database operations, no git, no servers (dev server may be running).

## Mission
Build the Inventory & compliance module UI on a mock repository, mirroring the DRAFT schema
semantics (docs/schema-module3.md + migrations 0010/0011 as the spec — READ THEM; especially
the unit-conversion rules, append-only ledger, derived on-hand, and RUP completeness logic).
Route /inventory (nav exists).

## Read first
- docs/farm-rx-handoff.md (three rules; Module 3 scope; Part 7 exclusions)
- docs/design-brief-codex.md — mandatory design brief
- docs/schema-module3.md — the semantics contract (on-hand derived; snapshots; unit rules)
- Existing patterns: src/ProfitabilityModule.tsx + src/data/MockProfitabilityRepository.ts
  (the module you mirror structurally), src/lib/farmerErrors.ts, backends.ts seam

## Data layer rules (same as Module 4 — critical)
- `MockInventoryRepository` implementing `InventoryRepository`, persisted in its OWN key
  `farm-rx-inventory-mock:v1` bound to the injected farm id (fail closed on mismatch);
  never touch other modules' keys; write-verified persistence; fail-closed corrupt
  envelope; seed only when key absent. Fields data via injected FieldsRepository.
- Register `inventory: 'mock'` in backends.ts; compose in index.ts like profitability.
- ON-HAND IS ALWAYS DERIVED in code from receipts + adjustments − effective applications;
  never store a running total.
- Unit conversions ONLY where the schema allows (volume↔volume, weight↔weight); package
  units need an explicit saved factor; never guess density.

## UI scope
1. **On-hand shelf** (landing): product cards grouped by type (chemical/seed/fertilizer),
   big on-hand number in the product's inventory unit, RUP badge where flagged, low/negative
   on-hand surfaced honestly (negative = "Your records show more used than received —
   add a count adjustment."). Quick search/filter.
2. **Receive** flow: 15-second entry — product (or new product inline), quantity + unit,
   optional price, date; draft vs received status per schema; received rows lock (cancel
   with reason only — append-only, no silent rewrite).
3. **Count adjustment**: signed correction with reason (count/loss/return/transfer);
   append-only history visible per product.
4. **Spray/application record**: one field + one crop assignment (pickers from injected
   Fields data), one or more products with rate + unit + total (validate total ≈ rate ×
   acres within 1% when convertible), date/time, applicator name + license no, weather
   (wind speed/direction, temp), REI/PHI display from product snapshot, target pest.
   Regulatory + cost snapshot semantics: copy product facts onto the record at save.
5. **Compliance view**: per record, the RUP completeness check — federal-minimum items
   missing shown as "Required for RUP records" vs operational items as "Good practice";
   plain farmer English; a filterable list of incomplete records.
6. Brand + a11y non-negotiables: ≥18px, ≥48px, tabular-nums, plain English, farmerError
   taxonomy, teaching empty states, no page-level horizontal scroll at 375px (scroll inside
   containers only). PDF export OUT of scope.

## Regression
`src/data/MockInventoryRepository.regression.ts` in `npm run regression`: on-hand derivation
(receipt + adjustment − application in mixed convertible units), package-factor conversion,
received-receipt immutability (edit rejected, cancel-with-reason works), farm isolation
fail-closed, snapshot-on-save (later product edit does not change record), rate×acres
validation, envelope byte preservation for other modules' keys.

## Proof required (run, paste real output)
`npm run build` clean · `npx tsc --noEmit` clean · `npm run regression` all 5 suites pass.
FINAL message: files built, proof output, deviations with one-line justifications.
