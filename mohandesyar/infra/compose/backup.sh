#!/usr/bin/env bash
# Full backup into backups/<timestamp>/: database (pg_dump), stored files (S3 volume), installed module
# packages, and the configuration (.env, s3.json, keys) needed to restore it. Database first, then files:
# a file uploaded meanwhile is at worst an unreferenced extra, never a missing one.
set -euo pipefail
cd "$(dirname "$0")"
dir="backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$dir"
docker compose exec -T postgres pg_dump -U postgres -Fc mohandesyar > "$dir/db.dump"
for v in s3data appdata; do
  docker run --rm -v "mohandix_$v:/data:ro" -v "$PWD/$dir:/b" --entrypoint sh postgres:16-alpine -c "tar czf /b/$v.tgz -C /data ."
done
cp .env s3.json "$dir/" && cp -r keys "$dir/keys"
chmod -R go-rwx "$dir"
echo "$dir"
