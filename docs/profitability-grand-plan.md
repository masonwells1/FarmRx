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
- [~] Chunk 2 schema drafts — drafted (Sol) + Claude-reviewed (additive-only ✓, append-only
      ledger ✓, RLS tiers ✓, no FOR UPDATE ✓) → **AWAITING MASON: "apply the phase-2 schema"**
- [ ] Chunk 3 Alerts — blocked on 0027 apply (+ Resend key for email leg)
- [ ] Chunk 4 Firm Offers — blocked on 0028 apply
- [ ] Chunk 5 Bins upgrade — blocked on 0029 apply
- [ ] Chunk 6 Insurance calculator — blocked on 0030 apply
- [ ] Chunk 7 Overview upgrade — no DB dependency
- [ ] Chunk 8 Landlord report — no DB dependency
