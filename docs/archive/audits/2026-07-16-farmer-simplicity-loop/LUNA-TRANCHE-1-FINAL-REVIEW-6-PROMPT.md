# Luna final release review 6

Act as a fresh-context, read-only `gpt-5.6-luna` release-quality reviewer at Medium reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree. Do not edit or create files, change Git state, commit, push, deploy, call live services, run a browser/Playwright, change a database, or print credentials. The outer runner alone writes your final response.

Reconcile `SCOPE-CORRECTION.md`: exactly 20 core plus 10 replay-containment code/test files. Treat the audit directory as evidence only. Confirm Option 2 remains selected and routes are unchanged.

Review 5 found one HIGH issue: for `pct_of_revenue`, malformed `base_rent_per_acre` and `trigger_revenue_per_acre` values could survive online normalization and offline queue validation. The repair now validates both fields for every structured method, requires them to be null/absent when unused by `pct_of_revenue`, and adds online/offline regressions for string, object, and non-null unused values. Verify the actual source and prove invalid input makes no writer call and does not alter queue bytes.

Then spot-check that the previously cleared release invariants still hold: pre-publication capability fences and removal of old profile bytes; awaited centralized replay before ready including initial-farm setup and due generation; restricted-role queue preservation; pure snapshots and clock fence; strict nested flex allowlists and canonical nulls; Equipment FIFO rebasing/link/delete rules; strict E2E mocks; exact echoes; unchanged routes and exact 30-file scope.

Fresh proof after the review-5 repair: forced TypeScript PASS; standalone E2E TypeScript PASS; focused Fields regression PASS; all 39 regression lanes PASS; production build PASS with only the existing chunk warning; dependency audit 0 vulnerabilities; static guards 11/11; credential scan 0 findings; diff and exact-scope gates PASS. You may rerun concise non-browser read-only probes. Do not run Playwright.

Return severity-ordered actionable findings with file/line and a smallest correction, or `GO` only if clean. State model/effort, scope count, commands, residual browser/live risk, and `External mutation: no` only if true.
