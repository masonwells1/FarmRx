Verified after the final code changes:

```text
npm run build
✓ built in 1.08s
PWA generated successfully.

npx tsc --noEmit
exit 0

npm run regression
MockFieldsRepository regressions passed.
MockGrainRepository regressions passed.
SupabaseFieldsRepository regressions passed.
```

The live Supabase/Auth path remains intentionally unverified against a real database because migrations/RPC setup are owned by another agent and were not run.