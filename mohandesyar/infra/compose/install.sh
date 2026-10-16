#!/usr/bin/env bash
# First installation (or upgrade with a newer bundle) of Mohandix on a server with Docker Engine and the
# compose plugin. Interactive by default; for automation set SITE_ADDRESS, PUBLIC_ORIGIN, ADMIN_EMAIL,
# ADMIN_NAME and ADMIN_PASSWORD in the environment.
set -euo pipefail
cd "$(dirname "$0")"
command -v docker >/dev/null || { echo 'Docker نصب نیست.'; exit 1; }
docker compose version >/dev/null || { echo 'افزونه docker compose نصب نیست.'; exit 1; }

if [ -f images/mohandix-images.tar.gz ]; then
  echo '» بارگذاری ایمیج‌ها…'
  docker load -i images/mohandix-images.tar.gz
fi

rand() { openssl rand -hex "${1:-32}"; }
fresh=0
if [ ! -f .env ]; then
  fresh=1
  SITE_ADDRESS=${SITE_ADDRESS:-$(read -rp 'دامنه (مثلاً example.ir) یا :80 برای HTTP: ' x && echo "$x")}
  if [ -z "${PUBLIC_ORIGIN:-}" ]; then
    case "$SITE_ADDRESS" in :*) PUBLIC_ORIGIN="http://$(hostname -I | awk '{print $1}')${SITE_ADDRESS#:80}";; *) PUBLIC_ORIGIN="https://$SITE_ADDRESS";; esac
  fi
  case "$PUBLIC_ORIGIN" in https://*) SECURE=true;; *) SECURE=false;; esac
  sed -e "s#^HTTP_PORT=.*#HTTP_PORT=${HTTP_PORT:-80}#" -e "s#^HTTPS_PORT=.*#HTTPS_PORT=${HTTPS_PORT:-443}#" -e "s#^SITE_ADDRESS=.*#SITE_ADDRESS=$SITE_ADDRESS#" -e "s#^PUBLIC_ORIGIN=.*#PUBLIC_ORIGIN=$PUBLIC_ORIGIN#" -e "s#^COOKIE_SECURE=.*#COOKIE_SECURE=$SECURE#" \
      -e "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=$(rand)#" -e "s#^OWNER_DB_PASSWORD=.*#OWNER_DB_PASSWORD=$(rand)#" -e "s#^APP_DB_PASSWORD=.*#APP_DB_PASSWORD=$(rand)#" \
      -e "s#^JWT_SECRET=.*#JWT_SECRET=$(rand)#" -e "s#^APP_ENCRYPTION_KEY=.*#APP_ENCRYPTION_KEY=$(rand)#" \
      -e "s#^S3_ACCESS_KEY=.*#S3_ACCESS_KEY=$(rand 12)#" -e "s#^S3_SECRET_KEY=.*#S3_SECRET_KEY=$(rand)#" .env.example > .env
  chmod 600 .env
  echo '» فایل .env با رمزهای تازه ساخته شد (از آن و از پشتیبان‌ها نگه‌داری کنید).'
fi
set -a; . ./.env; set +a
cat > s3.json <<JSON
{"identities":[{"name":"mohandix","credentials":[{"accessKey":"$S3_ACCESS_KEY","secretKey":"$S3_SECRET_KEY"}],"actions":["Admin","Read","Write","List","Tagging"]}]}
JSON
chmod 600 s3.json

echo '» راه‌اندازی سرویس‌ها و مهاجرت پایگاه داده…'
docker compose up -d
for i in $(seq 1 90); do
  [ "$(docker compose ps -a --format '{{.Service}} {{.State}}' | awk '$1=="api"{print $2}')" = running ] && \
    docker compose exec -T api node -e "fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null && break
  if docker compose ps -a --format '{{.Service}} {{.State}} {{.ExitCode}}' | awk '$1=="migrate" && $2=="exited" && $3!="0"{f=1} END{exit !f}'; then
    echo 'مهاجرت ناموفق بود:'; docker compose logs migrate | tail -40; exit 1
  fi
  sleep 2
done

if [ -n "${ADMIN_EMAIL:-}" ] || { [ "$fresh" = 1 ] && [ -t 0 ]; }; then
  ADMIN_EMAIL=${ADMIN_EMAIL:-$(read -rp 'ایمیل مدیر سامانه (پنل /console): ' x && echo "$x")}
  ADMIN_NAME=${ADMIN_NAME:-مدیر سامانه}
  if [ -z "${ADMIN_PASSWORD:-}" ]; then read -rsp 'رمز مدیر (حداقل ۱۲ نویسه): ' ADMIN_PASSWORD; echo; fi
  docker compose run --rm -T -e ADMIN_PASSWORD="$ADMIN_PASSWORD" migrate create-admin --email "$ADMIN_EMAIL" --name "$ADMIN_NAME" || true
fi
echo "» آماده است: $PUBLIC_ORIGIN  (پنل مدیریت: $PUBLIC_ORIGIN/console)"
