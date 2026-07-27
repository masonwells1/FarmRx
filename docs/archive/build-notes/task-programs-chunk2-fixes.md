# TASK — FIX Chunk 2 review findings (Terra)

CRITICAL EXECUTION RULE: headless, no human. PRE-APPROVED. Fix EVERY item, RUN the checks
yourself, report with real output. Do NOT git commit. Do NOT run a dev server. You MAY run
`npx tsc -b --force`, `npm run build`, `npm run regression`.

Files: `src/ProgramsModule.tsx`, `src/data/QueuedProgramsRepository.ts`, `src/data/programsWriteQueue.ts`,
`src/data/SupabaseProgramsRepository.ts`, `src/data/SupabaseProgramsRepository.regression.ts`.
Mirror the PROVEN patterns already in `harvestWriteQueue.ts` / `QueuedHarvestRepository.ts` /
`SupabaseHarvestRepository.ts` / `SupabaseScoutingRepository.ts` — do not invent new approaches.

## P1 (ship blockers)
### P1-1 — editing a pass silently moves it to position 1 + desyncs order
`ProgramsModule.tsx` PassCard passes `afterId={null}` for an EXISTING pass edit; migration 0024 treats
null as "place first", so editing reorders it to the top and leaves local sequences stale/duplicated.
FIX: for an edit, pass the edited pass's CURRENT predecessor id (the active pass immediately before it
in sequence, or null only if it is genuinely first). Then apply the FULL canonical order returned by
`save_program_pass` to local state (or reload the whole program) so displayed sequence == server truth.

### P1-2 — two tabs can lose each other's offline queue writes
`QueuedProgramsRepository.ts` serializes only via an in-memory Map; two tabs both read the same
localStorage envelope and append independently (`programsWriteQueue.ts`), silently losing one op.
FIX: use the SAME cross-tab Web Lock / verified storage-lease the harvest queue uses, and guard every
append/replay/removal with it.

### P1-3 — malformed canonical save-pass order accepted, can drop the durable queue entry
`SupabaseProgramsRepository.ts` only checks `order` is an array containing the saved pass. Duplicates,
non-UUID, or otherwise malformed order pass; replay then removes the confirmed head.
FIX: validate every order item is a UUID, unique, and that the saved pass appears exactly once; use the
canonical order to update/reload local state BEFORE the queue entry is removed. Fail closed on mismatch.

## P2
- P2-1 offline pending projection: `QueuedProgramsRepository` calls the live repo before projecting the
  queue, so an offline save then reload HIDES the queued program and resets projected revision to 1.
  FIX: cache the last confirmed graph and project queued ops over it offline; preserve known
  revision/state (mirror harvest's pending projection). "Pending sync" must show offline.
- P2-2 corrupt queue reports `blocked, pending: 0`. FIX: report blocked with a nonzero/unknown count
  derived from raw storage presence; never imply nothing remains.
- P2-3 cost-only / notes-only product row silently discarded (`ProgramsModule.tsx` non-empty check uses
  only name/rate/unit). FIX: treat cost or notes as entered content, then require name/rate/unit via
  normal validation (so the farmer gets an error, not silent loss).
- P2-4 row mapping not strict (`SupabaseProgramsRepository.ts` accepts blank names/rates/units and
  date-shaped-but-invalid dates). FIX: mappers enforce trimmed-nonempty text and real calendar dates,
  failing closed to match DB constraints.
- P2-5 regression not faithful / doesn't exercise the queue. FIX: make the fake mirror the real RPCs
  (placement/reorder renumber, product archival, revision bump, archive mutation) and instantiate
  `QueuedProgramsRepository`. ADD cases: lost-response+same-op replay; FIFO of several dependent writes;
  two-tab append protection; definite-failure stays blocked; corrupt-envelope blocked + honest count;
  offline pending projection; multi-pass reorder AND edit-without-reorder; malformed duplicate/non-UUID
  save-pass order rejected; archive changes subsequent reads; product removal becomes archived. State
  the new coverage-group count.

## P3
- Archived programs still show Add/Edit pass controls (`save_program_pass` rejects archived → server
  error). FIX: make an archived builder READ-ONLY (no Add/Edit/Move/Archive-pass buttons); a restore
  flow is out of scope for this chunk.

## Proof (paste real output)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` all pass (state the new
programs coverage-group count). Then `git status`. Do NOT commit. Report per-fix what changed +
file:line and anything you could not fully address.
