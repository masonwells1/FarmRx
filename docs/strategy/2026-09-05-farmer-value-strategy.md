# Farm Rx — Farmer Value Strategy (2026-09-05)

**Prepared for:** Mason Wells · **Basis:** read-only audit of `main` at `a8e11a9` (every module, every migration, every governing doc) · **Status:** Mason answered all eight decisions on 2026-09-05; the resulting owner amendment is in `GOAL.md` ("Owner scope amendment — 2026-09-05"). Where this document and the amendment differ, the amendment governs.

This document answers one question: *why would a farmer open Farm Rx on a Tuesday in February, and what has to change so they do?* It covers the five areas Mason named — profitability, planning, grain inventory, product inventory, and grain marketing — plus the cross-cutting problems that sit underneath all five.

---

## 1. The honest diagnosis

Farm Rx is not short on features. It has 13 modules, 61 database tables, four contract types, a 12-month marketing plan with five templates, a price × yield profit matrix, a cost-of-carry calculator, firm offers, bin ledgers, EPA-compliant spray records, program passes with reminders, offline queues, and a privacy model enforced in the database. Most farm apps at this stage have a third of that.

What it is short on is **reasons to open it** and **connections between the pieces**. Five specific findings explain the "lacking" feeling:

1. **There is no front door.** The app opens to the Fields list. Nothing on any screen answers "am I okay today?" The `Today` home screen was designed in July 2026 (Mason picked mockup Option 2/3), the ledger says it was delivered, but the code on `main` has never contained a `/today` route. The July release was hardening, not the home screen. Before the 2026-09-05 owner amendment, `GOAL.md` recorded the Today view as "backlog, not authorized"; that amendment (Initiative FD) now authorizes it.
2. **Every decision number is one the farmer typed himself.** The board quotes on the Grain page are TradingView widgets in sealed iframes; the app cannot read them. Position value, planned revenue, alerts, and cost of carry all run off prices the farmer keys in. The contract-month symbols are hardcoded to Dec 2026 / Nov 2026 / Jul 2027 and will go stale at rollover.
3. **The stickiest feature has nothing to watch.** A scheduled server job does evaluate marketing alert rules every 15 minutes (`run_scheduled_alert_sweep`, invoked by the `scheduled-alert-sweep` function) — an earlier draft of this document said the job was weather-only, which was wrong. But a price rule can only compare against a cash bid the farmer typed within the last 2 days, so with no feed the alert has no market to react to, and the Grain page still tells the farmer alerts are "check-on-open" notices. In practice a price target rarely fires on its own.
4. **The modules do not talk to each other where it matters.** Programs store product names and rates as free text. Inventory has a structured catalog. Profitability takes typed $/acre. Chemical and seed costs get typed two or three times. There is no planned-vs-on-hand-vs-remaining view, no inventory-cost-to-budget flow (the database view `application_cost_lines` exists and nothing reads it), no program-cost-to-budget flow.
5. **A new farm hits dead ends in the first ten minutes, and mistakes cannot be fixed.** On an empty farm the contract Buyer dropdown is empty (it lists only elevators from previously typed cash bids), so the first sale cannot be saved. The basis form silently defaults to a hardcoded "Cargill - Olney". After the first production estimate there is no button to add a second crop. Products can only be created inside a delivery receipt and can never be edited. Contracts cannot be edited or deleted. Completed spray records cannot be voided from the UI. The USDA report calendar is empty in production because no migration ever seeded it.

### Where the effort went

Rough line counts on `main` (source files only, not docs):

| What | Lines | Share |
|---|---:|---:|
| Farmer-facing screens (all modules, report, components) | 13,092 | 17% |
| App shell + authentication + farm access | 5,461 | 7% |
| Data, queue, repository plumbing | 9,643 | 12% |
| Regression tests inside `src/` | 10,449 | 13% |
| Browser / season proof tests | 8,767 | 11% |
| SQL migrations | 19,179 | 24% |
| PowerShell proof scripts | 11,682 | 15% |
| Edge functions | 967 | 1% |

About one line in six is something a farmer sees. The rest is safety, privacy, and proof. That investment is real and should not be thrown away — the privacy model, offline durability, and append-only ledgers are genuinely better than the competitors'. But the ratio explains the feeling. The next year needs to flip it.

---

## 2. Scoreboard: the five areas Mason named

Grades are for **farmer value today**, not code quality. Code quality is uniformly high.

