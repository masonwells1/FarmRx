# Feature C — Scouting notes with photos (design)

Third feature of the customer-value batch. Defers to the three handoff rules. Plain English,
18px base, 48px targets, tabular-nums, two-tap. Builds on Feature A (field location/GPS) and
feeds the Tasks board (Modules 5/6). NEW territory: Supabase Storage for photos.

## What the farmer gets
Walk a field, tap **New scouting note**: pick a **category** (weed / disease / insect / other),
write a short note, drop the **GPS pin** where they're standing ("use my location," reusing
Feature A), and attach **photos** (weeds, bugs, damage) taken on the phone. Back at the truck,
the field's scouting timeline shows each note with its photos, category, date, and location.
Optional: **"add a follow-up task"** creates a linked card on the Tasks board ("re-check
rootworm — North Quarter").

## 1. Schema — migration 0020 (Sol drafts; review gate before apply)
Table `public.scouting_notes` (private per-farm member data, mirror inventory/field_log access):
- id, farm_id (fk cascade), field_id (composite same-farm fk to fields), observed_on date
  (<= current_date + 1), category text check in ('weed','disease','insect','other'),
  note text (<= 2000, may be empty if photos present — but require note OR >=1 photo),
  latitude numeric(9,6) / longitude numeric(9,6) nullable (both-set-or-both-null check),
  created_by uuid provenance stamp, created_at, updated_at + triggers.
Child table `public.scouting_photos`:
- id, farm_id, note_id (composite fk (note_id, farm_id) -> scouting_notes(id, farm_id) cascade),
  storage_path text not null unique, created_by, created_at.
  storage_path convention: `{farm_id}/{field_id}/{note_id}/{uuid}` (farm_id FIRST segment — the
  storage RLS keys on it).
RLS on both tables: read = can_access_farm; write = can_edit_farm (owner/manager/worker).

Save/delete RPCs (SECURITY DEFINER, receipt-idempotent where it inserts, 0017 no-FOR-UPDATE):
- `save_scouting_note(p_farm_id, p_operation_id, p_note jsonb)` — upserts the note AND its photo
  rows (photo storage_paths passed in the jsonb; the actual file bytes are uploaded to Storage
  by the client BEFORE calling this — the RPC only records the paths). Validates each photo path
  begins with `{farm_id}/{field_id}/{note_id}/`. Require note non-empty OR >=1 photo. Returns the
  canonical note + photos. Optional `create_task boolean` → also inserts a farm_task (source
  'scouting') linked to field_id, title from category+note — reuse the equipment/task insert path
  so the board picks it up.
- `delete_scouting_note(p_farm_id, p_note_id)` — deletes the note (+ cascade photo rows);
  RETURNS the deleted photo storage_paths so the client can delete the files from Storage.
  Idempotent.

## 2. Storage — bucket + policies (in 0020 or a paired file; Sol confirms exact storage RLS)
- Create a PRIVATE bucket `scouting-photos` (`insert into storage.buckets (id, name, public)
  values ('scouting-photos','scouting-photos', false)`), with a file size limit + allowed image
  mime types if supported.
- RLS policies on `storage.objects` for that bucket, farm-scoped by the FIRST path segment:
  - SELECT (view/download): the first path segment (`split_part(name,'/',1)::uuid`) is a farm the
    caller `can_access_farm`.
  - INSERT (upload): first segment is a farm the caller `can_edit_farm`, bucket_id =
    'scouting-photos'.
  - DELETE: first segment is a farm the caller `can_edit_farm`.
  - (No UPDATE.) Read the Supabase storage RLS docs; get the predicate exactly right — this is
    the security boundary for customer photos. Confirm anon has NO access.

## 3. Data layer (mirror the module pattern) + Storage client
`src/data/scouting.ts` (types), gateway/repository/queued/writeQueue/services/regression like
field-log. PLUS a thin Storage client: `uploadScoutingPhoto(farmId, fieldId, noteId, file)` →
uploads to the bucket at the convention path via `supabase.storage.from('scouting-photos')`,
returns the path; `getSignedUrl(path)` for display (private bucket → signed URLs).
OFFLINE NOTE: photo bytes can't ride the JSON write queue. v1 policy: creating a note WITH photos
requires connectivity (upload then save); a text-only/GPS note MAY queue offline like field-log.
State this honestly in the UI ("photos need a connection"). Do not silently drop photos offline.

## 4. UI — new page `/scouting` (nav "Scouting"), mirror module registration
Per-field: "New scouting note" (48px). Form: category chips, note textarea, "use my location"
(reuse Feature A geolocation), photo picker (`<input type=file accept=image/* capture=environment
multiple>`), optional "add a follow-up task" checkbox. Timeline of notes: thumbnail(s) (signed
URL), category chip, date, location, note; tap a photo to enlarge; edit/delete for can-edit
members (role-gated). read_only sees notes+photos, no add/edit/delete. Calm loading/empty/error;
never blank; no medical metaphor in nav.

## 5. Regression + proof
Suite: note save/delete + wrong-echo rejection, idempotent replay, photo-path validation
(reject a path whose farm/field/note segments don't match), note-or-photo-required rule,
farm isolation, role gating, follow-up-task creation. Storage client can be faked. State group
count. PROOF: Claude verifies on farm-rx — create a scouting note with a real uploaded image on
North Quarter, see it in the timeline via signed URL, confirm the note row + photo row in
Postgres AND the object in the bucket; delete → note/photo rows gone + file removed; a
follow-up task appears on the board. Role-gate holds.

## Scope guards (v1)
- No pest/disease AI identification, no annotation/drawing on photos, no video. No public sharing.
- Photos are private (signed URLs only). Offline note-with-photo requires connectivity (honest).
- Follow-up task is optional and reuses the existing board — no new task concepts.
