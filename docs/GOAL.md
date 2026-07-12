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
      guard proven fail-closed when farm id changed). **LIVE SWAP DONE + BROWSER-PROVEN
      2026-07-11 ~9PM**: Sol 0015 draft + Terra build (fake-gateway pattern) → Opus
      adversarial review caught 2 P1 pre-ship (cancel-receipt always violated the
      cancelled_by check → fixed with a server trigger in 0015; RUP token whitelist
      mismatched the view vocabulary → screen crashed on any RUP row with unknown
      REI/PHI → fixed to the exact 11-token set) + 2 P2 (startup replay wired in
      App.tsx; regression suite rebuilt by Terra to drive every write end-to-end, 8
      coverage groups). Browser verification then caught a 3rd runtime-only P1: creating
      a NEW product live always failed (UI sends blank created_at/updated_at, strict
      mapper rejected) → repository now stamps them. Live proof on farm-rx: received 50
      gal restricted-use "Atrazine 4L Test" (+$4.25/gal cost), on-hand view 50→20 after
      a 120-qt spray record (server converted qt→gal), compliance screen renders
      rate-above-label-max + REI/PHI-unknown warnings (the old crash case), cancelled a
      10-gal receipt with reason → cancelled_by recorded as the test user in Postgres.
      0015 applied (15 migrations, verified). All four modules now LIVE.
- [x] Modules 5/6: Equipment & Tasks — BUILT + LIVE + BROWSER-PROVEN 2026-07-12 ~6AM
      (Mason's explicit "build the equipment module and the taskboard now" directive):
      recon stole CRX Manager's Team Board patterns (3-column card board, overdue
      escalation amber<3d/red>=3d/critical>=7d, quick-add, linked chips, done history)
      while deliberately dropping tags/comments/attachments/realtime; Equipment goes
      BEYOND CRX (it has no maintenance records/meter history/warranty at all): asset
      records, meter-reading history (append-only, backwards allowed for replaced
      meters), service intervals (every N hours/miles and/or months) that AUTO-GENERATE
      board tasks via idempotent RPC (one open card per reminder — proven through
      reload + mileage-jump cycle-key change), service/repair log w/ costs +
      cost-per-machine, warranty chips. Tasks board: To Do/Doing/Done, KPI tiles
      (Open/Mine/Overdue/Done), assignees via safe member-name view, field+machine
      linked chips, server-stamped completion. 0016+0017 applied (17 migrations).
      Gauntlet: Opus review caught 4 blockers pre-apply (due-view farm_id drift =
      module would never load; missing p_reading_id = service logging impossible;
      mapper/DB length-cap mismatch; Done column hidden by precedence bug) + vacuous
      suite rebuilt (9 coverage groups); browser then caught a 5th P1 NOBODY saw
      statically: SELECT..FOR UPDATE under RLS made a WORKER's service entry fail →
      0017 removed the row locks (advisory lock suffices; apply-agent proved the fix
      by impersonating the worker in a rolled-back transaction). Live proof: Truck 7
      (Peterbilt 389) created, 120k→135k miles, oil-change reminder auto-card exactly
      once, worker completed it (completed_by=worker in Postgres), worker logged the
      $385.50 service w/ reading 135,100 → interval reset (due-view empty), cost-to-
      date on card, role gating (worker: no Add/Edit machine, no interval forms, no
      Delete; owner: all present). PARKED P3 polish: service-log completion should
      auto-close leftover auto-task cards (today the still-due reminder honestly
      regenerates until the service is actually logged); DOT fleet compliance
      (DVIRs/IFTA/CDL) NOT built — needs Mason's explicit confirmation.
- [ ] Module 7: machine data import (Deere/FieldView/AgFiniti) — last by design

