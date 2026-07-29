# TASK — BUILD Chunk 6: Programs polish + full regression sweep (Terra) — FINAL chunk of Module 8

CRITICAL EXECUTION RULE: headless, no human. NEVER present a plan and wait — task failure.
PRE-APPROVED. Implement fully, RUN checks yourself, report in your FINAL message. Do NOT git commit.
Do NOT edit `supabase/migrations/`. Do NOT run a dev server. You MAY run `npx tsc -b --force`,
`npm run build`, `npm run regression`. Chunks 1–5 are DONE, committed, and browser-proven — do NOT
regress any of them. This is polish + a completeness pass, additive and low-risk.

## Scope (polish the whole Programs surface: My programs, Assign to fields, Season progress, Inventory
## program-linked cards)
1. **Plain-English copy pass** for a 55-year-old farmer on a phone: review every Programs string
   (labels, buttons, empty states, errors, confirmations, the spray-light and cost wording). No jargon,
   no medical metaphor, define nothing the farmer wouldn't say. Keep the already-approved disclosures
   verbatim ("Products are free-typed — not matched to inventory; on-hand was not changed."). Fix any
   awkward or developer-ish phrasing.
2. **Empty + error + loading states** everywhere in Programs: no programs yet; no assignments yet; a
   crop with no priced lines; weather unavailable/no-location/stale; a failed load; an offline pending
   action. Each must be a calm, plain sentence — never a blank area, a raw error, or a spinner with no
   words. Confirm the Season-progress empty state and the My-programs empty state read well.
3. **Archived filters**: verify the "Show archived programs" toggle and the archived-assignment history
   view behave and read clearly (archived badge, no edit controls on archived tracks). Make sure an
   archived program/assignment is visually and textually distinct from active.
4. **Brand/mobile audit at 375px**: 18px base text, 48px tap targets, tabular-nums on ALL numbers
   (costs, acres, dates-as-numbers), no horizontal overflow, status words not color-only. Fix any
   Programs element that violates this. State exactly what you checked and any CSS you changed
   (`src/styles/app.css`).
5. **Complete end-to-end Programs regression sweep**: audit the existing Programs + Chunk5 + Inventory
   program-row coverage and CLOSE any gap so the full Module 8 behavior is covered: template build +
   reorder + archive; assign (incl. multiple programs per crop, scope enforcement, the 12-cap); refresh/
   reassign/unassign; per-pass apply(none/link/create)/skip/reschedule with canonical + idempotent
   replay; due→task/reminder linkage; cost completeness (partial never $0, half-up); spray-light
   composition (never blocks); Inventory draft/completed render + farm_id rejection. State the final
   coverage-group counts per suite. Do NOT weaken any existing assertion.

## Rules / scope
- Additive polish only. Do NOT change RPC contracts, migrations, or the write-queue shape. Do NOT
  remove or loosen any control, guard, or assertion added in Chunks 1–5.
- Free-type stays free-type; never decrement inventory, write application_products, or post a draft.

## Proof (RUN yourself, paste real output in your FINAL message)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` all pass (STATE new counts).
`git status`. Do NOT commit. List each copy/state/CSS change with file:line, and the final per-suite
coverage counts. Note: Opus will browser-prove the polished empty/archived/error states and the 375px
audit on farm-rx TEST before committing and closing Module 8.
