# FarmRx Supabase advisor disposition

Date: 2026-07-18
Project: `agvsozfbstpekuqxpqjr` (`farm-rx`)
Live status during audit: `ACTIVE_HEALTHY`, PostgreSQL 17.6
Organization plan: Free
Migration: `20260718124337_harden_database_advisor_findings.sql`
Live application status: **not applied by this work lane**

## Decision

Apply the narrow migration after the disposable proof and full release gate pass. It removes the actionable security warning, optimizes the exact 25 flagged RLS policies, covers every public foreign key, and removes one proven duplicate index without changing FarmRx row-access rules or widening the Data API.

Supabase documents that wrapping `auth.uid()` in a scalar `select` lets PostgreSQL initialize the value once per statement instead of re-evaluating it per row. It also recommends indexing columns used by RLS and common relational access paths. See [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) and [Database linter](https://supabase.com/docs/guides/database/database-linter).

The July 17 Envoy gateway breaking change is self-hosted-only and does not affect this hosted FarmRx project. The April 2026 default-grant change affects how new tables are exposed, but this migration creates no tables and grants no table access. See [Supabase changelog](https://supabase.com/changelog?tags=breaking-change).

## Advisor disposition

| Advisor category | Before | Expected after apply | Disposition |
|---|---:|---:|---|
| `auth_rls_initplan` | 25 | 0 | Fixed by changing only direct `auth.uid()` calls to `(select auth.uid())` in the exact flagged policies. Farm, role, ownership, and row-link predicates remain unchanged. |
| `unindexed_foreign_keys` | 62 | 0 | Fixed with 66 minimal full B-tree indexes: 62 advisor findings plus four FKs that were only apparently covered by unrelated partial indexes. No pair shares a reusable left prefix. The only accepted partial coverage is `IS NOT NULL` on the nullable `firm_offers.filled_contract_id` and `push_delivery_targets.subscription_id` references. |
| `duplicate_index` | 1 | 0 | Drop `firm_offers_id_farm_id_idx`; retain constraint-backed `firm_offers_id_farm_id_key`. |
| Anonymous executable SECURITY DEFINER | 1 | 0 | Revoke `PUBLIC`, `anon`, and `authenticated` execution from `enqueue_push_delivery()`. Its notification trigger continues to execute as the table owner. |
| Authenticated executable SECURITY DEFINER | 49 | 48 | The removed item is the internal trigger function above. The remaining 48 are intended signed-in FarmRx RPCs or RLS access helpers. The disposable proof requires the exact reviewed endpoint/signature allowlist, denies anonymous execution, and exercises an authenticated read-only member against a representative writer. A broad move or invoker conversion would break the guarded atomic write paths and is not justified here. |
| RLS enabled with no policy | 7 | 7 | Intentional internal deny-by-default tables; leave unchanged. Each has RLS enabled, no policy, and no `SELECT`, `INSERT`, `UPDATE`, or `DELETE` privilege for `anon` or `authenticated`. |
| Unused indexes | 10 | At least 76 initially | Do not remove based on a new, low-traffic project snapshot. The existing ten serve declared app query or relational paths. The 66 new FK indexes will initially have zero scans by definition. Reassess only after representative production traffic and `pg_stat_user_indexes` history. |
| Leaked-password protection | 1 | 1 | Plan-blocked. FarmRx is on the Free plan; Supabase documents leaked-password protection as Pro and above. Enable immediately if the organization upgrades. See [Password security](https://supabase.com/docs/guides/auth/password-security). |

## Intentional internal tables

These seven public-schema tables remain unavailable to browser roles and are written only through guarded functions, triggers, or service operations:

- `alert_rule_states`
- `farm_access_epochs`
- `push_deliveries`
- `push_delivery_targets`
- `repository_write_receipts`
- `service_log_meter_readings`
- `spray_window_states`

Adding always-false policies would only silence an informational lint; it would not improve on the existing RLS-plus-no-grant posture.

## Proof added

`scripts/verify-0043-disposable.ps1` rebuilds the schema in disposable PostgreSQL 17 and proves:

- all 25 named policies exactly match reviewed PG17 catalog fingerprints for command, role, mode, `USING`, and `WITH CHECK`;
- every public foreign key has a valid full covering left-prefix index, except the two explicitly allowed nullable-FK `IS NOT NULL` partial indexes;
- no anonymous-executable public SECURITY DEFINER function remains;
- authenticated SECURITY DEFINER access exactly matches the reviewed 48-signature allowlist, and negative anonymous/read-only calls are denied;
- representative optimized INSERT and UPDATE policies deny a read-only write and an outside-user/cross-farm mutation;
- the duplicate manual index is gone and the unique constraint index remains;
- the seven internal tables retain RLS, no policies, and no browser-role DML privileges;
- revoking client execution from `enqueue_push_delivery()` does not stop its notification trigger.

The proof is integrated into `scripts/verify-foundation.ps1`. `verify-0042-disposable.ps1` explicitly excludes the later advisor migration so its historical 0042 ordering remains deterministic.

## Controlled red mutations

Each mutation was applied temporarily, observed failing, and then restored before the final green run:

1. Replaced the optimized `programs_insert` expression with direct `auth.uid()`: failed with `expected 25 exact optimized policy definitions, found 24`.
2. Removed the full `farm_memberships(user_id)` index while leaving its unrelated active-only partial index: failed with `1 public foreign keys remain without a covering index`.
3. Re-granted anonymous execution on `enqueue_push_delivery()`: failed with `client roles can still execute the internal push trigger function`.
4. Replaced `append_bin_movement` authorization enforcement with a no-op `perform auth.uid()`: the catalog allowlist still matched, but the read-only behavioral probe failed. This proves the gate does not certify source-text mention as enforcement.

After restoration, `verify-0043-disposable.ps1`, `verify-0042-disposable.ps1`, and `verify-rls-role-matrix.ps1` all passed.

## Remaining release risk

The migration creates 66 indexes. Its index DDL uses a five-second `lock_timeout` and five-minute `statement_timeout`, then explicitly resets both settings, so a busy table fails the release instead of waiting indefinitely. Current FarmRx tables are very small, so the expected lock/build window is short. Before production apply, the release orchestrator should re-run advisors and inspect relation sizes. After apply, re-run both advisor classes and the RLS role matrix, then confirm the notification-to-push-delivery trigger on the live schema with a non-destructive catalog check or normal application event.
