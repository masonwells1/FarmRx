Implemented all Feature A review fixes. No commit made.

- P1-1: own-hour rain probability now blocks “Good” at 70%+ and cautions at 50%+.
- P1-2: incomplete forecasts reject; valid stale cache is used when available.
- P1-3: location enqueue/replay now shares keyed cross-tab locking and removes only the confirmed operation.
- P2-4: cache bundles receive strict structural validation.
- P2-5: storage failures no longer hide valid live forecasts.
- P2-6: field replay finishes before location replay starts.
- P2-7: field location provenance must match coordinate presence.
- P2-8: offline location wording is honest about possible permission blocking.
- P2-9: weather suite is now 6 coverage groups, including local timestamps, DST-adjacent input, cache/storage failures, mapper and queue races.
- P3-10: field-load errors no longer show the empty-fields state.
- P3-11: hour-strip labels are 18px; no weather CSS text is below 18px.

Proof:

```text
.\node_modules\.bin\tsc.cmd -b --force
Exit code: 0

Regression suites:
MockFieldsRepository regressions passed.
MockGrainRepository regressions passed.
SupabaseFieldsRepository regressions passed.
SupabaseGrainRepository regressions passed.
MockProfitabilityRepository regressions passed.
SupabaseProfitabilityRepository regressions passed.
MockInventoryRepository regressions passed.
SupabaseInventoryRepository regression passed (8 coverage groups)
SupabaseEquipmentTasksRepository regression passed (9 coverage groups)
Weather service regressions passed (6 coverage groups).

vite build:
✓ 138 modules transformed.
✓ built in 1.26s
```

`git diff --check` passed.

Deviation: `npx tsc -b --force`, `npm run build`, and `npm run regression` could not start because this machine’s global npm/npx shims point to missing `npm-cli.js` / `npx-cli.js`. I ran their exact repository-local equivalents successfully.

`git status --short`:

```text
 M docs/GOAL.md
 M package.json
 M src/App.tsx
 M src/FieldsModule.tsx
 M src/data/MockFieldsRepository.ts
 M src/data/QueuedFieldsRepository.ts
 M src/data/SupabaseFieldsRepository.ts
 M src/data/fields.ts
 M src/data/index.ts
 M src/data/syncStatus.ts
 M src/styles/app.css
?? docs/build-notes/task-0018-field-location.md
?? docs/build-notes/task-0018-output.md
?? docs/build-notes/task-weather-build.md
?? docs/build-notes/task-weather-fixes.md
?? docs/build-notes/task-weather-output.md
?? docs/build-notes/task-weather-review-output.md
?? docs/build-notes/task-weather-review.md
?? docs/build-notes/weather-inventory-findings.md
?? docs/weather-spray-design.md
?? src/WeatherModule.tsx
?? src/data/fieldLocation.ts
?? src/data/weather.ts
?? src/data/weatherService.regression.ts
?? src/data/weatherService.ts
?? supabase/migrations/0018_field_location.sql
```