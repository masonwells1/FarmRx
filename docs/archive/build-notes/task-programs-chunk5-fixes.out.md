Implemented all Chunk 5 client/UI fixes; no commit and no migration edits.

- Full Season Tracker restored with additive spray guidance, application-record choices, and partial-safe costs: [ProgramsModule.tsx](C:\FarmRx\src\ProgramsModule.tsx:19)
- Link validation now uses the selected record’s canonical date/acres, including reread checks: [SupabaseProgramsRepository.ts](C:\FarmRx\src\data\SupabaseProgramsRepository.ts:95)
- Offline Apply/Skip/Reschedule now locates by `assignedPassId`, projects pending state, products, links, and canonical values: [QueuedProgramsRepository.ts](C:\FarmRx\src\data\QueuedProgramsRepository.ts:22)
- Cost mapper fails closed on incomplete/inconsistent gated totals; UI never converts missing totals to `$0.00`: [SupabaseProgramsRepository.ts](C:\FarmRx\src\data\SupabaseProgramsRepository.ts:23)
- Inventory accepts completed Program links and clearly separates free-typed Program lines from inventory movement: [SupabaseInventoryRepository.ts](C:\FarmRx\src\data\SupabaseInventoryRepository.ts:43), [InventoryModule.tsx](C:\FarmRx\src\InventoryModule.tsx:59)
- Deleted the minimal `src/ProgramSeasonTracker.tsx`.

Verification run:

```text
npx tsc -b --force
Exit code: 0

npm run regression
Exit code: 0
SupabaseInventoryRepository regression passed (9 coverage groups)
SupabaseProgramsRepository regression passed (23 coverage groups)
Programs Chunk 5 regression passed (4 coverage groups)

npm run build
✓ built in 1.36s
PWA precache 7 entries
```

The build emitted only Vite’s existing large-chunk advisory. `git diff --check` passed. `git status` remains dirty with the existing Chunk 5/Opus files, including `supabase/migrations/0026_program_cost_known_lines.sql`; I did not modify migration files or commit anything.