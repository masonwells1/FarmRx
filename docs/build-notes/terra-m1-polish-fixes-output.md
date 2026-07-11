Verified: `npm run regression` executed `src/data/MockGrainRepository.regression.ts` and printed:

```text
MockGrainRepository regressions passed.
```

It proves Grain saves preserve the authoritative Fields slice and never write a nested Fields copy.