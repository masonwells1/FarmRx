-- Hardening: the bootstrap trigger function must not be callable via the API.
-- Triggers run as the table owner, so no caller EXECUTE grant is needed.
-- Applied to farm-rx 2026-07-11 alongside 0001/0002.
revoke all on function public.bootstrap_farm_owner_membership() from public, anon, authenticated;
