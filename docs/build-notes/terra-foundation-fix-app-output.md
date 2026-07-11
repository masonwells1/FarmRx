Implemented foundation fixes across `src/**` and `package.json`; no migrations or database operations touched.

1–2. FIFO queueing, shared Web Lock/renewable lease fallback, ownership checks, and two-writer regression coverage.  
3. Crop assignment drafts now send `is_new`.  
4. Bootstrap uses the idempotent `bootstrap_first_farm` RPC.  
5. Expanded regression coverage for queue durability, FIFO replay, receipts, user isolation, Grain isolation, and concurrent writers.  
6–10. Central transport classification, offline workspace overlay/cold-start message, post-resolution replay, auth restore guard, and strict versioned queue validation.  
11–12. Fixed farmer-English UI errors and resolved farm name in the shell.

Proof:

```text
npm.cmd run regression
MockFieldsRepository regressions passed.
MockGrainRepository regressions passed.
SupabaseFieldsRepository regressions passed.

npm.cmd run build
✓ built in 1.16s

.\node_modules\.bin\tsc.cmd --noEmit
(exit 0; no diagnostics)
```

Deviation: the PowerShell `npm`/`npx` shim on this machine is broken (`npm-cli.js` missing), so I ran the same requested scripts through the installed `npm.cmd`; all project checks passed.