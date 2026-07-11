# Farm Profit Manager — hands-on analysis (2026-07-11)

Explored live in Mason's authorized demo account (`farmprofitmanager.app/app/wells-farm-group/main/2026/...`, fake data: 3,500 ac, 1,500 ac corn / 2,000 ac soybeans). I clicked through every section and edited real values to watch the math respond. Product is by **Ag View Solutions** ("nearly 30 years helping farmers profit" — footer on every page).

---

## ⚠ URGENT — findings that should influence Module 1 (Fields) being built RIGHT NOW

1. **Their "Add Field" is an inline table row, not a modal.** One tap on "+ Add Field" inserts an editable row directly in the field list: `Field name | Acres | Crop (dropdown) | Land Type (dropdown) | Land Cost $/ac`, with autosave ("Saved at 11:40 AM" toast in the corner). Zero navigation, ~10 seconds to a usable field. **Farm Rx's fast add/edit should match or beat this** — it is the best two-tap-rule implementation in the app.
2. **Land Type dropdown = exactly our four arrangements:** `Owned / Cash Rent / Crop Share / Flex Rent`. Validates the handoff list verbatim. Keep ours as a simple 4-option dropdown at the row level, with details behind an expandable "Land agreement" card (theirs holds Crop Share %, Land Cost $/ac, landlord name/phone/email).
3. **Crop-share nuance they surface in orange warning text:** *"Land cost currently assumes the landlord pays no input costs. If your lease splits expenses (seed, fertilizer, chemicals), set up Cost Sharing below so the equivalent cash rent nets them out."* They convert every arrangement to an **"equivalent cash rent"** number so land types compare apples-to-apples. Strong idea for our 4.2 arrangement comparison — adopt the "equivalent cash rent" concept.
4. **Field detail = four small cards, each with its own Edit:** `Field Basics` (acres, crop) · `Land agreement` · `Yield & price` ("Assign a crop to plan yield & price" — per-field yield/price overrides) · `Records` ("No FSA identifiers · no notes" — FSA IDs live here, matching our optional FSA farm/tract field). Clean chunking a 55-year-old can navigate; worth copying as the detail-page structure.
5. **Fields KPI row:** `Total Fields · Total Acres · Planted Acres · Avg Land Cost $/ac · Crops Assigned 0/1`. "Crops Assigned x/y" is a nice nudge metric that drives setup completion.
6. **Counter-example to us (do NOT copy):** in their model fields are *optional* — budgets run on crop-level acres alone and fields only refine land cost ("No fields have crops assigned. Assign crops to your fields to see profitability comparisons."). Farm Rx is fields-first (handoff Module 1: everything reads from Fields). Keep our order, but note their lesson: **the app must be useful before all fields are entered** — don't gate the Grain page on a complete field list.
7. They also offer a satellite **"Field Boundary"** map with "Search location or paste coordinate" + "Draw boundary" button per field, and a John Deere Ops Center sync upsell for boundaries. Not needed for our v1 — but the *placement* (inside field detail, not a separate GIS module) is right if we ever add it.

---

## What the app is

Farm Profit Manager is a farm financial-planning web app by consulting firm Ag View Solutions: crop budgets → breakevens → grain-marketing tracking → lender-grade reports, with an embedded AI assistant. The core app is **free**; they monetize a $2,495 one-time "Consulting & Setup" service, $20–40/mo add-ons (Tools + AI Suite, QuickBooks sync, John Deere Ops Center sync), and downstream consulting (transition planning, peer groups). It is budget-first and finance-first — much weaker on operational records (no spray/EPA compliance, thin field ops) — which leaves Farm Rx real differentiation room.

## Feature inventory (every section found)

