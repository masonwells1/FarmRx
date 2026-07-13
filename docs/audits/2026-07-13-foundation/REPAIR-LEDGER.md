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
- [x] **Round 2b — Land money math** (P0-03, P0-04, P0-05, P0-06, P1-01): labor/custom
  semantics restored to combined meaning everywhere (per audit + advisor recommendation;
  Mason notified, no objection) + SQL-view fix as migration DRAFT (not applied);
  structured flex computed once per field-year on combined revenue; agreement-period
  binding; budget/entity binding; landlord output renamed worksheet w/ net due +
  exclusions statement.
  STATUS: Terra build done; gates PASS under Claude's own run (tsc, 25 suites, build).
  PARTIAL LIVE PROOF 2026-07-13 (worksheet math verified against independent hand calc
  on the real DB): South Creek crop-share worksheet showed Crop value $33,750.00 (15,000
  bu × $4.50 × 50%), Labor & custom work $2,052.00 = (labor $28 + custom $20) × 85.5 ac
  × 50% (old code would show $1,197 + $855 misfiled under Other inputs), expenses total
  $21,620.81, Net due $12,129.19 — all exact matches; new title/percentages/budget+entity
  line/exclusions/disclaimer all render; blocked-state renders as plain-English message,
  no numbers; no console errors. (Proof used reversible test-data: entity+9 cost lines on
  the unallocated "copy" budget, reverted to 0 leftover rows, SQL-confirmed.)
  Sol adversarial review: FIXES-REQUIRED — 9 findings (5 P1: partial-allocation scenario
  distortion; silent fallback to budget land line on unresolved rent; field cards/totals/
  comparisons still per-crop flex + newest-agreement; other_input inert-but-editable +
  relabel changes stored meaning; budget binding silently substitutes sole eligible plan.
  3 P2: net-due suppressed on zero-cost budgets + to/from label ambiguity; migration 0031
  targets legacy flex JSON + misses dependent field_profitability view; regression doesn't
  exercise the report path. 1 P3: unreachable missing-arrangement block + wrong wording
  for adjacent split-year agreements). Fix round r2b-fixes dispatched.
  FIX ROUND 1 (r2b-fixes) DONE + LIVE-PROVEN 2026-07-13: shared resolveFieldYearLand
  resolver (fails closed, plain-English blocked reasons), calculateReportFieldRows
  exported + reused by field cards/totals/plan comparison, budget binding switched to
  budget_field_allocations (fixes R2B-LIVE-01), Other-inputs editor disabled w/ note,
  dynamic Due-to/Due-from label, 0031 rewritten. LIVE EVIDENCE (hand-calc vs real DB,
  no test-data edits needed): worksheet used the ALLOCATED "U of I start" budget —
  crop $33,750.00, expenses $29,104.20 (labor & custom $5,814.00 combined), "Due to
  landlord: $4,645.80"; Overview totals matched to the cent ($228,475.18 costs =
  North Quarter flex $236/ac once-per-field + South Creek crop-share $201.85/ac);
  Fields strip blocks w/ plain-English reason; Other inputs disabled w/ note; console
  clean. Gates PASS under Claude's run.
  Sol RE-REVIEW: still FIXES-REQUIRED — 7/9 fixed; open: partial allocation WITHOUT
  override overcharges rent 4× ($800/ac vs $200/ac worked example, P1); 0031 revenue
  from allocated-not-planted acres underprices flex (P1); resolver zero-divisor
  NaN/Infinity (P2); resolved_* override back door (P2); blockedFields counts
  allocations not fields + skips overlap check (P3); FieldsModule still passes a
  singleton agreement into the resolver, bypassing split-year blocking (P1, original
  finding 3). Fix round 2 (r2b-fixes2) dispatched with reviewer's worked examples as
  mandatory regressions.
  FIX ROUND 2 DONE + LIVE-PROVEN 2026-07-13: per-planted-acre allocation rent, resolver
  zero-divisor blocks + finite invariant, override channel closed (typed param validated
  in resolver), distinct-field blocked count + overlap bookkeeping, FieldsModule money
  display resolves full history. LIVE INVARIANTS HELD: South Creek worksheet identical
  to the penny (Due to landlord $4,645.80; expenses $29,104.20) and Overview totals
  identical ($222,324.75 / $228,475.18 / -$6,150.42); console clean. Gates PASS under
  Claude's run.
  Sol VERIFICATION 2: app code = ALL FIXED (items 1,3,4,5,6 confirmed w/ file:line;
  Sol ran the worked examples itself). Remaining, all confined to the DRAFT SQL +
  one test seam: 0031 fails to apply — min(uuid) doesn't exist (proven on a
  disposable local Postgres, P1); 0031 gives every allocation one field-average rent
  instead of the resolver's revenue-share allocation ($212/$212 vs correct
  $282.67/$141.33 example, P1); split-year regression tests the helper not the
  FieldsModule caller (P2). Fix round 3 (r2b-fixes3) dispatched: SQL fixes MUST be
  proven by running migrations 0001..0031 on a disposable local postgres + SELECTing
  the reviewer's example from the view; regression re-pointed at an exported
  fieldCardLand seam.
  FIX ROUND 3 DONE + INDEPENDENTLY PROVEN 2026-07-13, ROUND CLOSED. Claude re-ran the
  disposable-DB proof with its own hands (docker postgres:16 + minimal auth/storage
  stubs): ALL 31 migrations applied in order (min(uuid) fix works); the reviewer's
  worked example inserted as a signed-in user returned exactly 282.6667 / 141.3333
  from BOTH arrangement_comparisons and field_profitability (matching the accepted
  TS resolver, not the wrong $212/$212); adding a second split-year agreement flipped
  both rows to is_blocked=true with NULL money; container destroyed. fieldCardLand
  exported seam wired at FieldsModule.tsx:1331 with the split-year regression pointed
  at it. Live: Fields detail renders identically through the seam, console clean;
  South Creek worksheet + Overview totals invariants held after every fix round.
  Final gates on the closed tree: tsc PASS, all 25 regression suites PASS, build PASS.
  NOTE for the later apply decision: 0031 replaces BOTH arrangement_comparisons and
  field_profitability; validated apply-clean 0001→0031 on vanilla Postgres 16.
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
  during the post-fix browser pass. (Not seen on the 2026-07-13 Round 2b proof loads.)
- **R2B-LIVE-01 (P1):** the new budget/entity binding blocks 100% of settlements
  permanently: `fields.operating_entity_id` is NOT NULL (every field has an entity) but
  budgets are ALWAYS created with `operating_entity_id: null` (ProfitabilityModule:141,
  :353 — no UI ever sets it) and a DB trigger even blocks changing it on an allocated
  budget. So `budget.entity === field.entity` can never be true and every crop-share
  worksheet shows "no budget plan matches" with no farmer remedy. Found live 2026-07-13.
  Fix direction: bind settlement budgets through the existing budget_field_allocations
  (the farmer's explicit budget↔field-crop link) instead of an unusable entity equality.

## Queued Mason decisions
- Apply drafted migrations to the farm-rx Supabase project (batched; will list exact files).
- Push accumulated repair commits.
- Redeploy edge functions (send-push fix, deliver-grain-alert re-evaluation).

## Resume instructions
Open a session in C:\FarmRx, read this ledger + FOUNDATION-AUDIT.md, continue the first
unchecked round using the loop pattern above.