## CUSTOMER-VALUE BATCH (Mason directed 2026-07-12: "build a loop to build" these five)
Daily-use, farmer-facing features. Decisions locked with Mason 2026-07-12:
**weather feed = Open-Meteo (free, no key)**; **reminders = in-app + phone push only**
(no email, no SMS — both declined for now). NOTE: the original handoff Part 7 listed
"weather alerts" as out-of-scope; Mason has explicitly overridden that here, same as he
pulled Equipment/Tasks forward. Build order + status:
- [x] Feature A: Weather + spray windows — BUILT + LIVE + BROWSER-PROVEN 2026-07-12.
      Field-level Open-Meteo forecast (free, no key) + green/yellow/red "Can I spray now?"
      light per field, driven by wind bands / own-hour + look-ahead rain / heat / an
      inversion heuristic (sunrise-sunset). Best-window-today, 12-hour strip, 7-day row.
      Field location captured via phone GPS "use my location" + manual lat/long fallback.
      0018 applied (18 migrations): fields.latitude/longitude/location_source + worker-safe
      set_field_location RPC (owner/manager/worker; read_only+reps excluded). Product-agnostic
      spray light (inventory catalog has NO environmental label limits — see
      weather-inventory-findings.md; product refinement deferred). Design:
      docs/weather-spray-design.md. Gauntlet: Sol review found 3 P1s regression missed
      (own-hour rain probability ignored → could green-light a 90%-rain hour; empty/misaligned
      forecast produced unsafe "best window: 10 PM"; location replay could delete a freshly
      queued pin) + P2/P3 (envelope-deep cache validation → crash; storage-failure discarded
      live data; concurrent field+location replay; impossible provenance shape; read_only
      overconfident sync promise; 17px<18px) — ALL fixed by Terra + regression grown 4→6
      groups. Live proof on farm-rx: set North Quarter to 40.1105,-88.2073 → set_field_location
      wrote lat/long/source to Postgres (verified) → live forecast rendered (74°F, 8 mph NE,
      "Good — wind in 3–10 mph range", best window ~4–9 PM, 12-hr strip, 7-day) → 375px no
      page overflow (strips scroll internally) → 18px baseline confirmed. tsc+build+regression
      green firsthand. PARKED follow-up: inventory "use current weather" pre-fill button (kept
      out of first pass to keep review focused); GPS branch shares the proven manual save path.
- [ ] Feature B: Rain gauge + field log — per-field rainfall entry, running season total,
      growing-degree-days; simple timeline. Sits next to weather.
- [ ] Feature C: Scouting notes with photos — walk a field, drop a GPS pin, attach photos
      (Supabase Storage bucket, per-farm isolation), category (weed/disease/pest/other),
      optional auto-create a follow-up task. Feeds the Tasks board.
- [ ] Feature D: Harvest yield tracking — actual bushels per field/crop-year (crop_assignments
      already has harvested_bushels + expected columns), actual-vs-expected, feeds Profitability
      and builds the yield history crop insurance (APH)/FSA ask for.
- [ ] Feature E: Push reminders (in-app + phone push) — one notification layer across all of
      it (spray window opens, rain logged reminders, scouting follow-ups, harvest reminders,
      plus existing service/task reminders). Web push (service worker + VAPID keys + a
      notifications table + permission prompt). Built LAST — it references the others.

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
1. [x] GRAIN LIVE — DONE + browser-proven 2026-07-11 ~7:15PM (commit afb283d): Sol design →
   Terra build → Sol review (14 findings/9 P1) → fixes → Opus re-review COMMIT-READY →
   0012 applied (after DB parser caught a CASE-in-IF syntax bug both static reviews
   missed) → live proof: first-estimate editor wrote 195bu×160ac (31,200 bu reads back),
   Balanced Seller template wrote 5 rows through replace_marketing_plan_targets RPC
   (verified in Postgres). Claude also fixed 2 runtime-only bugs (uncached React store
   snapshot = blank page; timestamp validator rejecting real PostgREST stamps).
   FOLLOW-UPS: deploy deliver-grain-alert edge function (needs Mason OK? it's the dev
   project — do with next apply batch); P2 test-coverage additions from Opus re-review
   (canonical-confirmation rejection tests, MARS math-exclusion pure test, buyer dropdown
   filter). Profitability + Inventory live swaps follow the same pattern.
