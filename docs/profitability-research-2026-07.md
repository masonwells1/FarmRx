# Profitability / Break-Even Tool — Research & Brainstorm (2026-07-12)

Synthesis of: Mason's Excel (2026 Cost of Production Calculator), the existing FarmRx
Profitability module, and three web-research deep-dives (commercial competitors,
university-extension methodology, farmer UX research).

---

## 1. What Mason's Excel does today (the feature bar to clear)

- **Assumptions hub**: cash rent $/ac, crop-share landlord %, 60/40 split %, target yields
- **Input plans**: line-item $/acre budgets — Corn Plan A (Full) / B (Cheap) / C (Non-GMO),
  Beans Full / Basic — ~20 categories each (seed+treatment, N/P/K/S by product, pre/post chem,
  fungicide, insurance, planting/spraying/combine/cart/side-dress ops, storage, drying, in-furrow, 2x2)
- **Breakeven dashboard**: P/L per acre for every plan × every rent structure; WINNER pick per
  rent structure; breakeven PRICE at target yield; breakeven YIELD at expected price;
  margin-of-safety cushions (price cushion, yield cushion per plan)
- **Profit matrices**: price × yield grids per plan per rent structure
- **Input ROI Analyzer**: extra bushels needed for the expensive program to beat the cheap one,
  verdict tiers ("Easy YES / Likely worth it / Marginal / Probably NO"), plus a personal
  what-if (expected extra yield × price → $ verdict)
- **Rent Comparison**: each plan across cash rent / crop share (2/3-1/3) / 60/40 split at
  multiple price-yield combos

## 2. What already exists in the codebases

### FarmRx — Module 4 "Profitability" is ALREADY BUILT (UI on mock data, browser-verified 2026-07-11)
- `src\ProfitabilityModule.tsx`, `src\data\profitabilityCalculations.ts`, full repository/gateway
  layer with offline queue; route `/profitability`
- Drafted (NOT applied) migrations: `0006_module4_profitability.sql` (crop_budgets,
  budget_cost_lines by category, matrix steps, field allocations, analysis views incl.
  breakeven price+yield, BU-to-cover, arrangement_comparisons, field_profitability),
  `0007` RLS (financials private by default), `0013` live RPCs, `0014` flex-lease methods
- Design docs: `docs\profitability-live-design.md`, `docs\flex-lease-research.md` (farmdoc
  lease types A–D), `docs\competitor-farmprofitmanager.md`
- Remaining per GOAL.md: apply 0006/0007, swap mock→live, branded PDF export.
  Sequenced AFTER the ship gate (Fields + Grain first).
- Leverageable data: fields + crop_assignments (planted acres), arrangements (owned/cash/flex/
  crop-share w/ landlord input shares), commodities, grain (bushels, basis math), harvest
  (actual yields), inventory, equipment/tasks, programs. `budget_cost_lines.source_kind` is a
  deliberate hook for pulling real costs later.

### CRX-Manager — no crop-budget tool, but gold-mine data
- Business-side margin reporting only (customer/product profitability, quote margins, commissions)
- PRODUCT_MASTER equivalent in-app: current cost, tier prices, **price-per-acre at suggested
  rates** for every chemical — could auto-fill a grower's chem program with real, current prices
- application_records (actual products applied per field per acre), invoices/orders/job costs,
  field acres (corn/soy split), crop programs/blend recipes

### Gap: Excel vs FarmRx Module 4
Module 4 already covers: budgets, cost lines, breakeven price+yield, price×yield matrix,
arrangement comparison, copy-budget, field allocation.
Excel does these things Module 4 does NOT yet:
1. **Multiple named input plans per crop compared side-by-side** with per-rent-structure winner
2. **Input ROI Analyzer** (extra-bushels-to-justify + verdict)
3. **Margin-of-safety cushions** (price/yield cushion per plan)
4. Rent-comparison grids at multiple price/yield points (Module 4 compares at expected point)

## 3. Competitor landscape (July 2026)

| Tool | Position | Price |
|---|---|---|
| Harvest Profit (John Deere) | Closest competitor; live P&L, CBOT-fed breakeven, scenarios, equipment costs, profit maps | $1,600/yr ($5,000 concierge) |
| Traction Ag | Ate Granular Business + Conservis; real farm accounting + field P&L | $1,140–4,740/yr |
| FBN Profit Center | Free breakeven + bid-ranking + alerts; shallow; company shrinking | Free (input-sales funded) |
| Bushel Farm (ex-FarmLogs) | Contract OCR, marketed-vs-breakeven; killed free tier, users burned | $75–599 + $999 machine-data |
| Syngenta AgriEdge/Cropwise | Good software gated behind $45–60k chemical spend | Input-spend gate |
| Ambrook | Modern ag bookkeeping, mobile-first; no agronomics | $720–1,200/yr |
| AgYield | Best price×yield what-if incl. options + crop insurance; advisory-locked | Advisory model |
| Granular | DEAD (2022) — cautionary tale: farmers orphaned | — |

**Opportunity gaps (best tools do poorly or paywall):** self-serve scenario/plan comparison;
price×yield matrices that include crop insurance floors; machinery cost allocation; automated
data-in (OCR of invoices/tickets — CropRx already has OCR pipeline experience!); year-over-year
+ benchmark analytics.

