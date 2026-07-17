# Terra final cross-check 16 — authenticated-role proof closure

Use actual gpt-5.6-terra at Medium reasoning as an independent read-only reviewer. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree. Do not trust summaries or PASS text. Do not edit/create files, change Git, commit, push, deploy, call live services, run browser/Playwright/phone lanes, apply persistent migrations, mutate persistent data, or expose credentials. The outer runner alone writes your response.

Return GO only if no HIGH or MEDIUM blocker remains. Reconcile the exact 43-file scope, ordered 18 routes, and Option 2 hash.

Review 15 is rejected because Luna found that the positive service/provenance workflow in 0042 used JWT claims without a real authenticated SQL role. Verify the repaired script now performs first save, exact replay, and reversal under `SET LOCAL ROLE authenticated`; checks public rows through that role; resets to owner only to inspect the intentionally private provenance table; and returns to authenticated for reversal. Confirm the existing Program positive workflow already uses the authenticated role and trusted `skip_program_pass` RPC. Attack for a vacuous role switch, stale claims, hidden privilege dependence, transaction-scope mistake, or assertions that cannot distinguish an owner bypass.

Then independently spot-check read-only operational RLS/service denial, manual-only meter source, Program generic/database provenance fences, private helper revocation, public service wrapper lock/search-path/auth/edit/idempotency/history rules, farm-storage rollback, strict Program generation/retry, null flex formula rejection, interval preservation/recomputation, offline durability, cancellation/replay authorization, pure snapshots, exact echoes, capability routes, strict fixtures, and credential isolation.

Fresh outer proof reports forced and standalone-E2E TypeScript PASS, 39/39 regressions, production build, audit 0, targeted guards 11/11, foundation static and mutation drills 11/11, credential scan 43/0, diff/staged/scope/routes/hash gates, and 9/9 PostgreSQL 17 disposable probes. Browser/Playwright/phone are excluded. Inspect directly and rerun concise read-only non-browser checks as useful.

Report findings first, categorical GO/NO-GO, actual model/effort if independently visible, scope result, proof run, skipped-lane limits, and `External mutation: no` only if true.
