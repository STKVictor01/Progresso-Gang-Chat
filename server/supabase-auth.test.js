import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import argon2 from 'argon2';
import { createApp } from './app.js';
import { createSupabaseAuth } from './supabase-auth.js';
import { runtimeConfig } from './runtime-config.js';

const origin='http://localhost:5173';
const password=randomBytes(24).toString('base64url');
const options={apiKey:'testkey',apiSecret:randomBytes(32).toString('hex'),serverUrl:'ws://localhost:7880',logger:false,secureCookies:false,allowedOrigins:[origin]};
const headers={origin};
const request=(app,url,payload,extra={})=>app.inject({method:'POST',url,payload,headers:{...headers,...extra}});
const cookies=response=>response.cookies.map(cookie=>`${cookie.name}=${cookie.value}`).join('; ');

function fakeAuth(){
  const users=new Map(), tokens=new Map(), refreshTokens=new Map(), recoveryTokens=new Map();let available=true,refreshCount=0;
  const down=()=>{if(!available)throw Error('indisponível');};
  const denied=()=>{const error=Error('inválido');error.status=400;throw error;};
  return {
    users, setAvailable(value){available=value;}, confirm(email){users.get(email).email_confirmed_at='confirmado';}, expire(token){tokens.delete(token);}, get refreshCount(){return refreshCount;},
    recovery(email){const token=randomBytes(32).toString('hex');recoveryTokens.set(token,users.get(email));return token;},
    async assertConfirmation(){down();},
    async signUp(email,pass){down();if(!users.has(email))users.set(email,{id:randomUUID(),email,password:pass});},
    async signIn(email,pass){down();const user=users.get(email);if(!user||!user.email_confirmed_at||!(user.password===pass||user.password_hash && await argon2.verify(user.password_hash,pass)))denied();const token=randomUUID(),refreshToken=randomUUID();tokens.set(token,user);refreshTokens.set(refreshToken,user);return {user,accessToken:token,refreshToken,expiresAt:Math.floor(Date.now()/1000)+3600};},
    async refresh(token){down();refreshCount++;const user=refreshTokens.get(token);if(!user)denied();refreshTokens.delete(token);const accessToken=randomUUID(),refreshToken=randomUUID();tokens.set(accessToken,user);refreshTokens.set(refreshToken,user);return {user,accessToken,refreshToken,expiresAt:Math.floor(Date.now()/1000)+3600};},
    async requestRecovery(){down();},
    async recoverPassword(token,next,authorize){down();const user=recoveryTokens.get(token);recoveryTokens.delete(token);if(!user||!await authorize(user))denied();user.password=next;user.password_hash=null;for(const [value,owner] of tokens)if(owner.id===user.id)tokens.delete(value);for(const [value,owner] of refreshTokens)if(owner.id===user.id)refreshTokens.delete(value);},
    async verify(token){down();return tokens.get(token) || denied();},
    async getUser(id){down();return [...users.values()].find(user=>user.id===id)||null;},
    async importUser(user,email){down();if(users.has(email))denied();const remote={id:user.id,email,password_hash:user.password_hash};users.set(email,remote);return remote;},
    async resend(){down();},async signOut(token){tokens.delete(token);},
    async changePassword(email,current,next,id){const signed=await this.signIn(email,current);if(signed.user.id!==id)denied();signed.user.password=next;signed.user.password_hash=null;for(const [token,user] of tokens)if(user.id===id)tokens.delete(token);},
  };
}

