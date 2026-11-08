import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const key = value => value.normalize('NFKC').trim().toLocaleLowerCase('pt-BR');
const validName = value => typeof value === 'string' && /^[\p{L}\p{N}_ .-]{2,32}$/u.test(value.trim());
const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 128;
const passwordHash = value => argon2.hash(value, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
const publicUser = user => ({ id: user.id, name: user.username, role: user.role, owner: Boolean(user.is_owner) });

export async function installAccounts(app, db, { ownerSetupToken, secureCookies = true, allowedOrigins, onOwnerReady = () => {} }) {
  db.exec(`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL, username_key TEXT NOT NULL UNIQUE,
    password_hash TEXT, role TEXT NOT NULL CHECK(role IN ('admin','member')),
    is_owner INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), csrf TEXT NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS invites (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS owner_setup (id INTEGER PRIMARY KEY CHECK(id=1), token_hash TEXT NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS channels (id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('text','voice')), name TEXT NOT NULL, hint TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(id,kind));
  INSERT OR IGNORE INTO channels VALUES('general','text','geral','O papo continua por aqui',0),('geral','voice','Geral','Conversa e resenha',0),('jogatina','voice','Jogatina','Fecha o squad',1);
  CREATE TABLE IF NOT EXISTS site_settings (id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL, tagline TEXT NOT NULL);
  INSERT OR IGNORE INTO site_settings VALUES(1,'Progresso Gang - Chat','O nosso ponto de encontro');`);
  if (!db.prepare('SELECT id FROM users WHERE is_owner=1').get()) db.prepare('INSERT INTO users VALUES(?,?,?,?,?,1,1,?)').run(randomUUID(),'Vitão',key('Vitão'),null,'admin',Date.now());
  if (ownerSetupToken && !db.prepare('SELECT password_hash FROM users WHERE is_owner=1').get().password_hash) db.prepare('INSERT OR REPLACE INTO owner_setup VALUES(1,?,?)').run(digest(ownerSetupToken),Date.now()+86400000);
  db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  const limited = { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } };
  const session = (reply, user) => {
    const token = secret(), csrf = secret();
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token),user.id,csrf,Date.now()+7*86400000);
    reply.setCookie('pg_session', token, { httpOnly: true, secure: secureCookies, sameSite: 'strict', path: '/', maxAge: 7*86400 });
    return { user: publicUser(user), csrf };
  };
  const fail = (reply, code, error) => reply.code(code).send({ error });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');
    const path = request.url.split('?')[0];
    if (!['GET','HEAD','OPTIONS'].includes(request.method) && !allowedOrigins.includes(request.headers.origin)) return fail(reply,403,'Origem do acesso não autorizada. Atualize a página.');
    const token = request.cookies.pg_session;
    if (token && token.length < 200) {
      const row = db.prepare('SELECT u.*,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1').get(digest(token),Date.now());
      if (row) { request.user = row; request.csrf = row.csrf; }
    }
    const publicPaths = ['/health','/site','/auth/me','/auth/login','/auth/setup','/auth/register'];
    if (publicPaths.includes(path) || request.method === 'OPTIONS') return;
    if (!request.user) return fail(reply,401,'Entre na sua conta para continuar.');
    if (!['GET','HEAD'].includes(request.method) && request.headers['x-csrf-token'] !== request.csrf) return fail(reply,403,'Atualize a página antes de continuar.');
    if (path.startsWith('/admin/') && request.user.role !== 'admin') return fail(reply,403,'Somente administradores podem fazer isso.');
  });
  app.get('/site', async () => db.prepare('SELECT name,tagline FROM site_settings WHERE id=1').get());
  app.get('/auth/me', async request => ({ user: request.user ? publicUser(request.user) : null, csrf: request.csrf ?? null, setupPending: !db.prepare('SELECT password_hash FROM users WHERE is_owner=1').get().password_hash }));
  app.post('/auth/login', limited, async (request,reply) => {
    const { username, password } = request.body ?? {};
    const user = validName(username) ? db.prepare('SELECT * FROM users WHERE username_key=? AND active=1').get(key(username)) : null;
    // Always perform a costly verification, including unknown names.
    const hash = user?.password_hash || dummyHash;
    const okay = validPassword(password) && await argon2.verify(hash,password);
    if (!okay || !user?.password_hash) return fail(reply,401,'Usuário ou senha incorretos.');
    return session(reply,user);
  });
  const dummyHash = await passwordHash(secret());
  app.post('/auth/setup', limited, async (request,reply) => {
    const { token, password } = request.body ?? {};
    const setup = typeof token === 'string' && token.length < 200 && db.prepare('SELECT * FROM owner_setup WHERE token_hash=? AND expires_at>?').get(digest(token),Date.now());
    if (!setup || db.prepare('SELECT password_hash FROM users WHERE is_owner=1').get().password_hash) return fail(reply,403,'Este link de configuração não é válido. Abra o atalho deste PC novamente.');
    if (!validPassword(password)) return fail(reply,400,'Use uma senha de 12 a 128 caracteres.');
    const hash = await passwordHash(password);
    // A concurrent request must not overwrite an already claimed owner account.
    const result = db.prepare('UPDATE users SET password_hash=? WHERE is_owner=1 AND password_hash IS NULL').run(hash);
    if (!result.changes) return fail(reply,409,'A conta já foi configurada. Entre com sua senha.');
    db.exec('DELETE FROM owner_setup'); onOwnerReady();
    return session(reply,db.prepare('SELECT * FROM users WHERE is_owner=1').get());
  });
  app.post('/auth/register', limited, async (request,reply) => {
    const { token, username, password } = request.body ?? {};
    if (!validName(username) || !validPassword(password)) return fail(reply,400,'Use um nome de 2 a 32 caracteres e senha de 12 a 128 caracteres.');
    const tokenHash = typeof token === 'string' && token.length < 200 ? digest(token) : '';
    const invite = db.prepare('SELECT * FROM invites WHERE token_hash=? AND used=0 AND expires_at>?').get(tokenHash,Date.now());
    if (!invite) return fail(reply,403,'Convite inválido ou expirado. Peça um novo ao administrador.');
    if (db.prepare('SELECT id FROM users WHERE username_key=?').get(key(username))) return fail(reply,409,'Este nome já está em uso.');
    const hash = await passwordHash(password), id = randomUUID();
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!db.prepare('UPDATE invites SET used=1 WHERE token_hash=? AND used=0 AND expires_at>?').run(tokenHash,Date.now()).changes) { db.exec('ROLLBACK'); return fail(reply,409,'Este convite já foi usado.'); }
      db.prepare('INSERT INTO users VALUES(?,?,?,?,?,0,1,?)').run(id,username.trim(),key(username),hash,'member',Date.now()); db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); if (error.code?.includes('CONSTRAINT')) return fail(reply,409,'Este nome já está em uso.'); throw error; }
    return reply.code(201).send(session(reply,db.prepare('SELECT * FROM users WHERE id=?').get(id)));
  });
  app.post('/auth/logout', async (request,reply) => { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(request.cookies.pg_session)); reply.clearCookie('pg_session',{path:'/',secure:secureCookies,sameSite:'strict'}); return {ok:true}; });
  app.post('/auth/password', limited, async (request,reply) => {
    const { currentPassword, password } = request.body ?? {};
    if (!validPassword(currentPassword) || !await argon2.verify(request.user.password_hash,currentPassword)) return fail(reply,403,'A senha atual não confere.');
    if (!validPassword(password)) return fail(reply,400,'Use uma senha de 12 a 128 caracteres.');
    const hash = await passwordHash(password);
    db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,request.user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(request.user.id);
    return session(reply,request.user);
  });
  app.post('/admin/invites', async () => { const token=secret(); db.prepare('INSERT INTO invites VALUES(?,?,0)').run(digest(token),Date.now()+86400000); return {token,expiresInHours:24}; });
  app.get('/admin/users', async () => ({users:db.prepare('SELECT * FROM users ORDER BY created_at').all().map(user=>({...publicUser(user),active:Boolean(user.active)}))}));
  app.patch('/admin/users/:id', async (request,reply) => {
    const user=db.prepare('SELECT * FROM users WHERE id=?').get(request.params.id), {role,active}=request.body??{};
    if (!user) return fail(reply,404,'Conta não encontrada.');
    if (user.is_owner || user.id===request.user.id) return fail(reply,403,'A conta proprietária e sua própria conta estão protegidas.');
    if (!['admin','member'].includes(role) || typeof active!=='boolean') return fail(reply,400,'Permissões inválidas.');
    db.prepare('UPDATE users SET role=?,active=? WHERE id=?').run(role,Number(active),user.id);
    db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id); return {ok:true};
  });
  app.get('/channels', async () => ({ text:db.prepare("SELECT * FROM channels WHERE kind='text' ORDER BY position,rowid").all(),voice:db.prepare("SELECT * FROM channels WHERE kind='voice' ORDER BY position,rowid").all() }));
  app.post('/admin/channels', async (request,reply) => {
    const {name,kind,hint=''}=request.body??{};
    if (!validName(name) || !['text','voice'].includes(kind) || typeof hint!=='string' || hint.length>120) return fail(reply,400,'Confira nome, tipo e descrição do canal.');
    const id=randomUUID(); db.prepare('INSERT INTO channels(id,kind,name,hint,position) VALUES(?,?,?,?,?)').run(id,kind,name.trim(),hint.trim(),Date.now()); return reply.code(201).send({id});
  });
  app.patch('/admin/channels/:kind/:id', async (request,reply) => {
    const {name,hint=''}=request.body??{};
    if (!validName(name) || typeof hint!=='string' || hint.length>120) return fail(reply,400,'Nome ou descrição inválidos.');
    const result=db.prepare('UPDATE channels SET name=?,hint=? WHERE id=? AND kind=?').run(name.trim(),hint.trim(),request.params.id,request.params.kind);
    return result.changes?{ok:true}:fail(reply,404,'Canal não encontrado.');
  });
  app.patch('/admin/site', async (request,reply) => {
    const {name,tagline}=request.body??{};
    if (typeof name!=='string'||name.trim().length<2||name.length>60||typeof tagline!=='string'||tagline.length>120) return fail(reply,400,'Nome: 2 a 60 caracteres. Descrição: até 120.');
    db.prepare('UPDATE site_settings SET name=?,tagline=? WHERE id=1').run(name.trim(),tagline.trim()); return {ok:true};
  });
  return {
    voiceExists: id => Boolean(db.prepare("SELECT 1 FROM channels WHERE id=? AND kind='voice'").get(id)),
    conversationExists: id => typeof id==='string' && (id.startsWith('voice:') ? Boolean(db.prepare("SELECT 1 FROM channels WHERE id=? AND kind='voice'").get(id.slice(6))) : Boolean(db.prepare("SELECT 1 FROM channels WHERE id=? AND kind='text'").get(id))),
  };
}
