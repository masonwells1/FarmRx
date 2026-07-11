# TASK — Grain live swap adversarial review (Sol, read-only)

CRITICAL EXECUTION RULE: headless, no human; produce the review document as your FINAL
message — never ask for approval. Read code, do not run it.

Review the grain live implementation against **docs/grain-live-design.md** (authoritative)
and the applied schema (migrations 0004/0005/0008; plus the NEW draft 0012_grain_live_support.sql
— verify the code's RPC usage matches its exact signature/semantics).

## Scope (uncommitted changes)
New: src/data/GrainDataGateway.ts, SupabaseGrainDataGateway.ts, SupabaseGrainRepository.ts,
QueuedGrainRepository.ts, SupabaseGrainRepository.regression.ts, src/data/grainAlerts.ts (+
any other new files per git status). Modified: src/GrainModule.tsx, src/App.tsx,
src/data/{backends,index}.ts, SupabaseFieldsRepository.regression.ts, package.json.

## Hunt specifically for
1. **Fail-open paths**: any save reported without confirmed write; any fallback to mock
   grain on live errors; alert evaluation silently swallowing load errors.
2. **RPC contract match**: replaceMarketingPlanTargets calls
   public.replace_marketing_plan_targets(p_farm_id, p_crop_year, p_commodity_id,
   p_operating_entity_id, p_enterprise_label, p_targets jsonb) returning the canonical
   row set — argument names/types/normalization EXACT vs 0012; idempotency under replay;
   client never trusts its own rows over returned canonical rows.
3. **Queue integrity**: grain queue separate key + FIFO + same lock discipline as Fields;
   per-write idempotency mechanism per design (client IDs + upserts); cross-user isolation;
   no queue replay against the wrong farm; honest synced/pending.
4. **Strict mappers**: fail-closed on unknown enums/non-finite numbers; farm binding on
   every query; scope columns (crop_year, commodity, entity, enterprise) handled with
   nulls-distinct semantics matching the DB.
5. **Privacy**: 0008 means grain reads can be DENIED for non-owner members — verify the UI
   fails honestly (farmer-English, no crash/dishonest empty state) when RLS returns
   nothing/denies.
6. **USDA MARS feed**: display-only boundary respected; failures calm; no third-party quote
   values entering position math beyond what the design allows (manual prices stay the
   math source).
7. **Alerts v1**: owner-only per design; requestOwnerAlertDelivery cannot spam (dedup/
   throttle per design); no email content built from unsanitized data; failure invisible-
   but-logged vs silent data loss — per design.
8. **Mock discard**: swap discards practice grain data per design — verify no path reads
   the old mock key into live state.
9. **Regression honesty** + backends manifest regression updated correctly (fields+grain
   supabase, profitability+inventory mock).

## Output format (FINAL message = ONLY this markdown document)
## Findings
Numbered. **P1**/**P2** — title, file:line, what breaks, concrete fix.
Short verified-clean paragraph.
VERDICT: COMMIT-READY or NEEDS FIXES (n P1)