| Area | Grade | What works | What blocks daily use |
|---|:-:|---|---|
| **Grain marketing** | C+ | Four contract types, 12-month plan grid with 5 templates, actual-vs-plan table, "% over breakeven" targets, firm offers → contract fill, alert rules with email and a 15-minute server sweep, cost-of-carry verdict, IP premiums flow into average price | No live price in any number; price alerts have only farmer-typed bids to watch and the page still says "check-on-open"; buyer dropdown empty on new farms; no commodity picker on Contracts tab; cannot edit/delete a contract; no totals row; position card shows ~20 numbers; cost-of-carry grid and sale limit vanish when the tab closes; USDA calendar empty |
| **Profitability** | B | Price × yield matrix with breakeven contour, insurance floor shading, tap-a-cell sentence; dual breakeven (with/without land); named plan comparison with "Best" badge; Input ROI Analyzer; U of I 2026 starter budget; equipment service-cost import with provenance; banker + landlord print reports; breakeven feeds Grain | Land-arrangement comparison shows "Set up in Fields" for 3 of 4 types (the math exists, tested, never called); inventory costs never flow in; no Excel/CSV export; no actuals-vs-budget; no year-over-year; costs on one tab, matrix on another; 19 round-trips to edit 19 lines; no "Other" category (breaks landlord "other inputs %") |
| **Planning (Programs)** | C | Reusable program → passes → assign to field crops; materialized copies so history is safe; due-date reminders create tasks + notifications; spray-conditions light; honest cost-so-far rollups; plain-English confirmations | Products and rates are free text — cannot multiply rate × acres; no link to Inventory catalog; "Mark applied → new draft record" creates a spray record with zero products (retype everything); no planned-vs-applied-vs-remaining; program costs do not reach Profitability |
| **Product inventory** | C | Derived on-hand (receipts + adjustments − applications − confirmed matches) that can never drift; append-only receipts/adjustments; EPA/REI/PHI snapshotted onto every application (fixes a CRX Manager hole); RUP completeness check; unit safety; excellent offline saves | No add/edit product screen; one product per receipt; lot/expiry/invoice columns exist but always saved as null; "low stock" = hardcoded ≤5 of anything; no reorder points; cost per unit computed by the database then discarded by the app; REI/PHI never turned into a re-entry or harvest-safe date; applicator name/license retyped every record; no void/correct from UI; no compliance PDF; Inventory and Programs both behind "More" on phone |
| **Grain inventory (bins)** | C+ | Bins with capacity, on-farm/commercial, moisture with staleness flag, IP badges, append-only movement ledger with server-side guards (no negatives, no overfill, no mixing lots), harvest → Grain actual reconciliation button | "Committed vs free" is displayed but there is no way to write it — committed is permanently 0; contracts do not commit bushels; deliveries do not touch bins (by design, but there is no optional link either); bins are whole-farm all-years so they cannot reconcile to a crop-year position; no scale tickets / loads |

---

## 3. What is genuinely good (protect it)

Do not let a redesign wave flatten these. They are the parts a competitor cannot copy quickly.

- **Privacy as a feature.** Grain and money are private by default, the rep toggle is off by default, and the database enforces it. Farm Profit Manager, Bushel, and Harvest Profit do not offer this posture.
- **Saves that never lie.** Every write shows *Saved*, *Saved on this device, waiting for signal*, or *Needs attention*, and the needs-attention list keeps the farmer's typed values. Weak-signal handling is proven across offline/reconnect/revocation.
- **Regulatory snapshotting.** A spray record permanently carries the product's EPA number, REI, PHI, signal word, and label maximum as they were on the day. The compliance tab splits "required for RUP" from "good practice" honestly.
- **The profit matrix.** Better than Farm Profit Manager's (front-and-center, contour line, clickable, insurance shading).
- **Cost of carry, firm offers, plan templates, actual-vs-plan.** The competitor teardown's best ideas were actually built.
- **Honest math.** Lease math refuses to guess; program cost rollups say "cost so far from lines with a price" instead of a misleading $0; insurance wording refuses to claim coverage.

---

## 4. The strategy: five bets, in the order that earns daily use

The bets below are ranked by **farmer value**, not by delivery order. Research in `docs/profitability-research-2026-07.md` is blunt: *"the weekly hook is marketing, not budgeting — budgets get opened twice a year."* So the highest-value bet is the one that puts a live number in front of the farmer every day, and the next is the screen that shows it to him. The **authorized build order** is the one recorded in `GOAL.md`'s 2026-09-05 amendment — FS (friction sweep) → FD (Today) → GL (grain live) → LD (loads) → CM (connect the money) → IP (inventory planner) — and implementation follows that sequence, not the ranking here.

