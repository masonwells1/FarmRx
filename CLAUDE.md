# Claude router for Farm Rx

`AGENTS.md` is the canonical shared contract. Read it first and do not restate it here.

Load only the task-specific guide linked from `AGENTS.md`:

- implementation or verification: `docs/agent-development-guide.md`
- protected delivery or any outward action: `docs/agent-delivery.md`
- season-readiness execution: `docs/season-readiness/ORCHESTRATOR-RUNBOOK.md`

Use Claude's native planning and worker tools within those boundaries. Keep one writer per checkout, do not recursively delegate, and return distilled evidence rather than raw logs. Farm Rx TypeScript proof uses `npx tsc -b --force`.

Claude-only routing belongs here. Shared product, safety, approval, and communication policy belongs in `AGENTS.md` or the linked guides.