test('vincula conta antiga sem perder proprietário, mensagens ou proteção de sessões',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pg-auth-test-')),dbPath=join(dir,'test.sqlite');
  const setup=randomBytes(24).toString('base64url');let app;
  try{
    app=await createApp({...options,dbPath,ownerSetupToken:setup});
    const old=await request(app,'/auth/setup',{token:setup,password});assert.equal(old.statusCode,200);
    const owner=old.json().user,oldCookies=cookies(old),csrf=old.json().csrf;
    const message=await request(app,'/messages',{clientId:randomUUID(),text:'Mensagem fictícia',channel:'general'},{cookie:oldCookies,'x-csrf-token':csrf});assert.equal(message.statusCode,201);
    await app.close();app=undefined;
    const provider=fakeAuth();app=await createApp({...options,dbPath,authProvider:provider});
    assert.equal((await app.inject({url:'/channels',headers:{cookie:oldCookies}})).statusCode,401);
    assert.equal((await request(app,'/auth/link',{username:'Vitão',password:randomBytes(24).toString('base64url'),email:'owner@example.invalid'})).statusCode,401);
    const linked=await request(app,'/auth/link',{username:'Vitão',password,email:'owner@example.invalid'});assert.equal(linked.statusCode,200);assert.equal(linked.json().confirmationRequired,true);
    assert.equal((await request(app,'/auth/login',{email:'owner@example.invalid',password})).statusCode,401);
    provider.confirm('owner@example.invalid');
    const login=await request(app,'/auth/login',{email:'owner@example.invalid',password});assert.equal(login.statusCode,200);assert.deepEqual(login.json().user,owner);
    const auth={cookie:cookies(login),'x-csrf-token':login.json().csrf};
    assert.ok(login.cookies.every(cookie=>cookie.httpOnly&&cookie.sameSite==='Strict'));
    const history=await app.inject({url:'/messages?channel=general',headers:auth});assert.equal(history.statusCode,200);assert.equal(history.json().messages[0].user_id,owner.id);
    assert.equal((await request(app,'/admin/invites',{},auth)).statusCode,200);
    assert.equal((await request(app,'/auth/link',{username:'Vitão',password,email:'other@example.invalid'})).statusCode,409);
    assert.equal((await request(app,'/admin/invites',{}, {cookie:auth.cookie})).statusCode,403);
    provider.setAvailable(false);assert.equal((await app.inject({url:'/channels',headers:auth})).statusCode,503);provider.setAvailable(true);
    assert.equal((await request(app,'/auth/logout',{},auth)).statusCode,200);
    assert.equal((await app.inject({url:'/channels',headers:auth})).statusCode,401);
  }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('vincula identidade Auth existente somente após comprovar as duas senhas',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'pg-existing-auth-')),dbPath=join(dir,'test.sqlite');
  const provider=fakeAuth(),email='existente@example.invalid',remotePassword=randomBytes(24).toString('base64url');let app;
  try{
    const setup=randomUUID()+randomUUID();app=await createApp({...options,dbPath,ownerSetupToken:setup});
    const setupResult=await request(app,'/auth/setup',{token:setup,password}),owner=setupResult.json().user;
    const oldAuth={cookie:cookies(setupResult),'x-csrf-token':setupResult.json().csrf};
    const invite=(await request(app,'/admin/invites',{},oldAuth)).json().token;
    assert.equal((await request(app,'/auth/register',{token:invite,username:'Pessoa',password})).statusCode,201);
    await app.close();app=undefined;
    await provider.signUp(email,remotePassword);provider.confirm(email);
    app=await createApp({...options,dbPath,authProvider:provider});
    const data={username:'Vitão',password,email,existingPassword:remotePassword};
    assert.equal((await request(app,'/auth/link',{...data,password:randomBytes(24).toString('base64url')})).statusCode,401);
    assert.equal((await request(app,'/auth/link',{...data,existingPassword:'senha-incorreta'})).statusCode,401);
    assert.equal((await request(app,'/auth/login',{email,password:remotePassword})).statusCode,403);
    const linked=await request(app,'/auth/link',data);assert.equal(linked.statusCode,200);assert.equal(linked.json().confirmationRequired,false);
    assert.equal((await request(app,'/auth/link',{...data,username:'Pessoa'})).statusCode,409);
    const login=await request(app,'/auth/login',{email,password:remotePassword});assert.equal(login.statusCode,200);assert.deepEqual(login.json().user,owner);
    const auth={cookie:cookies(login),'x-csrf-token':login.json().csrf};assert.equal((await request(app,'/admin/invites',{},auth)).statusCode,200);
    provider.expire(login.cookies.find(item=>item.name==='pg_access').value);
    assert.equal((await app.inject({url:'/channels',headers:auth})).statusCode,200);
    const token=provider.recovery(email),next=randomBytes(24).toString('base64url');
    assert.equal((await request(app,'/auth/recovery-finish',{token,password:next})).statusCode,200);
    assert.equal((await request(app,'/auth/login',{email,password:next})).json().user.owner,true);
  }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('convite e vínculo são exigidos mesmo para uma conta Auth confirmada',async()=>{
  const provider=fakeAuth(),app=await createApp({...options,dbPath:':memory:',authProvider:provider});
  try{
    await provider.signUp('outside@example.invalid',password);provider.confirm('outside@example.invalid');
    assert.equal((await request(app,'/auth/login',{email:'outside@example.invalid',password})).statusCode,403);
    const payload={username:'Pessoa',email:'outside@example.invalid',password,token:'invalido',phase:'finish'};
    assert.equal((await request(app,'/auth/register',payload)).statusCode,403);
    assert.equal((await request(app,'/auth/register',{...payload,phase:'start',password:'á'.repeat(40)})).statusCode,400);
  }finally{await app.close();}
});

