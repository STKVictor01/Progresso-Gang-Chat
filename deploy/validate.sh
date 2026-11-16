#!/bin/sh
set -eu
cd "$(dirname "$0")"
# Evita imprimir variáveis e credenciais carregadas pelo Compose.
docker compose --env-file /etc/progresso-gang/compose.env -f compose.yaml config --quiet
echo 'Configuração Compose válida.'
