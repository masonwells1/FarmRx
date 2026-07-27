## High — stale central validation can reclaim the gate

[App.tsx:453](C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity\src\App.tsx:453) uses one effect-lifetime `active` flag for every startup/reconnect validation. If validation A is delayed in `loadFarmAccessProfile`, validation B completes and installs a newer read-only gate, then A resumes, it still sees `active === true` and calls `replayAuthorizedFarmWork` at [line 470](C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity\src\App.tsx:470). That replaces B’s global authorization because `beginFarmReplayAuthorization` defaults to superseding ([farmContext.ts:101](C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity\src\auth\farmContext.ts:101)), then A can publish its older profile/retry actions.

The new regression covers a stale repository lookup after an explicit A→B gate replacement, but not this older-central-validation-after-newer-central-validation race.

Smallest correction: create a monotonic validation generation/ref; increment and capture it synchronously for startup, reconnect, and setup completion before their first await. Use `isCurrent = () => active && generation === currentGeneration` after every await and before installing actions/publishing state. Pass it to replay so an older validation cannot start or reclaim a gate.

Model/effort: gpt-5.6-terra, Medium.
Scope reviewed: base `48aad521bd1ecb4c5704ef2e6c5bb30e4d522685` through working tree, focused on `App.tsx`, `farmContext.ts`, queued-context regression, plus flex/FIFO spot checks.
Commands: Git diff/status/scope checks and static source inspection; `git diff --check` passed. Targeted TypeScript regressions could not run because the read-only sandbox denied `tsx` temporary IPC-directory creation. No browser, live-service, database, or build probes run.
Residual risk: browser concurrency and live authentication/replay behavior remain unverified.
External mutation: no.
