Findings first:

- MEDIUM proof blocker — `scripts/verify-0042-disposable.ps1:120-149` still executes supported `delete_service_log_with_reversal` operations as database owner `postgres`. This is beyond private-provenance inspection and leaves a positive application operation owner-backed.
- The new save/retry/reversal triad is correctly under `SET LOCAL ROLE authenticated` at `:300-369`.
- The backdated/calendar path is authenticated at `:656-692`; the dblink remote and outer save/delete are both authenticated.
- No additional HIGH/MEDIUM farmer, permission, offline, data, concurrency, or recovery blocker was found in the inspected source.

**NO-GO**

The owner-only block must retain only migration/backfill/catalog assertions and private provenance inspection. Move the historical reversal behavior checks into authenticated application-role transactions, then rerun the nine probes.

Scope: 43 non-audit files; 18 routes; Option 2 hash matches exactly. Outer proof results are accepted as reported: 39 regressions, TypeScript/E2E TypeScript, build, guards, credential scan, and 9/9 disposable probes.

Actual model/effort: the runtime did not expose or verify `gpt-5.6-luna` or its reasoning setting.

Skipped: browser, Playwright, phone, live services, persistent migrations/data changes, and probe execution.

External mutation: no.
