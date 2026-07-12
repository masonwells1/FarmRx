-- Hardens the scouting-photos bucket (0020) with server-side MIME + size limits.
-- Additive/idempotent: only sets restrictions on the existing private bucket so a
-- bypassed client accept-hint cannot upload non-images or oversized files. The
-- client also validates before upload (Feature C fixes), but this is the hard guard.
update storage.buckets
set
  file_size_limit = 20971520, -- 20 MB; phone photos are well under this
  allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
where id = 'scouting-photos';