2. [x] Flex-formula upgrade — BUILT + LIVE-PROVEN + committed (00ae13a) 2026-07-11; and
   INVENTORY LIVE SWAP done + proven (see Module 3 entry above). Research trail below:
   RESEARCHED 2026-07-11 (Mason asked for U of I research →
   docs/flex-lease-research.md, farmdoc sources cited): 4 published structures; recommended
   superset JSON schema {method, base_rent_per_acre, rate_pct, trigger_revenue_per_acre,
   base_price_per_bu, base_yield_per_acre, min_rent_per_acre?, max_rent_per_acre?,
   price_source_note}. v1 = base_plus_bonus + pct_of_revenue w/ min-max (park lease-form
   Options I/II price/price+yield indexing; fields reserved). KEY FINDING: current UI
   'price'/'yield' per-unit bonus types match NO published U of I structure — existing
   saved rows of those types need Mason's confirmation before migration (default: keep
   readable, stop offering for new leases). BUILD after profitability swap: Fields
   arrangement editor + shared calc + regression; 0006 view alignment later.
3. [~] Customer onboarding path — DESIGNED + SCRIPT BUILT 2026-07-11 (docs/
   onboarding-design.md + scripts/provision-customer.mjs: Claude runs it locally with the
   service-role key in an env var — never committed/shipped; creates a confirmed user
   flagged initial_farm_owner → app shows "Set up your farm"). REMAINING: Mason's 2
   dashboard toggles (see MASON ACTION ITEMS) + a real end-to-end provisioning run.
4. [x] Live-path multi-user test matrix — PROVEN IN BROWSER 2026-07-12 ~3:30AM against the
   live DB with real signups (created while public signups are still open — do NOT delete
   these test users when signups get disabled):
   · farmworker@croprxsolutions.com (worker member, no financial flag): Fields visible
     (2 fields / 245.5 ac), Inventory visible (live 20 gal shelf), Grain DENIED with the
     farmer-English "Grain records are private on this farm" message, Profitability DENIED
     (data safe; message is the generic try-again one — P3 polish below).
   · farmrep@croprxsolutions.com (rep with an enabled farm_rep_access grant): with the
     farm's share_with_rep OFF → completely locked out (no farm at all); flipped ON →
     Grain opens. TWO-PART RULE PROVEN both directions; sharing restored to OFF after.
   REMAINING from this item: offline replay on a real signal drop (needs the phone pass).
5. Real-device PWA pass (phone install, sunlight/gloves two-tap flows) — MASON + Claude.
6. Polish: neutral sign-out message; profitability privacy-denial message should match
   grain's honest wording (P3, found in the worker test); Resend email key for the
   deployed deliver-grain-alert function (it fails safe with a farmer-friendly error
   until a RESEND_API_KEY secret is added — needs a Resend account, Mason decision).
   ALSO DONE 2026-07-12: deliver-grain-alert edge function DEPLOYED to farm-rx (ACTIVE,
   JWT required — unauthenticated probe returns 401; the earlier deploy agent hung and
   was killed).
7. Ship gate prep: deploy needs Mason's explicit OK (never auto).

## MASON ACTION ITEMS (2 minutes in the Supabase dashboard, farm-rx project — 2026-07-11)
Both from the onboarding security review (docs/onboarding-design.md):
1. Authentication → Sign In / Up → turn OFF "Allow new users to sign up" (today a stranger
   with the app's public key could create an account and an empty junk farm; customer
   accounts are created by our provisioning script instead — scripts/provision-customer.mjs).
2. Authentication → Passwords → turn ON leaked-password protection (HaveIBeenPwned check).

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
