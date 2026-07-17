# Sol Read-Only Reconnaissance

CRITICAL EXECUTION RULE: This is a headless read-only task. Do not ask for approval. Do not edit any file, ref, service, database, or external system. A successful task ends with a complete report in your final response.

You are the Sol worker for Farm Rx. Report your actual model and reasoning effort first.

Repository: `C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity`

Mission: design the smallest safe architecture for the approved Farmer Simplicity Layer: Today home, Quick Record, first-week setup checklist, progressive-disclosure forms, role-shaped navigation, and recovery/help. Focus on architecture, permissions, cross-module aggregation, offline/cache behavior, privacy, and failure containment.

Read:

- `CLAUDE.md`
- `docs/farm-rx-handoff.md`
- `docs/design/01-brand.md` through `04-page-patterns.md`
- `docs/audits/2026-07-16-farmer-simplicity-loop/GOAL-AND-LOOP.md`
- current `src/App.tsx`, auth/farm access, repositories, sync/cache layers, modules, tests, and migrations needed to support your conclusions

Required output:

1. Actual model/effort.
2. Files read and commands run.
3. Current-state architecture map relevant to the simplicity layer.
4. Recommended Today read model and the trusted source for role-shaped navigation.
5. Risks: cross-farm/user leakage, private financial exposure, stale/offline aggregates, duplicated writes, route/default regressions, and circular module coupling.
6. A serialized implementation plan with exact bounded file scopes, proof per slice, and stop conditions.
7. Which ideas should remain navigation-only versus which require new writes or schema.
8. Residual questions/risks.
9. Explicit statement that no external or filesystem mutation occurred.

Do not provide implementation rationale to the future adversarial reviewer; this report is for the orchestrator only.
