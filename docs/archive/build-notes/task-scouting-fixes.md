# TASK — Feature C review fixes (Terra, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; NEVER present a plan and wait — task failure.
PRE-APPROVED. Fix EVERY item, then report with proof. Do NOT git commit. Do NOT run a dev
server. You MAY run `npx tsc -b --force`, `npm run build`, `npm run regression`.
NOTE: bucket MIME/size LIMITS (P2-5 server side) are handled by the orchestrator via a separate
migration — you only do the CLIENT-side file validation part of P2-5.

Files in scope: `src/data/SupabaseScoutingRepository.ts`, `src/ScoutingModule.tsx`,
`src/data/QueuedScoutingRepository.ts`, `src/data/scoutingWriteQueue.ts`,
`src/data/scoutingStorage.ts`, `src/data/scouting.ts`,
`src/data/SupabaseScoutingRepository.regression.ts`. Migration 0020 is APPLIED — do NOT edit it;
work to its actual behavior (it converts empty note to SQL null, stores coords numeric(9,6),
delete RPC returns storage_paths only from existing photo rows).

## P1
### P1-1 — photo-only notes commit then the client falsely reports failure
The RPC converts empty/whitespace note to SQL `null`, but the repository echo/mapper requires
`note` to be a string, so a valid photo-only note (note omitted/empty, >=1 photo) commits and
then canonical-echo validation THROWS. FIX: model `note` as `string | null` consistently in the
type + echo mapper; accept null. Add a SQL-faithful regression (echo with note:null accepted).

### P1-2 — normal phone GPS precision commits then fails echo validation
Geolocation sends unrounded coords; the DB stores numeric(9,6) and echoes rounded values; strict
equality in the mapper rejects them, so a GPS note shows failure though it committed (and a
retry with create_task can DOUBLE the follow-up task). FIX: round latitude/longitude to 6
decimals BEFORE upload/save, and compare normalized (6-dp) values in the echo mapper. Add a
regression: unrounded input → rounded canonical echo accepted.

### P1-3 — a failed photo deletion becomes unrecoverable
`QueuedScoutingRepository` deletes the DB row (RPC) BEFORE removing Storage objects; if Storage
removal fails, replay re-calls the RPC which now finds no photo rows and returns an EMPTY path
list, so the queue clears while the files remain forever. The UI also re-attempts the same
removal. FIX: capture the note's storage_paths BEFORE the delete and carry them in the durable
delete queue operation; do Storage removal in ONE layer only (the queue/repository, not also the
module); on a failed Storage delete, keep the paths in the queue op so replay retries the FILE
removal even though the rows are already gone. Add a regression: delete retry after rows gone
still carries + retries the original paths.

## P2
### P2-4 — successful uploads not recovered when save fails
Photos upload before save with no rollback for partial upload / definite RPC failure; the queue
`scoutingWriteQueue` rejects any save containing photos, leaving orphaned objects and no
replayable save. FIX: allow already-uploaded photo PATH METADATA (not bytes) in the queue,
reuse the SAME operation id, and only clean up uploaded paths after a DEFINITELY-failed save
(not on ambiguous/transport failure — those must queue for replay). Add regressions for
upload-then-save-transport-failure (queues, replays, no orphan) and definite-failure (paths
cleaned).

### P2-5 (CLIENT portion) — reject non-image/oversized before upload
`scoutingStorage` forwards arbitrary `file.type`; `accept="image/*"` is only a hint. FIX:
client-side, reject files whose type is not one of image/jpeg,image/png,image/webp,image/heic,
image/heif OR larger than 20 MB, with a plain farmer message, BEFORE uploading. (The bucket will
also enforce this server-side via a separate migration.)

### P2-6 — regression fake hides real behavior
`SupabaseScoutingRepository.regression.ts` returns drafts without SQL null-conversion or 6-dp
rounding, and its delete fake caches paths forever (unlike the real RPC). Rebuild the fake to
MIRROR the real SQL: empty note → null; coords rounded to 6 dp; delete returns paths only for
still-present rows. Add the missing cases: SQL-shaped photo-only + GPS echoes; wrong note-ID path
segment rejected; corrupt queue envelope fail-closed; offline/new-photo + upload/save-failure;
partial-upload cleanup; real delete retry after rows gone; client MIME/size rejection; read_only
RPC rejection vs worker success. State the new coverage-group count.

## P3
### P3-7 — path validation accepts dot/extra segments
Both the repository and (already-applied) RPC only prefix-check. Client/repository FIX: parse the
path into segments and require EXACTLY `{farmId}/{fieldId}/{noteId}/{filename}` with those exact
UUIDs and a non-empty final filename; reject empty, `.`, `..`, or extra-depth segments. (The
random-filename uploader is already safe; harden the boundary anyway.)

### P3-8 — offline wording can claim an unsaved note was saved
`QueuedScoutingRepository` (~L19) throws "Saved the note text" before saving when called offline
with photo paths. FIX: use wording that does not claim success, or explicitly queue the text-only
draft first so the claim is true.

## Proof (run from C:\FarmRx, paste real output)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` ALL suites pass with
the rebuilt scouting suite (state its new group count). FINAL: per-fix confirmation, proof
output, `git status`, deviations. Do NOT commit.