- **Dashboard** — KPI stat cards (Total Acres, Total Income, Total Costs, Net Profit, % Marketed), "Daily Brief" market commentary ("WASDE Day — 11:00 AM CT..."), notifications feed, Crop Profitability cards ($/ac and cost/bu per crop), Marketing Position bars per crop, Upcoming Tasks/Events, Crop Details table, Equipment Summary, Firm Offers, "Customize dashboard" button.
- **Crops** — crop cards (Profit/ac, Cost/ac, B/E Yield, mini cost-category bars) + Cards/Table toggle; per-crop **Budget** page (the input-cost engine, detailed below); Add Crop modal; Manage Crops.
- **Marketing** — sub-tabs: Overview, Marketing Plan, Cost of Carry, Alerts, Firm Offers, Grain Bins; per-crop Sales and Targets pages (detailed below).
- **Equipment** — Manager (inline table: Power Units / Implements / Other; Name, Year, Leased ☑, Category, Value $, Useful Life, Annual Cost; Hours table w/ Engine Hours + As-Of), Operations, Loans, Capex Planning.
- **Fields** ("farm-ops") — list + Map + per-field Profitability tab (detailed above).
- **Inputs** — Chemicals and Fertilizers, each with Summary / Inputs / Programs / Order Planner / Inventory / Mixing tabs; "Buffer factor" (1.05 default = order 5% extra); Program Cost Summary ($/Acre, $/Unit, Acres, Total Cost); "Create programs for each spray pass."
- **Finances** — Total Assets/Liabilities/Net Worth/Overhead/Debt KPIs; Balance Sheet, Cash Flow (monthly projections), Overhead, Loans (amortization), **"Return to Management"** ("What's left after all costs").
- **Planning** — calendar + tasks + "Employee Sheets — time tracking and work logs for your team."
- **Analytics** — Profit by Crop, Cost Breakdown donut (Fixed 39% / Variable 42% / Field Ops 19%), Marketing Progress, Top 10 Expenses, "View Benchmarks."
- **Reports** (Generate + History tabs, one-click "Generate Report" each):
  - *Financial:* **Lender Packet** ("balance sheet, cash flow, debt summary, grain position, and key ratios"), Projected Cash Flow, Balance Sheet, Debt Summary, Debt Service Coverage, Working Capital/Liquidity, Accrual Profitability, Tax Planning Summary.
  - *Crop & Marketing:* Cost of Production/Break-even, Enterprise Profitability, **Field Profitability** ("Best and worst fields by profit per acre, not just yield"), Grain Position ("produced, sold, stored, contracted, and still unpriced"), **Contract Commitment** ("open contracts, delivery windows, buyer, contract type, and overcommitment risk"), Budget vs Actual Variance.
  - *Land & Equipment:* Land/Rent Performance ("margin by farm or landlord"), Equipment/Capital.
  - *Analysis:* **Financial Risk Summary** ("Plain-English summary of strengths, weaknesses, and what a lender or landlord would question").
- **Tools** ("Useful Tools") — Should I Buy Land?, Should I Build Storage?, Land Value Projection, **3% Better Calculator** ("improve costs, yields, and prices by just 3%"), Margin Enhancement, **Phantom Yield Loss** (moisture-point drying loss / "should you harvest wet?"), Fall Price Indemnity (RP insurance indemnity estimator), **Break-Even Matrix** (their profitability matrix — detailed below), Insurance Decision, Capital Expenditure Planning, Document Scanner.
- **Services** — pricing & consulting page (see business-model notes).
- **Settings** — General (farm details, county/zip; units; alert emails), Integrations, Subscription, **Team** (members with roles — "owner" badge, invite w/ Role dropdown), Memory (AI memory), Data.
- **AI assistant** (floating, every page) — "Ask about profitability, record sales, manage tasks, analyze budgets"; chips: "How's my whole farm doing? / What's my breakeven price? / What if prices drop 10%? / How profitable are my crops?"; file-upload, "Scan a document or photo," voice input; renders **interactive widgets in-chat** (see below).
- **Top bar** — entity switcher ("Add Entity"), **year switcher (‹ 2026 ›)**, Add task, Support, "Share an idea."
- **Mobile** — bottom tab bar (Dashboard, Crops, Marketing, Finances, More) exists in the DOM; app is responsive.

## The marketing piece, in detail

This is a genuinely well-designed module. Structure: **Marketing → Overview | Marketing Plan | Cost of Carry | Alerts | Firm Offers | Grain Bins**, plus per-crop **Sales** and **Targets** pages (sidebar expands to show Corn / Soybeans under Marketing).

**Overview** — whole-farm KPI strip: `PRODUCTION 420k bu · SOLD 1.00k bu · REMAINING 419k bu · % MARKETED 0.2% · UNPRICED 419k bu`, then a card per crop: `MARKETED 0.3% · 1,000 bu / 300,000 bu · REMAINING · AVG PRICE $4.51 · AVG BASIS -$0.30 · REVENUE $4,510` with Sales/Targets buttons.

