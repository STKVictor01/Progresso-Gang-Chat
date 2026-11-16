#!/bin/sh
# Testa uma cópia temporária, sem copiar segredos nem usar o banco da comunidade.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
QA_DIR=$(mktemp -d /tmp/pg-gang-qa.XXXXXXXX)
trap 'rm -rf -- "$QA_DIR"' EXIT HUP INT TERM
VERSION=24.22.3
ARCHIVE="node-v$VERSION-linux-x64.tar.xz"
curl -fsSLo "$QA_DIR/$ARCHIVE" "https://nodejs.org/dist/v$VERSION/$ARCHIVE"
curl -fsSLo "$QA_DIR/SHASUMS256.txt" "https://nodejs.org/dist/v$VERSION/SHASUMS256.txt"
(cd "$QA_DIR" && grep "  $ARCHIVE\$" SHASUMS256.txt | sha256sum -c -)
tar -xJf "$QA_DIR/$ARCHIVE" -C "$QA_DIR"
PATH="$QA_DIR/node-v$VERSION-linux-x64/bin:$PATH"; export PATH
mkdir "$QA_DIR/project"
tar -C "$ROOT" --exclude='*/node_modules' --exclude='*/dist' --exclude='*/.env*' --exclude='server/data' --exclude='server/logs' --exclude='client/client' -cf - client server | tar -C "$QA_DIR/project" -xf -
(cd "$QA_DIR/project/client" && npm ci && npm run build && npm run lint && npm test)
(cd "$QA_DIR/project/server" && npm ci && npm test)
python3 -m venv --without-pip "$QA_DIR/music"
curl -fsSLo "$QA_DIR/get-pip.py" https://bootstrap.pypa.io/get-pip.py
echo '356e0d0de21cdc348c3394084d90939b85e4246c4d14c76aee6ca4f46646ea98  '"$QA_DIR/get-pip.py" | sha256sum -c -
"$QA_DIR/music/bin/python" "$QA_DIR/get-pip.py"
"$QA_DIR/music/bin/pip" install -r "$QA_DIR/project/server/music-requirements.txt" -c "$ROOT/deploy/music-constraints.txt"
"$QA_DIR/music/bin/python" -c 'import imageio_ffmpeg, yt_dlp; from livekit import rtc; print("Python e dependências de música disponíveis")'
