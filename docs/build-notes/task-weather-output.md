Verified by execution:

- `npx tsc -b --force` passed.
- `npm run build` passed.
- `npm run regression` passed, including the new weather suite.

The changed field adapters and queue code are exercised by the existing field regressions; location echo validation is exercised by the new weather regression. UI/browser verification remains intentionally unrun because the task explicitly forbade starting a dev server and assigned browser verification to the orchestrator.