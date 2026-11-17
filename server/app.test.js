import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { TokenVerifier } from 'livekit-server-sdk';
import { createApp as createRawApp } from './app.js';
import { normalizeSoundboardWav } from './soundboard-audio.js';
import { runtimeConfig } from './runtime-config.js';
import { createMediaCache } from './media-cache.js';
const options = { apiKey: 'testkey', apiSecret: randomBytes(32).toString('hex'), serverUrl: 'ws://localhost:7880', logger: false, secureCookies:false, allowedOrigins:['http://localhost:5173'] };

const testPassword=randomBytes(24).toString('base64url');
test('cache de imagens limita memória, expira e descarta itens menos usados',()=>{
  let time=0;const cache=createMediaCache({maxBytes:4,ttlMs:10,now:()=>time});
  cache.set('a',Buffer.from('aa'));cache.set('b',Buffer.from('bb'));
  assert.equal(cache.get('a').toString(),'aa');
  cache.set('c',Buffer.from('cc'));assert.equal(cache.get('b'),undefined);
  assert.equal(cache.get('a').toString(),'aa');
  time=10;assert.equal(cache.get('a'),undefined);assert.equal(cache.get('c'),undefined);
  cache.set('grande',Buffer.alloc(5));assert.equal(cache.get('grande'),undefined);
});
test('produção exige PostgreSQL, CA e origens HTTPS seguras',()=>{
  const base={NODE_ENV:'production',PG_CHAT_DATABASE:'postgres',DATABASE_URL:'postgres://example',PG_CHAT_SITE_ORIGIN:'https://gang.example.com',LIVEKIT_URL:'wss://live.example.com',LIVEKIT_API_KEY:'key',LIVEKIT_API_SECRET:randomBytes(32).toString('hex')};
  const ca=join(import.meta.dirname,'package.json');
  for(const env of [{...base,PG_CHAT_DATABASE:''},{...base,DATABASE_URL:''},{...base,PG_CHAT_SITE_ORIGIN:'http://gang.example.com'},{...base,PG_CHAT_SITE_ORIGIN:'https://gang.example.com/path'},{...base,LIVEKIT_URL:'ws://live.example.com'},{...base,LIVEKIT_API_SECRET:''},{...base,PG_CHAT_MUSIC_MAX_ROOMS:'0'}]) assert.throws(()=>runtimeConfig(env,ca));
  assert.throws(()=>runtimeConfig(base,join(import.meta.dirname,'ca-inexistente')));
  assert.deepEqual(runtimeConfig(base,ca).allowedOrigins,['https://gang.example.com']);
  assert.equal(runtimeConfig({},ca).allowedOrigins,undefined);
});
test('inicialização protegida não aceita criar conta em SQLite vazio',async()=>{
  await assert.rejects(createRawApp({...options,dbPath:':memory:',requireExistingOwner:true}),/Produção exige o banco existente/);
});
test('inicialização sem limpeza preserva sessões e anexos antigos',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'gang-startup-')),dbPath=join(dir,'chat.sqlite');
  try{
    const first=await createRawApp({...options,dbPath});await first.close();
    const db=new DatabaseSync(dbPath);
    const owner=db.prepare('SELECT id FROM users WHERE is_owner=1').get().id;
    db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run('old',owner,'csrf',1);
    db.prepare('INSERT INTO attachments(id,request_hash,mime,width,height,size,animated,data,created_at) VALUES(?,?,?,?,?,?,?,?,?)').run('old','hash','image/png',1,1,1,0,Buffer.from([0]),1);
    db.close();
    const preserved=await createRawApp({...options,dbPath,startupCleanup:false});await preserved.close();
    const check=new DatabaseSync(dbPath);
    assert.equal(check.prepare('SELECT count(*) AS n FROM sessions').get().n,1);
    assert.equal(check.prepare('SELECT count(*) AS n FROM attachments').get().n,1);check.close();
    const cleaned=await createRawApp({...options,dbPath});await cleaned.close();
    const after=new DatabaseSync(dbPath);
    assert.equal(after.prepare('SELECT count(*) AS n FROM sessions').get().n,0);
    assert.equal(after.prepare('SELECT count(*) AS n FROM attachments').get().n,0);after.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('tentativas distribuídas para a mesma conta também são limitadas',async()=>{
  const app=await createRawApp({...options,dbPath:':memory:'});
  try{
    let response;
    for(let i=1;i<=21;i++)response=await app.inject({method:'POST',url:'/auth/login',remoteAddress:'192.0.2.'+i,headers:{origin:'http://localhost:5173'},payload:{username:'Pessoa',password:testPassword}});
    assert.equal(response.statusCode,429);
  }finally{await app.close();}
});
test('origem de produção respeita cookies, CSRF e CORS',async()=>{
  const token=randomBytes(32).toString('base64url'),origin='https://gang.example.com';
  const app=await createRawApp({...options,dbPath:':memory:',ownerSetupToken:token,secureCookies:true,allowedOrigins:[origin]});
  try{
    assert.equal((await app.inject('/ready')).json().ready,true);
    const good=await app.inject({method:'POST',url:'/auth/setup',headers:{origin},payload:{token,password:testPassword}});
    assert.equal(good.statusCode,200);assert.equal(good.cookies[0].secure,true);assert.equal(good.cookies[0].httpOnly,true);assert.equal(good.cookies[0].sameSite,'Strict');
    const credentials={cookie:'pg_session='+good.cookies[0].value,'x-csrf-token':good.json().csrf};
    assert.equal((await app.inject({method:'POST',url:'/admin/invites',headers:{...credentials,origin:'https://evil.example'}})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/admin/invites',headers:{origin,cookie:credentials.cookie}})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/admin/invites',headers:{...credentials,origin}})).statusCode,200);
    assert.equal((await app.inject({url:'/site',headers:{origin}})).headers['access-control-allow-origin'],origin);
    assert.notEqual((await app.inject({url:'/site',headers:{origin:'https://evil.example'}})).headers['access-control-allow-origin'],'https://evil.example');
  }finally{await app.close();}
});
test('soundboard normalizes loud and quiet audio to -6 dB and preserves silence', () => {
  const target = Math.floor(32767 * 10 ** (-6 / 20));
  for (const peak of [1000,32767]) {
    const wav=Buffer.alloc(48);
    wav.writeInt16LE(peak,44);wav.writeInt16LE(-peak,46);
    const result=normalizeSoundboardWav(wav);
    assert.equal(result.readInt16LE(44),target);
    assert.equal(result.readInt16LE(46),-target);
    assert.equal(wav.readInt16LE(44),peak);
  }
  const silence=Buffer.alloc(48);
  assert.deepEqual(normalizeSoundboardWav(silence),silence);
});
test('soundboard validates audio length and shares sounds between calls', async () => {
  const app=await createApp({...options,dbPath:':memory:'});
  const wav=Buffer.alloc(44+44100);
  wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(22050,24);wav.writeUInt32LE(44100,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  const headers={'content-type':'application/octet-stream','x-sound-channel':'geral','x-sound-name':encodeURIComponent('Som de teste')};
  try {
    const upload=await app.inject({method:'POST',url:'/soundboard',headers,payload:wav});
    assert.equal(upload.statusCode,201,upload.body);
    const id=upload.json().id;
    assert.equal((await app.inject('/soundboard?channel=geral')).json().sounds.length,1);
    assert.equal((await app.inject('/soundboard?channel=jogatina')).json().sounds.length,1);
    assert.equal((await app.inject('/soundboard/'+id+'?channel=jogatina')).statusCode,200);
    assert.equal((await app.inject('/soundboard/'+id+'?channel=inexistente')).statusCode,404);
    const retrieved=await app.inject('/soundboard/'+id+'?channel=geral');assert.equal(retrieved.statusCode,200);assert.deepEqual(retrieved.rawPayload,wav);
    const invite=await app.inject({method:'POST',url:'/admin/invites',payload:{}});
    const member=await app.inject({method:'POST',url:'/auth/register',payload:{token:invite.json().token,username:'Membro teste',password:testPassword}});
    const memberHeaders={cookie:'pg_session='+member.cookies[0].value,'x-csrf-token':member.json().csrf};
    assert.equal((await app.inject({method:'DELETE',url:'/soundboard/'+id,headers:memberHeaders})).statusCode,403);
    assert.equal((await app.inject({method:'POST',url:'/soundboard',headers,payload:Buffer.alloc(50)})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:'/soundboard',headers,payload:Buffer.alloc(441046)})).statusCode,413);
    assert.equal((await app.inject({method:'DELETE',url:'/soundboard/'+id})).statusCode,200);
  } finally {await app.close();}
});
test('som pessoal pertence à conta, é compartilhado na call e não aparece no soundboard', async () => {
  const app=await createApp({...options,dbPath:':memory:'});
  const wav=Buffer.alloc(48);wav.write('RIFF',0);wav.writeUInt32LE(40,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(22050,24);wav.writeUInt32LE(44100,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(4,40);wav.writeInt16LE(5000,44);
  try {
    const owner=(await app.inject('/presence')).json().users[0].id;
    const invite=await app.inject({method:'POST',url:'/admin/invites',payload:{}});
    const member=await app.inject({method:'POST',url:'/auth/register',headers:{cookie:''},payload:{token:invite.json().token,username:'Pessoa B',password:testPassword}});
    const memberId=member.json().user.id,headers={cookie:'pg_session='+member.cookies[0].value,'x-csrf-token':member.json().csrf};
    const upload=(body,extra={})=>app.inject({method:'PUT',url:'/voice-entry',headers:{'content-type':'application/octet-stream',...extra},payload:body});
    assert.equal((await app.inject({url:'/voice-entry',headers:{cookie:''}})).statusCode,401);
    assert.equal((await upload(wav,{'x-csrf-token':''})).statusCode,403);
    assert.equal((await upload(Buffer.alloc(48))).statusCode,400);
    assert.equal((await upload(wav)).statusCode,200);
    assert.equal((await app.inject('/voice-entry')).json().configured,true);
    assert.equal((await app.inject({url:'/voice-entry/'+owner,headers})).statusCode,200);
    assert.equal((await app.inject('/soundboard?channel=geral')).json().sounds.length,0);
    assert.equal((await upload(wav,headers)).statusCode,200);
    assert.equal((await app.inject({method:'DELETE',url:'/voice-entry',headers})).statusCode,200);
    assert.equal((await app.inject('/voice-entry/'+memberId)).statusCode,404);
    assert.equal((await app.inject('/voice-entry/'+owner)).statusCode,200);
    assert.equal((await app.inject({method:'DELETE',url:'/voice-entry'})).statusCode,200);
    assert.equal((await app.inject('/voice-entry/'+owner)).statusCode,404);
  } finally {await app.close();}
});
test('voice presence reports actual participants once per account and protects the endpoint', async () => {
  let ownerId, memberId;
  const roomService = {
    listRooms: async names => { assert.ok(names.includes('geral')); return [{name:'geral'}, {name:'outside'}]; },
    listParticipants: async room => { assert.equal(room,'geral'); return [ownerId+':first',ownerId+':second',memberId+':one','unknown:one'].map(identity=>({identity})); },
  };
  const app=await createApp({...options,dbPath:':memory:',roomService});
  try {
    ownerId=(await app.inject('/presence')).json().users[0].id;
    const invite=await app.inject({method:'POST',url:'/admin/invites',payload:{}});
    const member=await app.inject({method:'POST',url:'/auth/register',headers:{cookie:''},payload:{token:invite.json().token,username:'Pessoa B',password:testPassword}});
    assert.equal(member.statusCode,201); memberId=member.json().user.id;
    assert.equal((await app.inject({url:'/voice-presence',headers:{cookie:''}})).statusCode,401);
    const presence=await app.inject('/voice-presence');
    assert.equal(presence.statusCode,200);
    assert.deepEqual(presence.json().channels,{geral:[ownerId,memberId],jogatina:[]});
  } finally { await app.close(); }
});
test('voice presence reports an unavailable service instead of empty channels', async () => {
  const app=await createApp({...options,dbPath:':memory:',roomService:{listRooms:async()=>{throw Error('unavailable');}}});
  try { assert.equal((await app.inject('/voice-presence')).statusCode,503); }
  finally { await app.close(); }
});
test('somente administradores removem as conexões de outra conta da call escolhida', async () => {
  let members=[], fail=false;
  const removed=[];
  const roomService={
    listParticipants:async room=>{assert.equal(room,'geral');return members;},
    removeParticipant:async(room,identity)=>{assert.equal(room,'geral');if(fail)throw Error('unavailable');removed.push(identity);members=members.filter(member=>member.identity!==identity);},
  };
  const app=await createApp({...options,dbPath:':memory:',roomService});
  try {
    const owner=(await app.inject('/presence')).json().users[0].id;
    const invite=await app.inject({method:'POST',url:'/admin/invites',payload:{}});
    const member=await app.inject({method:'POST',url:'/auth/register',headers:{cookie:''},payload:{token:invite.json().token,username:'Pessoa teste',password:testPassword}});
    const memberId=member.json().user.id, other=randomUUID();
    const first=memberId+':'+randomUUID(),second=memberId+':'+randomUUID(),otherIdentity=other+':'+randomUUID();
    members=[first,second,otherIdentity,'music-bot:geral'].map(identity=>({identity}));
    const send=(payload,headers={})=>app.inject({method:'POST',url:'/admin/voice/geral/kick',headers,payload});
    const memberHeaders={cookie:'pg_session='+member.cookies[0].value,'x-csrf-token':member.json().csrf};
    assert.equal((await send({userId:other},memberHeaders)).statusCode,403);
    assert.equal((await send({userId:memberId},{'x-csrf-token':''})).statusCode,403);
    assert.equal((await send({userId:owner})).statusCode,403);
    assert.equal((await send({userId:'music-bot'})).statusCode,400);
    assert.equal((await send({userId:randomUUID()})).statusCode,404);
    assert.equal((await app.inject({method:'POST',url:'/admin/voice/inexistente/kick',payload:{userId:memberId}})).statusCode,400);
    assert.deepEqual(removed,[]);
    fail=true;assert.equal((await send({userId:memberId})).statusCode,503);fail=false;
    assert.equal((await send({userId:memberId})).statusCode,200);
    assert.deepEqual(removed.sort(),[first,second].sort());
    assert.deepEqual(members.map(item=>item.identity),[otherIdentity,'music-bot:geral']);
    assert.ok((await app.inject('/admin/logs')).json().events.some(entry=>entry.event==='voice-remove'&&entry.actor==='Vitão'&&entry.channel==='voice:geral'));
  } finally {await app.close();}
});
test('logs são restritos a administradores e não guardam texto das mensagens', async () => {
  const app=await createApp({...options,dbPath:':memory:'});
  try {
    const secretText='conteúdo privado da mensagem';
    const message=await app.inject({method:'POST',url:'/messages',payload:{clientId:randomUUID(),text:secretText,channel:'general'}});
    assert.equal(message.statusCode,201);
    assert.equal((await app.inject({method:'DELETE',url:'/messages/'+message.json().id})).statusCode,200);
    const invite=await app.inject({method:'POST',url:'/admin/invites',payload:{}});
    const member=await app.inject({method:'POST',url:'/auth/register',headers:{cookie:''},payload:{token:invite.json().token,username:'Pessoa teste',password:testPassword}});
    const memberCookie=member.cookies[0].name+'='+member.cookies[0].value;
    assert.equal((await app.inject({url:'/admin/logs',headers:{cookie:memberCookie}})).statusCode,403);
    assert.equal((await app.inject({url:'/admin/logs',headers:{cookie:''}})).statusCode,401);
    const logs=await app.inject('/admin/logs');assert.equal(logs.statusCode,200);
    assert.ok(logs.json().events.some(entry=>entry.event==='message-send'));
    assert.ok(logs.json().events.some(entry=>entry.event==='message-delete'));
    assert.equal(logs.body.includes(secretText),false);
  } finally {await app.close();}
});
test('logs registram entrada e saída reais da call observadas pelo LiveKit', async () => {
  let participants=[];
  const roomService={listRooms:async()=>participants.length?[{name:'geral'}]:[],listParticipants:async()=>participants};
  const app=await createApp({...options,dbPath:':memory:',roomService});
  try {
    const id=(await app.inject('/presence')).json().users[0].id;
    await app.inject('/voice-presence');participants=[{identity:id+':sessao'}];
    await new Promise(resolve=>setTimeout(resolve,3100));await app.inject('/voice-presence');
    participants=[];await new Promise(resolve=>setTimeout(resolve,3100));await app.inject('/voice-presence');
    const entries=(await app.inject('/admin/logs')).json().events;
    assert.ok(entries.some(entry=>entry.event==='voice-join'&&entry.actor==='Vitão'&&entry.channel==='Geral'));
    assert.ok(entries.some(entry=>entry.event==='voice-leave'&&entry.actor==='Vitão'&&entry.channel==='Geral'));
  } finally {await app.close();}
});
test('online presence and profile images use authenticated owners', async () => {
  const {default:sharp}=await import('sharp');
  const app=await createApp({...options,dbPath:':memory:'});
  try {
    const id=randomUUID();
    const image=await sharp({create:{width:8,height:8,channels:3,background:'red'}}).png().toBuffer();
    assert.equal((await app.inject({method:'POST',url:'/uploads',headers:{'content-type':'application/octet-stream','x-upload-id':id},payload:image})).statusCode,201);
    assert.equal((await app.inject({method:'PATCH',url:'/profile',payload:{description:'Olá gang',avatarId:id}})).statusCode,200);
    const people=(await app.inject('/presence')).json().users;
    assert.equal(people.length,1);assert.equal(people[0].description,'Olá gang');assert.equal(people[0].avatarUrl,'/api/media/'+id);
    assert.equal((await app.inject('/presence')).json().profiles[0].avatarUrl,'/api/media/'+id);
    for (const channel of ['general','voice:geral','voice:jogatina']) {
      const message=await app.inject({method:'POST',url:'/messages',payload:{channel,text:'Mensagem de teste',clientId:randomUUID()}});
      assert.equal(message.json().user_id,people[0].id);
      assert.equal((await app.inject('/messages?channel='+encodeURIComponent(channel))).json().messages[0].user_id,people[0].id);
    }
    assert.equal((await app.inject('/media/'+id)).statusCode,200);
    const thumbnail=await app.inject('/media/'+id+'?thumb=1');
    assert.equal(thumbnail.statusCode,200);assert.match(thumbnail.headers['content-type'],/^image\/webp/);
    const dimensions=await sharp(thumbnail.rawPayload).metadata();assert.ok(dimensions.width<=340 && dimensions.height<=120);
    assert.equal((await app.inject({url:'/media/'+id+'?thumb=1',headers:{cookie:''}})).statusCode,401);
    assert.equal((await app.inject({method:'POST',url:'/messages',payload:{clientId:randomUUID(),attachmentIds:[id]}})).statusCode,409);
    assert.equal((await app.inject({method:'PATCH',url:'/profile',payload:{description:'x'.repeat(201),avatarId:null}})).statusCode,400);
    assert.equal((await app.inject({method:'PATCH',url:'/profile',payload:{description:'',avatarId:null}})).statusCode,200);
    assert.equal((await app.inject('/media/'+id)).statusCode,404);
    assert.equal((await app.inject('/media/'+id+'?thumb=1')).statusCode,404);
  } finally { await app.close(); }
});
async function createApp(options){
  const token=randomBytes(32).toString('base64url');
  const app=await createRawApp({...options,ownerSetupToken:token});
  const inject=app.inject.bind(app);
  const setup=await inject({method:'POST',url:'/auth/setup',headers:{origin:'http://localhost:5173'},payload:{token,password:testPassword}});
  const auth=setup.statusCode===200?setup:await inject({method:'POST',url:'/auth/login',headers:{origin:'http://localhost:5173'},payload:{username:'Vitão',password:testPassword}});
  assert.equal(auth.statusCode,200,auth.body);
  const cookie=auth.cookies[0].name+'='+auth.cookies[0].value,csrf=auth.json().csrf;
  app.inject=options=>inject(typeof options==='string'?{url:options,headers:{cookie}}:{...options,headers:{origin:'http://localhost:5173',cookie,'x-csrf-token':csrf,...options.headers}});
  return app;
}

test('pedidos de convite persistem e a leitura é individual e restrita a administradores',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'gang-invite-requests-')),dbPath=join(dir,'chat.sqlite');
  const origin='http://localhost:5173',token=randomBytes(32).toString('base64url');
  let app;
  const auth=result=>({cookie:'pg_session='+result.cookies.find(cookie=>cookie.name==='pg_session').value,'x-csrf-token':result.json().csrf,origin});
  const call=(method,url,payload,headers={})=>app.inject({method,url,payload,headers:{origin,...headers}});
  try{
    app=await createRawApp({...options,dbPath,ownerSetupToken:token});
    const owner=auth(await call('POST','/auth/setup',{token,password:testPassword}));
    assert.equal((await call('POST','/invite-requests',{name:'X',email:'invalido'})).statusCode,400);
    assert.equal((await call('POST','/invite-requests',{name:'😀',email:'teste@example.invalid'})).statusCode,400);
    assert.equal((await call('POST','/invite-requests',{name:'Pessoa teste',email:'pessoa@example.invalid'},{origin:'https://evil.example'})).statusCode,403);
    assert.equal((await call('POST','/invite-requests',{name:'Pessoa teste',email:'pessoa@example.invalid'})).statusCode,201);
    assert.equal((await call('GET','/admin/invite-requests')).statusCode,401);
    const invite=await call('POST','/admin/invites',{},owner);
    const created=await call('POST','/auth/register',{token:invite.json().token,username:'Outro admin',password:testPassword});
    const member=auth(created),id=created.json().user.id;
    assert.equal((await call('GET','/admin/invite-requests',undefined,member)).statusCode,403);
    assert.equal((await call('PATCH','/admin/users/'+id,{role:'admin',active:true},owner)).statusCode,200);
    const second=auth(await call('POST','/auth/login',{username:'Outro admin',password:testPassword}));
    const received=(await call('GET','/admin/invite-requests',undefined,owner)).json();
    assert.equal(received.unread,1);assert.equal(received.requests[0].email,'pessoa@example.invalid');
    const requestId=received.requests[0].id;
    assert.equal((await call('POST','/admin/invite-requests/'+requestId+'/read',{}, {...owner,'x-csrf-token':''})).statusCode,403);
    assert.equal((await call('POST','/admin/invite-requests/'+requestId+'/read',{},owner)).statusCode,200);
    assert.equal((await call('GET','/admin/invite-requests',undefined,owner)).json().unread,0);
    assert.equal((await call('GET','/admin/invite-requests',undefined,second)).json().unread,1);
    await app.close();app=await createRawApp({...options,dbPath});
    assert.equal((await call('GET','/admin/invite-requests',undefined,owner)).json().requests[0].read,true);
    assert.equal((await call('GET','/admin/invite-requests',undefined,second)).json().unread,1);
    let last;for(let i=0;i<6;i++)last=await app.inject({method:'POST',url:'/invite-requests',remoteAddress:'192.0.2.50',headers:{origin},payload:{name:'Visitante',email:'visitante@example.invalid'}});
    assert.equal(last.statusCode,429);
  }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});

