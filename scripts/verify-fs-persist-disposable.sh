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