**Per-crop Sales page (the heart):**
- Header: "Corn Sales — 1,500 acres · 200 bu/ac expected yield" (production = acres × expected yield, straight from the crop budget; our 2.1 exactly).
- KPI row: `PRODUCTION 300k bu · CONTRACTED · REMAINING · % MARKETED · REVENUE · AVG PRICE · BREAK-EVEN $3.74/bu` — **breakeven from the budget sits right next to avg sold price.** Our 2.4 position view, confirmed working.
- **"MARK TO MARKET — REMAINING BUSHELS"** panel: editable `Market Price $/bu · Expected Basis $/bu · Expected Premium $/bu · Expected Fee $/bu · Contract Month (Sep 26 … Sep 28)` + a **"Fetch current futures price"** refresh button (clicking it pulled 4.395 for Sep 26, with "Last: 7/10/2026, 1:19:59 PM" timestamp). Outputs update live: `Remaining Value $1,314,105 · Total Portfolio Value $1,318,615 · Blended Avg Price $/bu $4.40`. I typed basis −0.30 and Remaining Value instantly dropped to $1,224,405 and Blended Avg to $4.10 — **this is our "blended expected revenue" (2.4) as a live, farmer-editable calculator.**
- **Sales table is inline-editable in place** (no modal): every row is live inputs — `Date | Contract # | Type | Bushels | Price | Basis | Premium | Fee` with computed `Final Price | Revenue`, per-row delete, sortable columns, "Customize" (column picker) and "Filters" buttons, and a "More" expander per row revealing `Buyer, Contract Mo., Notes, Status (Open), Delivery Start, Delivery End, Delivery Location`. A mobile-layout card shows `Final / Net / Revenue / **Margin: $0.77**` — margin over breakeven per bushel, per sale.
- **Contract Type dropdown (their taxonomy):** `Cash, Spot, HTA, Basis, NPE, Hedge, CBOT Hedge, Other`. (NPE = no price established. Ours: Cash/Spot, Forward Cash, Basis, HTA — theirs adds true board hedges; we deliberately exclude those.)
- "Print sales" button on the page header.

**Per-crop Targets page:** "Break-Even Prices — Corn $3.74/bu" strip on top, then "Add Target" → modal with **Target Type toggle: Cash | Futures | Basis**, each with its own helper sentence (tooltip: *"Futures: hedge on the board. Basis: lock basis at the elevator. Cash: sell delivered grain."*; Futures body: *"Sell on the board (CBOT short hedge) when futures hit this level. Basis fixed later."*; Basis: *"Lock basis at the elevator when basis hits this level. Futures fixed later."*). Fields: price (or basis), **% to Sell**, optional Contract Month, Notes. Saved target renders as a simple card (`Futures $4.80/bu · % to Sell 10.0%`). Empty state: "Add futures, basis, or cash targets to plan your grain marketing strategy."

**Marketing Plan page (the standout):**
- KPI strip + **"INSIGHTS & ALERTS (2)"** box: e.g. "Corn: No marketing plan set — consider building a plan."
- Per-crop plan cards with status chip (**"Not Started"**), "Strategy" button, marketed % progress bar, Remaining, Avg Price, **Plan Total %**, and a bin line ("0 bu in 1 bin").
- Sub-tabs: **Monthly Plan | Actual vs Plan | Progress Chart | Grain Inventory | Quick Setup**.
- **Monthly Plan:** a Jan–Dec grid per crop; every month column shows its **futures contract month and the live price** (Jan → "Mar $4.76", Sep → "Dec $4.83"…); caption: *"Click any cell to set targets · live futures shown."* Clicking a cell opens an inline editor: `Target % · Target Price · Target Basis · Target Futures · Notes` with "Live: $4.76" shown. My saved cell rendered as **"10% · $4.80 · carry $0.25"** — it auto-computes the carry vs. harvest for that month. Crop header keeps a running "Total: 10.0%".
- **Quick Setup — strategy templates** (Apply to: Corn | Soybeans), each with a mini distribution bar-chart preview:
  - **Balanced Seller** — "Even distribution across 10 months"
  - **Harvest Heavy** — "Sell heavily at harvest, less in storage"
  - **Storage Heavy** — "Store and sell later for carry premium"
  - **Conservative Pre-Harvest** — "Limit pre-harvest sales to ~30%"
  - **Seasonal Seller** — "Target seasonal price highs (spring + summer)"
  - plus "Distribute Remaining Evenly" and "Reset Plan." One click filled corn with 5/10/10/10/10/10/15/15/10/5% across Mar–Dec.
