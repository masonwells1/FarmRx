# TASK — Fix grain live swap per review (Terra, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; never present a plan and wait — task failure.
PRE-APPROVED. Modify src/** and supabase/functions/** only. Do NOT touch
supabase/migrations/** (another agent is fixing 0012 in parallel). No DB ops, no git.

Fix ALL findings from **docs/review-grain-live.md** (read it; numbering matches).
Authoritative spec stays docs/grain-live-design.md.

P1s:
1. RPC payload: send COMPLETE normalized target rows including farm_id (the RPC validates
   it equals p_farm_id); omit only client timestamps. Contract confirmed with the SQL agent.
3. grainWriteQueue parser: split scope-field validation from exact-object validation so all
   four entry kinds round-trip; validate entries BEFORE writing; prove all kinds round-trip
   in regression.
4. Canonical confirmation: single-row saves require returned ID + full scope to match the
   submitted row; plan replacement requires exact final ID/month/count equality vs the
   submitted desired state before resolving or removing queued work.
5. Global sync status: aggregate per-module (fields + grain) states and retry actions;
   "All changes synced" ONLY when both queues are empty; "Try again" retries both.
6. 0008-denied users: explicit permission probe (can_read_private_financials RPC exists and
   is executable by authenticated); when denied show calm farmer-English "Grain records are
   private on this farm..." instead of the add-a-crop empty state.
7. First-estimate path: when live crop assignments exist but no production estimates, show
   the design's first-estimate editor (create estimates from live crop assignments) instead
   of pointing at Fields.
8. USDA display-only boundary: MARS-sourced cash-bid rows NEVER feed latestBasis()/position/
   revenue math — separate manual bids from feed observations; MARS stays in history display
   + alert evaluation only (per design).
9. Enterprise scoping: reconciliation must filter enterprise_label exactly; reject (fail
   closed with farmer-English error) non-null enterprise production scopes if no
   authoritative mapping exists.

P2s:
10. Write supabase/functions/deliver-grain-alert/index.ts per the design: verifies the
    caller is the farm owner (server-side), re-reads canonical data, fixed recipient
    (owner's auth email), sanitized content, deterministic-key throttling, logs failures.
    Client: serialize in-flight keys, surface delivery failure calmly (no silent loss).
    (Deployment happens later by the orchestrator — just write the function.)
11. Strict date/timestamp validation (round-trip calendar check; exact ISO shape).
12. MARS staleness: show "Basis feed unavailable — last updated …" when observations are
    older than the design's threshold; never invent dates.
13. Regression suite: actually implement the design's 15 network-free checks — construct
    QueuedGrainRepository + GrainWriteQueue, FIFO replay, all entry kinds, cross-tab lock,
    context isolation, overlays, canonical confirmation, old-key isolation, blocked
    classification, privacy denial, unknown-commit replay.
14. Percentage tolerance exactly 100.000001 shared in one constant.

Proof required (run, paste real output): `npm run build` clean · `npx tsc --noEmit` clean ·
`npm run regression` all suites pass.
FINAL message: numbered fixes, proof output, deviations if any.
