# TASK — ADVERSARIAL REVIEW (read-only): Programs Chunk 3 assign + tracker (Sol, skeptical)

CRITICAL EXECUTION RULE: headless, no human. Review fully, then report. Do NOT fix, build, run a
server, or commit. You MAY read any file and run `npx tsc -b --force` / `npm run regression` (use the
repo-local binaries if the global npm shim is missing — report if you can't run them).

## Scope
Chunk 3 (Terra) — Programs assignment + season tracker on applied migration 0024. Spec:
`docs/programs-design.md` §2/§3/§4/§8/§9-Chunk3 (Revision 2 = multiple programs per crop). RPC
contracts: `supabase/migrations/0024_programs.sql`. Review the diffs in `src/ProgramsModule.tsx`,
`src/data/programs.ts`, `ProgramsDataGateway.ts`, `SupabaseProgramsDataGateway.ts`,
`SupabaseProgramsRepository.ts`, `programsWriteQueue.ts`, `QueuedProgramsRepository.ts`,
`SupabaseProgramsRepository.regression.ts`, `styles/app.css`.

## Hunt hard (rank P1/P2/P3, file:line + concrete failure + fix)
1. **Assignment RPC contract fidelity** — assign_program(uuid[]), reassign_program_assignment,
   refresh_program_assignment, reschedule_program_pass, skip_program_pass, unassign_program, and
   mark_program_pass_applied called with p_application_record_id=null + p_create_application_record=false
   (NO record creation this chunk). Exact params/types; each new op gets a fresh operation_id and
   replays the SAME id; canonical echo validated fail-closed.
2. **Multiple programs per crop (Rev 2)** — assign offers/handles several programs on one crop; the
   SAME program twice is rejected (farmer-English message shown, not a crash); actions (refresh/
   reschedule/reassign/unassign) target ONE assignment and never touch sibling program tracks. Tracker
   groups by program with name + kind.
3. **Snapshot immutability** — nothing in the assign/tracker path mutates a template; a template edit
   must not change assigned passes until explicit Refresh; refresh never rewrites Applied/Skipped/
   Cancelled or field-overridden passes (client must not optimistically do so either).
4. **Apply / Skip / Reschedule** — Apply captures applied_on, applied_acres (<= planted, client-guarded
   to match DB), and the COMPLETE active actual-product set exactly once; only Planned→Applied offered;
   Skip requires reason; Reschedule updates due/timing and the client reflects the canonical result.
   Marking Applied must never send crop expected/planting/acres.
5. **Offline queue extension** — new assignment mutation entry types are versioned, FIFO, Web-Lock
   cross-tab protected, canonical-echo validated, corrupt-envelope fail-closed, honest pending
   projection; a lost response + retry does not double-assign / double-apply.
6. **Read models** — crop choices render "Field — Commodity — Year — planting N" (never raw UUIDs);
   tracker reads program_assignment_tracker or equivalent with correct farm scope and independent
   double-crop rows; no N+1 that could silently drop rows.
7. **Brand/mobile** — 18px/48px/tabular-nums/plain-English/no medical metaphor/375px no horizontal
   overflow/status as words not color-only/calm empty-loading-error.
8. **Regression realness (18 groups)** — do the new assignment/tracker groups actually mirror the RPC
   state changes (materialization, multiple-per-crop, same-program-twice rejection, reschedule, apply
   actual-products, skip, refresh terminal preservation, unassign applied preservation, offline replay)?
   Name any missing critical case. Confirm no Chunk-5 application-record creation leaked in.

## Output
Run tsc + regression; state real results (or why not). Findings ranked P1/P2/P3 with file:line +
failure + fix. One-line verdict: SHIP-AFTER-FIXES (list P1s) or CLEAN.
