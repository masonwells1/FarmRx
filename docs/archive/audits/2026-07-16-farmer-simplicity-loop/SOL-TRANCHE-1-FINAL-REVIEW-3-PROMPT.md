# Sol final adversarial review 3 — Farmer Simplicity checkpoint

You are a fresh-context, read-only `gpt-5.6-sol` release-gate reviewer at Extra High reasoning. Inspect the repository and frozen working-tree diff directly. Do not edit or create files, change Git state, commit, push, deploy, call live services, use a browser/Playwright, mutate a database, or reveal credential values. The outer runner alone writes your response.

Review base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree. `SCOPE-CORRECTION.md` declares two independently reviewable pre-commit tranches: exactly 20 core files and exactly 10 replay-containment files. The audit directory is evidence-only. Distrust all prior completion claims.

Requirements to falsify:

1. Option 2 remains the selected action-first Farmer Simplicity direction, but this checkpoint adds no new feature or route.
2. Farm access publication stays bound to the exact signed-in user, selected farm, access generation/token, and server epoch through every final await. Named reps and read-only members receive only their explicit modules/routes. Weather remains denied without edit capability.
3. Offline replay is authorized only after the central Farm Access gate validates the latest capability profile. No queued repository or field-location client may self-register a retry, `online`, storage, or queue-transaction replay; no ordinary read/snapshot may replay or generate due work. Initial setup, reconnect, role downgrade, account replacement, and direct route entry must fail closed.
4. Fields and Equipment snapshots are pure: no replay, writers, due generation, cache/queue/receipt/notice/sync mutation, retained authorization state, ID creation, or IndexedDB creation/upgrade. Clock rollback protection must come from durable authorization-time observation, not snapshot mutation.
5. Fields live, offline, and durable-queue ingress enforce database-legal IDs, commodity slugs, dates, precision/ranges, arrangement semantics, structured/legacy flex rules, unknown-key denial, and validation before durable bytes. Crop overlays preserve canonical `actual_price_per_bu`. Save echoes must match the submitted bundle exactly apart from server audit fields.
6. Equipment due rows must match active machines/intervals and their meter/calendar rule. Offline interval deletion must normalize linked task source/cycle state. Malformed duplicate queue entries must validate before dedupe. Service/scouting/program task links must already exist in the canonical farm workspace before any direct writer or offline queue.
7. E2E mocks must use exact request method/query/body shapes, reject unknown fallbacks, use database-legal fixtures, compile standalone, and actually seed pending Fields/Equipment queues for read-only/named-rep suppression. Browser execution is intentionally unrun and must be reported only as residual risk.
8. No secret, generated build artifact, unrelated change, skipped/vacuous proof, or scope drift may enter either code tranche.

Reported local proof before this review: `npx tsc -b --force` PASS; standalone E2E TypeScript PASS; all 39 `npm run regression` lanes PASS; `npm run build` PASS with only the existing chunk-size warning; `npm audit --audit-level=high` PASS with 0 vulnerabilities; `git diff --check` PASS; tranche static guards PASS 11/11; credential scan PASS with 0 findings. Re-run focused read-only probes if useful. Do not run Playwright.

Return findings ordered BLOCKER/HIGH/MEDIUM/LOW with ID, file/line, reachable scenario, expected behavior, actual risk, business impact, proof, smallest safe correction, and verifying regression. Return `GO` only if no actionable finding exists at any severity. Reconcile the exact 20+10 code scope, state actual model/effort, commands run, residual unexecuted risk, and `External mutation: no` only if true.
