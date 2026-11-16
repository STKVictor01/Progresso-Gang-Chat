#!/bin/sh
# Banco efêmero somente em 127.0.0.1, sem usar arquivos, credenciais ou dados reais.
set -eu
ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
QA_DIR=$(mktemp -d /tmp/pg-gang-postgres-qa.XXXXXXXX)
PG_CTL=''
cleanup() {
  if [ -n "$PG_CTL" ] && [ -f "$QA_DIR/data/postmaster.pid" ]; then
    "$PG_CTL" -D "$QA_DIR/data" -m fast -w stop >/dev/null 2>&1 || true
  fi
  case "$QA_DIR" in /tmp/pg-gang-postgres-qa.*) rm -rf -- "$QA_DIR";; esac
}
trap cleanup EXIT HUP INT TERM
cd "$QA_DIR"
apt-get download postgresql-18 postgresql-client-18 libnuma1 libicu78 liburing2 libpq5
for package in ./*.deb; do dpkg-deb -x "$package" "$QA_DIR/pg"; done
LD_LIBRARY_PATH="$QA_DIR/pg/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"; export LD_LIBRARY_PATH
PG_BIN="$QA_DIR/pg/usr/lib/postgresql/18/bin"
PG_CTL="$PG_BIN/pg_ctl"
if ldd "$PG_BIN/postgres" | grep 'not found'; then echo 'Bibliotecas PostgreSQL ausentes neste Linux.' >&2; exit 1; fi
VERSION=24.22.3
ARCHIVE="node-v$VERSION-linux-x64.tar.xz"
curl -fsSLo "$ARCHIVE" "https://nodejs.org/dist/v$VERSION/$ARCHIVE"
curl -fsSLo SHASUMS256.txt "https://nodejs.org/dist/v$VERSION/SHASUMS256.txt"
grep "  $ARCHIVE\$" SHASUMS256.txt | sha256sum -c -
tar -xJf "$ARCHIVE"
PATH="$QA_DIR/node-v$VERSION-linux-x64/bin:$PG_BIN:$PATH"; export PATH
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 1 -subj '/CN=QA CA' >/dev/null 2>&1
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj '/CN=localhost' >/dev/null 2>&1
printf 'subjectAltName=DNS:localhost,IP:127.0.0.1\n' > extensions.cnf
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 1 -extfile extensions.cnf >/dev/null 2>&1
chmod 600 server.key
PORT=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
initdb -D "$QA_DIR/data" --auth=trust --no-instructions >/dev/null
pg_ctl -D "$QA_DIR/data" -l "$QA_DIR/postgres.log" -o "-h 127.0.0.1 -p $PORT -k $QA_DIR -c ssl=on -c ssl_cert_file=$QA_DIR/server.crt -c ssl_key_file=$QA_DIR/server.key" -w start >/dev/null
PGHOST=localhost PGPORT="$PORT" PGUSER=$(id -un) PGDATABASE=postgres PGSSLMODE=verify-full PGSSLROOTCERT="$QA_DIR/ca.crt"; export PGHOST PGPORT PGUSER PGDATABASE PGSSLMODE PGSSLROOTCERT
psql -X -v ON_ERROR_STOP=1 -c 'CREATE ROLE anon; CREATE ROLE authenticated;' >/dev/null
mkdir project
tar -C "$ROOT" --exclude='*/node_modules' --exclude='*/.env*' --exclude='server/data' --exclude='server/logs' -cf - server supabase/migrations | tar -C "$QA_DIR/project" -xf -
(cd project/server && npm ci --silent)
for kind in application migration; do
  schema="progresso_gang_qa_$(openssl rand -hex 8)"
  for file in "$QA_DIR"/project/supabase/migrations/*.sql; do
    sed "s/progresso_gang/$schema/g" "$file" | psql -X -v ON_ERROR_STOP=1 -q >/dev/null
  done
  if [ "$kind" = application ]; then
    psql -X -v ON_ERROR_STOP=1 -q -c "INSERT INTO $schema.channels VALUES ('general','text','geral','',0),('geral','voice','Geral','',0),('jogatina','voice','Jogatina','',1); INSERT INTO $schema.site_settings VALUES (1,'Teste','Teste');" >/dev/null
  fi
  PG_TEST_SCHEMA="$schema" PG_TEST_DATABASE_URL="postgresql://$PGUSER@localhost:$PORT/postgres" PG_TEST_CA_CERT="$QA_DIR/ca.crt" PG_TEST_LARGE_UPLOAD=1; export PG_TEST_SCHEMA PG_TEST_DATABASE_URL PG_TEST_CA_CERT PG_TEST_LARGE_UPLOAD
  if [ "$kind" = application ]; then (cd project/server && npm run test:postgres); else (cd project/server && npm run test:migration); fi
done
echo 'Testes PostgreSQL isolados concluídos.'
