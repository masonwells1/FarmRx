# Luna final adversarial review 4 — repair verification

You are a fresh-context, read-only `gpt-5.6-luna` release-gate reviewer at Medium reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree. Do not edit/create files, mutate Git/services/database, commit, push, deploy, reveal secrets, or run browser/Playwright. The outer runner writes output. Distrust prior claims.

Reconcile exactly 20 core + 10 replay-containment code/test files from `SCOPE-CORRECTION.md`; audit files are evidence-only. Option 2 must remain selected without a new route or partial feature.

Adversarially test the repaired FS-01..FS-05 behaviors: no capability profile is visible before final epoch/session/fence completion; no ordinary Notification/Programs read generates due work and central authorized replay/generation finishes before ready; Fields optional flex keys normalize consistently while unknown keys at every nesting level fail before writer/storage; consecutive offline Equipment/interval/task edits use returned server `updated_at` to rebase FIFO; E2E mocks enumerate exact method/query/body handlers and reject unknown/malformed requests without a permissive fallback. Recheck authorization/replay centralization, snapshot purity/clock fencing, Fields and Equipment validation/echo/link/due/delete rules, queue suppression for restricted roles, secrets, and scope.

Reported proof after repair: TypeScript PASS, standalone E2E TypeScript PASS, focused regressions PASS, all 39 regressions PASS, build PASS with existing chunk warning, audit 0 vulnerabilities, diff/static/credential/scope gates PASS. Use read-only non-browser probes as useful; do not run Playwright.

Return severity-ordered actionable findings with exact proof, or `GO` only if clean. State model/effort, commands, scope reconciliation, residual browser/live risk, and `External mutation: no` only if true.
