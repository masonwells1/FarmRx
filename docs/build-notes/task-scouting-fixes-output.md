`0021_scouting_bucket_limits.sql` was not edited or applied by me.

Static check confirms it sets the expected server guard:

```sql
file_size_limit = 20971520
allowed_mime_types = ['image/jpeg','image/png','image/webp','image/heic','image/heif']
```

It remains unverified against Supabase: `C:\FarmRx` has no `supabase/config.toml`, so a read-only `supabase migration list --linked` could not run.