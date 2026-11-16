#!/bin/sh
set -eu
cd "$(dirname "$0")"
[ "$#" -eq 1 ] || { echo 'Uso: ./rollback.sh RELEASE_ANTERIOR' >&2; exit 1; }
case "$1" in *[!a-zA-Z0-9_.-]*|'') echo 'Versão inválida.' >&2; exit 1;; esac
docker image inspect "progresso-gang-api:$1" "progresso-gang-web:$1" >/dev/null
PG_RELEASE="$1" docker compose --env-file /etc/progresso-gang/compose.env -f compose.yaml up -d --no-build
echo 'Rollback aplicado. Ajuste PG_RELEASE em compose.env para mantê-lo após reinicializações.'
