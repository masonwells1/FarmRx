# Profitability Upgrade Spec — LOCKED 2026-07-12 (owner-interviewed)

Status: **design locked, build deferred until after the SHIP GATE** (Fields + Grain in front
of real customers). This spec is the instant-start brief for that build session. It extends —
does not replace — `profitability-live-design.md`, migrations 0006/0007/0013/0014, and the
already-verified Module 4 UI.

Companion research: `profitability-research-2026-07.md` (competitor landscape, university
methodology, farmer UX — the evidence behind every choice here). Source workbook:
Mason's `2026 Cost of Production Calculator.xlsx` (Desktop / FUTURE ADDITIONS folder).

## Owner decisions (interview 2026-07-12)

1. **Home: FarmRx Module 4.** Not CRX-Manager. (CRX-Manager stays read-only reference.)
2. **Cost depth: progressive.** Simple cash-cost mode by default (works like Mason's Excel);
   an "Advanced costs" toggle reveals the hidden lines (machinery ownership/depreciation,
   operating interest, labor, family living, owned-land opportunity cost) pre-filled from
   university defaults, plus a "what am I forgetting?" coach.
3. **V1 must-have: Plan A/B/C comparison + Input ROI Analyzer** (the Excel's soul).
   Everything else is roadmap (V2/V3 below).
4. **Timing: parallel design only.** Fields + Grain keep priority; build starts after the gate
   (existing REMAINING work — apply 0006/0007, live swap, PDF export — still comes first).

## V1 scope (build after ship gate, after live swap)

### A. Named input plans per crop, compared side by side
- A farmer can hold several budgets for the same crop-year + commodity as **named plans**
  (e.g., Corn "Full Program" / "Cheap" / "Non-GMO"). Implementation direction: add a
  `plan_label` (nullable text) to `crop_budgets` and treat sibling budgets sharing
  (farm, crop_year, commodity) as one comparison set — copy-budget (0013) already makes
  creating a plan from an existing budget one tap. No new tables expected.
- Comparison screen: rows = plans, columns = the farm's arrangements (cash rent / crop share /
  flex / owned, from `arrangements`), cells = expected profit $/ac; **WINNER badge per column**
  (mirrors Excel Breakeven Calculator B16-F25).
- Per-plan **margin-of-safety cushions**: price cushion = expected price − breakeven price;
  yield cushion = expected yield − breakeven yield (mirrors Excel H8-J17). Derivable from the
  existing `crop_budget_analysis` view — UI work, not schema work.

### B. Input ROI Analyzer (Excel "Input ROI Analyzer" sheet, generalized)
- Pick any two plans of the same crop: show cost difference $/ac, **extra bushels needed to
  break even = cost diff ÷ price** across a small price ladder, verdict tiers
  (Easy YES ≤ X bu / Likely worth it / Marginal / Probably NO — thresholds per crop, corn ≈
  6/10/15 bu, beans ≈ 1/2/3 bu, editable), and a personal what-if: "I expect +N bu" →
  $ win/loss per acre verdict. Pure client-side math on existing budget totals.
- Ship the Excel's rule-of-thumb reference (fungicide 8–15 bu corn / 2–4 bu beans, etc.)
  as an info panel, clearly labeled as general guidance.

### C. Progressive cost depth + university defaults
- Simple mode = the existing category list, cash costs only.
- Advanced toggle adds the gold-standard lines (already in the 0006 category enum:
  equipment_depreciation, interest, labor, land; plus custom lines for family-living draw
  and management charge).
- **Defaults library**: farmdoc 2026 Illinois budgets by region (northern / central-high /
  central-low / southern) as a static versioned JSON in the repo (no schema change; refresh
  annually — farmdoc revises Aug/Jan/May). Every defaulted value shows a "university default"
  badge until the farmer overwrites it → then "your number". Never silently mix the two.
- "What am I forgetting?" coach: if a budget lacks machinery ownership / operating interest /
  family living, show a calm one-line nudge with the typical $/ac (e.g., "Most IL budgets
  include ~$90/ac machinery depreciation — add it?"). Dismissible, never blocking.
- Convention (farmdoc): show BOTH breakevens — price to cover non-land costs vs total costs;
  government payments (ARC/PLC) display as a separate revenue line but stay OUT of breakeven math.

### V1 explicitly out
Live market-price-vs-breakeven + alerts, banker/landlord PDFs, CRX price auto-fill,
insurance floor, actuals-vs-budget, benchmarks — all roadmap (below). Excel/CSV export of
every table is cheap and trust-critical (research §5) — recommend slotting it as V1.5.

## Roadmap (owner-ranked later)

- **V2 — the weekly hook + artifacts**: market price vs my breakeven with % sold / bushels
  remaining (Grain module join), target alerts; branded banker packet (Nov–Feb loan renewal)
  and landlord report incl. crop-share expense splits (Aug–Oct rent season); CRX product-master
  price auto-fill (real current $/ac chem prices — unique moat; via the existing
  `budget_cost_lines.source_kind` hook + CRX inbox pattern from 0010/0011).
- **V3 — moats**: RP/ECO insurance floor overlaid on the matrix (effective floor price vs
  breakeven, unprotected gap $/bu); actuals-vs-budget living breakeven from application
  records/invoices; year-over-year; farmdoc benchmark comparison.

## Why this wins (one paragraph of evidence)
No commercial tool does rent-structure comparison on the farmer's own numbers (market standard
is Iowa State Excel files) and self-serve plan-vs-plan comparison is $1,600/yr (Harvest Profit)
or advisory-locked (AgYield). Mason's Excel already does both; Module 4 already does budgets,
dual breakevens, matrix, and lease comparison. V1 = merge them. Farmer-UX research: defaults
labeled + overwritable, financials private by default (0007 already does this), full export,
independence from big-ag — all trust levers we already align with.
