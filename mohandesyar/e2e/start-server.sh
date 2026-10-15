#!/usr/bin/env bash
# Fresh database, migrations, platform admin, trusted signing key and signed test packages, then the real
# clustered API serving the built SPA. Used by Playwright's webServer.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
E2E="$ROOT/.local/e2e"
ADMIN_URL="${TEST_PG_ADMIN_URL:-postgres://postgres@127.0.0.1:54329/postgres}"
rm -rf "$E2E" && mkdir -p "$E2E"
psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS mohandesyar_e2e WITH (FORCE)" >/dev/null
psql "$ADMIN_URL" -q -v owner_pw=ownerpw -v app_pw=apppw -v db_name=mohandesyar_e2e -f "$ROOT/infra/db/init-roles.sql" >/dev/null
redis-cli -p 63799 -n 3 flushdb >/dev/null
PREINSTALL=contracts,projects,crm,meetings,recruitment,hr,kpi node "$ROOT/e2e/prepare-packages.mjs" "$E2E"
cat > "$E2E/env" <<ENV
NODE_ENV=production
PORT=3200
HOST=127.0.0.1
DATABASE_URL=postgres://mohandesyar_app:apppw@127.0.0.1:54329/mohandesyar_e2e
DATABASE_MIGRATOR_URL=postgres://mohandesyar_owner:ownerpw@127.0.0.1:54329/mohandesyar_e2e
REDIS_URL=redis://127.0.0.1:63799/3
S3_ENDPOINT=http://127.0.0.1:39000
S3_ACCESS_KEY=e2e
S3_SECRET_KEY=e2e
S3_BUCKET=mohandesyar-e2e
JWT_SECRET=e2e-secret-e2e-secret-e2e-secret-e2e-secret
APP_ENCRYPTION_KEY=efefefefefefefefefefefefefefefefefefefefefefefefefefefefefefefef
MODULE_STORE_DIR=$E2E/store
MODULE_UPLOAD_DIR=$E2E/uploads
MODULE_BACKUP_DIR=$E2E/backups
MODULE_TRUSTED_KEYS=$E2E/keys/release.pub.pem
PREINSTALLED_MODULES_DIR=$E2E/preinstalled
PUBLIC_ORIGIN=http://127.0.0.1:3200
WEB_DIST_DIR=$ROOT/apps/web/dist
COOKIE_SECURE=false
API_WORKERS=2
LOG_LEVEL=warn
ENV
set -a; . "$E2E/env"; set +a
node "$ROOT/apps/api/dist/main.js" migrate >/dev/null
ADMIN_PASSWORD='Admin-Passw0rd-e2e' node "$ROOT/apps/api/dist/main.js" create-admin --email tech@platform.test --name 'مدیر فنی' >/dev/null
ADMIN_PASSWORD='Ops-Passw0rd-e2e' node "$ROOT/apps/api/dist/main.js" create-admin --email ops@platform.test --name 'مدیر عملیات' >/dev/null
ADMIN_PASSWORD='Sales-Passw0rd-e2e' node "$ROOT/apps/api/dist/main.js" create-admin --email sales@platform.test --name 'مدیر فروش' >/dev/null
ADMIN_PASSWORD='Hr-Passw0rd-e2e' node "$ROOT/apps/api/dist/main.js" create-admin --email hr@platform.test --name 'مدیر فاز ۴' >/dev/null
exec node "$ROOT/apps/api/dist/main.js" serve
