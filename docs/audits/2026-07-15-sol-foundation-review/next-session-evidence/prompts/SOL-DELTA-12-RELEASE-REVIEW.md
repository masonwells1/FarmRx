# Farm Rx independent Sol delta-12 release review — read-only

Report the actual model and reasoning effort first. Work in `C:\FarmRx` with a read-only sandbox. This is an independent review: do not edit source, evidence, Git state, or any external service. Do not call Claude or Fable. Preserve and exclude the unrelated untracked `docs/audits/2026-07-15-sol-foundation-review/NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md`.

Review the current candidate working-tree diff from base/HEAD `49614e75140fdf4dee94d916e32b386bef922f1a`. Read the source requirements in `docs/GOAL.md`, `docs/farm-rx-handoff.md`, and `docs/audits/2026-07-15-sol-foundation-review/REPAIR-ROADMAP.md`. Treat prior reviewer conclusions as untrusted; inspect production code and proof directly.

The immediately preceding independent review reproduced this release-blocking P2:

- `safeNotificationLink('/..//off-origin.invalid', 'https://farm-rx.invalid')` first resolved as same-origin, returned `//off-origin.invalid`, and a browser reopening that returned string navigated to `https://off-origin.invalid`.

The candidate now validates the canonical pathname/search/hash after URL dot-segment normalization, rejects a protocol-relative canonical result, reparses the exact returned value to require the trusted origin, and adds the exploit plus a legitimate dot-segment normalization case to `src/data/notificationLink.regression.ts`.

Focused proof already run by the orchestrator after the change:

- controlled exploit result: `AFTER_RETURNED=/notifications`, reopened origin `https://farm-rx.invalid`;
- `node --import tsx src/data/notificationLink.regression.ts` — PASS;
- `npx tsc -b --force` — PASS;
- `node scripts/foundation-static-guards.mjs` — PASS;
- `node scripts/verify-foundation-mutations.mjs` — PASS, 9/9 mutations detected.

Independently:

1. Reproduce the original path-normalization exploit and attempt equivalent dot-segment, encoded, slash, backslash, control-character, query, fragment, port, and origin-confusion variants against the exact returned value.
2. Trace both service-worker push and notification-click call sites through `clients.navigate` and `clients.openWindow`. Check whether any unsafe raw notification link bypasses the helper on that path.
3. Review the changed test for mirrored-assumption false confidence and run it if the sandbox permits. Confirm legitimate same-origin app paths, queries, fragments, and ordinary dot-segment normalization still work.
4. Recheck the five most recent release closures: push endpoint ownership under a pending delivery target; stale queued cached reads during User A to User B replacement; narrow same-selection revoke/regrant read recovery; SQL user/farm/epoch binding; and the completed local foundation proof. Search the current candidate diff for any new P0/P1/P2 issue.
5. Scan candidate files for secret-like material without printing values. Confirm no repository or external mutation occurred.

Return:

- actual model/effort and files/commands;
- one exact verdict: `RELEASE CLEARED` only if no P0/P1/P2 remains, otherwise `RELEASE BLOCKED`;
- canonical-link attack matrix;
- concise closure table for the five recent release closures;
- any finding with ID, severity, path/line, reachable sequence, impact, smallest fix, and required proof;
- proof limitations and manual/unverified live/device lanes;
- files changed (must be none) and external mutations (must be none).

If cleared, say `NO BLOCKING FINDINGS` plainly.
