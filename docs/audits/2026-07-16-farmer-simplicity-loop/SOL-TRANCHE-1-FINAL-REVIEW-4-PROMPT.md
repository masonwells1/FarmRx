# Sol final adversarial review 4 — repair verification

You are a fresh-context, read-only `gpt-5.6-sol` release-gate reviewer at Extra High reasoning. Inspect base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through the current working tree directly. Do not edit/create files, change Git state, commit, push, deploy, call live services, use browser/Playwright, mutate a database, or reveal credentials. The outer runner alone writes your response. Distrust all prior verdicts.

Reconcile `SCOPE-CORRECTION.md`: exactly 20 core code/test files plus 10 replay-containment files; the audit directory is evidence-only. Option 2 remains selected and no route/feature is added.

Review the complete checkpoint, with special adversarial falsification of the five repairs from prior NO-GO FS-01..FS-05:

1. Capability profile bytes remain absent through the final epoch/session awaits. Publication happens only after exact user/farm/generation/token/server-epoch checks, with no await after publication. Cross-tab farm switch, generation change, and same-account token replacement fail closed.
2. Ordinary Notification/Programs reads and navigation cannot generate due work. Only the centrally validated, capability-gated replay/generation path may mutate, and it completes Programs replay then generation before publishing ready state. No repository constructor/read/online/storage/queue-transaction self-replay returns.
3. Fields uses explicit allowlists at top-level, arrangement, crop, structured-flex, and legacy-flex ingress. Omitted optional structured-flex keys canonicalize to null identically online/offline; unknown keys make zero writer calls and zero durable-byte changes; exact echoes cannot report false failure after a commit.
4. Consecutive offline Equipment, interval, and task edits of the same row rebase the second expected timestamp from the first confirmed server row and do not park valid work. Confirm the operation-writer return contract and FIFO map actually carry `updated_at`.
5. E2E Supabase handlers validate exact method/query/body shapes, including capability probe. No generic unknown-GET fallback remains. Explicit Grain handlers match production gateway query shapes and malformed mock tests cover unknown table, extra parameter, wrong method, and wrong RPC body.

Also recheck role-gated routes/replay, pure Fields/Equipment snapshots and clock fencing, commodity/date/precision/range validation, crop actual-price preservation, Equipment due/link/delete/dedupe rules, strict seeded read-only/named-rep queue suppression, secrets, generated files, and scope drift.

Reported proof after repair: app TypeScript PASS; standalone E2E TypeScript PASS; focused Farm Access/queued-context/Fields/Equipment regressions PASS; all 39 regression lanes PASS; production build PASS with only existing chunk warning; dependency audit 0 vulnerabilities; `git diff --check` PASS; static guards 11/11; credential scan 0 findings; exact 20+10 scope. Re-run non-browser read-only probes if useful. Do not run Playwright.

Return findings ordered BLOCKER/HIGH/MEDIUM/LOW with ID, file/line, reachable scenario, proof, impact, smallest correction, and regression. Return `GO` only if no actionable finding exists at any severity. State model/effort, commands run, scope reconciliation, residual unexecuted risk, and `External mutation: no` only if true.
