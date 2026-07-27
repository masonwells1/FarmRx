# Farm Rx Sol delta 10 release review

You are the mandatory fresh independent read-only reviewer for an authorized local Farm Rx release candidate. Work only in `C:\FarmRx` on branch `codex/farmrx-release-gate-proof`, with the uncommitted candidate based on `49614e75140fdf4dee94d916e32b386bef922f1a`.

## Boundaries

- Report the exact model and reasoning effort printed by the runtime.
- Do not edit files or Git state. Do not stage, commit, push, deploy, apply migrations to any remote project, change live data, contact providers, or call another model.
- You may inspect the local repository and run local/read-only or disposable verification commands. Do not print secret values.
- Do not read any existing reviewer reports, outputs, orchestration ledgers, command logs, release results, pre-commit decisions, implementation reports, runtime logs, or other prompts. Review code, migrations, tests, and the current diff directly.
- Ignore and preserve the unrelated untracked `docs/audits/2026-07-15-sol-foundation-review/NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md`.

## Release contract

Farm Rx must keep every user and farm's data isolated. A write captures one authenticated user, farm, and server-owned access epoch and must not silently adopt a later session. If identity or access changes during an operation, later remote work, local queue/outbox/cache/receipt changes, and public success must stop. Server-owned scheduled work must remain farm-contained, and privileged functions must expose only their intended role surface.

The candidate claims all prior release blockers are closed, including these most recent three:

1. A direct signed-in User A to User B replacement cannot render Farm A under B. The farm-access shell is remounted per `user.id`, render paths require matching `access.userId`, and a browser regression pauses B access validation while proving A content and controls disappear immediately.
2. `record_marketing_alert_transition` now calls the server-owned user/farm/access-epoch assertion before locking or changing its non-farm-keyed state table. A disposable two-user and stale-epoch drill proves rejection leaves state unchanged.
3. Push-subscription save/delete now require `p_farm_id`, bind the captured expected-user/epoch headers, assert them server-side before mutation, and retire the old unfenced function signatures. Repository and disposable database races prove no cross-user save, transfer, or delete.

Also recheck the earlier repairs: Scouting Storage operation fencing and cleanup ownership/versioning; Grain alert capture and final Edge delivery fencing; Grain delivery/price/offer/bin and Profitability insurance post-acceptance success rejection; queue/cache/revocation isolation; scheduler cancellation and per-farm containment; push retry/terminal health; privileged SQL grants/search paths/RLS; PWA/CSP boundaries; and whether proofs exercise production code.

Inspect every changed and untracked candidate file for P0/P1/P2 correctness defects. Check candidate material for secret-like values without revealing them.

The orchestrator reports a fresh complete local gate passed: forced TypeScript compilation; all 39 regression programs; production build; `npm audit --audit-level=high` with zero vulnerabilities; Deno check for `deliver-grain-alert`; static guards; 7/7 mutation drills; disposable migrations and probes through `0041`; the RLS role matrix; and 32/32 Chromium desktop/phone tests. Independently verify the most relevant evidence rather than merely repeating that claim. Label any command unavailable in the read-only environment as a verification limitation, not a defect.

This is correctness review of the user's own local application, not penetration testing. Keep all work local and read-only except disposable state created by existing repository verification scripts.

## Required final answer

1. Exact model and reasoning effort.
2. `RELEASE CLEARED` only if no P0/P1/P2 defect remains; otherwise `RELEASE BLOCKED`.
3. A closure table for the three recent blockers and the four earlier repair groups, with exact production-code and deterministic-proof references.
4. Any findings ordered by severity, with ID, exact file/line, concrete failure sequence, impact, smallest safe fix, and required proof.
5. Commands actually run and results.
6. Secret-scan result and limitations.

If cleared, say `NO BLOCKING FINDINGS` plainly. If an observation is unproven, label it as a verification limitation rather than a defect.
