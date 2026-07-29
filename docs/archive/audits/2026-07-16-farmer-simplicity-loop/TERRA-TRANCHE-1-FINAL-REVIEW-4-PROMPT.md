# Terra final adversarial review 4 — repair verification

You are a fresh-context, read-only `gpt-5.6-terra` release-gate reviewer at Medium reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree. Do not edit/create files, change Git, commit, push, deploy, use live services/database, expose secrets, or run browser/Playwright. The outer runner writes your response. Prior reviews are untrusted.

Reconcile the exact 20 core + 10 replay-containment code/test files in `SCOPE-CORRECTION.md`; audit files are evidence-only. Verify Option 2 remains selected with no route/feature addition.

Falsify the five repaired defects: profile publication must remain invisible until all final session/epoch/fence checks finish; ordinary Notification/Programs reads must never generate due work and central validated replay/generation must precede ready publication; Fields must canonicalize omitted optional flex keys and reject unknown top/arrangement/crop/structured/legacy keys before writer/queue bytes; repeated offline Equipment/interval/task edits must rebase from returned server timestamps; E2E mocks must have exact explicit request contracts and no generic GET fallback. Recheck role gates, centralized replay, pure snapshots, clock rollback, Fields/Equipment semantics and echoes, seeded pending-queue suppression, secrets, and scope drift.

Reported proof: TypeScript and standalone E2E compile PASS; four focused regressions PASS; all 39 regressions PASS; build PASS with only existing chunk warning; audit 0 vulnerabilities; diff check PASS; static guards 11/11; credential scan 0; exact 20+10 scope. Run useful read-only non-browser probes; no Playwright.

Return actionable findings ordered by severity with exact file/line and proof, or `GO` only if none. Include model/effort, commands, scope, residual browser/live risk, and `External mutation: no` only if true.
