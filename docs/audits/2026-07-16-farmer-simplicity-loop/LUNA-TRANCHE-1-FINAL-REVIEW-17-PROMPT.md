# Luna final UX/release cross-check 17 — unambiguous application-role proof

Use actual gpt-5.6-luna at Medium reasoning as an independent read-only reviewer. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree. Do not trust prior conclusions or PASS text. Do not edit/create files, change Git, call live services, apply persistent migrations/data changes, expose credentials, or run browser/Playwright/phone. The outer runner alone writes your response.

Return GO only if no HIGH/MEDIUM correctness, farmer-recovery, permission, offline, data, concurrency, or proof-quality blocker remains. Reconcile 43 files, 18 routes, and Option 2 hash.

Review 16 is rejected by your mixed-role finding. Verify the exact repair: the old postgres duplicate of the new service save/retry/reversal path is gone; one canonical path runs all three supported application operations under `SET LOCAL ROLE authenticated`; owner role is used only to inspect the private provenance table between those calls. Verify backdated/calendar operations are authenticated. Verify the dblink race now sets the remote connection to authenticated and switches the outer save/delete calls to authenticated, with postgres limited to dblink coordination/private assertions. Distinguish required owner-only migration/backfill/catalog checks from supported farmer application operations; do not require an app role to inspect the deliberately private provenance table.

Also recheck the farmer-visible/data-safe outcomes from earlier repairs: read-only operational denial, Program projection protection with working Season progress, unreachable private service helpers, exact/no-guess service history, atomic farm selection recovery, truthful locked retry after due-generation failure, fail-closed flex formula, durable queues, no cross-farm leak, and no false synced state.

Fresh outer proof reports TypeScript/E2E TypeScript, all 39 regressions, build, audit, guards/mutations, credential 43/0, exact manifest/hash, and all nine disposable PostgreSQL probes green after the cleanup. Browser/Playwright/phone are excluded. Use concise read-only checks if useful.

Report findings first, categorical GO/NO-GO, LOW follow-ups, actual model/effort if visible, scope/proof/skipped limits, and `External mutation: no` only if true.
