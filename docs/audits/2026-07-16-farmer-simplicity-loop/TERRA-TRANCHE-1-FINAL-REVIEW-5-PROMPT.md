# Terra final release review 5

Act as a fresh-context, read-only `gpt-5.6-terra` release-quality reviewer at Medium reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree. Do not edit/create files, change Git, commit, push, deploy, call live services, run browser/Playwright, change a database, or print credentials. The outer runner alone writes your response.

Reconcile exactly 20 core plus 10 replay-containment code/test files from `SCOPE-CORRECTION.md`; audit files are evidence only. Confirm Option 2 and unchanged routes.

Check that prior cached capability bytes are removed before online revalidation awaits; all final session/epoch/farm checks precede publication; all authorized replay/generation steps are awaited before `ready` in startup and initial setup; restricted roles cannot replay disallowed queues; live flex input rejects unknown structured/legacy keys while normalizing omitted optional keys. Recheck FS-01 through FS-05, pure snapshots, Equipment rebasing, strict mocks, validation, exact echoes, and secrets/scope.

Reported proof: forced TypeScript, standalone E2E TypeScript, focused regressions, all 39 regressions, production build, dependency audit, diff/static/credential/scope gates all PASS; browser/live checks intentionally skipped. Use concise read-only probes as useful.

Return severity-ordered findings with file/line and smallest correction, or `GO` only if clean. State model/effort, scope, residual risk, and `External mutation: no` only if true.
