# Farm Rx Sol delta 9B release review

You are the mandatory independent read-only reviewer for an authorized local Farm Rx release candidate. Work only in `C:\FarmRx` on branch `codex/farmrx-release-gate-proof`, with the uncommitted candidate based on `49614e75140fdf4dee94d916e32b386bef922f1a`.

## Boundaries

- Report the exact model and reasoning effort printed by the runtime.
- Do not edit files or Git state. Do not stage, commit, push, deploy, apply migrations to any remote project, change live data, contact providers, or call another model.
- You may inspect the local repository and run its existing local/disposable verification commands. Do not print secret values.
- Do not read any existing reviewer reports, outputs, orchestration ledgers, command logs, release results, pre-commit decisions, implementation reports, or other prompts. Review code, migrations, tests, and the current diff directly.
- Ignore and preserve the unrelated untracked `docs/audits/2026-07-15-sol-foundation-review/NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md`.

## Release contract

Farm Rx must keep every user and farm's data isolated. A write captures one authenticated user, farm, and access epoch and must not silently adopt a later session. If that identity or access epoch changes during an operation, later remote work, local queue/outbox/cache/receipt changes, and public success must stop. Server-owned scheduled work must remain farm-contained, and privileged functions must expose only their intended role surface.

The previous repair pass claims these four defects are closed:

1. Scouting photo upload/delete uses one captured context and an operation-specific Storage client with expected-user/epoch headers; an identity or epoch change after the first upload permits no second Storage call, database write, queue/outbox write, or cleanup attribution.
2. Grain alert evaluation captures before loading data, carries the context through transitions and delivery, sends exact headers, and the Edge function confirms owner membership and epoch both at entry and immediately before email delivery.
3. Grain contract delivery, price-leg finalization, firm-offer fill, bin movement, and Profitability insurance reject public success if their original context changed after an accepted server mutation.
4. Scouting cleanup version 2 is partitioned by initiating user and farm; legacy version 1 cleanup is moved to a separate unowned vault and is never attributed to a later user.

Trace those claims through the real call order and their deterministic regressions. Also inspect all changed and untracked candidate files for release-significant correctness defects, especially server-side user/farm/epoch enforcement, privileged SQL function role grants and `search_path`, RLS, queued durability, stale tabs, scheduler cancellation and per-farm containment, push retry/terminal health, PWA/CSP boundaries, and tests that could pass without exercising production code. Check secret-like candidate material without revealing values.

The root reports the current candidate passed forced TypeScript compilation, all regression programs, production build, `npm audit --audit-level=high`, `deno check` for `deliver-grain-alert`, static guards, 4/4 mutation drill, disposable migrations and probes through 0040, the RLS role matrix, and 30 Chromium desktop/phone tests. Verify the most relevant evidence yourself; do not merely repeat this claim.

This is correctness review of the user's own local application, not penetration testing. Keep all work local and read-only except for disposable test state created by existing repository verification scripts.

## Required final answer

1. Exact model and reasoning effort.
2. `RELEASE CLEARED` only if no P0/P1/P2 defect remains; otherwise `RELEASE BLOCKED`.
3. A closure table for the four repaired defects with exact code and proof references.
4. Any new findings ordered by severity, with ID, exact file/line, concrete failure sequence, impact, smallest safe fix, and required proof.
5. Commands actually run and their results.
6. Secret-scan result and limitations.

If cleared, say `NO BLOCKING FINDINGS` plainly. If an observation is unproven, label it as a verification limitation rather than a defect.
