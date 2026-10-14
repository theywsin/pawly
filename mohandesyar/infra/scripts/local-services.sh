#!/usr/bin/env bash
# Starts PostgreSQL, Redis and an S3-compatible store (Garage) for local development and integration tests.
# PostgreSQL/Redis use native binaries when available (fast), otherwise Docker.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
LOCAL="${MY_LOCAL_DIR:-$ROOT/.local}"
PG_PORT="${PG_PORT:-54329}"
REDIS_PORT="${REDIS_PORT:-63799}"
S3_PORT="${S3_PORT:-39000}"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
mkdir -p "$LOCAL"

as_pg() { if [ "$(id -u)" = 0 ]; then runuser -u postgres -- "$@"; else "$@"; fi; }

start_pg() {
  if [ -x "$PG_BIN/pg_ctl" ]; then
    local d="$LOCAL/pg"
    if [ ! -d "$d" ]; then
      mkdir -p "$d"; [ "$(id -u)" = 0 ] && chown postgres "$d"
      as_pg "$PG_BIN/initdb" -D "$d" -U postgres --auth=trust -E UTF8 --locale=C.UTF-8 >/dev/null
    fi
    as_pg "$PG_BIN/pg_ctl" -D "$d" -o "-p $PG_PORT -k /tmp -c listen_addresses=127.0.0.1" -l "$d/log" status >/dev/null 2>&1 \
      || as_pg "$PG_BIN/pg_ctl" -D "$d" -o "-p $PG_PORT -k /tmp -c listen_addresses=127.0.0.1" -l "$d/log" -w start >/dev/null
  else
    docker run -d --name my-pg -p 127.0.0.1:$PG_PORT:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:16-alpine >/dev/null 2>&1 || docker start my-pg >/dev/null
    for _ in $(seq 30); do pg_isready -h 127.0.0.1 -p "$PG_PORT" >/dev/null 2>&1 && break; sleep 1; done
  fi
  echo "postgres  postgres://postgres@127.0.0.1:$PG_PORT/postgres"
}

start_redis() {
  if command -v redis-server >/dev/null; then
    redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1 || redis-server --port "$REDIS_PORT" --bind 127.0.0.1 --save '' --daemonize yes >/dev/null
  else
    docker run -d --name my-redis -p 127.0.0.1:$REDIS_PORT:6379 redis:7-alpine >/dev/null 2>&1 || docker start my-redis >/dev/null
  fi
  echo "redis     redis://127.0.0.1:$REDIS_PORT"
}

start_s3() {
  # Local/test S3: moto server (S3-compatible, Apache-2.0) in a venv. Production uses any S3-compatible store
  # (MinIO, Garage, SeaweedFS, Ceph RGW) configured via S3_* variables.
  local venv="$LOCAL/venv"
  [ -x "$venv/bin/moto_server" ] || { python3 -m venv "$venv" && "$venv/bin/pip" install -q 'moto[server]==5.2.4'; }
  if ! curl -s -o /dev/null "http://127.0.0.1:$S3_PORT/"; then
    nohup "$venv/bin/moto_server" -H 127.0.0.1 -p "$S3_PORT" >"$LOCAL/s3.log" 2>&1 &
    echo $! > "$LOCAL/s3.pid"
    for _ in $(seq 30); do curl -s -o /dev/null "http://127.0.0.1:$S3_PORT/" && break; sleep 0.5; done
  fi
  echo "s3        http://127.0.0.1:$S3_PORT"
}

stop_all() {
  [ -x "$PG_BIN/pg_ctl" ] && [ -d "$LOCAL/pg" ] && as_pg "$PG_BIN/pg_ctl" -D "$LOCAL/pg" stop -m fast >/dev/null 2>&1 || true
  redis-cli -p "$REDIS_PORT" shutdown nosave >/dev/null 2>&1 || true
  [ -f "$LOCAL/s3.pid" ] && kill "$(cat "$LOCAL/s3.pid")" 2>/dev/null; rm -f "$LOCAL/s3.pid"
  docker rm -f my-pg my-redis >/dev/null 2>&1 || true
}

case "${1:-start}" in
  start) start_pg; start_redis; start_s3 ;;
  stop) stop_all ;;
  *) echo "usage: $0 start|stop"; exit 1 ;;
esac