**What NOBODY does:** rent-structure decision support on the farmer's own numbers (market
standard = Iowa State Excel files C2-20/C2-21); per-landlord profitability + landlord-ready
reports; working mobile finance UX; AI on the money side; neutral affordable ~$300–600/yr tier
between free university spreadsheets and $1,600 Harvest Profit. **Mason's Excel's two best
features (rent comparison, plan A/B/C ROI) are exactly the unserved gaps.**

## 4. Gold-standard methodology (university extension)

**Structure to copy (farmdoc):** Gross revenue − non-land costs = operator & land return;
− land = farmer return. Non-land costs in 3 blocks: **Direct** (fert, pesticides, seed, drying,
storage, crop insurance) / **Power** (machine hire, utilities, repair, fuel, light vehicle,
machinery depreciation) / **Overhead** (hired labor, building repair+depreciation, farm
insurance, misc, non-land interest). Budgets per rotation position (corn-after-soy vs
corn-after-corn ≈ $60/ac worse) and region.

**Two breakevens, always:** price to cover non-land (variable) costs vs to cover TOTAL costs —
the gap = rent negotiating room. Same for yield. OSU "returns ladder" = short-run vs long-run
keep-planting test. Gov payments (ARC/PLC ~$22–25/ac) shown as separate revenue line but
**excluded from breakeven math** (farmdoc convention — decoupled, paid a year late).

**What homemade spreadsheets forget (coach these):** interest on operating capital (~7 mo ×
rate), machinery depreciation/ownership (~$80–96/ac!), unpaid family labor, owned-land
opportunity cost, management charge (OSU: 5% of gross), hauling, **family living draw
($43/ac + $42/ac taxes in IL FBFM 2024 ≈ $0.37/bu on 230-bu corn)**.

**Rent structures (farmdoc):** fixed cash (2026 IL: north $293, central-high $321, central-low
$279, south $186); crop share (50/50 north/central IL — split revenue+gov+insurance AND direct
costs; 1/3–2/3 southern); variable cash two families: (a) rent-factor × actual gross revenue,
bounded ±$100 (corn ~30%, soy ~40% north/central) and (b) base + bonus = 50% of revenue above
(base rent + non-land costs). Risk-sharing correlation with operator returns: share .94,
variable .82, fixed .57.

**Insurance floor (the missing downside math):** RP guarantee = APH × coverage% ×
max(projected, harvest price). Compare effective floor price vs breakeven — e.g. $4.85
breakeven vs $3.87 floor = $0.98/bu unprotected. ECO extends to 90–95%. 2026 RMA projected:
corn $4.62, soy $11.09.

**2026 shipping defaults (farmdoc May-2026 rev, central-IL high):** corn 241 bu @ $4.50,
non-land $833/ac (direct 534 / power 181 / overhead 118), land $321, breakevens $3.46/$4.79;
soy 76 bu @ $11.50, non-land $511, breakevens $6.72/$10.95. All four IL regions available.

**Machine-readable annual sources:** OSU xlsx (open), ISU AgDM xlsx (stable URLs but behind a
JS bot-blocker — needs headless fetch), farmdoc PDFs (parse cleanly, 3 revisions/yr),
Purdue spreadsheet, USDA ERS CSV. → an annual "refresh defaults" job is feasible.

## 5. Farmer UX research — what makes it get USED

- Abandonment: cost 40%, integration 33%, not user-friendly 19% (Purdue); 70% of users felt
  needs unmet; willingness to pay < ~$5/acre/yr. Excel wins on free/private/trust/flexibility.
- **The weekly hook is marketing, not budgeting**: "market price vs MY breakeven, % sold,
  alert me at my target" — budgets get opened twice a year.
- Decision moments: grain marketing (year-round), input buying (Oct–Feb), rent negotiation
  (Aug–Oct — per-farm breakeven printout is the negotiation artifact), mid-season input cuts,
  **banker/loan renewal (Nov–Feb: projected cash flow + breakeven by crop + balance sheet =
  "banker packet")**.
- Landlord report (per-field inputs/yields/share-splits) = unserved retention weapon.
- Mobile captures / desktop plans; 82% of farms have smartphones, cellular-reliant; offline matters.
- Trust: university defaults labeled as such, overwritable line-by-line ("default" vs "your
  number" badges); full Excel export non-negotiable ("my data is not blocked"); independence
  from big ag (Deere data-privacy investigation 2026) is marketable; financial data = most
  sensitive tier (keep private-by-default RLS).

## 6. Proposed shape (draft — pending owner interview)

**V1 — finish + port the Excel (the planning core):**
- Apply Module 4 migrations, swap to live
- Add **named input plans per crop** (A/B/C) w/ side-by-side P/L per rent structure + winner
- Add **Input ROI Analyzer** + margin-of-safety cushions
- Progressive budget depth: simple cash-cost mode (like the Excel) + "advanced costs" toggle
  (machinery ownership, operating interest, labor, family living) with university defaults +
  "what am I forgetting?" coach
- University-budget smart defaults by region/crop, labeled + overwritable
- Full Excel/CSV export

**V2 — the weekly hook + the artifacts:**
- Live breakeven vs market price, % sold / bushels remaining (Grain module integration),
  target-price alerts
- Branded PDF: banker packet + landlord report (incl. crop-share expense splits)
- Auto-fill chem/fert prices from CRX product master (real current prices — unique moat)

**V3 — the moats:**
- Insurance floor overlay (RP/ECO effective floor vs breakeven in the matrix)
- Actuals-vs-budget (application records/invoices → living breakeven), year-over-year
- Sub-field / per-landlord profitability; benchmark vs university budgets

Full agent reports live in the session transcripts; this doc is the durable synthesis.
