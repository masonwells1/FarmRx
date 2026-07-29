# TASK — FOUNDATION BLOCK implementation (Terra, workspace-write)

PRE-APPROVED: modify code in this repository per the blueprint. Do NOT touch
supabase/migrations/** (another agent owns migrations), do NOT run any database DDL,
do NOT use git. Installing npm packages IS allowed (@supabase/supabase-js).

## Mission
Implement the FOUNDATION BLOCK exactly as designed in **docs/foundation-design.md** —
that document is the authoritative spec; follow its file/module table, contracts, and exact
behaviors. Summary of scope:

1. **Supabase client**: src/lib/supabaseConfig.ts + src/lib/supabaseClient.ts verbatim from
   the design (public publishable credentials, hostname assertion, persistent session).
2. **Real auth**: AuthProvider, RequireSession, sign-in/sign-out wired into the EXISTING
   login screen (visuals stay; the fake login goes away), session restore ("Opening your
   farm…"), farmer-English error table from the design, sign-out control in the wrapper
   (48px, "Sign out"), first-owner bootstrap flow per the design (farm insert → trigger
   creates owner membership → entity insert, fail-closed on 0 or >1 farms, resumable
   entity step).
3. **SupabaseFieldsRepository + FieldsDataGateway + SupabaseFieldsDataGateway**: same
   FieldsRepository interface the UI already uses; getData() mapping table; saveField via
   the save_field_bundle RPC contract (the SQL is being drafted in parallel — code against
   the contract in the design; the fake gateway makes all regressions runnable without it).
4. **QueuedFieldsRepository + writeQueue.ts + syncStatus.ts**: durable versioned queue,
   write-then-read-back verification, save algorithm steps 1–7, FIFO replay with
   operation-id reuse, navigator.locks + lease fallback, honest status notice in the app
   wrapper (synced/pending/syncing/blocked wording from the design, ≥18px).
5. **Backend seam**: src/data/backends.ts manifest { fields: 'supabase', grain: 'mock' },
   composition in src/data/index.ts, MockGrainRepository switched to constructor-injected
   FieldsRepository (data-layer only; Grain UI unchanged), no runtime fallback from live
   to mock.
6. **Regression suite**: src/data/SupabaseFieldsRepository.regression.ts implementing ALL
   15 network-free checks from the design's "Executable without network" list, using
   FakeFieldsDataGateway/FakeStorage/fixed clock+UUIDs. Wire it into `npm run regression`
   alongside the two existing suites, which must stay green unmodified in spirit (update
   MockGrainRepository construction where the new injection requires it).

## Constraints
- Fields UI (src/FieldsModule.tsx) must NOT change its repository usage; App.tsx changes
  limited to auth wiring, sign-out, and the global sync notice.
- Grain stays mock. No Supabase grain code may exist yet (the design forbids a factory).
- Brand rules: ≥18px text, ≥48px tap targets, tabular-nums, plain farmer English, no
  medical metaphors in navigation. All user-facing copy verbatim from the design where given.
- Fail closed everywhere: never report Saved/Synced without the confirmation the design
  requires; never fall back to seed data on live errors.
- The dev server may be running (HMR); do not start or stop servers.

## Proof required before you finish (run these, include real output in your final message)
- `npm run build` clean
- `npx tsc --noEmit` clean
- `npm run regression` — all three suites pass

FINAL chat message: what you built (file list), proof output, and any deviations from the
design with one-line justifications. Deviations from stated security/fail-closed behaviors
are not allowed.
