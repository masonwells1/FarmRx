# Farm Rx independent Sol delta-12B release quality review

Report the actual model and reasoning effort first. Work read-only in `C:\FarmRx`. Do not edit files, Git state, or external services. Do not call other models. Exclude the unrelated untracked `docs/audits/2026-07-15-sol-foundation-review/NEXT-SESSION-SOL-TERRA-LUNA-LOOP.md` from candidate scope.

Independently review the current candidate working tree from base/HEAD `49614e75140fdf4dee94d916e32b386bef922f1a`. Use `docs/GOAL.md`, `docs/farm-rx-handoff.md`, and `docs/audits/2026-07-15-sol-foundation-review/REPAIR-ROADMAP.md` as requirements. Inspect implementation and tests directly; do not rely on previous reviewer conclusions.

Primary delta to verify:

- A notification path `/..//off-origin.invalid` previously normalized to `//off-origin.invalid`. Reopening the returned value selected another origin.
- `src/data/notificationLink.ts` now validates the normalized return value, rejects a leading double slash, and reparses the exact return value to require the application origin.
- `src/data/notificationLink.regression.ts` includes the failing value and a legitimate dot-segment path.

Check the exact returned value for ordinary application routes, queries, fragments, dot segments, encoded characters, extra slashes, backslashes, control characters, explicit ports, and malformed values. Trace the service worker from push payload to stored notification data to `clients.navigate` or `clients.openWindow`. Confirm every value on that path passes through the helper and legitimate Farm Rx routes remain usable.

Also inspect these current release closures for ordinary correctness and account/farm isolation:

1. a push endpoint already owned by one account cannot be reassigned by another account and its pending delivery target remains intact;
2. a queued cached read started by User A cannot return User B data or write User B data into User A cache after an account change;
3. same-account, same-farm revoke/regrant recovery remains possible without permitting cross-account retry;
4. database writes remain bound to the captured user, farm, and access generation;
5. tests exercise production repository, database, service-worker, and browser paths rather than only helper copies.

Post-delta authoritative verification completed with exit code 0:

- all 39 regression programs;
- production build;
- dependency audit with zero high-severity findings;
- static guards;
- all 9 controlled mutation checks;
- disposable migration suites through 0041;
- RLS role matrix;
- 32/32 Playwright checks across desktop and phone;
- final line `Farm Rx foundation gate: PASS`.

Return a concise report with model/effort, files and commands, the notification-link case matrix, a five-row closure table, any P0/P1/P2 issue with exact file/line and required correction, limitations, files changed (must be none), and external changes (must be none). Use exactly `RELEASE CLEARED` only if no P0/P1/P2 remains; otherwise use `RELEASE BLOCKED`. If cleared, also say `NO BLOCKING FINDINGS`.
