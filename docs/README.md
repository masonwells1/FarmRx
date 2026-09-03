# Farm Rx documentation map

Start here when deciding what Farm Rx does now, what remains open, or whether an older document is still authoritative.

## Governing documents

1. [`GOAL.md`](GOAL.md) — current owner directive, scope, capability truth, status definitions, and remaining release gates.
2. [`farm-rx-handoff.md`](farm-rx-handoff.md) — enduring product and design intent. Its original build-order sections are historical context, not the current backlog.
3. [`season-readiness/WORKFLOWS-AND-SCENARIOS.md`](season-readiness/WORKFLOWS-AND-SCENARIOS.md) — frozen executable contract for the accepted six-scenario 2027 packet.
4. [`season-readiness/ORCHESTRATOR-RUNBOOK.md`](season-readiness/ORCHESTRATOR-RUNBOOK.md) — execution, proof, review, and approval rules.
5. [`season-readiness/LEDGER.md`](season-readiness/LEDGER.md) — append-only season-readiness history. Later entries correct earlier entries without rewriting them.

## Initiative records

- [`initiatives/connect-workflows/LEDGER.md`](initiatives/connect-workflows/LEDGER.md) records Weather-to-Spray prefill and confirmed Program-to-Inventory matching. Its final entries record source publication, the two production migrations, and the explicit limit that no production user path was exercised.
- Soil Rx is authorized by `GOAL.md`. Until its initiative ledger is published on `main`, use current branch/pull-request evidence for implementation status and do not promote branch-only claims into the governing documents.

## Dated status and evidence

- [`branch-inventory-2026-09-03.md`](branch-inventory-2026-09-03.md) classifies every GitHub branch observed on 2026-09-03 and separately records local worktree risks.
- Files under [`audits/`](audits/) are dated evidence, not automatically current service state.
- Files under [`archive/`](archive/) preserve superseded goals, build transcripts, and review history. They are not a current backlog.
- Standalone design, schema, research, and review documents in this directory explain how a module was conceived or built. They do not override `GOAL.md`, current source, an initiative ledger, or a later accepted review.

## Reading rule

Treat a pull request, commit, deployment, migration, or live-service statement as historical unless it is explicitly dated and reverified for the decision at hand. Never infer current production state from an old handoff or proof log.
