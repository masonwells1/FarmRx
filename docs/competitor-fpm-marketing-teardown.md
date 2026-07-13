# Farm Profit Manager — Marketing + Bins + Budget teardown (hands-on, 2026-07-13)

Walked live in Mason's Wells Farm Group trial account (farmprofitmanager.app) at his request.
Focus: Marketing tab structure, Cost of Carry, Alerts, Firm Offers, Grain Bins, and the
Crops→Budget page. Complements docs/competitor-farmprofitmanager.md (earlier teardown).

## Their information architecture (what Mason wants us to copy)
- **Left sidebar = sections**: Dashboard, Crops, Marketing, Equipment, Fields, Inputs,
  Finances, Planning, Reports, Tools, Services, Settings. Sections expand to show
  children (Crops → Corn / Soybeans as sub-items when inside).
- **Top tab bar INSIDE a section** segments the work: Marketing = `Overview | Marketing
  Plan | Cost of Carry | Alerts | Firm Offers | Grain Bins`, each its own route
  (/marketing, /marketing/plan, /marketing/cost-of-carry, /marketing/alerts,
  /marketing/offers, /marketing/bins).
- Year selector in the top chrome (‹ 2026 ›) scopes every page. Page titles carry the year
  ("Marketing Plan - 2026").
- Every page: KPI card strip on top → content cards below. Never one endless page.

## Marketing → Overview
KPIs: Production | Sold | Remaining | % Marketed | Unpriced (bu). Per-crop cards:
Marketed % + progress bar, sold/production bu, Remaining bu, Avg Price, Avg Basis,
Revenue, buttons Sales / Targets.

## Marketing → Marketing Plan
- KPIs: Production, Marketed, % Marketed, Unsold, Avg Price, Revenue. "Refresh Futures" + print.
- **INSIGHTS & ALERTS strip** (count badge): e.g. "Corn: Behind plan for this point in the
  year" / "Soybeans: No marketing plan set — consider building a plan".
- Per-crop plan cards: Marketed %, progress bar, Remaining, Avg Price, **Plan Total %**,
  status chip (Behind / Not Started), Strategy button, bin note ("5,000 bu in 1 bin"), Sales →.
- **Second-level tabs**: Monthly Plan | Actual vs Plan | Progress Chart | Grain Inventory |
  Quick Setup.
  - Monthly Plan: per crop, 12 month cells with % to sell; under each month header the
    futures CONTRACT month + live futures price; green intensity by %; total must hit 100%;
    "Click any cell to set targets — live futures shown".
  - Actual vs Plan table: Month, Planned %, Planned Bu, Target Price, Futures (live),
    Actual Bu, Avg Price, **Variance (red)**, Contract, Status bar.

## Marketing → Cost of Carry (store vs sell — decision page)
- Global inputs: "How do you pay for storage?" Option A Monthly Storage Rate (¢/bu/mo) /
  Option B Flat Rate; Interest Rate %; 2nd-Haul Trucking $/bu.
- Per crop: Harvest month select, Default Basis, Refresh Prices, print.
- KPIs: Harvest Cash/bu | Best Stored Month | Best Net vs Harvest | **VERDICT ("Deliver at
  Harvest")**.
- Table rows = delivery months (harvest ★ baseline): Contract, Market Price $/bu (editable),
  Basis (editable), Cash Price, Mo stored, Storage $, Interest $, Trucking $, Total Carry,
  **Net vs Harvest (red/green)**. Footer plain-English: "Harvest Delivery Wins — No stored
  month beats harvest delivery of $11.975/bu" (−$0.05/bu).

## Marketing → Alerts (exactly Mason's ask)
- **Alert Email(s)** field (comma-separated; farmer + advisor) — emailed when rules trigger.
- **BREAK-EVEN PRICES strip pulled from budgets** (Corn $3.74/bu, Soybeans $8.60/bu) —
  the profitability→marketing tie-in, always visible while setting targets.
- Alert Rules list; empty state offers 3 templates:
  1. **Price Target** — crop, direction (at-or-above/below), target $/bu, note/message,
     Active toggle; "Alert when futures price is at or above your target".
  2. **Marketing % Goal** — remind when behind a % marketed goal.
  3. **Deadline Reminder** — date-based nudge.
  Each rule row: type icon, crop select, fields, Active toggle, Save/Delete, + Add Rule.
- Collapsible **Live Market Prices** panel at bottom.

## Marketing → Firm Offers
- Purpose (their empty-state copy): "Track open buyer bids and working orders here. They
  feed your projected position on the sales pages until you fill them."
- Add Firm Offer modal: Buyer (e.g. ADM, local elevator), Offer Type (Cash/…), Budget
  (crop), Bushels, Price, Basis, Contract Mo., Offer Expires (date), Delivery Location, Notes.

## Marketing → Grain Bins (Mason: "very nice, very good detail and aesthetics")
- Bin cards: name + shape chip (Round), **fill bar with bu / capacity and %**, Crop,
  **Moisture % with last-checked date (red when high — 15.5%)**, location pin (Home Farm),
  collapsible **Transactions** ledger per bin (+ Add), edit/delete. "+ Add Bin".
- Add Bin modal: Name, Type, Capacity (bu), Opening Bushels ("live total updates as you
  add transactions"), Crop, Location, Moisture %, Last Checked, Notes.
- Bins feed the Marketing Plan cards ("5,000 bu in 1 bin") and Grain Inventory sub-tab.

## Crops → [Crop] → Budget (their profitability page)
- Sidebar shows per-crop children (Corn, Soybeans) when in section.
- Crops overview: farm KPIs (Total acres/income/costs/profit), Cards/Table toggle, crop
  cards with big colored Profit/ac, Cost/ac, B/E yield, top-3 expense categories as mini
  bars, acres·yield·price footer, View budget →.
- Budget page: KPI strip (Income/ac, Cost/ac, **Break-even $/bu**, Profit/ac, Total Profit,
  ROI %), Yield/Price input strip (acres, yield, price, premium, unit) with inline
  "break-even 166.0 bu/ac", **Income Items** (+ Gov Payment, + Other Income — separate from
  crop revenue), **EXPENSES as collapsible categories** (General Expenses, Nutrients,
  Chemicals, Field Operations, Grain Handling — each n items + $/ac subtotal + ⋯ menu),
  + Add Category, Total $/ac and whole-farm $.
- **INSURANCE CALCULATOR on the budget page**: coverage % (80), APH (195), projected price
  (4.70), unit type → panels: Insurance Coverage (cost/ac $28, coverage total, % of COP,
  **Min. Rev. Guarantee $733.20/ac**), Dollars of Risk (income guarantee $1,099,800,
  % at risk 1.9%, investment at risk **$20,700** red), Bushels of Risk (bushel guarantee,
  per acre 156.0, % of total 80%, **Safe to Forward 234,000 bu**).
- ECONOMIC RESULTS ladder: Total bushels, Crop income/ac, Total income ‖ Total expenses,
  Expense/acre, Cost/bushel, **Gross Profit (green), Profit/Acre, Profit/Bushel, ROI**.

## Mason's directives from this review (2026-07-13)
1. FarmRx pages are too crowded — one huge page each. Adopt FPM's pattern: left-side
   sections + a top header-tab bar inside each section.
2. Wants: marketing alerts (price target hit, % marketed goal, deadline reminders),
   firm offers updating position, Cost of Carry, and FPM-grade Grain Bins.
