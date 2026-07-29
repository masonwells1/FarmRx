# Sol final release review 5

Act as a fresh-context, read-only `gpt-5.6-sol` release-quality reviewer at Extra High reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree. Do not edit or create files, change Git state, commit, push, deploy, call live services, run a browser/Playwright, change a database, or print credentials. The outer runner alone writes your final response.

Reconcile `SCOPE-CORRECTION.md`: exactly 20 core plus 10 replay-containment code/test files. Treat the audit directory as evidence only. Confirm Option 2 remains selected and routes are unchanged.

Independently test these release conditions:

1. Online capability revalidation removes any prior cached profile before its first asynchronous session check. Final session, epoch, and farm fence checks all happen before profile publication. Nothing checks authorization after publication, and failed validation leaves no profile bytes.
2. The shared `replayAuthorizedFarmWork` gate awaits every permitted Fields, location, Programs, due-generation, Harvest, Grain, Inventory, Profitability, Equipment, Field Log, Scouting, and Notifications operation before profile publication and `ready`, including initial-farm setup. Restricted roles cannot replay disallowed modules. Ordinary reads do not generate due work.
3. Fields live, online-write, and offline-queue ingress use exact nested flex allowlists. Omitted optional structured keys become null; unknown structured or legacy keys are rejected. Writer/queue behavior and exact echoes remain consistent.
4. The earlier FS-01 through FS-05 repairs still hold: Equipment FIFO timestamp rebasing, strict request mocks, pure snapshots and clock fence, route/capability rules, validation, exact save echoes, link/due/delete semantics, and restricted-role queue preservation.

Reported local proof after the latest repair: forced TypeScript PASS; standalone E2E TypeScript PASS; focused Farm Access, queued-context, Fields, and Equipment regressions PASS; all 39 regression lanes PASS; production build PASS with only the existing chunk warning; dependency audit 0 vulnerabilities; diff/static/credential/scope gates PASS. You may rerun concise non-browser read-only probes. Do not run Playwright.

Return severity-ordered actionable findings with file/line and a smallest correction, or `GO` only if clean. State model/effort, scope count, commands, residual browser/live risk, and `External mutation: no` only if true.
