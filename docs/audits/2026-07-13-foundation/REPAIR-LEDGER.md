# Foundation Repair Ledger

Started 2026-07-13, Mason-approved ("start repair"). Source of truth for the repair pass.
Findings referenced by ID from `FOUNDATION-AUDIT.md` in this directory.

## Loop pattern (per round)
Terra builds (codex exec, CRITICAL EXECUTION RULE, absolute paths, `< /dev/null`) →
Claude gates (`npx tsc -b --force`, `npm run regression`, `npm run build`) →
Sol adversarial review (report-only) → fix round if needed → Claude browser-proof →
local commit. **Hard stops: NO git push, NO migration applied to the farm-rx Supabase
project, NO deploy — each needs Mason's explicit OK. Draft migrations go to
`supabase/migrations/` uncommitted-to-DB and get queued below.**

## Rounds

- [x] **Round 1 — Duplicate-write locks** (P0-01) — DONE 2026-07-13. Shared
  `createSubmitLock()`/`createSubmitLockMap()` in `src/lib/submitLock.ts`, applied across
  all 13 module files + App.tsx (sign-in/sign-out/queue-retry); per-record keyed locks
  where one lock would wrongly block unrelated records; Profitability `save()` returns
  success boolean before any follow-up runs; regression wired into `npm run regression`.
  Terra needed 2 passes (first stopped at 7/13 files) + a Sol FIXES-REQUIRED review
  (2 P1, 2 P2, 1 P3 — all fixed) + micro-round r1d for R1-LIVE-01. LIVE EVIDENCE:
  FieldLog triple-requestSubmit → exactly 1 DB row (SQL-verified) then UI double-click
  delete → 0 rows; Tasks triple-submit → 1 row, keyed-lock UI delete → 0 rows; Count
  Adjustment (fixed three layers: date validation, missing created_by vs RLS, timestamptz
  echo + a 4th: stale `event.currentTarget.reset()` after await faking a failure) now
  saves with success message + in-place history update, triple-submit → 1 row,
  created_by = signed-in user, verified by direct SQL; all test rows cleaned (0 remain).
  Gates on final code: tsc PASS, 24/24 regression suites PASS, build PASS.
- [x] **Round 2a — Fields draft lifecycle** (P0-02) — DONE 2026-07-13. Fresh-draft-on-open
  for Basics/Yield&Price/Records (AgreementCard pattern everywhere); new focused-patch
  serializer `src/data/fieldEditPatch.ts` so a card save can't clobber sibling-card
  fields; Sol FIXES-REQUIRED review (stale-cache base after failed refresh, offline
  agreement overlay revert, false-failure duplicate-field bait, decorative regression)
  — all 4 fixed: canonical-base guard ("reload to continue"), cache updated from save
  receipt, offline overlay closes prior arrangement like the RPC, confirmed-write vs
  reload-failure separated, regression rewritten to exercise the queued repo with
  stale-refresh + offline Agreement→Basics scenarios. LIVE EVIDENCE: cancel/reopen shows
  true saved value (junk discarded); two cards open at once, Basics rename saved then
  Yield&Price saved from its pre-rename snapshot → rename SURVIVED (SQL-verified);
  reopened editor showed the fresh renamed value. Test edits reverted (SQL-verified).
  Gates: tsc PASS, 25 regression suites PASS, build PASS.
- [ ] **Round 2b — Land money math** (P0-03, P0-04, P0-05, P0-06, P1-01): labor/custom
  semantics restored to combined meaning everywhere (per audit + advisor recommendation;
  Mason notified, no objection) + SQL-view fix as migration DRAFT (not applied);
  structured flex computed once per field-year on combined revenue; agreement-period
  binding; budget/entity binding; landlord output renamed worksheet w/ net due +
  exclusions statement.
- [ ] **Round 3 — Grain risk numbers** (P0-07, P0-08, P0-09, P0-10, P0-11): cash-target
  semantics; RP relabel + 50–85% bounds (delete 86–95%); subtract contracted+pending;
  atomic offer-fill RPC (migration DRAFT).
- [ ] **Round 4 — Bin/contract truth** (P1-04, P1-05, P1-06, P1-07, P1-09): capacity/
  nonnegative/commodity/year enforcement RPC (migration DRAFT); ledger baseline semantics;
  price-leg finalization + delivery quantities; Harvest→Grain reconciliation view.
- [ ] **Round 5 — Save durability** (P1-02, P1-11, P1-12, P2-13): insurance patch/revision
  flow; queue receipts/idempotent deletes; matrix conflict token; per-record receipts.
- [ ] **Round 6 — Operational integrations** (P1-10, P1-13, P1-14, P1-15, P1-16, P2-02):
  stale-weather fail-safe; server due scheduler + push delivery + send-push caller check
  (edge function redeploy = Mason gate); Program-task authority; service-log reversal.
- [ ] **Round 7 — P2/P3 sweep** (remaining P2s, P3s): farm timezone, photo cleanup outbox,
  finite/decimal validators, dropped-column tests, 18px/48px compliance, offline-delete
  honesty, filled-offer archival.
- [ ] **Round 8 — Re-verify**: full gates, re-audit (Sol, same charter scoped to fixes),
  live browser pass per FOUNDATION-AUDIT §7, then ship-checklist unfreeze.

## New findings discovered during repair (not in the original audit)
- **R1-LIVE-01 (P1):** Inventory "Count adjustment" can NEVER save: the form sends a
  date-only `adjusted_at` (`today()` → `YYYY-MM-DD`) but
  `SupabaseInventoryRepository.addAdjustmentOperation` validates it with `stamp()`
  which requires a full ISO timestamp → always fails → farmer sees generic "Check the
  field details and try again". DB table `inventory_adjustments` is empty (no row ever
  saved). Mock repository skips this validation, so regressions pass (mock/supabase
  seam divergence). **UPDATE after the date fix, live re-test still failed — two MORE
  root causes confirmed: (a) `created_by` is NOT NULL + RLS requires
  `created_by = auth.uid()`, but the gateway's raw `.insert()` never sends it
  (adjustments are the only write that bypasses the RPC pattern); (b) the post-insert
  echo returns timestamptz which the strict date-only parser rejects, so even a
  successful insert would throw. Micro-round r1d dispatched for the three-layer fix.**
  Found live 2026-07-13 during Round 1 browser proof. Fix in Round 1
  fix round: accept date-only for `adjusted_at` (dedicated `date()` validator like
  FieldLog's `observed_on`) + align the Mock, + a regression that would have caught it.
- **R1-LIVE-02 (P3):** Count-adjustment Product select displays the first product while
  parent state holds '' until a shelf product is clicked — submitting then fails with a
  generic error instead of either defaulting to the shown product or saying what's wrong.
- **R1-LIVE-03 (watch):** two React "Received NaN for the value attribute" console
  errors observed on load before any interaction — source not yet identified; re-check
  during the post-fix browser pass.

## Queued Mason decisions
- Apply drafted migrations to the farm-rx Supabase project (batched; will list exact files).
- Push accumulated repair commits.
- Redeploy edge functions (send-push fix, deliver-grain-alert re-evaluation).

## Resume instructions
Open a session in C:\FarmRx, read this ledger + FOUNDATION-AUDIT.md, continue the first
unchecked round using the loop pattern above.
