Fixed all four blockers without touching migrations or committing.

- Server-truth link validation: [SupabaseProgramsRepository.ts](/C:/FarmRx/src/data/SupabaseProgramsRepository.ts:96) now reads the linked, non-voided server record before the RPC. Both RPC echo and reread must match its date/acres; stale client fields are ignored.
- Tenant guard: [SupabaseInventoryRepository.ts](/C:/FarmRx/src/data/SupabaseInventoryRepository.ts:32) now maps `farm_id` on Program rows and rejects foreign-farm rows at validation.
- Inventory rendering: [InventoryModule.tsx](/C:/FarmRx/src/InventoryModule.tsx:59) derives Program-linked record cards. Completed records show normal inventory movement separately from free-typed Program lines; zero-product drafts show `Draft / un-posted` with no inventory movement.
- Regressions: stale echoed link rejection plus idempotent replay in [SupabaseProgramsRepository.regression.ts](/C:/FarmRx/src/data/SupabaseProgramsRepository.regression.ts:109); completed/draft rendering and foreign-farm rejection in [SupabaseInventoryRepository.regression.ts](/C:/FarmRx/src/data/SupabaseInventoryRepository.regression.ts:150); behavior-level display derivation in [programsChunk5.regression.ts](/C:/FarmRx/src/data/programsChunk5.regression.ts:26).

New cases:
- False client canonical date/acres cannot validate a wrong server echo.
- Valid server-truth link replays one idempotent receipt.
- Completed linked record: normal inventory lines and Program lines remain separate.
- Product-less draft: safe `Draft / un-posted`, Program lines visible, on-hand unchanged.
- Foreign-farm Program row fails closed.

Proof run:

```text
npx tsc -b --force
Exit code: 0
```

```text
npm run build
✓ built in 1.34s
PWA precache 7 entries
Exit code: 0
```

```text
npm run regression
SupabaseInventoryRepository regression passed (9 coverage groups)
SupabaseProgramsRepository regression passed (23 coverage groups)
Programs Chunk 5 regression passed (4 coverage groups)
…all remaining regression suites passed.
Exit code: 0
```

`git diff --check` was clean. `git status` remains dirty with the existing Chunk 5 work and untracked `supabase/migrations/0026_program_cost_known_lines.sql`; I did not edit that migration or commit anything.