test('respostas mantêm o vínculo apenas no canal e ocultam mensagens excluídas',async()=>{
  const app=await createApp({...options,dbPath:':memory:'});
  try{
    const send=payload=>app.inject({method:'POST',url:'/messages',payload:{clientId:randomUUID(),...payload}});
    const original=await send({text:'Mensagem original'});
    const id=original.json().id;
    const payload={text:'Minha resposta',replyTo:id,clientId:randomUUID()};
    const response=await app.inject({method:'POST',url:'/messages',payload});
    assert.equal(response.statusCode,201);
    assert.equal(response.json().reply.text,'Mensagem original');
    assert.equal((await app.inject({method:'POST',url:'/messages',payload})).json().id,response.json().id);
    assert.equal((await app.inject({method:'POST',url:'/messages',payload:{...payload,replyTo:null}})).statusCode,409);
    assert.equal((await send({channel:'voice:geral',text:'Outro canal',replyTo:id})).statusCode,400);
    assert.equal((await send({text:'Inválida',replyTo:999999})).statusCode,400);
    assert.equal((await app.inject({method:'DELETE',url:'/messages/'+id})).statusCode,200);
    const saved=(await app.inject('/messages')).json().messages.find(message=>message.id===response.json().id);
    assert.deepEqual(saved.reply,{id,deleted:true});
    assert.equal((await send({text:'Excluída',replyTo:id})).statusCode,400);
  } finally {await app.close();}
});

