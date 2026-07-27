# Terra final integration delta — Farmer Simplicity tranche 1

Fresh-context, read-only integration gate over the actual current diff. Do not edit, publish, browse, call live services, change refs, or mutate a database.

- Model `gpt-5.6-terra`, effort `medium`, sandbox `read-only`
- Worktree `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity`
- Base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`

Verify access-profile lifecycle and cache fencing, explicit snapshot-context API compatibility, production factory composition, live/offline snapshot envelope semantics, cold IndexedDB read purity, queue schema compatibility, all callers/tests, and the signed-in browser mock. Try to find broken existing flows or maintenance hazards. Run read-only/no-emit checks if useful.

Findings first, ordered BLOCKER/HIGH/MEDIUM/LOW, with exact file/line, impact, and correction. If no blocker/high, say exactly `No BLOCKER or HIGH findings.` Then report commands/results, residual risks, and external mutation `no`.
