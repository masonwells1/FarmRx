# Terra independent release cross-check 25

Use actual `gpt-5.6-terra` at Medium reasoning as a fresh-context, read-only reviewer. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree directly. Distrust earlier review and PASS claims. Do not edit/create files, alter Git, commit, push, deploy, call live services, run browser/Playwright/phone lanes, apply persistent migrations, mutate persistent data, or expose credentials. The outer runner alone writes your response.

Return `GO` only if no HIGH or MEDIUM blocker remains. Independently attack `src/auth/AuthProvider.tsx` and its mounted regressions. Verify all app-controlled session+intent transitions share one cross-tab lock without holding it across the password network call; the post-ownership-check/pre-intent-write interleaving is impossible; lost-nonce adoption trusts only a freshly reread coherent shared tuple; malformed non-null intent cannot be restored on returned errors or rejected promises; delayed historical deletion/bare sign-out cannot erase a newer coherent login; genuine deletion and incoherent accepted lineage fail closed; and pending nonce, early auth-js writes, commit failure, sign-out cleanup, restore generation, exact session bytes, and nonce ABA stay safe.

Spot-check wider offline, retry, eleven-queue, Fields, Equipment/provenance, Program, and RLS behavior. Reconcile 47 non-audit files (43 tracked plus 4 untracked), 18/18 ordered routes, zero staged, HEAD/base equality, Option 2 SHA-256 `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`, and credential scan 47/0.

Outer proof reports focused auth regression, TypeScript, standalone foundation-E2E TypeScript, all 39 regressions, build, audit 0, foundation static, 11/11 mutation drills, exact scope/routes/hash/staged gates, all nine disposable PostgreSQL probes, and RLS role matrix green. Browser/Playwright/phone are excluded. Use concise read-only probes if useful.

Report severity-ordered findings with exact evidence and reachable sequence, or `GO` if clean. Include actual model/effort, scope/proof reconciliation, residual skipped-lane risk, and `External mutation: no` only if true.
