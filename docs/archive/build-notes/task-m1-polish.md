PRE-APPROVED TASK — do NOT ask for confirmation, do NOT stop to check in; EXECUTE end-to-end and report what you did.

# Task: Module 1 Fields — polish pass (competitor-informed)

You are working in C:\FarmRx (Vite + React + TypeScript PWA, mock repositories on localStorage).
Read FIRST, before writing any code:
- docs/design-brief-codex.md (non-negotiable design rules: 18px minimum body text, 48px minimum tap targets, brand tokens in src/styles/tokens.css)
- docs/competitor-farmprofitmanager.md (sections on Fields/crops setup — we are adopting specific ideas listed below)
- src/FieldsModule.tsx, src/data/fields.ts, src/data/MockFieldsRepository.ts, src/data/index.ts (the repository composition point — UI must keep using the injected repository interface, never import the mock directly)
- src/GrainModule.tsx only as a style reference for status chips and card patterns.

## Build exactly these five improvements to the Fields module

1. **Inline add-field row in the fields list.** At the bottom of the list, a single always-visible row: field name, acres, county/location. Typing in it and leaving the row (blur) or pressing Enter saves the new field immediately through the repository — no separate page, no modal, no explicit Save button for this quick path. Show a brief inline "Saved" confirmation. Invalid input (empty name, non-positive acres) shows an inline error on the row and does NOT save. Full details can then be added on the detail page. Target: a farmer adds a field in under 10 seconds.

2. **Field detail page restructured as 4 edit-in-place cards**: (a) Basics — name, acres, county, FSA farm/tract numbers; (b) Land agreement — arrangement type, rent/share terms, landlord name AND landlord contact info (phone, notes); (c) Yield & price — per-crop APH/expected yield used by Grain math; (d) Records — crop assignments history. Each card shows values as text with an Edit affordance; editing happens in place in the card and saves per-card through the repository (autosave on blur or a small per-card Save — your call, but keep it consistent across cards). Preserve ALL existing behavior: arrangement close-and-insert history semantics in MockFieldsRepository must not change.

3. **KPI row at the top of the fields list**: total fields, total acres, and a "Crops assigned x/y" nudge (x = fields with a current-year crop assignment, y = total fields). If x < y the nudge is visually prominent (brand green accent) and clicking it filters the list to fields missing a crop assignment; click again to clear the filter.

4. **Landlord contact on the agreement card** (covered in item 2b) — this requires adding landlord contact fields to the Field/arrangement data model. Extend the TypeScript types and the mock repository schema-mirroring validation accordingly. Bump the localStorage envelope handling ONLY if the stored shape changes in a way that needs migration; if you add optional fields, a lazy default (undefined → empty) is fine and preferred — do NOT break existing stored v2 data. Write/extend a regression check like the existing MockGrainRepository.regression.ts pattern proving: existing stored data without the new fields still loads, and a save round-trips the new contact fields.

5. **Equivalent-cash-rent display** on the Land agreement card: for share/flex arrangements, compute and show the equivalent cash rent per acre (the cash-rent-equivalent of the share terms given the field's expected yield and a price input — use the same expected-price source the Grain module uses for that commodity, or a manual price on the card if none exists). Label it clearly as an estimate: "≈ equivalent cash rent". For cash-rent arrangements just show the rent itself. Show "—" with a hint when inputs are missing rather than fake numbers.

## Hard rules
- Mock data only. NO Supabase client code, NO network calls, NO new dependencies.
- UI talks only to the repository interface exported from src/data/index.ts.
- Do not touch src/GrainModule.tsx logic or MockGrainRepository persistence (shared envelope: grain compartment must remain untouched by fields saves — there is a regression test guarding this; keep it passing).
- Design brief rules are non-negotiable: ≥18px user-facing text, ≥48px interactive targets, brand tokens only (no hardcoded hex), tabular-nums for numbers.
- TypeScript strict must stay clean: run `npm run build` and ensure it passes before finishing.
- Run the existing regression scripts if they are runnable via node/npm and report results.

## Definition of done (report each)
- npm run build passes clean (paste the tail of output).
- List every file you created/changed with one line each on what changed.
- Describe how you verified the inline add row, per-card editing, KPI filter, and equivalent-cash-rent math (unit-level reasoning is fine; Claude will do browser verification after you).
