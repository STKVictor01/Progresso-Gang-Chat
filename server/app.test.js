import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { TokenVerifier } from 'livekit-server-sdk';
import { createApp } from './app.js';
const options = { apiKey: 'testkey', apiSecret: 'test-secret-for-isolated-tests-0123456789', serverUrl: 'ws://localhost:7880', logger: false };
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
    assert.equal((await app.inject({ method: 'POST', url: '/token', payload: { name: 'a' } })).statusCode, 400);
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
