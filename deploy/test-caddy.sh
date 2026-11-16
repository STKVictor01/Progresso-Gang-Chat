#!/bin/sh
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
QA_DIR=$(mktemp -d /tmp/pg-caddy-qa.XXXXXXXX)
trap 'rm -rf -- "$QA_DIR"' EXIT HUP INT TERM
VERSION=2.11.9
FILE="caddy_${VERSION}_linux_amd64.tar.gz"
BASE="https://github.com/caddyserver/caddy/releases/download/v${VERSION}"
curl -fsSLo "$QA_DIR/$FILE" "$BASE/$FILE"
curl -fsSLo "$QA_DIR/checksums.txt" "$BASE/caddy_${VERSION}_checksums.txt"
(cd "$QA_DIR" && grep "  $FILE\$" checksums.txt | sha512sum -c -)
tar -xzf "$QA_DIR/$FILE" -C "$QA_DIR" caddy
SITE_DOMAIN=gang.exemplo.com.br LIVEKIT_DOMAIN=live.gang.exemplo.com.br "$QA_DIR/caddy" validate --config "$ROOT/Caddyfile" --adapter caddyfile
