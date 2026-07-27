Verified `src/data/decimal.ts` through the harvest regression suite: it exercised `1.005 → 1.01`, the 6-decimal half-up boundary, outgoing rounding, and a genuine mismatch rejection.

```text
SupabaseHarvestRepository regression passed (8 coverage groups)
```

It also passed `tsc -b --force`, production build, and the full regression suite.