test('usuários e administradores alteram nomes sem perder login ou permissões',async()=>{
  const token=randomBytes(32).toString('base64url');
  const app=await createRawApp({...options,dbPath:':memory:',ownerSetupToken:token});
  const origin='http://localhost:5173';
  const headers=r=>({origin,cookie:r.cookies[0].name+'='+r.cookies[0].value,'x-csrf-token':r.json().csrf});
  const req=(h,method,url,payload)=>app.inject({headers:h,method,url,payload});
  try{
    const owner=await req({origin},'POST','/auth/setup',{token,password:testPassword});
    const admin=headers(owner);
    const invitation=await req(admin,'POST','/admin/invites',{});
    const member=await req({origin},'POST','/auth/register',{token:invitation.json().token,username:'Pessoa A',password:testPassword});
    const user=headers(member),id=member.json().user.id;
    assert.equal((await req(user,'PATCH','/auth/username',{username:'Pessoa Nova'})).statusCode,200);
    assert.equal((await req({origin},'POST','/auth/login',{username:'Pessoa Nova',password:testPassword})).statusCode,200);
    assert.equal((await req({origin},'POST','/auth/login',{username:'Pessoa A',password:testPassword})).statusCode,401);
    assert.equal((await req(user,'PATCH','/admin/users/'+owner.json().user.id+'/username',{username:'Intruso'})).statusCode,403);
    assert.equal((await req(admin,'PATCH','/admin/users/'+id+'/username',{username:'Vitão'})).statusCode,409);
    assert.equal((await req(admin,'PATCH','/admin/users/'+id+'/username',{username:'Pessoa Final'})).statusCode,200);
    assert.equal((await req(user,'GET','/auth/me')).json().user.name,'Pessoa Final');
    assert.equal((await req({origin},'POST','/auth/login',{username:'Pessoa Final',password:testPassword})).statusCode,200);
  } finally {await app.close();}
});

