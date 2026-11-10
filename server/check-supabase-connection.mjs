import 'dotenv/config';
import pg from 'pg';
import { readFileSync } from 'node:fs';

const certificatePath = process.argv[2];
if (!process.env.DATABASE_URL || !certificatePath) {
  console.error('Configure DATABASE_URL no .env e informe o caminho do certificado da Supabase.');
  process.exit(1);
}
let ca;
try { ca = readFileSync(certificatePath, 'utf8'); }
catch { console.error('Não foi possível ler o certificado informado.'); process.exit(1); }
let url;
try { url = new URL(process.env.DATABASE_URL); }
catch { console.error('DATABASE_URL está em um formato inválido.'); process.exit(1); }
if (!['postgres:', 'postgresql:'].includes(url.protocol)) {
  console.error('DATABASE_URL precisa ser uma conexão PostgreSQL.');
  process.exit(1);
}
if ([...url.searchParams.keys()].some(key => key.toLowerCase().startsWith('ssl'))) {
  console.error('Remova as opções SSL da DATABASE_URL; a verificação usa o certificado informado.');
  process.exit(1);
}
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { ca, rejectUnauthorized: true }, connectionTimeoutMillis: 8000 });
try {
  await client.connect();
  const result = await client.query("SELECT count(*)::int AS count FROM pg_catalog.pg_tables WHERE schemaname='public'");
  console.log('Conexão segura estabelecida. Tabelas existentes no esquema público:', result.rows[0].count);
  const check = await client.query("SELECT has_schema_privilege('anon', 'progresso_gang', 'USAGE') AS anon, has_schema_privilege('authenticated', 'progresso_gang', 'USAGE') AS authenticated, (SELECT bool_and(c.relrowsecurity) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='progresso_gang' AND c.relkind='r') AS rls");
  if (check.rows[0].anon || check.rows[0].authenticated || !check.rows[0].rls) throw Error('Verificação de acesso falhou.');
  console.log('Esquema privado e proteção das tabelas verificados.');
} catch (error) {
  console.error('Não foi possível conectar. Código:', error.code || error.name);
  process.exitCode = 1;
} finally {
  await client.end();
}
