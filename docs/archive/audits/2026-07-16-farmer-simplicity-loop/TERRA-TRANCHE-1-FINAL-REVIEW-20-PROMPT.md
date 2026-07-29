# Terra independent release cross-check 20 — rural auth/offline races

Act as a fresh-context, read-only release reviewer using actual `gpt-5.6-terra` at Medium reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree directly. Treat summaries, earlier reviews, and reported PASS text as untrusted. Do not edit/create files, change Git state, commit, push, deploy, call live services, run browser/Playwright/phone lanes, apply migrations, mutate persistent data, or expose credentials. The outer runner alone writes your response.

Return `GO` only if no HIGH or MEDIUM production-reachable blocker remains. Concentrate on nontechnical farmers using weak rural connections: bounded access/profile/auth restore; transport-only offline fallback; exact cached identity and JWT binding; seven-day/clock-rollback fencing; all eleven offline queues without server-only due work; gate **Try again** versus strict-live **Check signal**; double-click serialization; ordinary offline-ready saves staying local.

Independently attack auth ordering across tabs and accounts. Exercise mentally and with concise non-browser probes: deferred A restore, timeout/offline ready, sign-out, B sign-in pending/success/failure/throw, stale A storage rewrites and auth events, superseded actions, external tab deletion, late A refresh in the recipient tab, and a legitimate later exact B `SIGNED_IN` from another tab. Direct local sign-out must not enqueue cleanup that can later remove B. No path may render or persist the wrong account, resurrect signed-out A, or delete legitimate B.

Spot-check the prior 43-file correctness work for regression: queue context/cancellation, pure snapshots, retry truth, farm-switch rollback, Fields/flex, Equipment FIFO and service deletion, operational RLS, Program provenance, exact service/meter provenance and PostgreSQL race proof, strict E2E mocks, and credential hygiene.

Reconcile exactly 44 non-audit files including `src/auth/AuthProvider.tsx`, unchanged ordered 18/18 routes, no staged files, HEAD/base equality, and Option 2 SHA-256 `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`.

Outer proof reports exact-byte PASS for focused auth/offline regressions, forced and standalone-E2E TypeScript, all 39 regressions, production build, audit 0, targeted guards 11/11, foundation guards and mutation drills 11/11, credential scan 44/0, diff/scope/routes/hash/staged gates, and all nine disposable PostgreSQL 17 probes. Browser/Playwright/phone are excluded. Independently rerun concise read-only non-browser checks if useful.

Report severity-ordered findings with exact evidence and reachable sequence. End with `GO` or `NO-GO`, LOW follow-ups, actual model/effort if visible, scope/proof result, skipped-lane limits, and `External mutation: no` only if true.