test('accounts enforce owner reservation, sessions, CSRF, author ownership and admin permissions',async()=>{
  const setupToken=randomBytes(32).toString('base64url');
  const app=await createRawApp({...options,dbPath:':memory:',ownerSetupToken:setupToken});
  const origin='http://localhost:5173';
  const authHeaders=response=>({origin,cookie:response.cookies[0].name+'='+response.cookies[0].value,'x-csrf-token':response.json().csrf});
  const request=(headers,method,url,payload)=>app.inject({headers,method,url,payload});
  try{
    for(const url of ['/messages','/channels','/media/'+randomUUID()])assert.equal((await app.inject(url)).statusCode,401);
    assert.equal((await request({origin},'POST','/auth/setup',{token:'invalid',password:testPassword})).statusCode,403);
    assert.equal((await request({origin:'https://other.example'},'POST','/auth/setup',{token:setupToken,password:testPassword})).statusCode,403);
    const owner=await request({origin},'POST','/auth/setup',{token:setupToken,password:testPassword});assert.equal(owner.statusCode,200,owner.body);
    assert.equal(owner.json().user.name,'Vitão');assert.equal(owner.json().user.role,'admin');assert.equal(owner.cookies[0].httpOnly,true);assert.equal(owner.cookies[0].sameSite,'Strict');
    const admin=authHeaders(owner);
    assert.equal((await request({origin},'POST','/auth/setup',{token:setupToken,password:randomBytes(32).toString('hex')})).statusCode,403);
    assert.equal((await request({...admin,'x-csrf-token':'wrong'},'POST','/admin/invites',{})).statusCode,403);
    const invite=()=>request(admin,'POST','/admin/invites',{}).then(r=>r.json().token);
    const inviteA=await invite();
    assert.equal((await request({origin},'POST','/auth/register',{token:inviteA,username:'VITÃO',password:testPassword,role:'admin'})).statusCode,409);
    const memberA=await request({origin},'POST','/auth/register',{token:inviteA,username:'Pessoa A',password:testPassword,role:'admin'});assert.equal(memberA.statusCode,201);assert.equal(memberA.json().user.role,'member');
    assert.equal((await request({origin},'POST','/auth/register',{token:inviteA,username:'Intruso',password:testPassword})).statusCode,403);
    const memberB=await request({origin},'POST','/auth/register',{token:await invite(),username:'Pessoa B',password:testPassword});assert.equal(memberB.statusCode,201);
    const a=authHeaders(memberA),b=authHeaders(memberB);
    for(const route of ['/admin/invites','/admin/channels'])assert.equal((await request(a,'POST',route,{})).statusCode,403);
    const first=await request(a,'POST','/messages',{name:'Vitão',text:'minha mensagem',clientId:randomUUID()});assert.equal(first.statusCode,201);assert.equal(first.json().name,'Pessoa A');assert.equal(first.json().canDelete,true);
    const id=first.json().id;
    assert.equal((await request(b,'GET','/messages')).json().messages[0].canDelete,false);
    assert.equal((await request(b,'DELETE','/messages/'+id)).statusCode,403);
    const cursor=(await request(b,'GET','/messages')).json().cursor;
    assert.equal((await request(a,'DELETE','/messages/'+id)).statusCode,200);
    assert.deepEqual((await request(b,'GET','/messages?since='+cursor)).json().deletedIds,[id]);
    assert.equal((await request(admin,'GET','/messages')).json().messages.length,0);
    const other=await request(b,'POST','/messages',{text:'admin pode remover',clientId:randomUUID()});assert.equal((await request(admin,'DELETE','/messages/'+other.json().id)).statusCode,200);
    const {default:sharp}=await import('sharp');const image=await sharp({create:{width:2,height:2,channels:3,background:'red'}}).png().toBuffer();const uploadId=randomUUID();
    assert.equal((await request({...a,'content-type':'application/octet-stream','x-upload-id':uploadId},'POST','/uploads',image)).statusCode,201);
    assert.equal((await request(b,'POST','/messages',{text:'roubar anexo',attachmentIds:[uploadId],clientId:randomUUID()})).statusCode,400);
    const mediaMessage=await request(a,'POST','/messages',{attachmentIds:[uploadId],clientId:randomUUID()});assert.equal(mediaMessage.statusCode,201);
    assert.equal((await request(b,'GET','/media/'+uploadId)).headers['cache-control'],'no-store');
    await request(admin,'DELETE','/messages/'+mediaMessage.json().id);assert.equal((await request(a,'GET','/media/'+uploadId)).statusCode,404);
    const newChannel=await request(admin,'POST','/admin/channels',{kind:'voice',name:'Nova call',hint:'Teste'});assert.equal(newChannel.statusCode,201);
    const channelId=newChannel.json().id;
    assert.equal((await request(a,'POST','/token',{room:channelId})).statusCode,200);
    assert.equal((await request(a,'POST','/messages',{channel:'voice:'+channelId,text:'chat da nova call',clientId:randomUUID()})).statusCode,201);
    assert.equal((await request(admin,'PATCH','/admin/channels/voice/'+channelId,{name:'Renomeado',hint:'Nova descrição'})).statusCode,200);
    assert.equal((await request(admin,'PATCH','/admin/site',{name:'Novo nome',tagline:'Novo lema'})).statusCode,200);assert.equal((await app.inject('/site')).json().name,'Novo nome');
    assert.equal((await request(admin,'PATCH','/admin/users/'+owner.json().user.id,{role:'member',active:false})).statusCode,403);
    assert.equal((await request(admin,'PATCH','/admin/users/'+memberA.json().user.id,{role:'member',active:false})).statusCode,200);assert.equal((await request(a,'GET','/messages')).statusCode,401);
    assert.equal((await request(b,'POST','/auth/logout',{})).statusCode,200);assert.equal((await request(b,'GET','/messages')).statusCode,401);
  }finally{await app.close();}
});

