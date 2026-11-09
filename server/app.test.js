import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { TokenVerifier } from 'livekit-server-sdk';
import { createApp as createRawApp } from './app.js';
import { normalizeSoundboardWav } from './soundboard-audio.js';
const options = { apiKey: 'testkey', apiSecret: randomBytes(32).toString('hex'), serverUrl: 'ws://localhost:7880', logger: false, secureCookies:false, allowedOrigins:['http://localhost:5173'] };

const testPassword=randomBytes(24).toString('base64url');
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
test('soundboard validates audio length and separates channels', async () => {
  const app=await createApp({...options,dbPath:':memory:'});
  const wav=Buffer.alloc(44+44100);
  wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(22050,24);wav.writeUInt32LE(44100,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(wav.length-44,40);
  const headers={'content-type':'application/octet-stream','x-sound-channel':'geral','x-sound-name':encodeURIComponent('Som de teste')};
  try {
    const upload=await app.inject({method:'POST',url:'/soundboard',headers,payload:wav});
    assert.equal(upload.statusCode,201,upload.body);
    const id=upload.json().id;
    assert.equal((await app.inject('/soundboard?channel=geral')).json().sounds.length,1);
    assert.equal((await app.inject('/soundboard?channel=jogatina')).json().sounds.length,0);
    assert.equal((await app.inject('/soundboard/'+id+'?channel=jogatina')).statusCode,404);
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
    assert.equal((await app.inject({method:'POST',url:'/messages',payload:{clientId:randomUUID(),attachmentIds:[id]}})).statusCode,409);
    assert.equal((await app.inject({method:'PATCH',url:'/profile',payload:{description:'x'.repeat(201),avatarId:null}})).statusCode,400);
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
