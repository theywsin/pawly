#!/usr/bin/env bash
# Restores a backup made by backup.sh (replaces the current database, files and modules).
#   ./restore.sh backups/<timestamp>
set -euo pipefail
cd "$(dirname "$0")"
src=${1:?مسیر پوشه پشتیبان را بدهید}
[ -f "$src/db.dump" ] || { echo "پشتیبان معتبر نیست: $src"; exit 1; }
cp "$src/.env" .env && cp "$src/s3.json" s3.json && rm -rf keys && cp -r "$src/keys" keys && chmod 755 keys && chmod 644 keys/*.pub.pem
docker compose stop api proxy s3 >/dev/null 2>&1 || true
docker compose up -d postgres redis
for i in $(seq 1 60); do docker compose exec -T postgres pg_isready -U postgres >/dev/null 2>&1 && break; sleep 1; done
set -a; . ./.env; set +a
docker compose run --rm -T db-init >/dev/null
docker compose exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS mohandesyar WITH (FORCE)" -c "CREATE DATABASE mohandesyar OWNER mohandesyar_owner"
docker compose run --rm -T db-init >/dev/null   # schema grants and extensions on the fresh database
docker compose exec -T postgres pg_restore -U postgres -d mohandesyar --clean --if-exists --no-comments < "$src/db.dump" || true
for v in s3data appdata; do
  docker run --rm -v "mohandix_$v:/data" -v "$PWD/$src:/b:ro" --entrypoint sh postgres:16-alpine -c "rm -rf /data/* /data/.[!.]* 2>/dev/null; tar xzf /b/$v.tgz -C /data"
done
docker compose up -d
echo 'بازیابی انجام شد.'
