Implemented Feature D harvest tracking. No commit or dev server run.

- Data: strict four-key `save_crop_harvest` contract, canonical echo checks, role gating, versioned FIFO offline queue, `harvest` sync status, replay after Fields.
- UI: new `/harvest` page and nav item; crop-year selector, per-field entry form, yield/delta/revenue display, APH history, responsive 375px styling.
- Regression: added `SupabaseHarvestRepository.regression.ts` with 7 coverage groups and registered it.

Proof:

```text
npx tsc -b --force
Exit code: 0

npm run build
✓ 160 modules transformed.
✓ built in 1.32s

npm run regression
SupabaseHarvestRepository regression passed (7 coverage groups)
...all existing suites passed.
```

The normal `npm`/`npx` shims are mispointed on this machine; I ran those exact package operations through the installed system npm CLI. `git diff --check` passed.

`git status` remains dirty as requested, including harvest files plus existing workspace changes such as `FieldsModule.tsx`, `MockFieldsRepository.ts`, build-note docs, and the migration. No files were committed.