Effort sizes are rough, for focused Claude-driven build sessions under the existing one-tranche-one-commit discipline: **S** = a few days, **M** = one to two weeks, **L** = three to six weeks.

### Bet 1 — Make Grain marketing live (the daily hook)

**Goal:** the farmer's own numbers move without him typing anything, and the app tells him when they cross his line.

1. **Build the USDA MARS basis feed** (S–M). Free, public domain, no license risk. The design already exists (`docs/grain-live-design.md` §MARS, `docs/futures-feed-research.md`), the app already has the defenses (`isMarsBid`, staleness copy). What is missing is the small scheduled server program ("edge function") that pulls the daily report and writes rows. Result: local cash bids and basis appear every afternoon and basis history builds itself, which is the "is basis strong or weak right now?" answer the handoff asked for.
2. **Make the existing server alerts truthful** (S). The server sweep already evaluates marketing rules every 15 minutes. What is missing: agree in one place whether USDA feed rows may satisfy a price rule (the SQL would count them, the browser code excludes them), run the sweep after the daily feed lands, replace the "check-on-open" wording with the real schedule, and confirm the cron's secrets are actually configured in the live project. This is the feature the handoff calls "what advisors charge thousands a year for," and with a feed behind it, it finally has something to watch.
3. **Barchart — declined by Mason (2026-09-05) as too expensive.** Board prices stay as display-only widgets and no computed number may depend on them. The USDA feed in step 1 is the price source for bids, basis history, and alerts. Fix the hardcoded contract months so the widgets stop going stale.
4. **Fix the dead ends** (S). Free-text Buyer with suggestions instead of a dropdown that can be empty; remove the "Cargill - Olney" default; add a commodity/crop-year picker to the Contracts tab; add a totals row; allow edit and delete of a contract that has no deliveries (with confirmation and a reason); add "Add another crop" after the first production estimate; seed the USDA report dates.
5. **Simplify the position card** (M). One hero line ("62% sold at $4.71 · breakeven $4.28 · 47,500 bu open"), three tiles, and everything else behind *More details*. Persist the sale limit and the cost-of-carry grid (they currently disappear when the tab closes).

**What Mason will see:** open Grain on a Tuesday and the local bid has moved since Monday, basis history has another bar, and if corn crossed his $4.80 target his phone buzzed the night before.

### Bet 2 — Build the Today screen (the front door)

**Goal:** the first screen answers "am I okay today?" and puts the four common actions two taps away.

This requires reversing the "not authorized" line in `GOAL.md`. Mason already chose the visual direction in July; the design docs (`docs/design/04-page-patterns.md` §Dashboard) specify the order: greeting + date + weather one-liner → anything red/amber → three daily numbers → today's work (tasks and passes due) → grain snapshot (sold vs plan, today's bid move). Effort: **M**, mostly reading data the modules already produce.

Add **Quick Record** in the same tranche: *Rain · Scouting note · Spray record · Task · Harvest · Grain delivery* from one button, each opening a form that already exists. *Enter a load* joins the grid only when Initiative LD ships the load record. Restore the two-tap rule the handoff and design principles require.

### Bet 3 — Connect the money (Profitability becomes the banker and landlord tool)

**Goal:** the farmer types each cost once, the app knows planned vs actual, and the outputs are documents he can hand to a banker or landlord.

1. **Wire inventory costs into budgets** (M). The database view `application_cost_lines` already produces $/acre by profitability category from real spray records; Profitability already renders `source_kind: 'inventory'` lines read-only. Build the importer (same pattern as the equipment importer, which is already done and well designed).
2. **Program costs as "planned," applications as "actual"** (M). Programs already compute planned $/ac per crop. Show planned vs actual vs budget on the crop card. This is the "living breakeven" the roadmap has deferred three times and is where the app starts telling farmers something they did not already know.
3. **Ship the land-arrangement comparison screen** (S). `planProfitUnderArrangement` in `planningTools.ts` already computes profit under any lease type and is covered by tests; no screen calls it. Add a section on the field allocation: owned / cash rent / flex / crop share side by side with 2/3–1/3, 60/40, 50/50 presets. Rent negotiation season is Aug–Oct — this is the single most requested farm-office use in the research and nobody in the market does it on the farmer's own numbers.
4. **Excel/CSV export** (S). The research calls it "non-negotiable" for trust. Every table gets a *Download spreadsheet* button. Farmers already live in Excel; give them their numbers back.
5. **Real branded PDF** (M). Replace print-to-PDF with a generated, Crop RX-branded banker packet and landlord settlement. The tank-label branding pipeline is the reference.
6. **Trim the friction** (S–M). Simple/Advanced cost toggle (spec §C), regional farmdoc defaults instead of one central-Illinois preset, an "Other" category (unblocks the landlord "other inputs %"), matrix and cost table on the same screen, batch saves instead of one round trip per field.

