# Sol final adversarial release review 9 — Farmer Simplicity checkpoint

Act as the fresh-context, read-only release-gate orchestrator using `gpt-5.6-sol` at Extra High reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree directly; do not trust prior summaries or reviewer conclusions. Do not edit or create files, change Git state, commit, push, deploy, call live services, run a browser or Playwright, change a database, or print credential values. The outer runner alone writes your final response.

Return `GO` only if no HIGH or MEDIUM correctness, data-isolation, permission, offline-queue, or release-blocking issue remains. Otherwise return `NO-GO`, put findings first with exact file and line evidence, give a reachable failure sequence, business impact, smallest correction, and non-vacuous proof to add. Record any LOW follow-up separately.

Reconcile the exact 32-file checkpoint in `SCOPE-CORRECTION.md`: 20 core, 10 replay containment, and 2 closure-repair files. Exclude the audit directory as evidence-only. Confirm Option 2 SHA-256 and 18/18 unchanged routes.

Adversarially falsify all four Review-8 repairs:

1. Starting or invalidating any access-validation generation must synchronously cancel an already in-flight replay before its next writer, queue mutation, cache publication, or status success. The cancellation tombstone must also block newly captured repository guards and stale `supersede:false` retries until the current validated profile installs a new grant. Inspect startup, reconnect, setup completion, cleanup, account switch, and delayed pre-writer timing.
2. `FarmReplayContextChangedError` must propagate as a rejected promise through every replay entrypoint and relevant helper catch across Equipment, Fields, Grain, Inventory, Profitability, Field Log, Harvest, Programs, Scouting, Notifications, and field location. It must never be converted to a blocked/pending/success status or silently returned. Verify the real delayed replay regression actually fails on the old behavior and proves zero writer and byte mutation.
3. Field-location confirmation must match the exact requested farm, field, latitude, longitude, and source, including valid-but-different values.
4. Equipment service confirmation must validate all deterministic nested reading and interval fields, including farm, equipment, reading/date/source/notes and interval completion values.

Then spot-check all previously repaired invariants for regression: capability-shaped navigation/direct routes; validation and replay publication order; pure snapshots and durable clock fences; strict queue parsing and write echoes; Fields flex validation and exact relationships; Equipment FIFO rebasing/link/delete behavior; strict E2E request mocks; no constructor/read/event replay; no credential/debug leakage.

Fresh local proof after Review-8 repair: focused queued-context, Equipment, and weather regressions PASS; forced TypeScript PASS; standalone E2E TypeScript PASS; all 39 regression lanes PASS; production build PASS with only the existing chunk-size warning; dependency audit 0 vulnerabilities; tranche static guards 11/11; foundation guards PASS; credential scan files=150 findings=0; `git diff --check` PASS apart from line-ending notices; exact scope 32; routes 18 base/18 current; Option 2 SHA-256 matches. You may rerun concise read-only non-browser probes.

End with verdict, actual model and reasoning effort, scope reconciliation, commands/probes run, residual limits from the intentionally skipped browser/phone/live-service lanes, and `External mutation: no` only if true.
