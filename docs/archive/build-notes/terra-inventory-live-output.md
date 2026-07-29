Verified after the code changes:

```text
npx tsc -b --force
Exit code: 0
```

```text
npm run build
✓ 129 modules transformed.
✓ built in 1.22s
Exit code: 0
```

```text
npm run regression
8/8 suites passed, including SupabaseInventoryRepository.
```

I did not open the UI because the task explicitly prohibited starting servers.