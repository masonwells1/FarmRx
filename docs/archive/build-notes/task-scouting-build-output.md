Verified relevant executable paths:

- Typecheck passed.
- Production build passed.
- Full regression suite passed, including `SupabaseScoutingRepository` (6 coverage groups) covering saves, photo paths, replay receipts, deletes, roles, and farm isolation.

The new UI itself remains unverified in a browser because you explicitly prohibited starting a dev server; I did not bypass that. The orchestrator’s browser verification should cover the `/scouting` interaction and real Storage upload.