test('rotas administrativas exigem administrador também com caminhos codificados',async()=>{
  const token=randomBytes(32).toString('base64url'),origin='http://localhost:5173';
  const app=await createRawApp({...options,dbPath:':memory:',ownerSetupToken:token});
  const headers=response=>({origin,cookie:response.cookies.map(item=>item.name+'='+item.value).join('; '),'x-csrf-token':response.json().csrf});
  const request=(auth,method,url,payload)=>app.inject({headers:auth,method,url,payload});
  try {
    const owner=await request({origin},'POST','/auth/setup',{token,password:testPassword});
    assert.equal(owner.statusCode,200);
    const admin=headers(owner);
    const invite=await request(admin,'POST','/admin/invites',{});
    const registered=await request({origin},'POST','/auth/register',{token:invite.json().token,username:'Membro regressão',password:testPassword});
    assert.equal(registered.statusCode,201);
    const member=headers(registered);
    for(const prefix of ['/admin','/%61dmin','/ad%6Din','/a%64min','/%61%64%6d%69%6e']) {
      for(const route of ['/users','/logs']) {
        assert.equal((await request({},'GET',prefix+route)).statusCode,401,prefix+route);
        assert.equal((await request(member,'GET',prefix+route)).statusCode,403,prefix+route);
        assert.equal((await request(admin,'GET',prefix+route)).statusCode,200,prefix+route);
      }
      assert.equal((await request(member,'POST',prefix+'/invites',{})).statusCode,403,prefix);
      assert.equal((await request(member,'PATCH',prefix+'/site',{name:'Alteração indevida',tagline:'Teste'})).statusCode,403,prefix);
    }
    assert.equal((await app.inject('/site')).json().name,'Progresso Gang - Chat');
    assert.equal((await app.inject('/%68ealth')).statusCode,200);
  } finally {await app.close();}
});

test('password changes revoke other sessions and auth attempts are rate limited',async()=>{
  const token=randomBytes(32).toString('base64url'),origin='http://localhost:5173';
  const app=await createRawApp({...options,dbPath:':memory:',ownerSetupToken:token});
  try{
    const setup=await app.inject({method:'POST',url:'/auth/setup',headers:{origin},payload:{token,password:testPassword}});
    const headers={origin,cookie:'pg_session='+setup.cookies[0].value,'x-csrf-token':setup.json().csrf};
    const next=randomBytes(24).toString('base64url');
    const changed=await app.inject({method:'POST',url:'/auth/password',headers,payload:{currentPassword:testPassword,password:next}});assert.equal(changed.statusCode,200);
    assert.equal((await app.inject({url:'/messages',headers})).statusCode,401);
    assert.equal((await app.inject({method:'POST',url:'/auth/login',headers:{origin},payload:{username:'Vitão',password:next}})).statusCode,200);
    let last;for(let i=0;i<9;i++)last=await app.inject({method:'POST',url:'/auth/login',headers:{origin},payload:{username:'ninguém',password:testPassword}});
    assert.equal(last.statusCode,429);
  }finally{await app.close();}
});

test('voice grants isolate the two allowed rooms and reject unknown rooms', async () => {
  const app = await createApp({ ...options, dbPath: ':memory:' });
  try {
    const verifier = new TokenVerifier(options.apiKey, options.apiSecret);
    const identities = [];
    for (const room of ['geral', 'jogatina']) {
      const response = await app.inject({ method: 'POST', url: '/token', payload: { name: 'Teste', room } });
      assert.equal(response.statusCode, 200);
      const claims = await verifier.verify(response.json().token);
      assert.equal(claims.video.room, room);
      assert.equal(claims.video.roomJoin, true);
      identities.push(claims.sub);
    }
    assert.notEqual(identities[0], identities[1]);
    assert.equal((await app.inject({ method: 'POST', url: '/token', payload: { name: 'Teste', room: 'desconhecido' } })).statusCode, 400);
    const spoof=await app.inject({method:'POST',url:'/token',payload:{name:'Outra pessoa'}}); assert.equal((await verifier.verify(spoof.json().token)).name,'Vitão');
  } finally { await app.close(); }
});
test('concurrent retries create only one message', async () => {
  const app=await createApp({...options,dbPath:':memory:'});
  try {
    const payload={clientId:randomUUID(),text:'Mensagem simultânea'};
    const responses=await Promise.all([app.inject({method:'POST',url:'/messages',payload}),app.inject({method:'POST',url:'/messages',payload})]);
    assert.deepEqual(responses.map(response=>response.statusCode).sort(),[200,201]);
    assert.equal(responses[0].json().id,responses[1].json().id);
  } finally {await app.close();}
});
test('text works without a voice token, survives restart, and retries do not duplicate', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pg-chat-test-'));
  const dbPath = join(directory, 'chat.sqlite');
  let app = await createApp({ ...options, dbPath });
  try {
    const payload = { name: 'Teste local', text: '<script>texto seguro</script>', clientId: randomUUID() };
    const first = await app.inject({ method: 'POST', url: '/messages', payload });
    assert.equal(first.statusCode, 201);
    const retry = await app.inject({ method: 'POST', url: '/messages', payload });
    assert.equal(retry.json().id, first.json().id);
    assert.equal((await app.inject({ method: 'POST', url: '/messages', payload: { ...payload, text: 'outro texto' } })).statusCode, 409);
    assert.equal((await app.inject({ method: 'POST', url: '/messages', payload: { ...payload, text: ' ' } })).statusCode, 400);
    assert.equal((await app.inject('/messages?after=invalid')).statusCode, 400);
    await app.close(); app = await createApp({ ...options, dbPath });
    const saved = (await app.inject('/messages')).json().messages;
    assert.equal(saved.length, 1); assert.equal(saved[0].text, payload.text);
    assert.equal((await app.inject('/messages?after=' + saved[0].id)).json().messages.length, 0);
    for (let i = 0; i < 104; i++) await app.inject({ method: 'POST', url: '/messages', payload: { name: 'Teste', text: 'Mensagem ' + i, clientId: randomUUID() } });
    const latest = (await app.inject('/messages')).json();
    assert.equal(latest.messages.length, 100); assert.equal(latest.hasMore, true);
    const older = (await app.inject('/messages?before=' + latest.messages[0].id)).json();
    assert.equal(older.messages.length, 5); assert.equal(older.hasMore, false);
    assert.ok(older.messages.at(-1).id < latest.messages[0].id);
  } finally { await app.close(); for (const name of ['chat.sqlite', 'chat.sqlite-wal', 'chat.sqlite-shm']) rmSync(join(directory, name), { force: true }); rmdirSync(directory); }
});

