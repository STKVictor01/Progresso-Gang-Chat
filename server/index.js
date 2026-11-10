import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';

const setupFile = fileURLToPath(new URL('./data/owner-setup.json',import.meta.url));
mkdirSync(fileURLToPath(new URL('./data',import.meta.url)),{recursive:true});
let setup;
try { setup=JSON.parse(readFileSync(setupFile,'utf8')); } catch {}
if (!setup || typeof setup.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(setup.token) || !(setup.expiresAt > Date.now())) {
  setup={token:randomBytes(32).toString('base64url'),expiresAt:Date.now()+86400000};
  writeFileSync(setupFile,JSON.stringify(setup),{mode:0o600});
}

if (process.env.PG_CHAT_DATABASE === 'postgres' && !process.env.DATABASE_URL) throw Error('A conexão com o banco não está configurada.');
const app = await createApp({
  dbPath: fileURLToPath(new URL('./data/chat.sqlite', import.meta.url)),
  databaseUrl: process.env.PG_CHAT_DATABASE === 'postgres' ? process.env.DATABASE_URL : undefined,
  certificatePath: fileURLToPath(new URL('./data/supabase-ca.crt', import.meta.url)),
  activityLogPath: fileURLToPath(new URL('./logs/activity.jsonl', import.meta.url)),
  apiKey: process.env.LIVEKIT_API_KEY,
  apiSecret: process.env.LIVEKIT_API_SECRET,
  serverUrl: process.env.LIVEKIT_URL,
  ownerSetupToken: setup.token,
  ownerSetupExpiresAt: setup.expiresAt,
  onOwnerReady: () => { try { unlinkSync(setupFile); } catch {} },
});
// Never leave a setup link behind once the owner has set a password.
const ownerStatus=await app.inject({url:'/auth/me'});
if(!ownerStatus.json().setupPending){try{unlinkSync(setupFile);}catch{}}
await app.listen({ host: '127.0.0.1', port: 3001 });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => app.close().then(() => process.exit(0)));
