# Sol serialized repair: modern PostgREST service-role claims

You are the only source-code writer for this slice. Work in `C:\FarmRx` on branch `codex/farmrx-release-gate-proof` at the current uncommitted state. Use `gpt-5.6-sol` with High effort. Do not call Claude, Fable, or another model.

Read the current requirements, the Phase 1 report at `docs/audits/2026-07-15-sol-foundation-review/next-session-evidence/SOL-IMPLEMENTATION-REPORT.md`, migrations `0035` through `0037`, and their disposable verification scripts.

Confirmed defect: PostgreSQL 17/PostgREST uses JSON `request.jwt.claims`, but the server-owned RPCs check only legacy `request.jwt.claim.role`. The current disposable proof manually sets the legacy setting and therefore masks the deployed failure. Live read-only catalog proof confirms production is PostgreSQL 17.6, has only the 0035 server RPCs, and `service_role` currently has the needed table privileges. Do not query or mutate production.

Implement only this repair slice:

1. Capture a focused before-state proof that JSON-only `request.jwt.claims` cannot pass the current server-role checks.
2. Add a forward migration after `0037`; do not rely on editing an already-applied historical migration to repair production. Make server-role detection compatible with modern JSON claims and, if safely possible, legacy claims as a fallback. Preserve the existing anon/authenticated denial and existing function grants.
3. Update disposable verification so JSON-only service-role claims succeed, authenticated/anon claims fail, and a conflicting legacy setting cannot override the modern JSON claim. Include push claim/finish, Program generation, scheduled sweep, and spray recording as applicable.
4. Keep the migration deterministic and reviewable. Do not use catalog-table updates. Avoid widening public function/table privileges.
5. Run the narrow disposable proofs and `git diff --check`. Do not run live migrations, deploy, commit, push, stage, change secrets/settings, invoke notifications, or alter external services.
6. Update `docs/audits/2026-07-15-sol-foundation-review/next-session-evidence/SOL-IMPLEMENTATION-REPORT.md` with actual model/effort as visible, exact files changed, before-state failure, after-state proof, commands, failures, and residual risk. Do not overwrite it with only a generic summary; retain the useful reconnaissance findings or clearly link/summarize them.

Use `apply_patch` for edits. Stop if the fix would require a production or non-production service mutation.
