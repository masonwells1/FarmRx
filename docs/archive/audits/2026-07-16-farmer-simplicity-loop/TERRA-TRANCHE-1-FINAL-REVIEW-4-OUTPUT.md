BLOCK — one high-severity release-gate finding.

- High — access profile becomes visible before its final fence verification completes. [farmContext.ts](C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity\src\auth\farmContext.ts:335) writes the published profile, then [line 337](C:\Users\mason\.codex\worktrees\farmrx-farmer-simplicity\src\auth\farmContext.ts:337) performs another fence check. A concurrent account/farm/epoch fence change in that interval can expose the profile to another context before the catch removes it. Move every final verification before `setItem`; do not perform a post-publication authorization check.

Model/effort: gpt-5.6-terra, Medium.

Scope: reconciled 29 tracked changes plus new `deviceClockFence.ts` = exact 30 scoped code/test files; audit directory treated as evidence-only. Option 2 remains selected; no route/feature addition found. Static review found no generic Supabase GET mock fallback or credential exposure (E2E values are test fixtures).

Commands run: `git status`, `git diff --check`, scoped diffs/searches, scope/secret scans. Focused regressions and TypeScript could not execute because the read-only sandbox blocks Node/tsx temporary-file creation; reported passes remain unverified here.

Residual risk: browser/E2E and live-service behavior intentionally untested. External mutation: no.