test('convite confirmado cria membro e só pode ser usado uma vez',async()=>{
  const provider=fakeAuth(),dir=mkdtempSync(join(tmpdir(),'pg-auth-invite-')),dbPath=join(dir,'test.sqlite');let app;
  try{
    const setup=randomUUID()+randomUUID();app=await createApp({...options,dbPath,ownerSetupToken:setup});
    await request(app,'/auth/setup',{token:setup,password});await app.close();app=undefined;
    app=await createApp({...options,dbPath,authProvider:provider});
    await request(app,'/auth/link',{username:'Vitão',password,email:'dono@example.invalid'});provider.confirm('dono@example.invalid');
    const owner=await request(app,'/auth/login',{email:'dono@example.invalid',password});
    const auth={cookie:cookies(owner),'x-csrf-token':owner.json().csrf};
    const invite=(await request(app,'/admin/invites',{},auth)).json().token;
    const data={token:invite,username:'Pessoa',email:'pessoa@example.invalid',password,phase:'start'};
    assert.equal((await request(app,'/auth/register',data)).statusCode,200);
    assert.equal((await request(app,'/auth/register',{...data,phase:'finish'})).statusCode,401);
    provider.confirm(data.email);provider.users.get(data.email).created_at='2025-03-04T05:06:07.000Z';
    const member=await request(app,'/auth/register',{...data,phase:'finish'});assert.equal(member.statusCode,201);assert.equal(member.json().user.role,'member');
    // "Membro desde" usa a criação da conta no Supabase Auth.
    const presence=(await app.inject({url:'/presence',headers:{cookie:cookies(member)}})).json();
    assert.equal(presence.profiles.find(item=>item.id===member.json().user.id).memberSince,Date.parse('2025-03-04T05:06:07.000Z'));
    assert.equal((await request(app,'/admin/invites',{}, {cookie:cookies(member),'x-csrf-token':member.json().csrf})).statusCode,403);
    assert.equal((await request(app,'/auth/register',{...data,username:'Outra',phase:'finish'})).statusCode,403);
  }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('renova sessão concorrente e recuperação revoga sessões sem aceitar tokens repetidos',async()=>{
  const provider=fakeAuth(),dir=mkdtempSync(join(tmpdir(),'pg-auth-recovery-')),dbPath=join(dir,'test.sqlite');let app;
  try{
    const setup=randomUUID()+randomUUID();app=await createApp({...options,dbPath,ownerSetupToken:setup});
    await request(app,'/auth/setup',{token:setup,password});await app.close();app=undefined;
    app=await createApp({...options,dbPath,authProvider:provider});
    const email='dono@example.invalid';await request(app,'/auth/link',{username:'Vitão',password,email});provider.confirm(email);
    const owner=await request(app,'/auth/login',{email,password});assert.equal(owner.statusCode,200);
    const oldCookie=cookies(owner),access=owner.cookies.find(item=>item.name==='pg_access').value;
    provider.expire(access);
    const refreshed=await Promise.all(Array.from({length:4},()=>app.inject({url:'/channels',headers:{cookie:oldCookie}})));
    assert.ok(refreshed.every(response=>response.statusCode===200));assert.equal(provider.refreshCount,1);
    const renewedCookie=refreshed[0].cookies.map(item=>`${item.name}=${item.value}`).join('; ')+'; '+owner.cookies.filter(item=>item.name==='pg_session').map(item=>`${item.name}=${item.value}`).join('; ');
    assert.equal((await app.inject({url:'/channels',headers:{cookie:renewedCookie}})).statusCode,200);
    assert.equal((await request(app,'/auth/recovery-request',{email})).statusCode,200);
    const token=provider.recovery(email),newPassword=randomBytes(24).toString('base64url');
    assert.equal((await request(app,'/auth/recovery-finish',{token,password:newPassword})).statusCode,200);
    assert.equal((await app.inject({url:'/channels',headers:{cookie:renewedCookie}})).statusCode,401);
    assert.equal((await request(app,'/auth/recovery-finish',{token,password:newPassword})).statusCode,400);
    assert.equal((await request(app,'/auth/login',{email,password})).statusCode,401);
    const next=await request(app,'/auth/login',{email,password:newPassword});assert.equal(next.statusCode,200);assert.equal(next.json().user.owner,true);
  }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('SDK exige confirmação de e-mail e usa cliente isolado por operação',async()=>{
  let signup={user:{email_confirmed_at:null},session:null};let clients=0,automatic=false;
  const factory=()=>{clients++;return {auth:{signUp:async()=>({data:signup,error:null}),signInWithPassword:async()=>({data:{user:{email_confirmed_at:null},session:null},error:null})}};};
  const provider=createSupabaseAuth({url:'https://example.invalid',publishableKey:'ficticia',secretKey:'ficticia',redirectTo:'https://example.invalid',clientFactory:factory,settingsFetch:async()=>({ok:true,json:async()=>({mailer_autoconfirm:automatic})})});
  await provider.assertConfirmation();automatic=true;await assert.rejects(provider.assertConfirmation());
  await provider.signUp('x@example.invalid',password);
  signup={user:{email_confirmed_at:'sim'},session:{}};await assert.rejects(provider.signUp('x@example.invalid',password));
  await assert.rejects(provider.signIn('x@example.invalid',password),error=>error.status===403);
  assert.equal(clients,3);
});

test('configuração Auth exige chaves e origens HTTPS e não ativa por padrão',()=>{
  const base={PG_CHAT_AUTH:'supabase',SUPABASE_URL:'https://example.invalid',PG_CHAT_SITE_ORIGIN:'https://site.invalid',SUPABASE_PUBLISHABLE_KEY:'ficticia',SUPABASE_SECRET_KEY:'ficticia'};
  assert.ok(runtimeConfig(base).supabaseAuth);
  assert.equal(runtimeConfig({...base,LIVEKIT_INTERNAL_URL:'ws://127.0.0.1:7880'}).livekitInternalUrl,'ws://127.0.0.1:7880');
  for(const value of ['ws://example.com:7880','http://127.0.0.1:7880','ws://127.0.0.1:7880/path'])assert.throws(()=>runtimeConfig({...base,LIVEKIT_INTERNAL_URL:value}));
  for(const change of [{SUPABASE_URL:'http://example.invalid'},{PG_CHAT_SITE_ORIGIN:'https://site.invalid/path'},{SUPABASE_SECRET_KEY:''},{PG_CHAT_AUTH:'erro'}])assert.throws(()=>runtimeConfig({...base,...change}));
  assert.equal(runtimeConfig({}).supabaseAuth,undefined);
});