test('media is validated, linked once, and each channel has its own history', async () => {
  const {default:sharp}=await import('sharp');
  const app=await createApp({...options,dbPath:':memory:'});
  try{
    const image=await sharp({create:{width:20,height:12,channels:3,background:'#c6352c'}}).png().toBuffer();
    const id=randomUUID();
    const upload=await app.inject({method:'POST',url:'/uploads',headers:{'content-type':'application/octet-stream','x-upload-id':id},payload:image});
    assert.equal(upload.statusCode,201);assert.equal(upload.json().mime,'image/png');assert.equal(upload.json().width,20);
    assert.equal((await app.inject('/media/'+id)).statusCode,404);
    assert.equal((await app.inject({method:'POST',url:'/uploads',headers:{'content-type':'application/octet-stream','x-upload-id':id},payload:image})).statusCode,200);
    const message={name:'Teste',channel:'voice:geral',text:'Imagem da call',clientId:randomUUID(),attachmentIds:[id]};
    const sent=await app.inject({method:'POST',url:'/messages',payload:message});assert.equal(sent.statusCode,201);assert.equal(sent.json().attachments.length,1);
    assert.equal((await app.inject('/messages')).json().messages.length,0);
    assert.equal((await app.inject('/messages?channel=voice:jogatina')).json().messages.length,0);
    assert.equal((await app.inject('/messages?channel=voice:geral')).json().messages[0].text,message.text);
    assert.equal((await app.inject({method:'POST',url:'/messages',payload:message})).json().id,sent.json().id);
    assert.equal((await app.inject({method:'POST',url:'/messages',payload:{...message,channel:'general'}})).statusCode,409);
    assert.equal((await app.inject({method:'POST',url:'/messages',payload:{...message,clientId:randomUUID(),channel:'general'}})).statusCode,409);
    const served=await app.inject('/media/'+id);assert.equal(served.statusCode,200);assert.equal(served.headers['content-type'],'image/png');assert.equal(served.headers['x-content-type-options'],'nosniff');
    assert.equal((await sharp(served.rawPayload).metadata()).height,12);
    const photo=await sharp({create:{width:12,height:6,channels:3,background:'#c6352c'}}).jpeg().withMetadata({orientation:6}).toBuffer();
    const photoId=randomUUID();const photoUpload=await app.inject({method:'POST',url:'/uploads',headers:{'content-type':'application/octet-stream','x-upload-id':photoId},payload:photo});assert.equal(photoUpload.statusCode,201);assert.equal(photoUpload.json().width,6);assert.equal(photoUpload.json().height,12);
    await app.inject({method:'POST',url:'/messages',payload:{name:'Teste',text:'Foto',clientId:randomUUID(),attachmentIds:[photoId]}});
    const photoResponse=await app.inject('/media/'+photoId);assert.equal((await sharp(photoResponse.rawPayload).metadata()).exif,undefined);
    assert.equal((await app.inject('/messages?channel=unknown')).statusCode,400);
    for(const invalid of [Buffer.from('<svg><script>alert(1)</script></svg>'),Buffer.from([137,80,78,71,13,10,26,10])]){
      const response=await app.inject({method:'POST',url:'/uploads',headers:{'content-type':'application/octet-stream','x-upload-id':randomUUID()},payload:invalid});assert.equal(response.statusCode,415);
    }
    const raw=Buffer.alloc(2*4*4);for(let pixel=0;pixel<8;pixel++){raw[pixel*4+(pixel<4?0:1)]=255;raw[pixel*4+3]=255;}
    const gif=await sharp(raw,{raw:{width:2,height:4,channels:4,pageHeight:2}}).gif({delay:[100,150],loop:0}).toBuffer();
    assert.equal((await sharp(gif,{animated:true}).metadata()).pages,2);
    const gifId=randomUUID();const gifUpload=await app.inject({method:'POST',url:'/uploads',headers:{'content-type':'application/octet-stream','x-upload-id':gifId},payload:gif});assert.equal(gifUpload.statusCode,201);assert.equal(gifUpload.json().animated,true);
    const gifMessage=await app.inject({method:'POST',url:'/messages',payload:{name:'Teste',text:'',clientId:randomUUID(),attachmentIds:[gifId]}});assert.equal(gifMessage.statusCode,201);
    const savedGif=await app.inject('/media/'+gifId);assert.equal(savedGif.headers['content-type'],'image/gif');assert.equal((await sharp(savedGif.rawPayload,{animated:true}).metadata()).pages,2);
    const paused=await app.inject('/media/'+gifId+'?still=1');assert.equal(paused.statusCode,200);assert.equal(paused.headers['content-type'],'image/png');assert.equal((await sharp(paused.rawPayload).metadata()).height,2);
  }finally{await app.close();}
});
test('legacy messages migrate to the general chat without losing data', async () => {
  const {DatabaseSync}=await import('node:sqlite');const directory=mkdtempSync(join(tmpdir(),'pg-chat-test-'));const dbPath=join(directory,'chat.sqlite');
  const old=new DatabaseSync(dbPath);old.exec('CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT,client_id TEXT UNIQUE,name TEXT,text TEXT,timestamp INTEGER)');old.prepare('INSERT INTO messages(client_id,name,text,timestamp) VALUES(?,?,?,?)').run(randomUUID(),'Amigo antigo','Mensagem preservada',123);old.close();
  const app=await createApp({...options,dbPath});
  try{const messages=(await app.inject('/messages')).json().messages;assert.equal(messages.length,1);assert.equal(messages[0].text,'Mensagem preservada');assert.equal(messages[0].channel,'general');assert.deepEqual(messages[0].attachments,[]);assert.equal((await app.inject('/messages?channel=voice:geral')).json().messages.length,0);}
  finally{await app.close();for(const name of ['chat.sqlite','chat.sqlite-wal','chat.sqlite-shm'])rmSync(join(directory,name),{force:true});rmdirSync(directory);}
});
test('arquivos gerais são baixados com segurança e não podem virar imagens de perfil', async () => {
  const app=await createApp({...options,dbPath:':memory:'});
  try {
    const id=randomUUID(), contents=Buffer.from('<script>alert(1)</script>');
    const headers={'content-type':'application/octet-stream','x-upload-id':id,'x-upload-channel':'general','x-upload-name':encodeURIComponent('anotação.html')};
    const uploaded=await app.inject({method:'POST',url:'/uploads',headers,payload:contents});
    assert.equal(uploaded.statusCode,201);assert.equal(uploaded.json().mime,'application/octet-stream');assert.equal(uploaded.json().filename,'anotação.html');
    assert.equal((await app.inject({method:'PATCH',url:'/profile',payload:{description:'',avatarId:id}})).statusCode,400);
    const message=await app.inject({method:'POST',url:'/messages',payload:{clientId:randomUUID(),channel:'voice:geral',attachmentIds:[id]}});assert.equal(message.statusCode,201);
    const downloaded=await app.inject('/media/'+id);assert.equal(downloaded.statusCode,200);assert.equal(downloaded.headers['content-type'],'application/octet-stream');assert.match(downloaded.headers['content-disposition'],/^attachment;/);assert.match(downloaded.headers['content-disposition'],/anota%C3%A7%C3%A3o.html/);assert.deepEqual(downloaded.rawPayload,contents);
  } finally {await app.close();}
});
test('Chat de call recebe e devolve um arquivo de 100 MB', async () => {
  const app=await createApp({...options,dbPath:':memory:'});
  try {
    const id=randomUUID(),contents=Buffer.alloc(100*1024*1024,0x41);
    const headers={'content-type':'application/octet-stream','x-upload-id':id,'x-upload-channel':'voice:geral','x-upload-name':'arquivo.bin'};
    const uploaded=await app.inject({method:'POST',url:'/uploads',headers,payload:contents});
    assert.equal(uploaded.statusCode,201);assert.equal(uploaded.json().size,contents.length);
    assert.equal((await app.inject({method:'POST',url:'/messages',payload:{clientId:randomUUID(),channel:'voice:geral',attachmentIds:[id]}})).statusCode,201);
    const downloaded=await app.inject('/media/'+id);assert.equal(downloaded.statusCode,200);assert.deepEqual(downloaded.rawPayload,contents);
  } finally {await app.close();}
});
test('Chats aceitam imagens acima de 8 MB e fotos de perfil preservam o limite', async () => {
  const {default:sharp}=await import('sharp');
  const app=await createApp({...options,dbPath:':memory:'});
  try {
    const image=await sharp(randomBytes(1800*1800*3),{raw:{width:1800,height:1800,channels:3}}).png({compressionLevel:0}).toBuffer();
    assert.ok(image.length>8*1024*1024);
    const id=randomUUID(), headers={'content-type':'application/octet-stream','x-upload-id':id,'x-upload-channel':'general'};
    const uploaded=await app.inject({method:'POST',url:'/uploads',headers,payload:image});
    assert.equal(uploaded.statusCode,201);assert.ok(uploaded.json().size>8*1024*1024);
    assert.equal((await app.inject({method:'PATCH',url:'/profile',payload:{description:'',avatarId:id}})).statusCode,400);
    assert.equal((await app.inject({method:'POST',url:'/messages',payload:{clientId:randomUUID(),channel:'voice:geral',attachmentIds:[id]}})).statusCode,201);
    assert.equal((await app.inject({method:'POST',url:'/uploads',headers:{...headers,'x-upload-id':randomUUID()},payload:Buffer.alloc(100*1024*1024+1)})).statusCode,413);
  } finally {await app.close();}
});
test('upload size and storage limits fail clearly without accepting the image', async () => {
  const {default:sharp}=await import('sharp');const app=await createApp({...options,dbPath:':memory:',maxMediaStorageBytes:1});
  try{const image=await sharp({create:{width:2,height:2,channels:3,background:'#c6352c'}}).png().toBuffer();assert.equal((await app.inject({method:'POST',url:'/uploads',headers:{'content-type':'application/octet-stream','x-upload-id':randomUUID()},payload:image})).statusCode,507);assert.equal((await app.inject({method:'POST',url:'/uploads',headers:{'content-type':'application/octet-stream','x-upload-id':randomUUID()},payload:Buffer.alloc(8*1024*1024+1)})).statusCode,413);}
  finally{await app.close();}
});

