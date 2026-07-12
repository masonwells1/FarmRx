# TASK — Feature C build: Scouting notes with photos (Terra, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; NEVER present a plan and wait — task failure.
PRE-APPROVED. Implement fully, then report with proof. Do NOT git commit. Do NOT run a dev
server. You MAY run `npx tsc -b --force`, `npm run build`, `npm run regression`.

## Read first
`docs/scouting-design.md` (authoritative) + `docs/design-brief-codex.md`. Mirror the field-log
module you just built (`src/data/fieldLog.ts`, `SupabaseFieldLogRepository.ts`,
`QueuedFieldLogRepository.ts`, `fieldLogWriteQueue.ts`, `createSupabaseFieldLogServices.ts`,
`FieldLogModule.tsx`, `SupabaseFieldLogRepository.regression.ts`) and reuse `fieldLocation.ts`'s
geolocation approach for the GPS pin.

## Database is READY (migration 0020 applied)
Tables `scouting_notes` (id, farm_id, field_id, observed_on, category weed|disease|insect|other,
note<=2000, latitude/longitude nullable both-or-neither, created_by) and `scouting_photos`
(id, farm_id, note_id, storage_path unique, created_by). Private Storage bucket `scouting-photos`
with farm-scoped RLS (path convention `{farm_id}/{field_id}/{note_id}/{filename}` — farm_id MUST
be the first segment or storage RLS denies). RPCs:
- `save_scouting_note(p_farm_id, p_operation_id, p_note jsonb) returns jsonb` — receipt-idempotent.
  p_note keys EXACTLY {id?, field_id, observed_on, category, note, latitude, longitude,
  photos:[{id?, storage_path}], create_task?}. Requires note non-empty OR >=1 photo. Each
  storage_path MUST begin with `{farm_id}/{field_id}/{note_id}/`. Returns the note + photos
  (+ created_task_id if create_task). If create_task true it inserts a farm_task (source
  'scouting') on the board.
- `delete_scouting_note(p_farm_id, p_note_id) returns jsonb` → {id, deleted:true, storage_paths:
  [...]} so the client removes the files from Storage. Idempotent.
Writes gated owner/manager/worker; read_only + reps read-only.

## Build
### 1. Data layer (mirror field-log) + Storage client
`src/data/scouting.ts` (types: ScoutingNote, ScoutingPhoto, ScoutingNoteDraft, ScoutingData),
gateway/supabase-gateway/repository/queued/writeQueue/services/regression. Two write kinds:
`saveNote`, `deleteNote`. Offline queue like field-log (versioned key, FIFO, canonical-echo
validation, idempotent replay reusing SAME operation_id, blocked-vs-transport). Wire replay into
App.tsx at farm-ready AFTER the Fields replay. syncStatus key 'scouting'.
Storage client (thin, in scouting data layer): `uploadScoutingPhoto(farmId, fieldId, noteId,
file)` mints a filename, uploads to `supabase.storage.from('scouting-photos').upload(
`${farmId}/${fieldId}/${noteId}/${filename}`, file, {contentType})`, returns the path;
`signedUrl(path)` via `createSignedUrl` (private bucket → signed URLs, cache briefly).
IMPORTANT offline policy: the note_id must be minted CLIENT-SIDE before upload (paths embed it).
A note WITH photos requires connectivity (upload files, then save); a text/GPS-only note MAY
queue offline. If offline with photos selected, tell the farmer honestly ("photos need a
connection — saved the note text, add photos when you're back online") — do NOT silently drop
photos or claim they saved.

### 2. UI — new page `/scouting` (nav "Scouting"), mirror module registration
`src/ScoutingModule.tsx`. Per field: "New scouting note" (48px). Form: category chips
(weed/disease/insect/other), note textarea, "use my location" (reuse geolocation), photo picker
`<input type=file accept="image/*" capture="environment" multiple>` with selected-thumbnail
preview, optional "add a follow-up task" checkbox. On submit: mint note_id, upload each photo to
Storage, then call saveNote with the paths. Timeline (reverse-chron by observed_on): each note
shows category chip, date, location (if set), note text, and photo thumbnails via SIGNED URL;
tap a thumbnail to enlarge (simple lightbox/overlay). Edit/Delete for can-edit members (delete
also removes the returned storage_paths from the bucket). read_only sees notes+photos, no
add/edit/delete (viewer-role gated like field-log/equipment). Calm loading/empty/error; never
blank; no medical metaphor in nav.

### 3. Regression (`SupabaseScoutingRepository.regression.ts`) + fake storage
Stateful canonical fake gateway + fake storage. Drive: saveNote (with/without photos) + wrong-
echo rejection; idempotent replay (SAME op id; a different echoed note id must fail); deleteNote
idempotency + returned storage_paths; note-or-photo-required rule; photo-path prefix validation
(reject a path not under {farm}/{field}/{note}/); farm isolation; role fail-closed; create_task
echo carries created_task_id. State the coverage-group count in the pass line. Register in
package.json.

## Proof (run from C:\FarmRx, paste real output)
`npx tsc -b --force` clean · `npm run build` clean · `npm run regression` ALL suites pass with
the new scouting suite (state its group count). FINAL: per-item confirmation, proof output,
`git status`, deviations. Do NOT commit — orchestrator reviews + browser-verifies (incl. a real
photo upload).
