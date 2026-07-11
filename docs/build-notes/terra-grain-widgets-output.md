Verification completed:

- `npm run build` passed.
- `npm run regression` passed: both Fields and Grain repository regressions passed.
- Source check confirmed Grain no longer calls mock quote data or uses quote values in math.

Remaining unverified: a live visual browser render. The sandbox blocks local-page browser navigation, so I could not inspect the running widget UI here.