test('stored images survive restart alongside the right conversation', async () => {
  const {default:sharp}=await import('sharp');const directory=mkdtempSync(join(tmpdir(),'pg-chat-test-'));const dbPath=join(directory,'chat.sqlite');let app=await createApp({...options,dbPath});
  try{
    const id=randomUUID();const image=await sharp({create:{width:8,height:6,channels:3,background:'#c6352c'}}).png().toBuffer();
    assert.equal((await app.inject({method:'POST',url:'/uploads',headers:{'content-type':'application/octet-stream','x-upload-id':id},payload:image})).statusCode,201);
    assert.equal((await app.inject({method:'POST',url:'/messages',payload:{name:'Teste',channel:'voice:jogatina',text:'',clientId:randomUUID(),attachmentIds:[id]}})).statusCode,201);
    await app.close();app=await createApp({...options,dbPath});
    assert.equal((await app.inject('/messages?channel=voice:jogatina')).json().messages[0].attachments[0].id,id);
    assert.equal((await app.inject('/messages')).json().messages.length,0);
    assert.equal((await app.inject('/media/'+id)).statusCode,200);
  }finally{await app.close();for(const name of ['chat.sqlite','chat.sqlite-wal','chat.sqlite-shm'])rmSync(join(directory,name),{force:true});rmdirSync(directory);}
});

test('health identifies the accounts backend so the launcher can replace older versions',async()=>{
  const app=await createRawApp({...options,dbPath:':memory:'});
  try{
    const health=(await app.inject({url:'/health'})).json();
    assert.equal(health.application,'progresso-gang-chat');
    assert.ok(health.version>=4);
    assert.ok(health.features.includes('accounts'));
    assert.equal(health.pid,process.pid);
    // Login must exist (401 for bad credentials), never Fastify's 404 "Not Found".
    assert.equal((await app.inject({method:'POST',url:'/auth/login',headers:{origin:'http://localhost:5173'},payload:{username:'ninguem',password:testPassword}})).statusCode,401);
  }finally{await app.close();}
});

test('cor do nick aceita só #RRGGBB legível e é mantida por clientes antigos', async () => {
  const app=await createApp({...options,dbPath:':memory:'});
  try {
    const profile=async()=>(await app.inject('/presence')).json().profiles[0];
    assert.equal((await profile()).nameColor,null);
    assert.equal((await app.inject({method:'PATCH',url:'/profile',payload:{description:'',avatarId:null,nameColor:'#FF8800'}})).statusCode,200);
    assert.equal((await profile()).nameColor,'#ff8800');
    for (const nameColor of ['#000000','#111','red','#gg0000',12]) assert.equal((await app.inject({method:'PATCH',url:'/profile',payload:{description:'',avatarId:null,nameColor}})).statusCode,400);
    assert.equal((await app.inject({method:'PATCH',url:'/profile',payload:{description:'sem cor no pedido',avatarId:null}})).statusCode,200);
    assert.equal((await profile()).nameColor,'#ff8800');
    assert.equal((await app.inject({method:'PATCH',url:'/profile',payload:{description:'',avatarId:null,nameColor:null}})).statusCode,200);
    assert.equal((await profile()).nameColor,null);
  } finally { await app.close(); }
});

test('GIPHY expõe configuração apenas para membros e salva a referência como mensagem', async () => {
  const disabled=await createApp({...options,dbPath:':memory:'});
  try { assert.equal((await disabled.inject('/gifs/config')).statusCode,503); } finally { await disabled.close(); }
  const app=await createApp({...options,dbPath:':memory:',gifApiKey:'chave-teste'});
  try {
    assert.equal((await app.inject({url:'/gifs/config',headers:{cookie:''}})).statusCode,401);
    const config=await app.inject('/gifs/config');
    assert.equal(config.statusCode,200);
    assert.equal(config.json().apiKey,'chave-teste');
    assert.equal(config.headers['cache-control'],'no-store');
    const message=await app.inject({method:'POST',url:'/messages',payload:{channel:'general',clientId:randomUUID(),text:'[[giphy:abc123]]'}});
    assert.equal(message.statusCode,201);
    assert.equal(message.json().text,'[[giphy:abc123]]');
    assert.deepEqual(message.json().attachments,[]);
    assert.equal((await app.inject('/messages?channel=general')).json().messages[0].text,'[[giphy:abc123]]');
    assert.equal((await app.inject({method:'POST',url:'/gifs/abc123',payload:{id:randomUUID(),channel:'general'}})).statusCode,404);
  } finally { await app.close(); }
});

test('status personalizado tem limite, é mantido por clientes antigos e aparece na presença', async () => {
  const app=await createApp({...options,dbPath:':memory:'});
  try {
    const profile=async()=>(await app.inject('/presence')).json().profiles[0];
    assert.equal((await profile()).status,'');
    assert.equal((await app.inject('/presence')).json().statuses,true);
    assert.equal((await app.inject({method:'PATCH',url:'/profile',payload:{description:'',avatarId:null,status:'  Jogando Valorant 🎮  '}})).statusCode,200);
    assert.equal((await profile()).status,'Jogando Valorant 🎮');
    for (const status of ['x'.repeat(61),'duas\nlinhas',42]) assert.equal((await app.inject({method:'PATCH',url:'/profile',payload:{description:'',avatarId:null,status}})).statusCode,400);
    assert.equal((await app.inject({method:'PATCH',url:'/profile',payload:{description:'outra',avatarId:null,nameColor:'#ff8800'}})).statusCode,200);
    assert.equal((await profile()).status,'Jogando Valorant 🎮');
    assert.equal((await profile()).nameColor,'#ff8800');
    assert.equal((await app.inject({method:'PATCH',url:'/profile',payload:{description:'',avatarId:null,status:''}})).statusCode,200);
    assert.equal((await profile()).status,'');
    assert.equal((await profile()).nameColor,'#ff8800');
  } finally { await app.close(); }
});

test('administrador reordena canais e seções; membros não podem', async () => {
  const app=await createApp({...options,dbPath:':memory:'});
  try {
    const channels=(await app.inject('/channels')).json();
    const order=[...channels.voice.map(c=>({kind:'voice',id:c.id})).reverse(),...channels.text.map(c=>({kind:'text',id:c.id}))];
    assert.equal((await app.inject({method:'POST',url:'/admin/channels/order',payload:{order}})).statusCode,200);
    const after=(await app.inject('/channels')).json();
    assert.deepEqual(after.voice.map(c=>c.id),order.filter(c=>c.kind==='voice').map(c=>c.id));
    assert.ok(Math.min(...after.voice.map(c=>Number(c.position)))<Math.min(...after.text.map(c=>Number(c.position))));
    assert.equal((await app.inject({method:'POST',url:'/admin/channels/order',payload:{order:order.slice(1)}})).statusCode,409);
    assert.equal((await app.inject({method:'POST',url:'/admin/channels/order',payload:{order:[...order,order[0]]}})).statusCode,400);
    const invite=await app.inject({method:'POST',url:'/admin/invites',payload:{}});
    const member=await app.inject({method:'POST',url:'/auth/register',payload:{token:invite.json().token,username:'Membro ordem',password:testPassword}});
    assert.equal((await app.inject({method:'POST',url:'/admin/channels/order',headers:{cookie:'pg_session='+member.cookies[0].value,'x-csrf-token':member.json().csrf},payload:{order}})).statusCode,403);
  } finally { await app.close(); }
});

