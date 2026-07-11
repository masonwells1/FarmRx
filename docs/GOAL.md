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
- [ ] Phase 0b: CRX Manager engine analysis doc (`docs/crx-engines.md`, Sol)
- [ ] Phase 0c: app shell running in browser (Vite React TS PWA, brand tokens, login + nav, Terra)
- [ ] Phase 0d: Supabase free project + Module 1 schema (fields, crop_assignments, arrangements,
      entities, RLS + share-toggle) — Sol designs, review gate before apply
- [ ] Module 1: Fields (list, detail, fast add/edit, stat boxes)
- [ ] Module 2: Grain (expected production, projected→actual switch, contracts, position view,
      marketing plan targets + alerts, insurance guarantee, bins, manual basis + free futures API)
- [ ] Module 4: Profitability (input costs, arrangement comparison, breakeven, PROFITABILITY
      MATRIX ⭐, cost/acre by field, branded PDF)
- [ ] **SHIP GATE: Fields + Grain in front of real customers** ← the goal
- [ ] Module 3: Inventory & compliance · Modules 5/6: Equipment & Tasks · Module 7: machine data

## Open questions for Mason (answer when relevant, handoff Part 8)
1. Scale tickets / load tracking — in or out? (matters at Module 2)
2. Prepay balance tracking — in or out?
3. Pricing model (free to CRX customers vs subscription) — matters before Barchart $650/yr
4. Employee permission granularity (min: employees never see grain/financials)

## Session resume instructions
Open a session in `C:\FarmRx` (loads project CLAUDE.md + this goal via auto-memory).
Check the Roadmap checkboxes above, read the latest git log, continue the next unchecked item.
Update this file's checkboxes as phases complete — this file is the ledger.
