## HIGH — stale account A can replace account B

`AuthProvider` accepts any `SIGNED_IN` event whose bytes currently match local storage, without requiring it to continue the accepted B lineage ([AuthProvider.tsx](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/AuthProvider.tsx:126)). It also ignores non-deletion auth-storage changes ([AuthProvider.tsx](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/AuthProvider.tsx:151)).

Reachable sequence: B has signed in successfully; a stale A tab rewrites the shared auth key, then emits `SIGNED_IN(A)`. The exact-storage check succeeds, clears the block, and calls `applySession(A)`. This can render/resurrect A after B. The regression only exercises stale A as `TOKEN_REFRESHED`, not stale `SIGNED_IN` ([queuedOperationContext.regression.ts](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/queuedOperationContext.regression.ts:715)).

A second ordering gap: the initial restore is gated only by `eventVersion`, but direct local `signOut()` and successful password `signIn()` do not advance it. A pending restore of A can therefore resolve after sign-out and B sign-in, then call `applySession(A)` ([AuthProvider.tsx](C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/auth/AuthProvider.tsx:159)).

Required fix: advance/cancel the restore generation for every local auth action, and accept cross-tab `SIGNED_IN` only through a durable explicit lineage/intent guard that cannot be satisfied by a stale storage rewrite. Add both sequences above as focused regressions.

**NO-GO**

Scope reconciliation: 44 non-audit files, no staged files, HEAD equals base `48aad…2685`, clean `git diff --check`, 18 ordered routes unchanged, and Option 2 SHA-256 matches `D62CF729…EA10D38`. Targeted pure-snapshot guards passed 11/11; credential scan passed 44/0. The focused regression could not run because the read-only sandbox blocks `tsx` temporary IPC creation; browser/Playwright/phone and disposable PostgreSQL lanes were intentionally skipped.

Model/effort: requested `gpt-5.6-terra` Medium, but the runtime did not expose an independently verifiable model/effort label.

LOW follow-up: add an explicit test for non-null auth-storage rewrites, not only deletion.

External mutation: no
