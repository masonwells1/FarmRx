# TASK — Fix foundation app code per review findings (Terra, workspace-write)

PRE-APPROVED: modify src/** (and package.json if needed). Do NOT touch supabase/migrations/**
(another agent is fixing 0009 in parallel), do NOT use git, no database operations.

Fix ALL findings below from docs/review-foundation.md (full text there — read it first,
then docs/foundation-design.md for the authoritative behaviors). Numbering matches the review.

1. **P1 — queue overtaking**: saveField must serialize per user/farm: if the queue is
   nonempty, the new save appends BEHIND the tail and the whole queue replays FIFO; never
   publish synced while entries remain. No online save may jump ahead of older queued saves.
2. **P1 — multi-tab queue integrity**: protect append/remove/replay ALL under the same Web
   Lock (navigator.locks) with a renewable, ownership-verified localStorage lease fallback
   (renew well inside its TTL; verify ownership before every mutation). Add regression
   coverage simulating two concurrent writers.
3. (SQL agent's finding — but match the contract) The RPC draft contract now requires each
   crop assignment to carry `"is_new": true|false`. Set it correctly in the repository
   mapping (existing IDs from loaded data → false; client-generated new rows → true).
4. **P1 — bootstrap idempotency**: replace the client-side farm/entity inserts in
   src/auth/bootstrapFarm.ts with ONE call to the new RPC
   `public.bootstrap_first_farm(p_farm_name text, p_entity_name text, p_entity_type text)
   returns jsonb {farm, entity}` — idempotent server-side (safe under double-tap/two tabs).
   Handle its errors with farmer-English messages. Remove the resumable two-step flow.
5. **P1 — regression suite is toothless**: rewrite the weak checks into stateful contract
   tests against a stateful fake gateway + real storage fake: preserved-ID via full
   round-trip; arrangement history (same-date in-place / later-date close+insert / earlier-
   date reject) verified against fake DB state; multi-table failure mutates nothing (fake
   mutates then rolls back — assert state unchanged); storage-full + corrupt + read-back-
   mismatch cases; replay failure retains head; lost-response replay yields no duplicates
   (receipt path); cross-user queue isolation with an actual second user's queue present;
   Grain SAVE executed and asserted not to touch Fields; two-writer race test from fix 2.
6. **P2 — transport classifier**: classify Supabase error-shaped objects (message/status/
   code on plain objects, cause chains), centrally; unknown shapes default to transport
   (queue) ONLY when the design says ambiguous-commit, otherwise definite rejection — follow
   the design's table strictly.
7. **P2 — offline reads**: getData() returns the last successfully loaded workspace with
   queued bundles overlaid COMPLETELY (field + arrangement + crop assignments) when live
   refresh is unavailable, with the design's offline message; cold start with no cached
   workspace shows the design's "Connect to load your farm." state instead of a crash.
8. **P2 — replay triggers**: also inspect/replay the queue right after sign-in + farm
   resolution; recompute status on user change; never start as synced when a queue exists.
9. **P2 — auth restore race**: version/token-guard the getSession() restore so it can never
   overwrite a newer onAuthStateChange event.
10. **P2 — strict queue validation**: validate the full envelope + FieldDraft schema
    (types, UUIDs, dates, no unknown envelope versions) before accepting or mutating.
11. **P2 — raw errors in UI**: map every repository/auth failure surfaced in
    src/FieldsModule.tsx (and any other UI) through a fixed farmer-English taxonomy;
    never render Error.message verbatim.
12. **P2 — hardcoded farm name**: sidebar/header farm identity comes from the resolved
    farm (or is omitted while loading); remove "Wells Farm Group" from the live shell.

## Constraints
- Fields UI repository usage unchanged; brand rules (≥18px, ≥48px, tabular-nums, plain
  English) on anything you touch; fail-closed everywhere; Grain stays mock.
- Dev server may be running; do not start/stop servers.

## Proof required (run, paste real output):
`npm run build` clean · `npx tsc --noEmit` clean · `npm run regression` all suites pass.
FINAL message: fixes made (numbered to match), proof output, deviations if any.
