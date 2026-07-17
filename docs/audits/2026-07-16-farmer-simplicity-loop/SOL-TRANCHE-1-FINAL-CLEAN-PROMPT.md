# Sol Extra High final clean gate — Farmer Simplicity tranche 1

Fresh-context, read-only adversarial release gate. Inspect the actual current uncommitted diff against base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685`; do not trust summaries, prior reports, or passing tests. Do not edit files, refs, services, browsers, or databases.

The intended checkpoint is exactly the 18 production/test files reconciled in `SCOPE-CORRECTION.md`; audit artifacts are excluded. Attack the whole checkpoint, with special attention to the repaired areas:

1. Prove the single exported Fields canonical parser validates live, retained-memory, IndexedDB, nested Equipment, and post-overlay data; attack missing/malformed rows, duplicate IDs, cross-farm rows, and dangling entity/field/commodity/arrangement references.
2. Attack Equipment numeric values at PostgreSQL `numeric(16,2)`, `numeric(18,2)`, and signed-int boundaries in both queues and canonical workspaces.
3. Attack task source/link semantics. A queued `service_interval` task must carry equipment, interval, and cycle linkage. A DB-legal task orphaned by `ON DELETE SET NULL` must not remain represented as service-linked. Program/scouting/manual linkage must fail closed without breaking valid history.
4. Recheck cold restart coverage for invalid viewer, duplicates, dangling equipment/interval/member references, and malformed nested Fields, with no create/upgrade/write/notice/access-resolution/ID side effects.
5. Recheck clock rollback, simultaneous token+server-epoch publication race, exact E2E membership/rep filters and helper RPC bodies, capability matrix, production composition, and pure snapshot mutation checklist.
6. Reconcile scope, TypeScript, and diff hygiene. Run local read-only probes as useful; do not run Playwright, browser, build, live-service, or database commands.

Report findings first as BLOCKER/HIGH/MEDIUM/LOW with exact file/line, failure scenario, and smallest correction. If there is no blocker or high, say exactly `No BLOCKER or HIGH findings.` Give categorical `GO` or `NO-GO`, commands/results, residual risks, 18-file reconciliation, and `External mutation: no`.
