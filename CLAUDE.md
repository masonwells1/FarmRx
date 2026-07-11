# CLAUDE.md — Farm Rx

## What this is
- Farm Rx: a customer-facing farm management app (installable web app / PWA) by Crop RX Solutions.
  Farmers track fields, grain marketing, inventory/spray records, profitability, equipment, and tasks.
- Owner (Mason) has ~0 coding experience — explain in plain English, plan before risky changes,
  lead with one recommendation.
- **Source of truth: `docs/farm-rx-handoff.md`.** Read it before building anything. Visual
  reference: `docs/rx-one-brand-mockup.html` (labeled "Rx One" — the name is now Farm Rx).

## The three rules (from the handoff — every decision defers to these)
1. **Simplicity beats features.** 55-year-old farmer, phone, sunlight, gloves. 18px base font,
   48px tap targets, tabular-nums for all numbers, two-tap rule, plain English.
2. **The data is theirs and they must SEE that.** Grain/financials default PRIVATE; explicit
   per-farm "share with my Crop RX rep" toggle; enforced with Postgres RLS, not just UI.
3. **Brand the wrapper, never the buttons.** No medical metaphors in navigation.

## Stack
- React + TypeScript (Vite), Supabase (Postgres + RLS + Auth), Vercel hosting, Recharts, PWA.
- Supabase project: **separate free-tier project for Farm Rx** — NEVER the live CRX-Manager database.
- Live URL / production: not deployed yet.

## Standing loop (Mason-approved 2026-07-11)
- If a session opens here with no specific request, resume the build loop: next unchecked
  item in `docs/GOAL.md`, per its Loop policy (never block on questions; park them in
  Pending decisions and keep working). Each Codex build gets a Sol adversarial self-review
  before Claude verifies in-browser and commits.

## AI delegation (Codex CLI, Claude orchestrates)
- Claude = orchestrator: plans, splits work, reviews, verifies in the browser.
- **Codex launch rule:** always end `codex exec` invocations with `< /dev/null` (an open stdin
  pipe makes codex block on "Reading additional input from stdin..." forever — cost us 1.5h
  on 2026-07-11).
- **Stall watchdog:** while any codex background task runs, every loop wakeup checks progress
  (newest `~/.codex/sessions/<date>` file mtime + new files in repo). No activity for 15+ min
  → kill the codex PID and relaunch the task (fresh prompt, stdin closed). Never sit waiting.
- Codex via `codex exec -m <model>`: **gpt-5.6-sol** = architecture/schema/security/review,
  **gpt-5.6-terra** = everyday module building/UI, **gpt-5.6-luna** = boilerplate/docs/mechanical.
- **Absolute paths in codex launches:** the orchestrator shell's cwd can silently reset to C:\
  between calls, so `$(cat relative/prompt.md)` can expand to EMPTY (codex then no-ops and asks
  "what would you like me to work on?" while still exiting 0). Always pass the prompt file and
  `-o` output file as absolute `C:\FarmRx\...` paths, and after launching, head the task output
  to confirm the prompt text actually arrived (cost us a lost fix round on 2026-07-11).
- CRX Manager (`C:\CRX_Manager`) is READ-ONLY reference material for porting — never modify it
  from this project.

## How to run & verify it
- Install: `npm install`
- Run locally (preview): `npm run dev`
- Build: `npm run build`
- Test: `npm run test` (once tests exist)
- "Done" = ran and watched it work (open the page / run the endpoint), not just "tests pass".

## How changes ship
- Remote: private repo git@github.com:masonwells1/FarmRx.git (main). Get explicit approval
  before: pushing, deploying, changing the live database, or deleting data. No auto-push.
- Build order (handoff Part 6): Fields → Grain → Profitability → Inventory → Equipment/Tasks →
  Machine data import. Ship Fields + Grain to real customers before building the rest.

## Design
- Brand tokens verbatim from handoff Part 5 (CRX_GREEN #28A26A etc.), 16px card radius,
  Inter for body + ALL numbers (`tabular-nums`) — this overrides any skill that bans Inter.
- `.claude/skills/taste-skill` = design-quality guidance for marketing/login surfaces;
  handoff brand rules always win on conflicts.

## Project gotchas (add as you learn them)
- Crop assignments are their own rows (`field_id + year + crop`) — never a crop column on fields
  (double-crop soybeans break that).
- White corn and non-GMO corn are distinct marketable commodities (own contracts/premiums/bids),
  not variants of yellow corn.
- Store `expected_bushels` AND `actual_bushels` — never overwrite projected with actual.
- Options contracts, weather alerts, landlord portal, app-store distribution, elevator scraping:
  explicitly OUT of scope (handoff Part 7).
