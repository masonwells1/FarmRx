# TASK — Feature B review fixes (Terra, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; NEVER present a plan and wait — task failure.
PRE-APPROVED. Fix EVERY item, then report with proof. Do NOT git commit. Do NOT run a dev
server. You MAY run `npx tsc -b --force`, `npm run build`, `npm run regression`.

Adversarial review found these. Files in scope: `src/data/weatherService.ts`,
`src/FieldLogModule.tsx`, `src/data/fieldLogWriteQueue.ts`,
`src/data/QueuedFieldLogRepository.ts`, `src/data/SupabaseFieldLogRepository.ts`,
`src/data/fieldLog.ts`, `src/data/SupabaseFieldLogRepository.regression.ts`,
`src/styles/app.css`. Mirror the equipment/inventory queue + fieldLocation.ts patterns.

## P1 — GDD can display a materially understated "since planting" number
`weatherService.ts` (~L62) + `FieldLogModule.tsx` (~L37): the archive request ends on TODAY
despite Open-Meteo archive's ~5-day lag, and ANY non-empty partial response is accepted — a
one-day response can become the whole-season GDD. FIX:
- Cap the archive END date at the latest safely-available date (today − 5 days is a safe
  floor; do not request beyond it).
- Require CONTINUOUS daily coverage from the planting date through that capped end (no missing
  days, correct count, both temps present each day).
- If coverage is incomplete/short/empty, SHOW THE PROMPT (or an honest "growing-degree-days
  will appear once this season has enough history"), NEVER a number. Only render a GDD number
  when coverage is complete from planting through the capped end.
- Add regression: partial/short history and lagging "today" → no number; full history → number.

## P2
### P2-1 — corrupt queue envelope doesn't fail closed semantically
`fieldLogWriteQueue.ts` (~L10): the parser accepts a rainfall entry with rainfall_in:null +
empty note + observed_on:'2099-01-01'; replay then sends it and is permanently blocked. FIX:
reuse STRICT draft validation in queue parsing — real/valid date with the same future bound as
the DB (<= today+1), entry-type/field consistency (rainfall needs amount + optional non-empty
note; note needs non-empty note + null amount), rainfall 0..100, note length <= 500. A corrupt
or DB-illegal queued entry must fail closed (blocked-with-nothing-lost), not be sent.

### P2-2 — offline saveEntry() returns undefined but claims Promise<FieldLogEntry>
`QueuedFieldLogRepository.ts` (~L23-26): offline save resolves undefined; the UI closes the form
and reloads live data, so the just-saved entry disappears until sync. FIX: return an explicit
local PENDING entry (mirror how the other queued repos represent an optimistic/pending row) so
the timeline shows it immediately with a pending indicator, OR change the contract + UI so
offline acceptance is represented honestly (entry stays visible, labeled pending). Match the
inventory/equipment offline UX. No silent disappearance.

### P2-3 — client validation doesn't match the DB
`SupabaseFieldLogRepository.ts` (~L34) + `FieldLogModule.tsx` (~L31): repository only checks date
shape; far-future dates, >500-char notes, and blank rainfall notes reach the server/queue; the
date input has no max. FIX: centralize DB-equivalent validation (put a shared validate function
in `fieldLog.ts`) used by BOTH the form and the repository boundary; set the date input's max to
today+1; reject >500-char and blank-when-provided notes and future dates client-side with a plain
message.

### P2-4 — 375px overflow not guarded
`app.css` (~L201, L208): field-log forms stay two-column on mobile; timeline text lacks
min-width:0 / word-break; a 500-char unbroken note can push the row/page wider than the viewport.
FIX: stack the form (single column) and timeline row in the <=767px media query; add
`min-width:0; overflow-wrap:anywhere` so long notes wrap. The PAGE must not scroll horizontally
at 375px.

### P2-5 — regression coverage below the bar
`SupabaseFieldLogRepository.regression.ts`: add the missing adversarial cases — replay returning
a DIFFERENT row id must be rejected; malformed-queue coverage beyond invalid JSON (the P2-1 DB-
illegal shapes); season math INCLUDING a note row (notes excluded from the inch total); wrong
save farm/id/type/value echoes each rejected; GDD partial-history / archive-lag-cap / fractional
rounding / future-planting / corrupt-history-cache. Update the coverage-group counts in the pass
lines.

## P3 — season label + GDD text are 16px
`app.css` (~L194, L198): raise the season label and GDD explanatory/prompt text to 18px
(feature baseline). Verify nothing else in the field-log CSS is under 18px.

## Proof (run from C:\FarmRx, paste real output)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` ALL suites pass with
the enlarged field-log + weather suites (state group counts). FINAL: per-fix confirmation, proof
output, `git status`, deviations. Do NOT commit.
