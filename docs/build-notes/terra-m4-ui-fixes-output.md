Verified again:

```text
npx tsc --noEmit
# clean

MockProfitabilityRepository regressions passed.
```

This directly exercises the new shared calculations, farm-isolation fail-closed path, duplicate allocations, and persistence protection.