#!/bin/sh
set -eu

if [ ! -s "${PGDATA:?PGDATA is required}/PG_VERSION" ]; then
  echo 'MAPLE_CLOCK_IMAGE_REFUSED: an initialized disposable PostgreSQL data directory is required.' >&2
  exit 64
fi
if [ "${1:-}" != 'postgres' ]; then
  echo 'MAPLE_CLOCK_IMAGE_REFUSED: only the inherited PostgreSQL server command is allowed.' >&2
  exit 64
fi
if [ "$(id -u)" = '0' ]; then
  exec gosu postgres "$0" "$@"
fi

exec env \
  LD_PRELOAD=/usr/local/lib/faketime/libfaketime.so.1:/usr/local/lib/faketime/libclear-ld-preload.so \
  FAKETIME="${FROZEN_INSTANT:?FROZEN_INSTANT is required}" \
  FAKETIME_DONT_FAKE_MONOTONIC=1 \
  FAKETIME_NO_CACHE=1 \
  "$@"
