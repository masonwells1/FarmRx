# TASK — ADVERSARIAL REVIEW (read-only): Programs Chunk 2 client (Sol, skeptical)

CRITICAL EXECUTION RULE: headless, no human. Review fully, then report. Do NOT fix, build, run a
server, or commit. You MAY read any file and run `npx tsc -b --force` / `npm run regression`.

## Scope
Chunk 2 (Terra) — Programs TEMPLATE layer client on applied migration 0024. Spec:
`docs/programs-design.md` §8/§9-Chunk2. RPC contracts: `supabase/migrations/0024_programs.sql`
(save_program, save_program_pass, reorder_program_passes, delete_program_pass, delete_program).
Review: `src/data/programs.ts`, `ProgramsDataGateway.ts`, `SupabaseProgramsDataGateway.ts`,
`SupabaseProgramsRepository.ts`, `programsWriteQueue.ts`, `QueuedProgramsRepository.ts`,
`createSupabaseProgramsServices.ts`, `SupabaseProgramsRepository.regression.ts`, `src/ProgramsModule.tsx`,
and the diffs in `App.tsx`, `data/backends.ts`, `data/index.ts`, `data/syncStatus.ts`, `styles/app.css`.

## Hunt hard (rank P1/P2/P3, file:line + concrete failure + fix)
1. **RPC contract fidelity** — every call sends EXACTLY the keys the DB validates (program 6 keys;
   pass 9 keys; product 6 keys) with correct types. A missing/extra key or wrong type = the RPC
   raises "keys do not match" and the save silently fails. Check target_date XOR planting_offset_days,
   reminder_lead_days present, program_kind/pass_type/activity_type enums.
2. **Offline write queue** — versioned key, FIFO, replay reuses the SAME operation_id, canonical echo
   validated fail-closed, corrupt entry blocked (not silently dropped), transport-vs-definite(blocked)
   distinction, pending projection honest. A lost response + retry must NOT double-apply or bump
   revision twice. Compare against the proven scouting/harvest queue.
3. **Canonical echo / mapping** — strict mapping rejects malformed server rows; the reorder echo and
   the save_program_pass bundle echo (pass + ordered products + revision) are validated, not assumed.
4. **Pass ordering UI** — Move up/down produce a correct full ordered id array for reorder_program_passes
   (every active pass exactly once); no drag; reorder cannot desync from the server sequence.
5. **Free-type products** — no inventory/catalog picker anywhere; estimated_cost_per_acre uses
   roundDecimalHalfUp (not toFixed) as the acceptance rule; empty/partial cost handled honestly.
6. **Archive semantics** — delete_program / delete_program_pass are archives (is_archived), UI hides
   archived by default with a filter, and never hard-deletes; assigned snapshots are Chunk 3 (not here).
7. **Brand/mobile** — 18px base, 48px targets, tabular-nums, plain English, NO medical metaphor in nav,
   375px NO horizontal page overflow (long product/rate text wraps), calm empty/loading/error.
8. **Regression realness (5 groups)** — does the fake mirror the real RPCs (idempotent replay, wrong
   echo rejected, corrupt envelope fail-closed, reorder, archive)? Name missing critical cases.
9. **No scope creep** — assignment/tracker/weather/tasks must NOT be wired yet (Chunk 3–5); a disabled
   placeholder is fine.

## Output
Run `npx tsc -b --force` and `npm run regression`; state real results. Findings ranked P1/P2/P3 with
file:line + failure + fix. One-line verdict: SHIP-AFTER-FIXES (list P1s) or CLEAN.