- **Actual vs Plan:** table per crop with a status chip ("Behind"): `Month | Planned % | Planned Bu | Target Price | Futures (live) | Actual Bu | Avg Price | Variance (red) | Contract | Status` + totals row. This is the accountability view an advisor would walk a farmer through.
- **Progress Chart:** "Cumulative Marketing Progress" line chart — **Actual % vs Planned %** Jan–Dec, per-crop toggle; "Marketing Position by Crop" bars below.
- **Grain Inventory tab:** per crop — `In Storage · Planned Storage · Unsold · Storage vs Unsold %` + bin table (`Bin, Current, Capacity, Utilization bar, Moisture %`).

**Cost of Carry page (unique, and genuinely insightful):** "How do you pay for storage?" toggle (**Option A — Monthly Storage Rate / Option B — Flat Rate Storage**) with `Monthly Storage Rate ¢/bu/mo (0.04) · Interest Rate % (7) · 2nd Haul Trucking $/bu (0.05)` and note "Monthly rate accumulates — the longer you store, the higher the cost." Per crop: Harvest month + Default Basis inputs, "Refresh Prices," KPI cards `HARVEST CASH/BU -$0.30 · BEST STORED MONTH Sep 2026 · BEST NET VS HARVEST -$0.05 · VERDICT: "Deliver at Harvest"`, and a month-by-month table: `Delivery | Contract | Market Price | Basis | Cash Price | Mo | Storage | Interest | Trucking | Total Carry | Net vs Harvest` (reds when storing loses money). It answers "store or sell?" in one screen with a plain-English **Verdict**.

