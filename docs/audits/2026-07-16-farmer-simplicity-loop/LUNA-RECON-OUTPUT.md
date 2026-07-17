Model/effort: this surface exposes GPT-5 Codex, high reasoning effort. A separate `gpt-5.6-luna` pin was not independently available to verify.

## Scope status

The approved simplicity layer is not yet mechanically represented:

- No `Today` route, page, read model, or navigation item.
- No `Quick Record` route, launcher, or action registry.
- Setup exists only as `InitialFarmSetup` inside `src/App.tsx`.
- Existing recovery and offline-save infrastructure is substantial.
- Role data exists in module repositories, but navigation is currently static for every role.
- No dedicated React/UI test suite exists.

## Files read

- `CLAUDE.md`
- `docs/audits/2026-07-16-farmer-simplicity-loop/GOAL-AND-LOOP.md`
- `docs/audits/2026-07-16-farmer-simplicity-loop/ORCHESTRATOR-LEDGER.md`
- `docs/audits/2026-07-16-farmer-simplicity-loop/prompts/LUNA-RECON.md`
- `package.json`
- `tsconfig.json`, `tsconfig.app.json`, `vite.config.ts`, `playwright.config.ts`
- `src/App.tsx`
- shared components: `SaveReceipt`, `NeedsAttentionList`, `RevokedFarmRecovery`, `MarketQuote`
- auth files and farm-access logic
- `src/styles/tokens.css`, relevant sections of `src/styles/app.css`
- `tests/e2e/foundation-shell.spec.ts`
- `scripts/verify-foundation.ps1`
- `scripts/foundation-static-guards.mjs`
- `vercel.json`, `.gitignore`
- `docs/farm-rx-handoff.md`
- `docs/onboarding-design.md`
- prior foundation Luna/release evidence

I searched, but did not fully read, all module and regression files.

## Commands run

Read-only commands included:

- `git status --short --branch`
- `git log -1 --oneline`
- `git diff --stat`
- `git ls-files ...`
- `rg --files`
- targeted `rg` searches for routes, forms, roles, accessibility, recovery, and secrets
- `Get-Content` for the files listed above
- directory/file-name scans for environment and credential-like material

No build, test, audit, browser, database, deployment, or mutation command was run.

## Route and component inventory

Current application routes:

- `/login`
- `/fields`
- `/fields/new`
- `/fields/:id`
- `/fields/:id/edit`
- `/grain/*`
- `/inventory`
- `/profitability/*`
- `/equipment`
- `/tasks`
- `/weather`
- `/field-log`
- `/scouting`
- `/harvest`
- `/programs`
- `/notifications`
- wildcard fallback redirects to `/fields`

Desktop navigation is static:

`Fields`, `Grain`, `Inventory`, `Profitability`, `Equipment`, `Tasks`, `Weather`, `Field Log`, `Scouting`, `Harvest`, `Programs`, `Alerts`.

Mobile primary navigation is currently:

`Fields`, `Grain`, `Tasks`, `Weather`, `More`.

Mobile “More” contains the remaining destinations.

Relevant existing components:

- `InitialFarmSetup` — farm name, operating name, entity type.
- `FarmAccessGate` — session/access/setup/blocked state machine.
- `RequireSession` — expired-session recovery and safe return path.
- `SyncNotice` — synced, pending, syncing, and blocked save states.
- `OfflineDataNotice` — cached offline-work warning.
- `NeedsAttentionList` — retry/dismiss workflow for parked saves.
- `RevokedFarmRecovery` — exportable quarantined work after access removal.
- `SaveReceipt` — saving, saved, queued-offline, and needs-attention receipt states.
- `Navigation` and `MobileNavigation` — current static route presentation.

Existing form-heavy modules include Fields, Grain, Inventory, Profitability, Equipment, Tasks, Weather, Field Log, Scouting, Harvest, Programs, and Notifications.

Role enforcement is distributed through repositories and modules using `owner`, `manager`, `worker`, and `read_only`. It is not yet centralized into role-shaped navigation.

## Tests that can be extended

Best existing extension point:

- `tests/e2e/foundation-shell.spec.ts`
  - already mocks Supabase safely;
  - runs desktop and Pixel 5 projects;
  - covers login, PWA shell, phone overflow, multi-farm selection, offline work, sign-out, revoked work, stale sessions, security headers, and mobile navigation.

Useful regression extension points:

- `src/data/saveDurability.regression.ts`
- `src/data/submitLock.regression.ts`
- `src/data/revokedFarmRecovery.regression.ts`
- `src/auth/farmContext.regression.ts`
- repository regressions covering role and offline behavior
- `scripts/foundation-static-guards.mjs`

Exact missing test cases:

