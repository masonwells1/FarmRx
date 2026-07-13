# Profitability Grand Upgrade Plan — Farm Rx

**Owner:** Mason · **Authored:** 2026-07-13 (Fable, C:\ session) · **Status:** ACTIVE — Claude
orchestrates, Codex builds, every chunk gated by Sol review + Claude browser-proof, then
committed and pushed (Mason pre-approved pushes for this loop 2026-07-13; pushes auto-deploy
to farm-rx.vercel.app). **Live-DB migrations still pause for Mason's explicit OK.**

---

## The plan in plain English (read this part, skip the rest)

Farm Rx already answers *"what does it cost me to grow an acre and what do I need to sell it
for?"* — budgets, break-evens, the price×yield matrix, rent comparison, plan A/B/C, the ROI
analyzer, and the banker report are all live. This upgrade makes the money side of Farm Rx a
**decision machine a farmer opens every week**, by adding the six things we confirmed farmers
use and competitors do poorly (hands-on Farm Profit Manager teardown, 2026-07-13):

1. **Cost of Carry** — "should I sell at harvest or store?" Enter what storage costs you;
   get a month-by-month table and a one-sentence verdict.
2. **Marketing Alerts** — set a price target, a % marketed goal, or a deadline; Farm Rx
   reminds you in the app and by email, with your real break-even shown while you set it.
3. **Firm Offers** — log the standing offer you left at the elevator; your marketing
   position shows it as pending until it fills or expires.
4. **Grain-bin upgrade** — fill bars, moisture with last-checked date (red when risky),
   and a per-bin in/out ledger.
5. **Insurance calculator** — coverage % + APH + projected price → your revenue floor per
   acre, dollars actually at risk, and "safe to forward" bushels.
6. **A real Overview** — per-crop profit cards (colored profit/ac, top costs, break-even)
   so the first screen answers "how does the year look?" in two seconds. Plus a
   landlord-ready report to close out the reports tab.

Everything follows the new Modern Farmstead design system and ships in small chunks —
each one built by Codex, adversarially reviewed, proven in a real browser on the live dev
farm, then pushed. Nothing touches the database without your explicit OK first.

**Your two action items** (blockers for specific chunks, not for starting):
- **Resend API key** — email alerts (chunk 3) can't send email without it (ledger's open
  polish item). In-app alerts work regardless.
- **Migration OK** — when the drafted schema for alerts/offers/bins/insurance is reviewed
  and presented, say "apply the phase-2 schema."

---

## Already done (do not re-plan)

- Module 4 complete + live (38154e8): budgets, cost lines w/ BU-TO-COVER, matrix w/
  breakeven cells, field allocations on equivalent cash rent, copy-budget, offline queue,
  private-by-default RLS. Banker report (d7f8e86). V1 upgrade (dbde219): plan A/B/C
  comparison w/ winner per arrangement, Input ROI Analyzer, cushions, U of I farmdoc-2026
  starter budget w/ "default vs your number" badges, coach, dual breakeven.
- Section tabs (5f55e2f): Profitability = Overview | Budgets | Compare plans | Reports;
  Grain = Overview | Marketing plan | Contracts | Bins & basis.
- Evidence base: docs/profitability-upgrade-spec.md (locked skeleton),
  docs/profitability-research-2026-07.md, docs/competitor-fpm-marketing-teardown.md,
  docs/competitor-farmprofitmanager.md, docs/flex-lease-research.md, Mason's Excel.

## Standing constraints (every chunk)

- Design system: docs/design/ (Modern Farmstead — cream bg, charcoal nav, white cards w/
  colored top-border stat boxes, Barlow Semi Condensed headings, green only for accents/
  total bars). Reference: docs/design/examples/final-modern-farmstead.html.
- Handoff rules: 18px+/48px+/tabular-nums/two-tap/plain English; financials private by
  default; no marketing advice — show numbers, farmer decides.
- Manual prices remain the math source (TradingView tiles display-only; CME licensing).
- DB: additive migrations only, drafted → Claude review → **Mason explicit OK** → apply.
  No SELECT..FOR UPDATE under RLS (0017 lesson).
- Gate per chunk: Codex build → Sol adversarial review → fixes → `npx tsc -b --force`
  clean + `npm run regression` green → Claude browser-proof on the live dev farm
  (farmtest) → commit → push.

## The chunks