test('administrador exclui canal com histórico e anexos sem afetar outros canais',async()=>{
  const app=await createApp({...options,dbPath:':memory:'});
  try{
    const create=name=>app.inject({method:'POST',url:'/admin/channels',payload:{name,kind:'text'}});
    const empty=(await create('Canal vazio')).json().id;
    const history=(await create('Canal com histórico')).json().id;
    const attachmentId=randomUUID();
    const upload=await app.inject({method:'POST',url:'/uploads',headers:{'content-type':'application/octet-stream','x-upload-id':attachmentId,'x-upload-channel':history,'x-upload-name':'teste.txt'},payload:Buffer.from('anexo de teste')});
    assert.equal(upload.statusCode,201);
    const sent=await app.inject({method:'POST',url:'/messages',payload:{channel:history,clientId:randomUUID(),text:'Histórico',attachmentIds:[attachmentId]}});
    assert.equal(sent.statusCode,201);
    assert.equal((await app.inject({method:'POST',url:'/messages',payload:{channel:history,clientId:randomUUID(),text:'Resposta',replyTo:sent.json().id}})).statusCode,201);
    const kept=await app.inject({method:'POST',url:'/messages',payload:{channel:'general',clientId:randomUUID(),text:'Outro canal'}});
    assert.equal((await app.inject({method:'DELETE',url:'/admin/channels/text/general'})).statusCode,409);
    assert.equal((await app.inject({method:'DELETE',url:'/admin/channels/voice/geral'})).statusCode,409);
    const invite=await app.inject({method:'POST',url:'/admin/invites',payload:{}});
    const member=await app.inject({method:'POST',url:'/auth/register',payload:{token:invite.json().token,username:'Membro canal',password:testPassword}});
    assert.equal((await app.inject({method:'DELETE',url:'/admin/channels/text/'+empty,headers:{cookie:'pg_session='+member.cookies[0].value,'x-csrf-token':member.json().csrf}})).statusCode,403);
    assert.equal((await app.inject({method:'DELETE',url:'/admin/channels/text/'+history,headers:{cookie:'pg_session='+member.cookies[0].value,'x-csrf-token':member.json().csrf}})).statusCode,403);
    assert.equal((await app.inject({method:'DELETE',url:'/admin/channels/text/'+history})).statusCode,200);
    assert.equal((await app.inject({url:'/messages?channel='+history})).statusCode,400);
    assert.equal((await app.inject({url:'/media/'+attachmentId})).statusCode,404);
    assert.equal((await app.inject({url:'/messages?channel=general'})).json().messages.some(message=>message.id===kept.json().id),true);
    assert.equal((await app.inject({method:'DELETE',url:'/admin/channels/text/'+empty})).statusCode,200);
    assert.equal((await app.inject({method:'POST',url:'/messages',payload:{channel:empty,clientId:randomUUID(),text:'Tarde demais'}})).statusCode,400);
    const race=(await create('Canal simultâneo')).json().id;
    const [remove,send]=await Promise.all([app.inject({method:'DELETE',url:'/admin/channels/text/'+race}),app.inject({method:'POST',url:'/messages',payload:{channel:race,clientId:randomUUID(),text:'Mensagem simultânea'}})]);
    assert.equal(remove.statusCode,200);
    assert.ok([201,400,409].includes(send.statusCode));
    assert.equal((await app.inject({url:'/messages?channel='+race})).statusCode,400);
  }finally{await app.close();}
});

test('banner e cores do perfil são validados, preservados e públicos só para leitura', async () => {
  const {default:sharp}=await import('sharp');
  const app=await createApp({...options,dbPath:':memory:'});
  try {
    const profile=async()=>(await app.inject('/presence')).json().profiles[0];
    const patch=payload=>app.inject({method:'PATCH',url:'/profile',payload:{description:'',avatarId:null,...payload}});
    assert.equal((await app.inject('/presence')).json().appearance,true);
    const initial=await profile();
    assert.equal(initial.active,true);
    assert.equal(initial.bannerUrl,null);assert.equal(initial.appearanceMode,'auto');assert.deepEqual(initial.bannerCrop,{x:50,y:50,zoom:100});assert.deepEqual(initial.badges,[]);assert.ok(initial.memberSince>0);
    const id=randomUUID();
    const image=await sharp({create:{width:68,height:24,channels:3,background:'#3366aa'}}).png().toBuffer();
    assert.equal((await app.inject({method:'POST',url:'/uploads',headers:{'content-type':'application/octet-stream','x-upload-id':id},payload:image})).statusCode,201);
    assert.equal((await patch({bannerId:id,bannerCrop:{x:30,y:70,zoom:150},autoPalette:['#1A2B3C','#102030','#AABBCC']})).statusCode,200);
    let saved=await profile();
    assert.equal(saved.bannerUrl,'/api/media/'+id);assert.deepEqual(saved.bannerCrop,{x:30,y:70,zoom:150});assert.deepEqual(saved.autoPalette,['#1a2b3c','#102030','#aabbcc']);
    assert.equal((await app.inject('/media/'+id)).statusCode,200);
    // O banner não pode virar anexo de mensagem.
    assert.equal((await app.inject({method:'POST',url:'/messages',payload:{clientId:randomUUID(),attachmentIds:[id]}})).statusCode,409);
    // Cores manuais ficam guardadas ao voltar para o automático e ao trocar o banner.
    assert.equal((await patch({appearanceMode:'custom',customColors:['#222222','#333333','#ff8800']})).statusCode,200);
    assert.equal((await patch({appearanceMode:'auto'})).statusCode,200);
    assert.equal((await patch({bannerId:null,autoPalette:null})).statusCode,200);
    saved=await profile();
    assert.equal(saved.appearanceMode,'auto');assert.deepEqual(saved.customColors,['#222222','#333333','#ff8800']);assert.equal(saved.bannerUrl,null);assert.equal(saved.autoPalette,null);
    // Clientes antigos não apagam a aparência.
    assert.equal((await patch({appearanceMode:'custom',bannerId:id})).statusCode,200);
    assert.equal((await patch({description:'cliente antigo'})).statusCode,200);
    saved=await profile();assert.equal(saved.appearanceMode,'custom');assert.equal(saved.bannerUrl,'/api/media/'+id);
    for (const payload of [{customColors:['red','#000000','#ffffff']},{customColors:['#000000','#ffffff']},{customColors:['#000000;}body{','#000000','#000000']},{autoPalette:'#000000 #000000 #000000'},{appearanceMode:'dark'},{bannerCrop:{x:101,y:0,zoom:100}},{bannerCrop:{x:1.5,y:0,zoom:100}},{bannerCrop:{x:0,y:0,zoom:50}},{bannerId:'nao-e-uuid'},{bannerId:randomUUID()}])
      assert.equal((await patch(payload)).statusCode,400,JSON.stringify(payload));
    assert.equal((await app.inject({method:'POST',url:'/auth/logout',payload:{}})).statusCode,200);
    const login=await app.inject({method:'POST',url:'/auth/login',payload:{username:'Vitão',password:testPassword}});
    assert.equal(login.statusCode,200);
    const cookie=login.cookies[0].name+'='+login.cookies[0].value;
    const afterLogin=(await app.inject({url:'/presence',headers:{cookie}})).json().profiles[0];
    assert.equal(afterLogin.bannerUrl,'/api/media/'+id);
    assert.equal(afterLogin.appearanceMode,'custom');
    assert.deepEqual(afterLogin.customColors,['#222222','#333333','#ff8800']);
  } finally { await app.close(); }
});

test('somente administradores concedem a insígnia de Membro Fundador', async () => {
  const app=await createApp({...options,dbPath:':memory:'});
  try {
    const owner=(await app.inject('/presence')).json().profiles[0];
    assert.equal((await app.inject({method:'PUT',url:'/admin/users/'+owner.id+'/badges/founder'})).statusCode,200);
    assert.equal((await app.inject({method:'PUT',url:'/admin/users/'+owner.id+'/badges/founder'})).statusCode,200);
    assert.deepEqual((await app.inject('/presence')).json().profiles[0].badges,['founder']);
    assert.equal((await app.inject({method:'PUT',url:'/admin/users/'+owner.id+'/badges/rei'})).statusCode,404);
    assert.equal((await app.inject({method:'PUT',url:'/admin/users/'+randomUUID()+'/badges/founder'})).statusCode,404);
    // Um membro não pode se conceder a insígnia nem mexer pelo perfil.
    const invite=(await app.inject({method:'POST',url:'/admin/invites'})).json().token;
    const register=await app.inject({method:'POST',url:'/auth/register',headers:{cookie:''},payload:{token:invite,username:'Membro',password:testPassword}});
    assert.equal(register.statusCode,201);
    const memberCookie=register.cookies.find(item=>item.name==='pg_session'),memberCsrf=register.json().csrf,member=register.json().user;
    const asMember=(method,url,payload)=>app.inject({method,url,payload,headers:{cookie:memberCookie.name+'='+memberCookie.value,'x-csrf-token':memberCsrf}});
    assert.equal((await asMember('PUT','/admin/users/'+member.id+'/badges/founder')).statusCode,403);
    assert.equal((await asMember('PATCH','/profile',{description:'',avatarId:null,badges:['founder']})).statusCode,200);
    assert.deepEqual((await app.inject('/presence')).json().profiles.find(item=>item.id===member.id).badges,[]);
    assert.equal((await app.inject({method:'DELETE',url:'/admin/users/'+owner.id+'/badges/founder'})).statusCode,200);
    // Conta desativada aparece marcada para não entrar na lista de offline.
    assert.equal((await app.inject({method:'PATCH',url:'/admin/users/'+member.id,payload:{role:'member',active:false}})).statusCode,200);
    assert.equal((await app.inject('/presence')).json().profiles.find(item=>item.id===member.id).active,false);
    assert.deepEqual((await app.inject('/presence')).json().profiles[0].badges,[]);
  } finally { await app.close(); }
});