### Bet 4 — Turn product inventory into a planner (open it in February, not just after a spray)

**Goal:** the app answers "how much do I need, how much do I have, how short am I?" before the season starts.

1. **Link Programs to the Inventory catalog** (M). `catalog_product_id` is already reserved on program products. In the program builder, pick a product from the shed (with "Add new" inline) and enter rate as a number, unit, and basis (per acre, per 100 gallons) instead of free text, plus the same package conversion Inventory already asks for when ounces must become gallons or bags. Keep free-typed as a fallback so nothing breaks.
2. **Then compute the plan** (M). Planned need per product = quantity per acre × assigned acres, where quantity per acre depends on the rate basis: the rate itself for per-acre rates, rate × (carrier gallons or pounds per acre ÷ 100) for per-100-gal and per-100-lb rates, and rate × count per acre for each-based rates; the result is normalized into the product's inventory unit, and a line missing its carrier volume, count, or conversion is flagged rather than counted. Show **planned vs on hand vs applied vs remaining** per product, and a *Short list* — what to buy. With the farmer's explicit consent, the short list is also the most natural Crop RX order in the world.
3. **Make "Mark applied" carry the products** (S). Today it creates an empty draft spray record. Prefill product, rate, and computed total from the pass so the compliance record is one confirmation away. When a pass creates or links an application record, completing that record is the sole source of the on-hand deduction (drafts never deduct); the confirmed-match path remains only for passes recorded without an application record, so no quantity is ever deducted twice.
4. **Basic shed management** (M). Add/edit product screens; multi-line receipts (the database and RPC already support it, the UI sends one line); per-product reorder point instead of hardcoded ≤5; write the lot, expiration, and invoice columns that already exist; storage location; show cost per unit and shed value (the database already computes weighted cost and the app discards it).
5. **Compliance that protects** (M). Compute REI re-entry time and PHI harvest-safe date per field and show them on Fields/Today; applicator roster so name and license are picked, not retyped; void/correct a completed spray record with a reason; compliance PDF for an inspector.
6. **Later: the CRX Manager delivery sync.** The `inventory_delivery_events` inbox table is already designed. When a Crop RX delivery auto-appears in the farmer's shed, Farm Rx has a moat no independent app can match. Requires its own scope decision.

### Bet 5 — Make grain inventory true (bins that agree with contracts)

**Goal:** the bin page tells the truth about what is committed, what is free, and where it went.

1. **Derive committed vs free from contracts** (S–M). Committed bushels per commodity *and crop year* = undelivered contract bushels for that year. Free = that year's on hand − committed, shown once at farm level, not repeated on every bin. Stop displaying a column nothing can write.
2. **Optional, explicit delivery-from-bin link** (M). When recording a contract delivery, offer "this came from bin X" as a farmer-confirmed checkbox. Keeps the no-silent-mutation rule; removes the double entry.
3. **Scale tickets / loads** (L — **Mason: top priority, 2026-09-05**). A load = date, truck, from bin (or field at harvest), to buyer/contract or to bin, gross/tare/net, moisture. It feeds deliveries, bin movements, and actual production in one entry, each effect visible and confirmed by the farmer on save, applied as one all-or-nothing server transaction so a dropped connection can never half-apply a load or double-count bushels. For a 22-semi operation this is the natural harvest source of truth and does not need a yield monitor. Moved from August 2027 into the first winter build window as Initiative LD.
4. **Scope bins to a crop year** (M) so bins can reconcile to a position; persist sale limits; shrink/moisture adjustment.

---

## 5. Cross-cutting: a two-week friction sweep before anything else

These are small, visible, and touch every module. Do them first so every later demo lands on a clean surface.

