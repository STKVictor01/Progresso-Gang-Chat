import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

const digest = value => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const key = value => value.normalize('NFKC').trim().toLocaleLowerCase('pt-BR');
const validName = value => typeof value === 'string' && /^[\p{L}\p{N}_ .-]{2,32}$/u.test(value.trim());
const validPassword = value => typeof value === 'string' && value.length >= 12 && value.length <= 128;
const validExistingPassword = value => typeof value === 'string' && value.length > 0 && value.length <= 128;
const validEmail = value => typeof value==='string' && value.length<=254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validNewPassword = value => validPassword(value) && Buffer.byteLength(value,'utf8')<=72;
const passwordHash = value => argon2.hash(value, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });
const publicUser = user => ({ id: user.id, name: user.username, role: user.role, owner: Boolean(user.is_owner) });
// Fixo no commit que introduziu os perfis, para não incluir contas futuras.
export const FOUNDER_CUTOFF = Date.parse('2026-11-17T04:01:55Z');

export async function installAccounts(app, db, { ownerSetupToken, ownerSetupExpiresAt = Date.now()+86400000, secureCookies = true, allowedOrigins, onOwnerReady = () => {}, recordEvent = () => {}, authProvider, startupCleanup = true }) {
  if (db.kind==='sqlite') (await db.exec(`CREATE TABLE IF NOT EXISTS users (
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
  INSERT OR IGNORE INTO site_settings VALUES(1,'Progresso Gang - Chat','O nosso ponto de encontro');`));
  if (db.kind==='sqlite') await db.exec(`CREATE TABLE IF NOT EXISTS invite_requests (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS invite_requests_created_idx ON invite_requests(created_at DESC,id);
    CREATE TABLE IF NOT EXISTS invite_request_reads (request_id TEXT NOT NULL REFERENCES invite_requests(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, read_at INTEGER NOT NULL, PRIMARY KEY(request_id,user_id));
    CREATE INDEX IF NOT EXISTS invite_request_reads_user_idx ON invite_request_reads(user_id,request_id);`);
  const requestsReady=db.kind==='sqlite' || (await Promise.all(['invite_requests','invite_request_reads'].map(name=>db.prepare("SELECT 1 AS ok FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=?").get(name)))).every(Boolean);
  if (!(await db.prepare('SELECT id FROM users WHERE is_owner=1').get())) (await db.prepare('INSERT INTO users VALUES(?,?,?,?,?,1,1,?)').run(randomUUID(),'Vitão',key('Vitão'),null,'admin',Date.now()));
  if(authProvider){
    if(db.kind==='sqlite'){
      await db.exec('CREATE TABLE IF NOT EXISTS auth_links (user_id TEXT PRIMARY KEY REFERENCES users(id), auth_user_id TEXT NOT NULL UNIQUE, email TEXT NOT NULL, activated_at INTEGER)');
      const columns=await db.prepare('PRAGMA table_info(auth_links)').all();
      if(!columns.some(column=>column.name==='auth_user_id'))await db.exec('BEGIN; ALTER TABLE auth_links ADD COLUMN auth_user_id TEXT; UPDATE auth_links SET auth_user_id=user_id; CREATE UNIQUE INDEX auth_links_remote_id ON auth_links(auth_user_id); COMMIT');
      if(!columns.some(column=>column.name==='auth_created_at'))await db.exec('ALTER TABLE auth_links ADD COLUMN auth_created_at INTEGER');
      if(!columns.some(column=>column.name==='founder_checked'))await db.exec('ALTER TABLE auth_links ADD COLUMN founder_checked INTEGER NOT NULL DEFAULT 0 CHECK(founder_checked IN (0,1))');
    } else await db.prepare('SELECT user_id,auth_user_id FROM auth_links LIMIT 1').all();
  }
  // Data de criação da conta no Supabase Auth, para mostrar "Membro desde". No PostgreSQL vem da migração.
  const authCreatedAt=Boolean(authProvider) && (db.kind==='sqlite' || Boolean(await db.prepare("SELECT 1 AS ok FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='auth_links' AND column_name='auth_created_at'").get()));
  const founderChecked=authCreatedAt && (db.kind==='sqlite' || Boolean(await db.prepare("SELECT 1 AS ok FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='auth_links' AND column_name='founder_checked'").get()) && Boolean(await db.prepare("SELECT 1 AS ok FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='user_badges'").get()));
  const rememberCreatedAt=async(userId,remote)=>{
    const created=Date.parse(remote?.created_at);
    if(!authCreatedAt || !Number.isSafeInteger(created) || created<=0)return;
    if(!founderChecked){await db.prepare('UPDATE auth_links SET auth_created_at=? WHERE user_id=? AND (auth_created_at IS NULL OR auth_created_at<>?)').run(created,userId,created);return;}
    await db.transaction(async()=>{
      await db.lock('founder:'+userId);
      const first=await db.prepare('UPDATE auth_links SET auth_created_at=?,founder_checked=1 WHERE user_id=? AND founder_checked=0').run(created,userId);
      if(first.changes && remote.email_confirmed_at && validEmail(remote.email) && created<FOUNDER_CUTOFF) await db.prepare('INSERT INTO user_badges(user_id,badge,granted_at) VALUES(?,?,?) ON CONFLICT(user_id,badge) DO NOTHING').run(userId,'founder',Date.now());
      if(!first.changes)await db.prepare('UPDATE auth_links SET auth_created_at=? WHERE user_id=? AND (auth_created_at IS NULL OR auth_created_at<>?)').run(created,userId,created);
    });
  };
  if (ownerSetupToken && !(await db.prepare('SELECT password_hash FROM users WHERE is_owner=1').get()).password_hash) (await db.prepare('INSERT INTO owner_setup VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at').run(digest(ownerSetupToken),ownerSetupExpiresAt));
  if (startupCleanup) (await db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now()));
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  const limited = { config: { rateLimit: { max: 8, timeWindow: '15 minutes' } } };
  const loginAccountLimit=app.createRateLimit({max:20,timeWindow:'15 minutes',keyGenerator:request=>'account:'+digest(validName(request.body?.username)?key(request.body.username):validEmail(request.body?.email)?request.body.email.trim().toLowerCase():'invalid')});
  const cookieOptions={httpOnly:true,secure:secureCookies,sameSite:'strict',path:'/'};
  // Só compartilha consultas simultâneas; a próxima requisição volta a verificar revogações.
  const verifying=new Map();
  async function verifyOnce(token){
    const id=digest(token),existing=verifying.get(id);
    if(existing)return existing;
    if(verifying.size>=256)return authProvider.verify(token);
    const pending=authProvider.verify(token);verifying.set(id,pending);
    try{return await pending;}finally{if(verifying.get(id)===pending)verifying.delete(id);}
  }
  const refreshing=new Map();
  async function refreshOnce(token){
    const id=digest(token), existing=refreshing.get(id);
    if(existing)return existing;
    const pending=authProvider.refresh(token);
    refreshing.set(id,pending);
    try{return await pending;}finally{const timer=setTimeout(()=>{if(refreshing.get(id)===pending)refreshing.delete(id);},3000);timer.unref();}
  }
  const providerCookies=(reply,signed)=>{
    const accessAge=Math.floor(signed.expiresAt-Date.now()/1000);
    if(accessAge<=0 || !signed.refreshToken)throw Error('Sessão inválida.');
    reply.setCookie('pg_access',signed.accessToken,{...cookieOptions,maxAge:accessAge});
    reply.setCookie('pg_refresh',signed.refreshToken,{...cookieOptions,maxAge:7*86400});
  };
  const session = async (reply, user, providerSession) => {
    const token = secret(), csrf = secret();
    const maxAge=7*86400;
    if(authProvider)providerCookies(reply,providerSession);
    (await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(digest(token),user.id,csrf,Date.now()+maxAge*1000));
    reply.setCookie('pg_session',token,{...cookieOptions,maxAge});
    return { user: publicUser(user), csrf };
  };
  const fail = (reply, code, error) => reply.code(code).send({ error });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control','no-store').header('X-Content-Type-Options','nosniff');
    // Autorize a rota reconhecida pelo Fastify, inclusive quando a URL é codificada.
    const path = request.routeOptions.url ?? request.url.split('?')[0];
    if (!['GET','HEAD','OPTIONS'].includes(request.method) && !allowedOrigins.includes(request.headers.origin)) return fail(reply,403,'Origem do acesso não autorizada. Atualize a página.');
    const token = request.cookies.pg_session;
    if (token && token.length < 200) {
      const row = (await db.prepare('SELECT u.*,s.csrf FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1').get(digest(token),Date.now()));
      if (row && authProvider) {
        const link=await db.prepare('SELECT auth_user_id,email FROM auth_links WHERE user_id=?').get(row.id);
        const access=request.cookies.pg_access;
        let verified;
        if(access && access.length<8192)try {
          verified=await verifyOnce(access);
        } catch(error) {if(![400,401,403].includes(error.status))return fail(reply,503,'Autenticação temporariamente indisponível.');}
        if(!verified && request.cookies.pg_refresh && request.cookies.pg_refresh.length<8192)try{
          const signed=await refreshOnce(request.cookies.pg_refresh);
          if(link && signed.user?.id===link.auth_user_id && signed.user.email_confirmed_at){providerCookies(reply,signed);verified=signed.user;request.authAccess=signed.accessToken;}
        }catch(error){if(![400,401,403,422].includes(error.status))return fail(reply,503,'Autenticação temporariamente indisponível.');}
        if(link && verified?.id===link.auth_user_id && verified.email_confirmed_at && verified.email?.toLowerCase()===link.email.toLowerCase()){request.user=row;request.csrf=row.csrf;request.authUser=verified;}
      } else if (row) { request.user = row; request.csrf = row.csrf; }
    }
    const publicPaths = ['/health','/ready','/site','/auth/me','/auth/login','/auth/setup','/auth/register','/auth/link','/auth/recovery-request','/auth/recovery-finish','/invite-requests'];
    if (publicPaths.includes(path) || request.method === 'OPTIONS') return;
    if (!request.user) return fail(reply,401,'Entre na sua conta para continuar.');
    if (!['GET','HEAD'].includes(request.method) && request.headers['x-csrf-token'] !== request.csrf) return fail(reply,403,'Atualize a página antes de continuar.');
    if (path.startsWith('/admin/') && request.user.role !== 'admin') return fail(reply,403,'Somente administradores podem fazer isso.');
  });
  app.get('/site', async () => (await db.prepare('SELECT name,tagline FROM site_settings WHERE id=1').get()));
  app.post('/invite-requests', {bodyLimit:2048,config:{rateLimit:{max:5,timeWindow:'1 hour'}}}, async (request,reply)=>{
    if(!requestsReady)return fail(reply,503,'Pedidos de convite temporariamente indisponíveis.');
    const {name,email}=request.body??{};
    if(typeof name!=='string'||Array.from(name.trim()).length<2||Array.from(name.trim()).length>80||/[\x00-\x1f\x7f]/.test(name)||typeof email!=='string'||!validEmail(email.trim()))return fail(reply,400,'Confira o nome e o e-mail informados.');
    const count=await db.prepare('SELECT COUNT(*) AS total FROM invite_requests').get();
    if(count.total>=5000)return fail(reply,503,'Pedidos de convite temporariamente indisponíveis.');
    await db.prepare('INSERT INTO invite_requests(id,name,email,created_at) VALUES(?,?,?,?)').run(randomUUID(),name.trim(),email.trim(),Date.now());
    return reply.code(201).send({ok:true});
  });
  app.get('/admin/invite-requests',async(request,reply)=>{
    if(!requestsReady)return fail(reply,503,'Pedidos de convite ainda não estão disponíveis.');
    const offset=Number(request.query?.offset??0);
    if(!Number.isSafeInteger(offset)||offset<0||offset>5000)return fail(reply,400,'Página de pedidos inválida.');
    const rows=await db.prepare('SELECT r.id,r.name,r.email,r.created_at,CASE WHEN v.user_id IS NULL THEN 0 ELSE 1 END AS is_read FROM invite_requests r LEFT JOIN invite_request_reads v ON v.request_id=r.id AND v.user_id=? ORDER BY r.created_at DESC,r.id DESC LIMIT 100 OFFSET ?').all(request.user.id,offset);
    const unread=await db.prepare('SELECT COUNT(*) AS total FROM invite_requests r WHERE NOT EXISTS (SELECT 1 FROM invite_request_reads v WHERE v.request_id=r.id AND v.user_id=?)').get(request.user.id);
    return {requests:rows.map(row=>({id:row.id,name:row.name,email:row.email,createdAt:row.created_at,read:Boolean(row.is_read)})),unread:unread.total,hasMore:rows.length===100};
  });
  app.get('/admin/invite-requests/count',async(request,reply)=>{
    if(!requestsReady)return fail(reply,503,'Pedidos de convite ainda não estão disponíveis.');
    const result=await db.prepare('SELECT COUNT(*) AS total FROM invite_requests r WHERE NOT EXISTS (SELECT 1 FROM invite_request_reads v WHERE v.request_id=r.id AND v.user_id=?)').get(request.user.id);
    return {unread:result.total};
  });
  app.post('/admin/invite-requests/:id/read',async(request,reply)=>{
    if(!requestsReady)return fail(reply,503,'Pedidos de convite ainda não estão disponíveis.');
    if(!(await db.prepare('SELECT id FROM invite_requests WHERE id=?').get(request.params.id)))return fail(reply,404,'Pedido não encontrado.');
    await db.prepare('INSERT INTO invite_request_reads(request_id,user_id,read_at) VALUES(?,?,?) ON CONFLICT(request_id,user_id) DO NOTHING').run(request.params.id,request.user.id,Date.now());
    return {ok:true};
  });
  app.get('/auth/me', async request => ({ user: request.user ? publicUser(request.user) : null, csrf: request.csrf ?? null, setupPending: !(await db.prepare('SELECT password_hash FROM users WHERE is_owner=1').get()).password_hash, authMode:authProvider?'supabase':'local' }));
  app.post('/auth/login', limited, async (request,reply) => {
    if(authProvider){
      const {email,password}=request.body??{};
      if(!validEmail(email)||!validExistingPassword(password))return fail(reply,400,'Confira e-mail e senha.');
      if((await loginAccountLimit(request)).isExceeded)return fail(reply,429,'Muitas tentativas. Tente novamente mais tarde.');
      let signed;try{signed=await authProvider.signIn(email.trim(),password);}catch(error){return fail(reply,[400,401,403,422].includes(error.status)?401:503,[400,401,403,422].includes(error.status)?'E-mail ou senha incorretos, ou e-mail ainda não confirmado.':'Autenticação temporariamente indisponível.');}
      const link=await db.prepare('SELECT * FROM auth_links WHERE auth_user_id=?').get(signed.user.id);
      const user=link && await db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(link.user_id);
      if(!user||!link||link.email.toLowerCase()!==signed.user.email?.toLowerCase()){try{await authProvider.signOut(signed.accessToken);}catch{}return fail(reply,403,'Esta conta não está vinculada à comunidade.');}
      if(!link.activated_at)await db.prepare('UPDATE auth_links SET activated_at=? WHERE user_id=?').run(Date.now(),user.id);
      await rememberCreatedAt(user.id,signed.user);
      recordEvent('login',{actor:user.username});return session(reply,user,signed);
    }
    if((await loginAccountLimit(request)).isExceeded)return fail(reply,429,'Muitas tentativas. Tente novamente mais tarde.');
    const { username, password } = request.body ?? {};
    const user = validName(username) ? (await db.prepare('SELECT * FROM users WHERE username_key=? AND active=1').get(key(username))) : null;
    // Always perform a costly verification, including unknown names.
    const hash = user?.password_hash || dummyHash;
    const okay = validPassword(password) && await argon2.verify(hash,password);
    if (!okay || !user?.password_hash) return fail(reply,401,'Usuário ou senha incorretos.');
    const result=await session(reply,user);recordEvent('login',{actor:user.username});return result;
  });
  const dummyHash = await passwordHash(secret());
  app.post('/auth/setup', limited, async (request,reply) => {
    if(authProvider)return fail(reply,403,'A ativação usa o vínculo de e-mail.');
    const { token, password } = request.body ?? {};
    const setup = typeof token === 'string' && token.length < 200 && (await db.prepare('SELECT * FROM owner_setup WHERE token_hash=? AND expires_at>?').get(digest(token),Date.now()));
    if (!setup || (await db.prepare('SELECT password_hash FROM users WHERE is_owner=1').get()).password_hash) return fail(reply,403,'Este link de configuração não é válido. Abra o atalho deste PC novamente.');
    if (!validPassword(password)) return fail(reply,400,'Use uma senha de 12 a 128 caracteres.');
    const hash = await passwordHash(password);
    // A concurrent request must not overwrite an already claimed owner account.
    const result = (await db.prepare('UPDATE users SET password_hash=? WHERE is_owner=1 AND password_hash IS NULL').run(hash));
    if (!result.changes) return fail(reply,409,'A conta já foi configurada. Entre com sua senha.');
    (await db.exec('DELETE FROM owner_setup')); onOwnerReady();
    return session(reply,(await db.prepare('SELECT * FROM users WHERE is_owner=1').get()));
  });
  app.post('/auth/register', limited, async (request,reply) => {
    if(authProvider){
      const {token,username,email,password,phase}=request.body??{};
      if(!validName(username)||!validEmail(email)||!validNewPassword(password)||!['start','finish'].includes(phase))return fail(reply,400,'Confira nome, e-mail e senha de 12 caracteres até 72 bytes.');
      const tokenHash=typeof token==='string' && token.length<200?digest(token):'';
      if(!(await db.prepare('SELECT * FROM invites WHERE token_hash=? AND used=0 AND expires_at>?').get(tokenHash,Date.now())))return fail(reply,403,'Convite inválido ou expirado.');
      if(await db.prepare('SELECT id FROM users WHERE username_key=?').get(key(username)))return fail(reply,409,'Este nome já está em uso.');
      try{await authProvider.assertConfirmation();}catch{return fail(reply,503,'Confirmação de e-mail indisponível.');}
      if(phase==='start'){
        try{await authProvider.signUp(email.trim(),password);}catch{return fail(reply,503,'Não foi possível enviar a confirmação. Tente novamente.');}
        return {confirmationRequired:true};
      }
      let signed;try{signed=await authProvider.signIn(email.trim(),password);}catch{return fail(reply,401,'Confira os dados e confirme o e-mail antes de continuar.');}
      const id=signed.user.id;
      try{
        const registered=await db.transaction(async()=>{
          if(!(await db.prepare('UPDATE invites SET used=1 WHERE token_hash=? AND used=0 AND expires_at>?').run(tokenHash,Date.now())).changes)return false;
          await db.prepare('INSERT INTO users VALUES(?,?,?,?,?,0,1,?)').run(id,username.trim(),key(username),null,'member',Date.now());
          await db.prepare('INSERT INTO auth_links(user_id,auth_user_id,email,activated_at) VALUES(?,?,?,?)').run(id,id,signed.user.email,Date.now());
          return true;
        });
        if(!registered)return fail(reply,409,'Este convite já foi usado.');
      }catch(error){if(error.code?.includes('CONSTRAINT')||error.code==='23505'||[19,1555,2067].includes(error.errcode))return fail(reply,409,'Esta conta ou nome já está em uso.');throw error;}
      await rememberCreatedAt(id,signed.user);recordEvent('user-register',{actor:username.trim()});return reply.code(201).send(await session(reply,await db.prepare('SELECT * FROM users WHERE id=?').get(id),signed));
    }
    const { token, username, password } = request.body ?? {};
    if (!validName(username) || !validPassword(password)) return fail(reply,400,'Use um nome de 2 a 32 caracteres e senha de 12 a 128 caracteres.');
    const tokenHash = typeof token === 'string' && token.length < 200 ? digest(token) : '';
    const invite = (await db.prepare('SELECT * FROM invites WHERE token_hash=? AND used=0 AND expires_at>?').get(tokenHash,Date.now()));
    if (!invite) return fail(reply,403,'Convite inválido ou expirado. Peça um novo ao administrador.');
    if ((await db.prepare('SELECT id FROM users WHERE username_key=?').get(key(username)))) return fail(reply,409,'Este nome já está em uso.');
    const hash = await passwordHash(password), id = randomUUID();
    try {
      const registered=await db.transaction(async()=>{
        if (!(await db.prepare('UPDATE invites SET used=1 WHERE token_hash=? AND used=0 AND expires_at>?').run(tokenHash,Date.now())).changes) return false;
        await db.prepare('INSERT INTO users VALUES(?,?,?,?,?,0,1,?)').run(id,username.trim(),key(username),hash,'member',Date.now());
        return true;
      });
      if (!registered) return fail(reply,409,'Este convite já foi usado.');
    } catch (error) { if (error.code?.includes('CONSTRAINT') || error.code==='23505') return fail(reply,409,'Este nome já está em uso.'); throw error; }
    const result=await session(reply,(await db.prepare('SELECT * FROM users WHERE id=?').get(id)));recordEvent('user-register',{actor:username.trim()});return reply.code(201).send(result);
  });
  app.post('/auth/link',limited,async(request,reply)=>{
    if(!authProvider)return fail(reply,404,'Recurso indisponível.');
    const {username,password,email,existingPassword}=request.body??{};
    if(!validName(username)||!validPassword(password)||!validEmail(email))return fail(reply,400,'Confira usuário, senha atual e e-mail.');
    const user=await db.prepare('SELECT * FROM users WHERE username_key=? AND active=1').get(key(username));
    const okay=await argon2.verify(user?.password_hash || dummyHash,password);
    if(!okay || !user?.password_hash)return fail(reply,401,'Usuário ou senha incorretos.');
    const normalized=email.trim().toLowerCase();
    let signed;
    try{
      await authProvider.assertConfirmation();
      if(existingPassword!==undefined){
        if(!validExistingPassword(existingPassword))return fail(reply,400,'Informe a senha da conta Supabase.');
        try{signed=await authProvider.signIn(normalized,existingPassword);}catch{return fail(reply,401,'Confira a senha da conta de e-mail e sua confirmação.');}
      }
      const result=await db.transaction(async()=>{
        await db.lock('auth-link:'+user.id);
        const existing=await db.prepare('SELECT * FROM auth_links WHERE user_id=?').get(user.id);
        if(existing && (existing.activated_at || existing.email!==normalized))return null;
        let remote=signed?.user || await authProvider.getUser(user.id);
        if(!remote){try{remote=await authProvider.importUser(user,normalized);}catch{remote=await authProvider.getUser(user.id);}}
        if(!remote || remote.email?.toLowerCase()!==normalized || (existing && existing.auth_user_id!==remote.id))return null;
        if(!existing)await db.prepare('INSERT INTO auth_links(user_id,auth_user_id,email,activated_at) VALUES(?,?,?,?)').run(user.id,remote.id,normalized,remote.email_confirmed_at?Date.now():null);
        if(!remote.email_confirmed_at)await authProvider.resend(normalized);
        return {confirmationRequired:!remote.email_confirmed_at};
      });
      return result || fail(reply,409,'Não foi possível associar este e-mail.');
    }catch(error){if(error.code?.includes('CONSTRAINT')||error.code==='23505'||[19,1555,2067].includes(error.errcode))return fail(reply,409,'Esta conta já está vinculada.');return fail(reply,503,'Não foi possível enviar a confirmação. Tente novamente.');}
    finally{if(signed?.accessToken)try{await authProvider.signOut(signed.accessToken);}catch{}}
  });
  app.post('/auth/recovery-request',limited,async(request,reply)=>{
    if(!authProvider)return fail(reply,404,'Recurso indisponível.');
    const {email}=request.body??{};if(!validEmail(email))return fail(reply,400,'Informe um e-mail válido.');
    try{await authProvider.requestRecovery(email.trim());}catch{return fail(reply,503,'Não foi possível enviar o e-mail agora.');}
    return {ok:true};
  });
  app.post('/auth/recovery-finish',limited,async(request,reply)=>{
    if(!authProvider)return fail(reply,404,'Recurso indisponível.');
    const {token,password}=request.body??{};
    if(typeof token!=='string'||!/^\w{20,200}$/.test(token)||!validNewPassword(password))return fail(reply,400,'Link ou senha inválidos.');
    try{
      await authProvider.recoverPassword(token,password,async remote=>{
        const link=await db.prepare('SELECT * FROM auth_links WHERE auth_user_id=?').get(remote.id);
        const user=link && await db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(link.user_id);
        if(!link || link.email.toLowerCase()!==remote.email?.toLowerCase())return false;
        await db.prepare('UPDATE auth_links SET activated_at=? WHERE user_id=?').run(Date.now(),user.id);
        await db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id);
        return true;
      });
      return {ok:true};
    }catch{return fail(reply,400,'Link inválido ou expirado. Solicite outro e-mail.');}
  });
  app.post('/auth/logout', async (request,reply) => { (await db.prepare('DELETE FROM sessions WHERE token_hash=?').run(digest(request.cookies.pg_session))); if(authProvider)try{await authProvider.signOut(request.authAccess||request.cookies.pg_access);}catch{} recordEvent('logout',{actor:request.user.username});for(const name of ['pg_session','pg_access','pg_refresh'])reply.clearCookie(name,{path:'/',secure:secureCookies,sameSite:'strict'}); return {ok:true}; });
  async function renameUser(request,reply,id) {
    const {username}=request.body??{};
    if(!validName(username))return fail(reply,400,'Use um nome de 2 a 32 caracteres com letras, números, espaços, ponto, hífen ou sublinhado.');
    const target=await db.prepare('SELECT * FROM users WHERE id=?').get(id);
    if(!target)return fail(reply,404,'Conta não encontrada.');
    if(id!==request.user.id && (request.user.role!=='admin'||target.is_owner))return fail(reply,403,'Você não pode alterar esta conta.');
    try {
      await db.prepare('UPDATE users SET username=?,username_key=? WHERE id=?').run(username.trim(),key(username),id);
    } catch(error) {
      if(error.code?.includes('CONSTRAINT')||error.code==='23505'||[19,1555,2067].includes(error.errcode))return fail(reply,409,'Este nome já está em uso.');
      throw error;
    }
    recordEvent('user-rename',{actor:request.user.username});
    return {user:publicUser({...target,username:username.trim()})};
  }
  app.patch('/auth/username',async(request,reply)=>renameUser(request,reply,request.user.id));
  app.patch('/admin/users/:id/username',async(request,reply)=>renameUser(request,reply,request.params.id));
  app.post('/auth/password', limited, async (request,reply) => {
    const { currentPassword, password } = request.body ?? {};
    if(authProvider){
      if(!validExistingPassword(currentPassword)||!validNewPassword(password))return fail(reply,400,'Use uma senha de 12 caracteres até 72 bytes.');
      try{await authProvider.changePassword(request.authUser.email,currentPassword,password,request.authUser.id);}catch{return fail(reply,403,'Não foi possível alterar a senha. Confira a senha atual.');}
      await db.prepare('DELETE FROM sessions WHERE user_id=?').run(request.user.id);
      let signed;try{signed=await authProvider.signIn(request.authUser.email,password);}catch{return fail(reply,503,'Senha alterada. Entre novamente.');}
      return session(reply,request.user,signed);
    }
    if (!validPassword(currentPassword) || !await argon2.verify(request.user.password_hash,currentPassword)) return fail(reply,403,'A senha atual não confere.');
    if (!validPassword(password)) return fail(reply,400,'Use uma senha de 12 a 128 caracteres.');
    const hash = await passwordHash(password);
    (await db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(hash,request.user.id));
    (await db.prepare('DELETE FROM sessions WHERE user_id=?').run(request.user.id));
    return session(reply,request.user);
  });
  app.post('/admin/invites', {config:{rateLimit:{max:20,timeWindow:'1 minute'}}}, async () => { const token=secret(); (await db.prepare('INSERT INTO invites VALUES(?,?,0)').run(digest(token),Date.now()+86400000)); return {token,expiresInHours:24}; });
  app.get('/admin/users', async () => ({users:(await db.prepare('SELECT * FROM users ORDER BY created_at').all()).map(user=>({...publicUser(user),active:Boolean(user.active)}))}));
  app.patch('/admin/users/:id', async (request,reply) => {
    const user=(await db.prepare('SELECT * FROM users WHERE id=?').get(request.params.id)), {role,active}=request.body??{};
    if (!user) return fail(reply,404,'Conta não encontrada.');
    if (user.is_owner || user.id===request.user.id) return fail(reply,403,'A conta proprietária e sua própria conta estão protegidas.');
    if (!['admin','member'].includes(role) || typeof active!=='boolean') return fail(reply,400,'Permissões inválidas.');
    (await db.prepare('UPDATE users SET role=?,active=? WHERE id=?').run(role,Number(active),user.id));
    (await db.prepare('DELETE FROM sessions WHERE user_id=?').run(user.id));recordEvent('user-update',{actor:request.user.username});return {ok:true};
  });
  app.get('/channels', async () => ({ text:(await db.prepare("SELECT * FROM channels WHERE kind='text' ORDER BY position,rowid").all()),voice:(await db.prepare("SELECT * FROM channels WHERE kind='voice' ORDER BY position,rowid").all()) }));
  app.post('/admin/channels', async (request,reply) => {
    const {name,kind,hint=''}=request.body??{};
    if (!validName(name) || !['text','voice'].includes(kind) || typeof hint!=='string' || hint.length>120) return fail(reply,400,'Confira nome, tipo e descrição do canal.');
    const id=randomUUID(); (await db.prepare('INSERT INTO channels(id,kind,name,hint,position) VALUES(?,?,?,?,?)').run(id,kind,name.trim(),hint.trim(),Date.now()));recordEvent('channel-create',{actor:request.user.username,channel:name.trim()});return reply.code(201).send({id});
  });
  app.patch('/admin/channels/:kind/:id', async (request,reply) => {
    const {name,hint=''}=request.body??{};
    if (!validName(name) || typeof hint!=='string' || hint.length>120) return fail(reply,400,'Nome ou descrição inválidos.');
    const result=(await db.prepare('UPDATE channels SET name=?,hint=? WHERE id=? AND kind=?').run(name.trim(),hint.trim(),request.params.id,request.params.kind));
    if(result.changes)recordEvent('channel-update',{actor:request.user.username,channel:name.trim()});return result.changes?{ok:true}:fail(reply,404,'Canal não encontrado.');
  });
  app.delete('/admin/channels/:kind/:id', async (request,reply) => {
    const {kind,id}=request.params;
    if(!['text','voice'].includes(kind))return fail(reply,404,'Canal não encontrado.');
    if(kind==='voice')return fail(reply,409,'A exclusão de canais de voz está indisponível enquanto não for possível impedir novas conexões com acessos já emitidos.');
    if(id==='general')return fail(reply,409,'O canal geral é obrigatório e não pode ser excluído.');
    const result=await db.transaction(async()=>{
      await db.lock('channel-delete:'+id);
      const channel=await db.prepare('SELECT id FROM channels WHERE id=? AND kind=?').get(id,kind);
      if(!channel)return 404;
      if((await db.prepare("SELECT COUNT(*) AS total FROM channels WHERE kind='text'").get()).total<=1)return 409;
      const attachments=await db.prepare('SELECT ma.attachment_id FROM message_attachments ma JOIN messages m ON m.id=ma.message_id WHERE m.channel=?').all(id);
      await db.prepare('UPDATE messages SET reply_to_id=NULL WHERE reply_to_id IN (SELECT id FROM messages WHERE channel=?)').run(id);
      await db.prepare('DELETE FROM message_attachments WHERE message_id IN (SELECT id FROM messages WHERE channel=?)').run(id);
      for(let i=0;i<attachments.length;i+=200){
        const batch=attachments.slice(i,i+200);
        await db.prepare('DELETE FROM attachments WHERE id IN ('+batch.map(()=>'?').join(',')+')').run(...batch.map(item=>item.attachment_id));
      }
      await db.prepare('DELETE FROM message_events WHERE channel=?').run(id);
      await db.prepare('DELETE FROM messages WHERE channel=?').run(id);
      await db.prepare('DELETE FROM channels WHERE id=? AND kind=?').run(id,kind);return 200;
    });
    if(result===404)return fail(reply,404,'Canal não encontrado.');
    if(result===409)return fail(reply,409,'É necessário manter pelo menos um canal de texto.');
    recordEvent('channel-update',{actor:request.user.username,channel:'canal de texto removido'});return {ok:true};
  });
  // Ordem dos canais na barra lateral. A seção cujo primeiro canal vem antes aparece primeiro.
  app.post('/admin/channels/order', async (request,reply) => {
    const {order}=request.body??{};
    if (!Array.isArray(order) || !order.length || order.length>200 || order.some(item=>!item || !['text','voice'].includes(item.kind) || typeof item.id!=='string' || item.id.length>100) || new Set(order.map(item=>item?.kind+':'+item?.id)).size!==order.length) return fail(reply,400,'Ordem de canais inválida.');
    const existing=[...(await db.prepare('SELECT id,kind FROM channels').all())].map(channel=>channel.kind+':'+channel.id).sort();
    const sent=order.map(item=>item.kind+':'+item.id);
    if (JSON.stringify([...sent].sort())!==JSON.stringify(existing)) return fail(reply,409,'Os canais mudaram. Atualize a página e tente de novo.');
    await db.transaction(async()=>{ for (const [index,item] of order.entries()) await db.prepare('UPDATE channels SET position=? WHERE id=? AND kind=?').run(index,item.id,item.kind); });
    recordEvent('channel-update',{actor:request.user.username,channel:'ordem dos canais'});
    return {ok:true};
  });
  app.patch('/admin/site', async (request,reply) => {
    const {name,tagline}=request.body??{};
    if (typeof name!=='string'||name.trim().length<2||name.length>60||typeof tagline!=='string'||tagline.length>120) return fail(reply,400,'Nome: 2 a 60 caracteres. Descrição: até 120.');
    (await db.prepare('UPDATE site_settings SET name=?,tagline=? WHERE id=1').run(name.trim(),tagline.trim()));recordEvent('site-update',{actor:request.user.username});return {ok:true};
  });
  return {
    authCreatedAt,
    usesSupabase:Boolean(authProvider), founderChecked,
    voiceExists: async id => Boolean((await db.prepare("SELECT 1 FROM channels WHERE id=? AND kind='voice'").get(id))),
    conversationExists: async id => typeof id==='string' && (id.startsWith('voice:') ? Boolean((await db.prepare("SELECT 1 FROM channels WHERE id=? AND kind='voice'").get(id.slice(6)))) : Boolean((await db.prepare("SELECT 1 FROM channels WHERE id=? AND kind='text'").get(id)))),
  };
}
