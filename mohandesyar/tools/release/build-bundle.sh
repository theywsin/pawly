#!/usr/bin/env bash
# Assembles the server delivery bundle (docs/10 §4):
#   tools/release/build-bundle.sh <outDir> [--key <private.pem>] [--no-images]
# Output: <outDir>/mohandix/ (compose files, signed modules, public key, optional image archive, Persian guide)
# and <outDir>/mohandix.tar.gz. A new signing key is generated unless --key is given; the private key
# is written to <outDir>/signing-key/ and is NEVER placed inside the bundle.
# Expects the image mohandix:latest to be built already (infra/docker/Dockerfile).
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
out=${1:?usage: build-bundle.sh <outDir> [--key <private.pem>] [--no-images]}; shift
key=""; images=1
while [ $# -gt 0 ]; do
  case "$1" in --key) key=$2; shift 2;; --no-images) images=0; shift;; *) echo "unknown option $1"; exit 1;; esac
done
IMAGES="mohandix:latest postgres:16-alpine redis:7-alpine chrislusf/seaweedfs:3.97 caddy:2.10-alpine"

mkdir -p "$out"; out=$(cd "$out" && pwd)
b="$out/mohandix"; rm -rf "$b" "$out/pack"; mkdir -p "$b/keys" "$b/images"
c="$root/infra/compose"
cp -L "$c/docker-compose.yml" "$c/Caddyfile" "$c/.env.example" "$c/init-roles.sql" "$c/install.sh" "$c/backup.sh" "$c/restore.sh" "$b/"
chmod +x "$b"/*.sh
cp "$root/tools/release/راهنمای-نصب.md" "$b/"

node "$root/tools/release/pack-modules.mjs" "$out/pack" ${key:+--key "$key"}
mv "$out/pack/modules" "$b/modules"
cp "$out/pack/keys/release.pub.pem" "$b/keys/"
if [ -f "$out/pack/keys/release.key.pem" ]; then
  mkdir -p "$out/signing-key"; mv "$out/pack/keys/release.key.pem" "$out/signing-key/"
  cp "$out/pack/keys/release.pub.pem" "$out/signing-key/"; chmod 600 "$out/signing-key/release.key.pem"
fi
rm -rf "$out/pack"

if [ "$images" = 1 ]; then
  echo "» saving images: $IMAGES"
  docker save $IMAGES | gzip -1 > "$b/images/mohandix-images.tar.gz"
fi
(cd "$out" && tar czf mohandix.tar.gz mohandix)
echo "» bundle: $out/mohandix.tar.gz"
[ -d "$out/signing-key" ] && echo "» private signing key (keep offline, not on the server): $out/signing-key/"