- Replace every `window.prompt` / `window.confirm` (typed audit reasons in iOS system dialogs) with in-app dialogs that match the design system.
- Persist state that vanishes: cost-of-carry grid, sale limit, U of I default badges (currently in one browser's local storage).
- Seed `usda_report_dates`; roll the TradingView contract months from the crop year instead of hardcoding 2026/2027.
- Phone navigation: Inventory and Programs are behind *More*. Once Today exists, the bottom bar should be Today · Grain · Fields · Record · More.
- Tables with 720–1280px minimum widths (matrix, cost table, cost-of-carry, plan comparison) get phone layouts.
- Plain-English relabel pass: "Insurance-backed marketing estimate," "Open legs — manual valuation," "superseded by baseline," "Basis open / Futures open" and similar.
- Every empty state gets one sentence and one button.

---

## 6. Roadmap against the farm calendar

Farm Rx should arrive at each decision moment with the tool that moment needs.

| Window | Farm moment | Ship |
|---|---|---|
| **Sept–Oct 2026** | Rent negotiation (Aug–Oct); harvest in progress | Friction sweep (FS) · Today screen (FD) · MARS feed + server-side alerts + Grain dead ends (GL) |
| **Nov 2026–Jan 2027** | Banker / loan renewal (Nov–Feb); input buying (Oct–Feb) | Loads / scale tickets + committed vs free (LD, top priority) · inventory → budget cost flow, planned vs actual, land-arrangement comparison, CSV + branded PDF (CM) · Programs ↔ catalog link and chemical-needed planner (IP-1, IP-2) |
| **Feb–Mar 2027** | Pre-plant; the pilot | 3–5 friendly Crop RX customers; Mason or a rep enters their fields and shed with them ("we set up your numbers"); the two physical-phone journeys still owed in `GOAL.md` |
| **Apr–Jul 2027** | Planting, spraying | REI/PHI safety, applicator roster, "Mark applied" carries products, compliance PDF |
| **Aug 2027** | Harvest | Loads already live from LD; crop-year bin scoping and shrink/moisture if not yet done |

---

## 7. Decisions only Mason can make

**Answered 2026-09-05.** 1 yes · 2 no (Barchart too expensive) · 3 yes (free to active Crop RX customers, paid otherwise) · 4 yes, top priority · 5 defer until CRX Manager is done · 6 yes, free for pilot · 7 yes, names to follow · 8 yes, loosen for screen work. The original questions and recommendations are kept below for the record.

1. **Authorize the Today screen.** Reverses `GOAL.md` line 50. Recommended: yes, as the front door for everything else.
2. **Barchart OnDemand, ~$650/yr.** Recommended: yes, after written license confirmation. Ten paying farms cover it; without it Grain math is forever manual.
3. **Pricing model.** Free to Crop RX customers (software as the retail funnel, like Farm Profit Manager) or a ~$300–600/yr tier. Recommended: free to active Crop RX customers, paid for everyone else; decide before Barchart.
4. **Scale tickets / loads.** Recommended: in, for the 2027 harvest.
5. **Prepay balance tracking** (handoff open question #2). Recommended: defer until the CRX Manager sync exists; it is the same data path.
6. **A paid "we set up your numbers" service** modeled on FPM's $2,495 setup. Recommended: do it free for the pilot farms, price it afterward.
7. **Pilot farmers.** Three to five names, with the understanding that no real customer data goes in until the physical-phone journeys are recorded.
8. **Process.** The Sol/Terra/Luna proof loop and the approval gates on push/merge/deploy/migration should stay exactly as they are. But the same loop applied to every product tranche produced the 17% ratio above. Recommended: keep full proof for anything touching privacy, money math, or production; use a lighter "build, forced TypeScript, regression, one fresh review" loop for screen work, as `GOAL.md` already did for Connect Workflows and Soil Rx.

---

## 8. What was verified and what was not

Every claim above about the code was checked by reading `main` at `a8e11a9` and, for the highest-impact ones, re-checked directly: the Buyer dropdown source, the first-estimate-only gate, the unseeded USDA table, the unread `application_cost_lines` view, and the hardcoded TradingView years. One check was wrong in the first draft: the scheduled sweep was searched only in its TypeScript files and judged weather-only, but its marketing-rule evaluation lives in SQL (`run_scheduled_alert_sweep`, migration `0039`). Codex review on PR #38 caught it; finding 3, the scoreboard, and Bet 1 were corrected on 2026-09-05.

Not done here: running the app in a browser (there is no mock backend mode and no Docker in this environment), touching production, Vercel, or Supabase, or exercising any live service. Nothing was pushed. Competitor prices are from July 2026 research and should be re-checked before quoting them.

Related unfinished threads that affect capacity, from `docs/branch-inventory-2026-09-03.md`: Soil Rx sits across a draft PR and three local worktrees that still need reconciling, and a 56-commit local "V2" lineage has never been reviewed. Those should be resolved before Bet 1 starts, so new work does not collide with them.
