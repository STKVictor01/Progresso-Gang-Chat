#!/bin/sh
set -eu
cd "$(dirname "$0")"
sh ./validate.sh
docker compose --env-file /etc/progresso-gang/compose.env -f compose.yaml build
docker compose --env-file /etc/progresso-gang/compose.env -f compose.yaml up -d --no-build
docker compose --env-file /etc/progresso-gang/compose.env -f compose.yaml ps
