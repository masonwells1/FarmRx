# TASK — FOUNDATION BLOCK adversarial review (Sol, read-only)

You are reviewing another agent's implementation of the Farm Rx FOUNDATION BLOCK against the
authoritative spec **docs/foundation-design.md**. Be adversarial: your job is to find what is
wrong, unsafe, or dishonest — not to summarize. Read code, do not run it (read-only sandbox).

## Scope (uncommitted changes in this repo)
- New: src/auth/** , src/lib/** (supabaseConfig, supabaseClient), src/data/FieldsDataGateway.ts,
  SupabaseFieldsDataGateway.ts, SupabaseFieldsRepository.ts, QueuedFieldsRepository.ts,
  writeQueue.ts, syncStatus.ts, backends.ts, SupabaseFieldsRepository.regression.ts
- Modified: src/App.tsx, src/main.tsx, src/data/index.ts, src/data/MockGrainRepository.ts,
  src/styles/app.css, package.json
- Migration drafts (static SQL review): supabase/migrations/0008_employee_privacy.sql,
  0009_fields_live_support.sql — check each against docs/foundation-design.md and against
  the applied baseline 0001–0003 (0008 additionally against drafts 0004–0007 it amends).

## Hunt specifically for
1. **Fail-open paths**: any way a save reports Saved/Synced without the required confirmation;
   any fallback from live to mock/seed data on error; any catch that swallows.
2. **Queue integrity**: durable write-then-read-back verification actually byte-compares;
   FIFO replay reuses original operation IDs; head removed only after canonical result AND
   durable shortened queue; corrupt/unknown-version queue fails closed; cross-user isolation
   (user A cannot see/replay user B's queue); multi-tab double-replay.
3. **Auth**: session restore race (login flash), sign-out state ordering, token expiry path,
   password/token logging, bootstrap flow creating duplicate farms on retry, redirect
   open-redirect risk (remembered path must be internal-only).
4. **Wrong-backend risk**: can grain ever reach Supabase? can fields ever silently fall back
   to mock? project hostname assertion present? backends manifest regression present?
5. **Contract drift**: SupabaseFieldsRepository vs the RPC contract in 0009 (field names,
   normalization, null vs '' vs 0, numeric string conversion, flex formula shape {type,
   trigger, bonus_rate} round-tripped UNTRANSLATED); strict mapper rejects unknown enums/
   non-finite numbers; empty crop array = no change.
6. **Migration drafts**: 0009 — injection surface in jsonb handling, privilege escalation,
   cross-farm references, replay/receipt races, partial-commit windows, anything that would
   break when applied right after 0003. 0008 — policy alters that reference the correct
   policies from 0004–0007, no accidental broadening, rep two-part rule intact, self-grant
   impossible.
7. **UI honesty + brand**: sync notice wording matches design exactly; pending never shown
   as synced; ≥18px text, ≥48px targets on new controls; farmer-English errors (no raw
   Supabase text); no medical metaphors.
8. **Regression suite honesty**: do the 15 checks actually assert what the design lists, or
   do any assert trivial truths / test the fake instead of the contract?

## Output format (FINAL message = ONLY this markdown document)
## Findings
Numbered list. Each: **P1**/**P2** — one-line title, file:line, what breaks, concrete fix.
Then a short paragraph on anything verified clean that matters.
VERDICT: COMMIT-READY or NEEDS FIXES (n P1)