**Firm Offers:** empty-state copy explains the concept: *"Track open buyer bids and working orders here. They feed your projected position on the sales pages until you fill them."* (Offers count toward projected position before they're filled — subtle and smart.)

**Grain Bins:** bin cards (`Bin #1 · Round · 0 bu / 14,000 bu · fill bar · Crop: Corn · moisture 15.5% (Jun 3) · Home Farm · Transactions expander · edit/delete`). Feeds the "X bu in 1 bin" lines on plan cards and the Grain Inventory tab. Matches our 2.8.

**Market data:** live-ish CBOT futures per contract month with timestamps and auto-refresh countdown ("Updated 11:25 AM · next in 4:59 · Refresh"), price cards like "July 2026 Corn — May/Jun delivery — $4.345 USD". Basis is **manual/expected everywhere** (no elevator cash-bid feed at all!) — validates our v1 "free futures + manual basis" plan; they never solved cash bids either.

**What makes it "insightful" (Mason's word), distilled:** every marketing number stands next to the number that gives it meaning — % sold next to plan %, avg price next to breakeven, this month's bid next to carry-adjusted future months, targets expressed as % of production with carry computed. It converts a ledger of sales into "am I ahead or behind, and what should I look at next?"

## Crops setup & inputs, in detail

**Crop creation ("Add Crop" modal, ~20 seconds):** `Crop Name` (free text — placeholder "e.g. Corn on Corn," so a "crop" is really a *budget enterprise*, letting corn-on-corn and corn-after-beans carry different budgets), `Commodity` (dropdown: Corn, Soybeans, Wheat, Oats, Grain Sorghum, Alfalfa, Canola, Sunflowers, …) linking the enterprise to a marketable commodity, `Yield Unit` (Bushels…), `Acres`, `Yield (bu/ac)`, `Price ($/bu)`, and **"Copy from another budget"** (default "Don't copy anything") — clone last year's or another crop's cost structure. The name/commodity split is elegant; note it still wouldn't distinguish white/non-GMO corn as separate *commodities* (only via a premium field), so our schema decision stands.

**Budget page anatomy (per crop, one page, everything recalcs live):**
1. **KPI header:** `INCOME/AC · COST/AC $747.00 · BREAK-EVEN $3.74/bu · PROFIT/AC · TOTAL PROFIT · ROI %`. When I set Expected Price to 4.50, all six updated instantly (Income/ac $900, Profit/ac +$153, ROI 20.5%) and the crop card on the Crops page turned green.
2. **YIELD / PRICE strip:** `Acres · Expected Yield (bu/ac) · Expected Price ($/bu) · Expected Premium ($/bu) · Yield Unit`. Premium tooltip: *"Any additional payment above the base price, such as identity-preserved premiums or quality bonuses. Leave at zero if none."* Once price > 0 the strip also shows **"break-even 166.0 bu/ac"** — breakeven *yield*, not just price.
3. **Income Items:** "+ Gov Payment" and "+ Other Income" buttons (empty state: "No income items yet").
4. **EXPENSES:** collapsible categories, each `name · N items · $X/ac · ⋯ menu (Add Item / Add Group / Delete Category)` + "+ Add Category" (creates an inline renameable "New Category"). Default categories in the demo: **General Expenses** (Land Rent $225, Crop Insurance $28, Seed $115), **Nutrients** ($185), **Chemicals** ($60), **Field Operations** ($116, 4 items), **Grain Handling** ($18). Expanded, each category is an inline-editable table: `NAME | $/AC | $/BU | BU TO COVER | TOTAL | % | NOTES` with drag handles, per-row delete, and a category totals row. **"BU TO COVER"** = bushels needed to pay that line (Land Rent $225 → 50.0 bu at $4.50) — a brilliant, farmer-native way to make a cost feel real. `%` = share of total cost/ac (Land Rent 30.1%). Items can be grouped ("0 groups, 3 ungrouped items").
5. **INSURANCE CALCULATOR (inline on the budget page):** inputs `% Coverage Level · APH (bu/ac) · Spring Price · Fall Price · Unit Type (Enterprise) · Insurance Type`. With 80% / 195 / $4.70 it produced three panels: **Insurance Coverage** (`Cost/Acre $28.00` — pulled from the Crop Insurance expense line, `Coverage Total $42,000`, `% Cost of Production 3.7%`, `Min. Rev. Guarantee $733.20/ac`), **Dollars of Risk** (`Income Guarantee $1,099,800`, `% at Risk 1.9%`, `Investment at Risk $20,700` in red), and **Bushels of Risk** (`Bushel Guarantee 234,000`, `Per Acre 156.0`, `% of Total 80.0%`, **`Safe to Forward 234,000 bu`**). "Safe to Forward" directly links insurance to marketing — the number of bushels you can forward-contract because insurance guarantees them. This is our 2.7 done concretely.
6. **ECONOMIC RESULTS:** Income column (`Total Bushels, Crop Income $/ac, Total Income`) and Profit column (`Total Expenses, Expense/Acre, Cost/Bushel, Gross Profit, Profit/Acre, Profit/Bushel, ROI`), green when positive, red when negative.
7. Footer upsell: "Get more from your cost of production data — Schedule a Consultation."

**Cost model notes:** all inputs are **$/ac at the crop level** (not per-field, not per-product-quantity); per-field variation is handled only via field land cost. There is no true multi-scenario side-by-side on the budget page — scenarios live in the AI widget and the Break-Even Matrix instead. Farm Rx's planned 2–3 named scenarios (4.1) would go beyond them.

**Their profitability-matrix equivalent — "Break-Even Matrix" (Tools → Breakeven Calculator):** controls `Crop (Corn) · Cost per Acre ($747, prefilled from budget) · Price Range Min 2.5 / Max 6.5 / Step 0.25 · Yield Range Min 150 / Max 250 / Step 10`. Renders a **full color-shaded grid** (yield rows × price columns, profit $/ac per cell) with legend `< -$200 (red) · -$50 (pink) · $0 (light green) · > $200 (green)` and footer callouts **"Breakeven price at 200 bu/ac: $3.74/bu · Breakeven yield at $4.50: 166 bu/ac."** No breakeven contour line, not clickable, lives buried in Tools rather than on the Profitability page. Ours (4.4) should be the same math but front-and-center, with the contour line and scenario switcher they lack.

**AI scenario widget (bonus finding):** asking the assistant "What if prices drop 10%?" rendered an interactive **"Farm scenario — Whole-farm scenario planner (3,500 ac · 2 crops)"** card in the chat with `Base Profit / Scenario Profit / Change / Scenario $/Acre` tiles and **Price / Yield / Cost sliders** ("Across all crops") plus per-crop breakdown. Their scenario tool is an AI-embedded slider widget rather than a saved-scenario system.

## Reminders & notifications (brief — deprioritized per Mason)

Marketing → **Alerts** page: an **"Alert Email(s)"** field (comma-separated — a farmer can add his advisor's email; "Alerts will be emailed when rules are triggered"), a Break-Even Prices strip for reference, and **Alert Rules** with template chips `Price Target / Marketing % Goal / Deadline Reminder` or custom. A rule = `Alert Type (Price Target | % Marketed | Deadline | ROI Target) · per-crop · Direction (At or above/below) · value · Note/Message · Active toggle · Save/Delete`. The standout is **ROI Target**: enter "10% over break-even" and it shows *"10% over your $3.73/bu break-even → target ≈ $4.11/bu."* Delivery is **email-only** (no push/SMS seen). Marketing-plan "Insights & Alerts" nudges and dashboard notifications are separate, in-app only. For Farm Rx 2.6: copy the rule-template chips + per-crop rules + breakeven-relative (ROI) targets; improve with in-app + web-push (PWA) delivery, which they don't have.

## What reinforces the Farm Rx plan (mapped to the handoff)

- **2.1 Expected production** = their acres × expected yield header on every sales page. Identical approach.
- **2.3 Market data:** they run delayed/refreshing futures + **manual basis only**. No cash-bid feed even at their scale — our v1 (free futures + manual basis) is exactly what a shipping competitor does; Barchart later would *leapfrog* them.
- **2.4 Position view:** their KPI strip + mark-to-market panel is our position view; breakeven overlay confirmed as the anchor number (it appears on Sales, Targets, Alerts, and Budget pages — same number, four contexts).
- **2.5 Contracts:** ~15-second inline sale entry confirmed as the right bar; buyer/delivery window/contract # as secondary "More" details is the right hierarchy.
- **2.6 Targets + alerts:** %-of-production targets with price/basis/date triggers = their exact model; it's real and farmers use it.
- **2.7 Insurance guarantee:** their insurance calculator (esp. "Safe to Forward" and "Min. Rev. Guarantee $/ac") proves the insurance-floor-next-to-breakeven concept carries a whole page.
- **2.8 Bins:** bin cards w/ committed-vs-free logic ("Storage vs Unsold %") = our grain-bin module.
- **2.10 USDA calendar:** their Daily Brief leads with WASDE timing — report-day awareness matters to this audience.
- **2.11 Compliance:** they never say "sell now" — even Cost of Carry's "Verdict: Deliver at Harvest" is framed as math output; AI footer: "AI can make mistakes. Verify important information."
- **4.2 Arrangements:** Owned/Cash Rent/Crop Share/Flex Rent confirmed as the complete, correct set.
- **4.3 Breakeven:** cost/ac ÷ yield, recalculated live, fed to Grain — their whole product is built on this loop working.
- **4.4 Matrix:** exists, shaded, configurable — but buried and static. Our ⭐ treatment is justified.
- **4.5 Cost/acre by field:** their "Field Profitability — best and worst fields by profit per acre, not just yield" report validates it as a headline feature.
- **4.6 Reports:** the **Lender Packet** proves the "artifact for the banker" is a product pillar (they also monetize polish via consulting).
- **Part 8 Q3 pricing:** their model is free app + $2,495 setup + $20–40/mo add-ons — i.e., software as a consulting funnel, structurally identical to Farm Rx as a Crop RX funnel.

## What's genuinely worth adopting (ranked)

1. **"BU TO COVER" column in input costs** (→ Module 4.1). Bushels needed to pay each cost line. One column, huge intuition payoff, trivial math. Nobody forgets "rent costs me 50 bushels an acre."
2. **Monthly plan grid with live futures per cell + strategy templates** (→ Module 2.6). Their Jan–Dec "click any cell to set targets · live futures shown" grid plus one-click **Balanced Seller / Harvest Heavy / Storage Heavy / Conservative Pre-Harvest / Seasonal Seller** templates turns a blank marketing plan into a filled one in one tap. This is the single best UX idea in the app.
3. **Inline-editable rows with autosave everywhere** (→ Modules 1 & 2, URGENT for Module 1). Add Field and Add Sale never leave the list; a "Saved at 11:31 AM" whisper replaces Save buttons. Fastest path to the two-tap rule.
4. **"Safe to Forward" bushels + Min. Rev. Guarantee $/ac** (→ Module 2.7). Converts the insurance floor into an *actionable marketing number*. Put it on the Grain position view, not just a calculator.
5. **Actual vs Plan table + "Behind/On Track" status chips + cumulative progress chart** (→ Module 2.6). Accountability is what advisors charge for; this is it in two views.
6. **ROI-relative price alerts** ("10% over your $3.73 break-even → ≈ $4.11/bu") (→ Module 2.6). Breakeven-anchored targets beat absolute prices.
7. **Equivalent-cash-rent normalization in land agreements** (→ Modules 1 & 4.2). Express every arrangement as its cash-rent equivalent so the comparison screen reads in one unit.
8. **Cost of Carry page with a plain-English Verdict** (→ Module 2, post-v1 roadmap). Store-vs-sell with storage/interest/trucking per month is a real daily-use question for a 22-semi operation; "Verdict: Deliver at Harvest" is Rule-1 language.
9. **Breakeven-yield alongside breakeven-price** ("break-even 166.0 bu/ac") (→ Module 4.3). Two words of extra math, doubles the insight.
10. **"Copy from another budget" on crop creation** (→ Module 4.1). Year-two retention feature; near-free if schema anticipates it.
11. **Field detail as four edit-in-place cards** (Basics / Land agreement / Yield & price / Records) (→ Module 1, URGENT). Calm structure; landlord name/phone/email on the agreement card is a nice touch farmers actually need.
12. **Firm Offers feeding projected position** (→ Module 2.5, later). Working orders count toward the plan until filled — matches how farmers actually leave standing offers at elevators.

## What to skip (and why)

- **Board-hedge contract types (Hedge / CBOT Hedge / NPE)** — options/hedge accounting is out of scope (handoff Part 7); our four types cover our audience. Their 8-type dropdown adds confusion our Rule 1 forbids.
- **Full Finances suite (balance sheet, loans, debt service, working capital)** — a different product (lender accounting). Farm Rx should stay operational; the Lender Packet idea survives as the branded Profitability PDF.
- **The AI assistant** — impressive (esp. widget-in-chat scenarios) but a giant scope trap for v1. Note it for the roadmap; Mason already has AI infrastructure to revisit later.
- **QuickBooks / John Deere OAuth integrations at launch** — theirs are paid add-ons bolted on later; our Module 7 file-upload-first plan is the right sequence.
- **Buffer factor / Order Planner / Mixing depth in Inputs** — their inputs module is chemical-*procurement* oriented; ours is compliance + coverage oriented (spray records, EPA). Different jobs; take the "planned vs applied" spirit only.
- **Employee time sheets** — Task Board covers crew needs; time tracking is HR software creep.
- **Fields-optional architecture** — right for their budget-first product, wrong for ours (splits, per-field profitability, and CRX sync all need fields as the backbone).
- **Their color discipline (don't copy):** enormous negative dollar amounts in red everywhere makes the whole demo scream; our AMBER/red hierarchy is deliberately calmer.

## Open questions for Mason

1. **Cost of Carry:** their store-vs-sell page is the one feature outside our current handoff that feels daily-use for your operation (bins + 22 trucks). Add to Module 2 roadmap (post-ship), or leave out?
2. **"Crop = named enterprise" (e.g., "Corn on Corn") vs our "crop = commodity" model:** do you want budgets separable by rotation position within the same commodity in v1, or is per-crop enough to ship? (Schema can allow both cheaply if decided now — relevant to Module 1 build TODAY.)
3. **Their targets model ties Target % + price to *months*; ours (2.6) is a flat list of price/date tranches.** Do you want the calendar-grid presentation (their strongest UX) as the primary plan view for Farm Rx?
4. **Firm offers (standing orders at the elevator counting toward projected position):** in or out for v1 contracts?
5. **Alert emails to a second address (advisor/spouse):** they support comma-separated alert recipients. Fine for Farm Rx, or does Rule 2 (privacy) argue for owner-only in v1?
6. **Team roles:** they have Owner/Member per farm. Our handoff requires employees who can't see grain/financials — confirm role granularity before Module 6.
7. Their pricing is free-core + $2,495 human setup + $20–40/mo add-ons. Any appetite for a paid "we set up your numbers" service as a Crop RX offering, or keep Farm Rx purely free-to-customer?

---
*Method note: all observations from hands-on use of the authorized fake-data demo on 2026-07-11; I created/edited test values (corn expected price $4.50, a $4.80/10% futures target, a Balanced Seller plan, a "North 80" crop-share field, insurance calc 80%/195 APH/$4.70) and deleted my test alert rule + budget category. All were sandbox-safe per Mason's authorization. Screenshots not saved; exact labels quoted from the live UI.*
