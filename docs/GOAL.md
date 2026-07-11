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
- [ ] Module 2: Grain (expected production, projected→actual switch, contracts, position view,
      marketing plan targets + alerts, insurance guarantee, bins, manual basis + free futures API)
      · Note 2026-07-11: Mason says marketing-update notifications are NOT a must-build —
        keep handoff 2.6 alerts in the spec at normal priority, no special treatment
      · ADOPT from competitor report (docs/competitor-farmprofitmanager.md): monthly plan
        grid + strategy templates (primary view) · "Safe to Forward" bu + Min Rev Guarantee
        on position view (2.7) · Actual-vs-Plan status chips + cumulative chart · ROI-
        relative price targets (breakeven-anchored) · inline add-sale rows w/ autosave
- [ ] Module 1 polish pass (from competitor report): inline autosaving add-field row in the
      list (beat their ~10s), detail page as 4 edit-in-place cards (Basics/Land agreement/
      Yield & price/Records), KPI row w/ "Crops assigned x/y" nudge, landlord contact on
      agreement card, equivalent-cash-rent display
- [ ] Module 4: Profitability (input costs, arrangement comparison, breakeven, PROFITABILITY
      MATRIX ⭐, cost/acre by field, branded PDF)
      · ADOPT from competitor report: "BU TO COVER" column on every cost line (4.1) ·
        equivalent-cash-rent normalization in arrangement comparison (4.2) · breakeven-YIELD
        alongside breakeven-price (4.3) · "copy from another budget" (4.1) · our matrix stays
        front-and-center + interactive + contour line (theirs is buried/static — beatable)
- [ ] **SHIP GATE: Fields + Grain in front of real customers** ← the goal
- [ ] Module 3: Inventory & compliance · Modules 5/6: Equipment & Tasks · Module 7: machine data

## Loop policy (Mason, 2026-07-11): keep working, never block on questions
- The loop runs continuously and only surfaces questions that GENUINELY need Mason
  (business decisions, money, irreversible actions).
- **If Mason doesn't reply, do NOT idle**: park the question in "Pending decisions" below,
  skip to the next actionable ledger item, and keep building.
- Hard stops stay hard (push/deploy/new DB migrations/deletes wait for explicit OK) —
  but waiting on a hard stop never pauses other work.
- Re-surface pending decisions briefly at the top of each progress report; never nag.

## Pending decisions (parked, non-blocking — from competitor report, 2026-07-11)
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
