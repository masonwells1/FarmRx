NO-GO — one HIGH finding.

- **HIGH — a superseded capability profile can replay another account’s queues.** [App.tsx:412](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:412) authorizes the entire sequence with `latestProfile`, but each replay resolves the mutable current account/farm independently. The cancellation check occurs only after every replay finishes at [App.tsx:452](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/App.tsx:452). If account A’s sequence pauses and the SPA switches to read-only account B, the remaining calls can operate on B using A’s edit capability. An in-memory probe reproduced one B writer attempt; the permission failure changed B’s queue bytes and parked its entry. Smallest correction: bind every replay/generation call to `latestProfile.operationContext`, verify that exact context before any writer or queue mutation, cancel between steps when the gate is superseded, and add an A→read-only-B delayed-replay regression requiring zero B writer calls and byte-identical B queues.

The review-5 flex repair is otherwise correct: malformed string/object values and non-null unused percent-of-revenue base/trigger fields reject before writer or queue access; the regression proves writer count and all queue bytes remain unchanged.

- Model/effort: `gpt-5.6-sol`, Extra High
- Scope: exact 20 core + 10 replay-containment files; 29 tracked plus `deviceClockFence.ts`; audit directory excluded
- Option 2: confirmed; declared SHA-256 matches
- Routes: unchanged, 18 base / 18 current
- Rerun PASS: no-emit app TypeScript; standalone E2E TypeScript; Fields, Farm Access, queued-context, and Equipment regressions; static guards 11/11; credential scan 0; `git diff --check`; exact-scope gate
- Additional probe: stale-profile cross-account writer/queue mutation reproduced
- Not rerun: Playwright/browser, full 39-lane suite, emitting production build, dependency audit, or live services
- Residual risk: real-browser behavior and live database/RLS behavior remain unverified
- External mutation: no
