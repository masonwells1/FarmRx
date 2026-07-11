Migration draft is written and statically checked, but not database-proven because the task explicitly prohibited database operations.

Repository verification found unrelated Grain adapter work currently fails TypeScript compilation, and `SupabaseFieldsRepository.regression.ts` fails because the backend manifest changed from mock to Supabase. I did not modify those out-of-scope files.

Exact RPC signature:

```sql
public.replace_marketing_plan_targets(
  p_farm_id uuid,
  p_crop_year integer,
  p_commodity_id text,
  p_operating_entity_id uuid,
  p_enterprise_label text,
  p_targets jsonb
) RETURNS SETOF public.marketing_plan_targets
```