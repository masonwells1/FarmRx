# TASK — FIX Chunk 3 review + browser findings (Terra)

CRITICAL EXECUTION RULE: headless, no human. PRE-APPROVED. Fix EVERY item, RUN checks yourself,
report with real output. Do NOT git commit. Do NOT run a dev server. You MAY run `npx tsc -b --force`,
`npm run build`, `npm run regression`. Mirror the PROVEN harvest/scouting queue patterns.

Files: `src/ProgramsModule.tsx`, `src/data/QueuedProgramsRepository.ts`, `src/data/SupabaseProgramsRepository.ts`,
`src/data/SupabaseProgramsDataGateway.ts`, `src/data/programsWriteQueue.ts`, `src/data/programs.ts`,
`src/data/SupabaseProgramsRepository.regression.ts`.

## P0 — THE SMOKING GUN (Opus reproduced hands-on in the browser)
Assigning a program through the "Assign to fields" UI (select program → check a crop-year →
"Assign to fields") shows **"All changes synced" with NO error, but writes ZERO rows** to the
database (verified: 0 rows in program_assignments / assigned_program_passes on farm-rx TEST).
The UI reports success while nothing persists. This is caused by the P1 queue/echo defects below.
NON-NEGOTIABLE ACCEPTANCE: after the fix, assigning through the UI MUST create the
program_assignment + materialized assigned_program_passes rows in Postgres, AND a rejected/failed
assign MUST surface a farmer-English error instead of a false "synced". Do not mark an operation
synced until the real server write is confirmed by a fully validated canonical echo.

## P1
### P1-1 — full canonical-echo validation before removing the queue head
`SupabaseProgramsRepository.ts:39` (and the other new assignment ops) accept incomplete/incorrect
canonical responses; `QueuedProgramsRepository.ts:39` then removes the queue head after partial
checks, so a stale/malformed (or empty) receipt is treated as confirmed. Validate EVERY returned
field + RPC-specific metadata against the submitted command before removing the head:
- assign: assignments returned for exactly the requested crop ids, each active, program_id matches,
  passes/products materialized.
- refresh: assignment still active + the expected revision/preservation counts.
- reassign: OLD assignment archived AND replacement active on the SAME crop.
- reschedule: returned due_on/timing_label/due_source match the request.
- apply: returned status='applied' + applied_on/applied_acres + the actual-product set match.
- skip: status='skipped' + skipped_on + reason match.
- unassign: assignment archived + terminal history preserved (counts).
Fail closed (throw) on any mismatch so the op stays queued/blocked and the UI shows an honest error.

### P1-2 — offline assignment projections must not fake actionable identities
`QueuedProgramsRepository.ts:22` gives every projected crop the operationId as its assignment_id
(server generates different UUIDs) and still offers Reassign/Unassign on pending cards → those
replay with nonexistent IDs and permanently block the FIFO. Offline reassign also rewrites the
existing assignment's program identity instead of archiving+replacing (Applied history shows under
the wrong program). FIX: treat un-synced assignments as NON-ACTIONABLE pending placeholders (no
Reassign/Unassign/Apply until the canonical server IDs arrive); for reassign, keep the old track +
history and show the replacement separately until the canonical response lands.

## P2
### P2-3 — Applied/Skipped history vanishes after unassign/reassign
`SupabaseProgramsDataGateway.ts:9` excludes archived assignments and `ProgramsModule.tsx:35` filters
active again, so preserved terminal history disappears from Season progress. FIX: include archived
tracks that still carry Applied/Skipped/Cancelled passes, label status as WORDS, disable mutation
actions on them, keep showing terminal passes.
### P2-4 — assign picker must show existing programs + block same-program-twice with a specific message
`ProgramsModule.tsx:32/33` only filters commodity/year and turns the duplicate conflict into a
generic error. FIX: pass assignments into the picker; for each crop-year list the programs already
active on it; disable an already-assigned program/crop pair; on the RPC's same-program rejection show
a direct message like "This program is already assigned to North 80 — Soybeans — 2026 — planting 1."
### P2-5 — make the 18 regression groups actually prove Chunk 3
`SupabaseProgramsRepository.regression.ts` fake gateway materializes assignments with no
passes/products, ignores actual products on Apply, models Refresh as only a revision change, and only
tests clean offline replay. FIX: make the fake mirror SQL materialization + state transitions
(assign materializes passes/products; apply writes actual products + status; refresh preserves
terminal/override; reassign archives old + activates new on same crop; unassign preserves applied).
ADD: same-program-twice rejection, double-crop independence, 12-cap, lost-response+same-op replay
(no double-assign/double-apply), malformed-canonical-echo rejection for EVERY new op. Keep it honest;
state the new count.

## P3
### P3-6 — render load errors in all three views; destructive confirmations include full context
`ProgramsModule.tsx:14/15` don't render the page-level load/reload error in assign/progress views.
Reassign/Unassign confirmations omit field/crop/planting + affected-pass counts. FIX: render the
shared error in all views; make destructive confirmations repeat the exact crop/program + pass count.

## Proof (RUN yourself, paste real output)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` all pass (state new count).
`git status`. Do NOT commit. Per-fix: what changed + file:line, and explicitly confirm the P0
acceptance (assign now persists; failed assign surfaces an error).