1. `/` and unknown routes land on `Today`, not `/fields`.
2. Today renders its primary status, one primary action region, and recovery/help state.
3. Every approved common action is reachable from Today within two taps.
4. Quick Record opens and exposes only approved existing workflows.
5. Quick Record preserves the selected farm and does not cross farm scope.
6. Quick Record double-submit creates one operation.
7. Quick Record offline save shows the queued/offline receipt.
8. Failed replay produces `Needs attention`, with retry and dismiss behavior.
9. Today works with zero fields, no tasks, stale data, pending saves, and blocked saves.
10. Setup checklist shows incomplete/complete states and survives reload.
11. Setup never exposes another farm’s checklist or cached data.
12. `owner`, `manager`, `worker`, and `read_only` receive the intended navigation.
13. Read-only users cannot see or activate write actions.
14. Role changes during loading fail closed.
15. Expired sessions return safely to the requested path.
16. Revoked-farm work remains quarantined and is never replayed automatically.
17. Login, Today, Quick Record, setup, and representative forms have no horizontal overflow at 390px.
18. Main controls meet 48px computed dimensions.
19. Keyboard navigation reaches all primary controls in logical order.
20. Active navigation exposes `aria-current`.
21. Forms expose accessible names and error associations.
22. Status and alert messages are announced without duplicate or stale announcements.
23. Mobile More menu opens, closes, and returns focus predictably.
24. No external network request occurs on login and no unapproved request occurs in mocked Today flows.

## Accessibility and responsive CI checks

Deterministic checks should include:

- desktop and 390px phone browser projects;
- document horizontal-overflow assertion;
- computed width/height assertions for buttons, inputs, selects, textareas, and primary links;
- accessible-name checks for every interactive control;
- heading presence and one primary heading per route;
- `aria-current="page"` on active navigation;
- `role="status"` for successful/offline saves;
- `role="alert"` for blocked/error states;
- keyboard Tab traversal and visible focus assertions;
- mobile More menu `aria-expanded`, `aria-controls`, and focus return;
- form invalid-state and error-message checks;
- reduced-motion check for critical task animation;
- no live Supabase requests in mocked UI tests.

Current CSS already enforces 18px body text, tabular numbers, and 48px controls. Gaps include:

- global focus styling covers buttons, links, and inputs, but not selects and textareas;
- many links do not have an explicit 48px minimum target;
- no automated accessible-name or keyboard-order enforcement exists;
- no Today/Quick Record responsive proof exists.

## Proposed changed-file budget

Recommended maximum:

- 2–3 route/navigation files
- 3–5 new Today, Quick Record, and setup/checklist components
- 1–3 shared form/progressive-disclosure components
- 1–3 scoped data/read-model files
- 1 shared stylesheet plus narrowly scoped module styles
- 1 existing E2E spec, or one new simplicity E2E spec
- 2–4 focused regression/static-proof files
- 1 durable evidence artifact

Target: 14–20 tracked files total.

Do not add migrations, provisioning changes, new modules, new external services, or broad redesign work unless Sol proves an existing contract cannot support the approved scope.

## Scope-drift warnings

- Do not turn Quick Record into a new data-entry system; it should launch existing canonical workflows.
- Do not replace existing RLS or farm-access fencing with client-only role checks.
- Do not broaden setup into account administration or employee provisioning.
- Do not add new farm modules, integrations, reporting, or notification products.
- Do not weaken offline quarantine, save receipts, retry, or stale-session behavior.
- Do not make financial or grain data more visible than current privacy rules permit.
- Do not change production, migrations, deployment, or customer-facing external state.

## Secret and environment scan

No values are reproduced here.

- `src/lib/supabaseConfig.ts`: public browser Supabase project identifier, URL, and publishable browser credential. Expected public category; must not contain service-role material.
- `scripts/provision-customer.mjs`: service-role provisioning path. Risk category is environment-held admin credential; must remain environment-only.
- `docs/onboarding-design.md`: discusses service-role usage and environment variables; documentation only.
- Supabase Edge Functions and migration scripts: environment/configuration references for server-side credentials and JWT/service-role behavior.
- E2E and regression files: fake tokens, UUIDs, and test credentials used as fixtures.
- `.env*`: ignored by `.gitignore`; no tracked environment file was found.
- `src/styles/tokens.css`: false-positive filename match from the word “tokens”; it contains visual design variables, not credentials.

## Evidence checklist

A complete implementation packet should contain:

- exact base SHA and branch;
- changed-file list and budget result;
- route/component coverage matrix;
- Today and Quick Record two-tap map;
- role/navigation matrix;
- setup checklist state matrix;
- form progressive-disclosure matrix;
- offline/save/retry/recovery proof;
- desktop and phone browser results;
- accessibility assertion results;
- TypeScript, regression, build, audit, foundation, and E2E outputs;
- secret/scope scan result;
- adversarial findings with ID, severity, evidence, owner, disposition, and re-test;
- `git diff --check`;
- confirmation that no migration, deployment, push, merge, or external mutation occurred.

Commands requiring caution:

- `npx tsc --noEmit` is vacuous here because the root `tsconfig.json` has `files: []`; use `npx tsc -b --force`.
- `npm run regression` does not test React rendering or browser behavior.
- `npm run build` proves compilation/bundling only, not route usability.
- `npm audit` proves dependency findings only.
- static guards can pass through string presence without proving runtime behavior.
- mocked Playwright tests do not prove live Supabase RLS or deployed headers.
- PWA shell tests prove cached navigation, not durable Today/Quick Record data behavior.
- a passing aggregate harness can hide a lane failure unless each subprocess exit code is checked; the current foundation runner has explicit native exit checks and a controlled failure probe.

## Mutation statement

No filesystem, ref, service, database, deployment, external system, or other mutation occurred. The pre-existing untracked simplicity-loop evidence directory was preserved unchanged.
