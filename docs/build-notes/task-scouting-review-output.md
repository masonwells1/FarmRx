Verdict: **SHIP-AFTER-FIXES — P1s: valid photo-only saves falsely fail; GPS saves falsely fail after rounding; failed Storage deletion permanently loses cleanup paths.**

## P1

1. **Valid photo-only notes commit, then the client reports failure.**  
   [0020_scouting.sql](/C:/FarmRx/supabase/migrations/0020_scouting.sql:290) converts empty text to SQL `null`, but [SupabaseScoutingRepository.ts](/C:/FarmRx/src/data/SupabaseScoutingRepository.ts:14) requires `note` to be a string. A photo-only note therefore uploads and commits successfully, then canonical echo validation throws. I reproduced this with a SQL-shaped response.  
   **Fix:** consistently model `note` as nullable, or make the RPC return `coalesce(note, '')`, and add a SQL-faithful regression.

2. **Normal phone GPS precision commits, then fails echo validation.**  
   The database stores coordinates as `numeric(9,6)` at [0020_scouting.sql](/C:/FarmRx/supabase/migrations/0020_scouting.sql:23), while geolocation sends unrounded coordinates at [ScoutingModule.tsx](/C:/FarmRx/src/ScoutingModule.tsx:33). Strict comparison at [SupabaseScoutingRepository.ts](/C:/FarmRx/src/data/SupabaseScoutingRepository.ts:16) rejects the rounded canonical response. The farmer sees failure even though the note committed; retrying with `create_task` can create duplicate follow-up tasks. I reproduced this failure.  
   **Fix:** round coordinates to six decimals before upload/save and compare normalized values.

3. **A failed photo deletion becomes unrecoverable.**  
   [QueuedScoutingRepository.ts](/C:/FarmRx/src/data/QueuedScoutingRepository.ts:17) deletes the database row before removing Storage objects. If Storage removal fails, the delete is queued; replay calls the RPC again, but [0020_scouting.sql](/C:/FarmRx/supabase/migrations/0020_scouting.sql:570) now finds no photo rows and returns an empty path list. The queue clears while the supposedly deleted photos remain indefinitely. The UI also attempts the same removal a second time at [ScoutingModule.tsx](/C:/FarmRx/src/ScoutingModule.tsx:26).  
   **Fix:** retain the original paths in a durable delete receipt/queue operation and assign Storage removal to one layer only.

## P2

4. **Successful uploads are not recovered when save fails.**  
   [ScoutingModule.tsx](/C:/FarmRx/src/ScoutingModule.tsx:23) uploads all files before saving, with no rollback for partial upload or definite RPC failure. On an ambiguous network failure, the queue tries to persist uploaded paths, but [scoutingWriteQueue.ts](/C:/FarmRx/src/data/scoutingWriteQueue.ts:9) rejects every save containing photos. That leaves unrecorded objects and no replayable save.  
   **Fix:** allow already-uploaded path metadata—not photo bytes—in the queue, reuse the same operation ID, and clean up paths only after a definitely failed save.

5. **The “image-only” Storage boundary is not enforced.**  
   The bucket has neither `allowed_mime_types` nor `file_size_limit` at [0020_scouting.sql](/C:/FarmRx/supabase/migrations/0020_scouting.sql:129). The client forwards arbitrary `file.type` at [scoutingStorage.ts](/C:/FarmRx/src/data/scoutingStorage.ts:4); HTML `accept="image/*"` is only a picker hint and is bypassable.  
   **Fix:** configure bucket MIME/size restrictions and reject non-image or oversized files before upload.

6. **The regression suite’s fake backend hides real production behavior.**  
   [SupabaseScoutingRepository.regression.ts](/C:/FarmRx/src/data/SupabaseScoutingRepository.regression.ts:20) returns drafts without SQL null conversion or six-decimal rounding. Its delete fake also caches paths forever at line 21, unlike the real delete RPC. Consequently all six groups pass while the P1 failures remain. Missing cases include:

   - SQL-shaped photo-only and GPS responses
   - wrong note-ID path segment
   - corrupt queue envelopes
   - offline/new-photo and upload/save failure handling
   - partial upload cleanup
   - real delete retry after rows are gone
   - MIME and size enforcement
   - actual read-only RPC rejection versus worker success

   **Fix:** make the fake mirror SQL normalization and add focused storage/queue failure tests.

## P3

7. **Path validation accepts dot segments and extra hierarchy.**  
   Both [SupabaseScoutingRepository.ts](/C:/FarmRx/src/data/SupabaseScoutingRepository.ts:24) and [0020_scouting.sql](/C:/FarmRx/supabase/migrations/0020_scouting.sql:368) only test a string prefix. Crafted paths such as `farm/field/note/../other/file` pass. The normal uploader is safe because it generates a random filename at [scoutingStorage.ts](/C:/FarmRx/src/data/scoutingStorage.ts:4), but the repository/RPC boundary is weaker than the stated convention.  
   **Fix:** parse segments, require the exact farm/field/note UUIDs, and reject empty, `.` and `..` segments.

8. **Repository offline wording can claim an unsaved note was saved.**  
   [QueuedScoutingRepository.ts](/C:/FarmRx/src/data/QueuedScoutingRepository.ts:19) throws “Saved the note text” before saving anything when called offline with photo paths. The main new-note UI usually avoids this, but connection-loss races and other callers do not.  
   **Fix:** use wording that does not claim success, or explicitly queue the text-only draft first.

## Verification

- `npx tsc -b --force`: **could not run** because the global `npx` launcher references missing `npx-cli.js`.
- `npm run regression`: **could not run** because the global `npm` launcher references missing `npm-cli.js`.
- Local TypeScript fallback, `node_modules\.bin\tsc.cmd -b --force`: **PASS**.
- Local execution of the complete regression script list: **PASS**, including `SupabaseScoutingRepository regression passed (6 coverage groups)`.
- No files changed, no servers run, no commits made.

Confirmed clean: the normal uploader places `farmId` first, mints/reuses the note ID before upload, randomizes filenames, uses private signed URLs with sensible 300/270-second expiry, replays scouting after Fields, threads membership role correctly, and preserves the main 18px/48px/mobile wrapping rules.

