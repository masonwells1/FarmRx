# CLAUDE.md — Farm Rx router

## Sources of truth

1. Read `docs/farm-rx-handoff.md` for enduring Farm Rx product, privacy, farmer-usability, brand, and architecture rules.
2. Read `docs/GOAL.md` for Mason's current 2027 directive, scope, capability truth, carried gates, and canonical statuses.
3. Execute scenarios from `docs/season-readiness/WORKFLOWS-AND-SCENARIOS.md` under `docs/season-readiness/ORCHESTRATOR-RUNBOOK.md`.
4. Append exact state and evidence to `docs/season-readiness/LEDGER.md`; never rewrite earlier entries.

Mason directed on 2026-07-18 that no real farmer will use Farm Rx until 2027. This changes timing but does not deny prior commit, merge, deployment, migration, or production-verification history.

## Initiative rules

- Sol is the orchestrator. Use bounded Sol/Terra workers; use Luna only if actually available and recorded. Workers do not recursively delegate.
- Work one bounded tranche and one immutable commit at a time. Fresh-context, read-only Sol reviews every exact commit. Repairs are new commits and receive new reviews.
- Build on the completed Farmer Simplicity layer and existing modules. No standalone modules, vendors, broad redesigns, speculative features, or proof-only `run_id` product column.
- Missing integrations are negative assertions/out of scope unless an approved scenario reveals a defect in existing behavior.
- Season proof uses synthetic fixtures, a fixed `America/Chicago` 2027 clock, deterministic external UUIDs, and a disposable local backend—not live services or customer data.
- `C:\CRX_Manager` is read-only reference material and must not be modified from Farm Rx work.

## Production and approval boundary

Farm Rx production is `https://farm-rx.vercel.app`. GitHub `main` is linked to Vercel, so a merge or push to `main` is production-coupled.

Never infer approval from silence or label work “pre-approved.” Get Mason's explicit approval before push, pull-request mutation, main/production push, merge, deploy, live migration/data, secrets/auth/permissions, customer accounts, customer communication, or destructive actions. Local build/test/commit approval does not authorize an outward action.

## Local verification

- Forced TypeScript: `npx tsc -b --force` (plain root `tsc --noEmit` is not sufficient here).
- Use the current repository scripts only after inspecting `package.json`.
- “Done” requires the exact UI/local-database behavior and expected non-writes, not only green unit tests.
