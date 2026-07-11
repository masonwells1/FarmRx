# Module 1 Fields UI — adversarial review

1. **P1 — `src/data/MockFieldsRepository.ts:89`** — Persisted data is accepted with `JSON.parse(... as FieldsData)` but no structural or version validation. Valid-but-corrupt JSON such as `{}` will crash the Fields UI, while `localStorage.getItem/setItem` failures are unhandled. Add a versioned storage envelope, runtime schema validation, migration/reset handling, and guarded reads/writes.

2. **P1 — `src/data/MockFieldsRepository.ts:123`** — Editing a field deletes every arrangement for that field, including historical rows, then creates one replacement dated January 1. This violates the schema’s arrangement-history model and silently destroys data. Preserve closed arrangements; update the current row when its terms are unchanged or close it and insert a newly effective arrangement.

3. **P1 — `src/FieldsModule.tsx:203`** — Blank cash rent and flex base rent pass validation because `Number('')` is `0`, so the UI saves a rate the user never entered. Require a nonblank, finite rate and make the input visibly required for both arrangement types. Repeat this validation inside the repository.

4. **P1 — `src/FieldsModule.tsx:207`** — Flex rent is stubbed with `{ type: 'to_be_configured' }`, and its detail text only shows the base rent. The specification requires a configurable price/yield/revenue bonus formula and a plain-English arrangement description. Implement supported formula fields, validate them, persist structured terms, and render the complete formula in plain English.

5. **P1 — `src/FieldsModule.tsx:207`** — Crop-share editing hardcodes seed, fertilizer, and chemical shares to the crop percentage and every other input share to zero. Users cannot record the schema’s independently specified input percentages, so downstream share economics will be wrong. Add controls for every landlord input percentage and validate each value from 0–100.

6. **P1 — `src/data/MockFieldsRepository.ts:107`** — Repository validation does not mirror database constraints: it permits fields over 5,000 acres, blank/overlength or duplicate names, invalid state lengths, unknown entities/commodities, and invalid arrangement shapes. Centralize schema-equivalent validation in the repository so UI bypasses or corrupted storage cannot create records rejected by Supabase.

7. **P1 — `src/data/MockFieldsRepository.ts:6`** — Mock and generated IDs such as `farm-wells-group`, `field-1`, and `field-${crypto.randomUUID()}` are not UUIDs even though the corresponding database columns are UUIDs. Use valid deterministic UUIDs for seed rows and bare `crypto.randomUUID()` values for new rows.

8. **P1 — `src/FieldsModule.tsx:121`** — Arrangement is displayed and filterable but cannot be sorted, despite the explicit requirement that the field list be sortable by crop, entity, and arrangement. Add an arrangement sort key and wire this header to `changeSort`.

9. **P1 — `src/styles/app.css:90`** — Core UI text is repeatedly reduced below the required 18px base—headings, table headers/cells, filters, form labels, inputs, and mobile navigation reach 11–17px. The sort buttons at `src/styles/app.css:102` also have no 48px tap target. Raise functional text to at least 18px and give every interactive control a minimum 48×48px hit area.

10. **P2 — `src/FieldsModule.tsx:17`** — Currency formatting rounds rent to whole dollars, so `$285.50/ac` displays as `$286/ac`. Preserve two decimal places consistently for monetary rates.

11. **P2 — `src/FieldsModule.tsx:63`** — `visibleFields` calls `.sort()` directly on `data.fields`, mutating React state during rendering. Sort a copied array (`[...data.fields]`) to prevent hidden ordering changes and render-dependent behavior.

12. **P2 — `src/data/fields.ts:100`** — `FieldDraft` and the form omit FSA farm number, FSA tract number, soil productivity index, and usable legal-description editing. These are Module 1 field properties and are already displayed on detail. Add them to the draft, form, validation, and repository mapping.

13. **P2 — `src/FieldsModule.tsx:163`** — Yield history is explicitly a placeholder even though the Module 1 screen specification requires yield history. Either implement the required yield records/view or remove the claim that Module 1 is complete and track it as unfinished scope.

14. **P2 — `src/FieldsModule.tsx:188`** — Crop assignment editing is locked to the device’s current year, with no way to enter or amend historical or future assignments. Add an explicit crop-year field and enforce the schema’s 1900–2200 constraint so crop history can be maintained rather than merely viewed.

P3: None.

VERDICT: NEEDS FIXES (9 P1)