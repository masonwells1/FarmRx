# Farm Rx agent development guide

Read this for implementation, debugging, review, or verification. `AGENTS.md` remains the short shared contract; this guide carries project detail that agents need only while changing Farm Rx.

## Start from current truth

1. Inspect `git status --short --branch` before writing. Fetch and compare with `origin/main` before trusting a long-running checkout.
2. Read `docs/GOAL.md`, then the smallest relevant section of `docs/farm-rx-handoff.md` and current source.
3. Check `docs/README.md` before treating an older audit, handoff, or branch record as current.
4. Use a clean current-base worktree for multi-file or risky work. Preserve unrelated changes and keep one writer per checkout.

Current code, migrations, executable tests, current grants, and fresh read-only evidence beat prose. Documentation explains intent; it does not prove behavior.

## Keep the implementation simple

- Solve the requested problem completely with the fewest moving parts that remain easy to read and test.
- Prefer existing repositories, components, helpers, types, and naming. Add an abstraction only when it removes real repeated complexity now.
- Keep changes focused. Do not mix feature work with unrelated cleanup, dependency churn, formatting sweeps, or speculative future support.
- Avoid clever compression. Use explicit control flow, small functions, descriptive names, and plain error states.
- Remove dead paths made obsolete by the change, but do not widen the task into a broad rewrite.
- Comments should explain a business invariant or non-obvious reason, not translate straightforward code.
- Never hide uncertainty with a type escape, swallowed error, fake success state, or test that only proves its own mock.

## Farm Rx invariants

### Farmer experience

- Design for a farmer using a phone in poor connectivity. Keep required text at least 16px, use an 18px base, keep tap targets at least 48px, and keep common actions within two taps.
- Use plain agricultural language, visible save/recovery status, and clear next actions. Follow `docs/design/README.md`; do not create a parallel design system.
- Build on the existing modules and navigation. A missing integration is out of scope unless the requested flow or an accepted scenario proves it is needed.

### Privacy and data

- Farm and financial records are private by default. Every database path must enforce farm access with Row Level Security or an equally strong server-side check; UI hiding is not security.
- Farm Rx uses its own Supabase project. Never point Farm Rx code, scripts, or migrations at the CRX Manager database.
- New tables need RLS and policies in the same new migration. Never edit an applied migration.
- `SECURITY DEFINER` functions require a safe fixed `search_path`, deliberate grants, and proof that callers cannot cross farm boundaries.
- Service-role credentials stay server-side and all secrets come from the environment. Never log or return them.

### Domain and arithmetic

- Model crop assignments as rows keyed by field, crop year, and crop so double-crop acres remain representable.
- Keep white corn, non-GMO corn, yellow corn, and other marketable commodities distinct.
- Preserve projected and actual production separately; never overwrite `expected_bushels` with `actual_bushels`.
- Store and calculate money with defined precision, normally integer cents. Never introduce floating-point money arithmetic.
- Inventory, grain, and financial invariants require database or repository enforcement and focused regression proof, not UI-only checks.

### Offline and mutation safety

- A save must never claim success until its durable result is known. Preserve the existing saving, saved, queued-offline, confirmation-needed, and needs-attention distinctions.
- Offline queues must remain scoped to the project, user, farm, and operation. Replays must be idempotent and must fail closed after access changes.
- Treat lost responses, retries, account or farm switches, revocation, reconnects, and local persistence failures as normal test cases for changed mutation paths.
- Never use live customer records as fixtures. Season scenarios use the synthetic clock, deterministic identifiers, and disposable services defined by the season runbook.

## Verification ladder

Proof must exercise the changed behavior and its important non-writes.

1. Run the narrowest existing regression or focused check that reaches the changed path.
2. For TypeScript work, run `npx tsc -b --force`; plain root `tsc --noEmit` is not sufficient in this repository.
3. Run `npm run build` for shared frontend, routing, configuration, or release-facing changes.
4. Run `npm run regression` when shared data, queues, auth, money, grain, inventory, or repository behavior could be affected.
5. Run `npm run verify:foundation` for the full local foundation gate when risk and environment support justify it. Use `npm run verify:season` only for the accepted season-readiness packet.
6. Open or render changed UI flows and inspect the result, responsive behavior, save state, and console. Tests alone are not UI proof.

If a check cannot run, say exactly what is unverified, why, the risk, and the safest next step. A failing command is a lead to investigate, not a reason to silently stop.

## Documentation

- Update the closest durable guide when behavior or an enduring rule changes. Link to one canonical explanation instead of copying it across agent files.
- Append season execution evidence only to `docs/season-readiness/LEDGER.md`; never rewrite earlier entries.
- Put dated snapshots in an explicitly dated file and reverify them before later use.
- If the change is ready to leave the local checkout, switch to `docs/agent-delivery.md`.
