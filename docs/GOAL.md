# STANDING GOAL — Build Farm Rx to first customer ship

**Owner:** Mason Wells · **Started:** 2026-07-11 · **Status:** Phase 0 (setup) in progress

## The goal
Build Farm Rx (customer-facing farm management PWA by Crop RX Solutions) to the point where
**Fields + a usable Grain page are in front of a handful of real Crop RX customers.**
That is the finish line for this goal; everything after gets reprioritized by their feedback
(handoff Part 6 calls this "the most important sentence in this document").

Later: CRX Manager connects to Farm Rx via API (bill pay, delivery visibility) — design for it,
don't build it yet.

## How we work (decided 2026-07-11)
- **Claude = orchestrator** — plans, delegates, reviews, verifies in browser, reports to Mason.
- **Codex CLI = builder** — delegate by workload:
  - `gpt-5.6-sol` (frontier): architecture, DB schema, RLS/security, adversarial review
  - `gpt-5.6-terra` (balanced): everyday module building, UI screens
  - `gpt-5.6-luna` (fast): boilerplate, docs, mechanical edits
- Design: `docs/design-brief-codex.md` on every UI task. Handoff brand rules beat any skill.
- Supabase: new FREE-tier project for Farm Rx (Mason approved 2026-07-11). Never the live CRX DB.
- No push/deploy without Mason's explicit OK.

## Roadmap (checklist)
**DB STATE 2026-07-11 ~5:45PM: ALL drafted migrations 0004-0011 APPLIED to farm-rx
(Mason approved "Apply everything"). 11 migrations live, advisors clean (expected
WARNs only). Fields proven LIVE end-to-end in browser: real sign-in -> live list ->
quick-add save through save_field_bundle RPC -> row + receipt confirmed in Postgres.**
- [x] Phase 0a: project home, git, docs, .claude guardrails, taste-skill, design brief
- [x] Phase 0a2: private GitHub repo github.com/masonwells1/FarmRx created + main pushed 2026-07-11
      (initial push approved by Mason; FUTURE pushes still require his OK — no auto-push)
- [x] Phase 0b: CRX Manager engine analysis doc (`docs/crx-engines.md`, Sol) — done 2026-07-11, 30KB, real schemas + RLS warnings
- [x] Phase 0c: app shell running in browser (Vite React TS PWA, brand tokens, login + nav, Terra) — verified 2026-07-11: build+tsc clean, login→Fields works, no console errors
- [~] Phase 0d: Supabase free project CREATED 2026-07-11 (name `farm-rx`, ref `agvsozfbstpekuqxpqjr`,
      us-east-2, $0/mo — separate from live CRX-DATABASE). Module 1 schema draft in progress —
      Sol designs, REVIEW GATE with Mason before apply
- [x] Module 1: Fields UI on MOCK data (list/detail/add-edit, stat boxes) — built by Terra,
      Sol adversarial review found 14 issues, all fixed, browser-verified + committed
      2026-07-11 (161a097). REMAINING for Module 1 done-done: swap MockFieldsRepository →
      Supabase repository + real auth (do together with or right before first-customer setup)
- [x] Module 2: Grain UI on MOCK data — flagship built (position cards w/ two-second sentence,
      honest partial-pricing math, monthly plan grid + atomic templates, ROI-relative targets,
      contracts 15s entry, bins, basis history chart, USDA calendar, Safe-to-Forward + min rev
      guarantee, disclaimer). Terra build → Sol review (13 findings) → fixes → Claude
      browser-verified + committed 2026-07-11 (12f0eb4). REMAINING for done-done: apply 0004/0005
      schema (parked for Mason), real futures API, alerts (arrive with backend swap)
      · Note 2026-07-11: Mason says marketing-update notifications are NOT a must-build —
        keep handoff 2.6 alerts in the spec at normal priority, no special treatment
      · ADOPT from competitor report (docs/competitor-farmprofitmanager.md): monthly plan
        grid + strategy templates (primary view) · "Safe to Forward" bu + Min Rev Guarantee
        on position view (2.7) · Actual-vs-Plan status chips + cumulative chart · ROI-
        relative price targets (breakeven-anchored) · inline add-sale rows w/ autosave