**Chunk 1 — Cost of Carry (Grain → new "Cost of carry" tab).** Frontend-only, no DB.
Settings card ("How do you pay for storage?" — monthly ¢/bu/mo OR flat $/bu, interest %,
2nd-haul trucking $/bu; localStorage per farm for now). Per commodity (existing picker):
harvest month, default basis, then a row per delivery month (harvest → +12): editable
market price + basis → cash price, months stored, storage $, interest $, trucking $,
total carry, **net vs harvest** (red/green). KPI strip: harvest cash/bu, best stored
month, best net vs harvest, **plain-English VERDICT** ("Deliver at harvest" / "Store
until March"). Footer sentence like FPM's "no stored month beats harvest delivery of
$X". Pure math in src/data/costOfCarry.ts + regression suite. (Resolves ledger
decision #1 — approved by Mason 2026-07-13.)

**Chunk 2 — Phase-2 schema drafts (Sol; DRAFT ONLY, then MASON GATE).**
- 0027 marketing alerts: `grain_alert_settings` (farm-scoped alert emails — supersedes
  decision #4's owner-only default; Mason approved a second address 2026-07-13) +
  `marketing_alert_rules` (scope, rule_type price_target|pct_marketed_goal|deadline,
  direction, threshold, message, active).
- 0028 `firm_offers` (scope, buyer, offer type cash|basis|hta, bushels, price/basis,
  contract month, expires_on, delivery location, notes, status open|filled|expired|
  canceled, filled_contract_id).
- 0029 bins: additive `grain_bins` columns (moisture_pct, moisture_checked_on) +
  `bin_transactions` append-only ledger (direction, bushels, occurred_on, note) that
  reconciles with existing bin_inventory pattern (Sol must read 0004/0012 first).
- 0030 insurance on `crop_budgets` (rp_coverage_pct, rp_aph_yield, rp_projected_price,
  rp_premium_per_acre — nullable, additive).
- RLS per existing module patterns; explainer docs/schema-phase2-grain-marketing.md.

**Chunk 3 — Marketing Alerts (Grain → new "Alerts" tab).** Rules CRUD on 0027; break-even
strip from Module 4 (getBreakeven seam already exists) shown while setting targets;
evaluation on open extends existing evaluateGrainAlerts (check-on-open honesty stays);
email via existing owner-alert delivery path + alert emails from settings (**needs
Mason's Resend key to actually send; in-app works without it**). Templates row like FPM:
Price Target / % Marketed Goal / Deadline.

**Chunk 4 — Firm Offers (Grain → new "Firm offers" tab).** CRUD on 0028; position cards
and Safe-to-Forward math show "pending firm offers" bushels distinctly (projected, not
sold — honest wording); one-tap "filled → becomes contract" flow prefilling the existing
15-second contract entry; auto-expire display.

**Chunk 5 — Bins upgrade (Grain → "Bins & basis" tab).** FPM-grade bin cards: fill bar
(bu/capacity/%), crop badge (IP kept), moisture % + last-checked (red past threshold/age),
location, collapsible per-bin transactions ledger (0029), add/edit bin modal. Bushels
roll into marketing plan's "in bins" note.

**Chunk 6 — Insurance calculator (Profitability → Budgets tab).** Inputs (0030): coverage
% (50–95 incl. ECO note), APH, projected price (2026 RMA defaults corn $4.62 / soy
$11.09, labeled). Outputs: Min Revenue Guarantee $/ac, dollars of risk (income guarantee,
% at risk, investment at risk), bushels of risk (bushel guarantee, **Safe to Forward bu**).
Matrix optionally shades cells below the insurance floor (stretch). Safe-to-Forward
surfaces on Grain overview (Module 2's existing Safe-to-Forward gets the insurance-aware
number when present).

**Chunk 7 — Profitability Overview upgrade.** FPM-Crops-style per-crop cards replacing the
bare picker: colored Profit/ac, Cost/ac, break-even, top-3 cost categories as mini bars,
acres·yield·price footer, "View budget →" (jumps to Budgets tab with that budget
selected). Whole-farm KPI strip (total acres/income/costs/profit across allocated
budgets). Grouped, collapsible expense categories with subtotals on the Budgets tab.
Design-system polish pass across all Module 4 surfaces.

**Chunk 8 — Landlord report (Profitability → Reports tab).** Print-based like the banker
report: per-field plantings, inputs applied (rates/dates from application records where
present), yields, and crop-share expense settlement per the arrangement's split
percentages. Closes the upgrade-spec V2 report pair.

**Later (roadmap, not this loop):** CRX product-master price auto-fill (needs CRX↔FarmRx
inbox), actuals-vs-budget living breakeven, farmdoc benchmark comparison, year-over-year.

## Chunk status ledger (update as gates pass)

- [x] Chunk 1 Cost of Carry — DONE 2026-07-13: Terra build → Sol review (2 P1 + 1 P2, all
      fixed: harvest-month change now resets rows instead of silently relabeling typed
      prices; carry settings localStorage now farm-namespaced; negative saved rates clamped
      on read) → Claude browser-proof (FPM example numbers reproduced: $4.37 harvest cash,
      Dec net −$0.04; verdict flips to "Store until Dec 2026" at +$0.15; year rollover,
      375px, 0 console errors) → pushed
- [x] Chunk 2 schema — APPLIED 2026-07-13 (Mason said "apply the phase-2 schema"): 0027-0030
      applied to the farm-rx Supabase project in order, verified live (4 new tables w/ RLS
      enabled + expected policy counts; append-only bin ledger has select+insert policies
      only, matching the 0010/0011 house pattern; crop_budgets +4 rp_* cols; grain_bins
      +moisture cols; security advisors show NO new findings; app loads clean against the
      new schema on /profitability and /grain)
- [x] Chunk 3 Alerts — DONE 2026-07-13: Terra build (Alerts tab: Price Target / % Marketed
      Goal / Deadline templates, rules CRUD on 0027, break-even strip, check-on-open eval
      wired into evaluateGrainAlerts, alert-emails settings, offline queue support) → Sol
      review (4 P1 + 7 P2 + 1 P3) + 1 orchestrator finding, ALL 12 fixed by Terra: edge fn
      accepts marketing_* kinds + sends to settings emails; Add basis got an optional cash
      price field (price alerts were unfireable without it); deadline window bounded 0–7
      days (yesterday no longer fires forever); deletes verify the deleted id (RLS zero-row
      no longer fakes success); device-local day replaces UTC for today/suppression; fired
      price message states the bid date; orphan-scope pct rules skipped + "Other alerts"
      management list; scope labels include entity ("— whole farm"); queue validates rule
      semantics; farmerError on all actions; Saved whisper clears on edit; "Currently X%
      marketed" shown in goal form → Claude gates (tsc/regression/build all pass) →
      browser-proof: $4.25 cash bid entered via the new field, $4.00 rule FIRED live
      ("cash price is $4.25 (bid Jul 13)"); yesterday-deadline rule did NOT fire
      (last_triggered_at stayed NULL); orphan rule shown under Other alerts, deleted via UI,
      row gone from DB; email settings saved to grain_alert_settings (2 addresses); whisper
      clear proven; 375px no overflow, 48px targets, 0 console errors → edge function v2
      DEPLOYED to farm-rx project: logs show v1 rejected marketing alerts with 400, v2
      accepts them and reaches the email step (503 only because Mason's Resend key is still
      pending — in-app notice stays honest) → pushed
- [x] Chunk 4 Firm Offers — DONE 2026-07-13: Terra build (Firm offers tab on 0028: CRUD,
      status groups Open/Filled/Expired/Canceled, display-only expiry via device-local day,
      "Mark filled" one-tap flow prefilling the 15-second contract entry then linking
      filled_contract_id, "pending, not sold" line on the overview position card, orphan
      "Other firm offers" management list, full seam + queue support) → Sol review (2 P1 +
      3 P2 + 2 P3, all fixed by Terra: fill submit lock + retained-contract retry; edit
      preserves the offer's own scope; old local envelopes tolerate missing firm_offers;
      no more invented Sep–Nov delivery dates (blank when no month, full range when month);
      expires_on validated; table-driven fill-mapping regressions; canonical sameScope) →
      Claude found the submit "lock" was state-only and STILL allowed re-entrancy (triple
      submit created 3 contracts live) — fixed with a synchronous ref lock on both the
      contract fill form and the firm-offer form → browser-proof: offer created via form
      (DB row verified); overview showed "5,000 bu on firm offer — pending, not sold" with
      Fully priced 0 bu, then after fill flipped to Fully priced 5,000 bu with no pending
      line; fill created a real contract linked from the offer; DB-open offer past expiry
      displayed as Expired with DB status untouched and excluded from pending; orphan 2025
      offer edited while picker on 2026 kept crop_year 2025; 5 rapid submits after the ref
      fix produced exactly 1 contract (was 3 before); 375px no overflow, 48px targets →
      gates (tsc/regression×21/build) pass → pushed
- [x] Chunk 5 Bins upgrade — DONE 2026-07-13: Terra build (bin cards with fill bar +
      IP crop badge + moisture flag, add/edit bin form, per-bin APPEND-ONLY movement
      ledger on 0029 with plain-English "add an opposite movement" corrections, derived
      on-hand = inventory + in − out clamped at 0 with honest note, seam + queue) → Sol
      review (3 P1 + 3 P2 + 1 P3; Claude independently found P1#3 live first) all fixed:
      queue replay reconciles 23505 duplicate-key so a lost response can't jam offline
      saves forever; movement commodity locked to the bin's established crop; plan "in
      bins" now derives from ALL bins incl. movement-only (was 0 while the card said
      12,000); entity cards label the figure whole-farm; moisture both-or-neither +
      future dates rejected + undated readings flagged; useRef submit locks on bin +
      movement forms → browser-proof: bin created via form (DB verified 16.50%/2026-07-10,
      "Moisture is over 15%" flag rendered); In 12,000 bu → fill bar 12,000/20,000 · 60%;
      overdraw showed 0 bu + honest note then opposite-movement correction restored
      12,000 with full history; plan flipped 0 → "12,000 bu in bins"; commodity selector
      verified disabled+locked; future moisture date and pct-without-date both rejected
      with plain messages; 4 rapid submits → exactly 1 ledger row; 375px clean → gates
      (tsc/regression×22/build) pass → pushed
- [x] Chunk 6 Insurance calculator — DONE 2026-07-13: Terra build (RP inputs card on 0030
      cols, entered-number outputs, matrix shading, grain-overview safe-to-forward tie-in,
      seam + queue) → Sol review (5 P1 + 4 P2) all fixed: outputs reworded as entered-number
      arithmetic (never a policy promise) + unmissable 86–95% ECO/SCO county-based warning;
      safe-to-forward aggregates ALL matching allocated budgets (was .find one) and no
      longer caps by production before subtracting contracts; premium labeled reference-only
      (never double-counted into risk); legacy offline queue entries without rp_* fields
      normalized instead of stranded; the four fields share ONE draft with serialized
      debounced saves (rapid tabbing had clobbered earlier fields — observed live pre-fix);
      RMA placeholders restricted to exact corn_yellow/soybeans ids; legacy mock budgets
      normalized; calculator text ≥18px + Claude added a NaN guard on numeric input parsing
      → browser-proof (hand-verified): 80%/180 APH/$4.62 → 144 bu/ac floor, $665.28/ac
      revenue floor, $106,444.80 · 160 ac, $207.47/ac cost gap; rapid four-field entry
      persisted ALL FOUR to DB (the pre-fix race lost two); ECO warning rendered at 90%;
      non-GMO corn placeholder no longer inherits the $4.62 RMA default; grain overview
      "Safe to forward 18,040 bu — from entered coverage: 23,040 bu − 5,000 bu contracted"
      verified against DB contracts; smallest calculator font 18px computed; 375px no
      overflow → gates (tsc/regression×23/build) pass → pushed
- [x] Chunk 7 Overview upgrade — DONE 2026-07-13: Terra build (per-crop cards, whole-farm
      KPI strip, year picker, grouped collapsible expense categories) → Sol review (3 P1, all
      fixed: dual "before land" breakeven restored on cards; whole-farm totals now suppressed
      with a plain note when two budgets allocate the same field (double-count guard); year
      picker syncs the selected budget + selected card highlighted + matrix labeled with its
      budget) → Claude browser-proof (card math hand-checked vs matrix; category collapse +
      line move between groups proven live; whole-farm strip proven with 2 fields: $222,324.75
      income / $11,107.75 profit hand-verified incl. owned-ground land replacement; overlap
      note proven by allocating the same field twice then reverting; 375px no overflow, 0
      console errors) → pushed. BONUS FIX shipped with this chunk: "Add crop record" on the
      field detail page was broken for ALL fields (toDraft hardcoded is_new:false → DB
      correctly rejected; farmer saw "could not save records"); one-line fix proven live
      (South Creek corn record now persists to Supabase).
- [x] Chunk 8 Landlord report — DONE 2026-07-13: Terra build (LandlordReport print pages,
      launcher w/ landlord picker + "All landlords" = page per landlord) → Sol review (10
      findings: 3 P1 incl. fractional-acre harvest undercounting crop value, settlement
      requiring a budget even when actuals exist, inputs read only from Programs w/ a false
      "no records" claim; 5 P2 incl. unlabeled budget choice, 12-15px green-on-white print,
      stale landlord selection; 2 P3) → Terra fix round (all 10) → Claude browser-proof
      (crop-share settlement hand-checked twice on the dev farm: projected path $34,627.50
      crop value / $9,242.55 expenses; harvested path via real UI entry of 15,000 bu →
      $33,750.00 = bushels×price exactly, yield 175.4 bu/ac labeled actual; honest inputs
      wording; "Using budget:" label; print CSS forced 18px+ black-on-white w/ page break
      per landlord; banker launcher restored to primary; 0 console errors) → pushed.
      NOTE for a future chunk: there is NO UI yet to enter landlord input-share
      percentages (landlord_seed_pct etc.) — the report shows them when present; test
      values were set via SQL on the test farm. Test farm now has South Creek as a
      crop-share field ("Test Landlord", 50/40/35) with 15,000 bu harvested corn.
