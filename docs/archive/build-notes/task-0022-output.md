Verification is limited to static checks because applying to any database was explicitly prohibited.

What ran:

- `git diff --check`: passed.
- Adversarial contract checks: all passed for exact keys, `can_edit_farm`, farm-scoped lookup/update, null clearing, no expected-price assignment, no `FOR UPDATE`, receipt lock ordering, and grants.
- PostgreSQL execution was unavailable: `psql` and Docker are not installed, and the Supabase executable returned `Access is denied`.

Remaining unverified: PostgreSQL compilation and actual RPC execution against a database. The orchestrator must prove those when it reviews/applies migration 0022.