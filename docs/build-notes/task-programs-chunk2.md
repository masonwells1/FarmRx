# TASK — BUILD Chunk 2: Programs template builder + offline writes (Terra)

CRITICAL EXECUTION RULE: headless, no human is watching. NEVER present a plan and wait for
approval — that is task failure. Everything is PRE-APPROVED. Implement fully, write the files,
run the checks yourself, then report with proof. Do NOT ask questions mid-run.

## Spec + contracts (read first)
- `C:\FarmRx\docs\programs-design.md` — authoritative. Section 8 (client seam + screen contract)
  and Section 9 Chunk 2 define this chunk. Revision 2 = multiple programs per crop (but ASSIGNMENT
  is Chunk 3 — do NOT build assignment/tracker here).
- `C:\FarmRx\supabase\migrations\0024_programs.sql` — the EXACT RPC JSON contracts you must call.
  For THIS chunk you use only the TEMPLATE RPCs: `save_program` (6 keys: id,name,program_kind,
  commodity_id,crop_year,notes), `save_program_pass` (p_pass 9 keys: id,name,pass_type,activity_type,
  timing_label,target_date,planting_offset_days,reminder_lead_days,notes; p_products items 6 keys:
  id,product_name,rate_text,unit_text,estimated_cost_per_acre,notes; plus p_place_after_pass_id),
  `reorder_program_passes` (p_ordered_pass_ids uuid[]), `delete_program_pass`, `delete_program`.
  All are SECURITY DEFINER + receipt-idempotent: every call needs a fresh p_operation_id (uuid) and
  the client must replay the SAME operation_id on retry and validate the canonical echo.
- MIRROR an existing live module end-to-end for structure: scouting or harvest is the closest
  (`src/data/SupabaseScoutingRepository.ts`, `scoutingWriteQueue.ts`, `QueuedScoutingRepository.ts`,
  `createSupabaseScoutingServices.ts`, `ScoutingModule.tsx`, `SupabaseScoutingRepository.regression.ts`,
  and how `App.tsx` wires replay + the nav/route). Match those patterns exactly; do not invent a new
  architecture.

## Build (template layer ONLY — no assignment, no tracker, no weather, no tasks)
Create, following the seam UI → Repository → Gateway → PostgREST/RPC:
- `src/data/programs.ts` — domain types, validators (mirror DB limits: name 1–160, pass name 1–120,
  product_name 1–200, rate/unit 1–80, kind in chemical|fertility|fungicide|other, pass_type in
  pre|post|fungicide|planter_fertility|custom, activity_type in spray|fertility|other, target_date XOR
  planting_offset_days, reminder_lead_days 0–60), role helper, farmer-English error messages,
  and `roundDecimalHalfUp` for estimated_cost_per_acre (mirror harvest's decimal handling).
- `ProgramsDataGateway.ts` + `SupabaseProgramsDataGateway.ts` — reads via PostgREST (programs +
  program_passes + program_pass_products, farm-scoped, is_active/not-archived filtered, ordered by
  sequence), writes via the RPCs only.
- `SupabaseProgramsRepository.ts` — strict mapping + fail-closed canonical-echo validation.
- `programsWriteQueue.ts` — versioned (v1) discriminated FIFO entries for save_program / save_program_pass
  / reorder_program_passes / delete_program_pass / delete_program; exact-key + deep validation;
  corrupt entry fails closed.
- `QueuedProgramsRepository.ts` — per-queue serialization, FIFO replay by operationId, transport-vs-
  definite(blocked) handling, pending canonical projection.
- `createSupabaseProgramsServices.ts` + wire replay in `App.tsx` at farm-ready (AFTER Fields), sync
  status key `programs`.
- `src/ProgramsModule.tsx` — `/programs` page, nav label **Programs**. THIS chunk = two views only:
  "My programs" (list, with the program_kind badge + archived filter) and the template builder
  (create/edit a program; add/edit/reorder passes via Move up/Move down buttons — NOT drag; free-type
  product lines with product_name/rate_text/unit_text/estimated_cost_per_acre; archive pass; archive
  program). NO "assign to fields" and NO season tracker yet (those are Chunk 3 — you may leave a
  disabled placeholder tab).
- `SupabaseProgramsRepository.regression.ts` — drive every write through Repository→Gateway with
  replay receipts + malformed echoes; name the coverage groups; wire into `npm run regression`.

## Brand rules (from the handoff — non-negotiable)
18px base font, 48px tap targets, tabular-nums for all numbers, plain English, NO medical metaphor
in nav, 375px width with NO horizontal page overflow (long product names/rates wrap; strips scroll
internally), calm empty/loading/error states, two-tap common actions. NO inventory/catalog product
picker anywhere (products are free-type this version).

## Proof (RUN these yourself from C:\FarmRx and paste real output — do NOT claim success without it)
- `npx tsc -b --force` clean (NOT plain --noEmit — that checks zero files).
- `npm run build` clean.
- `npm run regression` all pass; state the new programs coverage-group count.
- `git status` shows the new files.
Do NOT run a dev server (Claude/Opus will browser-verify against farm-rx TEST). Do NOT git commit.
Report: files created, the exact tsc/build/regression output, coverage-group count, any deviations
from the design, and the top 3 things you want the reviewer to check.
