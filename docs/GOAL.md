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
      pending decision 6a. 0006/0007 APPLIED; LIVE SWAP DONE (commit 38154e8, 0013 applied,
      browser-proven). BANKER PDF DONE 2026-07-12 (Fable): print-based "Banker report"
      overlay on Profitability (preview → Save as PDF), farm name on top, KPIs, cost table
      w/ green total bar, per-field table using equivalent rent, ℞ "Powered by Crop RX"
      footer per docs/design/01-brand.md. Browser-proven live on farm-rx with farmtest:
      5 cost lines written through UI ($647.75/ac), field allocated, report math exact
      (breakeven $3.60/bu, 143.9 bu/ac, net $171.25/ac × 160 ac = $27,400). Module 4 COMPLETE.
      · ADOPT from competitor report: "BU TO COVER" column on every cost line (4.1) ·
        equivalent-cash-rent normalization in arrangement comparison (4.2) · breakeven-YIELD
        alongside breakeven-price (4.3) · "copy from another budget" (4.1) · our matrix stays
        front-and-center + interactive + contour line (theirs is buried/static — beatable)
      · UPGRADE SPEC LOCKED 2026-07-12 (owner-interviewed, C:\ session): docs/
        profitability-upgrade-spec.md — V1 (build AFTER ship gate + live swap) = named input
        plans A/B/C compared per arrangement w/ winner + Input ROI Analyzer + margin-of-safety
        cushions + progressive cost depth (farmdoc IL defaults, "default vs your number"
        badges). Evidence: docs/profitability-research-2026-07.md
      · UPGRADE V1 BUILT + BROWSER-PROVEN LIVE 2026-07-12 (Fable, C:\ session, Mason said
        "build it now"): plan-comparison card (sibling budgets same year+commodity, Best
        badge per arrangement, price/yield cushions), Input ROI Analyzer (extra-bu ladder +
        Excel verdict tiers + what-if, proven (95−89.5)×$4.50=$24.75/ac both directions),
        "Start from 2026 U of I budget" (19 farmdoc central-IL lines; live KPIs reproduce
        farmdoc's published $4.79/$3.46 corn breakevens exactly), per-line "U of I default"
        badges (proven to clear on real edit 229→250), "what am I forgetting?" coach
        (added 4 missing lines in one click, BE honestly moved $3.60→$4.85), dual breakeven
        KPI (total vs before-land). Frontend-only — NO schema change (budget name = plan).
        FIXED underlying bug: QueuedProfitabilityRepository raw-cache went stale on flushed
        online writes → batch saveCostLine minted duplicate sort_order → DB 23505 (found
        live in browser; cache now updated per save). New pure-math layer
        src/data/planningTools.ts + planningTools.regression.ts (26 checks, every number
        verbatim from Mason's Excel; wired into npm run regression, 18 suites green).
        tsc -b clean, 0 console errors, 375px clean (no overflow/tiny text/small targets).
        NOTE: farmtest password rotated — see docs/build-notes/verify-login.md. NOT pushed.
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
- [x] Feature B: Rain gauge + field log — BUILT + LIVE + BROWSER-PROVEN 2026-07-12.
      Per-field rainfall + dated notes (one field_log_entries table, entry_type rainfall|note),
      running 2026-season rainfall total, reverse-chron timeline with edit/delete, and
      growing-degree-days (base 50) accumulated from the crop's planting date using Open-Meteo's
      FREE archive API + the Feature A location. 0019 applied (19 migrations): field_log_entries
      + save_field_log_entry (receipt-idempotent) + delete_field_log_entry (idempotent), gated
      owner/manager/worker. Gauntlet: 0019 RPCs behaviorally proven via owner impersonation
      (insert→row, replay→no dup, delete→0 rows). Sol review found 1 P1 (GDD could show an
      understated "since planting" number — archive lags ~5 days and a partial response was
      accepted as the whole season) + P2s (offline save appeared to vanish; corrupt queue entry
      didn't fail closed; client validation didn't match DB future/length checks; 375px form
      overflow) + P3 (16px<18px) — ALL fixed by Terra; field-log suite 6→7 groups, weather 7→8.
      Live proof on farm-rx: logged 0.80 in on North Quarter via UI → save_field_log_entry wrote
      the row to Postgres (verified) → season total 0.00→0.80 → deleted via UI →
      delete_field_log_entry → 0 rows (verified); set North Quarter crop_assignment planting_date
      2026-05-01 → GDD rendered "1,256, weather data through 2026-07-07" (P1 fix: end capped at
      today−5 with honest caption, not understated to today); 375px single-column form, no page
      overflow with a 400-char note. tsc+build+regression green firsthand. (Test data note: North
      Quarter now has location 40.11,-88.21 + planting_date 2026-05-01 — left in place, realistic.)
- [x] Feature C: Scouting notes with photos — BUILT + LIVE + BROWSER-PROVEN 2026-07-12.
      Per-field scouting notes (category weed/disease/insect/other), GPS pin (reuses Feature A
      geolocation), PHOTOS to a PRIVATE Supabase Storage bucket (farm-scoped RLS on the first
      path segment; signed URLs), optional "add a follow-up task" that lands a card on the Tasks
      board (source 'scouting'). 0020 applied (scouting_notes + scouting_photos + bucket +
      storage RLS + save/delete RPCs + widened farm_tasks.source) + 0021 (bucket hardening:
      private, 20MB, image MIME only) = 21 migrations. Gauntlet: 0020 RPCs behaviorally proven
      (owner impersonation: note+board-task created, delete removed). Browser-proven happy path:
      note+photo → uploaded to private bucket → signed-URL thumbnail → note/photo rows + storage
      object all consistent (path {farm}/{field}/{note}/{uuid}) → UI delete removed rows AND the
      storage file (0/0/0). Sol review found 3 P1s my happy path missed — photo-ONLY note and
      GPS-tagged note each COMMITTED but the client falsely reported failure (empty-note→null
      echo mismatch; unrounded phone GPS vs numeric(9,6) echo), and a failed Storage delete could
      orphan files — ALL fixed by Terra + a durable delete-path + client MIME/size guard;
      scouting suite 6→9 groups. Re-proved after fix: photo-only note saved (note=null), GPS note
      saved (40.110538,-88.207312 — unrounded 40.11053789 rounded to 6dp, no false failure). tsc+
      build+regression green firsthand. PARKED P2/P3 already fixed; remaining polish none.
- [x] Feature D: Harvest yield tracking — BUILT + LIVE + BROWSER-PROVEN 2026-07-12.
      Per field+crop-year: enter actual bushels + date + optional actual price → actual yield/ac,
      delta vs expected (honest "no expected set" when null), actual revenue (actual price ??
      expected, labeled), plus a per-field yield-history/APH strip + year selector. 0022 applied
      (22 migrations): actual_price_per_bu column + receipt-idempotent save_crop_harvest RPC
      (updates ONLY harvest columns — never expected/planting/acres). Gauntlet: 0022 behaviorally
      proven (owner impersonation: set 32000bu/date/price, expected+planting untouched; clear-to-
      null). Terra's build was actually BROKEN (4 tsc errors it falsely reported clean — missing
      actual_price_per_bu in FieldsModule new-record literal + MockFieldsRepository 2 spots +
      single-cast in harvestWriteQueue) — Claude caught + fixed firsthand. Sol review: NO P1
      blockers; 3 P2 (float rounding false-reject of valid fractional saves [1.005→1.01, same
      class as Feature C GPS]; reconnect replay race w/ Fields; regression not SQL-faithful) +
      2 P3 (receipt-replay accepted as shared idempotency pattern across ALL RPCs, not fixed;
      16px<18px) — real ones fixed by Terra via a roundDecimalHalfUp decimal helper; harvest suite
      7→8 groups. Live proof on farm-rx: 32000bu → 200 bu/ac + $139,200; 31999.50bu (fractional,
      post-fix) → 200 bu/ac + $136,957.86, stored 31999.50 exactly, no false-fail; expected/
      planting untouched. tsc+build+regression green firsthand.
- [x] Feature E: Push reminders — IN-APP CENTER LIVE + BROWSER-PROVEN 2026-07-12; phone-push
      plumbing BUILT (live send gated on Mason: VAPID secret + HTTPS). In-app notification center
      (bell + unread badge + /notifications "Alerts" list, category chips, tap→link, mark read /
      mark all read) with per-person privacy. 0023 applied (23 migrations): notifications +
      push_subscriptions tables (RLS own-only; direct UPDATE limited to read_at; insert via RPC
      only) + create_notification (dedupe) / mark_notifications_read (own-only) / save+delete_push_
      subscription RPCs + generate_due_service_tasks extended to raise a deduped owner 'service'
      notification. Generation hooks: spray-window-good (Feature A) + scouting-follow-up (Feature
      C), best-effort/deduped/non-blocking. Phone push: custom SW (src/sw.ts, vite injectManifest)
      with push + notificationclick handlers, subscribe/unsubscribe flow + VAPID public key, honest
      "needs permission/HTTPS" states; send-push edge function written (supabase/functions/send-push,
      web-push+VAPID, fail-closed if secret unset). VAPID keypair generated (private key in
      scratchpad only, NEVER committed). Gauntlet: 0023 behaviorally proven (owner→worker notif;
      worker reads it; owner CANNOT see worker's = cross-user RLS; dedupe=1 row). Sol review: 2 P1
      (injectManifest dropped offline nav fallback + skipWaiting/clientsClaim → RESTORED via
      NavigationRoute+precache) + P2/P3 (mark-read no-op honesty, bell badge refresh, push-save
      rollback, SW payload safety, 'default'≠denied, 18px) all fixed by Terra; notifications suite
      5→9 groups. Browser-proven on farm-rx: seeded notif → bell count → alerts list → mark read →
      read_at in Postgres; scouting note+follow-up → auto 'scouting' notification appeared; mark-all
      -read cleared the bell badge instantly; honest "phone alerts blocked in this browser" state.
      tsc+build(SW precache intact)+regression green firsthand. REMAINING for live phone push
      (Mason): set VAPID_PRIVATE_KEY/PUBLIC_KEY/SUBJECT edge secrets + deploy send-push + the
      HTTPS tailscale-serve link (push needs a secure context). Also parked: scheduled "while app
      closed" evaluator (pg_cron/scheduled edge fn) for dawn spray-forecast pushes.

## 🎉 CUSTOMER-VALUE BATCH COMPLETE (A–E) 2026-07-12 — all built, reviewed, proven, committed LOCALLY.
Commits: A 7a9fe73 · B 982fec3 · C 7e219c4 · D 4029884 · E (this). 23 migrations (0018–0023) applied
to farm-rx TEST project. NOTHING pushed or deployed. Phone-push live send + real-device pass await Mason.

## MODULE 8 — PROGRAMS (planned application programs) — Mason directed 2026-07-12
Farmer plans Pre/Post/Fungicide/Planter-fertility (+ custom) programs, assigns to the exact crop on
each field, tracks Planned→Applied. Decisions locked with Mason 2026-07-12: **products FREE-TYPE now**
(catalog match later — reserved nullable column, no migration needed to switch on); **future roadmap
(design-for, DON'T build): CRX books an order → link/push into customer's Farm Rx account → they see
"scheduled delivery" → when it leaves the warehouse it becomes their on-hand ("on the floor")** via
Module 3's existing delivery-event inbox hook.
- [x] DESIGN DONE (Sol, 2026-07-12): `docs/programs-design.md` — authoritative. Materialized per-field
      pass snapshots (template edits never rewrite applied history); assigns to crop_assignment (not
      field) so double-crop is safe; free-type never touches inventory; receipt-idempotent SECURITY
      DEFINER RPCs (no SELECT..FOR UPDATE — 0017 lesson); wires into farm_tasks (source 'program'),
      notifications (dedupe), weather spray-light, application_records (link, on-hand unchanged),
      profitability cost view. 8 P1s + 10 P2s ranked with mitigations. 6-chunk build plan.
      DECISION (Mason 2026-07-12): ALLOW MULTIPLE active programs per crop — driver: farmers run
      different FERTILITY programs by soil productivity (lighter soil vs higher-productive ground),
      often + a separate chemical program on the same crop. NO sub-field zones (Farm Rx has none) —
      it's just differently-named/categorized programs assigned per field's crop. Sol doing Rev2 of
      programs-design.md (multiple-per-crop: drop the one-per-crop unique, optional program category,
      tracker groups by program, tasks/reminders name the program). Then build loop starts.
- [~] BUILD LOOP (6 chunks, each: build → Sol review → browser-prove → local commit; migration 0024
      applied to farm-rx TEST project only, additive): 1 schema+RPCs · 2 template builder+offline ·
      3 assign+season tracker · 4 tasks+reminders · 5 weather+applied+cost · 6 polish+full regression.
  - [x] CHUNK 1 schema+RPCs DONE + APPLIED + DB-PROVEN 2026-07-12 (0024_programs.sql, 24 migrations):
        6 tables (RLS all 6) + 4 security-invoker views + 18 receipt-idempotent SECURITY DEFINER RPCs
        + farm_tasks 'program' source + is_active retire column + collision-safe sync_open_program_task_due.
        Sol built → adversarial Codex review (NO P1s; 3 P2s fixed: refresh product-retire, task date sync,
        reschedule cycle collision) → Opus review → APPLY caught 3 more real bugs (constraint-name
        collision due_source; 2 plpgsql multi-INTO record errors) → then a REAL cross-module bug: create
        application_record as 'completed' violated Inventory's protect_application_history (must be draft;
        draft→completed needs a product; free-type has none). FIX (Sol, Option A): create as honest DRAFT,
        unposted, on-hand unchanged; apply-with-no-record + link-existing(non-voided,same farm+crop) paths.
        BEHAVIORAL PROOF (worker/outsider impersonation, rows observed, then cleaned up): worker builds
        program+pass+free-type products+assign ✓; idempotent replay no-dup ✓; MULTIPLE programs/crop=2 ✓;
        double-crop independence (corn applied, soybean pass still planned) ✓; mark-applied write-scope
        (crop row 160.00/2026-05-01/corn untouched) ✓; app record=draft, 0 products, on-hand unchanged ✓;
        same-program-twice rejected ✓; cross-farm crop rejected ✓; outsider write rejected ✓; 12-cap trips ✓.
        Security advisor clean for 0024 (no new lints beyond the accepted authenticated-definer pattern).
  - [x] CHUNK 2 template builder + offline writes DONE + BROWSER-PROVEN 2026-07-12 (Terra build):
        /programs page — My programs list (kind badge + archived filter) + template builder (name/
        category/crop-year/notes) + passes (Move up/down, free-type products name/rate/unit/$/ac) +
        archive. 9 client files (programs.ts, gateway, repo, versioned FIFO queue w/ Web-Lock cross-tab,
        regression). Sol adversarial review found 3 P1 (pass-edit sent afterId=null → bumped pass to
        top; cross-tab queue could clobber; loose canonical-order accepted → could drop durable queue
        entry) + 5 P2 + 1 P3 — ALL fixed by Terra (predecessor-aware edit + canonical reload, Harvest-
        style Web Lock, strict UUID/uniqueness order validation, offline pending projection, honest
        corrupt-queue count, cost/notes-only guard, strict row mapping, archived builder read-only);
        Programs regression 5→10 groups. Opus firsthand: tsc -b --force + build + full regression green.
        BROWSER-PROVEN on 375px against farm-rx TEST (then cleaned up): created program (persisted to
        DB), added 2 passes w/ free-type products (persisted), reordered (Move down swapped seq 1/2),
        EDITED a pass and it STAYED in place (P1-1 fix), archived program (is_archived=true, left active
        list, shows under Show-archived w/ Archived badge), 0px horizontal overflow at 375px. Commit: (this).
  - [x] CHUNK 3 assign + season tracker DONE + BROWSER-PROVEN 2026-07-12 (Terra build): "Assign to
        fields" (program picker → crop-year checkboxes reading "Field — Commodity — Year — planting N")
        + "Season progress" tracker (grouped by crop, then program w/ kind badge; per-pass Apply/Skip/
        Reschedule; per-assignment Refresh/Reassign/Unassign). mark-applied called with
        create_record=false + record_id=null (NO application record this chunk — Chunk 5). Sol review:
        2 P1 (canonical echo not fully validated before queue-head removal; offline projection faked
        actionable assignment IDs + misattributed reassign history) + 3 P2 (archived terminal history
        hidden; picker didn't show existing programs / block dup; regression not faithful) + 1 P3 — ALL
        fixed by Terra (full canonical read-back before 'synced'; non-actionable pending placeholders;
        archived terminal tracks visible read-only; picker shows/blocks dup w/ specific message; regression
        5→22 groups w/ malformed-echo + lost-response per op). Opus firsthand: tsc + build + regression green.
        BROWSER-PROVEN on farm-rx TEST (then cleaned): assign program→crop persisted (program_assignment +
        materialized pass "Post Herbicide" + product "Glyphosate 32 oz/ac", verified in Postgres); tracker
        rendered crop+program+pass; Apply→status='applied' 160ac, NO record created/linked, crop row
        untouched (160.00/2026-05-01). HONESTY NOTE: Opus first reported a "P0 assign writes nothing"
        smoking-gun — that was a TEST-HARNESS ERROR (the JS selector clicked the "Assign to fields" TAB,
        not the "Assign to 1 field" submit button); the assign flow was never broken. Sol's P1/P2/P3 were
        real + fixed regardless, so the fix round was legitimate. Lesson: confirm the RPC actually fired
        (network/root-cause) before declaring a code bug. Commit: (this).
  - [x] CHUNK 4 due passes → tasks + reminders DONE + BROWSER-PROVEN 2026-07-12 (Terra build):
        generate_due_program_items wired best-effort at farm-ready + Season-progress load + Notifications
        refresh; a due Planned pass raises ONE farm_tasks card (source='program', title=program+pass+field)
        + ONE deduped owner notification; Apply/Skip/Cancel close the card. Sol review: 1 P1 (editing a
        program card on the Tasks board dropped its linkage → strict mapper then rejected the WHOLE board
        = bricked) + 2 P2 (reconnect generated before queued Programs replay; notifications refresh raced
        its own generated alert) + P3 tests. FIXES: Opus added DB HARD GUARD **migration 0025**
        (farm_tasks_program_linkage_check: source='program' ⇒ both linkage cols NOT NULL — applied to TEST +
        proven it rejects a bad row); Terra hid Edit/Delete on program cards (tap → /programs?pass=<id>),
        ran a 2nd best-effort generate AFTER replayProgramsQueue on reconnect, and a follow-up
        notification/bell refresh after generation (guarded). Regression: programDueItems 4 groups,
        Notifications 10, Tasks 10. Opus firsthand: tsc + build + full regression green. BROWSER-PROVEN on
        farm-rx TEST (then cleaned): due pass → exactly 1 board card + 1 notification; repeated generate =
        still 1/1 (no spam); Apply → card done + pass applied; program card has NO Edit/Delete and taps
        through to /programs?pass=550e824e…; DB guard rejects a linkage-less program task. 25 migrations
        now (0024 programs + 0025 guard). Commit: (this).
  - [x] CHUNK 5 weather spray-light + Apply→application-record (link/create-draft) + planned-vs-actual
        cost — DONE + BROWSER-PROVEN on farm-rx TEST 2026-07-12 (commit: this). Terra build → Sol review
        found 6 P1 blockers (tracker rewrite dropped Skip/Reschedule/Refresh/Reassign/Unassign; partial-
        cost crash; link reported-as-failure; completed-link broke Inventory; offline apply didn't stick;
        + migration hygiene) → Terra fix round 1 → Sol re-review found 3 more (link trusted client canonical
        values; program rows dropped farm_id tenant check; product-less draft not actually rendered) →
        Terra fix round 2. Opus authored migration 0026 (CREATE OR REPLACE the two cost views: gate
        planned_cost_per_acre/total to NULL unless every planned line priced, append known-lines sums);
        APPLIED + registered to farm-rx TEST (26 migrations now). Opus firsthand: tsc -b --force + build +
        full regression green (Programs 23, Chunk5 4 behavioral, Inventory 9). BROWSER-PROVEN against live
        farm-rx via the real app client + RPCs (then fully cleaned up): (1) mixed priced/unpriced program →
        view returns is_complete=false, per_acre=NULL, known=$12; tracker shows "Partial estimate: $12.00/ac
        known lines", NEVER $0. (2) Season tracker at 375px shows ALL restored controls (Apply/Skip/
        Reschedule/Reassign/Unassign) + spray light "Good · wind 3–10 mph As of…" on the planned SPRAY pass
        only, status word once. (3) Apply→create-draft: on-hand 20gal UNCHANGED, draft status='draft'/
        un-posted, ZERO inventory application_products, free-type lines only via program_application_products
        view. (4) Inventory Spray-record tab renders the product-less draft safely as "Draft / un-posted",
        "on-hand was not changed". (5) Link to a COMPLETED record submitting 2026-07-25/99ac → server stored
        the record's own 2026-07-12/40ac (canonicalizes to server truth, ignores client values). Regression
        adds: stale/false client canonical rejected; foreign-farm program row rejected; behavioral draft/
        completed render derivation. Regenerated verify login note in docs/build-notes/verify-login.md.
  - [x] CHUNK 6 polish + full Programs regression sweep — DONE + BROWSER-PROVEN on farm-rx TEST
        2026-07-12 (commit: this). Terra: friendlier loading/empty states across My programs, Assign,
        Season progress (+ loadFailed state), archived "view only" wording + dashed-border styling +
        archived-badge, cleaner Inventory program-records copy, and a 375px overflow guard
        (max-width:100% + overflow-x:clip on programs-page/cards). Copy/CSS only — no logic/contract
        change; existing regression coverage audited as complete (Programs 23, Chunk5 4, Inventory 9 all
        green). Opus firsthand: tsc -b --force + build + full regression green. BROWSER-PROVEN at 375px:
        "No programs yet." + "No program history yet." empty states read in plain English; ZERO
        horizontal overflow (scrollW==clientW==375). Low-risk polish → verified proportionally (no full
        Sol review needed for copy/CSS).
        **>>> MODULE 8 (PROGRAMS) COMPLETE: chunks 1–6 all done, proven, committed. <<<**
  - [x] **FARM RX PUSHED + DEPLOYED TO PRODUCTION 2026-07-12** (Mason OK'd push + deploy). All local
        history pushed to GitHub git@github.com:masonwells1/FarmRx.git (main). Mason connected the repo
        to Vercel → **https://farm-rx.vercel.app** (auto-deploys on every future push). vercel.json =
        Vite + SPA rewrite; NO env vars (supabaseConfig ships the PUBLIC publishable key; RLS protects).
        Supabase Auth site_url + uri_allow_list set to the prod URL (was localhost:3000). LIVE E2E
        PROVEN over HTTPS in browser: login (farmtest@) → /fields real data (2 fields/245.5ac) →
        /programs renders; deep-link /programs serves the app (no 404); no console errors; signed out.
        OPEN PROD FOLLOW-UPS (Mason's calls): custom SMTP for real signup/reset emails (default SMTP is
        test-rate-limited; email-confirm is ON); public signups still OPEN (disable_signup=False — likely
        want OFF + provision-customer.mjs); test farm/accounts still in prod DB (RLS-isolated); phone-push
        SEND still gated (in-app alerts work).
      OPERATING MODEL (Mason 2026-07-12): **Opus = orchestrator** (plan/delegate/verify-in-browser/
      report). **Terra + Luna = the everyday workers** (most chunks; Terra modules/UI, Luna boilerplate/
      docs/mechanical). **Sol = complex/architectural work AND Opus's peer advisor** (equal-or-better —
      consult Sol on hard calls, don't just delegate down). **DOUBLE REVIEW on every build: Codex
      self-review (Sol adversarial) THEN Opus review** before anything is called done + browser-proven.

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
6. Polish — DONE 2026-07-12 (Fable, commit b5aa3d0, all browser-proven live): neutral
   sign-out (deliberate sign-out no longer shows "Your sign-in ended"); profitability
   privacy-denial now matches grain's honest wording; equipment service log auto-closes
   leftover reminder task cards (parked P3 from Modules 5/6). STILL OPEN: Resend email
   key for the deployed deliver-grain-alert function (it fails safe with a farmer-friendly
   error until a RESEND_API_KEY secret is added — needs a Resend account, Mason decision).
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
