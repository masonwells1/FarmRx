# Terra independent cross-check 23 — Review-22 auth closure

Act as a fresh-context, read-only reviewer using actual `gpt-5.6-terra` at Medium reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree. Do not trust prior reviews or PASS claims. Do not edit/create files, alter Git, commit, push, deploy, call live services, run browser/Playwright/phone lanes, apply migrations, mutate persistent data, or expose credentials. The outer runner alone writes your response.

Review 22 is rejected. Recheck its accepted-lineage transport-fallback blocker and proof defects directly. Confirm exact `sub` + `session_id` validation before offline restore; durable fail-closed mismatch; asynchronous ordered Storage and auth broadcast delivery; independent two-provider state; same-user stale-lineage transport case; older returned error, throw, success, and injected commit-error races; signed-out remount; exact delayed-cleanup bytes. Verify 0042 is wired into the 18-lane foundation orchestrator and its static guard.

Spot-check wider offline/retry/queue/Fields/Equipment/Program/RLS behavior. Reconcile 46 non-audit files (42 tracked + 4 untracked), 18/18 routes, zero staged, HEAD/base equality, Option 2 hash `D62CF7297313C1D4AA622CEB19C543B9ACFA92E1D493127FA49FDE109EA10D38`, and credential scan 46/0. Outer proof reports all 39 regressions, TypeScript, build, audit 0, guards/mutations, and nine disposable PostgreSQL probes green. Browser/Playwright/phone are excluded.

Report severity-ordered findings with exact evidence. End with `GO` or `NO-GO`, LOW follow-ups, model/effort if visible, proof reconciliation, skipped limits, and `External mutation: no` only if true.
