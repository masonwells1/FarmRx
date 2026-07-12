# TASK — Adversarial review: Feature C (scouting notes + photos) (Sol, read-mostly)

CRITICAL EXECUTION RULE: headless, no human; NEVER present a plan and wait — task failure. Review
fully, then report. Do NOT fix, do NOT commit, do NOT run servers. You MAY read any file and run
`npx tsc -b --force` / `npm run regression`.

## Scope
Feature C built by Terra on applied migration 0020 (scouting_notes + scouting_photos tables;
private `scouting-photos` Storage bucket with farm-scoped RLS on the FIRST path segment; RPCs
`save_scouting_note` receipt-idempotent + create_task board integration, `delete_scouting_note`
returns storage_paths; writes gated owner/manager/worker). Spec: `docs/scouting-design.md`.
Review NEW: `src/ScoutingModule.tsx`, `src/data/scouting.ts`, `ScoutingDataGateway.ts`,
`SupabaseScoutingDataGateway.ts`, `SupabaseScoutingRepository.ts`, `QueuedScoutingRepository.ts`,
`scoutingWriteQueue.ts`, `scoutingStorage.ts`, `createSupabaseScoutingServices.ts`,
`SupabaseScoutingRepository.regression.ts`. CHANGED: `App.tsx`, `index.ts`, `backends.ts`,
`syncStatus.ts`, `styles/app.css`, `package.json`.

## Hunt hard (rank P1/P2/P3, file:line + concrete failure)
1. **Photo path + storage security** — client builds paths `{farmId}/{fieldId}/{noteId}/{file}`;
   confirm farmId is ALWAYS the first segment (or storage RLS denies) and the note_id is minted
   client-side BEFORE upload and reused in the save (paths embed it). Can a crafted filename with
   `/` or `..` escape the prefix or collide across notes? Is the uploaded contentType constrained
   to images? Are signed URLs used for a PRIVATE bucket (never public URLs)? Signed-URL caching/
   expiry sane?
2. **Offline photo policy honesty** — a note WITH photos requires connectivity. Confirm: offline-
   with-photos does NOT silently drop photos or claim they saved; the note_id used for the queued
   text note must match any later photo upload (or the design's honest "add photos when online"
   path). No orphaned queue entry that can never replay. Text/GPS-only note may queue.
3. **Upload/save atomicity** — files upload BEFORE save_scouting_note records paths. If the RPC
   save fails after a successful upload, are the just-uploaded orphan files handled/cleaned or at
   least not shown as a saved note? If delete returns storage_paths, does the client actually
   remove those files from Storage (and handle partial failure)?
4. **Write queue** — echo validation (saved note id/farm_id + photos array; delete echo {id,
   deleted:true, storage_paths}); idempotent replay reuses SAME operation_id (different echoed id
   must fail a test); create_task echo carries created_task_id; corrupt envelope fail-closed;
   App.tsx scouting replay runs AFTER Fields replay.
5. **Note-or-photo rule + validation** — client enforces note non-empty OR >=1 photo (matches RPC);
   category one of the four; observed_on future bound; lat/long both-or-neither; DB-equivalent
   validation at the repository boundary (not just the form).
6. **Role gating** — read_only sees notes+photos but NO add/edit/delete; worker CAN. Viewer role
   threaded (not farm creator).
7. **Brand/rules** — 18px base, 48px targets, tabular-nums, plain English, no medical metaphor in
   nav; 375px no page overflow; photo thumbnails/lightbox don't break layout; long notes wrap.
8. **Regression realness** — does the suite drive save (with/without photos) + wrong-echo + photo-
   path prefix rejection + idempotent replay + delete idempotency + role fail-closed + farm
   isolation + create_task echo, with a fake storage? Name missing critical cases. Confirm it runs.

## Output
Run `npx tsc -b --force` and `npm run regression`; state real results. Findings ranked P1/P2/P3
with file:line + failure scenario + fix. One-line verdict: SHIP-AFTER-FIXES (list P1s) or CLEAN.
