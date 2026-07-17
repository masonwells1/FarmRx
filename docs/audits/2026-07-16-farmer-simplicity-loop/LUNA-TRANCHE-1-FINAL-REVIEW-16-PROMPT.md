# Luna final UX/release cross-check 16 — authenticated-role proof closure

Use actual gpt-5.6-luna at Medium reasoning as an independent read-only reviewer. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree. Do not trust prior conclusions or PASS text. Do not edit/create files, change Git, commit, push, deploy, call live services, run browser/Playwright/phone lanes, apply persistent migrations, mutate persistent data, or expose credentials. The outer runner alone writes your response.

Return GO only if no HIGH or MEDIUM product-correctness, nontechnical-user recovery, permission, offline-save, data-integrity, concurrency, proof-quality, or release blocker remains. Reconcile 43 files, 18 routes, and the Option 2 hash.

Review 15 is rejected by your prior MEDIUM: the positive service save/reversal path ran as `postgres`. Verify the correction directly. The 0042 script must now run service save, exact retry, and reversal under a genuine `SET LOCAL ROLE authenticated` owner session with correct JWT/epoch headers. That role must see exactly one public log/reading after retry and see them gone after reversal. Owner context may be used only to inspect the private provenance table between authenticated operations. Confirm the Program positive path remains under the authenticated role and trusted Season-progress RPC. Try to find any vacuous assertion, role reset error, stale claim, or owner-only behavior mislabeled as application proof.

Also verify the farmer-visible/data-safe outcomes remain intact: read-only users cannot alter operations; Program cards cannot be edited or downgraded through generic Tasks/direct database writes while Season progress works; private service helpers remain unreachable; public service save never guesses history; failed farm selection cannot split storage or leave stale retry authorization; due-generation failure remains visibly retryable without duplicate save; corrupt null flex formulas fail closed; service/meter history remains exact; and cross-farm work cannot leak or silently report synced.

Fresh outer proof reports forced and standalone-E2E TypeScript PASS, 39/39 regressions, build, audit 0, static/foundation/mutation gates, credential 43/0, exact diff/staged/scope/routes/hash, and 9/9 PostgreSQL 17 probes. Browser/Playwright/phone are excluded. Use concise read-only non-browser checks if useful.

Report findings first, categorical GO/NO-GO, LOW follow-ups, actual model/effort if independently visible, scope result, skipped-lane limits, and `External mutation: no` only if true.
