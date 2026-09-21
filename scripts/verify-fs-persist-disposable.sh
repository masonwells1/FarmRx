#!/usr/bin/env bash
# Disposable proof for migration 20260913174500 on a throwaway local
# PostgreSQL cluster (Linux; needs initdb/pg_ctl/psql from PostgreSQL 15+).
# The PowerShell twin, verify-fs-persist-disposable.ps1, runs the same SQL
# against a postgres:17 container for Windows and the Foundation workflow.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
bin="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)"
[ -n "$bin" ] || { echo "PostgreSQL server binaries not found" >&2; exit 1; }
port="${FS_PROOF_PORT:-5499}"
data="$(mktemp -d /tmp/farmrx-fs-persist-XXXXXX)"
runas=()
if [ "$(id -u)" = "0" ]; then
  id postgres >/dev/null 2>&1 || useradd -M -s /usr/sbin/nologin postgres
  chown postgres "$data"; runas=(runuser -u postgres --)
fi
cleanup() { "${runas[@]}" "$bin/pg_ctl" -D "$data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$data"; }
trap cleanup EXIT
"${runas[@]}" "$bin/initdb" -D "$data" -U postgres -A trust >/dev/null
"${runas[@]}" "$bin/pg_ctl" -D "$data" -o "-p $port -c listen_addresses=127.0.0.1" -w -l "$data/server.log" start >/dev/null
psql_() { "$bin/psql" -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$port" -U postgres "$@"; }
psql_ -d postgres -c "create database farmrx_disposable" >/dev/null
psql_ -d farmrx_disposable -c "create role anon nologin; create role authenticated nologin; create role service_role nologin; create schema auth; create table auth.users (id uuid primary key, email text); create function auth.uid() returns uuid language sql stable as \$\$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', nullif(current_setting('request.jwt.claim.sub', true), ''))::uuid \$\$; grant usage on schema auth to anon, authenticated, service_role; grant execute on function auth.uid() to anon, authenticated, service_role; create schema storage; create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]); create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null, name text not null, owner uuid); alter table storage.objects enable row level security;" >/dev/null
for migration in $(ls "$root"/supabase/migrations/*.sql | sort); do
  psql_ -d farmrx_disposable -f "$migration" >/dev/null || { echo "Migration failed: $(basename "$migration")" >&2; exit 1; }
done
psql_ -d farmrx_disposable -f "$root/scripts/sql/fs-persist-disposable-assertions.sql" | grep -q FS_PERSIST_DISPOSABLE_PASS
echo FS_PERSIST_DISPOSABLE_PASS
# Initiative FD-1 (Today) reads only existing rows; this asserts the row-level rules Today depends on, in the same database.
psql_ -d farmrx_disposable -f "$root/scripts/sql/fd-today-role-assertions.sql" | grep -q FD_TODAY_DISPOSABLE_PASS
echo FD_TODAY_DISPOSABLE_PASS
# Initiative GL-1 (USDA MARS feed): the fan-out, its fences, and the market region, in the same database.
psql_ -d farmrx_disposable -f "$root/scripts/sql/gl1-mars-feed-assertions.sql" | grep -q GL1_MARS_FEED_DISPOSABLE_PASS || { echo "GL-1 MARS feed assertions failed" >&2; exit 1; }
echo GL1_MARS_FEED_DISPOSABLE_PASS
# Initiative GL-2 (alert truth): crop-year eligibility and the feed's one permitted effect.
psql_ -d farmrx_disposable -f "$root/scripts/sql/gl2-alert-eligibility-assertions.sql" | grep -q GL2_ALERT_ELIGIBILITY_DISPOSABLE_PASS || { echo "GL-2 alert eligibility assertions failed" >&2; exit 1; }
echo GL2_ALERT_ELIGIBILITY_DISPOSABLE_PASS
# Initiative GL-3b (contract repair): edit and delete with a reason, and the audit that outlives the row.
psql_ -d farmrx_disposable -f "$root/scripts/sql/gl3-contract-edit-delete-assertions.sql" | grep -q GL3_CONTRACT_EDIT_DELETE_DISPOSABLE_PASS || { echo "GL-3b contract edit/delete assertions failed" >&2; exit 1; }
echo GL3_CONTRACT_EDIT_DELETE_DISPOSABLE_PASS
# Initiative LD-1 (the load record): the ticket, its one write path, and the void that keeps it.
psql_ -d farmrx_disposable -f "$root/scripts/sql/ld1-grain-loads-assertions.sql" | grep -q LD1_GRAIN_LOADS_DISPOSABLE_PASS || { echo "LD-1 grain loads assertions failed" >&2; exit 1; }
echo LD1_GRAIN_LOADS_DISPOSABLE_PASS
# Migration 0040 (farm access-epoch fencing), ported from the PowerShell-only lane so a development
# machine checks it too: the catalog rules every new farm-scoped table must satisfy, and the four
# write paths a stale epoch has to be refused on.
psql_ -d farmrx_disposable -f "$root/scripts/sql/epoch-fencing-assertions.sql" | grep -q EPOCH_FENCING_DISPOSABLE_PASS || { echo "0040 epoch fencing assertions failed" >&2; exit 1; }
echo EPOCH_FENCING_DISPOSABLE_PASS
# Migration 0033 (bin and contract truth), ported from the other PowerShell-only lane: the rules
# that decide whether the bushels Farm Rx shows a farmer are the bushels they actually have.
psql_ -d farmrx_disposable -f "$root/scripts/sql/bin-and-contract-truth-assertions.sql" | grep -q BIN_CONTRACT_TRUTH_DISPOSABLE_PASS || { echo "0033 bin and contract truth assertions failed" >&2; exit 1; }
echo BIN_CONTRACT_TRUTH_DISPOSABLE_PASS
# Initiative LD-2 (load effects): each effect happens only when the farmer confirmed it, the save
# is all-or-nothing, the negative-balance guard now holds at the lot, a void reverses exactly what
# the load created, and a void the bin cannot take changes nothing.
psql_ -d farmrx_disposable -f "$root/scripts/sql/ld2-load-effects-assertions.sql" | grep -q LD2_LOAD_EFFECTS_DISPOSABLE_PASS || { echo "LD-2 load effects assertions failed" >&2; exit 1; }
echo LD2_LOAD_EFFECTS_DISPOSABLE_PASS
# Initiative LD-3 (committed vs free): the database's own answer for the same fixture the browser
# derivation uses, and the proof that a "free" bushel is one the bin will actually let go.
psql_ -d farmrx_disposable -f "$root/scripts/sql/ld3-committed-free-assertions.sql" | grep -q LD3_COMMITTED_FREE_DISPOSABLE_PASS || { echo "LD-3 committed vs free assertions failed" >&2; exit 1; }
echo LD3_COMMITTED_FREE_DISPOSABLE_PASS
