# TASK — Grain LIVE swap implementation (Terra, workspace-write)

CRITICAL EXECUTION RULE: headless, no human; never present a plan and wait — that is a task
failure. Everything here is PRE-APPROVED. Implement fully, then report with proof.

PRE-APPROVED scope: modify src/** and package.json. Do NOT touch supabase/migrations/**
(another agent is drafting 0012 in parallel — code against the RPC contract in the design),
no database operations, no git, no servers.

## Mission
Implement **docs/grain-live-design.md** (the authoritative spec — read it fully first).
Build SupabaseGrainRepository + gateway + queue integration behind the UNCHANGED
GrainRepository interface, plus the USDA MARS basis feed and v1 owner-only alerts exactly
as the design states. Mirror the proven Fields pattern (SupabaseFieldsRepository,
SupabaseFieldsDataGateway, QueuedFieldsRepository, writeQueue.ts).

Key requirements (the design document's word wins on any conflict):
1. Strict fail-closed row mappers; farm binding on every query; no fallback to mock/seed.
2. Write paths per the design: plain PostgREST upserts with client-generated IDs where the
   design says so; the marketing-plan replacement goes through the 0012 RPC contract
   (`replace_marketing_plan`-style signature per the design — code to the documented
   contract; a fake gateway makes regressions runnable before the SQL exists).
3. Offline queue for grain writes: separate versioned key, FIFO, idempotency per the
   design's per-write mechanism, same lock discipline as Fields, honest synced/pending.
4. Release flip: backends.ts `grain: 'supabase'` + composition via a real
   createSupabaseGrainServices factory; mock test data in localStorage is DISCARDED on
   swap per the design (state shown to owner stays honest).
5. USDA MARS basis feed + alerts v1 exactly per design (display-only boundaries respected).
6. Regression suite `SupabaseGrainRepository.regression.ts` implementing the design's
   network-free checklist, wired into `npm run regression`; existing suites stay green.

## Proof required (run, paste real output)
`npm run build` clean · `npx tsc --noEmit` clean · `npm run regression` all suites pass.
FINAL message: files built, proof output, deviations with one-line justifications.
