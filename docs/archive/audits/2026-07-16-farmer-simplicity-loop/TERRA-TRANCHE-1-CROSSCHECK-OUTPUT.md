No BLOCKER or HIGH findings.

MEDIUM — Existing signed-in Playwright flows are now broken by unmocked access-profile requests. `FarmAccessGate` always calls `loadFarmAccessProfile` after farm selection ([App.tsx](C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity\src\App.tsx:404)); that function requests two membership tables and six permission RPCs ([farmContext.ts](C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity\src\auth\farmContext.ts:223)). The shared E2E mock only handles the epoch and private-financial RPCs and aborts all other requests ([foundation-shell.spec.ts](C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity\tests\e2e\foundation-shell.spec.ts:69), [foundation-shell.spec.ts](C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity\tests\e2e\foundation-shell.spec.ts:71), [foundation-shell.spec.ts](C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity\tests\e2e\foundation-shell.spec.ts:82)). This prevents the test farmer from reaching Fields after selecting a farm. Correct by extending every signed-in mock fixture to return production-shaped current-user membership/rep rows and capability RPC values, including the account-replacement fixture.

Review outcome: the access-profile derivation cross-checks membership/grant rows against database helper answers, uses epoch/session/farm fences, and fails closed. Fields and Equipment/Tasks snapshots refuse mutation-capable fallback methods, avoid replay/due-task generation/cache writes, fence context changes, and overlay queued entries once. The interface changes remain backward compatible because `getSnapshot` is optional, while pure consumers explicitly reject absent implementations.

Commands run:

- `git status --short`, base diff/stat/file manifest
- Source/interface/caller and migration inspection with `rg`
- `git diff --check` — passed
- Focused regressions and `tsc -b --force` — could not run: the read-only sandbox denies `npx` access and `tsx` temporary-directory creation before tests start.

Residual risk: runtime test execution and full typecheck remain unverified because of sandbox restrictions; the E2E mock regression above needs correction and browser proof.

External mutation status: `no`.