- [x] Module 1 polish pass — built by Terra, Sol adversarial review (10 findings, 4 P1
      incl false-Saved on storage failure + corrupt-envelope Grain wipe), all fixed,
      Claude browser-verified (quick-add persists, nudge filter, $360/ac equivalent-rent
      math proven, fail-closed corrupt-envelope test, landlord phone round-trip, 18px/48px
      clean, 0 console errors) + committed 2026-07-11. npm run regression now runs both
      repository suites.
- [~] FOUNDATION BLOCK — CODE BUILT + BROWSER-VERIFIED 2026-07-11 (Sol design →
      Terra build → Sol adversarial review 13 findings/5 P1 → all fixed → Claude verified
      hands-on): REAL Supabase auth live in dev (sign-in/sign-out/session-restore/wrong-
      password all proven in browser with test account farmtest@croprxsolutions.com on the
      farm-rx dev DB; real farm name renders from real DB), SupabaseFieldsRepository +
      durable offline write-queue (FIFO replay, multi-tab locks, never-lose-an-entry,
      honest synced/pending wording) behind the unchanged repository seam, Grain pinned to
      mock via explicit backend manifest, MockGrain now reads Fields via injection (no
      copies). Regressions: 3 suites incl. 15-check live-repo contract suite, all passing.
      DRAFTED NOT APPLIED: 0008 employee privacy (grain/financials owner/manager-only +
      per-member View financials), 0009 fields live support (5 missing UI columns +
      atomic save_field_bundle RPC w/ replay receipts + idempotent bootstrap_first_farm).
      ⚠ GATE: Fields+Grain pages in dev show an honest "could not load" error until 0009
      is APPLIED (decision #7 below) — the DB lacks 5 columns the UI round-trips.
      Remaining after 0009 apply: live-path manual test matrix (foundation-design.md),
      sign-out message says "sign-in ended" instead of a neutral goodbye (polish)
- [~] Free futures feed (research DONE 2026-07-11 → docs/futures-feed-research.md):
      no free raw-quote API is license-compliant for customer display (CME licensing);
      DECIDED BY CLAUDE: Phase 1 $0 = TradingView delayed widgets (licensed embed,
      attribution kept) for quotes + manual planned price stays the math source;
      USDA AMS MARS API (public domain) for basis/cash history when backend lands.
      Phase 1 SHIPPED 2026-07-11: 6 TradingView delayed tiles on Grain page (front months
      + Dec26 corn/Nov26 beans/Jul27 wheat), display-only (math still manual prices), calm
      offline fallback; Sol review 3 findings fixed; Claude browser-verified desktop+mobile
      (375px overflow bug found+fixed, incl pre-existing position-grid overflow). Phase 2
      (paid Barchart) parked below as decision #6. USDA basis feed arrives with backend.
- [~] Module 4: Profitability — SCHEMA DRAFTED (0006+0007, NOT applied) AND **UI BUILT ON
      MOCK + BROWSER-VERIFIED 2026-07-11** (Terra build → Sol review 13 findings/6 P1 →
      all fixed → Claude verified hands-on with exact arithmetic: owned ground drops the
      $245 land line ($833→$588/ac), crop-share equivalent rent = 40%×$929.20 revenue −
      40%×$588 landlord-paid inputs = $136.48, matrix cell math, BU TO COVER, copy-budget,
      duplicate-allocation guard, budget-switch cell reset, 0 text <18px / 0 targets <48px,
      375px clean). Separate storage key; Fields data injected; flex formula stays UI shape
      pending decision 6a. REMAINING: apply 0006/0007 (after grain), live repository swap,
      branded PDF export. NOTE: page shows honest load error in dev until 0009 is applied
      (it reads Fields live).
      · ADOPT from competitor report: "BU TO COVER" column on every cost line (4.1) ·
        equivalent-cash-rent normalization in arrangement comparison (4.2) · breakeven-YIELD
        alongside breakeven-price (4.3) · "copy from another budget" (4.1) · our matrix stays
        front-and-center + interactive + contour line (theirs is buried/static — beatable)
- [ ] **SHIP GATE: Fields + Grain in front of real customers** ← the goal
- [~] Module 3: Inventory & compliance — SCHEMA DRAFTED 2026-07-11 (0010+0011 by Sol,
      Claude spot-check-reviewed, NOT applied; explainer docs/schema-module3.md): farm
      product catalog, append-only receipts/adjustments ledger, derived on-hand (never
      stored), one-field application records w/ regulatory snapshots + RUP completeness
      view, idempotent CRX delivery-event inbox hook, Module 4 cost-source UUIDs.
      Runs after 0001–0003 only (no 0008 dependency — inventory/spray = ordinary member
      data, workers keep their own workflow). UI BUILT ON MOCK + BROWSER-VERIFIED
      2026-07-11 (Terra build after one plan-and-wait stall relaunch → Sol review 9
      findings/6 P1 incl gal→lb conversion hole + false compliance completeness → all
      fixed → Claude verified live: shelf w/ RUP badge + derived on-hand, receive 30 gal
      → 120→150 gal proven, honest low-stock nudges, 0 targets <48px, farm-isolation
      guard proven fail-closed when farm id changed). REMAINING: live repository swap.
- [ ] Modules 5/6: Equipment & Tasks · Module 7: machine data

## Loop policy (Mason, 2026-07-11): keep working, never block on questions
- The loop runs continuously and only surfaces questions that GENUINELY need Mason
  (business decisions, money, irreversible actions).
- **If Mason doesn't reply, do NOT idle**: park the question in "Pending decisions" below,
  skip to the next actionable ledger item, and keep building.
- Hard stops stay hard (push/deploy/new DB migrations/deletes wait for explicit OK) —
  but waiting on a hard stop never pauses other work.
- Re-surface pending decisions briefly at the top of each progress report; never nag.

## BUILDER FALLBACK (Mason, 2026-07-11 ~6:20PM): Codex usage runs out ~7:20PM and resets
## ~9:00PM. When a codex exec fails with a usage-limit error, switch delegation to Claude
## subagents — Opus 4.8 (model "opus") takes Sol's role (architecture/schema/security/
## adversarial review), Sonnet 5 (model "sonnet") takes Terra's role (modules/UI builds) —
## via the Agent tool with the same task prompts. At 9:00PM switch back to Codex.

## NEXT WORK QUEUE (post-apply, 2026-07-11 evening — in order)
1. Grain live repository swap (Sol design → Terra build → review → verify): SupabaseGrain
   repositories behind the existing seam, flip backends.grain to 'supabase'; alerts + USDA
   MARS basis feed ride along per handoff 2.6. Profitability + Inventory live swaps follow
   the same pattern after.
2. Flex-formula reconciliation: UI {type,trigger,bonus_rate} vs applied 0006 view
   {basis,trigger,rate_pct,cap_per_acre} — views fail closed on UI shape (no wrong math,
   but flex answers return empty). Align one way; ASK MASON which formula matches real
   CropRx leases.
3. Customer onboarding path: admin-side account+farm creation flow (currently only the
   test harness can provision).
4. Live-path manual test matrix from docs/foundation-design.md (multi-user permission
   checks: owner/manager/worker/granted employee/rep; offline replay on real signal drop).
5. Real-device PWA pass (phone install, sunlight/gloves two-tap flows).
6. Polish: neutral sign-out message; enable leaked-password protection (Supabase dashboard
   Auth toggle — 1 minute, flagged by security advisor).
7. Ship gate prep: deploy needs Mason's explicit OK (never auto).

## Pending decisions (parked, non-blocking — from competitor report, 2026-07-11)
**RESOLVED 2026-07-11 by Mason's "Apply everything": former decisions #0 (grain 0004/0005),
#6a (profitability 0006/0007), #7 (fields support 0009), #8 (employee privacy 0008) — ALL
APPLIED along with Module 3's 0010/0011. Only the flex-formula QUESTION from 6a survives
(see NEXT WORK QUEUE #2).**
0. **APPLY MODULE 2 SCHEMA** (0004+0005, drafted+Claude-reviewed 2026-07-11, explainer at
   docs/schema-module2.md): waiting for Mason's explicit OK, same as Module 1. Grain UI
   builds on mock data meanwhile — nothing blocked.
1. Cost of Carry (store-vs-sell verdict page): add to Module 2 post-ship roadmap, or skip?
2. Crop-as-named-enterprise ("Corn on Corn") vs plain commodity budgets — schema is being
   drafted to allow BOTH cheaply (optional enterprise label); v1 UI ships commodity-only
   unless Mason says otherwise.
3. Firm offers (standing elevator orders counting toward position): in v1 contracts or later?
   Default if no answer: later (2.5 note).
4. Alert emails to a second address (advisor/spouse): allowed, or owner-only per Rule 2?
   Default if no answer: owner-only v1.
5. Paid "we set up your numbers" service (their $2,495 model) as a Crop RX offering?
   Pure business call — no default.
6a. Module 4 schema drafted 2026-07-11 (0006+0007, NOT applied; explainer docs/schema-module4.md):
   flex-lease formula in the draft = trigger + %-above-trigger + optional cap — does that match
   real CropRx flex leases? Say "apply the profitability schema" when ready (after grain).
7. **APPLY FIELDS SUPPORT SCHEMA (0009)** — drafted+Claude-reviewed 2026-07-11, explainer
   at docs/schema-fields-support.md. Additive only (5 columns + save function + receipts +
   first-farm bootstrap). THIS is what turns real login + live Fields ON in dev; until then
   Fields/Grain pages show an honest load error. Say "apply the fields support schema".
   Note: 0009 applies right after the live 0001–0003; it does NOT need grain (0004/0005).
8. **APPLY EMPLOYEE PRIVACY SCHEMA (0008)** — drafted 2026-07-11 (grain+financials become
   owner/manager-only with per-employee View financials switch). Applies AFTER 0004–0007;
   must land before the first employee login. Explainer inside docs/foundation-design.md.
9. Module 3 owner questions (2026-07-11, from docs/schema-module3.md): (a) should ordinary
   workers see receipt PRICES? (default adopted: yes-visible v1, split later if a farm asks)
   (b) seed sold by bag vs seed_unit (schema supports both); (c) one field per spray record
   (default adopted: yes, batch ID later); (d) which license fields on the compliance PDF.
6. Futures feed Phase 2 (2026-07-11): Barchart OnDemand EOD ~$49/mo is the cheapest
   COMPLIANT raw-quote API (needed only when our UI must compute with live board prices;
   get written sales confirmation it covers end-user display). Default if no answer:
   stay on $0 Phase 1 widgets.
- DECIDED BY CLAUDE (technical/UX): monthly calendar grid with live futures per cell +
  one-tap strategy templates becomes the PRIMARY marketing-plan view (their best UX,
  handoff 2.6 compatible); fields stay first-class but Grain page must not be gated on
  a complete field list.

## Open questions for Mason (answer when relevant, handoff Part 8)
1. Scale tickets / load tracking — in or out? (matters at Module 2)
2. Prepay balance tracking — in or out?
3. Pricing model (free to CRX customers vs subscription) — matters before Barchart $650/yr
4. Employee permission granularity (min: employees never see grain/financials)

## Session resume instructions
Open a session in `C:\FarmRx` (loads project CLAUDE.md + this goal via auto-memory).
Check the Roadmap checkboxes above, read the latest git log, continue the next unchecked item.
Update this file's checkboxes as phases complete — this file is the ledger.
