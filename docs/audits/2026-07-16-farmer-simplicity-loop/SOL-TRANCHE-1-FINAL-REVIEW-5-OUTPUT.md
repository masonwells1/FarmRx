NO-GO — one HIGH finding.

- HIGH — percent-of-revenue flex validation accepts malformed known fields. [flexLeaseValidation.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/flexLeaseValidation.ts:16) does not validate `base_rent_per_acre` or `trigger_revenue_per_acre` unless the method is `base_plus_bonus`. Consequently, [SupabaseFieldsRepository.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/SupabaseFieldsRepository.ts:163) copies invalid values into the online request, while [writeQueue.ts](/C:/Users/mason/.codex/worktrees/farmrx-farmer-simplicity/src/data/writeQueue.ts:37) accepts them into durable offline storage. An inline probe proved that `"bad"` and `{bad:true}` survive normalization and queue parsing. Smallest correction: validate these two fields as finite nonnegative numbers or null for every structured method—preferably require null when unused by `pct_of_revenue`—and add online/offline rejection regressions proving no writer call or queue-byte change.

Everything else reviewed clean: access-profile publication fencing, awaited centralized replay including initial setup and due generation, restricted-role preservation, pure snapshots/clock fence, Equipment FIFO rebasing and link/delete semantics, strict mocks, exact echoes, Option 2 hash, and unchanged routes.

- Model/effort: `gpt-5.6-sol`, Extra High
- Scope: exact 20 core + 10 replay-containment files; audit directory evidence-only
- Routes: 18 base / 18 current, no differences
- Option 2: selected; declared SHA-256 matches
- Proof rerun: app and standalone E2E TypeScript PASS; four focused regressions PASS; static guards 11/11; credential scan 0 findings; `git diff --check` and exact-scope gate PASS
- Additional probe: malformed structured-flex online/queue ingress reproduced
- Not rerun: all 39 lanes, production build, dependency audit, browser/Playwright, or live services
- Residual risk: browser behavior and live database/service behavior remain unverified
- External mutation: no
